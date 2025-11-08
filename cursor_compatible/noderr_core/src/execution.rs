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
use std::sync::{Arc, RwLock, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::time;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::strategy::Signal;

/// Errors that can occur during trade execution
#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("Connection error: {0}")]
    ConnectionError(String),
    
    #[error("Authentication error: {0}")]
    AuthenticationError(String),
    
    #[error("Order validation failed: {0}")]
    ValidationError(String),
    
    #[error("Insufficient funds: {0}")]
    InsufficientFunds(String),
    
    #[error("Rate limit exceeded: {0}")]
    RateLimitExceeded(String),
    
    #[error("Order rejected: {0}")]
    OrderRejected(String),
    
    #[error("Timeout: {0}")]
    Timeout(String),
    
    #[error("Execution service error: {0}")]
    ServiceError(String),
    
    #[error("Not supported: {0}")]
    NotSupported(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Status of a trade execution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionStatus {
    /// The execution request has been received but not yet processed
    Received,
    /// The execution is in progress (e.g., order submitted to exchange)
    InProgress,
    /// The execution has completed successfully
    Completed,
    /// The execution has been partially filled
    PartiallyFilled,
    /// The execution has been rejected
    Rejected,
    /// The execution has timed out
    TimedOut,
    /// The execution has been cancelled
    Cancelled,
    /// The execution has failed
    Failed,
}

/// Mode of trade execution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionMode {
    /// Live trading with real funds
    Live,
    /// Paper trading with simulated funds
    Paper,
    /// Backtesting mode
    Backtest,
    /// Sandbox mode (testnet)
    Sandbox,
}

/// Request for executing a trade
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRequest {
    /// Unique ID for this execution request
    pub id: String,
    /// The trading signal to execute
    pub signal: Signal,
    /// Mode of execution
    pub mode: ExecutionMode,
    /// Execution parameters for special cases
    pub parameters: HashMap<String, serde_json::Value>,
    /// Maximum time to wait for execution to complete
    pub timeout_ms: Option<u64>,
    /// Timestamp when this request was created
    pub created_at: DateTime<Utc>,
}

impl ExecutionRequest {
    /// Create a new execution request for a signal
    pub fn new(signal: Signal, mode: ExecutionMode) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            signal,
            mode,
            parameters: HashMap::new(),
            timeout_ms: Some(30000), // Default 30s timeout
            created_at: Utc::now(),
        }
    }
    
    /// Add a parameter to the execution request
    pub fn with_parameter(mut self, key: &str, value: serde_json::Value) -> Self {
        self.parameters.insert(key.to_string(), value);
        self
    }
    
    /// Set a custom timeout
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }
}

/// Latency profile for execution tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyProfile {
    /// Time from request creation to receipt by execution service (ms)
    pub request_processing_ms: u64,
    /// Time from receipt to submission to venue/exchange (ms)
    pub submission_ms: u64,
    /// Time from submission to first acknowledgement (ms)
    pub acknowledgement_ms: Option<u64>,
    /// Time from acknowledgement to final execution (ms)
    pub execution_ms: Option<u64>,
    /// Total end-to-end execution time (ms)
    pub total_ms: u64,
    /// Timestamp when the profile was created
    pub timestamp: DateTime<Utc>,
    /// Optional breakdown of internal processing stages
    pub processing_stages: Option<HashMap<String, u64>>,
}

impl LatencyProfile {
    /// Create a new latency profile
    pub fn new(request_processing_ms: u64) -> Self {
        Self {
            request_processing_ms,
            submission_ms: 0,
            acknowledgement_ms: None,
            execution_ms: None,
            total_ms: request_processing_ms,
            timestamp: Utc::now(),
            processing_stages: Some(HashMap::new()),
        }
    }
    
    /// Record a processing stage time
    pub fn record_stage(&mut self, stage_name: &str, duration_ms: u64) {
        if let Some(stages) = &mut self.processing_stages {
            stages.insert(stage_name.to_string(), duration_ms);
        }
    }
    
    /// Update the profile with submission time
    pub fn update_submission(&mut self, submission_ms: u64) {
        self.submission_ms = submission_ms;
        self.total_ms = self.request_processing_ms + submission_ms;
    }
    
    /// Update the profile with acknowledgement time
    pub fn update_acknowledgement(&mut self, acknowledgement_ms: u64) {
        self.acknowledgement_ms = Some(acknowledgement_ms);
        self.total_ms = self.request_processing_ms + self.submission_ms + acknowledgement_ms;
    }
    
    /// Update the profile with execution time
    pub fn update_execution(&mut self, execution_ms: u64) {
        self.execution_ms = Some(execution_ms);
        
        // Calculate total time
        self.total_ms = self.request_processing_ms + self.submission_ms;
        
        if let Some(ack_ms) = self.acknowledgement_ms {
            self.total_ms += ack_ms;
        }
        
        self.total_ms += execution_ms;
    }
    
