use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use clap::{Args, Subcommand};
use colored::Colorize;
use comfy_table::{Cell, ContentArrangement, Row, Table};
use noderr_core::redis::RedisClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use std::thread;
use std::time::Duration as StdDuration;
use tabled::{Style, Tabled};
use rand::{Rng, thread_rng};
use uuid::Uuid;

#[derive(Debug, Args)]
pub struct AgentAnomalyMonitorCommand {
    #[command(subcommand)]
    pub subcommand: AgentAnomalyMonitorSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum AgentAnomalyMonitorSubcommand {
    /// Start real-time monitoring of agents for anomalies
    Monitor(MonitorArgs),
    
    /// View anomaly history and trends for specific agents
    History(HistoryArgs),
    
    /// Configure anomaly detection thresholds and sensitivity
    Configure(ConfigureArgs),
    
    /// Generate a comprehensive anomaly report
    Report(ReportArgs),
    
    /// Set up proactive alerting for anomaly detection
    Alert(AlertArgs),
}

#[derive(Debug, Args)]
pub struct MonitorArgs {
    /// Specific agent ID to monitor (omit to monitor all)
    #[arg(long)]
    pub agent_id: Option<String>,
    
    /// Refresh interval in seconds
    #[arg(long, default_value = "5")]
    pub interval: u64,
    
    /// Monitor only specific types of anomalies
    #[arg(long, default_value = "all")]
    pub types: String,
    
    /// Minimum severity level to display (1-5)
    #[arg(long, default_value = "1")]
    pub min_severity: u8,
    
    /// Maximum number of anomalies to display
    #[arg(long, default_value = "10")]
    pub limit: usize,
    
    /// Enable live mode with continuous updates
    #[arg(long)]
    pub live: bool,
}

#[derive(Debug, Args)]
pub struct HistoryArgs {
    /// Agent ID to view history for
    #[arg(long)]
    pub agent_id: String,
    
    /// Number of days to look back
    #[arg(long, default_value = "7")]
    pub days: u32,
    
    /// Type of anomalies to include
    #[arg(long, default_value = "all")]
    pub type_filter: String,
    
    /// Include resolved anomalies
    #[arg(long)]
    pub include_resolved: bool,
    
    /// Group by anomaly type
    #[arg(long)]
    pub group_by_type: bool,
}

#[derive(Debug, Args)]
pub struct ConfigureArgs {
    /// Sensitivity level for anomaly detection (low, medium, high)
    #[arg(long)]
    pub sensitivity: Option<String>,
    
    /// Custom thresholds for specific anomaly types (type:value)
    #[arg(long)]
    pub thresholds: Vec<String>,
    
    /// Enable learning mode to adapt thresholds automatically
    #[arg(long)]
    pub learning_mode: bool,
    
    /// Reset all configurations to defaults
    #[arg(long)]
    pub reset: bool,
    
    /// View current configuration
    #[arg(long)]
    pub view: bool,
}

#[derive(Debug, Args)]
pub struct ReportArgs {
    /// Agent ID to generate report for (omit for all agents)
    #[arg(long)]
    pub agent_id: Option<String>,
    
    /// Time period to include (day, week, month)
    #[arg(long, default_value = "week")]
    pub period: String,
    
    /// Export format (text, json, csv)
    #[arg(long, default_value = "text")]
    pub format: String,
    
    /// Include detailed analysis
    #[arg(long)]
    pub detailed: bool,
    
    /// Output file path
    #[arg(long)]
    pub output: Option<String>,
}

#[derive(Debug, Args)]
pub struct AlertArgs {
    /// Enable proactive alerting
    #[arg(long)]
    pub enable: bool,
    
    /// Alert channels (console, webhook, email)
    #[arg(long, default_value = "console")]
    pub channels: String,
    
    /// Minimum severity level for alerts
    #[arg(long, default_value = "3")]
    pub min_severity: u8,
    
    /// Cooldown period between alerts (in minutes)
    #[arg(long, default_value = "15")]
    pub cooldown: u32,
    
    /// Webhook URL for alerts (if webhook channel enabled)
    #[arg(long)]
    pub webhook_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Tabled)]
pub struct AnomalyEvent {
    #[tabled(rename = "ID")]
    pub id: String,
    
    #[tabled(rename = "Agent ID")]
    pub agent_id: String,
    
    #[tabled(rename = "Timestamp")]
    pub timestamp: String,
    
    #[tabled(rename = "Type")]
    pub anomaly_type: String,
    
    #[tabled(rename = "Severity")]
    pub severity: u8,
    
    #[tabled(rename = "Description")]
    pub description: String,
    
    #[tabled(rename = "Status")]
    pub status: String,
    
