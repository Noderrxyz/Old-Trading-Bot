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

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{RwLock, Mutex};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::strategy::{Signal, Strategy, StrategyId};
use crate::risk::{RiskError, RiskManager, PositionDirection};
use crate::market::MarketData;

/// Risk manager configuration optimized for latency-critical operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    /// Maximum allowed position size as percentage of portfolio (0.0-1.0)
    pub max_position_size_pct: f64,
    
    /// Maximum leverage allowed (e.g., 3.0 = 3x leverage)
    pub max_leverage: f64,
    
    /// Maximum drawdown percentage allowed (0.0-1.0)
    pub max_drawdown_pct: f64,
    
    /// Minimum trust score required for trading (0.0-1.0)
    pub min_trust_score: f64,
    
    /// Maximum exposure per symbol as percentage of portfolio (0.0-1.0)
    pub max_exposure_per_symbol: f64,
    
    /// Maximum exposure per venue as percentage of portfolio (0.0-1.0)
    pub max_exposure_per_venue: f64,
    
    /// Portfolio rebalance interval in milliseconds
    pub rebalance_interval_ms: u64,
    
    /// Discord webhook URL for notifications (optional)
    pub webhook_url: Option<String>,
    
    /// Strategies exempt from risk checks
    pub exempt_strategies: HashSet<String>,
    
    /// Fast risk check mode (skips some non-critical checks)
    pub fast_risk_mode: bool,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            max_position_size_pct: 0.1,      // 10% of portfolio
            max_leverage: 3.0,
            max_drawdown_pct: 0.2,           // 20% max drawdown
            min_trust_score: 0.7,
            max_exposure_per_symbol: 0.3,    // 30% per symbol
            max_exposure_per_venue: 0.4,     // 40% per venue
            rebalance_interval_ms: 300000,   // 5 minutes
            webhook_url: None,
            exempt_strategies: HashSet::new(),
            fast_risk_mode: false,
        }
    }
}

/// Position exposure tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionExposure {
    /// Symbol for this position
    pub symbol: String,
    
    /// Trading venue
    pub venue: String,
    
    /// Position size in base currency
    pub size: f64,
    
    /// Position value in quote currency
    pub value: f64,
    
    /// Leverage used
    pub leverage: f64,
    
    /// Trust score of the venue
    pub trust_score: f64,
    
    /// Direction of the position
    pub direction: PositionDirection,
    
    /// Unix timestamp of position creation
    pub timestamp: i64,
    
    /// Position unique identifier
    pub id: String,
}

impl PositionExposure {
    /// Create a new position exposure
    pub fn new(
        symbol: &str,
        venue: &str,
        size: f64,
        value: f64,
        leverage: f64,
        trust_score: f64,
        direction: PositionDirection,
    ) -> Self {
        Self {
            symbol: symbol.to_string(),
            venue: venue.to_string(),
            size,
            value,
            leverage,
            trust_score,
            direction,
            timestamp: chrono::Utc::now().timestamp(),
            id: Uuid::new_v4().to_string(),
        }
    }
}

/// Venue exposure tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VenueExposure {
    /// Venue name
    pub venue: String,
    
    /// Total value allocated to this venue
    pub total_value: f64,
    
    /// Trust score of the venue
    pub trust_score: f64,
    
    /// Positions count on this venue
    pub position_count: usize,
}

/// Risk calculation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskCheckResult {
    /// Whether the risk check passed
    pub passed: bool,
    
    /// Risk check timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Risk violations found (if any)
    pub violations: Vec<RiskViolation>,
    
    /// Calculated risk metrics
    pub metrics: HashMap<String, f64>,
    
    /// Risk check context
    pub context: String,
    
    /// Risk level (0.0-1.0 where 1.0 is highest risk)
    pub risk_level: f64,
}

impl RiskCheckResult {
    /// Create a new passing risk check result
    pub fn pass() -> Self {
        Self {
            passed: true,
            timestamp: Utc::now(),
            violations: Vec::new(),
            metrics: HashMap::new(),
            context: "All risk checks passed".to_string(),
            risk_level: 0.0,
        }
    }
    
