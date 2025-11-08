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
use tokio::sync::{mpsc, RwLock};
use tokio::time;
use tracing::{debug, error, info, warn};

use crate::market::{MarketData, Symbol};
use crate::market_regime::{MarketRegimeError, MarketRegimeResult, MarketRegimeState, MarketRegime, MarketRegimeDetector};
use crate::redis::{RedisClient, RedisClientError, RedisClientResult};
use crate::telemetry::TelemetryReporter;
use crate::market_regime::leading_indicators::{
    LeadingIndicator, IndicatorDirection, RegimeWarning, IndicatorConfig,
    RegimeForecast, StrategyPrepSignal
};

/// Errors that can occur in the regime warning engine
#[derive(Debug, Error)]
pub enum RegimeWarningError {
    #[error("Redis error: {0}")]
    RedisError(#[from] RedisClientError),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for regime warning operations
pub type RegimeWarningResult<T> = Result<T, RegimeWarningError>;

/// Configuration for the regime warning engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegimeWarningConfig {
    /// How often to check for warnings (in seconds)
    pub check_interval_sec: u64,
    
    /// How long warnings are valid (in seconds)
    pub warning_ttl_sec: u64,
    
    /// Indicator-specific configurations
    pub indicators: HashMap<LeadingIndicator, IndicatorConfig>,
    
    /// Minimum confidence for a forecast to be published
    pub min_forecast_confidence: f64,
    
    /// Whether to enable strategy preparation signals
    pub enable_strategy_prep: bool,
    
    /// Whether to enable WebSocket broadcasting
    pub enable_websocket: bool,
    
    /// Whether to store warnings and forecasts in time series database
    pub store_to_timeseries: bool,
}

impl Default for RegimeWarningConfig {
    fn default() -> Self {
        let mut indicators = HashMap::new();
        
        // Set default configs for each indicator
        indicators.insert(LeadingIndicator::VolatilitySpike, IndicatorConfig {
            threshold: 2.5,         // 2.5 standard deviations
            cooldown_sec: 300,      // 5 minutes
            decay_sec: 1800,        // 30 minutes
            enabled: true,
            min_confidence: 0.7,
        });
        
        indicators.insert(LeadingIndicator::MomentumReversal, IndicatorConfig {
            threshold: 2.0,         // 2 standard deviations
            cooldown_sec: 600,      // 10 minutes
            decay_sec: 3600,        // 1 hour
            enabled: true,
            min_confidence: 0.65,
        });
        
        indicators.insert(LeadingIndicator::VolumeAnomaly, IndicatorConfig {
            threshold: 3.0,         // 3 standard deviations
            cooldown_sec: 300,      // 5 minutes
            decay_sec: 1800,        // 30 minutes
            enabled: true,
            min_confidence: 0.75,
        });
        
        indicators.insert(LeadingIndicator::SocialSentiment, IndicatorConfig {
            threshold: 2.0,         // 2 standard deviations
            cooldown_sec: 1800,     // 30 minutes
            decay_sec: 7200,        // 2 hours
            enabled: true,
            min_confidence: 0.6,
        });
        
        indicators.insert(LeadingIndicator::OrderBookSkew, IndicatorConfig {
            threshold: 2.5,         // 2.5 standard deviations
            cooldown_sec: 120,      // 2 minutes
            decay_sec: 600,         // 10 minutes
            enabled: true,
            min_confidence: 0.8,
        });
        
        Self {
            check_interval_sec: 30,      // Check every 30 seconds
            warning_ttl_sec: 3600,       // Warnings valid for 1 hour
            indicators,
            min_forecast_confidence: 0.7, // 70% confidence
            enable_strategy_prep: true,
            enable_websocket: true,
            store_to_timeseries: true,
        }
    }
}

/// The main RegimeWarningEngine that monitors leading indicators for regime shifts
pub struct RegimeWarningEngine {
    /// Configuration
    config: RegimeWarningConfig,
    
    /// Last trigger time for each indicator and symbol
    last_trigger: Arc<RwLock<HashMap<(Symbol, LeadingIndicator), DateTime<Utc>>>>,
    
    /// Current active warnings
    active_warnings: Arc<RwLock<HashMap<(Symbol, LeadingIndicator), RegimeWarning>>>,
    
    /// Current regime forecasts
    forecasts: Arc<RwLock<HashMap<Symbol, RegimeForecast>>>,
    
    /// Market regime detector for current regime information
    regime_detector: Arc<dyn MarketRegimeDetector>,
    
    /// Redis client for publishing warnings and forecasts
    redis_client: Option<Arc<dyn RedisClient>>,
    
    /// Telemetry reporter
    telemetry: Arc<TelemetryReporter>,
    
    /// Stop channel for the monitor loop
    stop_tx: Option<mpsc::Sender<()>>,
}

impl RegimeWarningEngine {
    /// Create a new RegimeWarningEngine
    pub fn new(
        config: RegimeWarningConfig,
        regime_detector: Arc<dyn MarketRegimeDetector>,
        redis_client: Option<Arc<dyn RedisClient>>,
        telemetry: Arc<TelemetryReporter>,
    ) -> Self {
        Self {
            config,
            last_trigger: Arc::new(RwLock::new(HashMap::new())),
            active_warnings: Arc::new(RwLock::new(HashMap::new())),
            forecasts: Arc::new(RwLock::new(HashMap::new())),
            regime_detector,
            redis_client,
            telemetry,
            stop_tx: None,
        }
    }
    
    /// Create with default configuration
    pub fn default(
        regime_detector: Arc<dyn MarketRegimeDetector>,
        redis_client: Option<Arc<dyn RedisClient>>,
        telemetry: Arc<TelemetryReporter>,
    ) -> Self {
        Self::new(
            RegimeWarningConfig::default(),
            regime_detector,
            redis_client,
            telemetry,
        )
    }
    
