// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use async_trait::async_trait;
use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};
use chrono::Utc;

use crate::redis::RedisClient;
use crate::telemetry::TelemetryReporter;
use crate::governance::federation::types::{
    FederatedProposal, 
    FederatedVote,
    FederatedProposalStatus,
    ProposalSyncState,
    DomainInfo
};

/// Error that can occur during proposal relay
#[derive(Debug, thiserror::Error)]
pub enum RelayError {
    #[error("Failed to connect to peer: {0}")]
    ConnectionError(String),
    
    #[error("Proposal not found: {0}")]
    ProposalNotFound(String),
    
    #[error("Domain not found: {0}")]
    DomainNotFound(String),
    
    #[error("Authentication error: {0}")]
    AuthError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Message types that can be relayed between domains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RelayMessageType {
    /// New proposal or proposal update
    ProposalUpdate,
    /// Vote on a proposal
    Vote,
    /// Execution intent/confirmation
    ExecutionIntent,
    /// Final proposal state
    FinalState,
    /// Heartbeat/connectivity check
    Heartbeat,
}

/// A message relayed between domains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayMessage {
    /// Message ID
    pub id: String,
    /// Message type
    pub message_type: RelayMessageType,
    /// Source domain
    pub source_domain: String,
    /// Target domain
    pub target_domain: String,
    /// Payload
    pub payload: serde_json::Value,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Message authentication signature
    pub signature: Option<String>,
}

impl RelayMessage {
    /// Create a new relay message
    pub fn new(
        message_type: RelayMessageType,
        source_domain: String,
        target_domain: String,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            message_type,
            source_domain,
            target_domain,
            payload,
            timestamp: Utc::now(),
            signature: None,
        }
    }
    
    /// Set the authentication signature
    pub fn with_signature(mut self, signature: String) -> Self {
        self.signature = Some(signature);
        self
    }
}

/// Network interface trait for peer communication
#[async_trait]
pub trait PeerNetwork: Send + Sync {
    /// Send a message to a peer domain
    async fn send_message(
        &self,
        domain: &DomainInfo,
        message: RelayMessage,
    ) -> Result<String, RelayError>;
    
    /// Check if a domain is reachable
    async fn check_domain(&self, domain: &DomainInfo) -> bool;
    
    /// Get all known domains
    async fn get_domains(&self) -> Vec<DomainInfo>;
    
    /// Get a specific domain by ID
    async fn get_domain(&self, domain_id: &str) -> Option<DomainInfo>;
}

/// Handles relaying proposals between networks
pub struct ProposalRelay {
    /// Redis client for state storage
    redis: Arc<RedisClient>,
    /// Peer network for communication
    network: Arc<dyn PeerNetwork>,
    /// Telemetry for monitoring
    telemetry: Arc<TelemetryReporter>,
    /// Local domain ID
    local_domain_id: String,
    /// Pending message queue
    pending_messages: Arc<RwLock<Vec<RelayMessage>>>,
    /// Retry buffer for failed messages
    retry_buffer: Arc<RwLock<HashMap<String, (RelayMessage, u32)>>>,
}

