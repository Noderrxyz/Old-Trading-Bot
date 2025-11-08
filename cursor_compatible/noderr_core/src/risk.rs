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

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use std::any::Any;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, info, warn, error};
use uuid::Uuid;
use async_trait::async_trait;

use crate::strategy::{RiskProfile, Signal, SignalAction, StrategyTrustState, StrategyId, Strategy};
use crate::execution::{ExecutionResult, ExecutionStatus};
use crate::market::{MarketData, Symbol, Ticker, OrderBook};
use crate::telemetry::StrategyPerformance;
use crate::trust_score_engine::TrustScoreEngine;
use crate::drawdown::{DrawdownTracker, DrawdownState};

/// Direction of a trading position
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionDirection {
    /// Long position (buy)
    Long,
    /// Short position (sell)
    Short,
    /// Neutral position (no action)
    Neutral,
}

impl std::fmt::Display for PositionDirection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Long => write!(f, "Long"),
            Self::Short => write!(f, "Short"),
            Self::Neutral => write!(f, "Neutral"),
        }
    }
}

impl Default for PositionDirection {
    fn default() -> Self {
        PositionDirection::Neutral
    }
}

/// Errors that can occur during risk management operations
#[derive(Debug, Clone, Error)]
pub enum RiskError {
    /// Signal was rejected due to risk assessment
    #[error("Signal rejected: {0}")]
    SignalRejected(String),
    
    /// A risk limit was breached
    #[error("Risk limit breached: {0}")]
    RiskLimitBreached(String),
    
    /// The strategy has been disabled due to poor performance
    #[error("Strategy disabled: {0}")]
    StrategyDisabled(String),
    
    /// The trust score is below allowed threshold
    #[error("Trust score below threshold: {0}")]
    TrustScoreTooLow(String),
    
    /// Invalid configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    /// Market conditions are unsuitable
    #[error("Unsuitable market conditions: {0}")]
    UnsuitableMarketConditions(String),
    
    /// Position limit reached
    #[error("Position limit reached: {0}")]
    PositionLimitReached(String),
    
    /// Internal risk manager error
    #[error("Internal risk manager error: {0}")]
    Internal(String),
}

/// Configuration for the risk manager
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskManagerConfig {
    /// Maximum allowed exposure per strategy as percentage of total capital (0.0 - 1.0)
    pub max_strategy_allocation: f64,
    
    /// Maximum allowed daily drawdown as percentage (0.0 - 1.0)
    pub max_daily_drawdown: f64,
    
    /// Maximum allowed position size as percentage of capital (0.0 - 1.0)
    pub max_position_size: f64,
    
    /// Whether to enforce risk limits strictly (true) or just warn (false)
    pub enforce_risk_limits: bool,
    
    /// Minimum confidence level required for signals (0.0 - 1.0)
    pub min_signal_confidence: f64,
    
    /// Minimum trust score required for strategies (0.0 - 1.0)
    pub min_trust_score: f64,
    
    /// Maximum volatility level allowed for trading (0.0 - 1.0)
    pub max_volatility: f64,
    
    /// Maximum number of concurrent trades per strategy
    pub max_concurrent_trades: usize,
    
    /// Whether to adjust position sizes based on market volatility
    pub volatility_adjustment: bool,
    
    /// Whether to adjust position sizes based on trust scores
    pub trust_score_adjustment: bool,
    
    /// Maximum percentage of portfolio for all strategies combined
    pub max_portfolio_allocation: f64,
    
    /// Minimum liquidity score required for trading (0.0 - 1.0)
    pub min_liquidity_score: f64,
    
    /// Strategies exempt from risk limits
    pub exempt_strategies: HashSet<StrategyId>,
}

impl Default for RiskManagerConfig {
    fn default() -> Self {
        Self {
            max_strategy_allocation: 0.25,
            max_daily_drawdown: 0.05,
            max_position_size: 0.1,
            enforce_risk_limits: true,
            min_signal_confidence: 0.6,
            min_trust_score: 0.5,
            max_volatility: 0.8,
            max_concurrent_trades: 5,
            volatility_adjustment: true,
            trust_score_adjustment: true,
            max_portfolio_allocation: 0.75,
            min_liquidity_score: 0.3,
            exempt_strategies: HashSet::new(),
        }
    }
}

/// Metrics used to track and evaluate risk for a strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskMetrics {
    /// Current exposure for this strategy (percentage of capital)
    pub current_exposure: f64,
    
    /// Daily profit and loss
    pub daily_pnl: f64,
    
    /// Number of trades
    pub total_trades: u32,
    
    /// Number of profitable trades
    pub profitable_trades: usize,
    
    /// Last time metrics were updated
    pub last_update: DateTime<Utc>,
    
    /// Active positions and their sizes
    pub positions: HashMap<Symbol, f64>,
    
    /// Number of active trades
    pub active_trades: usize,
    
    /// Current drawdown
    pub current_drawdown: f64,
    
    /// Maximum drawdown
    pub max_drawdown: f64,
    
    /// Win rate
    pub win_rate: f64,
    
    /// Profit factor
    pub profit_factor: f64,
    
    /// Sharpe ratio
    pub sharpe_ratio: Option<f64>,
    
    /// Position direction
    pub position_direction: PositionDirection,
    
    /// Enabled status
    pub enabled: bool,
    
    /// Current trust score
    pub trust_score: Option<f64>,
    
    /// Consecutive losses
    pub consecutive_losses: u32,
    
    /// Historical volatility of returns
    pub historical_volatility: Option<f64>,
    
    /// Max drawdown percentage
    pub max_drawdown_pct: f64,
    
    /// Risk adjusted returns
    pub risk_adjusted_return: Option<f64>,
}

impl Default for RiskMetrics {
    fn default() -> Self {
        Self {
            current_exposure: 0.0,
            daily_pnl: 0.0,
            total_trades: 0,
            profitable_trades: 0,
            last_update: Utc::now(),
            positions: HashMap::new(),
            active_trades: 0,
            current_drawdown: 0.0,
            max_drawdown: 0.0,
            win_rate: 0.0,
            profit_factor: 1.0,
            sharpe_ratio: None,
            position_direction: PositionDirection::Neutral,
            enabled: true,
            trust_score: Some(0.7), // Default starting trust score
            consecutive_losses: 0,
            historical_volatility: None,
            max_drawdown_pct: 0.0,
            risk_adjusted_return: None,
        }
    }
}

/// Position sizing recommendation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionSizing {
    /// Recommended position size
    pub recommended_size: f64,
    
    /// Maximum allowed position size
    pub max_size: f64,
    
    /// Risk-adjusted position size
    pub risk_adjusted_size: f64,
    
    /// Risk factor applied to the base size
    pub risk_factor: f64,
    
    /// Reason for the sizing recommendation
    pub sizing_reason: String,
    
    /// Adjustment factors applied
    pub adjustments: HashMap<String, f64>,
    
    /// Is this the maximum allowed size
    pub is_max_size: bool,
    
    /// Confidence level in this recommendation
    pub confidence: f64,
}

impl PositionSizing {
    /// Create a new position sizing recommendation
    pub fn new(
        base_size: f64, 
        max_size: f64, 
        risk_adjusted_size: f64, 
        risk_factor: f64
    ) -> Self {
        let sizing_reason = if risk_factor < 0.8 {
            "Reduced due to risk assessment".to_string()
        } else {
            "Standard position size".to_string()
        };
        
        let is_max_size = (max_size - risk_adjusted_size).abs() < 0.0001;
        
        Self {
            recommended_size: base_size,
            max_size,
            risk_adjusted_size,
            risk_factor,
            sizing_reason,
            adjustments: HashMap::new(),
            is_max_size,
            confidence: 0.8,
        }
    }
    
    /// Create a new position sizing recommendation with detailed adjustments
    pub fn with_adjustments(
        base_size: f64,
        max_size: f64,
        risk_adjusted_size: f64,
        risk_factor: f64,
        adjustments: HashMap<String, f64>,
        reason: String
    ) -> Self {
        let is_max_size = (max_size - risk_adjusted_size).abs() < 0.0001;
        let confidence = adjustments.values().sum::<f64>() / adjustments.len() as f64;
        
        Self {
            recommended_size: base_size,
            max_size,
            risk_adjusted_size,
            risk_factor,
            sizing_reason: reason,
            adjustments,
            is_max_size,
            confidence,
        }
    }
    
    /// Add adjustment factor with explanation
    pub fn add_adjustment(&mut self, name: &str, factor: f64) {
        self.adjustments.insert(name.to_string(), factor);
        
        // Recalculate confidence
        if !self.adjustments.is_empty() {
            self.confidence = self.adjustments.values().sum::<f64>() / self.adjustments.len() as f64;
        }
    }
    
    /// Get user-friendly description of the position sizing
    pub fn description(&self) -> String {
        let mut desc = format!(
            "Position size: {:.2}% of capital ({:.2}% recommended, {:.2}% maximum)",
            self.risk_adjusted_size * 100.0,
            self.recommended_size * 100.0,
            self.max_size * 100.0
        );
        
        if !self.adjustments.is_empty() {
            desc.push_str("\nAdjustments applied:");
            for (name, factor) in &self.adjustments {
                desc.push_str(&format!("\n  {}: {:.2}", name, factor));
            }
        }
        
        desc
    }
}

