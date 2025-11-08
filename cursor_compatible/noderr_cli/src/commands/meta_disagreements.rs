use anyhow::Result;
use clap::{Args, Subcommand};
use chrono::{DateTime, Utc};
use colored::Colorize;
use comfy_table::{Table, ContentArrangement};
use serde_json;
use std::path::PathBuf;
use std::io::Write;
use std::fs::File;

use crate::disagreement_engine::{MetaAgentDisagreementEngine, DisagreementRecord, StrategyVote};

/// Command for managing meta-agent disagreements detection
#[derive(Debug, Args)]
pub struct MetaDisagreementsArgs {
    /// Filter by agent ID
    #[clap(long)]
    pub agent_id: Option<String>,
    
    /// Minimum disagreement score threshold (0.0-5.0)
    #[clap(long, default_value = "0.5")]
    pub min_score: f32,
    
    /// Maximum number of disagreements to return
    #[clap(long, default_value = "10")]
    pub limit: usize,
    
    /// Time period to look back (in days)
    #[clap(long, default_value = "7")]
    pub days: u64,
    
    /// Output format (table, json, markdown)
    #[clap(long, default_value = "table")]
    pub format: String,
    
    /// Include reason chains in the output
    #[clap(long)]
    pub explain: bool,
    
    /// Path to export results
    #[clap(long)]
    pub output: Option<PathBuf>,
}

/// Run the meta disagreements command
pub async fn run_meta_disagreements_command(args: &MetaDisagreementsArgs) -> Result<()> {
    println!("{}", "🧠 Meta Agent Disagreement Analysis".bright_blue());
    
    // Apply filters
    if let Some(agent_id) = &args.agent_id {
        println!("Agent ID: {}", agent_id.bright_yellow());
    } else {
        println!("Agent ID: {}", "All agents".bright_yellow());
    }
    
    println!("Min score: {}", args.min_score.to_string().bright_yellow());
    println!("Looking back: {} days", args.days.to_string().bright_yellow());
    println!("Limit: {} records", args.limit.to_string().bright_yellow());
    
    // Query disagreements from storage
    let agent_id_ref = args.agent_id.as_deref();
    let disagreements = MetaAgentDisagreementEngine::query(
        agent_id_ref,
        Some(args.min_score),
        args.limit,
        Some(args.days)
    ).await?;
    
    if disagreements.is_empty() {
        println!("\n{}", "No disagreements found matching the criteria.".bright_yellow());
        return Ok(());
    }
    
    println!("\nFound {} disagreement records:", disagreements.len().to_string().bright_green());
    
    // Display disagreements
    match args.format.as_str() {
        "json" => output_json(&disagreements, args.explain, args.output.as_ref())?,
        "markdown" => output_markdown(&disagreements, args.explain, args.output.as_ref())?,
        _ => output_table(&disagreements, args.explain, args.output.as_ref())?,
    }
    
    Ok(())
}

/// Output disagreements as a table
fn output_table(
    disagreements: &[DisagreementRecord], 
    include_explain: bool,
    output_path: Option<&PathBuf>
) -> Result<()> {
    let mut table = Table::new();
    table.set_content_arrangement(ContentArrangement::Dynamic);
    
    // Set header
    let mut headers = vec![
        "ID".bright_blue(),
        "Timestamp".bright_blue(),
        "Agent".bright_blue(),
        "Market".bright_blue(),
        "Score".bright_blue(),
        "Models".bright_blue(),
        "Dominant Strategy".bright_blue(),
    ];
    
    if include_explain {
        headers.push("Reasoning".bright_blue());
    }
    
    table.set_header(headers);
    
    // Add rows
    for (idx, record) in disagreements.iter().enumerate() {
        let dt = DateTime::<Utc>::from_timestamp(record.timestamp, 0)
            .unwrap_or_else(|| Utc::now());
        
        let formatted_time = dt.format("%Y-%m-%d %H:%M:%S").to_string();
        
        let models_count = record.strategy_votes.len();
        let strategy_count: usize = record.strategy_votes.iter()
            .map(|v| v.strategy_id.clone())
            .collect::<std::collections::HashSet<_>>()
            .len();
        
        let dominant = record.dominant_strategy.clone()
            .unwrap_or_else(|| "None".to_string());
        
        let mut row = vec![
            (idx + 1).to_string(),
            formatted_time,
            record.agent_id.clone(),
            record.context.market.clone(),
            format!("{:.2}", record.disagreement_score),
            format!("{} ({} strategies)", models_count, strategy_count),
            dominant,
        ];
        
        if include_explain {
            // Compile reasoning from each vote
            let reasoning = record.strategy_votes.iter()
                .filter_map(|vote| {
                    vote.reason_chain.as_ref().map(|reasons| {
                        format!("Model {}: {}", 
                            vote.model_id, 
                            reasons.first().unwrap_or(&"No reason provided".to_string()))
                    })
                })
                .collect::<Vec<_>>()
                .join("\n");
            
            row.push(reasoning);
        }
        
        table.add_row(row);
    }
    
    println!("{}", table);
    
    // Export if requested
    if let Some(path) = output_path {
        let table_string = format!("{}", table);
        let mut file = File::create(path)?;
        write!(file, "{}", table_string)?;
        println!("Results exported to: {}", path.display());
    }
    
    // Print detailed vote breakdown for each disagreement
    if include_explain {
        for (idx, record) in disagreements.iter().enumerate() {
            println!("\n{} {} {}", 
                "Disagreement".bright_blue(),
                (idx + 1).to_string().bright_yellow(),
                "Details:".bright_blue());
            
            println!("Agent: {}, Market: {}, Score: {:.2}", 
                record.agent_id, record.context.market, record.disagreement_score);
            
            println!("Strategy Votes:");
            let mut vote_table = Table::new();
            vote_table.set_header(vec!["Model", "Strategy", "Score", "Confidence"]);
            
            for vote in &record.strategy_votes {
                vote_table.add_row(vec![
                    vote.model_id.clone(),
                    vote.strategy_id.clone(),
                    format!("{:.2}", vote.score),
                    format!("{:.2}", vote.confidence),
                ]);
            }
            
            println!("{}", vote_table);
        }
    }
    
    Ok(())
}

