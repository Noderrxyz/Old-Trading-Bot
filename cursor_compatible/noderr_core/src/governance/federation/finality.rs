// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};
use chrono::{DateTime, Utc};
use tokio::sync::RwLock;

use crate::redis::RedisClient;
use crate::telemetry::TelemetryReporter;
use crate::governance::federation::types::{
    FederatedProposal,
    FederatedProposalStatus,
};
use crate::governance::federation::execution::{
    FederatedExecutionEngine,
    ExecutionError,
    ExecutionStatus,
};

/// Error types for finality handling
#[derive(Debug, thiserror::Error)]
pub enum FinalityError {
    #[error("Proposal not found: {0}")]
    ProposalNotFound(String),
    
    #[error("Lock not available: {0}")]
    LockNotAvailable(String),
    
    #[error("Lock timeout: {0}")]
    LockTimeout(String),
    
    #[error("Invalid state: {0}")]
    InvalidState(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
    
    #[error("Execution error: {0}")]
    ExecutionError(#[from] ExecutionError),
}

/// Finality lock status
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FinalityLockStatus {
    /// No lock has been acquired
    Unlocked,
    /// Lock has been acquired but not yet committed
    Locked,
    /// Lock has been committed (final)
    Committed,
    /// Lock has been aborted
    Aborted,
}

impl std::fmt::Display for FinalityLockStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FinalityLockStatus::Unlocked => write!(f, "unlocked"),
            FinalityLockStatus::Locked => write!(f, "locked"),
            FinalityLockStatus::Committed => write!(f, "committed"),
            FinalityLockStatus::Aborted => write!(f, "aborted"),
        }
    }
}

/// Finality lock for cross-domain atomicity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalityLock {
    /// Proposal ID
    pub proposal_id: String,
    /// Current lock status
    pub status: FinalityLockStatus,
    /// Domain IDs that have acknowledged the lock
    pub acknowledged_by: Vec<String>,
    /// Domain IDs that have committed
    pub committed_by: Vec<String>,
    /// Domain IDs that have aborted
    pub aborted_by: Vec<String>,
    /// When the lock was created
    pub created_at: DateTime<Utc>,
    /// When the lock was last updated
    pub updated_at: DateTime<Utc>,
    /// Lock timeout timestamp
    pub timeout_at: Option<DateTime<Utc>>,
    /// Reason for abort, if any
    pub abort_reason: Option<String>,
}

impl FinalityLock {
    /// Create a new finality lock
    pub fn new(proposal_id: String) -> Self {
        let now = Utc::now();
        Self {
            proposal_id,
            status: FinalityLockStatus::Unlocked,
            acknowledged_by: Vec::new(),
            committed_by: Vec::new(),
            aborted_by: Vec::new(),
            created_at: now,
            updated_at: now,
            timeout_at: None,
            abort_reason: None,
        }
    }
    
    /// Check if the lock is currently valid
    pub fn is_valid(&self) -> bool {
        if let Some(timeout) = self.timeout_at {
            Utc::now() < timeout
        } else {
            self.status == FinalityLockStatus::Locked || self.status == FinalityLockStatus::Committed
        }
    }
    
    /// Check if a domain has acknowledged the lock
    pub fn is_acknowledged_by(&self, domain_id: &str) -> bool {
        self.acknowledged_by.contains(&domain_id.to_string())
    }
    
    /// Check if a domain has committed the lock
    pub fn is_committed_by(&self, domain_id: &str) -> bool {
        self.committed_by.contains(&domain_id.to_string())
    }
    
    /// Check if a domain has aborted the lock
    pub fn is_aborted_by(&self, domain_id: &str) -> bool {
        self.aborted_by.contains(&domain_id.to_string())
    }
}

/// Handles atomic cross-domain execution locking
pub struct FinalityLockManager {
    /// Redis client for storage
    redis: Arc<RedisClient>,
    /// Telemetry reporter
    telemetry: Arc<TelemetryReporter>,
    /// Execution engine
    execution_engine: Arc<FederatedExecutionEngine>,
    /// Local domain ID
    local_domain_id: String,
    /// Active locks cache
    active_locks: Arc<RwLock<HashMap<String, FinalityLock>>>,
    /// Default lock timeout in seconds
    default_lock_timeout_seconds: u64,
}

