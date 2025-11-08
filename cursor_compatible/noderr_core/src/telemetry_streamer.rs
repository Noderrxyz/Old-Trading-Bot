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
use redis::{Client, Connection, AsyncConnection, aio::ConnectionManager, RedisResult, FromRedisValue, ToRedisArgs};
use redis::cluster::{ClusterClient, ClusterConnection};
use thiserror::Error;
use tokio::sync::RwLock;
use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};
use async_trait::async_trait;

use crate::analytics::{TrendLine, PerformanceSummary, ExecutionStats, Anomaly};
use crate::trust_score_engine::TrustScore;

/// Errors that can occur in the telemetry streaming system
#[derive(Debug, Error)]
pub enum TelemetryStreamError {
    #[error("Redis connection error: {0}")]
    ConnectionError(String),
    
    #[error("Redis operation error: {0}")]
    RedisError(#[from] redis::RedisError),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Invalid configuration: {0}")]
    ConfigError(String),
    
    #[error("Channel does not exist: {0}")]
    ChannelNotFound(String),
    
    #[error("Stream error: {0}")]
    StreamError(String),
}

/// Configuration for the telemetry streamer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryStreamerConfig {
    /// Redis connection string
    pub redis_url: String,
    
    /// Whether to use Redis cluster
    pub use_cluster: bool,
    
    /// Optional cluster nodes (required if use_cluster is true)
    pub cluster_nodes: Option<Vec<String>>,
    
    /// Time-to-live for cached data in seconds (0 = no TTL)
    pub cache_ttl_seconds: u64,
    
    /// Maximum number of entries in trend line streams
    pub max_trendline_entries: usize,
    
    /// Maximum number of anomalies to keep per strategy
    pub max_anomalies: usize,
    
    /// Prefix for all Redis keys
    pub key_prefix: String,
}

impl Default for TelemetryStreamerConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://127.0.0.1:6379".to_string(),
            use_cluster: false,
            cluster_nodes: None,
            cache_ttl_seconds: 3600, // 1 hour by default
            max_trendline_entries: 1000,
            max_anomalies: 100,
            key_prefix: "noderr:telemetry".to_string(),
        }
    }
}

/// Message type for WebSocket communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryMessage<T> {
    /// Message type
    pub message_type: TelemetryMessageType,
    
    /// Strategy ID this message relates to
    pub strategy_id: String,
    
    /// Timestamp of the message
    pub timestamp: chrono::DateTime<chrono::Utc>,
    
    /// Message payload
    pub payload: T,
}

/// Types of telemetry messages
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TelemetryMessageType {
    /// Trend line update
    Trendline,
    
    /// Performance summary update
    PerformanceSummary,
    
    /// Execution statistics update
    ExecutionStats,
    
    /// Anomaly alert
    AnomalyAlert,
    
    /// Trust score update
    TrustScoreUpdate,
    
    /// Health check
    HealthCheck,
}

/// Redis channel names
#[derive(Debug, Clone)]
pub struct RedisChannels {
    /// Trendline updates channel
    pub trendline: String,
    
    /// Performance summary channel
    pub performance_summary: String,
    
    /// Execution stats channel
    pub execution_stats: String,
    
    /// Anomaly alerts channel
    pub anomalies: String,
    
    /// Trust score update channel
    pub trust_score: String,
}

/// The telemetry streamer trait for publishing analytics data
#[async_trait]
pub trait TelemetryStreamer: Send + Sync {
    /// Publish a trend line update
    async fn publish_trendline(&self, strategy_id: &str, trendline: TrendLine) -> Result<(), TelemetryStreamError>;
    
    /// Publish a performance summary
    async fn publish_performance_summary(&self, strategy_id: &str, summary: PerformanceSummary) -> Result<(), TelemetryStreamError>;
    
    /// Publish execution statistics
    async fn publish_execution_stats(&self, strategy_id: &str, stats: ExecutionStats) -> Result<(), TelemetryStreamError>;
    
    /// Publish anomaly alerts
    async fn publish_anomaly(&self, strategy_id: &str, anomaly: Anomaly) -> Result<(), TelemetryStreamError>;
    
    /// Publish trust score update
    async fn publish_trust_score_update(&self, strategy_id: &str, trust_score: &TrustScore) -> Result<(), TelemetryStreamError>;
    
