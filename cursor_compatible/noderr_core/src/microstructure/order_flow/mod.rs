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

//! Order Flow Analysis Engine
//!
//! This module provides tools for analyzing real-time market order flow,
//! including trade aggressiveness, order book imbalance, and cumulative delta.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

use crate::market::{MarketData, Orderbook, OrderbookEntry, Symbol, Candle, Ticker};
use crate::redis::{RedisClient, RedisClientResult};

/// Error types for order flow operations
#[derive(Debug, Error)]
pub enum OrderFlowError {
    #[error("Redis error: {0}")]
    Redis(String),
    
    #[error("Symbol not found: {0}")]
    SymbolNotFound(String),
    
    #[error("Invalid data: {0}")]
    InvalidData(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for order flow operations
pub type OrderFlowResult<T> = Result<T, OrderFlowError>;

/// Trade aggression level indicating buyer/seller initiative
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TradeAggression {
    /// Highly aggressive buying (market buy into asks)
    StrongBuying,
    
    /// Moderately aggressive buying
    Buying,
    
    /// Passive buying (limit orders)
    PassiveBuying,
    
    /// Neutral (neither side initiating)
    Neutral,
    
    /// Passive selling (limit orders)
    PassiveSelling,
    
    /// Moderately aggressive selling
    Selling,
    
    /// Highly aggressive selling (market sell into bids)
    StrongSelling,
}

impl TradeAggression {
    /// Convert to a numerical value for calculations (-3 to +3)
    pub fn to_value(&self) -> i8 {
        match self {
            Self::StrongBuying => 3,
            Self::Buying => 2,
            Self::PassiveBuying => 1,
            Self::Neutral => 0,
            Self::PassiveSelling => -1,
            Self::Selling => -2,
            Self::StrongSelling => -3,
        }
    }
    
    /// Create from a numerical value
    pub fn from_value(value: i8) -> Self {
        match value {
            3 => Self::StrongBuying,
            2 => Self::Buying,
            1 => Self::PassiveBuying,
            0 => Self::Neutral,
            -1 => Self::PassiveSelling,
            -2 => Self::Selling,
            -3 | _ => Self::StrongSelling,
        }
    }
}

/// Order book imbalance indicating buying/selling pressure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderImbalance {
    /// Raw bid/ask quantity imbalance ratio
    pub ratio: f64,
    
    /// Categorized imbalance (-1.0 to 1.0 range)
    pub normalized: f64,
    
    /// Total bid quantity
    pub bid_quantity: f64,
    
    /// Total ask quantity
    pub ask_quantity: f64,
    
    /// Weighted bid quantity (more weight to prices near mid)
    pub weighted_bid_quantity: Option<f64>,
    
    /// Weighted ask quantity (more weight to prices near mid)
    pub weighted_ask_quantity: Option<f64>,
    
    /// Number of price levels analyzed
    pub levels_analyzed: usize,
}

impl OrderImbalance {
    /// Create a new order imbalance calculation
    pub fn new(bid_quantity: f64, ask_quantity: f64, levels_analyzed: usize) -> Self {
        let ratio = if ask_quantity > 0.0 {
            bid_quantity / ask_quantity
        } else {
            f64::MAX
        };
        
        // Normalize to -1.0 to 1.0 range using tanh
        let normalized = (ratio - 1.0) / (ratio + 1.0);
        
        Self {
            ratio,
            normalized,
            bid_quantity,
            ask_quantity,
            weighted_bid_quantity: None,
            weighted_ask_quantity: None,
            levels_analyzed,
        }
    }
    
    /// Add weighted quantities
    pub fn with_weighted_quantities(mut self, weighted_bid: f64, weighted_ask: f64) -> Self {
        self.weighted_bid_quantity = Some(weighted_bid);
        self.weighted_ask_quantity = Some(weighted_ask);
        self
    }
    
    /// Is the imbalance significant?
    pub fn is_significant(&self, threshold: f64) -> bool {
        self.normalized.abs() >= threshold
    }
    
    /// Is there significant buying pressure?
    pub fn is_buying_pressure(&self, threshold: f64) -> bool {
        self.normalized >= threshold
    }
    
    /// Is there significant selling pressure?
    pub fn is_selling_pressure(&self, threshold: f64) -> bool {
        self.normalized <= -threshold
    }
}

/// Analysis of trade execution, including aggressiveness and type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeExecution {
    /// Symbol traded
    pub symbol: Symbol,
    
    /// Price of the trade
    pub price: f64,
    
    /// Quantity traded
    pub quantity: f64,
    
    /// Timestamp of the trade
    pub timestamp: DateTime<Utc>,
    
    /// Aggression level of the trade
    pub aggression: TradeAggression,
    
    /// Whether this was a buy or sell
    pub is_buy: bool,
    
    /// Market impact as percentage of mid price
    pub market_impact: Option<f64>,
    
    /// Estimated slippage
    pub slippage: Option<f64>,
    
    /// Distance from mid price as percentage
    pub distance_from_mid: Option<f64>,
}

impl TradeExecution {
    /// Create a new trade execution analysis
    pub fn new(
        symbol: Symbol,
        price: f64,
        quantity: f64,
        is_buy: bool,
        aggression: TradeAggression,
    ) -> Self {
        Self {
            symbol,
            price,
            quantity,
            timestamp: Utc::now(),
            aggression,
            is_buy,
            market_impact: None,
            slippage: None,
            distance_from_mid: None,
        }
    }
    
    /// Add market impact information
    pub fn with_impact(mut self, impact: f64, slippage: f64, distance_from_mid: f64) -> Self {
        self.market_impact = Some(impact);
        self.slippage = Some(slippage);
        self.distance_from_mid = Some(distance_from_mid);
        self
    }
}

