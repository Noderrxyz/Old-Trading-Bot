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

//! Drawdown Tracker Engine
//! 
//! This module implements a system for tracking real-time drawdowns, managing recovery,
//! and adjusting risk exposure based on drawdown states.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::redis::{RedisClient, RedisClientResult};
use crate::strategy::StrategyId;

/// Errors that can occur with drawdown operations
#[derive(Debug, Error)]
pub enum DrawdownError {
    #[error("Redis error: {0}")]
    Redis(String),
    
    #[error("Strategy not found: {0}")]
    StrategyNotFound(String),
    
    #[error("Invalid state transition: {0}")]
    InvalidStateTransition(String),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for drawdown operations
pub type DrawdownResult<T> = Result<T, DrawdownError>;

/// Drawdown snapshot with current equity and drawdown metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawdownSnapshot {
    /// Strategy ID this snapshot belongs to
    pub strategy_id: StrategyId,
    
    /// Current equity value
    pub current_equity: f64,
    
    /// Maximum equity value (historical peak)
    pub max_equity: f64,
    
    /// Drawdown percentage (negative value)
    pub drawdown_percent: f64,
    
    /// Timestamp of this snapshot
    pub timestamp: i64,
}

/// Drawdown state representing the current risk adaptation mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DrawdownState {
    /// Normal operation with full exposure
    Normal,
    
    /// Caution state with reduced exposure
    Caution,
    
    /// Critical state with significantly reduced exposure
    Critical,
    
    /// Recovery state gradually increasing exposure
    Recovery,
}

impl Default for DrawdownState {
    fn default() -> Self {
        Self::Normal
    }
}

impl std::fmt::Display for DrawdownState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Normal => write!(f, "Normal"),
            Self::Caution => write!(f, "Caution"),
            Self::Critical => write!(f, "Critical"),
            Self::Recovery => write!(f, "Recovery"),
        }
    }
}

/// Configuration for drawdown management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawdownConfig {
    /// Threshold for entering caution state
    pub caution_threshold: f64,
    
    /// Threshold for entering critical state
    pub critical_threshold: f64,
    
    /// Threshold for exiting critical/caution into recovery
    pub recovery_threshold: f64,
    
    /// Exposure modifier for caution state
    pub caution_exposure_modifier: f64,
    
    /// Exposure modifier for critical state
    pub critical_exposure_modifier: f64,
    
    /// Recovery ramp mode (linear or exponential)
    pub recovery_ramp_mode: RecoveryRampMode,
    
    /// Maximum recovery period in seconds
    pub max_recovery_period_sec: u64,
    
    /// Whether to enable alert notifications
    pub enable_alerts: bool,
    
    /// Whether to pause new trades in critical state
    pub pause_trades_in_critical: bool,
    
    /// Time window for analyzing drawdown (in seconds)
    pub analysis_window_sec: u64,
}

impl Default for DrawdownConfig {
    fn default() -> Self {
        Self {
            caution_threshold: -0.05,           // 5% drawdown
            critical_threshold: -0.10,          // 10% drawdown
            recovery_threshold: -0.02,          // 2% drawdown from bottom
            caution_exposure_modifier: 0.75,    // 75% exposure
            critical_exposure_modifier: 0.30,   // 30% exposure
            recovery_ramp_mode: RecoveryRampMode::Linear,
            max_recovery_period_sec: 86400 * 7, // 7 days
            enable_alerts: true,
            pause_trades_in_critical: true,
            analysis_window_sec: 86400 * 30,    // 30 days
        }
    }
}

/// Recovery ramp modes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecoveryRampMode {
    /// Linear ramp from recovery to normal
    Linear,
    
    /// Exponential ramp (faster at first, then slower)
    Exponential,
    
    /// Sigmoid function for smooth transition
    Sigmoid,
}

/// Interface for drawdown tracker engine
#[async_trait]
pub trait DrawdownTracker: Send + Sync {
    /// Update equity and calculate drawdown for a strategy
    async fn update_equity(&self, strategy_id: &StrategyId, current_equity: f64) -> DrawdownResult<DrawdownSnapshot>;
    
    /// Get the latest drawdown snapshot
    async fn get_latest_snapshot(&self, strategy_id: &StrategyId) -> DrawdownResult<DrawdownSnapshot>;
    
