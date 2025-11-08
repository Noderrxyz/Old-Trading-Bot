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

//! # Trust Feedback Loop Demo
//! 
//! This example demonstrates the integration between:
//! - Strategy execution generating trust updates
//! - Telemetry reporting these updates
//! - TrustBuffer storing historical trust data
//! - Risk management adjusting based on trust scores

use std::sync::Arc;
use chrono::Utc;
use tokio::time;
use serde_json::json;
use std::collections::HashMap;

use crate::market::{MarketData, Candle, Orderbook};
use crate::strategy::{Strategy, Signal, SignalAction, StrategyTrustState, StrategyPerformance};
use crate::risk::{RiskManager, RiskManagerConfig, RiskMetrics};
use crate::execution::{ExecutionService, ExecutionResult, ExecutionStatus, PaperTradingProvider};
use crate::telemetry::{TelemetryReporter, TelemetryRole, TelemetryPermissions};
use crate::strategy_executor::{StrategyExecutor, StrategyExecutorConfig};
use crate::trust_buffer::{TrustBuffer, TrustBufferConfig, TimeRange};

/// A simple demo strategy for testing the trust feedback loop
struct DemoStrategy {
    name: String,
    win_rate: f64,
    trust_state: StrategyTrustState,
}

impl DemoStrategy {
    fn new(name: &str, win_rate: f64) -> Self {
        Self {
            name: name.to_string(),
            win_rate,
            trust_state: StrategyTrustState::default(),
        }
    }
}

#[async_trait::async_trait]
impl Strategy for DemoStrategy {
    fn name(&self) -> &str {
        &self.name
    }
    
    async fn analyze(&self, _market_data: &MarketData) -> Result<Option<Signal>, crate::strategy::StrategyError> {
        // Simulate a strategy that generates signals 50% of the time
        let generate_signal = rand::random::<f64>() < 0.5;
        
        if !generate_signal {
            return Ok(None);
        }
        
        // Create a signal
        let signal = Signal {
            id: uuid::Uuid::new_v4().to_string(),
            strategy_id: self.name.clone(),
            symbol: "BTC-USD".to_string(),
            action: SignalAction::Buy,
            price: Some(40000.0),
            quantity: 0.1,
            confidence: 0.8,
            timestamp: Utc::now(),
            expiration: None,
            urgency: crate::strategy::SignalUrgency::Medium,
            metadata: HashMap::new(),
            status: None,
            ttl_seconds: 60,
        };
        
        Ok(Some(signal))
    }
    
    async fn on_execution(&mut self, result: &ExecutionResult) -> Result<(), crate::strategy::StrategyError> {
        // Update trust state based on execution result
        let is_profitable = result.realized_pnl > 0.0;
        self.trust_state.update_with_trade_result(is_profitable, result.realized_pnl);
        
        Ok(())
    }
    
    fn risk_profile(&self) -> crate::strategy::RiskProfile {
        crate::strategy::RiskProfile::default()
    }
    
    fn entropy_score(&self) -> f64 {
        0.5
    }
    
    fn update_from_risk_metrics(&mut self, _metrics: &RiskMetrics) -> Result<(), crate::strategy::StrategyError> {
        Ok(())
    }
    
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
    
    async fn validate_market_conditions(&self, _signal: &Signal, _market_data: &MarketData) -> Result<bool, crate::strategy::StrategyError> {
        // Always validate for demo purposes
        Ok(true)
    }
    
    fn performance(&self) -> StrategyPerformance {
        StrategyPerformance {
            win_rate: self.win_rate,
            profit_factor: if self.win_rate > 0.5 { 1.5 } else { 0.8 },
            expected_value: if self.win_rate > 0.5 { 0.2 } else { -0.1 },
            max_drawdown: 0.05,
            current_drawdown: 0.02,
            trust_score: self.trust_state.trust_score,
            last_updated: Utc::now(),
        }
    }
}

/// Create sample market data for testing
fn create_sample_market_data() -> MarketData {
    let candle = Candle {
        timestamp: Utc::now(),
        open: 40000.0,
        high: 40100.0,
        low: 39900.0,
        close: 40050.0,
        volume: 10.5,
    };
    
    let mut orderbook = Orderbook::new();
    orderbook.bids.insert(40000.0, 1.5);
    orderbook.bids.insert(39900.0, 2.5);
    orderbook.asks.insert(40100.0, 1.0);
    orderbook.asks.insert(40200.0, 2.0);
    
    MarketData {
        symbol: "BTC-USD".to_string(),
        timestamp: Utc::now(),
        last_price: 40050.0,
        candle: Some(candle),
        orderbook: Some(orderbook),
        market_sentiment: None,
        technical_indicators: None,
    }
}

