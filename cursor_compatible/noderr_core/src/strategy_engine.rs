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

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};
use thiserror::Error;
use crate::strategy::{Signal, SignalStatus, RiskGrade, ExecutionHorizon, SignalExt};
use crate::order_router::{SmartOrderRouter, Order, ExecutionFailureReason};
use crate::execution::{ExecutionResult, ExecutionStatus};
use crate::risk_calc::{RiskCalculator, RiskViolation};
use crate::market::Symbol;
use crate::risk::PositionDirection;
use uuid::Uuid;
use tracing::{info, warn, error, debug};

/// Configuration for the strategy engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyEngineConfig {
    /// Whether to execute signals in dryrun mode (no real orders)
    pub dryrun_mode: bool,
    
    /// Whether to apply risk checks
    pub apply_risk_checks: bool,
    
    /// Maximum trust score required for automatic execution (0.0-1.0)
    pub min_trust_score: f64,
    
    /// Default execution horizon if not specified
    pub default_execution_horizon: ExecutionHorizon,
    
    /// Default risk grade if not specified
    pub default_risk_grade: RiskGrade,
    
    /// Whether to apply confidence-based position sizing
    pub confidence_based_sizing: bool,
    
    /// Whether to require signals to have explicit price
    pub require_price: bool,
    
    /// Maximum allowed slippage percentage
    pub max_slippage_pct: f64,
    
    /// Engine mode (sync or async execution)
    pub engine_mode: StrategyEngineMode,
    
    /// Whether to enforce latency budgets
    pub enforce_latency_budgets: bool,
}

impl Default for StrategyEngineConfig {
    fn default() -> Self {
        Self {
            dryrun_mode: false,
            apply_risk_checks: true,
            min_trust_score: 0.65,
            default_execution_horizon: ExecutionHorizon::ShortTerm,
            default_risk_grade: RiskGrade::Medium,
            confidence_based_sizing: true,
            require_price: false,
            max_slippage_pct: 0.5, // 0.5%
            engine_mode: StrategyEngineMode::Async,
            enforce_latency_budgets: true,
        }
    }
}

/// Engine operation mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrategyEngineMode {
    /// Synchronous execution mode (blocks until complete)
    Sync,
    /// Asynchronous execution mode (returns immediately, executes in background)
    Async,
}

/// Signal evaluation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalEvaluation {
    /// Signal ID
    pub signal_id: String,
    
    /// Whether the signal passed evaluation
    pub passed: bool,
    
    /// Execution probability (0.0-1.0)
    pub execution_probability: f64,
    
    /// Expected impact score (0.0-1.0, higher means more impact)
    pub expected_impact: f64,
    
    /// Expected slippage percentage
    pub expected_slippage_pct: f64,
    
    /// Trust score (0.0-1.0)
    pub trust_score: f64,
    
    /// Any risk violations detected
    pub risk_violations: Vec<RiskViolation>,
    
    /// Whether the signal is latency critical
    pub is_latency_critical: bool,
    
    /// Recommended position size as percentage of available capital
    pub recommended_position_size_pct: f64,
    
    /// Latency budget in milliseconds
    pub latency_budget_ms: u64,
    
    /// Timestamp of evaluation
    pub timestamp: DateTime<Utc>,
}

/// Signal metrics for performance analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalMetrics {
    /// Signal ID
    pub signal_id: String,
    
    /// Strategy ID
    pub strategy_id: String,
    
    /// Symbol
    pub symbol: Symbol,
    
    /// Signal generation time
    pub generation_time: DateTime<Utc>,
    
    /// Signal execution time (if executed)
    pub execution_time: Option<DateTime<Utc>>,
    
    /// Latency from generation to execution in milliseconds
    pub execution_latency_ms: Option<u64>,
    
    /// Signal confidence
    pub confidence: f64,
    
    /// Signal strength
    pub strength: f64,
    
    /// Execution success (true if successfully executed)
    pub success: bool,
    
    /// Order price
    pub price: Option<f64>,
    
    /// Actual execution price (if executed)
    pub execution_price: Option<f64>,
    
    /// Slippage percentage (positive means worse than expected)
    pub slippage_pct: Option<f64>,
    
    /// Position direction
    pub direction: PositionDirection,
    
    /// Position size
    pub position_size: Option<f64>,
    
    /// Trust score
    pub trust_score: Option<f64>,
    
    /// Execution status
    pub status: SignalStatus,
    
    /// Risk grade
    pub risk_grade: RiskGrade,
    
    /// Execution horizon
    pub execution_horizon: ExecutionHorizon,
    
    /// PnL if known
    pub pnl: Option<f64>,
    
    /// Additional metrics
    pub additional_metrics: HashMap<String, f64>,
}

