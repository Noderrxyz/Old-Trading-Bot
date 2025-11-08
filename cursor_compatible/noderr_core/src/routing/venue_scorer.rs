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

use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use thiserror::Error;
use tracing::{debug, info, warn, error};
use crate::routing::venue_telemetry::VenueTelemetryManager;
use crate::market::Symbol;
use crate::execution::{OrderIntent, OrderSide, OrderType};
use std::sync::Arc;
use chrono::{DateTime, Utc};

/// Error types for venue scoring operations
#[derive(Debug, Error)]
pub enum VenueScoringError {
    #[error("Insufficient market data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid venue configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Scoring algorithm error: {0}")]
    Algorithm(String),
    
    #[error("No valid venues available: {0}")]
    NoVenues(String),
}

/// Result type for venue scoring operations
pub type VenueScoringResult<T> = Result<T, VenueScoringError>;

/// Unique identifier for a trading venue
pub type VenueId = String;

/// Individual metrics for a trading venue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VenueMetrics {
    /// Venue identifier
    pub venue_id: VenueId,
    
    /// Market symbol
    pub symbol: Symbol,
    
    /// Best bid price available at the venue
    pub best_bid: Option<f64>,
    
    /// Best ask price available at the venue
    pub best_ask: Option<f64>,
    
    /// Available liquidity at the venue (in base currency)
    pub liquidity_depth: HashMap<OrderSide, Vec<(f64, f64)>>, // (price, quantity) pairs
    
    /// Current maker fee in basis points
    pub maker_fee_bps: f64,
    
    /// Current taker fee in basis points
    pub taker_fee_bps: f64,
    
    /// Estimated latency in milliseconds
    pub estimated_latency_ms: f64,
    
    /// Last time this venue was updated
    pub last_updated: DateTime<Utc>,
    
    /// Health status of the venue (e.g., "healthy", "degraded", "down")
    pub status: String,
}

impl VenueMetrics {
    /// Create new venue metrics with default values
    pub fn new(venue_id: VenueId) -> Self {
        Self {
            venue_id,
            symbol: Symbol::default(),
            best_bid: None,
            best_ask: None,
            liquidity_depth: HashMap::new(),
            maker_fee_bps: 0.0,
            taker_fee_bps: 0.0,
            estimated_latency_ms: 0.0,
            last_updated: Utc::now(),
            status: "unknown".to_string(),
        }
    }
    
    /// Calculate the mid price if both bid and ask are available
    pub fn mid_price(&self) -> Option<f64> {
        match (self.best_bid, self.best_ask) {
            (Some(bid), Some(ask)) => Some((bid + ask) / 2.0),
            _ => None,
        }
    }
    
    /// Get the spread as percentage
    pub fn spread_percentage(&self) -> Option<f64> {
        match (self.best_bid, self.best_ask) {
            (Some(bid), Some(ask)) => {
                let mid = (bid + ask) / 2.0;
                Some((ask - bid) / mid * 100.0)
            },
            _ => None,
        }
    }
    
    /// Check if the venue is available for trading
    pub fn is_available(&self) -> bool {
        self.status == "healthy" || self.status == "degraded"
    }
}

/// Configuration for the venue scoring algorithm
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VenueScorerConfig {
    /// Weight for price competitiveness in the score (0.0 to 1.0)
    pub price_weight: f64,
    /// Weight for latency in the score (0.0 to 1.0)
    pub latency_weight: f64,
    /// Weight for liquidity depth in the score (0.0 to 1.0)
    pub liquidity_weight: f64,
    /// Weight for fees in the score (0.0 to 1.0)
    pub fee_weight: f64,
    /// Weight for historical performance in the score (0.0 to 1.0)
    pub historical_weight: f64,
    /// Minimum health score required for a venue to be considered (0.0 to 1.0)
    pub min_health_score: f64,
}

impl Default for VenueScorerConfig {
    fn default() -> Self {
        Self {
            price_weight: 0.40,
            latency_weight: 0.15,
            liquidity_weight: 0.20,
            fee_weight: 0.15,
            historical_weight: 0.10,
            min_health_score: 0.6,
        }
    }
}

