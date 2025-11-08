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

use std::collections::{HashMap, BTreeMap};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use std::fmt;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::broadcast;
use tokio::time;
use tracing::{debug, error, info, warn};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

/// Type alias for trading pair/symbol
pub type Symbol = String;

/// Error types for market data operations
#[derive(Debug, thiserror::Error, Clone, Serialize, Deserialize)]
pub enum MarketDataError {
    /// API-related errors
    #[error("API error: {0}")]
    ApiError(String),
    
    /// Rate limit exceeded
    #[error("Rate limit exceeded, retry after {retry_after_secs} seconds")]
    RateLimitExceeded {
        retry_after_secs: u64,
    },
    
    /// Requested data is not available
    #[error("Data not available: {0}")]
    DataNotAvailable(String),
    
    /// Internal errors
    #[error("Internal error: {0}")]
    Internal(String),
    
    /// Parsing errors
    #[error("Failed to parse data: {0}")]
    ParseError(String),
    
    /// Authentication errors
    #[error("Authentication error: {0}")]
    AuthError(String),
    
    /// Network errors
    #[error("Network error: {0}")]
    NetworkError(String),
}

/// Timeframe for candles
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Timeframe {
    /// 1 minute candles
    Minute1,
    /// 5 minute candles
    Minute5,
    /// 15 minute candles
    Minute15,
    /// 30 minute candles
    Minute30,
    /// 1 hour candles
    Hour1,
    /// 4 hour candles
    Hour4,
    /// 1 day candles
    Day1,
    /// 1 week candles
    Week1,
    /// 1 month candles
    Month1,
}

impl Timeframe {
    /// Convert timeframe to seconds
    pub fn to_seconds(&self) -> i64 {
        match self {
            Timeframe::Minute1 => 60,
            Timeframe::Minute5 => 300,
            Timeframe::Minute15 => 900,
            Timeframe::Minute30 => 1800,
            Timeframe::Hour1 => 3600,
            Timeframe::Hour4 => 14400,
            Timeframe::Day1 => 86400,
            Timeframe::Week1 => 604800,
            Timeframe::Month1 => 2592000, // 30 days approximation
        }
    }
    
    /// Get appropriate timeframe for a given duration
    pub fn from_seconds(seconds: i64) -> Option<Self> {
        match seconds {
            s if s <= 60 => Some(Timeframe::Minute1),
            s if s <= 300 => Some(Timeframe::Minute5),
            s if s <= 900 => Some(Timeframe::Minute15),
            s if s <= 1800 => Some(Timeframe::Minute30),
            s if s <= 3600 => Some(Timeframe::Hour1),
            s if s <= 14400 => Some(Timeframe::Hour4),
            s if s <= 86400 => Some(Timeframe::Day1),
            s if s <= 604800 => Some(Timeframe::Week1),
            s if s <= 2592000 => Some(Timeframe::Month1),
            _ => None,
        }
    }
    
    /// Convert to string representation
    pub fn to_string(&self) -> String {
        match self {
            Timeframe::Minute1 => "1m".to_string(),
            Timeframe::Minute5 => "5m".to_string(),
            Timeframe::Minute15 => "15m".to_string(),
            Timeframe::Minute30 => "30m".to_string(),
            Timeframe::Hour1 => "1h".to_string(),
            Timeframe::Hour4 => "4h".to_string(),
            Timeframe::Day1 => "1d".to_string(),
            Timeframe::Week1 => "1w".to_string(),
            Timeframe::Month1 => "1M".to_string(),
        }
    }
}

impl fmt::Display for Timeframe {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_string())
    }
}

/// Represents a candle/OHLCV bar for a trading pair
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candle {
    /// Opening timestamp of the candle
    pub timestamp: DateTime<Utc>,
    /// Opening price
    pub open: Decimal,
    /// Highest price during the period
    pub high: Decimal,
    /// Lowest price during the period
    pub low: Decimal,
    /// Closing price
    pub close: Decimal,
    /// Trading volume during the period
    pub volume: Decimal,
    /// Optional number of trades
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trade_count: Option<u32>,
    /// Optional volume in quote currency
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_volume: Option<Decimal>,
    /// Optional additional data specific to the exchange or pair
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub extras: HashMap<String, Value>,
}

impl Candle {
    /// Create a new candle with basic OHLCV data
    pub fn new(
        timestamp: DateTime<Utc>,
        open: Decimal,
        high: Decimal,
        low: Decimal,
        close: Decimal,
        volume: Decimal,
    ) -> Self {
        Self {
            timestamp,
            open,
            high,
            low,
            close,
            volume,
            trade_count: None,
            quote_volume: None,
            extras: HashMap::new(),
        }
    }
    
    /// Calculate the body size of the candle (abs of close - open)
    pub fn body_size(&self) -> Decimal {
        (self.close - self.open).abs()
    }
    
    /// Calculate the wick size (high - low)
    pub fn wick_size(&self) -> Decimal {
        self.high - self.low
    }
    
    /// Check if candle is bullish (close > open)
    pub fn is_bullish(&self) -> bool {
        self.close > self.open
    }
    
    /// Calculate percentage change
    pub fn percent_change(&self) -> Decimal {
        if self.open == Decimal::ZERO {
            return Decimal::ZERO;
        }
        (self.close - self.open) * Decimal::from(100) / self.open
    }
    
    /// Check if this candle has higher volatility than the average of previous candles
    pub fn is_volatile(&self, previous_candles: &[Candle], threshold: f64) -> bool {
        if previous_candles.is_empty() {
            return false;
        }
        
        // Calculate average range of previous candles
        let avg_range: Decimal = previous_candles
            .iter()
            .map(|c| c.wick_size())
            .sum::<Decimal>() / Decimal::from(previous_candles.len());
        
        // If this candle's range is significantly larger than average
        self.wick_size() > avg_range * Decimal::from_f64(threshold).unwrap_or(Decimal::from(1.5))
    }
    
    /// Add additional data to the candle
    pub fn with_extra(mut self, key: &str, value: Value) -> Self {
        self.extras.insert(key.to_string(), value);
        self
    }
}

/// Represents a single entry in the orderbook
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderbookEntry {
    /// Price level
    pub price: Decimal,
    /// Quantity available at this price
    pub quantity: Decimal,
    /// Number of orders at this price (if available)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    /// Optional exchange-specific data
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub extras: HashMap<String, Value>,
}

impl OrderbookEntry {
    /// Create a new orderbook entry
    pub fn new(price: Decimal, quantity: Decimal) -> Self {
        Self {
            price,
            quantity,
            count: None,
            extras: HashMap::new(),
        }
    }
    
