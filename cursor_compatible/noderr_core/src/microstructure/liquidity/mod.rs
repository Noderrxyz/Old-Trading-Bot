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

//! Liquidity Profiling Engine
//!
//! This module provides tools for analyzing market liquidity, including order book depth,
//! spread analysis, and slippage estimation for optimal trade execution.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use rust_decimal::Decimal;

use crate::market::{MarketData, Orderbook, Symbol, Ticker};
use crate::redis::{RedisClient, RedisClientResult};

/// Error types for liquidity operations
#[derive(Debug, Error)]
pub enum LiquidityError {
    #[error("Redis error: {0}")]
    Redis(String),
    
    #[error("Symbol not found: {0}")]
    SymbolNotFound(String),
    
    #[error("Invalid data: {0}")]
    InvalidData(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for liquidity operations
pub type LiquidityResult<T> = Result<T, LiquidityError>;

/// Snapshot of market liquidity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquiditySnapshot {
    /// Symbol this snapshot applies to
    pub symbol: Symbol,
    
    /// Bid-ask spread in absolute terms
    pub spread: f64,
    
    /// Bid-ask spread as percentage of mid price
    pub spread_pct: f64,
    
    /// Order book depth (sum of bid and ask values up to depth)
    pub depth: f64,
    
    /// Estimated slippage for a given trade size
    pub est_slippage: f64,
    
    /// Standard size used for slippage estimation
    pub standard_size: f64,
    
    /// Liquidity score (0-100, higher is more liquid)
    pub liquidity_score: u8,
    
    /// Order book skew (-1 to 1, negative means more selling pressure)
    pub book_skew: f64,
    
    /// Bid wall sizes (price levels with significantly higher bids)
    pub bid_walls: Vec<(f64, f64)>, // (price, size)
    
    /// Ask wall sizes (price levels with significantly higher asks)
    pub ask_walls: Vec<(f64, f64)>, // (price, size)
    
    /// Depth at different percentage levels from mid
    pub depth_map: HashMap<String, f64>,
    
    /// Timestamp of this snapshot
    pub timestamp: DateTime<Utc>,
}

impl LiquiditySnapshot {
    /// Create a new liquidity snapshot
    pub fn new(symbol: Symbol, spread: f64, spread_pct: f64, depth: f64) -> Self {
        Self {
            symbol,
            spread,
            spread_pct,
            depth,
            est_slippage: 0.0,
            standard_size: 0.0,
            liquidity_score: 50, // Default neutral score
            book_skew: 0.0,
            bid_walls: Vec::new(),
            ask_walls: Vec::new(),
            depth_map: HashMap::new(),
            timestamp: Utc::now(),
        }
    }
    
    /// With estimated slippage for standard size
    pub fn with_slippage(mut self, est_slippage: f64, standard_size: f64) -> Self {
        self.est_slippage = est_slippage;
        self.standard_size = standard_size;
        self
    }
    
    /// With liquidity score
    pub fn with_score(mut self, score: u8) -> Self {
        self.liquidity_score = score;
        self
    }
    
    /// With order book skew
    pub fn with_skew(mut self, skew: f64) -> Self {
        self.book_skew = skew;
        self
    }
    
    /// With walls detected
    pub fn with_walls(mut self, bid_walls: Vec<(f64, f64)>, ask_walls: Vec<(f64, f64)>) -> Self {
        self.bid_walls = bid_walls;
        self.ask_walls = ask_walls;
        self
    }
    
    /// With depth map at different levels
    pub fn with_depth_map(mut self, depth_map: HashMap<String, f64>) -> Self {
        self.depth_map = depth_map;
        self
    }
    
    /// Is the market considered highly liquid?
    pub fn is_highly_liquid(&self) -> bool {
        self.liquidity_score >= 80
    }
    
    /// Is the market considered illiquid?
    pub fn is_illiquid(&self) -> bool {
        self.liquidity_score <= 30
    }
    