/// Run the trust feedback loop demo
pub async fn run_trust_feedback_demo() {
    println!("Starting Trust Feedback Loop Demo");
    
    // Create necessary components
    let telemetry = Arc::new(TelemetryReporter::new(Default::default()));
    
    // Create trust buffer
    let trust_buffer_config = TrustBufferConfig::default();
    let trust_buffer = TrustBuffer::new(trust_buffer_config).start();
    
    // Create risk manager
    let risk_config = RiskManagerConfig::default();
    let risk_manager = Arc::new(RiskManager::new(risk_config));
    
    // Create execution service
    let paper_provider = Arc::new(PaperTradingProvider::new());
    let execution_service = Arc::new(ExecutionService::new(
        paper_provider.clone(), // using paper provider for both
        paper_provider.clone(),
        None,
    ));
    
    // Create some strategies with different characteristics
    let good_strategy = Box::new(DemoStrategy::new("good-strategy", 0.7)); // 70% win rate
    let average_strategy = Box::new(DemoStrategy::new("average-strategy", 0.5)); // 50% win rate
    let poor_strategy = Box::new(DemoStrategy::new("poor-strategy", 0.3)); // 30% win rate
    
    let strategies = vec![good_strategy, average_strategy, poor_strategy];
    
    // Create strategy executor
    let executor_config = StrategyExecutorConfig {
        execution_interval_ms: 1000, // Fast for demo
        ..Default::default()
    };
    
    let strategy_executor = StrategyExecutor::with_config(
        strategies,
        risk_manager.clone(),
        None,
        telemetry.clone(),
        execution_service.clone(),
        executor_config,
    );
    
    // Set up subscription to trust updates from telemetry
    let mut telemetry_receiver = telemetry.subscribe();
    
    // Monitor trust updates in a separate task
    tokio::spawn(async move {
        while let Ok(event) = telemetry_receiver.recv().await {
            if let crate::telemetry::TelemetryEvent::TrustScoreUpdate { 
                entity_id, 
                entity_type,
                new_score,
                previous_score,
                reason,
                .. 
            } = event {
                println!(
                    "Trust update: {}:{} changed from {:.2} to {:.2} ({})", 
                    entity_type, entity_id, previous_score, new_score, reason
                );
                
                // Forward to trust buffer
                let update = crate::trust_buffer::TrustScoreUpdate::new(
                    &entity_id,
                    &entity_type,
                    new_score,
                    previous_score,
                    reason,
                );
                
                if let Err(e) = trust_buffer.add_update(update).await {
                    println!("Error adding to trust buffer: {}", e);
                }
            }
        }
    });
    
    // Run several execution cycles
    println!("Running execution cycles...");
    let market_data = create_sample_market_data();
    
    for i in 1..=10 {
        println!("\nExecution cycle {}:", i);
        
        let results = strategy_executor.execute_cycle(&market_data).await;
        println!("Generated {} execution results", results.len());
        
        // Simulate different outcomes for demonstration
        for result in &results {
            let strategy_id = &result.signal_id;
            println!(
                "Strategy {} execution: {}",
                strategy_id,
                if result.is_success() { "SUCCESS" } else { "FAILURE" }
            );
        }
        
        // Wait a bit between cycles
        time::sleep(time::Duration::from_millis(500)).await;
    }
    
    // After cycles complete, show final trust states
    println!("\nFinal trust statistics:");
    
    // Get strategy names
    let strategy_names = strategy_executor.list_strategies();
    
    for name in strategy_names {
        match trust_buffer.get_statistics(&name, "strategy", TimeRange::All) {
            Ok(stats) => {
                println!(
                    "{}: current={:.2}, avg={:.2}, min={:.2}, max={:.2}, updates={}",
                    name, stats.current_score, stats.average_score, 
                    stats.min_score, stats.max_score, stats.update_count
                );
            },
            Err(e) => {
                println!("Could not get statistics for {}: {}", name, e);
            }
        }
    }
    
    // Also show how permissions filtering works
    let admin_perms = TelemetryPermissions::new(TelemetryRole::Admin);
    let viewer_perms = TelemetryPermissions::new(TelemetryRole::Viewer);
    
    // Try to access trust scores with different permissions
    match telemetry.get_trust_scores_with_permissions(&admin_perms) {
        Ok(scores) => {
            println!("\nAdmin trust scores access:");
            for (id, score) in scores {
                println!("{}: {:.2}", id, score);
            }
        },
        Err(e) => println!("Admin trust access error: {}", e)
    }
    
    match telemetry.get_trust_scores_with_permissions(&viewer_perms) {
        Ok(_) => println!("Viewer could access trust scores (unexpected)"),
        Err(e) => println!("Viewer trust access correctly denied: {}", e)
    }
    
    println!("\nTrust Feedback Loop Demo completed");
} 