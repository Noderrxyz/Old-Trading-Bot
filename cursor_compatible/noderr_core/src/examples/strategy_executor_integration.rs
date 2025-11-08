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

//! Example demonstrating the integration between the refined Strategy interface,
//! RiskManager, and StrategyExecutor with telemetry reporting.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;
use chrono::Utc;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::market::{MarketData, MarketDataProvider};
use crate::execution::{ExecutionResult, ExecutionService, ExecutionStatus};
use crate::risk::{DefaultRiskManager, RiskError, RiskManager, RiskManagerConfig};
use crate::strategy::{
    Signal, SignalAction, Strategy, StrategyPerformance, StrategyTrustState, RiskProfile
};
use crate::telemetry::TelemetryReporter;

/// Strategy Executor that integrates with risk management and telemetry
pub struct StrategyExecutor<M: MarketDataProvider, E: ExecutionService> {
    strategies: HashMap<String, Box<dyn Strategy>>,
    risk_manager: Arc<Mutex<Box<dyn RiskManager>>>,
    market_data_provider: M,
    execution_service: E,
    telemetry_reporter: Option<Arc<dyn TelemetryReporter>>,
    
    // State tracking
    strategy_performances: HashMap<String, StrategyPerformance>,
    strategy_trust_states: HashMap<String, StrategyTrustState>,
}

impl<M: MarketDataProvider, E: ExecutionService> StrategyExecutor<M, E> {
    /// Create a new StrategyExecutor
    pub fn new(
        market_data_provider: M,
        execution_service: E,
        risk_manager: Box<dyn RiskManager>,
        telemetry_reporter: Option<Arc<dyn TelemetryReporter>>,
    ) -> Self {
        Self {
            strategies: HashMap::new(),
            risk_manager: Arc::new(Mutex::new(risk_manager)),
            market_data_provider,
            execution_service,
            telemetry_reporter,
            strategy_performances: HashMap::new(),
            strategy_trust_states: HashMap::new(),
        }
    }
    
    /// Add a strategy to the executor
    pub fn add_strategy(&mut self, strategy_id: &str, strategy: Box<dyn Strategy>) {
        // Initialize performance tracking
        self.strategy_performances.insert(
            strategy_id.to_string(),
            StrategyPerformance::new(strategy_id),
        );
        
        // Initialize trust state
        self.strategy_trust_states.insert(
            strategy_id.to_string(),
            StrategyTrustState::new(strategy_id),
        );
        
        // Add the strategy
        self.strategies.insert(strategy_id.to_string(), strategy);
        
        // Report strategy added
        if let Some(telemetry) = &self.telemetry_reporter {
            tokio::spawn({
                let telemetry = telemetry.clone();
                let strategy_id = strategy_id.to_string();
                async move {
                    telemetry.report_event("strategy_added", &[
                        ("strategy_id", &strategy_id),
                    ]).await;
                }
            });
        }
    }
    