/// Errors that can occur in the strategy engine
#[derive(Debug, Error)]
pub enum StrategyEngineError {
    #[error("Signal validation failed: {0}")]
    ValidationFailed(String),
    
    #[error("Risk check failed: {0}")]
    RiskCheckFailed(String),
    
    #[error("Trust score too low: {0}")]
    TrustScoreTooLow(String),
    
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),
    
    #[error("Invalid parameters: {0}")]
    InvalidParameters(String),
    
    #[error("Signal expired")]
    SignalExpired,
    
    #[error("Latency budget exceeded")]
    LatencyBudgetExceeded,
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Strategy engine for executing signals
pub struct StrategyEngine {
    /// Engine configuration
    config: RwLock<StrategyEngineConfig>,
    
    /// Order router for executing orders
    router: Arc<SmartOrderRouter>,
    
    /// Risk calculator for risk checks
    risk_calculator: Arc<RiskCalculator>,
    
    /// Signal metrics store
    metrics: RwLock<HashMap<String, SignalMetrics>>,
}

impl StrategyEngine {
    /// Create a new strategy engine
    pub fn new(
        router: Arc<SmartOrderRouter>,
        risk_calculator: Arc<RiskCalculator>,
        config: StrategyEngineConfig,
    ) -> Self {
        Self {
            config: RwLock::new(config),
            router,
            risk_calculator,
            metrics: RwLock::new(HashMap::new()),
        }
    }
    
    /// Execute a signal
    pub async fn execute_strategy(&self, signal: &Signal) -> Result<ExecutionResult, StrategyEngineError> {
        // Check if signal has expired
        if signal.is_expired() {
            return Err(StrategyEngineError::SignalExpired);
        }
        
        // Evaluate signal
        let evaluation = self.evaluate_signal(signal).await?;
        
        // Check if evaluation passed
        if !evaluation.passed {
            return Err(StrategyEngineError::ValidationFailed(
                "Signal did not pass evaluation checks".to_string()
            ));
        }
        
        // Create order from signal
        let order = self.create_order_from_signal(signal, &evaluation)?;
        
        // Execute order
        let execution_start = Utc::now();
        let execution_result = match self.router.execute_order(order).await {
            Ok(result) => result,
            Err(err) => {
                // Update signal metrics with failure
                self.update_metrics_for_failed_execution(signal, &evaluation, &err).await;
                
                // Map error
                return Err(StrategyEngineError::ExecutionFailed(err.to_string()));
            }
        };
        
        // Calculate latency
        let execution_latency = (Utc::now() - execution_start).num_milliseconds() as u64;
        
        // Update metrics
        self.update_metrics_for_execution(signal, &evaluation, &execution_result, execution_latency).await;
        
        // Return result
        Ok(execution_result)
    }
    
