use std::collections::HashMap;
use std::sync::{Arc, RwLock, Mutex};
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};
use thiserror::Error;

use crate::shared_memory::{SharedMemoryManager, SharedRingBuffer};
use crate::market::MarketData;

/// Market tick data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketTick {
    /// Symbol
    pub symbol: String,
    
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Last price
    pub price: f64,
    
    /// Trading volume
    pub volume: f64,
    
    /// Bid price
    pub bid: Option<f64>,
    
    /// Ask price
    pub ask: Option<f64>,
    
    /// Additional custom fields
    pub fields: HashMap<String, f64>,
}

/// Market anomaly type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AnomalyType {
    /// Price spike
    PriceSpike,
    
    /// Volume spike
    VolumeSpike,
    
    /// Spread widening
    SpreadWidening,
    
    /// Liquidity drop
    LiquidityDrop,
    
    /// Correlation break
    CorrelationBreak,
    
    /// Volatility explosion
    VolatilityExplosion,
}

/// Market anomaly detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketAnomaly {
    /// Symbol where anomaly was detected
    pub symbol: String,
    
    /// Timestamp when anomaly was detected
    pub timestamp: DateTime<Utc>,
    
    /// Type of anomaly
    pub anomaly_type: AnomalyType,
    
    /// Severity score (0.0-1.0)
    pub severity: f64,
    
    /// Description
    pub description: String,
    
    /// Related metrics
    pub metrics: HashMap<String, f64>,
}

/// Market features calculated from tick data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketFeatures {
    /// Symbol
    pub symbol: String,
    
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Last price
    pub price: f64,
    
    /// 1-minute return
    pub returns_1m: f64,
    
    /// 5-minute return
    pub returns_5m: f64,
    
    /// 15-minute return
    pub returns_15m: f64,
    
    /// 1-hour return
    pub returns_1h: f64,
    
    /// 4-hour return
    pub returns_4h: f64,
    
    /// 1-day return
    pub returns_1d: f64,
    
    /// Relative strength index (14-period)
    pub rsi_14: f64,
    
    /// Bollinger bandwidth
    pub bb_width: f64,
    
    /// Moving average convergence divergence
    pub macd: f64,
    
    /// MACD signal line
    pub macd_signal: f64,
    
    /// MACD histogram
    pub macd_hist: f64,
    
    /// Average true range
    pub atr: f64,
    
    /// Volume ratio to 20-period average
    pub volume_ratio: f64,
    
    /// On-balance volume
    pub obv: f64,
    
    /// Bid-ask spread
    pub spread: Option<f64>,
    
    /// Additional custom metrics
    pub additional_metrics: HashMap<String, f64>,
}

/// Market data processor errors
#[derive(Debug, Error)]
pub enum MarketDataError {
    #[error("Invalid tick data: {0}")]
    InvalidTickData(String),
    
    #[error("Insufficient history for feature calculation: {0}")]
    InsufficientHistory(String),
    
    #[error("Feature calculation error: {0}")]
    CalculationError(String),
    
    #[error("Symbol not found: {0}")]
    SymbolNotFound(String),
}

/// Type alias for result with MarketDataError
pub type MarketDataResult<T> = Result<T, MarketDataError>;

/// Market data processor configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDataProcessorConfig {
    /// Maximum history size per symbol
    pub max_history_size: usize,
    
    /// Feature calculation interval in milliseconds
    pub feature_calculation_interval_ms: u64,
    
    /// Anomaly detection interval in milliseconds
    pub anomaly_detection_interval_ms: u64,
    
    /// RSI period
    pub rsi_period: usize,
    
    /// Bollinger bands period
    pub bb_period: usize,
    
    /// Bollinger bands standard deviation multiplier
    pub bb_std_dev: f64,
    
    /// MACD fast period
    pub macd_fast_period: usize,
    
    /// MACD slow period
    pub macd_slow_period: usize,
    
    /// MACD signal period
    pub macd_signal_period: usize,
    
    /// ATR period
    pub atr_period: usize,
    
    /// Volume ratio period
    pub volume_ratio_period: usize,
    
    /// Price spike detection threshold
    pub price_spike_threshold: f64,
    
    /// Volume spike detection threshold
    pub volume_spike_threshold: f64,
    
    /// Spread widening threshold
    pub spread_widening_threshold: f64,
}

