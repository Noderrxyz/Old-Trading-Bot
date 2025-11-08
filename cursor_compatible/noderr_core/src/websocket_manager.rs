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
use futures::{SinkExt, StreamExt};
use tokio::sync::{mpsc, RwLock, Mutex, broadcast};
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;
use uuid::Uuid;
use serde::{Serialize, Deserialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use redis::{Client, RedisResult, AsyncCommands, aio::ConnectionManager};

use crate::telemetry::TelemetryPermissions;
use crate::telemetry_streamer::{TelemetryMessage, TelemetryMessageType, RedisChannels, TelemetryStreamError};

/// Errors for WebSocket operations
#[derive(Debug, Error)]
pub enum WebSocketError {
    #[error("WebSocket connection error: {0}")]
    ConnectionError(String),
    
    #[error("Message send error: {0}")]
    SendError(String),
    
    #[error("Subscription error: {0}")]
    SubscriptionError(String),
    
    #[error("Redis error: {0}")]
    RedisError(#[from] redis::RedisError),
    
    #[error("JSON serialization error: {0}")]
    SerializationError(String),
    
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// WebSocket client subscription request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionRequest {
    /// Subscription action (subscribe or unsubscribe)
    pub action: SubscriptionAction,
    
    /// Strategy IDs to subscribe to
    pub strategy_ids: Vec<String>,
    
    /// Message types to subscribe to
    pub message_types: Vec<String>,
    
    /// Authentication token
    pub auth_token: Option<String>,
}

/// Subscription action types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SubscriptionAction {
    /// Subscribe to strategies/channels
    #[serde(rename = "subscribe")]
    Subscribe,
    
    /// Unsubscribe from strategies/channels
    #[serde(rename = "unsubscribe")]
    Unsubscribe,
    
    /// List current subscriptions
    #[serde(rename = "list")]
    List,
}

/// WebSocket subscription info for a client
#[derive(Debug, Clone)]
pub struct ClientSubscription {
    /// Client ID
    pub client_id: String,
    
    /// Subscribed strategies
    pub strategy_ids: HashSet<String>,
    
    /// Subscribed message types
    pub message_types: HashSet<TelemetryMessageType>,
    
    /// Last activity timestamp
    pub last_activity: Instant,
    
    /// User permissions
    pub permissions: TelemetryPermissions,
}

/// Message from a client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientMessage {
    /// Message type
    pub message_type: ClientMessageType,
    
    /// Message payload
    pub payload: serde_json::Value,
}

/// Types of messages from clients
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClientMessageType {
    /// Subscription management
    #[serde(rename = "subscription")]
    Subscription,
    
    /// Heartbeat/ping
    #[serde(rename = "ping")]
    Ping,
    
    /// Authentication
    #[serde(rename = "auth")]
    Auth,
}

/// WebSocket message to be sent to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketMessage {
    /// Message type
    pub message_type: String,
    
    /// Message source (strategy_id)
    pub source: String,
    
    /// Message timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    
    /// Message payload
    pub payload: serde_json::Value,
}

/// Manages WebSocket connections and message broadcasting
pub struct WebSocketManager {
    /// Client subscriptions by client ID
    clients: Arc<RwLock<HashMap<String, ClientSubscription>>>,
    
    /// Redis connection manager
    redis: Arc<Mutex<Option<ConnectionManager>>>,
    
    /// Redis connection string
    redis_url: String,
    
    /// Key prefix for Redis channels
    key_prefix: String,
    
    /// Message sender to broadcast to all clients
    broadcast_tx: broadcast::Sender<WebSocketMessage>,
    
    /// Active Redis PubSub task handles
    pubsub_handles: Arc<RwLock<Vec<JoinHandle<()>>>>,
    
    /// Channel for registering new clients
    client_register_tx: mpsc::Sender<(String, mpsc::Sender<WebSocketMessage>)>,
    
    /// Channel for unregistering clients
    client_unregister_tx: mpsc::Sender<String>,
}

