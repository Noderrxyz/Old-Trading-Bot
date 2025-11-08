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

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::collections::HashMap;
use uuid::Uuid;

use crate::market::{Candle, MarketData, Orderbook};
use crate::risk::{DefaultRiskManager, MarketRiskAssessment, PositionSizing, RiskError, RiskManager, RiskManagerConfig, RiskMetrics};
use crate::strategy::{RiskProfile, Signal, SignalAction, StrategyPerformance};

/// Helper function to create a test market data instance
fn create_test_market_data() -> MarketData {
    let candles = vec![
        Candle {
            timestamp: chrono::Utc::now() - chrono::Duration::minutes(10),
            open: dec!(100),
            high: dec!(110),
            low: dec!(95),
            close: dec!(105),
            volume: dec!(1000),
        },
        Candle {
            timestamp: chrono::Utc::now() - chrono::Duration::minutes(5),
            open: dec!(105),
            high: dec!(115),
            low: dec!(102),
            close: dec!(112),
            volume: dec!(1200),
        },
        Candle {
            timestamp: chrono::Utc::now(),
            open: dec!(112),
            high: dec!(120),
            low: dec!(108),
            close: dec!(118),
            volume: dec!(1500),
        },
    ];
    
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    
    // Add some bids and asks to create an orderbook
    for i in 0..10 {
        bids.push((dec!(100) - Decimal::new(i, 0), dec!(10) - Decimal::new(i, 1)));
        asks.push((dec!(100) + Decimal::new(i, 0), dec!(10) - Decimal::new(i, 1)));
    }
    
    let orderbook = Orderbook {
        bids,
        asks,
    };
    
    MarketData {
        symbol: "BTC/USD".to_string(),
        candles: Some(candles),
        orderbook: Some(orderbook),
        timestamp: chrono::Utc::now(),
        technical_indicators: None,
        market_sentiment: None,
    }
}

/// Helper function to create a test signal
fn create_test_signal(strategy_id: &str, action: SignalAction) -> Signal {
    Signal {
        id: Uuid::new_v4().to_string(),
        strategy_id: strategy_id.to_string(),
        symbol: "BTC/USD".to_string(),
        action,
        confidence: dec!(0.8),
        source: "test".to_string(),
        generated_at: chrono::Utc::now(),
        signal_type: "trend".to_string(),
        metadata: HashMap::new(),
    }
}

/// Helper function to create a test risk profile
fn create_test_risk_profile(conservative: bool) -> RiskProfile {
    if conservative {
        RiskProfile {
            position_size: dec!(0.05),             // 5% position size
            use_stop_loss: true,
            max_slippage: dec!(0.01),             // 1% max slippage
            volatility_aversion: dec!(0.8),       // High volatility aversion
            strict_validation: true,
        }
    } else {
        RiskProfile {
            position_size: dec!(0.2),              // 20% position size
            use_stop_loss: false,
            max_slippage: dec!(0.05),             // 5% max slippage
            volatility_aversion: dec!(0.3),       // Low volatility aversion
            strict_validation: false,
        }
    }
}

/// Helper function to create a test strategy performance record
fn create_test_performance(strategy_id: &str, profitable: bool, drawdown: Decimal, allocation: Decimal) -> StrategyPerformance {
    StrategyPerformance {
        strategy_id: strategy_id.to_string(),
        winning_trades: if profitable { 10 } else { 5 },
        losing_trades: if profitable { 5 } else { 10 },
        last_trade_profitable: profitable,
        last_trade_result: Some(if profitable { dec!(100) } else { dec!(-100) }),
        current_drawdown: drawdown,
        max_drawdown: drawdown + dec!(0.01),
        current_allocation: allocation,
        daily_pnl: if profitable { dec!(500) } else { dec!(-500) },
    }
}

#[test]
fn test_risk_manager_config_default() {
    let config = RiskManagerConfig::default();
    
    assert_eq!(config.max_total_exposure, dec!(0.8));
    assert_eq!(config.max_daily_drawdown, dec!(0.05));
    assert_eq!(config.max_position_size, dec!(0.1));
    assert!(config.strict_enforcement);
}