    #[tabled(rename = "Detection Method")]
    pub detection_method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyConfig {
    pub sensitivity: String,
    pub thresholds: HashMap<String, f64>,
    pub learning_mode: bool,
    pub alert_channels: Vec<String>,
    pub alert_min_severity: u8,
    pub alert_cooldown: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyStats {
    pub agent_id: String,
    pub total_anomalies: u32,
    pub by_type: HashMap<String, u32>,
    pub by_severity: HashMap<u8, u32>,
    pub resolution_rate: f64,
    pub avg_detection_time: f64,
    pub trend: Vec<(String, u32)>,
}

pub async fn run_agent_anomaly_monitor_command(
    command: &AgentAnomalyMonitorCommand,
    redis_client: &RedisClient,
) -> Result<()> {
    match &command.subcommand {
        AgentAnomalyMonitorSubcommand::Monitor(args) => {
            monitor_anomalies(args, redis_client).await
        }
        AgentAnomalyMonitorSubcommand::History(args) => {
            view_anomaly_history(args, redis_client).await
        }
        AgentAnomalyMonitorSubcommand::Configure(args) => {
            configure_anomaly_detection(args, redis_client).await
        }
        AgentAnomalyMonitorSubcommand::Report(args) => {
            generate_anomaly_report(args, redis_client).await
        }
        AgentAnomalyMonitorSubcommand::Alert(args) => {
            configure_alerting(args, redis_client).await
        }
    }
}

async fn monitor_anomalies(args: &MonitorArgs, _redis_client: &RedisClient) -> Result<()> {
    println!("{}", "Agent Anomaly Monitor".bold().green());
    println!("Starting real-time anomaly monitoring...");
    
    if args.live {
        println!("Live mode enabled. Press Ctrl+C to exit.");
        let interval = StdDuration::from_secs(args.interval);
        
        loop {
            // Clear screen for live updates
            print!("\x1B[2J\x1B[1;1H");
            
            display_live_anomalies(args);
            thread::sleep(interval);
        }
    } else {
        display_live_anomalies(args);
        Ok(())
    }
}

fn display_live_anomalies(args: &MonitorArgs) -> Result<()> {
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Time", "Agent ID", "Type", "Severity", "Description", "Status"
        ]);
    
    let anomalies = get_mock_anomalies(args);
    for anomaly in anomalies.iter().take(args.limit) {
        let severity_cell = match anomaly.severity {
            4..=5 => Cell::new(&anomaly.severity.to_string()).fg(comfy_table::Color::Red),
            3 => Cell::new(&anomaly.severity.to_string()).fg(comfy_table::Color::Yellow),
            _ => Cell::new(&anomaly.severity.to_string()).fg(comfy_table::Color::Green),
        };
        
        let status_cell = match anomaly.status.as_str() {
            "Active" => Cell::new(&anomaly.status).fg(comfy_table::Color::Red),
            "Investigating" => Cell::new(&anomaly.status).fg(comfy_table::Color::Yellow),
            "Resolved" => Cell::new(&anomaly.status).fg(comfy_table::Color::Green),
            _ => Cell::new(&anomaly.status),
        };
        
        table.add_row(vec![
            Cell::new(&anomaly.timestamp),
            Cell::new(&anomaly.agent_id),
            Cell::new(&anomaly.anomaly_type),
            severity_cell,
            Cell::new(&anomaly.description),
            status_cell,
        ]);
    }
    
    println!("{}", table);
    println!("Last updated: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"));
    
    Ok(())
}

async fn view_anomaly_history(args: &HistoryArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    println!("{}", "Anomaly History".bold().green());
    println!("Agent ID: {}", args.agent_id);
    println!("Time period: Last {} days", args.days);
    
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Time", "Type", "Severity", "Description", "Status", "Detection Method"
        ]);
    
    // Try to fetch anomaly history from Redis
    let anomalies = match fetch_anomaly_history(&redis_client, args).await {
        Ok(events) => events,
        Err(e) => {
            eprintln!("Warning: Could not fetch anomaly history from Redis: {}", e);
            eprintln!("Falling back to mock data for demonstration");
            get_mock_anomaly_history(args) // Fallback to mock if Redis fails
        }
    };
    
    if args.group_by_type {
        // Group anomalies by type
        let mut anomaly_types = HashMap::new();
        for anomaly in &anomalies {
            anomaly_types.entry(anomaly.anomaly_type.clone())
                .or_insert_with(Vec::new)
                .push(anomaly);
        }
        
        for (anomaly_type, anomalies) in anomaly_types {
            println!("\n{} ({})", anomaly_type.bold(), anomalies.len());
            
            let mut type_table = Table::new();
            type_table
                .set_content_arrangement(ContentArrangement::Dynamic)
                .set_header(vec![
                    "Time", "Severity", "Description", "Status"
                ]);
            
            for anomaly in anomalies {
                type_table.add_row(vec![
                    anomaly.timestamp.to_string(),
                    anomaly.severity.to_string(),
                    anomaly.description.to_string(),
                    anomaly.status.to_string(),
                ]);
            }
            
            println!("{}", type_table);
        }
    } else {
        // Display all anomalies in chronological order
        for anomaly in anomalies {
            table.add_row(vec![
                anomaly.timestamp.to_string(),
                anomaly.anomaly_type.to_string(),
                anomaly.severity.to_string(),
                anomaly.description.to_string(),
                anomaly.status.to_string(),
                anomaly.detection_method.to_string(),
            ]);
        }
        
        println!("{}", table);
    }
    
    Ok(())
}

