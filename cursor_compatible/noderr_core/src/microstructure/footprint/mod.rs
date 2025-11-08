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

//! Footprint Chart Data Pipeline
//!
//! This module provides tools for generating footprint chart data, which shows
//! the volume distribution at each price level within a candlestick.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

use crate::market::{MarketData, Symbol, Candle, Timeframe};
use crate::redis::{RedisClient, RedisClientResult};

/// Error types for footprint operations
#[derive(Debug, Error)]
pub enum FootprintError {
    #[error("Redis error: {0}")]
    Redis(String),
    
    #[error("Symbol not found: {0}")]
    SymbolNotFound(String),
    
    #[error("Invalid data: {0}")]
    InvalidData(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for footprint operations
pub type FootprintResult<T> = Result<T, FootprintError>;

/// Price level data within a footprint chart
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    /// Price level
    pub price: f64,
    
    /// Buy volume at this price level
    pub buy_volume: f64,
    
    /// Sell volume at this price level
    pub sell_volume: f64,
    
    /// Number of buy trades
    pub buy_trades: usize,
    
    /// Number of sell trades
    pub sell_trades: usize,
    
    /// Delta (buy - sell volume)
    pub delta: f64,
    
    /// Percentage of total candle volume
    pub pct_of_total: f64,
}

impl PriceLevel {
    /// Create a new price level
    pub fn new(price: f64) -> Self {
        Self {
            price,
            buy_volume: 0.0,
            sell_volume: 0.0,
            buy_trades: 0,
            sell_trades: 0,
            delta: 0.0,
            pct_of_total: 0.0,
        }
    }
    
    /// Add volume to this price level
    pub fn add_volume(&mut self, volume: f64, is_buy: bool) {
        if is_buy {
            self.buy_volume += volume;
            self.buy_trades += 1;
        } else {
            self.sell_volume += volume;
            self.sell_trades += 1;
        }
        
        self.delta = self.buy_volume - self.sell_volume;
    }
    
    /// Calculate percentage of total volume
    pub fn calculate_percentage(&mut self, total_volume: f64) {
        if total_volume > 0.0 {
            self.pct_of_total = (self.buy_volume + self.sell_volume) / total_volume;
        }
    }
    
    /// Total volume at this price level
    pub fn total_volume(&self) -> f64 {
        self.buy_volume + self.sell_volume
    }
    
    /// Is this level dominated by buying?
    pub fn is_buy_dominant(&self) -> bool {
        self.buy_volume > self.sell_volume
    }
    
    /// Is this a significant level? (has substantial volume)
    pub fn is_significant(&self, threshold_pct: f64) -> bool {
        self.pct_of_total >= threshold_pct
    }
}

/// Footprint chart data for a candle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FootprintChartData {
    /// Symbol this data belongs to
    pub symbol: Symbol,
    
    /// Timeframe
    pub timeframe: String,
    
    /// Opening timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Price levels with volume data
    pub price_levels: Vec<PriceLevel>,
    
    /// Original candle data
    pub candle: Candle,
    
    /// Total buy volume
    pub total_buy_volume: f64,
    
    /// Total sell volume
    pub total_sell_volume: f64,
    
    /// Volume delta (buy - sell)
    pub delta: f64,
    
    /// Delta percent (delta / total volume)
    pub delta_pct: f64,
    
    /// Volume weighted average price
    pub vwap: f64,
    
    /// Price with maximum volume (point of control)
    pub poc_price: f64,
    
    /// Value area high (70% of volume above this price)
    pub value_area_high: Option<f64>,
    
    /// Value area low (70% of volume below this price)
    pub value_area_low: Option<f64>,
}

impl FootprintChartData {
    /// Create a new footprint chart data from a candle
    pub fn new(symbol: Symbol, timeframe: String, candle: Candle) -> Self {
        Self {
            symbol,
            timeframe,
            timestamp: candle.timestamp,
            price_levels: Vec::new(),
            candle,
            total_buy_volume: 0.0,
            total_sell_volume: 0.0,
            delta: 0.0,
            delta_pct: 0.0,
            vwap: 0.0,
            poc_price: 0.0,
            value_area_high: None,
            value_area_low: None,
        }
    }
    
    /// Calculate derived metrics after all data is added
    pub fn calculate_metrics(&mut self) {
        let total_volume = self.total_buy_volume + self.total_sell_volume;
        
        // Calculate percentages
        for level in &mut self.price_levels {
            level.calculate_percentage(total_volume);
        }
        
        // Sort by price
        self.price_levels.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap_or(std::cmp::Ordering::Equal));
        
        // Calculate delta percentage
        self.delta = self.total_buy_volume - self.total_sell_volume;
        if total_volume > 0.0 {
            self.delta_pct = self.delta / total_volume;
        }
        