/// Assessment of current market conditions and associated risk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRiskAssessment {
    /// Volatility level (0.0 - 1.0) where 1.0 is extremely volatile
    pub volatility: f64,
    
    /// Liquidity assessment (0.0 - 1.0) where 1.0 is highly liquid
    pub liquidity_score: f64,
    
    /// Risk score (0.0 - 1.0) where 1.0 is highest risk
    pub risk_score: f64,
    
    /// Market trend (0.0 - 1.0) where 1.0 is bullish
    pub market_trend: f64,
    
    /// Recommendations for trading strategy
    pub recommendations: Vec<String>,
    
    /// Whether the market is suitable for trading
    pub suitable_for_trading: bool,
    
    /// Timestamp when this assessment was made
    pub timestamp: DateTime<Utc>,
    
    /// Bid-ask spread percentage
    pub spread_pct: Option<f64>,
    
    /// Order book depth
    pub order_book_depth: Option<f64>,
    
    /// Market impact cost estimate
    pub market_impact_estimate: Option<f64>,
}

impl Default for MarketRiskAssessment {
    fn default() -> Self {
        Self {
            volatility: 0.5,
            liquidity_score: 0.5,
            risk_score: 0.5,
            market_trend: 0.5,
            recommendations: Vec::new(),
            suitable_for_trading: true,
            timestamp: Utc::now(),
            spread_pct: None,
            order_book_depth: None,
            market_impact_estimate: None,
        }
    }
}

/// Risk analysis result with detailed metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAnalysis {
    /// Overall risk score (0.0 - 1.0)
    pub risk_score: f64,
    
    /// Risk evaluation timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Detailed risk metrics by category
    pub risk_factors: HashMap<String, f64>,
    
    /// Action recommendations
    pub recommendations: Vec<String>,
    
    /// Raw market data used for analysis
    pub market_data: Option<MarketDataSummary>,
    
    /// Strategy trust state
    pub trust_state: Option<StrategyTrustState>,
    
    /// Current exposure
    pub current_exposure: f64,
    
    /// Maximum allowed exposure
    pub max_exposure: f64,
    
    /// Historical performance metrics
    pub performance_metrics: Option<PerformanceMetrics>,
}

/// Summary of market data used for risk analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDataSummary {
    /// Symbol 
    pub symbol: Symbol,
    
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Price
    pub price: f64,
    
    /// 24h volatility
    pub volatility_24h: Option<f64>,
    
    /// Bid-ask spread
    pub spread_pct: Option<f64>,
    
    /// Trading volume
    pub volume_24h: Option<f64>,
}

/// Performance metrics for risk assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    /// Win rate (0.0 - 1.0)
    pub win_rate: f64,
    
    /// Profit factor
    pub profit_factor: f64,
    
    /// Sharpe ratio
    pub sharpe_ratio: Option<f64>,
    
    /// Maximum drawdown
    pub max_drawdown: f64,
    
    /// Average return
    pub avg_return: f64,
    
    /// Total P&L
    pub total_pnl: f64,
}

/// Risk Manager trait defining risk management functionality
#[async_trait]
pub trait RiskManager: Send + Sync {
    /// Validate a signal against risk parameters
    async fn validate_signal(&self, signal: &Signal, market_data: &MarketData) -> Result<(), RiskError>;
    
    /// Calculate appropriate position sizing based on risk parameters
    async fn calculate_position_size(
        &self,
        signal: &Signal,
        market_data: &MarketData,
    ) -> Result<PositionSizing, RiskError>;
    
    /// Get current risk metrics for a strategy
    async fn get_risk_metrics(&self, strategy_id: &StrategyId) -> Option<RiskMetrics>;
    
    /// Update risk metrics based on strategy performance
    async fn update_metrics(&self, strategy_id: &StrategyId, performance: &StrategyPerformance);
    
    /// Assess current market risk based on market data
    async fn assess_market_risk(&self, market_data: &MarketData) -> MarketRiskAssessment;
    
    /// Check if a strategy has breached any risk limits
    async fn check_risk_limits(&self, strategy_id: &StrategyId) -> Result<(), RiskError>;
    
    /// Register a new strategy for risk management
    async fn register_strategy(&self, strategy_id: StrategyId);
    
    /// Unregister a strategy
    async fn unregister_strategy(&self, strategy_id: &StrategyId);
    
    /// Analyze risk of a potential signal without validation
    async fn analyze_signal_risk(&self, signal: &Signal, market_data: &MarketData) -> RiskAnalysis;
    
    /// Get detailed risk analysis for a strategy
    async fn get_strategy_risk_analysis(&self, strategy_id: &StrategyId) -> Option<RiskAnalysis>;
    
    /// Update strategy trust score from trust score engine
    async fn update_trust_score(&self, strategy_id: &StrategyId, trust_score_engine: &dyn TrustScoreEngine);
    
    /// Get the current configuration
    fn get_config(&self) -> RiskManagerConfig;
    
    /// Update the configuration
    async fn update_config(&self, config: RiskManagerConfig) -> Result<(), RiskError>;
    
    /// Allow downcasting to concrete implementation
    fn as_any(&self) -> &dyn Any where Self: 'static;
}

/// Default implementation of the RiskManager trait
pub struct DefaultRiskManager {
    /// Risk manager configuration
    config: RiskManagerConfig,
    
    /// Risk metrics for each strategy
    metrics: Arc<RwLock<HashMap<StrategyId, RiskMetrics>>>,
    
    /// Risk profiles for each strategy
    risk_profiles: Arc<Mutex<HashMap<StrategyId, RiskProfile>>>,
    
    /// Market risk assessments for different markets
    market_assessments: Arc<RwLock<HashMap<String, MarketRiskAssessment>>>,
    
    /// Portfolio-wide exposure tracking
    portfolio_exposure: Arc<RwLock<f64>>,
    
    /// Strategy trust scores cache
    trust_scores: Arc<RwLock<HashMap<StrategyId, f64>>>,
    
    /// Historical volatility calculations
    volatility_data: Arc<RwLock<HashMap<Symbol, Vec<f64>>>>,
    
    /// Drawdown tracker for adaptive exposure based on drawdowns
    drawdown_tracker: Option<Arc<dyn DrawdownTracker>>,
}

impl DefaultRiskManager {
    /// Creates a new DefaultRiskManager
    pub fn new(config: RiskManagerConfig) -> Self {
        Self {
            config,
            metrics: Arc::new(RwLock::new(HashMap::new())),
            risk_profiles: Arc::new(Mutex::new(HashMap::new())),
            market_assessments: Arc::new(RwLock::new(HashMap::new())),
            portfolio_exposure: Arc::new(RwLock::new(0.0)),
            trust_scores: Arc::new(RwLock::new(HashMap::new())),
            volatility_data: Arc::new(RwLock::new(HashMap::new())),
            drawdown_tracker: None,
        }
    }
    
    /// Creates a new DefaultRiskManager with drawdown tracking
    pub fn with_drawdown_tracker(config: RiskManagerConfig, drawdown_tracker: Arc<dyn DrawdownTracker>) -> Self {
        Self {
            config,
            metrics: Arc::new(RwLock::new(HashMap::new())),
            risk_profiles: Arc::new(Mutex::new(HashMap::new())),
            market_assessments: Arc::new(RwLock::new(HashMap::new())),
            portfolio_exposure: Arc::new(RwLock::new(0.0)),
            trust_scores: Arc::new(RwLock::new(HashMap::new())),
            volatility_data: Arc::new(RwLock::new(HashMap::new())),
            drawdown_tracker: Some(drawdown_tracker),
        }
    }
    
    /// Creates a new DefaultRiskManager with default configuration
    pub fn default() -> Self {
        Self::new(RiskManagerConfig::default())
    }
    
    /// Calculate win rate from risk metrics
    fn calculate_win_rate(&self, metrics: &RiskMetrics) -> f64 {
        if metrics.total_trades == 0 {
            return 0.5; // Default win rate for no trades
        }
        metrics.profitable_trades as f64 / metrics.total_trades as f64
    }
    
    /// Calculate profit factor from metrics
    fn calculate_profit_factor(&self, metrics: &RiskMetrics) -> f64 {
        if metrics.total_trades < 10 {
            return 1.0; // Default for insufficient data
        }
        
        // Use profit_factor from metrics if available
        metrics.profit_factor
    }
    
    /// Analyze volatility from market data
    fn analyze_volatility(&self, market_data: &MarketData) -> f64 {
        // Get price range from market data if available
        if let Some(ticker) = &market_data.ticker {
            if let (Some(high), Some(low)) = (ticker.high, ticker.low) {
                if high > 0.0 && low > 0.0 {
                    let price_range = (high - low) / ticker.price;
                    return price_range.min(1.0);
                }
            }
            
            // If no high/low but we have bid/ask, use spread as a proxy for volatility
            if let (Some(bid), Some(ask)) = (ticker.bid, ticker.ask) {
                if bid > 0.0 && ask > 0.0 {
                    let spread = (ask - bid) / ticker.price;
                    return (spread * 10.0).min(1.0); // Scale spread to volatility estimate
                }
            }
        }
        
        // Check historical volatility data
        let symbol_str = market_data.symbol.to_string();
        let volatility_data = self.volatility_data.read().unwrap();
        if let Some(price_data) = volatility_data.get(&market_data.symbol) {
            if price_data.len() >= 2 {
                // Calculate standard deviation of returns
                let returns: Vec<f64> = price_data.windows(2)
                    .map(|window| (window[1] - window[0]) / window[0])
                    .collect();
                
                if !returns.is_empty() {
                    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
                    let variance = returns.iter()
                        .map(|r| (r - mean).powi(2))
                        .sum::<f64>() / returns.len() as f64;
                    
                    let std_dev = variance.sqrt();
                    return (std_dev * 5.0).min(1.0); // Scale to 0.0-1.0
                }
            }
        }
        
        // Default moderate volatility if we can't calculate
        0.5
    }
    