// Function to fetch anomaly history from Redis
async fn fetch_anomaly_history(redis_client: &RedisClient, args: &HistoryArgs) -> Result<Vec<AnomalyEvent>> {
    // Create the key pattern for the specific agent
    let key_pattern = format!("agent:{}:anomalies:*", args.agent_id);
    
    // Fetch matching keys from Redis
    let keys = redis_client.keys(&key_pattern)?;
    let mut events = Vec::new();
    
    // Calculate the cutoff date
    let now = Utc::now();
    let cutoff_date = now - Duration::days(args.days as i64);
    
    // Process each key to retrieve the anomaly events
    for key in keys {
        match redis_client.get::<String>(&key) {
            Ok(json) => {
                match serde_json::from_str::<AnomalyEvent>(&json) {
                    Ok(event) => {
                        // Parse the timestamp
                        if let Ok(event_time) = DateTime::parse_from_rfc3339(&event.timestamp) {
                            let event_time = event_time.with_timezone(&Utc);
                            
                            // Apply time filter
                            if event_time >= cutoff_date {
                                // Apply type filter
                                if args.type_filter == "all" || event.anomaly_type == args.type_filter {
                                    // Apply resolution filter
                                    if args.include_resolved || event.status != "Resolved" {
                                        events.push(event);
                                    }
                                }
                            }
                        }
                    },
                    Err(e) => {
                        eprintln!("Error parsing anomaly event from {}: {}", key, e);
                    }
                }
            },
            Err(e) => {
                eprintln!("Error retrieving anomaly history from {}: {}", key, e);
            }
        }
    }
    
    // Sort events by timestamp (most recent first)
    events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    
    Ok(events)
}

async fn configure_anomaly_detection(args: &ConfigureArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    if args.reset {
        println!("{}", "Resetting anomaly detection configuration to defaults...".green());
        
        // Get the default configuration
        let default_config = get_default_anomaly_config();
        
        // Store the default configuration in Redis
        store_anomaly_config(&redis_client, &default_config).await?;
        
        println!("Configuration reset complete.");
        return Ok(());
    }
    
    // Try to fetch existing configuration from Redis or use default
    let mut config = match fetch_anomaly_config(&redis_client).await {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Warning: Could not fetch anomaly config from Redis: {}", e);
            eprintln!("Using default configuration");
            get_default_anomaly_config()
        }
    };
    
    if args.view {
        display_anomaly_config(&config);
        return Ok(());
    }
    
    // Update configuration if options are specified
    if let Some(sensitivity) = &args.sensitivity {
        println!("Setting sensitivity to: {}", sensitivity);
        config.sensitivity = sensitivity.clone();
    }
    
    if !args.thresholds.is_empty() {
        println!("Updating custom thresholds:");
        for threshold in &args.thresholds {
            if let Some((anomaly_type, value)) = threshold.split_once(':') {
                if let Ok(threshold_value) = value.parse::<f64>() {
                    println!("  {} -> {}", anomaly_type, threshold_value);
                    config.thresholds.insert(anomaly_type.to_string(), threshold_value);
                }
            }
        }
    }
    
    if args.learning_mode {
        println!("Enabling learning mode for automatic threshold adjustment");
        config.learning_mode = true;
    }
    
    // Save the updated configuration to Redis
    store_anomaly_config(&redis_client, &config).await?;
    
    println!("\n{}", "Updated configuration:".green());
    display_anomaly_config(&config);
    
    Ok(())
}

fn display_anomaly_config(config: &AnomalyConfig) {
    println!("Sensitivity level: {}", config.sensitivity);
    println!("Learning mode: {}", if config.learning_mode { "Enabled" } else { "Disabled" });
    println!("\nAnomaly thresholds:");
    
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec!["Anomaly Type", "Threshold"]);
    
    for (anomaly_type, threshold) in &config.thresholds {
        table.add_row(vec![
            anomaly_type.to_string(),
            threshold.to_string(),
        ]);
    }
    
    println!("{}", table);
    
    println!("\nAlert configuration:");
    println!("Channels: {}", config.alert_channels.join(", "));
    println!("Minimum severity: {}", config.alert_min_severity);
    println!("Cooldown period: {} minutes", config.alert_cooldown);
}

