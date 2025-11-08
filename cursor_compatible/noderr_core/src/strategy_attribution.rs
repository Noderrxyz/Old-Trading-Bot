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
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::execution::{ExecutionLog, ExecutionQualityScore};
use crate::execution_metrics::ExecutionMetricsCollector;
use crate::market_regime::{MarketRegimeDetector, MarketRegime};
use crate::redis::{RedisClient, RedisClientError, RedisClientResult};
use crate::risk::{RiskManager, RiskMetrics};
use crate::strategy::{StrategyId, StrategyPerformance};
use crate::telemetry::TelemetryReporter;

/// Errors that can occur in the strategy attribution system
#[derive(Debug, Error)]
pub enum AttributionError {
    #[error("Redis error: {0}")]
    RedisError(#[from] RedisClientError),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for attribution operations
pub type AttributionResult<T> = Result<T, AttributionError>;

/// Component-level attribution of strategy returns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyAttribution {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Contribution from signal quality (prediction accuracy)
    pub signal_contribution: f64,
    
    /// Contribution from execution efficiency
    pub execution_contribution: f64,
    
    /// Contribution from risk management
    pub risk_contribution: f64,
    
    /// Contribution from market regime alignment
    pub regime_contribution: f64,
    
    /// Total return for the period
    pub total_return: f64,
    
    /// Timestamp of the attribution calculation
    pub timestamp: DateTime<Utc>,
}

impl StrategyAttribution {
    /// Create a new strategy attribution
    pub fn new(strategy_id: String) -> Self {
        Self {
            strategy_id,
            signal_contribution: 0.0,
            execution_contribution: 0.0,
            risk_contribution: 0.0,
            regime_contribution: 0.0,
            total_return: 0.0,
            timestamp: Utc::now(),
        }
    }
    
    /// Normalize contributions to sum to total_return
    pub fn normalize(&mut self) -> &mut Self {
        if self.total_return == 0.0 {
            return self;
        }
        
        let sum = self.signal_contribution + self.execution_contribution + 
                  self.risk_contribution + self.regime_contribution;
        
        if sum != 0.0 {
            let ratio = self.total_return / sum;
            self.signal_contribution *= ratio;
            self.execution_contribution *= ratio;
            self.risk_contribution *= ratio;
            self.regime_contribution *= ratio;
        }
        
        self
    }
}

/// Configuration for the attribution engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributionConfig {
    /// How often to run attribution (in seconds)
    pub attribution_interval_sec: u64,
    
    /// Window for calculating returns (in minutes)
    pub return_window_minutes: i64,
    
    /// Window for calculating signal accuracy (in minutes)
    pub signal_window_minutes: i64,
    
    /// Window for calculating execution quality (in minutes)
    pub execution_window_minutes: i64,
    
    /// Window for calculating risk contribution (in minutes)
    pub risk_window_minutes: i64,
    
    /// Window for calculating regime contribution (in minutes)
    pub regime_window_minutes: i64,
    
    /// Alert threshold for low signal contribution
    pub signal_alert_threshold: f64,
    
    /// Alert threshold for poor execution contribution
    pub execution_alert_threshold: f64,
    
    /// Alert threshold for poor risk contribution
    pub risk_alert_threshold: f64,
    
    /// Alert threshold for poor regime contribution
    pub regime_alert_threshold: f64,
    
    /// Whether to enable alerts
    pub enable_alerts: bool,
    
    /// Whether to emit telemetry
    pub emit_telemetry: bool,
}

impl Default for AttributionConfig {
    fn default() -> Self {
        Self {
            attribution_interval_sec: 300, // 5 minutes
            return_window_minutes: 60,     // 1 hour
            signal_window_minutes: 1440,   // 24 hours
            execution_window_minutes: 1440, // 24 hours
            risk_window_minutes: 1440,     // 24 hours
            regime_window_minutes: 1440,   // 24 hours
            signal_alert_threshold: 0.15,
            execution_alert_threshold: -0.3,
            risk_alert_threshold: 0.2,
            regime_alert_threshold: 0.1,
            enable_alerts: true,
            emit_telemetry: true,
        }
    }
}

/// Trait for component attribution
#[async_trait]
pub trait AttributionEngine: Send + Sync {
    /// Start the attribution engine
    async fn start(&self) -> AttributionResult<()>;
    
    /// Stop the attribution engine
    async fn stop(&self) -> AttributionResult<()>;
    
    /// Calculate attribution for a strategy
    async fn calculate_attribution(&self, strategy_id: &StrategyId) -> AttributionResult<StrategyAttribution>;
    
    /// Run an attribution cycle for all strategies
    async fn run_attribution_cycle(&self) -> AttributionResult<HashMap<StrategyId, StrategyAttribution>>;
    
    /// Get the latest attribution for a strategy
    async fn get_latest_attribution(&self, strategy_id: &StrategyId) -> AttributionResult<StrategyAttribution>;
    
    /// Get attribution history for a strategy
    async fn get_attribution_history(
        &self, 
        strategy_id: &StrategyId,
        limit: Option<usize>
    ) -> AttributionResult<Vec<StrategyAttribution>>;
}

// More detailed implementation will follow in subsequent edits. 