    /// Get the drawdown state for a strategy
    async fn get_drawdown_state(&self, strategy_id: &StrategyId) -> DrawdownResult<DrawdownState>;
    
    /// Get the risk modifier based on current drawdown state
    async fn get_risk_modifier(&self, strategy_id: &StrategyId) -> DrawdownResult<f64>;
    
    /// Get historical drawdown snapshots for a strategy
    async fn get_drawdown_history(
        &self, 
        strategy_id: &StrategyId, 
        limit: Option<usize>
    ) -> DrawdownResult<Vec<DrawdownSnapshot>>;
    
    /// Reset drawdown for a strategy (e.g., after capital addition)
    async fn reset_drawdown(&self, strategy_id: &StrategyId) -> DrawdownResult<()>;
    
    /// Get configuration
    fn get_config(&self) -> &DrawdownConfig;
    
    /// Update configuration
    async fn update_config(&self, config: DrawdownConfig) -> DrawdownResult<()>;
}

/// Additional internal state for recovery calculation
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecoveryState {
    /// Equity at the bottom of the drawdown
    low_point_equity: f64,
    
    /// Timestamp when recovery started
    recovery_start: i64,
    
    /// Maximum equity before drawdown
    reference_max_equity: f64,
}

/// Default implementation of DrawdownTracker backed by Redis
pub struct DefaultDrawdownTracker {
    /// Redis client for persistence
    redis: Arc<dyn RedisClient>,
    
    /// Configuration
    config: RwLock<DrawdownConfig>,
    
    /// In-memory cache of current drawdown states
    states: RwLock<HashMap<StrategyId, DrawdownState>>,
    
    /// In-memory cache of recovery state information
    recovery_states: RwLock<HashMap<StrategyId, RecoveryState>>,
    
    /// In-memory cache of latest snapshots
    snapshots: RwLock<HashMap<StrategyId, DrawdownSnapshot>>,
}

impl DefaultDrawdownTracker {
    /// Create a new DefaultDrawdownTracker
    pub fn new(redis: Arc<dyn RedisClient>) -> Self {
        Self::with_config(redis, DrawdownConfig::default())
    }
    
    /// Create a new DefaultDrawdownTracker with custom config
    pub fn with_config(redis: Arc<dyn RedisClient>, config: DrawdownConfig) -> Self {
        Self {
            redis,
            config: RwLock::new(config),
            states: RwLock::new(HashMap::new()),
            recovery_states: RwLock::new(HashMap::new()),
            snapshots: RwLock::new(HashMap::new()),
        }
    }
    
    /// Generate Redis key for drawdown snapshots
    fn drawdown_key(&self, strategy_id: &StrategyId) -> String {
        format!("strategy:drawdown:{}", strategy_id)
    }
    
    /// Generate Redis key for drawdown state
    fn drawdown_state_key(&self, strategy_id: &StrategyId) -> String {
        format!("strategy:drawdown_state:{}", strategy_id)
    }
    
    /// Generate Redis key for risk modifier
    fn risk_modifier_key(&self, strategy_id: &StrategyId) -> String {
        format!("strategy:risk_modifier:{}", strategy_id)
    }
    
    /// Generate Redis key for recovery state
    fn recovery_state_key(&self, strategy_id: &StrategyId) -> String {
        format!("strategy:recovery_state:{}", strategy_id)
    }
    
    /// Calculate drawdown percentage
    fn calculate_drawdown(&self, current: f64, peak: f64) -> f64 {
        if peak <= 0.0 {
            return 0.0;
        }
        (current - peak) / peak
    }
    