/// Order flow event types for tracking unusual activity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderFlowEvent {
    /// Large trade detected
    LargeTrade {
        /// Symbol traded
        symbol: Symbol,
        /// Size of the trade
        size: f64,
        /// Price of the trade
        price: f64,
        /// Multiple of average trade size
        size_multiple: f64,
        /// Was this a buy?
        is_buy: bool,
        /// Timestamp of event
        timestamp: DateTime<Utc>,
    },
    
    /// Sudden order book change
    OrderBookSweep {
        /// Symbol affected
        symbol: Symbol,
        /// Side that was swept (bid or ask)
        side: String,
        /// Number of levels removed
        levels_removed: usize,
        /// Total quantity removed
        quantity_removed: f64,
        /// Percentage of order book removed
        percentage_removed: f64,
        /// Timestamp of event
        timestamp: DateTime<Utc>,
    },
    
    /// Possible spoofing detected
    PossibleSpoofing {
        /// Symbol affected
        symbol: Symbol,
        /// Side where spoofing is suspected
        side: String,
        /// Size of spoof orders
        size: f64,
        /// How quickly orders were canceled (ms)
        cancel_time_ms: u64,
        /// Confidence level (0-100)
        confidence: u8,
        /// Timestamp of event
        timestamp: DateTime<Utc>,
    },
    
    /// Quote stuffing (rapid order/cancel)
    QuoteStuffing {
        /// Symbol affected
        symbol: Symbol,
        /// Number of orders placed
        order_count: usize,
        /// Timeframe of stuffing in ms
        timeframe_ms: u64,
        /// Side where stuffing occurred
        side: String,
        /// Timestamp of event
        timestamp: DateTime<Utc>,
    },
    
    /// Liquidity disappearance
    LiquidityVacuum {
        /// Symbol affected
        symbol: Symbol,
        /// Side where liquidity disappeared
        side: String,
        /// Percentage of liquidity removed
        percentage_removed: f64,
        /// Time it took for liquidity to disappear (ms)
        time_ms: u64,
        /// Timestamp of event
        timestamp: DateTime<Utc>,
    },
    
    /// Momentum surge
    MomentumSurge {
        /// Symbol affected
        symbol: Symbol,
        /// Price movement percentage
        price_change_pct: f64,
        /// Duration of surge in ms
        duration_ms: u64,
        /// Direction (up or down)
        direction: String,
        /// Timestamp of event
        timestamp: DateTime<Utc>,
    },
}

/// Metrics derived from order flow analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderFlowMetrics {
    /// Symbol these metrics apply to
    pub symbol: Symbol,
    
    /// Cumulative delta (buy volume - sell volume)
    pub cumulative_delta: f64,
    
    /// Delta over time windows (1min, 5min, 15min)
    pub delta_by_timeframe: HashMap<String, f64>,
    
    /// Order book imbalance
    pub imbalance: OrderImbalance,
    
    /// Current trade aggressiveness trend
    pub aggressiveness: TradeAggression,
    
    /// Buying vs selling pressure (1.0 = all buying, -1.0 = all selling)
    pub pressure: f64,
    
    /// Unusual events detected in recent time window
    pub recent_events: Vec<OrderFlowEvent>,
    
    /// Volume traded in the current time window
    pub volume: f64,
    
    /// Tick volume (number of trades)
    pub tick_volume: usize,
    
    /// Volume-weighted average price (VWAP)
    pub vwap: f64,
    
    /// Timestamp of this analysis
    pub timestamp: DateTime<Utc>,
    
    /// Time window for the analysis in seconds
    pub time_window_sec: u64,
    
    /// Analysis of suspected manipulation or anomalies
    pub manipulation_indicators: HashMap<String, f64>,
}

impl OrderFlowMetrics {
    /// Create a new set of order flow metrics
    pub fn new(symbol: Symbol, time_window_sec: u64) -> Self {
        Self {
            symbol,
            cumulative_delta: 0.0,
            delta_by_timeframe: HashMap::new(),
            imbalance: OrderImbalance::new(0.0, 0.0, 0),
            aggressiveness: TradeAggression::Neutral,
            pressure: 0.0,
            recent_events: Vec::new(),
            volume: 0.0,
            tick_volume: 0,
            vwap: 0.0,
            timestamp: Utc::now(),
            time_window_sec,
            manipulation_indicators: HashMap::new(),
        }
    }
    
    /// Is there strong buying pressure?
    pub fn is_strong_buying(&self) -> bool {
        self.pressure > 0.7 && self.imbalance.normalized > 0.5
    }
    
    /// Is there strong selling pressure?
    pub fn is_strong_selling(&self) -> bool {
        self.pressure < -0.7 && self.imbalance.normalized < -0.5
    }
    
    /// Get market direction based on flow metrics
    pub fn market_direction(&self) -> String {
        if self.is_strong_buying() {
            "strong_bullish".to_string()
        } else if self.is_strong_selling() {
            "strong_bearish".to_string()
        } else if self.pressure > 0.3 {
            "bullish".to_string()
        } else if self.pressure < -0.3 {
            "bearish".to_string()
        } else {
            "neutral".to_string()
        }
    }
    
    /// Add a detected anomaly or manipulation indicator
    pub fn add_manipulation_indicator(&mut self, name: &str, value: f64) {
        self.manipulation_indicators.insert(name.to_string(), value);
    }
    
    /// Is there any suspicion of manipulation?
    pub fn has_manipulation_suspicion(&self, threshold: f64) -> bool {
        self.manipulation_indicators.values().any(|&v| v >= threshold)
    }
}

/// Configuration for the order flow analyzer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderFlowConfig {
    /// Maximum number of events to keep in history
    pub max_events: usize,
    
    /// Depth of order book to analyze
    pub order_book_depth: usize,
    
    /// Time window for trade analysis in seconds
    pub trade_window_sec: u64,
    
    /// Decay factor for older data
    pub historical_decay_factor: f64,
    
    /// Time windows for delta analysis in seconds
    pub delta_timeframes: Vec<u64>,
    
    /// Threshold for what counts as a "large" trade
    pub large_trade_threshold: f64,
    
    /// Threshold for suspicious activity detection
    pub manipulation_detection_threshold: f64,
    
    /// Whether to track spoofing attempts
    pub detect_spoofing: bool,
    
    /// Whether to track quote stuffing
    pub detect_quote_stuffing: bool,
}

