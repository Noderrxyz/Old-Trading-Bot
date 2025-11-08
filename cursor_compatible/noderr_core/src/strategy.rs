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

//! Strategy definitions and signal structures for the Noderr Protocol.
//! This module defines the core interface for all strategy implementations,
//! along with the signal lifecycle, trust states, and performance metadata.

use std::collections::HashMap;
use std::fmt;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use thiserror::Error;

use crate::execution::{ExecutionResult, ExecutionStatus};
use crate::market::{MarketData, Symbol};
use crate::risk::PositionDirection;

/// Type alias for strategy ID
pub type StrategyId = String;

/// Type alias for signal ID
pub type SignalId = String;

/// Represents a buy/sell action for a signal
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SignalAction {
    /// Enter a position (buy or long entry)
    Enter,
    
    /// Exit a position (sell or long exit)
    Exit,
    
    /// Do nothing, just hold current positions
    Hold,
}

impl SignalAction {
    /// Returns true if this is an entry action
    pub fn is_entry(&self) -> bool {
        matches!(self, SignalAction::Enter)
    }

    /// Returns true if this is an exit action
    pub fn is_exit(&self) -> bool {
        matches!(self, SignalAction::Exit)
    }

    /// Returns a human-readable description of the action
    pub fn description(&self) -> &str {
        match self {
            SignalAction::Enter => "Enter",
            SignalAction::Exit => "Exit",
            SignalAction::Hold => "Hold",
        }
    }
}

/// Signal status for telemetry and lifecycle tracking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SignalStatus {
    /// Signal has been created but not yet validated
    Created,
    
    /// Signal has been validated by risk checks
    Validated,
    
    /// Signal has been rejected (by risk or other validation)
    Rejected,
    
    /// Signal has been successfully executed
    Executed,
    
    /// Signal execution has failed
    Failed,
    
    /// Signal is currently being processed
    InProgress,
    
    /// Signal has expired
    Expired,
    
    /// Signal is ready for transaction processing (SIG-TXN-READY)
    ReadyForExecution,
    
    /// Signal is blocked by trust engine (SIG-TRUST-BLOCK)
    TrustBlocked,
    
    /// Signal is waiting for better market conditions
    AwaitingMarketConditions,
}

impl Default for SignalStatus {
    fn default() -> Self {
        Self::Created
    }
}

impl SignalStatus {
    /// Get the system code representing this status for telemetry
    pub fn to_system_code(&self) -> &'static str {
        match self {
            Self::Created => "SIG-CREATED",
            Self::Validated => "SIG-VALIDATED",
            Self::Rejected => "SIG-REJECTED",
            Self::Executed => "SIG-EXECUTED",
            Self::Failed => "SIG-FAILED",
            Self::InProgress => "SIG-IN-PROGRESS",
            Self::Expired => "SIG-EXPIRED",
            Self::ReadyForExecution => "SIG-TXN-READY",
            Self::TrustBlocked => "SIG-TRUST-BLOCK",
            Self::AwaitingMarketConditions => "SIG-AWAIT-MARKET",
        }
    }
}

impl fmt::Display for SignalStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Created => write!(f, "Created"),
            Self::Validated => write!(f, "Validated"),
            Self::Rejected => write!(f, "Rejected"),
            Self::Executed => write!(f, "Executed"),
            Self::Failed => write!(f, "Failed"),
            Self::InProgress => write!(f, "InProgress"),
            Self::Expired => write!(f, "Expired"),
            Self::ReadyForExecution => write!(f, "ReadyForExecution"),
            Self::TrustBlocked => write!(f, "TrustBlocked"),
            Self::AwaitingMarketConditions => write!(f, "AwaitingMarketConditions"),
        }
    }
}

/// Represents error conditions that may occur with signals
#[derive(Debug, Error, Clone)]
pub enum SignalError {
    #[error("Signal has expired")]
    Expired,
    
    #[error("Invalid signal parameters: {0}")]
    InvalidParameters(String),
    
    #[error("Signal rejected by risk manager: {0}")]
    RiskRejected(String),
    
    #[error("Execution error: {0}")]
    ExecutionError(String),
    
    #[error("Trust check failed: {0}")]
    TrustCheckFailed(String),
    
    #[error("Strategy downgraded: {0}")]
    StrategyDowngraded(String),
    
    #[error("Market conditions unsuitable: {0}")]
    UnsuitableMarketConditions(String),
    
    #[error("Latency budget exceeded: {execution_time_ms}ms > {budget_ms}ms")]
    LatencyBudgetExceeded { execution_time_ms: u64, budget_ms: u64 },
}

impl SignalError {
    /// Get the system code representing this error for telemetry
    pub fn to_system_code(&self) -> &'static str {
        match self {
            Self::Expired => "SIG-ERROR-EXPIRED",
            Self::InvalidParameters(_) => "SIG-ERROR-PARAMS",
            Self::RiskRejected(_) => "SIG-RISK-REJECT",
            Self::ExecutionError(_) => "SIG-EXEC-ERROR",
            Self::TrustCheckFailed(_) => "SIG-TRUST-FAIL",
            Self::StrategyDowngraded(_) => "STRAT-DOWNGRADED",
            Self::UnsuitableMarketConditions(_) => "SIG-MARKET-UNSUITABLE",
            Self::LatencyBudgetExceeded { .. } => "SIG-LATENCY-EXCEEDED",
        }
    }
}

/// Risk grade for a signal, indicating potential impact and required scrutiny
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskGrade {
    /// Minimal risk, standard position size
    Low,
    /// Moderate risk, may require additional validation
    Medium,
    /// High risk, requires strict validation and possibly reduced position size
    High,
    /// Exceptional risk, requires manual approval
    Exceptional,
}