impl WebSocketManager {
    /// Create a new WebSocket manager
    pub fn new(redis_url: String, key_prefix: String) -> Self {
        let (broadcast_tx, _) = broadcast::channel(1000); // Buffer for 1000 messages
        let (client_register_tx, client_register_rx) = mpsc::channel(100);
        let (client_unregister_tx, client_unregister_rx) = mpsc::channel(100);
        
        let manager = Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            redis: Arc::new(Mutex::new(None)),
            redis_url,
            key_prefix,
            broadcast_tx,
            pubsub_handles: Arc::new(RwLock::new(Vec::new())),
            client_register_tx,
            client_unregister_tx,
        };
        
        // Spawn the client manager task
        manager.spawn_client_manager(client_register_rx, client_unregister_rx);
        
        manager
    }
    
    /// Initialize the WebSocket manager
    pub async fn initialize(&self) -> Result<(), WebSocketError> {
        // Initialize Redis connection
        let client = Client::open(self.redis_url.clone())
            .map_err(|e| WebSocketError::RedisError(e))?;
        
        let connection = ConnectionManager::new(client)
            .await
            .map_err(|e| WebSocketError::RedisError(e))?;
        
        let mut redis_guard = self.redis.lock().await;
        *redis_guard = Some(connection);
        
        // Start the main Redis PubSub listener
        self.start_pubsub_listener().await?;
        
        info!("WebSocket manager initialized");
        Ok(())
    }
    
    /// Register a new client
    pub async fn register_client(
        &self,
        client_id: String,
        tx: mpsc::Sender<WebSocketMessage>,
        permissions: TelemetryPermissions,
    ) -> Result<(), WebSocketError> {
        // First, send the registration to the client manager
        self.client_register_tx.send((client_id.clone(), tx))
            .await
            .map_err(|e| WebSocketError::InternalError(format!("Failed to register client: {}", e)))?;
        
        // Then, add the client to our subscriptions with default empty subscriptions
        let subscription = ClientSubscription {
            client_id: client_id.clone(),
            strategy_ids: HashSet::new(),
            message_types: HashSet::new(),
            last_activity: Instant::now(),
            permissions,
        };
        
        let mut clients = self.clients.write().await;
        clients.insert(client_id, subscription);
        
        Ok(())
    }
    
    /// Unregister a client
    pub async fn unregister_client(&self, client_id: String) -> Result<(), WebSocketError> {
        // Remove from our subscriptions
        let mut clients = self.clients.write().await;
        clients.remove(&client_id);
        
        // Send unregistration to client manager
        self.client_unregister_tx.send(client_id)
            .await
            .map_err(|e| WebSocketError::InternalError(format!("Failed to unregister client: {}", e)))?;
        
        Ok(())
    }
    
    /// Update a client's subscriptions
    pub async fn update_client_subscription(
        &self,
        client_id: &str,
        action: SubscriptionAction,
        strategy_ids: Vec<String>,
        message_types: Vec<String>,
    ) -> Result<(), WebSocketError> {
        let mut clients = self.clients.write().await;
        
        let subscription = clients.get_mut(client_id)
            .ok_or_else(|| WebSocketError::SubscriptionError(format!("Client not found: {}", client_id)))?;
        
        // Update last activity time
        subscription.last_activity = Instant::now();
        
        // Convert message types from strings to enum
        let message_types: HashSet<TelemetryMessageType> = message_types.iter()
            .filter_map(|msg_type| match msg_type.as_str() {
                "trendline" => Some(TelemetryMessageType::Trendline),
                "performance_summary" => Some(TelemetryMessageType::PerformanceSummary),
                "execution_stats" => Some(TelemetryMessageType::ExecutionStats),
                "anomaly" => Some(TelemetryMessageType::AnomalyAlert),
                "trust_score" => Some(TelemetryMessageType::TrustScoreUpdate),
                "health_check" => Some(TelemetryMessageType::HealthCheck),
                _ => None,
            })
            .collect();
        
        // Filter strategy IDs based on permissions
        let allowed_strategies: Vec<String> = strategy_ids.into_iter()
            .filter(|id| subscription.permissions.can_access_strategy(id))
            .collect();
        
        match action {
            SubscriptionAction::Subscribe => {
                // Add new strategies
                for strategy_id in allowed_strategies {
                    subscription.strategy_ids.insert(strategy_id);
                }
                
                // Add new message types
                for msg_type in message_types {
                    subscription.message_types.insert(msg_type);
                }
            },
            SubscriptionAction::Unsubscribe => {
                // Remove strategies
                for strategy_id in allowed_strategies {
                    subscription.strategy_ids.remove(&strategy_id);
                }
                
                // Remove message types
                for msg_type in message_types {
                    subscription.message_types.remove(&msg_type);
                }
            },
            SubscriptionAction::List => {
                // Nothing to do here, just listing subscriptions
            },
        }
        
        Ok(())
    }
    
    /// Get current subscriptions for a client
    pub async fn get_client_subscriptions(&self, client_id: &str) -> Result<ClientSubscription, WebSocketError> {
        let clients = self.clients.read().await;
        clients.get(client_id)
            .cloned()
            .ok_or_else(|| WebSocketError::SubscriptionError(format!("Client not found: {}", client_id)))
    }
    
    /// Process a client message
    pub async fn process_client_message(
        &self,
        client_id: &str,
        message: &str,
    ) -> Result<Option<WebSocketMessage>, WebSocketError> {
        // Parse the client message
        let client_message: ClientMessage = serde_json::from_str(message)
            .map_err(|e| WebSocketError::SerializationError(format!("Invalid message format: {}", e)))?;
        
        match client_message.message_type {
            ClientMessageType::Subscription => {
                // Handle subscription message
                let subscription_request: SubscriptionRequest = serde_json::from_value(client_message.payload)
                    .map_err(|e| WebSocketError::SerializationError(format!("Invalid subscription request: {}", e)))?;
                
                // Update the subscription
                self.update_client_subscription(
                    client_id,
                    subscription_request.action.clone(),
                    subscription_request.strategy_ids,
                    subscription_request.message_types,
                ).await?;
                
                // If this is a list request, return the current subscriptions
                if subscription_request.action == SubscriptionAction::List {
                    let subscription = self.get_client_subscriptions(client_id).await?;
                    
                    // Convert to a message
                    let strategy_ids: Vec<String> = subscription.strategy_ids.iter().cloned().collect();
                    let message_types: Vec<String> = subscription.message_types.iter()
                        .map(|msg_type| match msg_type {
                            TelemetryMessageType::Trendline => "trendline",
                            TelemetryMessageType::PerformanceSummary => "performance_summary",
                            TelemetryMessageType::ExecutionStats => "execution_stats",
                            TelemetryMessageType::AnomalyAlert => "anomaly",
                            TelemetryMessageType::TrustScoreUpdate => "trust_score",
                            TelemetryMessageType::HealthCheck => "health_check",
                        }.to_string())
                        .collect();
                    
                    let response = WebSocketMessage {
                        message_type: "subscription_list".to_string(),
                        source: "system".to_string(),
                        timestamp: chrono::Utc::now(),
                        payload: serde_json::json!({
                            "strategy_ids": strategy_ids,
                            "message_types": message_types,
                        }),
                    };
                    
                    return Ok(Some(response));
                }
                
                // Return a confirmation message
                let response = WebSocketMessage {
                    message_type: "subscription_updated".to_string(),
                    source: "system".to_string(),
                    timestamp: chrono::Utc::now(),
                    payload: serde_json::json!({
                        "action": subscription_request.action,
                        "status": "success",
                    }),
                };
                
                Ok(Some(response))
            },
            ClientMessageType::Ping => {
                // Respond with a pong
                let response = WebSocketMessage {
                    message_type: "pong".to_string(),
                    source: "system".to_string(),
                    timestamp: chrono::Utc::now(),
                    payload: serde_json::json!({}),
                };
                
                Ok(Some(response))
            },
            ClientMessageType::Auth => {
                // Authentication would be handled elsewhere before this point
                // Just acknowledge receipt
                let response = WebSocketMessage {
                    message_type: "auth_acknowledged".to_string(),
                    source: "system".to_string(),
                    timestamp: chrono::Utc::now(),
                    payload: serde_json::json!({
                        "status": "success",
                    }),
                };
                
                Ok(Some(response))
            },
        }
    }
    
    /// Get a receiver for broadcast messages
    pub fn subscribe_to_broadcasts(&self) -> broadcast::Receiver<WebSocketMessage> {
        self.broadcast_tx.subscribe()
    }
    
    /// Start the Redis PubSub listener
    async fn start_pubsub_listener(&self) -> Result<(), WebSocketError> {
        // Create a clone of the broadcast sender
        let broadcast_tx = self.broadcast_tx.clone();
        let redis_url = self.redis_url.clone();
        let key_prefix = self.key_prefix.clone();
        
        // Create a client for pubsub
        let client = Client::open(redis_url.clone())
            .map_err(|e| WebSocketError::RedisError(e))?;
        
        // Clone what we need to pass to the task
        let handle = tokio::spawn(async move {
            info!("Starting Redis PubSub listener");
            
            // Create a pubsub connection
            let mut pubsub_conn = match client.get_async_connection().await {
                Ok(conn) => conn.into_pubsub(),
                Err(e) => {
                    error!("Failed to get Redis PubSub connection: {}", e);
                    return;
                }
            };
            
            // Subscribe to all channels with our prefix
            let pattern = format!("{}:channel:*", key_prefix);
            if let Err(e) = pubsub_conn.psubscribe(&pattern).await {
                error!("Failed to subscribe to Redis channels: {}", e);
                return;
            }
            
            info!("Subscribed to Redis channels with pattern: {}", pattern);
            
            // Listen for messages
            let mut pubsub_stream = pubsub_conn.on_message();
            while let Some(msg) = pubsub_stream.next().await {
                // Get the channel and payload
                let channel: String = match msg.get_channel_name() {
                    Ok(channel) => channel,
                    Err(e) => {
                        error!("Failed to get channel name: {}", e);
                        continue;
                    }
                };
                
                let payload: String = match msg.get_payload() {
                    Ok(payload) => payload,
                    Err(e) => {
                        error!("Failed to get message payload: {}", e);
                        continue;
                    }
                };
                
                // Deserialize the message
                let telemetry_message: serde_json::Value = match serde_json::from_str(&payload) {
                    Ok(message) => message,
                    Err(e) => {
                        error!("Failed to deserialize message: {}", e);
                        continue;
                    }
                };
                
                // Extract message type and strategy ID from the channel
                let channel_parts: Vec<&str> = channel.split(':').collect();
                if channel_parts.len() < 5 {
                    error!("Invalid channel format: {}", channel);
                    continue;
                }
                
                let strategy_id = channel_parts[3].to_string();
                let message_type = channel_parts[4].to_string();
                
                // Create a WebSocketMessage
                let websocket_message = WebSocketMessage {
                    message_type,
                    source: strategy_id,
                    timestamp: chrono::Utc::now(),
                    payload: telemetry_message,
                };
                
                // Broadcast the message
                if let Err(e) = broadcast_tx.send(websocket_message) {
                    error!("Failed to broadcast message: {}", e);
                }
            }
            
            info!("Redis PubSub listener ended");
        });
        
        // Store the handle
        let mut handles = self.pubsub_handles.write().await;
        handles.push(handle);
        
        Ok(())
    }
    
    /// Spawn the client manager task
    fn spawn_client_manager(
        &self,
        mut client_register_rx: mpsc::Receiver<(String, mpsc::Sender<WebSocketMessage>)>,
        mut client_unregister_rx: mpsc::Receiver<String>,
    ) {
        let broadcast_tx = self.broadcast_tx.clone();
        let clients = self.clients.clone();
        
        tokio::spawn(async move {
            // Map of client_id to message sender
            let mut client_senders: HashMap<String, mpsc::Sender<WebSocketMessage>> = HashMap::new();
            
            // Map of client_id to broadcast subscription task handle
            let mut client_tasks: HashMap<String, JoinHandle<()>> = HashMap::new();
            
            loop {
                tokio::select! {
                    // Handle new client registrations
                    Some((client_id, client_tx)) = client_register_rx.recv() => {
                        info!("Registering new WebSocket client: {}", client_id);
                        
                        // Store the sender
                        client_senders.insert(client_id.clone(), client_tx.clone());
                        
                        // Create a broadcast receiver
                        let mut broadcast_rx = broadcast_tx.subscribe();
                        
                        // Clone what we need for the task
                        let client_id_clone = client_id.clone();
                        let client_tx_clone = client_tx.clone();
                        let clients_clone = clients.clone();
                        
                        // Spawn a task to forward messages to this client
                        let handle = tokio::spawn(async move {
                            let mut stream = BroadcastStream::new(broadcast_rx);
                            
                            while let Some(Ok(message)) = stream.next().await {
                                // Check if client is still subscribed to this message type and strategy
                                let send_message = {
                                    let clients_guard = clients_clone.read().await;
                                    if let Some(subscription) = clients_guard.get(&client_id_clone) {
                                        // Check if client is subscribed to this strategy
                                        let subscribed_to_strategy = subscription.strategy_ids.is_empty() || 
                                                                     subscription.strategy_ids.contains(&message.source);
                                        
                                        // Parse message type
                                        let message_type = match message.message_type.as_str() {
                                            "trendline" => Some(TelemetryMessageType::Trendline),
                                            "performance_summary" => Some(TelemetryMessageType::PerformanceSummary),
                                            "execution_stats" => Some(TelemetryMessageType::ExecutionStats),
                                            "anomaly" => Some(TelemetryMessageType::AnomalyAlert),
                                            "trust_score" => Some(TelemetryMessageType::TrustScoreUpdate),
                                            "health_check" => Some(TelemetryMessageType::HealthCheck),
                                            _ => None,
                                        };
                                        
                                        // Check if client is subscribed to this message type
                                        let subscribed_to_message_type = message_type
                                            .map(|mt| subscription.message_types.is_empty() || subscription.message_types.contains(&mt))
                                            .unwrap_or(false);
                                        
                                        subscribed_to_strategy && subscribed_to_message_type
                                    } else {
                                        false
                                    }
                                };
                                
                                if send_message {
                                    if let Err(e) = client_tx_clone.send(message).await {
                                        error!("Failed to send message to client {}: {}", client_id_clone, e);
                                        break;
                                    }
                                }
                            }
                            
                            info!("Client {} message forwarding task ended", client_id_clone);
                        });
                        
                        client_tasks.insert(client_id, handle);
                    },
                    
                    // Handle client unregistrations
                    Some(client_id) = client_unregister_rx.recv() => {
                        info!("Unregistering WebSocket client: {}", client_id);
                        
                        // Remove the sender
                        client_senders.remove(&client_id);
                        
                        // Abort the task
                        if let Some(handle) = client_tasks.remove(&client_id) {
                            handle.abort();
                        }
                    },
                    
                    // No more clients to register or unregister
                    else => break,
                }
            }
            
            info!("WebSocket client manager task ended");
        });
    }
}

