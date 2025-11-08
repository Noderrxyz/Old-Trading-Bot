use anyhow::{anyhow, Result};
use clap::{Args, Subcommand};
use comfy_table::{Cell, Color, ContentArrangement, Table};
use noderr_core::{storage::Storage, engine::Engine, redis::RedisClient};
use std::collections::HashMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};

#[derive(Args)]
pub struct ArbitrationCommand {
    #[command(subcommand)]
    command: ArbitrationSubCommand,
}

#[derive(Subcommand)]
pub enum ArbitrationSubCommand {
    /// Show current arbitration weights
    Weights,
    
    /// Update arbitration weights
    UpdateWeights(UpdateWeightsArgs),
    
    /// Force arbitration on a specific proposal
    Resolve(ResolveArgs),
    
    /// Show agent arbitration statistics
    Stats(StatsArgs),
}

#[derive(Args)]
pub struct UpdateWeightsArgs {
    /// Trust score weight (0.0-1.0)
    #[arg(long)]
    trust_weight: Option<f64>,
    
    /// Leader role bonus (0.0-1.0)
    #[arg(long)]
    leader_bonus: Option<f64>,
    
    /// Uptime threshold for uptime bonus (0.0-1.0)
    #[arg(long)]
    uptime_threshold: Option<f64>,
    
    /// Uptime bonus for agents exceeding threshold (0.0-1.0)
    #[arg(long)]
    uptime_bonus: Option<f64>,
    
    /// Past accuracy weight factor (0.0-1.0)
    #[arg(long)]
    past_accuracy_factor: Option<f64>,
}

#[derive(Args)]
pub struct ResolveArgs {
    /// Proposal ID to arbitrate
    #[arg(long)]
    proposal_id: String,
    
    /// Force re-arbitration even if already arbitrated
    #[arg(long)]
    force: bool,
}