    /// Execute a single cycle of the strategy executor
    pub async fn execute_cycle(&mut self) -> Result<(), String> {
        // Get market data
        let market_data = match self.market_data_provider.get_market_data().await {
            Ok(data) => data,
            Err(err) => {
                error!("Failed to get market data: {}", err);
                return Err(format!("Market data error: {}", err));
            }
        };
        
        // First, assess market risk
        let market_risk = {
            let risk_manager = self.risk_manager.lock().unwrap();
            risk_manager.assess_market_risk(&market_data)
        };
        
        info!("Market risk assessment - volatility: {}, liquidity: {}, risk_score: {}", 
            market_risk.volatility, market_risk.liquidity, market_risk.risk_score);
        
        // Report market risk to telemetry
        if let Some(telemetry) = &self.telemetry_reporter {
            telemetry.report_event("market_risk_assessment", &[
                ("volatility", &market_risk.volatility.to_string()),
                ("liquidity", &market_risk.liquidity.to_string()),
                ("risk_score", &market_risk.risk_score.to_string()),
            ]).await;
        }
        
        // Process each strategy
        for (strategy_id, strategy) in &self.strategies {
            // Check if strategy should be executed based on trust state
            let trust_state = self.strategy_trust_states.get(strategy_id).unwrap();
            if !trust_state.can_trade() {
                warn!("Strategy {} trust state below threshold, skipping execution", strategy_id);
                
                if let Some(telemetry) = &self.telemetry_reporter {
                    telemetry.report_event("strategy_skipped", &[
                        ("strategy_id", strategy_id),
                        ("reason", "low_trust"),
                        ("trust_score", &trust_state.trust_score.to_string()),
                    ]).await;
                }
                
                continue;
            }
            
            // Check if strategy exceeds risk limits
            let risk_check_result = {
                let risk_manager = self.risk_manager.lock().unwrap();
                risk_manager.check_risk_limits(strategy_id)
            };
            
            if let Err(risk_error) = risk_check_result {
                warn!("Strategy {} exceeds risk limits: {:?}", strategy_id, risk_error);
                
                if let Some(telemetry) = &self.telemetry_reporter {
                    telemetry.report_event("risk_limit_exceeded", &[
                        ("strategy_id", strategy_id),
                        ("reason", &format!("{:?}", risk_error)),
                    ]).await;
                }
                
                continue;
            }
            
            // Generate signal from strategy
            let signal_result = strategy.generate_signal(&market_data).await;
            
            if let Ok(Some(signal)) = signal_result {
                debug!("Strategy {} generated signal: {:?}", strategy_id, signal.action);
                
                // Report signal generation to telemetry
                if let Some(telemetry) = &self.telemetry_reporter {
                    telemetry.report_event("signal_generated", &[
                        ("strategy_id", strategy_id),
                        ("signal_id", &signal.id),
                        ("action", signal.action.description()),
                        ("symbol", &signal.symbol),
                    ]).await;
                }
                
                // Get risk profile and validate signal
                let risk_profile = strategy.get_risk_profile().await;
                
                // Basic signal validation
                if let Err(err) = signal.validate() {
                    warn!("Signal validation failed: {:?}", err);
                    
                    if let Some(telemetry) = &self.telemetry_reporter {
                        telemetry.report_event("signal_validation_failed", &[
                            ("strategy_id", strategy_id),
                            ("signal_id", &signal.id),
                            ("reason", &format!("{:?}", err)),
                        ]).await;
                    }
                    
                    continue;
                }
                
                // Risk management validation
                let validation_result = {
                    let risk_manager = self.risk_manager.lock().unwrap();
                    risk_manager.validate_signal(&signal, &risk_profile)
                };
                
                if let Err(risk_error) = validation_result {
                    warn!("Signal rejected by risk manager: {:?}", risk_error);
                    
                    if let Some(telemetry) = &self.telemetry_reporter {
                        telemetry.report_event("signal_rejected", &[
                            ("strategy_id", strategy_id),
                            ("signal_id", &signal.id),
                            ("reason", &format!("{:?}", risk_error)),
                        ]).await;
                    }
                    
                    continue;
                }
                
                // Calculate position size
                let position_sizing_result = {
                    let risk_manager = self.risk_manager.lock().unwrap();
                    risk_manager.calculate_position_size(&signal, &risk_profile)
                };
                
                if let Ok(position_sizing) = position_sizing_result {
                    // Create signal with adjusted size
                    let adjusted_signal = signal.with_size(position_sizing.adjusted_size);
                    
                    // Log the position sizing adjustment
                    info!(
                        "Position sizing adjusted: {} from {} to {}",
                        strategy_id,
                        position_sizing.recommended_size,
                        position_sizing.adjusted_size
                    );
                    
                    // Execute the signal
                    match self.execution_service.execute(&adjusted_signal).await {
                        Ok(execution_result) => {
                            info!(
                                "Signal executed: {} status={:?}",
                                adjusted_signal.id,
                                execution_result.status
                            );
                            
                            // Process execution result
                            self.process_execution_result(strategy_id, &execution_result).await;
                        },
                        Err(err) => {
                            error!("Signal execution failed: {}", err);
                            
                            if let Some(telemetry) = &self.telemetry_reporter {
                                telemetry.report_event("execution_failed", &[
                                    ("strategy_id", strategy_id),
                                    ("signal_id", &adjusted_signal.id),
                                    ("reason", &err),
                                ]).await;
                            }
                        }
                    }
                } else {
                    warn!(
                        "Failed to calculate position size: {:?}",
                        position_sizing_result.err()
                    );
                }
            }
        }
        
        Ok(())
    }
    
