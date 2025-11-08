// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use redis::{Client, aio::ConnectionManager, AsyncCommands, RedisError, RedisResult};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::strategy::{StrategyId};
use crate::telemetry::StrategyPerformance;

/// Errors that can occur in the correlation engine
#[derive(Debug, Error)]
pub enum CorrelationError {
    #[error("Redis error: {0}")]
    RedisError(#[from] RedisError),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for correlation operations
pub type CorrelationResult<T> = Result<T, CorrelationError>;

/// A snapshot of strategy returns at a specific time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyReturnSnapshot {
    /// Strategy identifier
    pub strategy_id: StrategyId,
    
    /// Timestamp of the return
    pub timestamp: DateTime<Utc>,
    
    /// Return percentage
    pub return_pct: f64,
}

/// Time period for return aggregation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimePeriod {
    /// 15-minute intervals
    Minutes15,
    
    /// Hourly intervals
    Hourly,
    
    /// 4-hour intervals
    Hours4,
    
    /// Daily intervals
    Daily,
    
    /// Weekly intervals
    Weekly,
}

impl TimePeriod {
    /// Convert time period to seconds
    pub fn to_seconds(&self) -> i64 {
        match self {
            TimePeriod::Minutes15 => 15 * 60,
            TimePeriod::Hourly => 60 * 60,
            TimePeriod::Hours4 => 4 * 60 * 60,
            TimePeriod::Daily => 24 * 60 * 60,
            TimePeriod::Weekly => 7 * 24 * 60 * 60,
        }
    }
}

/// Configuration for the correlation engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationEngineConfig {
    /// Redis connection string
    pub redis_url: String,
    
    /// Redis key prefix
    pub redis_key_prefix: String,
    
    /// Minimum number of data points required for valid correlation
    pub min_data_points: usize,
    
    /// Maximum number of return snapshots to store per strategy
    pub max_snapshots_per_strategy: usize,
    
    /// Default time period for analysis
    pub default_time_period: TimePeriod,
    
    /// Cache TTL in seconds
    pub cache_ttl_sec: u64,
    
    /// How frequently to refresh correlation matrix (seconds)
    pub refresh_interval_sec: u64,
}

impl Default for CorrelationEngineConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://127.0.0.1:6379".to_string(),
            redis_key_prefix: "noderr:correlation".to_string(),
            min_data_points: 10,
            max_snapshots_per_strategy: 2000, // About 30 days of 15-min data
            default_time_period: TimePeriod::Daily,
            cache_ttl_sec: 3600, // 1 hour
            refresh_interval_sec: 300, // 5 minutes
        }
    }
}

/// Correlation matrix between strategies
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationMatrix {
    /// Timestamp when this matrix was computed
    pub timestamp: DateTime<Utc>,
    
    /// Period over which the correlation was calculated
    pub period: TimePeriod,
    
    /// Number of data points used to compute the correlation
    pub data_points: usize,
    
    /// Strategy IDs in the matrix
    pub strategy_ids: Vec<StrategyId>,
    
    /// Matrix data: [strategy_index][strategy_index] -> correlation
    pub matrix: Vec<Vec<f64>>,
}

/// Strategy risk weights adjusted by correlation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyRiskWeights {
    /// Timestamp when weights were calculated
    pub timestamp: DateTime<Utc>,
    
    /// Original weights before correlation adjustment
    pub original_weights: HashMap<StrategyId, f64>,
    
    /// Adjusted weights after correlation analysis
    pub adjusted_weights: HashMap<StrategyId, f64>,
    
    /// Average correlation for each strategy
    pub avg_correlations: HashMap<StrategyId, f64>,
}

/// Trait defining the correlation engine interface
#[async_trait]
pub trait CorrelationEngine: Send + Sync {
    /// Track a new return for a strategy
    async fn track_return(&self, strategy_id: &StrategyId, timestamp: DateTime<Utc>, return_pct: f64) -> CorrelationResult<()>;
    
    /// Track returns from strategy performance
    async fn track_from_performance(&self, performance: &StrategyPerformance) -> CorrelationResult<()>;
    
    /// Get historical returns for a strategy
    async fn get_strategy_returns(
        &self,
        strategy_id: &StrategyId,
        period: TimePeriod,
        limit: Option<usize>,
    ) -> CorrelationResult<Vec<StrategyReturnSnapshot>>;
    