    /// Get the largest bid wall
    pub fn largest_bid_wall(&self) -> Option<(f64, f64)> {
        self.bid_walls.iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)).cloned()
    }
    
    /// Get the largest ask wall
    pub fn largest_ask_wall(&self) -> Option<(f64, f64)> {
        self.ask_walls.iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)).cloned()
    }
}

/// Configuration for the liquidity profiler
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidityProfilerConfig {
    /// Standard size for slippage calculation (in base units)
    pub standard_size: f64,
    
    /// Percentage levels from mid to measure depth (e.g., 0.1%, 0.5%, 1%)
    pub depth_levels: Vec<f64>,
    
    /// Number of price levels to analyze
    pub max_levels: usize,
    
    /// Threshold for what counts as a "wall" (multiple of average level size)
    pub wall_threshold: f64,
    
    /// Score weights for different liquidity factors
    pub score_weights: HashMap<String, f64>,
    
    /// How often to sample liquidity (seconds)
    pub sampling_interval_sec: u64,
    
    /// Whether to calculate depth distribution
    pub calc_depth_distribution: bool,
}

impl Default for LiquidityProfilerConfig {
    fn default() -> Self {
        let mut score_weights = HashMap::new();
        score_weights.insert("spread".to_string(), 0.3);
        score_weights.insert("depth".to_string(), 0.4);
        score_weights.insert("slippage".to_string(), 0.3);
        
        Self {
            standard_size: 1.0, // Will be adjusted per market
            depth_levels: vec![0.001, 0.005, 0.01, 0.02, 0.05], // 0.1%, 0.5%, 1%, 2%, 5%
            max_levels: 20,
            wall_threshold: 3.0,
            score_weights,
            sampling_interval_sec: 60,
            calc_depth_distribution: true,
        }
    }
}

/// Interface for liquidity profiling
#[async_trait::async_trait]
pub trait LiquidityProfiler: Send + Sync {
    /// Analyze liquidity from market data
    async fn analyze_liquidity(&self, market_data: &MarketData) -> LiquidityResult<LiquiditySnapshot>;
    
    /// Get latest liquidity snapshot for a symbol
    async fn get_snapshot(&self, symbol: &Symbol) -> LiquidityResult<LiquiditySnapshot>;
    
    /// Get historical liquidity snapshots
    async fn get_historical_snapshots(
        &self,
        symbol: &Symbol,
        from_time: DateTime<Utc>,
        to_time: DateTime<Utc>,
        limit: Option<usize>,
    ) -> LiquidityResult<Vec<LiquiditySnapshot>>;
    
    /// Calculate estimated slippage for a given size
    async fn calculate_slippage(
        &self,
        symbol: &Symbol,
        size: f64,
        is_buy: bool,
    ) -> LiquidityResult<f64>;
    
    /// Reset liquidity data for a symbol
    async fn reset(&self, symbol: &Symbol) -> LiquidityResult<()>;
    
    /// Get configuration
    fn get_config(&self) -> &LiquidityProfilerConfig;
    
    /// Update configuration
    async fn update_config(&self, config: LiquidityProfilerConfig) -> LiquidityResult<()>;
}

/// Implementation of the LiquidityProfiler
pub struct DefaultLiquidityProfiler {
    /// Redis client for persistence
    redis: Arc<dyn RedisClient>,
    
    /// Configuration
    config: RwLock<LiquidityProfilerConfig>,
    
    /// Cache of latest snapshots by symbol
    snapshots: RwLock<HashMap<Symbol, LiquiditySnapshot>>,
    
    /// Market-specific standard sizes
    standard_sizes: RwLock<HashMap<Symbol, f64>>,
}

impl DefaultLiquidityProfiler {
    /// Create a new DefaultLiquidityProfiler
    pub fn new(redis: Arc<dyn RedisClient>) -> Self {
        Self {
            redis,
            config: RwLock::new(LiquidityProfilerConfig::default()),
            snapshots: RwLock::new(HashMap::new()),
            standard_sizes: RwLock::new(HashMap::new()),
        }
    }
    
