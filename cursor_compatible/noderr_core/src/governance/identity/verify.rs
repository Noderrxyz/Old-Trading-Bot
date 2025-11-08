// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::sync::Arc;
use async_trait::async_trait;
use thiserror::Error;
use tracing::{debug, error, warn};
use hex;
use sha2::{Sha256, Digest};
use k256::ecdsa::{Signature, signature::Verifier};
use k256::ecdsa::{SigningKey, VerifyingKey};
use crate::governance::identity::types::{DIDIdentity, DIDMethod};

/// Errors that can occur during signature verification
#[derive(Debug, Error)]
pub enum VerificationError {
    #[error("Invalid DID format: {0}")]
    InvalidDID(String),
    
    #[error("Unsupported DID method: {0}")]
    UnsupportedMethod(String),
    
    #[error("Invalid signature format: {0}")]
    InvalidSignature(String),
    
    #[error("Verification failed: {0}")]
    VerificationFailed(String),
    
    #[error("Key recovery failed: {0}")]
    KeyRecoveryFailed(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Trait for verifying signatures for different DID methods
#[async_trait]
pub trait DIDVerifier: Send + Sync {
    /// Check if this verifier supports the given DID method
    fn supports_method(&self, method: &DIDMethod) -> bool;
    
    /// Verify a signature against a message hash and DID
    async fn verify_signature(&self, did: &str, message_hash: &[u8], signature: &[u8]) 
        -> Result<bool, VerificationError>;
}

/// Ethereum DID verifier implementation
pub struct EthereumDIDVerifier {}

impl EthereumDIDVerifier {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl DIDVerifier for EthereumDIDVerifier {
    fn supports_method(&self, method: &DIDMethod) -> bool {
        matches!(method, DIDMethod::Ethereum)
    }
    
    async fn verify_signature(&self, did: &str, message_hash: &[u8], signature: &[u8]) 
        -> Result<bool, VerificationError> {
        // Extract address from did:ethr:0x...
        let address = did.strip_prefix("did:ethr:")
            .ok_or_else(|| VerificationError::InvalidDID(did.to_string()))?;
            
        // For Ethereum, we'd normally use ecrecover to get the address from the signature
        // This is a simplified implementation
        // In a real system, you'd want to use proper Ethereum signature verification
        
        // For now, we're using k256 for ECDSA verification
        if signature.len() != 65 {
            return Err(VerificationError::InvalidSignature(
                format!("Expected 65 bytes signature, got {}", signature.len())
            ));
        }
        
        // Extract r, s, v from signature
        let r = &signature[0..32];
        let s = &signature[32..64];
        let v = signature[64];
        
        // This is a simplified check - in a real implementation, 
        // you would recover the public key and derive the address
        
        debug!("Verifying Ethereum signature for {}", did);
        
        // Return placeholder (this should be properly implemented)
        // In real implementation, compare recovered address with the did address
        Ok(true)
    }
}

/// Key-based DID verifier implementation
pub struct KeyDIDVerifier {}

impl KeyDIDVerifier {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl DIDVerifier for KeyDIDVerifier {
    fn supports_method(&self, method: &DIDMethod) -> bool {
        matches!(method, DIDMethod::Key)
    }
    
    async fn verify_signature(&self, did: &str, message_hash: &[u8], signature: &[u8]) 
        -> Result<bool, VerificationError> {
        // Extract public key from did:key:...
        let key_part = did.strip_prefix("did:key:")
            .ok_or_else(|| VerificationError::InvalidDID(did.to_string()))?;
            
        // did:key typically uses multibase encoding 
        // This is a simplified implementation
        
        debug!("Verifying key-based signature for {}", did);
        
        // Return placeholder (this should be properly implemented)
        Ok(true)
    }
}

/// Cosmos DID verifier implementation
pub struct CosmosDIDVerifier {}

impl CosmosDIDVerifier {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl DIDVerifier for CosmosDIDVerifier {
    fn supports_method(&self, method: &DIDMethod) -> bool {
        matches!(method, DIDMethod::Cosmos)
    }
    
    async fn verify_signature(&self, did: &str, message_hash: &[u8], signature: &[u8]) 
        -> Result<bool, VerificationError> {
        // Extract address from did:cosmos:...
        let address = did.strip_prefix("did:cosmos:")
            .ok_or_else(|| VerificationError::InvalidDID(did.to_string()))?;
            
        debug!("Verifying Cosmos signature for {}", did);
        
        // Return placeholder (this should be properly implemented)
        Ok(true)
    }
}

/// Service to verify DID signatures using appropriate verifiers
pub struct DIDVerificationService {
    verifiers: Vec<Arc<dyn DIDVerifier>>,
}

impl DIDVerificationService {
    /// Create a new DID verification service with default verifiers
    pub fn new() -> Self {
        let mut verifiers: Vec<Arc<dyn DIDVerifier>> = Vec::new();
        
        // Add default verifiers
        verifiers.push(Arc::new(EthereumDIDVerifier::new()));
        verifiers.push(Arc::new(KeyDIDVerifier::new()));
        verifiers.push(Arc::new(CosmosDIDVerifier::new()));
        
        Self { verifiers }
    }
    
    /// Add a custom verifier
    pub fn add_verifier(&mut self, verifier: Arc<dyn DIDVerifier>) {
        self.verifiers.push(verifier);
    }
    
    /// Verify a signature
    pub async fn verify_signature(&self, did: &str, data: &[u8], signature: &str) 
        -> Result<bool, VerificationError> {
        let method = DIDMethod::from_did(did)
            .ok_or_else(|| VerificationError::InvalidDID(did.to_string()))?;
            
        // Find appropriate verifier
        for verifier in &self.verifiers {
            if verifier.supports_method(&method) {
                // Convert hex signature to bytes
                let sig_bytes = hex::decode(signature.trim_start_matches("0x"))
                    .map_err(|e| VerificationError::InvalidSignature(e.to_string()))?;
                
                // Calculate hash of data if not already a hash
                let message_hash = if data.len() == 32 {
                    data.to_vec()
                } else {
                    let mut hasher = Sha256::new();
                    hasher.update(data);
                    hasher.finalize().to_vec()
                };
                
                return verifier.verify_signature(did, &message_hash, &sig_bytes).await;
            }
        }
        
        Err(VerificationError::UnsupportedMethod(format!("{:?}", method)))
    }
    
    /// Create a hash of the provided data
    pub fn hash_data(&self, data: &[u8]) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hasher.finalize().to_vec()
    }
    
    /// Verify an identity DID matches its signature
    pub async fn verify_identity(&self, identity: &DIDIdentity) -> Result<bool, VerificationError> {
        // The payload to verify would typically be a challenge or the DID document
        // This is a simplified check - in a real system you'd want more robust verification
        let payload = identity.did.as_bytes();
        self.verify_signature(&identity.did, payload, &identity.signature).await
    }
}

/// Calculate a SHA-256 hash of serialized data
pub fn calculate_hash<T: serde::Serialize>(data: &T) -> Result<String, VerificationError> {
    let json = serde_json::to_string(data)
        .map_err(|e| VerificationError::InternalError(format!("Serialization error: {}", e)))?;
    
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    let result = hasher.finalize();
    
    Ok(hex::encode(result))
} 