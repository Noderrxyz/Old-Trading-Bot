use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::sync::Arc;
use tokio::runtime::Runtime;
use chrono::Utc;
use uuid::Uuid;
use async_trait::async_trait;

use noderr_core::drawdown_monitor::{
    DrawdownMonitor, DrawdownConfig, TradeDataPoint, TradeType, KillSwitch
};

// Mock kill switch for testing that does nothing
struct MockKillSwitch;

#[async_trait]
impl KillSwitch for MockKillSwitch {
    async fn trigger(&self, _agent_id: &str, _reason: &str, _message: &str) -> bool {
        true // Pretend the kill switch succeeded
    }
}

fn bench_drawdown_monitor(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("DrawdownMonitor");
    
    // Create a drawdown monitor with standard config
    let config = DrawdownConfig {
        max_drawdown_pct: 0.10,
        alert_threshold_pct: 0.05,
        rolling_window_size: 100,
        min_trades_for_drawdown: 5,
        cooldown_period_ms: 3600000,
        log_file_path: "".to_string(), // Disable logging for benchmarks
    };
    
    let kill_switch = Arc::new(MockKillSwitch {});
    let monitor = DrawdownMonitor::new(config, kill_switch);
    
    // Helper function to create a trade data point
    fn create_trade(agent_id: &str, symbol: &str, equity: f64) -> TradeDataPoint {
        TradeDataPoint {
            timestamp: Utc::now(),
            agent_id: agent_id.to_string(),
            symbol: symbol.to_string(),
            amount: 1.0,
            price: 50000.0,
            trade_type: TradeType::Buy,
            equity,
            trade_id: Uuid::new_v4().to_string(),
            pnl: 0.0,
        }
    }
    
    // Benchmark recording a single trade
    group.bench_function(BenchmarkId::new("record_trade", "single_trade"), |b| {
        b.iter(|| {
            let trade = create_trade("agent1", "BTC-USD", 10000.0);
            rt.block_on(async {
                let _ = black_box(monitor.record_trade(trade).await);
            });
        });
    });
    
    // Benchmark record_trade with many trades to trigger calculations
    group.bench_function(BenchmarkId::new("record_trade", "multiple_trades"), |b| {
        b.iter_batched(
            || {
                // Setup: reset the agent state
                rt.block_on(async {
                    let _ = monitor.reset_agent("agent2").await;
                });
            },
            |_| {
                rt.block_on(async {
                    // First record trades that establish peak equity
                    for i in 0..5 {
                        let equity = 10000.0 + (i as f64 * 100.0);
                        let trade = create_trade("agent2", "BTC-USD", equity);
                        let _ = monitor.record_trade(trade).await;
                    }
                    
                    // Then record trades with declining equity
                    for i in 0..5 {
                        let equity = 10500.0 - (i as f64 * 200.0);
                        let trade = create_trade("agent2", "BTC-USD", equity);
                        let _ = black_box(monitor.record_trade(trade).await);
                    }
                });
            },
            criterion::BatchSize::SmallInput,
        );
    });
    
    // Benchmark get_current_drawdown
    group.bench_function(BenchmarkId::new("get_current_drawdown", "existing_agent"), |b| {
        b.iter_batched(
            || {
                // Setup: create an agent with some trades
                rt.block_on(async {
                    let _ = monitor.reset_agent("agent3").await;
                    
                    // Record trades to establish history
                    let trade1 = create_trade("agent3", "BTC-USD", 10000.0);
                    let trade2 = create_trade("agent3", "BTC-USD", 10500.0);
                    let trade3 = create_trade("agent3", "BTC-USD", 10200.0);
                    let trade4 = create_trade("agent3", "BTC-USD", 9800.0);
                    let trade5 = create_trade("agent3", "BTC-USD", 9500.0);
                    
                    let _ = monitor.record_trade(trade1).await;
                    let _ = monitor.record_trade(trade2).await;
                    let _ = monitor.record_trade(trade3).await;
                    let _ = monitor.record_trade(trade4).await;
                    let _ = monitor.record_trade(trade5).await;
                });
            },
            |_| {
                rt.block_on(async {
                    let _ = black_box(monitor.get_current_drawdown("agent3").await);
                });
            },
            criterion::BatchSize::SmallInput,
        );
    });
    
    // Benchmark is_agent_active
    group.bench_function(BenchmarkId::new("is_agent_active", "check_status"), |b| {
        b.iter(|| {
            rt.block_on(async {
                let _ = black_box(monitor.is_agent_active("agent3").await);
            });
        });
    });
    
    // Benchmark triggering a breach
    group.bench_function(BenchmarkId::new("trigger_breach", "exceed_max_drawdown"), |b| {
        b.iter_batched(
            || {
                // Setup: reset the agent and establish peak equity
                rt.block_on(async {
                    let _ = monitor.reset_agent("agent4").await;
                    
                    // Record trades to establish history with a peak
                    for i in 0..5 {
                        let equity = 10000.0 + (i as f64 * 200.0);
                        let trade = create_trade("agent4", "BTC-USD", equity);
                        let _ = monitor.record_trade(trade).await;
                    }
                });
            },
            |_| {
                rt.block_on(async {
                    // Now record a trade with a severe drawdown (>10%)
                    let trade = create_trade("agent4", "BTC-USD", 8500.0); // 15% drawdown
                    let _ = black_box(monitor.record_trade(trade).await);
                });
            },
            criterion::BatchSize::SmallInput,
        );
    });
    
    // Benchmark recovery from a drawdown
    group.bench_function(BenchmarkId::new("recover_from_drawdown", "below_threshold"), |b| {
        b.iter_batched(
            || {
                // Setup: reset the agent, establish peak, then trigger drawdown
                rt.block_on(async {
                    let _ = monitor.reset_agent("agent5").await;
                    
                    // Record trades to establish history with a peak
                    for i in 0..5 {
                        let equity = 10000.0 + (i as f64 * 200.0);
                        let trade = create_trade("agent5", "BTC-USD", equity);
                        let _ = monitor.record_trade(trade).await;
                    }
                    
                    // Trigger drawdown alert (>5% but <10%)
                    let trade = create_trade("agent5", "BTC-USD", 10000.0); // 9.1% drawdown
                    let _ = monitor.record_trade(trade).await;
                    
                    // Verify the agent is still active
                    assert!(monitor.is_agent_active("agent5").await.unwrap());
                });
            },
            |_| {
                rt.block_on(async {
                    // Now record trades showing recovery
                    let trade = create_trade("agent5", "BTC-USD", 10800.0); // Reduced drawdown
                    let _ = black_box(monitor.record_trade(trade).await);
                });
            },
            criterion::BatchSize::SmallInput,
        );
    });
    
    group.finish();
}

criterion_group!(benches, bench_drawdown_monitor);
criterion_main!(benches); 