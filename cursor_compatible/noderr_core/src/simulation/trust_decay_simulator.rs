use chrono::{DateTime, Duration, Utc};
use rand::Rng;

/// Simulation parameters for trust decay
pub struct DecaySimulationParams {
    /// Strategy ID for which the decay is simulated
    pub strategy_id: String,
    /// Initial trust score value to start simulation
    pub initial_score: f64,
    /// Daily decay factor (multiplier applied to score each day)
    pub decay_factor_per_day: f64,
    /// Random noise range [-jitter, +jitter] added to each day's score
    pub jitter: f64,
    /// Number of days to simulate
    pub days: usize,
}

/// Simulated trust score entry with timestamp and score value
pub struct SimulatedTrustScore {
    /// Timestamp of the simulated trust score entry
    pub timestamp: DateTime<Utc>,
    /// Trust score value at this point in time
    pub score: f64,
}

/// Runs a trust score decay simulation over time
///
/// # Arguments
/// * `params` - Simulation parameters including strategy ID, initial score, decay factor, jitter, and days
///
/// # Returns
/// Vector of simulated trust score entries with timestamps
///
/// # Example
/// ```
/// use noderr_core::simulation::trust_decay_simulator::{DecaySimulationParams, simulate_trust_score_decay};
///
/// let params = DecaySimulationParams {
///     strategy_id: "test-strategy".to_string(),
///     initial_score: 0.9,
///     decay_factor_per_day: 0.98,
///     jitter: 0.02,
///     days: 30,
/// };
/// 
/// let results = simulate_trust_score_decay(params);
/// ```
pub fn simulate_trust_score_decay(params: DecaySimulationParams) -> Vec<SimulatedTrustScore> {
    let mut rng = rand::thread_rng();
    let mut result = Vec::with_capacity(params.days);
    
    // Start from current time
    let start_time = Utc::now();
    let mut current_score = params.initial_score;
    
    // Validate and clamp the initial score
    current_score = current_score.max(0.0).min(1.0);
    
    // Generate entries for each day
    for day in 0..params.days {
        // Calculate timestamp for this entry
        let timestamp = start_time + Duration::days(day as i64);
        
        // Apply decay factor for each day
        current_score *= params.decay_factor_per_day;
        
        // Add random jitter to simulate real-world variations
        if params.jitter > 0.0 {
            let noise = rng.gen_range(-params.jitter..=params.jitter);
            current_score += noise;
        }
        
        // Ensure score remains within valid range [0.0, 1.0]
        current_score = current_score.max(0.0).min(1.0);
        
        // Add entry to result
        result.push(SimulatedTrustScore {
            timestamp,
            score: current_score,
        });
    }
    
    result
}

/// Applies recovery events to a decay simulation
/// 
/// This function takes a vector of simulated trust scores and applies
/// recovery events at specified days, simulating things like:
/// - Strategy improvements
/// - Manual trust score adjustments
/// - Successful executions that boost trust
///
/// # Arguments
/// * `scores` - Vector of simulated trust scores to modify
/// * `recovery_events` - Vector of (day_index, boost_amount) tuples
///
/// # Returns
/// Updated vector of simulated trust scores
pub fn apply_recovery_events(
    mut scores: Vec<SimulatedTrustScore>,
    recovery_events: Vec<(usize, f64)>,
) -> Vec<SimulatedTrustScore> {
    for (day_index, boost_amount) in recovery_events {
        if day_index < scores.len() {
            // Apply boost to the specified day
            scores[day_index].score += boost_amount;
            scores[day_index].score = scores[day_index].score.min(1.0);
            
            // Propagate the boosted score to subsequent days
            if day_index + 1 < scores.len() {
                let boosted_score = scores[day_index].score;
                let mut current_score = boosted_score;
                
                for i in (day_index + 1)..scores.len() {
                    // Recalculate subsequent days based on the decay factor
                    // We can approximate the decay factor from the simulation
                    let prev_score_without_boost = if i > 0 && i - 1 != day_index {
                        scores[i - 1].score
                    } else {
                        current_score
                    };
                    
                    current_score = prev_score_without_boost * 
                        (scores[i].score / prev_score_without_boost).max(0.8);
                    
                    scores[i].score = current_score.max(0.0).min(1.0);
                }
            }
        }
    }
    
    scores
}

// Unit tests for the trust score decay simulator
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_trust_score_decay_simulation() {
        let params = DecaySimulationParams {
            strategy_id: "test-strategy".to_string(),
            initial_score: 0.9,
            decay_factor_per_day: 0.95,
            jitter: 0.02,
            days: 30,
        };

        let results = simulate_trust_score_decay(params);
        
        // Print results for visual inspection
        for entry in &results {
            println!("{} => {:.4}", entry.timestamp.format("%Y-%m-%d"), entry.score);
        }

        // Verify simulation results
        assert_eq!(results.len(), 30, "Simulation should produce exactly 30 days of data");
        assert!(results[0].score <= 1.0, "Initial score should be <= 1.0");
        assert!(results[0].score >= 0.0, "Initial score should be >= 0.0");
        
        // Verify general decay trend (last score should be less than first score)
        assert!(results.last().unwrap().score < results.first().unwrap().score, 
                "Trust score should decay over time");
                
        // Verify all scores are within valid range
        for entry in &results {
            assert!(entry.score >= 0.0 && entry.score <= 1.0, 
                    "All trust scores should be within [0.0, 1.0] range");
        }
    }
    
    #[test]
    fn test_recovery_events() {
        let params = DecaySimulationParams {
            strategy_id: "test-strategy".to_string(),
            initial_score: 0.8,
            decay_factor_per_day: 0.95,
            jitter: 0.01,
            days: 30,
        };
        
        let decay_results = simulate_trust_score_decay(params);
        
        // Apply recovery events at days 10 and 20
        let recovery_events = vec![(10, 0.2), (20, 0.15)];
        let recovery_results = apply_recovery_events(decay_results.clone(), recovery_events);
        
        // Print both results for comparison
        println!("DAY | DECAY | RECOVERY | DIFF");
        println!("---------------------------");
        for i in 0..decay_results.len() {
            println!("{:02} | {:.4} | {:.4} | {:.4}", 
                i, 
                decay_results[i].score, 
                recovery_results[i].score,
                recovery_results[i].score - decay_results[i].score
            );
        }
        
        // Verify recovery effects
        assert!(recovery_results[10].score > decay_results[10].score, 
                "Day 10 should show a recovery boost");
        assert!(recovery_results[20].score > decay_results[20].score, 
                "Day 20 should show a recovery boost");
        
        // The day after a recovery should still be higher than the original decay
        assert!(recovery_results[11].score > decay_results[11].score, 
                "Recovery effect should persist to following days");
        assert!(recovery_results[21].score > decay_results[21].score, 
                "Recovery effect should persist to following days");
    }
    
    // This is a future enhancement we're not implementing now, but keeping as a comment
    // to guide future development
    /*
    #[test]
    fn test_export_to_json() {
        let params = DecaySimulationParams {
            strategy_id: "test-strategy".to_string(),
            initial_score: 0.9,
            decay_factor_per_day: 0.95,
            jitter: 0.02,
            days: 30,
        };

        let results = simulate_trust_score_decay(params);
        
        // Future enhancement: Export results to JSON for visualization tools
        // let json = export_to_json(&results);
        // assert!(!json.is_empty());
    }
    */
} 