/// Create a new WebSocket manager
pub fn create_websocket_manager(redis_url: String, key_prefix: String) -> Arc<WebSocketManager> {
    Arc::new(WebSocketManager::new(redis_url, key_prefix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::TelemetryRole;
    
    // Create test permissions
    fn create_test_permissions() -> TelemetryPermissions {
        TelemetryPermissions {
            role: TelemetryRole::Viewer,
            can_access_metrics: true,
            can_access_events: true,
            can_access_trust_scores: true,
            can_access_trust_history: true,
            strategy_ids: vec!["test_strategy".to_string()],
            can_access_system_metrics: false,
            can_access_websocket: true,
        }
    }
    
    // Test creating client subscriptions
    #[tokio::test]
    async fn test_client_subscription() {
        let manager = WebSocketManager::new(
            "redis://127.0.0.1:6379".to_string(),
            "test:websocket".to_string(),
        );
        
        let (tx, _rx) = mpsc::channel(100);
        let client_id = Uuid::new_v4().to_string();
        let permissions = create_test_permissions();
        
        // Register the client
        let result = manager.register_client(client_id.clone(), tx, permissions).await;
        assert!(result.is_ok(), "Failed to register client: {:?}", result.err());
        
        // Update the subscription
        let result = manager.update_client_subscription(
            &client_id,
            SubscriptionAction::Subscribe,
            vec!["test_strategy".to_string()],
            vec!["trendline".to_string(), "anomaly".to_string()],
        ).await;
        assert!(result.is_ok(), "Failed to update subscription: {:?}", result.err());
        
        // Get the subscription
        let subscription = manager.get_client_subscriptions(&client_id).await;
        assert!(subscription.is_ok(), "Failed to get subscriptions: {:?}", subscription.err());
        
        let subscription = subscription.unwrap();
        assert!(subscription.strategy_ids.contains("test_strategy"));
        assert!(subscription.message_types.contains(&TelemetryMessageType::Trendline));
        assert!(subscription.message_types.contains(&TelemetryMessageType::AnomalyAlert));
    }
} 