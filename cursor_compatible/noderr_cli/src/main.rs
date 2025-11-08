mod commands;
mod mock_engine;
mod mock_decay_service;
mod persistence;
mod reason_exporter;
mod reason_chain_executor;
mod agent_snapshot;
mod federation_sync_engine;
mod trust_normalizer;
mod strategy_broadcast_router;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use noderr_core::strategy_storage::StrategyStorage;
use noderr_core::trust_score_engine::TrustScoreEngine;
use noderr_core::trust_decay_service::{TrustDecayService, TrustDecayConfig, StrategyActivityStatus};
use noderr_core::redis::RedisClient;
use std::sync::Arc;
use noderr_core::strategy::Strategy;
use noderr_core::strategy_executor::StrategyExecutor;
use mock_decay_service::init_mock_trust_decay_service;
use chrono::{Utc, Duration};
use colored::Colorize;
use persistence::PersistenceManager;
use std::sync::atomic::{AtomicBool, Ordering};
use federation_sync_engine::FederationSyncEngine;
use trust_normalizer::TrustNormalizer;
use strategy_broadcast_router::StrategyBroadcastRouter;
use ctrlc;

mod mock_trust_score_engine;
mod mock_strategy_storage;

use crate::commands::{
    trust_show::*, trust_history::*, trust_chart::*, trust_decay::*,
    trust_status::*, simulate_trust_decay::*, trust_monitor::*, 
    vote_ledger::VoteLedgerCommand, vote_ledger::run_vote_ledger_command,
    treasury::TreasuryCommand, treasury::run_treasury_command,
    memory::MemoryCommand, memory::run_memory_command,
    mesh_builder::MeshBuilderCommand, mesh_builder::run_mesh_builder_command,
    governance::GovernanceCommand, governance::run_governance_command,
    audit::AuditCommand, audit::run_audit_command,
    constitution::ConstitutionCommand, constitution::run_constitution_command,
    self_correction::{SelfCorrection, SelfCorrectionCommand},
    resilience::ResilienceCommand,
    bio_ethics::BioEthicsCommand,
    bio_signal::BioSignalCommand,
    bio_training::BioTrainingCommand,
    bio_roles::BioRolesCommand,
    bio_simulation::BioSimulationCommand,
    reason_chain::ReasonChainCommand, reason_chain::run_reason_chain_command,
    memory_shards::{MemoryShardsCommand, MemoryShardsSubcommand, run_memory_shards_command},
    agent_snapshot::AgentSnapshotCommand, agent_snapshot::run_agent_snapshot_command,
    agent_anomaly_monitor::{AgentAnomalyMonitorCommand, run_agent_anomaly_monitor_command},
    meta_agents::MetaAgentsCommand,
    federation::FederationCommand,
};

#[derive(clap::Parser)]
#[command(name = "noderr_cli")]
#[command(author, version, about, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    command: Option<CliCommand>,
    
    /// Vote ledger forensic tools for examining governance voting history
    #[command(subcommand)]
    vote_ledger: Option<VoteLedgerCommand>,
    
    /// Treasury management commands for contribution credits
    #[command(subcommand)]
    treasury: Option<TreasuryCommand>,
    
    /// Agent memory and behavioral analysis tools
    #[command(subcommand)]
    memory: Option<MemoryCommand>,
    
    /// Trust-based mesh network builder and management
    #[command(subcommand)]
    mesh_builder: Option<MeshBuilderCommand>,
    
    /// Governance and meta-agent oversight system
    #[command(subcommand)]
    governance: Option<GovernanceCommand>,
    
    /// Immutable audit vault and legal framework system
    #[command(subcommand)]
    audit: Option<AuditCommand>,

    /// Constitution commands
    #[command(subcommand)]
    constitution: Option<ConstitutionCommand>,

    /// Run constitutional self-correction operations
    #[command(subcommand)]
    self_correction: Option<SelfCorrectionCommand>,

    /// Resilience and fault tolerance commands
    #[command(flatten)]
    resilience: Option<ResilienceCommand>,

    /// Bio-ethics shield for agent decision evaluation
    #[command(flatten)]
    bio_ethics: Option<BioEthicsCommand>,
    
    /// Human signal amplification and trust engine
    #[command(flatten)]
    bio_signal: Option<BioSignalCommand>,

    /// Co-training protocols for agent-human learning
    #[command(flatten)]
    bio_training: Option<BioTrainingCommand>,

    /// Role synchronization for human-agent integration
    #[command(flatten)]
    bio_roles: Option<BioRolesCommand>,
    
    /// Agent decision reasoning chain exporter and visualizer
    #[command(flatten)]
    reason_chain: Option<ReasonChainCommand>,

    /// Bio-simulation for agent testing and analysis
    #[command(subcommand)]
    bio_simulation: Option<BioSimulationCommand>,

    /// Memory shards related commands
    #[command(subcommand)]
    memory_shards: Option<MemoryShardsCommand>,
    
    /// Agent snapshot management for rollback and replay
    #[command(subcommand)]
    agent_snapshot: Option<AgentSnapshotCommand>,

    /// Agent anomaly monitoring and detection
    #[command(subcommand)]
    agent_anomaly_monitor: Option<AgentAnomalyMonitorCommand>,

    /// Meta-agent monitoring and oversight tools
    #[command(subcommand)]
    meta_agents: Option<MetaAgentsCommand>,

    /// Federation and cross-cluster collaboration tools
    #[command(subcommand)]
    federation: Option<FederationCommand>,

    /// Run a strategy with the specified ID and configuration
    #[arg(short, long)]
    pub verbose: bool,
}