    /// Get channel names for a specific strategy
    fn get_channel_names(&self, strategy_id: &str) -> RedisChannels;
}

/// Redis-based implementation of the TelemetryStreamer
pub struct RedisTelemetryStreamer {
    /// Configuration
    config: TelemetryStreamerConfig,
    
    /// Redis connection manager
    connection: Arc<RwLock<Option<ConnectionManager>>>,
    
    /// Redis cluster connection (if using cluster mode)
    cluster_connection: Arc<RwLock<Option<ClusterConnection>>>,
}

impl RedisTelemetryStreamer {
    /// Create a new RedisTelemetryStreamer
    pub fn new(config: TelemetryStreamerConfig) -> Self {
        Self {
            config,
            connection: Arc::new(RwLock::new(None)),
            cluster_connection: Arc::new(RwLock::new(None)),
        }
    }
    
    /// Initialize the Redis connection
    pub async fn initialize(&self) -> Result<(), TelemetryStreamError> {
        if self.config.use_cluster {
            if let Some(nodes) = &self.config.cluster_nodes {
                let client = ClusterClient::new(nodes.clone())
                    .map_err(|e| TelemetryStreamError::ConnectionError(e.to_string()))?;
                
                let connection = client.get_connection()
                    .map_err(|e| TelemetryStreamError::ConnectionError(e.to_string()))?;
                
                let mut cluster_conn = self.cluster_connection.write().await;
                *cluster_conn = Some(connection);
                
                info!("Connected to Redis cluster with {} nodes", nodes.len());
            } else {
                return Err(TelemetryStreamError::ConfigError("Cluster nodes must be specified when using cluster mode".to_string()));
            }
        } else {
            let client = Client::open(self.config.redis_url.clone())
                .map_err(|e| TelemetryStreamError::ConnectionError(e.to_string()))?;
            
            let connection = ConnectionManager::new(client)
                .await
                .map_err(|e| TelemetryStreamError::ConnectionError(e.to_string()))?;
            
            let mut conn = self.connection.write().await;
            *conn = Some(connection);
            
            info!("Connected to Redis at {}", self.config.redis_url);
        }
        
        Ok(())
    }
    
    /// Generate a Redis key for a strategy and data type
    fn generate_key(&self, strategy_id: &str, data_type: &str) -> String {
        format!("{}:strategy:{}:{}", self.config.key_prefix, strategy_id, data_type)
    }
    
    /// Generate a Redis channel name for a strategy and event type
    fn generate_channel(&self, strategy_id: &str, event_type: &str) -> String {
        format!("{}:channel:strategy:{}:{}", self.config.key_prefix, strategy_id, event_type)
    }
    
    /// Execute a Redis command
    async fn execute_redis_command<T, F>(&self, f: F) -> Result<T, TelemetryStreamError>
    where
        T: FromRedisValue,
        F: FnOnce(&mut Connection) -> RedisResult<T> + Send,
    {
        if self.config.use_cluster {
            let mut connection = self.cluster_connection.write().await;
            if let Some(ref mut conn) = *connection {
                f(conn).map_err(TelemetryStreamError::from)
            } else {
                Err(TelemetryStreamError::ConnectionError("Redis cluster connection not initialized".to_string()))
            }
        } else {
            let connection = self.connection.read().await;
            if let Some(ref conn) = *connection {
                conn.clone().get_connection().await
                    .map_err(|e| TelemetryStreamError::ConnectionError(e.to_string()))
                    .and_then(|mut c| f(&mut c).map_err(TelemetryStreamError::from))
            } else {
                Err(TelemetryStreamError::ConnectionError("Redis connection not initialized".to_string()))
            }
        }
    }
    
    /// Publish a message to a Redis channel
    async fn publish_to_channel<T: Serialize>(&self, channel: &str, message: T) -> Result<(), TelemetryStreamError> {
        let serialized = serde_json::to_string(&message)
            .map_err(|e| TelemetryStreamError::SerializationError(e.to_string()))?;
        
        self.execute_redis_command(|conn| {
            redis::cmd("PUBLISH")
                .arg(channel)
                .arg(serialized)
                .query(conn)
        }).await?;
        
        debug!("Published message to channel: {}", channel);
        Ok(())
    }
    
