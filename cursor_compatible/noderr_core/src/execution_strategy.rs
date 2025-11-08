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
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{RwLock, Mutex};
use tracing::{debug, info, error, warn};
use async_trait::async_trait;

use crate::execution::{ExecutionResult, ExecutionStatus};
use crate::order_router::Order;
use crate::strategy::Signal;

/// Errors that can occur during execution strategy selection/execution
#[derive(Debug, Error)]
pub enum ExecutionStrategyError {
    #[error("Strategy not supported: {0}")]
    UnsupportedStrategy(String),
    
    #[error("Order execution failed: {0}")]
    ExecutionFailed(String),
    
    #[error("Invalid order parameters: {0}")]
    InvalidParameters(String),
    
    #[error("Strategy initialization failed: {0}")]
    InitializationFailed(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Supported execution algorithm types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionAlgorithm {
    /// Time Weighted Average Price
    TWAP,
    /// Volume Weighted Average Price
    VWAP,
    /// Implementation Shortfall
    ImplementationShortfall,
    /// Iceberg/Hiding
    Iceberg,
    /// Pegged
    Pegged,
    /// Direct Market Access
    DMA,
    /// Smart Order Routing
    SmartOrderRouting,
}

/// Latency-sensitive execution strategy configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionStrategyConfig {
    /// Default strategy to use when not specified
    pub default_strategy: ExecutionAlgorithm,
    /// Minimum order size to use TWAP
    pub min_order_size_for_twap: f64,
    /// Minimum order size to use VWAP
    pub min_order_size_for_vwap: f64,
    /// TWAP-specific configuration
    pub twap_config: Option<TWAPConfig>,
    /// VWAP-specific configuration
    pub vwap_config: Option<VWAPConfig>,
    /// Maximum execution time in milliseconds
    pub max_execution_time_ms: u64,
    /// Strategies to use for specific symbols
    pub symbol_strategy_map: HashMap<String, ExecutionAlgorithm>,
}

impl Default for ExecutionStrategyConfig {
    fn default() -> Self {
        Self {
            default_strategy: ExecutionAlgorithm::TWAP,
            min_order_size_for_twap: 1000.0,
            min_order_size_for_vwap: 5000.0,
            twap_config: Some(TWAPConfig::default()),
            vwap_config: Some(VWAPConfig::default()),
            max_execution_time_ms: 300000, // 5 minutes
            symbol_strategy_map: HashMap::new(),
        }
    }
}

/// TWAP (Time Weighted Average Price) configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TWAPConfig {
    /// Number of slices to divide the order into
    pub slices: u32,
    /// Time interval between slices in milliseconds
    pub interval_ms: u64,
    /// Maximum interval deviation (randomization) in milliseconds
    pub max_interval_deviation_ms: u64,
    /// Minimum execution percentage required to consider successful
    pub min_execution_pct: f64,
    /// Whether to randomize slice sizes
    pub randomize_sizes: bool,
    /// Size deviation percentage for randomization
    pub size_deviation_pct: f64,
}

impl Default for TWAPConfig {
    fn default() -> Self {
        Self {
            slices: 5,
            interval_ms: 60000, // 1 minute
            max_interval_deviation_ms: 10000, // 10 seconds
            min_execution_pct: 0.95, // 95%
            randomize_sizes: true,
            size_deviation_pct: 0.1, // 10%
        }
    }
}

/// VWAP (Volume Weighted Average Price) configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VWAPConfig {
    /// Start time offset in milliseconds
    pub start_time_offset_ms: i64,
    /// End time offset in milliseconds
    pub end_time_offset_ms: i64,
    /// Maximum participation rate as percentage of volume
    pub max_participation_rate: f64,
    /// Minimum execution percentage required to consider successful
    pub min_execution_pct: f64,
    /// Use historical volume profile
    pub use_historical_profile: bool,
    /// Volume profile to use
    pub volume_profile: Option<Vec<f64>>,
}

