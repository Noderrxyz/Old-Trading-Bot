use std::sync::RwLock;
use serde::{Serialize, Deserialize};

/// Cache line size for alignment (64 bytes on most x86_64 systems)
const CACHE_LINE_SIZE: usize = 64;

/// Aligned array wrapper for cache-line alignment
#[repr(C, align(64))]
struct AlignedVec<T> {
    data: Vec<T>,
}

impl<T> AlignedVec<T> {
    fn new() -> Self {
        Self { data: Vec::new() }
    }
    
    fn with_capacity(capacity: usize) -> Self {
        Self { data: Vec::with_capacity(capacity) }
    }
}

/// Structure-of-Arrays market data for optimal cache performance
#[derive(Debug)]
pub struct MarketDataSoA {
    /// Timestamps in microseconds (aligned)
    timestamps: RwLock<AlignedVec<u64>>,
    /// Bid prices (aligned)
    bid_prices: RwLock<AlignedVec<f64>>,
    /// Ask prices (aligned)
    ask_prices: RwLock<AlignedVec<f64>>,
    /// Bid volumes (aligned)
    bid_volumes: RwLock<AlignedVec<f64>>,
    /// Ask volumes (aligned)
    ask_volumes: RwLock<AlignedVec<f64>>,
    /// Trade prices (aligned)
    trade_prices: RwLock<AlignedVec<f64>>,
    /// Trade volumes (aligned)
    trade_volumes: RwLock<AlignedVec<f64>>,
    /// Current size
    size: RwLock<usize>,
    /// Maximum capacity
    capacity: usize,
}

impl MarketDataSoA {
    /// Create a new SoA market data container
    pub fn new(capacity: usize) -> Self {
        Self {
            timestamps: RwLock::new(AlignedVec::with_capacity(capacity)),
            bid_prices: RwLock::new(AlignedVec::with_capacity(capacity)),
            ask_prices: RwLock::new(AlignedVec::with_capacity(capacity)),
            bid_volumes: RwLock::new(AlignedVec::with_capacity(capacity)),
            ask_volumes: RwLock::new(AlignedVec::with_capacity(capacity)),
            trade_prices: RwLock::new(AlignedVec::with_capacity(capacity)),
            trade_volumes: RwLock::new(AlignedVec::with_capacity(capacity)),
            size: RwLock::new(0),
            capacity,
        }
    }
    
    /// Add a market tick (optimized for sequential access)
    pub fn add_tick(
        &self,
        timestamp: u64,
        bid_price: f64,
        ask_price: f64,
        bid_volume: f64,
        ask_volume: f64,
        trade_price: Option<f64>,
        trade_volume: Option<f64>,
    ) {
        let mut timestamps = self.timestamps.write().unwrap();
        let mut bid_prices = self.bid_prices.write().unwrap();
        let mut ask_prices = self.ask_prices.write().unwrap();
        let mut bid_volumes = self.bid_volumes.write().unwrap();
        let mut ask_volumes = self.ask_volumes.write().unwrap();
        let mut trade_prices = self.trade_prices.write().unwrap();
        let mut trade_volumes = self.trade_volumes.write().unwrap();
        let mut size = self.size.write().unwrap();
        
        // Ring buffer behavior - overwrite oldest if at capacity
        let index = *size % self.capacity;
        
        if index < timestamps.data.len() {
            // Update existing slot
            timestamps.data[index] = timestamp;
            bid_prices.data[index] = bid_price;
            ask_prices.data[index] = ask_price;
            bid_volumes.data[index] = bid_volume;
            ask_volumes.data[index] = ask_volume;
            trade_prices.data[index] = trade_price.unwrap_or(0.0);
            trade_volumes.data[index] = trade_volume.unwrap_or(0.0);
        } else {
            // Add new slot
            timestamps.data.push(timestamp);
            bid_prices.data.push(bid_price);
            ask_prices.data.push(ask_price);
            bid_volumes.data.push(bid_volume);
            ask_volumes.data.push(ask_volume);
            trade_prices.data.push(trade_price.unwrap_or(0.0));
            trade_volumes.data.push(trade_volume.unwrap_or(0.0));
        }
        
        *size += 1;
    }
    
    /// Calculate VWAP efficiently using SoA layout
    pub fn calculate_vwap(&self, window_size: usize) -> Option<f64> {
        let trade_prices = self.trade_prices.read().unwrap();
        let trade_volumes = self.trade_volumes.read().unwrap();
        let size = *self.size.read().unwrap();
        
        if size == 0 || window_size == 0 {
            return None;
        }
        
        let start_idx = size.saturating_sub(window_size);
        let end_idx = size.min(trade_prices.data.len());
        
        let mut total_value = 0.0;
        let mut total_volume = 0.0;
        
        // Vectorizable loop - compiler can optimize this
        for i in start_idx..end_idx {
            let volume = trade_volumes.data[i];
            if volume > 0.0 {
                total_value += trade_prices.data[i] * volume;
                total_volume += volume;
            }
        }
        
        if total_volume > 0.0 {
            Some(total_value / total_volume)
        } else {
            None
        }
    }
    
