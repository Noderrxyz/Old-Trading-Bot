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
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::execution_metrics::{ExecutionMetricsCollector, ExecutionMetricsError};
use crate::strategy::StrategyId;
use crate::risk_allocation::{RiskAllocator, StrategyAllocation, PortfolioAllocation};
use crate::redis::{RedisClient, RedisClientResult};

/// Errors that can occur in the strategy feedback system
#[derive(Debug, Error)]
pub enum StrategyFeedbackError {
    #[error("Redis error: {0}")]
    RedisError(String),
    
    #[error("Metrics error: {0}")]
    MetricsError(#[from] ExecutionMetricsError),
    
    #[error("Allocation error: {0}")]
    AllocationError(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for strategy feedback operations
pub type StrategyFeedbackResult<T> = Result<T, StrategyFeedbackError>;

/// Configuration for the strategy feedback loop
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyFeedbackConfig {
    /// How often to run the feedback loop (in seconds)
    pub feedback_interval_seconds: u64,
    /// Minimum EQS required for a strategy to be active
    pub min_eqs_threshold: f64,
    /// EQS threshold for strategy replacement consideration
    pub replacement_eqs_threshold: f64,
    /// Strategy decay threshold for reallocation
    pub decay_threshold: f64,
    /// Time window for short-term performance (hours)
    pub short_term_window_hours: i64,
    /// Time window for medium-term performance (hours)
    pub medium_term_window_hours: i64,
    /// Time window for long-term performance (hours)
    pub long_term_window_hours: i64,
    /// Performance impact weights for allocation
    pub allocation_weights: AllocationWeights,
    /// Whether to automatically deactivate underperforming strategies
    pub auto_deactivate: bool,
    /// Maximum percentage to adjust allocation in a single update
    pub max_allocation_adjustment_pct: f64,
}

impl Default for StrategyFeedbackConfig {
    fn default() -> Self {
        Self {
            feedback_interval_seconds: 3600, // 1 hour
            min_eqs_threshold: 0.5,
            replacement_eqs_threshold: 0.3,
            decay_threshold: 0.6,
            short_term_window_hours: 1,
            medium_term_window_hours: 4,
            long_term_window_hours: 24,
            allocation_weights: AllocationWeights::default(),
            auto_deactivate: true,
            max_allocation_adjustment_pct: 0.1, // 10%
        }
    }
}

/// Weights for different performance indicators in allocation decisions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllocationWeights {
    /// Weight for execution quality score
    pub eqs_weight: f64,
    /// Weight for short-term performance
    pub short_term_weight: f64,
    /// Weight for medium-term performance
    pub medium_term_weight: f64,
    /// Weight for long-term performance
    pub long_term_weight: f64,
    /// Weight for strategy decay
    pub decay_weight: f64,
}

impl Default for AllocationWeights {
    fn default() -> Self {
        Self {
            eqs_weight: 0.3,
            short_term_weight: 0.1,
            medium_term_weight: 0.2,
            long_term_weight: 0.3,
            decay_weight: 0.1,
        }
    }
}

/// Adaptive strategy status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdaptiveStrategyStatus {
    /// Strategy is active and allocated normally
    Active,
    /// Strategy is active but allocation is reduced
    Reduced,
    /// Strategy is in cooldown (temporary deactivation)
    Cooldown,
    /// Strategy is deactivated due to persistent issues
    Deactivated,
    /// Strategy is being monitored after performance issues
    Probation,
}

/// Record of a strategy adaptation event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptationEvent {
    /// Strategy ID
    pub strategy_id: StrategyId,
    /// When the adaptation occurred
    pub timestamp: DateTime<Utc>,
    /// Previous allocation percentage
    pub previous_allocation: f64,
    /// New allocation percentage
    pub new_allocation: f64,
    /// Previous status
    pub previous_status: AdaptiveStrategyStatus,
    /// New status
    pub new_status: AdaptiveStrategyStatus,
    /// Reason for the adaptation
    pub reason: String,
    /// Performance metrics that led to this adaptation
    pub metrics: HashMap<String, f64>,
}

/// Strategy score for allocation decisions
#[derive(Debug, Clone)]
struct StrategyScore {
    /// Strategy ID
    strategy_id: StrategyId,
    /// Execution quality score
    eqs: f64,
    /// Short-term performance
    short_term_perf: f64,
    /// Medium-term performance
    medium_term_perf: f64,
    /// Long-term performance
    long_term_perf: f64,
    /// Decay score (1.0 is no decay, < 1.0 indicates decay)
    decay_score: f64,
    /// Current status
    status: AdaptiveStrategyStatus,
    /// Composite score for allocation
    composite_score: f64,
}

