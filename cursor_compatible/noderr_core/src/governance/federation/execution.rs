// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};
use chrono::Utc;
use async_trait::async_trait;

use crate::redis::RedisClient;
use crate::telemetry::TelemetryReporter;
use crate::governance::federation::types::{
    FederatedProposal,
    FederatedProposalStatus,
    ProposalSyncState
};
use crate::governance::federation::vote_tracker::{
    FederatedVoteTracker,
    VoteTrackingError
};
use crate::governance::federation::relay::{
    ProposalRelay,
    RelayError
};

/// Execution error types
#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    #[error("Proposal not found: {0}")]
    ProposalNotFound(String),
    
    #[error("Invalid proposal state: {0}")]
    InvalidState(String),
    
    #[error("Voting error: {0}")]
    VotingError(#[from] VoteTrackingError),
    
    #[error("Relay error: {0}")]
    RelayError(#[from] RelayError),
    
    #[error("Internal error: {0}")]
    InternalError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),
}

/// Execution status of a federated proposal
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExecutionStatus {
    /// Not yet executed
    Pending,
    /// Execution is in progress
    InProgress,
    /// Execution completed successfully
    Completed,
    /// Execution failed
    Failed,
    /// Execution was cancelled
    Cancelled
}

impl std::fmt::Display for ExecutionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExecutionStatus::Pending => write!(f, "pending"),
            ExecutionStatus::InProgress => write!(f, "in_progress"),
            ExecutionStatus::Completed => write!(f, "completed"),
            ExecutionStatus::Failed => write!(f, "failed"),
            ExecutionStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Result of an execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    /// Proposal ID
    pub proposal_id: String,
    /// Domain ID that executed this
    pub domain_id: String,
    /// Current execution status
    pub status: ExecutionStatus,
    /// Any error message
    pub error: Option<String>,
    /// Additional output data
    pub output: Option<serde_json::Value>,
    /// Timestamp of this result
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Domain execution status 
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DomainExecutionStatus {
    /// Domain ID
    pub domain_id: String,
    /// Whether the domain has acknowledged the execution
    pub acknowledged: bool,
    /// Current execution status
    pub status: ExecutionStatus,
    /// Last known update
    pub last_update: chrono::DateTime<chrono::Utc>,
    /// Any error message
    pub error: Option<String>,
}

/// Execution plan for a proposal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    /// Proposal ID
    pub proposal_id: String,
    /// Execution status per domain
    pub domain_status: HashMap<String, DomainExecutionStatus>,
    /// Whether execution can proceed
    pub can_execute: bool,
    /// Whether all domains have completed execution
    pub all_complete: bool,
    /// Whether execution has failed
    pub has_failed: bool,
    /// Timestamp of when the plan was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Timestamp of when the plan was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Interface for executing proposal payloads 
#[async_trait]
pub trait ProposalExecutor: Send + Sync {
    /// Execute a proposal payload
    async fn execute_proposal(&self, proposal: &FederatedProposal) -> Result<ExecutionResult, ExecutionError>;
    
    /// Check if this executor can handle a proposal
    fn can_execute(&self, proposal: &FederatedProposal) -> bool;
    
    /// Get the type of proposals this executor handles
    fn executor_type(&self) -> &str;
}

/// Main engine for coordinating execution of federated proposals
pub struct FederatedExecutionEngine {
    /// Redis client for storage
    redis: Arc<RedisClient>,
    /// Telemetry reporter
    telemetry: Arc<TelemetryReporter>,
    /// Vote tracker
    vote_tracker: Arc<FederatedVoteTracker>,
    /// Proposal relay
    relay: Arc<ProposalRelay>,
    /// Local domain ID
    local_domain_id: String,
    /// Proposal executors
    executors: Vec<Arc<dyn ProposalExecutor>>,
}

impl FederatedExecutionEngine {
    /// Create a new federated execution engine
    pub fn new(
        redis: Arc<RedisClient>,
        telemetry: Arc<TelemetryReporter>,
        vote_tracker: Arc<FederatedVoteTracker>,
        relay: Arc<ProposalRelay>,
        local_domain_id: String,
    ) -> Self {
        Self {
            redis,
            telemetry,
            vote_tracker,
            relay,
            local_domain_id,
            executors: Vec::new(),
        }
    }
    
    /// Register a proposal executor
    pub fn register_executor(&mut self, executor: Arc<dyn ProposalExecutor>) {
        info!("Registering executor of type: {}", executor.executor_type());
        self.executors.push(executor);
    }
    