    /// Create a new orderbook entry with order count
    pub fn with_count(price: Decimal, quantity: Decimal, count: u32) -> Self {
        Self {
            price,
            quantity,
            count: Some(count),
            extras: HashMap::new(),
        }
    }
    
    /// Total value at this price level (price * quantity)
    pub fn value(&self) -> Decimal {
        self.price * self.quantity
    }
    
    /// Add extra data to this entry
    pub fn with_extra(mut self, key: &str, value: Value) -> Self {
        self.extras.insert(key.to_string(), value);
        self
    }
}

/// Represents a market's orderbook with bids and asks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Orderbook {
    /// Buy orders, sorted by price in descending order
    pub bids: Vec<OrderbookEntry>,
    /// Sell orders, sorted by price in ascending order
    pub asks: Vec<OrderbookEntry>,
    /// Last update timestamp
    pub timestamp: DateTime<Utc>,
    /// Market depth as a percentage of total volume
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_pct: Option<f64>,
    /// Exchange-specific sequence number for orderbook updates
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_number: Option<u64>,
    /// Whether this is a partial or full orderbook
    #[serde(default)]
    pub is_partial: bool,
    /// Additional orderbook metadata
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, Value>,
}

impl Orderbook {
    /// Create a new orderbook with the given bids and asks
    pub fn new(bids: Vec<OrderbookEntry>, asks: Vec<OrderbookEntry>) -> Self {
        Self {
            bids,
            asks,
            timestamp: Utc::now(),
            depth_pct: None,
            sequence_number: None,
            is_partial: false,
            metadata: HashMap::new(),
        }
    }
    
    /// Get the best bid price
    pub fn best_bid(&self) -> Option<Decimal> {
        self.bids.first().map(|e| e.price)
    }
    
    /// Get the best ask price
    pub fn best_ask(&self) -> Option<Decimal> {
        self.asks.first().map(|e| e.price)
    }
    
    /// Get the mid price (average of best bid and best ask)
    pub fn mid_price(&self) -> Option<Decimal> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) => Some((bid + ask) / Decimal::from(2)),
            _ => None,
        }
    }
    
    /// Get the spread as an absolute value
    pub fn spread(&self) -> Option<Decimal> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) => Some(ask - bid),
            _ => None,
        }
    }
    
    /// Get the spread as a percentage of the mid price
    pub fn spread_pct(&self) -> Option<f64> {
        match (self.spread(), self.mid_price()) {
            (Some(spread), Some(mid)) if mid > Decimal::ZERO => {
                Some((spread * Decimal::from(100) / mid).to_f64().unwrap_or(0.0))
            }
            _ => None,
        }
    }
    
    /// Calculate liquidity within a certain percentage of the mid price
    pub fn liquidity_at_level(&self, pct_from_mid: f64) -> Decimal {
        let mid = match self.mid_price() {
            Some(price) => price,
            None => return Decimal::ZERO,
        };
        
        let threshold = mid * Decimal::from_f64(1.0 + pct_from_mid / 100.0).unwrap_or(Decimal::ONE);
        let lower_threshold = mid * Decimal::from_f64(1.0 - pct_from_mid / 100.0).unwrap_or(Decimal::ONE);
        
        // Sum all bid quantities where price >= lower_threshold
        let bid_liquidity: Decimal = self.bids
            .iter()
            .filter(|entry| entry.price >= lower_threshold)
            .map(|entry| entry.quantity)
            .sum();
        
        // Sum all ask quantities where price <= threshold
        let ask_liquidity: Decimal = self.asks
            .iter()
            .filter(|entry| entry.price <= threshold)
            .map(|entry| entry.quantity)
            .sum();
        
        bid_liquidity + ask_liquidity
    }
    
    /// Calculate imbalance between bids and asks (positive = more bids, negative = more asks)
    pub fn imbalance(&self, depth: usize) -> f64 {
        let bid_volume: Decimal = self.bids.iter().take(depth).map(|e| e.quantity).sum();
        let ask_volume: Decimal = self.asks.iter().take(depth).map(|e| e.quantity).sum();
        
        let total = bid_volume + ask_volume;
        if total == Decimal::ZERO {
            return 0.0;
        }
        
        ((bid_volume - ask_volume) / total).to_f64().unwrap_or(0.0)
    }
    
    /// Calculate buying pressure (ratio of bid to ask volume within top N levels)
    pub fn buying_pressure(&self, depth: usize) -> f64 {
        let bid_volume: Decimal = self.bids.iter().take(depth).map(|e| e.quantity).sum();
        let ask_volume: Decimal = self.asks.iter().take(depth).map(|e| e.quantity).sum();
        
        if ask_volume == Decimal::ZERO {
            return 0.0;
        }
        
        (bid_volume / ask_volume).to_f64().unwrap_or(0.0)
    }
    
    /// Sort the orderbook entries in the correct order (bids descending, asks ascending)
    pub fn sort(&mut self) {
        self.bids.sort_by(|a, b| b.price.cmp(&a.price));
        self.asks.sort_by(|a, b| a.price.cmp(&b.price));
    }
    
    /// Add or update a bid
    pub fn add_bid(&mut self, entry: OrderbookEntry) {
        // Check if we need to update an existing level
        for existing in &mut self.bids {
            if existing.price == entry.price {
                *existing = entry;
                self.sort();
                return;
            }
        }
        
        // Add new level
        self.bids.push(entry);
        self.sort();
    }
    
    /// Add or update an ask
    pub fn add_ask(&mut self, entry: OrderbookEntry) {
        // Check if we need to update an existing level
        for existing in &mut self.asks {
            if existing.price == entry.price {
                *existing = entry;
                self.sort();
                return;
            }
        }
        
        // Add new level
        self.asks.push(entry);
        self.sort();
    }
    
    /// Calculate total bid value up to a specific depth
    pub fn total_bid_value(&self, depth: usize) -> Decimal {
        self.bids.iter().take(depth).map(|e| e.value()).sum()
    }
    
    /// Calculate total ask value up to a specific depth
    pub fn total_ask_value(&self, depth: usize) -> Decimal {
        self.asks.iter().take(depth).map(|e| e.value()).sum()
    }
}

/// Technical indicators calculated from market data
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TechnicalIndicators {
    /// Moving Average Convergence Divergence values
    pub macd: Option<(f64, f64, f64)>, // (MACD line, signal line, histogram)
    /// Relative Strength Index (0-100)
    pub rsi: Option<f64>,
    /// Bollinger Bands (lower, middle, upper)
    pub bollinger_bands: Option<(f64, f64, f64)>,
    /// Simple Moving Averages for different periods
    pub sma: HashMap<u32, f64>,
    /// Exponential Moving Averages for different periods
    pub ema: HashMap<u32, f64>,
    /// Average True Range - volatility indicator
    pub atr: Option<f64>,
    /// Stochastic Oscillator (K%, D%)
    pub stoch: Option<(f64, f64)>,
    /// On-Balance Volume
    pub obv: Option<f64>,
    /// Ichimoku Cloud components (conversion, base, leading_span_a, leading_span_b, lagging_span)
    pub ichimoku: Option<(f64, f64, f64, f64, f64)>,
    /// Custom indicators that don't fit into predefined categories
    pub custom: HashMap<String, f64>,
}

