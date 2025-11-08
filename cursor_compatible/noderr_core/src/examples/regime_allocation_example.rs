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
use chrono::Utc;

use crate::market::{MarketData, Symbol};
use crate::correlation_engine::{create_correlation_engine, CorrelationEngineConfig};
use crate::market_regime::{
    MarketRegimeDetector, MarketRegimeState, MarketRegimeConfig,
    create_market_regime_detector_with_config
};
use crate::asset_allocator::{
    AssetAllocator, AssetAllocationConfig, AssetMetadata, AssetRiskClass,
    create_asset_allocator_with_config
};
use crate::telemetry::TelemetryReporter;
use crate::redis::MockRedisClient;

/// Example demonstrating market regime detection and dynamic asset allocation
pub async fn run_regime_allocation_example() {
    println!("Starting market regime and dynamic allocation example");
    
    // Create mock dependencies
    let redis = Arc::new(MockRedisClient::new());
    let telemetry = Arc::new(TelemetryReporter::new_mock());
    
    // Create market regime detector with custom configuration
    let regime_config = MarketRegimeConfig {
        bull_trend_threshold: 0.4,
        bear_trend_threshold: -0.4,
        volatility_threshold: 0.35,
        trend_lookback_days: 14,
        regime_transition_smoothing: 0.25,
        update_interval_sec: 1800, // 30 minutes
    };
    
    let regime_detector = create_market_regime_detector_with_config(regime_config);
    
    // Create correlation engine
    let correlation_config = CorrelationEngineConfig::default();
    let correlation_engine = create_correlation_engine(correlation_config, redis.clone());
    
    // Create custom allocation config with different regime allocations
    let mut allocation_config = AssetAllocationConfig::default();
    
    // Adjust bull market allocations
    let mut bull_allocations = HashMap::new();
    bull_allocations.insert(AssetRiskClass::RiskOn, 0.8);
    bull_allocations.insert(AssetRiskClass::RiskOff, 0.1);
    bull_allocations.insert(AssetRiskClass::Neutral, 0.1);
    allocation_config.bull_allocations = bull_allocations;
    
    // Adjust bear market allocations
    let mut bear_allocations = HashMap::new();
    bear_allocations.insert(AssetRiskClass::RiskOn, 0.1);
    bear_allocations.insert(AssetRiskClass::RiskOff, 0.8);
    bear_allocations.insert(AssetRiskClass::Neutral, 0.1);
    allocation_config.bear_allocations = bear_allocations;
    
    // Create allocator
    let allocator = create_asset_allocator_with_config(
        allocation_config,
        regime_detector.clone(),
        correlation_engine,
        None,
    );
    
    // Initialize allocator
    allocator.initialize().await.expect("Failed to initialize allocator");
    
    // Register some assets
    register_sample_assets(&allocator).await;
    
    // Simulate market data for different regimes
    simulate_bull_market(&regime_detector).await;
    println!("After bull market simulation:");
    print_allocation(&allocator).await;
    
    simulate_bear_market(&regime_detector).await;
    println!("After bear market simulation:");
    print_allocation(&allocator).await;
    
    simulate_sideways_market(&regime_detector).await;
    println!("After sideways market simulation:");
    print_allocation(&allocator).await;
    
    simulate_volatile_market(&regime_detector).await;
    println!("After volatile market simulation:");
    print_allocation(&allocator).await;
    
    println!("Market regime and dynamic allocation example completed");
}