        // Find point of control (price level with highest volume)
        if let Some(poc) = self.price_levels.iter()
            .max_by(|a, b| {
                a.total_volume().partial_cmp(&b.total_volume()).unwrap_or(std::cmp::Ordering::Equal)
            }) {
            self.poc_price = poc.price;
        }
        
        // Calculate VWAP
        let mut volume_price_sum = 0.0;
        for level in &self.price_levels {
            volume_price_sum += level.price * level.total_volume();
        }
        
        if total_volume > 0.0 {
            self.vwap = volume_price_sum / total_volume;
        }
        
        // Calculate value area
        self.calculate_value_area();
    }
    
    /// Calculate value area (range containing 70% of volume)
    fn calculate_value_area(&mut self) {
        if self.price_levels.is_empty() {
            return;
        }
        
        // Sort by volume (highest first)
        let mut levels = self.price_levels.clone();
        levels.sort_by(|a, b| b.total_volume().partial_cmp(&a.total_volume()).unwrap_or(std::cmp::Ordering::Equal));
        
        // Calculate total volume
        let total_volume = levels.iter().map(|l| l.total_volume()).sum::<f64>();
        let target_volume = total_volume * 0.7; // 70% of volume
        
        // Start from POC and expand
        let poc_price = self.poc_price;
        let mut included_prices = vec![poc_price];
        let mut included_volume = levels.iter()
            .find(|l| (l.price - poc_price).abs() < 0.00001)
            .map(|l| l.total_volume())
            .unwrap_or(0.0);
        
        // Sort remaining levels by distance from POC
        let mut remaining = levels.iter()
            .filter(|l| (l.price - poc_price).abs() >= 0.00001)
            .collect::<Vec<_>>();
            
        remaining.sort_by(|a, b| {
            let a_dist = (a.price - poc_price).abs();
            let b_dist = (b.price - poc_price).abs();
            a_dist.partial_cmp(&b_dist).unwrap_or(std::cmp::Ordering::Equal)
        });
        
        // Add levels to value area until we reach target volume
        for level in remaining {
            if included_volume >= target_volume {
                break;
            }
            
            included_prices.push(level.price);
            included_volume += level.total_volume();
        }
        
        // Find high/low of included prices
        if !included_prices.is_empty() {
            let value_area_high = included_prices.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
            let value_area_low = included_prices.iter().fold(f64::INFINITY, |a, &b| a.min(b));
            
            self.value_area_high = Some(value_area_high);
            self.value_area_low = Some(value_area_low);
        }
    }
    
    /// Is this candle bullish based on delta?
    pub fn is_delta_bullish(&self) -> bool {
        self.delta > 0.0
    }
    
    /// Is this candle strongly bullish based on delta percentage?
    pub fn is_strongly_bullish(&self) -> bool {
        self.delta_pct > 0.6
    }
    
    /// Is this candle strongly bearish based on delta percentage?
    pub fn is_strongly_bearish(&self) -> bool {
        self.delta_pct < -0.6
    }
    
    /// Get the most significant price levels (by volume)
    pub fn significant_levels(&self, threshold_pct: f64) -> Vec<&PriceLevel> {
        self.price_levels.iter()
            .filter(|l| l.is_significant(threshold_pct))
            .collect()
    }
}

/// Configuration for footprint data pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FootprintConfig {
    /// Price buckets - how to round prices for grouping
    pub price_bucket_mode: PriceBucketMode,
    
    /// Default timeframes to generate footprint data for
    pub default_timeframes: Vec<String>,
    
    /// Value area percentage (default 70%)
    pub value_area_pct: f64,
    
    /// Whether to store raw trades
    pub store_raw_trades: bool,
    
    /// Maximum trades to store per candle
    pub max_trades_per_candle: usize,
    
    /// Whether to auto-calculate metrics on update
    pub auto_calculate_metrics: bool,
}

impl Default for FootprintConfig {
    fn default() -> Self {
        Self {
            price_bucket_mode: PriceBucketMode::Automatic,
            default_timeframes: vec!["1m".to_string(), "5m".to_string(), "15m".to_string()],
            value_area_pct: 0.7,
            store_raw_trades: false,
            max_trades_per_candle: 10000,
            auto_calculate_metrics: true,
        }
    }
}

/// How to bucket prices for the footprint
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PriceBucketMode {
    /// Automatically determine buckets based on price
    Automatic,
    
    /// Use fixed decimal places
    FixedDecimals(usize),
    
    /// Use fixed tick sizes
    FixedTickSize(f64),
}