impl TechnicalIndicators {
    /// Create a new empty set of technical indicators
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Check if an indicator suggests an overbought condition
    pub fn is_overbought(&self) -> bool {
        if let Some(rsi) = self.rsi {
            if rsi > 70.0 {
                return true;
            }
        }
        
        if let Some((_, _, histogram)) = self.macd {
            if histogram < -0.5 {
                return true;
            }
        }
        
        if let Some((k, d)) = self.stoch {
            if k > 80.0 && d > 80.0 {
                return true;
            }
        }
        
        false
    }
    
    /// Check if an indicator suggests an oversold condition
    pub fn is_oversold(&self) -> bool {
        if let Some(rsi) = self.rsi {
            if rsi < 30.0 {
                return true;
            }
        }
        
        if let Some((_, _, histogram)) = self.macd {
            if histogram > 0.5 {
                return true;
            }
        }
        
        if let Some((k, d)) = self.stoch {
            if k < 20.0 && d < 20.0 {
                return true;
            }
        }
        
        false
    }
    
    /// Get trend direction based on moving averages
    pub fn trend_direction(&self) -> Option<String> {
        if self.sma.contains_key(&50) && self.sma.contains_key(&200) {
            let sma_50 = self.sma[&50];
            let sma_200 = self.sma[&200];
            
            if sma_50 > sma_200 {
                return Some("bullish".to_string());
            } else if sma_50 < sma_200 {
                return Some("bearish".to_string());
            } else {
                return Some("neutral".to_string());
            }
        }
        
        None
    }
    
    /// Get volatility level based on Bollinger Bands and ATR
    pub fn volatility_level(&self) -> Option<String> {
        if let Some((lower, middle, upper)) = self.bollinger_bands {
            let band_width = (upper - lower) / middle;
            
            if band_width > 0.1 {
                return Some("high".to_string());
            } else if band_width > 0.05 {
                return Some("medium".to_string());
            } else {
                return Some("low".to_string());
            }
        }
        
        None
    }
    
    /// Add a Simple Moving Average with the specified period
    pub fn add_sma(&mut self, period: u32, value: f64) {
        self.sma.insert(period, value);
    }
    
    /// Add an Exponential Moving Average with the specified period
    pub fn add_ema(&mut self, period: u32, value: f64) {
        self.ema.insert(period, value);
    }
    
    /// Add a custom indicator
    pub fn add_custom(&mut self, name: &str, value: f64) {
        self.custom.insert(name.to_string(), value);
    }
    
    /// Merge this set of indicators with another, preferring the other's values when both exist
    pub fn merge(&mut self, other: &TechnicalIndicators) {
        if other.macd.is_some() {
            self.macd = other.macd;
        }
        
        if other.rsi.is_some() {
            self.rsi = other.rsi;
        }
        
        if other.bollinger_bands.is_some() {
            self.bollinger_bands = other.bollinger_bands;
        }
        
        if other.atr.is_some() {
            self.atr = other.atr;
        }
        
        if other.stoch.is_some() {
            self.stoch = other.stoch;
        }
        
        if other.obv.is_some() {
            self.obv = other.obv;
        }
        
        if other.ichimoku.is_some() {
            self.ichimoku = other.ichimoku;
        }
        
        for (period, value) in &other.sma {
            self.sma.insert(*period, *value);
        }
        
        for (period, value) in &other.ema {
            self.ema.insert(*period, *value);
        }
        
        for (name, value) in &other.custom {
            self.custom.insert(name.clone(), *value);
        }
    }
}

/// Market sentiment analysis data
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MarketSentiment {
    /// Overall sentiment score (-1.0 to 1.0, where -1 is very bearish, 1 is very bullish)
    pub score: f64,
    /// Confidence level of the sentiment (0.0 to 1.0)
    pub confidence: f64,
    /// Volume of social media mentions
    pub social_volume: Option<u32>,
    /// Social sentiment score (-1.0 to 1.0)
    pub social_sentiment: Option<f64>,
    /// News sentiment score (-1.0 to 1.0)
    pub news_sentiment: Option<f64>,
    /// Options put/call ratio
    pub put_call_ratio: Option<f64>,
    /// Long/short ratio from exchange data
    pub long_short_ratio: Option<f64>,
    /// Fear and greed index (0-100)
    pub fear_greed_index: Option<u32>,
    /// Timestamp when sentiment was measured
    pub timestamp: i64,
    /// Custom sentiment metrics that don't fit into predefined categories
    pub custom_metrics: HashMap<String, f64>,
}

impl MarketSentiment {
    /// Create new sentiment data with basic required fields
    pub fn new(score: f64, confidence: f64) -> Self {
        Self {
            score,
            confidence,
            timestamp: chrono::Utc::now().timestamp(),
            ..Default::default()
        }
    }
    
    /// Check if sentiment is strongly bullish
    pub fn is_strongly_bullish(&self) -> bool {
        self.score > 0.6 && self.confidence > 0.7
    }
    
    /// Check if sentiment is strongly bearish
    pub fn is_strongly_bearish(&self) -> bool {
        self.score < -0.6 && self.confidence > 0.7
    }
    
    /// Get sentiment category as a string
    pub fn category(&self) -> &str {
        if self.score < -0.6 {
            "very_bearish"
        } else if self.score < -0.2 {
            "bearish"
        } else if self.score <= 0.2 {
            "neutral"
        } else if self.score <= 0.6 {
            "bullish"
        } else {
            "very_bullish"
        }
    }
    
    /// Check if this sentiment data is recent (within last hour)
    pub fn is_recent(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        now - self.timestamp < 3600
    }
    
    /// Calculate sentiment divergence from price action (positive means sentiment more bullish than price)
    pub fn divergence_from_price(&self, price_change_pct: f64) -> f64 {
        // Normalize price change to -1 to 1 scale for comparison
        let normalized_price = price_change_pct.max(-1.0).min(1.0);
        self.score - normalized_price
    }
    
    /// Add a custom sentiment metric
    pub fn add_custom_metric(&mut self, name: &str, value: f64) {
        self.custom_metrics.insert(name.to_string(), value);
    }
    
