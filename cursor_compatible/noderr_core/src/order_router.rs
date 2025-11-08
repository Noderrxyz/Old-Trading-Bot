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
use std::collections::HashMap;
use tokio::sync::{RwLock, Mutex};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, error, warn, debug};
use uuid::Uuid;

use crate::execution::{ExecutionResult, ExecutionStatus};

/// Errors that can occur during order routing
#[derive(Debug, Error)]
pub enum OrderRouterError {
    #[error("No available venues for symbol: {0}")]
    NoAvailableVenues(String),

    #[error("Execution failed on all venues")]
    ExecutionFailedAllVenues,

    #[error("Venue error: {0}")]
    VenueError(String),

    #[error("Invalid order parameters: {0}")]
    InvalidOrderParameters(String),

    #[error("Timeout during execution")]
    ExecutionTimeout,
}

/// Reasons for execution failure
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionFailureReason {
    Revert,
    OutOfGas,
    SlippageTooHigh,
    Unknown,
}

/// Order structure for smart routing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    /// Symbol to trade
    pub symbol: String,
    /// Buy or sell
    pub side: OrderSide,
    /// Order amount/quantity
    pub amount: f64,
    /// Order price
    pub price: f64,
    /// Potential venues for execution
    pub venues: Vec<String>,
    /// Order ID for tracking
    pub id: String,
    /// Maximum slippage allowed (percentage)
    pub max_slippage: Option<f64>,
    /// Max retry attempts
    pub max_retries: Option<u32>,
    /// Additional parameters
    pub additional_params: HashMap<String, serde_json::Value>,
}

/// Order side (buy or sell)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Retry context for order execution
#[derive(Debug, Clone)]
pub struct RetryContext {
    /// Symbol being traded
    pub symbol: String, 
    /// Venue being used
    pub venue: String,
    /// Reason for retry
    pub reason: ExecutionFailureReason, 
    /// Attempt number
    pub attempt: u32,
    /// Maximum retries allowed
    pub max_retries: u32,
    /// Available venues for rotation
    pub available_venues: Vec<String>,
}

/// Execution result for a venue attempt
#[derive(Debug, Clone)]
pub struct VenueExecutionResult {
    /// Whether execution was successful
    pub success: bool,
    /// Venue used for execution
    pub venue: String,
    /// Reason for failure (if any)
    pub reason: Option<ExecutionFailureReason>,
    /// Execution details (if successful)
    pub details: Option<serde_json::Value>,
}

/// Smart Order Router implemented in Rust for maximum performance
pub struct SmartOrderRouter {
    /// Trust scores for venues
    trust_scores: Arc<RwLock<HashMap<String, f64>>>,
    /// Order retry engine
    retry_engine: Arc<OrderRetryEngine>,
    /// Recent execution results (cached)
    recent_executions: Arc<Mutex<HashMap<String, VenueExecutionResult>>>,
}