/// Trade for footprint analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FootprintTrade {
    /// Symbol
    pub symbol: Symbol,
    
    /// Price
    pub price: f64,
    
    /// Size
    pub size: f64,
    
    /// Is this a buy?
    pub is_buy: bool,
    
    /// Timestamp
    pub timestamp: DateTime<Utc>,
}

impl FootprintTrade {
    /// Create a new footprint trade
    pub fn new(symbol: Symbol, price: f64, size: f64, is_buy: bool) -> Self {
        Self {
            symbol,
            price,
            size,
            is_buy,
            timestamp: Utc::now(),
        }
    }
    
    /// Determine which candle this trade belongs to
    pub fn get_candle_timestamp(&self, timeframe: &Timeframe) -> DateTime<Utc> {
        let seconds = timeframe.to_seconds();
        let timestamp_secs = self.timestamp.timestamp();
        
        // Round down to the nearest timeframe boundary
        let candle_timestamp_secs = (timestamp_secs / seconds) * seconds;
        
        DateTime::<Utc>::from_timestamp(candle_timestamp_secs, 0).unwrap_or(self.timestamp)
    }
}

/// Interface for footprint chart data generation
#[async_trait::async_trait]
pub trait FootprintDataPipeline: Send + Sync {
    /// Process a new trade
    async fn process_trade(&self, trade: FootprintTrade) -> FootprintResult<()>;
    
    /// Get footprint data for a specific candle
    async fn get_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        timestamp: DateTime<Utc>,
    ) -> FootprintResult<FootprintChartData>;
    
    /// Get the latest footprint data
    async fn get_latest_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
    ) -> FootprintResult<FootprintChartData>;
    
    /// Get footprint data for a range of candles
    async fn get_footprint_range(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        from_time: DateTime<Utc>,
        to_time: DateTime<Utc>,
    ) -> FootprintResult<Vec<FootprintChartData>>;
    
    /// Generate footprint data from a candle and trades
    async fn generate_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        candle: &Candle,
        trades: &[FootprintTrade],
    ) -> FootprintResult<FootprintChartData>;
    
    /// Clear footprint data for a symbol
    async fn clear_data(&self, symbol: &Symbol) -> FootprintResult<()>;
    
    /// Get config
    fn get_config(&self) -> &FootprintConfig;
    
    /// Update config
    async fn update_config(&self, config: FootprintConfig) -> FootprintResult<()>;
}

/// Implementation of FootprintDataPipeline
pub struct DefaultFootprintPipeline {
    /// Redis client for persistence
    redis: Arc<dyn RedisClient>,
    
    /// Configuration
    config: RwLock<FootprintConfig>,
    
    /// Cache of current footprint data
    footprints: RwLock<HashMap<String, FootprintChartData>>,
    
    /// Cache of trades by candle
    trades_by_candle: RwLock<HashMap<String, Vec<FootprintTrade>>>,
}

impl DefaultFootprintPipeline {
    /// Create a new DefaultFootprintPipeline
    pub fn new(redis: Arc<dyn RedisClient>) -> Self {
        Self {
            redis,
            config: RwLock::new(FootprintConfig::default()),
            footprints: RwLock::new(HashMap::new()),
            trades_by_candle: RwLock::new(HashMap::new()),
        }
    }
    
    /// Create with custom config
    pub fn with_config(redis: Arc<dyn RedisClient>, config: FootprintConfig) -> Self {
        Self {
            redis,
            config: RwLock::new(config),
            footprints: RwLock::new(HashMap::new()),
            trades_by_candle: RwLock::new(HashMap::new()),
        }
    }
    
    /// Key for footprint data
    fn footprint_key(&self, symbol: &Symbol, timeframe: &str, timestamp: i64) -> String {
        format!("micro:footprint:{}:{}:{}", symbol, timeframe, timestamp)
    }
    
    /// Key for trades by candle
    fn trades_key(&self, symbol: &Symbol, timeframe: &str, timestamp: i64) -> String {
        format!("micro:trades:{}:{}:{}", symbol, timeframe, timestamp)
    }
    
    /// Key for latest footprint timestamp
    fn latest_footprint_key(&self, symbol: &Symbol, timeframe: &str) -> String {
        format!("micro:footprint:{}:{}:latest", symbol, timeframe)
    }
    
    /// Get price bucket size for a symbol
    fn get_price_bucket(&self, symbol: &Symbol, price: f64) -> f64 {
        let config = self.config.read().unwrap();
        
        match config.price_bucket_mode {
            PriceBucketMode::Automatic => {
                // Determine automatically based on price level
                if price < 0.1 {
                    0.00001
                } else if price < 1.0 {
                    0.0001
                } else if price < 10.0 {
                    0.001
                } else if price < 100.0 {
                    0.01
                } else if price < 1000.0 {
                    0.1
                } else {
                    1.0
                }
            },
            PriceBucketMode::FixedDecimals(decimals) => {
                let factor = 10f64.powi(decimals as i32);
                1.0 / factor
            },
            PriceBucketMode::FixedTickSize(tick_size) => tick_size,
        }
    }
    