    /// Analyze liquidity from market data
    fn analyze_liquidity(&self, market_data: &MarketData) -> f64 {
        // Higher is more liquid
        if let Some(orderbook) = &market_data.orderbook {
            // Simple liquidity metric based on order book depth
            let bid_depth: f64 = orderbook.bids.iter().map(|(_, size)| size).sum();
            let ask_depth: f64 = orderbook.asks.iter().map(|(_, size)| size).sum();
            
            let total_depth = bid_depth + ask_depth;
            if total_depth > 0.0 {
                // Normalize to 0.0-1.0 with a reasonable depth cap
                let normalized = (total_depth / 1000.0).min(1.0);
                return normalized;
            }
            
            // Also consider the bid-ask spread as a liquidity indicator
            if !orderbook.bids.is_empty() && !orderbook.asks.is_empty() {
                let best_bid = orderbook.bids.iter().map(|(price, _)| *price).fold(0.0, f64::max);
                let best_ask = orderbook.asks.iter().map(|(price, _)| *price).fold(f64::MAX, f64::min);
                
                if best_bid > 0.0 && best_ask < f64::MAX {
                    let spread = (best_ask - best_bid) / best_bid;
                    let spread_factor = (1.0 - (spread * 20.0).min(1.0)); // Tighter spread = higher liquidity
                    
                    // If we have both depth and spread, use a weighted average
                    if total_depth > 0.0 {
                        return (normalized * 0.7) + (spread_factor * 0.3);
                    }
                    
                    return spread_factor;
                }
            }
        }
        
        // Check ticker for basic liquidity indicators
        if let Some(ticker) = &market_data.ticker {
            // Consider volume as liquidity indicator
            if let Some(volume) = ticker.volume {
                if volume > 0.0 {
                    // Normalize based on typical volumes (this would need refinement based on the asset)
                    return (volume / 1000.0).min(1.0).max(0.1);
                }
            }
            
            // Use bid-ask spread if available
            if let (Some(bid), Some(ask)) = (ticker.bid, ticker.ask) {
                if bid > 0.0 && ask > 0.0 {
                    let spread = (ask - bid) / bid;
                    return (1.0 - (spread * 20.0).min(1.0)).max(0.1); // Tighter spread = higher liquidity
                }
            }
        }
        
        // Default moderate liquidity if we can't calculate
        0.5
    }
    
    /// Analyze market trend from market data and technical indicators
    fn analyze_market_trend(&self, market_data: &MarketData) -> f64 {
        // 0.0 = strongly bearish, 0.5 = neutral, 1.0 = strongly bullish
        let mut trend_signals = Vec::new();
        
        // Check technical indicators if available
        if let Some(indicators) = &market_data.indicators {
            // Common trend indicators
            if let Some(macd) = indicators.macd {
                // MACD above signal line is bullish
                if macd.value > macd.signal {
                    trend_signals.push(0.7);
                } else if macd.value < macd.signal {
                    trend_signals.push(0.3);
                } else {
                    trend_signals.push(0.5);
                }
            }
            
            // RSI
            if let Some(rsi) = indicators.rsi {
                // RSI > 70 = overbought, RSI < 30 = oversold
                if rsi > 70.0 {
                    trend_signals.push(0.8);
                } else if rsi > 50.0 {
                    trend_signals.push(0.6);
                } else if rsi < 30.0 {
                    trend_signals.push(0.2);
                } else if rsi < 50.0 {
                    trend_signals.push(0.4);
                } else {
                    trend_signals.push(0.5);
                }
            }
            
            // Moving averages
            if let Some(ma_crossover) = indicators.ma_crossover {
                if ma_crossover.is_bullish {
                    trend_signals.push(0.7);
                } else if ma_crossover.is_bearish {
                    trend_signals.push(0.3);
                } else {
                    trend_signals.push(0.5);
                }
            }
        }
        
        // Check price action from ticker
        if let Some(ticker) = &market_data.ticker {
            if let (Some(high), Some(low), Some(open)) = (ticker.high, ticker.low, ticker.open) {
                let price = ticker.price;
                let price_range = high - low;
                
                if price_range > 0.0 {
                    // Closer to high = more bullish
                    let range_position = (price - low) / price_range;
                    trend_signals.push(range_position);
                    
                    // Price above open = bullish
                    if price > open {
                        trend_signals.push(0.6);
                    } else if price < open {
                        trend_signals.push(0.4);
                    } else {
                        trend_signals.push(0.5);
                    }
                }
            }
        }
        
        // Check sentiment if available
        if let Some(sentiment) = &market_data.sentiment {
            trend_signals.push(sentiment.value);
        }
        
        // Average all signals or return neutral if no signals
        if trend_signals.is_empty() {
            return 0.5;
        }
        
        trend_signals.iter().sum::<f64>() / trend_signals.len() as f64
    }
    
    /// Update position size for a strategy and symbol
    fn update_position(&self, metrics: &mut RiskMetrics, symbol: Symbol, size_change: f64) {
        let current_size = metrics.positions.get(&symbol).unwrap_or(&0.0);
        let new_size = current_size + size_change;
        
        if new_size.abs() < 0.00001 {
            // Position effectively closed
            metrics.positions.remove(&symbol);
            if metrics.active_trades > 0 {
                metrics.active_trades -= 1;
            }
        } else {
            // Update position size
            metrics.positions.insert(symbol, new_size);
            if size_change != 0.0 && *current_size == 0.0 {
                // New position opened
                metrics.active_trades += 1;
            }
        }
        
        // Recalculate total exposure
        metrics.current_exposure = metrics.positions.values().map(|size| size.abs()).sum();
        
        // Update position direction
        if metrics.current_exposure < 0.001 {
            metrics.position_direction = PositionDirection::Neutral;
        } else {
            let net_position: f64 = metrics.positions.values().sum();
            metrics.position_direction = if net_position > 0.0 {
                PositionDirection::Long
            } else {
                PositionDirection::Short
            };
        }
    }

    /// Calculate market volatility from ticker data
    fn calculate_market_volatility(&self, ticker: &Ticker) -> f64 {
        if let (Some(high), Some(low)) = (ticker.high, ticker.low) {
            if high == 0.0 {
                return 0.0;
            }
            
            (high - low) / high
        } else {
            // If no high/low data, use spread as a proxy for volatility
            if let (Some(bid), Some(ask)) = (ticker.bid, ticker.ask) {
                if bid > 0.0 {
                    let spread_pct = (ask - bid) / bid;
                    return (spread_pct * 5.0).min(1.0); // Scale spread to volatility estimate
                }
            }
            
            // Default value if no data
            0.5
        }
    }
    
    /// Calculate risk score from market risk assessment
    fn calculate_risk_score(&self, assessment: &MarketRiskAssessment) -> f64 {
        // Higher score = higher risk
        let volatility_factor = assessment.volatility * 0.4;
        let liquidity_factor = (1.0 - assessment.liquidity_score) * 0.3;
        let trend_factor = if assessment.market_trend > 0.5 { 0.1 } else { 0.3 };
        
        volatility_factor + liquidity_factor + trend_factor
    }
    
    /// Apply trust score adjustment to position sizing
    fn apply_trust_score_adjustment(&self, strategy_id: &StrategyId, base_size: f64) -> (f64, f64) {
        let trust_scores = self.trust_scores.read().unwrap();
        
        if let Some(trust_score) = trust_scores.get(strategy_id) {
            // Trust score adjustment curve:
            // - Trust score 1.0 = full position size
            // - Trust score at min_trust_score = 50% position size
            // - Below min_trust_score = disabled (handled elsewhere)
            
            let min_score = self.config.min_trust_score;
            let usable_range = 1.0 - min_score;
            
            if *trust_score >= 1.0 {
                return (base_size, 1.0); // Full size
            }
            
            if *trust_score <= min_score {
                return (base_size * 0.5, 0.5); // Minimum size
            }
            
            // Linear scaling from 0.5 to 1.0 based on trust score
            let normalized_score = (*trust_score - min_score) / usable_range;
            let adjustment_factor = 0.5 + (normalized_score * 0.5);
            
            (base_size * adjustment_factor, adjustment_factor)
        } else {
            // No trust score available, use default adjustment
            (base_size * 0.8, 0.8)
        }
    }
    
    /// Generate risk recommendations based on assessment
    fn generate_risk_recommendations(&self, assessment: &MarketRiskAssessment) -> Vec<String> {
        let mut recommendations = Vec::new();
        
        // Volatility-based recommendations
        if assessment.volatility > 0.8 {
            recommendations.push("Extreme volatility detected - consider reducing position sizes by 50%".to_string());
        } else if assessment.volatility > 0.6 {
            recommendations.push("High volatility detected - consider reducing position sizes by 25%".to_string());
        }
        
        // Liquidity-based recommendations
        if assessment.liquidity_score < 0.2 {
            recommendations.push("Extremely low liquidity - trading not recommended".to_string());
        } else if assessment.liquidity_score < 0.4 {
            recommendations.push("Low liquidity - use limit orders and reduce position sizes".to_string());
        }
        
        // Spread recommendations
        if let Some(spread_pct) = assessment.spread_pct {
            if spread_pct > 0.01 {
                recommendations.push(format!("Wide spread ({:.2}%) - consider limit orders only", spread_pct * 100.0));
            }
        }
        
        // Market impact recommendations
        if let Some(impact) = assessment.market_impact_estimate {
            if impact > 0.005 {
                recommendations.push(format!("High market impact ({:.2}%) - consider splitting order", impact * 100.0));
            }
        }
        
        // Trend-based recommendations
        if assessment.market_trend > 0.8 {
            recommendations.push("Strong bullish trend - favor long positions".to_string());
        } else if assessment.market_trend < 0.2 {
            recommendations.push("Strong bearish trend - favor short positions or reduce exposure".to_string());
        } else if (assessment.market_trend - 0.5).abs() < 0.1 {
            recommendations.push("Neutral market trend - reduce position sizes or favor range strategies".to_string());
        }
        
        // Overall risk score recommendations
        if assessment.risk_score > 0.7 {
            recommendations.push("High overall risk - consider waiting for better conditions".to_string());
        }
        
        recommendations
    }

