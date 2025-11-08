use anyhow::{anyhow, Result};
use clap::{Args, Subcommand};
use comfy_table::{Cell, Color, ContentArrangement, Table};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use chrono::{DateTime, Utc, Duration};
use noderr_core::{storage::Storage, engine::Engine, redis::RedisClient};

#[derive(Args)]
pub struct VoteLedgerCommand {
    #[command(subcommand)]
    command: VoteLedgerSubCommand,
}

#[derive(Subcommand)]
pub enum VoteLedgerSubCommand {
    /// Inspect all votes for a specific proposal
    Inspect(InspectArgs),
    
    /// Trace recent arbitration resolutions
    RecentArbitrations(RecentArbitrationsArgs),
    
    /// Debug trust weight influence on a proposal
    WeightsDebug(WeightsDebugArgs),
    
    /// Detect potential tampering in voting records
    TamperDetect(TamperDetectArgs),
}

#[derive(Args)]
pub struct InspectArgs {
    /// Proposal ID to inspect
    proposal_id: String,
    
    /// Show detailed information about each vote
    #[arg(short, long)]
    detailed: bool,
}

#[derive(Args)]
pub struct RecentArbitrationsArgs {
    /// Number of hours to look back (default: 24)
    #[arg(short, long, default_value = "24")]
    hours: u64,
}

#[derive(Args)]
pub struct WeightsDebugArgs {
    /// Proposal ID to analyze trust weights for
    proposal_id: String,
}

#[derive(Args)]
pub struct TamperDetectArgs {
    /// Proposal ID to check for tampering (if not specified, checks all proposals)
    #[arg(short, long)]
    proposal_id: Option<String>,
    
