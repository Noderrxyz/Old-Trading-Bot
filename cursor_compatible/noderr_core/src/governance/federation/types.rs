// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Status of a federated proposal across domains
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FederatedProposalStatus {
    /// Proposal is open for voting
    Open,
    /// Proposal is being executed across domains
    Executing,
    /// Proposal has been finalized (executed or rejected) on all domains
    Finalized,
    /// Proposal has been rejected
    Rejected,
}

impl std::fmt::Display for FederatedProposalStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FederatedProposalStatus::Open => write!(f, "open"),
            FederatedProposalStatus::Executing => write!(f, "executing"),
            FederatedProposalStatus::Finalized => write!(f, "finalized"),
            FederatedProposalStatus::Rejected => write!(f, "rejected"),
        }
    }
}

/// Information about a domain (cluster, chain, or protocol)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainInfo {
    /// Unique identifier for the domain
    pub id: String,
    /// Human-readable name for the domain
    pub name: String,
    /// Network endpoint for communicating with the domain
    pub endpoint: String,
    /// Domain type (e.g., "NodeNet", "DexCluster")
    pub domain_type: String,
    /// Domain-specific metadata
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Synchronization status of a proposal across domains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalSyncState {
    /// Domain ID
    pub domain_id: String,
    /// Whether the domain has acknowledged the proposal
    pub acknowledged: bool,
    /// Whether voting has been completed on this domain
    pub voting_complete: bool,
    /// Whether execution has been initiated on this domain
    pub execution_initiated: bool,
    /// Whether execution has been finalized on this domain
    pub execution_finalized: bool,
    /// Last sync timestamp
    pub last_sync: DateTime<Utc>,
    /// Any error message from the last sync attempt
    pub last_error: Option<String>,
}

/// Information about proposal authorship with provenance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalAuthor {
    /// Agent DID that created the proposal
    pub agent_did: String,
    /// Agent name or other identifier
    pub agent_name: Option<String>,
    /// Domain the agent belongs to
    pub domain_id: String,
    /// Cryptographic signature of the agent
    pub signature: Option<String>,
    /// When the author information was recorded
    pub timestamp: DateTime<Utc>,
}

/// A proposal that spans multiple domains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedProposal {
    /// Unique proposal identifier
    pub id: String,
    /// Proposal title
    pub title: String,
    /// Detailed description
    pub description: String,
    /// Domain where the proposal originated
    pub origin_domain: String,
    /// All domains participating in this proposal
    pub participating_domains: Vec<String>,
    /// Agent that created the proposal with DID
    pub created_by: String,
    /// Detailed author information with provenance
    pub author: ProposalAuthor,
    /// Serialized execution payload
    pub payload: serde_json::Value,
    /// Current status of the proposal
    pub status: FederatedProposalStatus,
    /// Timestamps for proposal events
    pub timestamps: ProposalTimestamps,
    /// Sync status across domains
    pub sync_state: Vec<ProposalSyncState>,
    /// Quorum requirements per domain (optional)
    pub quorum_requirements: Option<HashMap<String, f64>>,
    /// Execution timeout in seconds
    pub execution_timeout_seconds: Option<u64>,
    /// Optional metadata for additional context
    pub metadata: Option<HashMap<String, serde_json::Value>>,
    /// Edit history with provenance data (agent DIDs, timestamps, signatures)
    pub edit_history: Vec<ProposalEdit>,
    /// Optional IPFS/Arweave content identifier
    pub storage_cid: Option<String>,
}

/// Information about an edit to a proposal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalEdit {
    /// Agent DID that made the edit
    pub agent_did: String,
    /// Timestamp of the edit
    pub timestamp: DateTime<Utc>,
    /// Description of what was changed
    pub edit_description: String,
    /// Hash of the proposal state after this edit
    pub state_hash: String,
    /// Cryptographic signature of the edit
    pub signature: Option<String>,
}

/// Timestamps for proposal lifecycle events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalTimestamps {
    /// When the proposal was created
    pub created: DateTime<Utc>,
    /// When the proposal was last updated
    pub last_updated: DateTime<Utc>,
    /// When voting closed
    pub voting_closed: Option<DateTime<Utc>>,
    /// When execution began
    pub execution_started: Option<DateTime<Utc>>,
    /// When proposal was fully finalized
    pub finalized: Option<DateTime<Utc>>,
}

impl FederatedProposal {
    /// Create a new federated proposal
    pub fn new(
        title: String,
        description: String,
        origin_domain: String,
        participating_domains: Vec<String>,
        created_by: String,
        payload: serde_json::Value,
    ) -> Self {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        
        let sync_state = participating_domains
            .iter()
            .map(|domain_id| ProposalSyncState {
                domain_id: domain_id.clone(),
                acknowledged: domain_id == &origin_domain,
                voting_complete: false,
                execution_initiated: false,
                execution_finalized: false,
                last_sync: now,
                last_error: None,
            })
            .collect();
            
        // Create author record
        let author = ProposalAuthor {
            agent_did: created_by.clone(), // In newer code, this would be the DID
            agent_name: None,
            domain_id: origin_domain.clone(),
            signature: None,
            timestamp: now,
        };
        
        Self {
            id,
            title,
            description,
            origin_domain,
            participating_domains,
            created_by,
            author,
            payload,
            status: FederatedProposalStatus::Open,
            timestamps: ProposalTimestamps {
                created: now,
                last_updated: now,
                voting_closed: None,
                execution_started: None,
                finalized: None,
            },
            sync_state,
            quorum_requirements: None,
            execution_timeout_seconds: Some(86400), // 24 hours default
            metadata: None,
            edit_history: Vec::new(),
            storage_cid: None,
        }
    }
    
