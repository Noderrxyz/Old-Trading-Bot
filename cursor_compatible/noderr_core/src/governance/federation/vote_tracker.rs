// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};
use chrono::Utc;
use tokio::sync::RwLock;

use crate::redis::RedisClient;
use crate::telemetry::TelemetryReporter;
use crate::governance::federation::types::{
    FederatedProposal, 
    FederatedVote,
    FederatedProposalStatus,
    VoteWeight,
    VoteType
};

/// Results of a vote aggregation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteAggregationResult {
    /// Proposal ID
    pub proposal_id: String,
    /// Whether quorum was met
    pub quorum_met: bool,
    /// Result of the vote
    pub result: VoteResult,
    /// Total votes by type
    pub vote_counts: HashMap<String, usize>,
    /// Total weight by type
    pub vote_weights: HashMap<String, f64>,
    /// Total weight of all votes
    pub total_weight: f64,
    /// Total number of votes
    pub total_votes: usize,
    /// Per-domain vote statistics
    pub domain_stats: HashMap<String, DomainVoteStats>,
    /// Whether all domains have completed voting
    pub all_domains_complete: bool,
    /// Timestamp of the aggregation
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Vote results
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VoteResult {
    /// Proposal passed
    Pass,
    /// Proposal failed
    Fail,
    /// Voting still in progress
    InProgress,
    /// Not enough votes to determine outcome
    Inconclusive,
}

impl std::fmt::Display for VoteResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VoteResult::Pass => write!(f, "pass"),
            VoteResult::Fail => write!(f, "fail"),
            VoteResult::InProgress => write!(f, "in_progress"),
            VoteResult::Inconclusive => write!(f, "inconclusive"),
        }
    }
}

/// Voting statistics for a domain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainVoteStats {
    /// Domain ID
    pub domain_id: String,
    /// Total votes from this domain
    pub total_votes: usize,
    /// Total weight from this domain
    pub total_weight: f64,
    /// Yes votes from this domain
    pub yes_votes: usize,
    /// Yes weight from this domain
    pub yes_weight: f64,
    /// No votes from this domain
    pub no_votes: usize,
    /// No weight from this domain
    pub no_weight: f64,
    /// Abstain votes from this domain
    pub abstain_votes: usize,
    /// Abstain weight from this domain
    pub abstain_weight: f64,
    /// Whether this domain has met its quorum
    pub quorum_met: bool,
    /// Required weight to meet quorum
    pub quorum_weight: f64,
}

/// Vote tracking error
#[derive(Debug, thiserror::Error)]
pub enum VoteTrackingError {
    #[error("Proposal not found: {0}")]
    ProposalNotFound(String),
    
    #[error("Domain not found: {0}")]
    DomainNotFound(String),
    
    #[error("Agent not found: {0}")]
    AgentNotFound(String),
    
