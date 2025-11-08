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
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration as StdDuration;
use std::any::Any;
use std::fmt;

use async_trait::async_trait;
use tokio::time;
use tracing::{debug, error, info, warn, trace};
use chrono::Utc;
use thiserror::Error;
use futures::executor;
use serde_json;
use serde::{Serialize, Deserialize};
use uuid::Uuid;

use crate::market::{MarketData, Symbol};
use crate::risk::{RiskManager, RiskError, RiskMetrics, PositionSizing, MarketRiskAssessment};
use crate::execution::{ExecutionResult, ExecutionService, ExecutionStatus, ExecutionRequest, ExecutionMode, ExecutionError, ExecutionLog, ExecutionOutcomeReason};
use crate::telemetry::TelemetryReporter;
use crate::strategy::{
    Strategy, Signal, EntropyInjector, StrategyError, 
    SignalStatus, StrategyHealth, StrategyPerformance, StrategyTrustState, StrategyId, RiskProfile, SignalAction
};
use crate::drawdown::DrawdownTracker;
use crate::execution_metrics::{ExecutionMetricsCollector};
use crate::strategy_attribution::{AttributionEngine, StrategyAttribution};
use crate::factor_analysis::{FactorAnalysisEngine, FactorAlert, FactorAlertType, StrategyFactorProfile};
use crate::governance::{GovernanceEnforcer, GovernanceActionType, EnforcementResult};