    /// Store footprint data in Redis
    async fn store_footprint(&self, footprint: &FootprintChartData) -> FootprintResult<()> {
        let key = self.footprint_key(
            &footprint.symbol,
            &footprint.timeframe,
            footprint.timestamp.timestamp()
        );
        
        match self.redis.set(&key, footprint, Some(86400 * 30)).await { // 30 days TTL
            Ok(_) => {
                // Update latest timestamp
                let latest_key = self.latest_footprint_key(&footprint.symbol, &footprint.timeframe);
                let _ = self.redis.set(&latest_key, &footprint.timestamp.timestamp(), Some(86400 * 30)).await;
                Ok(())
            },
            Err(e) => Err(FootprintError::Redis(e.to_string())),
        }
    }
    
    /// Store trades in Redis
    async fn store_trades(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        timestamp: DateTime<Utc>,
        trades: &[FootprintTrade],
    ) -> FootprintResult<()> {
        if !self.config.read().unwrap().store_raw_trades {
            return Ok(());
        }
        
        let key = self.trades_key(symbol, timeframe, timestamp.timestamp());
        
        match self.redis.set(&key, trades, Some(86400 * 2)).await { // 2 days TTL for raw trades
            Ok(_) => Ok(()),
            Err(e) => Err(FootprintError::Redis(e.to_string())),
        }
    }
    
    /// Generate a footprint chart from trades
    fn generate_footprint_from_trades(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        candle: &Candle,
        trades: &[FootprintTrade],
    ) -> FootprintChartData {
        let mut footprint = FootprintChartData::new(
            symbol.clone(),
            timeframe.to_string(),
            candle.clone(),
        );
        
        if trades.is_empty() {
            return footprint;
        }
        
        // Group trades by price bucket
        let mut price_levels = HashMap::new();
        
        for trade in trades {
            // Round to appropriate bucket
            let bucket_size = self.get_price_bucket(symbol, trade.price);
            let bucket_price = (trade.price / bucket_size).round() * bucket_size;
            
            // Add to price level
            let level = price_levels.entry(bucket_price)
                .or_insert_with(|| PriceLevel::new(bucket_price));
                
            level.add_volume(trade.size, trade.is_buy);
            
            // Update totals
            if trade.is_buy {
                footprint.total_buy_volume += trade.size;
            } else {
                footprint.total_sell_volume += trade.size;
            }
        }
        
        // Convert hashmap to vec
        footprint.price_levels = price_levels.into_values().collect();
        
        // Calculate metrics
        footprint.calculate_metrics();
        
        footprint
    }
}

#[async_trait::async_trait]
impl FootprintDataPipeline for DefaultFootprintPipeline {
    async fn process_trade(&self, trade: FootprintTrade) -> FootprintResult<()> {
        let config = self.config.read().unwrap();
        
        // Process for each configured timeframe
        for timeframe_str in &config.default_timeframes {
            let timeframe = match timeframe_str.as_str() {
                "1m" => Timeframe::Minute1,
                "5m" => Timeframe::Minute5,
                "15m" => Timeframe::Minute15,
                "30m" => Timeframe::Minute30,
                "1h" => Timeframe::Hour1,
                "4h" => Timeframe::Hour4,
                "1d" => Timeframe::Day1,
                _ => continue, // Skip unknown timeframes
            };
            
            // Determine which candle this trade belongs to
            let candle_timestamp = trade.get_candle_timestamp(&timeframe);
            
            // Add to in-memory cache
            let key = format!(
                "{}:{}:{}",
                trade.symbol,
                timeframe_str,
                candle_timestamp.timestamp()
            );
            
            {
                let mut trades_by_candle = self.trades_by_candle.write().unwrap();
                let trades = trades_by_candle.entry(key.clone()).or_insert_with(Vec::new);
                
                // Add trade
                trades.push(trade.clone());
                
                // Trim if exceeded limit
                if trades.len() > config.max_trades_per_candle {
                    trades.remove(0);
                }
            }
            
            // If auto-calculate is enabled, update footprint now
            if config.auto_calculate_metrics {
                // For a real implementation, we'd need the candle data
                // Here we'll use a placeholder candle
                let placeholder_candle = Candle::new(
                    candle_timestamp,
                    trade.price.into(),
                    trade.price.into(),
                    trade.price.into(),
                    trade.price.into(),
                    trade.size.into(),
                );
                
                // Get trades for this candle
                let trades = {
                    let trades_by_candle = self.trades_by_candle.read().unwrap();
                    trades_by_candle.get(&key).cloned().unwrap_or_default()
                };
                
                // Generate footprint
                let footprint = self.generate_footprint_from_trades(
                    &trade.symbol,
                    timeframe_str,
                    &placeholder_candle,
                    &trades
                );
                
                // Store in cache
                {
                    let mut footprints = self.footprints.write().unwrap();
                    footprints.insert(key, footprint.clone());
                }
                
                // Store in Redis
                let _ = self.store_footprint(&footprint).await;
            }
        }
        
        Ok(())
    }
    
