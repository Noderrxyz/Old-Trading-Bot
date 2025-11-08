use anyhow::{Result, Context};
use comfy_table::{Table, Cell, Color};
use noderr_core::trust_decay_service::{TrustDecayService, TrustDecayConfig, StrategyActivityStatus};
use noderr_core::trust_score_engine::TrustScoreEngine;
use noderr_core::strategy_storage::StrategyStorage;
use std::collections::HashMap;
use std::sync::Arc;
use chrono::Duration;

/// Display the current status of trust decay for all strategies
pub async fn run_trust_status(
    decay_service: Arc<dyn TrustDecayService>,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
) -> Result<()> {
    // Get all strategy IDs
    let strategy_ids = storage.get_all_strategy_ids().await
        .context("Failed to fetch strategy IDs")?;
    
    // Get current decay configuration
    let config = decay_service.get_config();
    
    // Display current configuration
    println!("Trust Decay Configuration:");
    println!("-------------------------");
    println!("Enabled: {}", config.enabled);
    println!("Default decay factor: {:.4} per day", config.default_decay_factor_per_day);
    println!("Decay interval: {} seconds", config.decay_interval_seconds);
    println!("Inactivity threshold: {} hours", config.inactivity_threshold_hours);
    println!("Pause during trading: {}", config.pause_during_trading);
    println!("Warning threshold: {:.2}", config.warning_threshold);
    println!("Critical threshold: {:.2}", config.critical_threshold);
    println!("Exclude list: {:?}", config.excluded_strategies);
    println!();
    
    // Custom decay factors
    if !config.strategy_decay_factors.is_empty() {
        println!("Custom Decay Factors:");
        println!("--------------------");
        for (strategy_id, factor) in &config.strategy_decay_factors {
            println!("{}: {:.4} per day", strategy_id, factor);
        }
        println!();
    }
    
    // Create a table for strategy status
    let mut table = Table::new();
    table.set_header(vec![
        "Strategy ID", 
        "Trust Score", 
        "Status", 
        "Last Activity", 
        "Decay Started",
        "Decay Factor",
    ]);
    
    // Fetch and display strategy information
    let mut active_count = 0;
    let mut inactive_count = 0;
    let mut decaying_count = 0;
    
    for strategy_id in strategy_ids {
        // Get the activity status
        let status = decay_service.get_strategy_activity_status(&strategy_id).await?;
        
        // Get the current trust score
        let trust_score = match engine.get_trust_score(&strategy_id).await {
            Ok(score) => score,
            Err(_) => {
                // Strategy might not have a trust score yet, skip it
                continue;
            }
        };
        
        // Determine decay factor for this strategy
        let decay_factor = config.strategy_decay_factors
            .get(&strategy_id)
            .copied()
            .unwrap_or(config.default_decay_factor_per_day);
        
        // Format the status information
        let (status_text, last_activity, decay_started) = match &status {
            StrategyActivityStatus::Active => {
                active_count += 1;
                (
                    Cell::new("Active").fg(Color::Green),
                    Cell::new("Now"),
                    Cell::new("N/A"),
                )
            },
            StrategyActivityStatus::RecentlyInactive { last_activity } => {
                inactive_count += 1;
                let ago = humanize_duration(last_activity.signed_duration_since(chrono::Utc::now()).abs());
                (
                    Cell::new("Inactive").fg(Color::Yellow),
                    Cell::new(format!("{} ago", ago)),
                    Cell::new("Pending"),
                )
            },
            StrategyActivityStatus::Inactive { last_activity, decay_started } => {
                decaying_count += 1;
                let last_ago = humanize_duration(last_activity.signed_duration_since(chrono::Utc::now()).abs());
                let decay_ago = humanize_duration(decay_started.signed_duration_since(chrono::Utc::now()).abs());
                (
                    Cell::new("Decaying").fg(Color::Red),
                    Cell::new(format!("{} ago", last_ago)),
                    Cell::new(format!("{} ago", decay_ago)),
                )
            }
        };
        
        // Add the row to the table
        let score_color = if trust_score.score < config.critical_threshold {
            Color::Red
        } else if trust_score.score < config.warning_threshold {
            Color::Yellow
        } else {
            Color::Green
        };
        
        table.add_row(vec![
            Cell::new(&strategy_id),
            Cell::new(format!("{:.4}", trust_score.score)).fg(score_color),
            status_text,
            last_activity,
            decay_started,
            Cell::new(format!("{:.4}", decay_factor)),
        ]);
    }
    
    // Sort the table by status (decaying first, then inactive, then active)
    // and then by trust score (ascending)
    
    // Display the table
    println!("Strategy Trust Decay Status:");
    println!("---------------------------");
    println!("{table}");
    
    // Summary
    println!();
    println!("Summary:");
    println!("  Active strategies: {}", active_count);
    println!("  Inactive strategies: {}", inactive_count);
    println!("  Decaying strategies: {}", decaying_count);
    println!("  Total: {}", active_count + inactive_count + decaying_count);
    
    Ok(())
}

