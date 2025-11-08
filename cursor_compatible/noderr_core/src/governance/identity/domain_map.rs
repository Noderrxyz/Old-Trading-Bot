// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use serde::{Serialize, Deserialize};

use crate::governance::identity::types::{DIDMethod};
use crate::redis::RedisClient;

/// Error types for DID mapping operations
#[derive(Debug, thiserror::Error)]
pub enum DIDMapError {
    #[error("Invalid DID format: {0}")]
    InvalidDID(String),
    
    #[error("Storage error: {0}")]
    StorageError(String),
    
    #[error("No mapping found for DID: {0}")]
    NoMappingFound(String),
    
    #[error("Unsupported DID method: {0}")]
    UnsupportedMethod(String),
}

/// A cross-domain DID mapping entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DIDMapping {
    /// Primary DID
    pub primary_did: String,
    /// Linked DIDs for different domains
    pub linked_dids: HashMap<String, String>,
    /// Verification status for each linked DID
    pub verification_status: HashMap<String, bool>,
    /// When the mapping was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// When the mapping was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl DIDMapping {
    /// Create a new DID mapping with a primary DID
    pub fn new(primary_did: String) -> Self {
        let now = chrono::Utc::now();
        Self {
            primary_did,
            linked_dids: HashMap::new(),
            verification_status: HashMap::new(),
            created_at: now,
            updated_at: now,
        }
    }
    
    /// Add a linked DID for a specific domain
    pub fn add_linked_did(&mut self, domain: String, did: String, verified: bool) {
        self.linked_dids.insert(domain.clone(), did.clone());
        self.verification_status.insert(domain, verified);
        self.updated_at = chrono::Utc::now();
    }
    
    /// Get all linked DIDs as a vector
    pub fn get_all_dids(&self) -> Vec<String> {
        let mut result = vec![self.primary_did.clone()];
        result.extend(self.linked_dids.values().cloned());
        result
    }
    
    /// Get a linked DID for a specific domain
    pub fn get_domain_did(&self, domain: &str) -> Option<&String> {
        self.linked_dids.get(domain)
    }
    
    /// Check if a DID mapping contains a specific DID
    pub fn contains_did(&self, did: &str) -> bool {
        if self.primary_did == did {
            return true;
        }
        self.linked_dids.values().any(|d| d == did)
    }
}

/// Service for managing cross-domain DID mappings
pub struct DIDMappingService {
    redis: Arc<RedisClient>,
    cache: Arc<RwLock<HashMap<String, DIDMapping>>>,
}