impl Default for RiskGrade {
    fn default() -> Self {
        Self::Medium
    }
}

impl fmt::Display for RiskGrade {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Low => write!(f, "Low"),
            Self::Medium => write!(f, "Medium"),
            Self::High => write!(f, "High"),
            Self::Exceptional => write!(f, "Exceptional"),
        }
    }
}

/// Execution horizon for a signal, indicating expected timeframe
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionHorizon {
    /// Immediate execution required (seconds)
    Immediate,
    /// Short-term execution (minutes)
    ShortTerm,
    /// Medium-term execution (hours)
    MediumTerm,
    /// Long-term execution (days)
    LongTerm,
}

impl Default for ExecutionHorizon {
    fn default() -> Self {
        Self::ShortTerm
    }
}

impl ExecutionHorizon {
    /// Get the suggested latency budget in milliseconds
    pub fn latency_budget_ms(&self) -> u64 {
        match self {
            Self::Immediate => 100,   // 100ms
            Self::ShortTerm => 500,   // 500ms
            Self::MediumTerm => 2000, // 2 seconds
            Self::LongTerm => 5000,   // 5 seconds
        }
    }
    
    /// Get the maximum execution window in seconds
    pub fn max_execution_window_secs(&self) -> u64 {
        match self {
            Self::Immediate => 5,      // 5 seconds
            Self::ShortTerm => 300,    // 5 minutes
            Self::MediumTerm => 3600,  // 1 hour
            Self::LongTerm => 86400,   // 24 hours
        }
    }
}

/// Represents a signal generated by a strategy, to be validated and executed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    /// Unique identifier for this signal
    pub id: String,
    
    /// ID of the strategy that generated this signal
    pub strategy_id: StrategyId,
    
    /// Trading pair or instrument symbol (e.g., "BTC/USD")
    pub symbol: Symbol,
    
    /// Action to take (enter, exit, hold)
    pub action: SignalAction,
    
    /// Direction of the position (long/short)
    pub direction: PositionDirection,
    
    /// Confidence level of the signal (0.0 - 1.0)
    pub confidence: f64,
    
    /// Relative strength of the signal (0.0 - 1.0) for position sizing
    pub strength: f64,
    
    /// Optional reference price for execution
    pub price: Option<f64>,
    
    /// Optional quantity to trade
    pub quantity: Option<f64>,
    
    /// Timestamp when the signal was generated
    pub timestamp: DateTime<Utc>,
    
    /// Optional expiration time
    pub expiration: Option<DateTime<Utc>>,
    
    /// Additional metadata and context tags
    #[serde(default)]
    pub metadata: Option<HashMap<String, String>>,
    
    /// Current status in the signal lifecycle
    #[serde(default)]
    pub status: SignalStatus,
    
    /// Associated execution result if available
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_result: Option<ExecutionResult>,
    
    /// Trust vector with trust metrics from various subsystems
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust_vector: Option<HashMap<String, f64>>,
    
    /// System code for telemetry linkage
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_code: Option<String>,
    
    /// Risk grade of the signal
    #[serde(default)]
    pub risk_grade: RiskGrade,
    
    /// Execution horizon for this signal
    #[serde(default)]
    pub execution_horizon: ExecutionHorizon,
    
    /// Expected slippage percentage
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_slippage_pct: Option<f64>,
    
    /// Fill confidence (0.0 - 1.0)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_confidence: Option<f64>,
}

