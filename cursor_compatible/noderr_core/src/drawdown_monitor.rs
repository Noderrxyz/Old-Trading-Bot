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
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{RwLock, Mutex};
use tracing::{debug, error, info, warn};

use crate::telemetry::TelemetryEvent;

/// Errors related to drawdown monitoring
#[derive(Debug, Error)]
pub enum DrawdownError {
    #[error("Agent not found: {0}")]
    AgentNotFound(String),
    
    #[error("I/O error: {0}")]
    IOError(#[from] std::io::Error),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

/// Configuration for drawdown monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawdownConfig {
    /// Maximum allowed drawdown percentage (0.0-1.0)
    pub max_drawdown_pct: f64,
    
    /// Alert threshold percentage (0.0-1.0, should be less than max_drawdown)
    pub alert_threshold_pct: f64,
    
    /// Number of data points to keep for drawdown calculation
    pub rolling_window_size: usize,
    
    /// Minimum number of trades required before drawdown tracking starts
    pub min_trades_for_drawdown: usize,
    
    /// Cooldown period after breach in milliseconds
    pub cooldown_period_ms: u64,
    
    /// Log file path for drawdown events
    pub log_file_path: String,
}

impl Default for DrawdownConfig {
    fn default() -> Self {
        Self {
            max_drawdown_pct: 0.10,       // 10% maximum drawdown
            alert_threshold_pct: 0.05,     // 5% alert threshold
            rolling_window_size: 100,      // Keep last 100 data points
            min_trades_for_drawdown: 5,    // Require at least 5 trades
            cooldown_period_ms: 3600000,   // 1 hour cooldown
            log_file_path: "logs/risk/drawdowns.jsonl".to_string(),
        }
    }
}

/// Trade data point for drawdown calculation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeDataPoint {
    /// Timestamp of the trade
    pub timestamp: DateTime<Utc>,
    
    /// Strategy/agent ID
    pub agent_id: String,
    
    /// Symbol traded
    pub symbol: String,
    
    /// Trade amount
    pub amount: f64,
    
    /// Trade price
    pub price: f64,
    
    /// Trade type (buy/sell)
    pub trade_type: TradeType,
    
    /// Current equity after trade
    pub equity: f64,
    
    /// Trade ID
    pub trade_id: String,
    
    /// Profit/loss from this trade
    pub pnl: f64,
}

/// Type of trade
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TradeType {
    /// Buy trade
    Buy,
    
    /// Sell trade
    Sell,
    
    /// Close position
    Close,
}

/// Type of drawdown event
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DrawdownEventType {
    /// Drawdown exceeded alert threshold
    Alert,
    
    /// Drawdown exceeded maximum threshold
    Breach,
    
    /// Drawdown recovered below alert threshold
    Recovery,
}

/// Drawdown state for an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawdownState {
    /// Agent ID
    pub agent_id: String,
    
    /// Whether the agent is active (not in cooldown)
    pub is_active: bool,
    
    /// Current drawdown percentage
    pub current_drawdown_pct: f64,
    
    /// Peak equity reached
    pub peak_equity: f64,
    
    /// Current equity
    pub current_equity: f64,
    
    /// When cooldown ends (if in cooldown)
    pub cooldown_end_time: Option<DateTime<Utc>>,
    
    /// Recent trade history
    #[serde(skip)]
    pub trade_history: Vec<TradeDataPoint>,
}

/// Drawdown event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawdownEvent {
    /// Type of event
    pub event_type: DrawdownEventType,
    
    /// When the event occurred
    pub timestamp: DateTime<Utc>,
    
    /// Agent ID
    pub agent_id: String,
    
    /// Drawdown percentage at time of event
    pub drawdown_pct: f64,
    
    /// Peak equity
    pub peak_equity: f64,
    
    /// Current equity
    pub current_equity: f64,
    
    /// Description of the event
    pub message: String,
}

/// Rolling window of trade data for drawdown calculation
#[derive(Debug, Clone)]
pub struct DrawdownWindow {
    /// Maximum window size
    pub max_size: usize,
    