    /// Compare with thresholds and determine if any latency is concerning
    pub fn evaluate(&self, thresholds: &LatencyThresholds) -> LatencyEvaluation {
        let mut issues = Vec::new();
        
        if self.request_processing_ms > thresholds.max_request_processing_ms {
            issues.push(LatencyIssue::SlowRequestProcessing(self.request_processing_ms));
        }
        
        if self.submission_ms > thresholds.max_submission_ms {
            issues.push(LatencyIssue::SlowSubmission(self.submission_ms));
        }
        
        if let Some(ack_ms) = self.acknowledgement_ms {
            if ack_ms > thresholds.max_acknowledgement_ms {
                issues.push(LatencyIssue::SlowAcknowledgement(ack_ms));
            }
        }
        
        if let Some(exec_ms) = self.execution_ms {
            if exec_ms > thresholds.max_execution_ms {
                issues.push(LatencyIssue::SlowExecution(exec_ms));
            }
        }
        
        if self.total_ms > thresholds.max_total_ms {
            issues.push(LatencyIssue::SlowTotal(self.total_ms));
        }
        
        if issues.is_empty() {
            LatencyEvaluation::Acceptable
        } else {
            LatencyEvaluation::Issues(issues)
        }
    }
}

/// Thresholds for acceptable latency
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyThresholds {
    /// Maximum acceptable request processing time (ms)
    pub max_request_processing_ms: u64,
    /// Maximum acceptable submission time (ms)
    pub max_submission_ms: u64,
    /// Maximum acceptable acknowledgement time (ms)
    pub max_acknowledgement_ms: u64,
    /// Maximum acceptable execution time (ms)
    pub max_execution_ms: u64,
    /// Maximum acceptable total time (ms)
    pub max_total_ms: u64,
}

impl Default for LatencyThresholds {
    fn default() -> Self {
        Self {
            max_request_processing_ms: 50,    // 50ms
            max_submission_ms: 100,           // 100ms
            max_acknowledgement_ms: 500,      // 500ms
            max_execution_ms: 2000,           // 2s
            max_total_ms: 3000,               // 3s
        }
    }
}

/// Evaluation of latency profile
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatencyEvaluation {
    /// Latency is within acceptable thresholds
    Acceptable,
    /// Latency has issues
    Issues(Vec<LatencyIssue>),
}

/// Specific latency issues
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatencyIssue {
    /// Request processing was too slow
    SlowRequestProcessing(u64),
    /// Submission to venue was too slow
    SlowSubmission(u64),
    /// Acknowledgement from venue was too slow
    SlowAcknowledgement(u64),
    /// Final execution was too slow
    SlowExecution(u64),
    /// Total execution time was too slow
    SlowTotal(u64),
}

/// Detailed context for execution errors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorContext {
    /// The original error message
    pub message: String,
    /// The error code (if available)
    pub code: Option<String>,
    /// When the error occurred
    pub timestamp: DateTime<Utc>,
    /// The component where the error occurred
    pub component: String,
    /// The operation being performed
    pub operation: String,
    /// Any retry attempt information
    pub retry_attempt: Option<u32>,
    /// Additional error details from the provider
    pub details: HashMap<String, serde_json::Value>,
    /// Whether this error is recoverable
    pub is_recoverable: bool,
    /// Suggested recovery action
    pub recovery_action: Option<String>,
}

impl ErrorContext {
    /// Create a new error context
    pub fn new(message: &str, component: &str, operation: &str) -> Self {
        Self {
            message: message.to_string(),
            code: None,
            timestamp: Utc::now(),
            component: component.to_string(),
            operation: operation.to_string(),
            retry_attempt: None,
            details: HashMap::new(),
            is_recoverable: false,
            recovery_action: None,
        }
    }
    
    /// Add an error code
    pub fn with_code(mut self, code: &str) -> Self {
        self.code = Some(code.to_string());
        self
    }
    
    /// Add retry information
    pub fn with_retry(mut self, attempt: u32) -> Self {
        self.retry_attempt = Some(attempt);
        self
    }
    
    /// Add a detail value
    pub fn with_detail(mut self, key: &str, value: serde_json::Value) -> Self {
        self.details.insert(key.to_string(), value);
        self
    }
    
    /// Mark as recoverable with suggested action
    pub fn recoverable(mut self, action: &str) -> Self {
        self.is_recoverable = true;
        self.recovery_action = Some(action.to_string());
        self
    }
}

/// Fee information with normalization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeInfo {
    /// Raw fee amount in the native currency
    pub amount: f64,
    /// Currency of the fee
    pub currency: String,
    /// Fee as percentage of trade value
    pub percentage: f64,
    /// Fee in USD (normalized)
    pub usd_equivalent: Option<f64>,
    /// Fee type (e.g., "maker", "taker", "transfer", etc.)
    pub fee_type: String,
    /// Fee tier or level
    pub tier: Option<String>,
}

impl FeeInfo {
    /// Create a new fee info
    pub fn new(amount: f64, currency: &str, percentage: f64, fee_type: &str) -> Self {
        Self {
            amount,
            currency: currency.to_string(),
            percentage,
            usd_equivalent: None,
            fee_type: fee_type.to_string(),
            tier: None,
        }
    }
    
    /// Set the USD equivalent amount
    pub fn with_usd_equivalent(mut self, usd_amount: f64) -> Self {
        self.usd_equivalent = Some(usd_amount);
        self
    }
    
