use noderr_core::trust_score_engine::TrustScoreEngine;
use anyhow::{Result, Context};
use std::sync::Arc;
use chrono::{DateTime, Duration, Utc};

/// Chart config for customizing the chart display
pub struct ChartConfig {
    pub width: usize,
    pub height: usize,
    pub show_points: bool,
    pub show_recovery: bool,
}

impl Default for ChartConfig {
    fn default() -> Self {
        Self {
            width: 60,
            height: 15,
            show_points: true,
            show_recovery: true,
        }
    }
}

/// Generate an ASCII chart of trust score decay
pub async fn run_trust_chart(
    engine: Arc<dyn TrustScoreEngine>,
    strategy_id: &str,
    days: u32,
    config: ChartConfig,
) -> Result<()> {
    // Get trust score history
    let history = engine.get_trust_score_history(strategy_id, Some(days as usize)).await?;
    let snapshots = &history.snapshots;
    
    if snapshots.is_empty() {
        println!("No history data available for strategy: {}", strategy_id);
        return Ok(());
    }
    
    // Get max and min values
    let mut max_score = 0.0;
    let mut min_score = 1.0;
    
    for snapshot in snapshots {
        max_score = max_score.max(snapshot.score);
        min_score = min_score.min(snapshot.score);
    }
    
    // Adjust range to make chart more readable
    let padding = (max_score - min_score) * 0.1;
    let max_y = (max_score + padding).min(1.0);
    let min_y = (min_score - padding).max(0.0);
    
    // Calculate start and end dates
    let start_date = snapshots.first().unwrap().timestamp;
    let end_date = snapshots.last().unwrap().timestamp;
    let total_duration = end_date.signed_duration_since(start_date);
    
    println!("Trust Score Decay Chart for '{}' (last {} days)", strategy_id, days);
    println!("Period: {} to {}", 
        start_date.format("%Y-%m-%d"),
        end_date.format("%Y-%m-%d"));
    println!("Score range: {:.4} - {:.4}", min_score, max_score);
    println!();
    
    // Generate chart
    generate_ascii_chart(snapshots, min_y, max_y, &config);
    
    // Show legend
    println!("\nLegend:");
    println!("  ▲ - Trust score increase");
    println!("  ▼ - Trust score decrease");
    println!("  * - Recovery event");
    
    // Calculation of trend
    if snapshots.len() >= 2 {
        let first_score = snapshots.first().unwrap().score;
        let last_score = snapshots.last().unwrap().score;
        let score_change = last_score - first_score;
        let percent_change = (score_change / first_score) * 100.0;
        
        println!("\nSummary:");
        println!("  Starting trust score: {:.4}", first_score);
        println!("  Current trust score: {:.4}", last_score);
        println!("  Overall change: {:.2}% ({})", 
            percent_change.abs(),
            if score_change >= 0.0 { "increase" } else { "decrease" });
        
        // Project future decay if trend continues
        if score_change < 0.0 {
            let avg_daily_decay = score_change.abs() / days as f64;
            
            // Estimate days until critical levels
            if let Ok(config) = engine.get_config().await {
                let warning_threshold = config.weights.warning_threshold;
                let critical_threshold = config.weights.critical_threshold;
                
                if last_score > warning_threshold {
                    let days_to_warning = (last_score - warning_threshold) / avg_daily_decay;
                    println!("  Est. days to warning level ({:.2}): {:.0}", 
                        warning_threshold, days_to_warning);
                }
                
                if last_score > critical_threshold {
                    let days_to_critical = (last_score - critical_threshold) / avg_daily_decay;
                    println!("  Est. days to critical level ({:.2}): {:.0}", 
                        critical_threshold, days_to_critical);
                }
            }
        }
    }
    
    Ok(())
}