/// Trait for strategy feedback loop
#[async_trait]
pub trait StrategyFeedbackLoop: Send + Sync {
    /// Start the feedback loop
    async fn start(&self) -> StrategyFeedbackResult<()>;
    
    /// Stop the feedback loop
    async fn stop(&self) -> StrategyFeedbackResult<()>;
    
    /// Run a single feedback cycle
    async fn run_feedback_cycle(&self) -> StrategyFeedbackResult<Vec<AdaptationEvent>>;
    
    /// Get current status of all strategies
    async fn get_strategy_statuses(&self) -> StrategyFeedbackResult<HashMap<StrategyId, AdaptiveStrategyStatus>>;
    
    /// Get recent adaptation events
    async fn get_recent_adaptations(&self, limit: Option<usize>) -> StrategyFeedbackResult<Vec<AdaptationEvent>>;
    
    /// Override strategy status
    async fn override_strategy_status(
        &self, 
        strategy_id: &StrategyId, 
        status: AdaptiveStrategyStatus,
        reason: &str
    ) -> StrategyFeedbackResult<()>;
}

/// Default implementation of the strategy feedback loop
pub struct DefaultStrategyFeedbackLoop {
    /// Configuration
    config: StrategyFeedbackConfig,
    /// Execution metrics collector
    metrics_collector: Arc<dyn ExecutionMetricsCollector>,
    /// Risk allocator
    risk_allocator: Arc<dyn RiskAllocator>,
    /// Redis client for caching
    redis: Option<Arc<dyn RedisClient>>,
    /// Current strategy statuses
    strategy_statuses: Arc<RwLock<HashMap<StrategyId, AdaptiveStrategyStatus>>>,
    /// Recent adaptation events
    recent_adaptations: Arc<Mutex<Vec<AdaptationEvent>>>,
    /// Flag to indicate if the loop is running
    is_running: Arc<RwLock<bool>>,
}

impl DefaultStrategyFeedbackLoop {
    /// Create a new strategy feedback loop
    pub fn new(
        config: StrategyFeedbackConfig,
        metrics_collector: Arc<dyn ExecutionMetricsCollector>,
        risk_allocator: Arc<dyn RiskAllocator>,
        redis: Option<Arc<dyn RedisClient>>,
    ) -> Self {
        Self {
            config,
            metrics_collector,
            risk_allocator,
            redis,
            strategy_statuses: Arc::new(RwLock::new(HashMap::new())),
            recent_adaptations: Arc::new(Mutex::new(Vec::new())),
            is_running: Arc::new(RwLock::new(false)),
        }
    }
    
    /// Calculate composite score for a strategy
    fn calculate_composite_score(&self, strategy_score: &mut StrategyScore) {
        let weights = &self.config.allocation_weights;
        
        strategy_score.composite_score = 
            weights.eqs_weight * strategy_score.eqs +
            weights.short_term_weight * strategy_score.short_term_perf +
            weights.medium_term_weight * strategy_score.medium_term_perf +
            weights.long_term_weight * strategy_score.long_term_perf +
            weights.decay_weight * strategy_score.decay_score;
    }
    
    /// Record an adaptation event
    async fn record_adaptation(
        &self,
        strategy_id: &StrategyId,
        previous_allocation: f64,
        new_allocation: f64,
        previous_status: AdaptiveStrategyStatus,
        new_status: AdaptiveStrategyStatus,
        reason: &str,
        metrics: HashMap<String, f64>,
    ) -> AdaptationEvent {
        let event = AdaptationEvent {
            strategy_id: strategy_id.clone(),
            timestamp: Utc::now(),
            previous_allocation,
            new_allocation,
            previous_status,
            new_status,
            reason: reason.to_string(),
            metrics,
        };
        
        // Store in recent adaptations
        let mut adaptations = self.recent_adaptations.lock().await;
        adaptations.push(event.clone());
        
        // Keep only the most recent 100 events
        if adaptations.len() > 100 {
            adaptations.remove(0);
        }
        
        // Update strategy status
        {
            let mut statuses = self.strategy_statuses.write().unwrap();
            statuses.insert(strategy_id.clone(), new_status);
        }
        
        // Store in Redis if available
        if let Some(redis) = &self.redis {
            let key = format!("strategy:adaptation:{}", strategy_id);
            let _ = redis.set(&key, &event, Some(86400)).await; // 24-hour TTL
            
            let status_key = format!("strategy:status:{}", strategy_id);
            let status_str = match new_status {
                AdaptiveStrategyStatus::Active => "active",
                AdaptiveStrategyStatus::Reduced => "reduced",
                AdaptiveStrategyStatus::Cooldown => "cooldown",
                AdaptiveStrategyStatus::Deactivated => "deactivated",
                AdaptiveStrategyStatus::Probation => "probation",
            };
            let _ = redis.set(&status_key, &status_str, Some(86400)).await;
        }
        
        event
    }
}

