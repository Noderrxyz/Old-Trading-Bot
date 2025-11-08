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
use tokio::sync::RwLock;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use tracing::{debug, error, info, warn};
use serde::{Deserialize, Serialize};

use crate::market::{MarketData, Symbol};
use crate::market_regime::{
    MarketRegimeError, MarketRegimeResult, MarketRegimeState, MarketRegime,
    MarketRegimeConfig, MarketRegimeDetector
};
use crate::market_regime::hmm::{
    HiddenMarkovModel, MarketObservation, calculate_market_features, normalize_observations
};
use crate::redis::RedisClient;

/// Configuration for HMM-based regime detection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HmmRegimeConfig {
    /// Number of hidden states in the HMM
    pub n_states: usize,
    /// How often to retrain the model (in hours)
    pub retraining_interval_hours: u64,
    /// Minimum number of samples needed for training
    pub min_training_samples: usize,
    /// Maximum number of samples to keep for training
    pub max_training_samples: usize,
    /// Window size for feature calculation (in candles)
    pub feature_window_size: usize,
    /// Minimum confidence threshold for regime classification
    pub min_confidence_threshold: f64,
    /// Feature timeframe to use (e.g., "1h", "4h")
    pub feature_timeframe: String,
    /// How often to update regime detection (in seconds)
    pub update_interval_sec: u64,
}

impl Default for HmmRegimeConfig {
    fn default() -> Self {
        Self {
            n_states: 4,
            retraining_interval_hours: 24,
            min_training_samples: 100,
            max_training_samples: 1000,
            feature_window_size: 30,
            min_confidence_threshold: 0.6,
            feature_timeframe: "1h".to_string(),
            update_interval_sec: 900, // 15 minutes
        }
    }
}

/// HMM-based market regime detector
pub struct HmmMarketRegimeDetector {
    /// General market regime configuration
    base_config: MarketRegimeConfig,
    /// HMM-specific configuration
    hmm_config: HmmRegimeConfig,
    /// HMM models for each symbol
    models: RwLock<HashMap<Symbol, HiddenMarkovModel>>,
    /// Current regimes by symbol
    regimes: RwLock<HashMap<Symbol, MarketRegime>>,
    /// Training data for each symbol
    training_data: RwLock<HashMap<Symbol, Vec<MarketObservation>>>,
    /// Last model training time
    last_training: RwLock<HashMap<Symbol, DateTime<Utc>>>,
    /// Last update time
    last_update: RwLock<Instant>,
    /// Optional Redis client for caching and distribution
    redis: Option<Arc<dyn RedisClient>>,
}

impl HmmMarketRegimeDetector {
    /// Create a new HMM-based market regime detector
    pub fn new(
        base_config: MarketRegimeConfig,
        hmm_config: HmmRegimeConfig,
        redis: Option<Arc<dyn RedisClient>>
    ) -> Self {
        Self {
            base_config,
            hmm_config,
            models: RwLock::new(HashMap::new()),
            regimes: RwLock::new(HashMap::new()),
            training_data: RwLock::new(HashMap::new()),
            last_training: RwLock::new(HashMap::new()),
            last_update: RwLock::new(Instant::now() - Duration::from_secs(3600)), // Force immediate update
            redis,
        }
    }
    
    /// Create with default configuration
    pub fn default() -> Self {
        Self::new(
            MarketRegimeConfig::default(),
            HmmRegimeConfig::default(),
            None
        )
    }
    
    /// Initialize a model for a symbol if not already initialized
    async fn ensure_model_initialized(&self, symbol: &Symbol) -> MarketRegimeResult<()> {
        let mut models = self.models.write().await;
        if !models.contains_key(symbol) {
            let model = HiddenMarkovModel::new_default();
            models.insert(symbol.clone(), model);
            
            // Also initialize training data storage
            let mut training_data = self.training_data.write().await;
            if !training_data.contains_key(symbol) {
                training_data.insert(symbol.clone(), Vec::new());
            }
            
            debug!("Initialized new HMM model for symbol {}", symbol);
        }
        
        Ok(())
    }
    
    /// Add a market observation to training data
    async fn add_observation(&self, symbol: &Symbol, observation: MarketObservation) -> MarketRegimeResult<()> {
        // Ensure model and training data are initialized
        self.ensure_model_initialized(symbol).await?;
        
        // Add to training data
        let mut training_data = self.training_data.write().await;
        let symbol_data = training_data.get_mut(symbol).unwrap();
        
        // Add new observation
        symbol_data.push(observation);
        
        // Limit size if needed
        if symbol_data.len() > self.hmm_config.max_training_samples {
            // Remove oldest data points
            *symbol_data = symbol_data.drain(symbol_data.len() - self.hmm_config.max_training_samples..)
                .collect();
        }
        
        Ok(())
    }
    
