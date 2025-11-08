use anyhow::{anyhow, Context, Result};
use clap::{Args, Subcommand};
use comfy_table::{Cell, Color, ContentArrangement, Table};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use chrono::{DateTime, Utc};
use noderr_core::{
    storage::Storage, 
    engine::Engine, 
    redis::RedisClient,
    memory_service::{MemoryService, MemoryEvent, AgentEmbedding, create_memory_service, generate_agent_embedding},
    agent_memory::{AgentMemory, MemoryRecord, MemoryType},
};

#[derive(Args, Debug)]
pub struct MemoryCommand {
    #[clap(subcommand)]
    pub subcommand: MemorySubcommand,
}

#[derive(Subcommand, Debug)]
pub enum MemorySubcommand {
    /// Show the memory records for a specific agent
    Show(ShowArgs),
    /// List all agents with memory records
    List(ListArgs),
    /// Analyze behavioral patterns of an agent based on its memory
    Analyze(AnalyzeArgs),
}

#[derive(Args, Debug)]
pub struct ShowArgs {
    /// Agent ID to show memory for
    #[clap(long)]
    pub agent_id: String,
    
    /// Optional memory type filter
    #[clap(long)]
    pub memory_type: Option<String>,
    
    /// Limit the number of memory records to show
    #[clap(long, default_value = "20")]
    pub limit: usize,
}

#[derive(Args, Debug)]
pub struct ListArgs {
    /// Optional limit for the number of agents to list
    #[clap(long, default_value = "20")]
    pub limit: usize,
}

#[derive(Args, Debug)]
pub struct AnalyzeArgs {
    /// Agent ID to analyze
    #[clap(long)]
    pub agent_id: String,
    
    /// Time period for analysis in days
    #[clap(long, default_value = "7")]
    pub days: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct AgentMemoryStats {
    agent_id: String,
    record_count: usize,
    memory_types: Vec<String>,
    first_record: DateTime<Utc>,
    latest_record: DateTime<Utc>,
}

pub async fn run_memory_command(
    command: &MemoryCommand,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    match &command.subcommand {
        MemorySubcommand::Show(args) => {
            show_agent_memory(&args, redis_client).await?;
        }
        MemorySubcommand::List(args) => {
            list_agents_with_memory(&args, redis_client).await?;
        }
        MemorySubcommand::Analyze(args) => {
            analyze_agent_behavior(&args, redis_client).await?;
        }
    }
    
    Ok(())
}

async fn show_agent_memory(args: &ShowArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    let agent_memory = AgentMemory::new(redis_client);
    
    let memory_records = if let Some(memory_type) = &args.memory_type {
        let memory_type = match memory_type.as_str() {
            "decision" => MemoryType::Decision,
            "observation" => MemoryType::Observation,
            "error" => MemoryType::Error,
            "action" => MemoryType::Action,
            _ => return Err(anyhow!("Invalid memory type: {}", memory_type)),
        };
        
        agent_memory.get_records_by_type(&args.agent_id, memory_type, args.limit)
            .await
            .context("Failed to get memory records by type")?
    } else {
        agent_memory.get_recent_records(&args.agent_id, args.limit)
            .await
            .context("Failed to get recent memory records")?
    };
    
    if memory_records.is_empty() {
        println!("No memory records found for agent {}", args.agent_id);
        return Ok(());
    }
    
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Timestamp",
            "Type",
            "Content",
            "Tags",
        ]);
    
    for record in memory_records {
        let type_str = match record.memory_type {
            MemoryType::Decision => Cell::new("Decision").fg(Color::Green),
            MemoryType::Observation => Cell::new("Observation").fg(Color::Blue),
            MemoryType::Error => Cell::new("Error").fg(Color::Red),
            MemoryType::Action => Cell::new("Action").fg(Color::Yellow),
        };
        
        let tags = record.tags.join(", ");
        
        table.add_row(Row::from(vec![
            Cell::new(record.timestamp.to_rfc3339()),
            type_str,
            Cell::new(record.content),
            Cell::new(tags),
        ]));
    }
    
    println!("Memory records for agent: {}", args.agent_id);
    println!("{table}");
    
    Ok(())
}

async fn list_agents_with_memory(args: &ListArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    let agent_memory = AgentMemory::new(redis_client);
    
    let agent_ids = agent_memory.get_agents_with_memory(args.limit)
        .await
        .context("Failed to get agents with memory")?;
    
    if agent_ids.is_empty() {
        println!("No agents with memory records found");
        return Ok(());
    }
    
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Agent ID",
            "Record Count",
            "Memory Types",
            "First Record",
            "Latest Record",
        ]);
    
    let mut agent_stats = Vec::new();
    
    for agent_id in agent_ids {
        let stats = collect_agent_stats(&agent_memory, &agent_id).await?;
        agent_stats.push(stats);
    }
    
    // Sort by record count (descending)
    agent_stats.sort_by(|a, b| b.record_count.cmp(&a.record_count));
    
    for stats in agent_stats {
        table.add_row(vec![
            stats.agent_id,
            stats.record_count.to_string(),
            stats.memory_types.join(", "),
            stats.first_record.to_rfc3339(),
            stats.latest_record.to_rfc3339(),
        ]);
    }
    
    println!("Agents with memory records:");
    println!("{table}");
    
    Ok(())
}

