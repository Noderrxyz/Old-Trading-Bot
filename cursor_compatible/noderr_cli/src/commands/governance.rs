use anyhow::{Context, Result};
use clap::{Args, Subcommand};
use comfy_table::{Table, ContentArrangement, Cell, Row};
use comfy_table::presets::UTF8_FULL;
use colored::Colorize;
use serde::{Serialize, Deserialize};
use std::sync::Arc;
use chrono::{DateTime, Utc, Duration};
use noderr_core::trust_score_engine::TrustScoreEngine;
use noderr_core::strategy_storage::StrategyStorage;
use noderr_core::redis::RedisClient;

#[derive(Debug, Clone, Subcommand)]
pub enum GovernanceCommand {
    /// Governance management commands for meta-agent oversight
    #[command(subcommand)]
    Command(GovernanceSubcommand),
}

#[derive(Debug, Clone, Subcommand)]
pub enum GovernanceSubcommand {
    /// Oversee meta-agent operations, compliance, and interventions
    Oversee(OverseeArgs),
    
    /// Vote on governance proposals and rule changes
    Vote(VoteArgs),
    
    /// Create new governance proposals for network parameters or rules
    Propose(ProposeArgs),
    
    /// Verify governance status of agents, networks, and proposals
    Verify(VerifyArgs),
}

#[derive(Debug, Clone, Args)]
pub struct OverseeArgs {
    /// Agent ID to oversee (optional, if not provided will show all meta-agents)
    #[arg(short, long)]
    pub agent_id: Option<String>,
    
    /// Display detailed compliance report
    #[arg(short, long)]
    pub detailed: bool,
    
    /// Automatically implement corrective actions for non-compliant agents
    #[arg(short, long)]
    pub auto_correct: bool,
}

#[derive(Debug, Clone, Args)]
pub struct VoteArgs {
    /// Proposal ID to vote on
    #[arg(short, long)]
    pub proposal_id: String,
    
    /// Vote type (yes, no, abstain)
    #[arg(short, long)]
    pub vote: String,
    
    /// Reason for vote (optional)
    #[arg(short, long)]
    pub reason: Option<String>,
    
    /// Your agent ID for attribution
    #[arg(short, long)]
    pub agent_id: String,
}

#[derive(Debug, Clone, Args)]
pub struct ProposeArgs {
    /// Proposal title
    #[arg(short, long)]
    pub title: String,
    
    /// Proposal description
    #[arg(short, long)]
    pub description: String,
    
    /// Proposal type (parameter, rule)
    #[arg(short, long)]
    pub proposal_type: String,
    
    /// Parameter name (if proposal_type is parameter)
    #[arg(short, long)]
    pub parameter_name: Option<String>,
    
    /// Parameter value (if proposal_type is parameter)
    #[arg(short, long)]
    pub parameter_value: Option<String>,
    
    /// Rule text (if proposal_type is rule)
    #[arg(short, long)]
    pub rule_text: Option<String>,
    
    /// Your agent ID for attribution
    #[arg(short, long)]
    pub agent_id: String,
}

#[derive(Debug, Clone, Args)]
pub struct VerifyArgs {
    /// Verification type (agent, network, proposal)
    #[arg(short, long)]
    pub verify_type: String,
    
    /// ID to verify (agent ID, network ID, or proposal ID)
    #[arg(short, long)]
    pub id: String,
    
