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

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use thiserror::Error;
use redis::{Client, AsyncCommands, aio::ConnectionManager};

use crate::analytics::{Analytics, AnalyticsResult, AnalyticsError, PerformanceSummary, ExecutionStats, Anomaly};
use crate::strategy::StrategyId;
use crate::telemetry_streamer::{TelemetryStreamer, TelemetryStreamError};

/// Error types for trust score operations
#[derive(Debug, Error)]
pub enum TrustScoreError {
    #[error("Analytics error: {0}")]
    AnalyticsError(#[from] AnalyticsError),
    
    #[error("Strategy not found: {0}")]
    StrategyNotFound(String),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Redis error: {0}")]
    RedisError(#[from] redis::RedisError),
    
    #[error("Telemetry stream error: {0}")]
    TelemetryStreamError(#[from] TelemetryStreamError),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Result type for trust score operations
pub type TrustScoreResult<T> = Result<T, TrustScoreError>;

/// Trust score feature weights configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreWeights {
    /// Weight for win rate (0.0-1.0)
    pub win_rate_weight: f64,
    
    /// Weight for Sharpe ratio (0.0-1.0)
    pub sharpe_ratio_weight: f64,
    
    /// Weight for Sortino ratio (0.0-1.0)
    pub sortino_ratio_weight: f64,
    
    /// Weight for drawdown metrics (0.0-1.0)
    pub drawdown_weight: f64,
    
    /// Weight for latency performance (0.0-1.0)
    pub latency_weight: f64,
    
    /// Weight for execution failures (0.0-1.0)
    pub failure_weight: f64,
    
    /// Weight for entropy penalty (0.0-1.0)
    pub entropy_penalty_weight: f64,
    
    /// Feature decay factor (0.0-1.0)
    pub feature_decay_factor: f64,
    
    /// Minimum trades required for reliable scoring
    pub min_trades_required: usize,
}

impl Default for TrustScoreWeights {
    fn default() -> Self {
        Self {
            win_rate_weight: 0.25,
            sharpe_ratio_weight: 0.15,
            sortino_ratio_weight: 0.15,
            drawdown_weight: 0.15,
            latency_weight: 0.10,
            failure_weight: 0.15,
            entropy_penalty_weight: 0.05,
            feature_decay_factor: 0.95, // 5% decay by default
            min_trades_required: 10,
        }
    }
}

/// Trust score configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreConfig {
    /// Feature weights
    pub weights: TrustScoreWeights,
    
    /// Redis connection string
    pub redis_url: String,
    
    /// Redis key prefix
    pub redis_key_prefix: String,
    
    /// Cache refresh interval in seconds
    pub cache_refresh_interval_sec: u64,
    
    /// Cache TTL in seconds
    pub cache_ttl_sec: u64,
    
    /// Trust score history retention period in days
    pub history_retention_days: u32,
    
    /// Maximum history entries to keep per strategy
    pub max_history_entries: usize,
}

impl Default for TrustScoreConfig {
    fn default() -> Self {
        Self {
            weights: TrustScoreWeights::default(),
            redis_url: "redis://127.0.0.1:6379".to_string(),
            redis_key_prefix: "noderr:trust".to_string(),
            cache_refresh_interval_sec: 300, // 5 minutes
            cache_ttl_sec: 3600, // 1 hour
            history_retention_days: 30,
            max_history_entries: 1000,
        }
    }
}

/// Features used for trust score calculation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreFeatures {
    /// Win rate (0.0-1.0)
    pub win_rate: f64,
    
    /// Number of trades
    pub total_trades: usize,
    
    /// Sharpe ratio normalized (0.0-1.0)
    pub normalized_sharpe: f64,
    
    /// Sortino ratio normalized (0.0-1.0)
    pub normalized_sortino: f64,
    
    /// Drawdown score (0.0-1.0), higher is better
    pub drawdown_score: f64,
    
    /// Latency score (0.0-1.0), higher is better
    pub latency_score: f64,
    
    /// Failure score (0.0-1.0), higher is better (fewer failures)
    pub failure_score: f64,
    
    /// Entropy penalty (0.0-1.0), higher is better
    pub entropy_score: f64,
    
    /// Timestamp when features were computed
    pub timestamp: DateTime<Utc>,
}

impl Default for TrustScoreFeatures {
    fn default() -> Self {
        Self {
            win_rate: 0.0,
            total_trades: 0,
            normalized_sharpe: 0.0,
            normalized_sortino: 0.0,
            drawdown_score: 0.0,
            latency_score: 0.0,
            failure_score: 0.0,
            entropy_score: 0.5, // Neutral default
            timestamp: Utc::now(),
        }
    }
}

/// Trust score with features
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScore {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Overall trust score (0.0-1.0)
    pub score: f64,
    
    /// Current features used to compute the score
    pub features: TrustScoreFeatures,
    
    /// Timestamp when the score was computed
    pub timestamp: DateTime<Utc>,
    
    /// Number of times this score has been updated
    pub update_count: u64,
}

impl TrustScore {
    /// Create a new trust score for a strategy
    pub fn new(strategy_id: &str) -> Self {
        Self {
            strategy_id: strategy_id.to_string(),
            score: 0.5, // Start with neutral trust
            features: TrustScoreFeatures::default(),
            timestamp: Utc::now(),
            update_count: 0,
        }
    }
}

/// Trust score historical entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreHistoryEntry {
    /// Trust score
    pub score: f64,
    