#[async_trait]
impl StrategyFeedbackLoop for DefaultStrategyFeedbackLoop {
    async fn start(&self) -> StrategyFeedbackResult<()> {
        {
            let mut is_running = self.is_running.write().unwrap();
            if *is_running {
                return Err(StrategyFeedbackError::Internal("Feedback loop already running".to_string()));
            }
            *is_running = true;
        }
        
        let feedback_loop = self.clone();
        tokio::spawn(async move {
            let interval_duration = Duration::from_secs(feedback_loop.config.feedback_interval_seconds);
            let mut interval = tokio::time::interval(interval_duration);
            
            loop {
                interval.tick().await;
                
                // Check if we should stop
                {
                    let is_running = feedback_loop.is_running.read().unwrap();
                    if !*is_running {
                        break;
                    }
                }
                
                // Run a feedback cycle
                match feedback_loop.run_feedback_cycle().await {
                    Ok(events) => {
                        if !events.is_empty() {
                            info!("Feedback loop completed with {} adaptation events", events.len());
                            for event in &events {
                                debug!(
                                    "Strategy {} adapted: {} -> {}, allocation: {:.2}% -> {:.2}%",
                                    event.strategy_id,
                                    format!("{:?}", event.previous_status),
                                    format!("{:?}", event.new_status),
                                    event.previous_allocation * 100.0,
                                    event.new_allocation * 100.0
                                );
                            }
                        }
                    }
                    Err(e) => {
                        error!("Error in feedback cycle: {}", e);
                    }
                }
            }
        });
        
        Ok(())
    }
    
    async fn stop(&self) -> StrategyFeedbackResult<()> {
        let mut is_running = self.is_running.write().unwrap();
        *is_running = false;
        Ok(())
    }
    
