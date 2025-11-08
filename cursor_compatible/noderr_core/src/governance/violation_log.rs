// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use chrono::Utc;
use serde::{Serialize, Deserialize};
use tracing::{debug, error, info, warn};

use crate::redis::RedisClient;
use crate::telemetry::TelemetryReporter;
use super::types::{RuleViolation, GovernanceActionType, RuleSeverity};

/// Maximum number of violations to store per agent
const MAX_VIOLATIONS_PER_AGENT: usize = 1000;

/// Entry in the violation log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViolationLogEntry {
    /// Agent ID that caused the violation
    pub agent_id: String,
    /// Type of action that was attempted
    pub action_type: GovernanceActionType,
    /// Details of the violation
    pub violation: RuleViolation,
    /// Timestamp when the violation was logged
    pub logged_at: chrono::DateTime<chrono::Utc>,
    /// Whether administrators were notified
    pub notified_admins: bool,
}

/// Trait for logging governance violations
#[async_trait]
pub trait ViolationLogger: Send + Sync {
    /// Log a governance rule violation
    async fn log_violation(
        &self,
        agent_id: &str,
        action_type: &GovernanceActionType,
        violation: &RuleViolation
    ) -> Result<(), String>;
    
    /// Get recent violations for an agent
    async fn get_agent_violations(
        &self,
        agent_id: &str,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String>;
    
    /// Get recent violations by severity
    async fn get_violations_by_severity(
        &self,
        severity: RuleSeverity,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String>;
    
    /// Get all recent violations
    async fn get_all_violations(
        &self,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String>;
}

/// Redis-backed violation logger
pub struct RedisViolationLogger {
    /// Redis client for persistence
    redis: Arc<RedisClient>,
    /// Telemetry reporter for alerts
    telemetry: Arc<TelemetryReporter>,
}

impl RedisViolationLogger {
    /// Create a new Redis-backed violation logger
    pub fn new(redis: Arc<RedisClient>, telemetry: Arc<TelemetryReporter>) -> Self {
        Self {
            redis,
            telemetry,
        }
    }
    
    /// Generate keys for Redis storage
    fn get_keys(&self, agent_id: &str, severity: &RuleSeverity) -> (String, String) {
        let agent_key = format!("governance:violations:agent:{}", agent_id);
        let severity_key = format!("governance:violations:severity:{}", severity);
        (agent_key, severity_key)
    }
    
    /// Report a critical violation to administrators
    async fn report_critical_violation(&self, entry: &ViolationLogEntry) {
        let mut data = HashMap::new();
        data.insert("agent_id".to_string(), serde_json::to_value(&entry.agent_id).unwrap());
        data.insert("action_type".to_string(), serde_json::to_value(&entry.action_type).unwrap());
        data.insert("reason".to_string(), serde_json::to_value(&entry.violation.reason).unwrap());
        data.insert("code".to_string(), serde_json::to_value(&entry.violation.code).unwrap());
        data.insert("timestamp".to_string(), serde_json::to_value(&entry.violation.timestamp).unwrap());
        
        // Add any context if available
        if let Some(context) = &entry.violation.context {
            data.insert("context".to_string(), serde_json::to_value(context).unwrap());
        }
        
        // Report via telemetry
        self.telemetry.report_custom("governance_critical_violation", data).await;
        
        // Log the event
        warn!("🚨 CRITICAL GOVERNANCE VIOLATION: Agent {} attempted {:?}: {}", 
             entry.agent_id, entry.action_type, entry.violation.reason);
    }
}

#[async_trait]
impl ViolationLogger for RedisViolationLogger {
    async fn log_violation(
        &self,
        agent_id: &str,
        action_type: &GovernanceActionType,
        violation: &RuleViolation
    ) -> Result<(), String> {
        // Create a log entry
        let entry = ViolationLogEntry {
            agent_id: agent_id.to_string(),
            action_type: action_type.clone(),
            violation: violation.clone(),
            logged_at: Utc::now(),
            notified_admins: false,
        };
        
        // Serialize to JSON
        let entry_json = match serde_json::to_string(&entry) {
            Ok(json) => json,
            Err(e) => return Err(format!("Failed to serialize violation log entry: {}", e)),
        };
        
        // Get Redis keys
        let (agent_key, severity_key) = self.get_keys(agent_id, &violation.severity);
        
        // Generate a unique ID for this violation
        let violation_id = format!("{}:{}", Utc::now().timestamp_millis(), uuid::Uuid::new_v4());
        
        // Store in Redis lists
        if let Err(e) = self.redis.lpush(&agent_key, &entry_json).await {
            return Err(format!("Failed to store violation for agent: {}", e));
        }
        
        if let Err(e) = self.redis.lpush(&severity_key, &entry_json).await {
            return Err(format!("Failed to store violation by severity: {}", e));
        }
        
        // Store in global list
        if let Err(e) = self.redis.lpush("governance:violations:all", &entry_json).await {
            return Err(format!("Failed to store violation in global list: {}", e));
        }
        
        // Trim the lists to prevent unbounded growth
        let _ = self.redis.ltrim(&agent_key, 0, MAX_VIOLATIONS_PER_AGENT as i64 - 1).await;
        let _ = self.redis.ltrim(&severity_key, 0, MAX_VIOLATIONS_PER_AGENT as i64 - 1).await;
        let _ = self.redis.ltrim("governance:violations:all", 0, (MAX_VIOLATIONS_PER_AGENT * 10) as i64 - 1).await;
        
        // Report critical violations to admins
        if violation.severity == RuleSeverity::Critical {
            self.report_critical_violation(&entry).await;
        }
        
        // Log to tracing
        match violation.severity {
            RuleSeverity::Mild => {
                debug!("Governance violation (mild): Agent {} attempted {:?}: {}", 
                      agent_id, action_type, violation.reason);
            },
            RuleSeverity::Moderate => {
                info!("Governance violation (moderate): Agent {} attempted {:?}: {}", 
                     agent_id, action_type, violation.reason);
            },
            RuleSeverity::Critical => {
                // Already logged in report_critical_violation
            },
        }
        
        Ok(())
    }
    
    async fn get_agent_violations(
        &self,
        agent_id: &str,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String> {
        let agent_key = format!("governance:violations:agent:{}", agent_id);
        let limit = limit.unwrap_or(100) as i64;
        
        let entries = match self.redis.lrange::<String>(&agent_key, 0, limit - 1).await {
            Ok(entries) => entries,
            Err(e) => return Err(format!("Failed to get violations for agent: {}", e)),
        };
        
        // Deserialize entries
        let mut result = Vec::with_capacity(entries.len());
        for entry_json in entries {
            match serde_json::from_str::<ViolationLogEntry>(&entry_json) {
                Ok(entry) => result.push(entry),
                Err(e) => {
                    error!("Failed to deserialize violation log entry: {}", e);
                    continue;
                }
            }
        }
        
        Ok(result)
    }
    
    async fn get_violations_by_severity(
        &self,
        severity: RuleSeverity,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String> {
        let severity_key = format!("governance:violations:severity:{}", severity);
        let limit = limit.unwrap_or(100) as i64;
        
        let entries = match self.redis.lrange::<String>(&severity_key, 0, limit - 1).await {
            Ok(entries) => entries,
            Err(e) => return Err(format!("Failed to get violations by severity: {}", e)),
        };
        
        // Deserialize entries
        let mut result = Vec::with_capacity(entries.len());
        for entry_json in entries {
            match serde_json::from_str::<ViolationLogEntry>(&entry_json) {
                Ok(entry) => result.push(entry),
                Err(e) => {
                    error!("Failed to deserialize violation log entry: {}", e);
                    continue;
                }
            }
        }
        
        Ok(result)
    }
    
    async fn get_all_violations(
        &self,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String> {
        let limit = limit.unwrap_or(100) as i64;
        
        let entries = match self.redis.lrange::<String>("governance:violations:all", 0, limit - 1).await {
            Ok(entries) => entries,
            Err(e) => return Err(format!("Failed to get all violations: {}", e)),
        };
        
        // Deserialize entries
        let mut result = Vec::with_capacity(entries.len());
        for entry_json in entries {
            match serde_json::from_str::<ViolationLogEntry>(&entry_json) {
                Ok(entry) => result.push(entry),
                Err(e) => {
                    error!("Failed to deserialize violation log entry: {}", e);
                    continue;
                }
            }
        }
        
        Ok(result)
    }
}

/// In-memory implementation of violation logger for testing
pub struct MockViolationLogger {
    /// In-memory storage for violations
    violations: Arc<RwLock<Vec<ViolationLogEntry>>>,
}

impl MockViolationLogger {
    /// Create a new mock violation logger
    pub fn new() -> Self {
        Self {
            violations: Arc::new(RwLock::new(Vec::new())),
        }
    }
}

#[async_trait]
impl ViolationLogger for MockViolationLogger {
    async fn log_violation(
        &self,
        agent_id: &str,
        action_type: &GovernanceActionType,
        violation: &RuleViolation
    ) -> Result<(), String> {
        let entry = ViolationLogEntry {
            agent_id: agent_id.to_string(),
            action_type: action_type.clone(),
            violation: violation.clone(),
            logged_at: Utc::now(),
            notified_admins: false,
        };
        
        // Log to the console
        match violation.severity {
            RuleSeverity::Mild => {
                debug!("Mock: Governance violation (mild): Agent {} attempted {:?}: {}", 
                      agent_id, action_type, violation.reason);
            },
            RuleSeverity::Moderate => {
                info!("Mock: Governance violation (moderate): Agent {} attempted {:?}: {}", 
                     agent_id, action_type, violation.reason);
            },
            RuleSeverity::Critical => {
                warn!("Mock: CRITICAL GOVERNANCE VIOLATION: Agent {} attempted {:?}: {}", 
                     agent_id, action_type, violation.reason);
            },
        }
        
        // Add to in-memory storage
        let mut violations = self.violations.write().unwrap();
        violations.push(entry);
        
        Ok(())
    }
    
    async fn get_agent_violations(
        &self,
        agent_id: &str,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String> {
        let violations = self.violations.read().unwrap();
        let mut result = violations.iter()
            .filter(|e| e.agent_id == agent_id)
            .cloned()
            .collect::<Vec<_>>();
        
        // Sort by logged_at, newest first
        result.sort_by(|a, b| b.logged_at.cmp(&a.logged_at));
        
        // Apply limit
        if let Some(limit) = limit {
            if result.len() > limit {
                result.truncate(limit);
            }
        }
        
        Ok(result)
    }
    
    async fn get_violations_by_severity(
        &self,
        severity: RuleSeverity,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String> {
        let violations = self.violations.read().unwrap();
        let mut result = violations.iter()
            .filter(|e| e.violation.severity == severity)
            .cloned()
            .collect::<Vec<_>>();
        
        // Sort by logged_at, newest first
        result.sort_by(|a, b| b.logged_at.cmp(&a.logged_at));
        
        // Apply limit
        if let Some(limit) = limit {
            if result.len() > limit {
                result.truncate(limit);
            }
        }
        
        Ok(result)
    }
    
    async fn get_all_violations(
        &self,
        limit: Option<usize>
    ) -> Result<Vec<ViolationLogEntry>, String> {
        let violations = self.violations.read().unwrap();
        let mut result = violations.clone();
        
        // Sort by logged_at, newest first
        result.sort_by(|a, b| b.logged_at.cmp(&a.logged_at));
        
        // Apply limit
        if let Some(limit) = limit {
            if result.len() > limit {
                result.truncate(limit);
            }
        }
        
        Ok(result)
    }
} 