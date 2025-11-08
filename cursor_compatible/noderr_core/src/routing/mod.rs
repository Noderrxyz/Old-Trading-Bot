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

//! Smart Order Routing (SOR) module
//!
//! This module provides the core functionality for the Smart Order Routing system
//! which intelligently routes orders to the best available venue(s) based on a
//! comprehensive scoring system that considers price, latency, liquidity depth,
//! fees, and historical performance.

mod venue_scorer;
mod venue_telemetry;
mod routing_strategy;
mod order_router;

pub use venue_scorer::{
    VenueId, VenueScorer, VenueScore, VenueMetrics, VenueStatus,
    VenueScorerConfig, VenueScoringError, VenueScoringResult,
    DefaultVenueScorer, VenueScorerFactory,
    create_venue_scorer, create_venue_scorer_with_config,
};

pub use venue_telemetry::{
    VenueTelemetry, VenueTelemetryEvent, VenueTelemetryManager,
    VenueLatencyTracker, VenueFillRateTracker,
};

pub use routing_strategy::{
    RoutingStrategy, RoutingMode, RoutingDecision,
    BestPriceStrategy, LowestLatencyStrategy, HighestLiquidityStrategy,
    MultiVenueStrategy, FallbackRoutingStrategy,
};

pub use order_router::{
    OrderRouter, OrderRoutingResult, OrderRoutingError,
    SmartOrderRouter, OrderRoutingConfig,
};

/// Create a new smart order router with default configuration
pub fn create_smart_order_router() -> SmartOrderRouter {
    SmartOrderRouter::new(OrderRoutingConfig::default())
}

/// Create a new smart order router with custom configuration
pub fn create_smart_order_router_with_config(config: OrderRoutingConfig) -> SmartOrderRouter {
    SmartOrderRouter::new(config)
}

pub mod venue_telemetry;
pub mod venue_scorer;

// Re-export key types and structs for easier access
pub use venue_telemetry::{VenueTelemetryEvent, VenueTelemetry, VenueTelemetryManager, 
                         VenueLatencyTracker, VenueFillRateTracker};
pub use venue_scorer::{VenueId, VenueMetrics, VenueScorerConfig, VenueScorer};

pub mod route;
pub mod venue_telemetry;
pub mod venue_scorer;

// Re-export the types and functions from the submodules
pub use route::*;
pub use venue_telemetry::*;
pub use venue_scorer::*; 