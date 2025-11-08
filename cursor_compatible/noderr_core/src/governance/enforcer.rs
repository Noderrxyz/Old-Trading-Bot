// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use serde_json;
use tracing::{debug, error, info, warn};

use crate::redis::RedisClient;
use super::types::{
    GovernanceRule, 
    GovernanceActionType, 
    RuleViolation, 
    EnforcementResult,
    RuleSeverity,
    RuleCheckFn
};
use super::violation_log::ViolationLogger;

// In-memory rule cache expiration time
const RULE_CACHE_EXPIRY_SECS: u64 = 60;

/// Trait for governance rule enforcement
#[async_trait]
pub trait GovernanceEnforcer: Send + Sync {
    /// Check if an action is allowed by governance rules
    async fn enforce_rules(
        &self,
        agent_id: &str,
        action_type: GovernanceActionType,
        context: HashMap<String, serde_json::Value>
    ) -> EnforcementResult;

    /// Get all active governance rules
    async fn get_active_rules(&self) -> Vec<GovernanceRule>;
    
    /// Add a new governance rule
    async fn add_rule(&self, rule: GovernanceRule) -> Result<(), String>;
    
    /// Update an existing governance rule
    async fn update_rule(&self, rule: GovernanceRule) -> Result<(), String>;
    
    /// Disable a governance rule
    async fn disable_rule(&self, rule_id: &str) -> Result<(), String>;
}

/// Redis-backed implementation of the governance enforcer
pub struct RedisGovernanceEnforcer {
    /// Redis client for persistence
    redis: Arc<RedisClient>,
    /// In-memory cache of active rules
    rules_cache: Arc<RwLock<Vec<GovernanceRule>>>,
    /// When the cache was last refreshed
    cache_last_refreshed: Arc<RwLock<chrono::DateTime<chrono::Utc>>>,
    /// Violation logger
    violation_logger: Arc<dyn ViolationLogger>,
}

impl RedisGovernanceEnforcer {
    /// Create a new Redis-backed governance enforcer
    pub fn new(redis: Arc<RedisClient>, violation_logger: Arc<dyn ViolationLogger>) -> Self {
        Self {
            redis,
            rules_cache: Arc::new(RwLock::new(Vec::new())),
            cache_last_refreshed: Arc::new(RwLock::new(Utc::now() - chrono::Duration::days(1))), // Force initial refresh
            violation_logger,
        }
    }
    
    /// Load all active rules from Redis into the cache
    async fn refresh_rules_cache(&self) -> Result<(), String> {
        // Check if cache refresh is needed
        let should_refresh = {
            let last_refreshed = self.cache_last_refreshed.read().unwrap();
            let now = Utc::now();
            let duration = now.signed_duration_since(*last_refreshed);
            duration.num_seconds() as u64 > RULE_CACHE_EXPIRY_SECS
        };
        
        if !should_refresh {
            return Ok(());
        }
        
        // Load rules from Redis
        let rule_ids = match self.redis.smembers::<String>("governance:rules:active").await {
            Ok(ids) => ids,
            Err(e) => return Err(format!("Failed to get active rule IDs: {}", e)),
        };
        
        let mut rules = Vec::with_capacity(rule_ids.len());
        
        for rule_id in rule_ids {
            match self.redis.get::<String>(&format!("governance:rule:{}", rule_id)).await {
                Ok(Some(json_str)) => {
                    match serde_json::from_str::<GovernanceRule>(&json_str) {
                        Ok(rule) => {
                            if rule.active {
                                rules.push(rule);
                            }
                        },
                        Err(e) => {
                            error!("Failed to deserialize rule {}: {}", rule_id, e);
                            continue;
                        }
                    }
                },
                Ok(None) => {
                    warn!("Rule {} not found, but listed in active set", rule_id);
                    // Clean up the active set
                    let _ = self.redis.srem::<String, String>("governance:rules:active", rule_id).await;
                    continue;
                },
                Err(e) => {
                    error!("Failed to get rule {}: {}", rule_id, e);
                    continue;
                }
            }
        }
        
        // Update the cache
        {
            let mut cache = self.rules_cache.write().unwrap();
            *cache = rules;
            
            let mut last_refreshed = self.cache_last_refreshed.write().unwrap();
            *last_refreshed = Utc::now();
        }
        
        Ok(())
    }
    
