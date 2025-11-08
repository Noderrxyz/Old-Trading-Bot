use anyhow::{Result, anyhow, Context};
use chrono::{DateTime, Utc, Duration};
use colored::Colorize;
use comfy_table::{Table, Cell, Color};
use noderr_core::trust_score_engine::{TrustScoreEngine, TrustScore};
use noderr_core::trust_decay_service::TrustDecayService;
use noderr_core::healing_orchestrator::HealingOrchestrator;
use noderr_core::agent_controller::AgentController;
use noderr_core::trust_monitor::TrustMonitor;
use rand::{Rng, thread_rng};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration as StdDuration;
use tokio::time::sleep;
use clap::Parser;
use std::thread;

use noderr_core::healing_orchestrator::{HealingStatus};
use noderr_core::agent_controller::{AgentStatus};
use noderr_core::trust_monitor::{TrustSnapshot};

use crate::trust_decay_service::{TrustDecayConfig};
use crate::redis_client::RedisClient;
use crate::mock_trust_score_engine::MockTrustScoreEngine;
use crate::mock_healing_orchestrator::MockHealingOrchestrator;
use crate::mock_agent_controller::MockAgentController;
use crate::mock_trust_monitor::MockTrustMonitor;

#[derive(Debug, Parser)]
pub struct SimulateOptions {
    /// Agent ID to simulate
    #[clap(long, default_value = "mean_reversion_001")]
    pub agent_id: String,

    /// Initial trust score (0-100)
    #[clap(long, default_value = "90")]
    pub initial_trust_score: u8,

    /// Error rate to simulate (percentage 0-100)
    #[clap(long, default_value = "25")]
    pub error_rate: u8,

    /// Enable full pipeline execution
    #[clap(long)]
    pub full_pipeline: bool,

    /// Show verbose output
    #[clap(short, long)]
    pub verbose: bool,

    /// Simulation duration in minutes
    #[clap(long, default_value = "10")]
    pub duration: u32,

    /// Time compression factor (1=real-time, higher=faster)
    #[clap(long, default_value = "60")]
    pub time_compression: u32,

    /// Enable self-healing
    #[clap(long)]
    pub enable_healing: bool,
}

/// Configuration for the trust decay simulation
pub struct SimulationConfig {
    /// The agent/strategy ID to target
    pub agent_id: String,
    
    /// Trust score to set (0.0-1.0)
    pub trust_score: f64,
    
    /// PnL stability (-1.0 to 1.0, negative is bad)
    pub pnl_stability: f64,
    
    /// Error rate (0.0-1.0, higher is worse)
    pub error_rate: f64,
    
    /// Overfitting index (0.0-1.0, higher is worse)
    pub overfitting_index: f64,
    
    /// Decay velocity (0.0-1.0, higher is faster decay)
    pub decay_velocity: f64,
    
    /// Whether to run the full healing pipeline
    pub run_healing: bool,
    
    /// Whether to run the canary validation
    pub run_canary: bool,
    
    /// Whether to wait for events to complete (if false, just sets up conditions)
    pub wait_for_completion: bool,
    
    /// Whether to print verbose output
    pub verbose: bool,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            agent_id: "agent:123".to_string(),
            trust_score: 0.42,
            pnl_stability: -0.3,
            error_rate: 0.17,
            overfitting_index: 0.78,
            decay_velocity: 0.25,
            run_healing: true,
            run_canary: true,
            wait_for_completion: true,
            verbose: false,
        }
    }
}

/// Represents an event in the trust decay pipeline
#[derive(Debug, Clone)]
pub struct TrustDecayEvent {
    /// Event name
    pub name: String,
    
    /// Event timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Event description
    pub description: String,
    
    /// Associated metrics
    pub metrics: HashMap<String, f64>,
    
    /// Event status
    pub status: EventStatus,
}

/// Possible event statuses
#[derive(Debug, Clone, PartialEq)]
pub enum EventStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

/// Types of events that can occur during simulation
#[derive(Debug, Clone)]
enum SimulationEvent {
    Error {
        severity: ErrorSeverity,
        message: String,
    },
    Recovery {
        description: String,
        impact: f64, // 0.0 to 1.0
    },
    MetricChange {
        metric: String,
        change: f64, // Can be positive or negative
    },
    StateChange {
        new_state: AgentStatus,
    },
    HealingAttempt {
        success_probability: f64,
    },
}

