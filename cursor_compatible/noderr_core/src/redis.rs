// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use redis::{Client, aio::ConnectionManager, AsyncCommands, RedisError, RedisResult};
use serde::{Serialize, Deserialize};
use thiserror::Error;
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info, warn};

/// Redis client configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConfig {
    /// Redis connection URL
    pub url: String,
    
    /// Optional key prefix for namespacing
    pub key_prefix: String,
    
    /// Connection timeout in seconds
    pub connection_timeout_sec: u64,
    
    /// Default TTL for cached items in seconds
    pub default_ttl_sec: u64,
    
    /// Maximum number of connections in the pool
    pub max_connections: usize,
    
    /// Whether to enable connection health checks
    pub enable_health_checks: bool,
    
    /// Health check interval in seconds
    pub health_check_interval_sec: u64,
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379".to_string(),
            key_prefix: "noderr".to_string(),
            connection_timeout_sec: 5,
            default_ttl_sec: 3600,
            max_connections: 10,
            enable_health_checks: true,
            health_check_interval_sec: 60,
        }
    }
}

/// Errors that can occur with Redis operations
#[derive(Debug, Error)]
pub enum RedisClientError {
    #[error("Redis error: {0}")]
    RedisError(#[from] RedisError),
    
    #[error("Connection error: {0}")]
    ConnectionError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Key not found: {0}")]
    KeyNotFound(String),
    
    #[error("Operation timeout")]
    Timeout,
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for Redis operations
pub type RedisClientResult<T> = Result<T, RedisClientError>;

/// Redis client interface
#[async_trait]
pub trait RedisClient: Send + Sync {
    /// Initialize the Redis connection
    async fn initialize(&self) -> RedisClientResult<()>;
    
    /// Get health status
    async fn health_check(&self) -> RedisClientResult<bool>;
    
    /// Get a value from Redis
    async fn get<T: for<'de> Deserialize<'de> + Send + Sync>(&self, key: &str) -> RedisClientResult<Option<T>>;
    
    /// Set a value in Redis with optional TTL
    async fn set<T: Serialize + Send + Sync>(&self, key: &str, value: &T, ttl_sec: Option<u64>) -> RedisClientResult<()>;
    
    /// Delete a key from Redis
    async fn delete(&self, key: &str) -> RedisClientResult<bool>;
    
    /// Increment a counter
    async fn increment(&self, key: &str, by: i64) -> RedisClientResult<i64>;
    
    /// Add a member to a set
    async fn add_to_set(&self, key: &str, member: &str) -> RedisClientResult<bool>;
    
    /// Get all members of a set
    async fn get_set_members(&self, key: &str) -> RedisClientResult<Vec<String>>;
    
    /// Publish a message to a channel
    async fn publish<T: Serialize + Send + Sync>(&self, channel: &str, message: &T) -> RedisClientResult<i64>;
    
    /// Execute a custom Redis command
    async fn execute_command<T, F>(&self, f: F) -> RedisClientResult<T>
    where
        T: redis::FromRedisValue,
        F: FnOnce(&mut ConnectionManager) -> RedisResult<T> + Send;
}

/// Default implementation of the Redis client
pub struct DefaultRedisClient {
    /// Redis configuration
    config: RedisConfig,
    
    /// Redis connection manager
    connection: Arc<RwLock<Option<ConnectionManager>>>,
    
    /// Last health check timestamp
    last_health_check: Arc<Mutex<Instant>>,
    
    /// Health status cache
    is_healthy: Arc<RwLock<bool>>,
}

impl DefaultRedisClient {
    /// Create a new DefaultRedisClient
    pub fn new(config: RedisConfig) -> Self {
        Self {
            config,
            connection: Arc::new(RwLock::new(None)),
            last_health_check: Arc::new(Mutex::new(Instant::now())),
            is_healthy: Arc::new(RwLock::new(false)),
        }
    }
    
    /// Generate a full Redis key with prefix
    fn full_key(&self, key: &str) -> String {
        if self.config.key_prefix.is_empty() {
            key.to_string()
        } else {
            format!("{}:{}", self.config.key_prefix, key)
        }
    }
    
    /// Start the health check loop
    async fn start_health_check_loop(&self) {
        if !self.config.enable_health_checks {
            return;
        }
        
        let client = self.clone();
        tokio::spawn(async move {
            let interval = Duration::from_secs(client.config.health_check_interval_sec);
            let mut interval_timer = tokio::time::interval(interval);
            
            loop {
                interval_timer.tick().await;
                
                match client.health_check().await {
                    Ok(is_healthy) => {
                        debug!("Redis health check: {}", if is_healthy { "OK" } else { "FAIL" });
                    }
                    Err(e) => {
                        error!("Redis health check error: {}", e);
                    }
                }
            }
        });
    }
}

impl Clone for DefaultRedisClient {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            connection: self.connection.clone(),
            last_health_check: self.last_health_check.clone(),
            is_healthy: self.is_healthy.clone(),
        }
    }
}

