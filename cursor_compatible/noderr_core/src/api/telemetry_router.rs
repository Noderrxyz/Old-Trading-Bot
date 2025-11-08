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

use std::sync::Arc;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum::extract::ws::{WebSocket, WebSocketUpgrade};
use chrono::{DateTime, Utc};
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio::sync::RwLock;
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::telemetry::{TelemetryReporter, TelemetryPermissions, TelemetryRole, TelemetryLevel, TelemetryEvent, TelemetrySnapshot};
use crate::trust_buffer::{TrustBuffer, TimeRange, TrustStatistics};
use crate::api::auth::{AuthenticatedUser, extract_user, get_permissions_from_user};

pub struct TelemetryRouterState {
    telemetry: Arc<RwLock<TelemetryReporter>>,
    trust_buffer: Arc<TrustBuffer>,
}

#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    since: Option<DateTime<Utc>>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    level: Option<String>,
    entity_id: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct TrustScoreQuery {
    entity_type: Option<String>,
    strategy_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TrustHistoryQuery {
    entity_id: String,
    entity_type: String,
    range_type: String, // "LastHours", "LastDays", "All"
    range_value: Option<u32>, // Required for LastHours/LastDays
}

// Error handling
enum ApiError {
    Unauthorized,
    Forbidden,
    NotFound,
    InternalError(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Authentication required"),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "Insufficient permissions"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "Resource not found"),
            ApiError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.as_str()),
        };

        let body = Json(serde_json::json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}

impl From<crate::telemetry::TelemetryError> for ApiError {
    fn from(err: crate::telemetry::TelemetryError) -> Self {
        match err {
            crate::telemetry::TelemetryError::AccessDenied(_) => ApiError::Forbidden,
            _ => ApiError::InternalError(err.to_string()),
        }
    }
}

impl From<crate::trust_buffer::TrustBufferError> for ApiError {
    fn from(err: crate::trust_buffer::TrustBufferError) -> Self {
        match err {
            crate::trust_buffer::TrustBufferError::EntityNotFound(_) => ApiError::NotFound,
            _ => ApiError::InternalError(err.to_string()),
        }
    }
}

// Helper function to parse TelemetryLevel from string
fn parse_level(level_str: &str) -> Option<TelemetryLevel> {
    match level_str.to_lowercase().as_str() {
        "debug" => Some(TelemetryLevel::Debug),
        "info" => Some(TelemetryLevel::Info),
        "warning" => Some(TelemetryLevel::Warning),
        "error" => Some(TelemetryLevel::Error),
        "critical" => Some(TelemetryLevel::Critical),
        _ => None,
    }
}

// Helper function to parse TimeRange from query
fn parse_time_range(query: &TrustHistoryQuery) -> Result<TimeRange, ApiError> {
    match query.range_type.as_str() {
        "LastHours" => {
            let hours = query.range_value.ok_or_else(|| {
                ApiError::InternalError("range_value is required for LastHours".to_string())
            })?;
            Ok(TimeRange::LastHours(hours))
        },
        "LastDays" => {
            let days = query.range_value.ok_or_else(|| {
                ApiError::InternalError("range_value is required for LastDays".to_string())
            })?;
            Ok(TimeRange::LastDays(days))
        },
        "All" => Ok(TimeRange::All),
        _ => Err(ApiError::InternalError(format!("Invalid range_type: {}", query.range_type))),
    }
}

pub fn create_telemetry_router(
    telemetry: Arc<RwLock<TelemetryReporter>>,
    trust_buffer: Arc<TrustBuffer>,
) -> Router {
    let state = TelemetryRouterState {
        telemetry,
        trust_buffer,
    };

    Router::new()
        .route("/telemetry/metrics", get(get_metrics))
        .route("/telemetry/events", get(get_events))
        .route("/telemetry/trust-scores", get(get_trust_scores))
        .route("/telemetry/snapshot", get(get_snapshot))
        .route("/trust/history", get(get_trust_history))
        .route("/trust/entities", get(list_trust_entities))
        .route("/ws/telemetry", get(ws_telemetry_handler))
        .with_state(Arc::new(state))
}

// Get metrics with RBAC permissions
async fn get_metrics(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
    Query(query): Query<MetricsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    let telemetry = state.telemetry.read().await;
    let metrics = telemetry.get_metrics();
    
    // Filter metrics based on strategy permissions
    let filtered_metrics = metrics.into_iter()
        .filter(|(strategy_id, _)| {
            if strategy_id.is_empty() {
                // System metrics
                permissions.can_access_system_metrics
            } else {
                permissions.can_access_strategy(strategy_id)
            }
        })
        .collect::<std::collections::HashMap<_, _>>();
    
    Ok(Json(serde_json::json!({
        "metrics": filtered_metrics,
        "timestamp": Utc::now(),
    })))
}

// Get telemetry events with RBAC permissions
async fn get_events(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
    Query(query): Query<EventsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    let level = query.level.as_deref().and_then(parse_level);
    
    let telemetry = state.telemetry.read().await;
    let mut events = telemetry.get_events();
    
    // Filter by strategy if specified
    if let Some(strategy_id) = query.entity_id.as_deref() {
        if !permissions.can_access_strategy(strategy_id) {
            return Err(ApiError::Forbidden);
        }
        
        events = events.into_iter()
            .filter(|e| e.entity_id() == Some(strategy_id.to_string()))
            .collect();
    } else {
        // If no strategy specified, filter based on permissions
        events = events.into_iter()
            .filter(|e| match e.entity_id() {
                Some(id) => permissions.can_access_strategy(id),
                None => true, // System events
            })
            .collect();
    }
    
    // Filter by level if specified
    if let Some(level) = level {
        events = events.into_iter()
            .filter(|e| e.level() >= level)
            .collect();
    }
    
    // Apply pagination
    let limit = query.limit.unwrap_or(100);
    let offset = query.limit.unwrap_or(0);
    
    if offset < events.len() {
        let end = std::cmp::min(offset + limit, events.len());
        events = events[offset..end].to_vec();
    } else {
        events = vec![];
    }
    
    Ok(Json(serde_json::json!({
        "events": events,
        "count": events.len(),
        "timestamp": Utc::now(),
    })))
}

// Get trust scores with RBAC permissions
async fn get_trust_scores(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
    Query(query): Query<TrustScoreQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    let telemetry = state.telemetry.read().await;
    let trust_scores = telemetry.get_trust_scores();
    
    // Filter by entity_type or strategy_id if specified
    let filtered_scores: serde_json::Map<String, serde_json::Value> = if let Some(entity_type) = &query.entity_type {
        trust_scores.iter()
            .filter(|(id, _)| id.starts_with(&format!("{}:", entity_type)))
            .map(|(id, score)| (id.clone(), serde_json::json!(*score)))
            .collect()
    } else if let Some(strategy_id) = &query.strategy_id {
        trust_scores.iter()
            .filter(|(id, _)| id == &format!("strategy:{}", strategy_id))
            .map(|(id, score)| (id.clone(), serde_json::json!(*score)))
            .collect()
    } else {
        trust_scores.iter()
            .map(|(id, score)| (id.clone(), serde_json::json!(*score)))
            .collect()
    };
    
    Ok(Json(serde_json::json!({
        "trust_scores": filtered_scores,
        "count": filtered_scores.len(),
        "timestamp": Utc::now(),
    })))
}

// Get telemetry snapshot with RBAC permissions
async fn get_snapshot(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    let telemetry = state.telemetry.read().await;
    let mut snapshot = telemetry.get_snapshot();
    
    // Filter snapshot data based on permissions
    if !permissions.can_access_trust_scores {
        snapshot.trust_scores.clear();
    } else {
        snapshot.trust_scores.retain(|strategy_id, _| 
            permissions.can_access_strategy(strategy_id)
        );
    }
    
    if !permissions.can_access_events {
        snapshot.recent_events.clear();
    } else {
        snapshot.recent_events.retain(|event| 
            match event.entity_id() {
                Some(id) => permissions.can_access_strategy(id),
                None => permissions.can_access_system_metrics,
            }
        );
    }
    
    if !permissions.can_access_metrics {
        snapshot.metrics.clear();
    } else {
        snapshot.metrics.retain(|strategy_id, _| {
            if strategy_id.is_empty() {
                permissions.can_access_system_metrics
            } else {
                permissions.can_access_strategy(strategy_id)
            }
        });
    }
    
    Ok(Json(serde_json::to_value(snapshot).map_err(|e| ApiError::InternalError(e.to_string()))?))
}

// Get trust history for a specific entity
async fn get_trust_history(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
    Query(query): Query<TrustHistoryQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has permission to access this entity's trust data
    if !permissions.can_access_trust_scores {
        return Err(ApiError::Forbidden);
    }
    
    // For strategy owners, ensure they can only access their own strategies
    if permissions.roles.contains(&TelemetryRole::StrategyOwner) && 
       !permissions.strategy_ids.is_empty() && 
       query.entity_type == "strategy" && 
       !permissions.strategy_ids.contains(&query.entity_id) {
        return Err(ApiError::Forbidden);
    }
    
    let time_range = parse_time_range(&query)?;
    
    // Try to get statistics first
    let telemetry = state.telemetry.read().await;
    let statistics = telemetry.get_statistics(&query.entity_id, &query.entity_type, time_range)?;
    
    // Get the actual updates
    let updates = telemetry.get_updates(&query.entity_id, &query.entity_type, time_range)?;
    
    Ok(Json(serde_json::json!({
        "entity_id": query.entity_id,
        "entity_type": query.entity_type,
        "statistics": statistics,
        "updates": updates,
        "update_count": updates.len(),
        "timestamp": Utc::now(),
    })))
}

// List all entities in the trust buffer
async fn list_trust_entities(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has permission to access trust data
    if !permissions.can_access_trust_scores {
        return Err(ApiError::Forbidden);
    }
    
    let telemetry = state.telemetry.read().await;
    let entities = telemetry.list_entities();
    
    // Filter entities based on permissions
    let filtered_entities: Vec<(String, String)> = if !permissions.strategy_ids.is_empty() && 
        permissions.roles.contains(&TelemetryRole::StrategyOwner) {
        entities.into_iter()
            .filter(|(id, entity_type)| {
                entity_type != "strategy" || permissions.strategy_ids.contains(id)
            })
            .collect()
    } else {
        entities
    };
    
    Ok(Json(serde_json::json!({
        "entities": filtered_entities,
        "count": filtered_entities.len(),
        "timestamp": Utc::now(),
    })))
}

// WebSocket handler for real-time telemetry updates
async fn ws_telemetry_handler(
    State(state): State<TelemetryRouterState>,
    user: AuthenticatedUser,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws_connection(socket, state.clone(), user))
}