/// Errors that can occur during strategy execution
#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error("Strategy error: {0}")]
    Strategy(#[from] StrategyError),
    
    #[error("Risk error: {0}")]
    Risk(#[from] RiskError),
    
    #[error("Execution error: {0}")]
    Execution(String),
    
    #[error("Strategy not found: {name}")]
    StrategyNotFound { name: String },
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Configuration for the strategy executor
#[derive(Debug, Clone)]
pub struct StrategyExecutorConfig {
    /// Time between execution cycles in milliseconds
    pub execution_interval_ms: u64,
    /// Default TTL for signals in seconds
    pub default_signal_ttl_seconds: i32,
    /// Whether to apply entropy to signals
    pub apply_entropy: bool,
    /// Whether to validate market conditions before execution
    pub validate_market_conditions: bool,
    /// Whether to skip failed strategies in next cycle
    pub skip_failed_strategies: bool,
    /// Maximum number of consecutive errors before pausing a strategy
    pub max_consecutive_errors: usize,
    /// Timeout for strategy execution in milliseconds
    pub strategy_execution_timeout_ms: u64,
    /// Execution mode (live, paper, sandbox)
    pub execution_mode: ExecutionMode,
    /// Trust policy configuration
    pub trust_policy: TrustPolicyConfig,
}

/// Trust policy thresholds
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustPolicyConfig {
    /// Below this, execution is rejected
    pub hard_rejection_threshold: f64,
    /// Below this, warning is emitted
    pub soft_warning_threshold: f64,
    /// If true, allow manual override via admin
    pub allow_override: bool,
    /// Whether trust-based filtering is enabled
    pub enabled: bool,
}

impl Default for TrustPolicyConfig {
    fn default() -> Self {
        Self {
            hard_rejection_threshold: 0.3,
            soft_warning_threshold: 0.5,
            allow_override: true,
            enabled: true,
        }
    }
}

impl Default for StrategyExecutorConfig {
    fn default() -> Self {
        Self {
            execution_interval_ms: 5000, // 5 seconds
            default_signal_ttl_seconds: 60,
            apply_entropy: true,
            validate_market_conditions: true,
            skip_failed_strategies: false,
            max_consecutive_errors: 3,
            strategy_execution_timeout_ms: 2000,
            execution_mode: ExecutionMode::Paper,
            trust_policy: TrustPolicyConfig::default(),
        }
    }
}

/// Reasons for rejecting an execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExecutionRejection {
    /// Rejected due to risk filtering
    RiskFiltered { reason: String },
    /// Rejected due to trust score gate
    TrustGate { reason: String, score: f64 },
    /// Rejected due to market conditions
    MarketConditions { reason: String },
    /// Rejected due to manual override
    ManualOverride { reason: String },
    /// Rejected due to governance rule violation
    GovernanceRule { reason: String, code: String, severity: String },
    /// Rejected due to other reasons
    Other { reason: String },
}

/// Tracks the state of a strategy's execution
#[derive(Debug, Clone)]
struct StrategyExecutionState {
    /// Current health status
    health: StrategyHealth,
    /// Number of consecutive errors
    consecutive_errors: usize,
    /// Last execution timestamp
    last_execution: chrono::DateTime<chrono::Utc>,
    /// Last successful execution timestamp
    last_successful_execution: Option<chrono::DateTime<chrono::Utc>>,
    /// Latest performance metrics
    performance: StrategyPerformance,
    /// Trust state for the strategy
    trust_state: StrategyTrustState,
    /// Optional metadata storage for strategy-specific data
    metadata: Option<HashMap<String, String>>,
    /// Last factor analysis timestamp
    last_factor_analysis: Option<chrono::DateTime<chrono::Utc>>,
}

impl Default for StrategyExecutionState {
    fn default() -> Self {
        Self {
            health: StrategyHealth::Healthy,
            consecutive_errors: 0,
            last_execution: chrono::Utc::now(),
            last_successful_execution: None,
            performance: StrategyPerformance::default(),
            trust_state: StrategyTrustState::default(),
            metadata: Some(HashMap::new()),
            last_factor_analysis: None,
        }
    }
}

/// Executes strategies and manages their lifecycle
pub struct StrategyExecutor {
    /// Available strategies with thread-safe access
    strategies: Arc<RwLock<Vec<Box<dyn Strategy>>>>,
    /// Risk management service
    risk_manager: Arc<dyn RiskManager>,
    /// Entropy injection service for unpredictability
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    /// Telemetry reporting service
    telemetry: Arc<TelemetryReporter>,
    /// Execution service for sending signals to Guardian nodes
    execution_service: Arc<ExecutionService>,
    /// Mutable strategy states for updating after execution
    strategy_states: Arc<Mutex<HashMap<StrategyId, Box<dyn Strategy>>>>,
    /// Strategy execution state tracking
    execution_states: Arc<RwLock<HashMap<StrategyId, StrategyExecutionState>>>,
    /// Configuration
    config: StrategyExecutorConfig,
    /// Optional drawdown tracker for risk adaptation
    drawdown_tracker: Option<Arc<dyn DrawdownTracker>>,
    /// Optional execution metrics collector
    execution_metrics: Option<Arc<dyn ExecutionMetricsCollector>>,
    /// Optional attribution engine for performance decomposition
    attribution_engine: Option<Arc<dyn AttributionEngine>>,
    /// Optional factor analysis engine for factor exposure tracking
    factor_analysis_engine: Option<Arc<dyn FactorAnalysisEngine>>,
    /// Optional governance enforcer for meta-protocol rule enforcement
    governance_enforcer: Option<Arc<dyn GovernanceEnforcer>>,
}

impl StrategyExecutor {
    /// Creates a new StrategyExecutor with the specified dependencies
    pub fn new(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
    ) -> Self {
        Self::with_config(
            strategies,
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            StrategyExecutorConfig::default(),
            None,
        )
    }
    
    /// Creates a new StrategyExecutor with drawdown tracking
    pub fn with_drawdown_tracker(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        drawdown_tracker: Arc<dyn DrawdownTracker>,
    ) -> Self {
        Self::with_config(
            strategies,
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            StrategyExecutorConfig::default(),
            Some(drawdown_tracker),
        )
    }

    /// Creates a new StrategyExecutor with custom configuration
    pub fn with_config(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        config: StrategyExecutorConfig,
        drawdown_tracker: Option<Arc<dyn DrawdownTracker>>,
    ) -> Self {
        // Initialize the strategies map
        let mut states = HashMap::new();
        for strategy in &strategies {
            let strategy_id = strategy.name().to_string();
            states.insert(strategy_id, StrategyExecutionState::default());
        }

        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(states)),
            config,
            drawdown_tracker,
            execution_metrics: None,
            attribution_engine: None,
            factor_analysis_engine: None,
            governance_enforcer: None,
        }
    }

    /// Create a new strategy executor with execution metrics collector
    pub fn with_execution_metrics(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        execution_metrics: Arc<dyn ExecutionMetricsCollector>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config: StrategyExecutorConfig::default(),
            drawdown_tracker: None,
            execution_metrics: Some(execution_metrics),
            attribution_engine: None,
            factor_analysis_engine: None,
            governance_enforcer: None,
        }
    }

    /// Create with both drawdown tracker and execution metrics
    pub fn with_drawdown_and_metrics(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        drawdown_tracker: Arc<dyn DrawdownTracker>,
        execution_metrics: Arc<dyn ExecutionMetricsCollector>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config: StrategyExecutorConfig::default(),
            drawdown_tracker: Some(drawdown_tracker),
            execution_metrics: Some(execution_metrics),
            attribution_engine: None,
            factor_analysis_engine: None,
            governance_enforcer: None,
        }
    }

    /// Create with attribution engine
    pub fn with_attribution_engine(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        attribution_engine: Arc<dyn AttributionEngine>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config: StrategyExecutorConfig::default(),
            drawdown_tracker: None,
            execution_metrics: None,
            attribution_engine: Some(attribution_engine),
            factor_analysis_engine: None,
            governance_enforcer: None,
        }
    }
    
    /// Create with all components including attribution engine
    pub fn with_all_components(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        config: StrategyExecutorConfig,
        drawdown_tracker: Option<Arc<dyn DrawdownTracker>>,
        execution_metrics: Option<Arc<dyn ExecutionMetricsCollector>>,
        attribution_engine: Option<Arc<dyn AttributionEngine>>,
        factor_analysis_engine: Option<Arc<dyn FactorAnalysisEngine>>,
        governance_enforcer: Option<Arc<dyn GovernanceEnforcer>>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config,
            drawdown_tracker,
            execution_metrics,
            attribution_engine,
            factor_analysis_engine,
            governance_enforcer,
        }
    }

    /// Create a fully configured executor with all components
    pub fn with_full_config(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        config: StrategyExecutorConfig,
        drawdown_tracker: Option<Arc<dyn DrawdownTracker>>,
        execution_metrics: Option<Arc<dyn ExecutionMetricsCollector>>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config,
            drawdown_tracker,
            execution_metrics,
            attribution_engine: None,
            factor_analysis_engine: None,
            governance_enforcer: None,
        }
    }

    /// Create with factor analysis engine
    pub fn with_factor_analysis_engine(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        factor_analysis_engine: Arc<dyn FactorAnalysisEngine>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config: StrategyExecutorConfig::default(),
            drawdown_tracker: None,
            execution_metrics: None,
            attribution_engine: None,
            factor_analysis_engine: Some(factor_analysis_engine),
            governance_enforcer: None,
        }
    }

    /// Create with governance enforcer for meta-protocol rule enforcement
    pub fn with_governance_enforcer(
        strategies: Vec<Box<dyn Strategy>>,
        risk_manager: Arc<dyn RiskManager>,
        entropy_injector: Option<Arc<dyn EntropyInjector>>,
        telemetry: Arc<TelemetryReporter>,
        execution_service: Arc<ExecutionService>,
        governance_enforcer: Arc<dyn GovernanceEnforcer>,
    ) -> Self {
        Self {
            strategies: Arc::new(RwLock::new(strategies)),
            risk_manager,
            entropy_injector,
            telemetry,
            execution_service,
            strategy_states: Arc::new(Mutex::new(HashMap::new())),
            execution_states: Arc::new(RwLock::new(HashMap::new())),
            config: StrategyExecutorConfig::default(),
            drawdown_tracker: None,
            execution_metrics: None,
            attribution_engine: None,
            factor_analysis_engine: None,
            governance_enforcer: Some(governance_enforcer),
        }
    }

    /// Executes a complete strategy cycle, analyzing market data and generating signals
    pub async fn execute_cycle(&self, market_data: &MarketData) -> Vec<ExecutionResult> {
        let mut results = Vec::new();
        
        // Get a read lock on strategies
        let strategies = match self.strategies.read() {
            Ok(guard) => guard,
            Err(e) => {
                error!("Failed to acquire read lock on strategies: {}", e);
                return results;
            }
        };
        
        for strategy in strategies.iter() {
            let strategy_id = strategy.id();
            
            // Check if we should skip this strategy due to health
            if let Some(should_skip) = self.should_skip_strategy(&strategy_id) {
                if should_skip {
                    debug!("Skipping strategy {} due to health status", strategy_id);
                    continue;
                }
            }
            
            // Check if strategy is disabled by risk manager
            if self.risk_manager.is_strategy_disabled(&strategy_id) {
                debug!("Skipping strategy {} due to risk cooldown period", strategy_id);
                self.telemetry.report_risk_limit(
                    &strategy_id,
                    &RiskError::StrategyDisabled(format!("Strategy {} is in cooldown period", strategy_id))
                ).await;
                continue;
            }
            
            // Check trust score if trust policy is enabled
            if self.config.trust_policy.enabled {
                if let Some(risk_metrics) = self.risk_manager.get_risk_metrics(&strategy_id) {
                    let trust_score = risk_metrics.trust_score;
                    
                    // Hard rejection if trust score below threshold
                    if trust_score < self.config.trust_policy.hard_rejection_threshold {
                        let rejection_reason = format!("Trust score ({:.2}) below critical threshold ({:.2})", 
                                                      trust_score, self.config.trust_policy.hard_rejection_threshold);
                        
                        info!("Rejecting strategy {} execution: {}", strategy_id, rejection_reason);
                        
                        // Create a rejection result
                        let rejection = ExecutionRejection::TrustGate {
                            reason: rejection_reason.clone(),
                            score: trust_score,
                        };
                        
                        // Report the rejection via telemetry
                        self.telemetry.report_trust_rejection(&strategy_id, &rejection).await;
                        
                        // Create an ExecutionResult to indicate the rejection
                        let result = ExecutionResult::trust_rejection(
                            Uuid::new_v4().to_string(), // No request ID yet
                            strategy_id.clone(),
                            rejection_reason,
                            trust_score,
                        );
                        
                        // Add to results
                        results.push(result);
                        
                        continue;
                    }
                    
                    // Soft warning if trust score below warning threshold
                    if trust_score < self.config.trust_policy.soft_warning_threshold {
                        let warning_message = format!("Trust score ({:.2}) below warning threshold ({:.2})", 
                                                     trust_score, self.config.trust_policy.soft_warning_threshold);
                        
                        debug!("Trust warning for strategy {}: {}", strategy_id, warning_message);
                        
                        // Emit soft warning via telemetry 
                        self.telemetry.emit_soft_warning(&strategy_id, trust_score, warning_message.clone()).await;
                    }
                }
            }
            
            // Check governance rules if enforcer is enabled
            if let Some(governance_enforcer) = &self.governance_enforcer {
                // Prepare context for governance check
                let mut context = HashMap::new();
                
                // Add trust score for governance rules
                if let Some(risk_metrics) = self.risk_manager.get_risk_metrics(&strategy_id) {
                    context.insert("trust_score".to_string(), serde_json::to_value(risk_metrics.trust_score).unwrap());
                }
                
                // Add strategy information
                context.insert("strategy_id".to_string(), serde_json::to_value(&strategy_id).unwrap());
                context.insert("action".to_string(), serde_json::to_value("execute_strategy").unwrap());
                
                // Check if the strategy is allowed to execute
                let enforcement_result = governance_enforcer.enforce_rules(
                    &strategy_id,
                    GovernanceActionType::Execute,
                    context
                ).await;
                
                if !enforcement_result.allowed {
                    // Strategy was rejected by governance rules
                    let violations = enforcement_result.violations;
                    
                    if violations.is_empty() {
                        warn!("Strategy {} was rejected by governance rules but no violations were reported", strategy_id);
                        continue;
                    }
                    
                    // Get the most severe violation
                    let primary_violation = &violations[0];
                    let rejection_reason = primary_violation.reason.clone();
                    
                    info!("Rejecting strategy {} execution due to governance rules: {}", 
                          strategy_id, rejection_reason);
                    
                    // Create a rejection result
                    let rejection = ExecutionRejection::GovernanceRule {
                        reason: rejection_reason.clone(),
                        code: primary_violation.code.clone(),
                        severity: format!("{}", primary_violation.severity),
                    };
                    
                    // Report the rejection via telemetry
                    let mut data = HashMap::new();
                    data.insert("strategy_id".to_string(), serde_json::to_value(&strategy_id).unwrap());
                    data.insert("reason".to_string(), serde_json::to_value(&rejection_reason).unwrap());
                    data.insert("code".to_string(), serde_json::to_value(&primary_violation.code).unwrap());
                    data.insert("severity".to_string(), serde_json::to_value(&primary_violation.severity).unwrap());
                    self.telemetry.report_custom("governance_rule_violation", data).await;
                    
                    // Create an ExecutionResult to indicate the rejection
                    let result = ExecutionResult::governance_rule_rejection(
                        Uuid::new_v4().to_string(), // No request ID yet
                        strategy_id.clone(),
                        rejection_reason,
                        primary_violation.code.clone(),
                        format!("{}", primary_violation.severity),
                    );
                    
                    // Add to results
                    results.push(result);
                    
                    continue;
                }
            }
            
            // Report telemetry before execution
            self.telemetry.report_execution_start(&strategy_id).await;
            
            // Update strategy execution state
            self.update_execution_state(&strategy_id, |state| {
                state.last_execution = chrono::Utc::now();
            });
            
            // Analyze market data with strategy
            let signal = match self.execute_strategy_with_timeout(strategy.as_ref(), market_data).await {
                Ok(Some(signal)) => signal,
                Ok(None) => {
                    // No signal generated, continue to next strategy
                    self.telemetry.report_no_signal(&strategy_id).await;
                    self.update_execution_state(&strategy_id, |state| {
                        state.consecutive_errors = 0;
                    });
                    continue;
                },
                Err(e) => {
                    self.telemetry.report_error(&strategy_id, &e).await;
                    self.handle_strategy_error(&strategy_id, &e).await;
                    continue;
                }
            };
            
            // Apply entropy to signal (for unpredictability) if enabled
            let modified_signal = if self.config.apply_entropy {
                if let Some(injector) = &self.entropy_injector {
                    let mut signal_copy = signal.clone();
                    let config = injector.get_config();
                    injector.inject_entropy(&mut signal_copy, config);
                    signal_copy
                } else {
                    signal
                }
            } else {
                signal
            };
            
            // Set TTL if not already set
            let mut final_signal = modified_signal.clone();
            if final_signal.ttl_seconds <= 0 {
                final_signal.ttl_seconds = self.config.default_signal_ttl_seconds as i64;
            }
            
            // Update signal status
            final_signal.update_status(SignalStatus::Created);
            
            // Validate signal with risk manager
            if let Err(risk_error) = self.risk_manager.validate_signal(&strategy_id, &final_signal, market_data) {
                final_signal.update_status(SignalStatus::Rejected);
                self.telemetry.report_risk_limit(&strategy_id, &risk_error).await;
                
                // Log rejection reason
                info!("Signal from strategy {} rejected by risk manager: {}", strategy_id, risk_error);
                continue;
            }
            
            // Signal passed risk validation, calculate position size
            let position_sizing = self.risk_manager.calculate_position_size(&strategy_id, &final_signal, market_data);
            
            // Set adjusted position size from risk manager
            final_signal.set_size(position_sizing.adjusted_size);
            
            // Update signal status to validated
            final_signal.update_status(SignalStatus::Validated);
            
            // Log the position sizing decision
            debug!(
                "Position sizing for strategy {}: base={:.4}, adjusted={:.4}, risk_factor={:.2}, max={:.4}",
                strategy_id,
                position_sizing.base_size,
                position_sizing.adjusted_size,
                position_sizing.risk_factor,
                position_sizing.max_size
            );
            
            // Execute the signal
            match self.execute_signal(&final_signal, position_sizing).await {
                Ok(result) => {
                    // Process execution result
                    self.update_strategy_state(&strategy_id, &final_signal, &result).await;
                    results.push(result);
                }
                Err(e) => {
                    error!("Failed to execute signal for strategy {}: {}", strategy_id, e);
                    self.telemetry.report_execution_error(&strategy_id, &e.to_string()).await;
                }
            }
        }
        
        results
    }
    
    /// Execute a strategy with timeout protection
    async fn execute_strategy_with_timeout(&self, strategy: &dyn Strategy, market_data: &MarketData) 
        -> Result<Option<Signal>, StrategyError> {
        // Create a timeout future
        let timeout_duration = StdDuration::from_millis(self.config.strategy_execution_timeout_ms);
        
        // Execute the strategy with timeout
        match time::timeout(timeout_duration, strategy.generate_signal(market_data)).await {
            Ok(result) => {
                // Strategy completed within timeout
                result.map_err(|e| StrategyError::SignalGenerationError(e))
            },
            Err(_) => {
                // Strategy execution timed out
                Err(StrategyError::Timeout(format!(
                    "Strategy {} timed out after {}ms", 
                    strategy.id(), 
                    self.config.strategy_execution_timeout_ms
                )))
            }
        }
    }
    
    /// Handle strategy errors and update metrics
    async fn handle_strategy_error(&self, strategy_id: &StrategyId, error: &StrategyError) {
        // Update execution state to track errors
        self.update_execution_state(strategy_id, |state| {
            state.consecutive_errors += 1;
            
            // Update health status based on consecutive errors
            if state.consecutive_errors >= self.config.max_consecutive_errors {
                state.health = StrategyHealth::Critical;
                warn!("Strategy {} health set to CRITICAL after {} consecutive errors", 
                     strategy_id, state.consecutive_errors);
            } else if state.consecutive_errors > 0 {
                state.health = StrategyHealth::Degraded;
                debug!("Strategy {} health set to DEGRADED after {} errors", 
                     strategy_id, state.consecutive_errors);
            }
        });
        
        // Log the error
        error!("Strategy {} error: {}", strategy_id, error);
    }
    
    /// Update execution state for a strategy
    fn update_execution_state<F>(&self, strategy_id: &StrategyId, update_fn: F)
    where
        F: FnOnce(&mut StrategyExecutionState)
    {
        if let Ok(mut states) = self.execution_states.write() {
            if let Some(state) = states.get_mut(strategy_id) {
                update_fn(state);
            } else {
                // Create a new state if not found
                let mut new_state = StrategyExecutionState::default();
                update_fn(&mut new_state);
                states.insert(strategy_id.clone(), new_state);
            }
        } else {
            error!("Failed to acquire write lock on execution states for strategy {}", strategy_id);
        }
    }
    
    /// Check if a strategy should be skipped due to health status
    fn should_skip_strategy(&self, strategy_id: &StrategyId) -> Option<bool> {
        if !self.config.skip_failed_strategies {
            return Some(false);
        }
        
        if let Ok(states) = self.execution_states.read() {
            if let Some(state) = states.get(strategy_id) {
                return Some(matches!(state.health, StrategyHealth::Critical | StrategyHealth::Paused));
            }
        }
        
        None
    }
    
    /// Execute a validated signal
    async fn execute_signal(&self, signal: &Signal, position_sizing: PositionSizing) -> Result<ExecutionResult, ExecutorError> {
        debug!("Executing signal {} from strategy {}", signal.id, signal.strategy_id);
        
        // Create execution request
        let mut request = ExecutionRequest::new(signal.clone(), self.config.execution_mode);
        
        // Add position sizing information to the request parameters
        request = request
            .with_parameter("base_size", serde_json::to_value(position_sizing.base_size).unwrap())
            .with_parameter("adjusted_size", serde_json::to_value(position_sizing.adjusted_size).unwrap())
            .with_parameter("risk_factor", serde_json::to_value(position_sizing.risk_factor).unwrap())
            .with_parameter("max_size", serde_json::to_value(position_sizing.max_size).unwrap());
        
        // Execute the request
        let result = self.execution_service.execute(request).await
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;
        
        // Log execution result
        match result.status {
            ExecutionStatus::Completed => {
                info!(
                    "Signal {} from strategy {} executed successfully: qty={:.4}, price={:.2}",
                    signal.id,
                    signal.strategy_id,
                    result.executed_quantity.unwrap_or(0.0),
                    result.average_price.unwrap_or(0.0)
                );
            }
            ExecutionStatus::PartiallyFilled => {
                info!(
                    "Signal {} from strategy {} partially filled: qty={:.4}/{:.4}, price={:.2}",
                    signal.id,
                    signal.strategy_id,
                    result.executed_quantity.unwrap_or(0.0),
                    signal.size.unwrap_or(0.0),
                    result.average_price.unwrap_or(0.0)
                );
            }
            _ => {
                warn!(
                    "Signal {} from strategy {} execution status: {:?}, error: {:?}",
                    signal.id,
                    signal.strategy_id,
                    result.status,
                    result.error_message
                );
            }
        }
        
        Ok(result)
    }
    
    /// Updates a strategy's state after execution and updates risk metrics
    async fn update_strategy_state(&self, strategy_id: &StrategyId, signal: &Signal, result: &ExecutionResult) {
        // Update strategy execution count and status
        let mut states = self.execution_states.write().await;
        if let Some(state) = states.get_mut(strategy_id) {
            // Record successful execution
            if result.status.is_success() {
                state.last_successful_execution = Some(Utc::now());
                state.consecutive_errors = 0;
                state.health = StrategyHealth::Healthy;
            }
            
            // Update performance metrics with the execution result
            state.performance.update_execution_result(result, signal);
            
            // Update drawdown tracker with current equity
            let equity = state.performance.current_equity;
            drop(states); // Release the lock before making async calls
            self.update_drawdown(strategy_id, equity).await;
            
            // Update attribution engine with execution result
            self.update_attribution(strategy_id, result).await;
        }
        
        // Get strategy and let it handle the execution result
        if let Some(mut strategy) = self.get_strategy_mut(strategy_id.clone()).await {
            if let Err(e) = strategy.on_execution(result).await {
                error!("Strategy {} on_execution handler failed: {}", strategy_id, e);
            }
        }
        
        // Update risk metrics based on performance
        if let Some(state) = states.get(strategy_id) {
            self.update_trust_state(strategy_id, result, &state.performance).await;
            self.risk_manager.update_metrics(strategy_id, &state.performance).await;
        }
        
        // Log execution to metrics collector for analytics
        self.log_execution_metrics(strategy_id, result).await;
    }
    
    /// Updates trust state based on execution result and performance
    async fn update_trust_state(&self, strategy_id: &StrategyId, result: &ExecutionResult, performance: &StrategyPerformance) {
        // Extract current trust metrics from risk manager
        if let Some(risk_metrics) = self.risk_manager.get_risk_metrics(strategy_id) {
            // Report trust update to telemetry
            self.telemetry.report_trust_update(
                strategy_id,
                risk_metrics.trust_score,
                risk_metrics.consecutive_losses,
                !self.risk_manager.is_strategy_disabled(strategy_id)
            ).await;
            
            // Log trust update
            debug!(
                "Updated trust state for strategy {}: score={:.2}, consecutive_losses={}, active={}",
                strategy_id,
                risk_metrics.trust_score,
                risk_metrics.consecutive_losses,
                !self.risk_manager.is_strategy_disabled(strategy_id)
            );
            
            // Update execution state with trust information
            self.update_execution_state(strategy_id, |state| {
                state.trust_state.trust_score = risk_metrics.trust_score;
                state.trust_state.consecutive_losses = risk_metrics.consecutive_losses;
                state.trust_state.is_active = !self.risk_manager.is_strategy_disabled(strategy_id);
                state.trust_state.last_updated = Utc::now();
            });
        }
    }
    
    /// Updates strategy from risk metrics
    async fn update_strategy_from_risk_metrics(&self, strategy_id: &StrategyId, metrics: &RiskMetrics) {
        // Lock the strategy states for mutation
        let mut states = match self.strategy_states.lock() {
            Ok(guard) => guard,
            Err(e) => {
                error!("Failed to acquire lock on strategy states: {}", e);
                return;
            }
        };
        
        // Find the strategy by name and update with metrics
        if let Some(strategy) = states.get_mut(strategy_id) {
            if let Err(e) = strategy.update_from_risk_metrics(metrics) {
                warn!("Strategy {} failed to process risk metrics: {}", strategy_id, e);
            }
        }
        
        // Update execution state with performance metrics
        self.update_execution_state(strategy_id, |state| {
            state.performance.trust_score = metrics.trust_score;
            state.performance.win_rate = metrics.win_rate;
            state.performance.profit_factor = metrics.profit_factor;
            state.performance.current_drawdown = metrics.current_drawdown;
            state.performance.max_drawdown = metrics.max_drawdown;
            state.performance.expected_value = metrics.expected_value;
            state.performance.last_updated = chrono::Utc::now();
        });
    }
    
    /// Adds a new strategy to the executor
    pub async fn add_strategy(&self, strategy: Box<dyn Strategy>) -> Result<(), ExecutorError> {
        let strategy_id = strategy.id();
        
        // Get risk profile and register with risk manager
        let risk_profile = strategy.get_risk_profile().await;
        self.risk_manager.register_strategy(
            strategy_id.clone(), 
            risk_profile,
            100.0 // Default initial allocation, can be configured later
        );
        
        // Add to mutable states
        {
            let mut states = match self.strategy_states.lock() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(ExecutorError::Internal(format!(
                        "Failed to acquire lock on strategy states: {}", e
                    )));
                }
            };
            
            // Add a clone or create a new instance for mutable state
            if states.contains_key(&strategy_id) {
                return Err(ExecutorError::Internal(format!(
                    "Strategy {} already exists in mutable states", strategy_id
                )));
            }
            
            states.insert(strategy_id.clone(), strategy.clone_box());
        }
        
        // Add to execution states
        {
            let mut states = match self.execution_states.write() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(ExecutorError::Internal(format!(
                        "Failed to acquire lock on execution states: {}", e
                    )));
                }
            };
            
            states.insert(strategy_id.clone(), StrategyExecutionState::default());
        }
        
        // Add to strategies collection
        {
            let mut strategies = match self.strategies.write() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(ExecutorError::Internal(format!(
                        "Failed to acquire write lock on strategies: {}", e
                    )));
                }
            };
            
            strategies.push(strategy);
        }
        
        // Report strategy added to telemetry
        self.telemetry.report_custom("strategy_added", 
            HashMap::from([
                ("strategy_id", serde_json::to_value(strategy_id).unwrap())
            ])
        ).await;
        
        Ok(())
    }
    
    /// Removes a strategy by ID
    pub fn remove_strategy(&self, strategy_id: &StrategyId) -> Result<(), ExecutorError> {
        // Unregister from risk manager
        self.risk_manager.unregister_strategy(strategy_id);
        
        // Remove from mutable states
        {
            let mut states = match self.strategy_states.lock() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(ExecutorError::Internal(format!(
                        "Failed to acquire lock on strategy states: {}", e
                    )));
                }
            };
            
            states.remove(strategy_id);
        }
        
        // Remove from execution states
        {
            let mut states = match self.execution_states.write() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(ExecutorError::Internal(format!(
                        "Failed to acquire lock on execution states: {}", e
                    )));
                }
            };
            
            states.remove(strategy_id);
        }
        
        // Remove from strategies collection
        {
            let mut strategies = match self.strategies.write() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(ExecutorError::Internal(format!(
                        "Failed to acquire write lock on strategies: {}", e
                    )));
                }
            };
            
            let position = strategies.iter().position(|s| s.id() == *strategy_id)
                .ok_or(ExecutorError::StrategyNotFound { name: strategy_id.clone() })?;
            
            strategies.remove(position);
        }
        
        // Report strategy removed to telemetry
        tokio::spawn({
            let telemetry = self.telemetry.clone();
            let strategy_id = strategy_id.clone();
            async move {
                telemetry.report_custom("strategy_removed", 
                    HashMap::from([
                        ("strategy_id", serde_json::to_value(strategy_id).unwrap())
                    ])
                ).await;
            }
        });
        
        Ok(())
    }
    
    /// Get all strategy performance statistics
    pub fn get_all_strategy_performance(&self) -> HashMap<StrategyId, StrategyPerformance> {
        let mut result = HashMap::new();
        
        if let Ok(states) = self.execution_states.read() {
            for (id, state) in states.iter() {
                result.insert(id.clone(), state.performance.clone());
            }
        }
        
        result
    }
    
    /// Get performance of a specific strategy
    pub fn get_strategy_performance(&self, strategy_id: &StrategyId) -> Option<StrategyPerformance> {
        if let Ok(states) = self.execution_states.read() {
            states.get(strategy_id).map(|state| state.performance.clone())
        } else {
            None
        }
    }
    
    /// Reset strategy health (e.g., after manual intervention)
    pub fn reset_strategy_health(&self, strategy_id: &StrategyId) -> Result<(), ExecutorError> {
        self.update_execution_state(strategy_id, |state| {
            state.health = StrategyHealth::Healthy;
            state.consecutive_errors = 0;
        });
        
        // Report health reset to telemetry
        tokio::spawn({
            let telemetry = self.telemetry.clone();
            let strategy_id = strategy_id.clone();
            async move {
                telemetry.report_custom("strategy_health_reset", 
                    HashMap::from([
                        ("strategy_id", serde_json::to_value(strategy_id).unwrap())
                    ])
                ).await;
            }
        });
        
        Ok(())
    }
    
    /// Get trust state for a strategy
    pub fn get_strategy_trust_state(&self, strategy_id: &StrategyId) -> Option<StrategyTrustState> {
        if let Ok(states) = self.execution_states.read() {
            states.get(strategy_id).map(|state| state.trust_state.clone())
        } else {
            None
        }
    }
    
    /// Get risk metrics for a strategy
    pub fn get_strategy_risk_metrics(&self, strategy_id: &StrategyId) -> Option<RiskMetrics> {
        self.risk_manager.get_risk_metrics(strategy_id)
    }
    
    /// Get list of all strategies 
    pub fn list_strategies(&self) -> Vec<StrategyId> {
        let mut result = Vec::new();
        
        if let Ok(strategies) = self.strategies.read() {
            for strategy in strategies.iter() {
                result.push(strategy.id());
            }
        }
        
        result
    }
    
    /// Starts a continuous execution loop with the specified market data provider
    pub async fn start_execution_loop(
        self: Arc<Self>,
        market_data_provider: Arc<dyn MarketDataProvider>,
    ) {
        info!("Starting strategy execution loop with interval of {}ms", self.config.execution_interval_ms);
        
        let interval_duration = StdDuration::from_millis(self.config.execution_interval_ms);
        let mut interval = time::interval(interval_duration);
        
        loop {
            interval.tick().await;
            
            // Get the latest market data
            match market_data_provider.get_latest_market_data().await {
                Ok(market_data) => {
                    // Execute strategy cycle with the market data
                    let results = self.execute_cycle(&market_data).await;
                    
                    debug!("Execution cycle completed: {} strategies executed, {} signals executed",
                          self.list_strategies().len(), results.len());
                },
                Err(e) => {
                    error!("Failed to get market data: {}", e);
                    
                    // Report error to telemetry
                    let telemetry = self.telemetry.clone();
                    tokio::spawn(async move {
                        telemetry.report_custom("market_data_error", 
                            HashMap::from([
                                ("error", serde_json::to_value(e.to_string()).unwrap())
                            ])
                        ).await;
                    });
                    
                    // Short pause before retrying after error
                    time::sleep(StdDuration::from_millis(1000)).await;
                }
            }
        }
    }
    
    /// Update drawdown tracker with latest equity after execution
    async fn update_drawdown(&self, strategy_id: &StrategyId, equity: f64) {
        if let Some(drawdown_tracker) = &self.drawdown_tracker {
            match drawdown_tracker.update_equity(strategy_id, equity).await {
                Ok(snapshot) => {
                    debug!(
                        "Updated drawdown for strategy {}: equity = {:.2}, drawdown = {:.2}%, max equity = {:.2}",
                        strategy_id, equity, snapshot.drawdown_percent * 100.0, snapshot.max_equity
                    );
                    
                    // If significant drawdown, report to telemetry
                    if snapshot.drawdown_percent <= -0.05 { // 5% drawdown or more
                        let drawdown_data = HashMap::from([
                            ("strategy_id", serde_json::to_value(strategy_id).unwrap()),
                            ("current_equity", serde_json::to_value(snapshot.current_equity).unwrap()),
                            ("max_equity", serde_json::to_value(snapshot.max_equity).unwrap()),
                            ("drawdown_percent", serde_json::to_value(snapshot.drawdown_percent).unwrap()),
                            ("timestamp", serde_json::to_value(snapshot.timestamp).unwrap()),
                        ]);
                        
                        self.telemetry.report_custom("significant_drawdown", drawdown_data).await;
                    }
                    
                    // Check if we need to adjust risk due to drawdown state
                    match drawdown_tracker.get_drawdown_state(strategy_id).await {
                        Ok(state) => {
                            if state != crate::drawdown::DrawdownState::Normal {
                                // Get risk modifier
                                if let Ok(risk_modifier) = drawdown_tracker.get_risk_modifier(strategy_id).await {
                                    debug!(
                                        "Strategy {} in drawdown state {:?}, applying risk modifier: {:.2}",
                                        strategy_id, state, risk_modifier
                                    );
                                    
                                    // Report to telemetry
                                    let risk_data = HashMap::from([
                                        ("strategy_id", serde_json::to_value(strategy_id).unwrap()),
                                        ("drawdown_state", serde_json::to_value(state.to_string()).unwrap()),
                                        ("risk_modifier", serde_json::to_value(risk_modifier).unwrap()),
                                    ]);
                                    
                                    self.telemetry.report_custom("drawdown_risk_adjustment", risk_data).await;
                                }
                            }
                        },
                        Err(e) => {
                            warn!("Failed to get drawdown state for strategy {}: {}", strategy_id, e);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to update drawdown for strategy {}: {}", strategy_id, e);
                    
                    // Report error to telemetry
                    let error_data = HashMap::from([
                        ("strategy_id", serde_json::to_value(strategy_id).unwrap()),
                        ("error", serde_json::to_value(e.to_string()).unwrap()),
                        ("equity", serde_json::to_value(equity).unwrap()),
                    ]);
                    
                    self.telemetry.report_custom("drawdown_tracker_error", error_data).await;
                }
            }
        }
    }

    /// Log execution data to the execution metrics collector
    async fn log_execution_metrics(&self, strategy_id: &StrategyId, result: &ExecutionResult) {
        if let Some(metrics_collector) = &self.execution_metrics {
            let venue = result.additional_data.get("venue")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            
            // Create execution log from result
            let mut log = ExecutionLog::from_execution_result(result, strategy_id, &venue);
            
            // Add max drawdown if available
            if let Some(drawdown) = &self.drawdown_tracker {
                if let Ok(snapshot) = drawdown.get_snapshot(strategy_id).await {
                    log.max_drawdown_pct = snapshot.max_drawdown_pct;
                }
            }
            
            // Calculate slippage if expected price is available
            if let Some(expected_price) = result.additional_data.get("expected_price")
                .and_then(|v| v.as_f64()) {
                log.with_slippage(expected_price);
            }
            
            // Log through the metrics collector
            if let Err(e) = metrics_collector.log_execution(log).await {
                error!("Failed to log execution metrics for strategy {}: {}", strategy_id, e);
            }
        }
    }

    /// Update attribution engine with execution result
    async fn update_attribution(&self, strategy_id: &StrategyId, result: &ExecutionResult) {
        if let Some(attribution_engine) = &self.attribution_engine {
            // After significant executions, trigger attribution calculation
            if result.status == ExecutionStatus::Success && result.realized_pnl.abs() > 0.001 {
                debug!("Updating attribution for strategy {} with PnL: {:.4}", strategy_id, result.realized_pnl);
                
                // Record execution data for attribution
                if let Err(e) = attribution_engine.record_execution(strategy_id, result).await {
                    warn!("Failed to record execution for attribution: {}", e);
                    
                    // Report error to telemetry
                    let error_data = serde_json::json!({
                        "strategy_id": strategy_id.to_string(),
                        "component": "attribution_engine",
                        "operation": "record_execution",
                        "error": e.to_string(),
                        "timestamp": Utc::now(),
                    });
                    
                    self.telemetry.report_custom(
                        "attribution_error", 
                        error_data.as_object().unwrap().clone()
                    ).await;
                    
                    return;
                }
                
                match attribution_engine.calculate_attribution(strategy_id).await {
                    Ok(attribution) => {
                        debug!(
                            "Strategy {} attribution: signal={:.2}%, execution={:.2}%, risk={:.2}%, regime={:.2}%", 
                            strategy_id,
                            attribution.signal_contribution * 100.0,
                            attribution.execution_contribution * 100.0,
                            attribution.risk_contribution * 100.0,
                            attribution.regime_contribution * 100.0
                        );
                        
                        // Report attribution to telemetry
                        let attribution_data = serde_json::json!({
                            "strategy_id": strategy_id.to_string(),
                            "signal_contribution": attribution.signal_contribution,
                            "execution_contribution": attribution.execution_contribution,
                            "risk_contribution": attribution.risk_contribution,
                            "regime_contribution": attribution.regime_contribution,
                            "total_return": attribution.total_return,
                            "timestamp": attribution.timestamp,
                        });
                        
                        self.telemetry.report_custom(
                            "strategy_attribution", 
                            attribution_data.as_object().unwrap().clone()
                        ).await;
                        
                        // Check for concerning attribution patterns
                        self.check_attribution_alerts(strategy_id, &attribution).await;
                        
                        // Adjust risk based on attribution data
                        self.adjust_risk_from_attribution(strategy_id, &attribution).await;
                        
                        // Update factor analysis with attribution data if available
                        self.update_factor_analysis(strategy_id, &attribution).await;
                                        
                        // Update strategy meta-data with attribution info
                        if let Ok(mut states) = self.execution_states.write().await {
                            if let Some(state) = states.get_mut(strategy_id) {
                                let metadata = state.metadata.get_or_insert_with(HashMap::new);
                                metadata.insert("last_attribution".to_string(), serde_json::to_string(&attribution).unwrap_or_default());
                            }
                        }
                    },
                    Err(e) => {
                        warn!("Failed to calculate attribution for strategy {}: {}", strategy_id, e);
                        
                        // Report error to telemetry
                        let error_data = serde_json::json!({
                            "strategy_id": strategy_id.to_string(),
                            "component": "attribution_engine",
                            "operation": "calculate_attribution",
                            "error": e.to_string(),
                            "timestamp": Utc::now(),
                        });
                        
                        self.telemetry.report_custom(
                            "attribution_error", 
                            error_data.as_object().unwrap().clone()
                        ).await;
                    }
                }
            } else {
                debug!(
                    "Skipping attribution update for strategy {} - execution not successful or PnL too small: status={:?}, pnl={:.4}", 
                    strategy_id, result.status, result.realized_pnl
                );
            }
        }
    }

    /// Adjust risk parameters based on attribution analysis
    async fn adjust_risk_from_attribution(&self, strategy_id: &StrategyId, attribution: &StrategyAttribution) {
        if let Some(risk_manager) = &self.risk_manager {
            // Determine risk modifier based on attribution components
            
            // 1. If execution contribution is negative and significant, reduce risk
            let mut risk_modifier = 1.0;
            let mut adjustment_reason = String::new();
            
            if attribution.execution_contribution < -0.1 {
                // Scale down risk by the magnitude of negative execution contribution
                let execution_factor = (1.0 + attribution.execution_contribution.min(-0.1).max(-0.5)).max(0.5);
                risk_modifier *= execution_factor;
                adjustment_reason = format!("Poor execution efficiency ({}%)", 
                    attribution.execution_contribution * 100.0);
            }
            
            // 2. If risk contribution is negative and significant, reduce risk even more
            if attribution.risk_contribution < -0.15 {
                // Scale down risk by the magnitude of negative risk contribution
                let risk_factor = (1.0 + attribution.risk_contribution.min(-0.15).max(-0.5)).max(0.5);
                risk_modifier *= risk_factor;
                
                if !adjustment_reason.is_empty() {
                    adjustment_reason.push_str(" and ");
                }
                adjustment_reason.push_str(&format!("Poor risk management ({}%)", 
                    attribution.risk_contribution * 100.0));
            }
            
            // 3. If signal contribution is very low compared to total return, reduce risk slightly
            if attribution.total_return > 0.0 && 
               attribution.signal_contribution < 0.2 * attribution.total_return {
                risk_modifier *= 0.9;
                
                if !adjustment_reason.is_empty() {
                    adjustment_reason.push_str(" and ");
                }
                adjustment_reason.push_str(&format!("Low signal contribution ({}%)", 
                    attribution.signal_contribution * 100.0));
            }
            
            // Only apply if there's a meaningful adjustment needed
            if (risk_modifier - 1.0).abs() > 0.05 {
                debug!(
                    "Applying risk modifier of {:.2} to strategy {} due to attribution analysis: {}", 
                    risk_modifier, strategy_id, adjustment_reason
                );
                
                // Apply the risk modifier
                if let Err(e) = risk_manager.apply_risk_modifier(strategy_id, risk_modifier).await {
                    warn!("Failed to apply risk modifier from attribution: {}", e);
                    return;
                }
                
                // Report adjustment to telemetry
                let adjustment_data = serde_json::json!({
                    "strategy_id": strategy_id.to_string(),
                    "risk_modifier": risk_modifier,
                    "reason": adjustment_reason,
                    "signal_contribution": attribution.signal_contribution,
                    "execution_contribution": attribution.execution_contribution,
                    "risk_contribution": attribution.risk_contribution,
                    "total_return": attribution.total_return,
                    "timestamp": Utc::now(),
                });
                
                self.telemetry.report_custom(
                    "attribution_risk_adjustment", 
                    adjustment_data.as_object().unwrap().clone()
                ).await;
            }
        }
    }
    
    /// Update factor analysis with attribution data
    async fn update_factor_analysis(&self, strategy_id: &StrategyId, attribution: &StrategyAttribution) {
        if let Some(factor_engine) = &self.factor_analysis_engine {
            // Record return data
            if let Err(e) = factor_engine.record_return(
                strategy_id, 
                attribution.timestamp, 
                attribution.total_return
            ).await {
                warn!("Failed to update factor analysis for strategy {}: {}", strategy_id, e);
                return;
            }
            
            // Only calculate factor exposures periodically to avoid excessive computation
            let states = match self.execution_states.read().await {
                Ok(states) => states,
                Err(_) => return,
            };
            
            if let Some(state) = states.get(strategy_id) {
                if let Some(last_factor_update) = state.last_factor_analysis {
                    // Only run factor analysis if it's been at least 1 hour since last update
                    if (Utc::now() - last_factor_update).num_seconds() < 3600 {
                        return;
                    }
                }
            }
            
            // Calculate factor exposures
            match factor_engine.calculate_factor_exposures(strategy_id).await {
                Ok(profile) => {
                    debug!(
                        "Strategy {} factor profile: r²={:.2}, factors={:?}", 
                        strategy_id, 
                        profile.r_squared, 
                        profile.exposures.iter()
                            .map(|(k, v)| format!("{}:{:.2}", k.as_str(), v))
                            .collect::<Vec<_>>()
                    );
                    
                    // Check for factor alerts
                    if let Ok(alerts) = factor_engine.check_factor_alerts(strategy_id, &profile).await {
                        for alert in alerts {
                            warn!(
                                "Factor alert for strategy {}: {} | Current: {:.2}, Threshold: {:.2}", 
                                strategy_id, 
                                alert.message,
                                alert.current_value,
                                alert.threshold
                            );
                            
                            // For serious alerts, adjust risk
                            match alert.alert_type {
                                FactorAlertType::SingleFactorOverexposure | 
                                FactorAlertType::CombinedExposureHigh => {
                                    self.adjust_risk_from_factor_alert(strategy_id, &alert).await;
                                },
                                _ => {} // Other alerts don't require immediate risk adjustment
                            }
                        }
                    }
                    
                    // Update the last factor analysis timestamp
                    if let Ok(mut states) = self.execution_states.write().await {
                        if let Some(state) = states.get_mut(strategy_id) {
                            state.last_factor_analysis = Some(Utc::now());
                        }
                    }
                },
                Err(e) => {
                    // Only warn if it's not just insufficient data
                    if !e.to_string().contains("Insufficient data") {
                        warn!("Failed to calculate factor exposures for strategy {}: {}", strategy_id, e);
                    }
                }
            }
        }
    }
    
    /// Adjust risk parameters based on factor alerts
    async fn adjust_risk_from_factor_alert(&self, strategy_id: &StrategyId, alert: &FactorAlert) {
        if let Some(risk_manager) = &self.risk_manager {
            // Determine risk modifier based on alert type and severity
            let risk_modifier = match alert.alert_type {
                FactorAlertType::SingleFactorOverexposure => {
                    // Reduce risk more for higher overexposure
                    let severity = (alert.current_value - alert.threshold) / alert.threshold;
                    1.0 - (0.2 * severity.min(1.0))
                },
                FactorAlertType::CombinedExposureHigh => {
                    // Reduce risk based on how much the combined exposure exceeds threshold
                    let severity = (alert.current_value - alert.threshold) / alert.threshold;
                    1.0 - (0.15 * severity.min(1.0))
                },
                _ => return, // No adjustment for other alert types
            };
            
            // Only apply if the modifier is significant
            if (risk_modifier - 1.0).abs() > 0.05 {
                debug!(
                    "Applying risk modifier of {:.2} to strategy {} due to factor alert: {}", 
                    risk_modifier, strategy_id, alert.alert_type
                );
                
                // Apply the risk modifier
                if let Err(e) = risk_manager.apply_risk_modifier(strategy_id, risk_modifier).await {
                    warn!("Failed to apply risk modifier from factor alert: {}", e);
                    return;
                }
                
                // Report adjustment to telemetry
                let adjustment_data = serde_json::json!({
                    "strategy_id": strategy_id.to_string(),
                    "alert_type": format!("{:?}", alert.alert_type),
                    "risk_modifier": risk_modifier,
                    "factor": alert.factor.as_ref().map(|f| f.as_str()),
                    "current_value": alert.current_value,
                    "threshold": alert.threshold,
                    "timestamp": Utc::now(),
                });
                
                self.telemetry.report_custom(
                    "factor_risk_adjustment", 
                    adjustment_data.as_object().unwrap().clone()
                ).await;
            }
        }
    }
    
    /// Check attribution values for concerning patterns
    async fn check_attribution_alerts(&self, strategy_id: &StrategyId, attribution: &StrategyAttribution) {
        // Check if signal contribution is too low
        if attribution.total_return > 0.0 && attribution.signal_contribution < 0.2 * attribution.total_return {
            let alert_data = serde_json::json!({
                "strategy_id": strategy_id.to_string(),
                "total_return": attribution.total_return,
                "signal_contribution": attribution.signal_contribution,
                "concern": "Low signal contribution relative to total return",
                "suggestion": "Review signal generation logic or feature engineering",
                "timestamp": Utc::now(),
            });
            
            self.telemetry.report_custom(
                "attribution_alert", 
                alert_data.as_object().unwrap().clone()
            ).await;
            
            warn!(
                "Strategy {} has low signal contribution ({:.2}%) relative to returns",
                strategy_id, attribution.signal_contribution * 100.0
            );
        }
        
        // Check for negative execution contribution
        if attribution.execution_contribution < 0.0 && attribution.execution_contribution.abs() > 0.1 {
            let alert_data = serde_json::json!({
                "strategy_id": strategy_id.to_string(),
                "total_return": attribution.total_return,
                "execution_contribution": attribution.execution_contribution,
                "concern": "Negative execution contribution",
                "suggestion": "Review execution timing or order sizing",
                "timestamp": Utc::now(),
            });
            
            self.telemetry.report_custom(
                "attribution_alert", 
                alert_data.as_object().unwrap().clone()
            ).await;
            
            warn!(
                "Strategy {} has negative execution contribution ({:.2}%)",
                strategy_id, attribution.execution_contribution * 100.0
            );
        }
        
        // Check for negative risk contribution
        if attribution.risk_contribution < 0.0 && attribution.risk_contribution.abs() > 0.15 {
            let alert_data = serde_json::json!({
                "strategy_id": strategy_id.to_string(),
                "total_return": attribution.total_return,
                "risk_contribution": attribution.risk_contribution,
                "concern": "Negative risk contribution",
                "suggestion": "Review position sizing or stop-loss logic",
                "timestamp": Utc::now(),
            });
            
            self.telemetry.report_custom(
                "attribution_alert", 
                alert_data.as_object().unwrap().clone()
            ).await;
            
            warn!(
                "Strategy {} has negative risk contribution ({:.2}%)",
                strategy_id, attribution.risk_contribution * 100.0
            );
        }
    }
    
    /// Get attribution for a specific strategy
    pub async fn get_strategy_attribution(&self, strategy_id: &StrategyId) -> Option<StrategyAttribution> {
        if let Some(attribution_engine) = &self.attribution_engine {
            match attribution_engine.get_latest_attribution(strategy_id).await {
                Ok(attribution) => Some(attribution),
                Err(e) => {
                    debug!("Failed to get attribution for strategy {}: {}", strategy_id, e);
                    None
                }
            }
        } else {
            None
        }
    }
    
    /// Get attribution history for a strategy
    pub async fn get_strategy_attribution_history(&self, strategy_id: &StrategyId, limit: Option<usize>) -> Vec<StrategyAttribution> {
        if let Some(attribution_engine) = &self.attribution_engine {
            match attribution_engine.get_attribution_history(strategy_id, limit).await {
                Ok(history) => history,
                Err(e) => {
                    debug!("Failed to get attribution history for strategy {}: {}", strategy_id, e);
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        }
    }
    
    /// Run attribution cycle for all strategies
    pub async fn run_attribution_cycle(&self) -> Result<(), ExecutorError> {
        if let Some(attribution_engine) = &self.attribution_engine {
            match attribution_engine.run_attribution_cycle().await {
                Ok(attributions) => {
                    info!("Completed attribution cycle for {} strategies", attributions.len());
                    
                    // Report aggregated attribution metrics
                    let mut total_signal = 0.0;
                    let mut total_execution = 0.0;
                    let mut total_risk = 0.0;
                    let mut total_regime = 0.0;
                    let mut total_return = 0.0;
                    let mut count = 0;
                    
                    for attribution in &attributions {
                        total_signal += attribution.signal_contribution;
                        total_execution += attribution.execution_contribution;
                        total_risk += attribution.risk_contribution;
                        total_regime += attribution.regime_contribution;
                        total_return += attribution.total_return;
                        count += 1;
                    }
                    
                    if count > 0 {
                        let avg_data = serde_json::json!({
                            "strategy_count": count,
                            "avg_signal_contribution": total_signal / count as f64,
                            "avg_execution_contribution": total_execution / count as f64,
                            "avg_risk_contribution": total_risk / count as f64,
                            "avg_regime_contribution": total_regime / count as f64,
                            "avg_total_return": total_return / count as f64,
                            "timestamp": Utc::now(),
                        });
                        
                        self.telemetry.report_custom(
                            "attribution_cycle_summary", 
                            avg_data.as_object().unwrap().clone()
                        ).await;
                    }
                    
                    Ok(())
                },
                Err(e) => {
                    error!("Failed to run attribution cycle: {}", e);
                    Err(ExecutorError::Internal(format!("Attribution error: {}", e)))
                }
            }
        } else {
            debug!("Attribution engine not configured, skipping attribution cycle");
            Ok(())
        }
    }

    /// Manually trigger factor analysis for a specific strategy
    pub async fn analyze_strategy_factors(&self, strategy_id: &StrategyId) -> Result<Option<StrategyFactorProfile>, ExecutorError> {
        if let Some(factor_engine) = &self.factor_analysis_engine {
            match factor_engine.calculate_factor_exposures(strategy_id).await {
                Ok(profile) => {
                    info!(
                        "Manual factor analysis for strategy {}: r²={:.2}, factors={:?}", 
                        strategy_id, 
                        profile.r_squared, 
                        profile.exposures.iter()
                            .map(|(k, v)| format!("{}:{:.2}", k.as_str(), v))
                            .collect::<Vec<_>>()
                    );
                    
                    // Store the timestamp
                    if let Ok(mut states) = self.execution_states.write() {
                        if let Some(state) = states.get_mut(strategy_id) {
                            state.last_factor_analysis = Some(Utc::now());
                        }
                    }
                    
                    // Check for alerts
                    if let Ok(alerts) = factor_engine.check_factor_alerts(strategy_id, &profile).await {
                        for alert in alerts {
                            // For critical alerts, adjust risk
                            if matches!(alert.alert_type, 
                                FactorAlertType::SingleFactorOverexposure | 
                                FactorAlertType::CombinedExposureHigh
                            ) {
                                self.adjust_risk_from_factor_alert(strategy_id, &alert).await;
                            }
                            
                            warn!(
                                "Factor alert for strategy {}: {} | Current: {:.2}, Threshold: {:.2}", 
                                strategy_id, 
                                alert.message,
                                alert.current_value,
                                alert.threshold
                            );
                        }
                    }
                    
                    Ok(Some(profile))
                },
                Err(e) => {
                    // If it's just insufficient data, don't make it an error
                    if e.to_string().contains("Insufficient data") {
                        debug!("Insufficient data for factor analysis of strategy {}: {}", strategy_id, e);
                        Ok(None)
                    } else {
                        error!("Factor analysis failed for strategy {}: {}", strategy_id, e);
                        Err(ExecutorError::Internal(format!("Factor analysis error: {}", e)))
                    }
                }
            }
        } else {
            debug!("No factor analysis engine configured");
            Ok(None)
        }
    }

    /// Get the latest factor profile for a strategy
    pub async fn get_strategy_factor_profile(&self, strategy_id: &StrategyId) -> Option<StrategyFactorProfile> {
        if let Some(factor_engine) = &self.factor_analysis_engine {
            match factor_engine.get_latest_factor_profile(strategy_id).await {
                Ok(profile) => Some(profile),
                Err(e) => {
                    debug!("Failed to get factor profile for strategy {}: {}", strategy_id, e);
                    None
                }
            }
        } else {
            None
        }
    }

    /// Get factor profile history for a strategy
    pub async fn get_strategy_factor_profile_history(
        &self, 
        strategy_id: &StrategyId,
        limit: Option<usize>
    ) -> Vec<StrategyFactorProfile> {
        if let Some(factor_engine) = &self.factor_analysis_engine {
            match factor_engine.get_factor_profile_history(strategy_id, limit).await {
                Ok(history) => history,
                Err(e) => {
                    debug!("Failed to get factor profile history for strategy {}: {}", strategy_id, e);
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        }
    }

    /// Run a factor analysis cycle for all strategies
    pub async fn run_factor_analysis_cycle(&self) -> Result<(), ExecutorError> {
        if let Some(factor_engine) = &self.factor_analysis_engine {
            match factor_engine.run_factor_analysis_cycle().await {
                Ok(profiles) => {
                    info!("Completed factor analysis cycle for {} strategies", profiles.len());
                    
                    // Update last analysis timestamp for each strategy
                    if let Ok(mut states) = self.execution_states.write() {
                        for (strategy_id, _) in &profiles {
                            if let Some(state) = states.get_mut(strategy_id) {
                                state.last_factor_analysis = Some(Utc::now());
                            }
                        }
                    }
                    
                    // Check for alerts for each profile
                    for (strategy_id, profile) in profiles {
                        if let Ok(alerts) = factor_engine.check_factor_alerts(&strategy_id, &profile).await {
                            for alert in alerts {
                                // For critical alerts, adjust risk
                                if matches!(alert.alert_type, 
                                    FactorAlertType::SingleFactorOverexposure | 
                                    FactorAlertType::CombinedExposureHigh
                                ) {
                                    self.adjust_risk_from_factor_alert(&strategy_id, &alert).await;
                                }
                                
                                warn!(
                                    "Factor alert for strategy {}: {} | Current: {:.2}, Threshold: {:.2}",
                                    strategy_id,
                                    alert.message,
                                    alert.current_value, 
                                    alert.threshold
                                );
                            }
                        }
                    }
                    
                    Ok(())
                }
                Err(e) => {
                    error!("Failed to run factor analysis cycle: {}", e);
                    Err(ExecutorError::Internal(format!("Factor analysis error: {}", e)))
                }
            }
        } else {
            debug!("No factor analysis engine configured");
            Ok(())
        }
    }
}

/// Provider for market data for strategy execution
#[async_trait]
pub trait MarketDataProvider: Send + Sync {
    /// Returns the latest market data
    async fn get_latest_market_data(&self) -> Result<MarketData, MarketDataError>;
}

/// Error types for market data operations
#[derive(Debug, Error)]
pub enum MarketDataError {
    #[error("API error: {0}")]
    ApiError(String),
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    
    #[error("Data not available: {0}")]
    DataNotAvailable(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Extension trait to add cloning capability to Strategy trait objects
pub trait StrategyExt: Strategy {
    /// Clone this strategy into a new boxed trait object
    fn clone_box(&self) -> Box<dyn Strategy>;
}

/// Implement the extension trait for all types that implement Strategy and Clone
impl<T> StrategyExt for T 
where 
    T: Strategy + Clone + 'static 
{
    fn clone_box(&self) -> Box<dyn Strategy> {
        Box::new(self.clone())
    }
}

/// Extension trait to add methods needed by the executor but not in the main Strategy trait
pub trait StrategyExecutorExt {
    /// Get the unique identifier for this strategy
    fn id(&self) -> StrategyId;
    
    /// Handle execution result
    async fn on_execution(&mut self, result: &ExecutionResult) -> Result<(), String>;
    
    /// Update from risk metrics
    fn update_from_risk_metrics(&mut self, metrics: &RiskMetrics) -> Result<(), String>;
}

/// Default implementation for any Strategy
impl<T: Strategy + ?Sized> StrategyExecutorExt for T {
    fn id(&self) -> StrategyId {
        // Default implementation using name as ID
        self.name().to_string()
    }
    
    async fn on_execution(&mut self, _result: &ExecutionResult) -> Result<(), String> {
        // Default implementation does nothing
        Ok(())
    }
    
    fn update_from_risk_metrics(&mut self, _metrics: &RiskMetrics) -> Result<(), String> {
        // Default implementation does nothing
        Ok(())
    }
}

/// Get the name of the strategy
impl Strategy for T {
    fn name(&self) -> &str {
        // Default to extracting name from ID
        self.id().as_str()
    }
}

/// Extension trait to add methods needed by the executor for Signal
pub trait SignalExt {
    /// Set the size of the signal
    fn set_size(&mut self, size: f64);
    
    /// Update the signal status
    fn update_status(&mut self, status: SignalStatus);
}

/// Default implementation for Signal
impl SignalExt for Signal {
    fn set_size(&mut self, size: f64) {
        self.size = Some(size);
    }
    
    fn update_status(&mut self, status: SignalStatus) {
        self.status = status;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::{MockMarketDataProvider, Candle, Orderbook, TechnicalIndicators, Timeframe};
    use std::collections::HashMap;
    use std::sync::Arc;
    use rust_decimal::Decimal;
    use crate::governance::{
        MockGovernanceEnforcer, 
        GovernanceActionType, 
        RuleViolation, 
        RuleSeverity, 
        EnforcementResult
    };
    
    // Mock implementation of RiskManager for testing
    struct MockRiskManager {
        is_disabled: bool,
        risk_metrics: HashMap<StrategyId, RiskMetrics>,
        risk_profiles: HashMap<StrategyId, RiskProfile>,
    }
    
    impl MockRiskManager {
        fn new() -> Self {
            Self {
                is_disabled: false,
                risk_metrics: HashMap::new(),
                risk_profiles: HashMap::new(),
            }
        }
    }
    
    impl RiskManager for MockRiskManager {
        fn validate_signal(&self, _strategy_id: &StrategyId, _signal: &Signal, _market_data: &MarketData) -> Result<(), RiskError> {
            if self.is_disabled {
                Err(RiskError::StrategyDisabled("Strategy is disabled for testing".to_string()))
            } else {
                Ok(())
            }
        }
        
        fn calculate_position_size(&self, _strategy_id: &StrategyId, _signal: &Signal, _market_data: &MarketData) -> PositionSizing {
            PositionSizing {
                base_size: 1.0,
                adjusted_size: 0.8,
                risk_factor: 0.8,
                max_size: 2.0,
            }
        }
        
        fn get_risk_metrics(&self, strategy_id: &StrategyId) -> Option<RiskMetrics> {
            self.risk_metrics.get(strategy_id).cloned()
        }
        
        fn update_metrics(&mut self, strategy_id: &StrategyId, performance: &StrategyPerformance) {
            let metrics = self.risk_metrics.entry(strategy_id.clone())
                .or_insert_with(|| RiskMetrics::new(strategy_id.clone(), 100.0));
            
            metrics.total_pnl = performance.realized_pnl;
            metrics.current_drawdown = performance.current_drawdown;
            metrics.trust_score = performance.trust_score;
        }
        
        fn assess_market_risk(&self, _market_data: &MarketData) -> MarketRiskAssessment {
            MarketRiskAssessment {
                symbol: "BTC/USD".to_string(),
                volatility_level: 0.3,
                liquidity_level: 0.7,
                market_trend: 0.2,
                risk_multiplier: 0.8,
            }
        }
        
        fn check_risk_limits(&self, _strategy_id: &StrategyId) -> Result<(), RiskError> {
            if self.is_disabled {
                Err(RiskError::RiskLimitBreached("Risk limit breached for testing".to_string()))
            } else {
                Ok(())
            }
        }
        
        fn register_strategy(&mut self, strategy_id: StrategyId, risk_profile: RiskProfile, initial_allocation: f64) {
            self.risk_profiles.insert(strategy_id.clone(), risk_profile);
            self.risk_metrics.insert(strategy_id.clone(), RiskMetrics::new(strategy_id, initial_allocation));
        }
        
        fn unregister_strategy(&mut self, strategy_id: &StrategyId) {
            self.risk_profiles.remove(strategy_id);
            self.risk_metrics.remove(strategy_id);
        }
        
        fn is_strategy_disabled(&self, _strategy_id: &StrategyId) -> bool {
            self.is_disabled
        }
    }
    
    // Mock implementation of TelemetryReporter for testing
    struct MockTelemetryReporter {}
    
    impl MockTelemetryReporter {
        fn new() -> Self {
            Self {}
        }
    }
    
    impl TelemetryReporter for MockTelemetryReporter {
        async fn report_execution_start(&self, _strategy_id: &str) {}
        async fn report_no_signal(&self, _strategy_id: &str) {}
        async fn report_error(&self, _strategy_id: &str, _error: &str) {}
        async fn report_risk_limit(&self, _strategy_id: &str, _error: &RiskError) {}
        async fn report_execution_error(&self, _strategy_id: &str, _error: &str) {}
        async fn report_execution_complete(&self, _strategy_id: &str, _result: &ExecutionResult) {}
        async fn report_trust_update(&self, _strategy_id: &str, _trust_score: f64, _consecutive_losses: u32, _is_active: bool) {}
        async fn report_custom(&self, _event_type: &str, _data: HashMap<String, serde_json::Value>) {}
        async fn emit_soft_warning(&self, _strategy_id: &str, _trust_score: f64, _message: String) {}
        async fn report_trust_rejection(&self, _strategy_id: &str, _rejection: &ExecutionRejection) {}
        async fn report_governance_violation(&self, _strategy_id: &str, _rejection: &ExecutionRejection) {}
    }
    
    // Mock implementation of ExecutionService for testing
    struct MockExecutionService {}
    
    impl MockExecutionService {
        fn new() -> Self {
            Self {}
        }
    }
    
    impl ExecutionService for MockExecutionService {
        async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionResult, ExecutionError> {
            Ok(ExecutionResult {
                id: "mock-execution".to_string(),
                request_id: request.id,
                signal_id: request.signal.id,
                status: ExecutionStatus::Completed,
                executed_quantity: Some(request.signal.size.unwrap_or(0.0)),
                average_price: Some(1000.0),
                realized_pnl: 0.0,
                // other fields would be initialized as needed
                // ...
            })
        }
    }
    
    #[derive(Clone)]
    struct MockStrategy {
        id: StrategyId,
        risk_profile: RiskProfile,
    }
    
    #[async_trait]
    impl Strategy for MockStrategy {
        async fn generate_signal(&self, _market_data: &crate::market::MarketData)
            -> Result<Option<Signal>, String> {
            Ok(Some(Signal::new(&self.id, "BTC/USD", SignalAction::Hold)))
        }
        
        async fn get_risk_profile(&self) -> RiskProfile {
            self.risk_profile.clone()
        }
        
        fn name(&self) -> &str {
            &self.id
        }
    }
    
    // Create test market data
    fn create_test_market_data() -> MarketData {
        let mut market_data = MarketData::default();
        market_data.symbol = "BTC/USD".to_string();
        market_data.price = 50000.0;
        
        // Add candles
        let mut candles = Vec::new();
        for i in 0..10 {
            candles.push(Candle {
                timestamp: Utc::now(),
                open: 50000.0 - i as f64 * 100.0,
                high: 50000.0 - i as f64 * 50.0,
                low: 50000.0 - i as f64 * 150.0,
                close: 50000.0 - i as f64 * 100.0,
                volume: 10.0,
                extras: HashMap::new(),
            });
        }
        
        let mut candle_map = HashMap::new();
        candle_map.insert(Timeframe::Minute5, candles);
        market_data.candles = candle_map;
        
        // Add orderbook
        market_data.orderbook = Orderbook::default();
        
        // Add technical indicators
        market_data.indicators = TechnicalIndicators {
            volatility: HashMap::from([("historical_vol".to_string(), 0.25)]),
            trend: HashMap::from([("direction".to_string(), serde_json::Value::from(0.75))]),
            ..TechnicalIndicators::default()
        };
        
        market_data
    }
    
    // Implement a simple test for the strategy executor
    #[tokio::test]
    async fn test_execute_cycle() {
        // Create test components
        let mut market_provider = MockMarketDataProvider::new();
        let market_data = create_test_market_data();
        market_provider.set_market_data("BTC/USD", market_data.clone());
        
        let risk_manager = Arc::new(MockRiskManager::new());
        let telemetry = Arc::new(MockTelemetryReporter::new());
        let execution_service = Arc::new(MockExecutionService::new());
        
        // Create a mock strategy
        let strategy = Box::new(MockStrategy {
            id: "test-strategy".to_string(),
            risk_profile: RiskProfile::default(),
        });
        
        // Create the strategy executor
        let executor = StrategyExecutor::new(
            vec![strategy],
            risk_manager,
            None,
            telemetry,
            execution_service,
        );
        
        // Execute a cycle
        let results = executor.execute_cycle(&market_data).await;
        
        // Verify results
        assert_eq!(results.len(), 1, "Should have executed one strategy");
        assert_eq!(results[0].status, ExecutionStatus::Completed, "Execution should be completed");
        
        // TODO: Add more assertions once full mocks are available
    }
    
    #[tokio::test]
    async fn test_trust_based_filtering() {
        // Create a mock risk manager that will return a low trust score
        let mut risk_manager = MockRiskManager::new();
        
        // Set up a test strategy
        let strategy_id = "test_strategy".to_string();
        let strategy = MockStrategy::new(strategy_id.clone());
        
        // Set up a very low trust score to trigger rejection
        let low_trust_metrics = RiskMetrics {
            trust_score: 0.2, // Below default hard rejection threshold of 0.3
            consecutive_losses: 5,
            win_rate: 30.0,
            profit_factor: 0.6,
            sharpe_ratio: -0.5,
            sortino_ratio: -0.8,
            expected_value: -0.05,
            max_drawdown: 25.0,
            current_drawdown: 20.0,
            var_95: 15.0,
            var_99: 22.0,
            cvar_95: 18.0,
            max_position_size: 1.0,
        };
        
        // Add the low trust metrics to the mock risk manager
        risk_manager.risk_metrics.insert(strategy_id.clone(), low_trust_metrics);
        
        // Create a telemetry reporter
        let telemetry = Arc::new(MockTelemetryReporter::new());
        
        // Create an execution service
        let execution_service = Arc::new(MockExecutionService::new());
        
        // Create the strategy executor with custom trust policy
        let mut config = StrategyExecutorConfig::default();
        config.trust_policy = TrustPolicyConfig {
            hard_rejection_threshold: 0.3,
            soft_warning_threshold: 0.5,
            allow_override: false,
            enabled: true,
        };
        
        let executor = StrategyExecutor::with_config(
            vec![Box::new(strategy)],
            Arc::new(risk_manager),
            None,
            telemetry,
            execution_service,
            config,
            None,
        );
        
        // Execute the strategy cycle
        let market_data = create_test_market_data();
        let results = executor.execute_cycle(&market_data).await;
        
        // Verify there's one result (the rejection)
        assert_eq!(results.len(), 1);
        
        // Verify the result is a trust-based rejection
        let result = &results[0];
        assert_eq!(result.status, ExecutionStatus::Rejected);
        assert!(result.error_message.as_ref().unwrap().contains("Trust-based rejection"));
        assert!(result.trust_score.is_some());
        assert_eq!(result.trust_score.unwrap(), 0.2);
        
        // Verify rejection details exist
        assert!(result.rejection_details.is_some());
        assert!(result.rejection_details.as_ref().unwrap().contains("Trust score (0.20) below critical threshold (0.30)"));
    }
} 