    /// Determine the drawdown state based on current drawdown percentage
    async fn determine_state(
        &self, 
        strategy_id: &StrategyId, 
        drawdown_pct: f64,
        current_state: DrawdownState,
        current_equity: f64,
        max_equity: f64
    ) -> DrawdownState {
        let config = self.config.read().await;
        
        // Special handling for recovery state
        if current_state == DrawdownState::Recovery {
            // Stay in recovery unless we've fully recovered or fallen back to critical
            if drawdown_pct >= 0.0 {
                // Fully recovered
                return DrawdownState::Normal;
            } else if drawdown_pct <= config.critical_threshold {
                // Fallen back to critical
                return DrawdownState::Critical;
            } else {
                // Still in recovery
                return DrawdownState::Recovery;
            }
        }
        
        // State transitions for other states
        if drawdown_pct <= config.critical_threshold {
            // If we just entered critical state, store the low point
            if current_state != DrawdownState::Critical {
                // Record the low point for recovery tracking
                let mut recovery_states = self.recovery_states.write().await;
                recovery_states.insert(strategy_id.clone(), RecoveryState {
                    low_point_equity: current_equity,
                    recovery_start: 0, // Will be set when recovery begins
                    reference_max_equity: max_equity,
                });
                
                // Publish alert if enabled
                if config.enable_alerts {
                    self.publish_critical_alert(strategy_id, drawdown_pct).await;
                }
            }
            DrawdownState::Critical
        } else if drawdown_pct <= config.caution_threshold {
            // If we were in critical state and improved to caution level
            if current_state == DrawdownState::Critical {
                // Check if we've improved enough from the bottom to enter recovery
                if let Some(recovery_state) = self.recovery_states.read().await.get(strategy_id) {
                    let improvement = self.calculate_drawdown(current_equity, recovery_state.low_point_equity);
                    
                    if improvement >= config.recovery_threshold.abs() {
                        // Enter recovery state
                        let mut recovery_states = self.recovery_states.write().await;
                        if let Some(state) = recovery_states.get_mut(strategy_id) {
                            state.recovery_start = Utc::now().timestamp();
                        }
                        return DrawdownState::Recovery;
                    }
                }
            }
            DrawdownState::Caution
        } else {
            DrawdownState::Normal
        }
    }
    
    /// Calculate risk modifier based on drawdown state and recovery progress
    async fn calculate_risk_modifier(&self, strategy_id: &StrategyId, state: DrawdownState) -> f64 {
        let config = self.config.read().await;
        
        match state {
            DrawdownState::Normal => 1.0,
            DrawdownState::Caution => config.caution_exposure_modifier,
            DrawdownState::Critical => config.critical_exposure_modifier,
            DrawdownState::Recovery => {
                // For recovery state, calculate a gradual ramp-up based on recovery progress
                let recovery_states = self.recovery_states.read().await;
                
                if let Some(recovery_state) = recovery_states.get(strategy_id) {
                    let now = Utc::now().timestamp();
                    
                    // If recovery hasn't started yet, use critical modifier
                    if recovery_state.recovery_start == 0 {
                        return config.critical_exposure_modifier;
                    }
                    
                    // Get latest snapshot for current equity
                    let latest = if let Ok(snapshot) = self.get_latest_snapshot(strategy_id).await {
                        snapshot
                    } else {
                        return config.critical_exposure_modifier;
                    };
                    
                    // Calculate progress for ramping
                    let recovery_progress = match config.recovery_ramp_mode {
                        RecoveryRampMode::Linear => {
                            // Linear: Based on equity recovery percentage
                            let recovery_pct = (latest.current_equity - recovery_state.low_point_equity) /
                                (recovery_state.reference_max_equity - recovery_state.low_point_equity);
                            recovery_pct.min(1.0).max(0.0)
                        }
                        RecoveryRampMode::Exponential => {
                            // Exponential: Faster at first, slower later
                            let elapsed_sec = (now - recovery_state.recovery_start) as f64;
                            let max_period = config.max_recovery_period_sec as f64;
                            
                            // Using 1 - e^(-5*t/T) for exponential approach
                            let progress = 1.0 - (-5.0 * elapsed_sec / max_period).exp();
                            progress.min(1.0).max(0.0)
                        }
                        RecoveryRampMode::Sigmoid => {
                            // Sigmoid: Smooth S-curve transition
                            let elapsed_sec = (now - recovery_state.recovery_start) as f64;
                            let max_period = config.max_recovery_period_sec as f64;
                            
                            // Using sigmoid function: 1/(1+e^(-(x-0.5)*10))
                            let normalized_time = elapsed_sec / max_period;
                            let progress = 1.0 / (1.0 + (-10.0 * (normalized_time - 0.5)).exp());
                            progress.min(1.0).max(0.0)
                        }
                    };
                    
                    // Calculate risk modifier by interpolating between critical and normal
                    let modifier = config.critical_exposure_modifier + 
                        (1.0 - config.critical_exposure_modifier) * recovery_progress;
                    
                    modifier
                } else {
                    // No recovery state found, default to critical modifier
                    config.critical_exposure_modifier
                }
            }
        }
    }
    
