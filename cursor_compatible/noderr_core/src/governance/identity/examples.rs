// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

//! Examples of how to use the DID provenance system

use std::sync::Arc;
use chrono::Utc;

use crate::redis::RedisClient;
use crate::governance::identity::types::{
    DIDIdentity,
    ProposalAction,
    ProvenanceEnvelope,
};
use crate::governance::identity::verify::{
    DIDVerificationService,
};
use crate::governance::identity::domain_map::DIDMappingService;
use crate::governance::identity::anchor::{
    AnchorService,
    IPFSProvider,
    ArweaveProvider,
};
use crate::governance::identity::provenance::ProvenanceService;
use crate::governance::federation::types::{
    FederatedProposal,
    ProposalAuthor,
};

/// Example of creating a proposal with DID provenance
pub async fn create_proposal_with_provenance(redis_client: Arc<RedisClient>) {
    println!("Creating a new proposal with DID provenance");
    
    // Set up the required services
    let verification_service = Arc::new(DIDVerificationService::new());
    let mapping_service = DIDMappingService::new(redis_client.clone());
    
    // Set up IPFS provider (primary storage)
    let ipfs_provider = Arc::new(IPFSProvider::new("http://localhost:5001".to_string()));
    
    // Set up Arweave provider (fallback storage)
    let arweave_provider = Arc::new(ArweaveProvider::new(
        "https://arweave.net".to_string(),
        None,
    ));
    
    // Create anchor service with fallback
    let anchor_service = Arc::new(AnchorService::with_fallback(
        ipfs_provider,
        arweave_provider,
    ));
    
    // Create provenance service
    let provenance_service = ProvenanceService::new(
        verification_service,
        anchor_service,
    );
    
    // Create a mock agent DID
    let agent_did = DIDIdentity {
        did: "did:ethr:0x1234567890123456789012345678901234567890".to_string(),
        domain: "example.com".to_string(),
        signature: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456789012345678901234567890123456789012345678901234567890123401".to_string(),
        timestamp: Utc::now(),
        metadata: None,
    };
    
    // Create a proposal author from the DID
    let author = ProposalAuthor {
        agent_did: agent_did.did.clone(),
        agent_name: Some("Example Agent".to_string()),
        domain_id: "domain1".to_string(),
        signature: Some(agent_did.signature.clone()),
        timestamp: Utc::now(),
    };
    
    // Create a new proposal
    let proposal = FederatedProposal::new_with_provenance(
        "Example Proposal".to_string(),
        "This is a test proposal with DID provenance".to_string(),
        "domain1".to_string(),
        vec!["domain1".to_string(), "domain2".to_string()],
        author,
        serde_json::json!({
            "action": "transfer",
            "amount": 100,
            "target": "domain2"
        }),
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
    );
    
    // Create a provenance envelope for the proposal
    match provenance_service.create_federated_proposal_envelope(proposal, &agent_did).await {
        Ok(envelope) => {
            println!("Created proposal envelope with provenance");
            println!("Auth chain length: {}", envelope.auth_chain.len());
            
            if let Some(cid) = envelope.storage_cid {
                println!("Stored proposal on decentralized storage with CID: {}", cid);
            } else {
                println!("Decentralized storage not available");
            }
            
            // Now let's simulate editing the proposal
            let mut updated_proposal = envelope.payload.clone();
            updated_proposal.description = "Updated description with more details".to_string();
            
            // Update the provenance envelope
            match provenance_service.update_federated_proposal_envelope(
                envelope,
                &agent_did,
                updated_proposal,
            ).await {
                Ok(updated_envelope) => {
                    println!("Updated proposal envelope");
                    println!("New auth chain length: {}", updated_envelope.auth_chain.len());
                    
                    // Validate the provenance chain
                    match provenance_service.validate_provenance_envelope(&updated_envelope).await {
                        Ok(true) => println!("Provenance chain validated successfully"),
                        Ok(false) => println!("Provenance chain validation failed"),
                        Err(e) => println!("Error validating provenance chain: {}", e),
                    }
                },
                Err(e) => println!("Error updating proposal envelope: {}", e),
            }
        },
        Err(e) => println!("Error creating proposal envelope: {}", e),
    }
}

/// Example of creating a vote with DID provenance
pub async fn create_vote_with_provenance(
    proposal_id: &str, 
    redis_client: Arc<RedisClient>
) {
    println!("Creating a new vote with DID provenance");
    
    // Set up the required services
    let verification_service = Arc::new(DIDVerificationService::new());
    let mapping_service = DIDMappingService::new(redis_client.clone());
    
    // Set up IPFS provider (primary storage)
    let ipfs_provider = Arc::new(IPFSProvider::new("http://localhost:5001".to_string()));
    
    // Create anchor service without fallback
    let anchor_service = Arc::new(AnchorService::new(ipfs_provider));
    
    // Create provenance service
    let provenance_service = ProvenanceService::new(
        verification_service,
        anchor_service,
    );
    
    // Create a mock agent DID
    let agent_did = DIDIdentity {
        did: "did:ethr:0x9876543210987654321098765432109876543210".to_string(),
        domain: "example.com".to_string(),
        signature: "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef987654321098765432109876543210987654321098765432109876543210123401".to_string(),
        timestamp: Utc::now(),
        metadata: None,
    };
    
    // Create a mock proposal for voting
    let author = ProposalAuthor {
        agent_did: "did:ethr:0x1234567890123456789012345678901234567890".to_string(),
        agent_name: Some("Proposal Creator".to_string()),
        domain_id: "domain1".to_string(),
        signature: None,
        timestamp: Utc::now(),
    };
    
    let proposal = FederatedProposal::new_with_provenance(
        "Example Proposal".to_string(),
        "This is a test proposal with DID provenance".to_string(),
        "domain1".to_string(),
        vec!["domain1".to_string(), "domain2".to_string()],
        author,
        serde_json::json!({
            "action": "transfer",
            "amount": 100,
            "target": "domain2"
        }),
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
    );
    
    // Create a provenance envelope for the proposal
    match provenance_service.create_federated_proposal_envelope(proposal, &agent_did).await {
        Ok(envelope) => {
            println!("Created proposal envelope for voting");
            
            // Now create a vote by adding a vote action to the provenance chain
            match provenance_service.add_vote_to_envelope(envelope, &agent_did).await {
                Ok(voted_envelope) => {
                    println!("Added vote to proposal envelope");
                    println!("Auth chain length: {}", voted_envelope.auth_chain.len());
                    
                    // The last auth record should be a Vote action
                    if let Some(last_auth) = voted_envelope.auth_chain.last() {
                        if last_auth.action == ProposalAction::Vote {
                            println!("Vote successfully recorded in provenance chain");
                        } else {
                            println!("Last action is not a vote: {:?}", last_auth.action);
                        }
                    }
                },
                Err(e) => println!("Error adding vote to envelope: {}", e),
            }
        },
        Err(e) => println!("Error creating proposal envelope for voting: {}", e),
    }
} 