    /// Set the fee tier
    pub fn with_tier(mut self, tier: &str) -> Self {
        self.tier = Some(tier.to_string());
        self
    }
}

/// Result of a trade execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    /// Unique ID for this execution result
    pub id: String,
    /// ID of the associated execution request
    pub request_id: String,
    /// ID of the signal that was executed
    pub signal_id: String,
    /// Status of the execution
    pub status: ExecutionStatus,
    /// Exchange/venue order ID (if available)
    pub order_id: Option<String>,
    /// Quantity executed
    pub executed_quantity: Option<f64>,
    /// Average execution price
    pub average_price: Option<f64>,
    /// Detailed fee information
    pub fee_info: Option<FeeInfo>,
    /// Legacy fee amount (deprecated, use fee_info instead)
    pub fees: Option<f64>,
    /// Legacy fee currency (deprecated, use fee_info instead)
    pub fee_currency: Option<String>,
    /// Timestamp when execution was completed/finalized
    pub timestamp: DateTime<Utc>,
    /// Time taken to execute in milliseconds
    pub execution_time_ms: u64,
    /// Detailed latency profile
    pub latency_profile: Option<LatencyProfile>,
    /// Error message (if any)
    pub error_message: Option<String>,
    /// Detailed error context (if error occurred)
    pub error_context: Option<ErrorContext>,
    /// Realized PnL for this execution (if applicable)
    pub realized_pnl: f64,
    /// Additional result data specific to the execution
    pub additional_data: HashMap<String, serde_json::Value>,
    /// Rejection details (if execution was rejected)
    pub rejection_details: Option<String>,
    /// Trust score that led to rejection (if applicable)
    pub trust_score: Option<f64>,
}

impl ExecutionResult {
    /// Create a successful execution result
    pub fn success(
        request_id: String,
        signal_id: String,
        order_id: Option<String>,
        executed_quantity: f64,
        average_price: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            request_id,
            signal_id,
            status: ExecutionStatus::Completed,
            order_id,
            executed_quantity: Some(executed_quantity),
            average_price: Some(average_price),
            fee_info: None,
            fees: None,
            fee_currency: None,
            timestamp: Utc::now(),
            execution_time_ms: 0, // Should be calculated by caller
            latency_profile: None,
            error_message: None,
            error_context: None,
            realized_pnl: 0.0,
            additional_data: HashMap::new(),
            rejection_details: None,
            trust_score: None,
        }
    }
    
    /// Create a failed execution result with detailed error context
    pub fn failure(
        request_id: String,
        signal_id: String,
        status: ExecutionStatus,
        error_message: String,
        error_context: Option<ErrorContext>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            request_id,
            signal_id,
            status,
            order_id: None,
            executed_quantity: None,
            average_price: None,
            fee_info: None,
            fees: None,
            fee_currency: None,
            timestamp: Utc::now(),
            execution_time_ms: 0, // Should be calculated by caller
            latency_profile: None,
            error_message: Some(error_message),
            error_context,
            realized_pnl: 0.0,
            additional_data: HashMap::new(),
            rejection_details: None,
            trust_score: None,
        }
    }
    
    /// Add detailed fee information
    pub fn with_fee_info(mut self, fee_info: FeeInfo) -> Self {
        // Also set legacy fee fields for backward compatibility
        self.fees = Some(fee_info.amount);
        self.fee_currency = Some(fee_info.currency.clone());
        self.fee_info = Some(fee_info);
        self
    }
    
    /// Add a latency profile
    pub fn with_latency_profile(mut self, profile: LatencyProfile) -> Self {
        self.latency_profile = Some(profile);
        self
    }
    
    /// Set the realized PnL
    pub fn with_realized_pnl(mut self, pnl: f64) -> Self {
        self.realized_pnl = pnl;
        self
    }
    
    /// Check if the execution was successful
    pub fn is_success(&self) -> bool {
        matches!(self.status, ExecutionStatus::Completed | ExecutionStatus::PartiallyFilled)
    }
    
    /// Check if the execution failed
    pub fn is_failure(&self) -> bool {
        matches!(
            self.status, 
            ExecutionStatus::Failed | ExecutionStatus::Rejected | ExecutionStatus::TimedOut | ExecutionStatus::Cancelled
        )
    }
    
    /// Add additional data to the result
    pub fn with_additional_data(mut self, key: &str, value: serde_json::Value) -> Self {
        self.additional_data.insert(key.to_string(), value);
        self
    }
    
    /// Check if the latency profile indicates any performance issues
    pub fn has_latency_issues(&self, thresholds: &LatencyThresholds) -> Option<LatencyEvaluation> {
        self.latency_profile.as_ref().map(|profile| profile.evaluate(thresholds))
    }
    
    /// Get normalized fee in USD (if available)
    pub fn get_normalized_fee_usd(&self) -> Option<f64> {
        self.fee_info.as_ref().and_then(|fee| fee.usd_equivalent)
    }
    
    /// Create a new result for a trust-based rejection
    pub fn trust_rejection(
        request_id: String,
        signal_id: String,
        reason: String,
        trust_score: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            request_id,
            signal_id,
            status: ExecutionStatus::Rejected,
            order_id: None,
            executed_quantity: None,
            average_price: None,
            fee_info: None,
            fees: None,
            fee_currency: None,
            timestamp: Utc::now(),
            execution_time_ms: 0,
            latency_profile: None,
            error_message: Some(format!("Trust-based rejection: {}", reason)),
            error_context: Some(ErrorContext::new(
                &reason,
                "trust_filter",
                "validate_trust_score"
            )),
            realized_pnl: 0.0,
            additional_data: HashMap::new(),
            rejection_details: Some(reason),
            trust_score: Some(trust_score),
        }
    }
    
    /// Create a new result for a governance rule violation
    pub fn governance_rule_rejection(
        request_id: String,
        signal_id: String,
        reason: String,
        rule_code: String,
        severity: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            request_id,
            signal_id,
            status: ExecutionStatus::Rejected,
            order_id: None,
            executed_quantity: None,
            average_price: None,
            fee_info: None,
            fees: None,
            fee_currency: None,
            timestamp: Utc::now(),
            execution_time_ms: 0,
            latency_profile: None,
            error_message: Some(format!("Governance rule violation: {}", reason)),
            error_context: Some(ErrorContext::new(
                &reason,
                "governance_enforcer",
                "enforce_rules"
            ).with_code(&rule_code)),
            realized_pnl: 0.0,
            additional_data: HashMap::from([
                ("rule_code".to_string(), serde_json::to_value(rule_code).unwrap()),
                ("severity".to_string(), serde_json::to_value(severity).unwrap()),
            ]),
            rejection_details: Some(reason),
            trust_score: None,
        }
    }
}