    /// Data points
    pub data_points: VecDeque<TradeDataPoint>,
    
    /// Peak equity seen in this window
    pub peak_equity: f64,
}

impl DrawdownWindow {
    /// Create a new drawdown window
    pub fn new(max_size: usize) -> Self {
        Self {
            max_size,
            data_points: VecDeque::with_capacity(max_size),
            peak_equity: 0.0,
        }
    }
    
    /// Add a trade data point
    pub fn add_point(&mut self, point: TradeDataPoint) {
        // Update peak equity if needed
        if point.equity > self.peak_equity {
            self.peak_equity = point.equity;
        }
        
        // Add point
        self.data_points.push_back(point);
        
        // Trim to max size
        if self.data_points.len() > self.max_size {
            self.data_points.pop_front();
            
            // Recalculate peak if we removed a peak point
            if self.data_points.iter().all(|p| p.equity < self.peak_equity) {
                self.peak_equity = self.data_points.iter().map(|p| p.equity).fold(0.0, f64::max);
            }
        }
    }
    
    /// Get current drawdown percentage
    pub fn current_drawdown_pct(&self) -> f64 {
        if self.data_points.is_empty() || self.peak_equity == 0.0 {
            return 0.0;
        }
        
        let current_equity = self.data_points.back().map(|p| p.equity).unwrap_or(0.0);
        (self.peak_equity - current_equity) / self.peak_equity
    }
    
    /// Get most recent equity
    pub fn current_equity(&self) -> f64 {
        self.data_points.back().map(|p| p.equity).unwrap_or(0.0)
    }
    
    /// Size of window
    pub fn size(&self) -> usize {
        self.data_points.len()
    }
}

/// Drawdown monitor for detecting and handling drawdowns
pub struct DrawdownMonitor {
    /// Configuration
    config: Arc<RwLock<DrawdownConfig>>,
    
    /// Drawdown states by agent
    drawdown_states: Arc<RwLock<HashMap<String, DrawdownState>>>,
    
    /// Drawdown windows by agent
    trade_windows: Arc<RwLock<HashMap<String, DrawdownWindow>>>,
    
    /// Log file path
    log_file_path: PathBuf,
    
    /// Kill switch for stopping agents
    kill_switch: Arc<dyn KillSwitch>,
    
    /// Telemetry sender (optional)
    telemetry_sender: Option<tokio::sync::mpsc::Sender<TelemetryEvent>>,
}

/// Kill switch trait for stopping agents
#[async_trait::async_trait]
pub trait KillSwitch: Send + Sync {
    /// Trigger the kill switch for an agent
    async fn trigger(&self, agent_id: &str, reason: &str, message: &str) -> bool;
}

impl DrawdownMonitor {
    /// Create a new drawdown monitor
    pub fn new(
        config: DrawdownConfig,
        kill_switch: Arc<dyn KillSwitch>,
    ) -> Self {
        // Ensure log directory exists
        let log_path = PathBuf::from(&config.log_file_path);
        if let Some(parent) = log_path.parent() {
            std::fs::create_dir_all(parent).unwrap_or_else(|e| {
                error!("Failed to create log directory: {}", e);
            });
        }
        
        Self {
            config: Arc::new(RwLock::new(config.clone())),
            drawdown_states: Arc::new(RwLock::new(HashMap::new())),
            trade_windows: Arc::new(RwLock::new(HashMap::new())),
            log_file_path: log_path,
            kill_switch,
            telemetry_sender: None,
        }
    }
    
    /// Set telemetry sender
    pub fn with_telemetry(
        mut self,
        sender: tokio::sync::mpsc::Sender<TelemetryEvent>,
    ) -> Self {
        self.telemetry_sender = Some(sender);
        self
    }
    