    /// Create a weighted average of two sentiment objects
    pub fn weighted_average(a: &Self, b: &Self, a_weight: f64) -> Self {
        let b_weight = 1.0 - a_weight;
        let weighted_score = a.score * a_weight + b.score * b_weight;
        let weighted_confidence = a.confidence * a_weight + b.confidence * b_weight;
        
        // For optional fields, prefer the one with data if only one has it
        let social_volume = match (a.social_volume, b.social_volume) {
            (Some(a_vol), Some(b_vol)) => Some((a_vol as f64 * a_weight + b_vol as f64 * b_weight) as u32),
            (Some(vol), None) => Some(vol),
            (None, Some(vol)) => Some(vol),
            (None, None) => None,
        };
        
        let social_sentiment = weighted_optional(a.social_sentiment, b.social_sentiment, a_weight);
        let news_sentiment = weighted_optional(a.news_sentiment, b.news_sentiment, a_weight);
        let put_call_ratio = weighted_optional(a.put_call_ratio, b.put_call_ratio, a_weight);
        let long_short_ratio = weighted_optional(a.long_short_ratio, b.long_short_ratio, a_weight);
        
        let fear_greed_index = match (a.fear_greed_index, b.fear_greed_index) {
            (Some(a_fgi), Some(b_fgi)) => Some((a_fgi as f64 * a_weight + b_fgi as f64 * b_weight) as u32),
            (Some(fgi), None) => Some(fgi),
            (None, Some(fgi)) => Some(fgi),
            (None, None) => None,
        };
        
        // Timestamp should be the most recent one
        let timestamp = a.timestamp.max(b.timestamp);
        
        // Merge custom metrics
        let mut custom_metrics = a.custom_metrics.clone();
        for (key, b_value) in &b.custom_metrics {
            match custom_metrics.get_mut(key) {
                Some(a_value) => {
                    *a_value = *a_value * a_weight + b_value * b_weight;
                }
                None => {
                    custom_metrics.insert(key.clone(), *b_value);
                }
            }
        }
        
        Self {
            score: weighted_score,
            confidence: weighted_confidence,
            social_volume,
            social_sentiment,
            news_sentiment,
            put_call_ratio,
            long_short_ratio,
            fear_greed_index,
            timestamp,
            custom_metrics,
        }
    }
}

/// Helper function for weighted average of optional values
fn weighted_optional(a: Option<f64>, b: Option<f64>, a_weight: f64) -> Option<f64> {
    match (a, b) {
        (Some(a_val), Some(b_val)) => Some(a_val * a_weight + b_val * (1.0 - a_weight)),
        (Some(val), None) => Some(val),
        (None, Some(val)) => Some(val),
        (None, None) => None,
    }
}

/// Exchange-specific information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeInfo {
    /// Exchange identifier
    pub exchange_id: String,
    /// Current price on this exchange
    pub price: f64,
    /// 24h volume on this exchange
    pub volume_24h: f64,
    /// Bid price on this exchange
    pub bid: Option<f64>,
    /// Ask price on this exchange
    pub ask: Option<f64>,
    /// Timestamp of this data
    pub timestamp: DateTime<Utc>,
    /// Additional exchange-specific data
    #[serde(default)]
    pub extras: HashMap<String, Value>,
}

/// Comprehensive market data for a trading pair/symbol
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketData {
    /// Exchange identifier
    pub exchange: String,
    /// Trading pair (e.g., "BTC/USDT")
    pub symbol: String,
    /// Current ticker data
    pub ticker: Ticker,
    /// Current orderbook snapshot
    pub orderbook: Option<Orderbook>,
    /// Recent candles at different timeframes
    pub candles: HashMap<String, Vec<Candle>>,
    /// Technical indicators calculated from candle data
    pub indicators: TechnicalIndicators,
    /// Market sentiment data
    pub sentiment: Option<MarketSentiment>,
    /// Timestamp when this data was last updated
    pub last_updated: i64,
    /// Data source (e.g., "realtime", "cached", "simulated")
    pub source: String,
}

/// Ticker information for a trading pair
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ticker {
    /// Current best bid price
    pub bid: f64,
    /// Current best ask price
    pub ask: f64,
    /// Last trade price
    pub last: f64,
    /// 24h volume in base currency
    pub volume: f64,
    /// 24h price change percentage
    pub change_24h: f64,
    /// 24h high price
    pub high_24h: f64,
    /// 24h low price
    pub low_24h: f64,
    /// Total 24h quote currency volume
    pub quote_volume: f64,
}

impl MarketData {
    /// Create a new MarketData instance with required fields
    pub fn new(exchange: String, symbol: String, ticker: Ticker) -> Self {
        Self {
            exchange,
            symbol,
            ticker,
            orderbook: None,
            candles: HashMap::new(),
            indicators: TechnicalIndicators::new(),
            sentiment: None,
            last_updated: chrono::Utc::now().timestamp(),
            source: "realtime".to_string(),
        }
    }
    
    /// Get current mid price ((bid + ask) / 2)
    pub fn mid_price(&self) -> f64 {
        (self.ticker.bid + self.ticker.ask) / 2.0
    }
    
    /// Get current spread as a percentage
    pub fn spread_percentage(&self) -> f64 {
        if self.ticker.bid == 0.0 {
            return 0.0;
        }
        ((self.ticker.ask - self.ticker.bid) / self.ticker.bid) * 100.0
    }
    
    /// Check if this market data is recent (within last minute)
    pub fn is_recent(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        now - self.last_updated < 60
    }
    
    /// Get the latest candle for a specific timeframe
    pub fn latest_candle(&self, timeframe: &str) -> Option<&Candle> {
        self.candles.get(timeframe)?.last()
    }
    
    /// Add candles for a specific timeframe
    pub fn add_candles(&mut self, timeframe: &str, new_candles: Vec<Candle>) {
        if let Some(existing) = self.candles.get_mut(timeframe) {
            // Filter out candles that we already have
            let last_timestamp = existing.last().map(|c| c.timestamp).unwrap_or(0);
            let filtered = new_candles.into_iter()
                .filter(|c| c.timestamp > last_timestamp)
                .collect::<Vec<_>>();
            
            existing.extend(filtered);
        } else {
            self.candles.insert(timeframe.to_string(), new_candles);
        }
        self.last_updated = chrono::Utc::now().timestamp();
    }
    
    /// Update ticker data
    pub fn update_ticker(&mut self, ticker: Ticker) {
        self.ticker = ticker;
        self.last_updated = chrono::Utc::now().timestamp();
    }
    
    /// Update orderbook
    pub fn update_orderbook(&mut self, orderbook: Orderbook) {
        self.orderbook = Some(orderbook);
        self.last_updated = chrono::Utc::now().timestamp();
    }
    