    /// Create with custom config
    pub fn with_config(redis: Arc<dyn RedisClient>, config: LiquidityProfilerConfig) -> Self {
        Self {
            redis,
            config: RwLock::new(config),
            snapshots: RwLock::new(HashMap::new()),
            standard_sizes: RwLock::new(HashMap::new()),
        }
    }
    
    /// Redis key for liquidity snapshot
    fn snapshot_key(&self, symbol: &Symbol) -> String {
        format!("micro:liquidity:{}", symbol)
    }
    
    /// Redis key for historical snapshots
    fn historical_key(&self, symbol: &Symbol, timestamp: i64) -> String {
        format!("micro:liquidity:{}:{}", symbol, timestamp)
    }
    
    /// Analyze the order book to find walls
    fn detect_walls(&self, orderbook: &Orderbook) -> (Vec<(f64, f64)>, Vec<(f64, f64)>) {
        let config = self.config.read().unwrap();
        
        // Calculate average size per level for bids and asks
        let bid_levels = orderbook.bids.len().min(config.max_levels);
        let ask_levels = orderbook.asks.len().min(config.max_levels);
        
        if bid_levels == 0 || ask_levels == 0 {
            return (Vec::new(), Vec::new());
        }
        
        let avg_bid_size: f64 = orderbook.bids.iter()
            .take(bid_levels)
            .map(|entry| entry.quantity.to_f64().unwrap_or(0.0))
            .sum::<f64>() / bid_levels as f64;
            
        let avg_ask_size: f64 = orderbook.asks.iter()
            .take(ask_levels)
            .map(|entry| entry.quantity.to_f64().unwrap_or(0.0))
            .sum::<f64>() / ask_levels as f64;
        
        // Find walls (levels with size > threshold * avg)
        let mut bid_walls = Vec::new();
        let mut ask_walls = Vec::new();
        
        for entry in orderbook.bids.iter().take(bid_levels) {
            let price = entry.price.to_f64().unwrap_or(0.0);
            let quantity = entry.quantity.to_f64().unwrap_or(0.0);
            
            if quantity > avg_bid_size * config.wall_threshold {
                bid_walls.push((price, quantity));
            }
        }
        
        for entry in orderbook.asks.iter().take(ask_levels) {
            let price = entry.price.to_f64().unwrap_or(0.0);
            let quantity = entry.quantity.to_f64().unwrap_or(0.0);
            
            if quantity > avg_ask_size * config.wall_threshold {
                ask_walls.push((price, quantity));
            }
        }
        
        (bid_walls, ask_walls)
    }
    
    /// Calculate a liquidity score from various metrics
    fn calculate_liquidity_score(
        &self,
        spread_pct: f64,
        depth: f64,
        slippage: f64,
        average_depth: Option<f64>,
    ) -> u8 {
        let config = self.config.read().unwrap();
        let weights = &config.score_weights;
        
        // Spread score (lower is better) - exponential scoring
        let spread_score = 100.0 * (-5.0 * spread_pct).exp();
        
        // Depth score (higher is better)
        let depth_score = if let Some(avg) = average_depth {
            if avg > 0.0 {
                (100.0 * (depth / avg)).min(100.0)
            } else {
                50.0 // Default if no comparison
            }
        } else {
            // Simple heuristic if we don't have an average
            (100.0 * (1.0 - (-0.0001 * depth).exp())).min(100.0)
        };
        
        // Slippage score (lower is better)
        let slippage_score = 100.0 * (-20.0 * slippage).exp();
        
        // Weighted combination
        let spread_weight = weights.get("spread").cloned().unwrap_or(0.3);
        let depth_weight = weights.get("depth").cloned().unwrap_or(0.4);
        let slippage_weight = weights.get("slippage").cloned().unwrap_or(0.3);
        
        let final_score = spread_weight * spread_score + 
                         depth_weight * depth_score + 
                         slippage_weight * slippage_score;
                         
        final_score.round().min(100.0).max(0.0) as u8
    }
    