impl Default for MarketDataProcessorConfig {
    fn default() -> Self {
        Self {
            max_history_size: 10000,
            feature_calculation_interval_ms: 1000,
            anomaly_detection_interval_ms: 5000,
            rsi_period: 14,
            bb_period: 20,
            bb_std_dev: 2.0,
            macd_fast_period: 12,
            macd_slow_period: 26,
            macd_signal_period: 9,
            atr_period: 14,
            volume_ratio_period: 20,
            price_spike_threshold: 3.0,
            volume_spike_threshold: 5.0,
            spread_widening_threshold: 3.0,
        }
    }
}

/// Market data processor
pub struct MarketDataProcessor {
    /// Configuration
    config: RwLock<MarketDataProcessorConfig>,
    
    /// Tick history by symbol
    tick_history: RwLock<HashMap<String, Vec<MarketTick>>>,
    
    /// Cached features by symbol
    cached_features: RwLock<HashMap<String, MarketFeatures>>,
    
    /// Detected anomalies
    anomalies: RwLock<Vec<MarketAnomaly>>,
    
    /// Shared memory manager for data access
    shared_memory: Option<Arc<SharedMemoryManager>>,
}

impl MarketDataProcessor {
    /// Create a new market data processor
    pub fn new(config: MarketDataProcessorConfig) -> Self {
        Self {
            config: RwLock::new(config),
            tick_history: RwLock::new(HashMap::new()),
            cached_features: RwLock::new(HashMap::new()),
            anomalies: RwLock::new(Vec::new()),
            shared_memory: None,
        }
    }
    
    /// Create a new market data processor with shared memory
    pub fn with_shared_memory(
        config: MarketDataProcessorConfig,
        shared_memory: Arc<SharedMemoryManager>,
    ) -> Self {
        Self {
            config: RwLock::new(config),
            tick_history: RwLock::new(HashMap::new()),
            cached_features: RwLock::new(HashMap::new()),
            anomalies: RwLock::new(Vec::new()),
            shared_memory: Some(shared_memory),
        }
    }
    
    /// Process a market tick
    pub fn process_tick(&self, tick: MarketTick) -> MarketDataResult<()> {
        // Validate tick data
        if tick.price <= 0.0 {
            return Err(MarketDataError::InvalidTickData(
                format!("Invalid price: {}", tick.price)
            ));
        }
        
        // Add tick to history
        let mut history = self.tick_history.write().unwrap();
        
        // Get or create history for symbol
        let ticks = history.entry(tick.symbol.clone()).or_insert_with(Vec::new);
        
        // Add tick to history
        ticks.push(tick.clone());
        
        // Trim history if needed
        let config = self.config.read().unwrap();
        if ticks.len() > config.max_history_size {
            let to_remove = ticks.len() - config.max_history_size;
            ticks.drain(0..to_remove);
        }
        
        Ok(())
    }
    
