use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::runtime::Runtime;
use async_trait::async_trait;

use noderr_core::execution_strategy::{
    ExecutionStrategyRouter, ExecutionStrategyConfig, ExecutionAlgorithm,
    ExecutionStrategy, ExecutionStrategyError, ExecutionStrategyDetails, 
    TWAPConfig, VWAPConfig
};
use noderr_core::execution::ExecutionResult;
use noderr_core::order_router::{Order, OrderSide};

// Mock execution strategies for testing
struct MockTWAPStrategy {}
struct MockVWAPStrategy {}

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

fn bench_execution_strategy_router(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("ExecutionStrategyRouter");
    
    // Create strategy router with mock strategies
    let twap_strategy = Arc::new(MockTWAPStrategy {});
    let vwap_strategy = Arc::new(MockVWAPStrategy {});
    
    let config = ExecutionStrategyConfig {
        default_strategy: ExecutionAlgorithm::TWAP,
        min_order_size_for_twap: 1000.0,
        min_order_size_for_vwap: 5000.0,
        twap_config: Some(TWAPConfig::default()),
        vwap_config: Some(VWAPConfig::default()),
        max_execution_time_ms: 300000,
        symbol_strategy_map: HashMap::new(),
    };
    
    let router = ExecutionStrategyRouter::new(
        config,
        twap_strategy,
        vwap_strategy,
    );
    
    // Helper function to create test orders
    fn create_test_order(id: &str, symbol: &str, amount: f64, execution_mode: Option<&str>) -> Order {
        let mut additional_params = HashMap::new();
        
        if let Some(mode) = execution_mode {
            additional_params.insert(
                "executionMode".to_string(),
                serde_json::Value::String(mode.to_string()),
            );
        }
        
        Order {
            symbol: symbol.to_string(),
            side: OrderSide::Buy,
            amount,
            price: 50000.0,
            venues: vec!["binance".to_string()],
            id: id.to_string(),
            max_slippage: Some(0.01),
            max_retries: None,
            additional_params,
        }
    }
    
    // Benchmark select_execution_strategy for small order
    group.bench_function(BenchmarkId::new("select_strategy", "small_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-1", "BTC-USD", 500.0, None);
            rt.block_on(async {
                let _ = black_box(router.select_execution_strategy(&order).await);
            });
        });
    });
    
    // Benchmark select_execution_strategy for TWAP-sized order
    group.bench_function(BenchmarkId::new("select_strategy", "twap_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-2", "BTC-USD", 2000.0, None);
            rt.block_on(async {
                let _ = black_box(router.select_execution_strategy(&order).await);
            });
        });
    });
    
    // Benchmark select_execution_strategy for VWAP-sized order
    group.bench_function(BenchmarkId::new("select_strategy", "vwap_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-3", "BTC-USD", 10000.0, None);
            rt.block_on(async {
                let _ = black_box(router.select_execution_strategy(&order).await);
            });
        });
    });
    
    // Benchmark select_execution_strategy with explicit execution mode
    group.bench_function(BenchmarkId::new("select_strategy", "explicit_mode"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-4", "BTC-USD", 500.0, Some("VWAP"));
            rt.block_on(async {
                let _ = black_box(router.select_execution_strategy(&order).await);
            });
        });
    });
    
    // Benchmark estimate_impact
    group.bench_function(BenchmarkId::new("estimate_impact", "standard_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-5", "BTC-USD", 2000.0, None);
            rt.block_on(async {
                let _ = black_box(router.estimate_impact(&order).await);
            });
        });
    });
    
    // Benchmark get_cost_estimate
    group.bench_function(BenchmarkId::new("get_cost_estimate", "standard_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-6", "BTC-USD", 2000.0, None);
            rt.block_on(async {
                let _ = black_box(router.get_cost_estimate(&order).await);
            });
        });
    });
    
    // Benchmark full execute method
    group.bench_function(BenchmarkId::new("execute", "twap_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-7", "BTC-USD", 2000.0, None);
            rt.block_on(async {
                let callback = Arc::new(|_result: ExecutionResult| {
                    // Just a simple callback that does nothing
                });
                
                let _ = black_box(router.execute(order, callback).await);
            });
        });
    });
    
    // Benchmark full execute method with VWAP
    group.bench_function(BenchmarkId::new("execute", "vwap_order"), |b| {
        b.iter(|| {
            let order = create_test_order("bench-8", "BTC-USD", 10000.0, None);
            rt.block_on(async {
                let callback = Arc::new(|_result: ExecutionResult| {
                    // Just a simple callback that does nothing
                });
                
                let _ = black_box(router.execute(order, callback).await);
            });
        });
    });
    
    group.finish();
}

criterion_group!(benches, bench_execution_strategy_router);
criterion_main!(benches); 