#[derive(Debug, Clone)]
enum ErrorSeverity {
    Low,
    Medium,
    High,
    Critical,
}

impl ErrorSeverity {
    fn impact(&self) -> f64 {
        match self {
            ErrorSeverity::Low => 0.05,
            ErrorSeverity::Medium => 0.15,
            ErrorSeverity::High => 0.3,
            ErrorSeverity::Critical => 0.6,
        }
    }
    
    fn as_str(&self) -> &str {
        match self {
            ErrorSeverity::Low => "Low",
            ErrorSeverity::Medium => "Medium",
            ErrorSeverity::High => "High",
            ErrorSeverity::Critical => "Critical",
        }
    }
    
    fn colored(&self) -> ColoredString {
        match self {
            ErrorSeverity::Low => self.as_str().yellow(),
            ErrorSeverity::Medium => self.as_str().bright_yellow(),
            ErrorSeverity::High => self.as_str().bright_red(),
            ErrorSeverity::Critical => self.as_str().on_red(),
        }
    }
}

/// Possible error types for simulation
const ERROR_TYPES: &[(&str, ErrorSeverity)] = &[
    ("Connection timeout", ErrorSeverity::Low),
    ("Market data deserialization error", ErrorSeverity::Medium),
    ("Missing required price points", ErrorSeverity::Medium),
    ("Inconsistent position tracking", ErrorSeverity::High),
    ("Invalid signal parameters", ErrorSeverity::Medium),
    ("Processing queue overflow", ErrorSeverity::High),
    ("Signal generation timeout", ErrorSeverity::Medium),
    ("Fatal thread panic", ErrorSeverity::Critical),
    ("Memory allocation error", ErrorSeverity::Critical),
    ("Data consistency violation", ErrorSeverity::High),
];

/// Possible recovery actions
const RECOVERY_ACTIONS: &[(&str, f64)] = &[
    ("Automatic reconnection successful", 0.8),
    ("Fallback data source activated", 0.7),
    ("Error handling retry succeeded", 0.6),
    ("Redundant system takeover", 0.9),
    ("Graceful error recovery", 0.8),
    ("Circuit breaker reset", 0.7),
    ("Cache invalidation and refresh", 0.6),
    ("Service restart completed", 0.9),
    ("Backup restoration successful", 0.8),
    ("Throttling applied", 0.5),
];