    async fn get_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        timestamp: DateTime<Utc>,
    ) -> FootprintResult<FootprintChartData> {
        // Check in-memory cache first
        let key = format!(
            "{}:{}:{}",
            symbol,
            timeframe,
            timestamp.timestamp()
        );
        
        {
            let footprints = self.footprints.read().unwrap();
            if let Some(footprint) = footprints.get(&key) {
                return Ok(footprint.clone());
            }
        }
        
        // Try to get from Redis
        let redis_key = self.footprint_key(symbol, timeframe, timestamp.timestamp());
        
        match self.redis.get::<FootprintChartData>(&redis_key).await {
            Ok(Some(footprint)) => {
                // Update cache
                let mut footprints = self.footprints.write().unwrap();
                footprints.insert(key, footprint.clone());
                Ok(footprint)
            },
            Ok(None) => {
                // If not found, check if we have trades but no footprint
                let trades_key = self.trades_key(symbol, timeframe, timestamp.timestamp());
                
                match self.redis.get::<Vec<FootprintTrade>>(&trades_key).await {
                    Ok(Some(trades)) if !trades.is_empty() => {
                        // Create a placeholder candle
                        let avg_price = trades.iter().map(|t| t.price).sum::<f64>() / trades.len() as f64;
                        let total_volume = trades.iter().map(|t| t.size).sum::<f64>();
                        
                        let placeholder_candle = Candle::new(
                            timestamp,
                            avg_price.into(),
                            avg_price.into(),
                            avg_price.into(),
                            avg_price.into(),
                            total_volume.into(),
                        );
                        
                        // Generate footprint
                        let footprint = self.generate_footprint_from_trades(
                            symbol,
                            timeframe,
                            &placeholder_candle,
                            &trades
                        );
                        
                        // Store in cache
                        let mut footprints = self.footprints.write().unwrap();
                        footprints.insert(key, footprint.clone());
                        
                        // Store in Redis
                        let _ = self.store_footprint(&footprint).await;
                        
                        Ok(footprint)
                    },
                    _ => Err(FootprintError::SymbolNotFound(format!(
                        "No footprint data for {}:{} at {}",
                        symbol,
                        timeframe,
                        timestamp
                    ))),
                }
            },
            Err(e) => Err(FootprintError::Redis(e.to_string())),
        }
    }
    
    async fn get_latest_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
    ) -> FootprintResult<FootprintChartData> {
        // Get the latest timestamp
        let latest_key = self.latest_footprint_key(symbol, timeframe);
        
        match self.redis.get::<i64>(&latest_key).await {
            Ok(Some(timestamp)) => {
                let datetime = DateTime::<Utc>::from_timestamp(timestamp, 0)
                    .ok_or_else(|| FootprintError::InvalidData("Invalid timestamp".to_string()))?;
                    
                self.get_footprint(symbol, timeframe, datetime).await
            },
            Ok(None) => Err(FootprintError::SymbolNotFound(format!(
                "No footprint data for {}:{}",
                symbol,
                timeframe
            ))),
            Err(e) => Err(FootprintError::Redis(e.to_string())),
        }
    }
    
    async fn get_footprint_range(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        from_time: DateTime<Utc>,
        to_time: DateTime<Utc>,
    ) -> FootprintResult<Vec<FootprintChartData>> {
        // This would ideally use Redis SCAN to find all keys in the range
        // For simplicity, we'll estimate the candles in the range
        
        let timeframe_obj = match timeframe {
            "1m" => Timeframe::Minute1,
            "5m" => Timeframe::Minute5,
            "15m" => Timeframe::Minute15,
            "30m" => Timeframe::Minute30,
            "1h" => Timeframe::Hour1,
            "4h" => Timeframe::Hour4,
            "1d" => Timeframe::Day1,
            _ => return Err(FootprintError::InvalidData(format!("Invalid timeframe: {}", timeframe))),
        };
        
        let timeframe_seconds = timeframe_obj.to_seconds();
        let from_secs = from_time.timestamp();
        let to_secs = to_time.timestamp();
        
        // Align to timeframe boundaries
        let from_aligned = (from_secs / timeframe_seconds) * timeframe_seconds;
        let to_aligned = (to_secs / timeframe_seconds) * timeframe_seconds;
        
        // Generate timestamps in the range
        let mut timestamps = Vec::new();
        let mut current = from_aligned;
        
        while current <= to_aligned {
            timestamps.push(current);
            current += timeframe_seconds;
        }
        
        // Fetch each footprint
        let mut result = Vec::new();
        
        for ts in timestamps {
            let datetime = DateTime::<Utc>::from_timestamp(ts, 0)
                .ok_or_else(|| FootprintError::InvalidData("Invalid timestamp".to_string()))?;
            
            match self.get_footprint(symbol, timeframe, datetime).await {
                Ok(footprint) => result.push(footprint),
                Err(FootprintError::SymbolNotFound(_)) => {
                    // Skip missing footprints
                    continue;
                },
                Err(e) => return Err(e),
            }
        }
        
        Ok(result)
    }
    
    async fn generate_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        candle: &Candle,
        trades: &[FootprintTrade],
    ) -> FootprintResult<FootprintChartData> {
        // Generate footprint
        let footprint = self.generate_footprint_from_trades(
            symbol,
            timeframe,
            candle,
            trades
        );
        
        // Store in cache
        let key = format!(
            "{}:{}:{}",
            symbol,
            timeframe,
            candle.timestamp.timestamp()
        );
        
        {
            let mut footprints = self.footprints.write().unwrap();
            footprints.insert(key, footprint.clone());
        }
        
        // Store in Redis
        let _ = self.store_footprint(&footprint).await;
        
        // Store trades if configured
        if self.config.read().unwrap().store_raw_trades {
            let _ = self.store_trades(
                symbol,
                timeframe,
                candle.timestamp,
                trades
            ).await;
        }
        
        Ok(footprint)
    }
    
    async fn clear_data(&self, symbol: &Symbol) -> FootprintResult<()> {
        // Clear in-memory caches
        {
            let mut footprints = self.footprints.write().unwrap();
            footprints.retain(|k, _| !k.starts_with(&format!("{}:", symbol)));
            
            let mut trades_by_candle = self.trades_by_candle.write().unwrap();
            trades_by_candle.retain(|k, _| !k.starts_with(&format!("{}:", symbol)));
        }
        
        // Clearing Redis would require scanning for all related keys
        // which is beyond the scope of this example
        
        Ok(())
    }
    
    fn get_config(&self) -> &RwLock<FootprintConfig> {
        &self.config
    }
    
    async fn update_config(&self, config: FootprintConfig) -> FootprintResult<()> {
        let mut cfg = self.config.write().unwrap();
        *cfg = config;
        Ok(())
    }
}

