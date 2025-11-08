use anyhow::{Result, Context};
use chrono::{DateTime, Utc, Duration};
use std::sync::Arc;
use std::time::Duration as StdDuration;
use tokio::time::sleep;
use std::sync::atomic::{AtomicBool, Ordering};
use colored::Colorize;

use noderr_core::trust_score_engine::TrustScoreEngine;
use noderr_core::trust_decay_service::{TrustDecayService, StrategyActivityStatus};

/// Continuously monitor and automatically apply trust decay
pub async fn run_trust_monitor(
    engine: Arc<dyn TrustScoreEngine>,
    decay_service: Arc<dyn TrustDecayService>,
    interval_seconds: u64,
    running: Arc<AtomicBool>,
) -> Result<()> {
    println!("\n{}\n", "Starting Trust Score Monitor".bright_green().bold());
    println!("Auto-applying decay every {} seconds", interval_seconds.to_string().bright_blue());
    println!("Press Ctrl+C to stop the monitor\n");

    let mut table = comfy_table::Table::new();
    table.set_header(vec!["Timestamp", "Strategy", "Trust Score", "Status", "Last Decay"]);

    // Main monitoring loop
    while running.load(Ordering::SeqCst) {
        // Get all strategies
        let strategies = match decay_service.get_strategy_ids().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Error getting strategy IDs: {}", e);
                // Wait before retrying
                sleep(StdDuration::from_secs(5)).await;
                continue;
            }
        };

        // Clear table rows
        table.remove_rows();

        // Process each strategy
        for strategy_id in &strategies {
            // Get current trust score
            let trust_score = match engine.get_trust_score(strategy_id).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Error getting trust score for {}: {}", strategy_id, e);
                    continue;
                }
            };

            // Get activity status
            let activity_status = match decay_service.get_strategy_activity_status(strategy_id).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Error getting activity status for {}: {}", strategy_id, e);
                    continue;
                }
            };

            // Apply decay automatically
            if let Err(e) = decay_service.apply_decay_to_strategy(strategy_id, None).await {
                eprintln!("Error applying decay to {}: {}", strategy_id, e);
            }

            // Get updated trust score after decay
            let updated_score = match engine.get_trust_score(strategy_id).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Error getting updated trust score for {}: {}", strategy_id, e);
                    continue;
                }
            };

            // Get last decay timestamp
            let last_decay = match decay_service.get_last_decay_timestamp(strategy_id).await {
                Ok(Some(ts)) => {
                    let dt = DateTime::<Utc>::from_timestamp(ts, 0)
                        .unwrap_or_else(|| Utc::now());
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                },
                Ok(None) => "Never".to_string(),
                Err(e) => {
                    eprintln!("Error getting last decay for {}: {}", strategy_id, e);
                    "Error".to_string()
                }
            };

            // Format status for display
            let status_str = match activity_status {
                StrategyActivityStatus::Active { last_active_at } => {
                    let dt = DateTime::<Utc>::from_timestamp(last_active_at, 0)
                        .unwrap_or_else(|| Utc::now());
                    let now = Utc::now();
                    let hours_ago = (now - dt).num_hours();
                    
                    if hours_ago < 24 {
                        "Active".green().to_string()
                    } else {
                        format!("Active ({} hrs ago)", hours_ago).yellow().to_string()
                    }
                },
                StrategyActivityStatus::Inactive { inactive_since } => {
                    let dt = DateTime::<Utc>::from_timestamp(inactive_since, 0)
                        .unwrap_or_else(|| Utc::now());
                    let now = Utc::now();
                    let days_ago = (now - dt).num_days();
                    
                    format!("Inactive ({} days)", days_ago).red().to_string()
                }
            };

            // Add row to table
            table.add_row(vec![
                Utc::now().format("%H:%M:%S").to_string(),
                strategy_id.to_string(),
                format!("{:.4} → {:.4}", trust_score, updated_score),
                status_str,
                last_decay,
            ]);
        }

        // Display the updated table
        println!("{}", table);

        // Wait for next interval
        sleep(StdDuration::from_secs(interval_seconds)).await;
        
        // Clear console for next update (platform-specific)
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let _ = Command::new("cmd").args(["/c", "cls"]).status();
        }
        #[cfg(not(target_os = "windows"))]
        {
            print!("\x1B[2J\x1B[1;1H");
        }
    }

    println!("\nTrust monitor stopped.");
    Ok(())
}

/// Run a one-time check of all strategies and display their trust scores
pub async fn run_trust_check(
    engine: Arc<dyn TrustScoreEngine>,
    decay_service: Arc<dyn TrustDecayService>,
) -> Result<()> {
    println!("\n{}\n", "Trust Score Check".bright_green().bold());

    // Get all strategies
    let strategies = decay_service.get_strategy_ids().await?;

    // Create table
    let mut table = comfy_table::Table::new();
    table.set_header(vec!["Strategy", "Trust Score", "Status", "Last Decay"]);

    // Process each strategy
    for strategy_id in &strategies {
        // Get current trust score
        let trust_score = engine.get_trust_score(strategy_id).await?;

        // Get activity status
        let activity_status = decay_service.get_strategy_activity_status(strategy_id).await?;

        // Get last decay timestamp
        let last_decay = match decay_service.get_last_decay_timestamp(strategy_id).await? {
            Some(ts) => {
                let dt = DateTime::<Utc>::from_timestamp(ts, 0)
                    .unwrap_or_else(|| Utc::now());
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            },
            None => "Never".to_string(),
        };

        // Format status for display
        let status_str = match activity_status {
            StrategyActivityStatus::Active { last_active_at } => {
                let dt = DateTime::<Utc>::from_timestamp(last_active_at, 0)
                    .unwrap_or_else(|| Utc::now());
                let now = Utc::now();
                let hours_ago = (now - dt).num_hours();
                
                if hours_ago < 24 {
                    "Active".green().to_string()
                } else {
                    format!("Active ({} hrs ago)", hours_ago).yellow().to_string()
                }
            },
            StrategyActivityStatus::Inactive { inactive_since } => {
                let dt = DateTime::<Utc>::from_timestamp(inactive_since, 0)
                    .unwrap_or_else(|| Utc::now());
                let now = Utc::now();
                let days_ago = (now - dt).num_days();
                
                format!("Inactive ({} days)", days_ago).red().to_string()
            }
        };

        // Add row to table
        table.add_row(vec![
            strategy_id.to_string(),
            format!("{:.4}", trust_score),
            status_str,
            last_decay,
        ]);
    }

    // Display the table
    println!("{}", table);

    Ok(())
} 