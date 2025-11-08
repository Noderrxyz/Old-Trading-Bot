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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc, TimeZone, NaiveDateTime};
use clap::{Parser, Subcommand};
use tokio::time::sleep;
use tracing::{debug, error, info, warn, Level};
use tracing_subscriber::FmtSubscriber;

use noderr_core::market::{MarketData, MarketDataProvider, Symbol, Timeframe, MockMarketDataProvider};
use noderr_core::market_regime::{
    MarketRegimeState, MarketRegime, MarketRegimeConfig, MarketRegimeDetector,
    HmmRegimeConfig, create_hmm_regime_detector
};
use noderr_core::strategy::{Strategy, StrategyError, Signal, RiskProfile};
use noderr_core::strategy_executor::{StrategyExecutor, ExecutorError};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Detect and visualize market regimes in real-time
    DetectRegime {
        /// Exchange to analyze
        #[arg(short, long, default_value = "binance")]
        exchange: String,
        
        /// Symbol to analyze
        #[arg(short, long, default_value = "BTC/USDT")]
        symbol: String,
        
        /// Timeframe for analysis
        #[arg(short, long, default_value = "1h")]
        timeframe: String,
        
        /// Number of states in the HMM
        #[arg(short, long, default_value_t = 4)]
        states: usize,
        
        /// Duration to run (in minutes, 0 for indefinite)
        #[arg(short, long, default_value_t = 0)]
        duration: u64,
    },
    
    /// Run backtest to analyze strategy performance in different market regimes
    RegimeBacktest {
        /// Strategy identifier to test
        #[arg(short, long)]
        strategy: String,
        
        /// Exchange to use for backtest
        #[arg(short, long, default_value = "binance")]
        exchange: String,
        
        /// Symbol to test on
        #[arg(short, long, default_value = "BTC/USDT")]
        symbol: String,
        
        /// Start date for backtest (format: YYYY-MM-DD)
        #[arg(long)]
        start_date: String,
        
        /// End date for backtest (format: YYYY-MM-DD)
        #[arg(long)]
        end_date: String,
        
        /// Output file for results (CSV format)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    
    /// Visualize the timeline of market regime changes
    RegimeTimeline {
        /// Exchange to analyze
        #[arg(short, long, default_value = "binance")]
        exchange: String,
        
        /// Symbol to analyze
        #[arg(short, long, default_value = "BTC/USDT")]
        symbol: String,
        
        /// Timeframe for analysis
        #[arg(short, long, default_value = "1h")]
        timeframe: String,
        
        /// Start date (format: YYYY-MM-DD)
        #[arg(long)]
        start_date: String,
        
        /// End date (format: YYYY-MM-DD)
        #[arg(long)]
        end_date: String,
        
        /// Output file for results (CSV format)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}

// Basic statistics for strategy performance in each regime
#[derive(Default, Clone)]
struct RegimeStats {
    total_trades: u32,
    winning_trades: u32,
    losing_trades: u32,
    total_pnl: f64,
    total_invested: f64,
    max_drawdown: f64,
    sharpe_ratio: Option<f64>,
    duration_days: f64,
}

impl RegimeStats {
    fn win_rate(&self) -> f64 {
        if self.total_trades == 0 {
            return 0.0;
        }
        self.winning_trades as f64 / self.total_trades as f64
    }
    
    fn roi(&self) -> f64 {
        if self.total_invested == 0.0 {
            return 0.0;
        }
        self.total_pnl / self.total_invested
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;
    
    let cli = Cli::parse();
    
    match cli.command {
        Commands::DetectRegime { 
            exchange, symbol, timeframe, states, duration 
        } => {
            // Run real-time regime detection
            detect_regime(exchange, symbol, timeframe, states, duration).await?;
        },
        Commands::RegimeBacktest { 
            strategy, exchange, symbol, start_date, end_date, output 
        } => {
            // Run backtest analysis
            backtest_regime(strategy, exchange, symbol, start_date, end_date, output).await?;
        },
        Commands::RegimeTimeline { 
            exchange, symbol, timeframe, start_date, end_date, output 
        } => {
            // Visualize regime timeline
            regime_timeline(exchange, symbol, timeframe, start_date, end_date, output).await?;
        },
    }
    
    Ok(())
}

/// Real-time market regime detection
async fn detect_regime(
    exchange: String,
    symbol: String,
    timeframe: String,
    states: usize,
    duration: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting real-time market regime detection for {}/{}", exchange, symbol);
    
    // Create market data provider
    // In a real implementation, this would connect to actual exchange API
    let market_provider = create_market_data_provider(&exchange).await?;
    
    // Create regime detector with HMM
    let base_config = MarketRegimeConfig {
        update_interval_sec: 900, // 15 minutes
        ..Default::default()
    };
    
    let hmm_config = HmmRegimeConfig {
        n_states: states,
        feature_timeframe: timeframe.clone(),
        update_interval_sec: 60, // Update every minute for demo purposes
        ..Default::default()
    };
    
    let regime_detector = create_hmm_regime_detector(base_config, hmm_config, None);
    
    // Main detection loop
    let start_time = std::time::Instant::now();
    let mut last_regime: Option<MarketRegimeState> = None;
    
    loop {
        // Check if duration is reached
        if duration > 0 {
            let elapsed = start_time.elapsed().as_secs() / 60;
            if elapsed >= duration {
                info!("Duration reached, stopping regime detection");
                break;
            }
        }
        
        // Get market data
        match market_provider.get_market_data(&exchange, &symbol).await {
            Ok(market_data) => {
                // Process market data to detect regime
                if let Err(e) = regime_detector.process_market_data(&market_data).await {
                    warn!("Failed to process market data: {}", e);
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
                
                // Get detected regime
                if let Some(regime) = regime_detector.get_current_regime(&symbol).await {
                    // Check if regime changed
                    if last_regime.map_or(true, |last| last != regime.state) {
                        info!(
                            "REGIME CHANGE: {} -> {} (confidence: {:.2})",
                            last_regime.map_or("Unknown".to_string(), |r| r.to_string()),
                            regime.state,
                            regime.confidence
                        );
                        
                        // Create a simple visualization of regime
                        visualize_regime(&regime);
                        
                        // Update last regime
                        last_regime = Some(regime.state);
                    } else {
                        // Just a regular update
                        debug!(
                            "Current regime: {} (confidence: {:.2}, price: {})",
                            regime.state,
                            regime.confidence,
                            market_data.ticker.last
                        );
                    }
                    
                    // Publish regime data to websocket if this was a real app
                }
            },
            Err(e) => {
                error!("Failed to get market data: {}", e);
            }
        }
        
        // Wait before next update
        sleep(Duration::from_secs(10)).await;
    }
    
    Ok(())
}

/// Simple ASCII visualization of regime
fn visualize_regime(regime: &MarketRegime) {
    println!("\n=== MARKET REGIME ANALYSIS ===");
    println!("Symbol: {}", regime.symbol);
    println!("State:  {}", regime.state);
    println!("Confidence: {:.2}%", regime.confidence * 100.0);
    
    let mut feature_values: Vec<(String, f64)> = regime.metrics.iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    
    // Sort by feature name
    feature_values.sort_by(|a, b| a.0.cmp(&b.0));
    
    println!("\nFeature Analysis:");
    for (feature, value) in feature_values {
        let bar_len = (value.abs() * 20.0) as usize;
        let bar = if value >= 0.0 {
            "█".repeat(bar_len)
        } else {
            "▒".repeat(bar_len)
        };
        
        println!("{:15}: {:6.2} {}", feature, value, bar);
    }
    
    println!("\nRegime Duration: {:.1} days", regime.duration_days);
    println!("================================\n");
}

/// Backtest strategy performance in different market regimes
async fn backtest_regime(
    strategy_id: String,
    exchange: String,
    symbol: String,
    start_date: String,
    end_date: String,
    output: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting regime backtest for strategy: {}", strategy_id);
    
    // Parse dates
    let start = parse_date(&start_date)?;
    let end = parse_date(&end_date)?;
    
    info!("Backtest period: {} to {}", start, end);
    
    // Create market data provider with historical data
    // In a real implementation, this would load actual historical data
    let market_provider = create_backtest_market_provider(
        &exchange, &symbol, start, end
    ).await?;
    
    // Create regime detector
    let regime_detector = create_hmm_regime_detector(
        MarketRegimeConfig::default(),
        HmmRegimeConfig::default(),
        None
    );
    
    // Load the strategy
    let strategy = load_strategy(&strategy_id).await?;
    
    // Create strategy executor (simplified for this example)
    let executor = create_strategy_executor(strategy).await?;
    
    info!("Processing historical data to detect regimes...");
    
    // Process market data chronologically
    let market_data_series = get_historical_market_data(
        &market_provider, &exchange, &symbol, start, end
    ).await?;
    
    // Performance stats by regime
    let mut regime_stats: HashMap<MarketRegimeState, RegimeStats> = HashMap::new();
    let mut current_regime = MarketRegimeState::Unknown;
    
    // Process each market data point
    for market_data in market_data_series {
        // Detect regime
        if let Err(e) = regime_detector.process_market_data(&market_data).await {
            warn!("Failed to detect regime: {}", e);
            continue;
        }
        
        // Get current regime
        if let Some(regime) = regime_detector.get_current_regime(&symbol).await {
            current_regime = regime.state;
        }
        
        // Execute strategy
        let result = executor.execute_cycle(&market_data).await;
        
        // Record performance metrics by regime
        for execution in result {
            let stats = regime_stats.entry(current_regime).or_default();
            
            // Update statistics
            stats.total_trades += 1;
            
            // Simplified P&L calculation
            let pnl = execution.realized_pnl();
            stats.total_pnl += pnl;
            
            // Approximate investment amount
            let trade_value = execution.executed_value();
            stats.total_invested += trade_value;
            
            // Record win/loss
            if pnl > 0.0 {
                stats.winning_trades += 1;
            } else if pnl < 0.0 {
                stats.losing_trades += 1;
            }
        }
    }
    
    // Calculate additional metrics and display results
    println!("\n===== STRATEGY PERFORMANCE BY MARKET REGIME =====");
    println!("Strategy: {}", strategy_id);
    println!("Symbol:   {}", symbol);
    println!("Period:   {} to {}", start_date, end_date);
    println!("\n{:<10} {:<8} {:<8} {:<8} {:<10}", "Regime", "Win Rate", "ROI", "Trades", "PnL");
    println!("{:-<50}", "");
    
    for (regime, stats) in &regime_stats {
        println!("{:<10} {:<8.1}% {:<8.2}% {:<8} {:<10.2}",
            regime.to_string(),
            stats.win_rate() * 100.0,
            stats.roi() * 100.0,
            stats.total_trades,
            stats.total_pnl
        );
    }
    
    // Save results to file if requested
    if let Some(path) = output {
        save_results_to_csv(&regime_stats, &path, &strategy_id)?;
        info!("Results saved to {:?}", path);
    }
    
    Ok(())
}

/// Visualize market regime timeline
async fn regime_timeline(
    exchange: String,
    symbol: String,
    timeframe: String,
    start_date: String,
    end_date: String,
    output: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("Generating market regime timeline for {}/{}", exchange, symbol);
    
    // Parse dates
    let start = parse_date(&start_date)?;
    let end = parse_date(&end_date)?;
    
    // Create market data provider
    let market_provider = create_backtest_market_provider(
        &exchange, &symbol, start, end
    ).await?;
    
    // Create regime detector
    let regime_detector = create_hmm_regime_detector(
        MarketRegimeConfig::default(),
        HmmRegimeConfig {
            feature_timeframe: timeframe,
            ..Default::default()
        },
        None
    );
    
    // Process historical data
    let market_data_series = get_historical_market_data(
        &market_provider, &exchange, &symbol, start, end
    ).await?;
    
    // Track regime changes
    let mut regime_changes: Vec<(DateTime<Utc>, MarketRegimeState, f64)> = Vec::new();
    let mut current_regime = MarketRegimeState::Unknown;
    let mut regime_durations: HashMap<MarketRegimeState, f64> = HashMap::new();
    
    // Process each market data point
    for market_data in market_data_series {
        // Detect regime
        if let Err(e) = regime_detector.process_market_data(&market_data).await {
            warn!("Failed to detect regime: {}", e);
            continue;
        }
        
        // Check if regime changed
        if let Some(regime) = regime_detector.get_current_regime(&symbol).await {
            if regime.state != current_regime {
                // Record regime change
                regime_changes.push((
                    market_data.timestamp(),
                    regime.state,
                    regime.confidence
                ));
                
                // Update current regime
                current_regime = regime.state;
            }
            
            // Update time spent in each regime
            *regime_durations.entry(regime.state).or_default() += 1.0;
        }
    }
    
    // Display regime timeline
    println!("\n===== MARKET REGIME TIMELINE =====");
    println!("Symbol: {}", symbol);
    println!("Period: {} to {}", start_date, end_date);
    println!("\nRegime Changes:");
    
    for (timestamp, regime, confidence) in &regime_changes {
        println!("{} -> {} (confidence: {:.2})",
            timestamp.format("%Y-%m-%d %H:%M"),
            regime,
            confidence
        );
    }
    
    // Calculate percentage of time in each regime
    let total_time: f64 = regime_durations.values().sum();
    
    println!("\nTime Distribution:");
    for (regime, duration) in &regime_durations {
        let percentage = (duration / total_time) * 100.0;
        let bar_len = (percentage / 5.0) as usize;
        let bar = "█".repeat(bar_len);
        
        println!("{:<10}: {:5.1}% {}", regime, percentage, bar);
    }
    
    // Save results to file if requested
    if let Some(path) = output {
        save_timeline_to_csv(&regime_changes, &path)?;
        info!("Timeline saved to {:?}", path);
    }
    
    Ok(())
}

// Helper functions

/// Parse date string (YYYY-MM-DD) to DateTime<Utc>
fn parse_date(date: &str) -> Result<DateTime<Utc>, Box<dyn std::error::Error>> {
    let naive = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", date), "%Y-%m-%d %H:%M:%S")?;
    Ok(Utc.from_utc_datetime(&naive))
}

/// Create a mock market data provider for testing
async fn create_market_data_provider(exchange: &str) -> Result<Arc<dyn MarketDataProvider>, Box<dyn std::error::Error>> {
    // In a real implementation, this would connect to an actual exchange API
    // For this example, we're using a mock provider
    let provider = Arc::new(MockMarketDataProvider::new());
    Ok(provider)
}

/// Create a market data provider with historical data for backtesting
async fn create_backtest_market_provider(
    exchange: &str,
    symbol: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<Arc<dyn MarketDataProvider>, Box<dyn std::error::Error>> {
    // In a real implementation, this would load historical data
    // For this example, we're using a mock provider
    let provider = Arc::new(MockMarketDataProvider::new());
    Ok(provider)
}

/// Load a strategy by ID
async fn load_strategy(strategy_id: &str) -> Result<Box<dyn Strategy>, Box<dyn std::error::Error>> {
    // In a real implementation, this would load the actual strategy
    // For this example, we're returning a dummy strategy
    
    struct DummyStrategy {
        id: String,
    }
    
    impl Strategy for DummyStrategy {
        async fn generate_signal(&self, market_data: &MarketData) -> Result<Option<Signal>, StrategyError> {
            // Dummy implementation
            Ok(None)
        }
        
        async fn get_risk_profile(&self) -> RiskProfile {
            RiskProfile::default()
        }
        
        fn name(&self) -> &str {
            &self.id
        }
    }
    
    Ok(Box::new(DummyStrategy {
        id: strategy_id.to_string(),
    }))
}

/// Create a strategy executor
async fn create_strategy_executor(strategy: Box<dyn Strategy>) -> Result<Arc<StrategyExecutor>, Box<dyn std::error::Error>> {
    // In a real implementation, this would create an actual executor
    // For this example, we're using a dummy implementation
    
    Err("Strategy executor creation not implemented in this example".into())
}

/// Get historical market data series
async fn get_historical_market_data(
    provider: &Arc<dyn MarketDataProvider>,
    exchange: &str,
    symbol: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<Vec<MarketData>, Box<dyn std::error::Error>> {
    // In a real implementation, this would fetch actual historical data
    // For this example, we're returning an empty vector
    Ok(Vec::new())
}

/// Save regime statistics to CSV file
fn save_results_to_csv(
    stats: &HashMap<MarketRegimeState, RegimeStats>,
    path: &PathBuf,
    strategy_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // In a real implementation, this would write actual CSV data
    Ok(())
}

/// Save regime timeline to CSV file
fn save_timeline_to_csv(
    changes: &[(DateTime<Utc>, MarketRegimeState, f64)],
    path: &PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    // In a real implementation, this would write actual CSV data
    Ok(())
} 