    /// Evaluate a signal
    pub async fn evaluate_signal(&self, signal: &Signal) -> Result<SignalEvaluation, StrategyEngineError> {
        let config = self.config.read().unwrap();
        
        // Perform basic validation
        self.validate_signal(signal, &config)?;
        
        // Calculate trust score
        let trust_score = signal.average_trust_score().unwrap_or(0.75);
        
        // Apply risk checks if enabled
        let mut risk_violations = Vec::new();
        if config.apply_risk_checks {
            risk_violations = self.apply_risk_checks(signal).await?;
        }
        
        // Check minimum trust score
        if trust_score < config.min_trust_score {
            return Err(StrategyEngineError::TrustScoreTooLow(
                format!("Trust score too low: {}", trust_score)
            ));
        }
        
        // Calculate execution probability based on confidence and trust score
        let execution_probability = signal.confidence * trust_score;
        
        // Calculate expected impact
        let expected_impact = signal.strength * signal.entropy_susceptibility();
        
        // Calculate expected slippage
        let expected_slippage_pct = signal.expected_slippage_pct();
        
        // Check if the signal is latency critical
        let is_latency_critical = signal.execution_horizon == ExecutionHorizon::Immediate;
        
        // Calculate recommended position size based on confidence and risk grade
        let recommended_position_size_pct = self.calculate_position_size_pct(signal);
        
        // Get latency budget from signal or use default based on execution horizon
        let latency_budget_ms = signal.latency_budget_ms();
        
        // Create evaluation result
        let evaluation = SignalEvaluation {
            signal_id: signal.id.clone(),
            passed: risk_violations.is_empty() && trust_score >= config.min_trust_score,
            execution_probability,
            expected_impact,
            expected_slippage_pct,
            trust_score,
            risk_violations,
            is_latency_critical,
            recommended_position_size_pct,
            latency_budget_ms,
            timestamp: Utc::now(),
        };
        
        Ok(evaluation)
    }
    
    /// Calculate metrics for a signal
    pub fn calculate_signal_metrics(&self, signal: &Signal, execution_result: Option<&ExecutionResult>) -> SignalMetrics {
        let mut metrics = SignalMetrics {
            signal_id: signal.id.clone(),
            strategy_id: signal.strategy_id.clone(),
            symbol: signal.symbol.clone(),
            generation_time: signal.timestamp,
            execution_time: None,
            execution_latency_ms: None,
            confidence: signal.confidence,
            strength: signal.strength,
            success: false,
            price: signal.price,
            execution_price: None,
            slippage_pct: None,
            direction: signal.direction,
            position_size: None,
            trust_score: signal.average_trust_score(),
            status: signal.status.clone(),
            risk_grade: signal.risk_grade,
            execution_horizon: signal.execution_horizon,
            pnl: None,
            additional_metrics: HashMap::new(),
        };
        
        // Update with execution result if available
        if let Some(result) = execution_result {
            metrics.execution_time = Some(result.timestamp);
            
            // Calculate latency
            if let Some(exec_time) = metrics.execution_time {
                metrics.execution_latency_ms = Some(
                    (exec_time - signal.timestamp).num_milliseconds() as u64
                );
            }
            
            metrics.success = result.status == ExecutionStatus::Completed;
            metrics.execution_price = result.average_price;
            
            // Calculate slippage if we have both prices
            if let (Some(signal_price), Some(exec_price)) = (signal.price, result.average_price) {
                let slippage_pct = match signal.direction {
                    PositionDirection::Long => (exec_price - signal_price) / signal_price * 100.0,
                    PositionDirection::Short => (signal_price - exec_price) / signal_price * 100.0,
                    PositionDirection::None => 0.0,
                };
                metrics.slippage_pct = Some(slippage_pct);
            }
            
            metrics.position_size = result.executed_quantity;
            metrics.pnl = Some(result.realized_pnl);
            
            // Add execution specific metrics
            metrics.additional_metrics.insert("execution_time_ms".to_string(), result.execution_time_ms as f64);
            
            if let Some(ref trust_score) = result.trust_score {
                metrics.additional_metrics.insert("venue_trust".to_string(), *trust_score);
            }
        }
        
        metrics
    }
    
    /// Get stored metrics for a signal
    pub fn get_signal_metrics(&self, signal_id: &str) -> Option<SignalMetrics> {
        self.metrics.read().unwrap().get(signal_id).cloned()
    }
    
    /// Store metrics for a signal
    pub fn store_signal_metrics(&self, metrics: SignalMetrics) {
        let mut metrics_store = self.metrics.write().unwrap();
        metrics_store.insert(metrics.signal_id.clone(), metrics);
    }
    
    /// Update configuration
    pub fn update_config(&self, config: StrategyEngineConfig) {
        let mut current_config = self.config.write().unwrap();
        *current_config = config;
    }
    
