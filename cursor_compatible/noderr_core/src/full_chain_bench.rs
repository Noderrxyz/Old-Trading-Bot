use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::runtime::Runtime;
use async_trait::async_trait;
use std::time::{Duration, Instant};

use noderr_core::order_router::{SmartOrderRouter, Order, OrderSide};
use noderr_core::risk_calc::{RiskCalculator, RiskConfig, PositionExposure};
use noderr_core::trade_sizer::{DynamicTradeSizer, TradeSizerConfig};
use noderr_core::execution_strategy::{
    ExecutionStrategyRouter, ExecutionStrategyConfig, ExecutionAlgorithm,
    ExecutionStrategy, ExecutionStrategyError, ExecutionStrategyDetails
};
use noderr_core::execution::ExecutionResult;
use noderr_core::risk::PositionDirection;

// Mock execution strategies for testing
struct MockTWAPStrategy {}

#[async_trait]
impl ExecutionStrategy for MockTWAPStrategy {
    async fn execute(
        &self,
        order: Order,
        callback: Arc<dyn Fn(ExecutionResult) + Send + Sync>,
    ) -> Result<(), ExecutionStrategyError> {
        // Create a basic execution result
        let result = ExecutionResult {
            id: "mock-twap-execution".to_string(),
            request_id: order.id.clone(),
            signal_id: "mock-signal".to_string(),
            status: noderr_core::execution::ExecutionStatus::Completed,
            order_id: Some(format!("twap-order-{}", order.id)),
            executed_quantity: Some(order.amount),
            average_price: Some(order.price),
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
            strategy_type: ExecutionAlgorithm::TWAP,
            name: "TWAP".to_string(),
            description: "Time Weighted Average Price".to_string(),
            parameters: HashMap::new(),
        }
    }
    
    async fn cancel(&self) -> Result<(), ExecutionStrategyError> {
        Ok(())
    }
}

struct MockVWAPStrategy {}