/// Output disagreements as JSON
fn output_json(
    disagreements: &[DisagreementRecord],
    include_explain: bool, 
    output_path: Option<&PathBuf>
) -> Result<()> {
    // If not including explanations, create a simplified version
    let output = if !include_explain {
        let simplified: Vec<_> = disagreements.iter().map(|record| {
            let strategies: Vec<_> = record.strategy_votes.iter()
                .map(|vote| {
                    serde_json::json!({
                        "model_id": vote.model_id,
                        "strategy_id": vote.strategy_id,
                        "score": vote.score,
                        "confidence": vote.confidence,
                    })
                })
                .collect();
            
            serde_json::json!({
                "timestamp": record.timestamp,
                "agent_id": record.agent_id,
                "market": record.context.market,
                "disagreement_score": record.disagreement_score,
                "dominant_strategy": record.dominant_strategy,
                "strategy_votes": strategies,
            })
        }).collect();
        
        serde_json::to_string_pretty(&simplified)?
    } else {
        // Full output with explanations
        serde_json::to_string_pretty(&disagreements)?
    };
    
    // Write to file or stdout
    if let Some(path) = output_path {
        let mut file = File::create(path)?;
        write!(file, "{}", output)?;
        println!("Results exported to: {}", path.display());
    } else {
        println!("{}", output);
    }
    
    Ok(())
}

/// Output disagreements as Markdown
fn output_markdown(
    disagreements: &[DisagreementRecord],
    include_explain: bool,
    output_path: Option<&PathBuf>
) -> Result<()> {
    let mut markdown = String::new();
    
    markdown.push_str("# Meta Agent Disagreement Report\n\n");
    markdown.push_str(&format!("Generated: {}\n\n", 
        Utc::now().format("%Y-%m-%d %H:%M:%S")));
    
    markdown.push_str("## Summary\n\n");
    markdown.push_str("| ID | Timestamp | Agent | Market | Score | Dominant Strategy |\n");
    markdown.push_str("|:--:|:----------|:------|:-------|:------|:----------------:|\n");
    
    for (idx, record) in disagreements.iter().enumerate() {
        let dt = DateTime::<Utc>::from_timestamp(record.timestamp, 0)
            .unwrap_or_else(|| Utc::now());
        
        let formatted_time = dt.format("%Y-%m-%d %H:%M:%S").to_string();
        
        let dominant = record.dominant_strategy.clone()
            .unwrap_or_else(|| "None".to_string());
        
        markdown.push_str(&format!("| {} | {} | {} | {} | {:.2} | {} |\n",
            idx + 1,
            formatted_time,
            record.agent_id,
            record.context.market,
            record.disagreement_score,
            dominant));
    }
    
    // Add detailed information for each disagreement
    if include_explain {
        markdown.push_str("\n## Detailed Analysis\n\n");
        
        for (idx, record) in disagreements.iter().enumerate() {
            let dt = DateTime::<Utc>::from_timestamp(record.timestamp, 0)
                .unwrap_or_else(|| Utc::now());
            
            let formatted_time = dt.format("%Y-%m-%d %H:%M:%S").to_string();
            
            markdown.push_str(&format!("### Disagreement {}\n\n", idx + 1));
            markdown.push_str(&format!("- **Agent**: {}\n", record.agent_id));
            markdown.push_str(&format!("- **Market**: {}\n", record.context.market));
            markdown.push_str(&format!("- **Timestamp**: {}\n", formatted_time));
            markdown.push_str(&format!("- **Disagreement Score**: {:.2}\n", record.disagreement_score));
            markdown.push_str(&format!("- **Dominant Strategy**: {}\n\n", 
                record.dominant_strategy.clone().unwrap_or_else(|| "None".to_string())));
            
            markdown.push_str("#### Strategy Votes\n\n");
            markdown.push_str("| Model | Strategy | Score | Confidence |\n");
            markdown.push_str("|:------|:---------|:------|:----------:|\n");
            
            for vote in &record.strategy_votes {
                markdown.push_str(&format!("| {} | {} | {:.2} | {:.2} |\n",
                    vote.model_id,
                    vote.strategy_id,
                    vote.score,
                    vote.confidence));
            }
            
            markdown.push_str("\n#### Reasoning\n\n");
            
            for vote in &record.strategy_votes {
                markdown.push_str(&format!("**Model {}**:\n\n", vote.model_id));
                
                if let Some(reasons) = &vote.reason_chain {
                    for (i, reason) in reasons.iter().enumerate() {
                        markdown.push_str(&format!("{}. {}\n", i + 1, reason));
                    }
                } else {
                    markdown.push_str("*No reasoning provided*\n");
                }
                
                markdown.push_str("\n");
            }
            
            markdown.push_str("---\n\n");
        }
    }
    
    // Write to file or stdout
    if let Some(path) = output_path {
        let mut file = File::create(path)?;
        write!(file, "{}", markdown)?;
        println!("Results exported to: {}", path.display());
    } else {
        println!("{}", markdown);
    }
    
    Ok(())
} 