/// Defines a service for executing trades
#[async_trait]
pub trait ExecutionProvider: Send + Sync {
    /// Execute a trade based on the given request
    async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionResult, ExecutionError>;
    
    /// Cancel an ongoing execution
    async fn cancel(&self, request_id: &str) -> Result<ExecutionResult, ExecutionError>;
    
    /// Get the status of an execution
    async fn get_status(&self, request_id: &str) -> Result<ExecutionResult, ExecutionError>;
    
    /// Check if this provider supports the given execution mode
    fn supports_mode(&self, mode: ExecutionMode) -> bool;
    
    /// Get the provider's name
    fn name(&self) -> &str;
}

/// Service for executing trades
pub struct ExecutionService {
    /// Primary provider for live trades
    live_provider: Arc<dyn ExecutionProvider>,
    /// Provider for paper trading
    paper_provider: Arc<dyn ExecutionProvider>,
    /// Provider for sandbox/testnet trading
    sandbox_provider: Option<Arc<dyn ExecutionProvider>>,
    /// Selected execution mode
    mode: Arc<RwLock<ExecutionMode>>,
    /// Recent executions cache
    recent_executions: Arc<Mutex<HashMap<String, ExecutionResult>>>,
    /// Maximum number of recent executions to track
    max_recent_executions: usize,
    /// Flag for entropy delay injection
    enable_entropy_delay: bool,
    /// Optional fixed delay in milliseconds for testing
    fixed_delay_ms: Option<u64>,
}

impl ExecutionService {
    /// Create a new execution service with the given providers
    pub fn new(
        live_provider: Arc<dyn ExecutionProvider>,
        paper_provider: Arc<dyn ExecutionProvider>,
        sandbox_provider: Option<Arc<dyn ExecutionProvider>>,
    ) -> Self {
        Self {
            live_provider,
            paper_provider,
            sandbox_provider,
            mode: Arc::new(RwLock::new(ExecutionMode::Paper)), // Default to paper trading
            recent_executions: Arc::new(Mutex::new(HashMap::new())),
            max_recent_executions: 1000,
            enable_entropy_delay: false,
            fixed_delay_ms: None,
        }
    }
    
    /// Set the execution mode
    pub fn set_mode(&self, mode: ExecutionMode) -> Result<(), ExecutionError> {
        let mut current_mode = self.mode.write().unwrap();
        
        // Validate that we have a provider for this mode
        match mode {
            ExecutionMode::Live => {
                if !self.live_provider.supports_mode(mode) {
                    return Err(ExecutionError::NotSupported(
                        format!("Live mode not supported by provider {}", self.live_provider.name())
                    ));
                }
            }
            ExecutionMode::Paper => {
                if !self.paper_provider.supports_mode(mode) {
                    return Err(ExecutionError::NotSupported(
                        format!("Paper mode not supported by provider {}", self.paper_provider.name())
                    ));
                }
            }
            ExecutionMode::Sandbox => {
                if let Some(ref provider) = self.sandbox_provider {
                    if !provider.supports_mode(mode) {
                        return Err(ExecutionError::NotSupported(
                            format!("Sandbox mode not supported by provider {}", provider.name())
                        ));
                    }
                } else {
                    return Err(ExecutionError::NotSupported("No sandbox provider configured".into()));
                }
            }
            ExecutionMode::Backtest => {
                return Err(ExecutionError::NotSupported(
                    "Backtest mode is not supported by ExecutionService directly".into()
                ));
            }
        }
        
        *current_mode = mode;
        info!("Execution mode set to {:?}", mode);
        Ok(())
    }
    