    /// Calculate depth at different percentage levels from mid price
    fn calculate_depth_map(&self, orderbook: &Orderbook) -> HashMap<String, f64> {
        let config = self.config.read().unwrap();
        
        if !config.calc_depth_distribution {
            return HashMap::new();
        }
        
        let mid_price = match orderbook.mid_price() {
            Some(mid) => mid.to_f64().unwrap_or(0.0),
            None => return HashMap::new(),
        };
        
        let mut result = HashMap::new();
        
        for &level_pct in &config.depth_levels {
            let bid_threshold = mid_price * (1.0 - level_pct);
            let ask_threshold = mid_price * (1.0 + level_pct);
            
            // Sum up quantities within these thresholds
            let bid_depth: f64 = orderbook.bids.iter()
                .filter(|entry| {
                    let price = entry.price.to_f64().unwrap_or(0.0);
                    price >= bid_threshold
                })
                .map(|entry| entry.quantity.to_f64().unwrap_or(0.0))
                .sum();
                
            let ask_depth: f64 = orderbook.asks.iter()
                .filter(|entry| {
                    let price = entry.price.to_f64().unwrap_or(0.0);
                    price <= ask_threshold
                })
                .map(|entry| entry.quantity.to_f64().unwrap_or(0.0))
                .sum();
            
            // Store total depth at this level
            result.insert(format!("{:.3}%", level_pct * 100.0), bid_depth + ask_depth);
            
            // Store individual sides too
            result.insert(format!("{:.3}%_bid", level_pct * 100.0), bid_depth);
            result.insert(format!("{:.3}%_ask", level_pct * 100.0), ask_depth);
        }
        
        result
    }
    
    /// Calculate book skew (-1 to 1)
    fn calculate_book_skew(&self, orderbook: &Orderbook) -> f64 {
        let config = self.config.read().unwrap();
        let levels = config.max_levels.min(orderbook.bids.len()).min(orderbook.asks.len());
        
        if levels == 0 {
            return 0.0;
        }
        
        let bid_value: f64 = orderbook.bids.iter()
            .take(levels)
            .map(|entry| {
                entry.price.to_f64().unwrap_or(0.0) * entry.quantity.to_f64().unwrap_or(0.0)
            })
            .sum();
            
        let ask_value: f64 = orderbook.asks.iter()
            .take(levels)
            .map(|entry| {
                entry.price.to_f64().unwrap_or(0.0) * entry.quantity.to_f64().unwrap_or(0.0)
            })
            .sum();
        
        if bid_value + ask_value == 0.0 {
            return 0.0;
        }
        
        // Calculate normalized skew (-1 to 1)
        (bid_value - ask_value) / (bid_value + ask_value)
    }
    
    /// Calculate slippage for a given size
    fn estimate_slippage(&self, orderbook: &Orderbook, size: f64, is_buy: bool) -> f64 {
        let mid_price = match orderbook.mid_price() {
            Some(mid) => mid.to_f64().unwrap_or(0.0),
            None => return 0.0,
        };
        
        if mid_price == 0.0 || size == 0.0 {
            return 0.0;
        }
        
        let mut remaining_size = size;
        let mut total_cost = 0.0;
        
        if is_buy {
            // Walk the ask book
            for entry in &orderbook.asks {
                let price = entry.price.to_f64().unwrap_or(0.0);
                let quantity = entry.quantity.to_f64().unwrap_or(0.0);
                
                let filled = quantity.min(remaining_size);
                total_cost += filled * price;
                remaining_size -= filled;
                
                if remaining_size <= 0.0 {
                    break;
                }
            }
            
            // If we couldn't fill the full size, use the last price
            if remaining_size > 0.0 {
                if let Some(last_entry) = orderbook.asks.last() {
                    let last_price = last_entry.price.to_f64().unwrap_or(0.0);
                    total_cost += remaining_size * last_price;
                } else {
                    // No asks available
                    return 0.0;
                }
            }
        } else {
            // Walk the bid book
            for entry in &orderbook.bids {
                let price = entry.price.to_f64().unwrap_or(0.0);
                let quantity = entry.quantity.to_f64().unwrap_or(0.0);
                
                let filled = quantity.min(remaining_size);
                total_cost += filled * price;
                remaining_size -= filled;
                
                if remaining_size <= 0.0 {
                    break;
                }
            }
            
            // If we couldn't fill the full size, use the last price
            if remaining_size > 0.0 {
                if let Some(last_entry) = orderbook.bids.last() {
                    let last_price = last_entry.price.to_f64().unwrap_or(0.0);
                    total_cost += remaining_size * last_price;
                } else {
                    // No bids available
                    return 0.0;
                }
            }
        }
        
        let avg_execution_price = total_cost / size;
        let slippage = if is_buy {
            (avg_execution_price - mid_price) / mid_price
        } else {
            (mid_price - avg_execution_price) / mid_price
        };
        
        slippage.max(0.0) // Slippage can't be negative
    }
    