    /// Create a detailed risk analysis report
    async fn create_risk_analysis(
        &self, 
        strategy_id: &StrategyId, 
        market_data: Option<&MarketData>
    ) -> RiskAnalysis {
        let mut risk_factors = HashMap::new();
        let mut recommendations = Vec::new();
        
        // Get metrics for this strategy
        let metrics_opt = self.get_risk_metrics(strategy_id).await;
        
        // Current exposure and limits
        let (current_exposure, trust_state) = if let Some(metrics) = &metrics_opt {
            risk_factors.insert("strategy_exposure".to_string(), metrics.current_exposure);
            risk_factors.insert("win_rate".to_string(), metrics.win_rate);
            
            if metrics.win_rate < 0.4 {
                recommendations.push("Low win rate - consider strategy review".to_string());
            }
            
            if let Some(sharpe) = metrics.sharpe_ratio {
                risk_factors.insert("sharpe_ratio".to_string(), sharpe);
                
                if sharpe < 0.5 {
                    recommendations.push("Low risk-adjusted returns - review strategy effectiveness".to_string());
                }
            }
            
            if metrics.consecutive_losses > 3 {
                risk_factors.insert("consecutive_losses".to_string(), metrics.consecutive_losses as f64);
                recommendations.push(format!("{} consecutive losses - consider reducing exposure", metrics.consecutive_losses));
            }
            
            let trust_state = if let Some(trust_score) = metrics.trust_score {
                risk_factors.insert("trust_score".to_string(), trust_score);
                
                if trust_score < self.config.min_trust_score {
                    recommendations.push(format!("Trust score below threshold ({:.2})", trust_score));
                    Some(StrategyTrustState::Disabled)
                } else if trust_score < 0.7 {
                    recommendations.push(format!("Trust score suboptimal ({:.2}) - reduced position sizing in effect", trust_score));
                    Some(StrategyTrustState::Recovering)
                } else {
                    Some(StrategyTrustState::Active)
                }
            } else {
                None
            };
            
            (metrics.current_exposure, trust_state)
        } else {
            (0.0, None)
        };
        
        // Market data analysis
        let market_data_summary = if let Some(md) = market_data {
            // Analyze market conditions
            let volatility = self.analyze_volatility(md);
            risk_factors.insert("market_volatility".to_string(), volatility);
            
            let liquidity = self.analyze_liquidity(md);
            risk_factors.insert("market_liquidity".to_string(), liquidity);
            
            let market_trend = self.analyze_market_trend(md);
            risk_factors.insert("market_trend".to_string(), market_trend);
            
            // Generate specific recommendations based on market conditions
            if volatility > 0.7 {
                recommendations.push("High market volatility - consider reduced position sizing".to_string());
            }
            
            if liquidity < 0.3 {
                recommendations.push("Low market liquidity - limit order execution may be difficult".to_string());
            }
            
            if let Some(ticker) = &md.ticker {
                let spread_pct = if let (Some(bid), Some(ask)) = (ticker.bid, ticker.ask) {
                    if bid > 0.0 {
                        let spread = (ask - bid) / bid;
                        risk_factors.insert("spread_percentage".to_string(), spread);
                        
                        if spread > 0.01 {
                            recommendations.push(format!("Wide spread ({:.2}%) - may impact profitability", spread * 100.0));
                        }
                        
                        Some(spread)
                    } else {
                        None
                    }
                } else {
                    None
                };
                
                Some(MarketDataSummary {
                    symbol: md.symbol.clone(),
                    timestamp: md.timestamp,
                    price: ticker.price,
                    volatility_24h: Some(volatility),
                    spread_pct,
                    volume_24h: ticker.volume,
                })
            } else {
                None
            }
        } else {
            None
        };
        
        // Calculate overall risk score (weighted average of risk factors)
        let mut overall_risk = 0.0;
        let mut weight_sum = 0.0;
        
        // Factors and their weights
        let factor_weights = [
            ("market_volatility", 0.25),
            ("market_liquidity", 0.20),
            ("strategy_exposure", 0.15),
            ("spread_percentage", 0.10),
            ("win_rate", 0.15),
            ("consecutive_losses", 0.15),
        ];
        
        for (factor, weight) in factor_weights.iter() {
            if let Some(value) = risk_factors.get(*factor) {
                // For win_rate, invert the scale (higher win_rate = lower risk)
                let adjusted_value = if *factor == "win_rate" {
                    1.0 - *value
                } else {
                    *value
                };
                
                overall_risk += adjusted_value * weight;
                weight_sum += weight;
            }
        }
        
        // Normalize risk score
        let risk_score = if weight_sum > 0.0 {
            (overall_risk / weight_sum).min(1.0).max(0.0)
        } else {
            0.5 // Default moderate risk if no factors available
        };
        
        // Add risk level context recommendation
        if risk_score > 0.8 {
            recommendations.push("VERY HIGH RISK - Consider pausing trading activity".to_string());
        } else if risk_score > 0.6 {
            recommendations.push("HIGH RISK - Reduce position sizes and increase scrutiny".to_string());
        } else if risk_score > 0.4 {
            recommendations.push("MODERATE RISK - Standard risk management procedures advised".to_string());
        } else {
            recommendations.push("LOW RISK - Standard operating conditions".to_string());
        }
        
        // Assemble performance metrics if available
        let performance_metrics = if let Some(metrics) = metrics_opt {
            Some(PerformanceMetrics {
                win_rate: metrics.win_rate,
                profit_factor: metrics.profit_factor,
                sharpe_ratio: metrics.sharpe_ratio,
                max_drawdown: metrics.max_drawdown_pct,
                avg_return: metrics.risk_adjusted_return.unwrap_or(0.0),
                total_pnl: metrics.daily_pnl,
            })
        } else {
            None
        };
        
        RiskAnalysis {
            risk_score,
            timestamp: Utc::now(),
            risk_factors,
            recommendations,
            market_data: market_data_summary,
            trust_state,
            current_exposure,
            max_exposure: self.config.max_strategy_allocation,
            performance_metrics,
        }
    }
    
    /// Get drawdown risk modifier for a strategy
    async fn get_drawdown_risk_modifier(&self, strategy_id: &StrategyId) -> f64 {
        if let Some(drawdown_tracker) = &self.drawdown_tracker {
            match drawdown_tracker.get_risk_modifier(strategy_id).await {
                Ok(modifier) => modifier,
                Err(e) => {
                    warn!("Failed to get drawdown risk modifier: {}", e);
                    1.0 // Default to no adjustment on error
                }
            }
        } else {
            1.0 // Default to no adjustment if no drawdown tracker
        }
    }
}

#[async_trait]
impl RiskManager for DefaultRiskManager {
    async fn validate_signal(&self, signal: &Signal, market_data: &MarketData) -> Result<(), RiskError> {
        // Skip validation for exempt strategies
        if self.config.exempt_strategies.contains(&signal.strategy_id) {
            return Ok(());
        }
        
        // Check confidence level
        if signal.confidence < self.config.min_signal_confidence {
            return Err(RiskError::SignalRejected(format!(
                "Signal confidence ({:.2}) below minimum threshold ({:.2})",
                signal.confidence, self.config.min_signal_confidence
            )));
        }
        
        // Check trust score
        let trust_scores = self.trust_scores.read().unwrap();
        if let Some(trust_score) = trust_scores.get(&signal.strategy_id) {
            if *trust_score < self.config.min_trust_score {
                return Err(RiskError::TrustScoreTooLow(format!(
                    "Trust score ({:.2}) below minimum threshold ({:.2})",
                    trust_score, self.config.min_trust_score
                )));
            }
        }
        
        // Check market conditions
        let market_assessment = self.assess_market_risk(market_data).await;
        if !market_assessment.suitable_for_trading {
            return Err(RiskError::UnsuitableMarketConditions(format!(
                "Market conditions unsuitable for trading: volatility={:.2}, liquidity={:.2}, risk_score={:.2}",
                market_assessment.volatility, 
                market_assessment.liquidity_score, 
                market_assessment.risk_score
            )));
        }
        
        // Check if the market is too volatile
        if market_assessment.volatility > self.config.max_volatility {
            return Err(RiskError::UnsuitableMarketConditions(format!(
                "Market volatility ({:.2}) exceeds maximum threshold ({:.2})",
                market_assessment.volatility, self.config.max_volatility
            )));
        }
        
        // Check if the market has sufficient liquidity
        if market_assessment.liquidity_score < self.config.min_liquidity_score {
            return Err(RiskError::UnsuitableMarketConditions(format!(
                "Market liquidity ({:.2}) below minimum threshold ({:.2})",
                market_assessment.liquidity_score, self.config.min_liquidity_score
            )));
        }
        
        // Check if we have risk metrics for this strategy
        let metrics_guard = self.metrics.read().unwrap();
        if let Some(metrics) = metrics_guard.get(&signal.strategy_id) {
            // Skip position checks for exit signals
            if signal.action != SignalAction::ClosePosition {
                // Check max concurrent trades
                if metrics.active_trades >= self.config.max_concurrent_trades {
                    return Err(RiskError::PositionLimitReached(format!(
                        "Maximum concurrent trades ({}) reached for strategy",
                        self.config.max_concurrent_trades
                    )));
                }
                
                // Check exposure limit for this strategy
                if metrics.current_exposure >= self.config.max_strategy_allocation {
                    return Err(RiskError::RiskLimitBreached(format!(
                        "Maximum strategy exposure ({:.2}%) reached",
                        self.config.max_strategy_allocation * 100.0
                    )));
                }
                
                // Check daily drawdown limit
                if metrics.daily_pnl < -self.config.max_daily_drawdown {
                    return Err(RiskError::RiskLimitBreached(format!(
                        "Maximum daily drawdown ({:.2}%) reached",
                        self.config.max_daily_drawdown * 100.0
                    )));
                }
                
                // Check portfolio-wide exposure
                let portfolio_exposure = *self.portfolio_exposure.read().unwrap();
                if portfolio_exposure >= self.config.max_portfolio_allocation {
                    return Err(RiskError::RiskLimitBreached(format!(
                        "Maximum portfolio allocation ({:.2}%) reached",
                        self.config.max_portfolio_allocation * 100.0
                    )));
                }
                
                // Check consecutive losses if significant
                if metrics.consecutive_losses > 5 {
                    return Err(RiskError::RiskLimitBreached(format!(
                        "Strategy has {} consecutive losses, exceeding safety threshold",
                        metrics.consecutive_losses
                    )));
                }
                
                // Check if strategy is disabled
                if !metrics.enabled {
                    return Err(RiskError::StrategyDisabled(
                        "Strategy has been disabled due to risk constraints".to_string()
                    ));
                }
            }
        }
        
        // All checks passed
        Ok(())
    }
    
