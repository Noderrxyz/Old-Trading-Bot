use anyhow::{anyhow, Context, Result};
use clap::{Args, Subcommand};
use colored::Colorize;
use comfy_table::{Table, ContentArrangement, Cell, Color};
use chrono::{DateTime, TimeZone, Utc};
use std::path::PathBuf;
use std::io::Write;
use std::fs::File;
use std::sync::Arc;

use crate::agent_snapshot::{
    AgentSnapshotManager, AgentSnapshot, MockAgentMemory, AgentInstance, TrustState,
    AgentContext, StrategyState, TrustReplayEngine, MockTrustReplayEngine
};

// Main command for Agent Snapshot management
#[derive(Args, Debug)]
pub struct AgentSnapshotCommand {
    #[command(subcommand)]
    pub subcommand: AgentSnapshotSubcommand,
}

// Subcommands for Agent Snapshot management
#[derive(Subcommand, Debug)]
pub enum AgentSnapshotSubcommand {
    /// Create a new agent snapshot
    Create(CreateArgs),
    
    /// List available agent snapshots
    List(ListArgs),
    
    /// View detailed snapshot information
    View(ViewArgs),
    
    /// Replay a snapshot to simulate agent behavior
    Replay(ReplayArgs),
    
    /// Compare two snapshots to see differences
    Diff(DiffArgs),
}

#[derive(Args, Debug)]
pub struct CreateArgs {
    /// Agent ID to snapshot
    #[arg(long)]
    pub agent_id: String,
    
    /// Current role of the agent
    #[arg(long, default_value = "executor")]
    pub role: String,
    
    /// Trust score (0.0-1.0)
    #[arg(long, default_value = "0.85")]
    pub trust_score: f32,
    
    /// Execution environment
    #[arg(long, default_value = "production")]
    pub environment: String,
    
    /// Execution mode
    #[arg(long, default_value = "live")]
    pub execution_mode: String,
    
