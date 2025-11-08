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

pub mod redis_engine;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::execution::{ExecutionResult};
use crate::redis::{RedisClient, RedisClientError, RedisClientResult};
use crate::strategy::{StrategyId};
use crate::telemetry::TelemetryReporter;

/// Standard alpha factors for decomposing strategy returns
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AlphaFactor {
    /// Trend/momentum factor - strategies that profit from continuation
    Momentum,
    /// Mean reversion factor - strategies that profit from reversal
    MeanReversion,
    /// Value factor - strategies that profit from fundamental valuation
    Value,
    /// Volatility factor - strategies that profit from volatility changes
    Volatility,
    /// Sentiment factor - strategies that profit from market sentiment changes
    Sentiment,
    /// Liquidity factor - strategies that profit from liquidity provision
    Liquidity,
    /// Macro factor - strategies that profit from macro economic events
    MacroExposure,
}

impl AlphaFactor {
    /// Get all available factor types
    pub fn all() -> Vec<AlphaFactor> {
        vec![
            AlphaFactor::Momentum,
            AlphaFactor::MeanReversion,
            AlphaFactor::Value,
            AlphaFactor::Volatility,
            AlphaFactor::Sentiment,
            AlphaFactor::Liquidity,
            AlphaFactor::MacroExposure,
        ]
    }
    
    /// Get the string representation of the factor
    pub fn as_str(&self) -> &'static str {
        match self {
            AlphaFactor::Momentum => "Momentum",
            AlphaFactor::MeanReversion => "MeanReversion",
            AlphaFactor::Value => "Value",
            AlphaFactor::Volatility => "Volatility",
            AlphaFactor::Sentiment => "Sentiment",
            AlphaFactor::Liquidity => "Liquidity",
            AlphaFactor::MacroExposure => "MacroExposure",
        }
    }
}

/// Factor exposure for a specific strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactorExposure {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Factor type
    pub factor: AlphaFactor,
    
    /// Beta coefficient (exposure to the factor)
    pub beta: f64,
    
    /// Standard error of the beta coefficient
    pub standard_error: Option<f64>,
    
    /// T-statistic for the beta coefficient
    pub t_stat: Option<f64>,
    
    /// P-value for the beta coefficient
    pub p_value: Option<f64>,
    
    /// Timestamp of the exposure calculation
    pub timestamp: DateTime<Utc>,
}

/// Aggregated factor exposures for a specific strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyFactorProfile {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Map of factor exposures by factor type
    pub exposures: HashMap<AlphaFactor, f64>,
    
    /// R-squared value of the factor model
    pub r_squared: f64,
    
    /// Adjusted R-squared value
    pub adj_r_squared: Option<f64>,
    
    /// Timestamp of the profile calculation
    pub timestamp: DateTime<Utc>,
    
    /// Residual (unexplained return)
    pub residual: f64,
}

impl StrategyFactorProfile {
    /// Create a new strategy factor profile
    pub fn new(strategy_id: String) -> Self {
        Self {
            strategy_id,
            exposures: HashMap::new(),
            r_squared: 0.0,
            adj_r_squared: None,
            timestamp: Utc::now(),
            residual: 0.0,
        }
    }
    
    /// Add a factor exposure
    pub fn add_exposure(&mut self, factor: AlphaFactor, beta: f64) -> &mut Self {
        self.exposures.insert(factor, beta);
        self
    }
    
    /// Set the R-squared value
    pub fn with_r_squared(&mut self, r_squared: f64) -> &mut Self {
        self.r_squared = r_squared;
        self
    }
    
    /// Get the total magnitude of factor exposures
    pub fn total_exposure_magnitude(&self) -> f64 {
        self.exposures.values().map(|v| v.abs()).sum()
    }
    
    /// Get the dominant factor (highest absolute beta)
    pub fn dominant_factor(&self) -> Option<(AlphaFactor, f64)> {
        self.exposures.iter()
            .max_by(|(_, a), (_, b)| a.abs().partial_cmp(&b.abs()).unwrap())
            .map(|(k, v)| (k.clone(), *v))
    }
}