    /// Update technical indicators
    pub fn update_indicators(&mut self, indicators: TechnicalIndicators) {
        self.indicators = indicators;
        self.last_updated = chrono::Utc::now().timestamp();
    }
    
    /// Update market sentiment
    pub fn update_sentiment(&mut self, sentiment: MarketSentiment) {
        self.sentiment = Some(sentiment);
        self.last_updated = chrono::Utc::now().timestamp();
    }
    
    /// Get market trend based on indicators and sentiment
    pub fn market_trend(&self) -> Option<String> {
        // First check if we have an indicator-based trend
        if let Some(indicator_trend) = self.indicators.trend_direction() {
            // If we have sentiment data and it strongly contradicts indicators, note the divergence
            if let Some(sentiment) = &self.sentiment {
                if sentiment.confidence > 0.8 {
                    if indicator_trend == "bullish" && sentiment.score < -0.7 {
                        return Some("bullish_with_bearish_sentiment".to_string());
                    }
                    if indicator_trend == "bearish" && sentiment.score > 0.7 {
                        return Some("bearish_with_bullish_sentiment".to_string());
                    }
                }
            }
            return Some(indicator_trend);
        }
        
        // Fall back to sentiment if available
        if let Some(sentiment) = &self.sentiment {
            if sentiment.confidence > 0.7 {
                if sentiment.score > 0.5 {
                    return Some("sentiment_bullish".to_string());
                } else if sentiment.score < -0.5 {
                    return Some("sentiment_bearish".to_string());
                }
            }
        }
        
        // If no clear signals, check simple price action
        if self.ticker.change_24h > 5.0 {
            return Some("price_bullish".to_string());
        } else if self.ticker.change_24h < -5.0 {
            return Some("price_bearish".to_string());
        }
        
        Some("neutral".to_string())
    }
    
    /// Check if market is highly volatile
    pub fn is_volatile(&self) -> bool {
        // Check ATR indicator if available
        if let Some(atr) = self.indicators.atr {
            let atr_percentage = atr / self.mid_price() * 100.0;
            if atr_percentage > 2.0 {
                return true;
            }
        }
        
        // Check recent price range
        let high_low_range = ((self.ticker.high_24h - self.ticker.low_24h) / self.mid_price()) * 100.0;
        if high_low_range > 5.0 {
            return true;
        }
        
        // Check spread
        if self.spread_percentage() > 0.5 {
            return true;
        }
        
        false
    }
    
    /// Get current market liquidity assessment based on orderbook depth
    pub fn liquidity_assessment(&self) -> String {
        if let Some(orderbook) = &self.orderbook {
            let bid_depth: f64 = orderbook.bids.iter()
                .take(10)
                .map(|(_, qty)| qty)
                .sum();
                
            let ask_depth: f64 = orderbook.asks.iter()
                .take(10)
                .map(|(_, qty)| qty)
                .sum();
                
            let total_depth = bid_depth + ask_depth;
            
            // Thresholds would depend on the specific market
            if total_depth > 1000.0 {
                return "high".to_string();
            } else if total_depth > 100.0 {
                return "medium".to_string();
            } else {
                return "low".to_string();
            }
        }
        
        // If no orderbook data available
        "unknown".to_string()
    }
    
    /// Create a copy with a different data source
    pub fn with_source(mut self, source: &str) -> Self {
        self.source = source.to_string();
        self
    }
    
    /// Merge this market data with another, preferring the more recent data
    pub fn merge(&mut self, other: &MarketData) {
        // Only merge if we're dealing with the same market
        if self.exchange != other.exchange || self.symbol != other.symbol {
            return;
        }
        
        // Always prefer the more recent data
        if other.last_updated > self.last_updated {
            self.ticker = other.ticker.clone();
            self.source = other.source.clone();
            self.last_updated = other.last_updated;
            
            if other.orderbook.is_some() {
                self.orderbook = other.orderbook.clone();
            }
        }
        
        // Merge candles from both sources
        for (timeframe, other_candles) in &other.candles {
            if let Some(our_candles) = self.candles.get_mut(timeframe) {
                // Find unique candles from the other source
                let our_timestamps: HashSet<i64> = our_candles.iter()
                    .map(|c| c.timestamp)
                    .collect();
                
                let unique_candles: Vec<Candle> = other_candles.iter()
                    .filter(|c| !our_timestamps.contains(&c.timestamp))
                    .cloned()
                    .collect();
                
                // Add unique candles and sort by timestamp
                our_candles.extend(unique_candles);
                our_candles.sort_by_key(|c| c.timestamp);
            } else {
                // We don't have this timeframe, add it
                self.candles.insert(timeframe.clone(), other_candles.clone());
            }
        }
        
        // Merge indicators
        self.indicators.merge(&other.indicators);
        
        // Prefer most recent sentiment data
        if let Some(other_sentiment) = &other.sentiment {
            if let Some(our_sentiment) = &self.sentiment {
                if other_sentiment.timestamp > our_sentiment.timestamp {
                    self.sentiment = other.sentiment.clone();
                }
            } else {
                self.sentiment = other.sentiment.clone();
            }
        }
    }
}

/// Market data provider trait
#[async_trait::async_trait]
pub trait MarketDataProvider: Send + Sync {
    /// Get real-time market data for a specific symbol
    async fn get_market_data(&self, exchange: &str, symbol: &str) -> Result<MarketData, MarketDataError>;
    
    /// Get historical candles for a specific symbol and timeframe
    async fn get_historical_candles(
        &self, 
        exchange: &str, 
        symbol: &str, 
        timeframe: &str, 
        start_time: Option<i64>, 
        end_time: Option<i64>, 
        limit: Option<usize>
    ) -> Result<Vec<Candle>, MarketDataError>;
    
    /// Get current orderbook for a specific symbol
    async fn get_orderbook(&self, exchange: &str, symbol: &str, depth: Option<usize>) -> Result<Orderbook, MarketDataError>;
    
    /// Get technical indicators for a specific symbol
    async fn get_technical_indicators(&self, exchange: &str, symbol: &str, timeframe: &str) -> Result<TechnicalIndicators, MarketDataError>;
    
    /// Get market sentiment for a specific symbol
    async fn get_market_sentiment(&self, exchange: &str, symbol: &str) -> Result<MarketSentiment, MarketDataError>;
}

/// Configuration for MarketDataManager
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDataConfig {
    /// Default exchange to use when not specified
    pub default_exchange: String,
    /// Default timeframe to use when not specified
    pub default_timeframe: String,
    /// How long to cache market data in seconds
    pub cache_ttl_secs: u64,
    /// Maximum number of candles to store per symbol+timeframe
    pub max_candles_per_timeframe: usize,
    /// Backoff time in seconds when rate limited
    pub rate_limit_backoff_secs: u64,
    /// Whether to use local cache
    pub use_cache: bool,
    /// Whether to enable market sentiment analysis
    pub enable_sentiment: bool,
}