    /// Execute a rule check
    async fn evaluate_rule(
        &self,
        rule: &GovernanceRule,
        agent_id: &str,
        action_type: &GovernanceActionType,
        context: &HashMap<String, serde_json::Value>
    ) -> Result<bool, RuleViolation> {
        // Only evaluate if the rule applies to this action type
        if !rule.applies_to.contains(action_type) {
            return Ok(true);
        }
        
        // Here we would normally deserialize and execute the rule implementation
        // For simplicity, we'll implement a few hard-coded rules based on the rule ID
        
        match rule.id.as_str() {
            "role-validator-vote" => {
                // Check if the agent has the validator role
                let role = context.get("role").and_then(|r| r.as_str()).unwrap_or("unknown");
                
                if role != "validator" && *action_type == GovernanceActionType::Vote {
                    return Err(RuleViolation::new(
                        format!("Only validators may vote, agent {} has role {}", agent_id, role),
                        RuleSeverity::Moderate,
                        "INVALID_ROLE_FOR_VOTE".to_string()
                    ));
                }
            },
            "min-trust-score-propose" => {
                // Check minimum trust score for proposals
                if *action_type == GovernanceActionType::Propose {
                    let trust_score = context.get("trust_score")
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.0);
                    
                    if trust_score < 0.75 {
                        return Err(RuleViolation::new(
                            format!("Minimum trust score of 0.75 required for proposals, agent {} has {:.2}", 
                                    agent_id, trust_score),
                            RuleSeverity::Moderate,
                            "INSUFFICIENT_TRUST_FOR_PROPOSAL".to_string()
                        ));
                    }
                }
            },
            "min-trust-score-execute" => {
                // Check minimum trust score for strategy execution
                if *action_type == GovernanceActionType::Execute {
                    let trust_score = context.get("trust_score")
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.0);
                    
                    let min_score = rule.parameters.as_ref()
                        .and_then(|p| p.get("min_score"))
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.5);
                    
                    if trust_score < min_score {
                        return Err(RuleViolation::new(
                            format!("Minimum trust score of {:.2} required for execution, agent {} has {:.2}", 
                                    min_score, agent_id, trust_score),
                            RuleSeverity::Critical,
                            "INSUFFICIENT_TRUST_FOR_EXECUTION".to_string()
                        ));
                    }
                }
            },
            "quorum-required" => {
                // Check if quorum is met for executions
                if *action_type == GovernanceActionType::Execute && context.contains_key("proposal_id") {
                    let votes_count = context.get("votes_count")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as usize;
                    
                    let member_count = context.get("member_count")
                        .and_then(|m| m.as_u64())
                        .unwrap_or(0) as usize;
                    
                    if member_count > 0 && votes_count < member_count / 2 {
                        return Err(RuleViolation::new(
                            format!("Quorum not met: {} votes out of {} members", votes_count, member_count),
                            RuleSeverity::Critical,
                            "QUORUM_NOT_MET".to_string()
                        ).with_context("votes", serde_json::to_value(votes_count).unwrap())
                         .with_context("members", serde_json::to_value(member_count).unwrap()));
                    }
                }
            },
            "cooldown-period" => {
                // Check cooldown period for actions
                if let Some(last_action_time) = context.get("last_action_time").and_then(|t| t.as_str()) {
                    if let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(last_action_time) {
                        let cooldown_hours = rule.parameters.as_ref()
                            .and_then(|p| p.get("cooldown_hours"))
                            .and_then(|h| h.as_u64())
                            .unwrap_or(24);
                        
                        let cooldown_duration = chrono::Duration::hours(cooldown_hours as i64);
                        let now = Utc::now();
                        
                        if now.signed_duration_since(last_time) < cooldown_duration {
                            return Err(RuleViolation::new(
                                format!("Cooldown period of {} hours not elapsed since last action", cooldown_hours),
                                RuleSeverity::Moderate,
                                "COOLDOWN_PERIOD_ACTIVE".to_string()
                            ));
                        }
                    }
                }
            },
            _ => {
                // Unknown rule, log a warning but don't block
                warn!("Unknown rule ID: {}", rule.id);
            }
        }
        
        Ok(true)
    }
}