    /// Create a new failing risk check result with violations
    pub fn fail(violations: Vec<RiskViolation>, risk_level: f64) -> Self {
        Self {
            passed: false,
            timestamp: Utc::now(),
            violations,
            metrics: HashMap::new(),
            context: "Risk check failed".to_string(),
            risk_level,
        }
    }
    
    /// Add a metric to the result
    pub fn add_metric(&mut self, name: &str, value: f64) -> &mut Self {
        self.metrics.insert(name.to_string(), value);
        self
    }
    
    /// Set context
    pub fn with_context(&mut self, context: &str) -> &mut Self {
        self.context = context.to_string();
        self
    }
}

/// Risk violation type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskViolation {
    /// Violation type
    pub violation_type: RiskViolationType,
    
    /// Violation description
    pub description: String,
    
    /// Actual value that caused the violation
    pub actual_value: f64,
    
    /// Limit value that was breached
    pub limit_value: f64,
    
    /// Severity level
    pub severity: RiskViolationSeverity,
}

/// Risk violation type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskViolationType {
    /// Position size too large
    PositionSize,
    
    /// Leverage too high
    Leverage,
    
    /// Trust score too low
    TrustScore,
    
    /// Venue exposure too high
    VenueExposure,
    
    /// Symbol exposure too high
    SymbolExposure,
    
    /// Drawdown too high
    Drawdown,
    
    /// Total portfolio allocation exceeded
    PortfolioAllocation,
    
    /// Low liquidity
    LowLiquidity,
    
    /// High volatility
    HighVolatility,
    
    /// Other violation type
    Other,
}

/// Risk violation severity
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskViolationSeverity {
    /// Warning level - execution can proceed but with caution
    Warning,
    
    /// Critical level - execution should be blocked
    Critical,
}

/// Risk calculator for fast risk limit checks
pub struct RiskCalculator {
    /// Risk configuration
    config: Arc<RwLock<RiskConfig>>,
    
    /// Current portfolio value
    portfolio_value: Arc<RwLock<f64>>,
    
    /// Active positions
    positions: Arc<RwLock<HashMap<String, PositionExposure>>>,
    
    /// Venue exposures
    venue_exposures: Arc<RwLock<HashMap<String, VenueExposure>>>,
    
    /// Symbol exposures
    symbol_exposures: Arc<RwLock<HashMap<String, f64>>>,
    
    /// Trust scores
    trust_scores: Arc<RwLock<HashMap<String, f64>>>,
    
    /// Last check timestamp
    last_check: Arc<RwLock<DateTime<Utc>>>,
}