impl Signal {
    /// Create a new signal with default values
    pub fn new(strategy_id: StrategyId, symbol: Symbol, action: SignalAction) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            strategy_id,
            symbol,
            action,
            direction: PositionDirection::Long,
            confidence: 0.5,
            strength: 0.5,
            price: None,
            quantity: None,
            timestamp: Utc::now(),
            expiration: Some(Utc::now() + chrono::Duration::seconds(3600)), // 1 hour default
            metadata: None,
            status: SignalStatus::Created,
            execution_result: None,
            trust_vector: None,
            system_code: None,
            risk_grade: RiskGrade::default(),
            execution_horizon: ExecutionHorizon::default(),
            expected_slippage_pct: None,
            fill_confidence: None,
        }
    }

    /// Returns true if this is an entry signal
    pub fn is_entry(&self) -> bool {
        self.action.is_entry()
    }

    /// Returns true if this is an exit signal
    pub fn is_exit(&self) -> bool {
        self.action.is_exit()
    }

    /// Returns true if this signal has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expiry) = self.expiration {
            Utc::now() > expiry
        } else {
            false
        }
    }

    /// Returns true if this signal is still valid for processing
    pub fn is_valid(&self) -> bool {
        !self.is_expired()
    }

    /// Provides a tag for telemetry and trust scoring
    pub fn trust_tag(&self) -> String {
        format!("signal:{}", self.id)
    }
    
    /// Add metadata to the signal
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        let metadata = self.metadata.get_or_insert_with(HashMap::new);
        metadata.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Set confidence level
    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = confidence;
        self
    }
    
    /// Set signal strength for position sizing
    pub fn with_strength(mut self, strength: f64) -> Self {
        self.strength = strength;
        self
    }
    
    /// Set direction
    pub fn with_direction(mut self, direction: PositionDirection) -> Self {
        self.direction = direction;
        self
    }
    
    /// Set quantity
    pub fn with_quantity(mut self, quantity: f64) -> Self {
        self.quantity = Some(quantity);
        self
    }
    
    /// Set price
    pub fn with_price(mut self, price: f64) -> Self {
        self.price = Some(price);
        self
    }
    
    /// Set expiration
    pub fn with_expiration(mut self, expiration: DateTime<Utc>) -> Self {
        self.expiration = Some(expiration);
        self
    }
    
    /// Mark signal as validated
    pub fn mark_validated(mut self) -> Self {
        self.status = SignalStatus::Validated;
        self.system_code = Some(self.status.to_system_code().to_string());
        self
    }
    
    /// Mark signal as rejected
    pub fn mark_rejected(mut self, reason: Option<&str>) -> Self {
        self.status = SignalStatus::Rejected;
        self.system_code = Some(self.status.to_system_code().to_string());
        if let Some(reason) = reason {
            self.with_metadata("rejection_reason", reason);
        }
        self
    }
    
    /// Mark signal as in progress
    pub fn mark_in_progress(mut self) -> Self {
        self.status = SignalStatus::InProgress;
        self.system_code = Some(self.status.to_system_code().to_string());
        self
    }
    
    /// Mark signal as ready for execution
    pub fn mark_ready_for_execution(mut self) -> Self {
        self.status = SignalStatus::ReadyForExecution;
        self.system_code = Some(self.status.to_system_code().to_string());
        self
    }
    
    /// Mark signal as trust blocked
    pub fn mark_trust_blocked(mut self, reason: &str) -> Self {
        self.status = SignalStatus::TrustBlocked;
        self.system_code = Some(self.status.to_system_code().to_string());
        self.with_metadata("trust_block_reason", reason)
    }
    
    /// Mark signal as awaiting better market conditions
    pub fn mark_awaiting_market(mut self, reason: &str) -> Self {
        self.status = SignalStatus::AwaitingMarketConditions;
        self.system_code = Some(self.status.to_system_code().to_string());
        self.with_metadata("market_wait_reason", reason)
    }
    
    /// Attach execution result and update status
    pub fn with_execution(mut self, result: ExecutionResult) -> Self {
        self.execution_result = Some(result.clone());
        self.status = match result.status {
            ExecutionStatus::Completed => SignalStatus::Executed,
            ExecutionStatus::Rejected => SignalStatus::Rejected,
            ExecutionStatus::Failed => SignalStatus::Failed,
            _ => SignalStatus::InProgress,
        };
        self.system_code = Some(self.status.to_system_code().to_string());
        self
    }
    
    /// Add trust vector data
    pub fn with_trust_vector(mut self, trust_vector: HashMap<String, f64>) -> Self {
        self.trust_vector = Some(trust_vector);
        self
    }
    
    /// Add trust score from a specific system
    pub fn with_trust_score(mut self, system: &str, score: f64) -> Self {
        let trust_vector = self.trust_vector.get_or_insert_with(HashMap::new);
        trust_vector.insert(system.to_string(), score);
        self
    }
    
    /// Set risk grade
    pub fn with_risk_grade(mut self, grade: RiskGrade) -> Self {
        self.risk_grade = grade;
        self
    }
    
    /// Set execution horizon
    pub fn with_execution_horizon(mut self, horizon: ExecutionHorizon) -> Self {
        self.execution_horizon = horizon;
        self
    }
    
    /// Set expected slippage percentage
    pub fn with_expected_slippage(mut self, slippage_pct: f64) -> Self {
        self.expected_slippage_pct = Some(slippage_pct);
        self
    }
    
    /// Set fill confidence
    pub fn with_fill_confidence(mut self, confidence: f64) -> Self {
        self.fill_confidence = Some(confidence);
        self
    }
    
    /// Get the latency budget in milliseconds based on execution horizon
    pub fn latency_budget_ms(&self) -> u64 {
        if let Some(meta) = &self.metadata {
            if let Some(budget_str) = meta.get("expected_latency_ms") {
                if let Ok(budget) = budget_str.parse::<u64>() {
                    return budget;
                }
            }
        }
        
        self.execution_horizon.latency_budget_ms()
    }
    
    /// Get the risk grade for the signal
    pub fn risk_grade(&self) -> RiskGrade {
        self.risk_grade
    }
    
    /// Check if the signal is sensitive to latency
    pub fn is_latency_sensitive(&self) -> bool {
        matches!(self.execution_horizon, ExecutionHorizon::Immediate | ExecutionHorizon::ShortTerm) ||
            self.metadata.as_ref().map_or(false, |m| m.get("latency_sensitive").map_or(false, |v| v == "true"))
    }
    
    /// Validate basic signal parameters
    pub fn validate(&self) -> Result<(), SignalError> {
        // Check if signal has expired
        if self.is_expired() {
            return Err(SignalError::Expired);
        }
        
        // Entry signals should have appropriate data
        if self.is_entry() && self.price.is_none() && self.metadata.as_ref().map_or(true, |m| !m.contains_key("market_order")) {
            return Err(SignalError::InvalidParameters(
                "Entry signals must specify a price or be marked as market orders".to_string()
            ));
        }
        
        Ok(())
    }
}

/// Represents a strategy's configured risk profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskProfile {
    /// Position size as a fraction of portfolio (e.g., 0.05 = 5%)
    pub position_size: f64,
    
    /// Whether this strategy requires stop losses
    pub use_stop_loss: bool,
    
    /// Maximum allowed slippage as a fraction
    pub max_slippage: f64,
    
    /// Aversion to volatility (0.0 = aggressive, 1.0 = very conservative)
    pub volatility_aversion: f64,
    
    /// Maximum drawdown before disabling the strategy (as a fraction)
    pub max_drawdown: f64,
    
    /// Maximum number of consecutive losses before reducing risk
    pub max_consecutive_losses: u32,
    
    /// Time window for evaluating strategy performance (in seconds)
    pub evaluation_window_seconds: u64,
    
    /// Factor to scale position sizing (0.0 - 1.0, used during recovery)
    pub position_sizing_factor: f64,
    
    /// Whether to enforce all risk checks strictly
    pub strict_validation: bool,
    
    /// Whether the strategy is currently active
    pub is_active: bool,
    
    /// Minimum win rate required for normal operation
    pub min_win_rate: f64,
}