impl Default for OrderFlowConfig {
    fn default() -> Self {
        Self {
            max_events: 100,
            order_book_depth: 10,
            trade_window_sec: 300, // 5 minutes
            historical_decay_factor: 0.95,
            delta_timeframes: vec![60, 300, 900], // 1min, 5min, 15min
            large_trade_threshold: 3.0, // 3x average trade size
            manipulation_detection_threshold: 0.7,
            detect_spoofing: true,
            detect_quote_stuffing: true,
        }
    }
}

/// Interface for order flow analysis
#[async_trait::async_trait]
pub trait OrderFlowAnalyzer: Send + Sync {
    /// Process a market data update and update metrics
    async fn process_market_data(&self, market_data: &MarketData) -> OrderFlowResult<OrderFlowMetrics>;
    
    /// Process a new trade execution
    async fn process_trade(&self, symbol: &Symbol, price: f64, quantity: f64, is_buy: bool) -> OrderFlowResult<TradeExecution>;
    
    /// Process an orderbook update
    async fn process_orderbook(&self, symbol: &Symbol, orderbook: &Orderbook) -> OrderFlowResult<OrderImbalance>;
    
    /// Get the latest order flow metrics for a symbol
    async fn get_metrics(&self, symbol: &Symbol) -> OrderFlowResult<OrderFlowMetrics>;
    
    /// Get recent order flow events for a symbol
    async fn get_events(&self, symbol: &Symbol, limit: Option<usize>) -> OrderFlowResult<Vec<OrderFlowEvent>>;
    
    /// Check for manipulation indicators
    async fn check_manipulation(&self, symbol: &Symbol) -> OrderFlowResult<HashMap<String, f64>>;
    
    /// Reset metrics for a symbol
    async fn reset_metrics(&self, symbol: &Symbol) -> OrderFlowResult<()>;
    
    /// Get config
    fn get_config(&self) -> &OrderFlowConfig;
    
    /// Update config
    async fn update_config(&self, config: OrderFlowConfig) -> OrderFlowResult<()>;
}

/// Implementation of the OrderFlowAnalyzer
pub struct DefaultOrderFlowAnalyzer {
    /// Redis client for persistence
    redis: Arc<dyn RedisClient>,
    
    /// Configuration
    config: RwLock<OrderFlowConfig>,
    
    /// Cache of latest metrics by symbol
    metrics_cache: RwLock<HashMap<Symbol, OrderFlowMetrics>>,
    
    /// Cache of recent events by symbol
    events_cache: RwLock<HashMap<Symbol, VecDeque<OrderFlowEvent>>>,
    
    /// Historical trade data for calculations
    historical_trades: RwLock<HashMap<Symbol, VecDeque<TradeExecution>>>,
    
    /// Average trade sizes by symbol
    avg_trade_sizes: RwLock<HashMap<Symbol, f64>>,
    
    /// Previous order books for comparing changes
    previous_orderbooks: RwLock<HashMap<Symbol, (Orderbook, DateTime<Utc>)>>,
}

impl DefaultOrderFlowAnalyzer {
    /// Create a new DefaultOrderFlowAnalyzer
    pub fn new(redis: Arc<dyn RedisClient>) -> Self {
        Self::with_config(redis, OrderFlowConfig::default())
    }
    
    /// Create with custom config
    pub fn with_config(redis: Arc<dyn RedisClient>, config: OrderFlowConfig) -> Self {
        Self {
            redis,
            config: RwLock::new(config),
            metrics_cache: RwLock::new(HashMap::new()),
            events_cache: RwLock::new(HashMap::new()),
            historical_trades: RwLock::new(HashMap::new()),
            avg_trade_sizes: RwLock::new(HashMap::new()),
            previous_orderbooks: RwLock::new(HashMap::new()),
        }
    }
    
    /// Redis key for order flow metrics
    fn metrics_key(&self, symbol: &Symbol) -> String {
        format!("micro:orderflow:{}", symbol)
    }
    
    /// Redis key for order flow events
    fn events_key(&self, symbol: &Symbol) -> String {
        format!("micro:events:{}", symbol)
    }
    
    /// Detect a large trade
    fn detect_large_trade(
        &self,
        symbol: &Symbol,
        price: f64,
        quantity: f64,
        is_buy: bool,
        avg_size: f64,
    ) -> Option<OrderFlowEvent> {
        let config = match self.config.try_read() {
            Ok(cfg) => cfg,
            Err(_) => return None,
        };
        
        let size_multiple = quantity / avg_size;
        if size_multiple >= config.large_trade_threshold {
            Some(OrderFlowEvent::LargeTrade {
                symbol: symbol.clone(),
                size: quantity,
                price,
                size_multiple,
                is_buy,
                timestamp: Utc::now(),
            })
        } else {
            None
        }
    }
    
    /// Analyze order book for imbalance
    fn analyze_orderbook_imbalance(&self, orderbook: &Orderbook) -> OrderImbalance {
        let config = match self.config.try_read() {
            Ok(cfg) => cfg,
            Err(_) => return OrderImbalance::new(0.0, 0.0, 0),
        };
        
        let depth = config.order_book_depth.min(orderbook.bids.len()).min(orderbook.asks.len());
        
        // Calculate total quantities
        let bid_quantity: f64 = orderbook.bids.iter()
            .take(depth)
            .map(|entry| entry.quantity.to_f64().unwrap_or(0.0))
            .sum();
            
        let ask_quantity: f64 = orderbook.asks.iter()
            .take(depth)
            .map(|entry| entry.quantity.to_f64().unwrap_or(0.0))
            .sum();
        
        // Calculate weighted quantities (more weight to prices near mid)
        let mid_price = match orderbook.mid_price() {
            Some(mid) => mid.to_f64().unwrap_or(0.0),
            None => return OrderImbalance::new(bid_quantity, ask_quantity, depth),
        };
        
        let weighted_bid_quantity: f64 = orderbook.bids.iter()
            .take(depth)
            .map(|entry| {
                let price = entry.price.to_f64().unwrap_or(0.0);
                let quantity = entry.quantity.to_f64().unwrap_or(0.0);
                let distance = (mid_price - price).abs() / mid_price;
                let weight = 1.0 / (1.0 + distance);
                quantity * weight
            })
            .sum();
            
        let weighted_ask_quantity: f64 = orderbook.asks.iter()
            .take(depth)
            .map(|entry| {
                let price = entry.price.to_f64().unwrap_or(0.0);
                let quantity = entry.quantity.to_f64().unwrap_or(0.0);
                let distance = (price - mid_price).abs() / mid_price;
                let weight = 1.0 / (1.0 + distance);
                quantity * weight
            })
            .sum();
        
        OrderImbalance::new(bid_quantity, ask_quantity, depth)
            .with_weighted_quantities(weighted_bid_quantity, weighted_ask_quantity)
    }
    