    async fn run_feedback_cycle(&self) -> StrategyFeedbackResult<Vec<AdaptationEvent>> {
        // Get current allocations
        let current_allocation = match self.risk_allocator.get_current_allocation().await {
            Ok(allocation) => allocation,
            Err(e) => return Err(StrategyFeedbackError::AllocationError(e.to_string())),
        };
        
        // Get all strategy EQS scores
        let all_eqs = self.metrics_collector.get_all_eqs().await?;
        
        // Get all strategy statuses
        let strategy_statuses = {
            let statuses = self.strategy_statuses.read().unwrap();
            statuses.clone()
        };
        
        // Calculate scores for all strategies
        let mut strategy_scores = Vec::new();
        for (strategy_id, allocation) in &current_allocation.strategies {
            // Skip strategies with zero allocation
            if allocation.allocation_pct <= 0.0 {
                continue;
            }
            
            // Get EQS
            let eqs = match all_eqs.get(strategy_id) {
                Some(eqs) => eqs.overall_score,
                None => 0.5, // Default to neutral if no EQS available
            };
            
            // Check for decay
            let (is_decaying, decay_score) = match self.metrics_collector.check_strategy_decay(strategy_id).await {
                Ok(result) => result,
                Err(_) => (false, 1.0), // Default to no decay if error
            };
            
            // Get current status
            let status = strategy_statuses.get(strategy_id)
                .cloned()
                .unwrap_or(AdaptiveStrategyStatus::Active);
            
            // For simplicity, we're using EQS as a proxy for performance metrics
            // In a real system, you would retrieve actual performance from a more detailed source
            let mut score = StrategyScore {
                strategy_id: strategy_id.clone(),
                eqs,
                short_term_perf: eqs, // Simplification - use EQS as performance proxy
                medium_term_perf: eqs,
                long_term_perf: eqs,
                decay_score,
                status,
                composite_score: 0.0,
            };
            
            // Calculate composite score
            self.calculate_composite_score(&mut score);
            
            strategy_scores.push(score);
        }
        
        // Sort strategies by composite score (descending)
        strategy_scores.sort_by(|a, b| b.composite_score.partial_cmp(&a.composite_score).unwrap());
        
        // Calculate new allocations
        let mut new_allocations = HashMap::new();
        let mut adaptation_events = Vec::new();
        
        for score in &strategy_scores {
            let strategy_id = &score.strategy_id;
            let current_allocation_pct = current_allocation.strategies
                .get(strategy_id)
                .map(|a| a.allocation_pct)
                .unwrap_or(0.0);
            
            let current_status = strategy_statuses
                .get(strategy_id)
                .cloned()
                .unwrap_or(AdaptiveStrategyStatus::Active);
            
            let (new_allocation_pct, new_status, reason) = match (score.eqs, score.decay_score, current_status) {
                // Very poor EQS - deactivate
                (eqs, _, _) if eqs < self.config.replacement_eqs_threshold => {
                    (0.0, AdaptiveStrategyStatus::Deactivated, "Very poor execution quality")
                },
                
                // Poor EQS - reduce allocation
                (eqs, _, AdaptiveStrategyStatus::Active) if eqs < self.config.min_eqs_threshold => {
                    let reduced = current_allocation_pct * 0.5; // 50% reduction
                    (reduced, AdaptiveStrategyStatus::Reduced, "Poor execution quality")
                },
                
                // Significant decay - reduce allocation
                (_, decay, AdaptiveStrategyStatus::Active) if decay < self.config.decay_threshold => {
                    let reduced = current_allocation_pct * 0.7; // 30% reduction
                    (reduced, AdaptiveStrategyStatus::Reduced, "Strategy performance decay detected")
                },
                
                // Already reduced, but improving - gradually increase
                (eqs, decay, AdaptiveStrategyStatus::Reduced) 
                    if eqs >= self.config.min_eqs_threshold && decay >= self.config.decay_threshold => {
                    let increased = (current_allocation_pct * 1.2).min(current_allocation_pct + 0.1); // 20% increase capped
                    (increased, AdaptiveStrategyStatus::Probation, "Improving performance - increasing allocation")
                },
                
                // On probation and doing well - restore to active
                (eqs, decay, AdaptiveStrategyStatus::Probation)
                    if eqs >= self.config.min_eqs_threshold && decay >= self.config.decay_threshold => {
                    let restored = (current_allocation_pct * 1.2).min(current_allocation_pct + 0.1); // 20% increase capped
                    (restored, AdaptiveStrategyStatus::Active, "Sustained improvement - restored to active")
                },
                
                // In cooldown with good metrics - move to probation
                (eqs, decay, AdaptiveStrategyStatus::Cooldown)
                    if eqs >= self.config.min_eqs_threshold && decay >= self.config.decay_threshold => {
                    (0.05, AdaptiveStrategyStatus::Probation, "Recovery from cooldown - entering probation")
                },
                
                // Keep current allocation and status for other cases
                _ => (current_allocation_pct, current_status, "No change needed"),
            };
            
            // Only record an event if there's a change
            if new_allocation_pct != current_allocation_pct || new_status != current_status {
                // Limit change to max adjustment percentage
                let max_change = current_allocation_pct * self.config.max_allocation_adjustment_pct;
                let limited_allocation = if new_allocation_pct > current_allocation_pct {
                    (current_allocation_pct + max_change).min(new_allocation_pct)
                } else {
                    (current_allocation_pct - max_change).max(new_allocation_pct)
                };
                
                // Create metrics map for the event
                let mut metrics = HashMap::new();
                metrics.insert("eqs".to_string(), score.eqs);
                metrics.insert("decay_score".to_string(), score.decay_score);
                metrics.insert("composite_score".to_string(), score.composite_score);
                
                // Record the adaptation event
                let event = self.record_adaptation(
                    strategy_id,
                    current_allocation_pct,
                    limited_allocation,
                    current_status,
                    new_status,
                    reason,
                    metrics,
                ).await;
                
                adaptation_events.push(event);
                
                // Store the new allocation
                new_allocations.insert(strategy_id.clone(), limited_allocation);
            } else {
                // No change, keep current allocation
                new_allocations.insert(strategy_id.clone(), current_allocation_pct);
            }
        }
        
        // Update allocations if there are changes
        if !adaptation_events.is_empty() {
            // Convert to a portfolio allocation
            let mut strategies = HashMap::new();
            for (strategy_id, allocation_pct) in new_allocations {
                strategies.insert(
                    strategy_id,
                    StrategyAllocation {
                        allocation_pct,
                        max_allocation_pct: allocation_pct * 1.5, // Simple max calculation
                        min_allocation_pct: 0.0,
                    },
                );
            }
            
            let new_portfolio = PortfolioAllocation {
                strategies,
                allocation_timestamp: Utc::now(),
                total_allocation_pct: 1.0, // Assuming full allocation
            };
            
            // Update the risk allocator
            if let Err(e) = self.risk_allocator.update_allocation(new_portfolio).await {
                error!("Failed to update risk allocation: {}", e);
            }
        }
        
        Ok(adaptation_events)
    }
    
