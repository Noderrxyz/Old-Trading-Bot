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
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, error, info};

use crate::strategy::StrategyId;
use crate::telemetry::{TelemetryPermissions, TelemetryLevel};
use crate::storage::{StrategyStorage, TimeRange, StoredExecution};
use crate::api::auth::{AuthenticatedUser, extract_user, get_permissions_from_user};

// Router state
pub struct StorageRouterState {
    storage: Arc<dyn StrategyStorage>,
}

// Query parameters for execution history
#[derive(Debug, Deserialize)]
pub struct ExecutionQuery {
    strategy_id: Option<String>,
    symbol: Option<String>,
    start_time: Option<DateTime<Utc>>,
    end_time: Option<DateTime<Utc>>,
    limit: Option<usize>,
}

// Query parameters for telemetry events
#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    strategy_id: Option<String>,
    level: Option<String>,
    hours: Option<u32>,
    days: Option<u32>,
    limit: Option<usize>,
}

// Query parameters for performance history
#[derive(Debug, Deserialize)]
pub struct PerformanceQuery {
    strategy_id: String,
    interval: Option<String>,
    hours: Option<u32>,
    days: Option<u32>,
}

// Helper function to parse level from string
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
fn parse_time_range(query: &ExecutionQuery) -> TimeRange {
    if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
        TimeRange::Custom { start, end }
    } else if let Some(hours) = query.hours {
        TimeRange::LastHours(hours)
    } else if let Some(days) = query.days {
        TimeRange::LastDays(days)
    } else {
        // Default to last 24 hours
        TimeRange::LastHours(24)
    }
}

// Error handling
enum ApiError {
    NotFound,
    BadRequest(String),
    Unauthorized,
    Forbidden,
    InternalError(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, "Resource not found"),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.as_str()),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Authentication required"),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "Insufficient permissions"),
            ApiError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.as_str()),
        };

        let body = Json(serde_json::json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}

// Create the storage router
pub fn create_storage_router(storage: Arc<dyn StrategyStorage>) -> Router {
    let state = StorageRouterState { storage };

    Router::new()
        .route("/storage/executions", get(get_executions))
        .route("/storage/executions/:id", get(get_execution_by_id))
        .route("/storage/events", get(get_telemetry_events))
        .route("/storage/performance", get(get_performance))
        .route("/storage/performance/:strategy_id", get(get_performance_by_strategy))
        .with_state(Arc::new(state))
}

// Handler to get execution history
async fn get_executions(
    State(state): State<Arc<StorageRouterState>>,
    user: Option<AuthenticatedUser>,
    Query(query): Query<ExecutionQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = user.map(|u| get_permissions_from_user(&u)).unwrap_or_default();
    
    // Get the strategy ID
    let strategy_id = match query.strategy_id {
        Some(ref id) if !id.is_empty() => {
            // Check if user has permission to access this strategy
            if !permissions.can_access_strategy(id) {
                return Err(ApiError::Forbidden);
            }
            Some(id.clone())
        },
        _ => None,
    };
    
    // Parse time range
    let time_range = parse_time_range(&query);
    
    // Query executions
    let executions = if let Some(strategy_id) = strategy_id {
        state.storage.query_executions_by_strategy(
            &strategy_id,
            time_range,
            query.limit,
        ).await.map_err(|e| ApiError::InternalError(e.to_string()))?
    } else {
        // If no strategy ID, return an empty list (or could query all strategies the user has access to)
        Vec::new()
    };
    
    Ok(Json(serde_json::json!({
        "executions": executions,
        "count": executions.len(),
        "timestamp": Utc::now(),
    })))
}