/// Run the trust decay simulation
pub async fn run_simulation(opts: SimulateOptions) -> Result<()> {
    // Validate input parameters
    if opts.initial_trust_score > 100 {
        return Err(anyhow!("Initial trust score must be between 0-100"));
    }
    if opts.error_rate > 100 {
        return Err(anyhow!("Error rate must be between 0-100"));
    }

    println!("\n{}\n", "Starting Trust Decay Simulation".bright_green().bold());
    println!("Agent ID: {}", opts.agent_id.bright_blue());
    println!("Initial Trust Score: {}", opts.initial_trust_score.to_string().bright_green());
    println!("Error Rate: {}%", opts.error_rate.to_string().yellow());
    println!("Duration: {} minutes (compressed {}x)", opts.duration, opts.time_compression);
    println!("Self-Healing: {}", if opts.enable_healing { "Enabled".bright_green() } else { "Disabled".red() });
    println!("Full Pipeline: {}", if opts.full_pipeline { "Enabled".bright_green() } else { "Minimal".yellow() });
    println!();

    // Initialize services
    let redis = RedisClient::new("redis://localhost:6379").await?;
    let trust_engine = MockTrustScoreEngine::new(
        opts.agent_id.clone(),
        opts.initial_trust_score as f64,
        redis.clone(),
    );
    
    let mut trust_decay_config = TrustDecayConfig::default();
    trust_decay_config.decay_rate = 1.0; // Set to 1.0 for simulation
    
    let trust_decay_service = TrustDecayService::new(
        redis.clone(),
        trust_decay_config,
    );

    // Initialize mock services for full pipeline simulation
    let agent_controller = MockAgentController::new();
    let healing_orchestrator = MockHealingOrchestrator::new();
    let trust_monitor = MockTrustMonitor::new();

    // Set up simulation parameters
    let sim_start_time = Utc::now();
    let sim_end_time = sim_start_time + Duration::minutes(opts.duration as i64);
    
    // Speed factor for time compression (e.g., 60 = 1 minute becomes 1 second)
    let speed_factor = opts.time_compression as f64;
    
    // Calculate the error interval based on error rate
    // Higher error rate = more frequent errors
    let avg_error_interval_secs = if opts.error_rate > 0 {
        60.0 * (100.0 / opts.error_rate as f64)
    } else {
        f64::MAX // No errors
    };
    
    // Calculate the recovery interval - recovery should be less frequent than errors
    let avg_recovery_interval_secs = avg_error_interval_secs * 2.5;
    
    // Initialize metrics
    let mut current_trust_score = opts.initial_trust_score as f64;
    let mut total_errors = 0;
    let mut recovered_errors = 0;
    let mut healing_attempts = 0;
    let mut successful_healing = 0;
    let mut current_state = AgentStatus::Running;
    let mut last_snapshot = create_initial_snapshot(&opts.agent_id, current_trust_score);
    
    // Store initial trust score
    trust_engine.set_trust_score(current_trust_score).await?;
    
    // Print simulation header
    println!("{:<10} | {:<10} | {:<20} | {:<50}",
        "TIME", "TRUST", "STATUS", "EVENT");
    println!("{}", "-".repeat(100));

    // Main simulation loop
    let mut current_sim_time = sim_start_time;
    let mut rng = rand::thread_rng();
    
    while current_sim_time < sim_end_time {
        // Calculate real wait time based on compression factor
        let wait_time_ms = (1000.0 / speed_factor) as u64;
        thread::sleep(StdDuration::from_millis(wait_time_ms));
        
        // Advance simulation time
        current_sim_time = current_sim_time + Duration::seconds(1);
        
        // Check if we should generate an event
        let should_generate_error = rng.gen_bool(1.0 / avg_error_interval_secs);
        let should_generate_recovery = rng.gen_bool(1.0 / avg_recovery_interval_secs);
        
        // Generate events
        if should_generate_error {
            let error_event = generate_error_event(&mut rng);
            apply_event(
                &error_event, 
                &mut current_trust_score, 
                &mut current_state, 
                &trust_engine, 
                &healing_orchestrator,
                &agent_controller,
                &current_sim_time,
                opts.verbose,
            ).await?;
            total_errors += 1;
        }
        
        if should_generate_recovery {
            let recovery_event = generate_recovery_event(&mut rng);
            apply_event(
                &recovery_event, 
                &mut current_trust_score, 
                &mut current_state, 
                &trust_engine, 
                &healing_orchestrator,
                &agent_controller,
                &current_sim_time,
                opts.verbose,
            ).await?;
            recovered_errors += 1;
        }
        
        // Check if we need to initiate self-healing
        if opts.enable_healing && current_trust_score < 50.0 && !healing_is_active(&healing_orchestrator).await {
            let healing_event = SimulationEvent::HealingAttempt {
                success_probability: 0.7,
            };
            
            apply_event(
                &healing_event, 
                &mut current_trust_score, 
                &mut current_state, 
                &trust_engine, 
                &healing_orchestrator,
                &agent_controller,
                &current_sim_time,
                opts.verbose,
            ).await?;
            healing_attempts += 1;
        }
        
        // Apply natural decay
        current_trust_score = apply_natural_decay(current_trust_score, 0.01);
        trust_engine.set_trust_score(current_trust_score).await?;
        
        // Every 30 simulation seconds, capture a snapshot
        if current_sim_time.timestamp() % 30 == 0 {
            last_snapshot = create_snapshot(&opts.agent_id, current_trust_score, total_errors, recovered_errors);
        }
        
        // Check if healing completed
        if let Some(status) = get_healing_status_if_active(&healing_orchestrator).await {
            match status {
                HealingStatus::Succeeded { started_at: _, completed_at: _ } => {
                    println!("{:<10} | {:<10.1} | {:<20} | {}",
                        format_time(&current_sim_time),
                        current_trust_score,
                        format!("{:?}", current_state),
                        "Healing process completed successfully".bright_green()
                    );
                    
                    // Apply healing boost
                    current_trust_score += 25.0;
                    if current_trust_score > 100.0 {
                        current_trust_score = 100.0;
                    }
                    trust_engine.set_trust_score(current_trust_score).await?;
                    successful_healing += 1;
                    
                    // Restore agent to running state
                    current_state = AgentStatus::Running;
                    agent_controller.set_agent_status(&opts.agent_id, current_state.clone()).await?;
                },
                HealingStatus::Failed { started_at: _, completed_at: _, reason } => {
                    println!("{:<10} | {:<10.1} | {:<20} | {}",
                        format_time(&current_sim_time),
                        current_trust_score,
                        format!("{:?}", current_state),
                        format!("Healing process failed: {}", reason).red()
                    );
                },
                _ => {}
            }
        }
    }

    // Simulation complete - display summary
    println!("\n{}\n", "Simulation Complete".bright_green().bold());
    println!("Duration: {} minutes (compressed {}x)", opts.duration, opts.time_compression);
    println!("Initial Trust Score: {}", opts.initial_trust_score.to_string().bright_blue());
    println!("Final Trust Score: {}", format!("{:.1}", current_trust_score).bright_blue());
    println!("Total Errors: {}", total_errors.to_string().red());
    println!("Recovered Errors: {}", recovered_errors.to_string().green());
    println!("Healing Attempts: {}", healing_attempts.to_string().yellow());
    println!("Successful Healing: {}", successful_healing.to_string().green());
    println!("Final Agent Status: {:?}", current_state);
    
    // Store final results in Redis for visualization
    store_simulation_results(
        &redis,
        &opts.agent_id,
        current_trust_score,
        total_errors,
        recovered_errors,
        healing_attempts,
        successful_healing,
    ).await?;
    
    println!("\nResults stored in Redis for visualization.");
    
    Ok(())
}