    /// Get the current execution mode
    pub fn get_mode(&self) -> ExecutionMode {
        *self.mode.read().unwrap()
    }
    
    /// Configure entropy injection for execution delays
    pub fn configure_entropy(&mut self, enable: bool, fixed_delay_ms: Option<u64>) {
        self.enable_entropy_delay = enable;
        self.fixed_delay_ms = fixed_delay_ms;
        
        if enable {
            info!("Execution entropy injection enabled");
            if let Some(delay) = fixed_delay_ms {
                info!("Fixed execution delay set to {}ms", delay);
            }
        } else {
            info!("Execution entropy injection disabled");
        }
    }
    
    /// Execute a trading signal
    pub async fn execute_signal(&self, signal: Signal) -> Result<ExecutionResult, ExecutionError> {
        let mode = *self.mode.read().unwrap();
        let request = ExecutionRequest::new(signal.clone(), mode);
        
        // Apply execution delay if entropy is enabled
        if self.enable_entropy_delay {
            if let Some(delay_ms) = self.fixed_delay_ms {
                time::sleep(Duration::from_millis(delay_ms)).await;
            } else {
                // Apply random delay based on signal urgency
                let max_delay_ms = (1.0 - signal.urgency) * 2000.0; // Up to 2 seconds for low urgency
                let delay_ms = (rand::random::<f64>() * max_delay_ms) as u64;
                if delay_ms > 0 {
                    debug!("Adding entropy delay of {}ms to execution", delay_ms);
                    time::sleep(Duration::from_millis(delay_ms)).await;
                }
            }
        }
        
        // Execute request with appropriate provider
        let result = match mode {
            ExecutionMode::Live => self.live_provider.execute(request).await,
            ExecutionMode::Paper => self.paper_provider.execute(request).await,
            ExecutionMode::Sandbox => {
                if let Some(ref provider) = self.sandbox_provider {
                    provider.execute(request).await
                } else {
                    return Err(ExecutionError::NotSupported("No sandbox provider configured".into()));
                }
            }
            ExecutionMode::Backtest => {
                return Err(ExecutionError::NotSupported(
                    "Backtest mode execution is not supported via execute_signal".into()
                ));
            }
        };
        
        // Cache successful executions
        if let Ok(ref execution_result) = result {
            self.cache_execution_result(execution_result.clone());
        }
        
        result
    }
    
    /// Get the status of an execution by ID
    pub async fn get_execution_status(&self, request_id: &str) -> Result<ExecutionResult, ExecutionError> {
        // First check the cache
        {
            let executions = self.recent_executions.lock().unwrap();
            if let Some(result) = executions.get(request_id) {
                return Ok(result.clone());
            }
        }
        
        // If not in cache, check with the appropriate provider
        let mode = *self.mode.read().unwrap();
        
        match mode {
            ExecutionMode::Live => self.live_provider.get_status(request_id).await,
            ExecutionMode::Paper => self.paper_provider.get_status(request_id).await,
            ExecutionMode::Sandbox => {
                if let Some(ref provider) = self.sandbox_provider {
                    provider.get_status(request_id).await
                } else {
                    Err(ExecutionError::NotSupported("No sandbox provider configured".into()))
                }
            }
            ExecutionMode::Backtest => {
                Err(ExecutionError::NotSupported(
                    "Backtest mode status check is not supported".into()
                ))
            }
        }
    }
    
    /// Cancel an execution by ID
    pub async fn cancel_execution(&self, request_id: &str) -> Result<ExecutionResult, ExecutionError> {
        let mode = *self.mode.read().unwrap();
        
        let result = match mode {
            ExecutionMode::Live => self.live_provider.cancel(request_id).await,
            ExecutionMode::Paper => self.paper_provider.cancel(request_id).await,
            ExecutionMode::Sandbox => {
                if let Some(ref provider) = self.sandbox_provider {
                    provider.cancel(request_id).await
                } else {
                    Err(ExecutionError::NotSupported("No sandbox provider configured".into()))
                }
            }
            ExecutionMode::Backtest => {
                Err(ExecutionError::NotSupported(
                    "Backtest mode cancellation is not supported".into()
                ))
            }
        };
        
        // Update cache if successful
        if let Ok(ref execution_result) = result {
            self.cache_execution_result(execution_result.clone());
        }
        
        result
    }
    
    /// Get recent executions matching optional filters
    pub fn get_recent_executions(
        &self,
        status: Option<ExecutionStatus>,
        limit: Option<usize>,
    ) -> Vec<ExecutionResult> {
        let executions = self.recent_executions.lock().unwrap();
        
        let mut results: Vec<_> = executions.values()
            .filter(|result| {
                status.map_or(true, |s| result.status == s)
            })
            .cloned()
            .collect();
        
        // Sort by timestamp, newest first
        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        
        // Apply limit if specified
        if let Some(limit) = limit {
            results.truncate(limit);
        }
        
        results
    }
    