// Handler to get a specific execution by ID
async fn get_execution_by_id(
    State(state): State<Arc<StorageRouterState>>,
    user: Option<AuthenticatedUser>,
    Path(execution_id): Path<String>,
) -> Result<Json<StoredExecution>, ApiError> {
    let permissions = user.map(|u| get_permissions_from_user(&u)).unwrap_or_default();
    
    // Get the execution
    let execution = state.storage.get_execution(&execution_id).await
        .map_err(|_| ApiError::NotFound)?;
    
    // Check if user has permission to access this strategy
    if !permissions.can_access_strategy(&execution.strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    Ok(Json(execution))
}

// Handler to get telemetry events
async fn get_telemetry_events(
    State(state): State<Arc<StorageRouterState>>,
    user: Option<AuthenticatedUser>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = user.map(|u| get_permissions_from_user(&u)).unwrap_or_default();
    
    // Check if user has permission to access events
    if !permissions.can_access_events {
        return Err(ApiError::Forbidden);
    }
    
    // Parse parameters
    let strategy_id = query.strategy_id.clone();
    
    // Check strategy permission
    if let Some(ref id) = strategy_id {
        if !permissions.can_access_strategy(id) {
            return Err(ApiError::Forbidden);
        }
    }
    
    let level = query.level.as_deref().and_then(parse_level);
    
    // Determine time range
    let time_range = if let Some(hours) = query.hours {
        TimeRange::LastHours(hours)
    } else if let Some(days) = query.days {
        TimeRange::LastDays(days)
    } else {
        TimeRange::LastHours(24) // Default to last 24 hours
    };
    
    // Query events
    let events = state.storage.query_telemetry_events(
        strategy_id.as_deref(),
        level,
        time_range,
        query.limit,
    ).await.map_err(|e| ApiError::InternalError(e.to_string()))?;
    
    Ok(Json(serde_json::json!({
        "events": events,
        "count": events.len(),
        "timestamp": Utc::now(),
    })))
}

// Handler to get performance data
async fn get_performance(
    State(state): State<Arc<StorageRouterState>>,
    user: Option<AuthenticatedUser>,
    Query(query): Query<PerformanceQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Use the strategy-specific handler
    get_performance_by_strategy(
        State(state),
        user,
        Path(query.strategy_id),
        Query(query),
    ).await
}

// Handler to get performance data for a specific strategy
async fn get_performance_by_strategy(
    State(state): State<Arc<StorageRouterState>>,
    user: Option<AuthenticatedUser>,
    Path(strategy_id): Path<String>,
    Query(query): Query<PerformanceQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permissions = user.map(|u| get_permissions_from_user(&u)).unwrap_or_default();
    
    // Check if user has permission to access metrics
    if !permissions.can_access_metrics {
        return Err(ApiError::Forbidden);
    }
    
    // Check if user has permission to access this strategy
    if !permissions.can_access_strategy(&strategy_id) {
        return Err(ApiError::Forbidden);
    }
    
    // Determine time range
    let time_range = if let Some(hours) = query.hours {
        TimeRange::LastHours(hours)
    } else if let Some(days) = query.days {
        TimeRange::LastDays(days)
    } else {
        TimeRange::LastHours(24) // Default to last 24 hours
    };
    
    // Get interval (default to "hour")
    let interval = query.interval.unwrap_or_else(|| "hour".to_string());
    
    // Get latest performance
    let latest = state.storage.get_latest_performance(&strategy_id).await
        .map_err(|_| ApiError::NotFound)?;
    
    // Get performance history
    let history = state.storage.get_performance_history(
        &strategy_id,
        time_range,
        &interval,
    ).await.map_err(|e| ApiError::InternalError(e.to_string()))?;
    
    // Format the history for the response
    let formatted_history: Vec<serde_json::Value> = history.iter()
        .map(|(timestamp, perf)| {
            serde_json::json!({
                "timestamp": timestamp,
                "pnl": perf.pnl,
                "win_rate": perf.win_rate,
                "drawdown": perf.current_drawdown,
                "trust_score": perf.trust_score,
            })
        })
        .collect();
    
    Ok(Json(serde_json::json!({
        "strategy_id": strategy_id,
        "latest": {
            "pnl": latest.pnl,
            "win_rate": latest.win_rate,
            "drawdown": latest.current_drawdown,
            "max_drawdown": latest.max_drawdown,
            "trust_score": latest.trust_score,
            "sharpe_ratio": latest.sharpe_ratio,
            "successful_trades": latest.successful_trades,
            "unsuccessful_trades": latest.unsuccessful_trades,
            "last_updated": latest.last_updated,
        },
        "history": formatted_history,
        "interval": interval,
        "timestamp": Utc::now(),
    })))
} 