impl Default for MarketDataConfig {
    fn default() -> Self {
        Self {
            default_exchange: "binance".to_string(),
            default_timeframe: "1h".to_string(),
            cache_ttl_secs: 60,
            max_candles_per_timeframe: 1000,
            rate_limit_backoff_secs: 60,
            use_cache: true,
            enable_sentiment: true,
        }
    }
}

/// Subscription to market data updates
#[derive(Debug, Clone)]
pub struct MarketDataSubscription {
    /// Subscription ID
    pub id: String,
    /// Exchange name
    pub exchange: String,
    /// Symbol to subscribe to
    pub symbol: String,
    /// Timeframes to subscribe to
    pub timeframes: Vec<String>,
    /// Whether to subscribe to orderbook updates
    pub include_orderbook: bool,
    /// Whether to subscribe to sentiment updates
    pub include_sentiment: bool,
    /// Callback to invoke when data is updated
    pub callback: Arc<dyn Fn(MarketData) + Send + Sync>,
}

/// CacheEntry for storing market data with expiration
struct CacheEntry<T> {
    data: T,
    expires_at: std::time::Instant,
}

/// MarketDataManager handles retrieving, caching, and providing market data
pub struct MarketDataManager {
    /// Configuration options
    config: MarketDataConfig,
    /// List of registered data providers
    providers: HashMap<String, Arc<dyn MarketDataProvider>>,
    /// In-memory cache for market data
    market_data_cache: tokio::sync::RwLock<HashMap<String, CacheEntry<MarketData>>>,
    /// In-memory cache for candles
    candle_cache: tokio::sync::RwLock<HashMap<String, CacheEntry<Vec<Candle>>>>,
    /// Active subscriptions
    subscriptions: tokio::sync::RwLock<HashMap<String, MarketDataSubscription>>,
    /// Last API request timestamps to manage rate limiting
    api_request_timestamps: tokio::sync::Mutex<HashMap<String, std::time::Instant>>,
}

impl MarketDataManager {
    /// Create a new MarketDataManager
    pub fn new(config: MarketDataConfig) -> Self {
        Self {
            config,
            providers: HashMap::new(),
            market_data_cache: tokio::sync::RwLock::new(HashMap::new()),
            candle_cache: tokio::sync::RwLock::new(HashMap::new()),
            subscriptions: tokio::sync::RwLock::new(HashMap::new()),
            api_request_timestamps: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
    
    /// Register a market data provider for a specific exchange
    pub fn register_provider(&mut self, exchange: &str, provider: Arc<dyn MarketDataProvider>) {
        self.providers.insert(exchange.to_string(), provider);
    }
    
    /// Get a market data provider for a specific exchange
    fn get_provider(&self, exchange: &str) -> Result<Arc<dyn MarketDataProvider>, MarketDataError> {
        self.providers.get(exchange).cloned().ok_or_else(|| 
            MarketDataError::DataNotAvailable(format!("No provider registered for exchange {}", exchange))
        )
    }
    
    /// Generate cache key for market data
    fn market_data_cache_key(exchange: &str, symbol: &str) -> String {
        format!("market_data:{}:{}", exchange, symbol)
    }
    
    /// Generate cache key for candles
    fn candle_cache_key(exchange: &str, symbol: &str, timeframe: &str) -> String {
        format!("candles:{}:{}:{}", exchange, symbol, timeframe)
    }
    
    /// Check and update rate limits
    async fn check_rate_limit(&self, key: &str) -> Result<(), MarketDataError> {
        let mut timestamps = self.api_request_timestamps.lock().await;
        let now = std::time::Instant::now();
        
        if let Some(last_request) = timestamps.get(key) {
            let elapsed = now.duration_since(*last_request).as_secs();
            if elapsed < self.config.rate_limit_backoff_secs {
                return Err(MarketDataError::RateLimitExceeded { 
                    retry_after_secs: self.config.rate_limit_backoff_secs - elapsed 
                });
            }
        }
        
        timestamps.insert(key.to_string(), now);
        Ok(())
    }
    
    /// Get market data for a specific symbol
    pub async fn get_market_data(&self, exchange: &str, symbol: &str) -> Result<MarketData, MarketDataError> {
        let exchange = if exchange.is_empty() { &self.config.default_exchange } else { exchange };
        let cache_key = Self::market_data_cache_key(exchange, symbol);
        
        // Try to get from cache first
        if self.config.use_cache {
            let cache = self.market_data_cache.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                if entry.expires_at > std::time::Instant::now() {
                    return Ok(entry.data.clone());
                }
            }
        }
        
        // Check rate limits
        self.check_rate_limit(&format!("market_data:{}", exchange)).await?;
        
        // Fetch from provider
        let provider = self.get_provider(exchange)?;
        let mut market_data = provider.get_market_data(exchange, symbol).await?;
        
        // If we have candles in cache, add them
        if self.config.use_cache {
            let candle_cache = self.candle_cache.read().await;
            for timeframe in &["1m", "5m", "15m", "1h", "4h", "1d"] {
                let candle_key = Self::candle_cache_key(exchange, symbol, timeframe);
                if let Some(entry) = candle_cache.get(&candle_key) {
                    if entry.expires_at > std::time::Instant::now() {
                        market_data.add_candles(timeframe, entry.data.clone());
                    }
                }
            }
        }
        
        // Store in cache
        if self.config.use_cache {
            let mut cache = self.market_data_cache.write().await;
            cache.insert(cache_key, CacheEntry {
                data: market_data.clone(),
                expires_at: std::time::Instant::now() + std::time::Duration::from_secs(self.config.cache_ttl_secs),
            });
        }
        
        Ok(market_data)
    }
    
    /// Get historical candles for a specific symbol and timeframe
    pub async fn get_candles(
        &self,
        exchange: &str,
        symbol: &str,
        timeframe: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: Option<usize>,
    ) -> Result<Vec<Candle>, MarketDataError> {
        let exchange = if exchange.is_empty() { &self.config.default_exchange } else { exchange };
        let timeframe = if timeframe.is_empty() { &self.config.default_timeframe } else { timeframe };
        let cache_key = Self::candle_cache_key(exchange, symbol, timeframe);
        
        // For historical data with specific time range, bypass cache
        let use_cache = start_time.is_none() && end_time.is_none() && self.config.use_cache;
        
        // Try to get from cache first
        if use_cache {
            let cache = self.candle_cache.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                if entry.expires_at > std::time::Instant::now() {
                    return Ok(entry.data.clone());
                }
            }
        }
        
        // Check rate limits
        self.check_rate_limit(&format!("candles:{}:{}", exchange, timeframe)).await?;
        
        // Fetch from provider
        let provider = self.get_provider(exchange)?;
        let candles = provider.get_historical_candles(
            exchange, symbol, timeframe, start_time, end_time, 
            limit.or(Some(self.config.max_candles_per_timeframe))
        ).await?;
        
        // Store in cache
        if use_cache {
            let mut cache = self.candle_cache.write().await;
            cache.insert(cache_key, CacheEntry {
                data: candles.clone(),
                expires_at: std::time::Instant::now() + std::time::Duration::from_secs(self.config.cache_ttl_secs),
            });
        }
        
        Ok(candles)
    }
    