    #[error("Vote not allowed: {0}")]
    VotingNotAllowed(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
}

/// Handles tracking and aggregating votes across domains
pub struct FederatedVoteTracker {
    /// Redis client for storage
    redis: Arc<RedisClient>,
    /// Telemetry reporter
    telemetry: Arc<TelemetryReporter>,
    /// Local domain ID
    local_domain_id: String,
    /// Default quorum percentage (0.0-1.0)
    default_quorum_threshold: f64,
    /// Quorum requirements cache
    quorum_requirements: Arc<RwLock<HashMap<String, HashMap<String, f64>>>>,
}

impl FederatedVoteTracker {
    /// Create a new federated vote tracker
    pub fn new(
        redis: Arc<RedisClient>,
        telemetry: Arc<TelemetryReporter>,
        local_domain_id: String,
    ) -> Self {
        Self {
            redis,
            telemetry,
            local_domain_id,
            default_quorum_threshold: 0.67, // 67% by default
            quorum_requirements: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Create a new vote
    pub async fn create_vote(
        &self,
        proposal_id: &str,
        agent_id: &str,
        vote_type: VoteType,
        reason: Option<String>,
    ) -> Result<FederatedVote, VoteTrackingError> {
        // Get the proposal
        let proposal = self.get_proposal(proposal_id).await?;
        
        // Check if voting is allowed
        if proposal.status != FederatedProposalStatus::Open {
            return Err(VoteTrackingError::VotingNotAllowed(
                format!("Proposal is not open for voting, current status: {:?}", proposal.status)
            ));
        }
        
        // Calculate vote weight
        let weight = self.calculate_vote_weight(agent_id).await?;
        
        // Create the vote
        let vote = FederatedVote::new(
            proposal_id.to_string(),
            self.local_domain_id.clone(),
            agent_id.to_string(),
            vote_type,
            weight,
            reason,
        );
        
        // Store in Redis
        let vote_key = format!("federation:votes:{}:{}", proposal_id, vote.id);
        let vote_json = serde_json::to_string(&vote)
            .map_err(|e| VoteTrackingError::SerializationError(e.to_string()))?;
        
        self.redis.set(&vote_key, &vote_json).await
            .map_err(|e| VoteTrackingError::InternalError(format!("Failed to store vote: {}", e)))?;
        
        // Add to index
        let index_key = format!("federation:proposals:{}:votes", proposal_id);
        self.redis.sadd(&index_key, &vote.id).await
            .map_err(|e| VoteTrackingError::InternalError(format!("Failed to add vote to index: {}", e)))?;
        
        // Add to agent index
        let agent_index_key = format!("federation:agents:{}:votes", agent_id);
        self.redis.sadd(&agent_index_key, &vote.id).await
            .map_err(|e| VoteTrackingError::InternalError(format!("Failed to add vote to agent index: {}", e)))?;
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("vote_id".to_string(), serde_json::to_value(&vote.id).unwrap());
        data.insert("agent_id".to_string(), serde_json::to_value(agent_id).unwrap());
        data.insert("vote_type".to_string(), serde_json::to_value(&vote_type).unwrap());
        data.insert("vote_weight".to_string(), serde_json::to_value(&weight.effective_weight).unwrap());
        self.telemetry.report_custom("vote_created", data).await;
        
        Ok(vote)
    }
    
    /// Get all votes for a proposal
    pub async fn get_proposal_votes(&self, proposal_id: &str) -> Result<Vec<FederatedVote>, VoteTrackingError> {
        // Get the vote IDs
        let index_key = format!("federation:proposals:{}:votes", proposal_id);
        let vote_ids = self.redis.smembers::<String>(&index_key).await
            .map_err(|e| VoteTrackingError::InternalError(format!("Failed to get vote IDs: {}", e)))?;
        
        // Get each vote
        let mut votes = Vec::with_capacity(vote_ids.len());
        for vote_id in vote_ids {
            let vote_key = format!("federation:votes:{}:{}", proposal_id, vote_id);
            if let Ok(Some(vote_json)) = self.redis.get::<String>(&vote_key).await {
                match serde_json::from_str::<FederatedVote>(&vote_json) {
                    Ok(vote) => votes.push(vote),
                    Err(e) => {
                        error!("Failed to deserialize vote {}: {}", vote_id, e);
                        continue;
                    }
                }
            }
        }
        
        Ok(votes)
    }
    
    /// Get all votes for a proposal from a specific domain
    pub async fn get_domain_votes(
        &self,
        proposal_id: &str,
        domain_id: &str,
    ) -> Result<Vec<FederatedVote>, VoteTrackingError> {
        // Get all votes
        let votes = self.get_proposal_votes(proposal_id).await?;
        
        // Filter by domain
        let domain_votes = votes.into_iter()
            .filter(|v| v.domain_id == domain_id)
            .collect();
        
        Ok(domain_votes)
    }
    
    /// Get the vote from a specific agent on a proposal
    pub async fn get_agent_vote(
        &self,
        proposal_id: &str,
        agent_id: &str,
    ) -> Result<Option<FederatedVote>, VoteTrackingError> {
        // Get all votes
        let votes = self.get_proposal_votes(proposal_id).await?;
        
        // Find the agent's vote
        let agent_vote = votes.into_iter()
            .find(|v| v.agent_id == agent_id);
        
        Ok(agent_vote)
    }
    
    /// Aggregate votes for a proposal
    pub async fn aggregate_votes(&self, proposal_id: &str) -> Result<VoteAggregationResult, VoteTrackingError> {
        // Get the proposal
        let proposal = self.get_proposal(proposal_id).await?;
        
        // Get all votes
        let votes = self.get_proposal_votes(proposal_id).await?;
        
        // Track total weights and counts
        let mut total_weight = 0.0;
        let mut yes_weight = 0.0;
        let mut no_weight = 0.0;
        let mut abstain_weight = 0.0;
        
        let mut total_votes = 0;
        let mut yes_votes = 0;
        let mut no_votes = 0;
        let mut abstain_votes = 0;
        
        // Track per-domain stats
        let mut domain_stats: HashMap<String, DomainVoteStats> = HashMap::new();
        
        // Initialize domain stats
        for domain_id in &proposal.participating_domains {
            let quorum_threshold = self.get_domain_quorum_threshold(&proposal, domain_id).await;
            
            domain_stats.insert(domain_id.clone(), DomainVoteStats {
                domain_id: domain_id.clone(),
                total_votes: 0,
                total_weight: 0.0,
                yes_votes: 0,
                yes_weight: 0.0,
                no_votes: 0,
                no_weight: 0.0,
                abstain_votes: 0,
                abstain_weight: 0.0,
                quorum_met: false,
                quorum_weight: quorum_threshold,
            });
        }
        
        // Process all votes
        for vote in &votes {
            let weight = vote.weight.effective_weight;
            total_weight += weight;
            total_votes += 1;
            
            // Update domain stats
            if let Some(stats) = domain_stats.get_mut(&vote.domain_id) {
                stats.total_votes += 1;
                stats.total_weight += weight;
                
                match vote.vote {
                    VoteType::Yes => {
                        yes_weight += weight;
                        yes_votes += 1;
                        stats.yes_votes += 1;
                        stats.yes_weight += weight;
                    },
                    VoteType::No => {
                        no_weight += weight;
                        no_votes += 1;
                        stats.no_votes += 1;
                        stats.no_weight += weight;
                    },
                    VoteType::Abstain => {
                        abstain_weight += weight;
                        abstain_votes += 1;
                        stats.abstain_votes += 1;
                        stats.abstain_weight += weight;
                    },
                }
            }
        }
        
        // Check if each domain has met quorum
        let mut all_domains_complete = true;
        for (domain_id, stats) in domain_stats.iter_mut() {
            let quorum_threshold = self.get_domain_quorum_threshold(&proposal, domain_id).await;
            let domain_weight = stats.total_weight;
            
            // Check if this domain needs to vote
            if domain_weight == 0.0 {
                all_domains_complete = false;
            }
            
            // Check if quorum is met for this domain
            let required_weight = domain_weight * quorum_threshold;
            stats.quorum_met = stats.yes_weight + stats.no_weight >= required_weight;
            
            // Update quorum weight
            stats.quorum_weight = required_weight;
            
            // If any domain hasn't met quorum, the overall status is incomplete
            if !stats.quorum_met {
                all_domains_complete = false;
            }
        }
        
        // Determine the overall vote result
        let result = if !all_domains_complete {
            VoteResult::InProgress
        } else if total_weight == 0.0 {
            VoteResult::Inconclusive
        } else {
            // Check the total yes weight against total weight (excluding abstains for quorum)
            let voting_weight = yes_weight + no_weight;
            let overall_quorum_threshold = self.default_quorum_threshold;
            
            if voting_weight < total_weight * overall_quorum_threshold {
                VoteResult::Inconclusive
            } else if yes_weight > no_weight {
                VoteResult::Pass
            } else {
                VoteResult::Fail
            }
        };
        
        // Build the aggregation result
        let mut vote_counts = HashMap::new();
        vote_counts.insert("yes".to_string(), yes_votes);
        vote_counts.insert("no".to_string(), no_votes);
        vote_counts.insert("abstain".to_string(), abstain_votes);
        
        let mut vote_weights = HashMap::new();
        vote_weights.insert("yes".to_string(), yes_weight);
        vote_weights.insert("no".to_string(), no_weight);
        vote_weights.insert("abstain".to_string(), abstain_weight);
        
        let aggregation = VoteAggregationResult {
            proposal_id: proposal_id.to_string(),
            quorum_met: all_domains_complete,
            result,
            vote_counts,
            vote_weights,
            total_weight,
            total_votes,
            domain_stats,
            all_domains_complete,
            timestamp: Utc::now(),
        };
        
        // Store the aggregation result
        let result_key = format!("federation:proposals:{}:vote_result", proposal_id);
        let result_json = serde_json::to_string(&aggregation)
            .map_err(|e| VoteTrackingError::SerializationError(e.to_string()))?;
        
        self.redis.set(&result_key, &result_json).await
            .map_err(|e| VoteTrackingError::InternalError(format!("Failed to store vote result: {}", e)))?;
        
        Ok(aggregation)
    }
    
    /// Get the cached vote aggregation result
    pub async fn get_vote_result(&self, proposal_id: &str) -> Result<Option<VoteAggregationResult>, VoteTrackingError> {
        let result_key = format!("federation:proposals:{}:vote_result", proposal_id);
        
        match self.redis.get::<String>(&result_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<VoteAggregationResult>(&json) {
                    Ok(result) => Ok(Some(result)),
                    Err(e) => Err(VoteTrackingError::SerializationError(format!("Failed to deserialize vote result: {}", e))),
                }
            },
            Ok(None) => Ok(None),
            Err(e) => Err(VoteTrackingError::InternalError(format!("Failed to get vote result: {}", e))),
        }
    }
    
    /// Check if a proposal has passed voting
    pub async fn has_proposal_passed(&self, proposal_id: &str) -> Result<bool, VoteTrackingError> {
        match self.aggregate_votes(proposal_id).await {
            Ok(result) => Ok(result.result == VoteResult::Pass && result.all_domains_complete),
            Err(e) => Err(e),
        }
    }
    
    /// Update the quorum threshold for a domain on a proposal
    pub async fn set_domain_quorum_threshold(
        &self,
        proposal_id: &str,
        domain_id: &str,
        threshold: f64,
    ) -> Result<(), VoteTrackingError> {
        // Validate threshold
        if threshold <= 0.0 || threshold > 1.0 {
            return Err(VoteTrackingError::InternalError(
                format!("Invalid quorum threshold: {}, must be between 0.0 and 1.0", threshold)
            ));
        }
        
        // Update the cache
        let mut requirements = self.quorum_requirements.write().await;
        let domain_requirements = requirements
            .entry(proposal_id.to_string())
            .or_insert_with(HashMap::new);
        
        domain_requirements.insert(domain_id.to_string(), threshold);
        
        // Update the proposal if it exists
        if let Ok(mut proposal) = self.get_proposal(proposal_id).await {
            let requirements = proposal.quorum_requirements.get_or_insert_with(HashMap::new);
            requirements.insert(domain_id.to_string(), threshold);
            
            // Store the updated proposal
            let proposal_key = format!("federation:proposals:{}", proposal_id);
            let proposal_json = serde_json::to_string(&proposal)
                .map_err(|e| VoteTrackingError::SerializationError(e.to_string()))?;
            
            self.redis.set(&proposal_key, &proposal_json).await
                .map_err(|e| VoteTrackingError::InternalError(format!("Failed to store updated proposal: {}", e)))?;
        }
        
        Ok(())
    }
    
    /// Get the quorum threshold for a domain on a proposal
    async fn get_domain_quorum_threshold(&self, proposal: &FederatedProposal, domain_id: &str) -> f64 {
        // Check proposal-specific requirements
        if let Some(requirements) = &proposal.quorum_requirements {
            if let Some(threshold) = requirements.get(domain_id) {
                return *threshold;
            }
        }
        
        // Check cache
        let requirements = self.quorum_requirements.read().await;
        if let Some(domain_requirements) = requirements.get(&proposal.id) {
            if let Some(threshold) = domain_requirements.get(domain_id) {
                return *threshold;
            }
        }
        
        // Use default
        self.default_quorum_threshold
    }
    
    /// Get a proposal by ID
    async fn get_proposal(&self, proposal_id: &str) -> Result<FederatedProposal, VoteTrackingError> {
        let proposal_key = format!("federation:proposals:{}", proposal_id);
        
        match self.redis.get::<String>(&proposal_key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<FederatedProposal>(&json) {
                    Ok(proposal) => Ok(proposal),
                    Err(e) => Err(VoteTrackingError::SerializationError(format!("Failed to deserialize proposal: {}", e))),
                }
            },
            Ok(None) => Err(VoteTrackingError::ProposalNotFound(proposal_id.to_string())),
            Err(e) => Err(VoteTrackingError::InternalError(format!("Failed to get proposal: {}", e))),
        }
    }
    