impl Default for RiskProfile {
    fn default() -> Self {
        Self {
            position_size: 0.02,                // 2% of portfolio by default
            use_stop_loss: true,
            max_slippage: 0.005,                // 0.5% max slippage
            volatility_aversion: 0.5,           // Moderate volatility aversion
            max_drawdown: 0.1,                  // 10% max drawdown
            max_consecutive_losses: 5,
            evaluation_window_seconds: 86400,   // 24 hours
            position_sizing_factor: 1.0,        // Full sizing by default
            strict_validation: true,
            is_active: true,
            min_win_rate: 0.4,                  // 40% minimum win rate
        }
    }
}

/// Builder for creating RiskProfile instances
pub struct RiskProfileBuilder {
    profile: RiskProfile,
}

impl RiskProfileBuilder {
    /// Create a new RiskProfileBuilder with default values
    pub fn new() -> Self {
        Self {
            profile: RiskProfile::default(),
        }
    }
    
    /// Set position size (as a decimal fraction)
    pub fn position_size(mut self, size: f64) -> Self {
        self.profile.position_size = size;
        self
    }
    
    /// Set whether to require stop losses
    pub fn use_stop_loss(mut self, use_stop_loss: bool) -> Self {
        self.profile.use_stop_loss = use_stop_loss;
        self
    }
    
    /// Set maximum allowed slippage
    pub fn max_slippage(mut self, slippage: f64) -> Self {
        self.profile.max_slippage = slippage;
        self
    }
    
    /// Set volatility aversion (0.0 = aggressive, 1.0 = very conservative)
    pub fn volatility_aversion(mut self, aversion: f64) -> Self {
        self.profile.volatility_aversion = aversion;
        self
    }
    
    /// Set strict validation mode
    pub fn strict_validation(mut self, strict: bool) -> Self {
        self.profile.strict_validation = strict;
        self
    }
    
    /// Create a conservative risk profile
    pub fn conservative() -> Self {
        Self {
            profile: RiskProfile {
                position_size: 0.02,                // 2% of portfolio by default
                use_stop_loss: true,
                max_slippage: 0.005,                // 0.5% max slippage
                volatility_aversion: 0.5,           // Moderate volatility aversion
                max_drawdown: 0.1,                  // 10% max drawdown
                max_consecutive_losses: 5,
                evaluation_window_seconds: 86400,   // 24 hours
                position_sizing_factor: 1.0,        // Full sizing by default
                strict_validation: true,
                is_active: true,
                min_win_rate: 0.4,                  // 40% minimum win rate
            },
        }
    }
    
    /// Create an aggressive risk profile
    pub fn aggressive() -> Self {
        Self {
            profile: RiskProfile {
                position_size: 0.1,                // 10% of portfolio by default
                use_stop_loss: false,
                max_slippage: 0.03,                // 3% max slippage
                volatility_aversion: 0.2,           // Very low volatility aversion
                max_drawdown: 0.2,                  // 20% max drawdown
                max_consecutive_losses: 3,
                evaluation_window_seconds: 86400,   // 24 hours
                position_sizing_factor: 0.5,        // Half sizing by default
                strict_validation: false,
                is_active: true,
                min_win_rate: 0.5,                  // 50% minimum win rate
            },
        }
    }
    
    /// Build the RiskProfile
    pub fn build(self) -> RiskProfile {
        self.profile
    }
}

/// Trust state of a strategy used for routing and risk gating
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum StrategyTrustState {
    /// Strategy is fully active and enabled
    Active,
    
    /// Strategy is on cooldown period after issues
    OnCooldown,
    
    /// Strategy has been disabled due to risk or performance issues
    Disabled,
    
    /// Strategy is in recovery phase with reduced position sizes
    Recovering,
    
    /// Trust state is unknown or not yet established
    Unknown,
}

impl Default for StrategyTrustState {
    fn default() -> Self {
        Self::Unknown
    }
}

impl fmt::Display for StrategyTrustState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Active => write!(f, "Active"),
            Self::OnCooldown => write!(f, "OnCooldown"),
            Self::Disabled => write!(f, "Disabled"),
            Self::Recovering => write!(f, "Recovering"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Performance metrics for a strategy
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StrategyPerformance {
    /// Number of signals generated
    pub signals_generated: u32,
    /// Number of signals executed
    pub signals_executed: u32,
    /// Number of signals rejected
    pub signals_rejected: u32,
    /// Number of successful trades
    pub successful_trades: u32,
    /// Number of unsuccessful trades
    pub unsuccessful_trades: u32,
    /// Profit and loss
    pub pnl: f64,
    /// Return on investment
    pub roi: f64,
    /// Sharpe ratio
    pub sharpe: Option<f64>,
    /// Sortino ratio
    pub sortino: Option<f64>,
    /// Maximum drawdown
    pub max_drawdown: f64,
    /// Win rate
    pub win_rate: f64,
    /// Average profit per trade
    pub avg_profit_per_trade: f64,
    /// Average loss per trade
    pub avg_loss_per_trade: f64,
    /// Profit factor
    pub profit_factor: f64,
    /// Average execution latency in milliseconds
    pub avg_execution_latency_ms: Option<f64>,
    /// Average slippage percentage
    pub avg_slippage_pct: Option<f64>,
    /// Trust score history
    pub trust_history: VecDeque<TrustScoreEntry>,
    /// Performance window start time
    pub window_start: Option<DateTime<Utc>>,
    /// Performance window end time
    pub window_end: Option<DateTime<Utc>>,
    /// Execution quality metrics
    pub execution_quality: ExecutionQualityMetrics,
    /// Raw signal metrics
    pub signal_metrics: SignalMetrics,
}

/// Trust score entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScoreEntry {
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    /// Trust score
    pub score: f64,
    /// Score source
    pub source: String,
    /// Associated system code if available
    pub system_code: Option<String>,
}