async fn collect_agent_stats(agent_memory: &AgentMemory, agent_id: &str) -> Result<AgentMemoryStats> {
    let records = agent_memory.get_recent_records(agent_id, 1000)
        .await
        .context("Failed to get agent records for stats")?;
    
    let record_count = records.len();
    
    let mut memory_types = Vec::new();
    let mut first_record = Utc::now();
    let mut latest_record = DateTime::<Utc>::from_timestamp(0, 0).unwrap();
    
    let mut type_set = std::collections::HashSet::new();
    
    for record in &records {
        type_set.insert(format!("{:?}", record.memory_type));
        
        if record.timestamp < first_record {
            first_record = record.timestamp;
        }
        
        if record.timestamp > latest_record {
            latest_record = record.timestamp;
        }
    }
    
    memory_types.extend(type_set.into_iter());
    memory_types.sort();
    
    Ok(AgentMemoryStats {
        agent_id: agent_id.to_string(),
        record_count,
        memory_types,
        first_record,
        latest_record,
    })
}

async fn analyze_agent_behavior(args: &AnalyzeArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    let agent_memory = AgentMemory::new(redis_client);
    
    let since = Utc::now() - chrono::Duration::days(args.days as i64);
    
    let records = agent_memory.get_records_since(&args.agent_id, since)
        .await
        .context("Failed to get agent records for analysis")?;
    
    if records.is_empty() {
        println!("No memory records found for agent {} in the last {} days", args.agent_id, args.days);
        return Ok(());
    }
    
    println!("Behavioral Analysis for Agent: {}", args.agent_id);
    println!("Period: Last {} days", args.days);
    println!("Total Records: {}", records.len());
    
    // Analyze memory type distribution
    let mut type_counts = std::collections::HashMap::new();
    for record in &records {
        *type_counts.entry(format!("{:?}", record.memory_type)).or_insert(0) += 1;
    }
    
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec!["Memory Type", "Count", "Percentage"]);
    
    for (memory_type, count) in type_counts.iter() {
        let percentage = (*count as f64 / records.len() as f64) * 100.0;
        table.add_row(vec![
            memory_type.to_string(),
            count.to_string(),
            format!("{:.1}%", percentage),
        ]);
    }
    
    println!("\nMemory Type Distribution:");
    println!("{table}");
    
    // Analyze action patterns
    let action_records: Vec<&MemoryRecord> = records.iter()
        .filter(|r| matches!(r.memory_type, MemoryType::Action))
        .collect();
    
    if !action_records.is_empty() {
        let mut action_patterns = std::collections::HashMap::new();
        
        for record in &action_records {
            *action_patterns.entry(&record.content).or_insert(0) += 1;
        }
        
        let mut patterns: Vec<(&&String, &i32)> = action_patterns.iter().collect();
        patterns.sort_by(|a, b| b.1.cmp(a.1));
        
        let mut table = Table::new();
        table
            .set_content_arrangement(ContentArrangement::Dynamic)
            .set_header(vec!["Action Pattern", "Frequency"]);
        
        for (i, (action, count)) in patterns.iter().take(10).enumerate() {
            table.add_row(vec![
                action.to_string(),
                count.to_string(),
            ]);
        }
        
        println!("\nTop Action Patterns:");
        println!("{table}");
    }
    
    // Analyze error trends
    let error_records: Vec<&MemoryRecord> = records.iter()
        .filter(|r| matches!(r.memory_type, MemoryType::Error))
        .collect();
    
    if !error_records.is_empty() {
        let mut error_trends = std::collections::HashMap::new();
        
        for record in &error_records {
            *error_trends.entry(&record.content).or_insert(0) += 1;
        }
        
        let mut trends: Vec<(&&String, &i32)> = error_trends.iter().collect();
        trends.sort_by(|a, b| b.1.cmp(a.1));
        
        let mut table = Table::new();
        table
            .set_content_arrangement(ContentArrangement::Dynamic)
            .set_header(vec!["Error Pattern", "Frequency"]);
        
        for (error, count) in trends.iter().take(5) {
            table.add_row(vec![
                error.to_string(),
                count.to_string(),
            ]);
        }
        
        println!("\nTop Error Patterns:");
        println!("{table}");
    }
    
    Ok(())
} 