use anyhow::Result;
use noderr_core::redis::RedisClient;
use noderr_cli::commands::agent_anomaly_monitor::{create_anomaly, update_anomaly_status};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use rand::{Rng, thread_rng};

/// This example demonstrates how to generate and store real anomalies in Redis
/// for testing and demonstrating the agent_anomaly_monitor command
async fn main() -> Result<()> {
    println!("Generating sample anomalies for Redis...");
    
    // Initialize Redis client
    let redis_client = Arc::new(RedisClient::new());
    
    // Define sample agents, anomaly types and detection methods
    let agents = vec!["agent-1", "agent-2", "agent-3"];
    
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
    
    let detection_methods = vec![
        "Statistical", "Pattern Matching", "Baseline Comparison", "Anomaly Detection ML"
    ];
    
    // Generate a set of anomalies
    let mut rng = thread_rng();
    let anomaly_count = 30;
    
    println!("Generating {} anomalies across {} agents...", anomaly_count, agents.len());
    
    let mut anomaly_ids = Vec::new();
    
    for i in 0..anomaly_count {
        // Select random attributes
        let agent_idx = rng.gen_range(0..agents.len());
        let agent_id = agents[agent_idx];
        
        let anomaly_type_idx = rng.gen_range(0..anomaly_types.len());
        let anomaly_type = anomaly_types[anomaly_type_idx];
        let description = descriptions[anomaly_type_idx];
        
        let method_idx = rng.gen_range(0..detection_methods.len());
        let method = detection_methods[method_idx];
        
        let severity = rng.gen_range(1..=5);
        
        // Create the anomaly
        let anomaly_id = create_anomaly(
            &redis_client,
            agent_id,
            anomaly_type,
            severity,
            description,
            method
        ).await?;
        
        println!("Created anomaly {} for agent {} (severity: {})", anomaly_id, agent_id, severity);
        
        // Store some anomaly IDs for later status updates
        if i % 3 == 0 {
            anomaly_ids.push((agent_id.to_string(), anomaly_id));
        }
        
        // Add a small delay to spread out timestamps
        thread::sleep(Duration::from_millis(100));
    }
    
    // Update some anomalies to "Investigating" or "Resolved" status
    println!("\nUpdating status of some anomalies...");
    
    for (i, (agent_id, anomaly_id)) in anomaly_ids.iter().enumerate() {
        let new_status = if i % 2 == 0 { "Investigating" } else { "Resolved" };
        
        update_anomaly_status(&redis_client, agent_id, anomaly_id, new_status).await?;
        
        println!("Updated anomaly {} to status: {}", anomaly_id, new_status);
        
        // Add a small delay between updates
        thread::sleep(Duration::from_millis(100));
    }
    
    println!("\nAnomaly generation complete!");
    println!("You can now use the agent_anomaly_monitor commands to view and manage these anomalies.");
    println!("Try running:");
    println!("  cargo run -- agent-anomaly-monitor monitor");
    println!("  cargo run -- agent-anomaly-monitor history --agent-id agent-1");
    println!("  cargo run -- agent-anomaly-monitor report --detailed");
    
    Ok(())
} 