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
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::market::MarketData;
use crate::market::Symbol;

/// Error types for market regime operations
#[derive(Debug, Error)]
pub enum MarketRegimeError {
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for market regime operations
pub type MarketRegimeResult<T> = Result<T, MarketRegimeError>;

/// Different market regime states
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MarketRegimeState {
    /// Bullish trend with positive momentum
    Bull,
    
    /// Bearish trend with negative momentum
    Bear,
    
    /// Sideways/ranging market with no clear direction
    Sideways,
    
    /// High volatility/uncertain market
    Volatile,
    
    /// Unknown state (insufficient data)
    Unknown,
}

impl std::fmt::Display for MarketRegimeState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MarketRegimeState::Bull => write!(f, "BULL"),
            MarketRegimeState::Bear => write!(f, "BEAR"),
            MarketRegimeState::Sideways => write!(f, "SIDEWAYS"),
            MarketRegimeState::Volatile => write!(f, "VOLATILE"),
            MarketRegimeState::Unknown => write!(f, "UNKNOWN"),
        }
    }
}

impl Default for MarketRegimeState {
    fn default() -> Self {
        MarketRegimeState::Unknown
    }
}

/// Market regime classification for an asset
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRegime {
    /// Symbol this regime applies to
    pub symbol: Symbol,
    
    /// Current regime state
    pub state: MarketRegimeState,
    
    /// Confidence in the regime classification (0.0-1.0)
    pub confidence: f64,
    
    /// When this regime was detected
    pub timestamp: DateTime<Utc>,
    
    /// Metrics used to determine the regime
    pub metrics: HashMap<String, f64>,
    
    /// Previous regime state
    pub previous_state: Option<MarketRegimeState>,
    
    /// How long the current regime has been active (in days)
    pub duration_days: f64,
}

impl MarketRegime {
    /// Create a new market regime instance
    pub fn new(symbol: Symbol, state: MarketRegimeState, confidence: f64) -> Self {
        Self {
            symbol,
            state,
            confidence,
            timestamp: Utc::now(),
            metrics: HashMap::new(),
            previous_state: None,
            duration_days: 0.0,
        }
    }
    
    /// Add a metric used in regime detection
    pub fn with_metric(mut self, name: &str, value: f64) -> Self {
        self.metrics.insert(name.to_string(), value);
        self
    }
    
    /// Set previous state
    pub fn with_previous_state(mut self, previous: MarketRegimeState) -> Self {
        self.previous_state = Some(previous);
        self
    }
    
    /// Set duration
    pub fn with_duration_days(mut self, days: f64) -> Self {
        self.duration_days = days;
        self
    }
    
    /// Check if this is a regime change from previous state
    pub fn is_regime_change(&self) -> bool {
        self.previous_state.map_or(false, |prev| prev != self.state)
    }
}

/// Configuration for market regime detection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRegimeConfig {
    /// Trend strength threshold for bull market
    pub bull_trend_threshold: f64,
    
    /// Trend strength threshold for bear market (negative)
    pub bear_trend_threshold: f64,
    
    /// Volatility threshold for volatile regime
    pub volatility_threshold: f64,
    
    /// Lookback period for trend calculation (in days)
    pub trend_lookback_days: u32,
    
    /// Smoothing factor for regime transitions (0.0-1.0)
    /// Higher values mean faster transitions
    pub regime_transition_smoothing: f64,
    
    /// How often to update regime detection (in seconds)
    pub update_interval_sec: u64,
}

impl Default for MarketRegimeConfig {
    fn default() -> Self {
        Self {
            bull_trend_threshold: 0.5,
            bear_trend_threshold: -0.5,
            volatility_threshold: 0.4,
            trend_lookback_days: 30,
            regime_transition_smoothing: 0.3,
            update_interval_sec: 3600, // 1 hour
        }
    }
}

/// Definition of market regime metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRegimeMetrics {
    /// Trend strength (-1.0 to 1.0)
    pub trend_strength: f64,
    
    /// Volatility (0.0-1.0)
    pub volatility: f64,
    
    /// Market momentum (-1.0 to 1.0)
    pub momentum: f64,
    
    /// Market liquidity (0.0-1.0)
    pub liquidity: f64,
}

/// Trait for systems that can detect market regimes
#[async_trait]
pub trait MarketRegimeDetector: Send + Sync {
    /// Detect the current market regime for a specific symbol
    async fn detect_regime(&self, symbol: &Symbol) -> MarketRegimeResult<MarketRegime>;
    
    /// Get the latest detected regime for a symbol
    async fn get_current_regime(&self, symbol: &Symbol) -> Option<MarketRegime>;
    
    /// Get all current market regimes
    async fn get_all_regimes(&self) -> HashMap<Symbol, MarketRegime>;
    
    /// Process market data and update regime detection
    async fn process_market_data(&self, market_data: &MarketData) -> MarketRegimeResult<()>;
    
