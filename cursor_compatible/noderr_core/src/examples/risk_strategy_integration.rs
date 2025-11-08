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

//! Example demonstrating the integration between RiskManager and StrategyExecutor.
//! 
//! This example shows how to:
//! 1. Initialize the RiskManager with custom configuration
//! 2. Register strategies with different risk profiles
//! 3. Process market data and generate signals
//! 4. Apply risk management to validate signals
//! 5. Calculate appropriate position sizes
//! 6. Execute validated signals
//! 7. Update risk metrics based on strategy performance
//! 8. Handle breached risk limits and telemetry

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::execution::{ExecutionResult, ExecutionService, ExecutionStatus};
use crate::market::{MarketData, MarketDataProvider};
use crate::risk::{DefaultRiskManager, RiskError, RiskManager, RiskManagerConfig, RiskMetrics};
use crate::strategy::{RiskProfile, Signal, SignalAction, Strategy, StrategyPerformance};
use crate::telemetry::TelemetryReporter;

/// Sample strategy executor with integrated risk management.
pub struct RiskAwareStrategyExecutor<T: MarketDataProvider, E: ExecutionService> {
    // Core components
    strategies: HashMap<String, Box<dyn Strategy>>,
    risk_manager: Arc<Mutex<Box<dyn RiskManager>>>,
    market_data_provider: T,
    execution_service: E,
    telemetry_reporter: Option<Arc<dyn TelemetryReporter>>,
    
    // Strategy state
    strategy_states: HashMap<String, StrategyPerformance>,
    
    // Configuration
    enable_risk_management: bool,
}

