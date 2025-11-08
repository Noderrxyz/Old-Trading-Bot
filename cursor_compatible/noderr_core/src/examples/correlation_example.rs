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

//! Example demonstrating the usage of correlation engine and risk allocation.
//! This example shows how to:
//! 1. Initialize a correlation engine
//! 2. Track strategy returns
//! 3. Generate a correlation matrix
//! 4. Use the risk allocator to optimize strategy allocations
//! 5. Apply optimized allocations to the risk manager

use std::sync::Arc;
use std::collections::HashMap;
use std::time::Duration;

use chrono::{Utc, TimeZone};
use rand::prelude::*;
use tracing::{info, error};
use tokio::time;

use crate::correlation_engine::{
    CorrelationEngine, CorrelationEngineConfig, TimePeriod,
    create_correlation_engine_with_config
};
use crate::risk_allocation::{RiskAllocator, RiskAllocationConfig, create_risk_allocator_with_config};
use crate::strategy::{StrategyId, Strategy, StrategyPerformance};
use crate::strategy_executor::{StrategyExecutor, StrategyExecutorConfig};
use crate::risk::{RiskManager, RiskManagerFactory};
use crate::market::Symbol;
use crate::telemetry::TelemetryReporter;
use crate::execution::ExecutionService;

/// Generate synthetic returns for a strategy
fn generate_synthetic_returns(
    strategy_id: &str,
    days: i64,
    trend: f64,   // -1.0 to 1.0
    volatility: f64,  // 0.0 to 1.0
    noise: f64,    // 0.0 to 1.0
) -> Vec<(chrono::DateTime<Utc>, f64)> {
    let mut rng = rand::thread_rng();
    let now = Utc::now();
    let mut returns = Vec::with_capacity(days as usize);
    
    for day in 0..days {
        let timestamp = now - chrono::Duration::days(days - day);
        
        // Base return following the trend
        let base_return = trend * 0.01; // Convert trend to daily return
        
        // Add volatility component
        let vol_component = volatility * 0.02 * (rng.gen::<f64>() - 0.5);
        
        // Add random noise
        let noise_component = noise * 0.01 * (rng.gen::<f64>() - 0.5);
        
        // Combine components for final return
        let daily_return = base_return + vol_component + noise_component;
        
        returns.push((timestamp, daily_return));
    }
    
    returns
}