    /// Calculate the vote weight for an agent
    async fn calculate_vote_weight(&self, agent_id: &str) -> Result<VoteWeight, VoteTrackingError> {
        // For now, use a simple weighting scheme
        // This can be expanded to use trust scores, stake, etc.
        let base_weight = 1.0;
        let trust_multiplier = 1.0; // TODO: Get from trust score system
        let domain_modifier = 1.0;
        
        Ok(VoteWeight::new(
            agent_id.to_string(),
            base_weight,
            trust_multiplier,
            domain_modifier,
        ))
    }
    
    /// Check if voting should be closed for a proposal
    pub async fn should_close_voting(&self, proposal_id: &str) -> Result<bool, VoteTrackingError> {
        // Get the proposal
        let proposal = self.get_proposal(proposal_id).await?;
        
        // If already closed, return false
        if proposal.status != FederatedProposalStatus::Open {
            return Ok(false);
        }
        
        // Check if all domains have voted
        let result = self.aggregate_votes(proposal_id).await?;
        if result.all_domains_complete {
            return Ok(true);
        }
        
        // Check if there's a timeout
        if let Some(closed) = proposal.timestamps.voting_closed {
            return Ok(Utc::now() > closed);
        }
        
        // Check if execution timeout has passed
        if let Some(timeout) = proposal.execution_timeout_seconds {
            let timeout_duration = chrono::Duration::seconds(timeout as i64);
            let deadline = proposal.timestamps.created + timeout_duration;
            
            return Ok(Utc::now() > deadline);
        }
        
        Ok(false)
    }
    