    /// Get current configuration
    pub fn get_config(&self) -> StrategyEngineConfig {
        self.config.read().unwrap().clone()
    }
    
    /// Apply risk checks to a signal
    async fn apply_risk_checks(&self, signal: &Signal) -> Result<Vec<RiskViolation>, StrategyEngineError> {
        match self.risk_calculator.check_signal(signal).await {
            Ok(result) => Ok(result.violations),
            Err(err) => Err(StrategyEngineError::RiskCheckFailed(err.to_string())),
        }
    }
    
    /// Validate basic signal properties
    fn validate_signal(&self, signal: &Signal, config: &StrategyEngineConfig) -> Result<(), StrategyEngineError> {
        // Check if price is required but missing
        if config.require_price && signal.price.is_none() {
            return Err(StrategyEngineError::InvalidParameters(
                "Signal price is required but missing".to_string()
            ));
        }
        
        // Check confidence within range
        if signal.confidence < 0.0 || signal.confidence > 1.0 {
            return Err(StrategyEngineError::InvalidParameters(
                format!("Invalid confidence value: {}", signal.confidence)
            ));
        }
        
        // Check strength within range
        if signal.strength < 0.0 || signal.strength > 1.0 {
            return Err(StrategyEngineError::InvalidParameters(
                format!("Invalid strength value: {}", signal.strength)
            ));
        }
        
        Ok(())
    }
    
    /// Create an order from a signal
    fn create_order_from_signal(&self, signal: &Signal, evaluation: &SignalEvaluation) -> Result<Order, StrategyEngineError> {
        let config = self.config.read().unwrap();
        
        // Calculate position size
        let position_size = if config.confidence_based_sizing {
            evaluation.recommended_position_size_pct
        } else {
            // Use a fixed size if confidence-based sizing is disabled
            0.05 // 5% default position size
        };
        
        // Create order
        let order = Order {
            id: Uuid::new_v4().to_string(),
            symbol: signal.symbol.clone(),
            price: signal.price,
            amount: position_size, // This will need to be scaled by available capital
            direction: signal.direction,
            signal_id: Some(signal.id.clone()),
            strategy_id: Some(signal.strategy_id.clone()),
            max_slippage_pct: Some(config.max_slippage_pct),
            is_dryrun: config.dryrun_mode,
            latency_budget_ms: Some(evaluation.latency_budget_ms),
            additional_params: HashMap::new(),
        };
        
        Ok(order)
    }
    
    /// Calculate position size as percentage of available capital
    fn calculate_position_size_pct(&self, signal: &Signal) -> f64 {
        // Base position size varies by risk grade
        let base_size = match signal.risk_grade {
            RiskGrade::Low => 0.1, // 10%
            RiskGrade::Medium => 0.05, // 5%
            RiskGrade::High => 0.025, // 2.5%
            RiskGrade::Exceptional => 0.01, // 1%
        };
        
        // Scale by confidence
        let confidence_factor = signal.confidence;
        
        // Scale by strength
        let strength_factor = signal.strength;
        
        // Calculate final position size
        let position_size = base_size * confidence_factor * strength_factor;
        
        // Cap at 20% maximum
        position_size.min(0.2)
    }
    
    /// Update metrics for successful execution
    async fn update_metrics_for_execution(
        &self,
        signal: &Signal,
        evaluation: &SignalEvaluation,
        execution_result: &ExecutionResult,
        execution_latency: u64,
    ) {
        // Calculate metrics
        let mut metrics = self.calculate_signal_metrics(signal, Some(execution_result));
        
        // Add evaluation specific metrics
        metrics.additional_metrics.insert("evaluation_trust_score".to_string(), evaluation.trust_score);
        metrics.additional_metrics.insert("evaluation_execution_probability".to_string(), evaluation.execution_probability);
        
        // Add latency metrics
        metrics.additional_metrics.insert("engine_execution_latency_ms".to_string(), execution_latency as f64);
        
        // Store metrics
        self.store_signal_metrics(metrics);
    }
    
