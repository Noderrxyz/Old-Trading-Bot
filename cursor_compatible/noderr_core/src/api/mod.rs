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

//! API routers and handlers for Noderr Protocol

pub mod auth;
pub mod telemetry_router;
pub mod storage_router;
pub mod analytics_router;

use std::sync::Arc;
use axum::Router;
use tracing::info;

use crate::telemetry::TelemetryReporter;
use crate::trust_buffer::TrustBuffer;
use crate::storage::StrategyStorage;
use crate::analytics::Analytics;
use crate::telemetry_streamer::TelemetryStreamer;
use crate::websocket_manager::WebSocketManager;
use crate::trust_score_engine::TrustScoreEngine;

/// Create a complete API router with all endpoints
pub fn create_api_router(
    telemetry: Arc<TelemetryReporter>,
    trust_buffer: Arc<TrustBuffer>,
    storage: Arc<dyn StrategyStorage>,
    analytics: Option<Arc<dyn Analytics>>,
    telemetry_streamer: Option<Arc<dyn TelemetryStreamer>>,
    websocket_manager: Option<Arc<WebSocketManager>>,
    trust_score_engine: Option<Arc<dyn TrustScoreEngine>>,
) -> Router {
    info!("Creating API router with all endpoints");
    
    let telemetry_routes = telemetry_router::create_telemetry_router(
        telemetry,
        trust_buffer,
    );
    
    let storage_routes = storage_router::create_storage_router(storage);
    
    let mut router = Router::new()
        .merge(telemetry_routes)
        .merge(storage_routes);
    
    // Add analytics routes if analytics is provided
    if let Some(analytics_service) = analytics {
        let analytics_routes = analytics_router::create_analytics_router(
            analytics_service,
            telemetry_streamer,
            websocket_manager,
            trust_score_engine,
        );
        router = router.merge(analytics_routes);
        info!("Added analytics routes to API router");
    }
    
    router
} 