/// Scores trading venues based on multiple factors
#[derive(Debug, Clone)]
pub struct VenueScorer {
    /// Configuration for the scoring algorithm
    config: VenueScorerConfig,
    /// Telemetry manager for historical performance data
    telemetry_manager: Arc<VenueTelemetryManager>,
}

impl VenueScorer {
    /// Create a new venue scorer with default configuration
    pub fn new(telemetry_manager: Arc<VenueTelemetryManager>) -> Self {
        Self {
            config: VenueScorerConfig::default(),
            telemetry_manager,
        }
    }
    
    /// Create a new venue scorer with custom configuration
    pub fn with_config(config: VenueScorerConfig, telemetry_manager: Arc<VenueTelemetryManager>) -> Self {
        Self {
            config,
            telemetry_manager,
        }
    }
    
    /// Score venues for a given order side and size
    pub async fn score_venues(
        &self, 
        venues: &[VenueMetrics], 
        side: OrderSide, 
        size: f64
    ) -> Vec<(VenueId, f64)> {
        let mut scores = Vec::new();
        
        for venue in venues {
            if !venue.is_available() {
                continue;
            }
            
            let score = self.calculate_venue_score(venue, side, size).await;
            
            if score >= self.config.min_health_score {
                scores.push((venue.venue_id.clone(), score));
                debug!("Venue {} scored {:.4} for {:?} order of size {}", 
                       venue.venue_id, score, side, size);
            }
        }
        
        // Sort by score descending
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        scores
    }
    
    /// Calculate the score for a single venue
    async fn calculate_venue_score(&self, venue: &VenueMetrics, side: OrderSide, size: f64) -> f64 {
        let price_score = self.calculate_price_score(venue, side);
        let latency_score = self.calculate_latency_score(venue).await;
        let liquidity_score = self.calculate_liquidity_score(venue, side, size);
        let fee_score = self.calculate_fee_score(venue, side);
        let historical_score = self.calculate_historical_score(venue).await;
        
        // Combine weighted scores
        let score = 
            self.config.price_weight * price_score +
            self.config.latency_weight * latency_score +
            self.config.liquidity_weight * liquidity_score +
            self.config.fee_weight * fee_score +
            self.config.historical_weight * historical_score;
        
        debug!("Venue {} scores: price={:.2}, latency={:.2}, liquidity={:.2}, fee={:.2}, historical={:.2}, total={:.4}",
               venue.venue_id, price_score, latency_score, liquidity_score, fee_score, historical_score, score);
        
        score
    }
    
    /// Calculate the price competitiveness score (0.0 to 1.0)
    fn calculate_price_score(&self, venue: &VenueMetrics, side: OrderSide) -> f64 {
        match side {
            OrderSide::Buy => {
                // For buy orders, lower ask prices are better
                venue.best_ask.map_or(0.0, |_| {
                    // This is a simplified scoring - in real implementation we would
                    // compare to the best available price across all venues
                    0.9
                })
            },
            OrderSide::Sell => {
                // For sell orders, higher bid prices are better
                venue.best_bid.map_or(0.0, |_| {
                    // This is a simplified scoring - in real implementation we would
                    // compare to the best available price across all venues
                    0.9
                })
            },
        }
    }
    
    /// Calculate the latency score (0.0 to 1.0)
    async fn calculate_latency_score(&self, venue: &VenueMetrics) -> f64 {
        // Use telemetry for historical latency if available, otherwise use estimated
        let latency = match self.telemetry_manager.get_average_latency(&venue.venue_id).await {
            Some(latency) => latency,
            None => venue.estimated_latency_ms,
        };
        
        // Normalize latency score (lower is better)
        // Assuming 200ms or more is bad (score 0.0) and 5ms or less is perfect (score 1.0)
        if latency <= 5.0 {
            1.0
        } else if latency >= 200.0 {
            0.0
        } else {
            (200.0 - latency) / 195.0
        }
    }
    
