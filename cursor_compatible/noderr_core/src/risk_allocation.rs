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
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use serde::{Serialize, Deserialize};

use crate::correlation_engine::{CorrelationEngine, CorrelationError, StrategyRiskWeights, TimePeriod};
use crate::risk::{RiskManager, RiskManagerConfig, RiskMetrics, PositionSizing};
use crate::strategy::{StrategyId, SignalAction, StrategyPerformance};
use crate::strategy_executor::StrategyExecutor;

/// Errors that can occur in risk allocation
#[derive(Debug, Error)]
pub enum RiskAllocationError {
    #[error("Correlation error: {0}")]
    CorrelationError(#[from] CorrelationError),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for risk allocation operations
pub type RiskAllocationResult<T> = Result<T, RiskAllocationError>;

/// Configuration for the risk allocation optimizer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAllocationConfig {
    /// Whether to enable correlation-based risk allocation
    pub enabled: bool,
    
    /// Time period for correlation analysis
    pub correlation_period: TimePeriod,
    
    /// Minimum correlation threshold to consider two strategies correlated
    pub correlation_threshold: f64,
    
    /// Maximum allocation to a single strategy
    pub max_strategy_allocation: f64,
    
    /// Minimum allocation to a single strategy (if allocated at all)
    pub min_strategy_allocation: f64,
    
    /// How often to recalculate allocations (in seconds)
    pub update_interval_sec: u64,
    
    /// Weight given to drawdown in allocation decisions (0.0-1.0)
    pub drawdown_weight: f64,
    
    /// Weight given to volatility in allocation decisions (0.0-1.0)
    pub volatility_weight: f64,
    
    /// Weight given to Sharpe ratio in allocation decisions (0.0-1.0)
    pub sharpe_weight: f64,
    
    /// Penalty factor for correlated strategies (multiplicative)
    pub correlation_penalty: f64,
}

impl Default for RiskAllocationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            correlation_period: TimePeriod::Daily,
            correlation_threshold: 0.7,
            max_strategy_allocation: 0.25,
            min_strategy_allocation: 0.01,
            update_interval_sec: 3600,  // 1 hour
            drawdown_weight: 0.3,
            volatility_weight: 0.3,
            sharpe_weight: 0.4,
            correlation_penalty: 0.5,
        }
    }
}

/// Strategy performance metrics used for allocation decisions
#[derive(Debug, Clone)]
pub struct StrategyAllocationMetrics {
    /// Strategy ID
    pub strategy_id: StrategyId,
    
    /// Win rate (0.0-1.0)
    pub win_rate: f64,
    
    /// Current drawdown as percentage (0.0-1.0)
    pub current_drawdown: f64,
    
    /// Historical volatility (0.0-1.0)
    pub volatility: f64,
    
    /// Sharpe ratio or null
    pub sharpe_ratio: Option<f64>,
    
    /// Profit factor (>1.0 is profitable)
    pub profit_factor: f64,
    
    /// Return on investment
    pub roi: f64,
    
    /// Risk score (0.0-1.0) where higher means riskier
    pub risk_score: f64,
    
    /// Performance score (0.0-1.0) where higher is better
    pub performance_score: f64,
}

/// Strategy risk allocation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyAllocation {
    /// Strategy ID
    pub strategy_id: StrategyId,
    
    /// Allocation percentage (0.0-1.0)
    pub allocation: f64,
    
    /// Base allocation before adjustments
    pub base_allocation: f64,
    
    /// Allocation adjustments and rationale
    pub adjustments: HashMap<String, f64>,
}

/// Portfolio-wide allocation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioAllocation {
    /// When this allocation was calculated
    pub timestamp: DateTime<Utc>,
    
    /// Individual strategy allocations
    pub allocations: Vec<StrategyAllocation>,
    
    /// Additional factors used in allocation
    pub factors: HashMap<String, f64>,
    
    /// Total allocated percentage (should sum to 1.0)
    pub total_allocation: f64,
}

/// Trait for risk allocation optimizers
#[async_trait]
pub trait RiskAllocator: Send + Sync {
    /// Calculate optimal risk allocation across strategies
    async fn optimize_allocation(&self) -> RiskAllocationResult<PortfolioAllocation>;
    
    /// Get current allocation for a specific strategy
    async fn get_strategy_allocation(&self, strategy_id: &StrategyId) -> Option<f64>;
    