#[test]
fn test_risk_manager_initialization() {
    let risk_manager = DefaultRiskManager::default();
    
    // Get risk metrics for a non-existent strategy should return default metrics
    let metrics = risk_manager.get_risk_metrics("nonexistent-strategy");
    assert_eq!(metrics.current_exposure, Decimal::zero());
    assert_eq!(metrics.win_rate, dec!(0.5));
    assert!(metrics.is_active);
}

#[test]
fn test_validate_signal_for_exit_signals() {
    let risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    let signal = create_test_signal(strategy_id, SignalAction::Exit(None));
    let risk_profile = create_test_risk_profile(true);
    
    // Exit signals should always be validated without issues
    let result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(result.is_ok());
}

#[test]
fn test_validate_signal_for_disabled_strategy() {
    let mut risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    
    // Create a performance record that would disable the strategy
    let performance = create_test_performance(strategy_id, false, dec!(0.15), dec!(0.1));
    
    // Update metrics for the strategy to disable it
    risk_manager.update_metrics(strategy_id, &performance);
    
    // Verify strategy is disabled due to excessive drawdown
    let metrics = risk_manager.get_risk_metrics(strategy_id);
    assert!(!metrics.is_active);
    
    // Create a signal for the disabled strategy
    let signal = create_test_signal(strategy_id, SignalAction::Enter(None));
    let risk_profile = create_test_risk_profile(true);
    
    // Validate should fail for disabled strategy
    let result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(result.is_err());
    
    if let Err(error) = result {
        match error {
            RiskError::StrategyDisabled(message) => {
                assert!(message.contains(strategy_id));
            },
            _ => panic!("Expected StrategyDisabled error, got: {:?}", error),
        }
    }
}

#[test]
fn test_validate_signal_for_drawdown_limit() {
    let mut risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    
    // Create a performance record with high drawdown
    let performance = create_test_performance(strategy_id, false, dec!(0.06), dec!(0.1));
    
    // Update metrics for the strategy
    risk_manager.update_metrics(strategy_id, &performance);
    
    // Verify the strategy is still active but has high drawdown
    let metrics = risk_manager.get_risk_metrics(strategy_id);
    assert!(metrics.is_active);
    assert!(metrics.current_drawdown > dec!(0.05));
    
    // Create a signal for the strategy
    let signal = create_test_signal(strategy_id, SignalAction::Enter(None));
    let risk_profile = create_test_risk_profile(true);
    
    // Validate should fail due to drawdown limit
    let result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(result.is_err());
    
    if let Err(error) = result {
        match error {
            RiskError::RiskLimitBreached(message) => {
                assert!(message.contains("drawdown"));
            },
            _ => panic!("Expected RiskLimitBreached error, got: {:?}", error),
        }
    }
}

#[test]
fn test_validate_signal_for_total_exposure() {
    let mut risk_manager = DefaultRiskManager::default();
    
    // Add multiple strategies with high exposure
    for i in 0..5 {
        let strategy_id = format!("test-strategy-{}", i);
        let performance = create_test_performance(&strategy_id, true, dec!(0.01), dec!(0.2));
        risk_manager.update_metrics(&strategy_id, &performance);
    }
    
    // Create a signal for a new strategy
    let signal = create_test_signal("new-strategy", SignalAction::Enter(None));
    let risk_profile = create_test_risk_profile(false);
    
    // Validate should fail due to total exposure limit
    let result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(result.is_err());
    
    if let Err(error) = result {
        match error {
            RiskError::RiskLimitBreached(message) => {
                assert!(message.contains("exposure"));
            },
            _ => panic!("Expected RiskLimitBreached error, got: {:?}", error),
        }
    }
}