    /// Calculate correlation between two strategies
    async fn calculate_correlation(
        &self,
        strategy_id1: &StrategyId,
        strategy_id2: &StrategyId,
        period: TimePeriod,
    ) -> CorrelationResult<f64>;
    
    /// Generate correlation matrix for all strategies
    async fn generate_correlation_matrix(&self, period: TimePeriod) -> CorrelationResult<CorrelationMatrix>;
    
    /// Calculate risk allocation weights adjusted for correlation
    async fn calculate_risk_weights(
        &self,
        base_weights: HashMap<StrategyId, f64>,
    ) -> CorrelationResult<StrategyRiskWeights>;
    
    /// Initialize the correlation engine
    async fn initialize(&self) -> CorrelationResult<()>;
}

/// Default implementation of the correlation engine
pub struct DefaultCorrelationEngine {
    /// Configuration
    config: CorrelationEngineConfig,
    
    /// Redis connection
    redis: Arc<RwLock<Option<ConnectionManager>>>,
    
    /// Cached correlation matrix
    cached_matrix: Arc<RwLock<Option<(CorrelationMatrix, Instant)>>>,
    
    /// Last refresh time for strategy returns
    last_refresh: Arc<RwLock<HashMap<StrategyId, Instant>>>,
}

impl DefaultCorrelationEngine {
    /// Create a new DefaultCorrelationEngine
    pub fn new(config: CorrelationEngineConfig) -> Self {
        Self {
            config,
            redis: Arc::new(RwLock::new(None)),
            cached_matrix: Arc::new(RwLock::new(None)),
            last_refresh: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Initialize with default configuration
    pub fn default() -> Self {
        Self::new(CorrelationEngineConfig::default())
    }
    
    /// Generate a Redis key for strategy returns
    fn returns_key(&self, strategy_id: &StrategyId) -> String {
        format!("{}:strategy:{}:returns", self.config.redis_key_prefix, strategy_id)
    }
    
    /// Generate a Redis key for correlation matrix
    fn matrix_key(&self, period: TimePeriod) -> String {
        format!("{}:matrix:{:?}", self.config.redis_key_prefix, period)
    }
    
    /// Generate a Redis key for risk weights
    fn weights_key(&self) -> String {
        format!("{}:weights", self.config.redis_key_prefix)
    }
    
    /// Execute a Redis command
    async fn execute_redis_command<T, F>(&self, f: F) -> Result<T, RedisError>
    where
        T: redis::FromRedisValue,
        F: FnOnce(&mut ConnectionManager) -> RedisResult<T> + Send,
    {
        let redis_guard = self.redis.read().await;
        if let Some(ref conn) = *redis_guard {
            let mut conn_clone = conn.clone();
            f(&mut conn_clone).await
        } else {
            Err(RedisError::from((redis::ErrorKind::ClientError, "Redis connection not initialized")))
        }
    }
    
    /// Store a return snapshot in Redis
    async fn store_return(&self, snapshot: &StrategyReturnSnapshot) -> CorrelationResult<()> {
        let key = self.returns_key(&snapshot.strategy_id);
        let data = serde_json::to_string(snapshot)
            .map_err(|e| CorrelationError::SerializationError(e.to_string()))?;
        
        // Store using ZADD with score as timestamp for sorted access
        let timestamp_seconds = snapshot.timestamp.timestamp();
        
        self.execute_redis_command(|conn| async move {
            conn.zadd(key, data, timestamp_seconds).await
        }).await?;
        
        // Trim to max size
        self.execute_redis_command(|conn| async move {
            conn.zremrangebyrank(
                &self.returns_key(&snapshot.strategy_id), 
                0, 
                -(self.config.max_snapshots_per_strategy as isize) - 1
            ).await
        }).await?;
        
        debug!("Stored return snapshot for strategy {}", snapshot.strategy_id);
        Ok(())
    }
    
    /// Load return snapshots from Redis
    async fn load_returns(
        &self,
        strategy_id: &StrategyId,
        period: TimePeriod,
        limit: Option<usize>,
    ) -> CorrelationResult<Vec<StrategyReturnSnapshot>> {
        let key = self.returns_key(strategy_id);
        
        // Calculate time period boundaries
        let now = Utc::now();
        let period_seconds = period.to_seconds();
        let start_time = now - chrono::Duration::seconds(period_seconds);
        let start_timestamp = start_time.timestamp();
        let end_timestamp = now.timestamp();
        
        // Fetch sorted returns within time range
        let result: Vec<String> = self.execute_redis_command(|conn| async move {
            conn.zrangebyscore_limit(
                key,
                start_timestamp,
                end_timestamp,
                0,
                limit.unwrap_or(self.config.max_snapshots_per_strategy) as isize,
            ).await
        }).await?;
        
        // Deserialize results
        let mut snapshots = Vec::with_capacity(result.len());
        for data in result {
            let snapshot: StrategyReturnSnapshot = serde_json::from_str(&data)
                .map_err(|e| CorrelationError::SerializationError(e.to_string()))?;
            snapshots.push(snapshot);
        }
        
        debug!("Loaded {} return snapshots for strategy {}", snapshots.len(), strategy_id);
        Ok(snapshots)
    }
    
    /// Calculate Pearson correlation coefficient between two series
    fn calculate_pearson_correlation(series1: &[f64], series2: &[f64]) -> f64 {
        if series1.len() != series2.len() || series1.is_empty() {
            return 0.0;
        }
        
        let n = series1.len() as f64;
        let mean1: f64 = series1.iter().sum::<f64>() / n;
        let mean2: f64 = series2.iter().sum::<f64>() / n;
        
        let variance1: f64 = series1.iter()
            .map(|&x| (x - mean1).powi(2))
            .sum::<f64>() / n;
        
        let variance2: f64 = series2.iter()
            .map(|&x| (x - mean2).powi(2))
            .sum::<f64>() / n;
        
        let covariance: f64 = series1.iter().zip(series2.iter())
            .map(|(&x, &y)| (x - mean1) * (y - mean2))
            .sum::<f64>() / n;
        
        if variance1 <= 0.0 || variance2 <= 0.0 {
            return 0.0;
        }
        
        let std_dev1 = variance1.sqrt();
        let std_dev2 = variance2.sqrt();
        
        covariance / (std_dev1 * std_dev2)
    }
}

#[async_trait]
impl CorrelationEngine for DefaultCorrelationEngine {
    async fn initialize(&self) -> CorrelationResult<()> {
        let client = Client::open(self.config.redis_url.clone())
            .map_err(CorrelationError::RedisError)?;
        
        let connection = ConnectionManager::new(client)
            .await
            .map_err(CorrelationError::RedisError)?;
        
        let mut redis_guard = self.redis.write().await;
        *redis_guard = Some(connection);
        
        info!("Correlation engine Redis connection initialized");
        Ok(())
    }
    
    async fn track_return(&self, strategy_id: &StrategyId, timestamp: DateTime<Utc>, return_pct: f64) -> CorrelationResult<()> {
        let snapshot = StrategyReturnSnapshot {
            strategy_id: strategy_id.clone(),
            timestamp,
            return_pct,
        };
        
        self.store_return(&snapshot).await
    }
    
    async fn track_from_performance(&self, performance: &StrategyPerformance) -> CorrelationResult<()> {
        // Extract the strategy ID from performance
        let strategy_id = performance.strategy_id.clone();
        
        // Use daily PnL as the return percentage
        let return_pct = performance.daily_pnl;
        
        // Use current timestamp if no specific window end is provided
        let timestamp = performance.window_end.unwrap_or_else(Utc::now);
        
        self.track_return(&strategy_id, timestamp, return_pct).await
    }
    
    async fn get_strategy_returns(
        &self,
        strategy_id: &StrategyId,
        period: TimePeriod,
        limit: Option<usize>,
    ) -> CorrelationResult<Vec<StrategyReturnSnapshot>> {
        self.load_returns(strategy_id, period, limit).await
    }
    
    async fn calculate_correlation(
        &self,
        strategy_id1: &StrategyId,
        strategy_id2: &StrategyId,
        period: TimePeriod,
    ) -> CorrelationResult<f64> {
        // If comparing with itself, correlation is always 1.0
        if strategy_id1 == strategy_id2 {
            return Ok(1.0);
        }
        
        // Get returns for both strategies
        let returns1 = self.load_returns(strategy_id1, period, None).await?;
        let returns2 = self.load_returns(strategy_id2, period, None).await?;
        
        if returns1.is_empty() || returns2.is_empty() {
            return Err(CorrelationError::InsufficientData(
                format!("No return data found for strategy {} and/or {}", strategy_id1, strategy_id2)
            ));
        }
        
        // Create a map of timestamp -> return for efficient lookup
        let mut returns_map1 = HashMap::with_capacity(returns1.len());
        for snapshot in &returns1 {
            returns_map1.insert(snapshot.timestamp, snapshot.return_pct);
        }
        
        // Find matching timestamps and create paired return series
        let mut series1 = Vec::new();
        let mut series2 = Vec::new();
        
        for snapshot in &returns2 {
            if let Some(&return1) = returns_map1.get(&snapshot.timestamp) {
                series1.push(return1);
                series2.push(snapshot.return_pct);
            }
        }
        
        // Check if we have enough data points for correlation
        if series1.len() < self.config.min_data_points {
            return Err(CorrelationError::InsufficientData(
                format!("Insufficient matching data points between strategies {} and {}: found {}, need {}",
                    strategy_id1, strategy_id2, series1.len(), self.config.min_data_points)
            ));
        }
        
        // Calculate Pearson correlation
        let correlation = Self::calculate_pearson_correlation(&series1, &series2);
        
        // Ensure result is in the valid range [-1, 1]
        let correlation = correlation.max(-1.0).min(1.0);
        
        Ok(correlation)
    }
    
    async fn generate_correlation_matrix(&self, period: TimePeriod) -> CorrelationResult<CorrelationMatrix> {
        // Check if we have a recent cached matrix
        {
            let cached = self.cached_matrix.read().await;
            if let Some((matrix, timestamp)) = &*cached {
                if timestamp.elapsed() < Duration::from_secs(self.config.refresh_interval_sec) && matrix.period == period {
                    debug!("Using cached correlation matrix");
                    return Ok(matrix.clone());
                }
            }
        }
        
        // Get all strategy IDs that have return data
        let all_keys: Vec<String> = self.execute_redis_command(|conn| async move {
            conn.keys::<_, Vec<String>>(format!("{}:strategy:*:returns", self.config.redis_key_prefix)).await
        }).await?;
        
        // Extract strategy IDs from keys
        let strategy_ids: Vec<StrategyId> = all_keys.iter()
            .filter_map(|key| {
                let parts: Vec<&str> = key.split(':').collect();
                if parts.len() >= 3 {
                    Some(parts[2].to_string())
                } else {
                    None
                }
            })
            .collect();
        
        if strategy_ids.is_empty() {
            return Err(CorrelationError::InsufficientData("No strategies with return data found".to_string()));
        }
        
        // Initialize matrix with zeros
        let n = strategy_ids.len();
        let mut matrix = vec![vec![0.0; n]; n];
        
        // Diagonal is always 1.0 (perfect correlation with self)
        for i in 0..n {
            matrix[i][i] = 1.0;
        }
        
        // Calculate correlations for each pair of strategies
        for i in 0..n {
            for j in (i+1)..n {
                let correlation = match self.calculate_correlation(&strategy_ids[i], &strategy_ids[j], period).await {
                    Ok(corr) => corr,
                    Err(CorrelationError::InsufficientData(_)) => 0.0, // Use zero for insufficient data
                    Err(e) => return Err(e),
                };
                
                // Matrix is symmetric
                matrix[i][j] = correlation;
                matrix[j][i] = correlation;
            }
        }
        
        // Create matrix result
        let result = CorrelationMatrix {
            timestamp: Utc::now(),
            period,
            data_points: self.config.min_data_points,
            strategy_ids: strategy_ids.clone(),
            matrix,
        };
        
        // Cache the result
        {
            let mut cached = self.cached_matrix.write().await;
            *cached = Some((result.clone(), Instant::now()));
        }
        
        // Store in Redis
        let matrix_key = self.matrix_key(period);
        let matrix_data = serde_json::to_string(&result)
            .map_err(|e| CorrelationError::SerializationError(e.to_string()))?;
        
        if self.config.cache_ttl_sec > 0 {
            self.execute_redis_command(|conn| async move {
                conn.set_ex(matrix_key, matrix_data, self.config.cache_ttl_sec as usize).await
            }).await?;
        } else {
            self.execute_redis_command(|conn| async move {
                conn.set(matrix_key, matrix_data).await
            }).await?;
        }
        
        info!("Generated correlation matrix for {} strategies", n);
        Ok(result)
    }
    
    async fn calculate_risk_weights(
        &self,
        base_weights: HashMap<StrategyId, f64>,
    ) -> CorrelationResult<StrategyRiskWeights> {
        // Generate correlation matrix
        let matrix = self.generate_correlation_matrix(self.config.default_time_period).await?;
        
        // Create map for strategy index lookup
        let mut strategy_indices = HashMap::new();
        for (i, id) in matrix.strategy_ids.iter().enumerate() {
            strategy_indices.insert(id, i);
        }
        
        // Calculate average correlation for each strategy
        let mut avg_correlations = HashMap::new();
        for (id1, i) in &strategy_indices {
            let mut sum = 0.0;
            let mut count = 0;
            
            for (id2, j) in &strategy_indices {
                if id1 != id2 {
                    sum += matrix.matrix[*i][*j];
                    count += 1;
                }
            }
            
            let avg = if count > 0 { sum / count as f64 } else { 0.0 };
            avg_correlations.insert((*id1).clone(), avg);
        }
        
        // Adjust weights based on correlation
        let mut adjusted_weights = HashMap::new();
        
        // For each strategy, scale down weight by average correlation
        for (id, base_weight) in &base_weights {
            if let Some(avg_corr) = avg_correlations.get(id) {
                // Scale factor: 1.0 means no correlation, 0.0 means perfect correlation
                // We want to reduce weight as correlation increases, so we use (1 - avg_corr) as factor
                let scale_factor = (1.0 - avg_corr.abs()).max(0.2);  // Don't reduce below 20%
                let adjusted = base_weight * scale_factor;
                adjusted_weights.insert(id.clone(), adjusted);
            } else {
                // If no correlation data, keep original weight
                adjusted_weights.insert(id.clone(), *base_weight);
            }
        }
        
        // Normalize weights to sum to 1.0
        let total_weight: f64 = adjusted_weights.values().sum();
        if total_weight > 0.0 {
            for weight in adjusted_weights.values_mut() {
                *weight /= total_weight;
            }
        }
        
        let result = StrategyRiskWeights {
            timestamp: Utc::now(),
            original_weights: base_weights.clone(),
            adjusted_weights,
            avg_correlations,
        };
        
        // Store in Redis
        let weights_key = self.weights_key();
        let weights_data = serde_json::to_string(&result)
            .map_err(|e| CorrelationError::SerializationError(e.to_string()))?;
        
        if self.config.cache_ttl_sec > 0 {
            self.execute_redis_command(|conn| async move {
                conn.set_ex(weights_key, weights_data, self.config.cache_ttl_sec as usize).await
            }).await?;
        } else {
            self.execute_redis_command(|conn| async move {
                conn.set(weights_key, weights_data).await
            }).await?;
        }
        
        info!("Calculated risk weights for {} strategies", base_weights.len());
        Ok(result)
    }
}

/// Factory for creating correlation engines
pub struct CorrelationEngineFactory {
    // Private constructor to prevent direct instantiation
    _private: (),
}

impl CorrelationEngineFactory {
    /// Create a default correlation engine
    pub fn create_default() -> Arc<dyn CorrelationEngine> {
        Arc::new(DefaultCorrelationEngine::default())
    }
    
    /// Create a custom correlation engine with specific configuration
    pub fn create_custom(config: CorrelationEngineConfig) -> Arc<dyn CorrelationEngine> {
        Arc::new(DefaultCorrelationEngine::new(config))
    }
}

/// Create a correlation engine with default configuration
pub fn create_correlation_engine() -> Arc<dyn CorrelationEngine> {
    CorrelationEngineFactory::create_default()
}

/// Create a correlation engine with custom configuration
pub fn create_correlation_engine_with_config(config: CorrelationEngineConfig) -> Arc<dyn CorrelationEngine> {
    CorrelationEngineFactory::create_custom(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    
    #[tokio::test]
    async fn test_pearson_correlation() {
        // Perfect positive correlation
        let series1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let series2 = vec![2.0, 4.0, 6.0, 8.0, 10.0];
        
        let corr = DefaultCorrelationEngine::calculate_pearson_correlation(&series1, &series2);
        assert!((corr - 1.0).abs() < 0.0001);
        
        // Perfect negative correlation
        let series3 = vec![5.0, 4.0, 3.0, 2.0, 1.0];
        let corr = DefaultCorrelationEngine::calculate_pearson_correlation(&series1, &series3);
        assert!((corr + 1.0).abs() < 0.0001);
        
        // No correlation
        let series4 = vec![1.0, 3.0, 2.0, 5.0, 4.0];
        let corr = DefaultCorrelationEngine::calculate_pearson_correlation(&series1, &series4);
        assert!(corr.abs() < 0.5);
    }
} 