#[async_trait]
impl RedisClient for DefaultRedisClient {
    async fn initialize(&self) -> RedisClientResult<()> {
        // Create Redis client
        let client = Client::open(self.config.url.clone())
            .map_err(|e| RedisClientError::ConnectionError(e.to_string()))?;
        
        // Create connection manager
        let connection = ConnectionManager::new(client)
            .await
            .map_err(|e| RedisClientError::ConnectionError(e.to_string()))?;
        
        // Store connection
        let mut conn_guard = self.connection.write().await;
        *conn_guard = Some(connection);
        
        // Update health status
        let mut health_guard = self.is_healthy.write().await;
        *health_guard = true;
        
        // Start health check loop
        self.start_health_check_loop().await;
        
        info!("Redis client initialized with URL: {}", self.config.url);
        Ok(())
    }
    
    async fn health_check(&self) -> RedisClientResult<bool> {
        // Check if we should perform a new health check
        let now = Instant::now();
        let mut last_check = self.last_health_check.lock().await;
        
        // Only check if enough time has passed since last check
        if now.duration_since(*last_check).as_secs() < self.config.health_check_interval_sec {
            let is_healthy = *self.is_healthy.read().await;
            return Ok(is_healthy);
        }
        
        // Update last check time
        *last_check = now;
        
        // Execute PING command
        let result = self.execute_command(|conn| Box::pin(async move {
            let result: RedisResult<String> = conn.ping().await;
            result
        })).await;
        
        let is_healthy = match result {
            Ok(response) => response == "PONG",
            Err(_) => false,
        };
        
        // Update health status
        let mut health_guard = self.is_healthy.write().await;
        *health_guard = is_healthy;
        
        Ok(is_healthy)
    }
    
