use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::{HashMap, HashSet};
use tokio::runtime::Runtime;

use noderr_core::risk_calc::{RiskCalculator, RiskConfig, PositionExposure};
use noderr_core::risk::PositionDirection;

fn bench_risk_calculator(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("RiskCalculator");
    
    // Create a risk calculator with standard config
    let config = RiskConfig {
        max_position_size_pct: 0.1,
        max_leverage: 3.0,
        max_drawdown_pct: 0.2,
        min_trust_score: 0.7,
        max_exposure_per_symbol: 0.3,
        max_exposure_per_venue: 0.4,
        rebalance_interval_ms: 300000,
        webhook_url: None,
        exempt_strategies: HashSet::new(),
        fast_risk_mode: false,
    };
    
    // Portfolio value of 100,000
    let calculator = RiskCalculator::new(config.clone(), 100000.0);
    
    // Create a position for testing
    let create_position = |symbol: &str, venue: &str, value: f64, leverage: f64, trust_score: f64| {
        PositionExposure::new(
            symbol,
            venue,
            value / 50000.0, // Size in units (assuming price of 50,000)
            value,
            leverage,
            trust_score,
            PositionDirection::Long,
        )
    };
    
    // Benchmark fast_risk_check for a valid position
    group.bench_function(BenchmarkId::new("fast_risk_check", "valid_position"), |b| {
        b.iter(|| {
            let position = create_position("BTC-USD", "binance", 5000.0, 1.0, 0.8);
            rt.block_on(async {
                let _ = black_box(calculator.fast_risk_check(&position, None).await);
            });
        });
    });
    
    // Benchmark fast_risk_check for a position that exceeds limits
    group.bench_function(BenchmarkId::new("fast_risk_check", "invalid_position"), |b| {
        b.iter(|| {
            let position = create_position("BTC-USD", "binance", 15000.0, 4.0, 0.5);
            rt.block_on(async {
                let _ = black_box(calculator.fast_risk_check(&position, None).await);
            });
        });
    });
    
    // Benchmark add_position (which includes validation)
    group.bench_function(BenchmarkId::new("add_position", "valid_position"), |b| {
        b.iter(|| {
            let position = create_position("ETH-USD", "kraken", 3000.0, 1.0, 0.8);
            rt.block_on(async {
                let _ = black_box(calculator.add_position(position.clone()).await);
                // Clean up after ourselves
                let _ = calculator.remove_position("ETH-USD", "kraken").await;
            });
        });
    });
    
    // Benchmark with fast risk mode enabled
    let fast_config = RiskConfig {
        fast_risk_mode: true,
        ..config
    };
    let fast_calculator = RiskCalculator::new(fast_config, 100000.0);
    
    group.bench_function(BenchmarkId::new("fast_risk_check", "fast_mode"), |b| {
        b.iter(|| {
            let position = create_position("BTC-USD", "binance", 5000.0, 1.0, 0.8);
            rt.block_on(async {
                let _ = black_box(fast_calculator.fast_risk_check(&position, None).await);
            });
        });
    });
    
    // Test combined operations to simulate a real-world scenario
    group.bench_function(BenchmarkId::new("combined_operations", "check_add_remove"), |b| {
        b.iter(|| {
            rt.block_on(async {
                // Perform multiple operations in sequence
                let position1 = create_position("BTC-USD", "binance", 5000.0, 1.0, 0.8);
                let check_result = black_box(calculator.fast_risk_check(&position1, None).await);
                
                if check_result.passed {
                    let _ = black_box(calculator.add_position(position1).await);
                    
                    // Add another position and get exposure
                    let position2 = create_position("ETH-USD", "coinbase", 3000.0, 1.0, 0.9);
                    let _ = black_box(calculator.add_position(position2).await);
                    
                    let symbol_exposure = black_box(calculator.get_symbol_exposure("BTC-USD").await);
                    let venue_exposures = black_box(calculator.get_all_venue_exposures().await);
                    
                    // Clean up
                    let _ = calculator.remove_position("BTC-USD", "binance").await;
                    let _ = calculator.remove_position("ETH-USD", "coinbase").await;
                }
            });
        });
    });
    
    group.finish();
}

criterion_group!(benches, bench_risk_calculator);
criterion_main!(benches); 