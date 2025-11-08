use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::runtime::Runtime;

use noderr_core::order_router::{SmartOrderRouter, Order, OrderSide, OrderRetryEngine};

fn create_test_order(symbol: &str, id: &str, venues: Vec<String>) -> Order {
    Order {
        symbol: symbol.to_string(),
        side: OrderSide::Buy,
        amount: 1.0,
        price: 50000.0,
        venues,
        id: id.to_string(),
        max_slippage: Some(0.01),
        max_retries: Some(1),
        additional_params: HashMap::new(),
    }
}

fn bench_order_router(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("SmartOrderRouter");
    
    // Simple router with default settings
    let router = SmartOrderRouter::new();
    
    // Router with trust scores
    let mut trust_scores = HashMap::new();
    trust_scores.insert("binance".to_string(), 0.9);
    trust_scores.insert("coinbase".to_string(), 0.8);
    trust_scores.insert("kraken".to_string(), 0.7);
    trust_scores.insert("ftx".to_string(), 0.6);
    
    let retry_engine = Arc::new(OrderRetryEngine::new(3, 10, 100)); // Fast for benchmarks
    let router_with_scores = SmartOrderRouter::with_retry_engine(
        retry_engine,
        trust_scores.clone(),
    );
    
    // Benchmark execute_order with a single venue
    group.bench_function(BenchmarkId::new("execute_order", "single_venue"), |b| {
        b.iter(|| {
            let order = create_test_order("BTC-USD", "bench-1", vec!["binance".to_string()]);
            rt.block_on(async {
                let _ = black_box(router.execute_order(order).await);
            });
        });
    });
    
    // Benchmark execute_order with multiple venues
    group.bench_function(BenchmarkId::new("execute_order", "multiple_venues"), |b| {
        b.iter(|| {
            let order = create_test_order(
                "BTC-USD", 
                "bench-2", 
                vec![
                    "binance".to_string(),
                    "coinbase".to_string(),
                    "kraken".to_string(),
                    "ftx".to_string(),
                ]
            );
            rt.block_on(async {
                let _ = black_box(router.execute_order(order).await);
            });
        });
    });
    
    // Benchmark execute_order with trust scores
    group.bench_function(BenchmarkId::new("execute_order", "with_trust_scores"), |b| {
        b.iter(|| {
            let order = create_test_order(
                "BTC-USD", 
                "bench-3", 
                vec![
                    "binance".to_string(),
                    "coinbase".to_string(),
                    "kraken".to_string(),
                    "ftx".to_string(),
                ]
            );
            rt.block_on(async {
                let _ = black_box(router_with_scores.execute_order(order).await);
            });
        });
    });
    
    // Benchmark get_ranked_venues
    group.bench_function(BenchmarkId::new("get_ranked_venues", "multiple_venues"), |b| {
        b.iter(|| {
            let venues = vec![
                "binance".to_string(),
                "coinbase".to_string(),
                "kraken".to_string(),
                "ftx".to_string(),
            ];
            rt.block_on(async {
                let _ = black_box(router_with_scores.get_ranked_venues(&venues).await);
            });
        });
    });
    
    group.finish();
}

criterion_group!(benches, bench_order_router);
criterion_main!(benches); 