    /// Store an execution result in the cache
    fn cache_execution_result(&self, result: ExecutionResult) {
        let mut executions = self.recent_executions.lock().unwrap();
        
        // Add to cache
        executions.insert(result.request_id.clone(), result);
        
        // Clean up cache if it's too large
        if executions.len() > self.max_recent_executions {
            // This is inefficient for very large caches, but works for our use case
            let mut entries: Vec<_> = executions.iter().collect();
            entries.sort_by(|(_, a), (_, b)| a.timestamp.cmp(&b.timestamp));
            
            let to_remove = entries.len() - self.max_recent_executions;
            for (id, _) in entries.iter().take(to_remove) {
                executions.remove(*id);
            }
        }
    }
}

/// Paper trading provider for simulated executions
pub struct PaperTradingProvider {
    /// Simulated latency range in milliseconds (min, max)
    latency_range_ms: (u64, u64),
    /// Simulated execution results by request ID
    executions: Arc<RwLock<HashMap<String, ExecutionResult>>>,
    /// Simulated fill rate for orders (0.0-1.0)
    fill_rate: f64,
    /// Simulated slippage as percentage of price (0.0-1.0)
    slippage_pct: f64,
    /// Random failure rate to simulate execution issues (0.0-1.0)
    failure_rate: f64,
}

impl PaperTradingProvider {
    /// Create a new paper trading provider with default parameters
    pub fn new() -> Self {
        Self {
            latency_range_ms: (50, 250),
            executions: Arc::new(RwLock::new(HashMap::new())),
            fill_rate: 1.0,
            slippage_pct: 0.05,
            failure_rate: 0.01,
        }
    }
    
    /// Configure simulation parameters
    pub fn configure(
        &mut self,
        latency_range_ms: (u64, u64),
        fill_rate: f64,
        slippage_pct: f64,
        failure_rate: f64,
    ) {
        self.latency_range_ms = latency_range_ms;
        self.fill_rate = fill_rate.clamp(0.0, 1.0);
        self.slippage_pct = slippage_pct.clamp(0.0, 1.0);
        self.failure_rate = failure_rate.clamp(0.0, 1.0);
    }
    
    /// Simulate network latency
    async fn simulate_latency(&self) {
        let (min, max) = self.latency_range_ms;
        let latency = min + (rand::random::<f64>() * (max - min) as f64) as u64;
        time::sleep(Duration::from_millis(latency)).await;
    }
    
    /// Simulate execution with configurable parameters
    async fn simulate_execution(&self, request: ExecutionRequest) -> Result<ExecutionResult, ExecutionError> {
        // Simulate network latency
        self.simulate_latency().await;
        
        // Simulate random failures
        if rand::random::<f64>() < self.failure_rate {
            let error_messages = [
                "Simulated network error",
                "Simulated timeout error",
                "Simulated rate limit error",
                "Simulated service unavailable error",
            ];
            let error_message = error_messages[rand::random::<usize>() % error_messages.len()];
            
            let result = ExecutionResult::failure(
                request.id.clone(),
                request.signal.id.clone(),
                ExecutionStatus::Failed,
                error_message.to_string(),
                None,
            );
            
            return Ok(result);
        }
        
        // Get the price from the signal
        let base_price = request.signal.price_limit.unwrap_or(100.0); // Default for testing
        
        // Apply slippage based on action (buy gets higher price, sell gets lower)
        let direction_factor = match request.signal.action.to_string().as_str() {
            "BUY" | "LONG_ENTRY" => 1.0,
            _ => -1.0,
        };
        
        let slippage_factor = 1.0 + (direction_factor * self.slippage_pct / 100.0 * rand::random::<f64>());
        let executed_price = base_price * slippage_factor;
        
        // Apply fill rate
        let requested_quantity = request.signal.quantity;
        let executed_quantity = if rand::random::<f64>() < self.fill_rate {
            requested_quantity
        } else {
            requested_quantity * rand::random::<f64>()
        };
        
        // Create simulated order ID
        let order_id = format!("paper-{}", Uuid::new_v4());
        
        // Calculate execution time
        let execution_time_ms = Utc::now()
            .signed_duration_since(request.created_at)
            .num_milliseconds()
            .max(0) as u64;
        
        // Create successful result
        let mut result = ExecutionResult::success(
            request.id.clone(),
            request.signal.id.clone(),
            Some(order_id),
            executed_quantity,
            executed_price,
        );
        
        // Set execution time
        result.execution_time_ms = execution_time_ms;
        
        // Set status based on fill
        if executed_quantity < requested_quantity {
            result.status = ExecutionStatus::PartiallyFilled;
        }
        
        // Store in executions map
        {
            let mut executions = self.executions.write().unwrap();
            executions.insert(request.id.clone(), result.clone());
        }
        
        Ok(result)
    }
}

#[async_trait]
impl ExecutionProvider for PaperTradingProvider {
    async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionResult, ExecutionError> {
        self.simulate_execution(request).await
    }
    
