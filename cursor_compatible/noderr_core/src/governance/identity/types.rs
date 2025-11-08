// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};

/// Decentralized identity information for an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DIDIdentity {
    /// The decentralized identifier (e.g., did:ethr:0xabc123...)
    pub did: String,
    /// The domain this identity is associated with
    pub domain: String,
    /// Cryptographic signature validating the identity
    pub signature: String,
    /// Timestamp when the identity was created/validated
    pub timestamp: DateTime<Utc>,
    /// Optional additional metadata for the identity
    pub metadata: Option<serde_json::Value>,
}

/// Action performed in a proposal's lifecycle
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalAction {
    /// Create a new proposal
    Create,
    /// Edit an existing proposal
    Edit,
    /// Delete/cancel a proposal
    Delete,
    /// Vote on a proposal
    Vote,
    /// Execute a proposal
    Execute,
    /// Finalize a proposal
    Finalize,
}

impl std::fmt::Display for ProposalAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProposalAction::Create => write!(f, "create"),
            ProposalAction::Edit => write!(f, "edit"),
            ProposalAction::Delete => write!(f, "delete"),
            ProposalAction::Vote => write!(f, "vote"),
            ProposalAction::Execute => write!(f, "execute"),
            ProposalAction::Finalize => write!(f, "finalize"),
        }
    }
}

/// Record of an action in a proposal's authentication chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalAuthRecord {
    /// The action performed
    pub action: ProposalAction,
    /// The DID of the agent performing the action
    pub agent_did: String,
    /// Cryptographic signature of the payload hash
    pub signature: String,
    /// Timestamp when the action occurred
    pub timestamp: DateTime<Utc>,
    /// Hash of the payload at this point in time
    pub payload_hash: String,
    /// Optional metadata about the action
    pub metadata: Option<serde_json::Value>,
}

/// An envelope containing a payload and its authentication chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceEnvelope<T> {
    /// The actual payload
    pub payload: T,
    /// The chain of authentication records
    pub auth_chain: Vec<ProposalAuthRecord>,
    /// Optional IPFS/Arweave CID for this version
    pub storage_cid: Option<String>,
}

/// Different DID methods supported
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DIDMethod {
    /// Ethereum-based DID
    Ethereum,
    /// Key-based DID
    Key,
    /// Cosmos-based DID
    Cosmos,
    /// ION-based DID
    Ion,
    /// Other DID methods
    Other(String),
}

impl DIDMethod {
    /// Parse a DID method from a DID string
    pub fn from_did(did: &str) -> Option<Self> {
        if did.starts_with("did:ethr:") {
            Some(Self::Ethereum)
        } else if did.starts_with("did:key:") {
            Some(Self::Key)
        } else if did.starts_with("did:cosmos:") {
            Some(Self::Cosmos)
        } else if did.starts_with("did:ion:") {
            Some(Self::Ion)
        } else if did.starts_with("did:") {
            let parts: Vec<&str> = did.split(':').collect();
            if parts.len() >= 2 {
                Some(Self::Other(parts[1].to_string()))
            } else {
                None
            }
        } else {
            None
        }
    }
} 