/// Execution quality metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExecutionQualityMetrics {
    /// Average time to fill in milliseconds
    pub avg_time_to_fill_ms: Option<f64>,
    /// Percentage of orders filled
    pub fill_rate_pct: f64,
    /// Average execution price vs target price (negative means better than target)
    pub price_improvement_pct: Option<f64>,
    /// Average execution cost (fees, spread, etc.)
    pub avg_execution_cost_pct: f64,
    /// Number of orders with positive slippage
    pub positive_slippage_count: u32,
    /// Number of orders with negative slippage
    pub negative_slippage_count: u32,
    /// Percentage of orders with slippage exceeding expected
    pub excessive_slippage_pct: f64,
}

/// Signal metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SignalMetrics {
    /// Average confidence of generated signals
    pub avg_confidence: f64,
    /// Signal distribution by risk grade
    pub risk_grade_distribution: HashMap<RiskGrade, u32>,
    /// Average trust score of signals
    pub avg_trust_score: Option<f64>,
    /// Signal rejection reasons
    pub rejection_reasons: HashMap<String, u32>,
    /// Signal generation rate (signals per hour)
    pub generation_rate: f64,
}

impl StrategyPerformance {
    /// Create a new empty performance record
    pub fn new() -> Self {
        Self {
            trust_history: VecDeque::with_capacity(100),
            ..Default::default()
        }
    }
    
    /// Update performance metrics with a new signal result
    pub fn update_with_signal(&mut self, signal: &Signal) {
        self.signals_generated += 1;
        
        // Update risk grade distribution
        self.signal_metrics.risk_grade_distribution
            .entry(signal.risk_grade.clone())
            .and_modify(|count| *count += 1)
            .or_insert(1);
            
        // Track confidence
        self.update_avg_confidence(signal.confidence);
        
        // Track trust score if available
        if let Some(trust_score) = signal.average_trust_score() {
            self.update_trust_score(trust_score, "signal", signal.system_code.clone());
        }
        
        match signal.status {
            SignalStatus::Executed | 
            SignalStatus::PartiallyExecuted => {
                self.signals_executed += 1;
                self.update_execution_metrics(signal);
            },
            SignalStatus::Rejected |
            SignalStatus::TrustBlocked |
            SignalStatus::RiskLimited => {
                self.signals_rejected += 1;
                
                // Track rejection reason
                let reason = signal.status.to_string();
                self.signal_metrics.rejection_reasons
                    .entry(reason)
                    .and_modify(|count| *count += 1)
                    .or_insert(1);
            },
            _ => {}
        }
        
        // Update window times
        let now = Utc::now();
        if self.window_start.is_none() {
            self.window_start = Some(now);
        }
        self.window_end = Some(now);
        
        // Update generation rate
        self.update_generation_rate();
    }
    
    /// Update execution metrics based on a signal
    fn update_execution_metrics(&mut self, signal: &Signal) {
        if let Some(exec_result) = &signal.execution_result {
            // Track execution latency
            if let Some(latency) = exec_result.latency_profile.as_ref().map(|p| p.total_ms) {
                self.update_avg_execution_latency(latency as f64);
            }
            
            // Track slippage
            if let Some(slippage) = signal.actual_slippage_pct() {
                self.update_avg_slippage(slippage);
                
                // Track slippage direction and excess
                if slippage > 0.0 {
                    self.execution_quality.negative_slippage_count += 1;
                    
                    // Check if slippage exceeds expected
                    let expected = signal.expected_slippage_pct();
                    if slippage > expected {
                        // Increment excessive slippage counter
                        let total_executed = self.signals_executed as f64;
                        self.execution_quality.excessive_slippage_pct = 
                            (self.execution_quality.excessive_slippage_pct * (total_executed - 1.0) + 1.0) / total_executed;
                    }
                } else {
                    self.execution_quality.positive_slippage_count += 1;
                }
            }
            
            // Update fill rate
            self.execution_quality.fill_rate_pct = 
                (self.signals_executed as f64) / (self.signals_generated as f64) * 100.0;
                
            // Track successful vs unsuccessful trades
            match exec_result.status {
                ExecutionStatus::Completed => {
                    self.successful_trades += 1;
                },
                _ => {
                    self.unsuccessful_trades += 1;
                }
            }
            
            // Update win rate
            let total_trades = self.successful_trades + self.unsuccessful_trades;
            if total_trades > 0 {
                self.win_rate = (self.successful_trades as f64) / (total_trades as f64);
            }
        }
    }
    
    /// Update the average confidence
    fn update_avg_confidence(&mut self, confidence: f64) {
        let total = self.signals_generated as f64;
        let current_avg = self.signal_metrics.avg_confidence;
        
        self.signal_metrics.avg_confidence = 
            (current_avg * (total - 1.0) + confidence) / total;
    }
    
    /// Update the average execution latency
    fn update_avg_execution_latency(&mut self, latency_ms: f64) {
        let total = self.signals_executed as f64;
        let current_avg = self.avg_execution_latency_ms.unwrap_or(0.0);
        
        self.avg_execution_latency_ms = Some(
            (current_avg * (total - 1.0) + latency_ms) / total
        );
    }
    
    /// Update the average slippage
    fn update_avg_slippage(&mut self, slippage_pct: f64) {
        let total = self.signals_executed as f64;
        let current_avg = self.avg_slippage_pct.unwrap_or(0.0);
        
        self.avg_slippage_pct = Some(
            (current_avg * (total - 1.0) + slippage_pct) / total
        );
    }
    
