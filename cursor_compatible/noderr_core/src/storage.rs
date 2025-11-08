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
use std::path::PathBuf;
use std::sync::Arc;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::strategy::{Signal, StrategyId, StrategyPerformance};
use crate::execution::ExecutionResult;
use crate::telemetry::{TelemetryEvent, TelemetryLevel};

/// Errors that can occur during storage operations
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("Database error: {0}")]
    DatabaseError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Item not found: {0}")]
    NotFound(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Configuration for the storage module
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    /// Storage type (SQLite, Memory, File)
    pub storage_type: StorageType,
    /// Database file path (for SQLite storage)
    pub db_path: Option<String>,
    /// Base directory for file-based storage
    pub base_dir: Option<String>,
    /// Maximum entries to keep in memory cache
    pub max_cache_entries: usize,
    /// Auto-commit interval in seconds
    pub auto_commit_interval_sec: u64,
    /// Maximum history retention in days
    pub max_history_days: u32,
    /// Whether to enable periodic cleanup
    pub enable_cleanup: bool,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            storage_type: StorageType::SQLite,
            db_path: Some("./noderr_data.db".to_string()),
            base_dir: Some("./noderr_data".to_string()),
            max_cache_entries: 10000,
            auto_commit_interval_sec: 60,
            max_history_days: 365,
            enable_cleanup: true,
        }
    }
}

/// Type of storage backend
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum StorageType {
    /// In-memory storage (non-persistent)
    Memory,
    /// File-based storage using JSON files
    File,
    /// SQLite database storage
    SQLite,
}

/// Stored execution record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredExecution {
    /// Unique ID
    pub id: String,
    /// Strategy ID
    pub strategy_id: StrategyId,
    /// Symbol/market
    pub symbol: String,
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    /// Signal that triggered the execution
    pub signal: Signal,
    /// Execution result
    pub result: ExecutionResult,
    /// Performance impact
    pub performance_impact: Option<PerformanceImpact>,
}

/// Impact of an execution on strategy performance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceImpact {
    /// PnL change
    pub pnl_change: f64,
    /// Drawdown change
    pub drawdown_change: f64,
    /// Win/loss
    pub is_win: bool,
    /// Trust score change
    pub trust_score_change: f64,
}

/// Time range for querying data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TimeRange {
    /// Last N hours
    LastHours(u32),
    /// Last N days
    LastDays(u32),
    /// Custom range with start and end
    Custom {
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    },
    /// All available data
    All,
}

/// Trait for storing and retrieving strategy data
#[async_trait]
pub trait StrategyStorage: Send + Sync {
    /// Store an execution record
    async fn store_execution(&self, execution: StoredExecution) -> Result<(), StorageError>;
    
    /// Get execution by ID
    async fn get_execution(&self, execution_id: &str) -> Result<StoredExecution, StorageError>;
    
    /// Query executions by strategy
    async fn query_executions_by_strategy(
        &self, 
        strategy_id: &StrategyId,
        time_range: TimeRange,
        limit: Option<usize>,
    ) -> Result<Vec<StoredExecution>, StorageError>;
    
    /// Store telemetry event
    async fn store_telemetry_event(&self, event: TelemetryEvent) -> Result<(), StorageError>;
    
    /// Query telemetry events
    async fn query_telemetry_events(
        &self,
        strategy_id: Option<&StrategyId>,
        level: Option<TelemetryLevel>,
        time_range: TimeRange,
        limit: Option<usize>,
    ) -> Result<Vec<TelemetryEvent>, StorageError>;
    
    /// Store strategy performance snapshot
    async fn store_performance(
        &self,
        strategy_id: &StrategyId,
        performance: &StrategyPerformance,
    ) -> Result<(), StorageError>;
    
    /// Get latest strategy performance
    async fn get_latest_performance(
        &self,
        strategy_id: &StrategyId,
    ) -> Result<StrategyPerformance, StorageError>;
    
