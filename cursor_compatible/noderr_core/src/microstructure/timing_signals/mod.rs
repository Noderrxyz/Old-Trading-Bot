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

//! Execution Timing Signals
//!
//! This module provides tools for timing trades based on microstructure signals,
//! such as order flow, liquidity changes, and short-term patterns.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

use crate::market::{MarketData, Symbol, Orderbook};
use crate::redis::{RedisClient, RedisClientResult};
use crate::microstructure::order_flow::{OrderFlowMetrics, OrderFlowAnalyzer};
use crate::microstructure::liquidity::{LiquiditySnapshot, LiquidityProfiler};

/// Error types for timing signals
#[derive(Debug, Error)]
pub enum TimingSignalError {
    #[error("Redis error: {0}")]
    Redis(String),
    
    #[error("Symbol not found: {0}")]
    SymbolNotFound(String),
    
    #[error("Invalid data: {0}")]
    InvalidData(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for timing signals
pub type TimingSignalResult<T> = Result<T, TimingSignalError>;

/// Confidence level for a timing signal
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalConfidence {
    /// Very high confidence (>90%)
    VeryHigh,
    
    /// High confidence (70-90%)
    High,
    
    /// Medium confidence (50-70%)
    Medium,
    
    /// Low confidence (30-50%)
    Low,
    
    /// Very low confidence (<30%)
    VeryLow,
}

impl SignalConfidence {
    /// Convert confidence to a numerical value (0-1)
    pub fn to_value(&self) -> f64 {
        match self {
            Self::VeryHigh => 0.95,
            Self::High => 0.80,
            Self::Medium => 0.60,
            Self::Low => 0.40,
            Self::VeryLow => 0.20,
        }
    }
    
    /// Create from a numerical value
    pub fn from_value(value: f64) -> Self {
        if value >= 0.9 {
            Self::VeryHigh
        } else if value >= 0.7 {
            Self::High
        } else if value >= 0.5 {
            Self::Medium
        } else if value >= 0.3 {
            Self::Low
        } else {
            Self::VeryLow
        }
    }
}

/// Types of timing signals
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalType {
    /// Delta flipped positive (buying pressure)
    DeltaFlip,
    
    /// Spread tightening
    SpreadTightening,
    
    /// Liquidity vacuum (rapid removal of liquidity)
    LiquidityVacuum,
    
    /// Momentum surge
    MomentumSurge,
    
    /// Order book imbalance
    OrderbookImbalance,
    
    /// Bidding competition
    BiddingCompetition,
    
    /// Resistance broken
    ResistanceBreak,
    
    /// Support broken
    SupportBreak,
    
    /// Major level crossed
    MajorLevelCross,
    
    /// Spoofing detected, delay trade
    SpoofingSuspected,
}

/// A timing signal for trade execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionTimingSignal {
    /// Symbol this signal applies to
    pub symbol: Symbol,
    
    /// Type of signal
    pub signal_type: SignalType,
    
    /// Timestamp when signal occurred
    pub timestamp: DateTime<Utc>,
    
    /// Confidence level
    pub confidence: SignalConfidence,
    
    /// Direction (buy or sell)
    pub is_buy: bool,
    
    /// Price when signal occurred
    pub price: f64,
    
    /// Expected price movement direction (1 = up, -1 = down, 0 = neutral)
    pub expected_direction: i8,
    
    /// Time window this signal is valid for (seconds)
    pub valid_for_sec: u64,
    
    /// Primary trigger for this signal
    pub trigger: String,
    
    /// Additional context data
    pub context: HashMap<String, f64>,
}

impl ExecutionTimingSignal {
    /// Create a new execution timing signal
    pub fn new(
        symbol: Symbol,
        signal_type: SignalType,
        confidence: SignalConfidence,
        is_buy: bool,
        price: f64,
    ) -> Self {
        Self {
            symbol,
            signal_type,
            timestamp: Utc::now(),
            confidence,
            is_buy,
            price,
            expected_direction: if is_buy { 1 } else { -1 },
            valid_for_sec: 60, // Default 1 minute
            trigger: signal_type.to_string(),
            context: HashMap::new(),
        }
    }
    
    /// Add context data
    pub fn with_context(mut self, key: &str, value: f64) -> Self {
        self.context.insert(key.to_string(), value);
        self
    }
    