impl Default for VWAPConfig {
    fn default() -> Self {
        Self {
            start_time_offset_ms: 0,
            end_time_offset_ms: 3600000, // 1 hour
            max_participation_rate: 0.25, // 25%
            min_execution_pct: 0.95, // 95%
            use_historical_profile: true,
            volume_profile: None,
        }
    }
}

/// Execution strategy trait for algorithm implementations
#[async_trait]
pub trait ExecutionStrategy: Send + Sync {
    /// Execute the order using this strategy
    async fn execute(
        &self,
        order: Order,
        callback: Arc<dyn Fn(ExecutionResult) + Send + Sync>,
    ) -> Result<(), ExecutionStrategyError>;
    
    /// Estimate market impact using this strategy
    async fn estimate_impact(&self, order: &Order) -> Result<f64, ExecutionStrategyError>;
    
    /// Estimate execution cost using this strategy
    async fn get_cost_estimate(&self, order: &Order) -> Result<f64, ExecutionStrategyError>;
    
    /// Get strategy details
    fn get_details(&self) -> ExecutionStrategyDetails;
    
    /// Cancel ongoing execution
    async fn cancel(&self) -> Result<(), ExecutionStrategyError>;
}

/// Execution strategy details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionStrategyDetails {
    /// Strategy type
    pub strategy_type: ExecutionAlgorithm,
    /// Strategy name
    pub name: String,
    /// Strategy description
    pub description: String,
    /// Strategy parameters
    pub parameters: HashMap<String, serde_json::Value>,
}

/// Execution strategy router
pub struct ExecutionStrategyRouter {
    /// Router configuration
    config: Arc<RwLock<ExecutionStrategyConfig>>,
    /// TWAP strategy instance
    twap_executor: Arc<dyn ExecutionStrategy>,
    /// VWAP strategy instance
    vwap_executor: Arc<dyn ExecutionStrategy>,
    /// Other strategy executors
    strategy_executors: HashMap<ExecutionAlgorithm, Arc<dyn ExecutionStrategy>>,
    /// Active executions
    active_executions: Arc<Mutex<HashMap<String, ExecutionAlgorithm>>>,
}