impl FinalityLockManager {
    /// Create a new finality lock handler
    pub fn new(
        redis: Arc<RedisClient>,
        telemetry: Arc<TelemetryReporter>,
        execution_engine: Arc<FederatedExecutionEngine>,
        local_domain_id: String,
    ) -> Self {
        Self {
            redis,
            telemetry,
            execution_engine,
            local_domain_id,
            active_locks: Arc::new(RwLock::new(HashMap::new())),
            default_lock_timeout_seconds: 120, // 2 minutes default
        }
    }
    
    /// Set the default lock timeout
    pub fn set_default_timeout(&mut self, seconds: u64) {
        self.default_lock_timeout_seconds = seconds;
    }
    
    /// Try to acquire a lock for a proposal
    pub async fn acquire_lock(&self, proposal_id: &str) -> Result<FinalityLock, FinalityError> {
        // Check if the proposal is ready for execution
        let is_approved = self.execution_engine.is_proposal_approved(proposal_id).await
            .map_err(|e| FinalityError::ExecutionError(e))?;
        
        if !is_approved {
            return Err(FinalityError::InvalidState(format!(
                "Proposal {} is not approved for execution",
                proposal_id
            )));
        }
        
        // Try to get an existing lock
        let lock_key = format!("federation:locks:{}", proposal_id);
        
        let existing_lock = match self.redis.get::<String>(&lock_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FinalityLock>(&json) {
                    Ok(lock) => Some(lock),
                    Err(e) => {
                        error!("Failed to deserialize lock: {}", e);
                        None
                    }
                }
            },
            Ok(None) => None,
            Err(e) => {
                error!("Failed to get lock from Redis: {}", e);
                None
            }
        };
        
        if let Some(lock) = existing_lock {
            // Check if the lock is valid
            if lock.is_valid() {
                // If we already hold the lock, return it
                if lock.is_acknowledged_by(&self.local_domain_id) {
                    return Ok(lock);
                }
                
                // Otherwise, we can't acquire it yet
                return Err(FinalityError::LockNotAvailable(format!(
                    "Lock for proposal {} is already held by other domains", 
                    proposal_id
                )));
            }
            
            // Lock is invalid/expired, we can try to acquire it
        }
        
        // Create a new lock
        let now = Utc::now();
        let timeout = now + chrono::Duration::seconds(self.default_lock_timeout_seconds as i64);
        
        let mut lock = FinalityLock::new(proposal_id.to_string());
        lock.status = FinalityLockStatus::Locked;
        lock.acknowledged_by.push(self.local_domain_id.clone());
        lock.timeout_at = Some(timeout);
        lock.updated_at = now;
        
        // Store the lock
        let lock_json = serde_json::to_string(&lock)
            .map_err(|e| FinalityError::InternalError(format!("Failed to serialize lock: {}", e)))?;
        
        let set_options = redis::SetOptions::default()
            .with_nx() // Only set if it doesn't exist
            .with_px(Duration::from_secs(self.default_lock_timeout_seconds * 1000)); // Set expiry
            
        let set_result = self.redis.set_with_options(&lock_key, &lock_json, set_options).await
            .map_err(|e| FinalityError::InternalError(format!("Failed to store lock: {}", e)))?;
        
        if !set_result {
            // Someone else acquired the lock just now
            return Err(FinalityError::LockNotAvailable(format!(
                "Race condition: Lock for proposal {} was acquired by another domain",
                proposal_id
            )));
        }
        
        // Update the cache
        let mut active_locks = self.active_locks.write().await;
        active_locks.insert(proposal_id.to_string(), lock.clone());
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("domain_id".to_string(), serde_json::to_value(&self.local_domain_id).unwrap());
        self.telemetry.report_custom("finality_lock_acquired", data).await;
        