    /// Train a model with current training data
    async fn train_model(&self, symbol: &Symbol) -> MarketRegimeResult<()> {
        // Get training data
        let training_data = self.training_data.read().await;
        let symbol_data = match training_data.get(symbol) {
            Some(data) => data,
            None => return Err(MarketRegimeError::InsufficientData(
                format!("No training data for symbol {}", symbol)
            )),
        };
        
        // Check if we have enough data
        if symbol_data.len() < self.hmm_config.min_training_samples {
            return Err(MarketRegimeError::InsufficientData(
                format!("Not enough training data for symbol {}: have {}, need {}", 
                        symbol, symbol_data.len(), self.hmm_config.min_training_samples)
            ));
        }
        
        // Convert observations to feature vectors
        let raw_features: Vec<Vec<f64>> = symbol_data.iter()
            .map(|obs| vec![
                obs.log_return,
                obs.volatility,
                obs.momentum_10,
                obs.momentum_30,
                obs.rsi_14,
                obs.macd,
                obs.on_balance_volume,
            ])
            .collect();
        
        // Normalize features
        let normalized_features = normalize_observations(raw_features);
        
        // Get model and train
        let mut models = self.models.write().await;
        let model = match models.get_mut(symbol) {
            Some(model) => model,
            None => return Err(MarketRegimeError::Internal(
                format!("Model for symbol {} not initialized", symbol)
            )),
        };
        
        // Train model
        if let Err(e) = model.fit(&normalized_features) {
            return Err(MarketRegimeError::Internal(
                format!("Failed to train HMM model for {}: {}", symbol, e)
            ));
        }
        
        // Update last training time
        let mut last_training = self.last_training.write().await;
        last_training.insert(symbol.clone(), Utc::now());
        
        info!("Successfully trained HMM model for symbol {} with {} observations", 
             symbol, symbol_data.len());
        
        Ok(())
    }
    
    /// Check if model needs retraining
    async fn should_retrain(&self, symbol: &Symbol) -> bool {
        let last_training = self.last_training.read().await;
        
        match last_training.get(symbol) {
            Some(time) => {
                let now = Utc::now();
                let duration = now.signed_duration_since(*time);
                duration.num_hours() >= self.hmm_config.retraining_interval_hours as i64
            },
            None => true, // No training recorded, should train
        }
    }
    
    /// Detect regime for a specific symbol using current model
    async fn detect_regime_with_hmm(&self, symbol: &Symbol, market_data: &MarketData) -> MarketRegimeResult<MarketRegime> {
        // Ensure model is initialized
        self.ensure_model_initialized(symbol).await?;
        
        // Get candles for feature calculation
        let candles = match market_data.candles.get(&self.hmm_config.feature_timeframe) {
            Some(candles) if candles.len() >= self.hmm_config.feature_window_size => candles,
            _ => return Err(MarketRegimeError::InsufficientData(
                format!("Not enough candles for regime detection for {}", symbol)
            )),
        };
        
        // Calculate features
        let observation = calculate_market_features(
            &candles[candles.len() - self.hmm_config.feature_window_size..],
            market_data.ticker.last
        ).map_err(|e| MarketRegimeError::Internal(e.to_string()))?;
        
        // Add to training data
        self.add_observation(symbol, observation.clone()).await?;
        
        // Check if model needs retraining
        if self.should_retrain(symbol).await {
            match self.train_model(symbol).await {
                Ok(_) => debug!("Retrained HMM model for {}", symbol),
                Err(e) => warn!("Failed to retrain HMM model for {}: {}", symbol, e),
            }
        }
        
        // Get model and predict
        let models = self.models.read().await;
        let model = match models.get(symbol) {
            Some(model) => model,
            None => return Err(MarketRegimeError::Internal(
                format!("Model for symbol {} not found", symbol)
            )),
        };
        
        // Get current regime
        let (regime_state, confidence) = model.predict_regime(&observation)?;
        
        // Get previous regime
        let regimes = self.regimes.read().await;
        let previous_state = regimes.get(symbol).map(|r| r.state);
        
        // Create regime info
        let mut regime = MarketRegime::new(
            symbol.clone(),
            regime_state,
            confidence
        );
        
        // Add metrics
        regime = regime
            .with_metric("log_return", observation.log_return)
            .with_metric("volatility", observation.volatility)
            .with_metric("momentum_10", observation.momentum_10)
            .with_metric("momentum_30", observation.momentum_30)
            .with_metric("rsi_14", observation.rsi_14)
            .with_metric("macd", observation.macd)
            .with_metric("obv", observation.on_balance_volume);
        
        // Add previous state if available
        if let Some(prev) = previous_state {
            regime = regime.with_previous_state(prev);
            
            // Calculate duration if we have a previous regime
            if let Some(prev_regime) = regimes.get(symbol) {
                let duration = Utc::now().signed_duration_since(prev_regime.timestamp);
                let days = duration.num_seconds() as f64 / 86400.0;
                regime = regime.with_duration_days(days);
            }
        }
        
        // Store in Redis if available
        if let Some(redis) = &self.redis {
            let json = serde_json::to_string(&regime)
                .map_err(|e| MarketRegimeError::Internal(e.to_string()))?;
            
            let key = format!("market:regime:{}", symbol);
            if let Err(e) = redis.set(&key, &json, Some(self.base_config.update_interval_sec)).await {
                warn!("Failed to store regime in Redis: {}", e);
            }
            
            // Also publish to channel
            let channel = format!("market:regime:updates:{}", symbol);
            if let Err(e) = redis.publish(&channel, &json).await {
                warn!("Failed to publish regime update to Redis: {}", e);
            }
        }
        
        Ok(regime)
    }
}