/// Generate a random error event
fn generate_error_event(rng: &mut impl Rng) -> SimulationEvent {
    let (error_msg, severity) = ERROR_TYPES.choose(rng).unwrap();
    
    SimulationEvent::Error {
        severity: severity.clone(),
        message: error_msg.to_string(),
    }
}

/// Generate a random recovery event
fn generate_recovery_event(rng: &mut impl Rng) -> SimulationEvent {
    let (recovery_msg, impact) = RECOVERY_ACTIONS.choose(rng).unwrap();
    
    SimulationEvent::Recovery {
        description: recovery_msg.to_string(),
        impact: *impact,
    }
}

/// Apply an event to the simulation state
async fn apply_event(
    event: &SimulationEvent,
    trust_score: &mut f64,
    agent_status: &mut AgentStatus,
    trust_engine: &MockTrustScoreEngine,
    healing_orchestrator: &MockHealingOrchestrator,
    agent_controller: &MockAgentController,
    current_time: &chrono::DateTime<Utc>,
    verbose: bool,
) -> Result<()> {
    match event {
        SimulationEvent::Error { severity, message } => {
            // Apply impact to trust score
            let impact = severity.impact();
            *trust_score -= impact * 100.0;
            if *trust_score < 0.0 {
                *trust_score = 0.0;
            }
            
            // Update trust score in engine
            trust_engine.set_trust_score(*trust_score).await?;
            
            // Update agent status if critical error
            if matches!(severity, ErrorSeverity::Critical) {
                *agent_status = AgentStatus::Error;
                agent_controller.set_agent_status(&trust_engine.agent_id, agent_status.clone()).await?;
            }
            
            // Print event
            println!("{:<10} | {:<10.1} | {:<20} | {} Error: {}",
                format_time(current_time),
                *trust_score,
                format!("{:?}", agent_status),
                severity.colored(),
                message
            );
        },
        SimulationEvent::Recovery { description, impact } => {
            // Apply recovery impact
            *trust_score += impact * 20.0; // Recovery has less impact than errors
            if *trust_score > 100.0 {
                *trust_score = 100.0;
            }
            
            // Update trust score in engine
            trust_engine.set_trust_score(*trust_score).await?;
            
            // Print event
            if verbose || *impact > 0.7 {
                println!("{:<10} | {:<10.1} | {:<20} | {} {}",
                    format_time(current_time),
                    *trust_score,
                    format!("{:?}", agent_status),
                    "🔄".green(),
                    description.green()
                );
            }
        },
        SimulationEvent::StateChange { new_state } => {
            *agent_status = new_state.clone();
            agent_controller.set_agent_status(&trust_engine.agent_id, agent_status.clone()).await?;
            
            // Print event
            println!("{:<10} | {:<10.1} | {:<20} | {} State changed to {:?}",
                format_time(current_time),
                *trust_score,
                format!("{:?}", agent_status),
                "🔄",
                new_state
            );
        },
        SimulationEvent::HealingAttempt { success_probability } => {
            // Start healing process
            healing_orchestrator.start_healing(&trust_engine.agent_id).await?;
            
            // Determine if it will eventually succeed (but don't complete immediately)
            let will_succeed = rand::thread_rng().gen_bool(*success_probability);
            healing_orchestrator.set_eventual_success(will_succeed).await?;
            
            // Set agent to paused during healing
            *agent_status = AgentStatus::Paused;
            agent_controller.set_agent_status(&trust_engine.agent_id, agent_status.clone()).await?;
            
            // Print event
            println!("{:<10} | {:<10.1} | {:<20} | {}",
                format_time(current_time),
                *trust_score,
                format!("{:?}", agent_status),
                "🔧 Initiating self-healing process".bright_blue()
            );
        },
        SimulationEvent::MetricChange { metric, change } => {
            if verbose {
                println!("{:<10} | {:<10.1} | {:<20} | Metric {} changed by {:.2}",
                    format_time(current_time),
                    *trust_score,
                    format!("{:?}", agent_status),
                    metric,
                    change
                );
            }
        }
    }
    
    Ok(())
}

