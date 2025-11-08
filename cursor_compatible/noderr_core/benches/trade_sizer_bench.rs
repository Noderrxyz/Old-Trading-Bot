use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::HashMap;
use tokio::runtime::Runtime;

use noderr_core::trade_sizer::{DynamicTradeSizer, TradeSizerConfig};

fn bench_trade_sizer(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("DynamicTradeSizer");
    
    // Create a basic trade sizer with default config
    let default_sizer = DynamicTradeSizer::new();
    
    // Create a trade sizer with custom config
    let mut symbol_scale_factors = HashMap::new();
    symbol_scale_factors.insert("BTC-USD".to_string(), 1.0);
    symbol_scale_factors.insert("ETH-USD".to_string(), 0.8);
    symbol_scale_factors.insert("SOL-USD".to_string(), 0.6);
    
    let config = TradeSizerConfig {
        base_size: 1.0,
        max_volatility_threshold: 0.05,
        volatility_window_size: 300,
        min_size_factor: 0.1,
        max_size_factor: 1.0,
        log_file_path: "".to_string(), // Disable logging for benchmarks
        enable_logging: false,
        symbol_scale_factors,
    };
    
    let custom_sizer = DynamicTradeSizer::with_config(config);
    
    // Helper function to generate price series with increasing volatility
    fn generate_price_series(base_price: f64, volatility: f64, count: usize) -> Vec<f64> {
        let mut prices = Vec::with_capacity(count);
        let mut price = base_price;
        
        for _ in 0..count {
            // Add random price movement based on volatility
            let change = price * volatility * (rand::random::<f64>() * 2.0 - 1.0);
            price += change;
            prices.push(price);
        }
        
        prices
    }
    
    // Benchmark update_volatility with new price
    group.bench_function(BenchmarkId::new("update_volatility", "single_update"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let _ = black_box(default_sizer.update_volatility("BTC-USD", 50000.0, None).await);
            });
        });
    });
    
    // Benchmark multiple volatility updates
    group.bench_function(BenchmarkId::new("update_volatility", "multiple_updates"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let prices = generate_price_series(50000.0, 0.01, 10);
                for price in &prices {
                    let _ = black_box(default_sizer.update_volatility("BTC-USD", *price, None).await);
                }
            });
        });
    });
    
    // Benchmark calculate_position_size with no prior volatility data
    group.bench_function(BenchmarkId::new("calculate_position_size", "no_prior_data"), |b| {
        b.iter(|| {
            let symbol = format!("TEST-{}", rand::random::<u32>());
            rt.block_on(async {
                let _ = black_box(default_sizer.calculate_position_size(&symbol, 1000.0).await);
            });
        });
    });
    
    // Benchmark calculate_position_size with existing volatility data
    group.bench_function(BenchmarkId::new("calculate_position_size", "with_volatility_data"), |b| {
        b.iter_batched(
            || {
                // Setup: generate volatility data
                rt.block_on(async {
                    let prices = generate_price_series(50000.0, 0.02, 20);
                    for price in &prices {
                        let _ = custom_sizer.update_volatility("BTC-USD", *price, None).await;
                    }
                });
            },
            |_| {
                rt.block_on(async {
                    let _ = black_box(custom_sizer.calculate_position_size("BTC-USD", 1000.0).await);
                });
            },
            criterion::BatchSize::SmallInput,
        );
    });
    
    // Benchmark real-world scenario: update volatility and calculate size
    group.bench_function(BenchmarkId::new("real_world", "update_and_size"), |b| {
        b.iter(|| {
            rt.block_on(async {
                // Update volatility with new price
                let _ = black_box(custom_sizer.update_volatility("ETH-USD", 3000.0, None).await);
                
                // Calculate position size
                let _ = black_box(custom_sizer.calculate_position_size("ETH-USD", 1000.0).await);
            });
        });
    });
    
    // Benchmark getting volatility for multiple symbols
    group.bench_function(BenchmarkId::new("get_volatility_summary", "multiple_symbols"), |b| {
        b.iter_batched(
            || {
                // Setup: generate volatility data for multiple symbols
                rt.block_on(async {
                    let symbols = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "ADA-USD"];
                    for symbol in &symbols {
                        let prices = generate_price_series(
                            match *symbol {
                                "BTC-USD" => 50000.0,
                                "ETH-USD" => 3000.0,
                                "SOL-USD" => 100.0,
                                "XRP-USD" => 0.5,
                                "ADA-USD" => 1.0,
                                _ => 10.0,
                            },
                            0.01,
                            5,
                        );
                        for price in &prices {
                            let _ = custom_sizer.update_volatility(symbol, *price, None).await;
                        }
                    }
                });
            },
            |_| {
                rt.block_on(async {
                    let _ = black_box(custom_sizer.get_volatility_summary().await);
                });
            },
            criterion::BatchSize::SmallInput,
        );
    });
    
    group.finish();
}

criterion_group!(benches, bench_trade_sizer);
criterion_main!(benches); 