#[test]
fn test_volatility_rejection() {
    let mut risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    
    // Create market data with high volatility
    let mut market_data = create_test_market_data();
    
    // Assess market risk
    let risk_assessment = risk_manager.assess_market_risk(&market_data);
    
    // Manually set high volatility and risk score in the risk manager
    let risk_manager = unsafe {
        let risk_manager_ptr = &risk_manager as *const DefaultRiskManager as *mut DefaultRiskManager;
        (*risk_manager_ptr).market_assessment = MarketRiskAssessment {
            volatility: dec!(0.9),
            liquidity: dec!(0.3),
            trend_strength: dec!(0.5),
            risk_score: dec!(0.8),
        };
        risk_manager
    };
    
    // Create a signal and a low volatility aversion risk profile
    let signal = create_test_signal(strategy_id, SignalAction::Enter(None));
    let risk_profile = create_test_risk_profile(false); // Low volatility aversion
    
    // Validate should fail due to high volatility
    let result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(result.is_err());
    
    if let Err(error) = result {
        match error {
            RiskError::SignalRejected(message) => {
                assert!(message.contains("volatility"));
            },
            _ => panic!("Expected SignalRejected error, got: {:?}", error),
        }
    }
    
    // Now try with a high volatility aversion profile
    let risk_profile = create_test_risk_profile(true); // High volatility aversion
    
    // This should pass despite high volatility
    let result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(result.is_ok());
}

#[test]
fn test_position_sizing() {
    let risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    
    // Create signals for testing
    let entry_signal = create_test_signal(strategy_id, SignalAction::Enter(None));
    let exit_signal = create_test_signal(strategy_id, SignalAction::Exit(None));
    
    // Test conservative risk profile
    let conservative_profile = create_test_risk_profile(true);
    let result = risk_manager.calculate_position_size(&entry_signal, &conservative_profile);
    assert!(result.is_ok());
    
    if let Ok(position_sizing) = result {
        assert_eq!(position_sizing.recommended_size, dec!(0.05)); // Original in profile
        assert_eq!(position_sizing.maximum_size, dec!(0.1));      // From config
        assert!(position_sizing.adjusted_size <= dec!(0.05));     // Should be <= recommended
    }
    
    // Test aggressive risk profile
    let aggressive_profile = create_test_risk_profile(false);
    let result = risk_manager.calculate_position_size(&entry_signal, &aggressive_profile);
    assert!(result.is_ok());
    
    if let Ok(position_sizing) = result {
        assert_eq!(position_sizing.recommended_size, dec!(0.2));  // Original in profile
        assert_eq!(position_sizing.maximum_size, dec!(0.1));      // From config
        assert!(position_sizing.adjusted_size <= dec!(0.1));      // Capped at max
    }
    
    // Test exit signal (should always be 100%)
    let result = risk_manager.calculate_position_size(&exit_signal, &conservative_profile);
    assert!(result.is_ok());
    
    if let Ok(position_sizing) = result {
        assert_eq!(position_sizing.recommended_size, dec!(1));
        assert_eq!(position_sizing.maximum_size, dec!(1));
        assert_eq!(position_sizing.adjusted_size, dec!(1));
    }
}

#[test]
fn test_update_metrics() {
    let mut risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    
    // Create initial performance 
    let initial_performance = create_test_performance(strategy_id, true, dec!(0.02), dec!(0.1));
    
    // Update metrics
    risk_manager.update_metrics(strategy_id, &initial_performance);
    
    // Check metrics were updated correctly
    let metrics = risk_manager.get_risk_metrics(strategy_id);
    assert_eq!(metrics.current_exposure, dec!(0.1));
    assert_eq!(metrics.current_drawdown, dec!(0.02));
    assert_eq!(metrics.consecutive_losses, 0); // Last trade was profitable
    assert_eq!(metrics.win_rate, dec!(0.6667)); // 10 wins out of 15 total ~= 0.6667
    assert!(metrics.is_active);
    
    // Create a performance with consecutive losses
    let losing_performance = create_test_performance(strategy_id, false, dec!(0.04), dec!(0.15));
    
    // Update metrics again
    risk_manager.update_metrics(strategy_id, &losing_performance);
    
    // Check metrics were updated correctly
    let metrics = risk_manager.get_risk_metrics(strategy_id);
    assert_eq!(metrics.current_exposure, dec!(0.15));
    assert_eq!(metrics.current_drawdown, dec!(0.04));
    assert_eq!(metrics.consecutive_losses, 1); // Increased due to unprofitable last trade
    assert_eq!(metrics.win_rate, dec!(0.3333)); // 5 wins out of 15 total ~= 0.3333
    assert!(metrics.is_active);
    
    // Create a performance with excessive losses to test deactivation
    let extreme_performance = create_test_performance(strategy_id, false, dec!(0.12), dec!(0.05));
    extreme_performance.winning_trades = 1;
    extreme_performance.losing_trades = 20;
    
    // Update metrics for extreme case
    risk_manager.update_metrics(strategy_id, &extreme_performance);
    
    // Check metrics - strategy should be disabled
    let metrics = risk_manager.get_risk_metrics(strategy_id);
    assert!(!metrics.is_active);
}