impl ExecutionStrategyRouter {
    /// Create a new execution strategy router
    pub fn new(
        config: ExecutionStrategyConfig,
        twap_executor: Arc<dyn ExecutionStrategy>,
        vwap_executor: Arc<dyn ExecutionStrategy>,
    ) -> Self {
        let mut strategy_executors = HashMap::new();
        strategy_executors.insert(ExecutionAlgorithm::TWAP, Arc::clone(&twap_executor));
        strategy_executors.insert(ExecutionAlgorithm::VWAP, Arc::clone(&vwap_executor));
        
        Self {
            config: Arc::new(RwLock::new(config)),
            twap_executor,
            vwap_executor,
            strategy_executors,
            active_executions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    /// Register an additional strategy executor
    pub fn register_strategy(
        &mut self,
        algorithm: ExecutionAlgorithm,
        executor: Arc<dyn ExecutionStrategy>,
    ) {
        self.strategy_executors.insert(algorithm, executor);
    }
    
    /// Execute an order with appropriate strategy
    pub async fn execute(
        &self,
        order: Order,
        on_complete: Arc<dyn Fn(ExecutionResult) + Send + Sync>,
    ) -> Result<(), ExecutionStrategyError> {
        // Select the best strategy for this order
        let strategy = self.select_execution_strategy(&order).await;
        info!("Selected {:?} execution strategy for order {}", strategy, order.id);
        
        // Record active execution
        {
            let mut active_executions = self.active_executions.lock().await;
            active_executions.insert(order.id.clone(), strategy);
        }
        
        // Create callback that will remove from active executions
        let active_executions = Arc::clone(&self.active_executions);
        let order_id = order.id.clone();
        let callback = Arc::new(move |result: ExecutionResult| {
            // Forward result to original callback
            on_complete(result.clone());
            
            // Remove from active executions
            tokio::spawn(async move {
                let mut active_executions = active_executions.lock().await;
                active_executions.remove(&order_id);
            });
        });
        
        // Execute using selected strategy
        let executor = self.get_executor(strategy)
            .ok_or_else(|| ExecutionStrategyError::UnsupportedStrategy(format!("{:?}", strategy)))?;
        
        executor.execute(order, callback).await
    }
    
    /// Estimate impact of executing an order
    pub async fn estimate_impact(&self, order: &Order) -> Result<f64, ExecutionStrategyError> {
        let strategy = self.select_execution_strategy(order).await;
        let executor = self.get_executor(strategy)
            .ok_or_else(|| ExecutionStrategyError::UnsupportedStrategy(format!("{:?}", strategy)))?;
        
        executor.estimate_impact(order).await
    }
    
    /// Get cost estimate for executing an order
    pub async fn get_cost_estimate(&self, order: &Order) -> Result<f64, ExecutionStrategyError> {
        let strategy = self.select_execution_strategy(order).await;
        let executor = self.get_executor(strategy)
            .ok_or_else(|| ExecutionStrategyError::UnsupportedStrategy(format!("{:?}", strategy)))?;
        
        executor.get_cost_estimate(order).await
    }
    
    /// Cancel execution for an order
    pub async fn cancel_execution(&self, order_id: &str) -> Result<(), ExecutionStrategyError> {
        let active_executions = self.active_executions.lock().await;
        
        if let Some(strategy) = active_executions.get(order_id) {
            let executor = self.get_executor(*strategy)
                .ok_or_else(|| ExecutionStrategyError::UnsupportedStrategy(format!("{:?}", strategy)))?;
            
            executor.cancel().await
        } else {
            Err(ExecutionStrategyError::ExecutionFailed(
                format!("No active execution found for order ID: {}", order_id)
            ))
        }
    }
    
    /// Update router configuration
    pub async fn update_config(&self, config: ExecutionStrategyConfig) {
        let mut current_config = self.config.write().await;
        *current_config = config;
    }
    
    /// Get executor for a strategy
    fn get_executor(&self, strategy: ExecutionAlgorithm) -> Option<Arc<dyn ExecutionStrategy>> {
        self.strategy_executors.get(&strategy).cloned()
    }
    
    /// Select the appropriate execution strategy for an order
    async fn select_execution_strategy(&self, order: &Order) -> ExecutionAlgorithm {
        let config = self.config.read().await;
        
        // Check if order has a specific execution mode in additional_params
        if let Some(serde_json::Value::String(mode)) = order.additional_params.get("executionMode") {
            match mode.as_str() {
                "TWAP" => return ExecutionAlgorithm::TWAP,
                "VWAP" => return ExecutionAlgorithm::VWAP,
                "Iceberg" => return ExecutionAlgorithm::Iceberg,
                "DMA" => return ExecutionAlgorithm::DMA,
                _ => {} // Fall through to other selection methods
            }
        }
        
        // Check symbol-specific strategy mapping
        if let Some(strategy) = config.symbol_strategy_map.get(&order.symbol) {
            return *strategy;
        }
        
        // Select based on order size
        if order.amount >= config.min_order_size_for_vwap {
            ExecutionAlgorithm::VWAP
        } else if order.amount >= config.min_order_size_for_twap {
            ExecutionAlgorithm::TWAP
        } else {
            // Default to configured strategy
            config.default_strategy
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    struct MockStrategy {
        strategy_type: ExecutionAlgorithm,
        name: String,
    }
    
    #[async_trait]
    impl ExecutionStrategy for MockStrategy {
        async fn execute(
            &self,
            _order: Order,
            callback: Arc<dyn Fn(ExecutionResult) + Send + Sync>,
        ) -> Result<(), ExecutionStrategyError> {
            // Create a mock result
            let result = ExecutionResult {
                id: "mock-execution".to_string(),
                request_id: "mock-request".to_string(),
                signal_id: "mock-signal".to_string(),
                status: ExecutionStatus::Completed,
                order_id: Some("mock-order".to_string()),
                executed_quantity: Some(100.0),
                average_price: Some(100.0),
                fee_info: None,
                fees: None,
                fee_currency: None,
                timestamp: chrono::Utc::now(),
                execution_time_ms: 0,
                latency_profile: None,
                error_message: None,
                error_context: None,
                realized_pnl: 0.0,
                additional_data: HashMap::new(),
                rejection_details: None,
                trust_score: None,
            };
            
            callback(result);
            Ok(())
        }
        
        async fn estimate_impact(&self, _order: &Order) -> Result<f64, ExecutionStrategyError> {
            Ok(0.001)
        }
        
        async fn get_cost_estimate(&self, order: &Order) -> Result<f64, ExecutionStrategyError> {
            Ok(order.amount * 0.001)
        }
        
        fn get_details(&self) -> ExecutionStrategyDetails {
            ExecutionStrategyDetails {
                strategy_type: self.strategy_type,
                name: self.name.clone(),
                description: "Mock strategy for testing".to_string(),
                parameters: HashMap::new(),
            }
        }
        
        async fn cancel(&self) -> Result<(), ExecutionStrategyError> {
            Ok(())
        }
    }
    
    #[tokio::test]
    async fn test_strategy_selection() {
        let twap = Arc::new(MockStrategy {
            strategy_type: ExecutionAlgorithm::TWAP,
            name: "TWAP".to_string(),
        });
        
        let vwap = Arc::new(MockStrategy {
            strategy_type: ExecutionAlgorithm::VWAP,
            name: "VWAP".to_string(),
        });
        
        let config = ExecutionStrategyConfig {
            min_order_size_for_twap: 1000.0,
            min_order_size_for_vwap: 5000.0,
            ..Default::default()
        };
        
        let router = ExecutionStrategyRouter::new(
            config,
            twap,
            vwap,
        );
        
        // Small order should use default (TWAP)
        let small_order = Order {
            id: "small".to_string(),
            symbol: "BTC/USD".to_string(),
            side: crate::order_router::OrderSide::Buy,
            amount: 500.0,
            price: 50000.0,
            venues: vec!["binance".to_string()],
            max_slippage: None,
            max_retries: None,
            additional_params: HashMap::new(),
        };
        
        // Medium order should use TWAP
        let medium_order = Order {
            id: "medium".to_string(),
            symbol: "BTC/USD".to_string(),
            side: crate::order_router::OrderSide::Buy,
            amount: 2000.0,
            price: 50000.0,
            venues: vec!["binance".to_string()],
            max_slippage: None,
            max_retries: None,
            additional_params: HashMap::new(),
        };
        
        // Large order should use VWAP
        let large_order = Order {
            id: "large".to_string(),
            symbol: "BTC/USD".to_string(),
            side: crate::order_router::OrderSide::Buy,
            amount: 10000.0,
            price: 50000.0,
            venues: vec!["binance".to_string()],
            max_slippage: None,
            max_retries: None,
            additional_params: HashMap::new(),
        };
        
        // Order with explicit execution mode
        let mut explicit_params = HashMap::new();
        explicit_params.insert(
            "executionMode".to_string(),
            serde_json::Value::String("VWAP".to_string()),
        );
        
        let explicit_order = Order {
            id: "explicit".to_string(),
            symbol: "BTC/USD".to_string(),
            side: crate::order_router::OrderSide::Buy,
            amount: 500.0, // Small, but should still use VWAP due to explicit mode
            price: 50000.0,
            venues: vec!["binance".to_string()],
            max_slippage: None,
            max_retries: None,
            additional_params: explicit_params,
        };
        
        assert_eq!(
            router.select_execution_strategy(&small_order).await,
            ExecutionAlgorithm::TWAP
        );
        
        assert_eq!(
            router.select_execution_strategy(&medium_order).await,
            ExecutionAlgorithm::TWAP
        );
        
        assert_eq!(
            router.select_execution_strategy(&large_order).await,
            ExecutionAlgorithm::VWAP
        );
        
        assert_eq!(
            router.select_execution_strategy(&explicit_order).await,
            ExecutionAlgorithm::VWAP
        );
    }
} 