async fn handle_ws_connection(mut socket: WebSocket, state: Arc<TelemetryRouterState>, user: AuthenticatedUser) {
    let permissions = get_permissions_from_user(&user);
    
    // Subscribe to telemetry events
    let telemetry = state.telemetry.read().await;
    let mut telemetry_rx = telemetry.subscribe();
    
    // Subscribe to trust buffer updates if available
    let trust_buffer = state.trust_buffer;
    let trust_rx = trust_buffer.subscribe();
    
    // Channel for sending filtered events to the WebSocket
    let (tx, rx) = mpsc::channel(100);
    let mut rx_stream = ReceiverStream::new(rx);
    
    // Task to filter and forward telemetry events
    let telemetry_task = tokio::spawn(async move {
        while let Ok(event) = telemetry_rx.recv().await {
            // Filter events based on permissions
            if permissions.can_access_event(&event) {
                let event_json = serde_json::to_string(&event).unwrap_or_default();
                
                // Send the event to the WebSocket handler
                if tx.send(event_json).await.is_err() {
                    break;
                }
            }
        }
    });
    
    // Task to filter and forward trust buffer updates if available
    let trust_task = if let Some(mut trust_rx) = trust_rx {
        Some(tokio::spawn(async move {
            let tx = tx.clone();
            
            while let Ok(update) = trust_rx.recv().await {
                // Filter updates based on permissions
                if permissions.can_access_trust_scores {
                    if !permissions.strategy_ids.is_empty() &&
                       update.entity_type == "strategy" &&
                       !permissions.strategy_ids.contains(&update.entity_id) {
                        continue;
                    }
                    
                    let update_json = serde_json::to_string(&update).unwrap_or_default();
                    
                    // Send the update to the WebSocket handler
                    if tx.send(update_json).await.is_err() {
                        break;
                    }
                }
            }
        }))
    } else {
        None
    };
    
    // Send events to the WebSocket client
    while let Some(msg) = rx_stream.next().await {
        if socket.send(axum::extract::ws::Message::Text(msg)).await.is_err() {
            break;
        }
    }
    
    // Clean up when the WebSocket is closed
    telemetry_task.abort();
    if let Some(task) = trust_task {
        task.abort();
    }
} 