    async fn cancel(&self, request_id: &str) -> Result<ExecutionResult, ExecutionError> {
        self.simulate_latency().await;
        
        let mut executions = self.executions.write().unwrap();
        
        if let Some(mut result) = executions.get(request_id).cloned() {
            // Only allow cancellation for in-progress orders
            if result.status == ExecutionStatus::InProgress || result.status == ExecutionStatus::Received {
                result.status = ExecutionStatus::Cancelled;
                result.timestamp = Utc::now();
                
                executions.insert(request_id.to_string(), result.clone());
                
                return Ok(result);
            } else {
                return Err(ExecutionError::OrderRejected(
                    format!("Cannot cancel order in state: {:?}", result.status)
                ));
            }
        }
        
        Err(ExecutionError::OrderRejected(format!("Order {} not found", request_id)))
    }
    
    async fn get_status(&self, request_id: &str) -> Result<ExecutionResult, ExecutionError> {
        self.simulate_latency().await;
        
        let executions = self.executions.read().unwrap();
        
        if let Some(result) = executions.get(request_id) {
            return Ok(result.clone());
        }
        
        Err(ExecutionError::OrderRejected(format!("Order {} not found", request_id)))
    }
    
    fn supports_mode(&self, mode: ExecutionMode) -> bool {
        mode == ExecutionMode::Paper
    }
    
    fn name(&self) -> &str {
        "PaperTradingProvider"
    }
}

/// Reason for the execution outcome
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionOutcomeReason {
    /// Normal fill
    NormalFill,
    /// Partial fill
    PartialFill,
    /// Order cancelled by user or system
    Cancelled,
    /// Order rejected by venue
    Rejected,
    /// Order timed out
    TimedOut,
    /// Slippage limit exceeded
    SlippageExceeded,
    /// Risk limit hit
    RiskLimitHit,
    /// Trust score too low
    LowTrustScore,
    /// Market conditions not suitable
    MarketConditions,
    /// Other reason with description
    Other(String),
}

/// Detailed execution log for analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionLog {
    /// Unique order identifier
    pub order_id: String,
    /// Strategy that generated the order
    pub strategy_id: String,
    /// Trading venue/exchange
    pub venue: String,
    /// Entry time of the order
    pub entry_time: DateTime<Utc>,
    /// Exit time (if applicable)
    pub exit_time: Option<DateTime<Utc>>,
    /// Entry price
    pub entry_price: f64,
    /// Exit price (if applicable)
    pub exit_price: Option<f64>,
    /// Quantity that was filled
    pub filled_qty: f64,
    /// Slippage in basis points
    pub slippage_bps: f64,
    /// Maximum drawdown percentage for this trade
    pub max_drawdown_pct: f64,
    /// Execution latency in milliseconds
    pub execution_latency_ms: u64,
    /// Reason for the execution outcome
    pub reason: ExecutionOutcomeReason,
    /// Optional tags for analysis
    pub tags: Option<Vec<String>>,
    /// Optional metadata for additional context
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

impl ExecutionLog {
    /// Create a new execution log
    pub fn new(
        order_id: String,
        strategy_id: String,
        venue: String,
        entry_time: DateTime<Utc>,
        entry_price: f64,
        filled_qty: f64,
        reason: ExecutionOutcomeReason,
    ) -> Self {
        Self {
            order_id,
            strategy_id,
            venue,
            entry_time,
            exit_time: None,
            entry_price,
            exit_price: None,
            filled_qty,
            slippage_bps: 0.0,
            max_drawdown_pct: 0.0,
            execution_latency_ms: 0,
            reason,
            tags: None,
            metadata: None,
        }
    }
    
    /// Create an execution log from an execution result
    pub fn from_execution_result(result: &ExecutionResult, strategy_id: &str, venue: &str) -> Self {
        let reason = match result.status {
            ExecutionStatus::Completed => ExecutionOutcomeReason::NormalFill,
            ExecutionStatus::PartiallyFilled => ExecutionOutcomeReason::PartialFill,
            ExecutionStatus::Cancelled => ExecutionOutcomeReason::Cancelled,
            ExecutionStatus::Rejected => ExecutionOutcomeReason::Rejected,
            ExecutionStatus::TimedOut => ExecutionOutcomeReason::TimedOut,
            ExecutionStatus::Failed => ExecutionOutcomeReason::Other(
                result.error_message.clone().unwrap_or_else(|| "Unknown failure".to_string())
            ),
            _ => ExecutionOutcomeReason::Other("Unknown status".to_string()),
        };
        
        let mut log = Self::new(
            result.id.clone(),
            strategy_id.to_string(),
            venue.to_string(),
            result.timestamp,
            result.average_price.unwrap_or(0.0),
            result.executed_quantity.unwrap_or(0.0),
            reason,
        );
        
        // Add latency if available
        if let Some(latency) = &result.latency_profile {
            log.execution_latency_ms = latency.total_ms;
        }
        
        log
    }
    
    /// Add exit information to the execution log
    pub fn with_exit(&mut self, exit_time: DateTime<Utc>, exit_price: f64) -> &mut Self {
        self.exit_time = Some(exit_time);
        self.exit_price = Some(exit_price);
        self
    }
    
    /// Add slippage information
    pub fn with_slippage(&mut self, expected_price: f64) -> &mut Self {
        if self.entry_price > 0.0 && expected_price > 0.0 {
            self.slippage_bps = ((self.entry_price - expected_price) / expected_price) * 10_000.0;
        }
        self
    }
    