/// Create a default footprint data pipeline
pub fn create_footprint_pipeline(redis: Arc<dyn RedisClient>) -> Arc<dyn FootprintDataPipeline> {
    Arc::new(DefaultFootprintPipeline::new(redis))
}

/// Create a footprint data pipeline with custom configuration
pub fn create_footprint_pipeline_with_config(
    redis: Arc<dyn RedisClient>,
    config: FootprintConfig,
) -> Arc<dyn FootprintDataPipeline> {
    Arc::new(DefaultFootprintPipeline::with_config(redis, config))
}

/// Mock implementation for testing
pub struct MockFootprintPipeline {
    footprints: RwLock<HashMap<String, FootprintChartData>>,
    trades: RwLock<HashMap<String, Vec<FootprintTrade>>>,
    config: FootprintConfig,
}

impl MockFootprintPipeline {
    /// Create a new mock pipeline
    pub fn new() -> Self {
        Self {
            footprints: RwLock::new(HashMap::new()),
            trades: RwLock::new(HashMap::new()),
            config: FootprintConfig::default(),
        }
    }
    
    /// Set a mock footprint
    pub fn set_footprint(
        &self,
        symbol: Symbol,
        timeframe: &str,
        timestamp: DateTime<Utc>,
        footprint: FootprintChartData,
    ) {
        let key = format!("{}:{}:{}", symbol, timeframe, timestamp.timestamp());
        let mut footprints = self.footprints.write().unwrap();
        footprints.insert(key, footprint);
    }
    
    /// Set mock trades
    pub fn set_trades(
        &self,
        symbol: Symbol,
        timeframe: &str,
        timestamp: DateTime<Utc>,
        trades: Vec<FootprintTrade>,
    ) {
        let key = format!("{}:{}:{}", symbol, timeframe, timestamp.timestamp());
        let mut all_trades = self.trades.write().unwrap();
        all_trades.insert(key, trades);
    }
    