    /// Get current portfolio allocation
    async fn get_portfolio_allocation(&self) -> Option<PortfolioAllocation>;
    
    /// Update allocation based on latest performance metrics
    async fn update_allocation(&self) -> RiskAllocationResult<()>;
    
    /// Apply allocation to risk manager
    async fn apply_to_risk_manager(&self, risk_manager: &dyn RiskManager) -> RiskAllocationResult<()>;
    
    /// Initialize the risk allocator
    async fn initialize(&self) -> RiskAllocationResult<()>;
}

/// Default implementation of risk allocator using correlation engine
pub struct CorrelationRiskAllocator {
    /// Configuration
    config: RiskAllocationConfig,
    
    /// Correlation engine
    correlation_engine: Arc<dyn CorrelationEngine>,
    
    /// Strategy executor for getting performance metrics
    strategy_executor: Arc<StrategyExecutor>,
    
    /// Current portfolio allocation
    current_allocation: Arc<RwLock<Option<PortfolioAllocation>>>,
    
    /// Last update time
    last_update: Arc<RwLock<Instant>>,
}

impl CorrelationRiskAllocator {
    /// Create a new CorrelationRiskAllocator
    pub fn new(
        config: RiskAllocationConfig,
        correlation_engine: Arc<dyn CorrelationEngine>,
        strategy_executor: Arc<StrategyExecutor>,
    ) -> Self {
        Self {
            config,
            correlation_engine,
            strategy_executor,
            current_allocation: Arc::new(RwLock::new(None)),
            last_update: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(3600))), // Force immediate update
        }
    }
    
    /// Create a simple default allocator
    pub fn default(
        correlation_engine: Arc<dyn CorrelationEngine>,
        strategy_executor: Arc<StrategyExecutor>,
    ) -> Self {
        Self::new(
            RiskAllocationConfig::default(),
            correlation_engine,
            strategy_executor,
        )
    }
    
    /// Calculate performance score for a strategy
    fn calculate_performance_score(&self, metrics: &StrategyPerformance, risk_metrics: &RiskMetrics) -> f64 {
        let mut score = 0.0;
        let mut weight_sum = 0.0;
        
        // Win rate component
        if metrics.win_rate > 0.0 {
            score += metrics.win_rate * 0.4;
            weight_sum += 0.4;
        }
        
        // Sharpe ratio component (if available)
        if let Some(sharpe) = metrics.sharpe {
            // Normalize Sharpe to 0-1 range (assuming 3.0 is excellent)
            let normalized_sharpe = (sharpe / 3.0).min(1.0).max(0.0);
            score += normalized_sharpe * self.config.sharpe_weight;
            weight_sum += self.config.sharpe_weight;
        }
        
        // Drawdown component (lower is better)
        let drawdown_score = 1.0 - risk_metrics.max_drawdown_pct.min(1.0);
        score += drawdown_score * self.config.drawdown_weight;
        weight_sum += self.config.drawdown_weight;
        
        // Volatility component (lower is better)
        if let Some(vol) = risk_metrics.historical_volatility {
            let volatility_score = 1.0 - vol.min(1.0);
            score += volatility_score * self.config.volatility_weight;
            weight_sum += self.config.volatility_weight;
        }
        
        // Profit factor component
        if risk_metrics.profit_factor > 1.0 {
            // Normalize to 0-1 (assuming 3.0 is excellent)
            let profit_factor_score = ((risk_metrics.profit_factor - 1.0) / 2.0).min(1.0);
            score += profit_factor_score * 0.3;
            weight_sum += 0.3;
        }
        
        // Normalize final score
        if weight_sum > 0.0 {
            score / weight_sum
        } else {
            0.5 // Default moderate score
        }
    }
    
    /// Calculate risk score for a strategy (higher = riskier)
    fn calculate_risk_score(&self, risk_metrics: &RiskMetrics) -> f64 {
        let mut risk_score = 0.0;
        let mut weight_sum = 0.0;
        
        // Drawdown component
        risk_score += risk_metrics.max_drawdown_pct.min(1.0) * 0.4;
        weight_sum += 0.4;
        
        // Volatility component
        if let Some(vol) = risk_metrics.historical_volatility {
            risk_score += vol.min(1.0) * 0.4;
            weight_sum += 0.4;
        }
        
        // Win rate component (inverse - lower win rate = higher risk)
        if risk_metrics.win_rate > 0.0 {
            risk_score += (1.0 - risk_metrics.win_rate) * 0.2;
        } else {
            risk_score += 0.2; // Maximum risk for this component
        }
        weight_sum += 0.2;
        
        // Normalize
        if weight_sum > 0.0 {
            risk_score / weight_sum
        } else {
            0.5 // Default moderate risk
        }
    }
    
    /// Calculate base allocations before correlation adjustment
    async fn calculate_base_allocations(&self) -> RiskAllocationResult<HashMap<StrategyId, f64>> {
        let mut base_allocations = HashMap::new();
        let mut performance_scores = HashMap::new();
        let mut total_score = 0.0;
        
        // Get all strategy performance metrics
        let all_performance = self.strategy_executor.get_all_strategy_performance();
        if all_performance.is_empty() {
            return Err(RiskAllocationError::InsufficientData(
                "No strategy performance data available".to_string()
            ));
        }
        
        // Calculate performance scores for each strategy
        for (strategy_id, performance) in all_performance {
            // Skip strategies with insufficient data
            if performance.total_trades < 10 {
                continue;
            }
            
            // Get risk metrics
            let risk_metrics = if let Some(metrics) = self.strategy_executor.get_risk_manager().get_risk_metrics(&strategy_id).await {
                metrics
            } else {
                // Default risk metrics if none found
                RiskMetrics::default()
            };
            
            // Calculate performance score
            let performance_score = self.calculate_performance_score(&performance, &risk_metrics);
            
            // Store score
            performance_scores.insert(strategy_id.clone(), performance_score);
            total_score += performance_score;
        }
        
        // Skip if no strategies have sufficient performance data
        if performance_scores.is_empty() {
            return Err(RiskAllocationError::InsufficientData(
                "No strategies with sufficient performance data".to_string()
            ));
        }
        
        // Calculate base allocations proportional to performance scores
        for (strategy_id, score) in performance_scores {
            let allocation = if total_score > 0.0 {
                (score / total_score).min(self.config.max_strategy_allocation)
            } else {
                // Equal allocation if no scores
                1.0 / performance_scores.len() as f64
            };
            
            // Apply minimum threshold
            if allocation >= self.config.min_strategy_allocation {
                base_allocations.insert(strategy_id, allocation);
            }
        }
        
        // Renormalize after applying max/min thresholds
        let total_allocation: f64 = base_allocations.values().sum();
        if total_allocation > 0.0 {
            for allocation in base_allocations.values_mut() {
                *allocation /= total_allocation;
            }
        }
        
        Ok(base_allocations)
    }
}

