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

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::execution::{ExecutionLog, ExecutionQualityScore, ExecutionResult, ExecutionOutcomeReason};
use crate::redis::{RedisClient, RedisClientError, RedisClientResult};
use crate::storage::{StrategyStorage, StorageError};
use crate::strategy::StrategyId;

/// Errors that can occur in the execution metrics system
#[derive(Debug, Error)]
pub enum ExecutionMetricsError {
    #[error("Redis error: {0}")]
    RedisError(#[from] RedisClientError),
    
    #[error("Storage error: {0}")]
    StorageError(#[from] StorageError),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for execution metrics operations
pub type ExecutionMetricsResult<T> = Result<T, ExecutionMetricsError>;

/// Configuration for the execution metrics collector
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionMetricsConfig {
    /// Maximum number of recent executions to keep in memory
    pub max_recent_executions: usize,
    /// Whether to stream to Redis
    pub enable_redis_streaming: bool,
    /// Whether to persist to PostgreSQL
    pub enable_db_persistence: bool,
    /// Window size for calculating EQS (in seconds)
    pub eqs_window_seconds: i64,
    /// Minimum number of executions required for EQS calculation
    pub min_executions_for_eqs: usize,
    /// Whether to enable strategy decay detection
    pub enable_decay_detection: bool,
    /// Decay threshold (recent/trailing ratio to be considered decaying)
    pub decay_threshold: f64,
    /// Window size for recent performance (in hours)
    pub recent_window_hours: i64,
    /// Window size for trailing performance (in hours)
    pub trailing_window_hours: i64,
}

impl Default for ExecutionMetricsConfig {
    fn default() -> Self {
        Self {
            max_recent_executions: 1000,
            enable_redis_streaming: true,
            enable_db_persistence: true,
            eqs_window_seconds: 3600, // 1 hour
            min_executions_for_eqs: 5,
            enable_decay_detection: true,
            decay_threshold: 0.6,
            recent_window_hours: 24, // 1 day
            trailing_window_hours: 168, // 7 days
        }
    }
}

/// Trait for collecting execution metrics
#[async_trait]
pub trait ExecutionMetricsCollector: Send + Sync {
    /// Log an execution
    async fn log_execution(&self, log: ExecutionLog) -> ExecutionMetricsResult<()>;
    
    /// Calculate EQS (Execution Quality Score) for a strategy
    async fn calculate_eqs(&self, strategy_id: &StrategyId) -> ExecutionMetricsResult<ExecutionQualityScore>;
    
    /// Get slippage for a strategy and venue
    async fn get_slippage(&self, strategy_id: &StrategyId, venue: Option<&str>) -> ExecutionMetricsResult<f64>;
    
    /// Check if a strategy is decaying
    async fn check_strategy_decay(&self, strategy_id: &StrategyId) -> ExecutionMetricsResult<(bool, f64)>;
    
    /// Get all execution logs for a strategy
    async fn get_execution_logs(
        &self, 
        strategy_id: &StrategyId, 
        limit: Option<usize>
    ) -> ExecutionMetricsResult<Vec<ExecutionLog>>;
    
    /// Get EQS for all strategies
    async fn get_all_eqs(&self) -> ExecutionMetricsResult<HashMap<StrategyId, ExecutionQualityScore>>;
}

/// Implementation of the execution metrics collector
pub struct DefaultExecutionMetricsCollector {
    /// Configuration
    config: ExecutionMetricsConfig,
    /// Recent execution logs
    recent_logs: Arc<RwLock<HashMap<StrategyId, VecDeque<ExecutionLog>>>>,
    /// Calculated EQS values
    eqs_cache: Arc<RwLock<HashMap<StrategyId, ExecutionQualityScore>>>,
    /// Redis client for streaming
    redis: Option<Arc<dyn RedisClient>>,
    /// Storage for persistence
    storage: Option<Arc<dyn StrategyStorage>>,
}

impl DefaultExecutionMetricsCollector {
    /// Create a new execution metrics collector
    pub fn new(
        config: ExecutionMetricsConfig,
        redis: Option<Arc<dyn RedisClient>>,
        storage: Option<Arc<dyn StrategyStorage>>,
    ) -> Self {
        Self {
            config,
            recent_logs: Arc::new(RwLock::new(HashMap::new())),
            eqs_cache: Arc::new(RwLock::new(HashMap::new())),
            redis,
            storage,
        }
    }
    
    /// Store an execution log in Redis
    async fn stream_to_redis(&self, log: &ExecutionLog) -> ExecutionMetricsResult<()> {
        if let Some(redis) = &self.redis {
            if self.config.enable_redis_streaming {
                // Stream to Redis using strategy_id
                let key = format!("exec:logs:{}", log.strategy_id);
                redis.set(&key, log, Some(86400)).await?; // 24-hour TTL
                
                // If we have slippage data, store it separately
                if log.slippage_bps != 0.0 {
                    let slippage_key = format!("exec:slippage:{}:{}", log.strategy_id, log.venue);
                    redis.set(&slippage_key, &log.slippage_bps, Some(86400)).await?;
                }
            }
        }
        Ok(())
    }
    
    /// Store an execution log in persistent storage
    async fn persist_to_db(&self, log: &ExecutionLog) -> ExecutionMetricsResult<()> {
        if let Some(storage) = &self.storage {
            if self.config.enable_db_persistence {
                // Convert the execution log to the storage format and persist
                // This would depend on your specific storage implementation
                // Here we're assuming a hypothetical method exists
                // This would need to be implemented in the storage module
            }
        }
        Ok(())
    }
    
    /// Update EQS in Redis
    async fn update_eqs_in_redis(&self, eqs: &ExecutionQualityScore) -> ExecutionMetricsResult<()> {
        if let Some(redis) = &self.redis {
            if self.config.enable_redis_streaming {
                let key = format!("exec:eqs:{}", eqs.strategy_id);
                redis.set(&key, eqs, Some(86400)).await?; // 24-hour TTL
            }
        }
        Ok(())
    }
    
    /// Calculate slippage score
    fn calculate_slippage_score(&self, logs: &[ExecutionLog]) -> f64 {
        if logs.is_empty() {
            return 0.0;
        }
        
        // Get average absolute slippage in basis points
        let avg_slippage = logs.iter()
            .map(|log| log.slippage_bps.abs())
            .sum::<f64>() / logs.len() as f64;
        
        // Convert to score (0.0-1.0) where lower slippage is better
        // Assuming 20 bps is very high slippage, 0 bps is perfect
        let score = 1.0 - (avg_slippage / 20.0).min(1.0);
        
        score
    }
    
    /// Calculate latency score
    fn calculate_latency_score(&self, logs: &[ExecutionLog]) -> f64 {
        if logs.is_empty() {
            return 0.0;
        }
        
        // Get average latency in milliseconds
        let avg_latency = logs.iter()
            .map(|log| log.execution_latency_ms as f64)
            .sum::<f64>() / logs.len() as f64;
        
        // Convert to score (0.0-1.0) where lower latency is better
        // Assuming 1000ms (1 second) is very high latency, 0ms is perfect
        let score = 1.0 - (avg_latency / 1000.0).min(1.0);
        
        score
    }
    
    /// Calculate fill rate score
    fn calculate_fill_rate_score(&self, logs: &[ExecutionLog]) -> f64 {
        if logs.is_empty() {
            return 0.0;
        }
        
        // Count fills and partial fills
        let fills = logs.iter().filter(|log| matches!(log.reason, ExecutionOutcomeReason::NormalFill)).count() as f64;
        let partial_fills = logs.iter().filter(|log| matches!(log.reason, ExecutionOutcomeReason::PartialFill)).count() as f64;
        
        // Calculate fill rate (full fills + 0.5 * partial fills) / total
        let fill_rate = (fills + 0.5 * partial_fills) / logs.len() as f64;
        
        fill_rate
    }
    
    /// Calculate cancel rate score
    fn calculate_cancel_rate_score(&self, logs: &[ExecutionLog]) -> f64 {
        if logs.is_empty() {
            return 0.0;
        }
        
        // Count cancellations
        let cancels = logs.iter().filter(|log| matches!(log.reason, ExecutionOutcomeReason::Cancelled)).count() as f64;
        
        // Calculate cancel rate score (1.0 - cancel_rate)
        let cancel_rate = cancels / logs.len() as f64;
        
        1.0 - cancel_rate
    }
    
    /// Update strategy decay status in Redis
    async fn update_decay_status(&self, strategy_id: &StrategyId, is_decaying: bool, decay_score: f64) -> ExecutionMetricsResult<()> {
        if let Some(redis) = &self.redis {
            if self.config.enable_redis_streaming && self.config.enable_decay_detection {
                let status = if is_decaying { "decaying" } else { "healthy" };
                let key = format!("strategy:status:{}", strategy_id);
                redis.set(&key, &status, Some(86400)).await?; // 24-hour TTL
                
                let score_key = format!("strategy:decay_score:{}", strategy_id);
                redis.set(&score_key, &decay_score, Some(86400)).await?;
            }
        }
        Ok(())
    }
}

#[async_trait]
impl ExecutionMetricsCollector for DefaultExecutionMetricsCollector {
    async fn log_execution(&self, log: ExecutionLog) -> ExecutionMetricsResult<()> {
        // Store in memory
        {
            let mut logs_map = self.recent_logs.write().unwrap();
            let logs = logs_map.entry(log.strategy_id.clone()).or_insert_with(VecDeque::new);
            
            // Add the new log
            logs.push_back(log.clone());
            
            // Trim if needed
            while logs.len() > self.config.max_recent_executions {
                logs.pop_front();
            }
        }
        
        // Stream to Redis if enabled
        if self.config.enable_redis_streaming {
            self.stream_to_redis(&log).await?;
        }
        
        // Persist to storage if enabled
        if self.config.enable_db_persistence {
            self.persist_to_db(&log).await?;
        }
        
        // Recalculate EQS if we have enough executions
        let need_eqs_update = {
            let logs_map = self.recent_logs.read().unwrap();
            if let Some(logs) = logs_map.get(&log.strategy_id) {
                logs.len() >= self.config.min_executions_for_eqs
            } else {
                false
            }
        };
        
        if need_eqs_update {
            let eqs = self.calculate_eqs(&log.strategy_id).await?;
            self.update_eqs_in_redis(&eqs).await?;
        }
        
        // Check for strategy decay if enabled
        if self.config.enable_decay_detection {
            let (is_decaying, decay_score) = self.check_strategy_decay(&log.strategy_id).await?;
            self.update_decay_status(&log.strategy_id, is_decaying, decay_score).await?;
        }
        
        Ok(())
    }
    
    async fn calculate_eqs(&self, strategy_id: &StrategyId) -> ExecutionMetricsResult<ExecutionQualityScore> {
        // Get recent logs for the strategy
        let logs = {
            let logs_map = self.recent_logs.read().unwrap();
            if let Some(logs) = logs_map.get(strategy_id) {
                logs.iter().cloned().collect::<Vec<_>>()
            } else {
                return Err(ExecutionMetricsError::InvalidParameter(
                    format!("No execution logs found for strategy {}", strategy_id)
                ));
            }
        };
        
        // Filter logs to the EQS window
        let now = Utc::now();
        let window_start = now - chrono::Duration::seconds(self.config.eqs_window_seconds);
        let window_logs: Vec<_> = logs.into_iter()
            .filter(|log| log.entry_time >= window_start)
            .collect();
        
        if window_logs.len() < self.config.min_executions_for_eqs {
            return Err(ExecutionMetricsError::InvalidParameter(
                format!("Insufficient executions for EQS calculation: {} < {}", 
                    window_logs.len(), self.config.min_executions_for_eqs)
            ));
        }
        
        // Calculate component scores
        let slippage_score = self.calculate_slippage_score(&window_logs);
        let latency_score = self.calculate_latency_score(&window_logs);
        let fill_rate_score = self.calculate_fill_rate_score(&window_logs);
        let cancel_rate_score = self.calculate_cancel_rate_score(&window_logs);
        
        // Create and calculate the EQS
        let mut eqs = ExecutionQualityScore {
            overall_score: 0.0,
            slippage_score,
            latency_score,
            fill_rate_score,
            cancel_rate_score,
            strategy_id: strategy_id.clone(),
            timestamp: now,
            venue: None, // We're calculating across all venues
            market_volatility: None, // Would need market data for this
            execution_count: window_logs.len(),
        };
        
        // Calculate overall score using default weights
        eqs.calculate_overall_score(None);
        
        // Cache the result
        {
            let mut eqs_cache = self.eqs_cache.write().unwrap();
            eqs_cache.insert(strategy_id.clone(), eqs.clone());
        }
        
        Ok(eqs)
    }
    
    async fn get_slippage(&self, strategy_id: &StrategyId, venue: Option<&str>) -> ExecutionMetricsResult<f64> {
        // Get recent logs for the strategy
        let logs = {
            let logs_map = self.recent_logs.read().unwrap();
            if let Some(logs) = logs_map.get(strategy_id) {
                logs.iter().cloned().collect::<Vec<_>>()
            } else {
                return Err(ExecutionMetricsError::InvalidParameter(
                    format!("No execution logs found for strategy {}", strategy_id)
                ));
            }
        };
        
        // Filter by venue if specified
        let filtered_logs = if let Some(v) = venue {
            logs.into_iter().filter(|log| log.venue == v).collect::<Vec<_>>()
        } else {
            logs
        };
        
        if filtered_logs.is_empty() {
            return Ok(0.0);
        }
        
        // Calculate average slippage
        let total_slippage = filtered_logs.iter().map(|log| log.slippage_bps).sum::<f64>();
        let avg_slippage = total_slippage / filtered_logs.len() as f64;
        
        Ok(avg_slippage)
    }
    
    async fn check_strategy_decay(&self, strategy_id: &StrategyId) -> ExecutionMetricsResult<(bool, f64)> {
        if !self.config.enable_decay_detection {
            return Ok((false, 1.0));
        }
        
        // Get all logs for this strategy
        let logs = {
            let logs_map = self.recent_logs.read().unwrap();
            if let Some(logs) = logs_map.get(strategy_id) {
                logs.iter().cloned().collect::<Vec<_>>()
            } else {
                return Err(ExecutionMetricsError::InvalidParameter(
                    format!("No execution logs found for strategy {}", strategy_id)
                ));
            }
        };
        
        if logs.is_empty() {
            return Ok((false, 1.0));
        }
        
        let now = Utc::now();
        let recent_window_start = now - chrono::Duration::hours(self.config.recent_window_hours);
        let trailing_window_start = now - chrono::Duration::hours(self.config.trailing_window_hours);
        
        // Filter logs into recent and trailing windows
        let recent_logs: Vec<_> = logs.iter()
            .filter(|log| log.entry_time >= recent_window_start)
            .collect();
        
        let trailing_logs: Vec<_> = logs.iter()
            .filter(|log| log.entry_time >= trailing_window_start && log.entry_time < recent_window_start)
            .collect();
        
        if recent_logs.is_empty() || trailing_logs.is_empty() {
            return Ok((false, 1.0));
        }
        
        // Calculate performance (success rate) for each window
        let recent_success = recent_logs.iter()
            .filter(|log| matches!(log.reason, ExecutionOutcomeReason::NormalFill))
            .count() as f64 / recent_logs.len() as f64;
        
        let trailing_success = trailing_logs.iter()
            .filter(|log| matches!(log.reason, ExecutionOutcomeReason::NormalFill))
            .count() as f64 / trailing_logs.len() as f64;
        
        // Calculate decay score
        let decay_score = if trailing_success > 0.0 {
            recent_success / trailing_success
        } else {
            1.0 // If no trailing success, no decay
        };
        
        // Determine if strategy is decaying
        let is_decaying = decay_score < self.config.decay_threshold;
        
        Ok((is_decaying, decay_score))
    }
    
    async fn get_execution_logs(
        &self, 
        strategy_id: &StrategyId, 
        limit: Option<usize>
    ) -> ExecutionMetricsResult<Vec<ExecutionLog>> {
        let logs = {
            let logs_map = self.recent_logs.read().unwrap();
            if let Some(logs) = logs_map.get(strategy_id) {
                logs.iter().cloned().collect::<Vec<_>>()
            } else {
                return Ok(Vec::new());
            }
        };
        
        // Apply limit if specified
        let limited_logs = if let Some(limit) = limit {
            logs.into_iter().take(limit).collect()
        } else {
            logs
        };
        
        Ok(limited_logs)
    }
    
    async fn get_all_eqs(&self) -> ExecutionMetricsResult<HashMap<StrategyId, ExecutionQualityScore>> {
        let eqs_cache = self.eqs_cache.read().unwrap();
        Ok(eqs_cache.clone())
    }
}

/// Factory function to create an execution metrics collector
pub fn create_execution_metrics_collector(
    config: ExecutionMetricsConfig,
    redis: Option<Arc<dyn RedisClient>>,
    storage: Option<Arc<dyn StrategyStorage>>,
) -> Arc<dyn ExecutionMetricsCollector> {
    Arc::new(DefaultExecutionMetricsCollector::new(config, redis, storage))
}

/// Factory function with default configuration
pub fn create_default_execution_metrics_collector(
    redis: Option<Arc<dyn RedisClient>>,
    storage: Option<Arc<dyn StrategyStorage>>,
) -> Arc<dyn ExecutionMetricsCollector> {
    create_execution_metrics_collector(ExecutionMetricsConfig::default(), redis, storage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::redis::MockRedisClient;
    
    fn create_test_execution_log(strategy_id: &str, success: bool) -> ExecutionLog {
        let reason = if success {
            ExecutionOutcomeReason::NormalFill
        } else {
            ExecutionOutcomeReason::Rejected
        };
        
        ExecutionLog {
            order_id: Uuid::new_v4().to_string(),
            strategy_id: strategy_id.to_string(),
            venue: "test_venue".to_string(),
            entry_time: Utc::now(),
            exit_time: None,
            entry_price: 100.0,
            exit_price: None,
            filled_qty: if success { 1.0 } else { 0.0 },
            slippage_bps: if success { 5.0 } else { 0.0 },
            max_drawdown_pct: 0.0,
            execution_latency_ms: 100,
            reason,
            tags: None,
            metadata: None,
        }
    }
    
    #[tokio::test]
    async fn test_log_execution() {
        let config = ExecutionMetricsConfig {
            max_recent_executions: 10,
            min_executions_for_eqs: 1,
            ..Default::default()
        };
        
        let mock_redis = Arc::new(MockRedisClient::new(Default::default()));
        let collector = create_execution_metrics_collector(config, Some(mock_redis.clone()), None);
        
        let log = create_test_execution_log("test_strategy", true);
        let result = collector.log_execution(log).await;
        
        assert!(result.is_ok());
    }
    
    #[tokio::test]
    async fn test_calculate_eqs() {
        let config = ExecutionMetricsConfig {
            max_recent_executions: 10,
            min_executions_for_eqs: 5,
            ..Default::default()
        };
        
        let collector = create_execution_metrics_collector(config, None, None);
        let strategy_id = "test_strategy".to_string();
        
        // Add 5 execution logs
        for i in 0..5 {
            let log = create_test_execution_log(&strategy_id, i % 2 == 0);
            collector.log_execution(log).await.unwrap();
        }
        
        let eqs = collector.calculate_eqs(&strategy_id).await;
        assert!(eqs.is_ok());
        
        let eqs = eqs.unwrap();
        assert_eq!(eqs.strategy_id, strategy_id);
        assert!(eqs.overall_score > 0.0 && eqs.overall_score <= 1.0);
    }
    
    #[tokio::test]
    async fn test_strategy_decay() {
        let config = ExecutionMetricsConfig {
            max_recent_executions: 100,
            enable_decay_detection: true,
            decay_threshold: 0.6,
            recent_window_hours: 1,
            trailing_window_hours: 2,
            ..Default::default()
        };
        
        let collector = create_execution_metrics_collector(config, None, None);
        let strategy_id = "test_strategy".to_string();
        
        // Create logs with timestamps in the trailing window (all successful)
        for _ in 0..10 {
            let mut log = create_test_execution_log(&strategy_id, true);
            log.entry_time = Utc::now() - chrono::Duration::hours(1) - chrono::Duration::minutes(30);
            collector.log_execution(log).await.unwrap();
        }
        
        // Create logs with timestamps in the recent window (half successful)
        for i in 0..10 {
            let mut log = create_test_execution_log(&strategy_id, i % 2 == 0);
            log.entry_time = Utc::now() - chrono::Duration::minutes(30);
            collector.log_execution(log).await.unwrap();
        }
        
        let (is_decaying, decay_score) = collector.check_strategy_decay(&strategy_id).await.unwrap();
        
        // With 100% success in trailing and 50% in recent, decay_score should be 0.5
        // Which is below the threshold of 0.6, so should be decaying
        assert!(is_decaying);
        assert!(decay_score < 0.6);
    }
} 