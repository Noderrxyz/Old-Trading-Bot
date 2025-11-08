// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

use std::collections::HashMap;
use std::fmt;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use async_trait::async_trait;

/// Types of actions that can be governed by meta-protocol rules
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GovernanceActionType {
    /// Voting on proposals
    Vote,
    /// Proposing new changes
    Propose,
    /// Executing strategies and trades
    Execute,
    /// Overriding a system decision
    Override,
    /// Accessing treasury funds
    Treasury,
    /// Administrative actions
    Admin,
}

impl fmt::Display for GovernanceActionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GovernanceActionType::Vote => write!(f, "vote"),
            GovernanceActionType::Propose => write!(f, "propose"),
            GovernanceActionType::Execute => write!(f, "execute"),
            GovernanceActionType::Override => write!(f, "override"),
            GovernanceActionType::Treasury => write!(f, "treasury"),
            GovernanceActionType::Admin => write!(f, "admin"),
        }
    }
}

/// Severity levels for rule violations
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleSeverity {
    /// Low severity - warning only
    Mild,
    /// Medium severity - may require attention
    Moderate,
    /// High severity - critical violation
    Critical,
}

impl fmt::Display for RuleSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RuleSeverity::Mild => write!(f, "mild"),
            RuleSeverity::Moderate => write!(f, "moderate"),
            RuleSeverity::Critical => write!(f, "critical"),
        }
    }
}

/// Details about a governance rule violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleViolation {
    /// Human-readable reason for the violation
    pub reason: String,
    /// Severity level of the violation
    pub severity: RuleSeverity,
    /// Error code for the violation
    pub code: String,
    /// Additional context for the violation
    pub context: Option<HashMap<String, serde_json::Value>>,
    /// Timestamp when the violation occurred
    pub timestamp: DateTime<Utc>,
}

impl RuleViolation {
    /// Create a new rule violation
    pub fn new(reason: String, severity: RuleSeverity, code: String) -> Self {
        Self {
            reason,
            severity,
            code,
            context: None,
            timestamp: Utc::now(),
        }
    }

    /// Add context to the violation
    pub fn with_context(mut self, key: &str, value: serde_json::Value) -> Self {
        let context = self.context.get_or_insert_with(HashMap::new);
        context.insert(key.to_string(), value);
        self
    }
}

/// Result of a governance enforcement check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnforcementResult {
    /// Whether the action is allowed by governance rules
    pub allowed: bool,
    /// List of rule violations that occurred
    pub violations: Vec<RuleViolation>,
    /// Agent/entity that was checked
    pub agent_id: String,
    /// Action type that was checked
    pub action_type: GovernanceActionType,
    /// Timestamp of the check
    pub timestamp: DateTime<Utc>,
}

impl EnforcementResult {
    /// Create a new successful enforcement result
    pub fn success(agent_id: String, action_type: GovernanceActionType) -> Self {
        Self {
            allowed: true,
            violations: Vec::new(),
            agent_id,
            action_type,
            timestamp: Utc::now(),
        }
    }

    /// Create a new failed enforcement result with violations
    pub fn failure(agent_id: String, action_type: GovernanceActionType, violations: Vec<RuleViolation>) -> Self {
        Self {
            allowed: false,
            violations,
            agent_id,
            action_type,
            timestamp: Utc::now(),
        }
    }

    /// Add a violation to the result
    pub fn add_violation(&mut self, violation: RuleViolation) {
        self.allowed = false;
        self.violations.push(violation);
    }
}

/// A governance rule that can be enforced on system actions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceRule {
    /// Unique identifier for the rule
    pub id: String,
    /// Human-readable label for the rule
    pub label: String,
    /// Description of what the rule enforces
    pub description: Option<String>,
    /// Types of actions this rule applies to
    pub applies_to: Vec<GovernanceActionType>,
    /// Whether the rule is currently active
    pub active: bool,
    /// When the rule was created
    pub created_at: DateTime<Utc>,
    /// When the rule was last updated
    pub updated_at: DateTime<Utc>,
    /// Implementation details (serialized function or evaluation logic)
    pub implementation: String,
    /// Optional parameters for the rule
    pub parameters: Option<HashMap<String, serde_json::Value>>,
}

/// Trait for governance rule enforcement
#[async_trait]
pub trait RuleCheckFn: Send + Sync {
    /// Check if an action complies with this rule
    async fn check(
        &self,
        agent_id: &str,
        action_type: &GovernanceActionType,
        context: &HashMap<String, serde_json::Value>,
    ) -> Result<bool, RuleViolation>;
}

/// Trait for governance rule serialization
pub trait RuleSerializer: Send + Sync {
    /// Serialize a rule check function to string
    fn serialize_rule(&self, rule_check: &dyn RuleCheckFn) -> Result<String, String>;
    
    /// Deserialize a rule check function from string
    fn deserialize_rule(&self, serialized: &str) -> Result<Box<dyn RuleCheckFn>, String>;
} 