#[derive(Subcommand, Debug)]
enum CliCommand {
    /// Run a strategy with the specified ID and configuration
    Run {
        strategy_id: String,
        #[arg(short, long)]
        verbose: bool,
    },
    
    /// Display current trust scores for all strategies
    TrustShow,
    
    /// Display trust score history for a specific strategy
    TrustHistory {
        strategy_id: String,
    },
    
    /// Display an ASCII chart of trust score decay trends
    TrustChart {
        strategy_id: String,
        #[arg(short, long, default_value = "30")]
        days: u32,
    },
    
    /// Simulate trust score decay over time
    TrustDecay {
        #[arg(short, long, default_value = "0.9")]
        initial_score: f64,
        #[arg(short, long, default_value = "0.98")]
        decay_factor: f64,
        #[arg(short, long, default_value = "0.0")]
        jitter: f64,
        #[arg(short, long, default_value = "30")]
        days: u32,
        #[arg(short, long)]
        recovery_points: Vec<u32>,
    },
    
    /// Show current trust decay status for all strategies
    TrustStatus,
    
    /// Apply decay to a strategy immediately
    TrustDecayNow {
        strategy_id: String,
        #[arg(short, long)]
        decay_factor: Option<f64>,
    },
    
    /// Configure trust decay settings
    TrustDecayConfig {
        #[arg(long)]
        enable: Option<bool>,
        #[arg(long)]
        default_factor: Option<f64>,
        #[arg(long)]
        interval_seconds: Option<u64>,
        #[arg(long)]
        inactivity_threshold_hours: Option<u64>,
        #[arg(long)]
        custom_factor: Option<(String, f64)>,
    },
    
    /// Simulate trust decay and test the self-healing pipeline
    SimulateTrustDecay {
        /// Agent ID to target
        #[arg(short, long, default_value = "agent:123")]
        agent: String,
        
        /// Trust score to set (0-100)
        #[arg(short, long, default_value = "42")]
        trust_score: f64,
        
        /// Error rate to inject (0-100)
        #[arg(short, long, default_value = "17")]
        error_rate: f64,
        
        /// Run the full healing pipeline including canary validation
        #[arg(short, long)]
        full_pipeline: bool,
        
        /// Print verbose output
        #[arg(short, long)]
        verbose: bool,
    },

    /// Continuously monitor and apply trust decay
    TrustMonitor {
        /// Update interval in seconds
        #[arg(short, long, default_value = "60")]
        interval: u64,
        
        /// Run once and exit instead of continuous monitoring
        #[arg(short, long)]
        once: bool,
    },
    
    /// Treasury management and contribution credits system
    Treasury(TreasuryCommand),
    
    /// Agent memory and behavioral embeddings system
    Memory(MemoryCommand),
    
    /// Trust-based mesh network builder and routing system
    MeshBuilder(MeshBuilderCommand),
    
    /// Governance and meta-agent oversight system
    Governance(GovernanceCommand),
    
    /// Immutable audit vault and legal framework system
    Audit(AuditCommand),
    
    /// AI Constitution and compliance system
    Constitution(ConstitutionCommand),

    /// Manage meta-agent governance
    SelfCorrection(SelfCorrectionCommand),

    /// Memory/logging related commands
    Memory(MemoryCommand),