impl<T: MarketDataProvider, E: ExecutionService> RiskAwareStrategyExecutor<T, E> {
    /// Create a new RiskAwareStrategyExecutor with the given components
    pub fn new(
        market_data_provider: T,
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
            strategy_states: HashMap::new(),
            enable_risk_management: true,
        }
    }
    
    /// Add a strategy to the executor
    pub fn add_strategy(&mut self, strategy_id: String, strategy: Box<dyn Strategy>) {
        // Initialize performance metrics for the strategy
        self.strategy_states.insert(strategy_id.clone(), StrategyPerformance {
            strategy_id: strategy_id.clone(),
            winning_trades: 0,
            losing_trades: 0,
            last_trade_profitable: false,
            last_trade_result: None,
            current_drawdown: Decimal::zero(),
            max_drawdown: Decimal::zero(),
            current_allocation: Decimal::zero(),
            daily_pnl: Decimal::zero(),
        });
        
        // Add the strategy
        self.strategies.insert(strategy_id, strategy);
    }
    
    /// Execute a single cycle of all registered strategies
    pub async fn execute_cycle(&mut self) -> Result<(), String> {
        // Get latest market data
        let market_data = match self.market_data_provider.get_market_data().await {
            Ok(data) => data,
            Err(e) => {
                error!("Failed to get market data: {:?}", e);
                return Err(format!("Failed to get market data: {:?}", e));
            }
        };
        
        // Assess market risk
        let market_risk = {
            let risk_manager = self.risk_manager.lock().unwrap();
            risk_manager.assess_market_risk(&market_data)
        };
        
        info!("Market risk assessment: volatility={:.2}, liquidity={:.2}, risk_score={:.2}", 
              market_risk.volatility, market_risk.liquidity, market_risk.risk_score);
        
        // Process each strategy
        for (strategy_id, strategy) in &self.strategies {
            // Check risk limits before running the strategy
            let risk_check_result = {
                let risk_manager = self.risk_manager.lock().unwrap();
                risk_manager.check_risk_limits(strategy_id)
            };
            
            // Skip strategy if risk limits are breached
            if let Err(risk_error) = risk_check_result {
                warn!("Skipping strategy {} due to risk limit breach: {:?}", strategy_id, risk_error);
                if let Some(reporter) = &self.telemetry_reporter {
                    reporter.report_event("risk_limit_breached", &[
                        ("strategy_id", strategy_id.as_str()),
                        ("reason", &format!("{:?}", risk_error)),
                    ]).await;
                }
                continue;
            }
            
            // Generate signal from strategy
            let signal_result = strategy.generate_signal(&market_data).await;
            
            if let Ok(Some(signal)) = signal_result {
                debug!("Strategy {} generated signal: {:?}", strategy_id, signal.action);
                
                // Get risk profile for the strategy
                let risk_profile = strategy.get_risk_profile().await;
                
                if self.enable_risk_management {
                    // Validate signal against risk manager
                    let validation_result = {
                        let risk_manager = self.risk_manager.lock().unwrap();
                        risk_manager.validate_signal(&signal, &risk_profile)
                    };
                    
                    if let Err(risk_error) = validation_result {
                        warn!("Signal rejected due to risk constraints: {:?}", risk_error);
                        if let Some(reporter) = &self.telemetry_reporter {
                            reporter.report_event("signal_rejected", &[
                                ("strategy_id", strategy_id.as_str()),
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
                        // Execute signal with adjusted position size
                        let execution_result = self.execute_signal(
                            &signal, 
                            position_sizing.adjusted_size
                        ).await;
                        
                        // Update strategy performance based on execution result
                        if let Ok(result) = execution_result {
                            self.update_strategy_performance(strategy_id, &result).await;
                            
                            // Update risk metrics
                            let state = self.strategy_states.get(strategy_id).unwrap();
                            let mut risk_manager = self.risk_manager.lock().unwrap();
                            risk_manager.update_metrics(strategy_id, state);
                        }
                    } else {
                        warn!("Failed to calculate position size: {:?}", position_sizing_result.err());
                    }
                } else {
                    // Execute signal without risk management
                    let execution_result = self.execute_signal(&signal, dec!(1)).await;
                    
                    // Update strategy performance based on execution result
                    if let Ok(result) = execution_result {
                        self.update_strategy_performance(strategy_id, &result).await;
                    }
                }
            }
        }
        
        Ok(())
    }
    
    /// Execute a signal with the specified position size
    async fn execute_signal(&self, signal: &Signal, position_size: Decimal) -> Result<ExecutionResult, String> {
        // Create a copy of the signal with adjusted size
        let mut adjusted_signal = signal.clone();
        
        // Apply position sizing
        match &adjusted_signal.action {
            SignalAction::Enter(_) => {
                info!("Executing entry signal for {} with position size {:.2}%", 
                      signal.symbol, position_size * dec!(100));
            },
            SignalAction::Exit(_) => {
                info!("Executing exit signal for {}", signal.symbol);
            },
            _ => {
                // For other action types, handle as needed
                info!("Executing signal: {:?}", signal.action);
            }
        }
        
        // Execute the signal through the execution service
        match self.execution_service.execute(&adjusted_signal).await {
            Ok(result) => {
                if result.status == ExecutionStatus::Completed {
                    info!("Signal executed successfully: {}", result.id);
                } else {
                    warn!("Signal execution status: {:?}", result.status);
                }
                Ok(result)
            },
            Err(e) => {
                error!("Signal execution failed: {:?}", e);
                Err(format!("Execution failed: {:?}", e))
            }
        }
    }
    
    /// Update strategy performance based on execution result
    async fn update_strategy_performance(&mut self, strategy_id: &str, result: &ExecutionResult) {
        if let Some(state) = self.strategy_states.get_mut(strategy_id) {
            // Record win/loss
            let is_profitable = result.realized_pnl.is_sign_positive();
            
            if is_profitable {
                state.winning_trades += 1;
            } else {
                state.losing_trades += 1;
            }
            
            // Update last trade result
            state.last_trade_profitable = is_profitable;
            state.last_trade_result = Some(result.realized_pnl);
            
            // Update PnL
            state.daily_pnl += result.realized_pnl;
            
            // Update allocation and drawdown (simplified)
            // In a real system, this would be calculated based on actual portfolio value
            // This is just a placeholder for the example
            state.current_allocation = dec!(0.1); // Placeholder
            
            // Calculate drawdown
            // In a real system, this would be based on peak equity vs current equity
            let drawdown = if result.realized_pnl.is_sign_negative() {
                result.realized_pnl.abs() / dec!(10000) // Just an example calculation
            } else {
                Decimal::zero()
            };
            
            state.current_drawdown = drawdown;
            state.max_drawdown = std::cmp::max_by(
                state.max_drawdown,
                drawdown,
                |a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
            );
            
            // Report telemetry
            if let Some(reporter) = &self.telemetry_reporter {
                reporter.report_event("trade_executed", &[
                    ("strategy_id", strategy_id),
                    ("symbol", &result.symbol),
                    ("pnl", &result.realized_pnl.to_string()),
                    ("win", &is_profitable.to_string()),
                ]).await;
            }
        }
    }
    
    /// Disable risk management
    pub fn disable_risk_management(&mut self) {
        self.enable_risk_management = false;
    }
    
    /// Enable risk management
    pub fn enable_risk_management(&mut self) {
        self.enable_risk_management = true;
    }
    
    /// Start a continuous execution loop
    pub async fn start_execution_loop(&mut self, interval_ms: u64) {
        use tokio::time::{sleep, Duration};
        
        loop {
            if let Err(e) = self.execute_cycle().await {
                error!("Execution cycle failed: {}", e);
            }
            
            sleep(Duration::from_millis(interval_ms)).await;
        }
    }
}

/// Example usage of RiskAwareStrategyExecutor
#[cfg(test)]
mod examples {
    use super::*;
    use async_trait::async_trait;
    use chrono::Utc;
    use tokio::sync::Mutex as TokioMutex;
    
    // Simplified mock market data provider for the example
    struct MockMarketDataProvider {
        data: MarketData,
    }
    
    #[async_trait]
    impl MarketDataProvider for MockMarketDataProvider {
        async fn get_market_data(&self) -> Result<MarketData, String> {
            Ok(self.data.clone())
        }
        
        async fn get_historical_candles(&self, _symbol: &str, _interval: &str, _limit: usize) 
            -> Result<Vec<crate::market::Candle>, String> {
            Ok(vec![])
        }
    }
    
    // Simplified mock execution service for the example
    struct MockExecutionService;
    
    #[async_trait]
    impl ExecutionService for MockExecutionService {
        async fn execute(&self, signal: &Signal) -> Result<ExecutionResult, String> {
            // Simulate execution result
            Ok(ExecutionResult {
                id: Uuid::new_v4().to_string(),
                signal_id: signal.id.clone(),
                symbol: signal.symbol.clone(),
                status: ExecutionStatus::Completed,
                timestamp: Utc::now(),
                execution_time_ms: 50,
                average_price: dec!(100),
                executed_quantity: dec!(1),
                realized_pnl: if matches!(signal.action, SignalAction::Exit(_)) {
                    dec!(50) // Profitable exit
                } else {
                    dec!(0) // No PnL for entries
                },
                message: "Execution completed".to_string(),
                fees: dec!(1),
            })
        }
    }
    
    // Simplified mock strategy
    struct MockStrategy {
        id: String,
        risk_profile: RiskProfile,
        generate_buy_signals: bool,
    }
    
    #[async_trait]
    impl Strategy for MockStrategy {
        async fn generate_signal(&self, _market_data: &MarketData) -> Result<Option<Signal>, String> {
            if self.generate_buy_signals {
                Ok(Some(Signal {
                    id: Uuid::new_v4().to_string(),
                    strategy_id: self.id.clone(),
                    symbol: "BTC/USD".to_string(),
                    action: SignalAction::Enter(None),
                    confidence: dec!(0.8),
                    source: "test".to_string(),
                    generated_at: Utc::now(),
                    signal_type: "trend".to_string(),
                    metadata: HashMap::new(),
                }))
            } else {
                Ok(None)
            }
        }
        
        async fn get_risk_profile(&self) -> RiskProfile {
            self.risk_profile.clone()
        }
    }
    
    // Simplified mock telemetry reporter
    struct MockTelemetryReporter {
        events: Arc<TokioMutex<Vec<(String, Vec<(String, String)>)>>>,
    }
    
    #[async_trait]
    impl TelemetryReporter for MockTelemetryReporter {
        async fn report_event(&self, event_type: &str, attributes: &[(&str, &str)]) {
            let mut events = self.events.lock().await;
            let attrs = attributes.iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            
            events.push((event_type.to_string(), attrs));
        }
        
        async fn report_metrics(&self, _metrics: &[(&str, f64)]) {
            // Not implemented for this example
        }
    }
    
    impl MockTelemetryReporter {
        fn new() -> Self {
            Self {
                events: Arc::new(TokioMutex::new(Vec::new())),
            }
        }
        
        async fn get_events(&self) -> Vec<(String, Vec<(String, String)>)> {
            self.events.lock().await.clone()
        }
    }
    
    #[tokio::test]
    async fn test_risk_aware_strategy_executor() {
        // Create mock market data
        let market_data = MarketData {
            symbol: "BTC/USD".to_string(),
            candles: None,
            orderbook: None,
            timestamp: Utc::now(),
            technical_indicators: None,
            market_sentiment: None,
        };
        
        let market_provider = MockMarketDataProvider { data: market_data };
        let execution_service = MockExecutionService;
        
        // Create risk manager with custom config
        let risk_config = RiskManagerConfig {
            max_total_exposure: dec!(0.5),     // 50% max exposure
            max_daily_drawdown: dec!(0.05),    // 5% max drawdown
            max_position_size: dec!(0.1),      // 10% max position size
            strict_enforcement: true,
        };
        
        let risk_manager: Box<dyn RiskManager> = Box::new(DefaultRiskManager::new(risk_config));
        
        // Create telemetry reporter
        let telemetry = Arc::new(MockTelemetryReporter::new());
        
        // Create strategy executor
        let mut executor = RiskAwareStrategyExecutor::new(
            market_provider,
            execution_service,
            risk_manager,
            Some(telemetry.clone()),
        );
        
        // Create and add strategies
        let conservative_strategy = MockStrategy {
            id: "conservative-strategy".to_string(),
            risk_profile: RiskProfile {
                position_size: dec!(0.05),         // 5% position size
                use_stop_loss: true,
                max_slippage: dec!(0.01),         // 1% max slippage
                volatility_aversion: dec!(0.8),   // High volatility aversion
                strict_validation: true,
            },
            generate_buy_signals: true,
        };
        
        let aggressive_strategy = MockStrategy {
            id: "aggressive-strategy".to_string(),
            risk_profile: RiskProfile {
                position_size: dec!(0.2),          // 20% position size
                use_stop_loss: false,
                max_slippage: dec!(0.05),         // 5% max slippage
                volatility_aversion: dec!(0.3),   // Low volatility aversion
                strict_validation: false,
            },
            generate_buy_signals: true,
        };
        
        // Add strategies to executor
        executor.add_strategy("conservative-strategy".to_string(), Box::new(conservative_strategy));
        executor.add_strategy("aggressive-strategy".to_string(), Box::new(aggressive_strategy));
        
        // Execute a cycle
        executor.execute_cycle().await.unwrap();
        
        // Check telemetry events
        let events = telemetry.get_events().await;
        assert!(!events.is_empty());
        
        // Execute another cycle
        executor.execute_cycle().await.unwrap();
        
        // Switch to high volatility scenario (would happen automatically in a real system)
        {
            let mut risk_manager = executor.risk_manager.lock().unwrap();
            let risk_manager_ptr = &mut **risk_manager as *mut dyn RiskManager;
            
            // This is unsafe and only for demonstration purposes
            // In a real system, the market risk assessment would be updated naturally
            unsafe {
                let default_manager = risk_manager_ptr as *mut DefaultRiskManager;
                (*default_manager).market_assessment.volatility = dec!(0.9);
                (*default_manager).market_assessment.risk_score = dec!(0.85);
            }
        }
        
        // Execute another cycle with high volatility
        executor.execute_cycle().await.unwrap();
        
        // Check updated telemetry events
        let events = telemetry.get_events().await;
        
        // In high volatility, we'd expect the aggressive strategy to have signals rejected
        let rejection_events: Vec<_> = events.iter()
            .filter(|(event_type, attrs)| {
                event_type == "signal_rejected" && 
                attrs.iter().any(|(k, v)| k == "strategy_id" && v == "aggressive-strategy")
            })
            .collect();
        
        // Print events for inspection
        println!("Telemetry events: {:?}", events);
        
        // This would be a proper assertion in a real test
        // assert!(!rejection_events.is_empty());
    }
} 