    /// Publish critical state alert
    async fn publish_critical_alert(&self, strategy_id: &StrategyId, drawdown_pct: f64) {
        let alert_data = serde_json::json!({
            "strategy_id": strategy_id,
            "drawdown_pct": drawdown_pct * 100.0,
            "timestamp": Utc::now().timestamp(),
            "message": format!("Strategy {} entered CRITICAL drawdown state with {:.2}% drawdown", 
                strategy_id, drawdown_pct * 100.0),
            "state": "CRITICAL"
        });
        
        if let Err(e) = self.redis.publish("strategy:alerts:drawdown", &alert_data).await {
            error!("Failed to publish drawdown alert: {}", e);
        }
    }
}

#[async_trait]
impl DrawdownTracker for DefaultDrawdownTracker {
    async fn update_equity(&self, strategy_id: &StrategyId, current_equity: f64) -> DrawdownResult<DrawdownSnapshot> {
        // Get current max equity from Redis or existing snapshot
        let existing_snapshot = match self.redis.get::<DrawdownSnapshot>(&self.drawdown_key(strategy_id)).await {
            Ok(Some(snapshot)) => Some(snapshot),
            Ok(None) => None,
            Err(e) => {
                error!("Failed to get existing drawdown snapshot: {}", e);
                return Err(DrawdownError::Redis(e.to_string()));
            }
        };
        
        // Determine max equity (rolling max)
        let max_equity = if let Some(snapshot) = &existing_snapshot {
            snapshot.max_equity.max(current_equity)
        } else {
            current_equity // First snapshot, current is also max
        };
        
        // Calculate drawdown percentage
        let drawdown_percent = self.calculate_drawdown(current_equity, max_equity);
        
        // Create new snapshot
        let new_snapshot = DrawdownSnapshot {
            strategy_id: strategy_id.clone(),
            current_equity,
            max_equity,
            drawdown_percent,
            timestamp: Utc::now().timestamp(),
        };
        
        // Get current state
        let current_state = match self.states.read().await.get(strategy_id) {
            Some(state) => *state,
            None => DrawdownState::Normal,
        };
        
        // Determine new state
        let new_state = self.determine_state(
            strategy_id, 
            drawdown_percent, 
            current_state,
            current_equity,
            max_equity
        ).await;
        
        // Calculate risk modifier
        let risk_modifier = self.calculate_risk_modifier(strategy_id, new_state).await;
        
        // Store snapshot in Redis
        if let Err(e) = self.redis.set(&self.drawdown_key(strategy_id), &new_snapshot, None).await {
            error!("Failed to store drawdown snapshot: {}", e);
            return Err(DrawdownError::Redis(e.to_string()));
        }
        
        // Store state in Redis
        if let Err(e) = self.redis.set(&self.drawdown_state_key(strategy_id), &new_state, None).await {
            error!("Failed to store drawdown state: {}", e);
            return Err(DrawdownError::Redis(e.to_string()));
        }
        
        // Store risk modifier in Redis
        if let Err(e) = self.redis.set(&self.risk_modifier_key(strategy_id), &risk_modifier, None).await {
            error!("Failed to store risk modifier: {}", e);
            return Err(DrawdownError::Redis(e.to_string()));
        }
        
        // If we have recovery state, store it in Redis
        if let Some(recovery_state) = self.recovery_states.read().await.get(strategy_id) {
            if let Err(e) = self.redis.set(&self.recovery_state_key(strategy_id), recovery_state, None).await {
                error!("Failed to store recovery state: {}", e);
                // Non-fatal, continue
            }
        }
        
        // Update in-memory caches
        {
            let mut states = self.states.write().await;
            states.insert(strategy_id.clone(), new_state);
            
            let mut snapshots = self.snapshots.write().await;
            snapshots.insert(strategy_id.clone(), new_snapshot.clone());
        }
        
        // Log significant state changes
        if current_state != new_state {
            info!(
                "Strategy {} drawdown state changed: {} -> {} (drawdown: {:.2}%, modifier: {:.2})",
                strategy_id, current_state, new_state, drawdown_percent * 100.0, risk_modifier
            );
        }
        
        Ok(new_snapshot)
    }
    
