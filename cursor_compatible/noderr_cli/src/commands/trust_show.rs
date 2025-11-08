use noderr_core::trust_score_engine::{TrustScoreEngine, TrustScore};
use noderr_core::strategy_storage::StrategyStorage;
use anyhow::{Result, Context};
use comfy_table::{Table, Cell, Color, Attribute};
use std::sync::Arc;

pub async fn run_trust_show(
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
) -> Result<()> {
    let strategy_ids = storage.get_all_strategy_ids().await
        .context("Failed to load strategy IDs from storage")?;
    
    let mut table = Table::new();
    table.set_header(vec![
        "Strategy ID", "Trust Score", "Win Rate", "Sharpe", "Sortino", "Failures", "Updated"
    ]);

    let mut scores: Vec<TrustScore> = Vec::new();
    for strategy_id in strategy_ids {
        if let Ok(score) = engine.get_trust_score(&strategy_id).await {
            scores.push(score);
        }
    }

    // Sort by trust score descending
    scores.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());

    for score in scores {
        let color = if score.score < 0.3 {
            Color::Red
        } else if score.score < 0.5 {
            Color::Yellow
        } else {
            Color::Green
        };

        table.add_row(vec![
            Cell::new(score.strategy_id),
            Cell::new(format!("{:.2}", score.score)).fg(color),
            Cell::new(format!("{:.2}%", score.features.win_rate * 100.0)),
            Cell::new(format!("{:.2}", score.features.normalized_sharpe)),
            Cell::new(format!("{:.2}", score.features.normalized_sortino)),
            Cell::new(format!("{:.2}", 1.0 - score.features.failure_score)), // failure % approx
            Cell::new(score.timestamp.to_rfc3339()),
        ]);
    }

    println!("{table}");
    Ok(())
} 