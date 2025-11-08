// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::sync::Arc;
use thiserror::Error;
use chrono::Utc;
use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};

use crate::governance::identity::types::{
    DIDIdentity,
    ProposalAuthRecord,
    ProposalAction,
    ProvenanceEnvelope,
};
use crate::governance::identity::verify::{
    DIDVerificationService,
    VerificationError,
    calculate_hash,
};
use crate::governance::identity::anchor::{
    AnchorService,
    AnchorError,
};
use crate::governance::federation::types::FederatedProposal;

/// Error types for provenance operations
#[derive(Debug, Error)]
pub enum ProvenanceError {
    #[error("Verification error: {0}")]
    VerificationError(#[from] VerificationError),
    
    #[error("Anchoring error: {0}")]
    AnchoringError(#[from] AnchorError),
    
    #[error("Agent not authorized: {0}")]
    AgentNotAuthorized(String),
    
    #[error("Invalid provenance chain: {0}")]
    InvalidProvenanceChain(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Service for managing proposal provenance
pub struct ProvenanceService {
    verification_service: Arc<DIDVerificationService>,
    anchor_service: Arc<AnchorService>,
}

impl ProvenanceService {
    /// Create a new provenance service
    pub fn new(
        verification_service: Arc<DIDVerificationService>,
        anchor_service: Arc<AnchorService>,
    ) -> Self {
        Self {
            verification_service,
            anchor_service,
        }
    }
    
    /// Create a new provenance envelope for a proposal
    pub async fn create_provenance_envelope<T: Serialize + Send + Sync>(
        &self,
        payload: T,
        agent_did: &DIDIdentity,
        action: ProposalAction,
    ) -> Result<ProvenanceEnvelope<T>, ProvenanceError> {
        // Verify the agent's identity
        let verified = self.verification_service.verify_identity(agent_did).await
            .map_err(ProvenanceError::VerificationError)?;
        
        if !verified {
            return Err(ProvenanceError::AgentNotAuthorized(
                format!("Agent DID verification failed: {}", agent_did.did)
            ));
        }
        
        // Calculate hash of the payload
        let payload_hash = calculate_hash(&payload)
            .map_err(ProvenanceError::VerificationError)?;
        
        // Create an auth record
        let auth_record = ProposalAuthRecord {
            action,
            agent_did: agent_did.did.clone(),
            signature: agent_did.signature.clone(),
            timestamp: Utc::now(),
            payload_hash,
            metadata: None,
        };
        
        // Create the envelope
        let envelope = ProvenanceEnvelope {
            payload,
            auth_chain: vec![auth_record],
            storage_cid: None,
        };
        
        // Anchor the envelope if storage is available
        let anchored_envelope = if self.anchor_service.is_storage_available().await {
            match self.anchor_service.anchor_proposal(&envelope).await {
                Ok(cid) => {
                    // Create a new envelope with the CID
                    ProvenanceEnvelope {
                        payload: envelope.payload,
                        auth_chain: envelope.auth_chain,
                        storage_cid: Some(cid),
                    }
                },
                Err(e) => {
                    warn!("Failed to anchor proposal: {}", e);
                    envelope
                }
            }
        } else {
            debug!("Decentralized storage not available, skipping anchoring");
            envelope
        };
        
        Ok(anchored_envelope)
    }
    
    /// Update an existing provenance envelope with a new action
    pub async fn update_provenance_envelope<T: Serialize + Send + Sync>(
        &self,
        mut envelope: ProvenanceEnvelope<T>,
        agent_did: &DIDIdentity,
        action: ProposalAction,
        updated_payload: T,
    ) -> Result<ProvenanceEnvelope<T>, ProvenanceError> {
        // Verify the agent's identity
        let verified = self.verification_service.verify_identity(agent_did).await
            .map_err(ProvenanceError::VerificationError)?;
        
        if !verified {
            return Err(ProvenanceError::AgentNotAuthorized(
                format!("Agent DID verification failed: {}", agent_did.did)
            ));
        }
        
        // Calculate hash of the updated payload
        let payload_hash = calculate_hash(&updated_payload)
            .map_err(ProvenanceError::VerificationError)?;
        
        // Create a new auth record
        let auth_record = ProposalAuthRecord {
            action,
            agent_did: agent_did.did.clone(),
            signature: agent_did.signature.clone(),
            timestamp: Utc::now(),
            payload_hash,
            metadata: None,
        };
        
        // Add to the auth chain
        envelope.auth_chain.push(auth_record);
        
        // Update the payload
        envelope.payload = updated_payload;
        
        // Anchor the updated envelope if storage is available
        if self.anchor_service.is_storage_available().await {
            match self.anchor_service.anchor_proposal(&envelope).await {
                Ok(cid) => {
                    // Update the CID
                    envelope.storage_cid = Some(cid);
                },
                Err(e) => {
                    warn!("Failed to anchor updated proposal: {}", e);
                }
            }
        } else {
            debug!("Decentralized storage not available, skipping anchoring");
        }
        
        Ok(envelope)
    }
    
    /// Validate a provenance envelope
    pub async fn validate_provenance_envelope<T: Serialize + Send + Sync>(
        &self,
        envelope: &ProvenanceEnvelope<T>,
    ) -> Result<bool, ProvenanceError> {
        if envelope.auth_chain.is_empty() {
            return Err(ProvenanceError::InvalidProvenanceChain("Auth chain is empty".to_string()));
        }
        
        // Check if the first action is Create
        if envelope.auth_chain[0].action != ProposalAction::Create {
            return Err(ProvenanceError::InvalidProvenanceChain(
                "First action must be Create".to_string()
            ));
        }
        
        // Validate each auth record
        for (i, record) in envelope.auth_chain.iter().enumerate() {
            // Create a mocked DIDIdentity from the record
            let identity = DIDIdentity {
                did: record.agent_did.clone(),
                domain: "unknown".to_string(), // We don't have this information in the record
                signature: record.signature.clone(),
                timestamp: record.timestamp,
                metadata: None,
            };
            
            // Verify the identity
            let verified = self.verification_service.verify_identity(&identity).await
                .map_err(ProvenanceError::VerificationError)?;
            
            if !verified {
                return Err(ProvenanceError::AgentNotAuthorized(
                    format!("Agent DID verification failed at record {}: {}", i, record.agent_did)
                ));
            }
            
            // Verify payload hash if it's the last record
            if i == envelope.auth_chain.len() - 1 {
                let current_hash = calculate_hash(&envelope.payload)
                    .map_err(ProvenanceError::VerificationError)?;
                
                if current_hash != record.payload_hash {
                    return Err(ProvenanceError::InvalidProvenanceChain(
                        format!("Payload hash mismatch: expected {}, got {}", record.payload_hash, current_hash)
                    ));
                }
            }
        }
        
        Ok(true)
    }
    
    /// Retrieve an envelope from decentralized storage
    pub async fn retrieve_envelope<T>(
        &self,
        cid: &str,
    ) -> Result<ProvenanceEnvelope<T>, ProvenanceError> 
    where
        T: for<'de> Deserialize<'de>,
    {
        self.anchor_service.retrieve_proposal(cid).await
            .map_err(ProvenanceError::AnchoringError)
    }
    
    /// Create a new provenance envelope for a federated proposal
    pub async fn create_federated_proposal_envelope(
        &self,
        proposal: FederatedProposal,
        agent_did: &DIDIdentity,
    ) -> Result<ProvenanceEnvelope<FederatedProposal>, ProvenanceError> {
        self.create_provenance_envelope(proposal, agent_did, ProposalAction::Create).await
    }
    
    /// Update an existing federated proposal envelope
    pub async fn update_federated_proposal_envelope(
        &self,
        envelope: ProvenanceEnvelope<FederatedProposal>,
        agent_did: &DIDIdentity,
        updated_proposal: FederatedProposal,
    ) -> Result<ProvenanceEnvelope<FederatedProposal>, ProvenanceError> {
        self.update_provenance_envelope(envelope, agent_did, ProposalAction::Edit, updated_proposal).await
    }
    
    /// Add a vote record to a federated proposal envelope
    pub async fn add_vote_to_envelope(
        &self,
        envelope: ProvenanceEnvelope<FederatedProposal>,
        agent_did: &DIDIdentity,
    ) -> Result<ProvenanceEnvelope<FederatedProposal>, ProvenanceError> {
        self.update_provenance_envelope(envelope, agent_did, ProposalAction::Vote, envelope.payload.clone()).await
    }
} 