    async fn get_latest_snapshot(&self, strategy_id: &StrategyId) -> DrawdownResult<DrawdownSnapshot> {
        // Check in-memory cache first
        if let Some(snapshot) = self.snapshots.read().await.get(strategy_id) {
            return Ok(snapshot.clone());
        }
        
        // Try to get from Redis
        match self.redis.get::<DrawdownSnapshot>(&self.drawdown_key(strategy_id)).await {
            Ok(Some(snapshot)) => {
                // Update cache
                let mut snapshots = self.snapshots.write().await;
                snapshots.insert(strategy_id.clone(), snapshot.clone());
                Ok(snapshot)
            }
            Ok(None) => Err(DrawdownError::StrategyNotFound(strategy_id.clone())),
            Err(e) => {
                error!("Failed to get drawdown snapshot: {}", e);
                Err(DrawdownError::Redis(e.to_string()))
            }
        }
    }
    
    async fn get_drawdown_state(&self, strategy_id: &StrategyId) -> DrawdownResult<DrawdownState> {
        // Check in-memory cache first
        if let Some(state) = self.states.read().await.get(strategy_id) {
            return Ok(*state);
        }
        
        // Try to get from Redis
        match self.redis.get::<DrawdownState>(&self.drawdown_state_key(strategy_id)).await {
            Ok(Some(state)) => {
                // Update cache
                let mut states = self.states.write().await;
                states.insert(strategy_id.clone(), state);
                Ok(state)
            }
            Ok(None) => Ok(DrawdownState::default()), // Default to Normal if not found
            Err(e) => {
                error!("Failed to get drawdown state: {}", e);
                Err(DrawdownError::Redis(e.to_string()))
            }
        }
    }
    
    async fn get_risk_modifier(&self, strategy_id: &StrategyId) -> DrawdownResult<f64> {
        // Get current state
        let state = self.get_drawdown_state(strategy_id).await?;
        
        // Calculate risk modifier based on state
        let risk_modifier = self.calculate_risk_modifier(strategy_id, state).await;
        
        Ok(risk_modifier)
    }
    
    async fn get_drawdown_history(
        &self, 
        strategy_id: &StrategyId, 
        limit: Option<usize>
    ) -> DrawdownResult<Vec<DrawdownSnapshot>> {
        // For this implementation, we don't store history in Redis yet
        // This would be expanded in a real implementation to retrieve historical snapshots
        // For now, we'll just return the latest snapshot if available
        match self.get_latest_snapshot(strategy_id).await {
            Ok(snapshot) => Ok(vec![snapshot]),
            Err(e) => Err(e),
        }
    }
    
    async fn reset_drawdown(&self, strategy_id: &StrategyId) -> DrawdownResult<()> {
        // Get current equity
        let current_equity = match self.get_latest_snapshot(strategy_id).await {
            Ok(snapshot) => snapshot.current_equity,
            Err(_) => {
                // If no snapshot exists, there's nothing to reset
                return Ok(());
            }
        };
        
        // Create a new snapshot with reset values
        let new_snapshot = DrawdownSnapshot {
            strategy_id: strategy_id.clone(),
            current_equity,
            max_equity: current_equity, // Reset peak to current
            drawdown_percent: 0.0,      // No drawdown
            timestamp: Utc::now().timestamp(),
        };
        
        // Store in Redis
        if let Err(e) = self.redis.set(&self.drawdown_key(strategy_id), &new_snapshot, None).await {
            error!("Failed to store reset drawdown snapshot: {}", e);
            return Err(DrawdownError::Redis(e.to_string()));
        }
        
        // Reset state to Normal
        if let Err(e) = self.redis.set(&self.drawdown_state_key(strategy_id), &DrawdownState::Normal, None).await {
            error!("Failed to reset drawdown state: {}", e);
            return Err(DrawdownError::Redis(e.to_string()));
        }
        
        // Reset risk modifier to 1.0
        if let Err(e) = self.redis.set(&self.risk_modifier_key(strategy_id), &1.0, None).await {
            error!("Failed to reset risk modifier: {}", e);
            return Err(DrawdownError::Redis(e.to_string()));
        }
        
        // Reset in-memory caches
        {
            let mut states = self.states.write().await;
            states.insert(strategy_id.clone(), DrawdownState::Normal);
            
            let mut snapshots = self.snapshots.write().await;
            snapshots.insert(strategy_id.clone(), new_snapshot);
            
            let mut recovery_states = self.recovery_states.write().await;
            recovery_states.remove(strategy_id);
        }
        
        // Delete recovery state from Redis
        if let Err(e) = self.redis.delete(&self.recovery_state_key(strategy_id)).await {
            warn!("Failed to delete recovery state: {}", e);
            // Non-fatal, continue
        }
        
        info!("Reset drawdown for strategy {}", strategy_id);
        
        Ok(())
    }
    