    /// Get the proposal by ID
    async fn get_proposal(&self, proposal_id: &str) -> Result<FederatedProposal, ExecutionError> {
        let key = format!("federation:proposals:{}", proposal_id);
        
        match self.redis.get::<String>(&key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FederatedProposal>(&json) {
                    Ok(proposal) => Ok(proposal),
                    Err(e) => Err(ExecutionError::SerializationError(format!(
                        "Failed to deserialize proposal: {}", e
                    ))),
                }
            },
            Ok(None) => Err(ExecutionError::ProposalNotFound(proposal_id.to_string())),
            Err(e) => Err(ExecutionError::InternalError(format!(
                "Failed to get proposal from Redis: {}", e
            ))),
        }
    }
    
    /// Update a proposal
    async fn update_proposal(&self, proposal: &FederatedProposal) -> Result<(), ExecutionError> {
        let key = format!("federation:proposals:{}", proposal.id);
        let proposal_json = match serde_json::to_string(proposal) {
            Ok(json) => json,
            Err(e) => return Err(ExecutionError::SerializationError(format!(
                "Failed to serialize proposal: {}", e
            ))),
        };
        
        if let Err(e) = self.redis.set(&key, &proposal_json).await {
            return Err(ExecutionError::InternalError(format!(
                "Failed to update proposal in Redis: {}", e
            )));
        }
        
        Ok(())
    }
    
    /// Check if a proposal has been approved for execution
    pub async fn is_proposal_approved(&self, proposal_id: &str) -> Result<bool, ExecutionError> {
        let proposal = self.get_proposal(proposal_id).await?;
        
        // Proposal must be in Executing state
        if proposal.status != FederatedProposalStatus::Executing {
            return Ok(false);
        }
        
        // Verify voting passed
        match self.vote_tracker.has_proposal_passed(proposal_id).await {
            Ok(passed) => Ok(passed),
            Err(e) => Err(ExecutionError::VotingError(e)),
        }
    }
    
    /// Prepare an execution plan for a proposal
    pub async fn prepare_execution_plan(&self, proposal_id: &str) -> Result<ExecutionPlan, ExecutionError> {
        let proposal = self.get_proposal(proposal_id).await?;
        
        // Verify proposal is ready for execution
        if proposal.status != FederatedProposalStatus::Executing {
            return Err(ExecutionError::InvalidState(format!(
                "Proposal {} is not in executing state, current status: {:?}",
                proposal_id, proposal.status
            )));
        }
        
        // Create domain status map
        let mut domain_status = HashMap::new();
        for domain_id in &proposal.participating_domains {
            let sync_state = proposal.sync_state.iter()
                .find(|s| &s.domain_id == domain_id)
                .cloned()
                .unwrap_or_else(|| ProposalSyncState {
                    domain_id: domain_id.clone(),
                    acknowledged: domain_id == &proposal.origin_domain,
                    voting_complete: false,
                    execution_initiated: false,
                    execution_finalized: false,
                    last_sync: Utc::now(),
                    last_error: None,
                });
            
            let status = if sync_state.execution_finalized {
                ExecutionStatus::Completed
            } else if sync_state.execution_initiated {
                ExecutionStatus::InProgress
            } else {
                ExecutionStatus::Pending
            };
            
            domain_status.insert(domain_id.clone(), DomainExecutionStatus {
                domain_id: domain_id.clone(),
                acknowledged: sync_state.acknowledged,
                status,
                last_update: sync_state.last_sync,
                error: None,
            });
        }
        
        // Determine overall execution status
        let all_complete = domain_status.values().all(|s| s.status == ExecutionStatus::Completed);
        let has_failed = domain_status.values().any(|s| s.status == ExecutionStatus::Failed);
        
        // Determine if execution can proceed
        let can_execute = !has_failed 
            && domain_status.values().all(|s| s.acknowledged) 
            && domain_status.values().none(|s| s.status == ExecutionStatus::Failed);
        
        let plan = ExecutionPlan {
            proposal_id: proposal_id.to_string(),
            domain_status,
            can_execute,
            all_complete,
            has_failed,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        
        // Cache the plan
        let plan_key = format!("federation:proposals:{}:execution_plan", proposal_id);
        let plan_json = serde_json::to_string(&plan)
            .map_err(|e| ExecutionError::SerializationError(e.to_string()))?;
        
        if let Err(e) = self.redis.set(&plan_key, &plan_json).await {
            error!("Failed to cache execution plan: {}", e);
            // Non-critical error, continue
        }
        
        Ok(plan)
    }
    
    /// Signal execution intent to other domains
    pub async fn signal_execution_intent(&self, proposal_id: &str) -> Result<(), ExecutionError> {
        let proposal = self.get_proposal(proposal_id).await?;
        
        // Verify proposal is in executing state
        if proposal.status != FederatedProposalStatus::Executing {
            return Err(ExecutionError::InvalidState(format!(
                "Cannot signal execution intent for proposal {} in state {:?}",
                proposal_id, proposal.status
            )));
        }
        
        // Send intent to other domains
        self.relay.signal_execution_intent(&proposal).await
            .map_err(|e| ExecutionError::RelayError(e))?;
        
        // Update local sync state
        let mut updated_proposal = proposal.clone();
        for state in &mut updated_proposal.sync_state {
            if state.domain_id == self.local_domain_id {
                state.execution_initiated = true;
                state.last_sync = Utc::now();
            }
        }
        
        // Update proposal in storage
        self.update_proposal(&updated_proposal).await?;
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        self.telemetry.report_custom("execution_intent_signaled", data).await;
        
        Ok(())
    }
    
    /// Execute a proposal on this domain
    pub async fn execute_proposal(&self, proposal_id: &str) -> Result<ExecutionResult, ExecutionError> {
        let proposal = self.get_proposal(proposal_id).await?;
        
        // Verify proposal is approved for execution
        if !self.is_proposal_approved(proposal_id).await? {
            return Err(ExecutionError::InvalidState(format!(
                "Proposal {} is not approved for execution",
                proposal_id
            )));
        }
        
        // Find an executor that can handle this proposal
        let executor = self.executors.iter()
            .find(|e| e.can_execute(&proposal))
            .ok_or_else(|| ExecutionError::InternalError(format!(
                "No executor found for proposal {}",
                proposal_id
            )))?;
        
        info!("Executing proposal {} with executor type {}", proposal_id, executor.executor_type());
        
        // Signal execution intent
        self.signal_execution_intent(proposal_id).await?;
        
        // Execute the proposal
        let result = match executor.execute_proposal(&proposal).await {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to execute proposal {}: {}", proposal_id, e);
                
                // Create a failure result
                ExecutionResult {
                    proposal_id: proposal_id.to_string(),
                    domain_id: self.local_domain_id.clone(),
                    status: ExecutionStatus::Failed,
                    error: Some(e.to_string()),
                    output: None,
                    timestamp: Utc::now(),
                }
            }
        };
        
        // Store the execution result
        let result_key = format!("federation:proposals:{}:execution_result:{}", 
                               proposal_id, self.local_domain_id);
        let result_json = serde_json::to_string(&result)
            .map_err(|e| ExecutionError::SerializationError(e.to_string()))?;
        
        if let Err(e) = self.redis.set(&result_key, &result_json).await {
            error!("Failed to store execution result: {}", e);
            // Non-critical error, continue
        }
        
        // Update proposal sync state
        let mut updated_proposal = proposal.clone();
        for state in &mut updated_proposal.sync_state {
            if state.domain_id == self.local_domain_id {
                state.execution_finalized = result.status == ExecutionStatus::Completed;
                state.last_sync = Utc::now();
                state.last_error = result.error.clone();
            }
        }
        
        // Update proposal in storage
        self.update_proposal(&updated_proposal).await?;
        
        // Report execution result
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("status".to_string(), serde_json::to_value(&result.status).unwrap());
        if let Some(ref error) = result.error {
            data.insert("error".to_string(), serde_json::to_value(error).unwrap());
        }
        self.telemetry.report_custom("proposal_executed", data).await;
        
        Ok(result)
    }
    
    /// Get the execution result for a proposal on this domain
    pub async fn get_execution_result(&self, proposal_id: &str) -> Result<Option<ExecutionResult>, ExecutionError> {
        let result_key = format!("federation:proposals:{}:execution_result:{}", 
                               proposal_id, self.local_domain_id);
        
        match self.redis.get::<String>(&result_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<ExecutionResult>(&json) {
                    Ok(result) => Ok(Some(result)),
                    Err(e) => Err(ExecutionError::SerializationError(format!(
                        "Failed to deserialize execution result: {}", e
                    ))),
                }
            },
            Ok(None) => Ok(None),
            Err(e) => Err(ExecutionError::InternalError(format!(
                "Failed to get execution result from Redis: {}", e
            ))),
        }
    }
    
    /// Check if all domains have executed a proposal
    pub async fn is_execution_complete(&self, proposal_id: &str) -> Result<bool, ExecutionError> {
        let plan = self.prepare_execution_plan(proposal_id).await?;
        Ok(plan.all_complete)
    }
    
    /// Finalize a proposal
    pub async fn finalize_proposal(&self, proposal_id: &str) -> Result<FederatedProposal, ExecutionError> {
        let mut proposal = self.get_proposal(proposal_id).await?;
        
        // Verify proposal is in executing state
        if proposal.status != FederatedProposalStatus::Executing {
            return Err(ExecutionError::InvalidState(format!(
                "Cannot finalize proposal {} in state {:?}",
                proposal_id, proposal.status
            )));
        }
        
        // Check if execution is complete
        let plan = self.prepare_execution_plan(proposal_id).await?;
        if !plan.all_complete {
            return Err(ExecutionError::InvalidState(format!(
                "Cannot finalize proposal {} because execution is not complete on all domains",
                proposal_id
            )));
        }
        
        // Update proposal status
        proposal.update_status(FederatedProposalStatus::Finalized);
        
        // Update proposal in storage
        self.update_proposal(&proposal).await?;
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        self.telemetry.report_custom("proposal_finalized", data).await;
        
        Ok(proposal)
    }
    
    /// Run periodic check for proposals that need execution
    pub async fn check_pending_executions(&self) -> Result<Vec<ExecutionResult>, ExecutionError> {
        let mut results = Vec::new();
        
        // Get all proposals
        let proposal_ids = match self.redis.smembers::<String>("federation:proposals:index").await {
            Ok(ids) => ids,
            Err(e) => {
                error!("Failed to get proposal index: {}", e);
                return Ok(results);
            }
        };
        
        // Check each proposal
        for proposal_id in proposal_ids {
            match self.get_proposal(&proposal_id).await {
                Ok(proposal) => {
                    // Check if proposal is ready for execution
                    if proposal.status == FederatedProposalStatus::Executing {
                        // Check if we've already executed this proposal
                        let already_executed = match self.get_execution_result(&proposal_id).await {
                            Ok(Some(_)) => true,
                            _ => false,
                        };
                        
                        if !already_executed {
                            // Execute the proposal
                            match self.execute_proposal(&proposal_id).await {
                                Ok(result) => {
                                    info!("Executed proposal {} with status {:?}", proposal_id, result.status);
                                    results.push(result);
                                },
                                Err(e) => {
                                    error!("Failed to execute proposal {}: {}", proposal_id, e);
                                    // Continue with other proposals
                                }
                            }
                        }
                    }
                },
                Err(e) => {
                    error!("Failed to get proposal {}: {}", proposal_id, e);
                    // Continue with other proposals
                }
            }
        }
        
        Ok(results)
    }
    
    /// Run periodic check for proposals that need finalization
    pub async fn check_pending_finalizations(&self) -> Result<Vec<FederatedProposal>, ExecutionError> {
        let mut results = Vec::new();
        
        // Get all proposals
        let proposal_ids = match self.redis.smembers::<String>("federation:proposals:index").await {
            Ok(ids) => ids,
            Err(e) => {
                error!("Failed to get proposal index: {}", e);
                return Ok(results);
            }
        };
        
        // Check each proposal
        for proposal_id in proposal_ids {
            match self.get_proposal(&proposal_id).await {
                Ok(proposal) => {
                    // Check if proposal is ready for finalization
                    if proposal.status == FederatedProposalStatus::Executing {
                        match self.is_execution_complete(&proposal_id).await {
                            Ok(true) => {
                                // Finalize the proposal
                                match self.finalize_proposal(&proposal_id).await {
                                    Ok(updated) => {
                                        info!("Finalized proposal {}", proposal_id);
                                        results.push(updated);
                                    },
                                    Err(e) => {
                                        error!("Failed to finalize proposal {}: {}", proposal_id, e);
                                        // Continue with other proposals
                                    }
                                }
                            },
                            Err(e) => {
                                error!("Failed to check execution completion for proposal {}: {}", proposal_id, e);
                                // Continue with other proposals
                            },
                            _ => {}
                        }
                    }
                },
                Err(e) => {
                    error!("Failed to get proposal {}: {}", proposal_id, e);
                    // Continue with other proposals
                }
            }
        }
        
        Ok(results)
    }
    
    /// Start the execution engine background tasks
    pub fn start(&self) -> Arc<Self> {
        let this = Arc::new(self.clone());
        let execution_this = this.clone();
        let finalization_this = this.clone();
        
        // Spawn execution check task
        tokio::spawn(async move {
            let check_interval_ms = 10000; // 10 seconds
            
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(check_interval_ms)).await;
                
                match execution_this.check_pending_executions().await {
                    Ok(results) => {
                        if !results.is_empty() {
                            debug!("Executed {} pending proposals", results.len());
                        }
                    },
                    Err(e) => {
                        error!("Failed to check pending executions: {}", e);
                    }
                }
            }
        });
        
        // Spawn finalization check task
        tokio::spawn(async move {
            let check_interval_ms = 15000; // 15 seconds
            
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(check_interval_ms)).await;
                
                match finalization_this.check_pending_finalizations().await {
                    Ok(results) => {
                        if !results.is_empty() {
                            debug!("Finalized {} pending proposals", results.len());
                        }
                    },
                    Err(e) => {
                        error!("Failed to check pending finalizations: {}", e);
                    }
                }
            }
        });
        
        this
    }
} 