    /// Add a trust score entry
    pub fn update_trust_score(&mut self, score: f64, source: &str, system_code: Option<String>) {
        // Add new entry
        self.trust_history.push_back(TrustScoreEntry {
            timestamp: Utc::now(),
            score,
            source: source.to_string(),
            system_code,
        });
        
        // Limit history size
        if self.trust_history.len() > 100 {
            self.trust_history.pop_front();
        }
        
        // Update average trust score
        let mut sum = 0.0;
        for entry in &self.trust_history {
            sum += entry.score;
        }
        
        self.signal_metrics.avg_trust_score = Some(sum / self.trust_history.len() as f64);
    }
    
    /// Update the generation rate
    fn update_generation_rate(&mut self) {
        if let (Some(start), Some(end)) = (self.window_start, self.window_end) {
            let duration = end.signed_duration_since(start);
            let hours = duration.num_milliseconds() as f64 / (1000.0 * 60.0 * 60.0);
            
            if hours > 0.0 {
                self.signal_metrics.generation_rate = self.signals_generated as f64 / hours;
            }
        }
    }
    
    /// Get the current trust score (average of recent entries)
    pub fn current_trust_score(&self) -> Option<f64> {
        if self.trust_history.is_empty() {
            return None;
        }
        
        // Weight more recent scores higher
        let mut weighted_sum = 0.0;
        let mut weight_sum = 0.0;
        
        for (i, entry) in self.trust_history.iter().enumerate() {
            let weight = (i + 1) as f64;
            weighted_sum += entry.score * weight;
            weight_sum += weight;
        }
        
        Some(weighted_sum / weight_sum)
    }
    
    /// Get a telemetry-friendly summary
    pub fn telemetry_summary(&self) -> HashMap<String, serde_json::Value> {
        let mut summary = HashMap::new();
        
        // Add basic metrics
        summary.insert("signals_generated".to_string(), json!(self.signals_generated));
        summary.insert("signals_executed".to_string(), json!(self.signals_executed));
        summary.insert("win_rate".to_string(), json!(self.win_rate));
        summary.insert("pnl".to_string(), json!(self.pnl));
        summary.insert("roi".to_string(), json!(self.roi));
        summary.insert("max_drawdown".to_string(), json!(self.max_drawdown));
        
        // Add execution quality metrics
        summary.insert("fill_rate_pct".to_string(), json!(self.execution_quality.fill_rate_pct));
        summary.insert("avg_slippage_pct".to_string(), json!(self.avg_slippage_pct));
        summary.insert("avg_execution_latency_ms".to_string(), json!(self.avg_execution_latency_ms));
        
        // Add trust metrics
        summary.insert("avg_trust_score".to_string(), json!(self.signal_metrics.avg_trust_score));
        summary.insert("current_trust_score".to_string(), json!(self.current_trust_score()));
        
        summary
    }
}

/// Configuration for entropy injection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntropyConfig {
    /// Whether entropy injection is enabled
    pub enabled: bool,
    
    /// Amount of randomness to inject (0.0 - 1.0)
    pub noise_level: f64,
    
    /// Minimum confidence level required for signals after noise injection
    pub min_confidence: f64,
    
    /// Whether to apply varying delays to signals
    pub apply_timing_entropy: bool,
    
    /// Maximum delay to add in milliseconds
    pub max_delay_ms: u64,
    
    /// Whether to occasionally skip signals even if they're valid
    pub enable_signal_skipping: bool,
    
    /// Probability of skipping a valid signal (0.0 - 1.0)
    pub skip_probability: f64,
}

impl Default for EntropyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            noise_level: 0.1,
            min_confidence: 0.6,
            apply_timing_entropy: false,
            max_delay_ms: 2000,
            enable_signal_skipping: false,
            skip_probability: 0.05,
        }
    }
}

/// Interface for injecting entropy into trading signals
pub trait EntropyInjector: Send + Sync {
    /// Add random noise to a signal's confidence level
    fn inject_entropy(&self, signal: &mut Signal, config: &EntropyConfig);
    
    /// Get the entropy configuration
    fn get_config(&self) -> &EntropyConfig;
    
    /// Calculate any delay to apply to the signal in milliseconds
    fn calculate_delay_ms(&self, signal: &Signal) -> Option<u64>;
    
    /// Determine if a signal should be skipped entirely
    fn should_skip_signal(&self, signal: &Signal) -> bool;
    
    /// Allow downcasting to concrete implementation
    fn as_any(&self) -> &dyn std::any::Any where Self: 'static;
}

/// Strategy-related errors
#[derive(Debug, Error)]
pub enum StrategyError {
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Data unavailable: {0}")]
    MissingData(String),
    
    #[error("Computation failed: {0}")]
    ComputationError(String),
    
    #[error("Execution pipeline blocked: {0}")]
    PipelineHalted(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Defines a strategy that can generate signals based on market data
#[async_trait]
pub trait Strategy: Send + Sync {
    /// Generate a signal from live market data
    async fn generate_signal(&self, market_data: &MarketData)
        -> Result<Option<Signal>, StrategyError>;
    
    /// Return the strategy's risk profile
    async fn get_risk_profile(&self) -> RiskProfile;
    
    /// Return the unique name or ID of the strategy
    fn name(&self) -> &str;
    
    /// Optional method to get strategy-specific metrics
    async fn get_metrics(&self) -> HashMap<String, f64> {
        HashMap::new()
    }
    
    /// Optional method for strategy-specific shutdown
    async fn shutdown(&self) -> Result<(), StrategyError> {
        Ok(())
    }
    
    /// Return the entropy score for this strategy (0.0 - 1.0)
    /// Higher values indicate more randomness should be applied
    /// Default implementation returns 0.5 (moderate entropy)
    fn entropy_score(&self) -> f64 {
        0.5
    }
    
    /// Called after a signal has been executed
    async fn on_signal_executed(&self, _signal: &Signal, _result: &ExecutionResult) -> Result<(), StrategyError> {
        Ok(())
    }
    
    /// Create a description of this strategy
    fn description(&self) -> String {
        format!("Strategy: {}", self.name())
    }
}

/// Builder for creating strategy implementations
pub struct StrategyBuilder {
    /// Strategy identifier
    id: String,
    /// Risk profile
    risk_profile: RiskProfile,
    /// Description
    description: Option<String>,
}

impl StrategyBuilder {
    /// Create a new strategy builder with the given ID
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_string(),
            risk_profile: RiskProfile::default(),
            description: None,
        }
    }
    