#[async_trait]
impl GovernanceEnforcer for RedisGovernanceEnforcer {
    async fn enforce_rules(
        &self,
        agent_id: &str,
        action_type: GovernanceActionType,
        context: HashMap<String, serde_json::Value>
    ) -> EnforcementResult {
        // Make sure rule cache is up to date
        if let Err(e) = self.refresh_rules_cache().await {
            error!("Failed to refresh rules cache: {}", e);
            // Continue with potentially stale cache
        }
        
        // Get the rules that apply to this action type
        let active_rules = {
            let cache = self.rules_cache.read().unwrap();
            cache.iter()
                .filter(|r| r.active && r.applies_to.contains(&action_type))
                .cloned()
                .collect::<Vec<_>>()
        };
        
        if active_rules.is_empty() {
            debug!("No active rules for action type: {:?}", action_type);
            return EnforcementResult::success(agent_id.to_string(), action_type);
        }
        
        let mut result = EnforcementResult::success(agent_id.to_string(), action_type.clone());
        
        // Check each rule
        for rule in active_rules {
            match self.evaluate_rule(&rule, agent_id, &action_type, &context).await {
                Ok(_) => {
                    // Rule passed
                    continue;
                },
                Err(violation) => {
                    // Rule failed
                    debug!("Rule violation for agent {}: {} (rule: {})", 
                          agent_id, violation.reason, rule.id);
                    
                    // Log the violation
                    let _ = self.violation_logger.log_violation(
                        agent_id,
                        &action_type,
                        &violation
                    ).await;
                    
                    // Add to result
                    result.add_violation(violation);
                }
            }
        }
        
        // If there were any violations, the action is not allowed
        if !result.violations.is_empty() {
            info!("Governance enforcement blocked action {:?} for agent {}: {} violations", 
                 action_type, agent_id, result.violations.len());
        }
        
        result
    }

    async fn get_active_rules(&self) -> Vec<GovernanceRule> {
        // Refresh the cache
        if let Err(e) = self.refresh_rules_cache().await {
            error!("Failed to refresh rules cache: {}", e);
        }
        
        // Return the cached rules
        let cache = self.rules_cache.read().unwrap();
        cache.clone()
    }
    
    async fn add_rule(&self, rule: GovernanceRule) -> Result<(), String> {
        // Validate the rule
        if rule.id.is_empty() {
            return Err("Rule ID cannot be empty".to_string());
        }
        
        // Save the rule
        let rule_json = match serde_json::to_string(&rule) {
            Ok(json) => json,
            Err(e) => return Err(format!("Failed to serialize rule: {}", e)),
        };
        
        // Store in Redis
        if let Err(e) = self.redis.set(&format!("governance:rule:{}", rule.id), &rule_json, None).await {
            return Err(format!("Failed to save rule to Redis: {}", e));
        }
        
        // Add to active set if the rule is active
        if rule.active {
            if let Err(e) = self.redis.sadd::<String, String>("governance:rules:active", rule.id.clone()).await {
                return Err(format!("Failed to add rule to active set: {}", e));
            }
        }
        
        // Refresh the cache
        {
            let mut cache = self.rules_cache.write().unwrap();
            // Find and replace if it exists, or add if it doesn't
            let existing_index = cache.iter().position(|r| r.id == rule.id);
            if let Some(index) = existing_index {
                cache[index] = rule.clone();
            } else {
                cache.push(rule.clone());
            }
        }
        
        Ok(())
    }
    
    async fn update_rule(&self, rule: GovernanceRule) -> Result<(), String> {
        // Check if the rule exists
        let exists = match self.redis.exists(&format!("governance:rule:{}", rule.id)).await {
            Ok(exists) => exists,
            Err(e) => return Err(format!("Failed to check if rule exists: {}", e)),
        };
        
        if !exists {
            return Err(format!("Rule with ID {} does not exist", rule.id));
        }
        
        // Update the rule using the same method as add_rule
        self.add_rule(rule).await
    }
    