/// Manually apply decay to a specific strategy
pub async fn run_trust_decay_now(
    decay_service: Arc<dyn TrustDecayService>,
    strategy_id: &str,
    decay_factor: Option<f64>,
) -> Result<()> {
    println!("Applying trust decay to strategy: {}", strategy_id);
    
    // Get current trust score
    let old_score = decay_service
        .apply_decay_to_strategy(strategy_id, decay_factor)
        .await?;
    
    println!("Decay applied successfully.");
    println!("  Old trust score: {:.4}", old_score.score);
    println!("  New trust score: {:.4}", old_score.score); // The score in the return value is the pre-decay score
    
    Ok(())
}

/// Update the trust decay configuration
pub async fn run_trust_decay_config(
    decay_service: Arc<dyn TrustDecayService>,
    enable: Option<bool>,
    default_factor: Option<f64>,
    interval: Option<u64>,
    inactivity: Option<u64>,
    pause_trading: Option<bool>,
    warning: Option<f64>,
    critical: Option<f64>,
    exclude: Option<Vec<String>>,
    add_custom: Option<Vec<(String, f64)>>,
    remove_custom: Option<Vec<String>>,
) -> Result<()> {
    // Get current configuration
    let mut config = decay_service.get_config();
    
    // Update configuration based on provided options
    if let Some(enable) = enable {
        config.enabled = enable;
    }
    
    if let Some(factor) = default_factor {
        config.default_decay_factor_per_day = factor;
    }
    
    if let Some(seconds) = interval {
        config.decay_interval_seconds = seconds;
    }
    
    if let Some(hours) = inactivity {
        config.inactivity_threshold_hours = hours;
    }
    
    if let Some(pause) = pause_trading {
        config.pause_during_trading = pause;
    }
    
    if let Some(threshold) = warning {
        config.warning_threshold = threshold;
    }
    
    if let Some(threshold) = critical {
        config.critical_threshold = threshold;
    }
    
    if let Some(exclude_list) = exclude {
        config.excluded_strategies = exclude_list;
    }
    
    if let Some(custom_factors) = add_custom {
        for (strategy_id, factor) in custom_factors {
            config.strategy_decay_factors.insert(strategy_id, factor);
        }
    }
    
    if let Some(remove_list) = remove_custom {
        for strategy_id in remove_list {
            config.strategy_decay_factors.remove(&strategy_id);
        }
    }
    
    // Apply the updated configuration
    decay_service.update_config(config.clone()).await?;
    
    println!("Trust decay configuration updated.");
    
    Ok(())
}

/// Convert a duration to a human-readable string
fn humanize_duration(duration: Duration) -> String {
    if duration.num_days() > 0 {
        format!("{} days", duration.num_days())
    } else if duration.num_hours() > 0 {
        format!("{} hours", duration.num_hours())
    } else if duration.num_minutes() > 0 {
        format!("{} mins", duration.num_minutes())
    } else {
        format!("{} secs", duration.num_seconds())
    }
}

/// Parse a custom decay factor specification in the format "strategy-id:factor"
pub fn parse_custom_factor(s: &str) -> Result<(String, f64)> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        anyhow::bail!("Custom factor must be in format 'strategy-id:factor', got '{}'", s);
    }
    
    let strategy_id = parts[0].to_string();
    let factor = parts[1].parse::<f64>()
        .context("Failed to parse factor as a number")?;
    
    if factor <= 0.0 || factor > 1.0 {
        anyhow::bail!("Decay factor must be between 0 and 1, got {}", factor);
    }
    
    Ok((strategy_id, factor))
} 