    /// Set the risk profile for the strategy
    pub fn with_risk_profile(mut self, risk_profile: RiskProfile) -> Self {
        self.risk_profile = risk_profile;
        self
    }
    
    /// Set a description for the strategy
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = Some(description.to_string());
        self
    }
    
    /// Build a simple "hold" strategy that never generates signals
    pub fn build_hold_strategy(self) -> impl Strategy {
        struct HoldStrategy {
            id: String,
            risk_profile: RiskProfile,
            description: Option<String>,
        }
        
        #[async_trait]
        impl Strategy for HoldStrategy {
            async fn generate_signal(&self, _market_data: &MarketData) -> Result<Option<Signal>, StrategyError> {
                // Hold strategy never generates signals
                Ok(None)
            }
            
            async fn get_risk_profile(&self) -> RiskProfile {
                self.risk_profile.clone()
            }
            
            fn name(&self) -> &str {
                &self.id
            }
            
            fn description(&self) -> String {
                self.description.clone().unwrap_or_else(|| format!("Hold Strategy: {}", self.id))
            }
        }
        
        HoldStrategy {
            id: self.id,
            risk_profile: self.risk_profile,
            description: self.description,
        }
    }
}

/// Extension trait for strategy-related utilities
#[async_trait]
pub trait StrategyExt {
    /// Get the trust state of the strategy
    async fn get_trust_state(&self, performance: &StrategyPerformance) -> StrategyTrustState;
    
    /// Check if the strategy is allowed to trade based on its performance
    async fn can_trade(&self, performance: &StrategyPerformance) -> bool;
    
    /// Get a recommended position sizing factor based on performance
    async fn position_sizing_factor(&self, performance: &StrategyPerformance) -> f64;
}

#[async_trait]
impl<T: Strategy + Send + Sync> StrategyExt for T {
    async fn get_trust_state(&self, performance: &StrategyPerformance) -> StrategyTrustState {
        performance.get_trust_state()
    }
    
    async fn can_trade(&self, performance: &StrategyPerformance) -> bool {
        let trust_state = self.get_trust_state(performance).await;
        match trust_state {
            StrategyTrustState::Active | StrategyTrustState::Recovering => true,
            _ => false,
        }
    }
    
    async fn position_sizing_factor(&self, performance: &StrategyPerformance) -> f64 {
        let trust_state = self.get_trust_state(performance).await;
        match trust_state {
            StrategyTrustState::Active => 1.0,
            StrategyTrustState::Recovering => 0.5,
            StrategyTrustState::OnCooldown => 0.25,
            _ => 0.0,
        }
    }
}

/// Extension trait for signal-related utilities
pub trait SignalExt {
    /// Calculate a telemetry tag for the signal
    fn telemetry_tag(&self) -> String;
    
    /// Check if the signal requires immediate execution
    fn is_urgent(&self) -> bool;
    
    /// Get a human-readable description of the signal
    fn describe(&self) -> String;
    
    /// Get the entropy susceptibility of the signal (0.0 - 1.0)
    fn entropy_susceptibility(&self) -> f64;
    
    /// Get the fill confidence of the signal (0.0 - 1.0)
    fn fill_confidence(&self) -> f64;
    
    /// Get the expected slippage percentage
    fn expected_slippage_pct(&self) -> f64;
    
    /// Get the actual slippage percentage if available
    fn actual_slippage_pct(&self) -> Option<f64>;
    
    /// Get the trust score from a specific system
    fn trust_score(&self, system: &str) -> Option<f64>;
    
    /// Get the average trust score across all systems
    fn average_trust_score(&self) -> Option<f64>;
    
    /// Get a canonical summary for telemetry and logging
    fn canonical_summary(&self) -> String;
    
    /// Get any execution latency in milliseconds
    fn execution_latency_ms(&self) -> Option<u64>;
    
    /// Check if execution was successful
    fn is_execution_successful(&self) -> bool;
    
    /// Get the system code for telemetry linkage
    fn system_code(&self) -> Option<String>;
}

impl SignalExt for Signal {
    fn telemetry_tag(&self) -> String {
        format!("signal:{}:{}:{}", self.strategy_id, self.symbol, self.id)
    }
    
    fn is_urgent(&self) -> bool {
        // Exit signals are considered urgent
        if self.is_exit() {
            return true;
        }
        
        // High confidence signals are more urgent
        if self.confidence > 0.9 {
            return true;
        }
        
        // Check for urgency tag in metadata
        if let Some(meta) = &self.metadata {
            if let Some(urgent) = meta.get("urgent") {
                return urgent == "true";
            }
        }
        
        // Immediate execution horizon signals are urgent
        matches!(self.execution_horizon, ExecutionHorizon::Immediate)
    }
    
    fn describe(&self) -> String {
        let urgency = if self.is_urgent() { "URGENT" } else { "" };
        let trust = self.average_trust_score()
            .map(|score| format!("trust:{:.2}", score))
            .unwrap_or_else(|| "".to_string());
        
        format!("{} {} on {} {} (conf:{:.2}, risk:{}, {}{})",
            self.action.description(),
            self.direction,
            self.symbol,
            urgency,
            self.confidence,
            self.risk_grade,
            trust,
            self.metadata.as_ref()
                .and_then(|m| m.get("context"))
                .map(|ctx| format!(", context:{}", ctx))
                .unwrap_or_else(|| "".to_string())
        )
    }
    
