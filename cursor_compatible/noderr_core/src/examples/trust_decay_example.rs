use chrono::Utc;
use noderr_core::simulation::trust_decay_simulator::{
    DecaySimulationParams, SimulatedTrustScore, simulate_trust_score_decay, apply_recovery_events
};

/// Example demonstrating the trust score decay simulator
pub async fn run_trust_decay_simulation_example() {
    println!("=== Trust Score Decay Simulation Example ===");
    
    // Create simulation parameters
    let params = DecaySimulationParams {
        strategy_id: "example-strategy".to_string(),
        initial_score: 0.85,        // Start with a high trust score
        decay_factor_per_day: 0.97, // Gentle decay (97% of previous day's score)
        jitter: 0.02,               // Add some randomness
        days: 60,                   // Simulate for 60 days
    };
    
    // Run the basic simulation
    let decay_results = simulate_trust_score_decay(params);
    
    // Display the first 5 days and then every 10 days after that
    println!("\nBasic decay simulation (60 days):");
    println!("{:<10} | {:<10}", "Day", "Trust Score");
    println!("-----------------------");
    
    for (i, entry) in decay_results.iter().enumerate() {
        if i < 5 || i % 10 == 0 {
            println!("{:<10} | {:.4}", 
                entry.timestamp.format("%Y-%m-%d"), 
                entry.score
            );
        }
    }
    
    // Now simulate recovery events (e.g., strategy improvements, successful trades)
    let recovery_events = vec![
        (15, 0.15),  // On day 15, boost trust by 0.15
        (30, 0.20),  // On day 30, boost trust by 0.20
        (45, 0.10),  // On day 45, boost trust by 0.10
    ];
    
    let recovery_results = apply_recovery_events(decay_results.clone(), recovery_events);
    
    // Compare the results with and without recovery events
    println!("\nComparison with recovery events:");
    println!("{:<10} | {:<10} | {:<10} | {:<10}", "Day", "Basic", "With Recovery", "Difference");
    println!("---------------------------------------------------");
    
    for i in 0..decay_results.len() {
        // Show days around recovery events and some regular intervals
        if i < 5 || i % 10 == 0 || (i >= 14 && i <= 16) || 
           (i >= 29 && i <= 31) || (i >= 44 && i <= 46) {
            println!("{:<10} | {:.4} | {:.4} | {:+.4}", 
                decay_results[i].timestamp.format("%Y-%m-%d"),
                decay_results[i].score,
                recovery_results[i].score,
                recovery_results[i].score - decay_results[i].score
            );
        }
    }
    
    println!("\nNote: The simulation shows how trust scores decay over time and how");
    println!("recovery events (like improvements to strategy or successful trades)");
    println!("can boost the trust score and slow down the decay process.");
    println!("\nReal-world applications:");
    println!("- Determine optimal strategy maintenance intervals");
    println!("- Evaluate long-term trust score sustainability");
    println!("- Plan strategic improvements to maintain trust above threshold");
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_example() {
        // Just make sure the example runs without errors
        run_trust_decay_simulation_example().await;
    }
} 