    /// Create a new federated proposal with full DID provenance
    pub fn new_with_provenance(
        title: String,
        description: String,
        origin_domain: String,
        participating_domains: Vec<String>,
        author: ProposalAuthor,
        payload: serde_json::Value,
        state_hash: String,
    ) -> Self {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        
        let sync_state = participating_domains
            .iter()
            .map(|domain_id| ProposalSyncState {
                domain_id: domain_id.clone(),
                acknowledged: domain_id == &origin_domain,
                voting_complete: false,
                execution_initiated: false,
                execution_finalized: false,
                last_sync: now,
                last_error: None,
            })
            .collect();
        
        Self {
            id,
            title,
            description,
            origin_domain,
            participating_domains,
            created_by: author.agent_did.clone(),
            author,
            payload,
            status: FederatedProposalStatus::Open,
            timestamps: ProposalTimestamps {
                created: now,
                last_updated: now,
                voting_closed: None,
                execution_started: None,
                finalized: None,
            },
            sync_state,
            quorum_requirements: None,
            execution_timeout_seconds: Some(86400), // 24 hours default
            metadata: None,
            edit_history: Vec::new(),
            storage_cid: None,
        }
    }
    
    /// Check if a domain is participating in this proposal
    pub fn is_domain_participating(&self, domain_id: &str) -> bool {
        self.participating_domains.contains(&domain_id.to_string())
    }
    
    /// Update the status of this proposal
    pub fn update_status(&mut self, status: FederatedProposalStatus) {
        self.status = status;
        self.timestamps.last_updated = Utc::now();
        
        match status {
            FederatedProposalStatus::Open => (),
            FederatedProposalStatus::Executing => {
                self.timestamps.execution_started = Some(Utc::now());
            },
            FederatedProposalStatus::Finalized | FederatedProposalStatus::Rejected => {
                self.timestamps.finalized = Some(Utc::now());
            },
        }
    }
    
    /// Mark voting as closed
    pub fn close_voting(&mut self) {
        self.timestamps.voting_closed = Some(Utc::now());
        self.timestamps.last_updated = Utc::now();
    }
    
    /// Add an edit record to the proposal
    pub fn add_edit(
        &mut self,
        agent_did: String,
        edit_description: String,
        state_hash: String,
        signature: Option<String>,
    ) {
        let edit = ProposalEdit {
            agent_did,
            timestamp: Utc::now(),
            edit_description,
            state_hash,
            signature,
        };
        
        self.edit_history.push(edit);
        self.timestamps.last_updated = Utc::now();
    }
    
    /// Set the storage CID for this proposal
    pub fn set_storage_cid(&mut self, cid: String) {
        self.storage_cid = Some(cid);
        self.timestamps.last_updated = Utc::now();
    }
}

/// Vote weights for trust-based voting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteWeight {
    /// Agent ID
    pub agent_id: String,
    /// Base voting weight (1.0 is standard)
    pub base_weight: f64,
    /// Trust factor multiplier
    pub trust_multiplier: f64,
    /// Domain-specific weight modifier
    pub domain_modifier: f64,
    /// Total effective weight
    pub effective_weight: f64,
}

impl VoteWeight {
    /// Create a new vote weight
    pub fn new(agent_id: String, base_weight: f64, trust_multiplier: f64, domain_modifier: f64) -> Self {
        let effective_weight = base_weight * trust_multiplier * domain_modifier;
        Self {
            agent_id,
            base_weight,
            trust_multiplier,
            domain_modifier,
            effective_weight,
        }
    }
}

/// Vote types for federated proposals
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VoteType {
    /// Vote in favor of the proposal
    Yes,
    /// Vote against the proposal
    No,
    /// Abstain from voting
    Abstain,
}

impl std::fmt::Display for VoteType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VoteType::Yes => write!(f, "yes"),
            VoteType::No => write!(f, "no"),
            VoteType::Abstain => write!(f, "abstain"),
        }
    }
}

/// A vote on a federated proposal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedVote {
    /// Unique vote ID
    pub id: String,
    /// Proposal ID this vote is for
    pub proposal_id: String,
    /// Domain this vote came from
    pub domain_id: String,
    /// Agent ID that cast the vote
    pub agent_id: String,
    /// Agent DID for identity verification
    pub agent_did: Option<String>,
    /// Type of vote
    pub vote: VoteType,
    /// Trust weight for this vote
    pub weight: VoteWeight,
    /// Timestamp the vote was cast
    pub timestamp: DateTime<Utc>,
    /// Optional reason for the vote
    pub reason: Option<String>,
    /// Cryptographic signature validating the vote
    pub signature: Option<String>,
    /// Hash of the vote data for verification
    pub vote_hash: Option<String>,
}

impl FederatedVote {
    /// Create a new federated vote
    pub fn new(
        proposal_id: String,
        domain_id: String,
        agent_id: String,
        vote: VoteType,
        weight: VoteWeight,
        reason: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            proposal_id,
            domain_id,
            agent_id,
            agent_did: None,
            vote,
            weight,
            timestamp: Utc::now(),
            reason,
            signature: None,
            vote_hash: None,
        }
    }
    
    /// Create a new federated vote with DID and provenance
    pub fn new_with_provenance(
        proposal_id: String,
        domain_id: String,
        agent_id: String,
        agent_did: String,
        vote: VoteType,
        weight: VoteWeight,
        reason: Option<String>,
        signature: String,
        vote_hash: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            proposal_id,
            domain_id,
            agent_id,
            agent_did: Some(agent_did),
            vote,
            weight,
            timestamp: Utc::now(),
            reason,
            signature: Some(signature),
            vote_hash: Some(vote_hash),
        }
    }
} 