/// Apply natural decay to trust score
fn apply_natural_decay(trust_score: f64, decay_rate: f64) -> f64 {
    let new_score = trust_score - decay_rate;
    if new_score < 0.0 {
        0.0
    } else {
        new_score
    }
}

/// Check if healing is currently active
async fn healing_is_active(healing_orchestrator: &MockHealingOrchestrator) -> bool {
    healing_orchestrator.is_healing_active().await.unwrap_or(false)
}

/// Get healing status if active
async fn get_healing_status_if_active(healing_orchestrator: &MockHealingOrchestrator) -> Option<HealingStatus> {
    if healing_orchestrator.is_healing_active().await.unwrap_or(false) {
        Some(healing_orchestrator.get_healing_status().await.unwrap_or(HealingStatus::NotActive))
    } else {
        None
    }
}

/// Format time for display
fn format_time(time: &chrono::DateTime<Utc>) -> String {
    time.format("%H:%M:%S").to_string()
}

/// Create an initial snapshot
fn create_initial_snapshot(agent_id: &str, trust_score: f64) -> TrustSnapshot {
    TrustSnapshot {
        agent_id: agent_id.to_string(),
        timestamp: Utc::now().timestamp(),
        trust_score,
        error_rate: 0.0,
        pnl_stability: 1.0,
        signal_entropy: 0.5,
        metrics: HashMap::new(),
    }
}

/// Create a snapshot with current metrics
fn create_snapshot(agent_id: &str, trust_score: f64, total_errors: usize, recovered_errors: usize) -> TrustSnapshot {
    let mut metrics = HashMap::new();
    let error_rate = if total_errors > 0 {
        (total_errors - recovered_errors) as f64 / total_errors as f64
    } else {
        0.0
    };
    
    metrics.insert("total_errors".to_string(), total_errors as f64);
    metrics.insert("recovered_errors".to_string(), recovered_errors as f64);
    
    TrustSnapshot {
        agent_id: agent_id.to_string(),
        timestamp: Utc::now().timestamp(),
        trust_score,
        error_rate,
        pnl_stability: (trust_score / 100.0).powf(0.5), // simplified relation
        signal_entropy: 0.5 + (0.5 - trust_score / 200.0), // simplified relation
        metrics,
    }
}

/// Store simulation results in Redis
async fn store_simulation_results(
    redis: &RedisClient,
    agent_id: &str,
    final_trust_score: f64,
    total_errors: usize,
    recovered_errors: usize,
    healing_attempts: usize,
    successful_healing: usize,
) -> Result<()> {
    let key_prefix = format!("simulation:{}:{}", agent_id, Utc::now().timestamp());
    
    // Store final metrics
    redis.hset(&format!("{}:metrics", key_prefix), "final_trust_score", final_trust_score.to_string()).await?;
    redis.hset(&format!("{}:metrics", key_prefix), "total_errors", total_errors.to_string()).await?;
    redis.hset(&format!("{}:metrics", key_prefix), "recovered_errors", recovered_errors.to_string()).await?;
    redis.hset(&format!("{}:metrics", key_prefix), "healing_attempts", healing_attempts.to_string()).await?;
    redis.hset(&format!("{}:metrics", key_prefix), "successful_healing", successful_healing.to_string()).await?;
    
    // Set expiry for cleanup (keep for 24 hours)
    redis.expire(&format!("{}:metrics", key_prefix), 86400).await?;
    
    Ok(())
} 