    fn entropy_susceptibility(&self) -> f64 {
        // Exit signals should have less entropy applied
        if self.is_exit() {
            return 0.3;
        }
        
        // High confidence signals should have less entropy
        if self.confidence > 0.9 {
            return 0.4;
        }
        
        // High risk signals should have less entropy
        match self.risk_grade {
            RiskGrade::High | RiskGrade::Exceptional => 0.3,
            RiskGrade::Medium => 0.5,
            RiskGrade::Low => 0.7,
        }
    }
    
    fn fill_confidence(&self) -> f64 {
        self.fill_confidence.unwrap_or_else(|| {
            // Default fill confidence based on market conditions
            // For more sophisticated implementations, this would be calculated
            // based on market liquidity, volatility, etc.
            match self.risk_grade {
                RiskGrade::Low => 0.9,
                RiskGrade::Medium => 0.8,
                RiskGrade::High => 0.7,
                RiskGrade::Exceptional => 0.6,
            }
        })
    }
    
    fn expected_slippage_pct(&self) -> f64 {
        self.expected_slippage_pct.unwrap_or_else(|| {
            // Default expected slippage based on risk grade
            match self.risk_grade {
                RiskGrade::Low => 0.1,
                RiskGrade::Medium => 0.3,
                RiskGrade::High => 0.5,
                RiskGrade::Exceptional => 1.0,
            }
        })
    }
    
    fn actual_slippage_pct(&self) -> Option<f64> {
        self.execution_result.as_ref().and_then(|result| {
            if let (Some(executed_price), Some(target_price)) = (result.executed_price, self.price) {
                let slippage = ((executed_price - target_price) / target_price).abs() * 100.0;
                Some(slippage)
            } else {
                None
            }
        })
    }
    
    fn trust_score(&self, system: &str) -> Option<f64> {
        self.trust_vector.as_ref().and_then(|tv| tv.get(system).copied())
    }
    
    fn average_trust_score(&self) -> Option<f64> {
        self.trust_vector.as_ref().map(|tv| {
            if tv.is_empty() {
                return 0.5; // Default trust score
            }
            let sum: f64 = tv.values().sum();
            sum / tv.len() as f64
        })
    }
    
    fn canonical_summary(&self) -> String {
        let status = format!("[{}]", self.status);
        let direction = format!("{:?}", self.direction);
        let risk = format!("RISK:{:?}", self.risk_grade);
        let trust = self.average_trust_score()
            .map(|score| format!("TRUST:{:.2}", score))
            .unwrap_or_else(|| "".to_string());
        
        let execution = self.execution_result.as_ref()
            .map(|r| format!("EXEC:{}", r.status))
            .unwrap_or_else(|| "".to_string());
        
        let latency = self.execution_latency_ms()
            .map(|ms| format!("LAT:{}ms", ms))
            .unwrap_or_else(|| "".to_string());
        
        format!("{} {} {} {} {} {} {} {}",
            status,
            self.action.description(),
            direction,
            self.symbol,
            risk,
            trust,
            execution,
            latency
        ).trim().to_string()
    }
    
    fn execution_latency_ms(&self) -> Option<u64> {
        self.execution_result.as_ref()
            .and_then(|result| result.latency_profile.as_ref())
            .map(|profile| profile.total_ms)
    }
    
    fn is_execution_successful(&self) -> bool {
        self.execution_result.as_ref()
            .map(|result| result.status == ExecutionStatus::Completed)
            .unwrap_or(false)
    }
    
    fn system_code(&self) -> Option<String> {
        self.system_code.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_signal_lifecycle() {
        let signal = Signal::new("test_strategy".to_string(), "BTC/USD".to_string(), SignalAction::Enter)
            .with_confidence(0.8)
            .with_price(50000.0);
        
        assert_eq!(signal.status, SignalStatus::Created);
        assert!(signal.is_valid());
        assert!(!signal.is_expired());
        assert!(signal.is_entry());
        assert!(!signal.is_exit());
    }
    
    #[test]
    fn test_strategy_performance() {
        let mut performance = StrategyPerformance::new("test_strategy".to_string());
        assert_eq!(performance.winning_trades, 0);
        assert_eq!(performance.losing_trades, 0);
        assert_eq!(performance.win_rate(), 0.0);
        
        // Simulate a winning trade
        let trade = TradeInfo {
            symbol: "BTC/USD".to_string(),
            entry_price: 50000.0,
            exit_price: 51000.0,
            profit_loss: 1000.0,
            entry_time: Utc::now(),
            exit_time: Utc::now(),
            direction: PositionDirection::Long,
            size: 1.0,
        };
        
        performance.update_after_trade(trade);
        assert_eq!(performance.winning_trades, 1);
        assert_eq!(performance.losing_trades, 0);
        assert_eq!(performance.consecutive_wins, 1);
        assert_eq!(performance.consecutive_losses, 0);
        assert_eq!(performance.win_rate(), 1.0);
    }
    
    #[tokio::test]
    async fn test_hold_strategy() {
        let strategy = StrategyBuilder::new("test_hold")
            .with_description("A strategy that always holds")
            .build_hold_strategy();
        
        let market_data = MarketData::new(
            "binance".to_string(),
            "BTC/USD".to_string(),
        );
        
        let signal_result = strategy.generate_signal(&market_data).await;
        assert!(signal_result.is_ok());
        let signal_opt = signal_result.unwrap();
        assert!(signal_opt.is_none());
        
        assert_eq!(strategy.name(), "test_hold");
        assert!(strategy.description().contains("Hold Strategy"));
    }
} 