    /// Vote ledger related commands
    VoteLedger(VoteLedgerCommand),
    
    /// Resilience and fault tolerance commands
    Resilience(ResilienceCommand),
    
    /// Bio-ethics shield for agent decision evaluation
    BioEthics(BioEthicsCommand),
    
    /// Human signal amplification and trust engine
    BioSignal(BioSignalCommand),
    
    /// Co-training protocols for agent-human learning
    BioTraining(BioTrainingCommand),
    
    /// Role synchronization for human-agent integration
    BioRoles(BioRolesCommand),

    /// Memory shards related commands
    MemoryShards(MemoryShardsCommand),
    
    /// Agent decision reasoning chain exporter and visualizer
    ReasonChain(ReasonChainCommand),

    /// Bio-simulation for agent testing and analysis
    BioSimulation(BioSimulationCommand),
    
    /// Agent snapshot management for rollback and replay
    AgentSnapshot(AgentSnapshotCommand),

    /// Agent anomaly monitoring and detection
    AgentAnomalyMonitor(AgentAnomalyMonitorCommand),

    /// Meta-agent monitoring and oversight tools
    MetaAgents(MetaAgentsCommand),

    /// Federation and cross-cluster collaboration tools
    Federation(FederationCommand),
}

#[tokio::main]
async fn main() -> Result<()> {
    // Set up logging
    env_logger::init();
    
    // Parse command line arguments
    let cli = Cli::parse();
    
    // Initialize persistence manager
    let persistence_path = persistence::get_default_persistence_path();
    println!("Using persistence file: {}", persistence_path.display());
    
    let mut persistence = match PersistenceManager::new(&persistence_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Warning: Failed to initialize persistence: {}", e);
            eprintln!("Will continue without persistence");
            PersistenceManager::new("./noderr_temp_state.json")?
        }
    };
    
    // Initialize core services with persisted data
    let engine = init_trust_score_engine(Arc::new(persistence.clone())).await?;
    let storage = init_strategy_storage().await?;
    let decay_service = init_trust_decay_service(engine.clone(), storage.clone(), Arc::new(persistence.clone())).await?;
    
    // Initialize mock Redis client for memory and mesh commands
    let redis_client = Arc::new(RedisClient::new()); // This is a mock implementation
    
    // Initialize federation-related components
    let federation_sync_engine = Arc::new(FederationSyncEngine::new());
    let trust_normalizer = Arc::new(TrustNormalizer::new());
    
    // Get local cluster ID from persistence or environment
    let local_cluster_id = persistence.get_value("local_cluster_id")
        .unwrap_or_else(|_| "local-cluster".to_string());
    
    // Mock private key for federation
    let private_key = "mock-private-key-12345".to_string();
    
    let strategy_broadcast_router = Arc::new(
        StrategyBroadcastRouter::new(
            federation_sync_engine.clone(), 
            local_cluster_id,
            private_key
        )
    );
    
    // Start federation sync loop
    if let Err(e) = federation_sync_engine.start_sync_loop().await {
        eprintln!("Warning: Failed to start federation sync loop: {}", e);
    }
    
    if let Some(cmd) = &cli.vote_ledger {
        return run_vote_ledger_command(cmd.clone(), engine, storage).await;
    }
    
    if let Some(cmd) = &cli.treasury {
        return run_treasury_command(cmd.clone(), engine, storage).await;
    }
    
    if let Some(cmd) = &cli.memory {
        return run_memory_command(cmd, redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.mesh_builder {
        return run_mesh_builder_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.governance {
        return run_governance_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.audit {
        return run_audit_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.constitution {
        return run_constitution_command(cmd, &persistence).await?;
    }
    
    if let Some(cmd) = &cli.self_correction {
        return run_self_correction_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.memory_shards {
        return run_memory_shards_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.bio_simulation {
        return run_bio_simulation_command(cmd.clone()).await?;
    }
    
    if let Some(cmd) = &cli.agent_snapshot {
        return run_agent_snapshot_command(cmd).await?;
    }
    
    if let Some(cmd) = &cli.agent_anomaly_monitor {
        return run_agent_anomaly_monitor_command(cmd, redis_client.clone()).await?;
    }
    
    if let Some(cmd) = &cli.meta_agents {
        return commands::meta_agents::run_meta_agents_command(cmd).await?;
    }
    
    if let Some(cmd) = &cli.federation {
        return commands::federation::run_federation_command(cmd).await?;
    }
    
    // Execute the appropriate command
    match cli.command {
        Some(CliCommand::Run { strategy_id, verbose }) => {
            // Implementation for running strategies
            println!("Running strategy {} (verbose: {})", strategy_id, verbose);
            // Actual implementation would go here
        },
        
        Some(CliCommand::TrustShow) => {
            let strategies = storage.get_strategy_ids()?;
            
            println!("Current Trust Scores:");
            println!("--------------------");
            
            for strategy_id in strategies {
                let score = engine.get_trust_score(&strategy_id).await?;
                println!("{}: {:.4}", strategy_id, score);
            }
        },
        
        Some(CliCommand::TrustHistory { strategy_id }) => {
            println!("Trust Score History for {}:", strategy_id);
            println!("--------------------");
            
            // This would normally query the history from the trust score engine
            // For now, we'll just print a mock message
            println!("History data not available in mock implementation.");
        },
        
        Some(CliCommand::TrustChart { strategy_id, days }) => {
            println!("Trust Score Chart for {} (last {} days):", strategy_id, days);
            
            // Use our new chart generation capability
            let config = commands::trust_chart::ChartConfig::default();
            commands::trust_chart::run_trust_chart(engine.clone(), &strategy_id, days, config).await?;
        },
        
        Some(CliCommand::TrustDecay { initial_score, decay_factor, jitter, days, recovery_points }) => {
            // Convert recovery points to the format expected by the command
            let recovery_points_with_amount = recovery_points.iter()
                .map(|&day| (day as usize, 0.1))
                .collect();

            commands::trust_decay::run_trust_decay(
                "simulated_strategy", 
                initial_score, 
                decay_factor, 
                jitter, 
                days as usize, 
                Some(recovery_points_with_amount)
            ).await?;
        },
        
        Some(CliCommand::TrustStatus) => {
            commands::trust_status::run_trust_status(
                engine.clone(),
                decay_service.clone()
            ).await?;
        },
        
        Some(CliCommand::TrustDecayNow { strategy_id, decay_factor }) => {
            println!("Applying decay to strategy {}:", strategy_id);
            
            if let Err(e) = decay_service.apply_decay_to_strategy(&strategy_id, decay_factor).await {
                println!("Error: {}", e);
                return Err(e.into());
            }
            
            println!("Decay applied successfully!");
            
            // Get the updated score
            let updated_score = engine.get_trust_score(&strategy_id).await?;
            println!("New trust score: {:.4}", updated_score);
        },
        
        Some(CliCommand::TrustDecayConfig { enable, default_factor, interval_seconds, inactivity_threshold_hours, custom_factor }) => {
            // Get the current config
            let mut config = decay_service.get_config();
            
            // Apply updates
            if let Some(enable_val) = enable {
                config.enabled = enable_val;
                println!("Decay enabled: {}", if enable_val { "Yes".green() } else { "No".red() });
            }
            
            if let Some(factor) = default_factor {
                config.default_decay_factor_per_day = factor;
                println!("Default decay factor set to: {:.4}", factor);
            }
            
            if let Some(interval) = interval_seconds {
                config.decay_interval_seconds = interval;
                println!("Decay interval set to: {} seconds", interval);
            }
            
            if let Some(threshold) = inactivity_threshold_hours {
                config.inactivity_threshold_hours = threshold;
                println!("Inactivity threshold set to: {} hours", threshold);
            }
            
            // Update config
            if let Err(e) = decay_service.update_config(config).await {
                println!("Error updating config: {}", e);
                return Err(e.into());
            }
            
            // Custom factor for specific strategy if provided
            if let Some((strategy_id, factor)) = custom_factor {
                // Apply the custom factor
                println!("Setting custom decay factor {:.4} for strategy {}", factor, strategy_id);
                
                // Would update in a real implementation
                // For mock, we'll just acknowledge
                println!("Custom factor acknowledged (not stored in mock implementation)");
            }
            
            println!("Configuration updated successfully!");
        },
        
        Some(CliCommand::SimulateTrustDecay { agent, trust_score, error_rate, full_pipeline, verbose }) => {
            println!("🧪 Simulating Trust Decay and Healing Pipeline");
            println!("Agent: {}", agent);
            println!("Trust Score: {:.2}", trust_score / 100.0);
            println!("Error Rate: {:.2}", error_rate / 100.0);
            println!("Full Pipeline: {}", if full_pipeline { "Yes".green() } else { "No".red() });
            
            // Run the simulation
            commands::simulate_trust_decay::run_trust_decay_simulation(
                &agent,
                trust_score / 100.0, // Convert to 0-1 scale
                error_rate / 100.0,  // Convert to 0-1 scale
                full_pipeline,
                engine.clone(),
                decay_service.clone()
            ).await?;
        },

        Some(CliCommand::TrustMonitor { interval, once }) => {
            if once {
                commands::trust_monitor::run_trust_check(
                    engine.clone(),
                    decay_service.clone()
                ).await?;
            } else {
                // Set up signal handling for Ctrl+C
                let running = Arc::new(AtomicBool::new(true));
                let r = running.clone();
                
                ctrlc::set_handler(move || {
                    println!("\nReceived Ctrl+C, shutting down...");
                    r.store(false, Ordering::SeqCst);
                }).expect("Error setting Ctrl+C handler");
                
                commands::trust_monitor::run_trust_monitor(
                    engine.clone(),
                    decay_service.clone(),
                    interval,
                    running
                ).await?;
            }
        },
        
        Some(CliCommand::Treasury(cmd)) => {
            run_treasury_command(cmd, engine, storage).await?;
        },
        
        Some(CliCommand::Memory(cmd)) => {
            run_memory_command(cmd, redis_client.clone()).await?;
        },
        
        Some(CliCommand::MeshBuilder(cmd)) => {
            run_mesh_builder_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
        },
        
        Some(CliCommand::Governance(cmd)) => {
            run_governance_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
        },
        
        Some(CliCommand::Audit(cmd)) => {
            run_audit_command(cmd, engine.clone(), storage.clone(), redis_client.clone()).await?;
        },
        
        Some(CliCommand::Constitution(cmd)) => {
            run_constitution_command(cmd, &persistence).await?;
        },

        Some(CliCommand::SelfCorrection(cmd)) => {
            // Implementation for running self-correction
            println!("Running self-correction");
            // Actual implementation would go here
        },

        Some(CliCommand::VoteLedger(cmd)) => {
            // Initialize Redis client for vote ledger
            let redis_client = RedisClient::new().await?;
            commands::vote_ledger::run_vote_ledger_command(cmd, &redis_client).await?;
        },
        
        Some(CliCommand::Resilience(cmd)) => {
            // Initialize Redis client for resilience
            let redis_client = RedisClient::new().await?;
            commands::resilience::run_resilience_command(cmd).await?;
        },
        
        Some(CliCommand::BioEthics(cmd)) => {
            // Initialize services for bio-ethics
            commands::bio_ethics::run_bio_ethics_command(cmd).await?;
        },
        
        Some(CliCommand::BioSignal(cmd)) => {
            // Initialize services for bio-signal
            commands::bio_signal::run_bio_signal_command(cmd).await?;
        },
        
        Some(CliCommand::BioTraining(cmd)) => {
            // Initialize services for bio-training
            commands::bio_training::run_bio_training_command(cmd).await?;
        },
        
        Some(CliCommand::BioRoles(cmd)) => {
            // Initialize services for bio-roles
            commands::bio_roles::run_bio_roles_command(cmd).await?;
        },

        Some(CliCommand::MemoryShards(cmd)) => {
            match cmd.subcommand {
                MemoryShardsSubcommand::Fragment(args) => {
                    run_memory_shards_command(MemoryShardsSubcommand::Fragment(args))
                        .await?
                }
                MemoryShardsSubcommand::Reassemble(args) => {
                    run_memory_shards_command(MemoryShardsSubcommand::Reassemble(args))
                        .await?
                }
                MemoryShardsSubcommand::List(args) => {
                    run_memory_shards_command(MemoryShardsSubcommand::List(args))
                        .await?
                }
                MemoryShardsSubcommand::Validate(args) => {
                    run_memory_shards_command(MemoryShardsSubcommand::Validate(args))
                        .await?
                }
                MemoryShardsSubcommand::Sync(args) => {
                    run_memory_shards_command(MemoryShardsSubcommand::Sync(args))
                        .await?
                }
                MemoryShardsSubcommand::Archive(args) => {
                    run_memory_shards_command(MemoryShardsSubcommand::Archive(args))
                        .await?
                }
            }
        },

        Some(CliCommand::ReasonChain(cmd)) => {
            // Initialize services for reason chain
            commands::reason_chain::run_reason_chain_command(&cmd).await?;
        },

        Some(CliCommand::BioSimulation(cmd)) => {
            // Initialize services for bio-simulation
            commands::bio_simulation::run_bio_simulation_command(cmd).await?;
        },

        Some(CliCommand::AgentSnapshot(cmd)) => {
            run_agent_snapshot_command(&cmd).await?;
        },

        Some(CliCommand::AgentAnomalyMonitor(cmd)) => {
            run_agent_anomaly_monitor_command(cmd, redis_client.clone()).await?;
        },

        Some(CliCommand::MetaAgents(cmd)) => {
            commands::meta_agents::run_meta_agents_command(cmd).await?;
        },

        Some(CliCommand::Federation(cmd)) => {
            commands::federation::run_federation_command(cmd).await?;
        },
    }
    
    // Add these to your cli.bio_ethics and cli.bio_signal checks
    if let Some(cmd) = &cli.bio_ethics {
        return commands::bio_ethics::run_bio_ethics_command(cmd).await?;
    }

    if let Some(cmd) = &cli.bio_signal {
        return commands::bio_signal::run_bio_signal_command(cmd).await?;
    }
    
    // Add this to your cli checks
    if let Some(cmd) = &cli.bio_training {
        return commands::bio_training::run_bio_training_command(cmd).await?;
    }
    
    if let Some(cmd) = &cli.bio_roles {
        return commands::bio_roles::run_bio_roles_command(cmd).await?;
    }
    
    // Add this to your cli checks
    if let Some(cmd) = &cli.reason_chain {
        return commands::reason_chain::run_reason_chain_command(cmd).await?;
    }
    
    // Add Meta-Agents command handler
    if let Some(cmd) = &cli.meta_agents {
        return commands::meta_agents::run_meta_agents_command(cmd).await?;
    }
    
    Ok(())
}

async fn init_trust_score_engine(persistence: Arc<PersistenceManager>) -> Result<Arc<dyn TrustScoreEngine>> {
    Ok(Arc::new(mock_trust_score_engine::MockTrustScoreEngine::new(Some(persistence))))
}

async fn init_strategy_storage() -> Result<Arc<dyn StrategyStorage>> {
    Ok(Arc::new(mock_strategy_storage::MockStrategyStorage::new()))
}

async fn init_trust_decay_service(
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    persistence: Arc<PersistenceManager>,
) -> Result<Arc<dyn TrustDecayService>> {
    Ok(init_mock_trust_decay_service(engine, storage, persistence).await?)
}

fn init_mock_trust_score_engine() -> Arc<dyn TrustScoreEngine> {
    Arc::new(mock_trust_score_engine::MockTrustScoreEngine::new())
}

fn init_mock_strategy_storage() -> Arc<dyn StrategyStorage> {
    Arc::new(mock_strategy_storage::MockStrategyStorage::new())
}

async fn run_memory_command(cmd: &MemoryCommand, redis_client: Arc<RedisClient>) -> Result<()> {
    commands::memory::run_memory_command(cmd, redis_client).await
}

async fn run_mesh_builder_command(
    cmd: &MeshBuilderCommand, 
    engine: Arc<dyn TrustScoreEngine>, 
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>
) -> Result<()> {
    commands::mesh_builder::run_mesh_builder_command(cmd, engine, storage, redis_client).await
}

/// Convert a duration to a human-readable string
fn humanize_duration(duration: Duration) -> String {
    if duration.num_seconds() < 60 {
        format!("{} seconds", duration.num_seconds())
    } else if duration.num_minutes() < 60 {
        format!("{} minutes", duration.num_minutes())
    } else if duration.num_hours() < 24 {
        format!("{} hours", duration.num_hours())
    } else {
        format!("{} days", duration.num_days())
    }
}

async fn run_memory_shards_command(
    cmd: &MemoryShardsCommand, 
    engine: Arc<dyn TrustScoreEngine>, 
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>
) -> Result<()> {
    commands::memory_shards::run_memory_shards_command(cmd.clone()).await
}

async fn run_bio_simulation_command(cmd: BioSimulationCommand) -> Result<()> {
    commands::bio_simulation::run_bio_simulation_command(cmd).await
}

async fn run_self_correction_command(
    cmd: &SelfCorrectionCommand,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>
) -> Result<()> {
    commands::self_correction::run_self_correction_command(cmd.clone()).await
}

async fn run_agent_snapshot_command(cmd: &AgentSnapshotCommand) -> Result<()> {
    commands::agent_snapshot::run_agent_snapshot_command(cmd).await
} 