#[async_trait]
impl ExecutionStrategy for MockVWAPStrategy {
    async fn execute(
        &self,
        order: Order,
        callback: Arc<dyn Fn(ExecutionResult) + Send + Sync>,
    ) -> Result<(), ExecutionStrategyError> {
        // Create a basic execution result
        let result = ExecutionResult {
            id: "mock-vwap-execution".to_string(),
            request_id: order.id.clone(),
            signal_id: "mock-signal".to_string(),
            status: noderr_core::execution::ExecutionStatus::Completed,
            order_id: Some(format!("vwap-order-{}", order.id)),
            executed_quantity: Some(order.amount),
            average_price: Some(order.price),
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
        Ok(0.002)
    }
    
    async fn get_cost_estimate(&self, order: &Order) -> Result<f64, ExecutionStrategyError> {
        Ok(order.amount * 0.002)
    }
    
    fn get_details(&self) -> ExecutionStrategyDetails {
        ExecutionStrategyDetails {
            strategy_type: ExecutionAlgorithm::VWAP,
            name: "VWAP".to_string(),
            description: "Volume Weighted Average Price".to_string(),
            parameters: HashMap::new(),
        }
    }
    
    async fn cancel(&self) -> Result<(), ExecutionStrategyError> {
        Ok(())
    }
}

fn bench_full_execution_chain(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("FullExecutionChain");
    group.measurement_time(Duration::from_secs(20));
    
    // Create a trade sizer with default settings
    let sizer = DynamicTradeSizer::new();
    
    // Create a risk calculator
    let risk_config = RiskConfig {
        max_position_size_pct: 0.1,
        max_leverage: 3.0,
        max_drawdown_pct: 0.2,
        min_trust_score: 0.7,
        max_exposure_per_symbol: 0.3,
        max_exposure_per_venue: 0.4,
        rebalance_interval_ms: 300000,
        webhook_url: None,
        exempt_strategies: Default::default(),
        fast_risk_mode: true, // Use fast mode for benchmarks
    };
    let risk_calculator = RiskCalculator::new(risk_config, 100000.0);
    
    // Create strategy router with mock strategies
    let twap_strategy = Arc::new(MockTWAPStrategy {});
    let vwap_strategy = Arc::new(MockVWAPStrategy {});
    
    let strategy_config = ExecutionStrategyConfig {
        default_strategy: ExecutionAlgorithm::TWAP,
        min_order_size_for_twap: 1000.0,
        min_order_size_for_vwap: 5000.0,
        twap_config: None,
        vwap_config: None,
        max_execution_time_ms: 300000,
        symbol_strategy_map: HashMap::new(),
    };
    
    let strategy_router = ExecutionStrategyRouter::new(
        strategy_config,
        twap_strategy,
        vwap_strategy,
    );
    
    // Create order router
    let mut trust_scores = HashMap::new();
    trust_scores.insert("binance".to_string(), 0.9);
    trust_scores.insert("coinbase".to_string(), 0.8);
    trust_scores.insert("kraken".to_string(), 0.7);
    
    let order_router = SmartOrderRouter::new();
    
    // Helper function to create a test order
    fn create_test_order(id: &str, symbol: &str, amount: f64, venues: Vec<String>) -> Order {
        Order {
            symbol: symbol.to_string(),
            side: OrderSide::Buy,
            amount,
            price: 50000.0,
            venues,
            id: id.to_string(),
            max_slippage: Some(0.01),
            max_retries: Some(1),
            additional_params: HashMap::new(),
        }
    }
    
    // Helper function to create a position exposure
    fn create_position(symbol: &str, venue: &str, size: f64, value: f64) -> PositionExposure {
        PositionExposure::new(
            symbol,
            venue,
            size,
            value,
            1.0, // Leverage
            0.8, // Trust score
            PositionDirection::Long,
        )
    }
    
    // Benchmark complete execution chain with all components
    group.bench_function(BenchmarkId::new("complete_chain", "standard"), |b| {
        b.iter(|| {
            rt.block_on(async {
                // Measure full chain execution time
                let start = Instant::now();
                
                // 1. Calculate dynamic position size based on volatility
                let base_size = 1000.0;
                let sized_amount = match sizer.calculate_position_size("BTC-USD", base_size).await {
                    Ok(size) => size,
                    Err(_) => base_size,
                };
                
                // 2. Create order with the sized amount
                let order = create_test_order(
                    "bench-full-chain", 
                    "BTC-USD", 
                    sized_amount, 
                    vec!["binance".to_string(), "coinbase".to_string()]
                );
                
                // 3. Perform risk validation
                let position = create_position(
                    &order.symbol, 
                    &order.venues[0], 
                    order.amount, 
                    order.amount * order.price
                );
                
                let risk_result = risk_calculator.fast_risk_check(&position, None).await;
                
                if risk_result.passed {
                    // 4. Execute the order using the appropriate strategy
                    let callback = Arc::new(|_result: ExecutionResult| {
                        // Do nothing with the result for this benchmark
                    });
                    
                    let _ = black_box(strategy_router.execute(order.clone(), callback).await);
                }
                
                // Record full chain execution time
                let elapsed = start.elapsed();
                
                // Ensure execution time is under 5ms
                assert!(elapsed < Duration::from_millis(5), 
                    "Execution chain took {}ms, which exceeds the 5ms target", 
                    elapsed.as_millis());
            });
        });
    });
    
    // Benchmark optimized execution chain for high-frequency trading
    group.bench_function(BenchmarkId::new("complete_chain", "optimized_hft"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let start = Instant::now();
                
                // Use pre-computed size for HFT (no dynamic sizing)
                let sized_amount = 1000.0;
                
                // Create order with the sized amount
                let order = create_test_order(
                    "bench-hft-chain", 
                    "BTC-USD", 
                    sized_amount, 
                    vec!["binance".to_string()] // Single venue for faster execution
                );
                
                // Fast risk check with minimal position details
                let position = create_position(
                    &order.symbol, 
                    &order.venues[0], 
                    order.amount, 
                    order.amount * order.price
                );
                
                let risk_result = risk_calculator.fast_risk_check(&position, Some("hft_strategy")).await;
                
                if risk_result.passed {
                    // Execute directly through order router (bypassing strategy selection)
                    let _ = black_box(order_router.execute_order(order.clone()).await);
                }
                
                let elapsed = start.elapsed();
                assert!(elapsed < Duration::from_millis(2), 
                    "HFT execution chain took {}ms, which exceeds the 2ms target", 
                    elapsed.as_millis());
            });
        });
    });
    
    // Separate benchmark for each component to identify bottlenecks
    group.bench_function(BenchmarkId::new("component", "trade_sizer"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let _ = black_box(sizer.calculate_position_size("BTC-USD", 1000.0).await);
            });
        });
    });
    
    group.bench_function(BenchmarkId::new("component", "risk_calculator"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let position = create_position("BTC-USD", "binance", 0.1, 5000.0);
                let _ = black_box(risk_calculator.fast_risk_check(&position, None).await);
            });
        });
    });
    
    group.bench_function(BenchmarkId::new("component", "strategy_router"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let order = create_test_order(
                    "bench-component", 
                    "BTC-USD", 
                    1000.0, 
                    vec!["binance".to_string()]
                );
                let _ = black_box(strategy_router.select_execution_strategy(&order).await);
            });
        });
    });
    
    group.bench_function(BenchmarkId::new("component", "order_router"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let order = create_test_order(
                    "bench-component", 
                    "BTC-USD", 
                    1000.0, 
                    vec!["binance".to_string()]
                );
                let _ = black_box(order_router.execute_on_venue(&order, "binance").await);
            });
        });
    });
    
    group.finish();
}

criterion_group!(benches, bench_full_execution_chain);
criterion_main!(benches); 