#[async_trait]
impl RiskAllocator for CorrelationRiskAllocator {
    async fn initialize(&self) -> RiskAllocationResult<()> {
        // Initial allocation
        self.update_allocation().await?;
        
        info!("Correlation-based risk allocator initialized");
        Ok(())
    }
    
    async fn optimize_allocation(&self) -> RiskAllocationResult<PortfolioAllocation> {
        // Check for cached allocation that's still fresh
        {
            let last_update = self.last_update.read().await;
            let current = self.current_allocation.read().await;
            
            if let Some(allocation) = &*current {
                if last_update.elapsed() < Duration::from_secs(self.config.update_interval_sec) {
                    return Ok(allocation.clone());
                }
            }
        }
        
        // Calculate base allocations (performance-weighted)
        let base_allocations = self.calculate_base_allocations().await?;
        
        if base_allocations.is_empty() {
            return Err(RiskAllocationError::InsufficientData(
                "No strategies with sufficient data for allocation".to_string()
            ));
        }
        
        // Apply correlation-based adjustments if enabled
        let final_allocations = if self.config.enabled {
            // Get correlation-adjusted weights
            let adjusted = self.correlation_engine
                .calculate_risk_weights(base_allocations.clone())
                .await
                .map_err(RiskAllocationError::from)?;
            
            adjusted.adjusted_weights
        } else {
            base_allocations.clone()
        };
        
        // Convert to StrategyAllocation format with adjustments
        let mut allocations = Vec::with_capacity(final_allocations.len());
        for (strategy_id, allocation) in &final_allocations {
            let base = base_allocations.get(strategy_id).cloned().unwrap_or(0.0);
            
            let mut adjustments = HashMap::new();
            if (base - allocation).abs() > 0.001 {
                // Add correlation adjustment factor
                adjustments.insert("correlation".to_string(), allocation / base);
            }
            
            allocations.push(StrategyAllocation {
                strategy_id: strategy_id.clone(),
                allocation: *allocation,
                base_allocation: base,
                adjustments,
            });
        }
        
        // Create portfolio allocation
        let result = PortfolioAllocation {
            timestamp: Utc::now(),
            allocations,
            factors: HashMap::new(), // Additional factors could be added here
            total_allocation: final_allocations.values().sum(),
        };
        
        // Update cache
        {
            let mut current = self.current_allocation.write().await;
            *current = Some(result.clone());
            
            let mut last_update = self.last_update.write().await;
            *last_update = Instant::now();
        }
        
        Ok(result)
    }
    