    /// Record a trade for drawdown tracking
    pub async fn record_trade(&self, trade: TradeDataPoint) -> Result<(), DrawdownError> {
        let agent_id = trade.agent_id.clone();
        
        // Add trade to window
        {
            let mut windows = self.trade_windows.write().await;
            let config = self.config.read().await;
            
            let window = windows
                .entry(agent_id.clone())
                .or_insert_with(|| DrawdownWindow::new(config.rolling_window_size));
            
            window.add_point(trade.clone());
        }
        
        // Update drawdown state
        self.update_drawdown_state(&agent_id).await?;
        
        Ok(())
    }
    
    /// Update drawdown state for an agent
    async fn update_drawdown_state(&self, agent_id: &str) -> Result<(), DrawdownError> {
        let windows = self.trade_windows.read().await;
        let config = self.config.read().await;
        
        let window = windows.get(agent_id).ok_or_else(|| {
            DrawdownError::AgentNotFound(agent_id.to_string())
        })?;
        
        // Skip if not enough trades
        if window.size() < config.min_trades_for_drawdown {
            return Ok(());
        }
        
        // Calculate drawdown
        let drawdown_pct = window.current_drawdown_pct();
        let current_equity = window.current_equity();
        let peak_equity = window.peak_equity;
        
        // Get or create state
        let mut states = self.drawdown_states.write().await;
        let state = states
            .entry(agent_id.to_string())
            .or_insert_with(|| DrawdownState {
                agent_id: agent_id.to_string(),
                is_active: true,
                current_drawdown_pct: 0.0,
                peak_equity,
                current_equity,
                cooldown_end_time: None,
                trade_history: Vec::new(),
            });
        
        // Update state
        state.current_drawdown_pct = drawdown_pct;
        state.peak_equity = peak_equity;
        state.current_equity = current_equity;
        
        // Check for drawdown events
        self.check_drawdown_events(agent_id, state, drawdown_pct).await;
        
        Ok(())
    }
    
    /// Check for drawdown events
    async fn check_drawdown_events(
        &self,
        agent_id: &str, 
        state: &mut DrawdownState,
        drawdown_pct: f64,
    ) {
        let config = self.config.read().await;
        
        // Check for breach
        if drawdown_pct >= config.max_drawdown_pct && state.is_active {
            self.handle_breach(agent_id, state, drawdown_pct).await;
        }
        // Check for alert
        else if drawdown_pct >= config.alert_threshold_pct && state.is_active {
            self.handle_alert(agent_id, state, drawdown_pct).await;
        }
        // Check for recovery
        else if drawdown_pct < config.alert_threshold_pct && !state.is_active {
            self.handle_recovery(agent_id, state, drawdown_pct).await;
        }
    }
    
    /// Handle drawdown breach
    async fn handle_breach(
        &self,
        agent_id: &str,
        state: &mut DrawdownState,
        drawdown_pct: f64,
    ) {
        state.is_active = false;
        
        let config = self.config.read().await;
        
        // Set cooldown end time
        state.cooldown_end_time = Some(Utc::now() + chrono::Duration::milliseconds(config.cooldown_period_ms as i64));
        
        // Create event
        let event = DrawdownEvent {
            event_type: DrawdownEventType::Breach,
            timestamp: Utc::now(),
            agent_id: agent_id.to_string(),
            drawdown_pct,
            peak_equity: state.peak_equity,
            current_equity: state.current_equity,
            message: format!("Drawdown breach: {:.2}%", drawdown_pct * 100.0),
        };
        
        // Log event
        self.log_event(&event);
        
        // Send telemetry event
        if let Some(sender) = &self.telemetry_sender {
            let telemetry = TelemetryEvent::new(
                "drawdown_breach",
                serde_json::json!({
                    "agent_id": agent_id,
                    "drawdown_pct": drawdown_pct,
                    "peak_equity": state.peak_equity,
                    "current_equity": state.current_equity,
                }),
            );
            
            if let Err(e) = sender.try_send(telemetry) {
                warn!("Failed to send telemetry: {}", e);
            }
        }
        
        // Trigger kill switch
        let kill_switch = &self.kill_switch;
        tokio::spawn(async move {
            kill_switch.trigger(agent_id, "drawdown_breach", &event.message).await;
        });
    }
    