    /// Initialize the detector
    async fn initialize(&self) -> MarketRegimeResult<()>;
}

/// Default implementation of market regime detector
pub struct DefaultMarketRegimeDetector {
    /// Configuration
    config: MarketRegimeConfig,
    
    /// Current regimes by symbol
    regimes: Arc<RwLock<HashMap<Symbol, MarketRegime>>>,
    
    /// Price history for trend analysis
    price_history: Arc<RwLock<HashMap<Symbol, Vec<(DateTime<Utc>, f64)>>>>,
    
    /// Last update time
    last_update: Arc<RwLock<Instant>>,
}

impl DefaultMarketRegimeDetector {
    /// Create a new DefaultMarketRegimeDetector
    pub fn new(config: MarketRegimeConfig) -> Self {
        Self {
            config,
            regimes: Arc::new(RwLock::new(HashMap::new())),
            price_history: Arc::new(RwLock::new(HashMap::new())),
            last_update: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(3600))), // Force immediate update
        }
    }
    
    /// Create with default configuration
    pub fn default() -> Self {
        Self::new(MarketRegimeConfig::default())
    }
    
    /// Calculate trend strength from price history
    async fn calculate_trend_strength(&self, symbol: &Symbol) -> MarketRegimeResult<f64> {
        let price_history = self.price_history.read().await;
        
        if let Some(history) = price_history.get(symbol) {
            if history.len() < 10 {
                return Err(MarketRegimeError::InsufficientData(
                    format!("Not enough price data for {}", symbol)
                ));
            }
            
            // Calculate linear regression slope
            let n = history.len() as f64;
            let mut sum_x = 0.0;
            let mut sum_y = 0.0;
            let mut sum_xy = 0.0;
            let mut sum_xx = 0.0;
            
            for (i, (_, price)) in history.iter().enumerate() {
                let x = i as f64;
                let y = *price;
                
                sum_x += x;
                sum_y += y;
                sum_xy += x * y;
                sum_xx += x * x;
            }
            
            let slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
            
            // Normalize slope to -1.0 to 1.0 range
            // First price in history
            let first_price = history.first().unwrap().1;
            let slope_normalized = slope * n / first_price;
            
            // Clamp between -1 and 1
            Ok(slope_normalized.max(-1.0).min(1.0))
        } else {
            Err(MarketRegimeError::InsufficientData(
                format!("No price history for {}", symbol)
            ))
        }
    }
    
    /// Calculate volatility from price history
    async fn calculate_volatility(&self, symbol: &Symbol) -> MarketRegimeResult<f64> {
        let price_history = self.price_history.read().await;
        
        if let Some(history) = price_history.get(symbol) {
            if history.len() < 10 {
                return Err(MarketRegimeError::InsufficientData(
                    format!("Not enough price data for {}", symbol)
                ));
            }
            
            // Calculate returns
            let mut returns = Vec::with_capacity(history.len() - 1);
            for i in 1..history.len() {
                let prev_price = history[i-1].1;
                let curr_price = history[i].1;
                returns.push((curr_price - prev_price) / prev_price);
            }
            
            // Calculate standard deviation
            let mean = returns.iter().sum::<f64>() / returns.len() as f64;
            let variance = returns.iter()
                .map(|r| (r - mean).powi(2))
                .sum::<f64>() / returns.len() as f64;
            
            let std_dev = variance.sqrt();
            
            // Normalize to 0.0-1.0 range (assuming max reasonable volatility is 0.05)
            let normalized = (std_dev / 0.05).min(1.0);
            
            Ok(normalized)
        } else {
            Err(MarketRegimeError::InsufficientData(
                format!("No price history for {}", symbol)
            ))
        }
    }
    
    /// Detect regime for a symbol
    async fn detect_regime_internal(&self, symbol: &Symbol) -> MarketRegimeResult<MarketRegime> {
        // Calculate trend and volatility
        let trend_strength = self.calculate_trend_strength(symbol).await?;
        let volatility = self.calculate_volatility(symbol).await?;
        
        // Determine regime
        let state = if volatility > self.config.volatility_threshold {
            MarketRegimeState::Volatile
        } else if trend_strength > self.config.bull_trend_threshold {
            MarketRegimeState::Bull
        } else if trend_strength < self.config.bear_trend_threshold {
            MarketRegimeState::Bear
        } else {
            MarketRegimeState::Sideways
        };
        
        // Calculate confidence based on how far we are from thresholds
        let confidence = match state {
            MarketRegimeState::Bull => {
                (trend_strength - self.config.bull_trend_threshold) / (1.0 - self.config.bull_trend_threshold)
            },
            MarketRegimeState::Bear => {
                (self.config.bear_trend_threshold - trend_strength) / (self.config.bear_trend_threshold + 1.0)
            },
            MarketRegimeState::Volatile => {
                (volatility - self.config.volatility_threshold) / (1.0 - self.config.volatility_threshold)
            },
            _ => 0.5, // Default confidence for sideways/unknown
        }.max(0.2).min(0.95); // Keep confidence between 20% and 95%
        
        // Get previous regime if any
        let previous_state = self.regimes.read().await
            .get(symbol)
            .map(|r| r.state);
        
        // Calculate duration
        let duration_days = self.regimes.read().await
            .get(symbol)
            .filter(|r| r.state == state)
            .map(|r| {
                let now = Utc::now();
                let duration = now.signed_duration_since(r.timestamp);
                duration.num_seconds() as f64 / 86400.0 // Convert to days
            })
            .unwrap_or(0.0);
        
        // Create new regime
        let regime = MarketRegime::new(symbol.clone(), state, confidence)
            .with_metric("trend_strength", trend_strength)
            .with_metric("volatility", volatility)
            .with_previous_state(previous_state.unwrap_or(MarketRegimeState::Unknown))
            .with_duration_days(duration_days);
        
        Ok(regime)
    }
    
    /// Update price history with new data
    async fn update_price_history(&self, symbol: &Symbol, timestamp: DateTime<Utc>, price: f64) -> MarketRegimeResult<()> {
        let mut price_history = self.price_history.write().await;
        
        // Get or create history
        let history = price_history.entry(symbol.clone()).or_insert_with(Vec::new);
        
        // Add new data point
        history.push((timestamp, price));
        
        // Keep only data within lookback period
        let lookback = chrono::Duration::days(self.config.trend_lookback_days as i64);
        let cutoff = Utc::now() - lookback;
        
        history.retain(|(ts, _)| *ts >= cutoff);
        
        Ok(())
    }
}