    async fn disable_rule(&self, rule_id: &str) -> Result<(), String> {
        // Get the rule
        let rule_json = match self.redis.get::<String>(&format!("governance:rule:{}", rule_id)).await {
            Ok(Some(json)) => json,
            Ok(None) => return Err(format!("Rule with ID {} does not exist", rule_id)),
            Err(e) => return Err(format!("Failed to get rule: {}", e)),
        };
        
        // Deserialize, update, and reserialize
        let mut rule: GovernanceRule = match serde_json::from_str(&rule_json) {
            Ok(rule) => rule,
            Err(e) => return Err(format!("Failed to deserialize rule: {}", e)),
        };
        
        // Update active status
        rule.active = false;
        rule.updated_at = Utc::now();
        
        // Save back to Redis
        let updated_json = match serde_json::to_string(&rule) {
            Ok(json) => json,
            Err(e) => return Err(format!("Failed to serialize updated rule: {}", e)),
        };
        
        if let Err(e) = self.redis.set(&format!("governance:rule:{}", rule_id), &updated_json, None).await {
            return Err(format!("Failed to save updated rule: {}", e));
        }
        
        // Remove from active set
        if let Err(e) = self.redis.srem::<String, String>("governance:rules:active", rule_id.to_string()).await {
            return Err(format!("Failed to remove rule from active set: {}", e));
        }
        
        // Update the cache
        {
            let mut cache = self.rules_cache.write().unwrap();
            // Find and update if it exists
            let existing_index = cache.iter().position(|r| r.id == rule_id);
            if let Some(index) = existing_index {
                cache[index].active = false;
            }
        }
        
        Ok(())
    }
}

/// A simple in-memory implementation for testing
pub struct MockGovernanceEnforcer {
    /// In-memory rules storage
    rules: Arc<RwLock<Vec<GovernanceRule>>>,
    /// Violation logger
    violation_logger: Arc<dyn ViolationLogger>,
    /// Custom enforcement function for testing
    pub enforce_rules: Box<dyn Fn(&str, GovernanceActionType, HashMap<String, serde_json::Value>) -> 
                             std::pin::Pin<Box<dyn Future<Output = EnforcementResult> + Send>> + Send + Sync>,
}

impl MockGovernanceEnforcer {
    /// Create a new mock governance enforcer
    pub fn new(violation_logger: Arc<dyn ViolationLogger>) -> Self {
        Self {
            rules: Arc::new(RwLock::new(Vec::new())),
            violation_logger,
            enforce_rules: Box::new(|agent_id, action_type, _context| {
                // Default implementation passes all checks
                Box::pin(async move {
                    EnforcementResult::success(agent_id.to_string(), action_type)
                })
            }),
        }
    }
    
    /// Add default test rules
    pub fn with_default_rules(mut self) -> Self {
        let default_rules = vec![
            GovernanceRule {
                id: "role-validator-vote".to_string(),
                label: "Only validators may vote".to_string(),
                description: Some("Restricts voting to validators only".to_string()),
                applies_to: vec![GovernanceActionType::Vote],
                active: true,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                implementation: "".to_string(), // Not used in mock
                parameters: None,
            },
            GovernanceRule {
                id: "min-trust-score-propose".to_string(),
                label: "Minimum trust score for proposals".to_string(),
                description: Some("Requires a minimum trust score to create proposals".to_string()),
                applies_to: vec![GovernanceActionType::Propose],
                active: true,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                implementation: "".to_string(),
                parameters: Some(HashMap::from([
                    ("min_score".to_string(), serde_json::to_value(0.75).unwrap()),
                ])),
            },
            GovernanceRule {
                id: "min-trust-score-execute".to_string(),
                label: "Minimum trust score for execution".to_string(),
                description: Some("Requires a minimum trust score to execute strategies".to_string()),
                applies_to: vec![GovernanceActionType::Execute],
                active: true,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                implementation: "".to_string(),
                parameters: Some(HashMap::from([
                    ("min_score".to_string(), serde_json::to_value(0.5).unwrap()),
                ])),
            },
        ];
        
        {
            let mut rules = self.rules.write().unwrap();
            *rules = default_rules;
        }
        
        self
    }
    