    /// Calculate features for a symbol
    pub fn calculate_features(&self, symbol: &str) -> MarketDataResult<MarketFeatures> {
        // Get tick history for symbol
        let history = self.tick_history.read().unwrap();
        
        let ticks = match history.get(symbol) {
            Some(ticks) => ticks,
            None => return Err(MarketDataError::SymbolNotFound(symbol.to_string())),
        };
        
        // Check if we have enough history
        if ticks.len() < 100 {
            return Err(MarketDataError::InsufficientHistory(
                format!("Need at least 100 ticks, got {}", ticks.len())
            ));
        }
        
        // Get configuration
        let config = self.config.read().unwrap();
        
        // Get the latest tick
        let latest = ticks.last().unwrap();
        
        // Calculate returns
        let returns_1m = self.calculate_return(ticks, 60);
        let returns_5m = self.calculate_return(ticks, 300);
        let returns_15m = self.calculate_return(ticks, 900);
        let returns_1h = self.calculate_return(ticks, 3600);
        let returns_4h = self.calculate_return(ticks, 14400);
        let returns_1d = self.calculate_return(ticks, 86400);
        
        // Calculate RSI
        let rsi = self.calculate_rsi(ticks, config.rsi_period);
        
        // Calculate Bollinger Bands
        let (_, bb_width) = self.calculate_bollinger_bands(
            ticks, config.bb_period, config.bb_std_dev
        );
        
        // Calculate MACD
        let (macd, macd_signal, macd_hist) = self.calculate_macd(
            ticks, config.macd_fast_period, config.macd_slow_period, config.macd_signal_period
        );
        
        // Calculate ATR
        let atr = self.calculate_atr(ticks, config.atr_period);
        
        // Calculate volume ratio
        let volume_ratio = self.calculate_volume_ratio(ticks, config.volume_ratio_period);
        
        // Calculate OBV
        let obv = self.calculate_obv(ticks);
        
        // Calculate spread if bid/ask available
        let spread = if let (Some(bid), Some(ask)) = (latest.bid, latest.ask) {
            Some((ask - bid) / bid * 100.0)
        } else {
            None
        };
        
        // Create features object
        let features = MarketFeatures {
            symbol: symbol.to_string(),
            timestamp: latest.timestamp,
            price: latest.price,
            returns_1m,
            returns_5m,
            returns_15m,
            returns_1h,
            returns_4h,
            returns_1d,
            rsi_14: rsi,
            bb_width,
            macd,
            macd_signal,
            macd_hist,
            atr,
            volume_ratio,
            obv,
            spread,
            additional_metrics: HashMap::new(),
        };
        
        // Cache the features
        let mut cached = self.cached_features.write().unwrap();
        cached.insert(symbol.to_string(), features.clone());
        
        Ok(features)
    }
    
    /// Detect anomalies across all symbols
    pub fn detect_anomalies(&self) -> Vec<MarketAnomaly> {
        let mut detected_anomalies = Vec::new();
        
        // Get configuration
        let config = self.config.read().unwrap();
        
        // Get tick history
        let history = self.tick_history.read().unwrap();
        
        // Get cached features
        let features = self.cached_features.read().unwrap();
        
        // Check each symbol
        for (symbol, ticks) in history.iter() {
            if ticks.len() < 100 {
                continue;
            }
            
            // Get features for symbol
            if let Some(feature) = features.get(symbol) {
                // Check for price spike
                if let Some(anomaly) = self.detect_price_spike(symbol, ticks, feature, &config) {
                    detected_anomalies.push(anomaly);
                }
                
                // Check for volume spike
                if let Some(anomaly) = self.detect_volume_spike(symbol, ticks, feature, &config) {
                    detected_anomalies.push(anomaly);
                }
                
                // Check for spread widening
                if let Some(anomaly) = self.detect_spread_widening(symbol, ticks, feature, &config) {
                    detected_anomalies.push(anomaly);
                }
                
                // Other anomaly checks can be added here
            }
        }
        
        // Store detected anomalies
        if !detected_anomalies.is_empty() {
            let mut anomalies = self.anomalies.write().unwrap();
            anomalies.extend(detected_anomalies.clone());
            
            // Trim anomalies list if needed
            if anomalies.len() > 1000 {
                let to_remove = anomalies.len() - 1000;
                anomalies.drain(0..to_remove);
            }
        }
        
        detected_anomalies
    }
    
    /// Get recent anomalies
    pub fn get_recent_anomalies(&self, limit: usize) -> Vec<MarketAnomaly> {
        let anomalies = self.anomalies.read().unwrap();
        let start = if anomalies.len() > limit {
            anomalies.len() - limit
        } else {
            0
        };
        
        anomalies[start..].to_vec()
    }
    
    /// Get latest market features for a symbol
    pub fn get_latest_features(&self, symbol: &str) -> Option<MarketFeatures> {
        let features = self.cached_features.read().unwrap();
        features.get(symbol).cloned()
    }
    
    // Helper methods for calculating technical indicators
    