/// Register some sample assets for allocation
async fn register_sample_assets(allocator: &Arc<dyn AssetAllocator>) {
    // Risk-on assets
    allocator.register_asset(AssetMetadata::new(
        "BTC/USD".to_string(),
        AssetRiskClass::RiskOn,
        0.6,  // High volatility
        45000.0,
    )).await.expect("Failed to register BTC");
    
    allocator.register_asset(AssetMetadata::new(
        "ETH/USD".to_string(),
        AssetRiskClass::RiskOn,
        0.65, // High volatility
        3000.0,
    )).await.expect("Failed to register ETH");
    
    allocator.register_asset(AssetMetadata::new(
        "SOL/USD".to_string(),
        AssetRiskClass::RiskOn,
        0.75, // Very high volatility
        130.0,
    )).await.expect("Failed to register SOL");
    
    // Neutral assets
    allocator.register_asset(AssetMetadata::new(
        "BNB/USD".to_string(),
        AssetRiskClass::Neutral,
        0.45, // Medium volatility
        350.0,
    )).await.expect("Failed to register BNB");
    
    allocator.register_asset(AssetMetadata::new(
        "XRP/USD".to_string(),
        AssetRiskClass::Neutral,
        0.4,  // Medium volatility
        0.5,
    )).await.expect("Failed to register XRP");
    
    // Risk-off assets
    allocator.register_asset(AssetMetadata::new(
        "USDT/USD".to_string(),
        AssetRiskClass::RiskOff,
        0.02, // Very low volatility
        1.0,
    )).await.expect("Failed to register USDT");
    
    allocator.register_asset(AssetMetadata::new(
        "USDC/USD".to_string(),
        AssetRiskClass::RiskOff,
        0.01, // Very low volatility
        1.0,
    )).await.expect("Failed to register USDC");
}

/// Simulate bull market conditions
async fn simulate_bull_market(detector: &Arc<dyn MarketRegimeDetector>) {
    println!("Simulating bull market conditions...");
    
    // Create sample market data with strong uptrend
    let assets = ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD", "USDT/USD", "USDC/USD"];
    
    for symbol in assets.iter() {
        let timestamp = Utc::now();
        
        // Generate 30 days of price data with uptrend
        for day in 0..30 {
            let base_price = match *symbol {
                "BTC/USD" => 40000.0,
                "ETH/USD" => 2800.0,
                "SOL/USD" => 120.0,
                "BNB/USD" => 330.0,
                "XRP/USD" => 0.48,
                "USDT/USD" => 1.0,
                "USDC/USD" => 1.0,
                _ => 100.0,
            };
            
            // Generate uptrend with small noise
            let trend = 0.01 * day as f64; // 1% increase per day
            let noise = (day % 3) as f64 * 0.005; // Small random noise
            let price = base_price * (1.0 + trend + noise);
            
            let market_data = MarketData {
                symbol: symbol.to_string(),
                price,
                timestamp: timestamp + chrono::Duration::days(day),
                ..MarketData::default()
            };
            
            detector.process_market_data(&market_data).await.expect("Failed to process market data");
        }
        
        // Check regime
        if let Some(regime) = detector.get_current_regime(symbol).await {
            println!("  {} market regime: {} (confidence: {:.2})", symbol, regime.state, regime.confidence);
        }
    }
}

/// Simulate bear market conditions
async fn simulate_bear_market(detector: &Arc<dyn MarketRegimeDetector>) {
    println!("Simulating bear market conditions...");
    
    // Create sample market data with strong downtrend
    let assets = ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD", "USDT/USD", "USDC/USD"];
    
    for symbol in assets.iter() {
        let timestamp = Utc::now();
        
        // Generate 30 days of price data with downtrend
        for day in 0..30 {
            let base_price = match *symbol {
                "BTC/USD" => 45000.0,
                "ETH/USD" => 3000.0,
                "SOL/USD" => 130.0,
                "BNB/USD" => 350.0,
                "XRP/USD" => 0.5,
                "USDT/USD" => 1.0,
                "USDC/USD" => 1.0,
                _ => 100.0,
            };
            
            // Generate downtrend with small noise
            let trend = -0.01 * day as f64; // 1% decrease per day
            let noise = (day % 3) as f64 * 0.005; // Small random noise
            let price = base_price * (1.0 + trend + noise);
            
            let market_data = MarketData {
                symbol: symbol.to_string(),
                price,
                timestamp: timestamp + chrono::Duration::days(day),
                ..MarketData::default()
            };
            
            detector.process_market_data(&market_data).await.expect("Failed to process market data");
        }
        
        // Check regime
        if let Some(regime) = detector.get_current_regime(symbol).await {
            println!("  {} market regime: {} (confidence: {:.2})", symbol, regime.state, regime.confidence);
        }
    }
}