    /// Close voting on a proposal
    pub async fn close_voting(&self, proposal_id: &str) -> Result<FederatedProposal, VoteTrackingError> {
        // Get the proposal
        let mut proposal = self.get_proposal(proposal_id).await?;
        
        // Check if already closed
        if proposal.status != FederatedProposalStatus::Open {
            return Ok(proposal);
        }
        
        // Close voting
        proposal.close_voting();
        
        // Get the vote result
        let result = self.aggregate_votes(proposal_id).await?;
        
        // Update proposal status based on vote
        match result.result {
            VoteResult::Pass => {
                proposal.update_status(FederatedProposalStatus::Executing);
                info!("Proposal {} passed voting and is now executing", proposal_id);
            },
            VoteResult::Fail => {
                proposal.update_status(FederatedProposalStatus::Rejected);
                info!("Proposal {} failed voting and is now rejected", proposal_id);
            },
            VoteResult::Inconclusive => {
                proposal.update_status(FederatedProposalStatus::Rejected);
                info!("Proposal {} voting was inconclusive and is now rejected", proposal_id);
            },
            VoteResult::InProgress => {
                // Force close anyway since we're explicitly closing
                proposal.update_status(FederatedProposalStatus::Rejected);
                warn!("Proposal {} voting was still in progress but is being forcibly closed", proposal_id);
            },
        }
        
        // Store the updated proposal
        let proposal_key = format!("federation:proposals:{}", proposal_id);
        let proposal_json = serde_json::to_string(&proposal)
            .map_err(|e| VoteTrackingError::SerializationError(e.to_string()))?;
        
        self.redis.set(&proposal_key, &proposal_json).await
            .map_err(|e| VoteTrackingError::InternalError(format!("Failed to store updated proposal: {}", e)))?;
        
        // Report to telemetry
        let mut data = HashMap::new();
        data.insert("proposal_id".to_string(), serde_json::to_value(proposal_id).unwrap());
        data.insert("result".to_string(), serde_json::to_value(&result.result).unwrap());
        data.insert("status".to_string(), serde_json::to_value(&proposal.status).unwrap());
        data.insert("yes_weight".to_string(), serde_json::to_value(result.vote_weights.get("yes").unwrap_or(&0.0)).unwrap());
        data.insert("no_weight".to_string(), serde_json::to_value(result.vote_weights.get("no").unwrap_or(&0.0)).unwrap());
        self.telemetry.report_custom("voting_closed", data).await;
        
        Ok(proposal)
    }
} 