    /// Features used to compute the score
    pub features: TrustScoreFeatures,
    
    /// Timestamp when the score was computed
    pub timestamp: DateTime<Utc>,
}

/// Trust score history for a strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreHistory {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Historical entries, ordered by timestamp
    pub entries: Vec<TrustScoreHistoryEntry>,
}

/// Trust score engine trait
#[async_trait]
pub trait TrustScoreEngine: Send + Sync {
    /// Compute trust score for a strategy
    async fn compute_trust_score(&self, strategy_id: &str) -> TrustScoreResult<TrustScore>;
    
    /// Get the latest trust score for a strategy
    async fn get_trust_score(&self, strategy_id: &str) -> TrustScoreResult<TrustScore>;
    
    /// Extract features for a strategy
    async fn extract_features(&self, strategy_id: &str) -> TrustScoreResult<TrustScoreFeatures>;
    
    /// Get trust score history for a strategy
    async fn get_trust_history(&self, strategy_id: &str) -> TrustScoreResult<TrustScoreHistory>;
    
    /// Record a trust score update in history
    async fn record_history(&self, score: &TrustScore) -> TrustScoreResult<()>;
    
    /// Update trust score and publish it
    async fn update_and_publish(&self, strategy_id: &str) -> TrustScoreResult<TrustScore>;
}

/// Default implementation of the trust score engine
pub struct DefaultTrustScoreEngine {
    /// Trust score configuration
    config: TrustScoreConfig,
    
    /// Analytics service for retrieving metrics
    analytics: Arc<dyn Analytics>,
    
    /// Telemetry streamer for broadcasting updates
    telemetry_streamer: Option<Arc<dyn TelemetryStreamer>>,
    
    /// Redis connection manager
    redis: Arc<RwLock<Option<ConnectionManager>>>,
    
    /// In-memory cache of trust scores
    scores_cache: Arc<RwLock<HashMap<String, TrustScore>>>,
    
    /// Last cache refresh timestamps
    last_refresh: Arc<RwLock<HashMap<String, Instant>>>,
}