/// Errors that can occur in the factor analysis system
#[derive(Debug, Error)]
pub enum FactorAnalysisError {
    #[error("Redis error: {0}")]
    RedisError(#[from] RedisClientError),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Statistical error: {0}")]
    StatisticalError(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for factor analysis operations
pub type FactorAnalysisResult<T> = Result<T, FactorAnalysisError>;

/// Configuration for factor analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactorAnalysisConfig {
    /// How often to run factor analysis (in seconds)
    pub analysis_interval_sec: u64,
    
    /// Window for calculating factor exposures (in hours)
    pub analysis_window_hours: i64,
    
    /// Minimum number of data points required for regression
    pub min_data_points: usize,
    
    /// Threshold for flagging unexplainable returns (low R-squared)
    pub low_r_squared_threshold: f64,
    
    /// Threshold for significant factor drift detection
    pub factor_drift_threshold: f64,
    
    /// Threshold for overexposure to a single factor
    pub single_factor_overexposure_threshold: f64,
    
    /// Threshold for combined factor exposure magnitude
    pub total_exposure_magnitude_threshold: f64,
    
    /// Whether to enable alerts
    pub enable_alerts: bool,
    
    /// Whether to emit telemetry
    pub emit_telemetry: bool,
}

impl Default for FactorAnalysisConfig {
    fn default() -> Self {
        Self {
            analysis_interval_sec: 3600, // 1 hour
            analysis_window_hours: 24,   // 24 hours (rolling window)
            min_data_points: 10,         // Minimum of 10 data points for regression
            low_r_squared_threshold: 0.5, // R-squared below 0.5 is considered low
            factor_drift_threshold: 0.3,  // 30% drift in 24h is significant
            single_factor_overexposure_threshold: 0.8, // Beta > 0.8 is overexposed
            total_exposure_magnitude_threshold: 2.5,  // Combined exposure > 2.5 is high
            enable_alerts: true,
            emit_telemetry: true,
        }
    }
}

/// Factor regression result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactorRegressionResult {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Regression coefficients (betas)
    pub coefficients: HashMap<AlphaFactor, f64>,
    
    /// Standard errors for coefficients
    pub standard_errors: HashMap<AlphaFactor, f64>,
    
    /// T-statistics for coefficients
    pub t_statistics: HashMap<AlphaFactor, f64>,
    
    /// P-values for coefficients
    pub p_values: HashMap<AlphaFactor, f64>,
    
    /// R-squared value
    pub r_squared: f64,
    
    /// Adjusted R-squared value
    pub adj_r_squared: f64,
    
    /// Residuals series
    pub residuals: Vec<f64>,
    
    /// Mean of residuals
    pub residual_mean: f64,
    
    /// Standard deviation of residuals
    pub residual_std: f64,
    
    /// Timestamp of regression
    pub timestamp: DateTime<Utc>,
}

impl FactorRegressionResult {
    /// Create a new factor regression result
    pub fn new(strategy_id: String) -> Self {
        Self {
            strategy_id,
            coefficients: HashMap::new(),
            standard_errors: HashMap::new(),
            t_statistics: HashMap::new(),
            p_values: HashMap::new(),
            r_squared: 0.0,
            adj_r_squared: 0.0,
            residuals: Vec::new(),
            residual_mean: 0.0,
            residual_std: 0.0,
            timestamp: Utc::now(),
        }
    }
    
    /// Convert to a strategy factor profile
    pub fn to_factor_profile(&self) -> StrategyFactorProfile {
        let mut profile = StrategyFactorProfile::new(self.strategy_id.clone());
        
        for (factor, beta) in &self.coefficients {
            profile.add_exposure(factor.clone(), *beta);
        }
        
        profile.with_r_squared(self.r_squared);
        profile.adj_r_squared = Some(self.adj_r_squared);
        profile.timestamp = self.timestamp;
        profile.residual = self.residual_mean;
        
        profile
    }
}

/// Interface for the factor analysis engine
#[async_trait]
pub trait FactorAnalysisEngine: Send + Sync {
    /// Start the factor analysis engine
    async fn start(&self) -> FactorAnalysisResult<()>;
    