    /// Calculate percentage return over a period
    fn calculate_return(&self, ticks: &[MarketTick], seconds: u64) -> f64 {
        if ticks.len() < 2 {
            return 0.0;
        }
        
        let latest = ticks.last().unwrap();
        let latest_time = latest.timestamp;
        let target_time = latest_time - chrono::Duration::seconds(seconds as i64);
        
        // Find the closest tick to target time
        let mut closest_idx = 0;
        let mut closest_diff = i64::MAX;
        
        for (i, tick) in ticks.iter().enumerate() {
            let diff = (tick.timestamp - target_time).num_seconds().abs();
            if diff < closest_diff {
                closest_diff = diff;
                closest_idx = i;
            }
        }
        
        let reference_price = ticks[closest_idx].price;
        (latest.price - reference_price) / reference_price * 100.0
    }
    
    /// Calculate Relative Strength Index (RSI)
    fn calculate_rsi(&self, ticks: &[MarketTick], period: usize) -> f64 {
        if ticks.len() < period + 1 {
            return 50.0;
        }
        
        // Extract prices
        let prices: Vec<f64> = ticks.iter().map(|t| t.price).collect();
        
        // Calculate price changes
        let mut gains = 0.0;
        let mut losses = 0.0;
        
        for i in 1..period+1 {
            let idx = prices.len() - i;
            let prev_idx = prices.len() - i - 1;
            
            let change = prices[idx] - prices[prev_idx];
            
            if change > 0.0 {
                gains += change;
            } else {
                losses -= change;
            }
        }
        
        if losses == 0.0 {
            return 100.0;
        }
        
        let relative_strength = gains / losses;
        100.0 - (100.0 / (1.0 + relative_strength))
    }
    
    /// Calculate Bollinger Bands
    fn calculate_bollinger_bands(
        &self, 
        ticks: &[MarketTick], 
        period: usize, 
        std_dev_multiplier: f64
    ) -> (f64, f64) {
        if ticks.len() < period {
            return (0.0, 0.0);
        }
        
        // Extract prices
        let prices: Vec<f64> = ticks.iter().map(|t| t.price).collect();
        
        // Calculate SMA
        let start_idx = prices.len() - period;
        let mut sum = 0.0;
        for i in start_idx..prices.len() {
            sum += prices[i];
        }
        let sma = sum / period as f64;
        
        // Calculate standard deviation
        let mut variance_sum = 0.0;
        for i in start_idx..prices.len() {
            variance_sum += (prices[i] - sma).powi(2);
        }
        let std_dev = (variance_sum / period as f64).sqrt();
        
        // Calculate bandwidth
        let upper_band = sma + std_dev_multiplier * std_dev;
        let lower_band = sma - std_dev_multiplier * std_dev;
        let bandwidth = (upper_band - lower_band) / sma;
        
        (sma, bandwidth)
    }
    
    /// Calculate MACD
    fn calculate_macd(
        &self, 
        ticks: &[MarketTick], 
        fast_period: usize, 
        slow_period: usize, 
        signal_period: usize
    ) -> (f64, f64, f64) {
        if ticks.len() < slow_period + signal_period {
            return (0.0, 0.0, 0.0);
        }
        
        // Extract prices
        let prices: Vec<f64> = ticks.iter().map(|t| t.price).collect();
        
        // Calculate EMAs
        let fast_ema = self.calculate_ema(&prices, fast_period);
        let slow_ema = self.calculate_ema(&prices, slow_period);
        
        // MACD line
        let macd_line = fast_ema - slow_ema;
        
        // Calculate signal line (EMA of MACD line)
        let signal_line = macd_line * 0.2 + 0.8 * 0.0; // Simplified EMA calculation
        
        // MACD histogram
        let histogram = macd_line - signal_line;
        
        (macd_line, signal_line, histogram)
    }
    