    /// Update metrics for failed execution
    async fn update_metrics_for_failed_execution(
        &self,
        signal: &Signal,
        evaluation: &SignalEvaluation,
        error: &ExecutionFailureReason,
    ) {
        // Calculate metrics
        let mut metrics = self.calculate_signal_metrics(signal, None);
        
        // Update success and status
        metrics.success = false;
        metrics.status = SignalStatus::Failed;
        
        // Add evaluation specific metrics
        metrics.additional_metrics.insert("evaluation_trust_score".to_string(), evaluation.trust_score);
        metrics.additional_metrics.insert("evaluation_execution_probability".to_string(), evaluation.execution_probability);
        
        // Add error information
        metrics.additional_metrics.insert("error_code".to_string(), match error {
            ExecutionFailureReason::Timeout => 1.0,
            ExecutionFailureReason::RejectedByExchange => 2.0,
            ExecutionFailureReason::InsufficientFunds => 3.0,
            ExecutionFailureReason::PriceOutOfRange => 4.0,
            ExecutionFailureReason::Throttled => 5.0,
            ExecutionFailureReason::Unknown => 6.0,
            ExecutionFailureReason::ConnectionError => 7.0,
            ExecutionFailureReason::InternalError => 8.0,
            ExecutionFailureReason::CancelledByUser => 9.0,
            ExecutionFailureReason::LimitExceeded => 10.0,
        });
        
        // Store metrics
        self.store_signal_metrics(metrics);
    }
}