    async fn calculate_position_size(
        &self,
        signal: &Signal,
        market_data: &MarketData,
    ) -> Result<PositionSizing, RiskError> {
        let strategy_id = &signal.strategy_id;
        
        // Check if strategy is disabled
        let metrics_guard = self.metrics.read().await;
        if let Some(metrics) = metrics_guard.get(strategy_id) {
            if !metrics.enabled {
                return Err(RiskError::StrategyDisabled(format!(
                    "Strategy {} is currently disabled", strategy_id
                )));
            }
        }
        
        // Get risk profile for the strategy
        let risk_profiles = self.risk_profiles.lock().await;
        let risk_profile = risk_profiles.get(strategy_id).cloned().unwrap_or_default();
        
        // Base position size calculation (as percentage of capital)
        let base_size = risk_profile.position_size;
        
        // Adjustments based on various factors
        let mut adjustments = HashMap::new();
        
        // Risk grade adjustment - reduce size for higher risk signals
        let risk_grade_factor = match signal.risk_grade {
            RiskGrade::Low => 1.0,
            RiskGrade::Medium => 0.8,
            RiskGrade::High => 0.6,
            RiskGrade::Exceptional => 0.3,
        };
        adjustments.insert("risk_grade".to_string(), risk_grade_factor);
        
        // Signal strength adjustment - scale by signal's strength
        let strength_factor = signal.strength.clamp(0.1, 1.0);
        adjustments.insert("signal_strength".to_string(), strength_factor);
        
        // Apply trust score adjustment if enabled
        let (trust_factor, trust_score) = self.apply_trust_score_adjustment(strategy_id, base_size).await;
        if trust_factor < 1.0 {
            adjustments.insert("trust_score".to_string(), trust_factor);
        }
        
        // Volatility adjustment
        let volatility_factor = if self.config.volatility_adjustment {
            // Higher volatility = smaller position size
            let volatility = self.calculate_market_volatility(&market_data.ticker);
            let factor = (1.0 - volatility).max(0.3);
            adjustments.insert("volatility".to_string(), factor);
            factor
        } else {
            1.0
        };
        
        // Drawdown adjustment factor
        let drawdown_factor = self.get_drawdown_risk_modifier(strategy_id).await;
        if drawdown_factor < 1.0 {
            adjustments.insert("drawdown".to_string(), drawdown_factor);
        }
        
        // Calculate combined adjustment factor
        let risk_factor = risk_grade_factor * strength_factor * trust_factor * volatility_factor * drawdown_factor;
        
        // Calculate adjusted position size
        let risk_adjusted_size = base_size * risk_factor;
        
        // Ensure we don't exceed maximum allowed position size
        let max_size = self.config.max_position_size;
        let is_max_size = risk_adjusted_size > max_size;
        let final_size = risk_adjusted_size.min(max_size);
        
        // Create reason string based on adjustments
        let mut reason_parts = Vec::new();
        if risk_grade_factor < 1.0 {
            reason_parts.push(format!("risk grade ({})", signal.risk_grade));
        }
        if strength_factor < 1.0 {
            reason_parts.push(format!("signal strength ({:.2})", signal.strength));
        }
        if trust_factor < 1.0 {
            reason_parts.push(format!("trust score ({:.2})", trust_score.unwrap_or(0.0)));
        }
        if volatility_factor < 1.0 {
            reason_parts.push("market volatility".to_string());
        }
        if drawdown_factor < 1.0 {
            reason_parts.push("strategy drawdown".to_string());
        }
        
        let reason = if reason_parts.is_empty() {
            "Base risk profile".to_string()
        } else {
            format!("Adjusted for: {}", reason_parts.join(", "))
        };
        
        Ok(PositionSizing::with_adjustments(
            base_size,
            max_size,
            final_size,
            risk_factor,
            adjustments,
            reason,
        ))
    }
    
    async fn get_risk_metrics(&self, strategy_id: &StrategyId) -> Option<RiskMetrics> {
        let metrics_guard = self.metrics.read().unwrap();
        metrics_guard.get(strategy_id).cloned()
    }
    
    async fn update_metrics(&self, strategy_id: &StrategyId, performance: &StrategyPerformance) {
        let mut metrics_guard = self.metrics.write().unwrap();
        let metrics = metrics_guard.entry(strategy_id.clone()).or_insert_with(RiskMetrics::default);
        
        // Update trade counts and PnL
        metrics.total_trades += performance.completed_trades;
        metrics.profitable_trades += performance.profitable_trades;
        metrics.daily_pnl = performance.daily_pnl;
        
        // Calculate win rate
        if metrics.total_trades > 0 {
            metrics.win_rate = metrics.profitable_trades as f64 / metrics.total_trades as f64;
        }
        
        // Update drawdown
        if performance.daily_pnl < 0.0 && performance.daily_pnl.abs() > metrics.current_drawdown {
            metrics.current_drawdown = performance.daily_pnl.abs();
        }
        
        if metrics.current_drawdown > metrics.max_drawdown {
            metrics.max_drawdown = metrics.current_drawdown;
        }
        
        // Update max drawdown percentage
        metrics.max_drawdown_pct = performance.max_drawdown;
        
        // Update sharpe and profit factor if available
        metrics.sharpe_ratio = performance.sharpe;
        metrics.profit_factor = performance.profit_factor;
        
        // Update consecutive losses tracking
        if let Some(last_trade) = &performance.last_trade_result {
            if last_trade.profitable {
                metrics.consecutive_losses = 0;
            } else {
                metrics.consecutive_losses += 1;
            }
        }
        
        // Update position if a trade result is available
        if let Some(trade_result) = &performance.last_trade_result {
            let symbol = Symbol::from(trade_result.symbol.clone());
            let mut metrics_clone = metrics.clone();
            self.update_position(&mut metrics_clone, symbol, trade_result.position_change);
            *metrics = metrics_clone;
        }
        
        // Update trust score if available
        if let Some(trust_score) = performance.get_trust_score() {
            metrics.trust_score = Some(trust_score);
            
            // Also update the trust score cache
            let mut trust_scores = self.trust_scores.write().unwrap();
            trust_scores.insert(strategy_id.clone(), trust_score);
        }
        
        metrics.last_update = Utc::now();
        
        // Update portfolio-wide exposure
        let mut total_exposure = 0.0;
        for (_, metrics) in metrics_guard.iter() {
            total_exposure += metrics.current_exposure;
        }
        
        let mut portfolio_exposure = self.portfolio_exposure.write().unwrap();
        *portfolio_exposure = total_exposure;
    }
    
