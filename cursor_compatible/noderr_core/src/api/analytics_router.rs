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
use std::collections::HashSet;
use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Response, Json},
    routing::{get, post},
    Router,
};
use axum::extract::ws::{WebSocket, Message};
use futures::{SinkExt, StreamExt};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::analytics::{
    Analytics, AnalyticsFilter, AnalyticsError, TimePeriod, 
    TrendLine, PerformanceSummary, ExecutionStats, Anomaly
};
use crate::telemetry_streamer::{TelemetryStreamer, TelemetryStreamError};
use crate::websocket_manager::{WebSocketManager, WebSocketMessage, WebSocketError};
use crate::trust_score_engine::{TrustScoreEngine, TrustScoreError, TrustScore, TrustScoreHistory};
use crate::api::auth::{AuthenticatedUser, extract_user, get_permissions_from_user};
use crate::execution::ExecutionStatus;

/// Analytics API router state
pub struct AnalyticsRouterState {
    /// Analytics service
    analytics: Arc<dyn Analytics>,
    /// Telemetry streamer
    telemetry_streamer: Option<Arc<dyn TelemetryStreamer>>,
    /// WebSocket manager
    websocket_manager: Option<Arc<WebSocketManager>>,
    /// Trust score engine
    trust_score_engine: Option<Arc<dyn TrustScoreEngine>>,
}

/// Query parameters for analytics API
#[derive(Debug, Deserialize)]
pub struct AnalyticsQuery {
    /// Strategy ID to get data for
    pub strategy_id: String,
    /// Optional start time for time range
    pub start_time: Option<DateTime<Utc>>,
    /// Optional end time for time range
    pub end_time: Option<DateTime<Utc>>,
    /// Optional time period for trend data
    pub time_period: Option<String>,
    /// Optional filter by symbols
    pub symbols: Option<Vec<String>>,
    /// Optional filter by execution status
    pub statuses: Option<Vec<String>>,
    /// Optional filter for minimum confidence
    pub min_confidence: Option<f64>,
}