    /// Get current orderbook for a specific symbol
    pub async fn get_orderbook(&self, exchange: &str, symbol: &str, depth: Option<usize>) -> Result<Orderbook, MarketDataError> {
        let exchange = if exchange.is_empty() { &self.config.default_exchange } else { exchange };
        
        // Check rate limits
        self.check_rate_limit(&format!("orderbook:{}", exchange)).await?;
        
        // Fetch from provider
        let provider = self.get_provider(exchange)?;
        provider.get_orderbook(exchange, symbol, depth).await
    }
    
    /// Get technical indicators for a specific symbol
    pub async fn get_technical_indicators(&self, exchange: &str, symbol: &str, timeframe: &str) -> Result<TechnicalIndicators, MarketDataError> {
        let exchange = if exchange.is_empty() { &self.config.default_exchange } else { exchange };
        let timeframe = if timeframe.is_empty() { &self.config.default_timeframe } else { timeframe };
        
        // Check rate limits
        self.check_rate_limit(&format!("indicators:{}:{}", exchange, timeframe)).await?;
        
        // Fetch from provider
        let provider = self.get_provider(exchange)?;
        provider.get_technical_indicators(exchange, symbol, timeframe).await
    }
    
    /// Get market sentiment for a specific symbol
    pub async fn get_market_sentiment(&self, exchange: &str, symbol: &str) -> Result<MarketSentiment, MarketDataError> {
        if !self.config.enable_sentiment {
            return Err(MarketDataError::DataNotAvailable("Market sentiment analysis is disabled".to_string()));
        }
        
        let exchange = if exchange.is_empty() { &self.config.default_exchange } else { exchange };
        
        // Check rate limits
        self.check_rate_limit(&format!("sentiment:{}", exchange)).await?;
        
        // Fetch from provider
        let provider = self.get_provider(exchange)?;
        provider.get_market_sentiment(exchange, symbol).await
    }
    
    /// Subscribe to market data updates
    pub async fn subscribe(&self, subscription: MarketDataSubscription) -> Result<(), MarketDataError> {
        let mut subscriptions = self.subscriptions.write().await;
        subscriptions.insert(subscription.id.clone(), subscription);
        Ok(())
    }
    
    /// Unsubscribe from market data updates
    pub async fn unsubscribe(&self, subscription_id: &str) -> Result<(), MarketDataError> {
        let mut subscriptions = self.subscriptions.write().await;
        subscriptions.remove(subscription_id);
        Ok(())
    }
    
    /// Notify subscribers of updated market data
    pub async fn notify_subscribers(&self, market_data: &MarketData) -> Result<(), MarketDataError> {
        let subscriptions = self.subscriptions.read().await;
        
        for subscription in subscriptions.values() {
            if subscription.exchange == market_data.exchange && subscription.symbol == market_data.symbol {
                (subscription.callback)(market_data.clone());
            }
        }
        
        Ok(())
    }
    
    /// Clear all caches
    pub async fn clear_cache(&self) {
        let mut market_data_cache = self.market_data_cache.write().await;
        market_data_cache.clear();
        
        let mut candle_cache = self.candle_cache.write().await;
        candle_cache.clear();
    }
}

/// A mock implementation of MarketDataProvider for testing
pub struct MockMarketDataProvider {
    /// Predefined market data for testing
    test_data: HashMap<String, MarketData>,
    /// Predefined candles for testing
    test_candles: HashMap<String, Vec<Candle>>,
}

impl MockMarketDataProvider {
    /// Create a new mock provider with optional test data
    pub fn new() -> Self {
        Self {
            test_data: HashMap::new(),
            test_candles: HashMap::new(),
        }
    }
    
    /// Add test market data
    pub fn add_market_data(&mut self, exchange: &str, symbol: &str, data: MarketData) {
        let key = format!("{}:{}", exchange, symbol);
        self.test_data.insert(key, data);
    }
    
    /// Add test candles
    pub fn add_candles(&mut self, exchange: &str, symbol: &str, timeframe: &str, candles: Vec<Candle>) {
        let key = format!("{}:{}:{}", exchange, symbol, timeframe);
        self.test_candles.insert(key, candles);
    }
}

#[async_trait::async_trait]
impl MarketDataProvider for MockMarketDataProvider {
    async fn get_market_data(&self, exchange: &str, symbol: &str) -> Result<MarketData, MarketDataError> {
        let key = format!("{}:{}", exchange, symbol);
        self.test_data.get(&key).cloned().ok_or_else(|| 
            MarketDataError::DataNotAvailable(format!("No mock data for {}:{}", exchange, symbol))
        )
    }
    
    async fn get_historical_candles(
        &self, 
        exchange: &str, 
        symbol: &str, 
        timeframe: &str, 
        _start_time: Option<i64>, 
        _end_time: Option<i64>, 
        _limit: Option<usize>
    ) -> Result<Vec<Candle>, MarketDataError> {
        let key = format!("{}:{}:{}", exchange, symbol, timeframe);
        self.test_candles.get(&key).cloned().ok_or_else(|| 
            MarketDataError::DataNotAvailable(format!("No mock candles for {}:{}:{}", exchange, symbol, timeframe))
        )
    }
    
    async fn get_orderbook(&self, exchange: &str, symbol: &str, _depth: Option<usize>) -> Result<Orderbook, MarketDataError> {
        let key = format!("{}:{}", exchange, symbol);
        self.test_data.get(&key)
            .and_then(|data| data.orderbook.clone())
            .ok_or_else(|| MarketDataError::DataNotAvailable(format!("No mock orderbook for {}:{}", exchange, symbol)))
    }
    
    async fn get_technical_indicators(&self, exchange: &str, symbol: &str, _timeframe: &str) -> Result<TechnicalIndicators, MarketDataError> {
        let key = format!("{}:{}", exchange, symbol);
        self.test_data.get(&key)
            .map(|data| data.indicators.clone())
            .ok_or_else(|| MarketDataError::DataNotAvailable(format!("No mock indicators for {}:{}", exchange, symbol)))
    }
    