impl DefaultTrustScoreEngine {
    /// Create a new DefaultTrustScoreEngine
    pub fn new(
        config: TrustScoreConfig,
        analytics: Arc<dyn Analytics>,
        telemetry_streamer: Option<Arc<dyn TelemetryStreamer>>,
    ) -> Self {
        Self {
            config,
            analytics,
            telemetry_streamer,
            redis: Arc::new(RwLock::new(None)),
            scores_cache: Arc::new(RwLock::new(HashMap::new())),
            last_refresh: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Initialize the Redis connection
    pub async fn initialize(&self) -> TrustScoreResult<()> {
        let client = Client::open(self.config.redis_url.clone())
            .map_err(|e| TrustScoreError::RedisError(e))?;
        
        let connection = ConnectionManager::new(client)
            .await
            .map_err(|e| TrustScoreError::RedisError(e))?;
        
        let mut redis_guard = self.redis.write().await;
        *redis_guard = Some(connection);
        
        info!("Trust score engine Redis connection initialized");
        Ok(())
    }
    
    /// Generate a Redis key for trust score
    fn trust_score_key(&self, strategy_id: &str) -> String {
        format!("{}:strategy:{}:score", self.config.redis_key_prefix, strategy_id)
    }
    
    /// Generate a Redis key for trust history
    fn trust_history_key(&self, strategy_id: &str) -> String {
        format!("{}:strategy:{}:history", self.config.redis_key_prefix, strategy_id)
    }
    
    /// Execute a Redis command
    async fn execute_redis_command<T, F>(&self, f: F) -> Result<T, redis::RedisError>
    where
        T: redis::FromRedisValue,
        F: FnOnce(&mut ConnectionManager) -> redis::RedisFuture<T> + Send,
    {
        let redis_guard = self.redis.read().await;
        if let Some(ref conn) = *redis_guard {
            // Clone the connection for this command
            let mut conn_clone = conn.clone();
            // Execute the function
            f(&mut conn_clone).await
        } else {
            Err(redis::RedisError::from(
                (redis::ErrorKind::ClientError, "Redis connection not initialized").into()
            ))
        }
    }
    
    /// Load trust score from Redis
    async fn load_from_redis(&self, strategy_id: &str) -> TrustScoreResult<Option<TrustScore>> {
        let key = self.trust_score_key(strategy_id);
        
        let result: Option<String> = self.execute_redis_command(|conn| {
            Box::pin(conn.get(&key))
        }).await?;
        
        if let Some(data) = result {
            let score: TrustScore = serde_json::from_str(&data)
                .map_err(|e| TrustScoreError::SerializationError(e.to_string()))?;
            Ok(Some(score))
        } else {
            Ok(None)
        }
    }
    
    /// Save trust score to Redis
    async fn save_to_redis(&self, score: &TrustScore) -> TrustScoreResult<()> {
        let key = self.trust_score_key(&score.strategy_id);
        let data = serde_json::to_string(score)
            .map_err(|e| TrustScoreError::SerializationError(e.to_string()))?;
        
        if self.config.cache_ttl_sec > 0 {
            self.execute_redis_command(|conn| {
                Box::pin(conn.set_ex(&key, &data, self.config.cache_ttl_sec as usize))
            }).await?;
        } else {
            self.execute_redis_command(|conn| {
                Box::pin(conn.set(&key, &data))
            }).await?;
        }
        
        debug!("Saved trust score for strategy {} to Redis", score.strategy_id);
        Ok(())
    }
    
    /// Load trust history from Redis
    async fn load_history_from_redis(&self, strategy_id: &str) -> TrustScoreResult<Option<TrustScoreHistory>> {
        let key = self.trust_history_key(strategy_id);
        
        let result: Option<String> = self.execute_redis_command(|conn| {
            Box::pin(conn.get(&key))
        }).await?;
        
        if let Some(data) = result {
            let history: TrustScoreHistory = serde_json::from_str(&data)
                .map_err(|e| TrustScoreError::SerializationError(e.to_string()))?;
            Ok(Some(history))
        } else {
            Ok(None)
        }
    }
    
    /// Save trust history to Redis
    async fn save_history_to_redis(&self, history: &TrustScoreHistory) -> TrustScoreResult<()> {
        let key = self.trust_history_key(&history.strategy_id);
        let data = serde_json::to_string(history)
            .map_err(|e| TrustScoreError::SerializationError(e.to_string()))?;
        
        self.execute_redis_command(|conn| {
            Box::pin(conn.set(&key, &data))
        }).await?;
        
        debug!("Saved trust history for strategy {} to Redis", history.strategy_id);
        Ok(())
    }
    
    /// Normalize Sharpe ratio to 0.0-1.0 range
    fn normalize_sharpe_ratio(&self, sharpe: f64) -> f64 {
        // Sharpe ratio typically ranges from -3.0 to 3.0 in practice
        // We'll normalize to 0.0-1.0 range
        let normalized = (sharpe + 3.0) / 6.0;
        normalized.max(0.0).min(1.0)
    }
    
    /// Normalize Sortino ratio to 0.0-1.0 range
    fn normalize_sortino_ratio(&self, sortino: f64) -> f64 {
        // Sortino ratio typically ranges from -3.0 to 5.0 in practice
        // We'll normalize to 0.0-1.0 range
        let normalized = (sortino + 3.0) / 8.0;
        normalized.max(0.0).min(1.0)
    }
    
    /// Calculate drawdown score (higher is better)
    fn calculate_drawdown_score(&self, max_drawdown: f64, current_drawdown: f64) -> f64 {
        // Convert drawdown percentages to 0.0-1.0 scores
        // A 0% drawdown gets a score of 1.0 (best)
        // A 50%+ drawdown gets a score of 0.0 (worst)
        
        // Weighted average of max and current drawdown
        let max_drawdown_score = (1.0 - (max_drawdown / 50.0)).max(0.0);
        let current_drawdown_score = (1.0 - (current_drawdown / 30.0)).max(0.0);
        
        // Weighted mix (max matters more but recovery is rewarded)
        0.7 * max_drawdown_score + 0.3 * current_drawdown_score
    }
    
    /// Calculate latency score (higher is better)
    fn calculate_latency_score(&self, stats: &ExecutionStats) -> f64 {
        // Higher score means better latency performance
        
        // If we have no latency data, return a neutral score
        if stats.total_executions == 0 {
            return 0.5;
        }
        
        // Assuming reasonable latency ranges for algorithmic trading
        // < 100ms: Excellent (1.0)
        // > 1000ms: Poor (0.0)
        
        let avg_latency = stats.avg_latency_ms as f64;
        let max_latency = stats.max_latency_ms as f64;
        
        // Normalize average latency (lower is better)
        let avg_score = ((1000.0 - avg_latency) / 900.0).max(0.0).min(1.0);
        
        // Normalize max latency (lower is better)
        let max_score = ((5000.0 - max_latency) / 4900.0).max(0.0).min(1.0);
        
        // Weighted combination
        0.7 * avg_score + 0.3 * max_score
    }
    
    /// Calculate failure score (higher is better)
    fn calculate_failure_score(&self, stats: &ExecutionStats) -> f64 {
        if stats.total_executions == 0 {
            return 0.5; // Neutral score for no data
        }
        
        // Calculate failure rate (lower is better)
        let failure_rate = (stats.failed_count + stats.rejected_count) as f64 / stats.total_executions as f64;
        
        // Convert to success rate (higher is better)
        let success_rate = 1.0 - failure_rate;
        
        // Apply a non-linear transformation to penalize high failure rates more
        success_rate.powf(1.5)
    }
    
    /// Apply feature decay to a score based on previous score
    fn apply_feature_decay(&self, current: f64, previous: f64) -> f64 {
        let decay_factor = self.config.weights.feature_decay_factor;
        previous * decay_factor + current * (1.0 - decay_factor)
    }
    
    /// Calculate entropy score (higher means less entropy penalty)
    fn calculate_entropy_score(&self, _strategy_id: &str) -> f64 {
        // Default implementation - can be enhanced with actual entropy data if available
        // For now, we'll use a neutral score of 0.8 (slight penalty by default)
        0.8
    }
}

#[async_trait]
impl TrustScoreEngine for DefaultTrustScoreEngine {
    async fn extract_features(&self, strategy_id: &str) -> TrustScoreResult<TrustScoreFeatures> {
        // Fetch performance summary and execution stats in parallel
        let performance_future = self.analytics.get_performance_summary(strategy_id, None, None);
        let stats_future = self.analytics.get_execution_stats(strategy_id, None);
        
        // Await both futures
        let (performance_result, stats_result) = tokio::join!(performance_future, stats_future);
        
        // Check for errors
        let performance = performance_result?;
        let stats = stats_result?;
        
        // Check if we have enough data
        if performance.total_trades < self.config.weights.min_trades_required {
            return Err(TrustScoreError::InsufficientData(format!(
                "Not enough trades ({}) for reliable scoring, minimum required: {}",
                performance.total_trades, self.config.weights.min_trades_required
            )));
        }
        
        // Extract and normalize features
        let win_rate = performance.win_rate / 100.0; // Convert percentage to 0.0-1.0
        let normalized_sharpe = self.normalize_sharpe_ratio(performance.sharpe_ratio);
        let normalized_sortino = self.normalize_sortino_ratio(performance.sortino_ratio);
        let drawdown_score = self.calculate_drawdown_score(performance.max_drawdown, performance.current_drawdown);
        let latency_score = self.calculate_latency_score(&stats);
        let failure_score = self.calculate_failure_score(&stats);
        let entropy_score = self.calculate_entropy_score(strategy_id);
        
        // Return the features
        Ok(TrustScoreFeatures {
            win_rate,
            total_trades: performance.total_trades,
            normalized_sharpe,
            normalized_sortino,
            drawdown_score,
            latency_score,
            failure_score,
            entropy_score,
            timestamp: Utc::now(),
        })
    }
    
    async fn compute_trust_score(&self, strategy_id: &str) -> TrustScoreResult<TrustScore> {
        // Get previous score if available (for feature decay)
        let previous_score = match self.get_trust_score(strategy_id).await {
            Ok(score) => Some(score),
            Err(_) => None,
        };
        
        // Extract features
        let features = self.extract_features(strategy_id).await?;
        
        // Calculate weighted score
        let weights = &self.config.weights;
        
        let mut weighted_score = 
            features.win_rate * weights.win_rate_weight +
            features.normalized_sharpe * weights.sharpe_ratio_weight +
            features.normalized_sortino * weights.sortino_ratio_weight +
            features.drawdown_score * weights.drawdown_weight +
            features.latency_score * weights.latency_weight +
            features.failure_score * weights.failure_weight +
            features.entropy_score * weights.entropy_penalty_weight;
        
        // Ensure score is in 0.0-1.0 range
        weighted_score = weighted_score.max(0.0).min(1.0);
        
        // Apply feature decay if we have a previous score
        if let Some(prev) = previous_score {
            weighted_score = self.apply_feature_decay(weighted_score, prev.score);
        }
        
        // Create or update trust score
        let mut trust_score = if let Some(prev) = previous_score {
            let mut updated = prev;
            updated.score = weighted_score;
            updated.features = features;
            updated.timestamp = Utc::now();
            updated.update_count += 1;
            updated
        } else {
            TrustScore {
                strategy_id: strategy_id.to_string(),
                score: weighted_score,
                features,
                timestamp: Utc::now(),
                update_count: 1,
            }
        };
        
        // Update cache
        {
            let mut cache = self.scores_cache.write().await;
            cache.insert(strategy_id.to_string(), trust_score.clone());
        }
        
        // Update last refresh time
        {
            let mut refresh = self.last_refresh.write().await;
            refresh.insert(strategy_id.to_string(), Instant::now());
        }
        
        // Save to Redis
        if let Err(e) = self.save_to_redis(&trust_score).await {
            warn!("Failed to save trust score to Redis: {}", e);
        }
        
        debug!("Computed trust score for strategy {}: {}", strategy_id, trust_score.score);
        Ok(trust_score)
    }
    
    async fn get_trust_score(&self, strategy_id: &str) -> TrustScoreResult<TrustScore> {
        // Check cache first
        {
            let cache = self.scores_cache.read().await;
            if let Some(score) = cache.get(strategy_id) {
                // Check if cache is fresh enough
                let refresh = self.last_refresh.read().await;
                if let Some(last_time) = refresh.get(strategy_id) {
                    let elapsed = last_time.elapsed();
                    if elapsed < Duration::from_secs(self.config.cache_refresh_interval_sec) {
                        return Ok(score.clone());
                    }
                }
            }
        }
        
        // Try to load from Redis
        if let Some(score) = self.load_from_redis(strategy_id).await? {
            // Update cache
            {
                let mut cache = self.scores_cache.write().await;
                cache.insert(strategy_id.to_string(), score.clone());
            }
            
            // Update last refresh time
            {
                let mut refresh = self.last_refresh.write().await;
                refresh.insert(strategy_id.to_string(), Instant::now());
            }
            
            return Ok(score);
        }
        
        // If not in Redis, compute a new score
        self.compute_trust_score(strategy_id).await
    }
    
    async fn get_trust_history(&self, strategy_id: &str) -> TrustScoreResult<TrustScoreHistory> {
        // Try to load history from Redis
        if let Some(history) = self.load_history_from_redis(strategy_id).await? {
            return Ok(history);
        }
        
        // If no history exists, return an empty history
        Ok(TrustScoreHistory {
            strategy_id: strategy_id.to_string(),
            entries: Vec::new(),
        })
    }
    
    async fn record_history(&self, score: &TrustScore) -> TrustScoreResult<()> {
        // Load existing history
        let mut history = self.get_trust_history(&score.strategy_id).await?;
        
        // Create a new history entry
        let entry = TrustScoreHistoryEntry {
            score: score.score,
            features: score.features.clone(),
            timestamp: score.timestamp,
        };
        
        // Add entry to history
        history.entries.push(entry);
        
        // Sort by timestamp (newest first)
        history.entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        
        // Trim history if needed
        if history.entries.len() > self.config.max_history_entries {
            history.entries.truncate(self.config.max_history_entries);
        }
        
        // Save updated history to Redis
        self.save_history_to_redis(&history).await?;
        
        Ok(())
    }
    
    async fn update_and_publish(&self, strategy_id: &str) -> TrustScoreResult<TrustScore> {
        // Compute the trust score
        let score = self.compute_trust_score(strategy_id).await?;
        
        // Record in history
        if let Err(e) = self.record_history(&score).await {
            warn!("Failed to record trust score history: {}", e);
        }
        
        // Publish via telemetry if available
        if let Some(streamer) = &self.telemetry_streamer {
            if let Err(e) = streamer.publish_trust_score_update(strategy_id, &score).await {
                warn!("Failed to publish trust score update: {}", e);
            }
        }
        
        Ok(score)
    }
}

/// Create a new trust score engine
pub fn create_trust_score_engine(
    config: TrustScoreConfig,
    analytics: Arc<dyn Analytics>,
    telemetry_streamer: Option<Arc<dyn TelemetryStreamer>>,
) -> Arc<dyn TrustScoreEngine> {
    Arc::new(DefaultTrustScoreEngine::new(config, analytics, telemetry_streamer))
} 