/// API errors
enum ApiError {
    Unauthorized,
    Forbidden,
    NotFound,
    BadRequest(String),
    InternalError(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Authentication required".to_string()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "Insufficient permissions".to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "Resource not found".to_string()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(serde_json::json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}

impl From<AnalyticsError> for ApiError {
    fn from(err: AnalyticsError) -> Self {
        match err {
            AnalyticsError::StorageError(msg) => ApiError::InternalError(format!("Storage error: {}", msg)),
            AnalyticsError::InsufficientData(msg) => ApiError::BadRequest(format!("Insufficient data: {}", msg)),
            AnalyticsError::InvalidParameter(msg) => ApiError::BadRequest(format!("Invalid parameter: {}", msg)),
        }
    }
}

impl From<TelemetryStreamError> for ApiError {
    fn from(err: TelemetryStreamError) -> Self {
        ApiError::InternalError(format!("Telemetry stream error: {}", err))
    }
}

impl From<WebSocketError> for ApiError {
    fn from(err: WebSocketError) -> Self {
        match err {
            WebSocketError::Unauthorized(_) => ApiError::Unauthorized,
            _ => ApiError::InternalError(format!("WebSocket error: {}", err)),
        }
    }
}

impl From<TrustScoreError> for ApiError {
    fn from(err: TrustScoreError) -> Self {
        match err {
            TrustScoreError::AnalyticsError(e) => ApiError::from(e),
            TrustScoreError::StrategyNotFound(id) => ApiError::NotFound,
            TrustScoreError::InsufficientData(msg) => ApiError::BadRequest(format!("Insufficient data: {}", msg)),
            TrustScoreError::RedisError(e) => ApiError::InternalError(format!("Redis error: {}", e)),
            TrustScoreError::TelemetryStreamError(e) => ApiError::InternalError(format!("Telemetry stream error: {}", e)),
            TrustScoreError::SerializationError(e) => ApiError::InternalError(format!("Serialization error: {}", e)),
            TrustScoreError::InternalError(e) => ApiError::InternalError(e),
        }
    }
}

/// Parse time period from string
fn parse_time_period(period: &str) -> Result<TimePeriod, ApiError> {
    match period.to_lowercase().as_str() {
        "hourly" => Ok(TimePeriod::Hourly),
        "daily" => Ok(TimePeriod::Daily),
        "weekly" => Ok(TimePeriod::Weekly),
        "monthly" => Ok(TimePeriod::Monthly),
        "quarterly" => Ok(TimePeriod::Quarterly),
        "yearly" => Ok(TimePeriod::Yearly),
        _ => Err(ApiError::BadRequest(format!("Invalid time period: {}", period))),
    }
}

/// Parse execution statuses from strings
fn parse_execution_statuses(statuses: &[String]) -> Result<HashSet<ExecutionStatus>, ApiError> {
    let mut result = HashSet::new();
    for status in statuses {
        let parsed = match status.to_lowercase().as_str() {
            "filled" => ExecutionStatus::Filled,
            "partially_filled" => ExecutionStatus::PartiallyFilled,
            "failed" => ExecutionStatus::Failed,
            "rejected" => ExecutionStatus::Rejected,
            "pending" => ExecutionStatus::Pending,
            _ => return Err(ApiError::BadRequest(format!("Invalid execution status: {}", status))),
        };
        result.insert(parsed);
    }
    Ok(result)
}

/// Create analytics API router
pub fn create_analytics_router(
    analytics: Arc<dyn Analytics>,
    telemetry_streamer: Option<Arc<dyn TelemetryStreamer>>,
    websocket_manager: Option<Arc<WebSocketManager>>,
    trust_score_engine: Option<Arc<dyn TrustScoreEngine>>,
) -> Router {
    let state = Arc::new(AnalyticsRouterState {
        analytics,
        telemetry_streamer,
        websocket_manager,
        trust_score_engine,
    });

    Router::new()
        .route("/analytics/summary", get(get_performance_summary))
        .route("/analytics/execution-stats", get(get_execution_stats))
        .route("/analytics/trendline", get(get_pnl_trendline))
        .route("/analytics/anomalies", get(get_anomalies))
        .route("/analytics/scan-anomalies", post(trigger_anomaly_scan))
        .route("/analytics/trust-score", get(get_trust_score))
        .route("/analytics/trust-history", get(get_trust_history))
        .route("/analytics/update-trust-score", post(update_trust_score))
        .route("/analytics/ws", get(websocket_handler))
        .with_state(state)
}

/// Get performance summary for a strategy
async fn get_performance_summary(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<PerformanceSummary>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Create time range if provided
    let time_range = if query.start_time.is_some() || query.end_time.is_some() {
        let start = query.start_time.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
        let end = query.end_time.unwrap_or_else(Utc::now);
        Some((start, end))
    } else {
        None
    };
    
    // Create filter if needed
    let filter = if query.symbols.is_some() || query.statuses.is_some() || query.min_confidence.is_some() {
        let mut analytics_filter = AnalyticsFilter {
            symbols: query.symbols.map(|s| s.into_iter().collect()),
            directions: None,
            execution_statuses: query.statuses
                .map(|statuses| parse_execution_statuses(&statuses))
                .transpose()?,
            only_successful: None,
            min_confidence: query.min_confidence,
        };
        Some(analytics_filter)
    } else {
        None
    };
    
    // Get performance summary
    let summary = state.analytics.get_performance_summary(
        &query.strategy_id, 
        time_range, 
        filter.as_ref()
    ).await?;
    
    // If telemetry streamer is available, publish the summary
    if let Some(streamer) = &state.telemetry_streamer {
        if let Err(e) = streamer.publish_performance_summary(&query.strategy_id, summary.clone()).await {
            warn!("Failed to publish performance summary: {}", e);
        }
    }
    
    Ok(Json(summary))
}

/// Get execution statistics for a strategy
async fn get_execution_stats(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<ExecutionStats>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Create time range if provided
    let time_range = if query.start_time.is_some() || query.end_time.is_some() {
        let start = query.start_time.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
        let end = query.end_time.unwrap_or_else(Utc::now);
        Some((start, end))
    } else {
        None
    };
    
    // Get execution stats
    let stats = state.analytics.get_execution_stats(
        &query.strategy_id, 
        time_range
    ).await?;
    
    // If telemetry streamer is available, publish the stats
    if let Some(streamer) = &state.telemetry_streamer {
        if let Err(e) = streamer.publish_execution_stats(&query.strategy_id, stats.clone()).await {
            warn!("Failed to publish execution stats: {}", e);
        }
    }
    
    Ok(Json(stats))
}

/// Get PnL trend line for a strategy
async fn get_pnl_trendline(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<TrendLine>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Get time period or use default
    let time_period = match &query.time_period {
        Some(period) => parse_time_period(period)?,
        None => TimePeriod::Daily,
    };
    
    // Create time range if provided
    let time_range = if query.start_time.is_some() || query.end_time.is_some() {
        let start = query.start_time.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
        let end = query.end_time.unwrap_or_else(Utc::now);
        Some((start, end))
    } else {
        None
    };
    
    // Create filter if needed
    let filter = if query.symbols.is_some() || query.statuses.is_some() || query.min_confidence.is_some() {
        let mut analytics_filter = AnalyticsFilter {
            symbols: query.symbols.map(|s| s.into_iter().collect()),
            directions: None,
            execution_statuses: query.statuses
                .map(|statuses| parse_execution_statuses(&statuses))
                .transpose()?,
            only_successful: None,
            min_confidence: query.min_confidence,
        };
        Some(analytics_filter)
    } else {
        None
    };
    
    // Get PnL trendline
    let trendline = state.analytics.get_pnl_over_time(
        &query.strategy_id, 
        time_period,
        time_range, 
        filter.as_ref()
    ).await?;
    
    // If telemetry streamer is available, publish the trendline
    if let Some(streamer) = &state.telemetry_streamer {
        if let Err(e) = streamer.publish_trendline(&query.strategy_id, trendline.clone()).await {
            warn!("Failed to publish trendline: {}", e);
        }
    }
    
    Ok(Json(trendline))
}

/// Get anomalies for a strategy
async fn get_anomalies(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<Vec<Anomaly>>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Create time range if provided
    let time_range = if query.start_time.is_some() || query.end_time.is_some() {
        let start = query.start_time.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
        let end = query.end_time.unwrap_or_else(Utc::now);
        Some((start, end))
    } else {
        None
    };
    
    // Get anomalies
    let anomalies = state.analytics.detect_anomalies(
        &query.strategy_id, 
        time_range
    ).await?;
    
    Ok(Json(anomalies))
}

/// Request payload for anomaly scan
#[derive(Debug, Deserialize)]
pub struct AnomalyScanRequest {
    /// Strategy ID to scan for anomalies
    pub strategy_id: String,
    /// Optional start time for time range
    pub start_time: Option<DateTime<Utc>>,
    /// Optional end time for time range
    pub end_time: Option<DateTime<Utc>>,
}

/// Trigger an anomaly scan for a strategy
async fn trigger_anomaly_scan(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Json(request): Json<AnomalyScanRequest>,
) -> Result<Json<Vec<Anomaly>>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&request.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Create time range if provided
    let time_range = if request.start_time.is_some() || request.end_time.is_some() {
        let start = request.start_time.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
        let end = request.end_time.unwrap_or_else(Utc::now);
        Some((start, end))
    } else {
        None
    };
    
    // Detect anomalies
    let anomalies = state.analytics.detect_anomalies(
        &request.strategy_id, 
        time_range
    ).await?;
    
    // If telemetry streamer is available, publish each anomaly
    if let Some(streamer) = &state.telemetry_streamer {
        for anomaly in &anomalies {
            if let Err(e) = streamer.publish_anomaly(&request.strategy_id, anomaly.clone()).await {
                warn!("Failed to publish anomaly: {}", e);
            }
        }
    }
    
    Ok(Json(anomalies))
}

/// Handler for WebSocket connections
async fn websocket_handler(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has WebSocket access
    if !permissions.can_access_websocket {
        return (StatusCode::FORBIDDEN, "WebSocket access denied").into_response();
    }
    
    // Check if WebSocket manager is available
    let websocket_manager = match &state.websocket_manager {
        Some(manager) => manager.clone(),
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE, "WebSocket service not available").into_response();
        }
    };
    
    // Generate a client ID
    let client_id = Uuid::new_v4().to_string();
    
    ws.on_upgrade(move |socket| handle_socket(socket, websocket_manager, client_id, permissions))
}

