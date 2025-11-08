use chrono::{Duration, Utc};
use noderr_core::simulation::trust_decay_simulator::{
    DecaySimulationParams, SimulatedTrustScore, simulate_trust_score_decay, apply_recovery_events
};

#[tokio::test]
async fn test_various_decay_factors() {
    // Test with different decay factors
    let decay_factors = vec![0.99, 0.95, 0.90, 0.85];
    let days = 30;
    
    for decay_factor in decay_factors {
        let params = DecaySimulationParams {
            strategy_id: format!("test-strategy-{}", decay_factor),
            initial_score: 0.9,
            decay_factor_per_day: decay_factor,
            jitter: 0.0, // No jitter for deterministic tests
            days,
        };
        
        let results = simulate_trust_score_decay(params);
        
        // Verify simulation length
        assert_eq!(results.len(), days);
        
        // Calculate theoretical final score without jitter
        let theoretical_final_score = 0.9 * decay_factor.powi(days as i32 - 1);
        
        // Since there's no jitter, the actual result should exactly match the theoretical calculation
        assert!((results.last().unwrap().score - theoretical_final_score).abs() < 0.000001,
                "Final score should match theoretical calculation");
                
        // Print results
        println!("Decay Factor: {:.2}", decay_factor);
        println!("Theoretical final score: {:.6}", theoretical_final_score);
        println!("Actual final score: {:.6}", results.last().unwrap().score);
        println!("---");
    }
}

#[tokio::test]
async fn test_jitter_effects() {
    // Run multiple simulations with the same parameters but different jitter
    let jitter_values = vec![0.0, 0.01, 0.05, 0.1];
    let iterations = 10;
    let days = 30;
    
    for jitter in jitter_values {
        let mut final_scores = Vec::new();
        
        for _ in 0..iterations {
            let params = DecaySimulationParams {
                strategy_id: "test-strategy".to_string(),
                initial_score: 0.9,
                decay_factor_per_day: 0.95,
                jitter,
                days,
            };
            
            let results = simulate_trust_score_decay(params);
            final_scores.push(results.last().unwrap().score);
        }
        
        // Calculate statistics
        let avg = final_scores.iter().sum::<f64>() / final_scores.len() as f64;
        let min = final_scores.iter().fold(f64::INFINITY, |a, &b| a.min(b));
        let max = final_scores.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
        let range = max - min;
        
        println!("Jitter: {:.2}, Range: {:.6}, Avg: {:.6}, Min: {:.6}, Max: {:.6}", 
                 jitter, range, avg, min, max);
                 
        // Higher jitter should lead to more variation
        if jitter > 0.0 {
            assert!(range > 0.0, "With jitter, there should be variation in results");
            
            // The range should roughly correlate with jitter
            if jitter >= 0.05 {
                assert!(range >= 0.05, "Higher jitter should produce larger variations");
            }
        } else {
            // With zero jitter, all runs should give identical results
            assert!(range < 0.000001, "With zero jitter, all runs should be identical");
        }
    }
}