    async fn get_strategy_statuses(&self) -> StrategyFeedbackResult<HashMap<StrategyId, AdaptiveStrategyStatus>> {
        let statuses = self.strategy_statuses.read().unwrap();
        Ok(statuses.clone())
    }
    
    async fn get_recent_adaptations(&self, limit: Option<usize>) -> StrategyFeedbackResult<Vec<AdaptationEvent>> {
        let adaptations = self.recent_adaptations.lock().await;
        let limit = limit.unwrap_or(adaptations.len());
        
        let start_idx = if adaptations.len() > limit {
            adaptations.len() - limit
        } else {
            0
        };
        
        Ok(adaptations[start_idx..].to_vec())
    }
    
    async fn override_strategy_status(
        &self, 
        strategy_id: &StrategyId, 
        status: AdaptiveStrategyStatus,
        reason: &str
    ) -> StrategyFeedbackResult<()> {
        let current_allocation = match self.risk_allocator.get_current_allocation().await {
            Ok(allocation) => allocation,
            Err(e) => return Err(StrategyFeedbackError::AllocationError(e.to_string())),
        };
        
        let current_allocation_pct = current_allocation.strategies
            .get(strategy_id)
            .map(|a| a.allocation_pct)
            .unwrap_or(0.0);
        
        let current_status = {
            let statuses = self.strategy_statuses.read().unwrap();
            statuses.get(strategy_id).cloned().unwrap_or(AdaptiveStrategyStatus::Active)
        };
        
        // Determine new allocation based on status
        let new_allocation_pct = match status {
            AdaptiveStrategyStatus::Active => current_allocation_pct,
            AdaptiveStrategyStatus::Reduced => current_allocation_pct * 0.5,
            AdaptiveStrategyStatus::Cooldown => 0.0,
            AdaptiveStrategyStatus::Deactivated => 0.0,
            AdaptiveStrategyStatus::Probation => current_allocation_pct * 0.7,
        };
        
        // Record the manual override
        let mut metrics = HashMap::new();
        metrics.insert("manual_override".to_string(), 1.0);
        
        let _event = self.record_adaptation(
            strategy_id,
            current_allocation_pct,
            new_allocation_pct,
            current_status,
            status,
            &format!("Manual override: {}", reason),
            metrics,
        ).await;
        
        // Update allocation if needed
        if new_allocation_pct != current_allocation_pct {
            let mut new_allocation = current_allocation.clone();
            if let Some(strategy) = new_allocation.strategies.get_mut(strategy_id) {
                strategy.allocation_pct = new_allocation_pct;
            }
            
            if let Err(e) = self.risk_allocator.update_allocation(new_allocation).await {
                return Err(StrategyFeedbackError::AllocationError(e.to_string()));
            }
        }
        
        Ok(())
    }
}

impl Clone for DefaultStrategyFeedbackLoop {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            metrics_collector: self.metrics_collector.clone(),
            risk_allocator: self.risk_allocator.clone(),
            redis: self.redis.clone(),
            strategy_statuses: self.strategy_statuses.clone(),
            recent_adaptations: self.recent_adaptations.clone(),
            is_running: self.is_running.clone(),
        }
    }
}

/// Factory function to create a strategy feedback loop
pub fn create_strategy_feedback_loop(
    config: StrategyFeedbackConfig,
    metrics_collector: Arc<dyn ExecutionMetricsCollector>,
    risk_allocator: Arc<dyn RiskAllocator>,
    redis: Option<Arc<dyn RedisClient>>,
) -> Arc<dyn StrategyFeedbackLoop> {
    Arc::new(DefaultStrategyFeedbackLoop::new(config, metrics_collector, risk_allocator, redis))
}

/// Factory function with default configuration
pub fn create_default_strategy_feedback_loop(
    metrics_collector: Arc<dyn ExecutionMetricsCollector>,
    risk_allocator: Arc<dyn RiskAllocator>,
    redis: Option<Arc<dyn RedisClient>>,
) -> Arc<dyn StrategyFeedbackLoop> {
    create_strategy_feedback_loop(
        StrategyFeedbackConfig::default(),
        metrics_collector,
        risk_allocator,
        redis,
    )
} 