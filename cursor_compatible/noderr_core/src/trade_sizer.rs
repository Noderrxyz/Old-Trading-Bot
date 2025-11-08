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
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

use crate::telemetry::TelemetryEvent;

/// Dynamic trade sizer errors
#[derive(Debug, Error)]
pub enum TradeSizerError {
    #[error("Insufficient data to calculate volatility: {0}")]
    InsufficientData(String),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),
    
    #[error("I/O error: {0}")]
    IOError(#[from] std::io::Error),
    
    #[error("Symbol not found: {0}")]
    SymbolNotFound(String),
    
    #[error("Calculation error: {0}")]
    CalculationError(String),
}

/// Trade sizer configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeSizerConfig {
    /// Base position size (multiplier)
    pub base_size: f64,
    
    /// Maximum volatility threshold before scaling to minimum
    pub max_volatility_threshold: f64,
    
    /// Window size for volatility calculation (number of data points)
    pub volatility_window_size: usize,
    
    /// Minimum size factor (0.0-1.0)
    pub min_size_factor: f64,
    
    /// Maximum size factor (0.0-1.0)
    pub max_size_factor: f64,
    
    /// Path to log file
    pub log_file_path: String,
    
    /// Enable logging
    pub enable_logging: bool,
    
    /// Additional scale factors by symbol
    pub symbol_scale_factors: HashMap<String, f64>,
}

impl Default for TradeSizerConfig {
    fn default() -> Self {
        Self {
            base_size: 1.0,
            max_volatility_threshold: 0.05, // 5% volatility threshold
            volatility_window_size: 300,
            min_size_factor: 0.1,
            max_size_factor: 1.0,
            log_file_path: "logs/risk/trade_sizing.jsonl".to_string(),
            enable_logging: true,
            symbol_scale_factors: HashMap::new(),
        }
    }
}

/// Symbol state for tracking volatility
#[derive(Debug, Clone)]
struct SymbolState {
    /// Symbol identifier
    symbol: String,
    
    /// Recent price or return values
    recent_returns: Vec<f64>,
    
    /// Current calculated volatility
    current_volatility: f64,
    
    /// Last update timestamp
    last_update_time: u64,
    
    /// Price history for calculating returns
    price_history: Vec<f64>,
}

impl SymbolState {
    /// Create a new symbol state
    fn new(symbol: &str) -> Self {
        Self {
            symbol: symbol.to_string(),
            recent_returns: Vec::new(),
            current_volatility: 0.0,
            last_update_time: unix_timestamp_ms(),
            price_history: Vec::new(),
        }
    }
}

/// Log entry for trade sizing
#[derive(Debug, Serialize, Deserialize)]
struct SizingLogEntry {
    /// Timestamp
    timestamp: u64,
    
    /// Symbol
    symbol: String,
    
    /// Base size
    base_size: f64,
    
    /// Size factor
    size_factor: f64,
    
    /// Final size
    final_size: f64,
    
    /// Volatility
    volatility: f64,
}

/// Dynamic trade sizer that adjusts position sizes based on volatility
pub struct DynamicTradeSizer {
    /// Configuration
    config: Arc<RwLock<TradeSizerConfig>>,
    
    /// Symbol states
    symbol_states: Arc<RwLock<HashMap<String, SymbolState>>>,
    
    /// Telemetry sender (optional)
    telemetry_sender: Option<tokio::sync::mpsc::Sender<TelemetryEvent>>,
}

impl DynamicTradeSizer {
    /// Create a new dynamic trade sizer with default configuration
    pub fn new() -> Self {
        Self::with_config(TradeSizerConfig::default())
    }
    