/// Generate a simple ASCII chart from trust score snapshots
fn generate_ascii_chart(
    snapshots: &[noderr_core::trust_score_engine::TrustScoreSnapshot],
    min_y: f64,
    max_y: f64,
    config: &ChartConfig,
) {
    let width = config.width;
    let height = config.height;
    
    // Calculate step sizes
    let y_range = max_y - min_y;
    
    // Skip drawing if we don't have enough data or range
    if snapshots.len() < 2 || y_range < 0.001 {
        println!("Insufficient data for chart visualization");
        return;
    }
    
    // Prepare the chart canvas
    let mut chart = vec![vec![' '; width]; height];
    
    // Initialize chart with axes
    for y in 0..height {
        chart[y][0] = '|';
    }
    for x in 0..width {
        chart[height-1][x] = '-';
    }
    chart[height-1][0] = '+';
    
    // Add y-axis labels
    let y_labels = [max_y, min_y + y_range * 0.75, min_y + y_range * 0.5, min_y + y_range * 0.25, min_y];
    for (i, &label) in y_labels.iter().enumerate() {
        let y_pos = (i * (height - 1) / (y_labels.len() - 1)).min(height - 1);
        let label_str = format!("{:.2}", label);
        for (j, c) in label_str.chars().enumerate() {
            if j < 5 {
                chart[y_pos][if j == 0 { 0 } else { j + 1 }] = c;
            }
        }
    }
    
    // Plot data points
    let mut prev_y_pos = 0;
    let mut prev_score = 0.0;
    
    for (i, snapshot) in snapshots.iter().enumerate() {
        let x_pos = 7 + (i * (width - 8) / snapshots.len().max(1)).min(width - 1);
        let y_pos = height - 1 - ((snapshot.score - min_y) / y_range * (height as f64 - 1.0)) as usize;
        let y_pos = y_pos.min(height - 1);
        
        // Draw the point
        if config.show_points {
            chart[y_pos][x_pos] = if i > 0 && prev_score < snapshot.score {
                '▲' // Upward trend
            } else if i > 0 && prev_score > snapshot.score {
                '▼' // Downward trend
            } else {
                '•' // No change
            };
            
            // Mark recovery events
            if config.show_recovery && 
               i > 0 && 
               snapshot.reason.as_deref().unwrap_or("").contains("recovery") {
                chart[y_pos][x_pos] = '*';
            }
        }
        
        // Draw line to connect points
        if i > 0 {
            let y_start = prev_y_pos.min(y_pos);
            let y_end = prev_y_pos.max(y_pos);
            
            for y in y_start..=y_end {
                if chart[y][x_pos - 1] == ' ' || chart[y][x_pos - 1] == '|' {
                    chart[y][x_pos - 1] = if y == y_pos || y == prev_y_pos { 
                        '+' 
                    } else { 
                        '|' 
                    };
                }
            }
            
            for x in x_pos-1..x_pos {
                if y_start == y_end && chart[y_start][x] == ' ' {
                    chart[y_start][x] = '-';
                }
            }
        }
        
        prev_y_pos = y_pos;
        prev_score = snapshot.score;
    }
    
    // Render the chart
    for row in chart {
        println!("{}", row.iter().collect::<String>());
    }
}

/// Generate a simplified chart suitable for terminal display
pub fn generate_sparkline(values: &[f64], width: usize) -> String {
    if values.is_empty() {
        return String::new();
    }
    
    let spark_chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    
    // Find min and max
    let min_val = *values.iter().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(&0.0);
    let max_val = *values.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(&1.0);
    let range = max_val - min_val;
    
    // Sample data to fit width
    let mut sampled_values = Vec::with_capacity(width);
    let step = values.len() as f64 / width as f64;
    
    for i in 0..width {
        let pos = (i as f64 * step) as usize;
        if pos < values.len() {
            sampled_values.push(values[pos]);
        }
    }
    
    // Generate sparkline
    let mut result = String::with_capacity(width);
    for &val in &sampled_values {
        if range < 0.001 {
            result.push(spark_chars[3]); // Middle character if range is too small
        } else {
            let normalized = (val - min_val) / range;
            let char_idx = (normalized * (spark_chars.len() - 1) as f64).round() as usize;
            result.push(spark_chars[char_idx.min(spark_chars.len() - 1)]);
        }
    }
    
    result
}

use terminal_size::{Width, Height, terminal_size};

#[cfg(test)]
mod tests {
    use super::*;
    use noderr_core::trust_score_engine::{TrustScoreSnapshot, TrustScoreHistory};
    use std::io::{self, Write};