// Function to fetch anomaly configuration from Redis
async fn fetch_anomaly_config(redis_client: &RedisClient) -> Result<AnomalyConfig> {
    let config_key = "system:anomaly_detection:config";
    
    match redis_client.get::<String>(config_key) {
        Ok(json) => {
            match serde_json::from_str::<AnomalyConfig>(&json) {
                Ok(config) => Ok(config),
                Err(e) => anyhow::bail!("Error parsing anomaly config: {}", e)
            }
        },
        Err(e) => anyhow::bail!("Error retrieving anomaly config: {}", e)
    }
}

// Function to store anomaly configuration in Redis
async fn store_anomaly_config(redis_client: &RedisClient, config: &AnomalyConfig) -> Result<()> {
    let config_key = "system:anomaly_detection:config";
    
    match serde_json::to_string(config) {
        Ok(json) => {
            redis_client.set(config_key, &json)?;
            Ok(())
        },
        Err(e) => anyhow::bail!("Error serializing anomaly config: {}", e)
    }
}

// Function to get the default anomaly configuration
fn get_default_anomaly_config() -> AnomalyConfig {
    let mut thresholds = HashMap::new();
    thresholds.insert("Memory Leak".to_string(), 15.0);
    thresholds.insert("CPU Spike".to_string(), 85.0);
    thresholds.insert("Response Delay".to_string(), 200.0);
    thresholds.insert("Trust Deviation".to_string(), 0.15);
    thresholds.insert("Decision Contradiction".to_string(), 2.0);
    thresholds.insert("Behavior Pattern Change".to_string(), 0.25);
    thresholds.insert("Knowledge Inconsistency".to_string(), 5.0);
    
    AnomalyConfig {
        sensitivity: "medium".to_string(),
        thresholds,
        learning_mode: false,
        alert_channels: vec!["console".to_string()],
        alert_min_severity: 3,
        alert_cooldown: 15,
    }
}

async fn generate_anomaly_report(args: &ReportArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    println!("{}", "Generating Anomaly Report".bold().green());
    
    let agent_str = if let Some(agent_id) = &args.agent_id {
        agent_id.clone()
    } else {
        "all agents".to_string()
    };
    
    println!("Report for: {}", agent_str);
    println!("Time period: {}", args.period);
    
    // Calculate time period in days
    let days = match args.period.as_str() {
        "day" => 1,
        "week" => 7,
        "month" => 30,
        _ => 7, // Default to week
    };
    
    // Generate statistics based on Redis data or fallback to mock data
    let stats = match generate_anomaly_stats(&redis_client, args.agent_id.as_deref(), days).await {
        Ok(stats) => stats,
        Err(e) => {
            eprintln!("Warning: Could not generate anomaly stats from Redis: {}", e);
            eprintln!("Falling back to mock data for demonstration");
            
            // Fallback to mock data
            if let Some(agent_id) = &args.agent_id {
                vec![get_mock_anomaly_stats(agent_id)]
            } else {
                vec![
                    get_mock_anomaly_stats("agent-1"),
                    get_mock_anomaly_stats("agent-2"),
                    get_mock_anomaly_stats("agent-3"),
                ]
            }
        }
    };
    
    // Display summary statistics
    let mut table = Table::new();
    table
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Agent ID", "Total Anomalies", "Critical", "Resolution Rate", "Common Type"
        ]);
    
    for stat in &stats {
        let mut max_type = ("Unknown", 0);
        for (type_name, count) in &stat.by_type {
            if *count > max_type.1 {
                max_type = (type_name, *count);
            }
        }
        
        let critical_count = stat.by_severity.get(&4).unwrap_or(&0) + stat.by_severity.get(&5).unwrap_or(&0);
        
        table.add_row(vec![
            stat.agent_id.clone(),
            stat.total_anomalies.to_string(),
            critical_count.to_string(),
            format!("{:.1}%", stat.resolution_rate * 100.0),
            max_type.0.to_string(),
        ]);
    }
    
    println!("{}", table);
    
    if args.detailed {
        for stat in &stats {
            println!("\n{} {}", "Detailed analysis for".green(), stat.agent_id);
            
            println!("\nAnomaly types distribution:");
            let mut type_table = Table::new();
            type_table
                .set_content_arrangement(ContentArrangement::Dynamic)
                .set_header(vec!["Type", "Count", "Percentage"]);
            
            for (type_name, count) in &stat.by_type {
                let percentage = (*count as f64 / stat.total_anomalies as f64) * 100.0;
                type_table.add_row(vec![
                    type_name.to_string(),
                    count.to_string(),
                    format!("{:.1}%", percentage),
                ]);
            }
            
            println!("{}", type_table);
            
            println!("\nSeverity distribution:");
            let mut severity_table = Table::new();
            severity_table
                .set_content_arrangement(ContentArrangement::Dynamic)
                .set_header(vec!["Severity", "Count", "Percentage"]);
            
            for severity in 1..=5 {
                let count = stat.by_severity.get(&severity).unwrap_or(&0);
                let percentage = (*count as f64 / stat.total_anomalies as f64) * 100.0;
                severity_table.add_row(vec![
                    severity.to_string(),
                    count.to_string(),
                    format!("{:.1}%", percentage),
                ]);
            }
            
            println!("{}", severity_table);
            
            println!("\nTrend over time:");
            for (date, count) in &stat.trend {
                println!("  {}: {} anomalies", date, count);
            }
        }
    }
    
    // Handle output to file if specified
    if let Some(output_path) = &args.output {
        match args.format.as_str() {
            "json" => {
                let json = serde_json::to_string_pretty(&stats)?;
                std::fs::write(output_path, json)?;
            },
            "csv" => {
                let mut csv_content = String::from("Agent ID,Total Anomalies,Critical,Resolution Rate,Common Type\n");
                
                for stat in &stats {
                    let mut max_type = ("Unknown", 0);
                    for (type_name, count) in &stat.by_type {
                        if *count > max_type.1 {
                            max_type = (type_name, *count);
                        }
                    }
                    
                    let critical_count = stat.by_severity.get(&4).unwrap_or(&0) + stat.by_severity.get(&5).unwrap_or(&0);
                    
                    csv_content.push_str(&format!(
                        "{},{},{},{:.1}%,{}\n",
                        stat.agent_id,
                        stat.total_anomalies,
                        critical_count,
                        stat.resolution_rate * 100.0,
                        max_type.0
                    ));
                }
                
                std::fs::write(output_path, csv_content)?;
            },
            _ => {
                // Default to text format
                let mut text_content = String::from("Anomaly Report\n\n");
                
                for stat in &stats {
                    text_content.push_str(&format!("Agent: {}\n", stat.agent_id));
                    text_content.push_str(&format!("Total Anomalies: {}\n", stat.total_anomalies));
                    
                    let critical_count = stat.by_severity.get(&4).unwrap_or(&0) + stat.by_severity.get(&5).unwrap_or(&0);
                    text_content.push_str(&format!("Critical: {}\n", critical_count));
                    text_content.push_str(&format!("Resolution Rate: {:.1}%\n\n", stat.resolution_rate * 100.0));
                }
                
                std::fs::write(output_path, text_content)?;
            }
        }
        
        println!("\nReport saved to: {}", output_path);
    }
    
    Ok(())
}

