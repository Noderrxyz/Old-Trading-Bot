use noderr_core::trust_score_engine::TrustScoreEngine;
use anyhow::{Result, Context};
use chrono::Utc;
use comfy_table::{Table, Cell, Color};
use std::sync::Arc;

pub async fn run_trust_history(
    engine: Arc<dyn TrustScoreEngine>,
    strategy_id: &str,
) -> Result<()> {
    let history = engine.get_trust_history(strategy_id).await
        .context("Failed to fetch trust history")?;

    if history.entries.is_empty() {
        println!("No history found for strategy {strategy_id}");
        return Ok(());
    }

    let mut table = Table::new();
    table.set_header(vec!["Timestamp", "Score", "Drawdown", "Sharpe", "Failures"]);

    for entry in history.entries.iter().rev().take(20) {
        let ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S").to_string();
        let score_color = if entry.score < 0.3 {
            Color::Red
        } else if entry.score < 0.5 {
            Color::Yellow
        } else {
            Color::Green
        };

        table.add_row(vec![
            Cell::new(ts),
            Cell::new(format!("{:.2}", entry.score)).fg(score_color),
            Cell::new(format!("{:.2}", entry.features.drawdown_score)),
            Cell::new(format!("{:.2}", entry.features.normalized_sharpe)),
            Cell::new(format!("{:.2}", 1.0 - entry.features.failure_score)),
        ]);
    }

    println!("{table}");
    Ok(())
} 