    /// Calculate spread statistics efficiently
    pub fn calculate_spread_stats(&self, window_size: usize) -> SpreadStats {
        let bid_prices = self.bid_prices.read().unwrap();
        let ask_prices = self.ask_prices.read().unwrap();
        let size = *self.size.read().unwrap();
        
        let start_idx = size.saturating_sub(window_size);
        let end_idx = size.min(bid_prices.data.len());
        
        let mut sum_spread = 0.0;
        let mut sum_spread_sq = 0.0;
        let mut min_spread = f64::MAX;
        let mut max_spread = 0.0;
        let count = (end_idx - start_idx) as f64;
        
        // Vectorizable loop
        for i in start_idx..end_idx {
            let spread = ask_prices.data[i] - bid_prices.data[i];
            sum_spread += spread;
            sum_spread_sq += spread * spread;
            min_spread = min_spread.min(spread);
            max_spread = max_spread.max(spread);
        }
        
        let mean = sum_spread / count;
        let variance = (sum_spread_sq / count) - (mean * mean);
        let std_dev = variance.sqrt();
        
        SpreadStats {
            mean,
            std_dev,
            min: min_spread,
            max: max_spread,
        }
    }
    
    /// Get recent data slice (zero-copy where possible)
    pub fn get_recent_slice(&self, count: usize) -> MarketDataSlice {
        let size = *self.size.read().unwrap();
        let start_idx = size.saturating_sub(count);
        let end_idx = size;
        
        MarketDataSlice {
            timestamps: self.timestamps.read().unwrap(),
            bid_prices: self.bid_prices.read().unwrap(),
            ask_prices: self.ask_prices.read().unwrap(),
            bid_volumes: self.bid_volumes.read().unwrap(),
            ask_volumes: self.ask_volumes.read().unwrap(),
            trade_prices: self.trade_prices.read().unwrap(),
            trade_volumes: self.trade_volumes.read().unwrap(),
            start_idx,
            end_idx,
        }
    }
}

/// Statistics for spread analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpreadStats {
    pub mean: f64,
    pub std_dev: f64,
    pub min: f64,
    pub max: f64,
}

/// Zero-copy slice view of market data
pub struct MarketDataSlice<'a> {
    timestamps: std::sync::RwLockReadGuard<'a, AlignedVec<u64>>,
    bid_prices: std::sync::RwLockReadGuard<'a, AlignedVec<f64>>,
    ask_prices: std::sync::RwLockReadGuard<'a, AlignedVec<f64>>,
    bid_volumes: std::sync::RwLockReadGuard<'a, AlignedVec<f64>>,
    ask_volumes: std::sync::RwLockReadGuard<'a, AlignedVec<f64>>,
    trade_prices: std::sync::RwLockReadGuard<'a, AlignedVec<f64>>,
    trade_volumes: std::sync::RwLockReadGuard<'a, AlignedVec<f64>>,
    start_idx: usize,
    end_idx: usize,
}

impl<'a> MarketDataSlice<'a> {
    /// Iterate over the slice
    pub fn iter(&self) -> impl Iterator<Item = MarketTick> + '_ {
        (self.start_idx..self.end_idx).map(move |i| MarketTick {
            timestamp: self.timestamps.data[i],
            bid_price: self.bid_prices.data[i],
            ask_price: self.ask_prices.data[i],
            bid_volume: self.bid_volumes.data[i],
            ask_volume: self.ask_volumes.data[i],
            trade_price: if self.trade_prices.data[i] > 0.0 {
                Some(self.trade_prices.data[i])
            } else {
                None
            },
            trade_volume: if self.trade_volumes.data[i] > 0.0 {
                Some(self.trade_volumes.data[i])
            } else {
                None
            },
        })
    }
}

/// Individual market tick for iteration
#[derive(Debug, Clone)]
pub struct MarketTick {
    pub timestamp: u64,
    pub bid_price: f64,
    pub ask_price: f64,
    pub bid_volume: f64,
    pub ask_volume: f64,
    pub trade_price: Option<f64>,
    pub trade_volume: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_soa_market_data() {
        let market_data = MarketDataSoA::new(1000);
        
        // Add some ticks
        for i in 0..100 {
            market_data.add_tick(
                i as u64 * 1000,
                100.0 + (i as f64 * 0.1),
                100.1 + (i as f64 * 0.1),
                1000.0,
                1000.0,
                Some(100.05 + (i as f64 * 0.1)),
                Some(500.0),
            );
        }
        
        // Test VWAP calculation
        let vwap = market_data.calculate_vwap(10);
        assert!(vwap.is_some());
        
        // Test spread stats
        let stats = market_data.calculate_spread_stats(10);
        assert!((stats.mean - 0.1).abs() < 0.001);
    }
} 