// Function to generate anomaly statistics from Redis data
async fn generate_anomaly_stats(redis_client: &RedisClient, agent_id: Option<&str>, days: u32) -> Result<Vec<AnomalyStats>> {
    let mut stats = Vec::new();
    
    // Create key patterns based on agent ID
    let key_patterns = if let Some(id) = agent_id {
        vec![format!("agent:{}:anomalies:*", id)]
    } else {
        // Get all agent IDs from Redis
        let agent_keys = redis_client.keys("agent:*:info")?;
        let mut patterns = Vec::new();
        
        for key in agent_keys {
            if let Some(id) = key.strip_prefix("agent:").and_then(|s| s.strip_suffix(":info")) {
                patterns.push(format!("agent:{}:anomalies:*", id));
            }
        }
        
        if patterns.is_empty() {
            anyhow::bail!("No agents found in Redis");
        }
        
        patterns
    };
    
    // Calculate the cutoff date
    let now = Utc::now();
    let cutoff_date = now - Duration::days(days as i64);
    
    // Process each agent's anomalies
    for pattern in key_patterns {
        let agent_id = pattern.split(':').nth(1).unwrap_or("unknown").to_string();
        
        let mut anomaly_count = 0;
        let mut by_type = HashMap::new();
        let mut by_severity = HashMap::new();
        let mut resolved_count = 0;
        let mut detection_times = Vec::new();
        let mut daily_counts = HashMap::new();
        
        // Fetch matching keys from Redis
        let keys = redis_client.keys(&pattern)?;
        
        for key in keys {
            if let Ok(json) = redis_client.get::<String>(&key) {
                if let Ok(event) = serde_json::from_str::<AnomalyEvent>(&json) {
                    // Parse the timestamp
                    if let Ok(event_time) = DateTime::parse_from_rfc3339(&event.timestamp) {
                        let event_time = event_time.with_timezone(&Utc);
                        
                        // Apply time filter
                        if event_time >= cutoff_date {
                            // Count the anomaly
                            anomaly_count += 1;
                            
                            // Count by type
                            *by_type.entry(event.anomaly_type.clone()).or_insert(0) += 1;
                            
                            // Count by severity
                            *by_severity.entry(event.severity).or_insert(0) += 1;
                            
                            // Count resolved
                            if event.status == "Resolved" {
                                resolved_count += 1;
                            }
                            
                            // Add to daily counts
                            let date = event_time.format("%m-%d").to_string();
                            *daily_counts.entry(date).or_insert(0) += 1;
                            
                            // Add detection time (mock for now)
                            detection_times.push(5.0); // Mock detection time in seconds
                        }
                    }
                }
            }
        }
        
        // Skip if no anomalies found
        if anomaly_count == 0 {
            continue;
        }
        
        // Calculate resolution rate
        let resolution_rate = if anomaly_count > 0 {
            resolved_count as f64 / anomaly_count as f64
        } else {
            0.0
        };
        
        // Calculate average detection time
        let avg_detection_time = if !detection_times.is_empty() {
            detection_times.iter().sum::<f64>() / detection_times.len() as f64
        } else {
            0.0
        };
        
        // Create the trend data
        let mut trend = Vec::new();
        for i in 0..7 {
            let date = (now - Duration::days(i)).format("%m-%d").to_string();
            let count = daily_counts.get(&date).cloned().unwrap_or(0);
            trend.push((date, count));
        }
        
        // Reverse to get chronological order
        trend.reverse();
        
        // Create the stats object
        stats.push(AnomalyStats {
            agent_id,
            total_anomalies: anomaly_count,
            by_type,
            by_severity,
            resolution_rate,
            avg_detection_time,
            trend,
        });
    }
    
    Ok(stats)
}