    /// Show detailed verification report
    #[arg(short, long)]
    pub detailed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaAgentStatus {
    pub agent_id: String,
    pub compliance_score: f64,
    pub intervention_count: u32,
    pub last_active: DateTime<Utc>,
    pub status: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceProposal {
    pub proposal_id: String,
    pub title: String,
    pub description: String,
    pub proposal_type: String,
    pub parameter_name: Option<String>,
    pub parameter_value: Option<String>,
    pub rule_text: Option<String>,
    pub proposer: String,
    pub created_at: DateTime<Utc>,
    pub status: ProposalStatus,
    pub yes_votes: u32,
    pub no_votes: u32,
    pub abstain_votes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProposalStatus {
    Pending,
    Approved,
    Rejected,
    Implemented,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    pub proposal_id: String,
    pub agent_id: String,
    pub vote_type: VoteType,
    pub reason: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VoteType {
    Yes,
    No,
    Abstain,
}

/// Run the governance command
pub async fn run_governance_command(
    cmd: &GovernanceCommand,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    match cmd {
        GovernanceCommand::Command(subcmd) => match subcmd {
            GovernanceSubcommand::Oversee(args) => {
                oversee_meta_agent(args, engine, storage, redis_client).await
            }
            GovernanceSubcommand::Vote(args) => {
                vote_on_proposal(args, engine, storage, redis_client).await
            }
            GovernanceSubcommand::Propose(args) => {
                create_proposal(args, engine, storage, redis_client).await
            }
            GovernanceSubcommand::Verify(args) => {
                verify_governance(args, engine, storage, redis_client).await
            }
        },
    }
}

/// Oversee meta-agent operations, compliance, and interventions
async fn oversee_meta_agent(
    args: &OverseeArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>, 
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("🔍 {} meta-agent oversight process", "Initiating".cyan());
    
    // Mock data for demonstration
    let meta_agents = get_mock_meta_agents();
    
    let filtered_agents = if let Some(agent_id) = &args.agent_id {
        meta_agents.iter().filter(|a| a.agent_id == *agent_id).collect::<Vec<_>>()
    } else {
        meta_agents.iter().collect::<Vec<_>>()
    };
    
    if filtered_agents.is_empty() {
        println!("{} No meta-agents found matching criteria", "Warning:".yellow());
        return Ok(());
    }
    
    // Build table for display
    let mut table = Table::new();
    table.set_content_arrangement(ContentArrangement::Dynamic);
    table.load_preset(UTF8_FULL);
    
    table.set_header(vec![
        "Agent ID", "Compliance", "Interventions", "Last Active", "Status", 
    ]);
    
    for agent in &filtered_agents {
        let compliance_cell = if agent.compliance_score >= 0.9 {
            Cell::new(format!("{:.2}", agent.compliance_score)).fg(colored::Color::Green)
        } else if agent.compliance_score >= 0.7 {
            Cell::new(format!("{:.2}", agent.compliance_score)).fg(colored::Color::Yellow)
        } else {
            Cell::new(format!("{:.2}", agent.compliance_score)).fg(colored::Color::Red)
        };
        
        let status_cell = match agent.status.as_str() {
            "Active" => Cell::new(&agent.status).fg(colored::Color::Green),
            "Warning" => Cell::new(&agent.status).fg(colored::Color::Yellow),
            "Suspended" => Cell::new(&agent.status).fg(colored::Color::Red),
            _ => Cell::new(&agent.status),
        };
        
        let last_active = humanize_time_ago(agent.last_active);
        
        table.add_row(vec![
            Cell::new(&agent.agent_id),
            compliance_cell,
            Cell::new(agent.intervention_count.to_string()),
            Cell::new(last_active),
            status_cell,
        ]);
    }
    
    println!("\n{}", table);
    
    // Display detailed report if requested
    if args.detailed {
        for agent in &filtered_agents {
            println!("\n{} for {}", "Detailed Compliance Report".green().bold(), agent.agent_id);
            println!("Permissions: {}", agent.permissions.join(", "));
            
            // More detailed information would go here in a real implementation
            println!("Recent activities:");
            println!("  - Configuration update (3 hours ago)");
            println!("  - Memory sector integrity check (12 hours ago)");
            println!("  - Network parameter adjustment (2 days ago)");
        }
    }
    
    // Auto-correct if requested
    if args.auto_correct {
        let low_compliance_agents = filtered_agents.iter()
            .filter(|a| a.compliance_score < 0.7)
            .collect::<Vec<_>>();
        
        if !low_compliance_agents.is_empty() {
            println!("\n{} Implementing corrective actions for {} agents", 
                "Auto-correction:".yellow(), low_compliance_agents.len());
            
            for agent in low_compliance_agents {
                println!("  - Agent {}: Applying governance constraints", agent.agent_id);
                println!("    • Resetting volatile memory sectors");
                println!("    • Applying stricter decision validation");
                println!("    • Scheduling compliance review");
            }
            
            println!("\n{} Auto-correction completed", "Success:".green());
        } else {
            println!("\n{} No agents require corrective actions", "Note:".blue());
        }
    }
    
    Ok(())
}

/// Vote on governance proposals and rule changes
async fn vote_on_proposal(
    args: &VoteArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("🗳️ {} vote on proposal {}", "Recording".cyan(), args.proposal_id);
    
    // Validate vote type
    let vote_type = match args.vote.to_lowercase().as_str() {
        "yes" => VoteType::Yes,
        "no" => VoteType::No,
        "abstain" => VoteType::Abstain,
        _ => {
            println!("{} Invalid vote type. Must be 'yes', 'no', or 'abstain'", "Error:".red());
            return Ok(());
        }
    };
    
    // In a real implementation, we would store the vote in a database
    // For now, we'll just mock the response
    
    let vote = Vote {
        proposal_id: args.proposal_id.clone(),
        agent_id: args.agent_id.clone(),
        vote_type,
        reason: args.reason.clone(),
        timestamp: Utc::now(),
    };
    
    println!("Vote recorded successfully!");
    
    // Show current vote status (mock data)
    let yes_votes = 7;
    let no_votes = 3;
    let abstain_votes = 2;
    
    println!("\nCurrent voting status:");
    println!("Yes: {}", yes_votes);
    println!("No: {}", no_votes);
    println!("Abstain: {}", abstain_votes);
    
    let total_votes = yes_votes + no_votes + abstain_votes;
    let yes_percentage = (yes_votes as f64 / total_votes as f64) * 100.0;
    
    if yes_votes > no_votes && yes_percentage >= 66.0 {
        println!("Status: {} (66% majority required)", "Passing".green());
    } else {
        println!("Status: {}", "Not passing".yellow());
    }
    
    Ok(())
}

/// Create new governance proposals for network parameters or rules
async fn create_proposal(
    args: &ProposeArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("📜 {} new governance proposal", "Creating".cyan());
    
    // Validate proposal type
    let proposal_type = match args.proposal_type.to_lowercase().as_str() {
        "parameter" => {
            // For parameter proposals, we need parameter name and value
            if args.parameter_name.is_none() || args.parameter_value.is_none() {
                println!("{} Parameter proposals require parameter_name and parameter_value", "Error:".red());
                return Ok(());
            }
            "parameter"
        },
        "rule" => {
            // For rule proposals, we need rule text
            if args.rule_text.is_none() {
                println!("{} Rule proposals require rule_text", "Error:".red());
                return Ok(());
            }
            "rule"
        },
        _ => {
            println!("{} Invalid proposal type. Must be 'parameter' or 'rule'", "Error:".red());
            return Ok(());
        }
    };
    
    // Generate a mock proposal ID
    let proposal_id = format!("prop_{}", Utc::now().timestamp());
    
    // In a real implementation, we would store the proposal in a database
    // For now, we'll just display what would be stored
    
    let proposal = GovernanceProposal {
        proposal_id: proposal_id.clone(),
        title: args.title.clone(),
        description: args.description.clone(),
        proposal_type: proposal_type.to_string(),
        parameter_name: args.parameter_name.clone(),
        parameter_value: args.parameter_value.clone(),
        rule_text: args.rule_text.clone(),
        proposer: args.agent_id.clone(),
        created_at: Utc::now(),
        status: ProposalStatus::Pending,
        yes_votes: 0,
        no_votes: 0,
        abstain_votes: 0,
    };
    
    println!("Proposal created successfully with ID: {}", proposal_id.green());
    println!("Title: {}", proposal.title);
    println!("Type: {}", proposal.proposal_type);
    
    if proposal.proposal_type == "parameter" {
        println!("Parameter: {} = {}", 
            proposal.parameter_name.as_ref().unwrap(), 
            proposal.parameter_value.as_ref().unwrap());
    } else {
        println!("Rule: {}", proposal.rule_text.as_ref().unwrap());
    }
    
    println!("\nProposal will be open for voting for 7 days");
    println!("Requires 66% majority to pass");
    
    Ok(())
}

/// Verify governance status of agents, networks, and proposals
async fn verify_governance(
    args: &VerifyArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("✓ {} governance status", "Verifying".cyan());
    
    match args.verify_type.to_lowercase().as_str() {
        "agent" => verify_agent_governance(args, engine, storage, redis_client).await?,
        "network" => verify_network_governance(args, engine, storage, redis_client).await?,
        "proposal" => verify_proposal_governance(args, engine, storage, redis_client).await?,
        _ => {
            println!("{} Invalid verification type. Must be 'agent', 'network', or 'proposal'", "Error:".red());
        }
    }
    
    Ok(())
}

async fn verify_agent_governance(
    args: &VerifyArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("Verifying governance status for agent: {}", args.id);
    
    // Mock data for demonstration
    let compliance_score = 0.92;
    let governance_issues = vec![];
    let last_governance_update = Utc::now() - Duration::hours(12);
    
    println!("Agent Governance Status:");
    println!("  Compliance Score: {:.2}", compliance_score);
    println!("  Last Governance Update: {}", humanize_time_ago(last_governance_update));
    
    if governance_issues.is_empty() {
        println!("  Governance Issues: {}", "None".green());
    } else {
        println!("  Governance Issues:");
        for issue in governance_issues {
            println!("    - {}", issue);
        }
    }
    
    if args.detailed {
        println!("\nDetailed Governance Report:");
        println!("  Permission Levels: admin, execute, read");
        println!("  Governance Participation Rate: 87%");
        println!("  Recent Votes: 12 (last 30 days)");
        println!("  Proposal Contributions: 3 (last 90 days)");
    }
    
    Ok(())
}

async fn verify_network_governance(
    args: &VerifyArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("Verifying governance status for network: {}", args.id);
    
    // Mock data for demonstration
    let active_proposals = 5;
    let governance_participation = 0.78;
    let last_parameter_change = Utc::now() - Duration::days(8);
    
    println!("Network Governance Status:");
    println!("  Active Proposals: {}", active_proposals);
    println!("  Governance Participation: {:.2}%", governance_participation * 100.0);
    println!("  Last Parameter Change: {}", humanize_time_ago(last_parameter_change));
    
    if args.detailed {
        println!("\nDetailed Network Governance Report:");
        println!("  Parameter Change Frequency: 4.2 per month");
        println!("  Rule Change Frequency: 1.5 per month");
        println!("  Compliance Audits: 3 per week");
        println!("  Meta-agent Oversight: Continuous");
    }
    
    Ok(())
}

async fn verify_proposal_governance(
    args: &VerifyArgs,
    engine: Arc<dyn TrustScoreEngine>,
    storage: Arc<dyn StrategyStorage>,
    redis_client: Arc<RedisClient>,
) -> Result<()> {
    println!("Verifying governance status for proposal: {}", args.id);
    
    // Mock data for demonstration
    let total_votes = 32;
    let yes_votes = 24;
    let no_votes = 5;
    let abstain_votes = 3;
    let proposal_status = "Approved";
    let yes_percentage = (yes_votes as f64 / total_votes as f64) * 100.0;
    
    println!("Proposal Governance Status:");
    println!("  Status: {}", proposal_status.green());
    println!("  Total Votes: {}", total_votes);
    println!("  Vote Distribution: {:.1}% Yes, {:.1}% No, {:.1}% Abstain", 
        (yes_votes as f64 / total_votes as f64) * 100.0,
        (no_votes as f64 / total_votes as f64) * 100.0,
        (abstain_votes as f64 / total_votes as f64) * 100.0);
    
    if yes_percentage >= 66.0 {
        println!("  Majority Threshold: {} (66% required)", "Passed".green());
    } else {
        println!("  Majority Threshold: {} (66% required)", "Not reached".yellow());
    }
    
    if args.detailed {
        println!("\nDetailed Proposal Governance Report:");
        println!("  Proposal Type: Parameter Change");
        println!("  Parameter: trust.decay.interval");
        println!("  Current Value: 24h");
        println!("  Proposed Value: 12h");
        println!("  Implementation Timeline: 7 days after approval");
        println!("  Voting Period: 5 days remaining");
    }
    
    Ok(())
}

/// Get mock meta-agents for demonstration
fn get_mock_meta_agents() -> Vec<MetaAgentStatus> {
    vec![
        MetaAgentStatus {
            agent_id: "meta_agent_001".to_string(),
            compliance_score: 0.95,
            intervention_count: 2,
            last_active: Utc::now() - Duration::hours(3),
            status: "Active".to_string(),
            permissions: vec!["admin".to_string(), "execute".to_string(), "read".to_string()],
        },
        MetaAgentStatus {
            agent_id: "meta_agent_002".to_string(),
            compliance_score: 0.87,
            intervention_count: 5,
            last_active: Utc::now() - Duration::minutes(45),
            status: "Active".to_string(),
            permissions: vec!["execute".to_string(), "read".to_string()],
        },
        MetaAgentStatus {
            agent_id: "meta_agent_003".to_string(),
            compliance_score: 0.72,
            intervention_count: 8,
            last_active: Utc::now() - Duration::days(1),
            status: "Warning".to_string(),
            permissions: vec!["read".to_string()],
        },
        MetaAgentStatus {
            agent_id: "meta_agent_004".to_string(),
            compliance_score: 0.53,
            intervention_count: 12,
            last_active: Utc::now() - Duration::days(3),
            status: "Suspended".to_string(),
            permissions: vec!["read".to_string()],
        },
    ]
}

/// Format a timestamp as a human-readable "time ago" string
fn humanize_time_ago(time: DateTime<Utc>) -> String {
    let now = Utc::now();
    let duration = now.signed_duration_since(time);
    
    if duration.num_seconds() < 60 {
        format!("{} seconds ago", duration.num_seconds())
    } else if duration.num_minutes() < 60 {
        format!("{} minutes ago", duration.num_minutes())
    } else if duration.num_hours() < 24 {
        format!("{} hours ago", duration.num_hours())
    } else if duration.num_days() < 30 {
        format!("{} days ago", duration.num_days())
    } else {
        format!("{} months ago", duration.num_days() / 30)
    }
} 