    /// Store snapshot in Redis
    async fn store_snapshot(&self, snapshot: &LiquiditySnapshot) -> LiquidityResult<()> {
        // Store current snapshot
        if let Err(e) = self.redis.set(
            &self.snapshot_key(&snapshot.symbol),
            snapshot,
            Some(3600) // 1 hour TTL
        ).await {
            return Err(LiquidityError::Redis(e.to_string()));
        }
        
        // Store historical snapshot
        let historical_key = self.historical_key(&snapshot.symbol, snapshot.timestamp.timestamp());
        if let Err(e) = self.redis.set(
            &historical_key,
            snapshot,
            Some(86400 * 7) // 7 days TTL
        ).await {
            warn!("Failed to store historical snapshot: {}", e);
            // Continue anyway, not critical
        }
        
        Ok(())
    }
}

#[async_trait::async_trait]
impl LiquidityProfiler for DefaultLiquidityProfiler {
    async fn analyze_liquidity(&self, market_data: &MarketData) -> LiquidityResult<LiquiditySnapshot> {
        let symbol = market_data.symbol.clone();
        
        // Require orderbook data
        let orderbook = match &market_data.orderbook {
            Some(ob) => ob,
            None => return Err(LiquidityError::InvalidData("No orderbook data available".to_string())),
        };
        
        // Calculate basic metrics
        let spread = match (orderbook.best_ask(), orderbook.best_bid()) {
            (Some(ask), Some(bid)) => (ask - bid).to_f64().unwrap_or(0.0),
            _ => return Err(LiquidityError::InvalidData("Invalid orderbook data".to_string())),
        };
        
        let mid_price = match orderbook.mid_price() {
            Some(mid) => mid.to_f64().unwrap_or(0.0),
            None => return Err(LiquidityError::InvalidData("Invalid orderbook data".to_string())),
        };
        
        let spread_pct = if mid_price > 0.0 {
            spread / mid_price
        } else {
            0.0
        };
        
        // Calculate depth (sum of bid and ask values up to depth limit)
        let config = self.config.read().unwrap();
        let max_levels = config.max_levels;
        
        let depth: f64 = orderbook.bids.iter().take(max_levels)
            .map(|entry| entry.price.to_f64().unwrap_or(0.0) * entry.quantity.to_f64().unwrap_or(0.0))
            .sum::<f64>()
            + orderbook.asks.iter().take(max_levels)
            .map(|entry| entry.price.to_f64().unwrap_or(0.0) * entry.quantity.to_f64().unwrap_or(0.0))
            .sum::<f64>();
        
        // Get standard size for this market
        let standard_size = {
            let sizes = self.standard_sizes.read().unwrap();
            sizes.get(&symbol).cloned().unwrap_or_else(|| {
                // Default to config value if not set for this market
                config.standard_size
            })
        };
        
        // Calculate slippage for standard size
        let slippage_buy = self.estimate_slippage(orderbook, standard_size, true);
        let slippage_sell = self.estimate_slippage(orderbook, standard_size, false);
        
        // Use the worse of the two slippages
        let est_slippage = slippage_buy.max(slippage_sell);
        
        // Detect walls
        let (bid_walls, ask_walls) = self.detect_walls(orderbook);
        
        // Calculate depth map
        let depth_map = self.calculate_depth_map(orderbook);
        
        // Calculate book skew
        let book_skew = self.calculate_book_skew(orderbook);
        
        // Calculate liquidity score
        // We would ideally compare to historical average depth for this market
        let average_depth = None; // In a full implementation, get this from a time series
        let liquidity_score = self.calculate_liquidity_score(spread_pct, depth, est_slippage, average_depth);
        
        // Create snapshot
        let snapshot = LiquiditySnapshot::new(symbol.clone(), spread, spread_pct, depth)
            .with_slippage(est_slippage, standard_size)
            .with_score(liquidity_score)
            .with_skew(book_skew)
            .with_walls(bid_walls, ask_walls)
            .with_depth_map(depth_map);
        
        // Cache the snapshot
        {
            let mut snapshots = self.snapshots.write().unwrap();
            snapshots.insert(symbol.clone(), snapshot.clone());
        }
        
        // Store in Redis
        let _ = self.store_snapshot(&snapshot).await;
        
        Ok(snapshot)
    }
    