    /// Handle drawdown alert
    async fn handle_alert(
        &self,
        agent_id: &str,
        state: &mut DrawdownState,
        drawdown_pct: f64,
    ) {
        // Create event
        let event = DrawdownEvent {
            event_type: DrawdownEventType::Alert,
            timestamp: Utc::now(),
            agent_id: agent_id.to_string(),
            drawdown_pct,
            peak_equity: state.peak_equity,
            current_equity: state.current_equity,
            message: format!("Drawdown alert: {:.2}%", drawdown_pct * 100.0),
        };
        
        // Log event
        self.log_event(&event);
        
        // Send telemetry event
        if let Some(sender) = &self.telemetry_sender {
            let telemetry = TelemetryEvent::new(
                "drawdown_alert",
                serde_json::json!({
                    "agent_id": agent_id,
                    "drawdown_pct": drawdown_pct,
                    "peak_equity": state.peak_equity,
                    "current_equity": state.current_equity,
                }),
            );
            
            if let Err(e) = sender.try_send(telemetry) {
                warn!("Failed to send telemetry: {}", e);
            }
        }
    }
    
    /// Handle drawdown recovery
    async fn handle_recovery(
        &self,
        agent_id: &str,
        state: &mut DrawdownState,
        drawdown_pct: f64,
    ) {
        state.is_active = true;
        state.cooldown_end_time = None;
        
        // Create event
        let event = DrawdownEvent {
            event_type: DrawdownEventType::Recovery,
            timestamp: Utc::now(),
            agent_id: agent_id.to_string(),
            drawdown_pct,
            peak_equity: state.peak_equity,
            current_equity: state.current_equity,
            message: format!("Drawdown recovery: {:.2}%", drawdown_pct * 100.0),
        };
        
        // Log event
        self.log_event(&event);
        
        // Send telemetry event
        if let Some(sender) = &self.telemetry_sender {
            let telemetry = TelemetryEvent::new(
                "drawdown_recovery",
                serde_json::json!({
                    "agent_id": agent_id,
                    "drawdown_pct": drawdown_pct,
                    "peak_equity": state.peak_equity,
                    "current_equity": state.current_equity,
                }),
            );
            
            if let Err(e) = sender.try_send(telemetry) {
                warn!("Failed to send telemetry: {}", e);
            }
        }
    }
    
    /// Log an event to file
    fn log_event(&self, event: &DrawdownEvent) {
        match serde_json::to_string(event) {
            Ok(log_str) => {
                match OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&self.log_file_path)
                {
                    Ok(mut file) => {
                        if let Err(e) = writeln!(file, "{}", log_str) {
                            error!("Failed to write to log file: {}", e);
                        }
                    }
                    Err(e) => {
                        error!("Failed to open log file: {}", e);
                    }
                }
            }
            Err(e) => {
                error!("Failed to serialize event: {}", e);
            }
        }
        