        Ok(lock)
    }
    
    /// Acknowledge a lock from another domain
    pub async fn acknowledge_lock(&self, proposal_id: &str) -> Result<FinalityLock, FinalityError> {
        // Get the current lock
        let lock_key = format!("federation:locks:{}", proposal_id);
        
        let existing_lock = match self.redis.get::<String>(&lock_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FinalityLock>(&json) {
                    Ok(lock) => lock,
                    Err(e) => {
                        return Err(FinalityError::InternalError(format!("Failed to deserialize lock: {}", e)));
                    }
                }
            },
            Ok(None) => {
                return Err(FinalityError::LockNotAvailable(format!(
                    "No lock exists for proposal {}", proposal_id
                )));
            },
            Err(e) => {
                return Err(FinalityError::InternalError(format!("Failed to get lock from Redis: {}", e)));
            }
        };
        
        // Make sure the lock is valid
        if !existing_lock.is_valid() {
            return Err(FinalityError::LockTimeout(format!(
                "Lock for proposal {} has expired", proposal_id
            )));
        }
        
        // Make sure we haven't already acknowledged
        if existing_lock.is_acknowledged_by(&self.local_domain_id) {
            return Ok(existing_lock);
        }
        
        // Acknowledge the lock
        let mut updated_lock = existing_lock.clone();
        updated_lock.acknowledged_by.push(self.local_domain_id.clone());
        updated_lock.updated_at = Utc::now();
        
        // Store the updated lock
        let lock_json = serde_json::to_string(&updated_lock)
            .map_err(|e| FinalityError::InternalError(format!("Failed to serialize lock: {}", e)))?;
        
        self.redis.set(&lock_key, &lock_json).await
            .map_err(|e| FinalityError::InternalError(format!("Failed to update lock: {}", e)))?;
        
        // Update the cache
        let mut active_locks = self.active_locks.write().await;
        active_locks.insert(proposal_id.to_string(), updated_lock.clone());
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("domain_id".to_string(), serde_json::to_value(&self.local_domain_id).unwrap());
        self.telemetry.report_custom("finality_lock_acknowledged", data).await;
        
        Ok(updated_lock)
    }
    
    /// Commit a finality lock
    pub async fn commit_lock(&self, proposal_id: &str) -> Result<FinalityLock, FinalityError> {
        // Get the current lock
        let lock_key = format!("federation:locks:{}", proposal_id);
        
        let existing_lock = match self.redis.get::<String>(&lock_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FinalityLock>(&json) {
                    Ok(lock) => lock,
                    Err(e) => {
                        return Err(FinalityError::InternalError(format!("Failed to deserialize lock: {}", e)));
                    }
                }
            },
            Ok(None) => {
                return Err(FinalityError::LockNotAvailable(format!(
                    "No lock exists for proposal {}", proposal_id
                )));
            },
            Err(e) => {
                return Err(FinalityError::InternalError(format!("Failed to get lock from Redis: {}", e)));
            }
        };
        
        // Make sure the lock is valid
        if !existing_lock.is_valid() {
            return Err(FinalityError::LockTimeout(format!(
                "Lock for proposal {} has expired", proposal_id
            )));
        }
        
        // Make sure we have acknowledged
        if !existing_lock.is_acknowledged_by(&self.local_domain_id) {
            return Err(FinalityError::InvalidState(format!(
                "Domain {} has not acknowledged the lock for proposal {}",
                self.local_domain_id, proposal_id
            )));
        }
        
        // Make sure we haven't already committed
        if existing_lock.is_committed_by(&self.local_domain_id) {
            return Ok(existing_lock);
        }
        
        // Commit the lock
        let mut updated_lock = existing_lock.clone();
        updated_lock.committed_by.push(self.local_domain_id.clone());
        updated_lock.updated_at = Utc::now();
        
        // If all domains have committed, update the status
        let is_fully_committed = updated_lock.acknowledged_by.iter()
            .all(|domain_id| updated_lock.committed_by.contains(domain_id));
        
        if is_fully_committed {
            updated_lock.status = FinalityLockStatus::Committed;
        }
        
        // Store the updated lock
        let lock_json = serde_json::to_string(&updated_lock)
            .map_err(|e| FinalityError::InternalError(format!("Failed to serialize lock: {}", e)))?;
        
        self.redis.set(&lock_key, &lock_json).await
            .map_err(|e| FinalityError::InternalError(format!("Failed to update lock: {}", e)))?;
        
        // Update the cache
        let mut active_locks = self.active_locks.write().await;
        active_locks.insert(proposal_id.to_string(), updated_lock.clone());
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("domain_id".to_string(), serde_json::to_value(&self.local_domain_id).unwrap());
        data.insert("fully_committed".to_string(), serde_json::to_value(is_fully_committed).unwrap());
        self.telemetry.report_custom("finality_lock_committed", data).await;
        
        Ok(updated_lock)
    }
    
    /// Abort a finality lock
    pub async fn abort_lock(&self, proposal_id: &str, reason: Option<String>) -> Result<FinalityLock, FinalityError> {
        // Get the current lock
        let lock_key = format!("federation:locks:{}", proposal_id);
        
        let existing_lock = match self.redis.get::<String>(&lock_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FinalityLock>(&json) {
                    Ok(lock) => lock,
                    Err(e) => {
                        return Err(FinalityError::InternalError(format!("Failed to deserialize lock: {}", e)));
                    }
                }
            },
            Ok(None) => {
                return Err(FinalityError::LockNotAvailable(format!(
                    "No lock exists for proposal {}", proposal_id
                )));
            },
            Err(e) => {
                return Err(FinalityError::InternalError(format!("Failed to get lock from Redis: {}", e)));
            }
        };
        
        // Once committed, a lock cannot be aborted
        if existing_lock.status == FinalityLockStatus::Committed {
            return Err(FinalityError::InvalidState(format!(
                "Cannot abort a committed lock for proposal {}", proposal_id
            )));
        }
        
        // Abort the lock
        let mut updated_lock = existing_lock.clone();
        updated_lock.status = FinalityLockStatus::Aborted;
        updated_lock.aborted_by.push(self.local_domain_id.clone());
        updated_lock.updated_at = Utc::now();
        updated_lock.abort_reason = reason;
        
        // Store the updated lock
        let lock_json = serde_json::to_string(&updated_lock)
            .map_err(|e| FinalityError::InternalError(format!("Failed to serialize lock: {}", e)))?;
        
        self.redis.set(&lock_key, &lock_json).await
            .map_err(|e| FinalityError::InternalError(format!("Failed to update lock: {}", e)))?;
        
        // Update the cache
        let mut active_locks = self.active_locks.write().await;
        active_locks.insert(proposal_id.to_string(), updated_lock.clone());
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("domain_id".to_string(), serde_json::to_value(&self.local_domain_id).unwrap());
        if let Some(ref reason_str) = updated_lock.abort_reason {
            data.insert("reason".to_string(), serde_json::to_value(reason_str).unwrap());
        }
        self.telemetry.report_custom("finality_lock_aborted", data).await;
        
        Ok(updated_lock)
    }
    
    /// Get the current lock status for a proposal
    pub async fn get_lock_status(&self, proposal_id: &str) -> Result<Option<FinalityLock>, FinalityError> {
        // Check the cache first
        {
            let active_locks = self.active_locks.read().await;
            if let Some(lock) = active_locks.get(proposal_id) {
                return Ok(Some(lock.clone()));
            }
        }
        
        // Try to get from Redis
        let lock_key = format!("federation:locks:{}", proposal_id);
        
        match self.redis.get::<String>(&lock_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FinalityLock>(&json) {
                    Ok(lock) => {
                        // Update the cache
                        let mut active_locks = self.active_locks.write().await;
                        active_locks.insert(proposal_id.to_string(), lock.clone());
                        
                        Ok(Some(lock))
                    },
                    Err(e) => {
                        Err(FinalityError::InternalError(format!("Failed to deserialize lock: {}", e)))
                    }
                }
            },
            Ok(None) => Ok(None),
            Err(e) => {
                Err(FinalityError::InternalError(format!("Failed to get lock from Redis: {}", e)))
            }
        }
    }
    
    /// Check if all domains have committed to a proposal
    pub async fn is_fully_committed(&self, proposal_id: &str) -> Result<bool, FinalityError> {
        match self.get_lock_status(proposal_id).await? {
            Some(lock) => Ok(lock.status == FinalityLockStatus::Committed),
            None => Ok(false),
        }
    }
    
    /// Execute a proposal with finality guarantee across all domains
    pub async fn execute_with_finality(&self, proposal_id: &str) -> Result<(), FinalityError> {
        // First, try to acquire the lock
        let lock = self.acquire_lock(proposal_id).await?;
        
        // Check if all domains have acknowledged
        let all_acknowledged = lock.acknowledged_by.len() >= lock.acknowledged_by.len();
        
        if !all_acknowledged {
            return Err(FinalityError::InvalidState(format!(
                "Not all domains have acknowledged the lock for proposal {}",
                proposal_id
            )));
        }
        
        // Execute the proposal
        let result = self.execution_engine.execute_proposal(proposal_id).await
            .map_err(|e| FinalityError::ExecutionError(e))?;
        
        // If execution was successful, commit the lock
        if result.status == ExecutionStatus::Completed {
            self.commit_lock(proposal_id).await?;
            Ok(())
        } else {
            // Otherwise, abort the lock
            let reason = result.error.clone().unwrap_or_else(|| "Execution failed".to_string());
            self.abort_lock(proposal_id, Some(reason)).await?;
            Err(FinalityError::InvalidState(format!(
                "Execution failed for proposal {}: {:?}", proposal_id, result.status
            )))
        }
    }
    
    /// Start the background task to clean up expired locks
    pub fn start_cleanup_task(&self) -> Arc<Self> {
        let this = Arc::new(self.clone());
        let cleanup_this = this.clone();
        
        tokio::spawn(async move {
            let cleanup_interval_ms = 30000; // 30 seconds
            
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(cleanup_interval_ms)).await;
                
                // Get all active locks
                let lock_keys = match cleanup_this.redis.keys("federation:locks:*").await {
                    Ok(keys) => keys,
                    Err(e) => {
                        error!("Failed to get lock keys: {}", e);
                        continue;
                    }
                };
                
                let now = Utc::now();
                let mut expired_count = 0;
                
                for key in lock_keys {
                    match cleanup_this.redis.get::<String>(&key).await {
                        Ok(Some(json)) => {
                            match serde_json::from_str::<FinalityLock>(&json) {
                                Ok(lock) => {
                                    // Check if the lock has expired
                                    if let Some(timeout) = lock.timeout_at {
                                        if now > timeout && lock.status == FinalityLockStatus::Locked {
                                            // Lock has expired, mark it as aborted
                                            let mut updated_lock = lock.clone();
                                            updated_lock.status = FinalityLockStatus::Aborted;
                                            updated_lock.updated_at = now;
                                            updated_lock.abort_reason = Some("Lock timeout".to_string());
                                            
                                            // Store the updated lock
                                            if let Ok(updated_json) = serde_json::to_string(&updated_lock) {
                                                if let Err(e) = cleanup_this.redis.set(&key, &updated_json).await {
                                                    error!("Failed to update expired lock: {}", e);
                                                } else {
                                                    expired_count += 1;
                                                    
                                                    // Update the cache
                                                    let mut active_locks = cleanup_this.active_locks.write().await;
                                                    active_locks.insert(updated_lock.proposal_id.clone(), updated_lock);
                                                }
                                            }
                                        }
                                    }
                                },
                                Err(e) => {
                                    error!("Failed to deserialize lock {}: {}", key, e);
                                }
                            }
                        },
                        Ok(None) => {
                            // Lock was removed, ignore
                        },
                        Err(e) => {
                            error!("Failed to get lock {}: {}", key, e);
                        }
                    }
                }
                
                if expired_count > 0 {
                    debug!("Cleaned up {} expired locks", expired_count);
                }
            }
        });
        
        this
    }
} 