impl SmartOrderRouter {
    /// Create a new instance with default settings
    pub fn new() -> Self {
        Self {
            trust_scores: Arc::new(RwLock::new(HashMap::new())),
            retry_engine: Arc::new(OrderRetryEngine::new(3, 1000, 30000)),
            recent_executions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create a new instance with custom retry engine
    pub fn with_retry_engine(
        retry_engine: Arc<OrderRetryEngine>,
        trust_scores: HashMap<String, f64>,
    ) -> Self {
        Self {
            trust_scores: Arc::new(RwLock::new(trust_scores)),
            retry_engine,
            recent_executions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Execute an order across venues
    pub async fn execute_order(&self, order: Order) -> Result<ExecutionResult, OrderRouterError> {
        // Sort venues by trust score
        let ranked_venues = self.get_ranked_venues(&order.venues).await;
        
        if ranked_venues.is_empty() {
            error!("No available venues for {}", order.symbol);
            return Err(OrderRouterError::NoAvailableVenues(order.symbol));
        }
        
        debug!("Attempting to execute order for {} across {} venues", order.symbol, ranked_venues.len());
        
        // Try each venue in order of trust score
        for venue in &ranked_venues {
            match self.execute_on_venue(&order, venue).await {
                Ok(result) if result.success => {
                    // Improve trust score on success
                    self.improve_trust_score(venue, 0.01).await;
                    
                    let mut execution_result = ExecutionResult {
                        id: Uuid::new_v4().to_string(),
                        request_id: order.id.clone(),
                        signal_id: "".to_string(),  // To be filled by caller
                        status: ExecutionStatus::Completed,
                        order_id: Some(format!("venue-{}-{}", venue, Uuid::new_v4())),
                        executed_quantity: Some(order.amount),
                        average_price: Some(order.price),
                        fee_info: None,
                        fees: None,
                        fee_currency: None,
                        timestamp: chrono::Utc::now(),
                        execution_time_ms: 0, // To be filled by caller
                        latency_profile: None,
                        error_message: None,
                        error_context: None,
                        realized_pnl: 0.0,
                        additional_data: HashMap::new(),
                        rejection_details: None,
                        trust_score: Some(self.get_venue_trust_score(venue).await),
                    };
                    
                    // Store in cache
                    self.cache_execution_result(&order, result.clone()).await;
                    
                    // Add venue to result
                    execution_result.additional_data.insert(
                        "venue".to_string(), 
                        serde_json::Value::String(venue.clone())
                    );
                    
                    return Ok(execution_result);
                }
                Ok(result) => {
                    // Handle failure with retry
                    let retry_context = RetryContext {
                        symbol: order.symbol.clone(),
                        venue: venue.clone(),
                        reason: result.reason.unwrap_or(ExecutionFailureReason::Unknown),
                        attempt: 0,
                        max_retries: order.max_retries.unwrap_or(3),
                        available_venues: ranked_venues.clone(),
                    };
                    
                    debug!("Execution failed on venue {}. Attempting retry.", venue);
                    
                    let should_retry = self.retry_engine.retry(retry_context).await;
                    if should_retry {
                        // Try again with potentially rotated venue
                        let retry_venue = self.retry_engine.get_next_venue(venue, &ranked_venues);
                        match self.execute_on_venue(&order, &retry_venue).await {
                            Ok(retry_result) if retry_result.success => {
                                // Improve trust score on success
                                self.improve_trust_score(&retry_venue, 0.005).await;
                                
                                // Convert to ExecutionResult
                                let mut execution_result = ExecutionResult {
                                    id: Uuid::new_v4().to_string(),
                                    request_id: order.id.clone(),
                                    signal_id: "".to_string(),  // To be filled by caller
                                    status: ExecutionStatus::Completed,
                                    order_id: Some(format!("venue-{}-{}", retry_venue, Uuid::new_v4())),
                                    executed_quantity: Some(order.amount),
                                    average_price: Some(order.price),
                                    fee_info: None,
                                    fees: None,
                                    fee_currency: None,
                                    timestamp: chrono::Utc::now(),
                                    execution_time_ms: 0, // To be filled by caller
                                    latency_profile: None,
                                    error_message: None,
                                    error_context: None,
                                    realized_pnl: 0.0,
                                    additional_data: HashMap::new(),
                                    rejection_details: None,
                                    trust_score: Some(self.get_venue_trust_score(&retry_venue).await),
                                };
                                
                                execution_result.additional_data.insert(
                                    "venue".to_string(), 
                                    serde_json::Value::String(retry_venue)
                                );
                                execution_result.additional_data.insert(
                                    "retry_attempt".to_string(), 
                                    serde_json::Value::Number(serde_json::Number::from(1))
                                );
                                
                                return Ok(execution_result);
                            }
                            _ => continue, // Try next venue
                        }
                    }
                }
                Err(err) => {
                    warn!("Error executing on venue {}: {:?}", venue, err);
                    // Decay trust score on error
                    self.decay_trust_score(venue, 0.02).await;
                }
            }
        }
        
        // All venues failed
        Err(OrderRouterError::ExecutionFailedAllVenues)
    }
    
    /// Execute on a specific venue
    async fn execute_on_venue(&self, order: &Order, venue: &str) -> Result<VenueExecutionResult, OrderRouterError> {
        // Placeholder for actual venue execution logic
        // TODO: Implement real venue execution
        
        // Simulate venue execution (70% success rate for testing)
        let success = rand::random::<f64>() > 0.3;
        
        if success {
            Ok(VenueExecutionResult {
                success: true,
                venue: venue.to_string(),
                reason: None,
                details: Some(serde_json::json!({
                    "execution_time": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis()
                })),
            })
        } else {
            // Generate random failure reason
            let reasons = [
                ExecutionFailureReason::Revert,
                ExecutionFailureReason::OutOfGas,
                ExecutionFailureReason::SlippageTooHigh,
            ];
            let reason_idx = rand::random::<usize>() % reasons.len();
            
            Ok(VenueExecutionResult {
                success: false,
                venue: venue.to_string(),
                reason: Some(reasons[reason_idx]),
                details: None,
            })
        }
    }
    
    /// Get venues sorted by trust score
    async fn get_ranked_venues(&self, available_venues: &[String]) -> Vec<String> {
        // Create a list of (venue, trust_score) pairs
        let trust_scores = self.trust_scores.read().await;
        
        let mut venue_scores: Vec<(String, f64)> = available_venues
            .iter()
            .filter_map(|venue| {
                let score = trust_scores.get(venue).copied().unwrap_or(0.5);
                Some((venue.clone(), score))
            })
            .collect();
        
        // Sort by trust score (highest first)
        venue_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        // Return just the venues
        venue_scores.into_iter().map(|(venue, _)| venue).collect()
    }
    
    /// Get trust score for a venue
    async fn get_venue_trust_score(&self, venue: &str) -> f64 {
        let trust_scores = self.trust_scores.read().await;
        *trust_scores.get(venue).unwrap_or(&0.5)
    }
    
    /// Improve trust score for a venue
    async fn improve_trust_score(&self, venue: &str, amount: f64) {
        let mut trust_scores = self.trust_scores.write().await;
        let current_score = trust_scores.entry(venue.to_string()).or_insert(0.5);
        *current_score = (*current_score + amount).min(1.0);
    }
    
    /// Decay trust score for a venue
    async fn decay_trust_score(&self, venue: &str, amount: f64) {
        let mut trust_scores = self.trust_scores.write().await;
        let current_score = trust_scores.entry(venue.to_string()).or_insert(0.5);
        *current_score = (*current_score - amount).max(0.0);
    }
    
    /// Cache execution result
    async fn cache_execution_result(&self, order: &Order, result: VenueExecutionResult) {
        let mut recent_executions = self.recent_executions.lock().await;
        recent_executions.insert(order.id.clone(), result);
        
        // Limit cache size
        if recent_executions.len() > 1000 {
            // Remove oldest items
            // This is inefficient but good enough for now
            // TODO: Use a more efficient cache implementation
            let keys: Vec<String> = recent_executions.keys().cloned().collect();
            for key in keys.iter().take(keys.len() - 900) {
                recent_executions.remove(key);
            }
        }
    }
}

/// Order retry engine for handling failed executions
pub struct OrderRetryEngine {
    /// Maximum number of retries
    max_retries: u32,
    /// Base delay in milliseconds for exponential backoff
    base_delay_ms: u64,
    /// Maximum delay in milliseconds
    max_delay_ms: u64,
    /// Recent retry attempts
    retry_history: Arc<Mutex<Vec<RetryContext>>>,
}

impl OrderRetryEngine {
    /// Create a new retry engine
    pub fn new(max_retries: u32, base_delay_ms: u64, max_delay_ms: u64) -> Self {
        Self {
            max_retries,
            base_delay_ms,
            max_delay_ms,
            retry_history: Arc::new(Mutex::new(Vec::new())),
        }
    }
    
    /// Retry an execution
    pub async fn retry(&self, mut context: RetryContext) -> bool {
        if context.attempt >= context.max_retries {
            warn!("Max retries exceeded for {} on {}", context.symbol, context.venue);
            return false;
        }
        
        // Calculate exponential backoff delay
        let delay = std::cmp::min(
            self.base_delay_ms * 2u64.pow(context.attempt),
            self.max_delay_ms
        );
        
        // Log retry attempt
        debug!("Retry #{} for {} on {} after {}ms", 
            context.attempt + 1, 
            context.symbol, 
            context.venue, 
            delay
        );
        
        // Store retry context
        let mut history = self.retry_history.lock().await;
        history.push(context.clone());
        
        // Limit history size
        if history.len() > 100 {
            history.drain(0..50);
        }
        
        // Wait for backoff period
        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
        
        // Increment attempt counter
        context.attempt += 1;
        
        true
    }
    
    /// Get next venue to try (for venue rotation)
    pub fn get_next_venue(&self, current_venue: &str, available_venues: &[String]) -> String {
        if available_venues.is_empty() {
            return current_venue.to_string();
        }
        
        let current_index = available_venues.iter().position(|v| v == current_venue);
        match current_index {
            Some(idx) => {
                let next_idx = (idx + 1) % available_venues.len();
                available_venues[next_idx].clone()
            }
            None => {
                available_venues[0].clone()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_venue_ranking() {
        let mut trust_scores = HashMap::new();
        trust_scores.insert("venue1".to_string(), 0.8);
        trust_scores.insert("venue2".to_string(), 0.6);
        trust_scores.insert("venue3".to_string(), 0.9);
        
        let router = SmartOrderRouter::with_retry_engine(
            Arc::new(OrderRetryEngine::new(3, 100, 1000)),
            trust_scores,
        );
        
        let venues = vec![
            "venue1".to_string(),
            "venue2".to_string(),
            "venue3".to_string(),
        ];
        
        let ranked = router.get_ranked_venues(&venues).await;
        
        assert_eq!(ranked[0], "venue3");
        assert_eq!(ranked[1], "venue1");
        assert_eq!(ranked[2], "venue2");
    }
    
    #[tokio::test]
    async fn test_retry_engine() {
        let retry_engine = OrderRetryEngine::new(3, 10, 100);
        
        let context = RetryContext {
            symbol: "ETH-USD".to_string(),
            venue: "test_venue".to_string(),
            reason: ExecutionFailureReason::SlippageTooHigh,
            attempt: 0,
            max_retries: 3,
            available_venues: vec!["test_venue".to_string(), "backup_venue".to_string()],
        };
        
        // First retry should succeed
        let should_retry = retry_engine.retry(context.clone()).await;
        assert!(should_retry);
        
        // Check venue rotation
        let next_venue = retry_engine.get_next_venue(
            &context.venue,
            &context.available_venues,
        );
        assert_eq!(next_venue, "backup_venue");
    }
} 