#[tokio::test]
async fn test_recovery_events_simulation() {
    let params = DecaySimulationParams {
        strategy_id: "recovery-test".to_string(),
        initial_score: 0.8,
        decay_factor_per_day: 0.95,
        jitter: 0.0, // Disable jitter for predictable results
        days: 40,
    };
    
    let baseline_results = simulate_trust_score_decay(params.clone());
    
    // Create three different recovery scenarios
    let scenarios = vec![
        (
            "Single large recovery",
            vec![(15, 0.3)],
        ),
        (
            "Multiple small recoveries",
            vec![(10, 0.1), (20, 0.1), (30, 0.1)],
        ),
        (
            "Early vs late recovery",
            vec![(5, 0.2), (35, 0.2)],
        ),
    ];
    
    for (scenario_name, recovery_events) in scenarios {
        let with_recovery = apply_recovery_events(baseline_results.clone(), recovery_events.clone());
        
        println!("Scenario: {}", scenario_name);
        println!("Day | Baseline | With Recovery | Diff");
        println!("------------------------------------");
        
        for i in 0..params.days {
            // Print selected days to reduce output volume
            if i % 5 == 0 || recovery_events.iter().any(|&(day, _)| day == i) {
                println!("{:3} | {:8.4} | {:13.4} | {:+6.4}", 
                    i, 
                    baseline_results[i].score, 
                    with_recovery[i].score,
                    with_recovery[i].score - baseline_results[i].score
                );
            }
        }
        println!();
        
        // Assert that recovery events had the expected effect
        for &(day, amount) in &recovery_events {
            // On the recovery day, score should be higher
            assert!(with_recovery[day].score > baseline_results[day].score,
                    "Recovery should increase score on day {}", day);
                
            // The impact should be close to the recovery amount
            let impact = with_recovery[day].score - baseline_results[day].score;
            assert!((impact - amount).abs() < 0.000001, 
                    "Recovery impact should match the defined amount");
                
            // The effect should persist to the next day (but diminished)
            if day + 1 < params.days {
                assert!(with_recovery[day + 1].score > baseline_results[day + 1].score,
                        "Recovery effect should persist to following days");
            }
        }
    }
}

#[tokio::test]
async fn test_edge_cases() {
    // Edge case: Very low initial score
    {
        let params = DecaySimulationParams {
            strategy_id: "edge-case-low".to_string(),
            initial_score: 0.05,
            decay_factor_per_day: 0.9,
            jitter: 0.01,
            days: 10,
        };
        
        let results = simulate_trust_score_decay(params);
        
        // Verify that scores don't go negative
        for entry in &results {
            assert!(entry.score >= 0.0, "Score should never be negative");
            assert!(entry.score <= 1.0, "Score should never exceed 1.0");
        }
    }
    
    // Edge case: Very high initial score with negative jitter
    {
        let params = DecaySimulationParams {
            strategy_id: "edge-case-high".to_string(),
            initial_score: 0.99,
            decay_factor_per_day: 0.99,
            jitter: 0.1, // High jitter to test clamping
            days: 10,
        };
        
        let results = simulate_trust_score_decay(params);
        
        // Verify that scores don't exceed 1.0
        for entry in &results {
            assert!(entry.score >= 0.0, "Score should never be negative");
            assert!(entry.score <= 1.0, "Score should never exceed 1.0");
        }
    }
    
    // Edge case: Zero days
    {
        let params = DecaySimulationParams {
            strategy_id: "edge-case-zero-days".to_string(),
            initial_score: 0.8,
            decay_factor_per_day: 0.95,
            jitter: 0.02,
            days: 0,
        };
        
        let results = simulate_trust_score_decay(params);
        assert_eq!(results.len(), 0, "Zero days should result in empty output");
    }
    
    // Edge case: Very high decay factor (barely any decay)
    {
        let params = DecaySimulationParams {
            strategy_id: "edge-case-high-decay".to_string(),
            initial_score: 0.8,
            decay_factor_per_day: 0.999,
            jitter: 0.0,
            days: 30,
        };
        
        let results = simulate_trust_score_decay(params);
        let final_score = results.last().unwrap().score;
        
        // Score should still show some decay, but minimal
        assert!(final_score < 0.8, "Score should decay at least slightly");
        assert!(final_score > 0.75, "Score should not decay much with high decay factor");
    }
    
    // Edge case: Very low decay factor (rapid decay)
    {
        let params = DecaySimulationParams {
            strategy_id: "edge-case-low-decay".to_string(),
            initial_score: 0.8,
            decay_factor_per_day: 0.5,
            jitter: 0.0,
            days: 10,
        };
        
        let results = simulate_trust_score_decay(params);
        
        // Score should decay rapidly
        assert!(results.last().unwrap().score < 0.1, 
                "Score should decay rapidly with low decay factor");
    }
} 