    /// Detect order book sweep events
    fn detect_orderbook_sweep(
        &self,
        symbol: &Symbol,
        current: &Orderbook,
        previous: &Orderbook,
    ) -> Option<OrderFlowEvent> {
        // Placeholder for order book sweep detection
        // In a full implementation, this would compare the order books
        // to detect sudden removal of significant liquidity
        None
    }
    
    /// Detect possible spoofing (large orders that get canceled quickly)
    fn detect_spoofing(&self, symbol: &Symbol, orderbook: &Orderbook) -> Option<OrderFlowEvent> {
        // Placeholder for spoofing detection
        // This would require tracking individual orders over time
        // to detect patterns of placing large orders and canceling them
        None
    }
    
    /// Calculate trade aggressiveness
    fn calculate_aggressiveness(
        &self,
        price: f64,
        is_buy: bool,
        orderbook: Option<&Orderbook>,
    ) -> TradeAggression {
        let orderbook = match orderbook {
            Some(ob) => ob,
            None => return if is_buy { TradeAggression::Buying } else { TradeAggression::Selling },
        };
        
        // Get best bid and ask
        let best_bid = match orderbook.best_bid() {
            Some(bid) => bid.to_f64().unwrap_or(0.0),
            None => return if is_buy { TradeAggression::Buying } else { TradeAggression::Selling },
        };
        
        let best_ask = match orderbook.best_ask() {
            Some(ask) => ask.to_f64().unwrap_or(0.0),
            None => return if is_buy { TradeAggression::Buying } else { TradeAggression::Selling },
        };
        
        let mid_price = (best_bid + best_ask) / 2.0;
        let spread = best_ask - best_bid;
        let price_position = (price - mid_price) / (spread / 2.0);
        
        if is_buy {
            if price >= best_ask + spread * 0.5 {
                TradeAggression::StrongBuying
            } else if price >= best_ask {
                TradeAggression::Buying
            } else if price > mid_price {
                TradeAggression::PassiveBuying
            } else {
                TradeAggression::Neutral
            }
        } else {
            if price <= best_bid - spread * 0.5 {
                TradeAggression::StrongSelling
            } else if price <= best_bid {
                TradeAggression::Selling
            } else if price < mid_price {
                TradeAggression::PassiveSelling
            } else {
                TradeAggression::Neutral
            }
        }
    }
    
    /// Calculate cumulative delta for different timeframes
    async fn calculate_delta_by_timeframe(
        &self,
        symbol: &Symbol,
    ) -> HashMap<String, f64> {
        let historical_trades = match self.historical_trades.try_read() {
            Ok(trades) => trades,
            Err(_) => return HashMap::new(),
        };
        
        let trades = match historical_trades.get(symbol) {
            Some(t) => t,
            None => return HashMap::new(),
        };
        
        let config = match self.config.try_read() {
            Ok(cfg) => cfg,
            Err(_) => return HashMap::new(),
        };
        
        let now = Utc::now();
        let mut result = HashMap::new();
        
        for &timeframe in &config.delta_timeframes {
            let cutoff = now - chrono::Duration::seconds(timeframe as i64);
            
            let delta: f64 = trades.iter()
                .filter(|trade| trade.timestamp >= cutoff)
                .map(|trade| {
                    let sign = if trade.is_buy { 1.0 } else { -1.0 };
                    sign * trade.quantity
                })
                .sum();
            
            result.insert(timeframe.to_string(), delta);
        }
        
        result
    }
    
    /// Update average trade size
    fn update_avg_trade_size(&self, symbol: &Symbol, size: f64) {
        let mut avg_sizes = match self.avg_trade_sizes.try_write() {
            Ok(sizes) => sizes,
            Err(_) => return,
        };
        
        let avg = avg_sizes.entry(symbol.clone()).or_insert(size);
        *avg = *avg * 0.95 + size * 0.05; // Exponential moving average
    }
    
    /// Store metrics in Redis
    async fn store_metrics(&self, metrics: &OrderFlowMetrics) -> OrderFlowResult<()> {
        match self.redis.set(&self.metrics_key(&metrics.symbol), metrics, Some(3600)).await {
            Ok(_) => Ok(()),
            Err(e) => Err(OrderFlowError::Redis(e.to_string())),
        }
    }
    
    /// Store event in Redis
    async fn store_event(&self, symbol: &Symbol, event: &OrderFlowEvent) -> OrderFlowResult<()> {
        let key = self.events_key(symbol);
        
        // First get existing events
        let mut events: Vec<OrderFlowEvent> = match self.redis.get(&key).await {
            Ok(Some(evts)) => evts,
            Ok(None) => Vec::new(),
            Err(e) => return Err(OrderFlowError::Redis(e.to_string())),
        };
        
        // Add new event and trim
        events.push(event.clone());
        let config = self.config.read().unwrap();
        if events.len() > config.max_events {
            events.remove(0);
        }
        
        // Store back
        match self.redis.set(&key, &events, Some(86400)).await { // 24h TTL
            Ok(_) => Ok(()),
            Err(e) => Err(OrderFlowError::Redis(e.to_string())),
        }
    }
}