        // Log to console as well
        warn!("[DrawdownMonitor] {}", event.message);
    }
    
    /// Get current drawdown percentage for an agent
    pub async fn get_current_drawdown(&self, agent_id: &str) -> Result<f64, DrawdownError> {
        let states = self.drawdown_states.read().await;
        
        match states.get(agent_id) {
            Some(state) => Ok(state.current_drawdown_pct),
            None => Err(DrawdownError::AgentNotFound(agent_id.to_string())),
        }
    }
    
    /// Check if an agent is active (not in cooldown)
    pub async fn is_agent_active(&self, agent_id: &str) -> Result<bool, DrawdownError> {
        let states = self.drawdown_states.read().await;
        
        match states.get(agent_id) {
            Some(state) => {
                // If in cooldown, check if cooldown has ended
                if let Some(cooldown_end) = state.cooldown_end_time {
                    if Utc::now() >= cooldown_end {
                        // Cooldown has ended, but state hasn't been updated yet
                        Ok(true)
                    } else {
                        // Still in cooldown
                        Ok(false)
                    }
                } else {
                    // Not in cooldown
                    Ok(state.is_active)
                }
            }
            None => Ok(true), // No recorded state means active by default
        }
    }
    
    /// Update configuration
    pub async fn update_config(&self, config: DrawdownConfig) {
        let mut current_config = self.config.write().await;
        *current_config = config;
    }
    
    /// Get all drawdown states
    pub async fn get_all_states(&self) -> HashMap<String, DrawdownState> {
        let states = self.drawdown_states.read().await;
        states.clone()
    }
    
    /// Reset state for an agent
    pub async fn reset_agent(&self, agent_id: &str) -> Result<(), DrawdownError> {
        // Remove drawdown state
        {
            let mut states = self.drawdown_states.write().await;
            states.remove(agent_id);
        }
        
        // Remove trade window
        {
            let mut windows = self.trade_windows.write().await;
            windows.remove(agent_id);
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    
    struct MockKillSwitch;
    
    #[async_trait::async_trait]
    impl KillSwitch for MockKillSwitch {
        async fn trigger(&self, agent_id: &str, reason: &str, message: &str) -> bool {
            println!("MOCK KILL SWITCH: Agent: {}, Reason: {}, Message: {}", agent_id, reason, message);
            true
        }
    }
    
    fn create_test_trade(agent_id: &str, equity: f64) -> TradeDataPoint {
        TradeDataPoint {
            timestamp: Utc::now(),
            agent_id: agent_id.to_string(),
            symbol: "BTC-USD".to_string(),
            amount: 1.0,
            price: 50000.0,
            trade_type: TradeType::Buy,
            equity,
            trade_id: Uuid::new_v4().to_string(),
            pnl: 0.0,
        }
    }
    
    #[tokio::test]
    async fn test_drawdown_calculation() {
        let config = DrawdownConfig {
            max_drawdown_pct: 0.10,
            alert_threshold_pct: 0.05,
            min_trades_for_drawdown: 2,
            enable_logging: false,
            ..Default::default()
        };
        
        let monitor = DrawdownMonitor::new(
            config,
            Arc::new(MockKillSwitch),
        );
        
        // Record initial trade
        let trade1 = create_test_trade("test_agent", 10000.0);
        monitor.record_trade(trade1).await.unwrap();
        
        // Record trade with small drawdown
        let trade2 = create_test_trade("test_agent", 9800.0);
        monitor.record_trade(trade2).await.unwrap();
        
        // Check drawdown
        let drawdown = monitor.get_current_drawdown("test_agent").await.unwrap();
        assert!((drawdown - 0.02).abs() < 0.001);
        
        // Check agent is active
        let active = monitor.is_agent_active("test_agent").await.unwrap();
        assert!(active);
        
        // Record trade with alert-level drawdown
        let trade3 = create_test_trade("test_agent", 9500.0);
        monitor.record_trade(trade3).await.unwrap();
        
        // Check drawdown
        let drawdown = monitor.get_current_drawdown("test_agent").await.unwrap();
        assert!((drawdown - 0.05).abs() < 0.001);
        
        // Check agent is still active
        let active = monitor.is_agent_active("test_agent").await.unwrap();
        assert!(active);
        
        // Record trade with breach-level drawdown
        let trade4 = create_test_trade("test_agent", 8900.0);
        monitor.record_trade(trade4).await.unwrap();
        
        // Check drawdown
        let drawdown = monitor.get_current_drawdown("test_agent").await.unwrap();
        assert!((drawdown - 0.11).abs() < 0.001);
        
        // Check agent is now inactive
        let active = monitor.is_agent_active("test_agent").await.unwrap();
        assert!(!active);
        
        // Record trade with recovery
        let trade5 = create_test_trade("test_agent", 9900.0);
        monitor.record_trade(trade5).await.unwrap();
        
        // Check drawdown
        let drawdown = monitor.get_current_drawdown("test_agent").await.unwrap();
        assert!((drawdown - 0.01).abs() < 0.001);
        
        // Check agent is active again
        let active = monitor.is_agent_active("test_agent").await.unwrap();
        assert!(active);
    }
} 