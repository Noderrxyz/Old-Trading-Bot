use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::collections::HashMap;
use chrono::Utc;
use crate::redis::RedisClient;
use anyhow::{anyhow, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryAccount {
    pub balance: u32,
    pub last_updated: u64,
    pub roles: Vec<String>,
    pub tier: String,
    pub frozen: bool,
    pub frozen_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryTransaction {
    pub timestamp: u64,
    pub amount: i32,
    pub reason: String,
    pub agent_id: String,
}

pub enum TreasuryEvent {
    StrategySuccess,
    GovernanceVote,
    ArbitrationWin,
    SignalApproved(u32), // Signal quality determines credit amount (10-50)
    DrawdownRecovery,
    BlueprintUsed,
    CanaryIssue,
    Custom(String, u32),
}

#[async_trait]
pub trait TreasuryService: Send + Sync {
    /// Get an agent's treasury account
    async fn get_account(&self, agent_id: &str) -> Result<Option<TreasuryAccount>>;
    
    /// Credit an agent's account and record the transaction
    async fn credit(&self, agent_id: &str, amount: u32, reason: &str) -> Result<TreasuryAccount>;
    
    /// Penalize an agent by removing credits
    async fn penalize(&self, agent_id: &str, amount: u32, reason: &str) -> Result<TreasuryAccount>;
    
    /// Freeze an agent's account
    async fn freeze_account(&self, agent_id: &str, reason: &str) -> Result<TreasuryAccount>;
    
    /// Unfreeze an agent's account
    async fn unfreeze_account(&self, agent_id: &str) -> Result<TreasuryAccount>;
    
    /// Get transaction history for an agent
    async fn get_transactions(&self, agent_id: &str) -> Result<Vec<TreasuryTransaction>>;
    
    /// Get top treasury accounts by balance
    async fn get_top_accounts(&self, limit: usize) -> Result<Vec<(String, TreasuryAccount)>>;
    
    /// Set an agent's tier
    async fn set_tier(&self, agent_id: &str, tier: &str) -> Result<TreasuryAccount>;
    
    /// Process a treasury event
    async fn process_event(&self, agent_id: &str, event: TreasuryEvent) -> Result<TreasuryAccount>;
    
    /// Evaluate and update tiers for all accounts
    async fn evaluate_tiers(&self) -> Result<Vec<(String, String, String)>>;
}

pub struct RedisTreasuryService {
    redis: Arc<RedisClient>,
}

impl RedisTreasuryService {
    pub fn new(redis: Arc<RedisClient>) -> Self {
        Self { redis }
    }
    
    async fn get_or_create_account(&self, agent_id: &str) -> Result<TreasuryAccount> {
        match self.get_account(agent_id).await? {
            Some(account) => Ok(account),
            None => {
                // Create a new account with default roles
                let account = TreasuryAccount {
                    balance: 0,
                    last_updated: Utc::now().timestamp_millis() as u64,
                    roles: vec!["contributor".to_string()],
                    tier: "observer".to_string(),
                    frozen: false,
                    frozen_reason: None,
                };
                
                // Save the new account
                let account_key = format!("treasury:account:{}", agent_id);
                self.redis.set(&account_key, &serde_json::to_string(&account)?).await?;
                
                Ok(account)
            }
        }
    }
    
    async fn save_account(&self, agent_id: &str, account: &TreasuryAccount) -> Result<()> {
        let account_key = format!("treasury:account:{}", agent_id);
        self.redis.set(&account_key, &serde_json::to_string(&account)?).await?;
        Ok(())
    }
    
    async fn add_transaction(&self, transaction: TreasuryTransaction) -> Result<()> {
        let ledger_key = format!("treasury:ledger:{}", transaction.agent_id);
        
        // Get existing transactions or create a new vec
        let existing: Option<String> = self.redis.get(&ledger_key).await?;
        let mut transactions = match existing {
            Some(data) => serde_json::from_str::<Vec<TreasuryTransaction>>(&data)?,
            None => Vec::new(),
        };
        
        // Add new transaction
        transactions.push(transaction);
        
        // Save updated list
        self.redis.set(&ledger_key, &serde_json::to_string(&transactions)?).await?;
        
        Ok(())
    }
    
    fn determine_tier(balance: u32) -> String {
        if balance >= 5000 {
            "core".to_string()
        } else if balance >= 2000 {
            "trusted".to_string()
        } else if balance >= 500 {
            "member".to_string()
        } else {
            "observer".to_string()
        }
    }
}

#[async_trait]
impl TreasuryService for RedisTreasuryService {
    async fn get_account(&self, agent_id: &str) -> Result<Option<TreasuryAccount>> {
        let account_key = format!("treasury:account:{}", agent_id);
        let account_data: Option<String> = self.redis.get(&account_key).await?;
        
        match account_data {
            Some(data) => Ok(Some(serde_json::from_str(&data)?)),
            None => Ok(None),
        }
    }
    
    async fn credit(&self, agent_id: &str, amount: u32, reason: &str) -> Result<TreasuryAccount> {
        let mut account = self.get_or_create_account(agent_id).await?;
        
        if account.frozen {
            return Err(anyhow!("Cannot credit account: Account is frozen"));
        }
        
        // Credit the account
        account.balance += amount;
        account.last_updated = Utc::now().timestamp_millis() as u64;
        
        // Update tier if necessary
        let new_tier = Self::determine_tier(account.balance);
        account.tier = new_tier;
        
        // Save account
        self.save_account(agent_id, &account).await?;
        
        // Record transaction
        let transaction = TreasuryTransaction {
            timestamp: Utc::now().timestamp_millis() as u64,
            amount: amount as i32,
            reason: reason.to_string(),
            agent_id: agent_id.to_string(),
        };
        
        self.add_transaction(transaction).await?;
        
        Ok(account)
    }
    
    async fn penalize(&self, agent_id: &str, amount: u32, reason: &str) -> Result<TreasuryAccount> {
        match self.get_account(agent_id).await? {
            Some(mut account) => {
                // Subtract penalty, ensuring it doesn't go below zero
                if account.balance < amount {
                    account.balance = 0;
                } else {
                    account.balance -= amount;
                }
                
                account.last_updated = Utc::now().timestamp_millis() as u64;
                
                // Update tier if necessary
                let new_tier = Self::determine_tier(account.balance);
                account.tier = new_tier;
                
                // Save account
                self.save_account(agent_id, &account).await?;
                
                // Record transaction
                let transaction = TreasuryTransaction {
                    timestamp: Utc::now().timestamp_millis() as u64,
                    amount: -(amount as i32),
                    reason: reason.to_string(),
                    agent_id: agent_id.to_string(),
                };
                
                self.add_transaction(transaction).await?;
                
                Ok(account)
            },
            None => Err(anyhow!("No treasury account found for agent {}", agent_id)),
        }
    }
    
    async fn freeze_account(&self, agent_id: &str, reason: &str) -> Result<TreasuryAccount> {
        match self.get_account(agent_id).await? {
            Some(mut account) => {
                if account.frozen {
                    return Err(anyhow!("Account is already frozen"));
                }
                
                // Freeze account
                account.frozen = true;
                account.frozen_reason = Some(reason.to_string());
                account.last_updated = Utc::now().timestamp_millis() as u64;
                
                // Save account
                self.save_account(agent_id, &account).await?;
                
                // Record transaction
                let transaction = TreasuryTransaction {
                    timestamp: Utc::now().timestamp_millis() as u64,
                    amount: 0,
                    reason: format!("ACCOUNT FROZEN: {}", reason),
                    agent_id: agent_id.to_string(),
                };
                
                self.add_transaction(transaction).await?;
                
                Ok(account)
            },
            None => Err(anyhow!("No treasury account found for agent {}", agent_id)),
        }
    }
    
    async fn unfreeze_account(&self, agent_id: &str) -> Result<TreasuryAccount> {
        match self.get_account(agent_id).await? {
            Some(mut account) => {
                if !account.frozen {
                    return Err(anyhow!("Account is not frozen"));
                }
                
                // Unfreeze account
                account.frozen = false;
                account.frozen_reason = None;
                account.last_updated = Utc::now().timestamp_millis() as u64;
                
                // Save account
                self.save_account(agent_id, &account).await?;
                
                // Record transaction
                let transaction = TreasuryTransaction {
                    timestamp: Utc::now().timestamp_millis() as u64,
                    amount: 0,
                    reason: "ACCOUNT UNFROZEN".to_string(),
                    agent_id: agent_id.to_string(),
                };
                
                self.add_transaction(transaction).await?;
                
                Ok(account)
            },
            None => Err(anyhow!("No treasury account found for agent {}", agent_id)),
        }
    }
    
    async fn get_transactions(&self, agent_id: &str) -> Result<Vec<TreasuryTransaction>> {
        let ledger_key = format!("treasury:ledger:{}", agent_id);
        let transactions_data: Option<String> = self.redis.get(&ledger_key).await?;
        
        match transactions_data {
            Some(data) => Ok(serde_json::from_str(&data)?),
            None => Ok(Vec::new()),
        }
    }
    
    async fn get_top_accounts(&self, limit: usize) -> Result<Vec<(String, TreasuryAccount)>> {
        let account_keys = self.redis.keys("treasury:account:*").await?;
        
        if account_keys.is_empty() {
            return Ok(Vec::new());
        }
        
        let mut accounts = Vec::new();
        
        for key in account_keys {
            let account_data: Option<String> = self.redis.get(&key).await?;
            
            if let Some(data) = account_data {
                let account: TreasuryAccount = serde_json::from_str(&data)?;
                let agent_id = key.replace("treasury:account:", "");
                
                accounts.push((agent_id, account));
            }
        }
        
        // Sort by balance (highest first)
        accounts.sort_by(|a, b| b.1.balance.cmp(&a.1.balance));
        
        // Limit to requested number
        Ok(accounts.into_iter().take(limit).collect())
    }
    
    async fn set_tier(&self, agent_id: &str, tier: &str) -> Result<TreasuryAccount> {
        // Validate tier
        if !["observer", "member", "trusted", "core"].contains(&tier) {
            return Err(anyhow!("Invalid tier: {}. Valid tiers are: observer, member, trusted, core", tier));
        }
        
        match self.get_account(agent_id).await? {
            Some(mut account) => {
                let previous_tier = account.tier.clone();
                account.tier = tier.to_string();
                account.last_updated = Utc::now().timestamp_millis() as u64;
                
                // Save account
                self.save_account(agent_id, &account).await?;
                
                // Record transaction
                let transaction = TreasuryTransaction {
                    timestamp: Utc::now().timestamp_millis() as u64,
                    amount: 0,
                    reason: format!("Tier changed from {} to {}", previous_tier, tier),
                    agent_id: agent_id.to_string(),
                };
                
                self.add_transaction(transaction).await?;
                
                Ok(account)
            },
            None => Err(anyhow!("No treasury account found for agent {}", agent_id)),
        }
    }
    
    async fn process_event(&self, agent_id: &str, event: TreasuryEvent) -> Result<TreasuryAccount> {
        // Define default credit amounts for each event type
        let (amount, reason) = match event {
            TreasuryEvent::StrategySuccess => (25, "Strategy execution success"),
            TreasuryEvent::GovernanceVote => (5, "Governance vote participation"),
            TreasuryEvent::ArbitrationWin => (20, "Arbitration decision win"),
            TreasuryEvent::SignalApproved(quality) => (quality, "Signal approved"),
            TreasuryEvent::DrawdownRecovery => (15, "Drawdown recovery"),
            TreasuryEvent::BlueprintUsed => (30, "Community blueprint used"),
            TreasuryEvent::CanaryIssue => (8, "Canary QA bug report"),
            TreasuryEvent::Custom(ref r, a) => (a, r),
        };
        
        // Credit the account
        self.credit(agent_id, amount, reason).await
    }
    
    async fn evaluate_tiers(&self) -> Result<Vec<(String, String, String)>> {
        let account_keys = self.redis.keys("treasury:account:*").await?;
        let mut tier_changes = Vec::new();
        
        for key in account_keys {
            let agent_id = key.replace("treasury:account:", "");
            let account_data: Option<String> = self.redis.get(&key).await?;
            
            if let Some(data) = account_data {
                let mut account: TreasuryAccount = serde_json::from_str(&data)?;
                
                // Skip frozen accounts
                if account.frozen {
                    continue;
                }
                
                // Determine the correct tier based on balance
                let correct_tier = Self::determine_tier(account.balance);
                
                // If tier is different, update it
                if account.tier != correct_tier {
                    let old_tier = account.tier.clone();
                    account.tier = correct_tier.clone();
                    account.last_updated = Utc::now().timestamp_millis() as u64;
                    
                    // Save the updated account
                    self.save_account(&agent_id, &account).await?;
                    
                    // Record the transaction
                    let transaction = TreasuryTransaction {
                        timestamp: Utc::now().timestamp_millis() as u64,
                        amount: 0,
                        reason: format!("Automated tier update: {} -> {}", old_tier, correct_tier),
                        agent_id: agent_id.clone(),
                    };
                    
                    self.add_transaction(transaction).await?;
                    
                    // Add to the list of changes
                    tier_changes.push((agent_id, old_tier, correct_tier));
                }
            }
        }
        
        Ok(tier_changes)
    }
}

/// Create a Treasury Service
pub fn create_treasury_service(redis: Arc<RedisClient>) -> Arc<dyn TreasuryService> {
    Arc::new(RedisTreasuryService::new(redis))
}

/// Run the daily tier evaluation task
pub async fn run_daily_tier_evaluation(treasury_service: Arc<dyn TreasuryService>) -> Result<()> {
    let changes = treasury_service.evaluate_tiers().await?;
    
    // Log tier changes for metrics
    if !changes.is_empty() {
        println!("Treasury tier evaluations completed with {} changes", changes.len());
        for (agent_id, old_tier, new_tier) in &changes {
            println!("Agent {} tier changed: {} -> {}", agent_id, old_tier, new_tier);
        }
    } else {
        println!("Treasury tier evaluations completed with no changes");
    }
    
    Ok(())
} 