/// Handle WebSocket connection
async fn handle_socket(
    socket: WebSocket,
    websocket_manager: Arc<WebSocketManager>,
    client_id: String,
    permissions: crate::telemetry::TelemetryPermissions,
) {
    // Create channel for messages to client
    let (client_tx, mut client_rx) = mpsc::channel(100);
    
    // Register the client with the WebSocket manager
    if let Err(e) = websocket_manager.register_client(client_id.clone(), client_tx, permissions).await {
        error!("Failed to register WebSocket client: {}", e);
        return;
    }
    
    info!("WebSocket client connected: {}", client_id);
    
    // Split the socket
    let (mut socket_tx, mut socket_rx) = socket.split();
    
    // Task to forward messages from client_rx to socket_tx
    let client_to_socket = tokio::spawn(async move {
        while let Some(message) = client_rx.recv().await {
            // Serialize the message
            if let Ok(json) = serde_json::to_string(&message) {
                if let Err(e) = socket_tx.send(Message::Text(json)).await {
                    error!("Error sending WebSocket message: {}", e);
                    break;
                }
            }
        }
    });
    
    // Task to handle messages from socket_rx
    let socket_to_client = tokio::spawn(async move {
        while let Some(Ok(message)) = socket_rx.next().await {
            match message {
                Message::Text(text) => {
                    // Process the message
                    match websocket_manager.process_client_message(&client_id, &text).await {
                        Ok(Some(response)) => {
                            // If there's a response, serialize and send it back via client_rx
                            if let Ok(json) = serde_json::to_string(&response) {
                                if socket_tx.send(Message::Text(json)).await.is_err() {
                                    break;
                                }
                            }
                        },
                        Ok(None) => {
                            // No response needed
                        },
                        Err(e) => {
                            error!("Error processing WebSocket message: {}", e);
                            // Send error response
                            let error_msg = WebSocketMessage {
                                message_type: "error".to_string(),
                                source: "system".to_string(),
                                timestamp: Utc::now(),
                                payload: serde_json::json!({
                                    "error": format!("Error processing message: {}", e),
                                }),
                            };
                            
                            if let Ok(json) = serde_json::to_string(&error_msg) {
                                if socket_tx.send(Message::Text(json)).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                },
                Message::Close(_) => {
                    break;
                },
                _ => {
                    // Ignore other message types
                }
            }
        }
        
        // Unregister the client when done
        if let Err(e) = websocket_manager.unregister_client(client_id.clone()).await {
            error!("Failed to unregister WebSocket client: {}", e);
        }
        
        info!("WebSocket client disconnected: {}", client_id);
    });
    
    // Wait for either task to complete
    tokio::select! {
        _ = client_to_socket => socket_to_client.abort(),
        _ = socket_to_client => client_to_socket.abort(),
    }
}

/// Get trust score for a strategy
async fn get_trust_score(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<TrustScore>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Check if trust score engine is available
    let trust_engine = match &state.trust_score_engine {
        Some(engine) => engine,
        None => return Err(ApiError::InternalError("Trust score engine not available".to_string())),
    };
    
    // Get trust score
    let trust_score = trust_engine.get_trust_score(&query.strategy_id).await?;
    
    Ok(Json(trust_score))
}

/// Get trust history for a strategy
async fn get_trust_history(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<TrustScoreHistory>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Check if trust score engine is available
    let trust_engine = match &state.trust_score_engine {
        Some(engine) => engine,
        None => return Err(ApiError::InternalError("Trust score engine not available".to_string())),
    };
    
    // Get trust history
    let history = trust_engine.get_trust_history(&query.strategy_id).await?;
    
    Ok(Json(history))
}

/// Update trust score for a strategy
async fn update_trust_score(
    State(state): State<Arc<AnalyticsRouterState>>,
    user: AuthenticatedUser,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<TrustScore>, ApiError> {
    let permissions = get_permissions_from_user(&user);
    
    // Check if user has access to the strategy
    if !permissions.can_access_strategy(&query.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Check if trust score engine is available
    let trust_engine = match &state.trust_score_engine {
        Some(engine) => engine,
        None => return Err(ApiError::InternalError("Trust score engine not available".to_string())),
    };
    
    // Update and publish trust score
    let trust_score = trust_engine.update_and_publish(&query.strategy_id).await?;
    
    Ok(Json(trust_score))
} 