#[async_trait]
impl MarketRegimeDetector for DefaultMarketRegimeDetector {
    async fn initialize(&self) -> MarketRegimeResult<()> {
        // Nothing to initialize for now
        Ok(())
    }
    
    async fn detect_regime(&self, symbol: &Symbol) -> MarketRegimeResult<MarketRegime> {
        self.detect_regime_internal(symbol).await
    }
    
    async fn get_current_regime(&self, symbol: &Symbol) -> Option<MarketRegime> {
        self.regimes.read().await.get(symbol).cloned()
    }
    
    async fn get_all_regimes(&self) -> HashMap<Symbol, MarketRegime> {
        self.regimes.read().await.clone()
    }
    
    async fn process_market_data(&self, market_data: &MarketData) -> MarketRegimeResult<()> {
        // Update price history
        self.update_price_history(
            &market_data.symbol, 
            market_data.timestamp, 
            market_data.price
        ).await?;
        
        // Check if we need to update regime detection
        let should_update = {
            let last_update = self.last_update.read().await;
            last_update.elapsed() >= Duration::from_secs(self.config.update_interval_sec)
        };
        
        if should_update {
            // Detect regime
            let regime = self.detect_regime_internal(&market_data.symbol).await?;
            
            // Update state
            {
                let mut regimes = self.regimes.write().await;
                regimes.insert(market_data.symbol.clone(), regime.clone());
            }
            
            // Update last update time
            {
                let mut last_update = self.last_update.write().await;
                *last_update = Instant::now();
            }
            
            // Log regime detection
            if regime.is_regime_change() {
                info!(
                    "Market regime change for {}: {} -> {} (confidence: {:.2})",
                    regime.symbol,
                    regime.previous_state.unwrap_or(MarketRegimeState::Unknown),
                    regime.state,
                    regime.confidence
                );
            } else {
                debug!(
                    "Market regime for {}: {} (confidence: {:.2}, duration: {:.1} days)",
                    regime.symbol,
                    regime.state,
                    regime.confidence,
                    regime.duration_days
                );
            }
        }
        
        Ok(())
    }
}

/// Factory for creating market regime detectors
pub struct MarketRegimeDetectorFactory;

impl MarketRegimeDetectorFactory {
    /// Create detector with default configuration
    pub fn create_default() -> Arc<dyn MarketRegimeDetector> {
        Arc::new(DefaultMarketRegimeDetector::default())
    }
    
    /// Create detector with custom configuration
    pub fn create_custom(config: MarketRegimeConfig) -> Arc<dyn MarketRegimeDetector> {
        Arc::new(DefaultMarketRegimeDetector::new(config))
    }
}

/// Helper function to create a default market regime detector
pub fn create_market_regime_detector() -> Arc<dyn MarketRegimeDetector> {
    MarketRegimeDetectorFactory::create_default()
}

/// Helper function to create a custom market regime detector
pub fn create_market_regime_detector_with_config(config: MarketRegimeConfig) -> Arc<dyn MarketRegimeDetector> {
    MarketRegimeDetectorFactory::create_custom(config)
} 