    /// Create a new dynamic trade sizer with custom configuration
    pub fn with_config(config: TradeSizerConfig) -> Self {
        // Ensure log directory exists
        if config.enable_logging {
            if let Some(parent) = Path::new(&config.log_file_path).parent() {
                std::fs::create_dir_all(parent).unwrap_or_else(|e| {
                    error!("Failed to create log directory: {}", e);
                });
            }
        }
        
        Self {
            config: Arc::new(RwLock::new(config)),
            symbol_states: Arc::new(RwLock::new(HashMap::new())),
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
    
    /// Update configuration
    pub async fn update_config(&self, config: TradeSizerConfig) {
        let mut current_config = self.config.write().await;
        *current_config = config;
    }
    
    /// Calculate position size based on volatility
    pub async fn calculate_position_size(
        &self,
        symbol: &str,
        base_size: f64,
    ) -> Result<f64, TradeSizerError> {
        let state = self.get_or_create_state(symbol).await;
        let config = self.config.read().await;
        
        // Calculate volatility factor
        let volatility_factor = self.calculate_volatility_factor(state.current_volatility, &config);
        
        // Determine size factor
        let size_factor = f64::max(
            config.min_size_factor,
            f64::min(config.max_size_factor, 1.0 - volatility_factor),
        );
        
        // Apply symbol-specific scale factor if it exists
        let symbol_factor = config.symbol_scale_factors
            .get(symbol)
            .copied()
            .unwrap_or(1.0);
        
        // Calculate final size
        let size = base_size * size_factor * symbol_factor;
        
        // Log sizing decision
        if config.enable_logging {
            self.log_sizing(symbol, base_size, size_factor, size, state.current_volatility, &config).await;
        }
        
        // Send telemetry event
        if let Some(sender) = &self.telemetry_sender {
            let event = TelemetryEvent::new(
                "trade_sizing",
                serde_json::json!({
                    "symbol": symbol,
                    "base_size": base_size,
                    "size_factor": size_factor,
                    "volatility": state.current_volatility,
                    "final_size": size,
                }),
            );
            
            if let Err(e) = sender.try_send(event) {
                warn!("Failed to send telemetry event: {}", e);
            }
        }
        
        debug!(
            "[DynamicTradeSizer] {}: {} (volatility: {:.2}%)",
            symbol,
            size,
            state.current_volatility * 100.0
        );
        
        Ok(size)
    }
    
    /// Update volatility for a symbol based on new price data
    pub async fn update_volatility(
        &self,
        symbol: &str,
        price: f64,
        timestamp: Option<u64>,
    ) -> Result<f64, TradeSizerError> {
        let mut states = self.symbol_states.write().await;
        let config = self.config.read().await;
        
        let state = states
            .entry(symbol.to_string())
            .or_insert_with(|| SymbolState::new(symbol));
        
        // Add price to history
        state.price_history.push(price);
        
        // Calculate return if we have at least two prices
        if state.price_history.len() > 1 {
            let prev_price = state.price_history[state.price_history.len() - 2];
            let return_val = (price - prev_price) / prev_price;
            state.recent_returns.push(return_val);
        } else if state.recent_returns.is_empty() {
            // First price, add a zero return
            state.recent_returns.push(0.0);
        }
        
        // Trim return history to window size
        if state.recent_returns.len() > config.volatility_window_size {
            let excess = state.recent_returns.len() - config.volatility_window_size;
            state.recent_returns.drain(0..excess);
        }
        
        // Trim price history (keep twice the window size)
        if state.price_history.len() > config.volatility_window_size * 2 {
            let excess = state.price_history.len() - config.volatility_window_size * 2;
            state.price_history.drain(0..excess);
        }
        
        // Calculate volatility
        state.current_volatility = self.calculate_volatility(&state.recent_returns)?;
        state.last_update_time = timestamp.unwrap_or_else(unix_timestamp_ms);
        
        // Send telemetry event
        if let Some(sender) = &self.telemetry_sender {
            let event = TelemetryEvent::new(
                "volatility_update",
                serde_json::json!({
                    "symbol": symbol,
                    "volatility": state.current_volatility,
                    "timestamp": state.last_update_time,
                    "window_size": state.recent_returns.len(),
                }),
            );
            
            if let Err(e) = sender.try_send(event) {
                warn!("Failed to send telemetry event: {}", e);
            }
        }
        
        Ok(state.current_volatility)
    }
    
    /// Get volatility for a symbol
    pub async fn get_volatility(&self, symbol: &str) -> Result<f64, TradeSizerError> {
        let states = self.symbol_states.read().await;
        
        match states.get(symbol) {
            Some(state) => Ok(state.current_volatility),
            None => Err(TradeSizerError::SymbolNotFound(symbol.to_string())),
        }
    }
    
    /// Get or create state for a symbol
    async fn get_or_create_state(&self, symbol: &str) -> SymbolState {
        let mut states = self.symbol_states.write().await;
        
        match states.get(symbol) {
            Some(state) => state.clone(),
            None => {
                let state = SymbolState::new(symbol);
                states.insert(symbol.to_string(), state.clone());
                state
            }
        }
    }
    
    /// Calculate volatility from a series of returns
    fn calculate_volatility(&self, returns: &[f64]) -> Result<f64, TradeSizerError> {
        if returns.len() < 2 {
            return Err(TradeSizerError::InsufficientData(
                "Need at least 2 data points to calculate volatility".to_string(),
            ));
        }
        
        // Calculate mean
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        
        // Calculate variance
        let variance = returns
            .iter()
            .map(|r| (r - mean).powi(2))
            .sum::<f64>() / (returns.len() - 1) as f64;
        
        // Return standard deviation
        Ok(variance.sqrt())
    }
    
    /// Calculate volatility factor for sizing
    fn calculate_volatility_factor(&self, volatility: f64, config: &TradeSizerConfig) -> f64 {
        f64::min(1.0, volatility / config.max_volatility_threshold)
    }
    
    /// Log sizing decision
    async fn log_sizing(
        &self,
        symbol: &str,
        base_size: f64,
        size_factor: f64,
        final_size: f64,
        volatility: f64,
        config: &TradeSizerConfig,
    ) {
        if !config.enable_logging {
            return;
        }
        
        let log_entry = SizingLogEntry {
            timestamp: unix_timestamp_ms(),
            symbol: symbol.to_string(),
            base_size,
            size_factor,
            final_size,
            volatility,
        };
        
        match serde_json::to_string(&log_entry) {
            Ok(log_str) => {
                match OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&config.log_file_path)
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
                error!("Failed to serialize log entry: {}", e);
            }
        }
    }
    
    /// Clear all data for a symbol
    pub async fn clear_symbol_data(&self, symbol: &str) {
        let mut states = self.symbol_states.write().await;
        states.remove(symbol);
    }
    
    /// Get all tracked symbols
    pub async fn get_tracked_symbols(&self) -> Vec<String> {
        let states = self.symbol_states.read().await;
        states.keys().cloned().collect()
    }
    
    /// Get volatility summary for all symbols
    pub async fn get_volatility_summary(&self) -> HashMap<String, f64> {
        let states = self.symbol_states.read().await;
        states.iter().map(|(k, v)| (k.clone(), v.current_volatility)).collect()
    }
}

/// Get current Unix timestamp in milliseconds
fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    
    #[tokio::test]
    async fn test_volatility_calculation() {
        let sizer = DynamicTradeSizer::new();
        
        // Generate synthetic price data
        let prices = vec![100.0, 102.0, 101.0, 103.0, 102.5, 104.0, 105.0, 103.0];
        
        for price in &prices {
            sizer.update_volatility("TEST", *price, None).await.unwrap();
        }
        
        let volatility = sizer.get_volatility("TEST").await.unwrap();
        assert!(volatility > 0.0, "Volatility should be positive");
        
        // Verify returns calculation
        let states = sizer.symbol_states.read().await;
        let state = states.get("TEST").unwrap();
        
        assert_eq!(state.recent_returns.len(), prices.len() - 1);
    }
    