    /// Stop the factor analysis engine
    async fn stop(&self) -> FactorAnalysisResult<()>;
    
    /// Record a return data point for a strategy
    async fn record_return(&self, strategy_id: &StrategyId, 
                          timestamp: DateTime<Utc>, 
                          returns: f64) -> FactorAnalysisResult<()>;
    
    /// Record execution result for a strategy
    async fn record_execution(&self, strategy_id: &StrategyId, 
                             result: &ExecutionResult) -> FactorAnalysisResult<()>;
    
    /// Calculate factor exposures for a strategy
    async fn calculate_factor_exposures(&self, strategy_id: &StrategyId) 
        -> FactorAnalysisResult<StrategyFactorProfile>;
    
    /// Run factor analysis for all strategies
    async fn run_factor_analysis_cycle(&self) -> FactorAnalysisResult<HashMap<StrategyId, StrategyFactorProfile>>;
    
    /// Get the latest factor profile for a strategy
    async fn get_latest_factor_profile(&self, strategy_id: &StrategyId) 
        -> FactorAnalysisResult<StrategyFactorProfile>;
    
    /// Get factor profile history for a strategy
    async fn get_factor_profile_history(&self, strategy_id: &StrategyId, limit: Option<usize>) 
        -> FactorAnalysisResult<Vec<StrategyFactorProfile>>;
    
    /// Check if any factor exposures have drifted significantly
    async fn check_factor_drift(&self, strategy_id: &StrategyId) 
        -> FactorAnalysisResult<HashMap<AlphaFactor, f64>>;
    
    /// Check for factor exposure alerts
    async fn check_factor_alerts(&self, strategy_id: &StrategyId, profile: &StrategyFactorProfile) 
        -> FactorAnalysisResult<Vec<FactorAlert>>;
}

/// Factor alert types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FactorAlertType {
    /// Single factor overexposure
    SingleFactorOverexposure,
    /// Combined factor exposure magnitude too high
    CombinedExposureHigh,
    /// Factor exposure drift
    FactorDrift,
    /// Unexplainable returns (low R-squared)
    UnexplainableReturns,
    /// Sudden residual increase
    ResidualIncrease,
    /// Factor profile shift
    FactorProfileShift,
}

/// Alert for concerning factor patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactorAlert {
    /// Strategy ID
    pub strategy_id: String,
    
    /// Alert type
    pub alert_type: FactorAlertType,
    
    /// Alert message
    pub message: String,
    
    /// Factor involved (if applicable)
    pub factor: Option<AlphaFactor>,
    
    /// Current value
    pub current_value: f64,
    
    /// Threshold value
    pub threshold: f64,
    
    /// Previous value (if applicable)
    pub previous_value: Option<f64>,
    
    /// Timestamp of the alert
    pub timestamp: DateTime<Utc>,
    
    /// Suggested action (if any)
    pub suggested_action: Option<String>,
}

// Factory functions for creating factor analysis engine instances
pub use redis_engine::RedisFactorAnalysisEngine;

/// Create a new factor analysis engine with Redis storage
pub fn create_factor_analysis_engine(
    redis: Arc<dyn RedisClient>,
    telemetry: Arc<TelemetryReporter>,
) -> Arc<dyn FactorAnalysisEngine> {
    Arc::new(redis_engine::RedisFactorAnalysisEngine::new_with_default_config(redis, telemetry))
}

/// Create a new factor analysis engine with Redis storage and custom config
pub fn create_factor_analysis_engine_with_config(
    redis: Arc<dyn RedisClient>,
    telemetry: Arc<TelemetryReporter>,
    config: FactorAnalysisConfig,
) -> Arc<dyn FactorAnalysisEngine> {
    Arc::new(redis_engine::RedisFactorAnalysisEngine::new(redis, telemetry, config))
} 