impl ProposalRelay {
    /// Create a new proposal relay
    pub fn new(
        redis: Arc<RedisClient>,
        network: Arc<dyn PeerNetwork>,
        telemetry: Arc<TelemetryReporter>,
        local_domain_id: String,
    ) -> Self {
        Self {
            redis,
            network,
            telemetry,
            local_domain_id,
            pending_messages: Arc::new(RwLock::new(Vec::new())),
            retry_buffer: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Relay a proposal to all participating domains
    pub async fn relay_proposal(&self, proposal: &FederatedProposal) -> Result<(), RelayError> {
        // Only relay if the proposal involves multiple domains
        if proposal.participating_domains.len() <= 1 {
            debug!("Proposal {} only has one domain, not relaying", proposal.id);
            return Ok(());
        }
        
        // Convert to JSON
        let proposal_json = match serde_json::to_value(proposal) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(e.to_string())),
        };
        
        // Get all domains
        let domains = self.network.get_domains().await;
        let domain_map: HashMap<String, DomainInfo> = domains
            .into_iter()
            .map(|d| (d.id.clone(), d))
            .collect();
        
        let mut success_count = 0;
        let mut failure_count = 0;
        
        // Send to each participating domain
        for domain_id in &proposal.participating_domains {
            // Skip self
            if domain_id == &self.local_domain_id {
                continue;
            }
            
            // Get domain info
            let domain = match domain_map.get(domain_id) {
                Some(d) => d,
                None => {
                    warn!("Domain {} not found, skipping relay", domain_id);
                    failure_count += 1;
                    continue;
                }
            };
            
            // Create relay message
            let message = RelayMessage::new(
                RelayMessageType::ProposalUpdate,
                self.local_domain_id.clone(),
                domain_id.clone(),
                proposal_json.clone(),
            );
            
            // Send message
            match self.network.send_message(domain, message.clone()).await {
                Ok(_) => {
                    success_count += 1;
                    debug!("Successfully relayed proposal {} to domain {}", proposal.id, domain_id);
                },
                Err(e) => {
                    failure_count += 1;
                    error!("Failed to relay proposal {} to domain {}: {}", proposal.id, domain_id, e);
                    
                    // Add to retry buffer
                    let mut retry_buffer = self.retry_buffer.write().unwrap();
                    retry_buffer.insert(message.id.clone(), (message, 0));
                }
            }
        }
        
        // Log stats
        info!(
            "Relay stats for proposal {}: {} successful, {} failed",
            proposal.id, success_count, failure_count
        );
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(&proposal.id).unwrap());
        data.insert("success_count".to_string(), serde_json::to_value(success_count).unwrap());
        data.insert("failure_count".to_string(), serde_json::to_value(failure_count).unwrap());
        self.telemetry.report_custom("proposal_relay", data).await;
        
        if failure_count > 0 {
            warn!("Failed to relay proposal to {} domains", failure_count);
        }
        
