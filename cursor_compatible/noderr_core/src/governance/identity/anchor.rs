// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::sync::Arc;
use async_trait::async_trait;
use serde::Serialize;
use thiserror::Error;
use tracing::{debug, error, info, warn};
use reqwest;
use serde_json;

use crate::governance::identity::types::ProvenanceEnvelope;

/// Error types for storage anchoring operations
#[derive(Debug, Error)]
pub enum AnchorError {
    #[error("Upload failed: {0}")]
    UploadFailed(String),
    
    #[error("Retrieval failed: {0}")]
    RetrievalFailed(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Network error: {0}")]
    NetworkError(String),
    
    #[error("Invalid CID: {0}")]
    InvalidCID(String),
    
    #[error("Storage unavailable: {0}")]
    StorageUnavailable(String),
}

/// Trait for content-addressable storage providers
#[async_trait]
pub trait StorageProvider: Send + Sync {
    /// Get the name of this storage provider
    fn name(&self) -> &str;
    
    /// Upload content to storage and return a CID
    async fn upload_content<T: Serialize + Send + Sync>(&self, content: &T) -> Result<String, AnchorError>;
    
    /// Retrieve content from storage by CID
    async fn retrieve_content(&self, cid: &str) -> Result<Vec<u8>, AnchorError>;
    