/// Simulate sideways market conditions
async fn simulate_sideways_market(detector: &Arc<dyn MarketRegimeDetector>) {
    println!("Simulating sideways market conditions...");
    
    // Create sample market data with no clear trend
    let assets = ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD", "USDT/USD", "USDC/USD"];
    
    for symbol in assets.iter() {
        let timestamp = Utc::now();
        
        // Generate 30 days of price data with no trend
        for day in 0..30 {
            let base_price = match *symbol {
                "BTC/USD" => 42000.0,
                "ETH/USD" => 2900.0,
                "SOL/USD" => 125.0,
                "BNB/USD" => 340.0,
                "XRP/USD" => 0.49,
                "USDT/USD" => 1.0,
                "USDC/USD" => 1.0,
                _ => 100.0,
            };
            
            // Generate noise only
            let noise = ((day % 5) as f64 - 2.0) * 0.01; // Random noise around 0
            let price = base_price * (1.0 + noise);
            
            let market_data = MarketData {
                symbol: symbol.to_string(),
                price,
                timestamp: timestamp + chrono::Duration::days(day),
                ..MarketData::default()
            };
            
            detector.process_market_data(&market_data).await.expect("Failed to process market data");
        }
        
        // Check regime
        if let Some(regime) = detector.get_current_regime(symbol).await {
            println!("  {} market regime: {} (confidence: {:.2})", symbol, regime.state, regime.confidence);
        }
    }
}

/// Simulate volatile market conditions
async fn simulate_volatile_market(detector: &Arc<dyn MarketRegimeDetector>) {
    println!("Simulating volatile market conditions...");
    
    // Create sample market data with high volatility
    let assets = ["BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD", "USDT/USD", "USDC/USD"];
    
    for symbol in assets.iter() {
        let timestamp = Utc::now();
        
        // Generate 30 days of price data with high volatility
        for day in 0..30 {
            let base_price = match *symbol {
                "BTC/USD" => 43000.0,
                "ETH/USD" => 2950.0,
                "SOL/USD" => 128.0,
                "BNB/USD" => 345.0,
                "XRP/USD" => 0.495,
                "USDT/USD" => 1.0,
                "USDC/USD" => 1.0,
                _ => 100.0,
            };
            
            // Generate high volatility
            let volatility = if (day % 2) == 0 { 0.05 } else { -0.05 }; // Large swings
            let noise = ((day % 3) as f64 - 1.0) * 0.01; // Additional noise
            let price = base_price * (1.0 + volatility + noise);
            
            let market_data = MarketData {
                symbol: symbol.to_string(),
                price,
                timestamp: timestamp + chrono::Duration::days(day),
                ..MarketData::default()
            };
            
            detector.process_market_data(&market_data).await.expect("Failed to process market data");
        }
        
        // Check regime
        if let Some(regime) = detector.get_current_regime(symbol).await {
            println!("  {} market regime: {} (confidence: {:.2})", symbol, regime.state, regime.confidence);
        }
    }
}

/// Print current asset allocation
async fn print_allocation(allocator: &Arc<dyn AssetAllocator>) {
    if let Some(allocation) = allocator.get_portfolio_allocation().await {
        println!("Current portfolio allocation:");
        println!("  Market regime: {}", allocation.market_regime);
        println!("  Regime confidence: {:.2}", allocation.regime_confidence);
        println!("  Risk-on allocation: {:.2}%", allocation.risk_on_allocation * 100.0);
        println!("  Risk-off allocation: {:.2}%", allocation.risk_off_allocation * 100.0);
        println!("  Neutral allocation: {:.2}%", allocation.neutral_allocation * 100.0);
        
        println!("  Individual asset allocations:");
        for asset in allocation.allocations {
            println!("    {}: {:.2}% ({})", asset.symbol, asset.allocation * 100.0, asset.risk_class);
        }
    } else {
        println!("No allocation available yet");
    }
}

/// Run this example
pub async fn main() {
    run_regime_allocation_example().await;
} 