    async fn get_snapshot(&self, symbol: &Symbol) -> LiquidityResult<LiquiditySnapshot> {
        // Try from cache first
        {
            let snapshots = self.snapshots.read().unwrap();
            if let Some(snapshot) = snapshots.get(symbol) {
                // If snapshot is recent enough, return it
                let now = Utc::now();
                let age = now.timestamp() - snapshot.timestamp.timestamp();
                if age < 300 { // 5 minutes
                    return Ok(snapshot.clone());
                }
            }
        }
        
        // Try from Redis
        match self.redis.get::<LiquiditySnapshot>(&self.snapshot_key(symbol)).await {
            Ok(Some(snapshot)) => {
                // Update cache
                let mut snapshots = self.snapshots.write().unwrap();
                snapshots.insert(symbol.clone(), snapshot.clone());
                Ok(snapshot)
            },
            Ok(None) => Err(LiquidityError::SymbolNotFound(symbol.clone())),
            Err(e) => Err(LiquidityError::Redis(e.to_string())),
        }
    }
    
    async fn get_historical_snapshots(
        &self,
        symbol: &Symbol,
        from_time: DateTime<Utc>,
        to_time: DateTime<Utc>,
        limit: Option<usize>,
    ) -> LiquidityResult<Vec<LiquiditySnapshot>> {
        // This would require scanning Redis for all timestamps in the range
        // For simplicity, we're implementing a placeholder that returns recent snapshots
        
        // Get recent snapshots from sorted set
        // In a real implementation, this would use Redis ZRANGEBYSCORE
        let mut result = Vec::new();
        
        if let Ok(Some(snapshot)) = self.redis.get::<LiquiditySnapshot>(&self.snapshot_key(symbol)).await {
            if snapshot.timestamp >= from_time && snapshot.timestamp <= to_time {
                result.push(snapshot);
            }
        }
        
        // Apply limit if specified
        if let Some(limit_val) = limit {
            if result.len() > limit_val {
                result.truncate(limit_val);
            }
        }
        
        Ok(result)
    }
    
    async fn calculate_slippage(
        &self,
        symbol: &Symbol,
        size: f64,
        is_buy: bool,
    ) -> LiquidityResult<f64> {
        // Get the latest snapshot
        let snapshot = match self.get_snapshot(symbol).await {
            Ok(s) => s,
            Err(_) => {
                // If no snapshot, we can't calculate slippage
                return Err(LiquidityError::SymbolNotFound(symbol.clone()));
            }
        };
        
        // If the requested size is the same as the standard size, use the pre-calculated value
        if (size - snapshot.standard_size).abs() < 0.00001 {
            return Ok(snapshot.est_slippage);
        }
        
        // Otherwise, we need the orderbook to calculate
        // In a real implementation, we would have a cached orderbook
        // For now, we'll estimate based on the size ratio
        
        // Simple model: slippage increases with the square root of size
        let size_ratio = size / snapshot.standard_size;
        let estimated_slippage = snapshot.est_slippage * size_ratio.sqrt();
        
        Ok(estimated_slippage)
    }
    