/// Run the correlation and risk allocation example
pub async fn run_correlation_example() -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting correlation and risk allocation example");
    
    // Initialize correlation engine with configuration
    let correlation_config = CorrelationEngineConfig {
        redis_url: "redis://127.0.0.1:6379".to_string(),
        redis_key_prefix: "noderr:example:correlation".to_string(),
        min_data_points: 5,  // Lowered for example
        max_snapshots_per_strategy: 100,
        default_time_period: TimePeriod::Daily,
        cache_ttl_sec: 300,
        refresh_interval_sec: 60,
    };
    
    let correlation_engine = create_correlation_engine_with_config(correlation_config);
    correlation_engine.initialize().await?;
    
    // Create strategy executor and risk manager
    let risk_manager = RiskManagerFactory::create_default();
    
    let telemetry = Arc::new(TelemetryReporter::new(None));
    let execution_service = Arc::new(ExecutionService::new_mock());
    
    let executor_config = StrategyExecutorConfig::default();
    let executor = Arc::new(StrategyExecutor::new(
        risk_manager.clone(),
        None,
        telemetry,
        execution_service,
        executor_config,
    ));
    
    // Initialize risk allocator
    let risk_allocation_config = RiskAllocationConfig {
        enabled: true,
        correlation_period: TimePeriod::Daily,
        correlation_threshold: 0.6,
        max_strategy_allocation: 0.3,
        min_strategy_allocation: 0.05,
        update_interval_sec: 300,
        drawdown_weight: 0.3,
        volatility_weight: 0.3,
        sharpe_weight: 0.4,
        correlation_penalty: 0.5,
    };
    
    let risk_allocator = create_risk_allocator_with_config(
        risk_allocation_config,
        correlation_engine.clone(),
        executor.clone(),
    );
    
    // Define synthetic strategies with different characteristics
    let strategy_defs = vec![
        // Strategy 1: Positive trend, low volatility (conservative)
        ("strategy_1", 0.5, 0.2, 0.1),
        // Strategy 2: Higher trend, medium volatility (balanced)
        ("strategy_2", 0.7, 0.4, 0.2),
        // Strategy 3: Highest trend, high volatility (aggressive)
        ("strategy_3", 0.9, 0.7, 0.3),
        // Strategy 4: Negative correlation to others
        ("strategy_4", -0.6, 0.5, 0.2),
        // Strategy 5: Non-correlated
        ("strategy_5", 0.1, 0.3, 0.8),
    ];
    
    // Generate synthetic returns and track them
    info!("Generating synthetic strategy returns...");
    
    for (strategy_id, trend, volatility, noise) in strategy_defs {
        let returns = generate_synthetic_returns(strategy_id, 30, trend, volatility, noise);
        
        // Track returns in correlation engine
        for (timestamp, return_pct) in returns {
            correlation_engine.track_return(&strategy_id.to_string(), timestamp, return_pct).await?;
            
            // Also create synthetic performance data for the strategy executor
            let mut performance = StrategyPerformance::default();
            performance.strategy_id = strategy_id.to_string();
            performance.daily_pnl = return_pct;
            performance.win_rate = if return_pct > 0.0 { 0.6 } else { 0.4 };
            performance.sharpe = Some(trend / volatility);
            performance.max_drawdown = volatility * 0.1;
            
            // Register strategy with risk manager
            risk_manager.register_strategy(strategy_id.to_string()).await;
            
            // Update metrics
            risk_manager.update_metrics(&strategy_id.to_string(), &performance).await;
        }
        
        info!("Tracked returns for strategy {}", strategy_id);
    }
    
    // Generate correlation matrix
    info!("Generating correlation matrix...");
    let matrix = correlation_engine.generate_correlation_matrix(TimePeriod::Daily).await?;
    
    // Print correlation matrix
    println!("\nCorrelation Matrix:");
    println!("{:<12}", "Strategy");
    
    for id in &matrix.strategy_ids {
        print!("{:<12}", id);
    }
    println!();
    
    for (i, row_id) in matrix.strategy_ids.iter().enumerate() {
        print!("{:<12}", row_id);
        for (j, _) in matrix.strategy_ids.iter().enumerate() {
            print!("{:<12.4}", matrix.matrix[i][j]);
        }
        println!();
    }
    
    // Run risk allocator to optimize allocations
    info!("Optimizing risk allocations...");
    let allocation = risk_allocator.optimize_allocation().await?;
    
    // Print allocation results
    println!("\nOptimized Strategy Allocations:");
    println!("{:<12} {:<12} {:<12} {:<18}", "Strategy", "Base Alloc %", "Final Alloc %", "Correlation Adj");
    
    for strategy_alloc in &allocation.allocations {
        let corr_factor = if let Some(adj) = strategy_alloc.adjustments.get("correlation") {
            adj
        } else {
            &1.0
        };
        
        println!(
            "{:<12} {:<12.2} {:<12.2} {:<18.2}",
            strategy_alloc.strategy_id,
            strategy_alloc.base_allocation * 100.0,
            strategy_alloc.allocation * 100.0,
            corr_factor * 100.0
        );
    }
    
    println!("\nTotal allocation: {:.2}%", allocation.total_allocation * 100.0);
    
    // Apply to risk manager
    info!("Applying optimized allocations to risk manager...");
    risk_allocator.apply_to_risk_manager(&*risk_manager).await?;
    
    info!("Correlation and risk allocation example completed successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_correlation_example() {
        // This is just a minimal test to ensure the example code compiles
        // In a real test, we would use mock implementations
        let result = generate_synthetic_returns("test", 10, 0.5, 0.3, 0.2);
        assert_eq!(result.len(), 10);
    }
} 