    /// Check if the storage service is available
    async fn is_available(&self) -> bool;
}

/// IPFS storage implementation
pub struct IPFSProvider {
    api_endpoint: String,
    client: reqwest::Client,
}

impl IPFSProvider {
    /// Create a new IPFS provider
    pub fn new(api_endpoint: String) -> Self {
        Self {
            api_endpoint,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl StorageProvider for IPFSProvider {
    fn name(&self) -> &str {
        "ipfs"
    }
    
    async fn upload_content<T: Serialize + Send + Sync>(&self, content: &T) -> Result<String, AnchorError> {
        // Serialize content to JSON
        let json = serde_json::to_string(content)
            .map_err(|e| AnchorError::SerializationError(e.to_string()))?;
        
        // Construct API endpoint for adding content
        let url = format!("{}/api/v0/add", self.api_endpoint);
        
        // Upload to IPFS
        let form = reqwest::multipart::Form::new()
            .text("file", json);
        
        let response = self.client.post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| AnchorError::NetworkError(e.to_string()))?;
        
        if !response.status().is_success() {
            return Err(AnchorError::UploadFailed(
                format!("IPFS API returned status: {}", response.status())
            ));
        }
        
        // Parse response to get CID
        #[derive(serde::Deserialize)]
        struct IPFSAddResponse {
            #[serde(rename = "Hash")]
            hash: String,
        }
        
        let ipfs_response = response.json::<IPFSAddResponse>().await
            .map_err(|e| AnchorError::SerializationError(format!("Failed to parse IPFS response: {}", e)))?;
        
        Ok(ipfs_response.hash)
    }
    
    async fn retrieve_content(&self, cid: &str) -> Result<Vec<u8>, AnchorError> {
        // Construct API endpoint for retrieving content
        let url = format!("{}/api/v0/cat?arg={}", self.api_endpoint, cid);
        
        // Get content from IPFS
        let response = self.client.post(&url)
            .send()
            .await
            .map_err(|e| AnchorError::NetworkError(e.to_string()))?;
        
        if !response.status().is_success() {
            return Err(AnchorError::RetrievalFailed(
                format!("IPFS API returned status: {}", response.status())
            ));
        }
        
        // Get bytes from response
        let bytes = response.bytes().await
            .map_err(|e| AnchorError::RetrievalFailed(e.to_string()))?;
        
        Ok(bytes.to_vec())
    }
    
    async fn is_available(&self) -> bool {
        // Check if IPFS API is available
        let url = format!("{}/api/v0/version", self.api_endpoint);
        
        match self.client.post(&url).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }
}

/// Arweave storage implementation
pub struct ArweaveProvider {
    api_endpoint: String,
    client: reqwest::Client,
    wallet_key: Option<String>,
}

impl ArweaveProvider {
    /// Create a new Arweave provider
    pub fn new(api_endpoint: String, wallet_key: Option<String>) -> Self {
        Self {
            api_endpoint,
            client: reqwest::Client::new(),
            wallet_key,
        }
    }
}

#[async_trait]
impl StorageProvider for ArweaveProvider {
    fn name(&self) -> &str {
        "arweave"
    }
    
    async fn upload_content<T: Serialize + Send + Sync>(&self, content: &T) -> Result<String, AnchorError> {
        // Note: This is a simplified implementation
        // A real Arweave implementation would require wallet integration
        // and transaction signing
        
        // Serialize content to JSON
        let json = serde_json::to_string(content)
            .map_err(|e| AnchorError::SerializationError(e.to_string()))?;
        
        // In a real implementation, we would:
        // 1. Create a transaction
        // 2. Sign it with the wallet key
        // 3. Submit the transaction
        // 4. Wait for confirmation
        
        // Mock implementation for now
        Err(AnchorError::StorageUnavailable(
            "Arweave implementation is a placeholder - not available".to_string()
        ))
    }
    
    async fn retrieve_content(&self, tx_id: &str) -> Result<Vec<u8>, AnchorError> {
        // Construct API endpoint for retrieving content
        let url = format!("{}/{}", self.api_endpoint, tx_id);
        
        // Get content from Arweave
        let response = self.client.get(&url)
            .send()
            .await
            .map_err(|e| AnchorError::NetworkError(e.to_string()))?;
        
        if !response.status().is_success() {
            return Err(AnchorError::RetrievalFailed(
                format!("Arweave API returned status: {}", response.status())
            ));
        }
        
        // Get bytes from response
        let bytes = response.bytes().await
            .map_err(|e| AnchorError::RetrievalFailed(e.to_string()))?;
        
        Ok(bytes.to_vec())
    }
    
    async fn is_available(&self) -> bool {
        // Check if Arweave API is available
        let url = format!("{}/info", self.api_endpoint);
        
        match self.client.get(&url).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }
}

/// Service for anchoring data to decentralized storage
pub struct AnchorService {
    primary_provider: Arc<dyn StorageProvider>,
    fallback_provider: Option<Arc<dyn StorageProvider>>,
}

impl AnchorService {
    /// Create a new anchor service with a primary storage provider
    pub fn new(primary_provider: Arc<dyn StorageProvider>) -> Self {
        Self {
            primary_provider,
            fallback_provider: None,
        }
    }
    
    /// Create a new anchor service with primary and fallback providers
    pub fn with_fallback(
        primary_provider: Arc<dyn StorageProvider>,
        fallback_provider: Arc<dyn StorageProvider>,
    ) -> Self {
        Self {
            primary_provider,
            fallback_provider: Some(fallback_provider),
        }
    }
    
    /// Anchor proposal data to decentralized storage
    pub async fn anchor_proposal<T: Serialize + Send + Sync>(
        &self,
        proposal: &ProvenanceEnvelope<T>,
    ) -> Result<String, AnchorError> {
        // Try primary provider first
        match self.primary_provider.upload_content(proposal).await {
            Ok(cid) => {
                info!(
                    "Anchored proposal to {} with CID: {}", 
                    self.primary_provider.name(), 
                    cid
                );
                Ok(cid)
            },
            Err(e) => {
                // If primary fails and fallback is available, try fallback
                if let Some(fallback) = &self.fallback_provider {
                    warn!(
                        "Primary storage ({}) failed: {}. Trying fallback...", 
                        self.primary_provider.name(), 
                        e
                    );
                    
                    match fallback.upload_content(proposal).await {
                        Ok(cid) => {
                            info!(
                                "Anchored proposal to fallback {} with CID: {}", 
                                fallback.name(), 
                                cid
                            );
                            Ok(cid)
                        },
                        Err(fallback_err) => {
                            error!(
                                "Both primary and fallback storage failed. Primary: {}, Fallback: {}", 
                                e, 
                                fallback_err
                            );
                            Err(AnchorError::UploadFailed(format!(
                                "All storage providers failed. Primary: {}, Fallback: {}", 
                                e, 
                                fallback_err
                            )))
                        }
                    }
                } else {
                    // No fallback available
                    Err(e)
                }
            }
        }
    }
    
    /// Retrieve proposal data from decentralized storage
    pub async fn retrieve_proposal<T>(&self, cid: &str) -> Result<ProvenanceEnvelope<T>, AnchorError> 
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        // Try primary provider first
        let result = self.primary_provider.retrieve_content(cid).await;
        
        let content = match result {
            Ok(content) => content,
            Err(e) => {
                // If primary fails and fallback is available, try fallback
                if let Some(fallback) = &self.fallback_provider {
                    warn!(
                        "Primary storage ({}) failed to retrieve {}: {}. Trying fallback...", 
                        self.primary_provider.name(), 
                        cid,
                        e
                    );
                    
                    match fallback.retrieve_content(cid).await {
                        Ok(content) => content,
                        Err(fallback_err) => {
                            error!(
                                "Both primary and fallback storage failed to retrieve {}. Primary: {}, Fallback: {}", 
                                cid,
                                e, 
                                fallback_err
                            );
                            return Err(AnchorError::RetrievalFailed(format!(
                                "All storage providers failed. Primary: {}, Fallback: {}", 
                                e, 
                                fallback_err
                            )));
                        }
                    }
                } else {
                    // No fallback available
                    return Err(e);
                }
            }
        };
        
        // Parse content as JSON
        serde_json::from_slice(&content)
            .map_err(|e| AnchorError::SerializationError(format!("Failed to deserialize content: {}", e)))
    }
    
    /// Check if storage is available
    pub async fn is_storage_available(&self) -> bool {
        self.primary_provider.is_available().await || 
            self.fallback_provider.as_ref().map_or(false, |p| p.is_available().await)
    }
} 