    // Helper to create test snapshots with different patterns
    fn create_test_snapshots(pattern: &str, count: usize) -> Vec<noderr_core::trust_score_engine::TrustScoreSnapshot> {
        let mut snapshots = Vec::with_capacity(count);
        let base_time = Utc::now() - Duration::days(count as i64);
        
        for i in 0..count {
            let score = match pattern {
                "increasing" => 0.5 + (i as f64 * 0.01),
                "decreasing" => 0.9 - (i as f64 * 0.01),
                "stable" => 0.75,
                "oscillating" => 0.75 + (0.1 * ((i as f64 * std::f64::consts::PI / 5.0).sin())),
                "recovery" => {
                    if i < count / 2 {
                        0.9 - (i as f64 * 0.02)
                    } else {
                        0.5 + ((i - count / 2) as f64 * 0.03)
                    }
                },
                _ => 0.5 + (i as f64 * 0.01), // default to increasing
            };
            
            let reason = if pattern == "recovery" && i == count / 2 {
                Some("Applied recovery boost".to_string())
            } else {
                None
            };
            
            snapshots.push(TrustScoreSnapshot {
                timestamp: base_time + Duration::days(i as i64),
                score: score.max(0.0).min(1.0),
                reason,
            });
        }
        
        snapshots
    }
    
    #[test]
    fn test_sparkline_generation() {
        // Test with increasing values
        let values = (1..21).map(|i| i as f64 / 20.0).collect::<Vec<_>>();
        let sparkline = generate_sparkline(&values, 10);
        
        // Should have 10 characters
        assert_eq!(sparkline.len(), 10);
        
        // First character should be lowest, last should be highest
        assert_eq!(sparkline.chars().next().unwrap(), '▁');
        assert_eq!(sparkline.chars().last().unwrap(), '█');
        
        // Test with constant values
        let values = vec![0.5; 20];
        let sparkline = generate_sparkline(&values, 10);
        
        // All characters should be the same
        let first_char = sparkline.chars().next().unwrap();
        assert!(sparkline.chars().all(|c| c == first_char));
        
        // Test with empty values
        let values: Vec<f64> = vec![];
        let sparkline = generate_sparkline(&values, 10);
        assert_eq!(sparkline, "");
    }
    
    #[test]
    fn test_chart_data_handling() {
        // Test with different patterns
        let patterns = ["increasing", "decreasing", "stable", "oscillating", "recovery"];
        
        for pattern in patterns {
            let snapshots = create_test_snapshots(pattern, 30);
            
            // Verify min/max calculation
            let mut min_score = 1.0;
            let mut max_score = 0.0;
            
            for snapshot in &snapshots {
                min_score = min_score.min(snapshot.score);
                max_score = max_score.max(snapshot.score);
            }
            
            assert!(min_score < max_score || pattern == "stable", 
                    "Min should be less than max for non-stable patterns");
            
            // For recovery pattern, check for presence of reason
            if pattern == "recovery" {
                let recovery_snapshots: Vec<_> = snapshots.iter()
                    .filter(|s| s.reason.is_some())
                    .collect();
                
                assert!(!recovery_snapshots.is_empty(), 
                        "Recovery pattern should have at least one recovery reason");
            }
            
            // Test generating chart (captures any panics)
            let config = ChartConfig {
                width: 40,
                height: 10,
                show_points: true,
                show_recovery: true,
            };
            
            // Redirecting stdout to avoid cluttering test output
            let stdout = io::stdout();
            let mut handle = stdout.lock();
            
            generate_ascii_chart(&snapshots, min_score, max_score, &config);
        }
    }
    
    #[test]
    fn test_chart_edge_cases() {
        // Test with single point
        let single_snapshot = vec![
            TrustScoreSnapshot {
                timestamp: Utc::now(),
                score: 0.5,
                reason: None,
            }
        ];
        
        // Should not panic but return early
        generate_ascii_chart(&single_snapshot, 0.0, 1.0, &ChartConfig::default());
        
        // Test with identical values
        let identical_snapshots = vec![
            TrustScoreSnapshot {
                timestamp: Utc::now() - Duration::days(1),
                score: 0.5,
                reason: None,
            },
            TrustScoreSnapshot {
                timestamp: Utc::now(),
                score: 0.5,
                reason: None,
            }
        ];
        
        // Should handle zero range
        generate_ascii_chart(&identical_snapshots, 0.45, 0.55, &ChartConfig::default());
    }
} 