    /// Start the warning engine monitor loop
    pub async fn start(&mut self) -> RegimeWarningResult<()> {
        if self.stop_tx.is_some() {
            return Err(RegimeWarningError::Internal(
                "Warning engine already started".to_string()
            ));
        }
        
        let (stop_tx, mut stop_rx) = mpsc::channel(1);
        self.stop_tx = Some(stop_tx);
        
        let config = self.config.clone();
        let last_trigger = self.last_trigger.clone();
        let active_warnings = self.active_warnings.clone();
        let forecasts = self.forecasts.clone();
        let regime_detector = self.regime_detector.clone();
        let redis_client = self.redis_client.clone();
        let telemetry = self.telemetry.clone();
        
        // Start the monitoring loop
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(config.check_interval_sec));
            
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Run the warning check cycle
                        match Self::run_check_cycle(
                            &config,
                            &last_trigger,
                            &active_warnings, 
                            &forecasts,
                            &regime_detector,
                            &redis_client,
                            &telemetry
                        ).await {
                            Ok(_) => {
                                debug!("Completed regime warning check cycle");
                            }
                            Err(e) => {
                                error!("Error in regime warning check cycle: {}", e);
                            }
                        }
                    }
                    _ = stop_rx.recv() => {
                        info!("Stopping regime warning engine monitor loop");
                        break;
                    }
                }
            }
        });
        
        info!("Started regime warning engine monitor loop");
        Ok(())
    }
    
    /// Stop the warning engine monitor loop
    pub async fn stop(&mut self) -> RegimeWarningResult<()> {
        if let Some(stop_tx) = self.stop_tx.take() {
            if let Err(e) = stop_tx.send(()).await {
                return Err(RegimeWarningError::Internal(
                    format!("Failed to send stop signal: {}", e)
                ));
            }
            
            info!("Stopped regime warning engine monitor loop");
            Ok(())
        } else {
            Err(RegimeWarningError::Internal(
                "Warning engine not started".to_string()
            ))
        }
    }
    
    /// Get all active warnings
    pub async fn get_active_warnings(&self) -> Vec<RegimeWarning> {
        let active_warnings = self.active_warnings.read().await;
        active_warnings.values().cloned().collect()
    }
    
    /// Get active warnings for a specific symbol
    pub async fn get_symbol_warnings(&self, symbol: &Symbol) -> Vec<RegimeWarning> {
        let active_warnings = self.active_warnings.read().await;
        active_warnings
            .iter()
            .filter(|((s, _), _)| s == symbol)
            .map(|(_, warning)| warning.clone())
            .collect()
    }
    
    /// Get the current regime forecast for a symbol
    pub async fn get_regime_forecast(&self, symbol: &Symbol) -> Option<RegimeForecast> {
        let forecasts = self.forecasts.read().await;
        forecasts.get(symbol).cloned()
    }
    
    /// Get all current regime forecasts
    pub async fn get_all_forecasts(&self) -> HashMap<Symbol, RegimeForecast> {
        let forecasts = self.forecasts.read().await;
        forecasts.clone()
    }
    
    /// Process new market data and check for warnings
    pub async fn process_market_data(&self, market_data: &MarketData) -> RegimeWarningResult<()> {
        let symbol = market_data.symbol.clone();
        
        // Check all indicators for this symbol
        let mut warnings = Vec::new();
        
        // 1. Check for volatility spike
        if let Some(config) = self.config.indicators.get(&LeadingIndicator::VolatilitySpike) {
            if config.enabled {
                if let Some(warning) = self.check_volatility_spike(market_data, config).await? {
                    warnings.push(warning);
                }
            }
        }
        
        // 2. Check for momentum reversal
        if let Some(config) = self.config.indicators.get(&LeadingIndicator::MomentumReversal) {
            if config.enabled {
                if let Some(warning) = self.check_momentum_reversal(market_data, config).await? {
                    warnings.push(warning);
                }
            }
        }
        
        // 3. Check for volume anomaly
        if let Some(config) = self.config.indicators.get(&LeadingIndicator::VolumeAnomaly) {
            if config.enabled {
                if let Some(warning) = self.check_volume_anomaly(market_data, config).await? {
                    warnings.push(warning);
                }
            }
        }
        
        // 4. Check for order book skew (if available)
        if let Some(config) = self.config.indicators.get(&LeadingIndicator::OrderBookSkew) {
            if config.enabled {
                if let Some(warning) = self.check_order_book_skew(market_data, config).await? {
                    warnings.push(warning);
                }
            }
        }
        
        // Process any new warnings
        for warning in warnings {
            self.process_warning(&warning).await?;
        }
        
        // Update regime forecasts based on active warnings
        self.update_regime_forecast(&symbol).await?;
        
        Ok(())
    }
    
    /// Run a complete check cycle across all symbols
    async fn run_check_cycle(
        config: &RegimeWarningConfig,
        last_trigger: &RwLock<HashMap<(Symbol, LeadingIndicator), DateTime<Utc>>>,
        active_warnings: &RwLock<HashMap<(Symbol, LeadingIndicator), RegimeWarning>>,
        forecasts: &RwLock<HashMap<Symbol, RegimeForecast>>,
        regime_detector: &Arc<dyn MarketRegimeDetector>,
        redis_client: &Option<Arc<dyn RedisClient>>,
        telemetry: &Arc<TelemetryReporter>,
    ) -> RegimeWarningResult<()> {
        // 1. Clean up expired warnings
        Self::clean_expired_warnings(active_warnings).await;
        
        // 2. Check for social sentiment warnings (these can be checked independently)
        // TODO: Implement social sentiment check when the API is available
        
        // 3. Update forecasts for all symbols that have active warnings
        let symbols = {
            let warnings = active_warnings.read().await;
            warnings.keys()
                .map(|(symbol, _)| symbol.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
        };
        
        for symbol in symbols {
            Self::update_regime_forecast_internal(
                &symbol,
                active_warnings,
                forecasts,
                regime_detector,
                config,
                redis_client,
                telemetry
            ).await?;
        }
        
        // 4. Generate strategy prep signals for forecasts
        if config.enable_strategy_prep {
            Self::generate_strategy_prep_signals(
                forecasts,
                config,
                redis_client,
                telemetry
            ).await?;
        }
        
        Ok(())
    }
    
    /// Check for volatility spike
    async fn check_volatility_spike(
        &self,
        market_data: &MarketData,
        config: &IndicatorConfig,
    ) -> RegimeWarningResult<Option<RegimeWarning>> {
        let symbol = &market_data.symbol;
        
        // Check if we're in cooldown period
        if !self.can_trigger_warning(symbol, LeadingIndicator::VolatilitySpike).await {
            return Ok(None);
        }
        
        // Get historical volatility from indicators
        let realized_vol = market_data.indicators.volatility.get("realized_volatility")
            .or_else(|| market_data.indicators.volatility.get("historical_volatility"))
            .copied()
            .unwrap_or(0.0);
        
        // Get long-term average volatility (if available)
        let avg_vol = market_data.indicators.volatility.get("average_volatility")
            .copied()
            .unwrap_or(realized_vol / 2.0); // Fallback if not available
        
        if avg_vol <= 0.0 {
            return Ok(None); // Avoid division by zero
        }
        
        // Calculate z-score (how many standard deviations from mean)
        let vol_z_score = (realized_vol - avg_vol) / avg_vol;
        
        // Check if volatility exceeds threshold
        if vol_z_score > config.threshold {
            let confidence = (vol_z_score - config.threshold) / (config.threshold * 0.5);
            let confidence = confidence.min(0.95); // Cap at 0.95
            
            if confidence >= config.min_confidence {
                // Determine the likely regime direction
                let direction = IndicatorDirection::Volatile;
                
                let mut warning = RegimeWarning::new(
                    LeadingIndicator::VolatilitySpike,
                    symbol,
                    realized_vol,
                    config.threshold,
                    confidence,
                    direction,
                );
                
                // Add metadata
                let metadata = serde_json::json!({
                    "realized_volatility": realized_vol,
                    "average_volatility": avg_vol,
                    "z_score": vol_z_score,
                });
                
                warning.with_metadata(metadata);
                
                return Ok(Some(warning));
            }
        }
        
        Ok(None)
    }
    
    /// Check for momentum reversal
    async fn check_momentum_reversal(
        &self,
        market_data: &MarketData,
        config: &IndicatorConfig,
    ) -> RegimeWarningResult<Option<RegimeWarning>> {
        let symbol = &market_data.symbol;
        
        // Check if we're in cooldown period
        if !self.can_trigger_warning(symbol, LeadingIndicator::MomentumReversal).await {
            return Ok(None);
        }
        
        // Look for trend divergence signals
        // 1. Check MACD divergence
        let macd = market_data.indicators.trend.get("macd").copied().unwrap_or(0.0);
        let macd_signal = market_data.indicators.trend.get("macd_signal").copied().unwrap_or(0.0);
        let macd_histogram = market_data.indicators.trend.get("macd_histogram").copied().unwrap_or(0.0);
        
        // 2. Check RSI
        let rsi = market_data.indicators.momentum.get("rsi_14").copied().unwrap_or(50.0);
        
        // 3. Check Trend Oscillator (if available)
        let trend_oscillator = market_data.indicators.trend.get("trend_oscillator").copied().unwrap_or(0.0);
        
        // Calculate a composite divergence score
        let mut divergence_score = 0.0;
        let mut count = 0;
        
        // MACD crossover (signal crosses MACD)
        if (macd_signal > macd && macd_histogram < 0.0 && macd_histogram.abs() > 0.1) || 
           (macd_signal < macd && macd_histogram > 0.0 && macd_histogram > 0.1) {
            divergence_score += 1.0;
            count += 1;
        }
        
        // RSI divergence (overbought/oversold)
        if rsi > 70.0 || rsi < 30.0 {
            divergence_score += 1.0;
            count += 1;
        }
        
        // Trend oscillator direction change
        if trend_oscillator.abs() > 0.5 {
            divergence_score += 1.0;
            count += 1;
        }
        
        if count > 0 {
            divergence_score /= count as f64;
            
            // Check if divergence exceeds threshold
            if divergence_score * 2.0 > config.threshold {
                let confidence = (divergence_score * 2.0 - config.threshold) / (config.threshold * 0.5);
                let confidence = confidence.min(0.95); // Cap at 0.95
                
                if confidence >= config.min_confidence {
                    // Determine the likely regime direction
                    let direction = if rsi > 70.0 {
                        IndicatorDirection::Bearish
                    } else if rsi < 30.0 {
                        IndicatorDirection::Bullish
                    } else if macd_histogram < 0.0 {
                        IndicatorDirection::Bearish
                    } else if macd_histogram > 0.0 {
                        IndicatorDirection::Bullish
                    } else {
                        IndicatorDirection::Sideways
                    };
                    
                    let mut warning = RegimeWarning::new(
                        LeadingIndicator::MomentumReversal,
                        symbol,
                        divergence_score * 2.0, // Normalize to same scale as other indicators
                        config.threshold,
                        confidence,
                        direction,
                    );
                    
                    // Add metadata
                    let metadata = serde_json::json!({
                        "macd": macd,
                        "macd_signal": macd_signal,
                        "macd_histogram": macd_histogram,
                        "rsi": rsi,
                        "trend_oscillator": trend_oscillator,
                        "divergence_score": divergence_score,
                    });
                    
                    warning.with_metadata(metadata);
                    
                    return Ok(Some(warning));
                }
            }
        }
        
        Ok(None)
    }
    
    /// Check for volume anomaly
    async fn check_volume_anomaly(
        &self,
        market_data: &MarketData,
        config: &IndicatorConfig,
    ) -> RegimeWarningResult<Option<RegimeWarning>> {
        let symbol = &market_data.symbol;
        
        // Check if we're in cooldown period
        if !self.can_trigger_warning(symbol, LeadingIndicator::VolumeAnomaly).await {
            return Ok(None);
        }
        
        // Get volume indicators
        let obv = market_data.indicators.volume.get("on_balance_volume").copied().unwrap_or(0.0);
        let obv_sma = market_data.indicators.volume.get("obv_sma").copied().unwrap_or(0.0);
        let volume = market_data.indicators.volume.get("volume").copied().unwrap_or(0.0);
        let avg_volume = market_data.indicators.volume.get("average_volume").copied().unwrap_or(volume / 2.0);
        
        if avg_volume <= 0.0 {
            return Ok(None); // Avoid division by zero
        }
        
        // Calculate volume z-score
        let volume_z_score = (volume - avg_volume) / avg_volume;
        
        // Calculate OBV divergence
        let obv_divergence = if obv_sma != 0.0 {
            (obv - obv_sma) / obv_sma.abs()
        } else {
            0.0
        };
        
        // Take the maximum of volume spike or OBV divergence
        let anomaly_score = volume_z_score.max(obv_divergence.abs());
        
        // Check if anomaly exceeds threshold
        if anomaly_score > config.threshold {
            let confidence = (anomaly_score - config.threshold) / (config.threshold * 0.5);
            let confidence = confidence.min(0.95); // Cap at 0.95
            
            if confidence >= config.min_confidence {
                // Determine the likely regime direction
                let direction = if obv_divergence > 0.0 {
                    IndicatorDirection::Bullish
                } else if obv_divergence < 0.0 {
                    IndicatorDirection::Bearish
                } else if volume_z_score > 2.0 {
                    IndicatorDirection::Volatile
                } else {
                    IndicatorDirection::Undefined
                };
                
                let mut warning = RegimeWarning::new(
                    LeadingIndicator::VolumeAnomaly,
                    symbol,
                    anomaly_score,
                    config.threshold,
                    confidence,
                    direction,
                );
                
                // Add metadata
                let metadata = serde_json::json!({
                    "volume": volume,
                    "average_volume": avg_volume,
                    "volume_z_score": volume_z_score,
                    "obv": obv,
                    "obv_sma": obv_sma,
                    "obv_divergence": obv_divergence,
                });
                
                warning.with_metadata(metadata);
                
                return Ok(Some(warning));
            }
        }
        
        Ok(None)
    }
    
    /// Check for order book skew
    async fn check_order_book_skew(
        &self,
        market_data: &MarketData,
        config: &IndicatorConfig,
    ) -> RegimeWarningResult<Option<RegimeWarning>> {
        let symbol = &market_data.symbol;
        
        // Check if we're in cooldown period
        if !self.can_trigger_warning(symbol, LeadingIndicator::OrderBookSkew).await {
            return Ok(None);
        }
        
        // Skip if no order book is available
        if market_data.orderbook.is_empty() {
            return Ok(None);
        }
        
        // Calculate buy/sell imbalance
        let total_bids = market_data.orderbook.bids
            .iter()
            .map(|(_, size)| *size)
            .sum::<f64>();
            
        let total_asks = market_data.orderbook.asks
            .iter()
            .map(|(_, size)| *size)
            .sum::<f64>();
            
        if total_bids == 0.0 || total_asks == 0.0 {
            return Ok(None); // Avoid division by zero
        }
        
        // Calculate imbalance ratio (positive = more bids, negative = more asks)
        let imbalance_ratio = if total_bids > total_asks {
            (total_bids / total_asks) - 1.0
        } else {
            -((total_asks / total_bids) - 1.0)
        };
        
        // Get depth imbalance indicator (if available)
        let depth_imbalance = market_data.indicators.orderbook
            .get("depth_imbalance")
            .copied()
            .unwrap_or(imbalance_ratio);
        
        // Take absolute value for threshold comparison
        let abs_imbalance = depth_imbalance.abs();
        
        // Check if imbalance exceeds threshold
        if abs_imbalance > config.threshold {
            let confidence = (abs_imbalance - config.threshold) / (config.threshold * 0.5);
            let confidence = confidence.min(0.95); // Cap at 0.95
            
            if confidence >= config.min_confidence {
                // Determine the likely regime direction
                let direction = if depth_imbalance > 0.0 {
                    IndicatorDirection::Bullish
                } else {
                    IndicatorDirection::Bearish
                };
                
                let mut warning = RegimeWarning::new(
                    LeadingIndicator::OrderBookSkew,
                    symbol,
                    abs_imbalance,
                    config.threshold,
                    confidence,
                    direction,
                );
                
                // Add metadata
                let metadata = serde_json::json!({
                    "total_bids": total_bids,
                    "total_asks": total_asks,
                    "imbalance_ratio": imbalance_ratio,
                    "depth_imbalance": depth_imbalance,
                });
                
                warning.with_metadata(metadata);
                
                return Ok(Some(warning));
            }
        }
        
        Ok(None)
    }
    
    /// Check if a warning can be triggered for a given indicator
    async fn can_trigger_warning(&self, symbol: &Symbol, indicator: LeadingIndicator) -> bool {
        let last_trigger = self.last_trigger.read().await;
        let key = (symbol.clone(), indicator);
        
        if let Some(last_time) = last_trigger.get(&key) {
            let now = Utc::now();
            let duration = now.signed_duration_since(*last_time);
            
            // Get the cooldown period for this indicator
            let cooldown_sec = self.config.indicators
                .get(&indicator)
                .map(|config| config.cooldown_sec)
                .unwrap_or(300); // Default 5 minutes
                
            // Check if cooldown period has elapsed
            duration.num_seconds() >= cooldown_sec as i64
        } else {
            true // No previous trigger
        }
    }
    
    /// Process a new warning
    async fn process_warning(&self, warning: &RegimeWarning) -> RegimeWarningResult<()> {
        let key = (warning.symbol.clone(), warning.indicator);
        
        // Update last trigger time
        {
            let mut last_trigger = self.last_trigger.write().await;
            last_trigger.insert(key.clone(), warning.timestamp);
        }
        
        // Add to active warnings
        {
            let mut active_warnings = self.active_warnings.write().await;
            active_warnings.insert(key.clone(), warning.clone());
        }
        
        // Log the warning
        info!(
            "Regime warning: {} for symbol {}. Value: {:.2}, Threshold: {:.2}, Confidence: {:.2}, Direction: {}",
            warning.indicator, warning.symbol, warning.value, warning.threshold, warning.confidence, warning.direction
        );
        
        // Publish to Redis if available
        if let Some(redis) = &self.redis_client {
            let channel = warning.redis_channel();
            if let Err(e) = redis.publish(&channel, warning).await {
                warn!("Failed to publish warning to Redis: {}", e);
            }
        }
        
        // Report to telemetry
        let warning_data = serde_json::json!({
            "type": "REGIME_WARNING",
            "indicator": warning.indicator.to_string(),
            "symbol": warning.symbol,
            "value": warning.value,
            "threshold": warning.threshold,
            "confidence": warning.confidence,
            "direction": warning.direction.to_string(),
            "timestamp": warning.timestamp,
        });
        
        self.telemetry.report_custom("regime_warning", 
            warning_data.as_object().unwrap().clone()
        ).await;
        
        // Update the regime forecast for this symbol
        self.update_regime_forecast(&warning.symbol).await?;
        
        Ok(())
    }
    
    /// Update the regime forecast for a symbol
    async fn update_regime_forecast(&self, symbol: &Symbol) -> RegimeWarningResult<()> {
        Self::update_regime_forecast_internal(
            symbol,
            &self.active_warnings,
            &self.forecasts,
            &self.regime_detector,
            &self.config,
            &self.redis_client,
            &self.telemetry
        ).await
    }
    
    /// Internal implementation of update_regime_forecast
    async fn update_regime_forecast_internal(
        symbol: &Symbol,
        active_warnings: &RwLock<HashMap<(Symbol, LeadingIndicator), RegimeWarning>>,
        forecasts: &RwLock<HashMap<Symbol, RegimeForecast>>,
        regime_detector: &Arc<dyn MarketRegimeDetector>,
        config: &RegimeWarningConfig,
        redis_client: &Option<Arc<dyn RedisClient>>,
        telemetry: &Arc<TelemetryReporter>,
    ) -> RegimeWarningResult<()> {
        // Get current regime
        let current_regime = match regime_detector.get_current_regime(symbol).await {
            Some(regime) => regime,
            None => return Err(RegimeWarningError::InsufficientData(
                format!("No current regime for symbol {}", symbol)
            )),
        };
        
        // Get active warnings for this symbol
        let symbol_warnings = {
            let warnings = active_warnings.read().await;
            warnings
                .iter()
                .filter(|((s, _), _)| s == symbol)
                .map(|(_, w)| w.clone())
                .collect::<Vec<_>>()
        };
        
        if symbol_warnings.is_empty() {
            // No active warnings, forecast is the current regime
            let mut single_regime = HashMap::new();
            single_regime.insert(current_regime.state, 1.0);
            
            let forecast = RegimeForecast::new(
                symbol,
                current_regime.state,
                single_regime,
                1.0, // Max confidence
            );
            
            let mut forecasts = forecasts.write().await;
            forecasts.insert(symbol.clone(), forecast);
            
            return Ok(());
        }
        
        // Initialize forecast probabilities with current regime having higher weight
        let mut forecast_probs = HashMap::new();
        forecast_probs.insert(current_regime.state, 0.5); // Start with 50% for current regime
        
        // Define possible next states based on current regime
        let mut potential_next_states = HashMap::new();
        match current_regime.state {
            MarketRegimeState::Bull => {
                potential_next_states.insert(MarketRegimeState::Sideways, 0.0);
                potential_next_states.insert(MarketRegimeState::Bear, 0.0);
                potential_next_states.insert(MarketRegimeState::Volatile, 0.0);
            },
            MarketRegimeState::Bear => {
                potential_next_states.insert(MarketRegimeState::Sideways, 0.0);
                potential_next_states.insert(MarketRegimeState::Bull, 0.0);
                potential_next_states.insert(MarketRegimeState::Volatile, 0.0);
            },
            MarketRegimeState::Sideways => {
                potential_next_states.insert(MarketRegimeState::Bull, 0.0);
                potential_next_states.insert(MarketRegimeState::Bear, 0.0);
                potential_next_states.insert(MarketRegimeState::Volatile, 0.0);
            },
            MarketRegimeState::Volatile => {
                potential_next_states.insert(MarketRegimeState::Bull, 0.0);
                potential_next_states.insert(MarketRegimeState::Bear, 0.0);
                potential_next_states.insert(MarketRegimeState::Sideways, 0.0);
            },
            MarketRegimeState::Unknown => {
                potential_next_states.insert(MarketRegimeState::Bull, 0.0);
                potential_next_states.insert(MarketRegimeState::Bear, 0.0);
                potential_next_states.insert(MarketRegimeState::Sideways, 0.0);
                potential_next_states.insert(MarketRegimeState::Volatile, 0.0);
            },
        }
        
        // Update forecast based on warnings
        for warning in &symbol_warnings {
            // Map indicator direction to potential regime state
            let target_state = match warning.direction {
                IndicatorDirection::Bullish => MarketRegimeState::Bull,
                IndicatorDirection::Bearish => MarketRegimeState::Bear,
                IndicatorDirection::Volatile => MarketRegimeState::Volatile,
                IndicatorDirection::Sideways => MarketRegimeState::Sideways,
                IndicatorDirection::Undefined => continue, // Skip undefined directions
            };
            
            // Add contribution weighted by confidence
            let contribution = warning.confidence * 0.1; // Scale factor to avoid overconfidence
            
            // Update potential next state probabilities
            if let Some(prob) = potential_next_states.get_mut(&target_state) {
                *prob += contribution;
            }
        }
        
        // Merge the potential next states into forecast_probs
        for (state, prob) in potential_next_states {
            if prob > 0.0 {
                *forecast_probs.entry(state).or_insert(0.0) += prob;
            }
        }
        
        // Normalize the probabilities to sum to 1.0
        let total_prob: f64 = forecast_probs.values().sum();
        if total_prob > 0.0 {
            for prob in forecast_probs.values_mut() {
                *prob /= total_prob;
            }
        }
        
        // Calculate the overall confidence in the forecast
        let confidence = if symbol_warnings.len() == 1 {
            symbol_warnings[0].confidence
        } else {
            // Use weighted average of warning confidences
            let total_confidence: f64 = symbol_warnings.iter()
                .map(|w| w.confidence)
                .sum();
            total_confidence / symbol_warnings.len() as f64
        };
        
        // Create the forecast
        let mut forecast = RegimeForecast::new(
            symbol,
            current_regime.state,
            forecast_probs,
            confidence,
        );
        
        // Add contributing indicators
        for warning in &symbol_warnings {
            forecast.add_contributing_indicator(warning.indicator);
        }
        
        // Estimate time to shift based on warning times
        if let Some(earliest_warning) = symbol_warnings.iter().min_by_key(|w| w.timestamp) {
            // Simple heuristic: estimate shift in 2x the time since first warning
            let now = Utc::now();
            let warning_age = now.signed_duration_since(earliest_warning.timestamp).num_seconds();
            if warning_age > 0 {
                let estimated_seconds = warning_age as u64 * 2;
                forecast.with_estimated_time(estimated_seconds);
            }
        }
        
        // Store the forecast
        {
            let mut forecasts = forecasts.write().await;
            forecasts.insert(symbol.clone(), forecast.clone());
        }
        
        // Check if confidence exceeds threshold
        if forecast.confidence >= config.min_forecast_confidence {
            // Log the forecast
            let (most_likely_regime, prob) = forecast.most_likely_regime();
            info!(
                "Regime forecast for {}: Current={:?}, Next likely={:?} ({:.1}%), Confidence={:.1}%",
                symbol, forecast.current_regime, most_likely_regime, prob * 100.0, forecast.confidence * 100.0
            );
            
            // Publish to Redis if available
            if let Some(redis) = redis_client {
                if let Err(e) = redis.publish("regime:forecast", &forecast).await {
                    warn!("Failed to publish forecast to Redis: {}", e);
                }
            }
            
            // Report to telemetry
            let forecast_data = serde_json::json!({
                "symbol": forecast.symbol,
                "current": forecast.current_regime.to_string(),
                "forecast": forecast.forecast.iter().map(|(k, v)| {
                    (k.to_string(), v)
                }).collect::<HashMap<String, f64>>(),
                "confidence": forecast.confidence,
                "estimated_time_to_shift": forecast.estimated_time_to_shift,
                "timestamp": forecast.timestamp,
            });
            
            telemetry.report_custom("regime_forecast", 
                forecast_data.as_object().unwrap().clone()
            ).await;
        }
        
        Ok(())
    }
    
    /// Generate strategy preparation signals based on forecasts
    async fn generate_strategy_prep_signals(
        forecasts: &RwLock<HashMap<Symbol, RegimeForecast>>,
        config: &RegimeWarningConfig,
        redis_client: &Option<Arc<dyn RedisClient>>,
        telemetry: &Arc<TelemetryReporter>,
    ) -> RegimeWarningResult<()> {
        if !config.enable_strategy_prep {
            return Ok(());
        }
        
        let forecasts_data = forecasts.read().await;
        
        for (symbol, forecast) in forecasts_data.iter() {
            if forecast.confidence < config.min_forecast_confidence {
                continue; // Skip low-confidence forecasts
            }
            
            let (likely_regime, prob) = forecast.most_likely_regime();
            
            // Skip if the likely regime is the same as current or probability is low
            if likely_regime == forecast.current_regime || prob < 0.6 {
                continue;
            }
            
            // Create strategy prep signal
            let mut prep_signal = StrategyPrepSignal::new(
                likely_regime,
                &symbol,
                forecast.confidence,
            );
            
            // Add strategy actions based on the forecasted regime
            match likely_regime {
                MarketRegimeState::Bull => {
                    prep_signal.add_warmup("trend_follow_btc");
                    prep_signal.add_warmup("breakout_momentum");
                    prep_signal.add_cooldown("mean_reversion");
                },
                MarketRegimeState::Bear => {
                    prep_signal.add_warmup("trend_follow_short");
                    prep_signal.add_warmup("defensive_hedge");
                    prep_signal.add_cooldown("breakout_momentum");
                },
                MarketRegimeState::Volatile => {
                    prep_signal.add_warmup("volatility_scalp");
                    prep_signal.add_warmup("breakout_scalp");
                    prep_signal.add_cooldown("trend_follow_btc");
                },
                MarketRegimeState::Sideways => {
                    prep_signal.add_warmup("mean_reversion");
                    prep_signal.add_warmup("range_bound");
                    prep_signal.add_cooldown("trend_follow_btc");
                },
                _ => continue, // Skip unknown regime
            }
            
            // Publish signal to Redis
            if let Some(redis) = redis_client {
                if let Err(e) = redis.publish("strategy:prep", &prep_signal).await {
                    warn!("Failed to publish strategy prep signal to Redis: {}", e);
                }
            }
            
            // Report to telemetry
            let actions_json: Vec<serde_json::Value> = prep_signal.actions.iter()
                .map(|action| {
                    match action {
                        StrategyPrepAction::Warmup(strategy_id) => {
                            serde_json::json!({
                                "type": "warmup",
                                "strategy_id": strategy_id
                            })
                        },
                        StrategyPrepAction::Cooldown(strategy_id) => {
                            serde_json::json!({
                                "type": "cooldown",
                                "strategy_id": strategy_id
                            })
                        }
                    }
                })
                .collect();
            
            let signal_data = serde_json::json!({
                "type": "STRATEGY_PREP_SIGNAL",
                "forecast_regime": prep_signal.forecast_regime.to_string(),
                "symbol": prep_signal.symbol,
                "confidence": prep_signal.confidence,
                "actions": actions_json,
                "timestamp": prep_signal.timestamp,
            });
            
            telemetry.report_custom("strategy_prep", 
                signal_data.as_object().unwrap().clone()
            ).await;
            
            info!(
                "Strategy prep signal for {}: Preparing for {:?} regime (confidence: {:.1}%)",
                symbol, likely_regime, forecast.confidence * 100.0
            );
        }
        
        Ok(())
    }
    
    /// Clean up expired warnings
    async fn clean_expired_warnings(
        active_warnings: &RwLock<HashMap<(Symbol, LeadingIndicator), RegimeWarning>>,
    ) {
        let now = Utc::now();
        let mut to_remove = Vec::new();
        
        {
            let warnings = active_warnings.read().await;
            for (key, warning) in warnings.iter() {
                let age = now.signed_duration_since(warning.timestamp).num_seconds();
                
                // Remove if older than decay period
                let decay_sec = 1800; // Default 30 minutes if not specified
                if age > decay_sec as i64 {
                    to_remove.push(key.clone());
                }
            }
        }
        
        if !to_remove.is_empty() {
            let mut warnings = active_warnings.write().await;
            for key in to_remove {
                warnings.remove(&key);
            }
        }
    }
}