    async fn get<T: for<'de> Deserialize<'de> + Send + Sync>(&self, key: &str) -> RedisClientResult<Option<T>> {
        let full_key = self.full_key(key);
        
        let result: Option<String> = self.execute_command(|conn| {
            Box::pin(async move {
                let result: RedisResult<Option<String>> = conn.get(&full_key).await;
                result
            })
        }).await?;
        
        match result {
            Some(data) => {
                let value = serde_json::from_str(&data)
                    .map_err(|e| RedisClientError::SerializationError(e.to_string()))?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }
    
    async fn set<T: Serialize + Send + Sync>(&self, key: &str, value: &T, ttl_sec: Option<u64>) -> RedisClientResult<()> {
        let full_key = self.full_key(key);
        let data = serde_json::to_string(value)
            .map_err(|e| RedisClientError::SerializationError(e.to_string()))?;
        
        let ttl = ttl_sec.unwrap_or(self.config.default_ttl_sec);
        
        if ttl > 0 {
            self.execute_command(|conn| {
                Box::pin(async move {
                    let result: RedisResult<()> = conn.set_ex(&full_key, &data, ttl as usize).await;
                    result
                })
            }).await?;
        } else {
            self.execute_command(|conn| {
                Box::pin(async move {
                    let result: RedisResult<()> = conn.set(&full_key, &data).await;
                    result
                })
            }).await?;
        }
        
        debug!("Set Redis key: {}", full_key);
        Ok(())
    }
    
    async fn delete(&self, key: &str) -> RedisClientResult<bool> {
        let full_key = self.full_key(key);
        
        let result: i64 = self.execute_command(|conn| {
            Box::pin(async move {
                let result: RedisResult<i64> = conn.del(&full_key).await;
                result
            })
        }).await?;
        
        debug!("Deleted Redis key: {}", full_key);
        Ok(result > 0)
    }
    
    async fn increment(&self, key: &str, by: i64) -> RedisClientResult<i64> {
        let full_key = self.full_key(key);
        
        let result: i64 = self.execute_command(|conn| {
            Box::pin(async move {
                let result: RedisResult<i64> = conn.incr(&full_key, by).await;
                result
            })
        }).await?;
        
        debug!("Incremented Redis key: {} by {}", full_key, by);
        Ok(result)
    }
    
    async fn add_to_set(&self, key: &str, member: &str) -> RedisClientResult<bool> {
        let full_key = self.full_key(key);
        
        let result: i64 = self.execute_command(|conn| {
            Box::pin(async move {
                let result: RedisResult<i64> = conn.sadd(&full_key, member).await;
                result
            })
        }).await?;
        
        debug!("Added '{}' to Redis set: {}", member, full_key);
        Ok(result > 0)
    }
    
    async fn get_set_members(&self, key: &str) -> RedisClientResult<Vec<String>> {
        let full_key = self.full_key(key);
        
        let result: Vec<String> = self.execute_command(|conn| {
            Box::pin(async move {
                let result: RedisResult<Vec<String>> = conn.smembers(&full_key).await;
                result
            })
        }).await?;
        
        debug!("Got {} members from Redis set: {}", result.len(), full_key);
        Ok(result)
    }
    
    async fn publish<T: Serialize + Send + Sync>(&self, channel: &str, message: &T) -> RedisClientResult<i64> {
        let full_channel = self.full_key(channel);
        let data = serde_json::to_string(message)
            .map_err(|e| RedisClientError::SerializationError(e.to_string()))?;
        
        let result: i64 = self.execute_command(|conn| {
            Box::pin(async move {
                let result: RedisResult<i64> = conn.publish(&full_channel, &data).await;
                result
            })
        }).await?;
        
        debug!("Published message to Redis channel: {}", full_channel);
        Ok(result)
    }
    
    async fn execute_command<T, F>(&self, f: F) -> RedisClientResult<T>
    where
        T: redis::FromRedisValue,
        F: FnOnce(&mut ConnectionManager) -> RedisResult<T> + Send,
    {
        let conn_guard = self.connection.read().await;
        
        if let Some(ref conn) = *conn_guard {
            let mut conn_clone = conn.clone();
            
            // Execute with timeout
            let timeout = Duration::from_secs(self.config.connection_timeout_sec);
            
            match tokio::time::timeout(timeout, f(&mut conn_clone)).await {
                Ok(result) => result.map_err(RedisClientError::RedisError),
                Err(_) => Err(RedisClientError::Timeout),
            }
        } else {
            Err(RedisClientError::ConnectionError("Redis connection not initialized".to_string()))
        }
    }
}

/// A simple in-memory mock Redis client for testing
pub struct MockRedisClient {
    /// In-memory key-value store
    data: Arc<RwLock<HashMap<String, (String, Option<Instant>)>>>,
    
    /// In-memory sets
    sets: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    
    /// Redis configuration
    config: RedisConfig,
    
    /// Whether the mock client is healthy
    is_healthy: Arc<RwLock<bool>>,
    
    /// Published messages for testing
    published: Arc<RwLock<Vec<(String, String)>>>,
}

impl MockRedisClient {
    /// Create a new MockRedisClient
    pub fn new(config: RedisConfig) -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
            sets: Arc::new(RwLock::new(HashMap::new())),
            config,
            is_healthy: Arc::new(RwLock::new(true)),
            published: Arc::new(RwLock::new(Vec::new())),
        }
    }
    