impl DIDMappingService {
    /// Create a new DID mapping service
    pub fn new(redis: Arc<RedisClient>) -> Self {
        Self {
            redis,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Get linked identities for a DID
    pub async fn get_linked_identities(&self, did: &str) -> Result<Vec<String>, DIDMapError> {
        // Check cache first
        {
            let cache = self.cache.read().unwrap();
            for mapping in cache.values() {
                if mapping.contains_did(did) {
                    return Ok(mapping.get_all_dids());
                }
            }
        }
        
        // If not in cache, check Redis
        let key = format!("did:mapping:{}", did);
        match self.redis.get::<String>(&key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<DIDMapping>(&json) {
                    Ok(mapping) => {
                        // Update cache
                        let mut cache = self.cache.write().unwrap();
                        cache.insert(mapping.primary_did.clone(), mapping.clone());
                        Ok(mapping.get_all_dids())
                    },
                    Err(e) => Err(DIDMapError::StorageError(format!("Failed to deserialize mapping: {}", e))),
                }
            },
            Ok(None) => {
                // Try fallback mappings based on DID method
                let method = DIDMethod::from_did(did)
                    .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
                
                let fallbacks = match method {
                    DIDMethod::Ethereum => {
                        // Generate Cosmos, Key DIDs based on Ethereum address
                        let eth_address = did.strip_prefix("did:ethr:")
                            .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
                        
                        vec![
                            format!("did:cosmos:{}", eth_address),
                            format!("did:key:{}", eth_address),
                        ]
                    },
                    DIDMethod::Cosmos => {
                        // Generate Ethereum, Key DIDs based on Cosmos address
                        let cosmos_address = did.strip_prefix("did:cosmos:")
                            .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
                        
                        vec![
                            format!("did:ethr:{}", cosmos_address),
                            format!("did:key:{}", cosmos_address),
                        ]
                    },
                    _ => vec![],
                };
                
                if fallbacks.is_empty() {
                    Err(DIDMapError::NoMappingFound(did.to_string()))
                } else {
                    // Create a new mapping with the fallbacks
                    let mut mapping = DIDMapping::new(did.to_string());
                    for (i, fallback) in fallbacks.iter().enumerate() {
                        let domain = match i {
                            0 => "cosmos".to_string(),
                            1 => "key".to_string(),
                            _ => format!("domain_{}", i),
                        };
                        mapping.add_linked_did(domain, fallback.clone(), false);
                    }
                    
                    // Save the mapping for future use
                    self.save_mapping(&mapping).await?;
                    
                    // Return all DIDs
                    Ok(mapping.get_all_dids())
                }
            },
            Err(e) => Err(DIDMapError::StorageError(format!("Redis error: {}", e))),
        }
    }
    
    /// Create or update a DID mapping
    pub async fn set_linked_identity(
        &self, 
        primary_did: &str, 
        domain: &str, 
        linked_did: &str,
        verified: bool,
    ) -> Result<DIDMapping, DIDMapError> {
        // Check if mapping exists
        let mut mapping = match self.get_mapping(primary_did).await {
            Ok(m) => m,
            Err(DIDMapError::NoMappingFound(_)) => {
                // Create new mapping
                DIDMapping::new(primary_did.to_string())
            },
            Err(e) => return Err(e),
        };
        
        // Update mapping
        mapping.add_linked_did(domain.to_string(), linked_did.to_string(), verified);
        
        // Save mapping
        self.save_mapping(&mapping).await?;
        
        Ok(mapping)
    }
    
    /// Get a DID mapping by primary DID
    pub async fn get_mapping(&self, primary_did: &str) -> Result<DIDMapping, DIDMapError> {
        // Check cache first
        {
            let cache = self.cache.read().unwrap();
            if let Some(mapping) = cache.get(primary_did) {
                return Ok(mapping.clone());
            }
        }
        
        // If not in cache, check Redis
        let key = format!("did:mapping:{}", primary_did);
        match self.redis.get::<String>(&key).await {
            Ok(Some(json)) => {
                match serde_json::from_str::<DIDMapping>(&json) {
                    Ok(mapping) => {
                        // Update cache
                        let mut cache = self.cache.write().unwrap();
                        cache.insert(mapping.primary_did.clone(), mapping.clone());
                        Ok(mapping)
                    },
                    Err(e) => Err(DIDMapError::StorageError(format!("Failed to deserialize mapping: {}", e))),
                }
            },
            Ok(None) => Err(DIDMapError::NoMappingFound(primary_did.to_string())),
            Err(e) => Err(DIDMapError::StorageError(format!("Redis error: {}", e))),
        }
    }
    
    /// Save a DID mapping to storage
    async fn save_mapping(&self, mapping: &DIDMapping) -> Result<(), DIDMapError> {
        let key = format!("did:mapping:{}", mapping.primary_did);
        let json = serde_json::to_string(mapping)
            .map_err(|e| DIDMapError::StorageError(format!("Failed to serialize mapping: {}", e)))?;
        
        self.redis.set(&key, &json).await
            .map_err(|e| DIDMapError::StorageError(format!("Failed to store mapping: {}", e)))?;
        
        // Update cache
        let mut cache = self.cache.write().unwrap();
        cache.insert(mapping.primary_did.clone(), mapping.clone());
        
        // Also create indexes for each linked DID
        for linked_did in mapping.linked_dids.values() {
            let index_key = format!("did:index:{}", linked_did);
            self.redis.set(&index_key, &mapping.primary_did).await
                .map_err(|e| DIDMapError::StorageError(format!("Failed to create index: {}", e)))?;
        }
        
        Ok(())
    }
    
    /// Generate default mapping for a DID based on its method
    pub fn generate_default_mapping(&self, did: &str) -> Result<DIDMapping, DIDMapError> {
        let method = DIDMethod::from_did(did)
            .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
        
        let mut mapping = DIDMapping::new(did.to_string());
        
        match method {
            DIDMethod::Ethereum => {
                // Extract Ethereum address
                let eth_address = did.strip_prefix("did:ethr:")
                    .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
                
                // Create mapped DIDs
                mapping.add_linked_did("cosmos".to_string(), format!("did:cosmos:{}", eth_address), false);
                mapping.add_linked_did("key".to_string(), format!("did:key:{}", eth_address), false);
            },
            DIDMethod::Cosmos => {
                // Extract Cosmos address
                let cosmos_address = did.strip_prefix("did:cosmos:")
                    .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
                
                // Create mapped DIDs
                mapping.add_linked_did("ethereum".to_string(), format!("did:ethr:{}", cosmos_address), false);
                mapping.add_linked_did("key".to_string(), format!("did:key:{}", cosmos_address), false);
            },
            DIDMethod::Key => {
                // Extract key
                let key_part = did.strip_prefix("did:key:")
                    .ok_or_else(|| DIDMapError::InvalidDID(did.to_string()))?;
                
                // Create mapped DIDs
                mapping.add_linked_did("ethereum".to_string(), format!("did:ethr:{}", key_part), false);
                mapping.add_linked_did("cosmos".to_string(), format!("did:cosmos:{}", key_part), false);
            },
            _ => {
                // No default mappings for other methods
            }
        }
        
        Ok(mapping)
    }
} 