impl RiskCalculator {
    /// Create a new risk calculator
    pub fn new(config: RiskConfig, initial_portfolio_value: f64) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            portfolio_value: Arc::new(RwLock::new(initial_portfolio_value)),
            positions: Arc::new(RwLock::new(HashMap::new())),
            venue_exposures: Arc::new(RwLock::new(HashMap::new())),
            symbol_exposures: Arc::new(RwLock::new(HashMap::new())),
            trust_scores: Arc::new(RwLock::new(HashMap::new())),
            last_check: Arc::new(RwLock::new(Utc::now())),
        }
    }
    
    /// Update portfolio value
    pub async fn update_portfolio_value(&self, value: f64) {
        let mut portfolio_value = self.portfolio_value.write().await;
        *portfolio_value = value;
    }
    
    /// Add a position
    pub async fn add_position(&self, position: PositionExposure) -> Result<(), RiskError> {
        let position_id = format!("{}-{}", position.symbol, position.venue);
        
        // Validate the position first
        self.validate_position(&position).await?;
        
        // Add to positions map
        {
            let mut positions = self.positions.write().await;
            positions.insert(position_id.clone(), position.clone());
        }
        
        // Update venue exposure
        self.update_venue_exposure(&position, false).await;
        
        // Update symbol exposure
        self.update_symbol_exposure(&position.symbol, position.value, false).await;
        
        Ok(())
    }
    
    /// Remove a position
    pub async fn remove_position(&self, symbol: &str, venue: &str) -> Result<(), RiskError> {
        let position_id = format!("{}-{}", symbol, venue);
        
        // Get position first
        let position = {
            let positions = self.positions.read().await;
            match positions.get(&position_id) {
                Some(pos) => pos.clone(),
                None => {
                    warn!("Attempted to remove non-existent position: {}-{}", symbol, venue);
                    return Ok(());
                }
            }
        };
        
        // Remove from positions map
        {
            let mut positions = self.positions.write().await;
            positions.remove(&position_id);
        }
        
        // Update venue exposure
        self.update_venue_exposure(&position, true).await;
        
        // Update symbol exposure
        self.update_symbol_exposure(&position.symbol, position.value, true).await;
        
        Ok(())
    }
    
    /// Update venue exposure
    async fn update_venue_exposure(&self, position: &PositionExposure, is_removal: bool) {
        let mut venue_exposures = self.venue_exposures.write().await;
        
        let venue_exposure = venue_exposures
            .entry(position.venue.clone())
            .or_insert(VenueExposure {
                venue: position.venue.clone(),
                total_value: 0.0,
                trust_score: position.trust_score,
                position_count: 0,
            });
        
        if is_removal {
            venue_exposure.total_value -= position.value;
            if venue_exposure.position_count > 0 {
                venue_exposure.position_count -= 1;
            }
        } else {
            venue_exposure.total_value += position.value;
            venue_exposure.position_count += 1;
        }
        
        // Validate venue exposure
        let config = self.config.read().await;
        let portfolio_value = *self.portfolio_value.read().await;
        
        if venue_exposure.total_value / portfolio_value > config.max_exposure_per_venue {
            // This is just a warning, actual blocking happens in validate_position
            warn!(
                "Venue exposure limit exceeded: {} at {:.2}% (limit: {:.2}%)",
                position.venue,
                venue_exposure.total_value / portfolio_value * 100.0,
                config.max_exposure_per_venue * 100.0
            );
        }
    }
    
    /// Update symbol exposure
    async fn update_symbol_exposure(&self, symbol: &str, value: f64, is_removal: bool) {
        let mut symbol_exposures = self.symbol_exposures.write().await;
        
        let current_exposure = symbol_exposures.entry(symbol.to_string()).or_insert(0.0);
        
        if is_removal {
            *current_exposure -= value;
        } else {
            *current_exposure += value;
        }
        
        // Validate symbol exposure
        let config = self.config.read().await;
        let portfolio_value = *self.portfolio_value.read().await;
        
        if *current_exposure / portfolio_value > config.max_exposure_per_symbol {
            // This is just a warning, actual blocking happens in validate_position
            warn!(
                "Symbol exposure limit exceeded: {} at {:.2}% (limit: {:.2}%)",
                symbol,
                *current_exposure / portfolio_value * 100.0,
                config.max_exposure_per_symbol * 100.0
            );
        }
    }
    
    /// Set trust score for a venue
    pub async fn set_trust_score(&self, venue: &str, score: f64) {
        let mut trust_scores = self.trust_scores.write().await;
        trust_scores.insert(venue.to_string(), score);
    }
    
    /// Get trust score for a venue
    pub async fn get_trust_score(&self, venue: &str) -> f64 {
        let trust_scores = self.trust_scores.read().await;
        *trust_scores.get(venue).unwrap_or(&0.5)
    }
    
    /// Perform fast risk check for a position
    pub async fn fast_risk_check(
        &self,
        position: &PositionExposure,
        strategy_id: Option<&str>,
    ) -> RiskCheckResult {
        let config = self.config.read().await;
        let portfolio_value = *self.portfolio_value.read().await;
        
        // Skip checks for exempt strategies
        if let Some(strategy_id) = strategy_id {
            if config.exempt_strategies.contains(strategy_id) {
                return RiskCheckResult::pass();
            }
        }
        
        let mut violations = Vec::new();
        
        // Check position size
        let position_size_pct = position.value / portfolio_value;
        if position_size_pct > config.max_position_size_pct {
            violations.push(RiskViolation {
                violation_type: RiskViolationType::PositionSize,
                description: format!(
                    "Position size exceeds limit: {:.2}% > {:.2}%", 
                    position_size_pct * 100.0, 
                    config.max_position_size_pct * 100.0
                ),
                actual_value: position_size_pct,
                limit_value: config.max_position_size_pct,
                severity: RiskViolationSeverity::Critical,
            });
        }
        
        // Check leverage
        if position.leverage > config.max_leverage {
            violations.push(RiskViolation {
                violation_type: RiskViolationType::Leverage,
                description: format!(
                    "Leverage exceeds limit: {:.2}x > {:.2}x", 
                    position.leverage, 
                    config.max_leverage
                ),
                actual_value: position.leverage,
                limit_value: config.max_leverage,
                severity: RiskViolationSeverity::Critical,
            });
        }
        
        // Check trust score
        if position.trust_score < config.min_trust_score {
            violations.push(RiskViolation {
                violation_type: RiskViolationType::TrustScore,
                description: format!(
                    "Trust score below minimum: {:.2} < {:.2}", 
                    position.trust_score, 
                    config.min_trust_score
                ),
                actual_value: position.trust_score,
                limit_value: config.min_trust_score,
                severity: RiskViolationSeverity::Critical,
            });
        }
        
        // Check venue exposure (current + new position)
        let venue_exposures = self.venue_exposures.read().await;
        if let Some(venue_exposure) = venue_exposures.get(&position.venue) {
            let new_exposure = (venue_exposure.total_value + position.value) / portfolio_value;
            if new_exposure > config.max_exposure_per_venue {
                violations.push(RiskViolation {
                    violation_type: RiskViolationType::VenueExposure,
                    description: format!(
                        "Venue exposure exceeds limit: {:.2}% > {:.2}%", 
                        new_exposure * 100.0, 
                        config.max_exposure_per_venue * 100.0
                    ),
                    actual_value: new_exposure,
                    limit_value: config.max_exposure_per_venue,
                    severity: RiskViolationSeverity::Critical,
                });
            }
        }
        
        // Check symbol exposure (current + new position)
        let symbol_exposures = self.symbol_exposures.read().await;
        let current_symbol_exposure = symbol_exposures.get(&position.symbol).copied().unwrap_or(0.0);
        let new_symbol_exposure = (current_symbol_exposure + position.value) / portfolio_value;
        
        if new_symbol_exposure > config.max_exposure_per_symbol {
            violations.push(RiskViolation {
                violation_type: RiskViolationType::SymbolExposure,
                description: format!(
                    "Symbol exposure exceeds limit: {:.2}% > {:.2}%", 
                    new_symbol_exposure * 100.0, 
                    config.max_exposure_per_symbol * 100.0
                ),
                actual_value: new_symbol_exposure,
                limit_value: config.max_exposure_per_symbol,
                severity: RiskViolationSeverity::Critical,
            });
        }
        
        // Return result
        if violations.is_empty() {
            RiskCheckResult::pass()
        } else {
            // Calculate risk level based on violations
            let risk_level = violations.iter().fold(0.0, |max, v| {
                let factor = match v.violation_type {
                    RiskViolationType::PositionSize => v.actual_value / v.limit_value,
                    RiskViolationType::Leverage => v.actual_value / v.limit_value,
                    RiskViolationType::TrustScore => (v.limit_value - v.actual_value) / v.limit_value,
                    RiskViolationType::VenueExposure => v.actual_value / v.limit_value,
                    RiskViolationType::SymbolExposure => v.actual_value / v.limit_value,
                    _ => 1.0,
                };
                
                factor.max(max)
            });
            
            RiskCheckResult::fail(violations, risk_level)
        }
    }
    
    /// Validate a position against risk limits
    async fn validate_position(&self, position: &PositionExposure) -> Result<(), RiskError> {
        let check_result = self.fast_risk_check(position, None).await;
        
        if !check_result.passed {
            let error_message = check_result.violations
                .iter()
                .map(|v| v.description.clone())
                .collect::<Vec<_>>()
                .join("; ");
            
            return Err(RiskError::RiskLimitBreached(error_message));
        }
        
        Ok(())
    }
    
    /// Get all current positions
    pub async fn get_all_positions(&self) -> Vec<PositionExposure> {
        let positions = self.positions.read().await;
        positions.values().cloned().collect()
    }
    
    /// Get all venue exposures
    pub async fn get_all_venue_exposures(&self) -> Vec<VenueExposure> {
        let venue_exposures = self.venue_exposures.read().await;
        venue_exposures.values().cloned().collect()
    }
    
    /// Get exposure for a specific symbol
    pub async fn get_symbol_exposure(&self, symbol: &str) -> f64 {
        let symbol_exposures = self.symbol_exposures.read().await;
        *symbol_exposures.get(symbol).unwrap_or(&0.0)
    }
    
    /// Get total exposure across all positions
    pub async fn get_total_exposure(&self) -> f64 {
        let positions = self.positions.read().await;
        positions.values().fold(0.0, |acc, pos| acc + pos.value)
    }
    
    /// Update configuration
    pub async fn update_config(&self, config: RiskConfig) {
        let mut current_config = self.config.write().await;
        *current_config = config;
    }
    
    /// Get current configuration
    pub async fn get_config(&self) -> RiskConfig {
        self.config.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_position_validation() {
        let config = RiskConfig {
            max_position_size_pct: 0.1,
            max_leverage: 3.0,
            min_trust_score: 0.7,
            ..Default::default()
        };
        
        let calculator = RiskCalculator::new(config, 100000.0);
        
        // Valid position
        let valid_position = PositionExposure::new(
            "BTC-USD",
            "binance",
            1.0,
            5000.0,  // 5% of portfolio
            1.0,
            0.8,
            PositionDirection::Long,
        );
        
        // Invalid position - too large
        let large_position = PositionExposure::new(
            "BTC-USD",
            "binance",
            1.0,
            15000.0,  // 15% of portfolio
            1.0,
            0.8,
            PositionDirection::Long,
        );
        
        // Invalid position - too much leverage
        let high_leverage_position = PositionExposure::new(
            "BTC-USD",
            "binance",
            1.0,
            5000.0,
            5.0,
            0.8,
            PositionDirection::Long,
        );
        
        // Invalid position - low trust score
        let low_trust_position = PositionExposure::new(
            "BTC-USD",
            "binance",
            1.0,
            5000.0,
            1.0,
            0.5,
            PositionDirection::Long,
        );
        
        // Valid position should pass
        let result = calculator.validate_position(&valid_position).await;
        assert!(result.is_ok());
        
        // Large position should fail
        let result = calculator.validate_position(&large_position).await;
        assert!(result.is_err());
        
        // High leverage position should fail
        let result = calculator.validate_position(&high_leverage_position).await;
        assert!(result.is_err());
        
        // Low trust position should fail
        let result = calculator.validate_position(&low_trust_position).await;
        assert!(result.is_err());
    }
    
    #[tokio::test]
    async fn test_venue_exposure() {
        let config = RiskConfig {
            max_exposure_per_venue: 0.2,
            ..Default::default()
        };
        
        let calculator = RiskCalculator::new(config, 100000.0);
        
        // Add positions to same venue
        let position1 = PositionExposure::new(
            "BTC-USD",
            "binance",
            1.0,
            10000.0,  // 10% of portfolio
            1.0,
            0.8,
            PositionDirection::Long,
        );
        
        let position2 = PositionExposure::new(
            "ETH-USD",
            "binance",
            10.0,
            15000.0,  // 15% of portfolio
            1.0,
            0.8,
            PositionDirection::Long,
        );
        
        // First position should pass
        let result = calculator.add_position(position1).await;
        assert!(result.is_ok());
        
        // Second position should fail due to venue exposure
        let result = calculator.add_position(position2).await;
        assert!(result.is_err());
        
        // Check venue exposure
        let venue_exposures = calculator.get_all_venue_exposures().await;
        assert_eq!(venue_exposures.len(), 1);
        assert_eq!(venue_exposures[0].venue, "binance");
        assert_eq!(venue_exposures[0].total_value, 10000.0);
    }
} 