/// Create a singleton strategy engine
pub fn create_strategy_engine(
    router: Arc<SmartOrderRouter>,
    risk_calculator: Arc<RiskCalculator>,
    config: Option<StrategyEngineConfig>,
) -> Arc<StrategyEngine> {
    Arc::new(StrategyEngine::new(
        router,
        risk_calculator,
        config.unwrap_or_default(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strategy::{Signal, SignalAction};
    use crate::risk::PositionDirection;
    use mock_it::Matcher;
    use std::sync::Mutex;
    
    struct MockRouter {
        execute_result: Mutex<Option<Result<ExecutionResult, ExecutionFailureReason>>>,
    }
    
    impl MockRouter {
        fn new(result: Option<Result<ExecutionResult, ExecutionFailureReason>>) -> Self {
            Self {
                execute_result: Mutex::new(result),
            }
        }
        
        fn set_result(&self, result: Result<ExecutionResult, ExecutionFailureReason>) {
            let mut execute_result = self.execute_result.lock().unwrap();
            *execute_result = Some(result);
        }
    }
    
    impl SmartOrderRouter for MockRouter {
        async fn execute_order(&self, _order: Order) -> Result<ExecutionResult, ExecutionFailureReason> {
            let execute_result = self.execute_result.lock().unwrap();
            match &*execute_result {
                Some(result) => result.clone(),
                None => Err(ExecutionFailureReason::Unknown),
            }
        }
        
        // Other methods...
        // For the test, we only need execute_order
    }
    
    struct MockRiskCalculator {
        check_result: Mutex<Option<Result<RiskCheckResult, RiskCalculatorError>>>,
    }
    
    impl MockRiskCalculator {
        fn new(result: Option<Result<RiskCheckResult, RiskCalculatorError>>) -> Self {
            Self {
                check_result: Mutex::new(result),
            }
        }
        
        fn set_result(&self, result: Result<RiskCheckResult, RiskCalculatorError>) {
            let mut check_result = self.check_result.lock().unwrap();
            *check_result = Some(result);
        }
    }
    
    impl RiskCalculator for MockRiskCalculator {
        async fn check_signal(&self, _signal: &Signal) -> Result<RiskCheckResult, RiskCalculatorError> {
            let check_result = self.check_result.lock().unwrap();
            match &*check_result {
                Some(result) => result.clone(),
                None => Ok(RiskCheckResult { violations: vec![] }),
            }
        }
        
        // Other methods...
        // For the test, we only need check_signal
    }
    
    #[tokio::test]
    async fn test_execute_strategy_success() {
        // Create a mock execution result
        let execution_result = ExecutionResult {
            id: "test-execution".to_string(),
            signal_id: "test-signal".to_string(),
            order_id: Some("test-order".to_string()),
            status: ExecutionStatus::Completed,
            executed_quantity: Some(1.0),
            average_price: Some(100.0),
            timestamp: Utc::now(),
            // ... other fields with default values
        };
        
        // Create mock router and risk calculator
        let router = Arc::new(MockRouter::new(Some(Ok(execution_result.clone()))));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        
        // Create strategy engine
        let engine = create_strategy_engine(
            router.clone(),
            risk_calculator.clone(),
            None,
        );
        
        // Create a test signal
        let signal = Signal::new(
            "test-strategy".to_string(),
            "BTC/USD".to_string(),
            SignalAction::Enter,
        )
        .with_direction(PositionDirection::Long)
        .with_confidence(0.8)
        .with_strength(0.9)
        .with_price(100.0);
        
        // Execute strategy
        let result = engine.execute_strategy(&signal).await;
        
        // Check result
        assert!(result.is_ok());
        let execution = result.unwrap();
        assert_eq!(execution.status, ExecutionStatus::Completed);
        
        // Check metrics were stored
        let metrics = engine.get_signal_metrics(&signal.id).unwrap();
        assert_eq!(metrics.signal_id, signal.id);
        assert_eq!(metrics.success, true);
    }
    
    #[tokio::test]
    async fn test_evaluate_signal() {
        // Create mock router and risk calculator
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        
        // Create strategy engine
        let engine = create_strategy_engine(
            router.clone(),
            risk_calculator.clone(),
            None,
        );
        
        // Create a test signal
        let signal = Signal::new(
            "test-strategy".to_string(),
            "BTC/USD".to_string(),
            SignalAction::Enter,
        )
        .with_direction(PositionDirection::Long)
        .with_confidence(0.8)
        .with_strength(0.9)
        .with_price(100.0);
        
        // Evaluate signal
        let result = engine.evaluate_signal(&signal).await;
        
        // Check result
        assert!(result.is_ok());
        let evaluation = result.unwrap();
        assert_eq!(evaluation.signal_id, signal.id);
        assert!(evaluation.passed);
        assert!(evaluation.execution_probability > 0.5);
    }
    
    #[tokio::test]
    async fn test_calculate_signal_metrics() {
        // Create mock router and risk calculator
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        
        // Create strategy engine
        let engine = create_strategy_engine(
            router.clone(),
            risk_calculator.clone(),
            None,
        );
        
        // Create a test signal
        let signal = Signal::new(
            "test-strategy".to_string(),
            "BTC/USD".to_string(),
            SignalAction::Enter,
        )
        .with_direction(PositionDirection::Long)
        .with_confidence(0.8)
        .with_strength(0.9)
        .with_price(100.0);
        
        // Create a mock execution result
        let execution_result = ExecutionResult {
            id: "test-execution".to_string(),
            signal_id: signal.id.clone(),
            order_id: Some("test-order".to_string()),
            status: ExecutionStatus::Completed,
            executed_quantity: Some(1.0),
            average_price: Some(101.0), // 1% slippage
            timestamp: Utc::now(),
            // ... other fields with default values
        };
        
        // Calculate metrics
        let metrics = engine.calculate_signal_metrics(&signal, Some(&execution_result));
        
        // Check metrics
        assert_eq!(metrics.signal_id, signal.id);
        assert_eq!(metrics.strategy_id, signal.strategy_id);
        assert_eq!(metrics.symbol, signal.symbol);
        assert_eq!(metrics.confidence, 0.8);
        assert_eq!(metrics.strength, 0.9);
        assert_eq!(metrics.success, true);
        assert_eq!(metrics.price, Some(100.0));
        assert_eq!(metrics.execution_price, Some(101.0));
        
        // Check slippage calculation
        assert!(metrics.slippage_pct.is_some());
        let slippage = metrics.slippage_pct.unwrap();
        assert!(slippage > 0.0); // Positive slippage for long position with higher execution price
    }

    #[tokio::test]
    async fn test_execute_strategy_risk_check_fail() {
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(Some(Err(RiskCalculatorError::Violation("Risk fail".to_string())))));
        let engine = create_strategy_engine(router, risk_calculator, None);
        let signal = Signal::new("test-strategy".to_string(), "BTC/USD".to_string(), SignalAction::Enter)
            .with_direction(PositionDirection::Long)
            .with_confidence(0.8)
            .with_strength(0.9)
            .with_price(100.0);
        let result = engine.execute_strategy(&signal).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        match err {
            StrategyEngineError::RiskCheckFailed(_) => {},
            _ => panic!("Expected RiskCheckFailed error"),
        }
    }

    #[tokio::test]
    async fn test_execute_strategy_trust_score_too_low() {
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        let mut config = StrategyEngineConfig::default();
        config.min_trust_score = 0.95;
        let engine = create_strategy_engine(router, risk_calculator, Some(config));
        let signal = Signal::new("test-strategy".to_string(), "BTC/USD".to_string(), SignalAction::Enter)
            .with_direction(PositionDirection::Long)
            .with_confidence(0.5)
            .with_strength(0.5)
            .with_price(100.0);
        let result = engine.execute_strategy(&signal).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        match err {
            StrategyEngineError::TrustScoreTooLow(_) => {},
            _ => panic!("Expected TrustScoreTooLow error"),
        }
    }

    #[tokio::test]
    async fn test_execute_strategy_execution_fail() {
        let router = Arc::new(MockRouter::new(Some(Err(ExecutionFailureReason::Unknown))));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        let engine = create_strategy_engine(router, risk_calculator, None);
        let signal = Signal::new("test-strategy".to_string(), "BTC/USD".to_string(), SignalAction::Enter)
            .with_direction(PositionDirection::Long)
            .with_confidence(0.8)
            .with_strength(0.9)
            .with_price(100.0);
        let result = engine.execute_strategy(&signal).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        match err {
            StrategyEngineError::ExecutionFailed(_) => {},
            _ => panic!("Expected ExecutionFailed error"),
        }
    }

    #[tokio::test]
    async fn test_execute_strategy_invalid_parameters() {
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        let engine = create_strategy_engine(router, risk_calculator, None);
        // Create a signal with missing price (if required by config)
        let mut config = StrategyEngineConfig::default();
        config.require_price = true;
        engine.update_config(config);
        let signal = Signal::new("test-strategy".to_string(), "BTC/USD".to_string(), SignalAction::Enter)
            .with_direction(PositionDirection::Long)
            .with_confidence(0.8)
            .with_strength(0.9);
        let result = engine.execute_strategy(&signal).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        match err {
            StrategyEngineError::InvalidParameters(_) => {},
            _ => panic!("Expected InvalidParameters error"),
        }
    }

    #[tokio::test]
    async fn test_update_and_get_config() {
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        let engine = create_strategy_engine(router, risk_calculator, None);
        let mut config = StrategyEngineConfig::default();
        config.dryrun_mode = true;
        engine.update_config(config.clone());
        let got = engine.get_config();
        assert_eq!(got.dryrun_mode, true);
        assert_eq!(got, config);
    }

    #[tokio::test]
    async fn test_store_and_get_signal_metrics() {
        let router = Arc::new(MockRouter::new(None));
        let risk_calculator = Arc::new(MockRiskCalculator::new(None));
        let engine = create_strategy_engine(router, risk_calculator, None);
        let metrics = SignalMetrics {
            signal_id: "sig1".to_string(),
            strategy_id: "strat1".to_string(),
            symbol: Symbol::from("BTC/USD"),
            generation_time: Utc::now(),
            execution_time: None,
            execution_latency_ms: None,
            confidence: 0.9,
            strength: 0.8,
            success: false,
            price: Some(100.0),
            execution_price: None,
            slippage_pct: None,
            direction: PositionDirection::Long,
            position_size: Some(1.0),
            trust_score: Some(0.7),
            status: SignalStatus::Pending,
            risk_grade: RiskGrade::Medium,
            execution_horizon: ExecutionHorizon::ShortTerm,
            pnl: None,
            additional_metrics: HashMap::new(),
        };
        engine.store_signal_metrics(metrics.clone());
        let got = engine.get_signal_metrics("sig1");
        assert!(got.is_some());
        assert_eq!(got.unwrap().signal_id, "sig1");
    }
} 