    fn get_config(&self) -> &RwLock<DrawdownConfig> {
        &self.config
    }
    
    async fn update_config(&self, config: DrawdownConfig) -> DrawdownResult<()> {
        // Validate config
        if config.caution_threshold > 0.0 || config.critical_threshold > 0.0 || config.recovery_threshold > 0.0 {
            return Err(DrawdownError::InvalidConfig(
                "Drawdown thresholds should be negative values".to_string()
            ));
        }
        
        if config.caution_threshold < config.critical_threshold {
            return Err(DrawdownError::InvalidConfig(
                "Caution threshold should be greater than critical threshold".to_string()
            ));
        }
        
        if config.caution_exposure_modifier < 0.0 || config.caution_exposure_modifier > 1.0 ||
           config.critical_exposure_modifier < 0.0 || config.critical_exposure_modifier > 1.0 {
            return Err(DrawdownError::InvalidConfig(
                "Exposure modifiers should be between 0.0 and 1.0".to_string()
            ));
        }
        
        // Update config
        let mut cfg = self.config.write().await;
        *cfg = config;
        
        Ok(())
    }
}

/// Mock implementation for testing
pub struct MockDrawdownTracker {
    /// Configuration
    config: DrawdownConfig,
    
    /// In-memory snapshots
    snapshots: RwLock<HashMap<StrategyId, DrawdownSnapshot>>,
    
    /// In-memory states
    states: RwLock<HashMap<StrategyId, DrawdownState>>,
    
    /// In-memory risk modifiers
    risk_modifiers: RwLock<HashMap<StrategyId, f64>>,
    
    /// In-memory history
    history: RwLock<HashMap<StrategyId, Vec<DrawdownSnapshot>>>,
}

impl MockDrawdownTracker {
    /// Create a new MockDrawdownTracker
    pub fn new() -> Self {
        Self {
            config: DrawdownConfig::default(),
            snapshots: RwLock::new(HashMap::new()),
            states: RwLock::new(HashMap::new()),
            risk_modifiers: RwLock::new(HashMap::new()),
            history: RwLock::new(HashMap::new()),
        }
    }
    
    /// Create a new MockDrawdownTracker with custom config
    pub fn with_config(config: DrawdownConfig) -> Self {
        Self {
            config,
            snapshots: RwLock::new(HashMap::new()),
            states: RwLock::new(HashMap::new()),
            risk_modifiers: RwLock::new(HashMap::new()),
            history: RwLock::new(HashMap::new()),
        }
    }
    
    /// Set a mock drawdown state for testing
    pub async fn set_mock_state(&self, strategy_id: StrategyId, state: DrawdownState) {
        let mut states = self.states.write().await;
        states.insert(strategy_id, state);
    }
    
    /// Set a mock risk modifier for testing
    pub async fn set_mock_risk_modifier(&self, strategy_id: StrategyId, modifier: f64) {
        let mut modifiers = self.risk_modifiers.write().await;
        modifiers.insert(strategy_id, modifier);
    }
    
    /// Add a mock snapshot for testing
    pub async fn add_mock_snapshot(&self, snapshot: DrawdownSnapshot) {
        let strategy_id = snapshot.strategy_id.clone();
        
        let mut snapshots = self.snapshots.write().await;
        snapshots.insert(strategy_id.clone(), snapshot.clone());
        
        let mut history = self.history.write().await;
        history.entry(strategy_id).or_insert_with(Vec::new).push(snapshot);
    }
    