    /// Generate a key for a candle
    fn candle_key(&self, symbol: &Symbol, timeframe: &str, timestamp: DateTime<Utc>) -> String {
        format!("{}:{}:{}", symbol, timeframe, timestamp.timestamp())
    }
}

#[async_trait::async_trait]
impl FootprintDataPipeline for MockFootprintPipeline {
    async fn process_trade(&self, trade: FootprintTrade) -> FootprintResult<()> {
        // Just add to the trades collection
        for timeframe in &self.config.default_timeframes {
            let tf = match timeframe.as_str() {
                "1m" => Timeframe::Minute1,
                "5m" => Timeframe::Minute5,
                "15m" => Timeframe::Minute15,
                "30m" => Timeframe::Minute30,
                "1h" => Timeframe::Hour1,
                "4h" => Timeframe::Hour4,
                "1d" => Timeframe::Day1,
                _ => continue,
            };
            
            let candle_time = trade.get_candle_timestamp(&tf);
            let key = self.candle_key(&trade.symbol, timeframe, candle_time);
            
            let mut trades = self.trades.write().unwrap();
            let candle_trades = trades.entry(key).or_insert_with(Vec::new);
            candle_trades.push(trade.clone());
        }
        
        Ok(())
    }
    
    async fn get_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        timestamp: DateTime<Utc>,
    ) -> FootprintResult<FootprintChartData> {
        let key = self.candle_key(symbol, timeframe, timestamp);
        
        let footprints = self.footprints.read().unwrap();
        if let Some(footprint) = footprints.get(&key) {
            return Ok(footprint.clone());
        }
        
        // If no footprint but we have trades, create one
        let trades = self.trades.read().unwrap();
        if let Some(trades_list) = trades.get(&key) {
            if !trades_list.is_empty() {
                // Simple mock footprint
                let mock_candle = Candle::new(
                    timestamp,
                    Decimal::from(0),
                    Decimal::from(0),
                    Decimal::from(0),
                    Decimal::from(0),
                    Decimal::from(0),
                );
                
                let mut footprint = FootprintChartData::new(
                    symbol.clone(),
                    timeframe.to_string(),
                    mock_candle,
                );
                
                footprint.total_buy_volume = trades_list.iter()
                    .filter(|t| t.is_buy)
                    .map(|t| t.size)
                    .sum();
                    
                footprint.total_sell_volume = trades_list.iter()
                    .filter(|t| !t.is_buy)
                    .map(|t| t.size)
                    .sum();
                
                return Ok(footprint);
            }
        }
        
        Err(FootprintError::SymbolNotFound(format!(
            "No footprint data for {}:{} at {}",
            symbol,
            timeframe,
            timestamp
        )))
    }
    
    async fn get_latest_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
    ) -> FootprintResult<FootprintChartData> {
        let footprints = self.footprints.read().unwrap();
        
        // Find the latest timestamp for this symbol/timeframe
        let mut latest_ts = 0;
        let mut latest_fp = None;
        
        for (key, fp) in footprints.iter() {
            if key.starts_with(&format!("{}:{}", symbol, timeframe)) {
                let parts: Vec<&str> = key.split(':').collect();
                if parts.len() >= 3 {
                    if let Ok(ts) = parts[2].parse::<i64>() {
                        if ts > latest_ts {
                            latest_ts = ts;
                            latest_fp = Some(fp);
                        }
                    }
                }
            }
        }
        
        if let Some(fp) = latest_fp {
            Ok(fp.clone())
        } else {
            Err(FootprintError::SymbolNotFound(format!(
                "No footprint data for {}:{}",
                symbol,
                timeframe
            )))
        }
    }
    
    async fn get_footprint_range(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        from_time: DateTime<Utc>,
        to_time: DateTime<Utc>,
    ) -> FootprintResult<Vec<FootprintChartData>> {
        let footprints = self.footprints.read().unwrap();
        let mut result = Vec::new();
        
        // Filter footprints in the range
        for (key, fp) in footprints.iter() {
            if key.starts_with(&format!("{}:{}", symbol, timeframe)) {
                if fp.timestamp >= from_time && fp.timestamp <= to_time {
                    result.push(fp.clone());
                }
            }
        }
        
        // Sort by timestamp
        result.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        
        Ok(result)
    }
    
    async fn generate_footprint(
        &self,
        symbol: &Symbol,
        timeframe: &str,
        candle: &Candle,
        trades: &[FootprintTrade],
    ) -> FootprintResult<FootprintChartData> {
        // Simple mock implementation
        let mut footprint = FootprintChartData::new(
            symbol.clone(),
            timeframe.to_string(),
            candle.clone(),
        );
        
        // Aggregate by price levels
        let mut price_levels = HashMap::new();
        
        for trade in trades {
            let price = (trade.price * 100.0).round() / 100.0; // Round to 2 decimals
            let level = price_levels.entry(price)
                .or_insert_with(|| PriceLevel::new(price));
                
            level.add_volume(trade.size, trade.is_buy);
            
            if trade.is_buy {
                footprint.total_buy_volume += trade.size;
            } else {
                footprint.total_sell_volume += trade.size;
            }
        }
        
        footprint.price_levels = price_levels.into_values().collect();
        footprint.delta = footprint.total_buy_volume - footprint.total_sell_volume;
        
        let total = footprint.total_buy_volume + footprint.total_sell_volume;
        if total > 0.0 {
            footprint.delta_pct = footprint.delta / total;
        }
        
        // Store in our mock storage
        let key = self.candle_key(symbol, timeframe, candle.timestamp);
        let mut footprints = self.footprints.write().unwrap();
        footprints.insert(key, footprint.clone());
        
        Ok(footprint)
    }
    
    async fn clear_data(&self, symbol: &Symbol) -> FootprintResult<()> {
        // Clear footprints
        {
            let mut footprints = self.footprints.write().unwrap();
            footprints.retain(|k, _| !k.starts_with(&format!("{}:", symbol)));
        }
        
        // Clear trades
        {
            let mut trades = self.trades.write().unwrap();
            trades.retain(|k, _| !k.starts_with(&format!("{}:", symbol)));
        }
        
        Ok(())
    }
    
    fn get_config(&self) -> &FootprintConfig {
        &self.config
    }
    
    async fn update_config(&self, _config: FootprintConfig) -> FootprintResult<()> {
        Ok(())
    }
}