    /// Get published messages for testing verification
    pub async fn get_published_messages(&self) -> Vec<(String, String)> {
        self.published.read().await.clone()
    }
    
    /// Set mock health status
    pub async fn set_health_status(&self, is_healthy: bool) {
        let mut health_guard = self.is_healthy.write().await;
        *health_guard = is_healthy;
    }
    
    /// Clear all data (for testing)
    pub async fn clear_all(&self) {
        let mut data_guard = self.data.write().await;
        data_guard.clear();
        
        let mut sets_guard = self.sets.write().await;
        sets_guard.clear();
        
        let mut published_guard = self.published.write().await;
        published_guard.clear();
    }
    
    /// Generate a full Redis key with prefix
    fn full_key(&self, key: &str) -> String {
        if self.config.key_prefix.is_empty() {
            key.to_string()
        } else {
            format!("{}:{}", self.config.key_prefix, key)
        }
    }
    
    /// Clean expired keys
    async fn clean_expired_keys(&self) {
        let now = Instant::now();
        let mut data_guard = self.data.write().await;
        
        data_guard.retain(|_, (_, expiry)| {
            match expiry {
                Some(expire_time) => now < *expire_time,
                None => true,
            }
        });
    }
}

impl Clone for MockRedisClient {
    fn clone(&self) -> Self {
        Self {
            data: self.data.clone(),
            sets: self.sets.clone(),
            config: self.config.clone(),
            is_healthy: self.is_healthy.clone(),
            published: self.published.clone(),
        }
    }
}

#[async_trait]
impl RedisClient for MockRedisClient {
    async fn initialize(&self) -> RedisClientResult<()> {
        // Nothing to initialize for mock
        Ok(())
    }
    
    async fn health_check(&self) -> RedisClientResult<bool> {
        let is_healthy = *self.is_healthy.read().await;
        Ok(is_healthy)
    }
    
    async fn get<T: for<'de> Deserialize<'de> + Send + Sync>(&self, key: &str) -> RedisClientResult<Option<T>> {
        self.clean_expired_keys().await;
        
        let full_key = self.full_key(key);
        let data_guard = self.data.read().await;
        
        if let Some((value, _)) = data_guard.get(&full_key) {
            let result = serde_json::from_str(value)
                .map_err(|e| RedisClientError::SerializationError(e.to_string()))?;
            Ok(Some(result))
        } else {
            Ok(None)
        }
    }
    
    async fn set<T: Serialize + Send + Sync>(&self, key: &str, value: &T, ttl_sec: Option<u64>) -> RedisClientResult<()> {
        let full_key = self.full_key(key);
        let data = serde_json::to_string(value)
            .map_err(|e| RedisClientError::SerializationError(e.to_string()))?;
        
        let ttl = ttl_sec.unwrap_or(self.config.default_ttl_sec);
        let expiry = if ttl > 0 {
            Some(Instant::now() + Duration::from_secs(ttl))
        } else {
            None
        };
        
        let mut data_guard = self.data.write().await;
        data_guard.insert(full_key, (data, expiry));
        
        Ok(())
    }
    
    async fn delete(&self, key: &str) -> RedisClientResult<bool> {
        let full_key = self.full_key(key);
        let mut data_guard = self.data.write().await;
        
        Ok(data_guard.remove(&full_key).is_some())
    }
    
    async fn increment(&self, key: &str, by: i64) -> RedisClientResult<i64> {
        let full_key = self.full_key(key);
        let mut data_guard = self.data.write().await;
        
        let entry = data_guard.entry(full_key).or_insert(("0".to_string(), None));
        
        let current: i64 = entry.0.parse().unwrap_or(0);
        let new_value = current + by;
        entry.0 = new_value.to_string();
        
        Ok(new_value)
    }
    