    /// Helper to calculate drawdown
    fn calculate_drawdown(&self, current: f64, peak: f64) -> f64 {
        if peak <= 0.0 {
            return 0.0;
        }
        (current - peak) / peak
    }
}

#[async_trait]
impl DrawdownTracker for MockDrawdownTracker {
    async fn update_equity(&self, strategy_id: &StrategyId, current_equity: f64) -> DrawdownResult<DrawdownSnapshot> {
        // Get existing snapshot if any
        let existing = self.snapshots.read().await.get(strategy_id).cloned();
        
        // Calculate max equity
        let max_equity = match &existing {
            Some(snapshot) => snapshot.max_equity.max(current_equity),
            None => current_equity,
        };
        
        // Calculate drawdown
        let drawdown_percent = self.calculate_drawdown(current_equity, max_equity);
        
        // Create new snapshot
        let new_snapshot = DrawdownSnapshot {
            strategy_id: strategy_id.clone(),
            current_equity,
            max_equity,
            drawdown_percent,
            timestamp: Utc::now().timestamp(),
        };
        
        // Determine state based on drawdown
        let new_state = if drawdown_percent <= self.config.critical_threshold {
            DrawdownState::Critical
        } else if drawdown_percent <= self.config.caution_threshold {
            DrawdownState::Caution
        } else {
            DrawdownState::Normal
        };
        
        // Determine risk modifier based on state
        let risk_modifier = match new_state {
            DrawdownState::Normal => 1.0,
            DrawdownState::Caution => self.config.caution_exposure_modifier,
            DrawdownState::Critical => self.config.critical_exposure_modifier,
            DrawdownState::Recovery => {
                // Simplistic recovery calculation for mock
                let progress = 0.5; // 50% progress
                self.config.critical_exposure_modifier + 
                    (1.0 - self.config.critical_exposure_modifier) * progress
            }
        };
        
        // Update in-memory state
        {
            let mut snapshots = self.snapshots.write().await;
            snapshots.insert(strategy_id.clone(), new_snapshot.clone());
            
            let mut states = self.states.write().await;
            states.insert(strategy_id.clone(), new_state);
            
            let mut modifiers = self.risk_modifiers.write().await;
            modifiers.insert(strategy_id.clone(), risk_modifier);
            
            let mut history = self.history.write().await;
            history.entry(strategy_id.clone()).or_insert_with(Vec::new).push(new_snapshot.clone());
        }
        
        Ok(new_snapshot)
    }
    
    async fn get_latest_snapshot(&self, strategy_id: &StrategyId) -> DrawdownResult<DrawdownSnapshot> {
        match self.snapshots.read().await.get(strategy_id) {
            Some(snapshot) => Ok(snapshot.clone()),
            None => Err(DrawdownError::StrategyNotFound(strategy_id.clone())),
        }
    }
    
    async fn get_drawdown_state(&self, strategy_id: &StrategyId) -> DrawdownResult<DrawdownState> {
        match self.states.read().await.get(strategy_id) {
            Some(state) => Ok(*state),
            None => Ok(DrawdownState::Normal), // Default to Normal
        }
    }
    
    async fn get_risk_modifier(&self, strategy_id: &StrategyId) -> DrawdownResult<f64> {
        match self.risk_modifiers.read().await.get(strategy_id) {
            Some(modifier) => Ok(*modifier),
            None => Ok(1.0), // Default to full exposure
        }
    }
    
    async fn get_drawdown_history(
        &self, 
        strategy_id: &StrategyId, 
        limit: Option<usize>
    ) -> DrawdownResult<Vec<DrawdownSnapshot>> {
        let history = self.history.read().await;
        
        match history.get(strategy_id) {
            Some(snapshots) => {
                let mut result = snapshots.clone();
                if let Some(limit_val) = limit {
                    if result.len() > limit_val {
                        result = result.into_iter().rev().take(limit_val).collect::<Vec<_>>();
                        result.reverse(); // Keep chronological order
                    }
                }
                Ok(result)
            },
            None => Ok(Vec::new()), // Return empty vec if no history
        }
    }
    
