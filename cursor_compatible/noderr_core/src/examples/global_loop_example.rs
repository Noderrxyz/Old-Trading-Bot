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
use std::time::Duration;
use chrono::Utc;
use tokio::time;
use tracing::{debug, error, info, warn};

use crate::market::{MarketData, MockMarketDataProvider};
use crate::strategy::{Signal, StrategyId, StrategyPerformance};
use crate::execution::{ExecutionResult, ExecutionService, MockExecutionProvider};
use crate::risk::{DefaultRiskManager, RiskManagerConfig};
use crate::telemetry::{TelemetryConfig, TelemetryReporter};
use crate::strategy_executor::{MarketDataProvider, StrategyExecutor, StrategyExecutorConfig};
use crate::storage::{create_storage, StorageConfig, StorageType, StoredExecution, PerformanceImpact, TimeRange, StrategyStorage};

/// Example showing a global execution loop with persistence
pub async fn run_global_loop_example() {
    // Initialize components
    info!("Starting global execution loop example");
    
    // 1. Set up telemetry
    let telemetry_config = TelemetryConfig {
        enable_persistence: true,
        ..Default::default()
    };
    let telemetry = Arc::new(TelemetryReporter::new(telemetry_config));
    
    // 2. Set up storage
    let storage_config = StorageConfig {
        storage_type: StorageType::Memory, // Use in-memory for example
        ..Default::default()
    };
    let storage = create_storage(storage_config);
    
    // 3. Set up market data
    let market_data_provider = Arc::new(build_mock_market_data_provider());
    
    // 4. Set up execution service
    let execution_provider = Arc::new(MockExecutionProvider::new());
    let execution_service = Arc::new(ExecutionService::new_with_providers(
        execution_provider.clone(),
        execution_provider.clone(),
        None,
    ));
    
    // 5. Set up risk manager
    let risk_config = RiskManagerConfig::default();
    let risk_manager = Arc::new(DefaultRiskManager::new(risk_config));
    
    // 6. Set up strategies (would come from a strategy factory in a real system)
    let strategies = build_example_strategies();
    
    // 7. Set up strategy executor
    let executor_config = StrategyExecutorConfig::default();
    let strategy_executor = Arc::new(StrategyExecutor::with_config(
        strategies,
        risk_manager,
        None, // No entropy injector for simplicity
        telemetry.clone(),
        execution_service.clone(),
        executor_config,
    ));
    
    // Start global execution loop in a separate task
    tokio::spawn({
        let executor = strategy_executor.clone();
        let market_provider = market_data_provider.clone();
        let storage = storage.clone();
        let telemetry = telemetry.clone();
        
        async move {
            global_execution_loop(executor, market_provider, storage, telemetry).await;
        }
    });
    
    // For demonstration purposes, let the loop run for a while
    time::sleep(Duration::from_secs(60)).await;
    
    // In a real system, you'd wait for a shutdown signal
    info!("Global execution loop example completed");
}

/// The global execution loop that processes market data and persists results
async fn global_execution_loop(
    executor: Arc<StrategyExecutor>,
    market_provider: Arc<dyn MarketDataProvider>,
    storage: Arc<dyn StrategyStorage>,
    telemetry: Arc<TelemetryReporter>,
) {
    info!("Starting global execution loop");
    
    // Set up interval for the loop
    let interval_duration = Duration::from_secs(30);
    let mut interval = time::interval(interval_duration);
    
    // Performance tracking
    let mut performance_tracker = HashMap::new();
    
    loop {
        interval.tick().await;
        info!("Executing strategy cycle");
        
        // Fetch market data
        match market_provider.get_latest_market_data().await {
            Ok(market_data) => {
                // Execute strategy cycle
                let results = executor.execute_cycle(&market_data).await;
                
                // Process and store results
                for result in results {
                    // Get the signal that led to this execution
                    if let Some(signal) = &result.signal {
                        let strategy_id = signal.strategy_id.clone();
                        
                        // Calculate performance impact
                        let current_performance = executor.get_strategy_performance(&strategy_id)
                            .unwrap_or_default();
                        
                        // Get previous performance or create default
                        let prev_performance = performance_tracker
                            .entry(strategy_id.clone())
                            .or_insert_with(StrategyPerformance::default);
                        
                        // Calculate differences
                        let pnl_change = current_performance.pnl - prev_performance.pnl;
                        let drawdown_change = current_performance.current_drawdown - prev_performance.current_drawdown;
                        let is_win = pnl_change > 0.0;
                        let trust_score_change = current_performance.trust_score - prev_performance.trust_score;
                        
                        // Update tracked performance
                        *prev_performance = current_performance.clone();
                        
                        // Create stored execution
                        let stored_execution = StoredExecution {
                            id: result.id.clone(),
                            strategy_id: strategy_id.clone(),
                            symbol: signal.symbol.clone(),
                            timestamp: Utc::now(),
                            signal: signal.clone(),
                            result: result.clone(),
                            performance_impact: Some(PerformanceImpact {
                                pnl_change,
                                drawdown_change,
                                is_win,
                                trust_score_change,
                            }),
                        };
                        
                        // Store execution
                        if let Err(e) = storage.store_execution(stored_execution).await {
                            error!("Failed to store execution: {}", e);
                        }
                        
                        // Store performance snapshot
                        if let Err(e) = storage.store_performance(&strategy_id, &current_performance).await {
                            error!("Failed to store performance: {}", e);
                        }
                    }
                }
                
                // Run storage maintenance (cleanup old data)
                if let Err(e) = storage.run_maintenance().await {
                    warn!("Storage maintenance error: {}", e);
                }
                
                // Log stats
                let strategies = executor.list_strategies();
                info!(
                    "Cycle completed: {} strategies, {} executions",
                    strategies.len(),
                    results.len()
                );
            },
            Err(e) => {
                error!("Failed to fetch market data: {}", e);
                time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// Build a mock market data provider for the example
fn build_mock_market_data_provider() -> MockMarketDataProvider {
    let mut provider = MockMarketDataProvider::new();
    
    // Add some mock market data
    let mut btc_market_data = MarketData::default();
    btc_market_data.symbol = "BTC/USD".to_string();
    btc_market_data.price = 50000.0;
    
    let mut eth_market_data = MarketData::default();
    eth_market_data.symbol = "ETH/USD".to_string();
    eth_market_data.price = 3000.0;
    
    provider.add_market_data("BTC/USD", btc_market_data);
    provider.add_market_data("ETH/USD", eth_market_data);
    
    provider
}

/// Build example strategies (in a real system, these would come from a strategy factory)
fn build_example_strategies() -> Vec<Box<dyn crate::strategy::Strategy>> {
    // In a real implementation, this would load strategies from a configuration
    vec![]
} 