    /// Set validity period
    pub fn with_validity(mut self, valid_for_sec: u64) -> Self {
        self.valid_for_sec = valid_for_sec;
        self
    }
    
    /// Set expected direction
    pub fn with_expected_direction(mut self, direction: i8) -> Self {
        self.expected_direction = direction;
        self
    }
    
    /// Set trigger description
    pub fn with_trigger(mut self, trigger: &str) -> Self {
        self.trigger = trigger.to_string();
        self
    }
    
    /// Is the signal still valid?
    pub fn is_valid(&self) -> bool {
        let now = Utc::now();
        let age = now.timestamp() - self.timestamp.timestamp();
        age < self.valid_for_sec as i64
    }
    
    /// Get seconds until expiration
    pub fn seconds_until_expiry(&self) -> i64 {
        let now = Utc::now();
        let age = now.timestamp() - self.timestamp.timestamp();
        let remaining = self.valid_for_sec as i64 - age;
        remaining.max(0)
    }
}

impl std::fmt::Display for SignalType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DeltaFlip => write!(f, "DeltaFlip"),
            Self::SpreadTightening => write!(f, "SpreadTightening"),
            Self::LiquidityVacuum => write!(f, "LiquidityVacuum"),
            Self::MomentumSurge => write!(f, "MomentumSurge"),
            Self::OrderbookImbalance => write!(f, "OrderbookImbalance"),
            Self::BiddingCompetition => write!(f, "BiddingCompetition"),
            Self::ResistanceBreak => write!(f, "ResistanceBreak"),
            Self::SupportBreak => write!(f, "SupportBreak"),
            Self::MajorLevelCross => write!(f, "MajorLevelCross"),
            Self::SpoofingSuspected => write!(f, "SpoofingSuspected"),
        }
    }
}

/// Configuration for the timing signal engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimingSignalConfig {
    /// Minimum confidence threshold to generate signals
    pub min_confidence_threshold: f64,
    
    /// Feature weights for different components
    pub feature_weights: HashMap<String, f64>,
    
    /// Delta flip threshold
    pub delta_flip_threshold: f64,
    
    /// Spread tightening percentage threshold
    pub spread_tightening_threshold: f64,
    
    /// Orderbook imbalance threshold
    pub imbalance_threshold: f64,
    
    /// Liquidity vacuum detection threshold
    pub liquidity_vacuum_threshold: f64,
    
    /// Whether to enable spoofing detection
    pub detect_spoofing: bool,
    
    /// Lookback window for pattern recognition (seconds)
    pub pattern_lookback_sec: u64,
    
    /// Default validity period for signals (seconds)
    pub default_validity_sec: u64,
}

impl Default for TimingSignalConfig {
    fn default() -> Self {
        let mut weights = HashMap::new();
        weights.insert("orderflow".to_string(), 0.4);
        weights.insert("liquidity".to_string(), 0.3);
        weights.insert("levels".to_string(), 0.2);
        weights.insert("spoofing".to_string(), 0.1);
        
        Self {
            min_confidence_threshold: 0.6,
            feature_weights: weights,
            delta_flip_threshold: 0.3,
            spread_tightening_threshold: 0.2,
            imbalance_threshold: 0.7,
            liquidity_vacuum_threshold: 0.5,
            detect_spoofing: true,
            pattern_lookback_sec: 300, // 5 minutes
            default_validity_sec: 60,   // 1 minute
        }
    }
}

/// Interface for execution timing signals
#[async_trait::async_trait]
pub trait TimingSignalEngine: Send + Sync {
    /// Process market data to detect timing signals
    async fn process_market_data(&self, market_data: &MarketData) -> TimingSignalResult<Vec<ExecutionTimingSignal>>;
    
    /// Get active signals for a symbol
    async fn get_active_signals(&self, symbol: &Symbol) -> TimingSignalResult<Vec<ExecutionTimingSignal>>;
    
    /// Check if a good time to execute
    async fn is_good_time_to_execute(
        &self,
        symbol: &Symbol,
        is_buy: bool,
    ) -> TimingSignalResult<(bool, Option<ExecutionTimingSignal>)>;
    
    /// Get recent signals for a symbol
    async fn get_recent_signals(
        &self,
        symbol: &Symbol,
        limit: Option<usize>,
    ) -> TimingSignalResult<Vec<ExecutionTimingSignal>>;
    