    /// Store data with optional TTL
    async fn store_with_ttl<T: Serialize>(&self, key: &str, data: T) -> Result<(), TelemetryStreamError> {
        let serialized = serde_json::to_string(&data)
            .map_err(|e| TelemetryStreamError::SerializationError(e.to_string()))?;
        
        if self.config.cache_ttl_seconds > 0 {
            self.execute_redis_command(|conn| {
                redis::cmd("SETEX")
                    .arg(key)
                    .arg(self.config.cache_ttl_seconds)
                    .arg(serialized)
                    .query(conn)
            }).await?;
        } else {
            self.execute_redis_command(|conn| {
                redis::cmd("SET")
                    .arg(key)
                    .arg(serialized)
                    .query(conn)
            }).await?;
        }
        
        debug!("Stored data with key: {}", key);
        Ok(())
    }
}

#[async_trait]
impl TelemetryStreamer for RedisTelemetryStreamer {
    async fn publish_trendline(&self, strategy_id: &str, trendline: TrendLine) -> Result<(), TelemetryStreamError> {
        let key = self.generate_key(strategy_id, "trendline");
        let channel = self.generate_channel(strategy_id, "trendline");
        
        // Create telemetry message
        let message = TelemetryMessage {
            message_type: TelemetryMessageType::Trendline,
            strategy_id: strategy_id.to_string(),
            timestamp: chrono::Utc::now(),
            payload: trendline.clone(),
        };
        
        // Store in Redis
        self.store_with_ttl(&key, &message).await?;
        
        // Publish to channel
        self.publish_to_channel(&channel, message).await?;
        
        Ok(())
    }
    
    async fn publish_performance_summary(&self, strategy_id: &str, summary: PerformanceSummary) -> Result<(), TelemetryStreamError> {
        let key = self.generate_key(strategy_id, "performance_summary");
        let channel = self.generate_channel(strategy_id, "performance_summary");
        
        // Create telemetry message
        let message = TelemetryMessage {
            message_type: TelemetryMessageType::PerformanceSummary,
            strategy_id: strategy_id.to_string(),
            timestamp: chrono::Utc::now(),
            payload: summary.clone(),
        };
        
        // Store in Redis
        self.store_with_ttl(&key, &message).await?;
        
        // Publish to channel
        self.publish_to_channel(&channel, message).await?;
        
        Ok(())
    }
    
    async fn publish_execution_stats(&self, strategy_id: &str, stats: ExecutionStats) -> Result<(), TelemetryStreamError> {
        let key = self.generate_key(strategy_id, "execution_stats");
        let channel = self.generate_channel(strategy_id, "execution_stats");
        
        // Create telemetry message
        let message = TelemetryMessage {
            message_type: TelemetryMessageType::ExecutionStats,
            strategy_id: strategy_id.to_string(),
            timestamp: chrono::Utc::now(),
            payload: stats.clone(),
        };
        
        // Store in Redis
        self.store_with_ttl(&key, &message).await?;
        
        // Publish to channel
        self.publish_to_channel(&channel, message).await?;
        
        Ok(())
    }
    
    async fn publish_anomaly(&self, strategy_id: &str, anomaly: Anomaly) -> Result<(), TelemetryStreamError> {
        let key = self.generate_key(strategy_id, "anomalies");
        let channel = self.generate_channel(strategy_id, "anomaly");
        
        // Create telemetry message
        let message = TelemetryMessage {
            message_type: TelemetryMessageType::AnomalyAlert,
            strategy_id: strategy_id.to_string(),
            timestamp: chrono::Utc::now(),
            payload: anomaly.clone(),
        };
        
        // Store the anomaly in a list (we'll use LPUSH to maintain recency)
        let serialized = serde_json::to_string(&message)
            .map_err(|e| TelemetryStreamError::SerializationError(e.to_string()))?;
            
        // Add to list and trim to max length
        self.execute_redis_command(|conn| {
            let _: () = redis::pipe()
                .cmd("LPUSH").arg(&key).arg(&serialized).ignore()
                .cmd("LTRIM").arg(&key).arg(0).arg(self.config.max_anomalies - 1).ignore()
                .query(conn)?;
            Ok(())
        }).await?;
        
        // Publish to channel
        self.publish_to_channel(&channel, message).await?;
        
        Ok(())
    }
    