    /// Calculate the liquidity depth score (0.0 to 1.0)
    fn calculate_liquidity_score(&self, venue: &VenueMetrics, side: OrderSide, size: f64) -> f64 {
        let liquidity = venue.liquidity_depth.get(&side);
        
        match liquidity {
            Some(depth) => {
                let mut available_size = 0.0;
                for (_, qty) in depth {
                    available_size += *qty;
                    if available_size >= size {
                        // Can fill the entire order at this venue
                        return 1.0;
                    }
                }
                
                // Can fill part of the order
                if size > 0.0 {
                    (available_size / size).min(1.0)
                } else {
                    0.0
                }
            },
            None => 0.0,
        }
    }
    
    /// Calculate the fee score (0.0 to 1.0)
    fn calculate_fee_score(&self, venue: &VenueMetrics, side: OrderSide) -> f64 {
        // For simplicity, we'll use taker fees for all orders
        // Lower fees are better - assume 50 bps (0.5%) or more is bad (score 0.0)
        // and 0 bps is perfect (score 1.0)
        
        let fee_bps = venue.taker_fee_bps;
        
        if fee_bps <= 0.0 {
            1.0
        } else if fee_bps >= 50.0 {
            0.0
        } else {
            (50.0 - fee_bps) / 50.0
        }
    }
    
    /// Calculate the historical performance score (0.0 to 1.0)
    async fn calculate_historical_score(&self, venue: &VenueMetrics) -> f64 {
        // Get the fill rate from telemetry
        let fill_rate = self.telemetry_manager.get_fill_rate(&venue.venue_id).await.unwrap_or(0.9);
        
        // Get the error count and penalize based on it
        let error_count = self.telemetry_manager.get_error_count(&venue.venue_id).await;
        let error_penalty = if error_count == 0 {
            0.0
        } else if error_count < 5 {
            0.1
        } else if error_count < 20 {
            0.3
        } else {
            0.5
        };
        
        // Combine fill rate and error penalty
        (fill_rate - error_penalty).max(0.0)
    }
}

/// Score assigned to a venue after evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VenueScore {
    /// Venue identifier
    pub venue_id: VenueId,
    
    /// Overall score (higher is better)
    pub score: f64,
    
    /// Reason for this score (for logging/debugging)
    pub reason: Option<String>,
    
    /// Component scores
    pub component_scores: HashMap<String, f64>,
    
    /// Venue metrics used for scoring
    pub metrics: VenueMetrics,
}

impl VenueScore {
    /// Create a new venue score
    pub fn new(venue_id: VenueId, score: f64, metrics: VenueMetrics) -> Self {
        Self {
            venue_id,
            score,
            reason: None,
            component_scores: HashMap::new(),
            metrics,
        }
    }
    
    /// Add a reason for this score
    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
    
    /// Add component scores
    pub fn with_component_scores(mut self, components: HashMap<String, f64>) -> Self {
        self.component_scores = components;
        self
    }
}

/// Trait for scoring venues based on their metrics
pub trait VenueScorer: Send + Sync {
    /// Score a list of venues for a specific order intent
    fn score(&self, venues: &[VenueMetrics], order: &OrderIntent) -> VenueScoringResult<Vec<VenueScore>>;
    
    /// Update the configuration for this scorer
    fn update_config(&mut self, config: VenueScorerConfig);
    
    /// Get the current configuration
    fn get_config(&self) -> VenueScorerConfig;
}

/// Default implementation of venue scorer
pub struct DefaultVenueScorer {
    /// Configuration
    config: VenueScorerConfig,
}

impl DefaultVenueScorer {
    /// Create a new DefaultVenueScorer with the provided configuration
    pub fn new(config: VenueScorerConfig) -> Self {
        Self { config }
    }
    
    /// Create a new DefaultVenueScorer with default configuration
    pub fn default() -> Self {
        Self { config: VenueScorerConfig::default() }
    }
    