    /// Add drawdown information
    pub fn with_drawdown(&mut self, max_drawdown_pct: f64) -> &mut Self {
        self.max_drawdown_pct = max_drawdown_pct;
        self
    }
    
    /// Add tags for analysis
    pub fn with_tags(&mut self, tags: Vec<String>) -> &mut Self {
        self.tags = Some(tags);
        self
    }
    
    /// Add metadata
    pub fn with_metadata(&mut self, metadata: HashMap<String, serde_json::Value>) -> &mut Self {
        self.metadata = Some(metadata);
        self
    }
    
    /// Calculate holding time in seconds
    pub fn holding_time_seconds(&self) -> Option<i64> {
        if let Some(exit_time) = self.exit_time {
            let duration = exit_time.signed_duration_since(self.entry_time);
            Some(duration.num_seconds())
        } else {
            None
        }
    }
}

/// Execution quality score metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionQualityScore {
    /// Overall execution quality score (0.0-1.0)
    pub overall_score: f64,
    /// Slippage component of the score
    pub slippage_score: f64,
    /// Latency component of the score
    pub latency_score: f64,
    /// Fill rate component of the score
    pub fill_rate_score: f64,
    /// Cancel rate component of the score
    pub cancel_rate_score: f64,
    /// Strategy ID this score belongs to
    pub strategy_id: String,
    /// Timestamp of the score calculation
    pub timestamp: DateTime<Utc>,
    /// Trading venue this score applies to
    pub venue: Option<String>,
    /// Market volatility at time of execution
    pub market_volatility: Option<f64>,
    /// Number of executions used in calculation
    pub execution_count: usize,
}

impl ExecutionQualityScore {
    /// Create a new execution quality score
    pub fn new(strategy_id: String) -> Self {
        Self {
            overall_score: 0.0,
            slippage_score: 0.0,
            latency_score: 0.0,
            fill_rate_score: 0.0,
            cancel_rate_score: 0.0,
            strategy_id,
            timestamp: Utc::now(),
            venue: None,
            market_volatility: None,
            execution_count: 0,
        }
    }
    
    /// Calculate the overall score
    pub fn calculate_overall_score(&mut self, weights: Option<ExecutionQualityWeights>) -> &mut Self {
        let weights = weights.unwrap_or_default();
        
        self.overall_score = (
            weights.slippage * self.slippage_score +
            weights.latency * self.latency_score +
            weights.fill_rate * self.fill_rate_score +
            weights.cancel_rate * self.cancel_rate_score
        ) / (weights.slippage + weights.latency + weights.fill_rate + weights.cancel_rate);
        
        self
    }
}

/// Weights for execution quality score components
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionQualityWeights {
    /// Weight for slippage component
    pub slippage: f64,
    /// Weight for latency component
    pub latency: f64,
    /// Weight for fill rate component
    pub fill_rate: f64,
    /// Weight for cancel rate component
    pub cancel_rate: f64,
}

impl Default for ExecutionQualityWeights {
    fn default() -> Self {
        Self {
            slippage: 0.4,
            latency: 0.2,
            fill_rate: 0.3,
            cancel_rate: 0.1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strategy::{SignalAction, Signal};
    
    fn create_test_signal() -> Signal {
        let mut signal = Signal::new(
            "test-strategy".to_string(),
            "BTC/USDT".to_string(),
            SignalAction::Buy,
            0.1,
        );
        
        signal.price_limit = Some(50000.0);
        signal
    }
    
    #[tokio::test]
    async fn test_paper_trading_provider() {
        let provider = PaperTradingProvider::new();
        let signal = create_test_signal();
        
        let request = ExecutionRequest::new(signal, ExecutionMode::Paper);
        let result = provider.execute(request.clone()).await.unwrap();
        
        // Test basic execution
        assert!(result.is_success());
        assert!(result.executed_quantity.unwrap() > 0.0);
        
        // Test status lookup
        let status = provider.get_status(&request.id).await.unwrap();
        assert_eq!(status.request_id, request.id);
        
        // Test cancellation (should fail because it's already completed)
        let cancel_result = provider.cancel(&request.id).await;
        assert!(cancel_result.is_err());
    }
    
    #[tokio::test]
    async fn test_execution_service() {
        let paper_provider = Arc::new(PaperTradingProvider::new());
        // In a real implementation, we'd have a LiveTradingProvider here
        let live_provider = Arc::new(PaperTradingProvider::new());
        
        let service = ExecutionService::new(
            live_provider,
            paper_provider,
            None,
        );
        
        // Test paper trading mode
        assert_eq!(service.get_mode(), ExecutionMode::Paper);
        
        // Test signal execution
        let signal = create_test_signal();
        let result = service.execute_signal(signal).await.unwrap();
        
        assert!(result.is_success());
        
        // Test recent executions
        let recent = service.get_recent_executions(None, Some(10));
        assert_eq!(recent.len(), 1);
        
        // Test status lookup
        let status = service.get_execution_status(&result.request_id).await.unwrap();
        assert_eq!(status.id, result.id);
    }
} 