    async fn reset(&self, symbol: &Symbol) -> LiquidityResult<()> {
        // Clear cache
        {
            let mut snapshots = self.snapshots.write().unwrap();
            snapshots.remove(symbol);
            
            let mut standard_sizes = self.standard_sizes.write().unwrap();
            standard_sizes.remove(symbol);
        }
        
        // Remove from Redis
        if let Err(e) = self.redis.delete(&self.snapshot_key(symbol)).await {
            return Err(LiquidityError::Redis(e.to_string()));
        }
        
        Ok(())
    }
    
    fn get_config(&self) -> &LiquidityProfilerConfig {
        &self.config
    }
    
    async fn update_config(&self, config: LiquidityProfilerConfig) -> LiquidityResult<()> {
        let mut cfg = self.config.write().unwrap();
        *cfg = config;
        Ok(())
    }
}

/// Create a default liquidity profiler
pub fn create_liquidity_profiler(redis: Arc<dyn RedisClient>) -> Arc<dyn LiquidityProfiler> {
    Arc::new(DefaultLiquidityProfiler::new(redis))
}

/// Create a liquidity profiler with custom configuration
pub fn create_liquidity_profiler_with_config(
    redis: Arc<dyn RedisClient>,
    config: LiquidityProfilerConfig,
) -> Arc<dyn LiquidityProfiler> {
    Arc::new(DefaultLiquidityProfiler::with_config(redis, config))
}

/// Mock implementation for testing
pub struct MockLiquidityProfiler {
    snapshots: RwLock<HashMap<Symbol, LiquiditySnapshot>>,
    config: LiquidityProfilerConfig,
}

impl MockLiquidityProfiler {
    /// Create a new mock profiler
    pub fn new() -> Self {
        Self {
            snapshots: RwLock::new(HashMap::new()),
            config: LiquidityProfilerConfig::default(),
        }
    }
    
    /// Set a snapshot for testing
    pub fn set_snapshot(&self, symbol: Symbol, snapshot: LiquiditySnapshot) {
        let mut snapshots = self.snapshots.write().unwrap();
        snapshots.insert(symbol, snapshot);
    }
}

#[async_trait::async_trait]
impl LiquidityProfiler for MockLiquidityProfiler {
    async fn analyze_liquidity(&self, market_data: &MarketData) -> LiquidityResult<LiquiditySnapshot> {
        let symbol = market_data.symbol.clone();
        
        // Return a basic mock snapshot
        let snapshot = LiquiditySnapshot::new(
            symbol,
            0.01,  // spread
            0.001, // spread_pct
            10000.0 // depth
        )
        .with_slippage(0.0002, 1.0)
        .with_score(80)
        .with_skew(0.0)
        .with_walls(Vec::new(), Vec::new())
        .with_depth_map(HashMap::new());
        
        // Store in cache
        let mut snapshots = self.snapshots.write().unwrap();
        snapshots.insert(snapshot.symbol.clone(), snapshot.clone());
        
        Ok(snapshot)
    }
    
    async fn get_snapshot(&self, symbol: &Symbol) -> LiquidityResult<LiquiditySnapshot> {
        let snapshots = self.snapshots.read().unwrap();
        
        if let Some(snapshot) = snapshots.get(symbol) {
            Ok(snapshot.clone())
        } else {
            Err(LiquidityError::SymbolNotFound(symbol.clone()))
        }
    }
    