    /// Score a venue on price
    fn score_price(&self, metrics: &VenueMetrics, order: &OrderIntent, best_price: f64) -> f64 {
        let side = order.side;
        let size = order.quantity;
        
        // Calculate effective price for this order size
        let effective_price = metrics.calculate_effective_price(side, size);
        
        // Calculate price score (1.0 is best price, 0.0 is worst price)
        let price_score = match side {
            OrderSide::Buy => {
                // For buys, lower price is better
                if effective_price <= best_price {
                    1.0 // This is the best price
                } else {
                    // Score based on how much worse the price is
                    let price_diff_pct = (best_price / effective_price).min(1.0);
                    price_diff_pct * price_diff_pct // Square to penalize worse prices
                }
            },
            OrderSide::Sell => {
                // For sells, higher price is better
                if effective_price >= best_price {
                    1.0 // This is the best price
                } else {
                    // Score based on how much worse the price is
                    let price_diff_pct = (effective_price / best_price).min(1.0);
                    price_diff_pct * price_diff_pct // Square to penalize worse prices
                }
            },
        };
        
        price_score
    }
    
    /// Score a venue on latency
    fn score_latency(&self, metrics: &VenueMetrics) -> f64 {
        if metrics.estimated_latency_ms <= 0.0 {
            // No latency data, assume average score
            return 0.5;
        }
        
        // Use a sigmoid curve to score latency
        // 1.0 for very low latency, 0.0 for very high latency
        let normalized_latency = metrics.estimated_latency_ms / 200.0;
        let latency_score = 1.0 / (1.0 + normalized_latency.powi(2));
        
        latency_score
    }
    
    /// Score a venue on liquidity
    fn score_liquidity(&self, metrics: &VenueMetrics, order: &OrderIntent) -> f64 {
        let side = order.side;
        let size = order.quantity;
        
        // Calculate liquidity score based on available depth
        let liquidity_score = self.calculate_liquidity_score(metrics, side, size);
        
        // Sigmoid function to normalize liquidity score
        1.0 / (1.0 + (-5.0 * liquidity_score + 2.5).exp())
    }
    
    /// Score a venue on fees
    fn score_fee(&self, metrics: &VenueMetrics, order: &OrderIntent) -> f64 {
        let fee_bps = metrics.taker_fee_bps;
        
        // Higher fee means worse score
        // Normalize fee between 0.0 and 1.0 (assuming 0.5% is the maximum expected fee)
        let normalized_fee = (fee_bps / 50.0).min(0.005);
        let fee_score = 1.0 - (normalized_fee / 0.005);
        
        fee_score
    }
    
    /// Score a venue on fill rate history
    fn score_fill_rate(&self, metrics: &VenueMetrics) -> f64 {
        let fill_rate = self.calculate_fill_rate(metrics);
        
        if fill_rate < 0.6 {
            0.0 // Below minimum fill rate
        } else {
            // Scale from min_fill_rate to 1.0
            (fill_rate - 0.6) / 0.4
        }
    }
    
    /// Calculate the overall score for a venue
    fn calculate_overall_score(&self, component_scores: &HashMap<String, f64>) -> f64 {
        let price_score = component_scores.get("price").copied().unwrap_or(0.0);
        let latency_score = component_scores.get("latency").copied().unwrap_or(0.0);
        let liquidity_score = component_scores.get("liquidity").copied().unwrap_or(0.0);
        let fee_score = component_scores.get("fee").copied().unwrap_or(0.0);
        let fill_rate_score = component_scores.get("fill_rate").copied().unwrap_or(0.0);
        
        // Combine scores with weights
        let overall_score = 
            price_score * self.config.price_weight +
            latency_score * self.config.latency_weight +
            liquidity_score * self.config.liquidity_weight +
            fee_score * self.config.fee_weight +
            fill_rate_score * self.config.fill_rate_weight;
        
        overall_score
    }
    
    /// Find the best available price across all venues
    fn find_best_price(&self, venues: &[VenueMetrics], order: &OrderIntent) -> f64 {
        match order.side {
            OrderSide::Buy => {
                // For buys, find lowest effective ask price
                venues.iter()
                    .filter(|m| m.status == "healthy" || m.status == "degraded")
                    .map(|m| m.best_ask.unwrap_or(0.0))
                    .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .unwrap_or(0.0)
            },
            OrderSide::Sell => {
                // For sells, find highest effective bid price
                venues.iter()
                    .filter(|m| m.status == "healthy" || m.status == "degraded")
                    .map(|m| m.best_bid.unwrap_or(0.0))
                    .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .unwrap_or(0.0)
            },
        }
    }
}