    /// Calculate Exponential Moving Average (EMA)
    fn calculate_ema(&self, prices: &[f64], period: usize) -> f64 {
        if prices.len() < period {
            return prices.last().copied().unwrap_or(0.0);
        }
        
        let start_idx = prices.len() - period;
        
        // Start with SMA for the first EMA value
        let mut sum = 0.0;
        for i in start_idx..prices.len() {
            sum += prices[i];
        }
        let mut ema = sum / period as f64;
        
        // Calculate EMA with smoothing factor
        let alpha = 2.0 / (period as f64 + 1.0);
        
        for i in (prices.len() - period + 1)..prices.len() {
            ema = prices[i] * alpha + ema * (1.0 - alpha);
        }
        
        ema
    }
    
    /// Calculate Average True Range (ATR)
    fn calculate_atr(&self, ticks: &[MarketTick], period: usize) -> f64 {
        if ticks.len() < period + 1 {
            return 0.0;
        }
        
        // Extract prices
        let prices: Vec<f64> = ticks.iter().map(|t| t.price).collect();
        let mut tr_sum = 0.0;
        
        for i in 1..period+1 {
            let idx = prices.len() - i;
            let prev_idx = prices.len() - i - 1;
            
            let high = prices[idx];
            let low = prices[idx];
            let prev_close = prices[prev_idx];
            
            // True Range is the greatest of:
            // 1. Current High - Current Low
            // 2. |Current High - Previous Close|
            // 3. |Current Low - Previous Close|
            let tr = (high - low).max((high - prev_close).abs()).max((low - prev_close).abs());
            tr_sum += tr;
        }
        
        tr_sum / period as f64
    }
    
    /// Calculate Volume Ratio
    fn calculate_volume_ratio(&self, ticks: &[MarketTick], period: usize) -> f64 {
        if ticks.len() < period {
            return 1.0;
        }
        
        // Extract volumes
        let volumes: Vec<f64> = ticks.iter().map(|t| t.volume).collect();
        
        // Calculate average volume
        let start_idx = volumes.len() - period;
        let mut sum = 0.0;
        for i in start_idx..volumes.len() {
            sum += volumes[i];
        }
        let avg_volume = sum / period as f64;
        
        // Latest volume
        let latest_volume = volumes.last().copied().unwrap_or(0.0);
        
        if avg_volume > 0.0 {
            latest_volume / avg_volume
        } else {
            1.0
        }
    }
    
    /// Calculate On-Balance Volume (OBV)
    fn calculate_obv(&self, ticks: &[MarketTick]) -> f64 {
        if ticks.len() < 2 {
            return 0.0;
        }
        
        let mut obv = 0.0;
        
        for i in 1..ticks.len() {
            let current_price = ticks[i].price;
            let previous_price = ticks[i-1].price;
            let current_volume = ticks[i].volume;
            
            if current_price > previous_price {
                obv += current_volume;
            } else if current_price < previous_price {
                obv -= current_volume;
            }
            // If prices are equal, OBV doesn't change
        }
        
        obv
    }
    
    // Anomaly detection methods
    
    /// Detect price spike anomaly
    fn detect_price_spike(
        &self, 
        symbol: &str, 
        ticks: &[MarketTick], 
        feature: &MarketFeatures, 
        config: &MarketDataProcessorConfig
    ) -> Option<MarketAnomaly> {
        // Check if recent return exceeds threshold
        if feature.returns_1m.abs() > config.price_spike_threshold {
            let latest = ticks.last().unwrap();
            
            let mut metrics = HashMap::new();
            metrics.insert("returns_1m".to_string(), feature.returns_1m);
            metrics.insert("threshold".to_string(), config.price_spike_threshold);
            
            Some(MarketAnomaly {
                symbol: symbol.to_string(),
                timestamp: latest.timestamp,
                anomaly_type: AnomalyType::PriceSpike,
                severity: (feature.returns_1m.abs() / config.price_spike_threshold).min(1.0),
                description: format!(
                    "Price spike detected: {:.2}% move in 1 minute", 
                    feature.returns_1m
                ),
                metrics,
            })
        } else {
            None
        }
    }
    