    /// Reset signals for a symbol
    async fn reset(&self, symbol: &Symbol) -> TimingSignalResult<()>;
    
    /// Get configuration
    fn get_config(&self) -> &TimingSignalConfig;
    
    /// Update configuration
    async fn update_config(&self, config: TimingSignalConfig) -> TimingSignalResult<()>;
}

/// Implementation of TimingSignalEngine
pub struct DefaultTimingSignalEngine {
    /// Redis client for persistence
    redis: Arc<dyn RedisClient>,
    
    /// Configuration
    config: RwLock<TimingSignalConfig>,
    
    /// Order flow analyzer
    order_flow_analyzer: Arc<dyn OrderFlowAnalyzer>,
    
    /// Liquidity profiler
    liquidity_profiler: Arc<dyn LiquidityProfiler>,
    
    /// Active signals by symbol
    active_signals: RwLock<HashMap<Symbol, Vec<ExecutionTimingSignal>>>,
    
    /// Previous market data for comparison
    previous_data: RwLock<HashMap<Symbol, (MarketData, DateTime<Utc>)>>,
}

impl DefaultTimingSignalEngine {
    /// Create a new DefaultTimingSignalEngine
    pub fn new(
        redis: Arc<dyn RedisClient>,
        order_flow_analyzer: Arc<dyn OrderFlowAnalyzer>,
        liquidity_profiler: Arc<dyn LiquidityProfiler>,
    ) -> Self {
        Self {
            redis,
            config: RwLock::new(TimingSignalConfig::default()),
            order_flow_analyzer,
            liquidity_profiler,
            active_signals: RwLock::new(HashMap::new()),
            previous_data: RwLock::new(HashMap::new()),
        }
    }
    
    /// Create with custom config
    pub fn with_config(
        redis: Arc<dyn RedisClient>,
        order_flow_analyzer: Arc<dyn OrderFlowAnalyzer>,
        liquidity_profiler: Arc<dyn LiquidityProfiler>,
        config: TimingSignalConfig,
    ) -> Self {
        Self {
            redis,
            config: RwLock::new(config),
            order_flow_analyzer,
            liquidity_profiler,
            active_signals: RwLock::new(HashMap::new()),
            previous_data: RwLock::new(HashMap::new()),
        }
    }
    
    /// Redis key for signals
    fn signals_key(&self, symbol: &Symbol) -> String {
        format!("micro:timing_signals:{}", symbol)
    }
    
    /// Store signal in Redis
    async fn store_signal(&self, signal: &ExecutionTimingSignal) -> TimingSignalResult<()> {
        let key = self.signals_key(&signal.symbol);
        
        // Get existing signals
        let mut signals: Vec<ExecutionTimingSignal> = match self.redis.get(&key).await {
            Ok(Some(sigs)) => sigs,
            Ok(None) => Vec::new(),
            Err(e) => return Err(TimingSignalError::Redis(e.to_string())),
        };
        
        // Add new signal
        signals.push(signal.clone());
        
        // Sort by timestamp (newest first)
        signals.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        
        // Limit to 100 signals
        if signals.len() > 100 {
            signals.truncate(100);
        }
        
        // Store back
        match self.redis.set(&key, &signals, Some(86400)).await { // 24h TTL
            Ok(_) => Ok(()),
            Err(e) => Err(TimingSignalError::Redis(e.to_string())),
        }
    }
    
    /// Detect delta flip signal
    fn detect_delta_flip(
        &self, 
        symbol: &Symbol,
        current_metrics: &OrderFlowMetrics,
        previous_metrics: Option<&OrderFlowMetrics>,
    ) -> Option<ExecutionTimingSignal> {
        let config = self.config.read().unwrap();
        
        // Need previous metrics for comparison
        let prev_metrics = match previous_metrics {
            Some(m) => m,
            None => return None,
        };
        
        // Check if delta flipped from negative to positive (buy signal)
        if prev_metrics.delta_pct < -config.delta_flip_threshold && 
           current_metrics.delta_pct > config.delta_flip_threshold {
            
            let confidence = (current_metrics.delta_pct - prev_metrics.delta_pct).abs().min(1.0);
            
            return Some(ExecutionTimingSignal::new(
                symbol.clone(),
                SignalType::DeltaFlip,
                SignalConfidence::from_value(confidence),
                true, // buy signal
                current_metrics.vwap,
            ).with_trigger("Delta flipped from negative to positive")
             .with_context("prev_delta", prev_metrics.delta_pct)
             .with_context("current_delta", current_metrics.delta_pct)
             .with_validity(config.default_validity_sec));
        }
        
        // Check if delta flipped from positive to negative (sell signal)
        if prev_metrics.delta_pct > config.delta_flip_threshold && 
           current_metrics.delta_pct < -config.delta_flip_threshold {
            
            let confidence = (current_metrics.delta_pct - prev_metrics.delta_pct).abs().min(1.0);
            
            return Some(ExecutionTimingSignal::new(
                symbol.clone(),
                SignalType::DeltaFlip,
                SignalConfidence::from_value(confidence),
                false, // sell signal
                current_metrics.vwap,
            ).with_trigger("Delta flipped from positive to negative")
             .with_context("prev_delta", prev_metrics.delta_pct)
             .with_context("current_delta", current_metrics.delta_pct)
             .with_validity(config.default_validity_sec));
        }
        
        None
    }
    