    async fn get_historical_snapshots(
        &self,
        symbol: &Symbol,
        _from_time: DateTime<Utc>,
        _to_time: DateTime<Utc>,
        _limit: Option<usize>,
    ) -> LiquidityResult<Vec<LiquiditySnapshot>> {
        // Return current snapshot in a vector if available
        let snapshots = self.snapshots.read().unwrap();
        
        if let Some(snapshot) = snapshots.get(symbol) {
            Ok(vec![snapshot.clone()])
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn calculate_slippage(
        &self,
        symbol: &Symbol,
        size: f64,
        _is_buy: bool,
    ) -> LiquidityResult<f64> {
        let snapshots = self.snapshots.read().unwrap();
        
        if let Some(snapshot) = snapshots.get(symbol) {
            // Simple mock calculation
            let size_ratio = size / snapshot.standard_size;
            Ok(snapshot.est_slippage * size_ratio.sqrt())
        } else {
            Err(LiquidityError::SymbolNotFound(symbol.clone()))
        }
    }
    
    async fn reset(&self, symbol: &Symbol) -> LiquidityResult<()> {
        let mut snapshots = self.snapshots.write().unwrap();
        snapshots.remove(symbol);
        Ok(())
    }
    
    fn get_config(&self) -> &LiquidityProfilerConfig {
        &self.config
    }
    
    async fn update_config(&self, _config: LiquidityProfilerConfig) -> LiquidityResult<()> {
        Ok(())
    }
}

/// Create a mock liquidity profiler for testing
pub fn create_mock_liquidity_profiler() -> Arc<dyn LiquidityProfiler> {
    Arc::new(MockLiquidityProfiler::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::{Orderbook, OrderbookEntry};
    
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
    
    fn create_test_market_data() -> MarketData {
        use crate::market::{Ticker, TechnicalIndicators};
        
        let ticker = Ticker {
            bid: 100.0,
            ask: 101.0,
            last: 100.5,
            volume: 1000.0,
            change_24h: 0.02,
            high_24h: 102.0,
            low_24h: 99.0,
            quote_volume: 100500.0,
        };
        
        let mut market_data = MarketData::new(
            "binance".to_string(),
            "BTC/USDT".to_string(),
            ticker,
        );
        
        market_data.update_orderbook(create_test_orderbook());
        market_data
    }
    
    #[tokio::test]
    async fn test_liquidity_analysis() {
        let redis = Arc::new(MockRedisClient);
        let profiler = DefaultLiquidityProfiler::new(redis);
        
        let market_data = create_test_market_data();
        let result = profiler.analyze_liquidity(&market_data).await;
        
        assert!(result.is_ok());
        let snapshot = result.unwrap();
        
        assert_eq!(snapshot.symbol, "BTC/USDT");
        assert_eq!(snapshot.spread, 1.0);
        assert!(snapshot.spread_pct > 0.0);
        assert!(snapshot.depth > 0.0);
        assert!(snapshot.liquidity_score > 0);
    }
    
    #[tokio::test]
    async fn test_slippage_calculation() {
        let redis = Arc::new(MockRedisClient);
        let profiler = DefaultLiquidityProfiler::new(redis);
        
        let orderbook = create_test_orderbook();
        
        // Test buying slippage
        let slippage_buy = profiler.estimate_slippage(&orderbook, 20.0, true);
        assert!(slippage_buy >= 0.0);
        
        // Test selling slippage
        let slippage_sell = profiler.estimate_slippage(&orderbook, 20.0, false);
        assert!(slippage_sell >= 0.0);
    }
    
    #[tokio::test]
    async fn test_mock_profiler() {
        let profiler = MockLiquidityProfiler::new();
        let symbol = "BTC/USDT".to_string();
        
        // Test with no data
        let result = profiler.get_snapshot(&symbol).await;
        assert!(result.is_err());
        
        // Add test data
        let snapshot = LiquiditySnapshot::new(
            symbol.clone(),
            1.0,
            0.01,
            10000.0
        );
        profiler.set_snapshot(symbol.clone(), snapshot);
        
        // Test retrieval
        let result = profiler.get_snapshot(&symbol).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().symbol, symbol);
    }
} 