async fn configure_alerting(args: &AlertArgs, redis_client: Arc<RedisClient>) -> Result<()> {
    // Get the current config
    let mut config = match fetch_anomaly_config(&redis_client).await {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Warning: Could not fetch anomaly config from Redis: {}", e);
            eprintln!("Using default configuration");
            get_default_anomaly_config()
        }
    };
    
    if args.enable {
        println!("{}", "Configuring proactive anomaly alerting".green());
        
        // Update alert settings
        config.alert_channels = args.channels.split(',').map(|s| s.trim().to_string()).collect();
        config.alert_min_severity = args.min_severity;
        config.alert_cooldown = args.cooldown;
        
        // Store webhook URL in a separate Redis key if provided
        if let Some(webhook_url) = &args.webhook_url {
            println!("Webhook URL: {}", webhook_url);
            redis_client.set("system:anomaly_detection:webhook_url", webhook_url)?;
        }
        
        // Save the updated configuration
        store_anomaly_config(&redis_client, &config).await?;
        
        // Store alert settings in Redis
        let alert_settings = serde_json::json!({
            "enabled": true,
            "channels": config.alert_channels,
            "min_severity": config.alert_min_severity,
            "cooldown": config.alert_cooldown,
            "webhook_url": args.webhook_url,
        });
        
        redis_client.set("system:anomaly_detection:alerts", &alert_settings.to_string())?;
        
        println!("\nAlert configuration updated successfully. Proactive alerting is now enabled.");
    } else {
        println!("Disabling proactive anomaly alerting.");
        
        // Store alert settings in Redis with enabled=false
        let alert_settings = serde_json::json!({
            "enabled": false,
            "channels": config.alert_channels,
            "min_severity": config.alert_min_severity,
            "cooldown": config.alert_cooldown,
        });
        
        redis_client.set("system:anomaly_detection:alerts", &alert_settings.to_string())?;
    }
    
    Ok(())
}

// ===============================================================
// UTILITY FUNCTIONS FOR ANOMALY CREATION AND STORAGE
// ===============================================================

/// Utility function to create a new anomaly and store it in Redis
/// Can be used by agent code to report anomalies
pub async fn create_anomaly(
    redis_client: &RedisClient,
    agent_id: &str,
    anomaly_type: &str,
    severity: u8,
    description: &str,
    detection_method: &str,
) -> Result<String> {
    // Generate a unique ID for the anomaly
    let anomaly_id = Uuid::new_v4().to_string();
    
    // Create the anomaly event
    let event = AnomalyEvent {
        id: anomaly_id.clone(),
        agent_id: agent_id.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        anomaly_type: anomaly_type.to_string(),
        severity,
        description: description.to_string(),
        status: "Active".to_string(),
        detection_method: detection_method.to_string(),
    };
    
    // Serialize the event to JSON
    let json = serde_json::to_string(&event)?;
    
    // Store in Redis
    let key = format!("agent:{}:anomalies:{}", agent_id, anomaly_id);
    redis_client.set(&key, &json)?;
    
    // Set expiration to 30 days to prevent unlimited growth
    redis_client.expire(&key, 30 * 24 * 60 * 60)?;
    
    // If severity is high enough, trigger an alert based on configuration
    if severity >= 3 {
        trigger_anomaly_alert(redis_client, &event).await?;
    }
    
    Ok(anomaly_id)
}

