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
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tokio::time;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Errors related to trust buffer operations
#[derive(Debug, Error)]
pub enum TrustBufferError {
    #[error("Entity not found: {0}")]
    EntityNotFound(String),
    
    #[error("Invalid time range: {0}")]
    InvalidTimeRange(String),
    
    #[error("Buffer capacity exceeded: {0}")]
    CapacityExceeded(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// A trust score update event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreUpdate {
    /// Entity ID (strategy, node, etc.)
    pub entity_id: String,
    /// Entity type
    pub entity_type: String,
    /// New trust score
    pub trust_score: f64,
    /// Previous trust score
    pub previous_score: f64,
    /// Change in trust score
    pub delta: f64,
    /// Reason for update
    pub reason: String,
    /// Number of consecutive losses (for strategies)
    pub consecutive_losses: Option<u32>,
    /// Whether the entity is active
    pub is_active: Option<bool>,
    /// Timestamp of the update
    pub timestamp: DateTime<Utc>,
    /// Unique ID for this update
    pub id: String,
}

impl TrustScoreUpdate {
    /// Create a new trust score update
    pub fn new(
        entity_id: &str,
        entity_type: &str,
        trust_score: f64,
        previous_score: f64,
        reason: String,
    ) -> Self {
        Self {
            entity_id: entity_id.to_string(),
            entity_type: entity_type.to_string(),
            trust_score,
            previous_score,
            delta: trust_score - previous_score,
            reason,
            consecutive_losses: None,
            is_active: None,
            timestamp: Utc::now(),
            id: Uuid::new_v4().to_string(),
        }
    }
    
    /// Add strategy-specific information
    pub fn with_strategy_info(mut self, consecutive_losses: u32, is_active: bool) -> Self {
        self.consecutive_losses = Some(consecutive_losses);
        self.is_active = Some(is_active);
        self
    }
}

/// Aggregated trust statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustStatistics {
    /// Entity ID
    pub entity_id: String,
    /// Entity type
    pub entity_type: String,
    /// Current trust score
    pub current_score: f64,
    /// Average trust score over the time period
    pub average_score: f64,
    /// Minimum trust score over the time period
    pub min_score: f64,
    /// Maximum trust score over the time period
    pub max_score: f64,
    /// Number of updates in the time period
    pub update_count: usize,
    /// Number of positive changes
    pub positive_changes: usize,
    /// Number of negative changes
    pub negative_changes: usize,
    /// Standard deviation of the score
    pub standard_deviation: f64,
    /// First timestamp in the range
    pub start_time: DateTime<Utc>,
    /// Last timestamp in the range
    pub end_time: DateTime<Utc>,
}

/// Time range for querying trust data
#[derive(Debug, Clone, Copy)]
pub enum TimeRange {
    /// Last N hours
    LastHours(u32),
    /// Last N days
    LastDays(u32),
    /// Custom range between two timestamps
    Custom(DateTime<Utc>, DateTime<Utc>),
    /// All available data
    All,
}

impl TimeRange {
    /// Convert to start and end timestamps
    pub fn to_timestamps(&self) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
        let now = Utc::now();
        
        match self {
            TimeRange::LastHours(hours) => {
                let start = now - chrono::Duration::hours(*hours as i64);
                (Some(start), Some(now))
            },
            TimeRange::LastDays(days) => {
                let start = now - chrono::Duration::days(*days as i64);
                (Some(start), Some(now))
            },
            TimeRange::Custom(start, end) => {
                (Some(*start), Some(*end))
            },
            TimeRange::All => {
                (None, Some(now))
            },
        }
    }
    
    /// Validate the time range
    pub fn validate(&self) -> Result<(), TrustBufferError> {
        match self {
            TimeRange::Custom(start, end) => {
                if end <= start {
                    return Err(TrustBufferError::InvalidTimeRange(
                        "End time must be after start time".to_string()
                    ));
                }
            },
            _ => {}
        }
        
        Ok(())
    }
}

/// Configuration for the trust buffer
#[derive(Debug, Clone)]
pub struct TrustBufferConfig {
    /// Maximum number of updates to keep per entity
    pub max_updates_per_entity: usize,
    /// Maximum number of entities to track
    pub max_entities: usize,
    /// Whether to persist trust history to disk
    pub enable_persistence: bool,
    /// Path to store persistent data
    pub persistence_path: Option<String>,
    /// Interval for aggregating and cleaning up data in seconds
    pub cleanup_interval_sec: u64,
    /// Maximum age of data to keep in days
    pub max_data_age_days: u32,
    /// Whether to enable broadcasting of updates
    pub enable_broadcasting: bool,
    /// Broadcast channel capacity
    pub broadcast_capacity: usize,
}