    /// Export the created snapshot to JSON file
    #[arg(long)]
    pub export: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub struct ListArgs {
    /// Filter by agent ID
    #[arg(long)]
    pub agent_id: Option<String>,
    
    /// Maximum number of snapshots to list
    #[arg(long, default_value = "10")]
    pub limit: usize,
    
    /// Filter by minimum trust score
    #[arg(long)]
    pub min_trust: Option<f32>,
    
    /// Filter by maximum trust score
    #[arg(long)]
    pub max_trust: Option<f32>,
    
    /// Output format (table, json, csv)
    #[arg(long, default_value = "table")]
    pub format: String,
    
    /// Export the results to a file
    #[arg(long)]
    pub export: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub struct ViewArgs {
    /// Snapshot ID to view
    #[arg()]
    pub snapshot_id: String,
    
    /// Output format (table, json)
    #[arg(long, default_value = "table")]
    pub format: String,
    
    /// Export the results to a file
    #[arg(long)]
    pub export: Option<PathBuf>,
    
    /// Show full reason chain
    #[arg(long)]
    pub full_reason_chain: bool,
}

#[derive(Args, Debug)]
pub struct ReplayArgs {
    /// Snapshot ID to replay
    #[arg()]
    pub snapshot_id: String,
    
    /// Display detailed replay steps
    #[arg(long)]
    pub verbose: bool,
    
    /// Output replay results to a file
    #[arg(long)]
    pub export: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub struct DiffArgs {
    /// First snapshot ID for comparison
    #[arg()]
    pub snapshot_id1: String,
    
    /// Second snapshot ID for comparison
    #[arg()]
    pub snapshot_id2: String,
    
    /// Output format (table, json)
    #[arg(long, default_value = "table")]
    pub format: String,
    
    /// Export the diff to a file
    #[arg(long)]
    pub export: Option<PathBuf>,
}

pub async fn run_agent_snapshot_command(cmd: &AgentSnapshotCommand) -> Result<()> {
    match &cmd.subcommand {
        AgentSnapshotSubcommand::Create(args) => create_snapshot(args).await,
        AgentSnapshotSubcommand::List(args) => list_snapshots(args).await,
        AgentSnapshotSubcommand::View(args) => view_snapshot(args).await,
        AgentSnapshotSubcommand::Replay(args) => replay_snapshot(args).await,
        AgentSnapshotSubcommand::Diff(args) => diff_snapshots(args).await,
    }
}

async fn create_snapshot(args: &CreateArgs) -> Result<()> {
    println!("{}", "📸 Creating Agent Snapshot".bright_blue());
    println!("Agent ID: {}", args.agent_id.bright_yellow());
    
    // In a real implementation, we would fetch the actual agent state
    // For now, create a mock agent instance with the provided parameters
    let agent = create_mock_agent(
        &args.agent_id,
        args.trust_score,
        &args.role,
        &args.environment,
        &args.execution_mode,
    );
    
    // Create the snapshot
    let snapshot_manager = AgentSnapshotManager::new();
    let snapshot = snapshot_manager.create_snapshot(&agent).await
        .context("Failed to create snapshot")?;
    
    println!("{}", "✅ Snapshot created successfully!".bright_green());
    println!("Snapshot ID: {}", snapshot.snapshot_id.bright_green());
    println!("Timestamp: {}", format_timestamp(snapshot.timestamp));
    println!("Trust Score: {:.2}", snapshot.trust_score);
    
    // Export if requested
    if let Some(path) = &args.export {
        // Serialize snapshot to JSON
        let json = serde_json::to_string_pretty(&snapshot)
            .context("Failed to serialize snapshot to JSON")?;
        
        // Write to file
        let mut file = File::create(path)
            .context("Failed to create output file")?;
        file.write_all(json.as_bytes())
            .context("Failed to write to output file")?;
        
        println!("Snapshot exported to: {}", path.display());
    }
    
    Ok(())
}

async fn list_snapshots(args: &ListArgs) -> Result<()> {
    println!("{}", "📋 Listing Agent Snapshots".bright_blue());
    
    if let Some(agent_id) = &args.agent_id {
        println!("Agent ID: {}", agent_id.bright_yellow());
    }
    
    // Get snapshots - handle trust score filters if provided
    let snapshot_manager = AgentSnapshotManager::new();
    let snapshots = if let (Some(min), Some(max)) = (args.min_trust, args.max_trust) {
        snapshot_manager.find_by_trust_score(min, max, args.limit).await?
    } else {
        let agent_id_ref = args.agent_id.as_deref();
        snapshot_manager.list_snapshots(agent_id_ref, args.limit).await?
    };
    
    if snapshots.is_empty() {
        println!("{}", "No snapshots found matching the criteria.".bright_yellow());
        return Ok(());
    }
    
    println!("Found {} snapshots:", snapshots.len());
    
    // Display results based on requested format
    match args.format.as_str() {
        "json" => {
            // Output as JSON
            let json = serde_json::to_string_pretty(&snapshots)
                .context("Failed to serialize snapshots to JSON")?;
            
            if let Some(path) = &args.export {
                // Write to file
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(json.as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("Results exported to: {}", path.display());
            } else {
                println!("{}", json);
            }
        },
        "csv" => {
            // Create CSV content
            let mut csv_content = String::from("snapshot_id,agent_id,timestamp,trust_score,role\n");
            
            for snapshot in &snapshots {
                let dt = format_timestamp(snapshot.timestamp);
                csv_content.push_str(&format!(
                    "{},{},{},{:.2},{}\n",
                    snapshot.snapshot_id,
                    snapshot.agent_id,
                    dt,
                    snapshot.trust_score,
                    snapshot.role
                ));
            }
            
            if let Some(path) = &args.export {
                // Write to file
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(csv_content.as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("Results exported to: {}", path.display());
            } else {
                println!("{}", csv_content);
            }
        },
        _ => {
            // Default to table format
            let mut table = Table::new();
            table.set_content_arrangement(ContentArrangement::Dynamic);
            table.set_header(vec![
                "ID",
                "Agent ID",
                "Timestamp",
                "Trust Score",
                "Role",
            ]);
            
            for snapshot in &snapshots {
                let dt = format_timestamp(snapshot.timestamp);
                table.add_row(vec![
                    snapshot.snapshot_id.clone(),
                    snapshot.agent_id.clone(),
                    dt,
                    format!("{:.2}", snapshot.trust_score),
                    snapshot.role.clone(),
                ]);
            }
            
            if let Some(path) = &args.export {
                // Write to file
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(format!("{}", table).as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("Results exported to: {}", path.display());
            } else {
                println!("{}", table);
            }
        }
    }
    
    Ok(())
}

async fn view_snapshot(args: &ViewArgs) -> Result<()> {
    println!("{}", "🔍 Viewing Agent Snapshot".bright_blue());
    println!("Snapshot ID: {}", args.snapshot_id.bright_yellow());
    
    // Load the snapshot
    let snapshot_manager = AgentSnapshotManager::new();
    let snapshot = snapshot_manager.load_snapshot(&args.snapshot_id).await?
        .ok_or_else(|| anyhow!("Snapshot not found with ID: {}", args.snapshot_id))?;
    
    match args.format.as_str() {
        "json" => {
            // Output as JSON
            let json = serde_json::to_string_pretty(&snapshot)
                .context("Failed to serialize snapshot to JSON")?;
            
            if let Some(path) = &args.export {
                // Write to file
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(json.as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("Snapshot exported to: {}", path.display());
            } else {
                println!("{}", json);
            }
        },
        _ => {
            // Default to table format for basic information
            let mut basic_table = Table::new();
            basic_table.set_content_arrangement(ContentArrangement::Dynamic);
            
            basic_table.add_row(vec![
                Cell::new("Snapshot ID").fg(Color::Blue),
                Cell::new(&snapshot.snapshot_id),
            ]);
            
            basic_table.add_row(vec![
                Cell::new("Agent ID").fg(Color::Blue),
                Cell::new(&snapshot.agent_id),
            ]);
            
            basic_table.add_row(vec![
                Cell::new("Timestamp").fg(Color::Blue),
                Cell::new(format_timestamp(snapshot.timestamp)),
            ]);
            
            basic_table.add_row(vec![
                Cell::new("Trust Score").fg(Color::Blue),
                Cell::new(format!("{:.2}", snapshot.trust_score)),
            ]);
            
            basic_table.add_row(vec![
                Cell::new("Role").fg(Color::Blue),
                Cell::new(&snapshot.current_role),
            ]);
            
            basic_table.add_row(vec![
                Cell::new("Memory Hash").fg(Color::Blue),
                Cell::new(&snapshot.memory_shard_hash),
            ]);
            
            println!("Basic Information:");
            println!("{}", basic_table);
            
            // Display reason chain
            let mut reason_table = Table::new();
            reason_table.set_content_arrangement(ContentArrangement::Dynamic);
            reason_table.set_header(vec!["Step", "Reason"]);
            
            let reason_chain = if args.full_reason_chain {
                &snapshot.reason_chain
            } else {
                // Limit to 5 steps if not requesting full chain
                &snapshot.reason_chain[..snapshot.reason_chain.len().min(5)]
            };
            
            for (i, reason) in reason_chain.iter().enumerate() {
                reason_table.add_row(vec![
                    (i + 1).to_string(),
                    reason.clone(),
                ]);
            }
            
            println!("\nReason Chain:");
            println!("{}", reason_table);
            
            // Display context
            let mut context_table = Table::new();
            context_table.set_content_arrangement(ContentArrangement::Dynamic);
            
            context_table.add_row(vec![
                Cell::new("Environment").fg(Color::Blue),
                Cell::new(&snapshot.context.environment),
            ]);
            
            context_table.add_row(vec![
                Cell::new("Execution Mode").fg(Color::Blue),
                Cell::new(&snapshot.context.execution_mode),
            ]);
            
            context_table.add_row(vec![
                Cell::new("Permissions").fg(Color::Blue),
                Cell::new(snapshot.context.permissions.join(", ")),
            ]);
            
            println!("\nContext:");
            println!("{}", context_table);
            
            // Display strategy state if available
            if let Some(strategy) = &snapshot.strategy_state {
                let mut strategy_table = Table::new();
                strategy_table.set_content_arrangement(ContentArrangement::Dynamic);
                
                strategy_table.add_row(vec![
                    Cell::new("Strategy ID").fg(Color::Blue),
                    Cell::new(&strategy.strategy_id),
                ]);
                
                if let Some(time) = strategy.last_execution_time {
                    strategy_table.add_row(vec![
                        Cell::new("Last Execution").fg(Color::Blue),
                        Cell::new(format_timestamp(time)),
                    ]);
                }
                
                println!("\nStrategy State:");
                println!("{}", strategy_table);
                
                // Display parameters
                if !strategy.parameters.is_empty() {
                    let mut params_table = Table::new();
                    params_table.set_content_arrangement(ContentArrangement::Dynamic);
                    params_table.set_header(vec!["Parameter", "Value"]);
                    
                    for (key, value) in &strategy.parameters {
                        params_table.add_row(vec![
                            key.clone(),
                            format!("{}", value),
                        ]);
                    }
                    
                    println!("\nStrategy Parameters:");
                    println!("{}", params_table);
                }
                
                // Display performance metrics
                if !strategy.performance_metrics.is_empty() {
                    let mut metrics_table = Table::new();
                    metrics_table.set_content_arrangement(ContentArrangement::Dynamic);
                    metrics_table.set_header(vec!["Metric", "Value"]);
                    
                    for (key, value) in &strategy.performance_metrics {
                        metrics_table.add_row(vec![
                            key.clone(),
                            format!("{:.4}", value),
                        ]);
                    }
                    
                    println!("\nPerformance Metrics:");
                    println!("{}", metrics_table);
                }
            }
            
            if let Some(path) = &args.export {
                // Export the full snapshot as JSON
                let json = serde_json::to_string_pretty(&snapshot)
                    .context("Failed to serialize snapshot to JSON")?;
                
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(json.as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("\nSnapshot details exported to: {}", path.display());
            }
        }
    }
    
    Ok(())
}

async fn replay_snapshot(args: &ReplayArgs) -> Result<()> {
    println!("{}", "🔄 Replaying Agent Snapshot".bright_blue());
    println!("Snapshot ID: {}", args.snapshot_id.bright_yellow());
    
    // Load the snapshot
    let snapshot_manager = AgentSnapshotManager::new();
    let snapshot = snapshot_manager.load_snapshot(&args.snapshot_id).await?
        .ok_or_else(|| anyhow!("Snapshot not found with ID: {}", args.snapshot_id))?;
    
    println!("Loaded snapshot for agent: {}", snapshot.agent_id.bright_yellow());
    println!("Trust Score: {:.2}", snapshot.trust_score);
    println!("Timestamp: {}", format_timestamp(snapshot.timestamp));
    
    println!("\n{}", "Initializing replay engine...".bright_blue());
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    // In a real implementation, we would integrate with the actual trust engine
    // For now, use a mock implementation
    let replay_engine = MockTrustReplayEngine;
    
    // Configure output capture if exporting
    let mut output = String::new();
    if args.export.is_some() {
        output.push_str(&format!("# Replay of snapshot {}\n\n", args.snapshot_id));
        output.push_str(&format!("Agent ID: {}\n", snapshot.agent_id));
        output.push_str(&format!("Trust Score: {:.2}\n", snapshot.trust_score));
        output.push_str(&format!("Timestamp: {}\n\n", format_timestamp(snapshot.timestamp)));
        output.push_str("## Reason Chain Replay\n\n");
    }
    
    // Replay the snapshot
    println!("\n{}", "Starting replay:".bright_green());
    for (i, step) in snapshot.reason_chain.iter().enumerate() {
        let step_str = format!("Step {}: {}", i + 1, step);
        println!("{}", step_str);
        
        if args.export.is_some() {
            output.push_str(&format!("{}. {}\n", i + 1, step));
        }
        
        // If verbose, add a small delay between steps for better visualization
        if args.verbose {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    }
    
    // Call the replay engine
    replay_engine.replay_from_snapshot(&snapshot)?;
    
    println!("\n{}", "✅ Replay completed".bright_green());
    
    if let Some(path) = &args.export {
        // Write captured output to file
        let mut file = File::create(path)
            .context("Failed to create output file")?;
        file.write_all(output.as_bytes())
            .context("Failed to write to output file")?;
        
        println!("Replay results exported to: {}", path.display());
    }
    
    Ok(())
}

async fn diff_snapshots(args: &DiffArgs) -> Result<()> {
    println!("{}", "📊 Comparing Agent Snapshots".bright_blue());
    println!("Snapshot 1: {}", args.snapshot_id1.bright_yellow());
    println!("Snapshot 2: {}", args.snapshot_id2.bright_yellow());
    
    // Load and compare snapshots
    let snapshot_manager = AgentSnapshotManager::new();
    let diff = snapshot_manager.compare_snapshots(&args.snapshot_id1, &args.snapshot_id2).await
        .context("Failed to compare snapshots")?;
    
    match args.format.as_str() {
        "json" => {
            // Output as JSON
            let json = serde_json::to_string_pretty(&diff)
                .context("Failed to serialize diff to JSON")?;
            
            if let Some(path) = &args.export {
                // Write to file
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(json.as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("Diff exported to: {}", path.display());
            } else {
                println!("{}", json);
            }
        },
        _ => {
            // Default to table format
            let mut summary_table = Table::new();
            summary_table.set_content_arrangement(ContentArrangement::Dynamic);
            
            summary_table.add_row(vec![
                Cell::new("Time Difference").fg(Color::Blue),
                Cell::new(format_duration(diff.time_difference)),
            ]);
            
            let trust_color = if diff.trust_score_delta > 0.0 {
                Color::Green
            } else if diff.trust_score_delta < 0.0 {
                Color::Red
            } else {
                Color::Reset
            };
            
            summary_table.add_row(vec![
                Cell::new("Trust Score Change").fg(Color::Blue),
                Cell::new(format!("{:+.2}", diff.trust_score_delta)).fg(trust_color),
            ]);
            
            summary_table.add_row(vec![
                Cell::new("Role Changed").fg(Color::Blue),
                Cell::new(if diff.role_changed { "Yes" } else { "No" }),
            ]);
            
            summary_table.add_row(vec![
                Cell::new("Memory Hash Changed").fg(Color::Blue),
                Cell::new(if diff.memory_hash_changed { "Yes" } else { "No" }),
            ]);
            
            println!("Summary of Changes:");
            println!("{}", summary_table);
            
            // Display reason chain changes
            if !diff.reason_chain_changes.is_empty() {
                let mut reason_table = Table::new();
                reason_table.set_content_arrangement(ContentArrangement::Dynamic);
                reason_table.set_header(vec!["Operation", "Index", "Change"]);
                
                for change in &diff.reason_chain_changes {
                    let operation_color = match change.operation.as_str() {
                        "added" => Color::Green,
                        "removed" => Color::Red,
                        _ => Color::Yellow,
                    };
                    
                    let change_text = match change.operation.as_str() {
                        "added" => format!("+ {}", change.value.as_ref().unwrap_or(&"".to_string())),
                        "removed" => format!("- {}", change.previous_value.as_ref().unwrap_or(&"".to_string())),
                        _ => "Changed".to_string(),
                    };
                    
                    reason_table.add_row(vec![
                        Cell::new(&change.operation).fg(operation_color),
                        Cell::new(change.index.to_string()),
                        Cell::new(change_text),
                    ]);
                }
                
                println!("\nReason Chain Changes:");
                println!("{}", reason_table);
            }
            
            // Display strategy changes
            if !diff.strategy_changes.is_empty() {
                let mut strategy_table = Table::new();
                strategy_table.set_content_arrangement(ContentArrangement::Dynamic);
                strategy_table.set_header(vec!["Strategy Changes"]);
                
                for change in &diff.strategy_changes {
                    strategy_table.add_row(vec![change.clone()]);
                }
                
                println!("\nStrategy Changes:");
                println!("{}", strategy_table);
            }
            
            // Display context changes
            if !diff.context_changes.is_empty() {
                let mut context_table = Table::new();
                context_table.set_content_arrangement(ContentArrangement::Dynamic);
                context_table.set_header(vec!["Context Changes"]);
                
                for change in &diff.context_changes {
                    context_table.add_row(vec![change.clone()]);
                }
                
                println!("\nContext Changes:");
                println!("{}", context_table);
            }
            
            if let Some(path) = &args.export {
                // Export the full diff as JSON
                let json = serde_json::to_string_pretty(&diff)
                    .context("Failed to serialize diff to JSON")?;
                
                let mut file = File::create(path)
                    .context("Failed to create output file")?;
                file.write_all(json.as_bytes())
                    .context("Failed to write to output file")?;
                
                println!("\nDiff details exported to: {}", path.display());
            }
        }
    }
    
    Ok(())
}

// Helper functions

fn format_timestamp(timestamp: i64) -> String {
    match Utc.timestamp_opt(timestamp, 0) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
        _ => "Invalid timestamp".to_string(),
    }
}

fn format_duration(seconds: i64) -> String {
    let abs_seconds = seconds.abs();
    let prefix = if seconds < 0 { "-" } else { "" };
    
    if abs_seconds < 60 {
        format!("{}{} seconds", prefix, abs_seconds)
    } else if abs_seconds < 3600 {
        format!("{}{} minutes", prefix, abs_seconds / 60)
    } else if abs_seconds < 86400 {
        format!("{}{} hours", prefix, abs_seconds / 3600)
    } else {
        format!("{}{} days", prefix, abs_seconds / 86400)
    }
}

fn create_mock_agent(agent_id: &str, trust_score: f32, role: &str, environment: &str, execution_mode: &str) -> AgentInstance {
    use std::collections::HashMap;
    
    // Create a mock agent instance for demonstration purposes
    AgentInstance {
        id: agent_id.to_string(),
        trust_state: TrustState {
            score: trust_score,
            last_updated: Utc::now().timestamp(),
            factors: HashMap::new(),
        },
        role: role.to_string(),
        memory: MockAgentMemory::new("mock-memory-hash-12345"),
        strategy_state: Some(StrategyState {
            strategy_id: "default-strategy".to_string(),
            parameters: {
                let mut params = HashMap::new();
                params.insert("threshold".to_string(), serde_json::json!(0.75));
                params.insert("window_size".to_string(), serde_json::json!(10));
                params
            },
            active_positions: Vec::new(),
            last_execution_time: Some(Utc::now().timestamp()),
            performance_metrics: {
                let mut metrics = HashMap::new();
                metrics.insert("accuracy".to_string(), 0.92);
                metrics.insert("latency_ms".to_string(), 15.0);
                metrics
            },
        }),
        context: AgentContext {
            environment: environment.to_string(),
            execution_mode: execution_mode.to_string(),
            permissions: vec!["read".to_string(), "write".to_string(), "execute".to_string()],
            configuration: HashMap::new(),
            custom_data: None,
        },
        reason_chain_history: vec![
            "Initialized with default parameters".to_string(),
            "Loaded historical data".to_string(),
            "Computed baseline metrics".to_string(),
            "Analyzed market conditions".to_string(),
            "Applied trust scaling factors".to_string(),
        ],
    }
} 