#[derive(Args)]
pub struct StatsArgs {
    /// Agent ID to view arbitration stats for
    #[arg(long)]
    agent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ArbitrationWeights {
    trust_weight: f64,
    leader_bonus: f64,
    uptime_threshold: f64,
    uptime_bonus: f64,
    past_accuracy_factor: f64,
}

#[derive(Serialize, Deserialize, Debug)]
struct ArbitrationResult {
    proposal_id: String,
    winner: String,
    winning_option: String,
    total_trust: f64,
    agent_count: usize,
    reason: String,
    options: HashMap<String, OptionDetails>,
}

#[derive(Serialize, Deserialize, Debug)]
struct OptionDetails {
    raw_count: usize,
    weighted_score: f64,
    supporters: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct AgentArbitrationStats {
    correct_arbitrations: usize,
    total_arbitrations: usize,
    accuracy: f64,
}

pub async fn run_arbitration_command(
    command: ArbitrationCommand,
    engine: Arc<Engine>,
    storage: Arc<Storage>,
) -> Result<()> {
    let redis_client = engine.get_redis_client().clone();
    
    match command.command {
        ArbitrationSubCommand::Weights => {
            show_arbitration_weights(&redis_client).await
        },
        ArbitrationSubCommand::UpdateWeights(args) => {
            update_arbitration_weights(&redis_client, args).await
        },
        ArbitrationSubCommand::Resolve(args) => {
            force_arbitration(&redis_client, args).await
        },
        ArbitrationSubCommand::Stats(args) => {
            show_arbitration_stats(&redis_client, args).await
        },
    }
}

async fn show_arbitration_weights(redis: &RedisClient) -> Result<()> {
    let weights_json = redis.get("governance:arbitration:weights").await?;
    
    let weights: ArbitrationWeights = if let Some(json) = weights_json {
        serde_json::from_str(&json)?
    } else {
        ArbitrationWeights {
            trust_weight: 0.7,
            leader_bonus: 0.2,
            uptime_threshold: 0.95,
            uptime_bonus: 0.1,
            past_accuracy_factor: 0.3,
        }
    };
    
    let mut table = Table::new();
    table
        .set_header(vec!["Parameter", "Value"])
        .set_content_arrangement(ContentArrangement::Dynamic);
    
    table.add_row(vec!["Trust Weight", &format!("{:.2}", weights.trust_weight)]);
    table.add_row(vec!["Leader Bonus", &format!("{:.2}", weights.leader_bonus)]);
    table.add_row(vec!["Uptime Threshold", &format!("{:.2}", weights.uptime_threshold)]);
    table.add_row(vec!["Uptime Bonus", &format!("{:.2}", weights.uptime_bonus)]);
    table.add_row(vec!["Past Accuracy Factor", &format!("{:.2}", weights.past_accuracy_factor)]);
    
    println!("Current Arbitration Weights:");
    println!("{table}");
    
    Ok(())
}

async fn update_arbitration_weights(redis: &RedisClient, args: UpdateWeightsArgs) -> Result<()> {
    let weights_json = redis.get("governance:arbitration:weights").await?;
    
    let mut weights: ArbitrationWeights = if let Some(json) = weights_json {
        serde_json::from_str(&json)?
    } else {
        ArbitrationWeights {
            trust_weight: 0.7,
            leader_bonus: 0.2,
            uptime_threshold: 0.95,
            uptime_bonus: 0.1,
            past_accuracy_factor: 0.3,
        }
    };
    
    let mut updated = false;
    
    if let Some(trust_weight) = args.trust_weight {
        if trust_weight < 0.0 || trust_weight > 1.0 {
            return Err(anyhow!("Trust weight must be between 0.0 and 1.0"));
        }
        weights.trust_weight = trust_weight;
        updated = true;
    }
    
    if let Some(leader_bonus) = args.leader_bonus {
        if leader_bonus < 0.0 || leader_bonus > 1.0 {
            return Err(anyhow!("Leader bonus must be between 0.0 and 1.0"));
        }
        weights.leader_bonus = leader_bonus;
        updated = true;
    }
    
    if let Some(uptime_threshold) = args.uptime_threshold {
        if uptime_threshold < 0.0 || uptime_threshold > 1.0 {
            return Err(anyhow!("Uptime threshold must be between 0.0 and 1.0"));
        }
        weights.uptime_threshold = uptime_threshold;
        updated = true;
    }
    
    if let Some(uptime_bonus) = args.uptime_bonus {
        if uptime_bonus < 0.0 || uptime_bonus > 1.0 {
            return Err(anyhow!("Uptime bonus must be between 0.0 and 1.0"));
        }
        weights.uptime_bonus = uptime_bonus;
        updated = true;
    }
    
    if let Some(past_accuracy_factor) = args.past_accuracy_factor {
        if past_accuracy_factor < 0.0 || past_accuracy_factor > 1.0 {
            return Err(anyhow!("Past accuracy factor must be between 0.0 and 1.0"));
        }
        weights.past_accuracy_factor = past_accuracy_factor;
        updated = true;
    }
    
    if updated {
        let weights_json = serde_json::to_string(&weights)?;
        redis.set("governance:arbitration:weights", &weights_json).await?;
        println!("Arbitration weights updated successfully.");
    } else {
        println!("No changes to arbitration weights.");
    }
    
    Ok(())
}

async fn force_arbitration(redis: &RedisClient, args: ResolveArgs) -> Result<()> {
    let proposal_id = args.proposal_id;
    let force = args.force;
    
    // Check if proposal exists
    let proposal_json = redis.get(&format!("governance:proposal:{}", proposal_id)).await?;
    if proposal_json.is_none() {
        return Err(anyhow!("Proposal {} does not exist", proposal_id));
    }
    
    // Check if already arbitrated
    let result_json = redis.get(&format!("governance:arbitration:result:{}", proposal_id)).await?;
    if result_json.is_some() && !force {
        return Err(anyhow!("Proposal {} has already been arbitrated. Use --force to override", proposal_id));
    }
    
    // Call arbitration function via Redis Lua script
    let script = r#"
        local proposal_id = ARGV[1]
        return redis.call('EVALSHA', redis.call('SCRIPT', 'LOAD', 'return require("arbitration").resolve_conflict(KEYS, ARGV)'), 0, proposal_id)
    "#;
    
    let result: Option<String> = redis.eval(script, &[], &[&proposal_id]).await?;
    
    if let Some(result_json) = result {
        let result: ArbitrationResult = serde_json::from_str(&result_json)?;
        
        println!("Arbitration result for proposal {}:", proposal_id);
        println!("Winner: {}", result.winner);
        println!("Winning option: {}", result.winning_option);
        println!("Total trust score: {:.2}", result.total_trust);
        println!("Agent count: {}", result.agent_count);
        println!("Reason: {}", result.reason);
        
        let mut table = Table::new();
        table
            .set_header(vec!["Option", "Raw Count", "Weighted Score", "Supporters"])
            .set_content_arrangement(ContentArrangement::Dynamic);
        
        for (option, details) in result.options.iter() {
            let supporters = if details.supporters.len() <= 3 {
                details.supporters.join(", ")
            } else {
                format!("{} agents", details.supporters.len())
            };
            
            let row = vec![
                option,
                &details.raw_count.to_string(),
                &format!("{:.2}", details.weighted_score),
                &supporters,
            ];
            
            table.add_row(row);
        }
        
        println!("{table}");
    } else {
        println!("Failed to arbitrate proposal {}", proposal_id);
    }
    
    Ok(())
}

async fn show_arbitration_stats(redis: &RedisClient, args: StatsArgs) -> Result<()> {
    if let Some(agent_id) = args.agent_id {
        // Show stats for a specific agent
        let stats_json = redis.get(&format!("agent:{}:arbitration:stats", agent_id)).await?;
        
        if let Some(json) = stats_json {
            let stats: AgentArbitrationStats = serde_json::from_str(&json)?;
            
            println!("Arbitration statistics for agent {}:", agent_id);
            println!("Correct arbitrations: {}", stats.correct_arbitrations);
            println!("Total arbitrations: {}", stats.total_arbitrations);
            println!("Accuracy: {:.2}%", stats.accuracy * 100.0);
        } else {
            println!("No arbitration statistics found for agent {}", agent_id);
        }
    } else {
        // List all agents with arbitration stats
        let keys: Vec<String> = redis.keys("agent:*:arbitration:stats").await?;
        
        if keys.is_empty() {
            println!("No agents have arbitration statistics.");
            return Ok(());
        }
        
        let mut table = Table::new();
        table
            .set_header(vec!["Agent ID", "Correct", "Total", "Accuracy"])
            .set_content_arrangement(ContentArrangement::Dynamic);
        
        for key in keys {
            let agent_id = key.split(':').nth(1).unwrap_or("unknown");
            let stats_json = redis.get(&key).await?;
            
            if let Some(json) = stats_json {
                let stats: AgentArbitrationStats = serde_json::from_str(&json)?;
                
                // Color code based on accuracy
                let accuracy_cell = if stats.accuracy >= 0.8 {
                    Cell::new(format!("{:.2}%", stats.accuracy * 100.0)).fg(Color::Green)
                } else if stats.accuracy >= 0.5 {
                    Cell::new(format!("{:.2}%", stats.accuracy * 100.0)).fg(Color::Yellow)
                } else {
                    Cell::new(format!("{:.2}%", stats.accuracy * 100.0)).fg(Color::Red)
                };
                
                table.add_row(vec![
                    Cell::new(agent_id),
                    Cell::new(stats.correct_arbitrations.to_string()),
                    Cell::new(stats.total_arbitrations.to_string()),
                    accuracy_cell,
                ]);
            }
        }
        
        println!("Agent Arbitration Statistics:");
        println!("{table}");
    }
    
    Ok(())
} 