impl Default for TrustBufferConfig {
    fn default() -> Self {
        Self {
            max_updates_per_entity: 1000,
            max_entities: 500,
            enable_persistence: false,
            persistence_path: None,
            cleanup_interval_sec: 3600, // 1 hour
            max_data_age_days: 30,      // 30 days
            enable_broadcasting: true,
            broadcast_capacity: 100,
        }
    }
}

/// Trust history for a single entity
#[derive(Debug)]
struct EntityTrustHistory {
    /// Entity ID
    entity_id: String,
    /// Entity type
    entity_type: String,
    /// History of trust updates
    updates: VecDeque<TrustScoreUpdate>,
    /// Current trust score
    current_score: f64,
    /// Last update timestamp
    last_updated: DateTime<Utc>,
}

impl EntityTrustHistory {
    /// Create a new entity trust history
    fn new(entity_id: &str, entity_type: &str, initial_score: f64) -> Self {
        Self {
            entity_id: entity_id.to_string(),
            entity_type: entity_type.to_string(),
            updates: VecDeque::new(),
            current_score: initial_score,
            last_updated: Utc::now(),
        }
    }
    
    /// Add a trust update
    fn add_update(&mut self, update: TrustScoreUpdate, max_updates: usize) {
        self.current_score = update.trust_score;
        self.last_updated = update.timestamp;
        
        self.updates.push_front(update);
        
        // Trim if needed
        while self.updates.len() > max_updates {
            self.updates.pop_back();
        }
    }
    
    /// Get updates in a time range
    fn get_updates_in_range(&self, range: TimeRange) -> Result<Vec<TrustScoreUpdate>, TrustBufferError> {
        range.validate()?;
        
        let (start, end) = range.to_timestamps();
        
        Ok(self.updates.iter()
            .filter(|update| {
                let within_start = start.map_or(true, |s| update.timestamp >= s);
                let within_end = end.map_or(true, |e| update.timestamp <= e);
                within_start && within_end
            })
            .cloned()
            .collect())
    }
    
    /// Calculate statistics for a time range
    fn calculate_statistics(&self, range: TimeRange) -> Result<TrustStatistics, TrustBufferError> {
        let updates = self.get_updates_in_range(range)?;
        
        if updates.is_empty() {
            return Err(TrustBufferError::InvalidTimeRange(
                "No data in the specified time range".to_string()
            ));
        }
        
        let mut sum = 0.0;
        let mut min = f64::MAX;
        let mut max = f64::MIN;
        let mut positive_changes = 0;
        let mut negative_changes = 0;
        
        for update in &updates {
            sum += update.trust_score;
            min = min.min(update.trust_score);
            max = max.max(update.trust_score);
            
            if update.delta > 0.0 {
                positive_changes += 1;
            } else if update.delta < 0.0 {
                negative_changes += 1;
            }
        }
        
        let count = updates.len();
        let average = sum / count as f64;
        
        // Calculate standard deviation
        let variance = updates.iter()
            .map(|u| (u.trust_score - average).powi(2))
            .sum::<f64>() / count as f64;
        let std_dev = variance.sqrt();
        
        // Get timespan
        let start_time = updates.iter().map(|u| u.timestamp).min().unwrap();
        let end_time = updates.iter().map(|u| u.timestamp).max().unwrap();
        
        Ok(TrustStatistics {
            entity_id: self.entity_id.clone(),
            entity_type: self.entity_type.clone(),
            current_score: self.current_score,
            average_score: average,
            min_score: min,
            max_score: max,
            update_count: count,
            positive_changes,
            negative_changes,
            standard_deviation: std_dev,
            start_time,
            end_time,
        })
    }
}

/// Buffer for storing and analyzing trust score history
pub struct TrustBuffer {
    /// Configuration
    config: TrustBufferConfig,
    /// Trust histories by entity ID
    histories: Arc<RwLock<HashMap<String, EntityTrustHistory>>>,
    /// Broadcast channel for trust updates
    update_tx: Option<broadcast::Sender<TrustScoreUpdate>>,
    /// Shutdown signal
    shutdown: Arc<RwLock<bool>>,
}

impl TrustBuffer {
    /// Create a new trust buffer with the given configuration
    pub fn new(config: TrustBufferConfig) -> Self {
        let update_tx = if config.enable_broadcasting {
            Some(broadcast::channel(config.broadcast_capacity).0)
        } else {
            None
        };
        
        Self {
            config,
            histories: Arc::new(RwLock::new(HashMap::new())),
            update_tx,
            shutdown: Arc::new(RwLock::new(false)),
        }
    }
    