    /// Get performance history
    async fn get_performance_history(
        &self,
        strategy_id: &StrategyId,
        time_range: TimeRange,
        interval: &str, // "hour", "day", "week"
    ) -> Result<Vec<(DateTime<Utc>, StrategyPerformance)>, StorageError>;
    
    /// Run database maintenance tasks
    async fn run_maintenance(&self) -> Result<(), StorageError>;
}

/// In-memory implementation of strategy storage
pub struct InMemoryStorage {
    /// Stored executions
    executions: Arc<RwLock<HashMap<String, StoredExecution>>>,
    /// Telemetry events
    events: Arc<RwLock<Vec<TelemetryEvent>>>,
    /// Strategy performance history
    performance: Arc<RwLock<HashMap<StrategyId, Vec<(DateTime<Utc>, StrategyPerformance)>>>>,
    /// Configuration
    config: StorageConfig,
}

impl InMemoryStorage {
    /// Create a new in-memory storage
    pub fn new(config: StorageConfig) -> Self {
        Self {
            executions: Arc::new(RwLock::new(HashMap::new())),
            events: Arc::new(RwLock::new(Vec::new())),
            performance: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }
}

#[async_trait]
impl StrategyStorage for InMemoryStorage {
    async fn store_execution(&self, execution: StoredExecution) -> Result<(), StorageError> {
        let mut executions = self.executions.write().await;
        executions.insert(execution.id.clone(), execution);
        
        // Limit cache size
        if executions.len() > self.config.max_cache_entries {
            // Simple approach: just remove oldest entries
            // A more sophisticated approach would prioritize keeping important data
            let mut entries: Vec<_> = executions.iter().collect();
            entries.sort_by(|(_, a), (_, b)| a.timestamp.cmp(&b.timestamp));
            
            for i in 0..(entries.len() - self.config.max_cache_entries) {
                if let Some((id, _)) = entries.get(i) {
                    executions.remove(*id);
                }
            }
        }
        
        Ok(())
    }
    
    async fn get_execution(&self, execution_id: &str) -> Result<StoredExecution, StorageError> {
        let executions = self.executions.read().await;
        executions.get(execution_id)
            .cloned()
            .ok_or_else(|| StorageError::NotFound(format!("Execution {} not found", execution_id)))
    }
    
    async fn query_executions_by_strategy(
        &self,
        strategy_id: &StrategyId,
        time_range: TimeRange,
        limit: Option<usize>,
    ) -> Result<Vec<StoredExecution>, StorageError> {
        let executions = self.executions.read().await;
        
        // Filter by strategy and time range
        let mut result: Vec<StoredExecution> = executions.values()
            .filter(|exec| {
                if &exec.strategy_id != strategy_id {
                    return false;
                }
                
                match &time_range {
                    TimeRange::LastHours(hours) => {
                        let cutoff = Utc::now() - chrono::Duration::hours(*hours as i64);
                        exec.timestamp >= cutoff
                    },
                    TimeRange::LastDays(days) => {
                        let cutoff = Utc::now() - chrono::Duration::days(*days as i64);
                        exec.timestamp >= cutoff
                    },
                    TimeRange::Custom { start, end } => {
                        exec.timestamp >= *start && exec.timestamp <= *end
                    },
                    TimeRange::All => true,
                }
            })
            .cloned()
            .collect();
        
        // Sort by timestamp (newest first)
        result.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        
        // Apply limit
        if let Some(limit) = limit {
            result.truncate(limit);
        }
        
        Ok(result)
    }
    
    async fn store_telemetry_event(&self, event: TelemetryEvent) -> Result<(), StorageError> {
        let mut events = self.events.write().await;
        events.push(event);
        
        // Limit cache size
        if events.len() > self.config.max_cache_entries {
            events.sort_by(|a, b| a.timestamp().cmp(&b.timestamp()));
            events.truncate(self.config.max_cache_entries);
        }
        
        Ok(())
    }
    