#[async_trait::async_trait]
impl OrderFlowAnalyzer for DefaultOrderFlowAnalyzer {
    async fn process_market_data(&self, market_data: &MarketData) -> OrderFlowResult<OrderFlowMetrics> {
        let symbol = market_data.symbol.clone();
        
        // Process orderbook if available
        let imbalance = if let Some(orderbook) = &market_data.orderbook {
            let prev_orderbooks = self.previous_orderbooks.read().unwrap();
            
            // Check for sweep events if we have a previous orderbook
            if let Some((prev_ob, _)) = prev_orderbooks.get(&symbol) {
                if let Some(event) = self.detect_orderbook_sweep(&symbol, orderbook, prev_ob) {
                    // Cache the event
                    let mut events_cache = self.events_cache.write().unwrap();
                    let events = events_cache.entry(symbol.clone()).or_insert_with(VecDeque::new);
                    events.push_back(event.clone());
                    
                    // Trim if needed
                    let config = self.config.read().unwrap();
                    while events.len() > config.max_events {
                        events.pop_front();
                    }
                    
                    // Store in Redis
                    let _ = self.store_event(&symbol, &event).await;
                }
            }
            
            // Update previous orderbook
            let mut prev_orderbooks = self.previous_orderbooks.write().unwrap();
            prev_orderbooks.insert(symbol.clone(), (orderbook.clone(), Utc::now()));
            
            // Calculate imbalance
            self.analyze_orderbook_imbalance(orderbook)
        } else {
            OrderImbalance::new(0.0, 0.0, 0)
        };
        
        // Calculate delta by timeframe
        let delta_by_timeframe = self.calculate_delta_by_timeframe(&symbol).await;
        
        // Get cumulative delta
        let cumulative_delta = delta_by_timeframe.get(&self.config.read().unwrap().trade_window_sec.to_string())
            .cloned()
            .unwrap_or(0.0);
            
        // Calculate aggressiveness based on recent trades
        let aggressiveness = {
            let historical_trades = self.historical_trades.read().unwrap();
            if let Some(trades) = historical_trades.get(&symbol) {
                if !trades.is_empty() {
                    // Use the most recent trade's aggressiveness
                    trades.back().map(|t| t.aggression).unwrap_or(TradeAggression::Neutral)
                } else {
                    TradeAggression::Neutral
                }
            } else {
                TradeAggression::Neutral
            }
        };
        
        // Get recent events
        let recent_events = {
            let events_cache = self.events_cache.read().unwrap();
            events_cache.get(&symbol)
                .map(|events| events.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        };
        
        // Calculate volume and tick volume
        let (volume, tick_volume, vwap) = {
            let historical_trades = self.historical_trades.read().unwrap();
            if let Some(trades) = historical_trades.get(&symbol) {
                // Get trades within the window
                let now = Utc::now();
                let window = self.config.read().unwrap().trade_window_sec;
                let cutoff = now - chrono::Duration::seconds(window as i64);
                
                let recent_trades: Vec<_> = trades.iter()
                    .filter(|t| t.timestamp >= cutoff)
                    .collect();
                
                let total_volume: f64 = recent_trades.iter().map(|t| t.quantity).sum();
                let total_value: f64 = recent_trades.iter().map(|t| t.price * t.quantity).sum();
                
                let vwap = if total_volume > 0.0 {
                    total_value / total_volume
                } else {
                    market_data.ticker.last
                };
                
                (total_volume, recent_trades.len(), vwap)
            } else {
                (0.0, 0, market_data.ticker.last)
            }
        };
        
        // Calculate buying/selling pressure
        let pressure = {
            // Combine weighted order imbalance with recent delta
            let imbalance_factor = imbalance.normalized;
            let delta_factor = if volume > 0.0 {
                cumulative_delta / volume
            } else {
                0.0
            };
            
            // Combine with aggressiveness
            let agg_factor = aggressiveness.to_value() as f64 / 3.0; // Normalize to -1..1
            
            // Weighted average
            (imbalance_factor * 0.4 + delta_factor * 0.4 + agg_factor * 0.2).max(-1.0).min(1.0)
        };
        
        // Check for manipulation
        let manipulation_indicators = match self.check_manipulation(&symbol).await {
            Ok(indicators) => indicators,
            Err(_) => HashMap::new(),
        };
        
        // Create metrics object
        let metrics = OrderFlowMetrics {
            symbol: symbol.clone(),
            cumulative_delta,
            delta_by_timeframe,
            imbalance,
            aggressiveness,
            pressure,
            recent_events,
            volume,
            tick_volume,
            vwap,
            timestamp: Utc::now(),
            time_window_sec: self.config.read().unwrap().trade_window_sec,
            manipulation_indicators,
        };
        
        // Cache metrics
        {
            let mut metrics_cache = self.metrics_cache.write().unwrap();
            metrics_cache.insert(symbol.clone(), metrics.clone());
        }
        
        // Store in Redis
        let _ = self.store_metrics(&metrics).await;
        
        Ok(metrics)
    }
    
    async fn process_trade(
        &self,
        symbol: &Symbol,
        price: f64,
        quantity: f64,
        is_buy: bool,
    ) -> OrderFlowResult<TradeExecution> {
        // Get orderbook if available
        let orderbook = {
            let prev_orderbooks = self.previous_orderbooks.read().unwrap();
            prev_orderbooks.get(symbol).map(|(ob, _)| ob.clone())
        };
        
        // Calculate aggressiveness
        let aggression = self.calculate_aggressiveness(price, is_buy, orderbook.as_ref());
        
        // Create trade execution object
        let trade = TradeExecution::new(
            symbol.clone(),
            price,
            quantity,
            is_buy,
            aggression,
        );
        
        // Add to historical trades
        {
            let mut historical_trades = self.historical_trades.write().unwrap();
            let trades = historical_trades.entry(symbol.clone()).or_insert_with(VecDeque::new);
            
            // Trim old trades
            let now = Utc::now();
            let max_age = chrono::Duration::seconds(
                self.config.read().unwrap().delta_timeframes.iter().max().cloned().unwrap_or(900) as i64
            );
            
            while trades.front().map(|t| t.timestamp + max_age < now).unwrap_or(false) {
                trades.pop_front();
            }
            
            // Add new trade
            trades.push_back(trade.clone());
        }
        
        // Update average trade size
        self.update_avg_trade_size(symbol, quantity);
        
        // Check for large trade event
        let avg_size = {
            let avg_sizes = self.avg_trade_sizes.read().unwrap();
            avg_sizes.get(symbol).cloned().unwrap_or(quantity)
        };
        
        if let Some(event) = self.detect_large_trade(symbol, price, quantity, is_buy, avg_size) {
            // Add to events cache
            {
                let mut events_cache = self.events_cache.write().unwrap();
                let events = events_cache.entry(symbol.clone()).or_insert_with(VecDeque::new);
                events.push_back(event.clone());
                
                // Trim if needed
                let config = self.config.read().unwrap();
                while events.len() > config.max_events {
                    events.pop_front();
                }
            }
            
            // Store in Redis
            let _ = self.store_event(symbol, &event).await;
        }
        
        Ok(trade)
    }
    
    async fn process_orderbook(&self, symbol: &Symbol, orderbook: &Orderbook) -> OrderFlowResult<OrderImbalance> {
        // Update previous orderbook
        {
            let mut prev_orderbooks = self.previous_orderbooks.write().unwrap();
            
            // Check for sweep events if we have a previous orderbook
            if let Some((prev_ob, _)) = prev_orderbooks.get(symbol) {
                if let Some(event) = self.detect_orderbook_sweep(symbol, orderbook, prev_ob) {
                    // Cache the event
                    let mut events_cache = self.events_cache.write().unwrap();
                    let events = events_cache.entry(symbol.clone()).or_insert_with(VecDeque::new);
                    events.push_back(event.clone());
                    
                    // Trim if needed
                    let config = self.config.read().unwrap();
                    while events.len() > config.max_events {
                        events.pop_front();
                    }
                    
                    // Store in Redis
                    let _ = self.store_event(symbol, &event).await;
                }
            }
            
            prev_orderbooks.insert(symbol.clone(), (orderbook.clone(), Utc::now()));
        }
        
        // Check for spoofing if enabled
        if self.config.read().unwrap().detect_spoofing {
            if let Some(event) = self.detect_spoofing(symbol, orderbook) {
                // Cache the event
                let mut events_cache = self.events_cache.write().unwrap();
                let events = events_cache.entry(symbol.clone()).or_insert_with(VecDeque::new);
                events.push_back(event.clone());
                
                // Trim if needed
                let config = self.config.read().unwrap();
                while events.len() > config.max_events {
                    events.pop_front();
                }
                
                // Store in Redis
                let _ = self.store_event(symbol, &event).await;
            }
        }
        
        // Calculate imbalance
        let imbalance = self.analyze_orderbook_imbalance(orderbook);
        
        // Update metrics with new imbalance
        {
            let mut metrics_cache = self.metrics_cache.write().unwrap();
            if let Some(metrics) = metrics_cache.get_mut(symbol) {
                metrics.imbalance = imbalance.clone();
                metrics.timestamp = Utc::now();
                
                // Store in Redis
                let _ = self.store_metrics(metrics).await;
            }
        }
        
        Ok(imbalance)
    }
    
    async fn get_metrics(&self, symbol: &Symbol) -> OrderFlowResult<OrderFlowMetrics> {
        // Try from cache first
        {
            let metrics_cache = self.metrics_cache.read().unwrap();
            if let Some(metrics) = metrics_cache.get(symbol) {
                return Ok(metrics.clone());
            }
        }
        
        // Try from Redis
        match self.redis.get::<OrderFlowMetrics>(&self.metrics_key(symbol)).await {
            Ok(Some(metrics)) => {
                // Update cache
                let mut metrics_cache = self.metrics_cache.write().unwrap();
                metrics_cache.insert(symbol.clone(), metrics.clone());
                Ok(metrics)
            },
            Ok(None) => Err(OrderFlowError::SymbolNotFound(symbol.clone())),
            Err(e) => Err(OrderFlowError::Redis(e.to_string())),
        }
    }
    
    async fn get_events(&self, symbol: &Symbol, limit: Option<usize>) -> OrderFlowResult<Vec<OrderFlowEvent>> {
        // Try from cache first
        let from_cache = {
            let events_cache = self.events_cache.read().unwrap();
            events_cache.get(symbol).map(|events| {
                let limit_val = limit.unwrap_or_else(|| events.len());
                events.iter().rev().take(limit_val).cloned().collect::<Vec<_>>()
            })
        };
        
        if let Some(events) = from_cache {
            return Ok(events);
        }
        
        // Try from Redis
        match self.redis.get::<Vec<OrderFlowEvent>>(&self.events_key(symbol)).await {
            Ok(Some(mut events)) => {
                // Sort by timestamp (most recent first)
                events.sort_by(|a, b| {
                    let a_time = match a {
                        OrderFlowEvent::LargeTrade { timestamp, .. } => timestamp,
                        OrderFlowEvent::OrderBookSweep { timestamp, .. } => timestamp,
                        OrderFlowEvent::PossibleSpoofing { timestamp, .. } => timestamp,
                        OrderFlowEvent::QuoteStuffing { timestamp, .. } => timestamp,
                        OrderFlowEvent::LiquidityVacuum { timestamp, .. } => timestamp,
                        OrderFlowEvent::MomentumSurge { timestamp, .. } => timestamp,
                    };
                    
                    let b_time = match b {
                        OrderFlowEvent::LargeTrade { timestamp, .. } => timestamp,
                        OrderFlowEvent::OrderBookSweep { timestamp, .. } => timestamp,
                        OrderFlowEvent::PossibleSpoofing { timestamp, .. } => timestamp,
                        OrderFlowEvent::QuoteStuffing { timestamp, .. } => timestamp,
                        OrderFlowEvent::LiquidityVacuum { timestamp, .. } => timestamp,
                        OrderFlowEvent::MomentumSurge { timestamp, .. } => timestamp,
                    };
                    
                    b_time.cmp(a_time) // Most recent first
                });
                
                // Apply limit if specified
                if let Some(limit_val) = limit {
                    events.truncate(limit_val);
                }
                
                // Update cache
                {
                    let mut events_cache = self.events_cache.write().unwrap();
                    let cache = events_cache.entry(symbol.clone()).or_insert_with(VecDeque::new);
                    
                    // Clear and refill
                    cache.clear();
                    for event in events.iter().rev() { // Reverse to get chronological in the deque
                        cache.push_back(event.clone());
                    }
                }
                
                Ok(events)
            },
            Ok(None) => Ok(Vec::new()),
            Err(e) => Err(OrderFlowError::Redis(e.to_string())),
        }
    }
    
    async fn check_manipulation(&self, symbol: &Symbol) -> OrderFlowResult<HashMap<String, f64>> {
        let mut indicators = HashMap::new();
        
        // Get recent events
        let events = match self.get_events(symbol, None).await {
            Ok(evts) => evts,
            Err(_) => Vec::new(),
        };
        
        // Count by type
        let now = Utc::now();
        let window = chrono::Duration::seconds(
            self.config.read().unwrap().trade_window_sec as i64
        );
        
        let recent_events: Vec<_> = events.into_iter()
            .filter(|e| {
                let timestamp = match e {
                    OrderFlowEvent::LargeTrade { timestamp, .. } => timestamp,
                    OrderFlowEvent::OrderBookSweep { timestamp, .. } => timestamp,
                    OrderFlowEvent::PossibleSpoofing { timestamp, .. } => timestamp,
                    OrderFlowEvent::QuoteStuffing { timestamp, .. } => timestamp,
                    OrderFlowEvent::LiquidityVacuum { timestamp, .. } => timestamp,
                    OrderFlowEvent::MomentumSurge { timestamp, .. } => timestamp,
                };
                
                *timestamp + window >= now
            })
            .collect();
        
        // Count by type in recent window
        let mut spoofing_count = 0;
        let mut quote_stuffing_count = 0;
        let mut sweep_count = 0;
        let mut liquidity_vacuum_count = 0;
        
        for event in recent_events {
            match event {
                OrderFlowEvent::PossibleSpoofing { .. } => spoofing_count += 1,
                OrderFlowEvent::QuoteStuffing { .. } => quote_stuffing_count += 1,
                OrderFlowEvent::OrderBookSweep { .. } => sweep_count += 1,
                OrderFlowEvent::LiquidityVacuum { .. } => liquidity_vacuum_count += 1,
                _ => {}
            }
        }
        
        // Convert counts to confidence scores (0-1)
        let config = self.config.read().unwrap();
        
        if spoofing_count > 0 {
            indicators.insert(
                "spoofing".to_string(),
                (spoofing_count as f64 * 0.2).min(1.0)
            );
        }
        
        if quote_stuffing_count > 0 {
            indicators.insert(
                "quote_stuffing".to_string(),
                (quote_stuffing_count as f64 * 0.15).min(1.0)
            );
        }
        
        if sweep_count > 0 {
            indicators.insert(
                "sweeping".to_string(),
                (sweep_count as f64 * 0.1).min(1.0)
            );
        }
        
        if liquidity_vacuum_count > 0 {
            indicators.insert(
                "liquidity_disappearance".to_string(),
                (liquidity_vacuum_count as f64 * 0.25).min(1.0)
            );
        }
        
        // Add imbalance persistence indicators
        let metrics = match self.get_metrics(symbol).await {
            Ok(m) => m,
            Err(_) => return Ok(indicators),
        };
        
        if metrics.imbalance.is_significant(0.8) {
            indicators.insert(
                "extreme_imbalance".to_string(),
                metrics.imbalance.normalized.abs()
            );
        }
        
        Ok(indicators)
    }
    
    async fn reset_metrics(&self, symbol: &Symbol) -> OrderFlowResult<()> {
        // Clear caches
        {
            let mut metrics_cache = self.metrics_cache.write().unwrap();
            metrics_cache.remove(symbol);
            
            let mut events_cache = self.events_cache.write().unwrap();
            events_cache.remove(symbol);
            
            let mut historical_trades = self.historical_trades.write().unwrap();
            historical_trades.remove(symbol);
            
            let mut avg_trade_sizes = self.avg_trade_sizes.write().unwrap();
            avg_trade_sizes.remove(symbol);
            
            let mut previous_orderbooks = self.previous_orderbooks.write().unwrap();
            previous_orderbooks.remove(symbol);
        }
        
        // Remove from Redis
        if let Err(e) = self.redis.delete(&self.metrics_key(symbol)).await {
            return Err(OrderFlowError::Redis(e.to_string()));
        }
        
        if let Err(e) = self.redis.delete(&self.events_key(symbol)).await {
            return Err(OrderFlowError::Redis(e.to_string()));
        }
        
        Ok(())
    }
    
    fn get_config(&self) -> &RwLock<OrderFlowConfig> {
        &self.config
    }
    
    async fn update_config(&self, config: OrderFlowConfig) -> OrderFlowResult<()> {
        let mut cfg = self.config.write().unwrap();
        *cfg = config;
        Ok(())
    }
}

/// Create a default order flow analyzer
pub fn create_order_flow_analyzer(redis: Arc<dyn RedisClient>) -> Arc<dyn OrderFlowAnalyzer> {
    Arc::new(DefaultOrderFlowAnalyzer::new(redis))
}

/// Create an order flow analyzer with custom configuration
pub fn create_order_flow_analyzer_with_config(
    redis: Arc<dyn RedisClient>,
    config: OrderFlowConfig,
) -> Arc<dyn OrderFlowAnalyzer> {
    Arc::new(DefaultOrderFlowAnalyzer::with_config(redis, config))
}

/// Create a mock order flow analyzer for testing
pub struct MockOrderFlowAnalyzer {
    metrics: RwLock<HashMap<Symbol, OrderFlowMetrics>>,
    events: RwLock<HashMap<Symbol, Vec<OrderFlowEvent>>>,
    config: OrderFlowConfig,
}

impl MockOrderFlowAnalyzer {
    /// Create a new mock analyzer
    pub fn new() -> Self {
        Self {
            metrics: RwLock::new(HashMap::new()),
            events: RwLock::new(HashMap::new()),
            config: OrderFlowConfig::default(),
        }
    }
    