    /// Start background tasks for the trust buffer
    pub fn start(&self) -> Arc<Self> {
        let buffer = Arc::new(self.clone());
        
        if self.config.enable_persistence || self.config.max_data_age_days > 0 {
            Self::start_background_tasks(Arc::clone(&buffer));
        }
        
        buffer
    }
    
    /// Start background tasks for cleanup and persistence
    fn start_background_tasks(buffer: Arc<Self>) {
        tokio::spawn(async move {
            let cleanup_interval = time::Duration::from_secs(buffer.config.cleanup_interval_sec);
            let mut interval = time::interval(cleanup_interval);
            
            loop {
                interval.tick().await;
                
                // Check if we should shut down
                {
                    let shutdown = buffer.shutdown.read().unwrap();
                    if *shutdown {
                        break;
                    }
                }
                
                // Perform cleanup
                if let Err(e) = buffer.cleanup_old_data().await {
                    error!("Error during trust buffer cleanup: {}", e);
                }
                
                // Persist data if enabled
                if buffer.config.enable_persistence {
                    if let Err(e) = buffer.persist_data().await {
                        error!("Error persisting trust buffer data: {}", e);
                    }
                }
            }
        });
    }
    
    /// Add a trust score update
    pub async fn add_update(&self, update: TrustScoreUpdate) -> Result<(), TrustBufferError> {
        let full_id = format!("{}:{}", update.entity_type, update.entity_id);
        
        // Update the history
        {
            let mut histories = self.histories.write().unwrap();
            
            // Check if we've reached the entity limit
            if !histories.contains_key(&full_id) && histories.len() >= self.config.max_entities {
                return Err(TrustBufferError::CapacityExceeded(
                    format!("Maximum number of entities ({}) reached", self.config.max_entities)
                ));
            }
            
            let history = histories.entry(full_id.clone()).or_insert_with(|| {
                EntityTrustHistory::new(&update.entity_id, &update.entity_type, update.trust_score)
            });
            
            history.add_update(update.clone(), self.config.max_updates_per_entity);
        }
        
        // Broadcast the update if enabled
        if let Some(tx) = &self.update_tx {
            if let Err(e) = tx.send(update) {
                warn!("Failed to broadcast trust update: {}", e);
            }
        }
        
        Ok(())
    }
    
    /// Get updates for an entity in a time range
    pub fn get_updates(&self, entity_id: &str, entity_type: &str, range: TimeRange) 
        -> Result<Vec<TrustScoreUpdate>, TrustBufferError> {
        let full_id = format!("{}:{}", entity_type, entity_id);
        
        let histories = self.histories.read().unwrap();
        
        let history = histories.get(&full_id).ok_or_else(|| 
            TrustBufferError::EntityNotFound(format!("Entity {} not found", full_id))
        )?;
        
        history.get_updates_in_range(range)
    }
    
    /// Get statistics for an entity in a time range
    pub fn get_statistics(&self, entity_id: &str, entity_type: &str, range: TimeRange) 
        -> Result<TrustStatistics, TrustBufferError> {
        let full_id = format!("{}:{}", entity_type, entity_id);
        
        let histories = self.histories.read().unwrap();
        
        let history = histories.get(&full_id).ok_or_else(|| 
            TrustBufferError::EntityNotFound(format!("Entity {} not found", full_id))
        )?;
        
        history.calculate_statistics(range)
    }
    
    /// Get a list of all tracked entities
    pub fn list_entities(&self) -> Vec<(String, String)> {
        let histories = self.histories.read().unwrap();
        
        histories.values()
            .map(|h| (h.entity_id.clone(), h.entity_type.clone()))
            .collect()
    }
    
    /// Get current trust scores for all entities
    pub fn get_all_current_scores(&self) -> HashMap<String, f64> {
        let histories = self.histories.read().unwrap();
        
        histories.iter()
            .map(|(id, h)| (id.clone(), h.current_score))
            .collect()
    }
    
    /// Get a subscription to trust updates
    pub fn subscribe(&self) -> Option<broadcast::Receiver<TrustScoreUpdate>> {
        self.update_tx.as_ref().map(|tx| tx.subscribe())
    }
    
    /// Clean up old data beyond max_data_age_days
    async fn cleanup_old_data(&self) -> Result<usize, TrustBufferError> {
        if self.config.max_data_age_days == 0 {
            return Ok(0); // No cleanup needed
        }
        
        let cutoff = Utc::now() - chrono::Duration::days(self.config.max_data_age_days as i64);
        let mut total_removed = 0;
        
        let mut histories = self.histories.write().unwrap();
        
        for history in histories.values_mut() {
            let initial_size = history.updates.len();
            
            // Remove updates older than the cutoff
            history.updates.retain(|update| update.timestamp >= cutoff);
            
            total_removed += initial_size - history.updates.len();
        }
        
        // Remove entities with no updates
        histories.retain(|_, history| !history.updates.is_empty());
        
        Ok(total_removed)
    }
    