    async fn add_to_set(&self, key: &str, member: &str) -> RedisClientResult<bool> {
        let full_key = self.full_key(key);
        let mut sets_guard = self.sets.write().await;
        
        let set = sets_guard.entry(full_key).or_insert_with(HashSet::new);
        let was_inserted = set.insert(member.to_string());
        
        Ok(was_inserted)
    }
    
    async fn get_set_members(&self, key: &str) -> RedisClientResult<Vec<String>> {
        let full_key = self.full_key(key);
        let sets_guard = self.sets.read().await;
        
        if let Some(set) = sets_guard.get(&full_key) {
            Ok(set.iter().cloned().collect())
        } else {
            Ok(Vec::new())
        }
    }
    
    async fn publish<T: Serialize + Send + Sync>(&self, channel: &str, message: &T) -> RedisClientResult<i64> {
        let full_channel = self.full_key(channel);
        let data = serde_json::to_string(message)
            .map_err(|e| RedisClientError::SerializationError(e.to_string()))?;
        
        let mut published_guard = self.published.write().await;
        published_guard.push((full_channel, data));
        
        // Return the number of subscribers (always 1 in mock)
        Ok(1)
    }
    
    async fn execute_command<T, F>(&self, _f: F) -> RedisClientResult<T>
    where
        T: redis::FromRedisValue,
        F: FnOnce(&mut ConnectionManager) -> RedisResult<T> + Send,
    {
        Err(RedisClientError::Internal("Direct command execution not supported in mock client".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Serialize, Deserialize};
    use std::time::Duration;
    
    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    struct TestData {
        id: String,
        value: i32,
    }
    
    #[tokio::test]
    async fn test_mock_redis_basic_operations() {
        let config = RedisConfig {
            url: "redis://localhost:6379".to_string(),
            key_prefix: "test".to_string(),
            default_ttl_sec: 10,
            ..Default::default()
        };
        
        let client = MockRedisClient::new(config);
        
        // Test set and get
        let data = TestData {
            id: "test1".to_string(),
            value: 42,
        };
        
        client.set("key1", &data, None).await.unwrap();
        
        let retrieved: Option<TestData> = client.get("key1").await.unwrap();
        assert_eq!(retrieved, Some(data.clone()));
        
        // Test delete
        let deleted = client.delete("key1").await.unwrap();
        assert!(deleted);
        
        let retrieved: Option<TestData> = client.get("key1").await.unwrap();
        assert_eq!(retrieved, None);
        
        // Test increment
        let value = client.increment("counter", 5).await.unwrap();
        assert_eq!(value, 5);
        
        let value = client.increment("counter", 3).await.unwrap();
        assert_eq!(value, 8);
        
        // Test sets
        client.add_to_set("myset", "item1").await.unwrap();
        client.add_to_set("myset", "item2").await.unwrap();
        client.add_to_set("myset", "item1").await.unwrap(); // Duplicate
        
        let members = client.get_set_members("myset").await.unwrap();
        assert_eq!(members.len(), 2);
        assert!(members.contains(&"item1".to_string()));
        assert!(members.contains(&"item2".to_string()));
        
        // Test publish
        client.publish("channel1", &data).await.unwrap();
        
        let messages = client.get_published_messages().await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].0, "test:channel1");
    }
    
    #[tokio::test]
    async fn test_mock_redis_ttl() {
        let config = RedisConfig {
            url: "redis://localhost:6379".to_string(),
            key_prefix: "test".to_string(),
            default_ttl_sec: 1,
            ..Default::default()
        };
        
        let client = MockRedisClient::new(config);
        
        // Set with TTL
        let data = TestData {
            id: "test_ttl".to_string(),
            value: 100,
        };
        
        client.set("expire_key", &data, Some(1)).await.unwrap();
        
        // Should be there immediately
        let retrieved: Option<TestData> = client.get("expire_key").await.unwrap();
        assert_eq!(retrieved, Some(data.clone()));
        
        // Wait for expiration
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        // Should be gone now
        let retrieved: Option<TestData> = client.get("expire_key").await.unwrap();
        assert_eq!(retrieved, None);
    }
} 