    async fn get_market_sentiment(&self, exchange: &str, symbol: &str) -> Result<MarketSentiment, MarketDataError> {
        let key = format!("{}:{}", exchange, symbol);
        self.test_data.get(&key)
            .and_then(|data| data.sentiment.clone())
            .ok_or_else(|| MarketDataError::DataNotAvailable(format!("No mock sentiment for {}:{}", exchange, symbol)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    
    fn create_test_candle(timestamp: DateTime<Utc>, price: f64) -> Candle {
        Candle {
            timestamp,
            open: Decimal::from_f64(price * 0.99).unwrap(),
            high: Decimal::from_f64(price * 1.01).unwrap(),
            low: Decimal::from_f64(price * 0.98).unwrap(),
            close: Decimal::from_f64(price).unwrap(),
            volume: Decimal::from_f64(100.0).unwrap(),
            trade_count: None,
            quote_volume: None,
            extras: HashMap::new(),
        }
    }
    
    fn create_test_market_data(symbol: &str, price: f64) -> MarketData {
        let now = Utc::now();
        let mut candles = HashMap::new();
        
        // Add some candles for 1m timeframe
        let mut minute_candles = Vec::new();
        for i in 0..10 {
            let ts = now - chrono::Duration::minutes(i);
            minute_candles.push(create_test_candle(ts, price * (1.0 + 0.001 * (i as f64))));
        }
        candles.insert(Timeframe::Minute1.to_string(), minute_candles);
        
        // Create orderbook
        let mut bids = Vec::new();
        let mut asks = Vec::new();
        
        for i in 1..6 {
            bids.push(OrderbookEntry {
                price: Decimal::from_f64((price * (1.0 - 0.001 * (i as f64)))).unwrap(),
                quantity: Decimal::from_f64(10.0 / (i as f64)).unwrap(),
                count: Some(i * 2),
                extras: HashMap::new(),
            });
            
            asks.push(OrderbookEntry {
                price: Decimal::from_f64((price * (1.0 + 0.001 * (i as f64)))).unwrap(),
                quantity: Decimal::from_f64(10.0 / (i as f64)).unwrap(),
                count: Some(i * 2),
                extras: HashMap::new(),
            });
        }
        
        let orderbook = Orderbook {
            bids,
            asks,
            timestamp: now,
            depth_pct: Some(0.5),
            sequence_number: None,
            is_partial: false,
            metadata: HashMap::new(),
        };
        
        // Create exchange info
        let mut exchanges = HashMap::new();
        exchanges.insert("binance".to_string(), ExchangeInfo {
            exchange_id: "binance".to_string(),
            price,
            volume_24h: 1000.0,
            bid: Some(price * 0.999),
            ask: Some(price * 1.001),
            timestamp: now,
            extras: HashMap::new(),
        });
        
        exchanges.insert("coinbase".to_string(), ExchangeInfo {
            exchange_id: "coinbase".to_string(),
            price: price * 1.001,
            volume_24h: 800.0,
            bid: Some(price * 0.998),
            ask: Some(price * 1.002),
            timestamp: now,
            extras: HashMap::new(),
        });
        
        MarketData {
            exchange: "binance".to_string(),
            symbol: symbol.to_string(),
            ticker: Ticker {
                bid: price * 0.999,
                ask: price * 1.001,
                last: price,
                volume: 1000.0,
                change_24h: 0.0,
                high_24h: price,
                low_24h: price,
                quote_volume: 1800.0,
            },
            orderbook: Some(orderbook),
            candles,
            indicators: TechnicalIndicators::default(),
            sentiment: None,
            last_updated: now.timestamp(),
            source: "realtime".to_string(),
        }
    }
    
    #[test]
    fn test_market_data_methods() {
        let btc_data = create_test_market_data("BTC/USDT", 50000.0);
        
        // Test spread calculation
        let spread = btc_data.spread_percentage();
        assert!(spread > 0.0 && spread < 1.0);
        
        // Test latest candle
        let latest_candle = btc_data.latest_candle("1m").unwrap();
        assert_eq!(latest_candle.close.to_f64().unwrap(), 50000.0);
        
        // Test is_recent
        assert!(btc_data.is_recent());
    }
    
    #[tokio::test]
    async fn test_mock_provider() {
        let mut provider = MockMarketDataProvider::new();
        let btc_data = create_test_market_data("BTC/USDT", 50000.0);
        provider.add_market_data("BTC/USDT", btc_data.clone());
        
        let retrieved = provider.get_market_data("BTC/USDT", "BTC/USDT").await.unwrap();
        assert_eq!(retrieved.ticker.bid, 50000.0 * 0.999);
        assert_eq!(retrieved.symbol, "BTC/USDT");
        
        // Test error case
        let err = provider.get_market_data("ETH/USDT", "ETH/USDT").await.unwrap_err();
        match err {
            MarketDataError::DataNotAvailable(_) => {}, // Expected
            _ => panic!("Unexpected error type"),
        }
    }
    
    // Note: This test requires tokio runtime
    #[tokio::test]
    async fn test_market_data_manager() {
        let mut mock_provider = MockMarketDataProvider::new();
        
        // Set up mock data
        let btc_data = create_test_market_data("BTC/USDT", 50000.0);
        let eth_data = create_test_market_data("ETH/USDT", 3000.0);
        
        mock_provider.add_market_data("BTC/USDT", btc_data.clone());
        mock_provider.add_market_data("ETH/USDT", eth_data);
        
        // Create manager
        let config = MarketDataConfig {
            max_candles_per_timeframe: 100,
            ..Default::default()
        };
        
        let manager = MarketDataManager::new(config);
        
        // Get data
        let result = manager.get_market_data("BTC/USDT", "BTC/USDT").await.unwrap();
        assert_eq!(result.symbol, "BTC/USDT");
        assert_eq!(result.ticker.bid, 50000.0 * 0.999);
        
        // Test caching
        let result2 = manager.get_market_data("BTC/USDT", "BTC/USDT").await.unwrap();
        assert_eq!(result2.symbol, "BTC/USDT");
        
        // Subscription
        let subscription = MarketDataSubscription {
            id: "test_subscription".to_string(),
            exchange: "BTC/USDT".to_string(),
            symbol: "BTC/USDT".to_string(),
            timeframes: vec!["1m".to_string()],
            include_orderbook: true,
            include_sentiment: true,
            callback: Arc::new(|data| {
                // Handle update
            }),
        };
        let _ = manager.subscribe(subscription).await;
    }
} 