    /// Set mock metrics for a symbol
    pub fn set_metrics(&self, symbol: Symbol, metrics: OrderFlowMetrics) {
        let mut m = self.metrics.write().unwrap();
        m.insert(symbol, metrics);
    }
    
    /// Add a mock event
    pub fn add_event(&self, symbol: Symbol, event: OrderFlowEvent) {
        let mut e = self.events.write().unwrap();
        let events = e.entry(symbol).or_insert_with(Vec::new);
        events.push(event);
    }
}

#[async_trait::async_trait]
impl OrderFlowAnalyzer for MockOrderFlowAnalyzer {
    async fn process_market_data(&self, market_data: &MarketData) -> OrderFlowResult<OrderFlowMetrics> {
        let symbol = market_data.symbol.clone();
        
        // Return existing metrics if we have them
        if let Some(metrics) = self.metrics.read().unwrap().get(&symbol) {
            return Ok(metrics.clone());
        }
        
        // Otherwise create default metrics
        let metrics = OrderFlowMetrics::new(symbol, self.config.trade_window_sec);
        Ok(metrics)
    }
    
    async fn process_trade(
        &self,
        symbol: &Symbol,
        price: f64,
        quantity: f64,
        is_buy: bool,
    ) -> OrderFlowResult<TradeExecution> {
        Ok(TradeExecution::new(
            symbol.clone(),
            price,
            quantity,
            is_buy,
            if is_buy { TradeAggression::Buying } else { TradeAggression::Selling },
        ))
    }
    