    /// Only show records with detected tampering
    #[arg(short, long)]
    suspicious_only: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct VoteRecord {
    proposal_id: String,
    agent_id: String,
    vote: String,
    trust_score: f64,
    role: String,
    timestamp: u64,
    arbitrated: bool,
    finalized: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ArbitrationRecord {
    proposal_id: String,
    winner: String,
    winning_option: String,
    total_trust: f64,
    agent_count: usize,
    reason: String,
    timestamp: u64,
    participants: Vec<String>,
}

pub async fn run_vote_ledger_command(
    command: VoteLedgerCommand,
    engine: Arc<Engine>,
    storage: Arc<Storage>,
) -> Result<()> {
    let redis_client = engine.get_redis_client().clone();
    
    match command.command {
        VoteLedgerSubCommand::Inspect(args) => {
            inspect_proposal_votes(&redis_client, args).await
        },
        VoteLedgerSubCommand::RecentArbitrations(args) => {
            trace_recent_arbitrations(&redis_client, args).await
        },
        VoteLedgerSubCommand::WeightsDebug(args) => {
            debug_trust_weights(&redis_client, args).await
        },
        VoteLedgerSubCommand::TamperDetect(args) => {
            detect_tampering(&redis_client, args).await
        },
    }
}

async fn inspect_proposal_votes(redis: &RedisClient, args: InspectArgs) -> Result<()> {
    println!("🧾 Inspecting votes for proposal: {}", args.proposal_id);
    
    // Get vote records for the proposal
    let vote_keys = redis.keys(&format!("vote:ledger:{}:*", args.proposal_id)).await?;
    
    if vote_keys.is_empty() {
        println!("No votes found for proposal {}", args.proposal_id);
        return Ok(());
    }
    
    let mut votes = Vec::new();
    
    for key in vote_keys {
        let vote_data = redis.get(&key).await?;
        
        if let Some(data) = vote_data {
            let vote: VoteRecord = serde_json::from_str(&data)?;
            votes.push(vote);
        }
    }
    
    // Sort votes by timestamp
    votes.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    
    // Create table for display
    let mut table = Table::new();
    
    if args.detailed {
        table.set_header(vec!["Agent", "Vote", "Trust", "Role", "Time", "Status"]);
        
        for vote in votes {
            let time = DateTime::<Utc>::from_timestamp((vote.timestamp / 1000) as i64, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_else(|| "Invalid".to_string());
                
            let status = if vote.finalized {
                "Final".to_string()
            } else if vote.arbitrated {
                "Arbitrated".to_string()
            } else {
                "Pending".to_string()
            };
            
            // Color vote based on choice
            let vote_cell = match vote.vote.to_lowercase().as_str() {
                "yes" | "accept" => Cell::new(vote.vote).fg(Color::Green),
                "no" | "reject" => Cell::new(vote.vote).fg(Color::Red),
                "abstain" => Cell::new(vote.vote).fg(Color::Yellow),
                _ => Cell::new(vote.vote),
            };
            
            table.add_row(vec![
                Cell::new(vote.agent_id),
                vote_cell,
                Cell::new(format!("{:.2}", vote.trust_score)),
                Cell::new(vote.role),
                Cell::new(time),
                Cell::new(status),
            ]);
        }
    } else {
        table.set_header(vec!["Agent", "Vote", "Trust", "Time"]);
        
        for vote in votes {
            let time = DateTime::<Utc>::from_timestamp((vote.timestamp / 1000) as i64, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_else(|| "Invalid".to_string());
                
            // Color vote based on choice
            let vote_cell = match vote.vote.to_lowercase().as_str() {
                "yes" | "accept" => Cell::new(vote.vote).fg(Color::Green),
                "no" | "reject" => Cell::new(vote.vote).fg(Color::Red),
                "abstain" => Cell::new(vote.vote).fg(Color::Yellow),
                _ => Cell::new(vote.vote),
            };
            
            table.add_row(vec![
                Cell::new(vote.agent_id),
                vote_cell,
                Cell::new(format!("{:.2}", vote.trust_score)),
                Cell::new(time),
            ]);
        }
    }
    
    // Get arbitration result if available
    let arbitration_key = format!("vote:arbitration:{}", args.proposal_id);
    let arbitration_data = redis.get(&arbitration_key).await?;
    
    // Display vote table
    println!("{table}");
    
    // Display arbitration result if available
    if let Some(data) = arbitration_data {
        let arbitration: ArbitrationRecord = serde_json::from_str(&data)?;
        
        println!("\n✅ Arbitration Result:");
        println!("Winner: {}", arbitration.winner);
        println!("Winning Option: {}", arbitration.winning_option);
        println!("Total Trust: {:.2}", arbitration.total_trust);
        println!("Reason: {}", arbitration.reason);
        
        let time = DateTime::<Utc>::from_timestamp((arbitration.timestamp / 1000) as i64, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
            .unwrap_or_else(|| "Invalid".to_string());
            
        println!("Timestamp: {}", time);
        println!("Participants: {}", arbitration.participants.join(", "));
    }
    
    Ok(())
}

async fn trace_recent_arbitrations(redis: &RedisClient, args: RecentArbitrationsArgs) -> Result<()> {
    println!("🔍 Tracing arbitration resolutions in the last {} hours", args.hours);
    
    // Get all arbitration records
    let arbitration_keys = redis.keys("vote:arbitration:*").await?;
    
    if arbitration_keys.is_empty() {
        println!("No arbitration records found");
        return Ok(());
    }
    
    let mut arbitrations = Vec::new();
    let current_time = Utc::now().timestamp() as u64 * 1000;
    let cutoff_time = current_time - (args.hours * 3600 * 1000);
    
    for key in arbitration_keys {
        let data = redis.get(&key).await?;
        
        if let Some(data) = data {
            let arbitration: ArbitrationRecord = serde_json::from_str(&data)?;
            
            // Filter by recent time
            if arbitration.timestamp >= cutoff_time {
                arbitrations.push(arbitration);
            }
        }
    }
    
    // Sort by timestamp (newest first)
    arbitrations.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    
    if arbitrations.is_empty() {
        println!("No arbitrations found in the last {} hours", args.hours);
        return Ok(());
    }
    
    let mut table = Table::new();
    table.set_header(vec!["Proposal", "Winner", "Option", "Trust", "Time", "Participants"]);
    
    for arbitration in arbitrations {
        let time = DateTime::<Utc>::from_timestamp((arbitration.timestamp / 1000) as i64, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
            .unwrap_or_else(|| "Invalid".to_string());
            
        let participants = if arbitration.participants.len() <= 2 {
            arbitration.participants.join(", ")
        } else {
            format!("{} agents", arbitration.participants.len())
        };
        
        // Color winning option
        let option_cell = match arbitration.winning_option.to_lowercase().as_str() {
            "yes" | "accept" => Cell::new(&arbitration.winning_option).fg(Color::Green),
            "no" | "reject" => Cell::new(&arbitration.winning_option).fg(Color::Red),
            "abstain" => Cell::new(&arbitration.winning_option).fg(Color::Yellow),
            _ => Cell::new(&arbitration.winning_option),
        };
        
        table.add_row(vec![
            Cell::new(&arbitration.proposal_id),
            Cell::new(&arbitration.winner),
            option_cell,
            Cell::new(format!("{:.2}", arbitration.total_trust)),
            Cell::new(time),
            Cell::new(participants),
        ]);
    }
    
    println!("{table}");
    
    Ok(())
}

async fn debug_trust_weights(redis: &RedisClient, args: WeightsDebugArgs) -> Result<()> {
    println!("🧾 Proposal {} - Trust Breakdown", args.proposal_id);
    println!("--------------------------------------");
    
    // Get all votes for the proposal
    let vote_keys = redis.keys(&format!("vote:ledger:{}:*", args.proposal_id)).await?;
    
    if vote_keys.is_empty() {
        println!("No votes found for proposal {}", args.proposal_id);
        return Ok(());
    }
    
    let mut votes = Vec::new();
    let mut total_trust_yes = 0.0;
    let mut total_trust_no = 0.0;
    let mut total_trust_abstain = 0.0;
    
    for key in vote_keys {
        let vote_data = redis.get(&key).await?;
        
        if let Some(data) = vote_data {
            let vote: VoteRecord = serde_json::from_str(&data)?;
            votes.push(vote.clone());
            
            // Add to totals
            match vote.vote.to_lowercase().as_str() {
                "yes" | "accept" => total_trust_yes += vote.trust_score,
                "no" | "reject" => total_trust_no += vote.trust_score,
                "abstain" => total_trust_abstain += vote.trust_score,
                _ => {}
            }
        }
    }
    
    // Sort by trust score (highest first)
    votes.sort_by(|a, b| b.trust_score.partial_cmp(&a.trust_score).unwrap_or(std::cmp::Ordering::Equal));
    
    // Display each vote
    for vote in &votes {
        let vote_str = match vote.vote.to_lowercase().as_str() {
            "yes" | "accept" => "accept",
            "no" | "reject" => "reject",
            "abstain" => "abstain",
            _ => &vote.vote,
        };
        
        println!("{:<10} vote: {:<8} trust: {:.1}", vote.agent_id, vote_str, vote.trust_score);
    }
    
    println!("\nTrust Score Totals:");
    println!("Accept:  {:.1}", total_trust_yes);
    println!("Reject:  {:.1}", total_trust_no);
    println!("Abstain: {:.1}", total_trust_abstain);
    
    // Determine outcome
    let highest_trust = total_trust_yes.max(total_trust_no);
    let winning_option = if total_trust_yes > total_trust_no {
        "accept"
    } else if total_trust_no > total_trust_yes {
        "reject"
    } else {
        "tie"
    };
    
    // Get arbitration result if available
    let arbitration_key = format!("vote:arbitration:{}", args.proposal_id);
    let arbitration_data = redis.get(&arbitration_key).await?;
    
    if let Some(data) = arbitration_data {
        let arbitration: ArbitrationRecord = serde_json::from_str(&data)?;
        println!("\n✅ Resolved: {} ({:.1} trust-weighted)", arbitration.winning_option, arbitration.total_trust);
    } else if winning_option != "tie" {
        println!("\n✅ Resolved: {} ({:.1} trust-weighted)", winning_option, highest_trust);
    } else {
        println!("\n❓ Unresolved: tie");
    }
    
    Ok(())
}

async fn detect_tampering(redis: &RedisClient, args: TamperDetectArgs) -> Result<()> {
    println!("🔐 Checking for vote tampering or inconsistencies");
    
    let proposal_ids = if let Some(id) = args.proposal_id.as_ref() {
        vec![id.clone()]
    } else {
        // Get all unique proposal IDs from vote ledger
        let vote_keys = redis.keys("vote:ledger:*").await?;
        let mut ids = std::collections::HashSet::new();
        
        for key in vote_keys {
            let parts: Vec<&str> = key.split(':').collect();
            if parts.len() >= 3 {
                ids.insert(parts[2].to_string());
            }
        }
        
        ids.into_iter().collect()
    };
    
    if proposal_ids.is_empty() {
        println!("No proposals found for tampering analysis");
        return Ok(());
    }
    
    let mut has_suspicious = false;
    let mut table = Table::new();
    table.set_header(vec!["Proposal", "Agent", "Issue", "Severity"]);
    
    for proposal_id in proposal_ids {
        // 1. Check for vote changes after submission
        let vote_history_keys = redis.keys(&format!("vote:history:{}:*", proposal_id)).await?;
        
        for history_key in vote_history_keys {
            let history_data: Option<String> = redis.get(&history_key).await?;
            
            if let Some(data) = history_data {
                let vote_history: Vec<VoteRecord> = serde_json::from_str(&data)?;
                
                if vote_history.len() > 1 {
                    // Multiple votes from same agent
                    let agent_id = history_key.split(':').nth(3).unwrap_or("unknown");
                    let first_vote = &vote_history[0];
                    let last_vote = &vote_history[vote_history.len() - 1];
                    
                    if first_vote.vote != last_vote.vote {
                        has_suspicious = true;
                        table.add_row(vec![
                            Cell::new(&proposal_id),
                            Cell::new(agent_id),
                            Cell::new("Vote changed after submission"),
                            Cell::new("High").fg(Color::Red),
                        ]);
                        
                        // Flag the agent for trust violation
                        redis.set(&format!("trust:flag:tamper:{}", agent_id), "vote_change").await?;
                    }
                }
            }
        }
        
        // 2. Check for arbitration inconsistencies
        let arbitration_key = format!("vote:arbitration:{}", proposal_id);
        let arbitration_history_key = format!("vote:arbitration:history:{}", proposal_id);
        
        let arbitration_data = redis.get(&arbitration_key).await?;
        let arbitration_history: Option<String> = redis.get(&arbitration_history_key).await?;
        
        if let (Some(data), Some(history_data)) = (arbitration_data, arbitration_history) {
            let current: ArbitrationRecord = serde_json::from_str(&data)?;
            let history: Vec<ArbitrationRecord> = serde_json::from_str(&history_data)?;
            
            if !history.is_empty() {
                let first = &history[0];
                
                if first.winning_option != current.winning_option {
                    has_suspicious = true;
                    table.add_row(vec![
                        Cell::new(&proposal_id),
                        Cell::new(&current.winner),
                        Cell::new("Arbitration result changed"),
                        Cell::new("Critical").fg(Color::Red),
                    ]);
                    
                    // Flag the winning agent for trust violation
                    redis.set(&format!("trust:flag:tamper:{}", current.winner), "arbitration_change").await?;
                }
            }
        }
        
        // 3. Check for timestamp inconsistencies
        let vote_keys = redis.keys(&format!("vote:ledger:{}:*", proposal_id)).await?;
        let mut votes = Vec::new();
        
        for key in vote_keys {
            let vote_data = redis.get(&key).await?;
            
            if let Some(data) = vote_data {
                let vote: VoteRecord = serde_json::from_str(&data)?;
                votes.push(vote);
            }
        }
        
        // Sort by timestamp
        votes.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        
        // Get the proposal data
        let proposal_data: Option<String> = redis.get(&format!("governance:proposal:{}", proposal_id)).await?;
        
        if let Some(proposal_str) = proposal_data {
            let proposal: serde_json::Value = serde_json::from_str(&proposal_str)?;
            
            if let (Some(created_at), Some(expires_at)) = (
                proposal["createdAt"].as_u64(),
                proposal["expiresAt"].as_u64()
            ) {
                // Check for votes before creation
                for vote in &votes {
                    if vote.timestamp < created_at {
                        has_suspicious = true;
                        table.add_row(vec![
                            Cell::new(&proposal_id),
                            Cell::new(&vote.agent_id),
                            Cell::new("Vote timestamp before proposal creation"),
                            Cell::new("Critical").fg(Color::Red),
                        ]);
                        
                        // Flag the agent for trust violation
                        redis.set(&format!("trust:flag:tamper:{}", vote.agent_id), "time_inconsistency").await?;
                    }
                    
                    // Check for votes after expiration
                    if vote.timestamp > expires_at {
                        has_suspicious = true;
                        table.add_row(vec![
                            Cell::new(&proposal_id),
                            Cell::new(&vote.agent_id),
                            Cell::new("Vote timestamp after proposal expiration"),
                            Cell::new("High").fg(Color::Red),
                        ]);
                        
                        // Flag the agent for trust violation
                        redis.set(&format!("trust:flag:tamper:{}", vote.agent_id), "time_inconsistency").await?;
                    }
                }
            }
        }
    }
    
    if !has_suspicious {
        if args.suspicious_only {
            println!("No suspicious activities detected");
        } else {
            table.add_row(vec![
                Cell::new("-"),
                Cell::new("-"),
                Cell::new("No suspicious activities detected"),
                Cell::new("None").fg(Color::Green),
            ]);
            println!("{table}");
        }
    } else if !args.suspicious_only || table.row_iter().count() > 0 {
        println!("{table}");
        println!("\n⚠️ Suspicious activities detected! These have been flagged for trust evaluation.");
    }
    
    Ok(())
} 