    async fn get_strategy_allocation(&self, strategy_id: &StrategyId) -> Option<f64> {
        let current = self.current_allocation.read().await;
        
        if let Some(allocation) = &*current {
            allocation.allocations.iter()
                .find(|a| &a.strategy_id == strategy_id)
                .map(|a| a.allocation)
        } else {
            None
        }
    }
    
    async fn get_portfolio_allocation(&self) -> Option<PortfolioAllocation> {
        let current = self.current_allocation.read().await;
        current.clone()
    }
    
    async fn update_allocation(&self) -> RiskAllocationResult<()> {
        let allocation = self.optimize_allocation().await?;
        
        info!(
            "Updated risk allocation for {} strategies, total allocation: {:.2}%", 
            allocation.allocations.len(),
            allocation.total_allocation * 100.0
        );
        
        Ok(())
    }
    
    async fn apply_to_risk_manager(&self, risk_manager: &dyn RiskManager) -> RiskAllocationResult<()> {
        let allocation = self.optimize_allocation().await?;
        
        // Get current risk manager config
        let mut config = risk_manager.get_config();
        
        // Apply allocations to each strategy
        for strategy_alloc in &allocation.allocations {
            // Skip small allocations
            if strategy_alloc.allocation < self.config.min_strategy_allocation {
                continue;
            }
            
            // TODO: In a real implementation, we would need to update
            // per-strategy allocation limits in the risk manager.
            // For now, we'll just log the allocations.
            debug!(
                "Applying allocation for strategy {}: {:.2}%", 
                strategy_alloc.strategy_id,
                strategy_alloc.allocation * 100.0
            );
        }
        
        // Update overall allocation limit to match our calculated total
        config.max_portfolio_allocation = allocation.total_allocation.min(1.0);
        
        // Apply updated config
        risk_manager.update_config(config).await
            .map_err(|e| RiskAllocationError::Internal(format!("Failed to update risk manager config: {}", e)))?;
        
        info!("Applied optimized allocations to risk manager");
        Ok(())
    }
}

/// Factory for creating risk allocators
pub struct RiskAllocatorFactory;

impl RiskAllocatorFactory {
    /// Create a default correlation-based risk allocator
    pub fn create_default(
        correlation_engine: Arc<dyn CorrelationEngine>,
        strategy_executor: Arc<StrategyExecutor>,
    ) -> Arc<dyn RiskAllocator> {
        Arc::new(CorrelationRiskAllocator::default(
            correlation_engine,
            strategy_executor,
        ))
    }
    
    /// Create a custom risk allocator with specific configuration
    pub fn create_custom(
        config: RiskAllocationConfig,
        correlation_engine: Arc<dyn CorrelationEngine>,
        strategy_executor: Arc<StrategyExecutor>,
    ) -> Arc<dyn RiskAllocator> {
        Arc::new(CorrelationRiskAllocator::new(
            config,
            correlation_engine,
            strategy_executor,
        ))
    }
}

/// Create a risk allocator with default configuration
pub fn create_risk_allocator(
    correlation_engine: Arc<dyn CorrelationEngine>,
    strategy_executor: Arc<StrategyExecutor>,
) -> Arc<dyn RiskAllocator> {
    RiskAllocatorFactory::create_default(correlation_engine, strategy_executor)
}

/// Create a risk allocator with custom configuration
pub fn create_risk_allocator_with_config(
    config: RiskAllocationConfig,
    correlation_engine: Arc<dyn CorrelationEngine>,
    strategy_executor: Arc<StrategyExecutor>,
) -> Arc<dyn RiskAllocator> {
    RiskAllocatorFactory::create_custom(config, correlation_engine, strategy_executor)
} 