    /// Detect spread tightening signal
    fn detect_spread_tightening(
        &self,
        symbol: &Symbol,
        current_data: &MarketData,
        previous_data: Option<&MarketData>,
    ) -> Option<ExecutionTimingSignal> {
        let config = self.config.read().unwrap();
        
        // Need previous data for comparison
        let prev_data = match previous_data {
            Some(d) => d,
            None => return None,
        };
        
        // Get current and previous spread
        let current_spread = current_data.spread_percentage();
        let prev_spread = prev_data.spread_percentage();
        
        // If spread has tightened significantly
        if prev_spread > 0.0 && current_spread > 0.0 {
            let change_pct = (prev_spread - current_spread) / prev_spread;
            
            if change_pct >= config.spread_tightening_threshold {
                // Direction depends on order book imbalance
                let is_buy = if let Some(orderbook) = &current_data.orderbook {
                    if let Some(imbalance) = orderbook.imbalance(5).try_into().ok() {
                        imbalance > 0.0 // Buy if more bids than asks
                    } else {
                        true // Default to buy
                    }
                } else {
                    true // Default to buy
                };
                
                let confidence = (change_pct / 0.5).min(1.0);
                
                return Some(ExecutionTimingSignal::new(
                    symbol.clone(),
                    SignalType::SpreadTightening,
                    SignalConfidence::from_value(confidence),
                    is_buy,
                    current_data.ticker.last,
                ).with_trigger("Spread tightened significantly")
                 .with_context("prev_spread", prev_spread)
                 .with_context("current_spread", current_spread)
                 .with_context("change_pct", change_pct)
                 .with_validity(config.default_validity_sec));
            }
        }
        
        None
    }
    
    /// Detect liquidity vacuum
    fn detect_liquidity_vacuum(
        &self,
        symbol: &Symbol,
        current_snapshot: &LiquiditySnapshot,
        previous_snapshot: Option<&LiquiditySnapshot>,
    ) -> Option<ExecutionTimingSignal> {
        let config = self.config.read().unwrap();
        
        // Need previous data for comparison
        let prev_snapshot = match previous_snapshot {
            Some(s) => s,
            None => return None,
        };
        
        // Check for significant drop in liquidity
        let liquidity_change = (prev_snapshot.depth - current_snapshot.depth) / prev_snapshot.depth;
        
        if liquidity_change > config.liquidity_vacuum_threshold {
            // Direction based on which side lost more liquidity
            let is_buy = current_snapshot.book_skew < 0.0; // More selling pressure, good time to buy
            
            let confidence = (liquidity_change / 0.8).min(1.0);
            
            return Some(ExecutionTimingSignal::new(
                symbol.clone(),
                SignalType::LiquidityVacuum,
                SignalConfidence::from_value(confidence),
                is_buy,
                current_snapshot.spread / 2.0, // Approximation of price
            ).with_trigger("Significant liquidity disappeared")
             .with_context("liquidity_change", liquidity_change)
             .with_context("book_skew", current_snapshot.book_skew)
             .with_validity(config.default_validity_sec / 2)); // Shorter validity for liquidity signals
        }
        
        None
    }
    