    async fn publish_trust_score_update(&self, strategy_id: &str, trust_score: &TrustScore) -> Result<(), TelemetryStreamError> {
        let key = self.generate_key(strategy_id, "trust_score");
        let channel = self.generate_channel(strategy_id, "trust_score");
        
        // Create telemetry message
        let message = TelemetryMessage {
            message_type: TelemetryMessageType::TrustScoreUpdate,
            strategy_id: strategy_id.to_string(),
            timestamp: chrono::Utc::now(),
            payload: trust_score.clone(),
        };
        
        // Store in Redis
        self.store_with_ttl(&key, &message).await?;
        
        // Publish to channel
        self.publish_to_channel(&channel, message).await?;
        
        Ok(())
    }
    
    fn get_channel_names(&self, strategy_id: &str) -> RedisChannels {
        RedisChannels {
            trendline: self.generate_channel(strategy_id, "trendline"),
            performance_summary: self.generate_channel(strategy_id, "performance_summary"),
            execution_stats: self.generate_channel(strategy_id, "execution_stats"),
            anomalies: self.generate_channel(strategy_id, "anomaly"),
            trust_score: self.generate_channel(strategy_id, "trust_score"),
        }
    }
}

/// Create a new telemetry streamer instance
pub fn create_telemetry_streamer(config: TelemetryStreamerConfig) -> Arc<RedisTelemetryStreamer> {
    Arc::new(RedisTelemetryStreamer::new(config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analytics::{TimePeriod, TrendDirection};
    use std::env;
    
    // Helper function to create a test trend line
    fn create_test_trendline() -> TrendLine {
        TrendLine {
            data_points: vec![
                (chrono::Utc::now(), 100.0),
                (chrono::Utc::now(), 110.0),
                (chrono::Utc::now(), 105.0),
            ],
            trend_direction: TrendDirection::Up,
            percent_change: 5.0,
            time_period: TimePeriod::Hourly,
        }
    }
    
    // Helper function to create a test performance summary
    fn create_test_performance_summary() -> PerformanceSummary {
        PerformanceSummary {
            total_trades: 100,
            winning_trades: 60,
            losing_trades: 40,
            win_rate: 60.0,
            total_pnl: 5000.0,
            profit_factor: 1.5,
            max_drawdown: 10.0,
            current_drawdown: 5.0,
            avg_profit: 100.0,
            avg_loss: 50.0,
            sharpe_ratio: 1.2,
            sortino_ratio: 1.5,
            avg_holding_time_seconds: 3600,
        }
    }
    
    // Helper function to create test execution stats
    fn create_test_execution_stats() -> ExecutionStats {
        ExecutionStats {
            total_executions: 100,
            filled_count: 80,
            partial_count: 10,
            failed_count: 5,
            rejected_count: 5,
            avg_fill_rate: 0.95,
            avg_latency_ms: 150,
            min_latency_ms: 50,
            max_latency_ms: 500,
        }
    }
    
    // Helper function to create a test anomaly
    fn create_test_anomaly() -> Anomaly {
        Anomaly {
            timestamp: chrono::Utc::now(),
            anomaly_type: crate::analytics::AnomalyType::DrawdownSpike,
            severity: 0.8,
            description: "Significant drawdown detected".to_string(),
        }
    }
    
    // These tests require a real Redis instance, so they're tagged with #[ignore]
    // To run these tests, use: cargo test -- --ignored
    
    #[tokio::test]
    #[ignore]
    async fn test_redis_streamer_initialize() {
        let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        let config = TelemetryStreamerConfig {
            redis_url,
            ..Default::default()
        };
        
        let streamer = RedisTelemetryStreamer::new(config);
        let result = streamer.initialize().await;
        assert!(result.is_ok(), "Failed to initialize Redis connection: {:?}", result.err());
    }
    
    #[tokio::test]
    #[ignore]
    async fn test_publish_trendline() {
        let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        let config = TelemetryStreamerConfig {
            redis_url,
            ..Default::default()
        };
        
        let streamer = RedisTelemetryStreamer::new(config);
        let init_result = streamer.initialize().await;
        assert!(init_result.is_ok(), "Failed to initialize Redis connection: {:?}", init_result.err());
        
        let strategy_id = "test_strategy";
        let trendline = create_test_trendline();
        
        let result = streamer.publish_trendline(strategy_id, trendline).await;
        assert!(result.is_ok(), "Failed to publish trendline: {:?}", result.err());
    }
} 