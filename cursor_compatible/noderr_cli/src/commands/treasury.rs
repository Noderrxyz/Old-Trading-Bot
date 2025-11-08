use anyhow::{anyhow, Result};
use clap::{Args, Subcommand};
use comfy_table::{Cell, Color, ContentArrangement, Table};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use chrono::{DateTime, Utc};
use noderr_core::{storage::Storage, engine::Engine, redis::RedisClient};

#[derive(Args)]
pub struct TreasuryCommand {
    #[command(subcommand)]
    command: TreasurySubCommand,
}

#[derive(Subcommand)]
pub enum TreasurySubCommand {
    /// Get account balance for an agent
    Balance(BalanceArgs),
    
    /// View transaction history for an agent
    Ledger(LedgerArgs),
    
    /// View top agents by treasury balance
    Top(TopArgs),
    
    /// Credit an agent with contribution points
    Credit(CreditArgs),
    
    /// Penalize an agent by removing contribution points
    Penalize(PenalizeArgs),
    
    /// Freeze an agent's treasury account
    Freeze(FreezeArgs),
    
    /// Unfreeze an agent's treasury account
    Unfreeze(UnfreezeArgs),
    
    /// Get or set an agent's tier
    Tier(TierArgs),
    
    /// Evaluate all agent tiers and update if necessary
    EvaluateTiers,
}

#[derive(Args)]
pub struct BalanceArgs {
    /// Agent ID to check
    agent_id: String,
}

#[derive(Args)]
pub struct LedgerArgs {
    /// Agent ID to check
    agent_id: String,
    
    /// Number of entries to show
    #[arg(short, long, default_value = "10")]
    limit: usize,
}

#[derive(Args)]
pub struct TopArgs {
    /// Number of agents to show
    #[arg(short, long, default_value = "10")]
    limit: usize,
}

#[derive(Args)]
pub struct CreditArgs {
    /// Agent ID to credit
    agent_id: String,
    
    /// Amount to credit
    amount: u32,
    
    /// Reason for the credit
    reason: String,
}

#[derive(Args)]
pub struct PenalizeArgs {
    /// Agent ID to penalize
    agent_id: String,
    
    /// Amount to penalize
    amount: u32,
    
    /// Reason for the penalty
    reason: String,
}

#[derive(Args)]
pub struct FreezeArgs {
    /// Agent ID to freeze
    agent_id: String,
    
    /// Reason for freezing
    #[arg(short, long)]
    reason: String,
}

#[derive(Args)]
pub struct UnfreezeArgs {
    /// Agent ID to unfreeze
    agent_id: String,
}

#[derive(Args)]
pub struct TierArgs {
    /// Agent ID to check or modify
    agent_id: String,
    
    /// Set a specific tier (optional)
    #[arg(short, long)]
    set: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct TreasuryAccount {
    balance: u32,
    last_updated: u64,
    roles: Vec<String>,
    tier: String,
    frozen: bool,
    frozen_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct TreasuryTransaction {
    timestamp: u64,
    amount: i32,
    reason: String,
    agent_id: String,
}

impl TreasuryAccount {
    fn new(roles: Vec<String>) -> Self {
        Self {
            balance: 0,
            last_updated: Utc::now().timestamp_millis() as u64,
            roles,
            tier: "observer".to_string(),
            frozen: false,
            frozen_reason: None,
        }
    }
    
    fn determine_tier(&self) -> String {
        if self.balance >= 5000 {
            "core".to_string()
        } else if self.balance >= 2000 {
            "trusted".to_string()
        } else if self.balance >= 500 {
            "member".to_string()
        } else {
            "observer".to_string()
        }
    }
}

pub async fn run_treasury_command(
    command: TreasuryCommand,
    engine: Arc<Engine>,
    storage: Arc<Storage>,
) -> Result<()> {
    let redis_client = engine.get_redis_client().clone();
    
    match command.command {
        TreasurySubCommand::Balance(args) => {
            get_balance(&redis_client, args).await
        },
        TreasurySubCommand::Ledger(args) => {
            view_ledger(&redis_client, args).await
        },
        TreasurySubCommand::Top(args) => {
            view_top_balances(&redis_client, args).await
        },
        TreasurySubCommand::Credit(args) => {
            credit_agent(&redis_client, args).await
        },
        TreasurySubCommand::Penalize(args) => {
            penalize_agent(&redis_client, args).await
        },
        TreasurySubCommand::Freeze(args) => {
            freeze_agent(&redis_client, args).await
        },
        TreasurySubCommand::Unfreeze(args) => {
            unfreeze_agent(&redis_client, args).await
        },
        TreasurySubCommand::Tier(args) => {
            manage_tier(&redis_client, args).await
        },
        TreasurySubCommand::EvaluateTiers => {
            evaluate_tiers(&redis_client).await
        },
    }
}

async fn evaluate_tiers(redis: &RedisClient) -> Result<()> {
    println!("🔄 Evaluating all agent tiers based on balances...");
    
    // Create a treasury service
    let treasury_service = noderr_core::create_treasury_service(Arc::new(redis.clone()));
    
    // Run the evaluation
    let changes = treasury_service.evaluate_tiers().await?;
    
    if changes.is_empty() {
        println!("✅ No tier changes needed, all accounts are at the correct tier.");
        return Ok(());
    }
    
    // Show the changes
    println!("✅ Updated {} agent tiers:", changes.len());
    
    let mut table = Table::new();
    table.set_header(vec!["Agent", "Old Tier", "New Tier"]);
    
    for (agent_id, old_tier, new_tier) in changes {
        // Color for the tier change direction
        let new_tier_cell = if old_tier == "observer" && new_tier == "member" 
                           || old_tier == "member" && new_tier == "trusted"
                           || old_tier == "trusted" && new_tier == "core" {
            Cell::new(&new_tier).fg(Color::Green) // Promotion
        } else {
            Cell::new(&new_tier).fg(Color::Red) // Demotion
        };
        
        table.add_row(vec![
            Cell::new(agent_id),
            Cell::new(old_tier),
            new_tier_cell,
        ]);
    }
    
    println!("{table}");
    
    Ok(())
} 