#[async_trait]
impl MarketRegimeDetector for HmmMarketRegimeDetector {
    async fn initialize(&self) -> MarketRegimeResult<()> {
        // Nothing to do here, models are initialized on-demand
        Ok(())
    }
    
    async fn detect_regime(&self, symbol: &Symbol) -> MarketRegimeResult<MarketRegime> {
        // Check Redis first if available
        if let Some(redis) = &self.redis {
            let key = format!("market:regime:{}", symbol);
            if let Ok(Some(json)) = redis.get(&key).await {
                if let Ok(regime) = serde_json::from_str::<MarketRegime>(&json) {
                    // Check if regime is fresh enough
                    let age = Utc::now().signed_duration_since(regime.timestamp);
                    if age.num_seconds() <= self.base_config.update_interval_sec as i64 * 2 {
                        return Ok(regime);
                    }
                }
            }
        }
        
        // Fall back to regimes map
        let regimes = self.regimes.read().await;
        if let Some(regime) = regimes.get(symbol) {
            let age = Utc::now().signed_duration_since(regime.timestamp);
            if age.num_seconds() <= self.base_config.update_interval_sec as i64 * 2 {
                return Ok(regime.clone());
            }
        }
        
        Err(MarketRegimeError::InsufficientData(
            format!("No current regime data for {}", symbol)
        ))
    }
    
    async fn get_current_regime(&self, symbol: &Symbol) -> Option<MarketRegime> {
        // First try from Redis
        if let Some(redis) = &self.redis {
            let key = format!("market:regime:{}", symbol);
            if let Ok(Some(json)) = redis.get(&key).await {
                if let Ok(regime) = serde_json::from_str::<MarketRegime>(&json) {
                    return Some(regime);
                }
            }
        }
        
        // Fall back to local storage
        let regimes = self.regimes.read().await;
        regimes.get(symbol).cloned()
    }
    
    async fn get_all_regimes(&self) -> HashMap<Symbol, MarketRegime> {
        self.regimes.read().await.clone()
    }
    
    async fn process_market_data(&self, market_data: &MarketData) -> MarketRegimeResult<()> {
        let symbol = &market_data.symbol;
        
        // Check if it's time to update
        let now = Instant::now();
        let last_update = *self.last_update.read().await;
        let elapsed = now.duration_since(last_update).as_secs();
        
        if elapsed < self.base_config.update_interval_sec && 
           self.get_current_regime(symbol).await.is_some() {
            // Skip update if not enough time has passed and we already have a regime
            return Ok(());
        }
        
        // Update the last update time
        *self.last_update.write().await = now;
        
        // Detect regime
        match self.detect_regime_with_hmm(symbol, market_data).await {
            Ok(regime) => {
                // Store the regime
                let mut regimes = self.regimes.write().await;
                
                // Check if this is a regime change
                let is_change = if let Some(current) = regimes.get(symbol) {
                    current.state != regime.state
                } else {
                    true // First detection is considered a change
                };
                
                regimes.insert(symbol.clone(), regime.clone());
                
                // Log regime changes
                if is_change {
                    info!(
                        "Market regime change for {}: {:?} -> {:?} (confidence: {:.2})",
                        symbol,
                        regime.previous_state.unwrap_or(MarketRegimeState::Unknown),
                        regime.state,
                        regime.confidence
                    );
                }
                
                // Publish telemetry event for regime change if significant
                if is_change && regime.confidence >= self.hmm_config.min_confidence_threshold {
                    // TODO: Add telemetry event for regime change
                }
                
                Ok(())
            },
            Err(e) => {
                warn!("Failed to detect regime for {}: {}", symbol, e);
                Err(e)
            }
        }
    }
}

/// Factory function to create an HMM-based regime detector
pub fn create_hmm_regime_detector(
    base_config: MarketRegimeConfig,
    hmm_config: HmmRegimeConfig,
    redis: Option<Arc<dyn RedisClient>>
) -> Arc<dyn MarketRegimeDetector> {
    Arc::new(HmmMarketRegimeDetector::new(base_config, hmm_config, redis))
}

/// Factory function with default configuration
pub fn create_default_hmm_regime_detector() -> Arc<dyn MarketRegimeDetector> {
    Arc::new(HmmMarketRegimeDetector::default())
} 