    /// Detect orderbook imbalance signal
    fn detect_orderbook_imbalance(
        &self,
        symbol: &Symbol,
        metrics: &OrderFlowMetrics,
    ) -> Option<ExecutionTimingSignal> {
        let config = self.config.read().unwrap();
        
        // Check for strong imbalance
        if metrics.imbalance.normalized.abs() >= config.imbalance_threshold {
            let is_buy = metrics.imbalance.normalized > 0.0; // Positive imbalance = buy
            
            let confidence = (metrics.imbalance.normalized.abs() / 0.9).min(1.0);
            
            return Some(ExecutionTimingSignal::new(
                symbol.clone(),
                SignalType::OrderbookImbalance,
                SignalConfidence::from_value(confidence),
                is_buy,
                metrics.vwap,
            ).with_trigger("Strong orderbook imbalance detected")
             .with_context("imbalance", metrics.imbalance.normalized)
             .with_context("bid_qty", metrics.imbalance.bid_quantity)
             .with_context("ask_qty", metrics.imbalance.ask_quantity)
             .with_validity(config.default_validity_sec));
        }
        
        None
    }
    
    /// Detect spoofing
    fn detect_spoofing(
        &self,
        symbol: &Symbol,
        metrics: &OrderFlowMetrics,
    ) -> Option<ExecutionTimingSignal> {
        let config = self.config.read().unwrap();
        
        if !config.detect_spoofing {
            return None;
        }
        
        // Check for spoofing indicators
        let spoofing_score = metrics.manipulation_indicators
            .get("spoofing")
            .cloned()
            .unwrap_or(0.0);
            
        if spoofing_score > 0.7 {
            // If spoofing detected, signal to delay trade
            return Some(ExecutionTimingSignal::new(
                symbol.clone(),
                SignalType::SpoofingSuspected,
                SignalConfidence::from_value(spoofing_score),
                false, // This is a "don't trade" signal
                metrics.vwap,
            ).with_trigger("Possible spoofing activity detected")
             .with_context("spoofing_score", spoofing_score)
             .with_validity(config.default_validity_sec * 2));
        }
        
        None
    }
    
    /// Clean up expired signals
    fn cleanup_expired_signals(&self, symbol: &Symbol) {
        let mut active_signals = self.active_signals.write().unwrap();
        
        if let Some(signals) = active_signals.get_mut(symbol) {
            signals.retain(|signal| signal.is_valid());
        }
    }
}

#[async_trait::async_trait]
impl TimingSignalEngine for DefaultTimingSignalEngine {
    async fn process_market_data(&self, market_data: &MarketData) -> TimingSignalResult<Vec<ExecutionTimingSignal>> {
        let symbol = market_data.symbol.clone();
        let mut signals = Vec::new();
        
        // Get order flow metrics
        let order_flow_metrics = match self.order_flow_analyzer.process_market_data(market_data).await {
            Ok(metrics) => metrics,
            Err(e) => {
                warn!("Failed to get order flow metrics: {}", e);
                return Err(TimingSignalError::Internal(e.to_string()));
            }
        };
        
        // Get liquidity snapshot
        let liquidity_snapshot = match self.liquidity_profiler.analyze_liquidity(market_data).await {
            Ok(snapshot) => snapshot,
            Err(e) => {
                warn!("Failed to get liquidity snapshot: {}", e);
                return Err(TimingSignalError::Internal(e.to_string()));
            }
        };
        
        // Get previous market data
        let previous_market_data = {
            let prev_data = self.previous_data.read().unwrap();
            prev_data.get(&symbol).map(|(data, _)| data.clone())
        };
        
        // Get previous order flow metrics
        let previous_metrics = match previous_market_data {
            Some(ref prev_data) => {
                match self.order_flow_analyzer.process_market_data(prev_data).await {
                    Ok(metrics) => Some(metrics),
                    Err(_) => None,
                }
            },
            None => None,
        };
        
        // Get previous liquidity snapshot
        let previous_snapshot = match previous_market_data {
            Some(ref prev_data) => {
                match self.liquidity_profiler.analyze_liquidity(prev_data).await {
                    Ok(snapshot) => Some(snapshot),
                    Err(_) => None,
                }
            },
            None => None,
        };
        
        // Detect signals
        if let Some(signal) = self.detect_delta_flip(&symbol, &order_flow_metrics, previous_metrics.as_ref()) {
            signals.push(signal);
        }
        
        if let Some(signal) = self.detect_spread_tightening(&symbol, market_data, previous_market_data.as_ref()) {
            signals.push(signal);
        }
        
        if let Some(signal) = self.detect_liquidity_vacuum(&symbol, &liquidity_snapshot, previous_snapshot.as_ref()) {
            signals.push(signal);
        }
        
        if let Some(signal) = self.detect_orderbook_imbalance(&symbol, &order_flow_metrics) {
            signals.push(signal);
        }
        
        if let Some(signal) = self.detect_spoofing(&symbol, &order_flow_metrics) {
            signals.push(signal);
        }
        
        // Update previous data
        {
            let mut prev_data = self.previous_data.write().unwrap();
            prev_data.insert(symbol.clone(), (market_data.clone(), Utc::now()));
        }
        
        // Store signals
        for signal in &signals {
            // Store in Redis
            let _ = self.store_signal(signal).await;
            
            // Add to active signals
            let mut active_signals = self.active_signals.write().unwrap();
            let symbol_signals = active_signals.entry(symbol.clone()).or_insert_with(Vec::new);
            symbol_signals.push(signal.clone());
        }
        
        // Clean up expired signals
        self.cleanup_expired_signals(&symbol);
        
        Ok(signals)
    }
    