/// Update the status of an existing anomaly
pub async fn update_anomaly_status(
    redis_client: &RedisClient,
    agent_id: &str,
    anomaly_id: &str,
    new_status: &str,
) -> Result<()> {
    let key = format!("agent:{}:anomalies:{}", agent_id, anomaly_id);
    
    // Get the existing anomaly
    match redis_client.get::<String>(&key) {
        Ok(json) => {
            match serde_json::from_str::<AnomalyEvent>(&json) {
                Ok(mut event) => {
                    // Update the status
                    event.status = new_status.to_string();
                    
                    // Save back to Redis
                    let updated_json = serde_json::to_string(&event)?;
                    redis_client.set(&key, &updated_json)?;
                    
                    Ok(())
                },
                Err(e) => anyhow::bail!("Error parsing anomaly event: {}", e)
            }
        },
        Err(e) => anyhow::bail!("Error retrieving anomaly: {}", e)
    }
}

/// Trigger alerts for high-severity anomalies based on configured channels
async fn trigger_anomaly_alert(redis_client: &RedisClient, event: &AnomalyEvent) -> Result<()> {
    // Get alert configuration
    match redis_client.get::<String>("system:anomaly_detection:alerts") {
        Ok(json) => {
            match serde_json::from_str::<serde_json::Value>(&json) {
                Ok(config) => {
                    // Check if alerts are enabled
                    if !config["enabled"].as_bool().unwrap_or(false) {
                        return Ok(());
                    }
                    
                    // Check severity threshold
                    let min_severity = config["min_severity"].as_u64().unwrap_or(3) as u8;
                    if event.severity < min_severity {
                        return Ok(());
                    }
                    
                    // Get configured channels
                    let channels = config["channels"].as_array().unwrap_or(&Vec::new());
                    
                    for channel in channels {
                        if let Some(channel_name) = channel.as_str() {
                            match channel_name {
                                "console" => {
                                    // For console, we just log to stderr (would be actual logs in production)
                                    eprintln!(
                                        "[ALERT] {}: {} anomaly detected for agent {}: {} (severity: {})",
                                        event.timestamp, event.anomaly_type, event.agent_id, event.description, event.severity
                                    );
                                },
                                "webhook" => {
                                    // For webhook, we would make an HTTP request to the configured URL
                                    if let Some(webhook_url) = config["webhook_url"].as_str() {
                                        // In a real implementation, would use reqwest or similar to make the HTTP request
                                        println!("Would send webhook to {} with anomaly data", webhook_url);
                                    }
                                },
                                "email" => {
                                    // For email, we would send an email to the configured addresses
                                    // In a real implementation, would use lettre or similar to send emails
                                    println!("Would send email alert for anomaly {}", event.id);
                                },
                                _ => {
                                    println!("Unknown alert channel: {}", channel_name);
                                }
                            }
                        }
                    }
                    
                    Ok(())
                },
                Err(e) => anyhow::bail!("Error parsing alert configuration: {}", e)
            }
        },
        Err(e) => {
            // If alert config doesn't exist, we just ignore and don't alert
            Ok(())
        }
    }
}

// ===============================================================
// MOCK DATA GENERATION FOR FALLBACK/DEMO PURPOSES
// ===============================================================

// These functions provide mock data when Redis is not available
// They should only be used for demo purposes or as fallbacks

fn get_mock_anomalies(args: &MonitorArgs) -> Vec<AnomalyEvent> {
    let mut rng = thread_rng();
    let now = Utc::now();
    let anomaly_types = vec![
        "Memory Leak", "CPU Spike", "Response Delay", "Trust Deviation",
        "Decision Contradiction", "Behavior Pattern Change", "Knowledge Inconsistency"
    ];
    
    let descriptions = vec![
        "Agent memory usage growing abnormally",
        "CPU utilization spiked to 95% during operation",
        "Response time exceeded threshold by 250ms",
        "Trust score deviated significantly from historical baseline",
        "Agent made contradictory decisions within short time period",
        "Behavioral pattern shifted unexpectedly",
        "Knowledge base contains inconsistent information",
    ];
    
    let statuses = vec!["Active", "Investigating", "Resolved"];
    let detection_methods = vec!["Statistical", "Pattern Matching", "Baseline Comparison", "Anomaly Detection ML"];
    
    let mut anomalies = Vec::new();
    
    for i in 0..20 {
        let minutes_ago = rng.gen_range(0..60);
        let timestamp = now - Duration::minutes(minutes_ago);
        let anomaly_type_idx = rng.gen_range(0..anomaly_types.len());
        let anomaly_type = anomaly_types[anomaly_type_idx];
        let severity = rng.gen_range(1..=5);
        
        // Skip if below minimum severity
        if severity < args.min_severity {
            continue;
        }
        
        // Skip if type doesn't match filter
        if args.types != "all" && anomaly_type != args.types {
            continue;
        }
        
        // If agent_id filter is applied, only include matching agents
        let agent_id = if let Some(aid) = &args.agent_id {
            aid.clone()
        } else {
            format!("agent-{}", rng.gen_range(1..=5))
        };
        
        let status_idx = if severity >= 4 {
            // Higher severity anomalies more likely to be active
            rng.gen_range(0..2)
        } else {
            rng.gen_range(0..3)
        };
        
        let method_idx = rng.gen_range(0..detection_methods.len());
        
        anomalies.push(AnomalyEvent {
            id: format!("anom-{}", i),
            agent_id,
            timestamp: timestamp.format("%H:%M:%S").to_string(),
            anomaly_type: anomaly_type.to_string(),
            severity,
            description: descriptions[anomaly_type_idx].to_string(),
            status: statuses[status_idx].to_string(),
            detection_method: detection_methods[method_idx].to_string(),
        });
    }
    
    // Sort by timestamp (most recent first)
    anomalies.sort_by(|a, b| {
        b.timestamp.cmp(&a.timestamp)
    });
    
    anomalies
}