/// Factory method to create a new RegimeWarningEngine
pub fn create_regime_warning_engine(
    regime_detector: Arc<dyn MarketRegimeDetector>,
    redis_client: Option<Arc<dyn RedisClient>>,
    telemetry: Arc<TelemetryReporter>,
) -> Arc<RegimeWarningEngine> {
    Arc::new(RegimeWarningEngine::default(
        regime_detector,
        redis_client,
        telemetry,
    ))
}

/// Factory method to create a new RegimeWarningEngine with custom config
pub fn create_regime_warning_engine_with_config(
    config: RegimeWarningConfig,
    regime_detector: Arc<dyn MarketRegimeDetector>,
    redis_client: Option<Arc<dyn RedisClient>>,
    telemetry: Arc<TelemetryReporter>,
) -> Arc<RegimeWarningEngine> {
    Arc::new(RegimeWarningEngine::new(
        config,
        regime_detector,
        redis_client,
        telemetry,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::{Candle, Orderbook, TechnicalIndicators, Timeframe};
    use crate::redis::MockRedisClient;
    use crate::telemetry::MockTelemetryReporter;
    use std::collections::HashMap;
    
    // Mock market regime detector for testing
    struct MockMarketRegimeDetector {
        regimes: HashMap<Symbol, MarketRegime>,
    }
    
    impl MockMarketRegimeDetector {
        fn new() -> Self {
            Self {
                regimes: HashMap::new(),
            }
        }
        
        fn with_regime(mut self, symbol: &str, state: MarketRegimeState) -> Self {
            let regime = MarketRegime::new(symbol.to_string(), state, 0.8);
            self.regimes.insert(symbol.to_string(), regime);
            self
        }
    }
    
    #[async_trait]
    impl MarketRegimeDetector for MockMarketRegimeDetector {
        async fn detect_regime(&self, symbol: &Symbol) -> MarketRegimeResult<MarketRegime> {
            if let Some(regime) = self.regimes.get(symbol) {
                Ok(regime.clone())
            } else {
                Err(MarketRegimeError::InsufficientData(format!("No regime for {}", symbol)))
            }
        }
        
        async fn get_current_regime(&self, symbol: &Symbol) -> Option<MarketRegime> {
            self.regimes.get(symbol).cloned()
        }
        
        async fn get_all_regimes(&self) -> HashMap<Symbol, MarketRegime> {
            self.regimes.clone()
        }
        
        async fn process_market_data(&self, _market_data: &MarketData) -> MarketRegimeResult<()> {
            Ok(())
        }
        
        async fn initialize(&self) -> MarketRegimeResult<()> {
            Ok(())
        }
    }
    
    // Create test market data
    fn create_test_market_data() -> MarketData {
        let mut market_data = MarketData::default();
        market_data.symbol = "BTC/USD".to_string();
        market_data.price = 50000.0;
        
        // Add candles
        let mut candles = Vec::new();
        for i in 0..10 {
            candles.push(Candle {
                timestamp: Utc::now(),
                open: 50000.0 - i as f64 * 100.0,
                high: 50000.0 - i as f64 * 50.0,
                low: 50000.0 - i as f64 * 150.0,
                close: 50000.0 - i as f64 * 100.0,
                volume: 10.0,
                extras: HashMap::new(),
            });
        }
        
        let mut candle_map = HashMap::new();
        candle_map.insert("1h".to_string(), candles);
        market_data.candles = candle_map;
        
        // Add orderbook
        let mut orderbook = Orderbook::default();
        orderbook.bids.push((49900.0, 1.0));
        orderbook.bids.push((49800.0, 2.0));
        orderbook.asks.push((50100.0, 0.5));
        orderbook.asks.push((50200.0, 1.0));
        market_data.orderbook = orderbook;
        
        // Add technical indicators for volatility spike test
        let mut indicators = TechnicalIndicators::default();
        
        // Volatility indicators
        indicators.volatility.insert("realized_volatility".to_string(), 0.05);
        indicators.volatility.insert("average_volatility".to_string(), 0.02);
        
        // Momentum indicators
        indicators.momentum.insert("rsi_14".to_string(), 75.0);
        
        // Trend indicators
        indicators.trend.insert("macd".to_string(), 0.5);
        indicators.trend.insert("macd_signal".to_string(), 0.3);
        indicators.trend.insert("macd_histogram".to_string(), 0.2);
        indicators.trend.insert("trend_oscillator".to_string(), 0.8);
        
        // Volume indicators
        indicators.volume.insert("volume".to_string(), 1000.0);
        indicators.volume.insert("average_volume".to_string(), 500.0);
        indicators.volume.insert("on_balance_volume".to_string(), 5000.0);
        indicators.volume.insert("obv_sma".to_string(), 4800.0);
        
        // Order book indicators
        indicators.orderbook.insert("depth_imbalance".to_string(), 0.5);
        
        market_data.indicators = indicators;
        
        market_data
    }
    
    #[tokio::test]
    async fn test_volatility_spike_warning() {
        // Create mock components
        let regime_detector = Arc::new(
            MockMarketRegimeDetector::new()
                .with_regime("BTC/USD", MarketRegimeState::Sideways)
        );
        
        let redis_client = Arc::new(MockRedisClient::new(Default::default()));
        let telemetry = Arc::new(MockTelemetryReporter::new());
        
        // Create warning engine
        let engine = RegimeWarningEngine::default(
            regime_detector,
            Some(redis_client.clone()),
            telemetry,
        );
        
        // Create market data with volatility spike
        let mut market_data = create_test_market_data();
        market_data.indicators.volatility.insert("realized_volatility".to_string(), 0.10); // 5x average
        
        // Process market data
        let result = engine.process_market_data(&market_data).await;
        assert!(result.is_ok());
        
        // Check that a warning was generated
        let warnings = engine.get_active_warnings().await;
        assert!(!warnings.is_empty());
        
        // Verify the warning details
        let warning = warnings.first().unwrap();
        assert_eq!(warning.indicator, LeadingIndicator::VolatilitySpike);
        assert_eq!(warning.symbol, "BTC/USD");
        assert!(warning.value > warning.threshold);
        assert!(warning.confidence > 0.5);
        
        // Check that a forecast was generated
        let forecast = engine.get_regime_forecast(&"BTC/USD".to_string()).await;
        assert!(forecast.is_some());
        
        let forecast = forecast.unwrap();
        assert_eq!(forecast.current_regime, MarketRegimeState::Sideways);
        
        // Volatile should have higher probability due to the volatility spike
        let volatile_prob = forecast.forecast.get(&MarketRegimeState::Volatile).cloned().unwrap_or(0.0);
        assert!(volatile_prob > 0.0);
    }
    
    #[tokio::test]
    async fn test_momentum_reversal_warning() {
        // Create mock components
        let regime_detector = Arc::new(
            MockMarketRegimeDetector::new()
                .with_regime("BTC/USD", MarketRegimeState::Bull)
        );
        
        let redis_client = Arc::new(MockRedisClient::new(Default::default()));
        let telemetry = Arc::new(MockTelemetryReporter::new());
        
        // Create warning engine
        let engine = RegimeWarningEngine::default(
            regime_detector,
            Some(redis_client.clone()),
            telemetry,
        );
        
        // Create market data with momentum reversal signals
        let mut market_data = create_test_market_data();
        market_data.indicators.momentum.insert("rsi_14".to_string(), 78.0); // Overbought
        market_data.indicators.trend.insert("macd".to_string(), 0.1);
        market_data.indicators.trend.insert("macd_signal".to_string(), 0.2); // Signal crossing above MACD
        market_data.indicators.trend.insert("macd_histogram".to_string(), -0.15);
        
        // Process market data
        let result = engine.process_market_data(&market_data).await;
        assert!(result.is_ok());
        
        // Check that a warning was generated
        let warnings = engine.get_active_warnings().await;
        assert!(!warnings.is_empty());
        
        // Look for momentum reversal warning
        let momentum_warning = warnings.iter()
            .find(|w| w.indicator == LeadingIndicator::MomentumReversal);
        
        assert!(momentum_warning.is_some());
        let warning = momentum_warning.unwrap();
        assert_eq!(warning.symbol, "BTC/USD");
        assert!(warning.value > warning.threshold);
        
        // Verify the warning direction
        assert_eq!(warning.direction, IndicatorDirection::Bearish);
    }
    
    #[tokio::test]
    async fn test_strategy_prep_signal() {
        // Create mock components
        let regime_detector = Arc::new(
            MockMarketRegimeDetector::new()
                .with_regime("BTC/USD", MarketRegimeState::Bull)
        );
        
        let redis_client = Arc::new(MockRedisClient::new(Default::default()));
        let telemetry = Arc::new(MockTelemetryReporter::new());
        
        // Create a custom config with lower thresholds for testing
        let mut config = RegimeWarningConfig::default();
        config.min_forecast_confidence = 0.5; // Lower for testing
        
        // Create warning engine
        let mut engine = RegimeWarningEngine::new(
            config,
            regime_detector,
            Some(redis_client.clone()),
            telemetry,
        );
        
        // Start the engine
        engine.start().await.unwrap();
        
        // Create market data with strong bearish signals
        let mut market_data = create_test_market_data();
        market_data.indicators.momentum.insert("rsi_14".to_string(), 85.0); // Very overbought
        market_data.indicators.trend.insert("macd_histogram".to_string(), -0.25); // Strong negative divergence
        market_data.indicators.orderbook.insert("depth_imbalance".to_string(), -0.8); // Strong sell pressure
        
        // Process market data to generate warnings
        engine.process_market_data(&market_data).await.unwrap();
        
        // Stop the engine
        engine.stop().await.unwrap();
        
        // Check that the forecast shows high probability of transitioning to bearish
        let forecast = engine.get_regime_forecast(&"BTC/USD".to_string()).await;
        assert!(forecast.is_some());
        
        let forecast = forecast.unwrap();
        let bear_prob = forecast.forecast.get(&MarketRegimeState::Bear).cloned().unwrap_or(0.0);
        
        // Bear probability should have increased due to the signals
        assert!(bear_prob > 0.0);
        
        // Check that published messages contain strategy prep signals
        let published = redis_client.get_published_messages().await;
        let prep_signals = published.iter()
            .filter(|(channel, _)| channel == "strategy:prep")
            .count();
        
        // At least one strategy prep signal should have been published
        assert!(prep_signals > 0);
    }
} 