#[test]
fn test_assess_market_risk() {
    let risk_manager = DefaultRiskManager::default();
    let market_data = create_test_market_data();
    
    // Assess market risk
    let assessment = risk_manager.assess_market_risk(&market_data);
    
    // Basic validation of assessment values
    assert!(assessment.volatility > Decimal::zero() && assessment.volatility <= Decimal::one());
    assert!(assessment.liquidity > Decimal::zero() && assessment.liquidity <= Decimal::one());
    assert!(assessment.trend_strength >= -Decimal::one() && assessment.trend_strength <= Decimal::one());
    assert!(assessment.risk_score > Decimal::zero() && assessment.risk_score <= Decimal::one());
}

#[test]
fn test_check_risk_limits() {
    let mut risk_manager = DefaultRiskManager::default();
    let strategy_id = "test-strategy";
    
    // Create a performance with acceptable risk
    let good_performance = create_test_performance(strategy_id, true, dec!(0.02), dec!(0.05));
    
    // Update metrics
    risk_manager.update_metrics(strategy_id, &good_performance);
    
    // Check risk limits - should pass
    let result = risk_manager.check_risk_limits(strategy_id);
    assert!(result.is_ok());
    
    // Create a performance with high drawdown
    let high_drawdown = create_test_performance(strategy_id, false, dec!(0.06), dec!(0.05));
    
    // Update metrics
    risk_manager.update_metrics(strategy_id, &high_drawdown);
    
    // Check risk limits - should fail with strict enforcement
    let result = risk_manager.check_risk_limits(strategy_id);
    assert!(result.is_err());
    
    // Create a custom config with non-strict enforcement
    let non_strict_config = RiskManagerConfig {
        strict_enforcement: false,
        ..RiskManagerConfig::default()
    };
    
    // Create a new risk manager with non-strict config
    let mut non_strict_manager = DefaultRiskManager::new(non_strict_config);
    
    // Update metrics in the non-strict manager
    non_strict_manager.update_metrics(strategy_id, &high_drawdown);
    
    // Check risk limits - should issue warning but not error with non-strict enforcement
    let result = non_strict_manager.check_risk_limits(strategy_id);
    assert!(result.is_ok());
}

#[test]
fn test_end_to_end_workflow() {
    // This test simulates a full workflow of the risk manager in a strategy execution environment
    
    // 1. Set up risk manager and market data
    let mut risk_manager = DefaultRiskManager::default();
    let market_data = create_test_market_data();
    let strategy_id = "test-strategy";
    
    // 2. Assess market risk
    let risk_assessment = risk_manager.assess_market_risk(&market_data);
    
    // 3. Create a signal
    let signal = create_test_signal(strategy_id, SignalAction::Enter(None));
    let risk_profile = create_test_risk_profile(true);
    
    // 4. Validate signal
    let validation_result = risk_manager.validate_signal(&signal, &risk_profile);
    assert!(validation_result.is_ok());
    
    // 5. Calculate position size
    let sizing_result = risk_manager.calculate_position_size(&signal, &risk_profile);
    assert!(sizing_result.is_ok());
    
    let position_sizing = sizing_result.unwrap();
    
    // 6. Simulate execution and update performance
    let performance = create_test_performance(strategy_id, true, dec!(0.02), position_sizing.adjusted_size);
    risk_manager.update_metrics(strategy_id, &performance);
    
    // 7. Check risk limits after execution
    let limits_result = risk_manager.check_risk_limits(strategy_id);
    assert!(limits_result.is_ok());
    
    // 8. Simulate a losing trade
    let losing_performance = create_test_performance(strategy_id, false, dec!(0.04), position_sizing.adjusted_size);
    risk_manager.update_metrics(strategy_id, &losing_performance);
    
    // 9. Get updated metrics
    let updated_metrics = risk_manager.get_risk_metrics(strategy_id);
    assert_eq!(updated_metrics.consecutive_losses, 1);
    
    // 10. Exit the position
    let exit_signal = create_test_signal(strategy_id, SignalAction::Exit(None));
    let exit_validation = risk_manager.validate_signal(&exit_signal, &risk_profile);
    assert!(exit_validation.is_ok());
    
    let exit_sizing = risk_manager.calculate_position_size(&exit_signal, &risk_profile).unwrap();
    assert_eq!(exit_sizing.adjusted_size, dec!(1)); // Exit should use full position
}