    async fn get_active_signals(&self, symbol: &Symbol) -> TimingSignalResult<Vec<ExecutionTimingSignal>> {
        // Clean up expired signals first
        self.cleanup_expired_signals(symbol);
        
        // Get active signals from cache
        let active_signals = self.active_signals.read().unwrap();
        
        if let Some(signals) = active_signals.get(symbol) {
            Ok(signals.clone())
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn is_good_time_to_execute(
        &self,
        symbol: &Symbol,
        is_buy: bool,
    ) -> TimingSignalResult<(bool, Option<ExecutionTimingSignal>)> {
        // Get active signals
        let signals = self.get_active_signals(symbol).await?;
        
        // Check if there are any spoofing signals (these take precedence)
        for signal in &signals {
            if signal.signal_type == SignalType::SpoofingSuspected && signal.is_valid() {
                return Ok((false, Some(signal.clone())));
            }
        }
        
        // Find the strongest signal in the right direction
        let direction_signals: Vec<_> = signals.iter()
            .filter(|s| s.is_buy == is_buy && s.is_valid())
            .collect();
            
        if !direction_signals.is_empty() {
            // Find the strongest signal
            let strongest = direction_signals.iter()
                .max_by_key(|s| (s.confidence.to_value() * 1000.0) as u64)
                .unwrap();
                
            // If confidence is above threshold, it's a good time
            let config = self.config.read().unwrap();
            if strongest.confidence.to_value() >= config.min_confidence_threshold {
                return Ok((true, Some((*strongest).clone())));
            }
        }
        
        // No strong signals found
        Ok((false, None))
    }
    
    async fn get_recent_signals(
        &self,
        symbol: &Symbol,
        limit: Option<usize>,
    ) -> TimingSignalResult<Vec<ExecutionTimingSignal>> {
        let key = self.signals_key(symbol);
        
        match self.redis.get::<Vec<ExecutionTimingSignal>>(&key).await {
            Ok(Some(mut signals)) => {
                // Apply limit if specified
                if let Some(limit_val) = limit {
                    if signals.len() > limit_val {
                        signals.truncate(limit_val);
                    }
                }
                
                Ok(signals)
            },
            Ok(None) => Ok(Vec::new()),
            Err(e) => Err(TimingSignalError::Redis(e.to_string())),
        }
    }
    
    async fn reset(&self, symbol: &Symbol) -> TimingSignalResult<()> {
        // Clear active signals
        {
            let mut active_signals = self.active_signals.write().unwrap();
            active_signals.remove(symbol);
        }
        
        // Clear previous data
        {
            let mut prev_data = self.previous_data.write().unwrap();
            prev_data.remove(symbol);
        }
        
        // Clear Redis
        match self.redis.delete(&self.signals_key(symbol)).await {
            Ok(_) => Ok(()),
            Err(e) => Err(TimingSignalError::Redis(e.to_string())),
        }
    }
    
    fn get_config(&self) -> &RwLock<TimingSignalConfig> {
        &self.config
    }
    
    async fn update_config(&self, config: TimingSignalConfig) -> TimingSignalResult<()> {
        let mut cfg = self.config.write().unwrap();
        *cfg = config;
        Ok(())
    }
}

/// Create a default timing signal engine
pub fn create_timing_signal_engine(
    redis: Arc<dyn RedisClient>,
    order_flow_analyzer: Arc<dyn OrderFlowAnalyzer>,
    liquidity_profiler: Arc<dyn LiquidityProfiler>,
) -> Arc<dyn TimingSignalEngine> {
    Arc::new(DefaultTimingSignalEngine::new(
        redis,
        order_flow_analyzer,
        liquidity_profiler,
    ))
}

/// Create a timing signal engine with custom configuration
pub fn create_timing_signal_engine_with_config(
    redis: Arc<dyn RedisClient>,
    order_flow_analyzer: Arc<dyn OrderFlowAnalyzer>,
    liquidity_profiler: Arc<dyn LiquidityProfiler>,
    config: TimingSignalConfig,
) -> Arc<dyn TimingSignalEngine> {
    Arc::new(DefaultTimingSignalEngine::with_config(
        redis,
        order_flow_analyzer,
        liquidity_profiler,
        config,
    ))
}

/// Mock implementation for testing
pub struct MockTimingSignalEngine {
    signals: RwLock<HashMap<Symbol, Vec<ExecutionTimingSignal>>>,
    config: TimingSignalConfig,
}

impl MockTimingSignalEngine {
    /// Create a new mock engine
    pub fn new() -> Self {
        Self {
            signals: RwLock::new(HashMap::new()),
            config: TimingSignalConfig::default(),
        }
    }
    
    /// Add a mock signal
    pub fn add_signal(&self, signal: ExecutionTimingSignal) {
        let mut signals = self.signals.write().unwrap();
        let symbol_signals = signals.entry(signal.symbol.clone()).or_insert_with(Vec::new);
        symbol_signals.push(signal);
    }
}

#[async_trait::async_trait]
impl TimingSignalEngine for MockTimingSignalEngine {
    async fn process_market_data(&self, market_data: &MarketData) -> TimingSignalResult<Vec<ExecutionTimingSignal>> {
        // Mock implementation - just return any existing signals
        let signals = self.signals.read().unwrap();
        
        if let Some(symbol_signals) = signals.get(&market_data.symbol) {
            Ok(symbol_signals.clone())
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn get_active_signals(&self, symbol: &Symbol) -> TimingSignalResult<Vec<ExecutionTimingSignal>> {
        let signals = self.signals.read().unwrap();
        
        if let Some(symbol_signals) = signals.get(symbol) {
            // Filter to only active signals
            let active = symbol_signals.iter()
                .filter(|s| s.is_valid())
                .cloned()
                .collect();
                
            Ok(active)
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn is_good_time_to_execute(
        &self,
        symbol: &Symbol,
        is_buy: bool,
    ) -> TimingSignalResult<(bool, Option<ExecutionTimingSignal>)> {
        let signals = self.signals.read().unwrap();
        
        if let Some(symbol_signals) = signals.get(symbol) {
            // Find valid signals in the right direction
            let valid_signals: Vec<_> = symbol_signals.iter()
                .filter(|s| s.is_valid() && s.is_buy == is_buy)
                .collect();
                
            if !valid_signals.is_empty() {
                // Return the first one
                return Ok((true, Some(valid_signals[0].clone())));
            }
        }
        
        Ok((false, None))
    }
    
    async fn get_recent_signals(
        &self,
        symbol: &Symbol,
        limit: Option<usize>,
    ) -> TimingSignalResult<Vec<ExecutionTimingSignal>> {
        let signals = self.signals.read().unwrap();
        
        if let Some(symbol_signals) = signals.get(symbol) {
            let mut result = symbol_signals.clone();
            
            // Sort by timestamp (newest first)
            result.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
            
            // Apply limit
            if let Some(limit_val) = limit {
                if result.len() > limit_val {
                    result.truncate(limit_val);
                }
            }
            
            Ok(result)
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn reset(&self, symbol: &Symbol) -> TimingSignalResult<()> {
        let mut signals = self.signals.write().unwrap();
        signals.remove(symbol);
        Ok(())
    }
    
    fn get_config(&self) -> &TimingSignalConfig {
        &self.config
    }
    
    async fn update_config(&self, _config: TimingSignalConfig) -> TimingSignalResult<()> {
        Ok(())
    }
}

/// Create a mock timing signal engine for testing
pub fn create_mock_timing_signal_engine() -> Arc<dyn TimingSignalEngine> {
    Arc::new(MockTimingSignalEngine::new())
} 