    /// Persist data to disk
    async fn persist_data(&self) -> Result<(), TrustBufferError> {
        if !self.config.enable_persistence || self.config.persistence_path.is_none() {
            return Ok(());
        }
        
        // In a real implementation, we would serialize and save the data
        // This is just a placeholder
        debug!("Would persist trust buffer data to disk");
        
        Ok(())
    }
    
    /// Shutdown the trust buffer
    pub async fn shutdown(&self) {
        {
            let mut shutdown = self.shutdown.write().unwrap();
            *shutdown = true;
        }
        
        // Final persistence if enabled
        if self.config.enable_persistence {
            if let Err(e) = self.persist_data().await {
                error!("Error during final trust buffer persistence: {}", e);
            }
        }
    }
}

impl Clone for TrustBuffer {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            histories: Arc::clone(&self.histories),
            update_tx: self.update_tx.clone(),
            shutdown: Arc::clone(&self.shutdown),
        }
    }
}

impl Drop for TrustBuffer {
    fn drop(&mut self) {
        if Arc::strong_count(&self.histories) == 1 {
            // Last instance being dropped
            debug!("Last trust buffer instance dropped");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_add_and_retrieve_updates() {
        let config = TrustBufferConfig::default();
        let buffer = TrustBuffer::new(config);
        
        // Add some updates
        let update1 = TrustScoreUpdate::new(
            "test-strategy", "strategy", 0.8, 0.7, "Test update 1".to_string()
        );
        
        let update2 = TrustScoreUpdate::new(
            "test-strategy", "strategy", 0.9, 0.8, "Test update 2".to_string()
        );
        
        buffer.add_update(update1).await.unwrap();
        buffer.add_update(update2).await.unwrap();
        
        // Retrieve updates
        let updates = buffer.get_updates("test-strategy", "strategy", TimeRange::All).unwrap();
        assert_eq!(updates.len(), 2);
        
        // Check ordering (newest first)
        assert_eq!(updates[0].trust_score, 0.9);
        assert_eq!(updates[1].trust_score, 0.8);
    }
    
    #[tokio::test]
    async fn test_statistics_calculation() {
        let config = TrustBufferConfig::default();
        let buffer = TrustBuffer::new(config);
        
        // Add sequence of updates
        for i in 0..5 {
            let prev = 0.5 + (i as f64 * 0.1);
            let score = prev + 0.1;
            
            let update = TrustScoreUpdate::new(
                "test-strategy", "strategy", score, prev, format!("Update {}", i)
            );
            
            buffer.add_update(update).await.unwrap();
        }
        
        // Calculate statistics
        let stats = buffer.get_statistics("test-strategy", "strategy", TimeRange::All).unwrap();
        
        // Check statistics
        assert_eq!(stats.entity_id, "test-strategy");
        assert_eq!(stats.entity_type, "strategy");
        assert_eq!(stats.current_score, 1.0);
        assert!(stats.average_score > 0.5 && stats.average_score < 1.0);
        assert_eq!(stats.min_score, 0.6);
        assert_eq!(stats.max_score, 1.0);
        assert_eq!(stats.update_count, 5);
        assert_eq!(stats.positive_changes, 5);
        assert_eq!(stats.negative_changes, 0);
    }
    
    #[tokio::test]
    async fn test_time_range_filtering() {
        let config = TrustBufferConfig::default();
        let buffer = TrustBuffer::new(config);
        
        // Add updates with different timestamps
        for i in 0..3 {
            let timestamp = Utc::now() - chrono::Duration::hours(i * 12);
            
            let update = TrustScoreUpdate {
                entity_id: "test-strategy".to_string(),
                entity_type: "strategy".to_string(),
                trust_score: 0.5 + (i as f64 * 0.1),
                previous_score: 0.5,
                delta: i as f64 * 0.1,
                reason: format!("Update {}", i),
                consecutive_losses: None,
                is_active: Some(true),
                timestamp,
                id: Uuid::new_v4().to_string(),
            };
            
            buffer.add_update(update).await.unwrap();
        }
        
        // Test filtering by time range
        let last_day = buffer.get_updates("test-strategy", "strategy", TimeRange::LastHours(24)).unwrap();
        assert_eq!(last_day.len(), 2); // Should include first two updates
        
        let all = buffer.get_updates("test-strategy", "strategy", TimeRange::All).unwrap();
        assert_eq!(all.len(), 3); // Should include all updates
    }
} 