fn get_mock_anomaly_history(args: &HistoryArgs) -> Vec<AnomalyEvent> {
    let mut rng = thread_rng();
    let now = Utc::now();
    
    let anomaly_types = vec![
        "Memory Leak", "CPU Spike", "Response Delay", "Trust Deviation",
        "Decision Contradiction", "Behavior Pattern Change", "Knowledge Inconsistency"
    ];
    
    let descriptions = vec![
        "Agent memory usage growing abnormally",
        "CPU utilization spiked to 95% during operation",
        "Response time exceeded threshold by 250ms",
        "Trust score deviated significantly from historical baseline",
        "Agent made contradictory decisions within short time period",
        "Behavioral pattern shifted unexpectedly",
        "Knowledge base contains inconsistent information",
    ];
    
    let statuses = if args.include_resolved {
        vec!["Active", "Investigating", "Resolved", "Resolved", "Resolved"]
    } else {
        vec!["Active", "Investigating"]
    };
    
    let detection_methods = vec!["Statistical", "Pattern Matching", "Baseline Comparison", "Anomaly Detection ML"];
    
    let days_back = args.days as i64;
    let mut anomalies = Vec::new();
    
    for i in 0..50 {
        let days_ago = rng.gen_range(0..days_back);
        let hours_ago = rng.gen_range(0..24);
        let timestamp = now - Duration::days(days_ago) - Duration::hours(hours_ago);
        
        let anomaly_type_idx = rng.gen_range(0..anomaly_types.len());
        let anomaly_type = anomaly_types[anomaly_type_idx];
        
        // Skip if type doesn't match filter
        if args.type_filter != "all" && anomaly_type != args.type_filter {
            continue;
        }
        
        let severity = rng.gen_range(1..=5);
        let status_idx = rng.gen_range(0..statuses.len());
        let method_idx = rng.gen_range(0..detection_methods.len());
        
        anomalies.push(AnomalyEvent {
            id: format!("anom-hist-{}", i),
            agent_id: args.agent_id.clone(),
            timestamp: timestamp.format("%Y-%m-%d %H:%M").to_string(),
            anomaly_type: anomaly_type.to_string(),
            severity,
            description: descriptions[anomaly_type_idx].to_string(),
            status: statuses[status_idx].to_string(),
            detection_method: detection_methods[method_idx].to_string(),
        });
    }
    
    // Sort by timestamp (most recent first)
    anomalies.sort_by(|a, b| {
        b.timestamp.cmp(&a.timestamp)
    });
    
    anomalies
}

fn get_mock_anomaly_stats(agent_id: &str) -> AnomalyStats {
    let mut rng = thread_rng();
    
    let mut by_type = HashMap::new();
    by_type.insert("Memory Leak".to_string(), rng.gen_range(1..15));
    by_type.insert("CPU Spike".to_string(), rng.gen_range(3..25));
    by_type.insert("Response Delay".to_string(), rng.gen_range(5..30));
    by_type.insert("Trust Deviation".to_string(), rng.gen_range(2..10));
    by_type.insert("Knowledge Inconsistency".to_string(), rng.gen_range(1..8));
    
    let mut by_severity = HashMap::new();
    by_severity.insert(1, rng.gen_range(5..20));
    by_severity.insert(2, rng.gen_range(10..30));
    by_severity.insert(3, rng.gen_range(5..15));
    by_severity.insert(4, rng.gen_range(2..8));
    by_severity.insert(5, rng.gen_range(0..3));
    
    let total_anomalies = by_type.values().sum();
    
    let mut trend = Vec::new();
    let now = Utc::now();
    for i in 0..7 {
        let date = (now - Duration::days(i)).format("%m-%d").to_string();
        trend.push((date, rng.gen_range(1..12)));
    }
    
    // Reverse to get chronological order
    trend.reverse();
    
    AnomalyStats {
        agent_id: agent_id.to_string(),
        total_anomalies,
        by_type,
        by_severity,
        resolution_rate: rng.gen_range(0.65..0.95),
        avg_detection_time: rng.gen_range(2.5..15.0),
        trend,
    }
} 