        Ok(())
    }
    
    /// Relay a vote to all participating domains
    pub async fn relay_vote(&self, vote: &FederatedVote, proposal: &FederatedProposal) -> Result<(), RelayError> {
        // Convert to JSON
        let vote_json = match serde_json::to_value(vote) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(e.to_string())),
        };
        
        // Get all domains
        let domains = self.network.get_domains().await;
        let domain_map: HashMap<String, DomainInfo> = domains
            .into_iter()
            .map(|d| (d.id.clone(), d))
            .collect();
        
        let mut success_count = 0;
        let mut failure_count = 0;
        
        // Send to each participating domain
        for domain_id in &proposal.participating_domains {
            // Skip self and the domain that cast the vote
            if domain_id == &self.local_domain_id || domain_id == &vote.domain_id {
                continue;
            }
            
            // Get domain info
            let domain = match domain_map.get(domain_id) {
                Some(d) => d,
                None => {
                    warn!("Domain {} not found, skipping vote relay", domain_id);
                    failure_count += 1;
                    continue;
                }
            };
            
            // Create relay message
            let message = RelayMessage::new(
                RelayMessageType::Vote,
                self.local_domain_id.clone(),
                domain_id.clone(),
                vote_json.clone(),
            );
            
            // Send message
            match self.network.send_message(domain, message.clone()).await {
                Ok(_) => {
                    success_count += 1;
                    debug!("Successfully relayed vote on proposal {} to domain {}", proposal.id, domain_id);
                },
                Err(e) => {
                    failure_count += 1;
                    error!("Failed to relay vote on proposal {} to domain {}: {}", proposal.id, domain_id, e);
                    
                    // Add to retry buffer
                    let mut retry_buffer = self.retry_buffer.write().unwrap();
                    retry_buffer.insert(message.id.clone(), (message, 0));
                }
            }
        }
        
        // Log stats
        debug!(
            "Vote relay stats for proposal {}: {} successful, {} failed",
            proposal.id, success_count, failure_count
        );
        
        if failure_count > 0 {
            warn!("Failed to relay vote to {} domains", failure_count);
        }
        
        Ok(())
    }
    
    /// Signal execution intent to all participating domains
    pub async fn signal_execution_intent(&self, proposal: &FederatedProposal) -> Result<(), RelayError> {
        // Create execution intent payload
        let intent_payload = serde_json::json!({
            "proposal_id": proposal.id,
            "status": FederatedProposalStatus::Executing.to_string(),
            "timestamp": Utc::now(),
        });
        
        // Get all domains
        let domains = self.network.get_domains().await;
        let domain_map: HashMap<String, DomainInfo> = domains
            .into_iter()
            .map(|d| (d.id.clone(), d))
            .collect();
        
        let mut success_count = 0;
        let mut failure_count = 0;
        
        // Send to each participating domain
        for domain_id in &proposal.participating_domains {
            // Skip self
            if domain_id == &self.local_domain_id {
                continue;
            }
            
            // Get domain info
            let domain = match domain_map.get(domain_id) {
                Some(d) => d,
                None => {
                    warn!("Domain {} not found, skipping execution intent", domain_id);
                    failure_count += 1;
                    continue;
                }
            };
            
            // Create relay message
            let message = RelayMessage::new(
                RelayMessageType::ExecutionIntent,
                self.local_domain_id.clone(),
                domain_id.clone(),
                intent_payload.clone(),
            );
            
            // Send message
            match self.network.send_message(domain, message.clone()).await {
                Ok(_) => {
                    success_count += 1;
                    info!("Successfully signaled execution intent for proposal {} to domain {}", proposal.id, domain_id);
                },
                Err(e) => {
                    failure_count += 1;
                    error!("Failed to signal execution intent for proposal {} to domain {}: {}", proposal.id, domain_id, e);
                    
                    // Add to retry buffer with higher priority
                    let mut retry_buffer = self.retry_buffer.write().unwrap();
                    retry_buffer.insert(message.id.clone(), (message, 0));
                }
            }
        }
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(&proposal.id).unwrap());
        data.insert("success_count".to_string(), serde_json::to_value(success_count).unwrap());
        data.insert("failure_count".to_string(), serde_json::to_value(failure_count).unwrap());
        self.telemetry.report_custom("execution_intent_relay", data).await;
        
        if failure_count > 0 {
            warn!("Failed to signal execution intent to {} domains", failure_count);
            return Err(RelayError::InternalError(format!("Failed to signal execution intent to {} domains", failure_count)));
        }
        
        Ok(())
    }
    
    /// Process an incoming relay message
    pub async fn process_message(&self, message: RelayMessage) -> Result<(), RelayError> {
        // Verify the message is intended for us
        if message.target_domain != self.local_domain_id {
            return Err(RelayError::InternalError(format!(
                "Message intended for domain {}, not our domain {}",
                message.target_domain, self.local_domain_id
            )));
        }
        
        match message.message_type {
            RelayMessageType::ProposalUpdate => {
                debug!("Processing proposal update from domain {}", message.source_domain);
                self.process_proposal_update(message).await
            },
            RelayMessageType::Vote => {
                debug!("Processing vote from domain {}", message.source_domain);
                self.process_vote(message).await
            },
            RelayMessageType::ExecutionIntent => {
                info!("Processing execution intent from domain {}", message.source_domain);
                self.process_execution_intent(message).await
            },
            RelayMessageType::FinalState => {
                info!("Processing final state from domain {}", message.source_domain);
                self.process_final_state(message).await
            },
            RelayMessageType::Heartbeat => {
                debug!("Received heartbeat from domain {}", message.source_domain);
                Ok(())
            },
        }
    }
    
    // Process a proposal update message
    async fn process_proposal_update(&self, message: RelayMessage) -> Result<(), RelayError> {
        // Deserialize the proposal
        let proposal: FederatedProposal = match serde_json::from_value(message.payload) {
            Ok(p) => p,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to deserialize proposal: {}", e))),
        };
        
        // Verify the proposal involves our domain
        if !proposal.participating_domains.contains(&self.local_domain_id) {
            return Err(RelayError::InternalError(format!(
                "Proposal {} does not involve our domain {}",
                proposal.id, self.local_domain_id
            )));
        }
        
        // Store in Redis
        let key = format!("federation:proposals:{}", proposal.id);
        let proposal_json = match serde_json::to_string(&proposal) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to serialize proposal: {}", e))),
        };
        
        if let Err(e) = self.redis.set(&key, &proposal_json).await {
            return Err(RelayError::InternalError(format!("Failed to store proposal in Redis: {}", e)));
        }
        
        // Add to index
        let index_key = "federation:proposals:index";
        if let Err(e) = self.redis.sadd(index_key, &proposal.id).await {
            warn!("Failed to add proposal to index: {}", e);
            // Non-critical, continue
        }
        
        // Create or update the sync state
        let mut sync_state = proposal.sync_state.clone();
        let local_state = sync_state.iter_mut().find(|s| s.domain_id == self.local_domain_id);
        if let Some(state) = local_state {
            state.acknowledged = true;
            state.last_sync = Utc::now();
        }
        
        // Update the proposal with new sync state
        let mut updated_proposal = proposal.clone();
        updated_proposal.sync_state = sync_state;
        
        // Store updated proposal
        let updated_json = match serde_json::to_string(&updated_proposal) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to serialize updated proposal: {}", e))),
        };
        
        if let Err(e) = self.redis.set(&key, &updated_json).await {
            return Err(RelayError::InternalError(format!("Failed to store updated proposal in Redis: {}", e)));
        }
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(&proposal.id).unwrap());
        data.insert("source_domain".to_string(), serde_json::to_value(&message.source_domain).unwrap());
        data.insert("status".to_string(), serde_json::to_value(&proposal.status).unwrap());
        self.telemetry.report_custom("proposal_received", data).await;
        
        info!("Processed proposal update: {} from domain {}", proposal.id, message.source_domain);
        Ok(())
    }
    
    // Process a vote message
    async fn process_vote(&self, message: RelayMessage) -> Result<(), RelayError> {
        // Deserialize the vote
        let vote: FederatedVote = match serde_json::from_value(message.payload) {
            Ok(v) => v,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to deserialize vote: {}", e))),
        };
        
        // Get the proposal
        let proposal_key = format!("federation:proposals:{}", vote.proposal_id);
        let proposal_json = match self.redis.get::<String>(&proposal_key).await {
            Ok(Some(json)) => json,
            Ok(None) => return Err(RelayError::ProposalNotFound(vote.proposal_id)),
            Err(e) => return Err(RelayError::InternalError(format!("Failed to get proposal from Redis: {}", e))),
        };
        
        let proposal: FederatedProposal = match serde_json::from_str(&proposal_json) {
            Ok(p) => p,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to deserialize proposal: {}", e))),
        };
        
        // Store vote in Redis
        let vote_key = format!("federation:votes:{}:{}", vote.proposal_id, vote.id);
        let vote_json = match serde_json::to_string(&vote) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to serialize vote: {}", e))),
        };
        
        if let Err(e) = self.redis.set(&vote_key, &vote_json).await {
            return Err(RelayError::InternalError(format!("Failed to store vote in Redis: {}", e)));
        }
        
        // Add to index
        let index_key = format!("federation:proposals:{}:votes", vote.proposal_id);
        if let Err(e) = self.redis.sadd(&index_key, &vote.id).await {
            warn!("Failed to add vote to index: {}", e);
            // Non-critical, continue
        }
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(&vote.proposal_id).unwrap());
        data.insert("vote_id".to_string(), serde_json::to_value(&vote.id).unwrap());
        data.insert("agent_id".to_string(), serde_json::to_value(&vote.agent_id).unwrap());
        data.insert("domain_id".to_string(), serde_json::to_value(&vote.domain_id).unwrap());
        data.insert("vote".to_string(), serde_json::to_value(&vote.vote).unwrap());
        self.telemetry.report_custom("vote_received", data).await;
        
        debug!("Processed vote {} on proposal {} from domain {}", vote.id, vote.proposal_id, message.source_domain);
        Ok(())
    }
    
    // Process an execution intent message
    async fn process_execution_intent(&self, message: RelayMessage) -> Result<(), RelayError> {
        // Parse the payload
        let payload = message.payload.as_object().ok_or_else(|| 
            RelayError::SerializationError("Invalid payload format".to_string())
        )?;
        
        let proposal_id = payload.get("proposal_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RelayError::SerializationError("Missing proposal_id".to_string()))?
            .to_string();
        
        let status_str = payload.get("status")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RelayError::SerializationError("Missing status".to_string()))?;
        
        let status = match status_str {
            "executing" => FederatedProposalStatus::Executing,
            _ => return Err(RelayError::SerializationError(format!("Invalid status: {}", status_str))),
        };
        
        // Get the proposal
        let proposal_key = format!("federation:proposals:{}", proposal_id);
        let proposal_json = match self.redis.get::<String>(&proposal_key).await {
            Ok(Some(json)) => json,
            Ok(None) => return Err(RelayError::ProposalNotFound(proposal_id)),
            Err(e) => return Err(RelayError::InternalError(format!("Failed to get proposal from Redis: {}", e))),
        };
        
        let mut proposal: FederatedProposal = match serde_json::from_str(&proposal_json) {
            Ok(p) => p,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to deserialize proposal: {}", e))),
        };
        
        // Update proposal status
        proposal.update_status(status);
        
        // Update sync state
        for state in &mut proposal.sync_state {
            if state.domain_id == message.source_domain {
                state.execution_initiated = true;
                state.last_sync = Utc::now();
            }
        }
        
        // Store updated proposal
        let updated_json = match serde_json::to_string(&proposal) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to serialize updated proposal: {}", e))),
        };
        
        if let Err(e) = self.redis.set(&proposal_key, &updated_json).await {
            return Err(RelayError::InternalError(format!("Failed to store updated proposal in Redis: {}", e)));
        }
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(&proposal_id).unwrap());
        data.insert("source_domain".to_string(), serde_json::to_value(&message.source_domain).unwrap());
        data.insert("status".to_string(), serde_json::to_value(&status).unwrap());
        self.telemetry.report_custom("execution_intent_received", data).await;
        
        info!("Processed execution intent for proposal {} from domain {}", proposal_id, message.source_domain);
        Ok(())
    }
    
    // Process a final state message
    async fn process_final_state(&self, message: RelayMessage) -> Result<(), RelayError> {
        // Deserialize the proposal
        let proposal: FederatedProposal = match serde_json::from_value(message.payload) {
            Ok(p) => p,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to deserialize proposal: {}", e))),
        };
        
        // Store in Redis
        let key = format!("federation:proposals:{}", proposal.id);
        let proposal_json = match serde_json::to_string(&proposal) {
            Ok(json) => json,
            Err(e) => return Err(RelayError::SerializationError(format!("Failed to serialize proposal: {}", e))),
        };
        
        if let Err(e) = self.redis.set(&key, &proposal_json).await {
            return Err(RelayError::InternalError(format!("Failed to store proposal in Redis: {}", e)));
        }
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(&proposal.id).unwrap());
        data.insert("source_domain".to_string(), serde_json::to_value(&message.source_domain).unwrap());
        data.insert("status".to_string(), serde_json::to_value(&proposal.status).unwrap());
        self.telemetry.report_custom("proposal_finalized", data).await;
        
        info!("Processed final state for proposal {} from domain {}", proposal.id, message.source_domain);
        Ok(())
    }
    
    /// Run the retry process for failed messages
    pub async fn process_retries(&self) {
        let retry_interval_ms = 5000; // 5 seconds between retry attempts
        let max_retries = 5; // Maximum retry attempts
        
        loop {
            // Sleep first to avoid immediate retry
            tokio::time::sleep(tokio::time::Duration::from_millis(retry_interval_ms)).await;
            
            // Get domains
            let domains = self.network.get_domains().await;
            let domain_map: HashMap<String, DomainInfo> = domains
                .into_iter()
                .map(|d| (d.id.clone(), d))
                .collect();
            
            // Process retries
            let mut retry_buffer = self.retry_buffer.write().unwrap();
            let messages: Vec<_> = retry_buffer.keys().cloned().collect();
            
            for message_id in messages {
                if let Some((message, retry_count)) = retry_buffer.get(&message_id) {
                    if *retry_count >= max_retries {
                        // Too many retries, give up
                        error!("Giving up on message {} after {} retries", message_id, retry_count);
                        retry_buffer.remove(&message_id);
                        continue;
                    }
                    
                    // Get domain info
                    if let Some(domain) = domain_map.get(&message.target_domain) {
                        // Try to send the message again
                        let message_clone = message.clone();
                        match self.network.send_message(domain, message_clone).await {
                            Ok(_) => {
                                debug!("Successfully retried message {} to domain {}", message_id, message.target_domain);
                                retry_buffer.remove(&message_id);
                            },
                            Err(e) => {
                                // Increment retry count
                                warn!("Retry {} failed for message {} to domain {}: {}", 
                                     retry_count + 1, message_id, message.target_domain, e);
                                retry_buffer.insert(message_id.clone(), (message.clone(), retry_count + 1));
                            }
                        }
                    } else {
                        // Domain not found, give up
                        error!("Domain {} not found, giving up on message {}", message.target_domain, message_id);
                        retry_buffer.remove(&message_id);
                    }
                }
            }
        }
    }
    
    /// Start the relay service
    pub fn start(&self) -> Arc<Self> {
        let this = Arc::new(self.clone());
        let retry_this = this.clone();
        
        // Spawn retry task
        tokio::spawn(async move {
            retry_this.process_retries().await;
        });
        
        this
    }
} 