    async fn query_telemetry_events(
        &self,
        strategy_id: Option<&StrategyId>,
        level: Option<TelemetryLevel>,
        time_range: TimeRange,
        limit: Option<usize>,
    ) -> Result<Vec<TelemetryEvent>, StorageError> {
        let events = self.events.read().await;
        
        // Filter by criteria
        let mut result: Vec<TelemetryEvent> = events.iter()
            .filter(|event| {
                // Filter by strategy ID
                if let Some(strategy_id) = strategy_id {
                    if let Some(event_id) = event.entity_id() {
                        if event_id != strategy_id {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
                
                // Filter by level
                if let Some(min_level) = level {
                    if event.level() < min_level {
                        return false;
                    }
                }
                
                // Filter by time range
                match &time_range {
                    TimeRange::LastHours(hours) => {
                        let cutoff = Utc::now() - chrono::Duration::hours(*hours as i64);
                        event.timestamp() >= cutoff
                    },
                    TimeRange::LastDays(days) => {
                        let cutoff = Utc::now() - chrono::Duration::days(*days as i64);
                        event.timestamp() >= cutoff
                    },
                    TimeRange::Custom { start, end } => {
                        event.timestamp() >= *start && event.timestamp() <= *end
                    },
                    TimeRange::All => true,
                }
            })
            .cloned()
            .collect();
        
        // Sort by timestamp (newest first)
        result.sort_by(|a, b| b.timestamp().cmp(&a.timestamp()));
        
        // Apply limit
        if let Some(limit) = limit {
            result.truncate(limit);
        }
        
        Ok(result)
    }
    
    async fn store_performance(
        &self,
        strategy_id: &StrategyId,
        performance: &StrategyPerformance,
    ) -> Result<(), StorageError> {
        let mut performances = self.performance.write().await;
        
        let history = performances
            .entry(strategy_id.clone())
            .or_insert_with(Vec::new);
        
        history.push((Utc::now(), performance.clone()));
        
        // Limit history size
        if history.len() > self.config.max_cache_entries {
            history.sort_by(|(a, _), (b, _)| a.cmp(b));
            history.truncate(self.config.max_cache_entries);
        }
        
        Ok(())
    }
    
    async fn get_latest_performance(
        &self,
        strategy_id: &StrategyId,
    ) -> Result<StrategyPerformance, StorageError> {
        let performances = self.performance.read().await;
        
        let history = performances.get(strategy_id)
            .ok_or_else(|| StorageError::NotFound(format!("No performance history for strategy {}", strategy_id)))?;
        
        if history.is_empty() {
            return Err(StorageError::NotFound(format!("No performance history for strategy {}", strategy_id)));
        }
        
        // Find the most recent entry
        let latest = history.iter()
            .max_by_key(|(timestamp, _)| timestamp)
            .map(|(_, perf)| perf.clone())
            .ok_or_else(|| StorageError::Internal("Failed to get latest performance".to_string()))?;
        
        Ok(latest)
    }
    
    async fn get_performance_history(
        &self,
        strategy_id: &StrategyId,
        time_range: TimeRange,
        interval: &str,
    ) -> Result<Vec<(DateTime<Utc>, StrategyPerformance)>, StorageError> {
        let performances = self.performance.read().await;
        
        let history = performances.get(strategy_id)
            .ok_or_else(|| StorageError::NotFound(format!("No performance history for strategy {}", strategy_id)))?;
        
        // Filter by time range
        let mut filtered: Vec<(DateTime<Utc>, StrategyPerformance)> = history.iter()
            .filter(|(timestamp, _)| {
                match &time_range {
                    TimeRange::LastHours(hours) => {
                        let cutoff = Utc::now() - chrono::Duration::hours(*hours as i64);
                        *timestamp >= cutoff
                    },
                    TimeRange::LastDays(days) => {
                        let cutoff = Utc::now() - chrono::Duration::days(*days as i64);
                        *timestamp >= cutoff
                    },
                    TimeRange::Custom { start, end } => {
                        *timestamp >= *start && *timestamp <= *end
                    },
                    TimeRange::All => true,
                }
            })
            .cloned()
            .collect();
        
        // Sort by timestamp
        filtered.sort_by(|(a, _), (b, _)| a.cmp(b));
        
        // Simple resampling for the requested interval
        // In a real implementation, this would do proper time-based resampling
        match interval {
            "hour" | "day" | "week" => {
                // Just return all data for now
                // A real implementation would aggregate based on the interval
                Ok(filtered)
            },
            _ => Err(StorageError::Internal(format!("Unsupported interval: {}", interval))),
        }
    }
    
    async fn run_maintenance(&self) -> Result<(), StorageError> {
        // For in-memory storage, we don't need complex maintenance
        // Just clean up old data based on retention policy
        
        if !self.config.enable_cleanup {
            return Ok(());
        }
        
        let cutoff = Utc::now() - chrono::Duration::days(self.config.max_history_days as i64);
        
        // Clean up old executions
        {
            let mut executions = self.executions.write().await;
            executions.retain(|_, exec| exec.timestamp >= cutoff);
        }
        
        // Clean up old events
        {
            let mut events = self.events.write().await;
            events.retain(|event| event.timestamp() >= cutoff);
        }
        
        // Clean up old performance data
        {
            let mut performances = self.performance.write().await;
            for history in performances.values_mut() {
                history.retain(|(timestamp, _)| *timestamp >= cutoff);
            }
            
            // Remove empty histories
            performances.retain(|_, history| !history.is_empty());
        }
        
        Ok(())
    }
}

/// Create a new strategy storage with the given configuration
pub fn create_storage(config: StorageConfig) -> Arc<dyn StrategyStorage> {
    match config.storage_type {
        StorageType::Memory => {
            Arc::new(InMemoryStorage::new(config))
        },
        StorageType::File => {
            // Placeholder for file-based storage
            // In a real implementation, this would use a file-based storage backend
            info!("File storage not fully implemented, using in-memory storage");
            Arc::new(InMemoryStorage::new(config))
        },
        StorageType::SQLite => {
            // Placeholder for SQLite storage
            // In a real implementation, this would use a SQLite database
            info!("SQLite storage not fully implemented, using in-memory storage");
            Arc::new(InMemoryStorage::new(config))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strategy::SignalAction;
    
    #[tokio::test]
    async fn test_in_memory_storage() {
        let config = StorageConfig {
            storage_type: StorageType::Memory,
            max_cache_entries: 10,
            ..Default::default()
        };
        
        let storage = InMemoryStorage::new(config);
        
        // Create a test execution
        let strategy_id = "test-strategy".to_string();
        let execution = StoredExecution {
            id: "exec-1".to_string(),
            strategy_id: strategy_id.clone(),
            symbol: "BTC/USD".to_string(),
            timestamp: Utc::now(),
            signal: Signal::new(&strategy_id, "BTC/USD", SignalAction::Buy),
            result: ExecutionResult::default(),
            performance_impact: Some(PerformanceImpact {
                pnl_change: 100.0,
                drawdown_change: 0.0,
                is_win: true,
                trust_score_change: 0.01,
            }),
        };
        
        // Store the execution
        storage.store_execution(execution.clone()).await.unwrap();
        
        // Retrieve the execution
        let retrieved = storage.get_execution("exec-1").await.unwrap();
        assert_eq!(retrieved.id, "exec-1");
        assert_eq!(retrieved.strategy_id, strategy_id);
        
        // Query executions
        let executions = storage.query_executions_by_strategy(
            &strategy_id,
            TimeRange::All,
            None,
        ).await.unwrap();
        
        assert_eq!(executions.len(), 1);
        assert_eq!(executions[0].id, "exec-1");
    }
} 