/// Create a mock footprint pipeline for testing
pub fn create_mock_footprint_pipeline() -> Arc<dyn FootprintDataPipeline> {
    Arc::new(MockFootprintPipeline::new())
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
    
    fn create_test_trade(symbol: &str, price: f64, size: f64, is_buy: bool) -> FootprintTrade {
        FootprintTrade {
            symbol: symbol.to_string(),
            price,
            size,
            is_buy,
            timestamp: Utc::now(),
        }
    }
    
    fn create_test_candle() -> Candle {
        use rust_decimal_macros::dec;
        
        Candle::new(
            Utc::now(),
            dec!(100.0),
            dec!(105.0),
            dec!(99.0),
            dec!(103.0),
            dec!(1000.0),
        )
    }
    
    #[tokio::test]
    async fn test_process_trade() {
        let redis = Arc::new(MockRedisClient);
        let pipeline = DefaultFootprintPipeline::new(redis);
        
        let trade = create_test_trade("BTC/USDT", 50000.0, 1.0, true);
        let result = pipeline.process_trade(trade).await;
        
        assert!(result.is_ok());
    }
    
    #[tokio::test]
    async fn test_generate_footprint() {
        let redis = Arc::new(MockRedisClient);
        let pipeline = DefaultFootprintPipeline::new(redis);
        
        let symbol = "BTC/USDT".to_string();
        let candle = create_test_candle();
        
        let trades = vec![
            create_test_trade("BTC/USDT", 100.0, 1.0, true),
            create_test_trade("BTC/USDT", 101.0, 2.0, false),
            create_test_trade("BTC/USDT", 102.0, 0.5, true),
            create_test_trade("BTC/USDT", 100.0, 1.5, false),
        ];
        
        let result = pipeline.generate_footprint(&symbol, "1m", &candle, &trades).await;
        
        assert!(result.is_ok());
        let footprint = result.unwrap();
        
        assert_eq!(footprint.symbol, symbol);
        assert_eq!(footprint.total_buy_volume, 1.5);
        assert_eq!(footprint.total_sell_volume, 3.5);
        assert_eq!(footprint.delta, -2.0);
        assert!(!footprint.price_levels.is_empty());
    }
    
    #[tokio::test]
    async fn test_mock_pipeline() {
        let pipeline = MockFootprintPipeline::new();
        let symbol = "BTC/USDT".to_string();
        let timestamp = Utc::now();
        
        // Test with no data
        let result = pipeline.get_footprint(&symbol, "1m", timestamp).await;
        assert!(result.is_err());
        
        // Set mock data
        let candle = create_test_candle();
        let footprint = FootprintChartData::new(symbol.clone(), "1m".to_string(), candle);
        pipeline.set_footprint(symbol.clone(), "1m", timestamp, footprint);
        
        // Test retrieval
        let result = pipeline.get_footprint(&symbol, "1m", timestamp).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().symbol, symbol);
    }
} 