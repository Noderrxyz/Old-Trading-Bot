use anyhow::{Result, Context};
use chrono::{DateTime, Utc};
use noderr_core::simulation::trust_decay_simulator::{
    DecaySimulationParams, SimulatedTrustScore, simulate_trust_score_decay, apply_recovery_events
};
use comfy_table::{Table, Cell, Color};
use std::str::FromStr;

/// Run a trust score decay simulation and display the results
pub async fn run_trust_decay(
    strategy_id: &str,
    initial_score: f64,
    decay_factor: f64,
    jitter: f64,
    days: usize,
    recovery_points: Option<Vec<(usize, f64)>>,
) -> Result<()> {
    // Create simulation parameters
    let params = DecaySimulationParams {
        strategy_id: strategy_id.to_string(),
        initial_score,
        decay_factor_per_day: decay_factor,
        jitter,
        days,
    };
    
    // Run the simulation
    let mut results = simulate_trust_score_decay(params);
    
    // Apply recovery events if specified
    if let Some(recovery_events) = recovery_points {
        let baseline = results.clone();
        results = apply_recovery_events(results, recovery_events.clone());
        
        // Print recovery points
        let mut recovery_table = Table::new();
        recovery_table.set_header(vec!["Day", "Amount", "Before", "After", "Impact"]);
        
        for (day, amount) in recovery_events {
            if day < baseline.len() {
                recovery_table.add_row(vec![
                    day.to_string(),
                    format!("{:.2}", amount),
                    format!("{:.4}", baseline[day].score),
                    format!("{:.4}", results[day].score),
                    format!("+{:.4}", results[day].score - baseline[day].score),
                ]);
            }
        }
        
        println!("Recovery Events:");
        println!("{recovery_table}");
        println!();
    }
    
    // Create a table for displaying the results
    let mut table = Table::new();
    table.set_header(vec!["Day", "Date", "Trust Score"]);
    
    // Determine how many rows to display based on the number of days
    let display_interval = if days <= 30 {
        1 // Show every day for shorter simulations
    } else if days <= 90 {
        3 // Show every 3 days for medium simulations
    } else {
        7 // Show weekly for long simulations
    };
    
    // Collect data points for charting
    let mut chart_data = Vec::new();
    
    // Add rows to the table
    for (i, entry) in results.iter().enumerate() {
        // Add each point to the chart data
        chart_data.push(entry.score);
        
        // Only show selected days in the table
        if i == 0 || i == results.len() - 1 || i % display_interval == 0 {
            let color = get_color_for_score(entry.score);
            
            table.add_row(vec![
                Cell::new(i.to_string()),
                Cell::new(entry.timestamp.format("%Y-%m-%d").to_string()),
                Cell::new(format!("{:.4}", entry.score)).fg(color),
            ]);
        }
    }
    
    // Display the results
    println!("Trust Score Decay Simulation");
    println!("----------------------------");
    println!("Strategy: {}", strategy_id);
    println!("Initial Score: {:.2}", initial_score);
    println!("Decay Factor: {:.4} per day", decay_factor);
    println!("Jitter: ±{:.2}", jitter);
    println!("Days: {}", days);
    println!();
    
    // Display the table
    println!("{table}");
    
    // Generate and display an ASCII chart
    println!("\nTrust Score Decay Chart:");
    let chart = generate_ascii_chart(&chart_data, 60, 15);
    println!("{chart}");
    
    // Print summary statistics
    let min_score = results.iter().map(|r| r.score).fold(f64::INFINITY, f64::min);
    let max_score = results.iter().map(|r| r.score).fold(f64::NEG_INFINITY, f64::max);
    let final_score = results.last().unwrap().score;
    
    println!("\nSummary Statistics:");
    println!("Starting Score: {:.4}", initial_score);
    println!("Final Score: {:.4}", final_score);
    println!("Min Score: {:.4}", min_score);
    println!("Max Score: {:.4}", max_score);
    println!("Total Decay: {:.2}%", (initial_score - final_score) / initial_score * 100.0);
    
    Ok(())
}

/// Parse a recovery point string in the format "day:amount"
pub fn parse_recovery_point(s: &str) -> Result<(usize, f64)> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        anyhow::bail!("Recovery point must be in format 'day:amount', got '{}'", s);
    }
    
    let day = parts[0].parse::<usize>()
        .context("Failed to parse day as a number")?;
    
    let amount = parts[1].parse::<f64>()
        .context("Failed to parse amount as a number")?;
    
    Ok((day, amount))
}

/// Get a color based on the trust score value
fn get_color_for_score(score: f64) -> Color {
    if score < 0.3 {
        Color::Red
    } else if score < 0.5 {
        Color::Yellow
    } else if score < 0.7 {
        Color::Green
    } else {
        Color::Cyan
    }
}

/// Generate a simple ASCII chart from the data
fn generate_ascii_chart(data: &[f64], width: usize, height: usize) -> String {
    if data.is_empty() {
        return "No data to display".to_string();
    }
    
    // Find min and max values to scale the chart
    let min_value = data.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let max_value = data.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    
    // Ensure we have a non-zero range to avoid division by zero
    let value_range = if (max_value - min_value).abs() < f64::EPSILON {
        1.0
    } else {
        max_value - min_value
    };
    
    let mut chart = String::new();
    
    // Generate rows from top to bottom
    for row in 0..height {
        let row_value = max_value - (row as f64 / height as f64) * value_range;
        
        // Row label (only show some rows to avoid clutter)
        if row == 0 || row == height - 1 || row == height / 2 {
            chart.push_str(&format!("{:5.2} │", row_value));
        } else {
            chart.push_str("      │");
        }
        
        // Determine step size based on available width
        let step = (data.len() as f64 / width as f64).max(1.0) as usize;
        
        // Generate data points across the row
        for i in (0..data.len()).step_by(step.max(1)) {
            let next_row_value = max_value - ((row + 1) as f64 / height as f64) * value_range;
            
            if data[i] <= row_value && data[i] > next_row_value {
                // Choose character based on score value
                if data[i] < 0.3 {
                    chart.push('▓'); // Low trust
                } else if data[i] < 0.5 {
                    chart.push('▒'); // Medium trust
                } else {
                    chart.push('░'); // High trust
                }
            } else {
                chart.push(' ');
            }
        }
        
        chart.push('\n');
    }
    
    // X-axis
    chart.push_str("      └");
    chart.push_str(&"─".repeat(width.min(data.len())));
    chart.push('\n');
    
    // X-axis labels
    chart.push_str("        ");
    
    // Show labels at regular intervals
    let label_count = 5.min(data.len());
    let label_interval = data.len() / label_count;
    
    for i in 0..label_count {
        let idx = i * label_interval;
        chart.push_str(&format!("{:<8}", idx));
    }
    
    chart.push_str(&format!("{:<8}", data.len() - 1)); // Last data point
    
    chart
} 