    /// Process execution result and update strategy performance and trust state
    async fn process_execution_result(&mut self, strategy_id: &str, result: &ExecutionResult) {
        // Determine if the execution was profitable
        let is_profitable = result.realized_pnl.is_sign_positive() && 
                           result.status == ExecutionStatus::Completed;
        
        // Update strategy performance
        if let Some(performance) = self.strategy_performances.get_mut(strategy_id) {
            performance.update_with_trade(
                is_profitable,
                result.realized_pnl,
                // This is simplified - in a real system, we'd calculate actual allocation
                Decimal::new(5, 2) // 5% allocation for example
            );
            
            // Update risk metrics
            let mut risk_manager = self.risk_manager.lock().unwrap();
            risk_manager.update_metrics(strategy_id, performance);
        }
        
        // Update trust state
        if let Some(trust_state) = self.strategy_trust_states.get_mut(strategy_id) {
            trust_state.update_with_trade_result(is_profitable, result.realized_pnl);
            
            // Report trust state update to telemetry
            if let Some(telemetry) = &self.telemetry_reporter {
                telemetry.report_event("trust_state_updated", &[
                    ("strategy_id", strategy_id),
                    ("trust_score", &trust_state.trust_score.to_string()),
                    ("consecutive_losses", &trust_state.consecutive_losses.to_string()),
                    ("is_active", &trust_state.is_active.to_string()),
                ]).await;
            }
        }
        
        // Report execution result to telemetry
        if let Some(telemetry) = &self.telemetry_reporter {
            telemetry.report_event("execution_completed", &[
                ("strategy_id", strategy_id),
                ("symbol", &result.symbol),
                ("pnl", &result.realized_pnl.to_string()),
                ("status", &format!("{:?}", result.status)),
                ("profitable", &is_profitable.to_string()),
            ]).await;
        }
    }
    
    /// Start an execution loop with the given interval in milliseconds
    pub async fn start_execution_loop(&mut self, interval_ms: u64) {
        use tokio::time::{sleep, Duration};
        
        info!("Starting strategy execution loop with interval {}ms", interval_ms);
        
        loop {
            if let Err(err) = self.execute_cycle().await {
                error!("Error in execution cycle: {}", err);
            }
            
            sleep(Duration::from_millis(interval_ms)).await;
        }
    }
}

/// Example strategy implementation for testing
pub struct ExampleStrategy {
    id: String,
    risk_profile: RiskProfile,
}

impl ExampleStrategy {
    pub fn new(id: &str, conservative: bool) -> Self {
        let risk_profile = if conservative {
            RiskProfile {
                position_size: dec!(0.05),        // 5%
                use_stop_loss: true,
                max_slippage: dec!(0.01),         // 1%
                volatility_aversion: dec!(0.8),   // High aversion
                strict_validation: true,
            }
        } else {
            RiskProfile {
                position_size: dec!(0.1),         // 10%
                use_stop_loss: false,
                max_slippage: dec!(0.03),         // 3%
                volatility_aversion: dec!(0.3),   // Low aversion
                strict_validation: false,
            }
        };
        
        Self {
            id: id.to_string(),
            risk_profile,
        }
    }
}

#[async_trait]
impl Strategy for ExampleStrategy {
    async fn generate_signal(&self, market_data: &MarketData) -> Result<Option<Signal>, String> {
        // A very simple example strategy that alternates between buy and sell signals
        // In a real system, this would analyze market_data
        
        // Generate signal with 50% probability
        let generate = rand::random::<bool>();
        if !generate {
            return Ok(None);
        }
        
        // Simple condition - generate enter signal if price is trending up
        let action = if let Some(candles) = &market_data.candles {
            if candles.len() >= 2 {
                let last = candles.last().unwrap();
                let prev = &candles[candles.len() - 2];
                
                if last.close > prev.close {
                    SignalAction::Enter(Some("uptrend".to_string()))
                } else {
                    SignalAction::Exit(Some("downtrend".to_string()))
                }
            } else {
                SignalAction::Hold
            }
        } else {
            SignalAction::Hold
        };
        
        let signal = Signal::new(&self.id, &market_data.symbol, action)
            .with_confidence(dec!(0.7))
            .with_price(dec!(100))
            .with_size(dec!(1))
            .with_type("trend");
            
        Ok(Some(signal))
    }
    
    async fn get_risk_profile(&self) -> RiskProfile {
        self.risk_profile.clone()
    }
}

/// Mock telemetry reporter for testing
pub struct MockTelemetryReporter {
    events: Arc<Mutex<Vec<(String, Vec<(String, String)>)>>>,
}

impl MockTelemetryReporter {
    pub fn new() -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }
    
    pub fn get_events(&self) -> Vec<(String, Vec<(String, String)>)> {
        self.events.lock().unwrap().clone()
    }
}