    #[tokio::test]
    async fn test_position_sizing() {
        let config = TradeSizerConfig {
            base_size: 1.0,
            max_volatility_threshold: 0.05,
            min_size_factor: 0.1,
            max_size_factor: 1.0,
            enable_logging: false,
            ..Default::default()
        };
        
        let sizer = DynamicTradeSizer::with_config(config);
        
        // Manually set volatility
        {
            let mut states = sizer.symbol_states.write().await;
            let state = states
                .entry("TEST".to_string())
                .or_insert_with(|| SymbolState::new("TEST"));
                
            // Set to 2.5% volatility (50% of threshold)
            state.current_volatility = 0.025;
        }
        
        let size = sizer.calculate_position_size("TEST", 100.0).await.unwrap();
        
        // Expected size factor = 1.0 - (0.025 / 0.05) = 0.5
        // Expected size = 100.0 * 0.5 = 50.0
        assert!(
            (size - 50.0).abs() < 0.001,
            "Size should be 50.0, got {}",
            size
        );
        
        // Test with high volatility
        {
            let mut states = sizer.symbol_states.write().await;
            let state = states.get_mut("TEST").unwrap();
            
            // Set to 10% volatility (200% of threshold)
            state.current_volatility = 0.1;
        }
        
        let size = sizer.calculate_position_size("TEST", 100.0).await.unwrap();
        
        // Expected size factor = min_size_factor = 0.1
        // Expected size = 100.0 * 0.1 = 10.0
        assert!(
            (size - 10.0).abs() < 0.001,
            "Size should be 10.0, got {}",
            size
        );
    }
} 