    async fn assess_market_risk(&self, market_data: &MarketData) -> MarketRiskAssessment {
        let volatility = self.analyze_volatility(market_data);
        let liquidity = self.analyze_liquidity(market_data);
        let market_trend = self.analyze_market_trend(market_data);
        
        // Calculate overall risk score (higher = riskier)
        let risk_score = (volatility * 0.5) + ((1.0 - liquidity) * 0.3) + (abs_deviation(market_trend, 0.5) * 0.2);
        
        // Calculate spread percentage if available
        let spread_pct = if let Some(ticker) = &market_data.ticker {
            if let (Some(bid), Some(ask)) = (ticker.bid, ticker.ask) {
                if bid > 0.0 {
                    Some((ask - bid) / bid)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        
        // Calculate order book depth if available
        let order_book_depth = if let Some(orderbook) = &market_data.orderbook {
            let bid_depth: f64 = orderbook.bids.iter().map(|(_, size)| size).sum();
            let ask_depth: f64 = orderbook.asks.iter().map(|(_, size)| size).sum();
            Some(bid_depth + ask_depth)
        } else {
            None
        };
        
        // Estimate market impact for a standard order
        let market_impact_estimate = if let Some(orderbook) = &market_data.orderbook {
            if !orderbook.bids.is_empty() && !orderbook.asks.is_empty() {
                // Simple market impact model - actual implementation would be more sophisticated
                let standard_order_size = 1.0; // Arbitrary unit of size
                let impact = estimate_market_impact(orderbook, standard_order_size);
                Some(impact)
            } else {
                None
            }
        } else {
            None
        };
        
        // Determine if market is suitable for trading
        let suitable_for_trading = 
            volatility <= self.config.max_volatility && 
            liquidity >= self.config.min_liquidity_score && 
            risk_score <= 0.7;
        
        // Generate recommendations
        let recommendations = self.generate_risk_recommendations(&MarketRiskAssessment {
            volatility,
            liquidity_score: liquidity,
            risk_score,
            market_trend,
            recommendations: Vec::new(),
            suitable_for_trading,
            timestamp: Utc::now(),
            spread_pct,
            order_book_depth,
            market_impact_estimate,
        });
        
        let assessment = MarketRiskAssessment {
            volatility,
            liquidity_score: liquidity,
            risk_score,
            market_trend,
            recommendations,
            suitable_for_trading,
            timestamp: Utc::now(),
            spread_pct,
            order_book_depth,
            market_impact_estimate,
        };
        
        // Store this assessment
        let symbol_str = market_data.symbol.to_string();
        let mut market_guard = self.market_assessments.write().unwrap();
        market_guard.insert(symbol_str, assessment.clone());
        
        assessment
    }
    
    async fn check_risk_limits(&self, strategy_id: &StrategyId) -> Result<(), RiskError> {
        // Skip checking exempt strategies
        if self.config.exempt_strategies.contains(strategy_id) {
            return Ok(());
        }
        
        let metrics_guard = self.metrics.read().unwrap();
        if let Some(metrics) = metrics_guard.get(strategy_id) {
            // Check if strategy is disabled
            if !metrics.enabled {
                return Err(RiskError::StrategyDisabled(
                    "Strategy is currently disabled".to_string()
                ));
            }
            
            // Check exposure limit
            if metrics.current_exposure > self.config.max_strategy_allocation {
                return Err(RiskError::RiskLimitBreached(format!(
                    "Strategy exposure ({:.2}%) exceeds maximum ({:.2}%)",
                    metrics.current_exposure * 100.0,
                    self.config.max_strategy_allocation * 100.0
                )));
            }
            
            // Check daily drawdown limit
            if metrics.daily_pnl < -self.config.max_daily_drawdown {
                return Err(RiskError::RiskLimitBreached(format!(
                    "Daily drawdown ({:.2}%) exceeds maximum ({:.2}%)",
                    -metrics.daily_pnl * 100.0,
                    self.config.max_daily_drawdown * 100.0
                )));
            }
            
            // Check trust score
            let trust_scores = self.trust_scores.read().unwrap();
            if let Some(trust_score) = trust_scores.get(strategy_id) {
                if *trust_score < self.config.min_trust_score {
                    return Err(RiskError::TrustScoreTooLow(format!(
                        "Trust score ({:.2}) below minimum threshold ({:.2})",
                        trust_score, self.config.min_trust_score
                    )));
                }
            }
            
            // Check win rate and performance for potential disabling
            if metrics.total_trades >= 10 {
                let win_rate = self.calculate_win_rate(metrics);
                if win_rate < 0.3 {
                    return Err(RiskError::StrategyDisabled(format!(
                        "Strategy disabled due to poor performance (win rate: {:.2})", 
                        win_rate
                    )));
                }
            }
            
            // Check consecutive losses
            if metrics.consecutive_losses > 5 {
                return Err(RiskError::RiskLimitBreached(format!(
                    "Strategy has {} consecutive losses, exceeding safety threshold",
                    metrics.consecutive_losses
                )));
            }
        }
        
        // All checks passed
        Ok(())
    }
    
    async fn register_strategy(&self, strategy_id: StrategyId) {
        // Get the risk profile from the strategy or use default
        let risk_profile = RiskProfile::default();
        
        let mut profiles_guard = self.risk_profiles.lock().unwrap();
        profiles_guard.insert(strategy_id.clone(), risk_profile);
        
        let mut metrics_guard = self.metrics.write().unwrap();
        metrics_guard.insert(strategy_id.clone(), RiskMetrics::default());
        
        // Initialize trust score
        let mut trust_scores = self.trust_scores.write().unwrap();
        trust_scores.insert(strategy_id, 0.7); // Default starting trust score
        
        debug!("Registered strategy for risk management");
    }
    
    async fn unregister_strategy(&self, strategy_id: &StrategyId) {
        let mut profiles_guard = self.risk_profiles.lock().unwrap();
        profiles_guard.remove(strategy_id);
        
        let mut metrics_guard = self.metrics.write().unwrap();
        metrics_guard.remove(strategy_id);
        
        let mut trust_scores = self.trust_scores.write().unwrap();
        trust_scores.remove(strategy_id);
        
        debug!("Unregistered strategy from risk management");
    }
    
    async fn analyze_signal_risk(&self, signal: &Signal, market_data: &MarketData) -> RiskAnalysis {
        self.create_risk_analysis(&signal.strategy_id, Some(market_data)).await
    }
    
    async fn get_strategy_risk_analysis(&self, strategy_id: &StrategyId) -> Option<RiskAnalysis> {
        Some(self.create_risk_analysis(strategy_id, None).await)
    }
    
    async fn update_trust_score(&self, strategy_id: &StrategyId, trust_score_engine: &dyn TrustScoreEngine) {
        // Fetch current trust score
        match trust_score_engine.get_trust_score(strategy_id).await {
            Ok(score) => {
                // Update cache
                let mut trust_scores = self.trust_scores.write().unwrap();
                trust_scores.insert(strategy_id.clone(), score);
                
                // Update metrics
                let mut metrics_guard = self.metrics.write().unwrap();
                if let Some(metrics) = metrics_guard.get_mut(strategy_id) {
                    metrics.trust_score = Some(score);
                    
                    // Update enabled status based on trust score
                    metrics.enabled = score >= self.config.min_trust_score;
                }
                
                debug!("Updated trust score for strategy {}: {:.4}", strategy_id, score);
            },
            Err(e) => {
                warn!("Failed to update trust score for strategy {}: {}", strategy_id, e);
            }
        }
    }
    
    fn get_config(&self) -> RiskManagerConfig {
        self.config.clone()
    }
    
    async fn update_config(&self, config: RiskManagerConfig) -> Result<(), RiskError> {
        // Validate configuration
        if config.max_strategy_allocation > 1.0 || config.max_strategy_allocation <= 0.0 {
            return Err(RiskError::InvalidConfig(
                "Max strategy allocation must be between 0.0 and 1.0".to_string()
            ));
        }
        
        if config.max_portfolio_allocation > 1.0 || config.max_portfolio_allocation <= 0.0 {
            return Err(RiskError::InvalidConfig(
                "Max portfolio allocation must be between 0.0 and 1.0".to_string()
            ));
        }
        
        if config.min_signal_confidence > 1.0 || config.min_signal_confidence < 0.0 {
            return Err(RiskError::InvalidConfig(
                "Minimum signal confidence must be between 0.0 and 1.0".to_string()
            ));
        }
        
        // Update configuration
        *((self as &DefaultRiskManager).config) = config;
        
        Ok(())
    }
    
    fn as_any(&self) -> &dyn Any where Self: 'static {
        self
    }
}

// Helper functions

/// Calculate absolute deviation from a reference value
fn abs_deviation(value: f64, reference: f64) -> f64 {
    (value - reference).abs()
}

/// Estimate market impact for an order of a given size
fn estimate_market_impact(orderbook: &OrderBook, order_size: f64) -> f64 {
    // Simple market impact model - more sophisticated models would account for
    // order book shape, market dynamics, etc.
    let total_depth: f64 = orderbook.bids.iter().chain(orderbook.asks.iter())
        .map(|(_, size)| size)
        .sum();
    
    if total_depth == 0.0 {
        return 0.01; // Default impact if no depth data
    }
    
    // Simple model: impact scales with order size relative to total depth
    (order_size / total_depth).min(0.05)
}

/// Factory for creating different types of risk managers
pub struct RiskManagerFactory;

impl RiskManagerFactory {
    /// Create a default risk manager
    pub fn create_default() -> Arc<dyn RiskManager> {
        Arc::new(DefaultRiskManager::default())
    }
    
    /// Create a custom risk manager with specified configuration
    pub fn create_custom(config: RiskManagerConfig) -> Arc<dyn RiskManager> {
        Arc::new(DefaultRiskManager::new(config))
    }
    
    /// Create a risk manager with drawdown tracking
    pub fn create_with_drawdown_tracker(
        config: RiskManagerConfig,
        drawdown_tracker: Arc<dyn DrawdownTracker>
    ) -> Arc<dyn RiskManager> {
        Arc::new(DefaultRiskManager::with_drawdown_tracker(config, drawdown_tracker))
    }
    
    /// Create a conservative risk manager with stringent risk controls
    pub fn create_conservative() -> Arc<dyn RiskManager> {
        let config = RiskManagerConfig {
            max_strategy_allocation: 0.15,
            max_daily_drawdown: 0.03,
            max_position_size: 0.05,
            enforce_risk_limits: true,
            min_signal_confidence: 0.75,
            min_trust_score: 0.7,
            max_volatility: 0.6,
            max_concurrent_trades: 3,
            volatility_adjustment: true,
            trust_score_adjustment: true,
            max_portfolio_allocation: 0.5,
            min_liquidity_score: 0.5,
            exempt_strategies: HashSet::new(),
        };
        
        Self::create_custom(config)
    }
    
    /// Create an aggressive risk manager with relaxed risk controls
    pub fn create_aggressive() -> Arc<dyn RiskManager> {
        let config = RiskManagerConfig {
            max_strategy_allocation: 0.40,
            max_daily_drawdown: 0.08,
            max_position_size: 0.15,
            enforce_risk_limits: true,
            min_signal_confidence: 0.5,
            min_trust_score: 0.4,
            max_volatility: 0.9,
            max_concurrent_trades: 8,
            volatility_adjustment: true,
            trust_score_adjustment: true,
            max_portfolio_allocation: 0.9,
            min_liquidity_score: 0.2,
            exempt_strategies: HashSet::new(),
        };
        
        Self::create_custom(config)
    }
    
    /// Create a risk manager for backtesting (minimal restrictions)
    pub fn create_for_backtesting() -> Arc<dyn RiskManager> {
        let config = RiskManagerConfig {
            max_strategy_allocation: 1.0,
            max_daily_drawdown: 1.0,
            max_position_size: 1.0,
            enforce_risk_limits: false,
            min_signal_confidence: 0.0,
            min_trust_score: 0.0,
            max_volatility: 1.0,
            max_concurrent_trades: 100,
            volatility_adjustment: false,
            trust_score_adjustment: false,
            max_portfolio_allocation: 1.0,
            min_liquidity_score: 0.0,
            exempt_strategies: HashSet::new(),
        };
        
        Self::create_custom(config)
    }
}

/// Mock risk manager for testing
pub struct MockRiskManager {
    /// Whether signals should be validated (pass or fail)
    should_validate: bool,
    
    /// Fixed position size to return
    position_size: f64,
    
    /// Configuration
    config: RiskManagerConfig,
    
    /// Mock metrics for strategies
    metrics: Arc<RwLock<HashMap<StrategyId, RiskMetrics>>>,
    
    /// Mock market assessments
    market_assessments: Arc<RwLock<HashMap<Symbol, MarketRiskAssessment>>>,
}

impl MockRiskManager {
    /// Create a new mock risk manager
    pub fn new(should_validate: bool, position_size: f64) -> Self {
        Self {
            should_validate,
            position_size,
            config: RiskManagerConfig::default(),
            metrics: Arc::new(RwLock::new(HashMap::new())),
            market_assessments: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Create a mock risk manager that always validates
    pub fn always_valid() -> Self {
        Self::new(true, 0.1)
    }
    
    /// Create a mock risk manager that always rejects
    pub fn always_reject() -> Self {
        Self::new(false, 0.1)
    }
    
    /// Add mock metrics for a strategy
    pub fn add_mock_metrics(&self, strategy_id: &str, metrics: RiskMetrics) {
        let mut metrics_guard = self.metrics.write().unwrap();
        metrics_guard.insert(strategy_id.to_string(), metrics);
    }
    
    /// Add mock market assessment
    pub fn add_mock_assessment(&self, symbol: Symbol, assessment: MarketRiskAssessment) {
        let mut assessments_guard = self.market_assessments.write().unwrap();
        assessments_guard.insert(symbol, assessment);
    }
}

#[async_trait]
impl RiskManager for MockRiskManager {
    async fn validate_signal(&self, _signal: &Signal, _market_data: &MarketData) -> Result<(), RiskError> {
        if self.should_validate {
            Ok(())
        } else {
            Err(RiskError::SignalRejected("Mock rejection".to_string()))
        }
    }
    
    async fn calculate_position_size(
        &self,
        _signal: &Signal,
        _market_data: &MarketData,
    ) -> Result<PositionSizing, RiskError> {
        Ok(PositionSizing::new(
            self.position_size,
            self.position_size,
            self.position_size,
            1.0
        ))
    }
    
    async fn get_risk_metrics(&self, strategy_id: &StrategyId) -> Option<RiskMetrics> {
        let metrics_guard = self.metrics.read().unwrap();
        metrics_guard.get(strategy_id).cloned().or_else(|| Some(RiskMetrics::default()))
    }
    
    async fn update_metrics(&self, strategy_id: &StrategyId, _performance: &StrategyPerformance) {
        // In mock, just create default metrics if they don't exist
        let mut metrics_guard = self.metrics.write().unwrap();
        metrics_guard.entry(strategy_id.clone()).or_insert_with(RiskMetrics::default);
    }
    
    async fn assess_market_risk(&self, market_data: &MarketData) -> MarketRiskAssessment {
        let assessments_guard = self.market_assessments.read().unwrap();
        
        // Return mock assessment if available for this symbol
        if let Some(assessment) = assessments_guard.get(&market_data.symbol) {
            return assessment.clone();
        }
        
        // Otherwise return default assessment
        MarketRiskAssessment {
            volatility: 0.5,
            liquidity_score: 0.7,
            risk_score: 0.3,
            market_trend: 0.5,
            recommendations: vec!["Mock recommendation".to_string()],
            suitable_for_trading: true,
            timestamp: Utc::now(),
            spread_pct: Some(0.001),
            order_book_depth: Some(1000.0),
            market_impact_estimate: Some(0.001),
        }
    }
    
    async fn check_risk_limits(&self, _strategy_id: &StrategyId) -> Result<(), RiskError> {
        if self.should_validate {
            Ok(())
        } else {
            Err(RiskError::RiskLimitBreached("Mock limit breach".to_string()))
        }
    }
    
    async fn register_strategy(&self, strategy_id: StrategyId) {
        let mut metrics_guard = self.metrics.write().unwrap();
        metrics_guard.insert(strategy_id, RiskMetrics::default());
    }
    
    async fn unregister_strategy(&self, strategy_id: &StrategyId) {
        let mut metrics_guard = self.metrics.write().unwrap();
        metrics_guard.remove(strategy_id);
    }
    
    async fn analyze_signal_risk(&self, _signal: &Signal, _market_data: &MarketData) -> RiskAnalysis {
        RiskAnalysis {
            risk_score: 0.3,
            timestamp: Utc::now(),
            risk_factors: {
                let mut factors = HashMap::new();
                factors.insert("mock_factor".to_string(), 0.3);
                factors
            },
            recommendations: vec!["Mock risk analysis recommendation".to_string()],
            market_data: None,
            trust_state: Some(StrategyTrustState::Active),
            current_exposure: 0.1,
            max_exposure: 0.25,
            performance_metrics: None,
        }
    }
    
    async fn get_strategy_risk_analysis(&self, _strategy_id: &StrategyId) -> Option<RiskAnalysis> {
        Some(RiskAnalysis {
            risk_score: 0.3,
            timestamp: Utc::now(),
            risk_factors: {
                let mut factors = HashMap::new();
                factors.insert("mock_factor".to_string(), 0.3);
                factors
            },
            recommendations: vec!["Mock risk analysis recommendation".to_string()],
            market_data: None,
            trust_state: Some(StrategyTrustState::Active),
            current_exposure: 0.1,
            max_exposure: 0.25,
            performance_metrics: None,
        })
    }
    
    async fn update_trust_score(&self, _strategy_id: &StrategyId, _trust_score_engine: &dyn TrustScoreEngine) {
        // No-op for mock
    }
    
    fn get_config(&self) -> RiskManagerConfig {
        self.config.clone()
    }
    
    async fn update_config(&self, config: RiskManagerConfig) -> Result<(), RiskError> {
        *((self as &MockRiskManager).config) = config;
        Ok(())
    }
    
    fn as_any(&self) -> &dyn Any where Self: 'static {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    
    fn create_test_signal(confidence: f64, action: SignalAction, direction: PositionDirection) -> Signal {
        Signal {
            id: "test-signal".to_string(),
            strategy_id: "test-strategy".to_string(),
            timestamp: Utc::now(),
            symbol: Symbol::from("BTC/USD"),
            action,
            direction,
            confidence,
            strength: 0.7,
            price: Some(50000.0),
            quantity: None,
            expiration: None,
            metadata: None,
            status: crate::strategy::SignalStatus::Created,
            execution_result: None,
            trust_vector: None,
            system_code: None,
            risk_grade: crate::strategy::RiskGrade::Low,
            execution_horizon: crate::strategy::ExecutionHorizon::Immediate,
            expected_slippage_pct: None,
            fill_confidence: None,
        }
    }
    
    fn create_test_market_data() -> MarketData {
        MarketData {
            symbol: Symbol::from("BTC/USD"),
            timestamp: Utc::now(),
            ticker: Some(Ticker {
                price: 50000.0,
                high: Some(51000.0),
                low: Some(49000.0),
                volume: Some(100.0),
                bid: Some(49900.0),
                ask: Some(50100.0),
                open: Some(49500.0),
                close: None,
            }),
            orderbook: Some(OrderBook {
                bids: vec![(49900.0, 1.0), (49800.0, 2.0)],
                asks: vec![(50100.0, 1.0), (50200.0, 2.0)],
                timestamp: Utc::now(),
            }),
            indicators: None,
            sentiment: None,
        }
    }
    
    fn create_test_performance() -> StrategyPerformance {
        use crate::strategy::{SignalMetrics, ExecutionQualityMetrics};
        
        StrategyPerformance {
            strategy_id: "test-strategy".to_string(),
            timestamp: Utc::now(),
            daily_pnl: 0.05,
            total_pnl: 0.10,
            completed_trades: 5,
            profitable_trades: 3,
            last_trade_result: None,
            signals_generated: 10,
            signals_executed: 8,
            signals_rejected: 2,
            successful_trades: 3,
            unsuccessful_trades: 2,
            pnl: 0.10,
            roi: 0.08,
            sharpe: Some(1.2),
            sortino: Some(1.3),
            max_drawdown: 0.02,
            win_rate: 0.6,
            avg_profit_per_trade: 0.05,
            avg_loss_per_trade: -0.03,
            profit_factor: 1.5,
            avg_execution_latency_ms: None,
            avg_slippage_pct: None,
            trust_history: VecDeque::new(),
            window_start: None,
            window_end: None,
            execution_quality: ExecutionQualityMetrics::default(),
            signal_metrics: SignalMetrics::default(),
        }
    }
    
    #[tokio::test]
    async fn test_position_sizing() {
        let risk_manager = DefaultRiskManager::default();
        let signal = create_test_signal(0.8, SignalAction::Enter, PositionDirection::Long);
        let market_data = create_test_market_data();
        
        let sizing = risk_manager.calculate_position_size(&signal, &market_data).await.unwrap();
        assert!(sizing.risk_adjusted_size <= sizing.max_size);
        assert!(sizing.risk_adjusted_size > 0.0);
        assert!(!sizing.adjustments.is_empty());
    }
    
    #[tokio::test]
    async fn test_validate_signal_low_confidence() {
        let risk_manager = DefaultRiskManager::default();
        let signal = create_test_signal(0.4, SignalAction::Enter, PositionDirection::Long);
        let market_data = create_test_market_data();
        
        let result = risk_manager.validate_signal(&signal, &market_data).await;
        assert!(result.is_err());
        
        if let Err(RiskError::SignalRejected(_)) = result {
            // Expected error
        } else {
            panic!("Expected SignalRejected error");
        }
    }
    
    #[tokio::test]
    async fn test_validate_signal_success() {
        let risk_manager = DefaultRiskManager::default();
        let signal = create_test_signal(0.8, SignalAction::Enter, PositionDirection::Long);
        let market_data = create_test_market_data();
        
        // First, register the strategy
        risk_manager.register_strategy("test-strategy".to_string()).await;
        
        let result = risk_manager.validate_signal(&signal, &market_data).await;
        assert!(result.is_ok());
    }
    
    #[tokio::test]
    async fn test_market_risk_assessment() {
        let risk_manager = DefaultRiskManager::default();
        let market_data = create_test_market_data();
        
        let assessment = risk_manager.assess_market_risk(&market_data).await;
        assert!(assessment.volatility >= 0.0 && assessment.volatility <= 1.0);
        assert!(assessment.liquidity_score >= 0.0 && assessment.liquidity_score <= 1.0);
        assert!(assessment.risk_score >= 0.0 && assessment.risk_score <= 1.0);
        assert!(assessment.market_trend >= 0.0 && assessment.market_trend <= 1.0);
        assert!(!assessment.recommendations.is_empty());
    }
    
    #[tokio::test]
    async fn test_risk_metrics() {
        let risk_manager = DefaultRiskManager::default();
        let strategy_id = "test-strategy".to_string();
        
        // Register strategy first
        risk_manager.register_strategy(strategy_id.clone()).await;
        
        // Check initial metrics
        let metrics = risk_manager.get_risk_metrics(&strategy_id).await;
        assert!(metrics.is_some());
        
        // Create some performance data and update
        let performance = create_test_performance();
        
        risk_manager.update_metrics(&strategy_id, &performance).await;
        
        // Check updated metrics
        let updated_metrics = risk_manager.get_risk_metrics(&strategy_id).await.unwrap();
        assert_eq!(updated_metrics.total_trades, 5);
        assert_eq!(updated_metrics.profitable_trades, 3);
        assert_eq!(updated_metrics.daily_pnl, 0.05);
        assert_eq!(updated_metrics.win_rate, 0.6);
        assert!(updated_metrics.sharpe_ratio.is_some());
    }
    
    #[tokio::test]
    async fn test_check_risk_limits() {
        let risk_manager = DefaultRiskManager::default();
        let strategy_id = "test-strategy".to_string();
        
        // Register strategy first
        risk_manager.register_strategy(strategy_id.clone()).await;
        
        // Check limits with default metrics
        let result = risk_manager.check_risk_limits(&strategy_id).await;
        assert!(result.is_ok());
        
        // Create metrics that breach limits
        let mut metrics = RiskMetrics::default();
        metrics.current_exposure = 0.5;  // Higher than default max_strategy_allocation
        metrics.daily_pnl = -0.1;        // More negative than default max_daily_drawdown
        
        // Update metrics manually for testing
        {
            let mut metrics_guard = risk_manager.metrics.write().unwrap();
            metrics_guard.insert(strategy_id.clone(), metrics);
        }
        
        // Check limits again, should fail
        let result = risk_manager.check_risk_limits(&strategy_id).await;
        assert!(result.is_err());
        
        match result {
            Err(RiskError::RiskLimitBreached(_)) => (),
            _ => panic!("Expected RiskLimitBreached error"),
        }
    }
    
    #[tokio::test]
    async fn test_trust_score_adjustment() {
        let risk_manager = DefaultRiskManager::default();
        let strategy_id = "test-strategy".to_string();
        
        // Register strategy first
        risk_manager.register_strategy(strategy_id.clone()).await;
        
        // Set a custom trust score
        {
            let mut trust_scores = risk_manager.trust_scores.write().unwrap();
            trust_scores.insert(strategy_id.clone(), 0.6);
        }
        
        // Create signal and market data
        let signal = create_test_signal(0.8, SignalAction::Enter, PositionDirection::Long);
        let market_data = create_test_market_data();
        
        // Calculate position size
        let sizing = risk_manager.calculate_position_size(&signal, &market_data).await.unwrap();
        
        // Verify trust score adjustment is applied
        assert!(sizing.adjustments.contains_key("Trust Score"));
        
        // Lower trust score significantly
        {
            let mut trust_scores = risk_manager.trust_scores.write().unwrap();
            trust_scores.insert(strategy_id.clone(), 0.2);
        }
        
        // Try to validate signal
        let result = risk_manager.validate_signal(&signal, &market_data).await;
        assert!(result.is_err());
        
        match result {
            Err(RiskError::TrustScoreTooLow(_)) => (),
            _ => panic!("Expected TrustScoreTooLow error"),
        }
    }
    
    #[tokio::test]
    async fn test_signal_risk_analysis() {
        let risk_manager = DefaultRiskManager::default();
        let strategy_id = "test-strategy".to_string();
        
        // Register strategy first
        risk_manager.register_strategy(strategy_id.clone()).await;
        
        // Create signal and market data
        let signal = create_test_signal(0.8, SignalAction::Enter, PositionDirection::Long);
        let market_data = create_test_market_data();
        
        // Get risk analysis
        let analysis = risk_manager.analyze_signal_risk(&signal, &market_data).await;
        
        // Verify analysis contains expected components
        assert!(analysis.risk_score >= 0.0 && analysis.risk_score <= 1.0);
        assert!(!analysis.risk_factors.is_empty());
        assert!(!analysis.recommendations.is_empty());
        assert!(analysis.market_data.is_some());
    }
    
    #[tokio::test]
    async fn test_mock_risk_manager() {
        // Create a mock manager that always validates
        let mock_manager = MockRiskManager::always_valid();
        
        // Create signal and market data
        let signal = create_test_signal(0.8, SignalAction::Enter, PositionDirection::Long);
        let market_data = create_test_market_data();
        
        // Test validation
        let result = mock_manager.validate_signal(&signal, &market_data).await;
        assert!(result.is_ok());
        
        // Test position sizing
        let sizing = mock_manager.calculate_position_size(&signal, &market_data).await.unwrap();
        assert_eq!(sizing.risk_adjusted_size, 0.1);
        
        // Create a mock manager that always rejects
        let mock_manager = MockRiskManager::always_reject();
        
        // Test validation
        let result = mock_manager.validate_signal(&signal, &market_data).await;
        assert!(result.is_err());
        
        // Test custom metrics
        let mut custom_metrics = RiskMetrics::default();
        custom_metrics.current_exposure = 0.5;
        custom_metrics.win_rate = 0.75;
        
        mock_manager.add_mock_metrics("test-strategy", custom_metrics.clone());
        
        let metrics = mock_manager.get_risk_metrics(&"test-strategy".to_string()).await.unwrap();
        assert_eq!(metrics.current_exposure, 0.5);
        assert_eq!(metrics.win_rate, 0.75);
    }
    
    #[tokio::test]
    async fn test_factory_methods() {
        // Test default factory
        let default_manager = RiskManagerFactory::create_default();
        let config = default_manager.get_config();
        assert_eq!(config.max_strategy_allocation, 0.25);
        
        // Test conservative factory
        let conservative_manager = RiskManagerFactory::create_conservative();
        let config = conservative_manager.get_config();
        assert_eq!(config.max_strategy_allocation, 0.15);
        assert_eq!(config.min_signal_confidence, 0.75);
        
        // Test aggressive factory
        let aggressive_manager = RiskManagerFactory::create_aggressive();
        let config = aggressive_manager.get_config();
        assert_eq!(config.max_strategy_allocation, 0.40);
        assert_eq!(config.min_signal_confidence, 0.5);
    }
} 