    /// Detect volume spike anomaly
    fn detect_volume_spike(
        &self, 
        symbol: &str, 
        ticks: &[MarketTick], 
        feature: &MarketFeatures, 
        config: &MarketDataProcessorConfig
    ) -> Option<MarketAnomaly> {
        // Check if volume ratio exceeds threshold
        if feature.volume_ratio > config.volume_spike_threshold {
            let latest = ticks.last().unwrap();
            
            let mut metrics = HashMap::new();
            metrics.insert("volume_ratio".to_string(), feature.volume_ratio);
            metrics.insert("threshold".to_string(), config.volume_spike_threshold);
            
            Some(MarketAnomaly {
                symbol: symbol.to_string(),
                timestamp: latest.timestamp,
                anomaly_type: AnomalyType::VolumeSpike,
                severity: (feature.volume_ratio / config.volume_spike_threshold).min(1.0),
                description: format!(
                    "Volume spike detected: {:.2}x normal volume", 
                    feature.volume_ratio
                ),
                metrics,
            })
        } else {
            None
        }
    }
    
    /// Detect spread widening anomaly
    fn detect_spread_widening(
        &self, 
        symbol: &str, 
        ticks: &[MarketTick], 
        feature: &MarketFeatures, 
        config: &MarketDataProcessorConfig
    ) -> Option<MarketAnomaly> {
        // Skip if spread not available
        if feature.spread.is_none() {
            return None;
        }
        
        let spread = feature.spread.unwrap();
        
        // Get historical spreads
        let mut historical_spreads = Vec::new();
        for tick in ticks.iter().rev().take(100) {
            if let (Some(bid), Some(ask)) = (tick.bid, tick.ask) {
                let s = (ask - bid) / bid * 100.0;
                historical_spreads.push(s);
            }
        }
        
        if historical_spreads.len() < 10 {
            return None;
        }
        
        // Calculate average spread
        let avg_spread: f64 = historical_spreads.iter().sum::<f64>() / historical_spreads.len() as f64;
        
        // Check if current spread exceeds threshold
        if spread > avg_spread * config.spread_widening_threshold {
            let latest = ticks.last().unwrap();
            
            let mut metrics = HashMap::new();
            metrics.insert("current_spread".to_string(), spread);
            metrics.insert("avg_spread".to_string(), avg_spread);
            metrics.insert("ratio".to_string(), spread / avg_spread);
            metrics.insert("threshold".to_string(), config.spread_widening_threshold);
            
            Some(MarketAnomaly {
                symbol: symbol.to_string(),
                timestamp: latest.timestamp,
                anomaly_type: AnomalyType::SpreadWidening,
                severity: ((spread / avg_spread) / config.spread_widening_threshold).min(1.0),
                description: format!(
                    "Spread widening detected: {:.2}x normal spread", 
                    spread / avg_spread
                ),
                metrics,
            })
        } else {
            None
        }
    }
}

/// Create a market data processor with default configuration
pub fn create_market_data_processor() -> Arc<MarketDataProcessor> {
    let config = MarketDataProcessorConfig::default();
    Arc::new(MarketDataProcessor::new(config))
}

/// Create a market data processor with custom configuration
pub fn create_market_data_processor_with_config(config: MarketDataProcessorConfig) -> Arc<MarketDataProcessor> {
    Arc::new(MarketDataProcessor::new(config))
}

/// Create a market data processor with shared memory integration
pub fn create_market_data_processor_with_shared_memory(
    shared_memory_manager: Arc<SharedMemoryManager>,
    config: Option<MarketDataProcessorConfig>
) -> Arc<MarketDataProcessor> {
    let config = config.unwrap_or_default();
    let processor = MarketDataProcessor::new(config);
    
    // Register the processor with shared memory
    let arc_processor = Arc::new(processor);
    let weak_processor = Arc::downgrade(&arc_processor);
    
    // Set up shared memory callback
    shared_memory_manager.register_data_handler(Box::new(move |data| {
        if let Some(processor) = weak_processor.upgrade() {
            // Handle shared memory data
            if let Ok(market_data) = serde_json::from_slice::<MarketTick>(data) {
                let _ = processor.process_tick(market_data);
            }
        }
    }));
    
    arc_processor
} 