impl VenueScorer for DefaultVenueScorer {
    fn score(&self, venues: &[VenueMetrics], order: &OrderIntent) -> VenueScoringResult<Vec<VenueScore>> {
        if venues.is_empty() {
            return Err(VenueScoringError::NoVenues("No venues provided for scoring".to_string()));
        }
        
        // Filter out offline venues and stale metrics
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
            
        let valid_venues: Vec<&VenueMetrics> = venues.iter()
            .filter(|m| m.status == "healthy" || m.status == "degraded")
            .filter(|m| (now - m.last_updated.timestamp_millis()) <= 30000)
            .collect();
            
        if valid_venues.is_empty() {
            return Err(VenueScoringError::NoVenues("No valid venues available (all offline or stale)".to_string()));
        }
        
        // Find the best price across all venues for comparison
        let best_price = self.find_best_price(venues, order);
        if best_price == 0.0 {
            warn!("Could not find a valid best price across venues");
        }
        
        // Score each venue
        let mut venue_scores = Vec::with_capacity(valid_venues.len());
        
        for metrics in valid_venues {
            let mut component_scores = HashMap::new();
            
            // Calculate component scores
            let price_score = self.score_price(metrics, order, best_price);
            let latency_score = self.score_latency(metrics);
            let liquidity_score = self.score_liquidity(metrics, order);
            let fee_score = self.score_fee(metrics, order);
            let fill_rate_score = self.score_fill_rate(metrics);
            
            // Store component scores
            component_scores.insert("price".to_string(), price_score);
            component_scores.insert("latency".to_string(), latency_score);
            component_scores.insert("liquidity".to_string(), liquidity_score);
            component_scores.insert("fee".to_string(), fee_score);
            component_scores.insert("fill_rate".to_string(), fill_rate_score);
            
            // Calculate overall score
            let overall_score = self.calculate_overall_score(&component_scores);
            
            // Create venue score
            let venue_score = VenueScore::new(metrics.venue_id.clone(), overall_score, metrics.clone())
                .with_component_scores(component_scores)
                .with_reason(format!(
                    "price={:.3}, latency={:.3}, liquidity={:.3}, fee={:.3}, fill_rate={:.3}",
                    price_score, latency_score, liquidity_score, fee_score, fill_rate_score
                ));
                
            venue_scores.push(venue_score);
        }
        
        // Sort venues by score (descending)
        venue_scores.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        
        // Normalize scores if configured
        if self.config.normalize_scores && !venue_scores.is_empty() {
            let max_score = venue_scores[0].score;
            
            if max_score > 0.0 {
                for score in &mut venue_scores {
                    score.score /= max_score;
                }
            }
        }
        
        // Log the best venue
        if let Some(best) = venue_scores.first() {
            debug!(
                "Best venue for {} {}: {} (score: {:.3})", 
                order.side, order.symbol, best.venue_id, best.score
            );
        }
        
        Ok(venue_scores)
    }
    
    fn update_config(&mut self, config: VenueScorerConfig) {
        self.config = config;
    }
    
    fn get_config(&self) -> VenueScorerConfig {
        self.config.clone()
    }
}

/// Factory for creating venue scorers
pub struct VenueScorerFactory;

impl VenueScorerFactory {
    /// Create a default venue scorer
    pub fn create_default() -> Box<dyn VenueScorer> {
        Box::new(DefaultVenueScorer::default())
    }
    
    /// Create a venue scorer with custom configuration
    pub fn create_with_config(config: VenueScorerConfig) -> Box<dyn VenueScorer> {
        Box::new(DefaultVenueScorer::new(config))
    }
}

/// Helper function to create a default venue scorer
pub fn create_venue_scorer() -> Box<dyn VenueScorer> {
    VenueScorerFactory::create_default()
}

/// Helper function to create a venue scorer with custom configuration
pub fn create_venue_scorer_with_config(config: VenueScorerConfig) -> Box<dyn VenueScorer> {
    VenueScorerFactory::create_with_config(config)
} 