// This test simulates interactions between the RiskManager and StrategyExecutor
#[test]
fn test_strategy_executor_integration() {
    // Set up a mock strategy execution environment
    let mut risk_manager = DefaultRiskManager::default();
    let market_data = create_test_market_data();
    
    // Multiple strategies with different risk profiles
    let strategies = vec![
        ("conservative-strategy", create_test_risk_profile(true)),
        ("aggressive-strategy", create_test_risk_profile(false)),
    ];
    
    // Simulate market assessment in execution cycle
    let market_risk = risk_manager.assess_market_risk(&market_data);
    
    // Process each strategy
    for (strategy_id, risk_profile) in strategies {
        // Simulate signal generation
        let signal = create_test_signal(strategy_id, SignalAction::Enter(None));
        
        // Step 1: StrategyExecutor would validate the signal
        let validation_result = risk_manager.validate_signal(&signal, &risk_profile);
        
        if validation_result.is_ok() {
            // Step 2: StrategyExecutor would calculate position size
            let sizing_result = risk_manager.calculate_position_size(&signal, &risk_profile);
            
            if let Ok(position_sizing) = sizing_result {
                // Step 3: StrategyExecutor would execute the order with adjusted size
                println!("Executing order for {}: {} BTC", 
                    strategy_id, 
                    position_sizing.adjusted_size
                );
                
                // Step 4: After execution, StrategyExecutor would update metrics
                let performance = create_test_performance(
                    strategy_id, 
                    true, // Simulate profitable trade
                    dec!(0.01), 
                    position_sizing.adjusted_size
                );
                
                risk_manager.update_metrics(strategy_id, &performance);
                
                // Step 5: StrategyExecutor would check risk limits after execution
                let limits_check = risk_manager.check_risk_limits(strategy_id);
                assert!(limits_check.is_ok());
            }
        } else {
            // Signal was rejected - StrategyExecutor would log and skip execution
            println!("Signal rejected for {}: {:?}", strategy_id, validation_result.err());
        }
    }
    
    // Simulate market condition change (high volatility scenario)
    // In a real StrategyExecutor, this would come from market data updates
    let risk_manager = unsafe {
        let risk_manager_ptr = &risk_manager as *const DefaultRiskManager as *mut DefaultRiskManager;
        (*risk_manager_ptr).market_assessment = MarketRiskAssessment {
            volatility: dec!(0.9),
            liquidity: dec!(0.3),
            trend_strength: dec!(-0.7),
            risk_score: dec!(0.85),
        };
        risk_manager
    };
    
    // Process strategies again with changed market conditions
    for (strategy_id, risk_profile) in strategies {
        let signal = create_test_signal(strategy_id, SignalAction::Enter(None));
        
        // Validate signal again with new market conditions
        let validation_result = risk_manager.validate_signal(&signal, &risk_profile);
        
        // Conservative strategy should still be valid even in high volatility
        // Aggressive strategy should be rejected
        if strategy_id == "conservative-strategy" && risk_profile.volatility_aversion > dec!(0.7) {
            assert!(validation_result.is_ok());
        } else if strategy_id == "aggressive-strategy" && risk_profile.volatility_aversion < dec!(0.5) {
            assert!(validation_result.is_err());
        }
    }
} 