    async fn reset_drawdown(&self, strategy_id: &StrategyId) -> DrawdownResult<()> {
        // Get current equity if available
        let current_equity = match self.snapshots.read().await.get(strategy_id) {
            Some(snapshot) => snapshot.current_equity,
            None => return Ok(()), // Nothing to reset
        };
        
        // Create reset snapshot
        let reset_snapshot = DrawdownSnapshot {
            strategy_id: strategy_id.clone(),
            current_equity,
            max_equity: current_equity, // Reset peak to current
            drawdown_percent: 0.0,
            timestamp: Utc::now().timestamp(),
        };
        
        // Update in-memory state
        {
            let mut snapshots = self.snapshots.write().await;
            snapshots.insert(strategy_id.clone(), reset_snapshot.clone());
            
            let mut states = self.states.write().await;
            states.insert(strategy_id.clone(), DrawdownState::Normal);
            
            let mut modifiers = self.risk_modifiers.write().await;
            modifiers.insert(strategy_id.clone(), 1.0);
            
            let mut history = self.history.write().await;
            if let Some(hist) = history.get_mut(strategy_id) {
                hist.push(reset_snapshot);
            }
        }
        
        Ok(())
    }
    
    fn get_config(&self) -> &DrawdownConfig {
        &self.config
    }
    
    async fn update_config(&self, _config: DrawdownConfig) -> DrawdownResult<()> {
        // For the mock, we don't actually update the config
        Ok(())
    }
}

/// Factory for creating drawdown trackers
pub struct DrawdownTrackerFactory;

impl DrawdownTrackerFactory {
    /// Create a default drawdown tracker
    pub fn create_default(redis: Arc<dyn RedisClient>) -> Arc<dyn DrawdownTracker> {
        Arc::new(DefaultDrawdownTracker::new(redis))
    }
    
    /// Create a drawdown tracker with custom config
    pub fn create_with_config(redis: Arc<dyn RedisClient>, config: DrawdownConfig) -> Arc<dyn DrawdownTracker> {
        Arc::new(DefaultDrawdownTracker::with_config(redis, config))
    }
    
    /// Create a mock drawdown tracker for testing
    pub fn create_mock() -> Arc<dyn DrawdownTracker> {
        Arc::new(MockDrawdownTracker::new())
    }
    
    /// Create a conservative drawdown tracker
    pub fn create_conservative(redis: Arc<dyn RedisClient>) -> Arc<dyn DrawdownTracker> {
        let config = DrawdownConfig {
            caution_threshold: -0.03,           // 3% drawdown
            critical_threshold: -0.07,          // 7% drawdown
            recovery_threshold: -0.01,          // 1% drawdown from bottom
            caution_exposure_modifier: 0.50,    // 50% exposure
            critical_exposure_modifier: 0.20,   // 20% exposure
            ..DrawdownConfig::default()
        };
        
        Arc::new(DefaultDrawdownTracker::with_config(redis, config))
    }
    
    /// Create an aggressive drawdown tracker
    pub fn create_aggressive(redis: Arc<dyn RedisClient>) -> Arc<dyn DrawdownTracker> {
        let config = DrawdownConfig {
            caution_threshold: -0.10,           // 10% drawdown
            critical_threshold: -0.20,          // 20% drawdown
            recovery_threshold: -0.05,          // 5% drawdown from bottom
            caution_exposure_modifier: 0.90,    // 90% exposure
            critical_exposure_modifier: 0.50,   // 50% exposure
            ..DrawdownConfig::default()
        };
        
        Arc::new(DefaultDrawdownTracker::with_config(redis, config))
    }
}

/// Helper function to create a drawdown tracker with default configuration
pub fn create_drawdown_tracker(redis: Arc<dyn RedisClient>) -> Arc<dyn DrawdownTracker> {
    DrawdownTrackerFactory::create_default(redis)
}

/// Helper function to create a drawdown tracker with custom configuration
pub fn create_drawdown_tracker_with_config(redis: Arc<dyn RedisClient>, config: DrawdownConfig) -> Arc<dyn DrawdownTracker> {
    DrawdownTrackerFactory::create_with_config(redis, config)
}

/// Create a mock drawdown tracker for testing
pub fn create_mock_drawdown_tracker() -> Arc<dyn DrawdownTracker> {
    DrawdownTrackerFactory::create_mock()
} 