    async fn process_orderbook(&self, symbol: &Symbol, _orderbook: &Orderbook) -> OrderFlowResult<OrderImbalance> {
        Ok(OrderImbalance::new(100.0, 100.0, 10))
    }
    
    async fn get_metrics(&self, symbol: &Symbol) -> OrderFlowResult<OrderFlowMetrics> {
        if let Some(metrics) = self.metrics.read().unwrap().get(symbol) {
            Ok(metrics.clone())
        } else {
            Err(OrderFlowError::SymbolNotFound(symbol.clone()))
        }
    }
    
    async fn get_events(&self, symbol: &Symbol, limit: Option<usize>) -> OrderFlowResult<Vec<OrderFlowEvent>> {
        if let Some(events) = self.events.read().unwrap().get(symbol) {
            let limit_val = limit.unwrap_or_else(|| events.len());
            Ok(events.iter().take(limit_val).cloned().collect())
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn check_manipulation(&self, _symbol: &Symbol) -> OrderFlowResult<HashMap<String, f64>> {
        Ok(HashMap::new())
    }
    
    async fn reset_metrics(&self, symbol: &Symbol) -> OrderFlowResult<()> {
        let mut metrics = self.metrics.write().unwrap();
        metrics.remove(symbol);
        
        let mut events = self.events.write().unwrap();
        events.remove(symbol);
        
        Ok(())
    }
    
    fn get_config(&self) -> &OrderFlowConfig {
        &self.config
    }
    
    async fn update_config(&self, _config: OrderFlowConfig) -> OrderFlowResult<()> {
        Ok(())
    }
}

/// Create a mock order flow analyzer for testing
pub fn create_mock_order_flow_analyzer() -> Arc<dyn OrderFlowAnalyzer> {
    Arc::new(MockOrderFlowAnalyzer::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    // Mock Redis client for testing
    struct MockRedisClient;
    
    #[async_trait::async_trait]
    impl RedisClient for MockRedisClient {
        async fn get<T: for<'de> serde::Deserialize<'de> + Send + Sync>(&self, _key: &str) -> RedisClientResult<Option<T>> {
            Ok(None)
        }
        
        async fn set<T: serde::Serialize + Send + Sync>(&self, _key: &str, _value: &T, _ttl_seconds: Option<u64>) -> RedisClientResult<()> {
            Ok(())
        }
        
        async fn delete(&self, _key: &str) -> RedisClientResult<()> {
            Ok(())
        }
        
        async fn publish<T: serde::Serialize + Send + Sync>(&self, _channel: &str, _message: &T) -> RedisClientResult<()> {
            Ok(())
        }
    }
    
    fn create_test_orderbook() -> Orderbook {
        use rust_decimal_macros::dec;
        
        let bids = vec![
            OrderbookEntry::new(dec!(100.0), dec!(10.0)),
            OrderbookEntry::new(dec!(99.0), dec!(20.0)),
            OrderbookEntry::new(dec!(98.0), dec!(30.0)),
        ];
        
        let asks = vec![
            OrderbookEntry::new(dec!(101.0), dec!(15.0)),
            OrderbookEntry::new(dec!(102.0), dec!(25.0)),
            OrderbookEntry::new(dec!(103.0), dec!(35.0)),
        ];
        
        Orderbook::new(bids, asks)
    }
    
    #[tokio::test]
    async fn test_order_imbalance_calculation() {
        let orderbook = create_test_orderbook();
        
        let redis = Arc::new(MockRedisClient);
        let analyzer = DefaultOrderFlowAnalyzer::new(redis);
        
        let imbalance = analyzer.analyze_orderbook_imbalance(&orderbook);
        
        assert_eq!(imbalance.levels_analyzed, 3);
        assert!(imbalance.bid_quantity > 0.0);
        assert!(imbalance.ask_quantity > 0.0);
        assert!(imbalance.weighted_bid_quantity.is_some());
        assert!(imbalance.weighted_ask_quantity.is_some());
    }
    
    #[tokio::test]
    async fn test_process_trade() {
        let redis = Arc::new(MockRedisClient);
        let analyzer = DefaultOrderFlowAnalyzer::new(redis);
        
        let symbol = "BTC/USDT".to_string();
        let result = analyzer.process_trade(&symbol, 100.0, 1.0, true).await;
        
        assert!(result.is_ok());
        let trade = result.unwrap();
        assert_eq!(trade.symbol, symbol);
        assert_eq!(trade.price, 100.0);
        assert_eq!(trade.quantity, 1.0);
        assert!(trade.is_buy);
    }
    
    #[tokio::test]
    async fn test_mock_analyzer() {
        let analyzer = MockOrderFlowAnalyzer::new();
        
        let symbol = "BTC/USDT".to_string();
        
        // Test empty state
        let result = analyzer.get_metrics(&symbol).await;
        assert!(result.is_err());
        
        // Add mock data
        let metrics = OrderFlowMetrics::new(symbol.clone(), 300);
        analyzer.set_metrics(symbol.clone(), metrics);
        
        // Test retrieval
        let result = analyzer.get_metrics(&symbol).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().symbol, symbol);
    }
} 