#[async_trait]
impl TelemetryReporter for MockTelemetryReporter {
    async fn report_event(&self, event_type: &str, attributes: &[(&str, &str)]) {
        let mut events = self.events.lock().unwrap();
        let attrs = attributes.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        
        events.push((event_type.to_string(), attrs));
        
        // For debugging
        debug!("Event: {} {:?}", event_type, attributes);
    }
    
    async fn report_metrics(&self, _metrics: &[(&str, f64)]) {
        // Not implemented for this example
    }
}

/// Example usage of the strategy executor
#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::{Candle, Orderbook};
    
    // Mock market data provider for testing
    struct MockMarketDataProvider {
        data: MarketData,
    }
    
    #[async_trait]
    impl MarketDataProvider for MockMarketDataProvider {
        async fn get_market_data(&self) -> Result<MarketData, String> {
            Ok(self.data.clone())
        }
        
        async fn get_historical_candles(&self, _symbol: &str, _interval: &str, _limit: usize) 
            -> Result<Vec<Candle>, String> {
            Ok(vec![])
        }
    }
    
    // Mock execution service for testing
    struct MockExecutionService;
    
    #[async_trait]
    impl ExecutionService for MockExecutionService {
        async fn execute(&self, signal: &Signal) -> Result<ExecutionResult, String> {
            // Create a mock successful execution
            Ok(ExecutionResult {
                id: Uuid::new_v4().to_string(),
                signal_id: signal.id.clone(),
                symbol: signal.symbol.clone(),
                status: ExecutionStatus::Completed,
                timestamp: Utc::now(),
                execution_time_ms: 10,
                average_price: dec!(100),
                executed_quantity: dec!(1),
                realized_pnl: if signal.is_exit() {
                    dec!(50) // Profit on exit
                } else {
                    dec!(0) // No PnL on entry
                },
                message: "Successfully executed".to_string(),
                fees: dec!(1),
            })
        }
    }
    
    #[tokio::test]
    async fn test_strategy_executor() {
        // Create sample market data
        let candles = vec![
            Candle {
                timestamp: Utc::now() - chrono::Duration::minutes(2),
                open: dec!(100),
                high: dec!(105),
                low: dec!(98),
                close: dec!(102),
                volume: dec!(1000),
            },
            Candle {
                timestamp: Utc::now() - chrono::Duration::minutes(1),
                open: dec!(102),
                high: dec!(110),
                low: dec!(101),
                close: dec!(108),
                volume: dec!(1200),
            },
        ];
        
        let market_data = MarketData {
            symbol: "BTC/USD".to_string(),
            candles: Some(candles),
            orderbook: Some(Orderbook {
                bids: vec![(dec!(107), dec!(5)), (dec!(106), dec!(10))],
                asks: vec![(dec!(109), dec!(5)), (dec!(110), dec!(10))],
            }),
            timestamp: Utc::now(),
            technical_indicators: None,
            market_sentiment: None,
        };
        
        let market_provider = MockMarketDataProvider { data: market_data };
        let execution_service = MockExecutionService;
        
        // Create risk manager
        let risk_config = RiskManagerConfig {
            max_total_exposure: dec!(0.5),     // 50%
            max_daily_drawdown: dec!(0.05),    // 5%
            max_position_size: dec!(0.1),      // 10%
            strict_enforcement: true,
        };
        
        let risk_manager: Box<dyn RiskManager> = Box::new(DefaultRiskManager::new(risk_config));
        
        // Create telemetry reporter
        let telemetry = Arc::new(MockTelemetryReporter::new());
        
        // Create strategy executor
        let mut executor = StrategyExecutor::new(
            market_provider,
            execution_service,
            risk_manager,
            Some(telemetry.clone()),
        );
        
        // Add strategies
        executor.add_strategy(
            "conservative",
            Box::new(ExampleStrategy::new("conservative", true)),
        );
        
        executor.add_strategy(
            "aggressive",
            Box::new(ExampleStrategy::new("aggressive", false)),
        );
        
        // Execute one cycle
        executor.execute_cycle().await.unwrap();
        
        // Check telemetry events
        let events = telemetry.get_events();
        
        // Print events for inspection
        println!("Events: {:#?}", events);
        
        // Verify we have various event types
        let event_types: Vec<_> = events.iter().map(|(event_type, _)| event_type).collect();
        println!("Event types: {:?}", event_types);
        
        assert!(events.iter().any(|(event_type, _)| event_type == "market_risk_assessment"));
        assert!(events.iter().any(|(event_type, _)| event_type == "strategy_added"));
        
        // The signal generation is random in our example, so we can't assert specific events
        // but we can verify the executor is working in a basic way
    }
} 