    /// Evaluate a rule
    async fn evaluate_rule(
        &self,
        rule: &GovernanceRule,
        agent_id: &str,
        action_type: &GovernanceActionType,
        context: &HashMap<String, serde_json::Value>
    ) -> Result<bool, RuleViolation> {
        // Only evaluate if the rule applies to this action type
        if !rule.applies_to.contains(action_type) {
            return Ok(true);
        }
        
        // Same implementation as RedisGovernanceEnforcer
        match rule.id.as_str() {
            "role-validator-vote" => {
                let role = context.get("role").and_then(|r| r.as_str()).unwrap_or("unknown");
                
                if role != "validator" && *action_type == GovernanceActionType::Vote {
                    return Err(RuleViolation::new(
                        format!("Only validators may vote, agent {} has role {}", agent_id, role),
                        RuleSeverity::Moderate,
                        "INVALID_ROLE_FOR_VOTE".to_string()
                    ));
                }
            },
            "min-trust-score-propose" => {
                if *action_type == GovernanceActionType::Propose {
                    let trust_score = context.get("trust_score")
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.0);
                    
                    if trust_score < 0.75 {
                        return Err(RuleViolation::new(
                            format!("Minimum trust score of 0.75 required for proposals, agent {} has {:.2}", 
                                    agent_id, trust_score),
                            RuleSeverity::Moderate,
                            "INSUFFICIENT_TRUST_FOR_PROPOSAL".to_string()
                        ));
                    }
                }
            },
            "min-trust-score-execute" => {
                if *action_type == GovernanceActionType::Execute {
                    let trust_score = context.get("trust_score")
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.0);
                    
                    let min_score = rule.parameters.as_ref()
                        .and_then(|p| p.get("min_score"))
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.5);
                    
                    if trust_score < min_score {
                        return Err(RuleViolation::new(
                            format!("Minimum trust score of {:.2} required for execution, agent {} has {:.2}", 
                                    min_score, agent_id, trust_score),
                            RuleSeverity::Critical,
                            "INSUFFICIENT_TRUST_FOR_EXECUTION".to_string()
                        ));
                    }
                }
            },
            _ => {
                // Unknown rule
                warn!("Unknown rule ID: {}", rule.id);
            }
        }
        
        Ok(true)
    }
}

#[async_trait]
impl GovernanceEnforcer for MockGovernanceEnforcer {
    async fn enforce_rules(
        &self,
        agent_id: &str,
        action_type: GovernanceActionType,
        context: HashMap<String, serde_json::Value>
    ) -> EnforcementResult {
        // Use the custom enforcement function
        (self.enforce_rules)(agent_id, action_type, context).await
    }

    async fn get_active_rules(&self) -> Vec<GovernanceRule> {
        let rules = self.rules.read().unwrap();
        rules.iter().filter(|r| r.active).cloned().collect()
    }
    
    async fn add_rule(&self, rule: GovernanceRule) -> Result<(), String> {
        let mut rules = self.rules.write().unwrap();
        // Find and replace if it exists, or add if it doesn't
        let existing_index = rules.iter().position(|r| r.id == rule.id);
        if let Some(index) = existing_index {
            rules[index] = rule;
        } else {
            rules.push(rule);
        }
        Ok(())
    }
    
    async fn update_rule(&self, rule: GovernanceRule) -> Result<(), String> {
        let mut rules = self.rules.write().unwrap();
        let existing_index = rules.iter().position(|r| r.id == rule.id);
        if let Some(index) = existing_index {
            rules[index] = rule;
            Ok(())
        } else {
            Err(format!("Rule with ID {} does not exist", rule.id))
        }
    }
    
    async fn disable_rule(&self, rule_id: &str) -> Result<(), String> {
        let mut rules = self.rules.write().unwrap();
        let existing_index = rules.iter().position(|r| r.id == rule_id);
        if let Some(index) = existing_index {
            rules[index].active = false;
            Ok(())
        } else {
            Err(format!("Rule with ID {} does not exist", rule_id))
        }
    }
} 