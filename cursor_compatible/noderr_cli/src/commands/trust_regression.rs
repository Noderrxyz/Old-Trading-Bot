use anyhow::{Result, Context};
use chrono::{DateTime, Duration, Utc};
use clap::{Args, Subcommand};
use colored::Colorize;
use comfy_table::{Cell, ContentArrangement, Row, Table};
use noderr_core::redis::RedisClient;
use noderr_core::trust_score_engine::TrustScoreEngine;
use noderr_core::trust_decay_service::TrustDecayService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use uuid::Uuid;

// ===============================================================
// CLI COMMAND STRUCTURES
// ===============================================================

#[derive(Debug, Args)]
pub struct TrustRegressionCommand {
    #[command(subcommand)]
    pub subcommand: TrustRegressionSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum TrustRegressionSubcommand {
    /// Analyze trust score regression for an agent
    Analyze(AnalyzeArgs),
    
    /// Explain details of a specific regression event
    Explain(ExplainArgs),
    
    /// Configure trust regression detection parameters
    Configure(ConfigureArgs),
    
    /// List recent trust regression events
    List(ListArgs),
    
    /// Analyze attribution factors for a regression event
    Attribution(AttributionArgs),
    
    /// Generate a comprehensive report for a regression event
    Report(ReportArgs),
}

#[derive(Debug, Args)]
pub struct AnalyzeArgs {
    /// Agent ID to analyze
    #[arg(long)]
    pub agent_id: String,
    
    /// Time period to look back (e.g., "10min", "1h", "1d")
    #[arg(long, default_value = "1h")]
    pub since: String,
    
    /// Minimum trust score drop to consider (percentage)
    #[arg(long, default_value = "5.0")]
    pub min_drop: f64,
    
    /// Include detailed context information
    #[arg(long)]
    pub detailed: bool,
    
    /// Output format (text, json)
    #[arg(long, default_value = "text")]
    pub format: String,
    
    /// Output file path
    #[arg(long)]
    pub output: Option<String>,
    
    #[arg(long, help = "Filter by agent ID")]
    agent_id_filter: Option<String>,
    
    #[arg(long, help = "Filter by minimum drop percentage")]
    min_drop_filter: Option<f32>,
    
    #[arg(long, help = "Display raw event data")]
    raw: bool,
    
    #[arg(long, help = "Filter for events with bio-signal anomalies")]
    bio_signal: bool,
}

#[derive(Debug, Args)]
pub struct ExplainArgs {
    /// Regression event ID to explain
    #[arg(long)]
    pub event_id: String,
    
    /// Include detailed analysis of each factor
    #[arg(long)]
    pub detailed: bool,
}

#[derive(Debug, Args)]
pub struct ConfigureArgs {
    /// Default minimum drop percentage to trigger detection
    #[arg(long)]
    pub threshold: Option<f64>,
    
    /// Time window for drop detection in minutes
    #[arg(long)]
    pub window: Option<u32>,
    
    /// Buffer size for trust score history per agent
    #[arg(long)]
    pub buffer_size: Option<u32>,
    
    /// Enable automatic regression detection
    #[arg(long)]
    pub enable: Option<bool>,
    
    /// Enable automatic report generation
    #[arg(long)]
    pub auto_report: Option<bool>,
    
    /// Reset configuration to defaults
    #[arg(long)]
    pub reset: bool,
    
    /// View current configuration
    #[arg(long)]
    pub view: bool,
}

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Agent ID to filter events (optional)
    #[arg(long)]
    pub agent_id: Option<String>,
    
    /// Number of events to display
    #[arg(long, default_value = "10")]
    pub limit: usize,
    
    /// Minimum severity level (1-5)
    #[arg(long, default_value = "1")]
    pub min_severity: u8,
}

#[derive(Debug, Args)]
pub struct AttributionArgs {
    /// Regression event ID to analyze
    #[arg(long)]
    pub event_id: String,
    
    /// Include detailed reasons for each attribution category
    #[arg(long)]
    pub detailed: bool,
    
    /// Output format (text, json)
    #[arg(long, default_value = "text")]
    pub format: String,
    
    /// Output file path
    #[arg(long)]
    pub output: Option<String>,
}

#[derive(Debug, Args)]
pub struct ReportArgs {
    /// Agent ID (Optional if event_id is provided)
    #[arg(long)]
    pub agent_id: Option<String>,
    
    /// Regression event ID to report on
    #[arg(long)]
    pub event_id: String,
    
    /// Output format (text, json, markdown)
    #[arg(long, default_value = "text")]
    pub format: String,
    
    /// Output file path
    #[arg(long)]
    pub output: Option<String>,
    
    /// Store report in Redis
    #[arg(long)]
    pub store: bool,
}

// ===============================================================
// 28.B.1 - TRUST DROP TRIGGER ENGINE
// ===============================================================

/// Fires when trust drops > X% within Y minutes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDropTrigger {
    pub id: String,
    pub agent_id: String,
    pub previous_trust: f64,
    pub current_trust: f64,
    pub timestamp: i64,
    pub delta: f64,
    pub threshold: f64,
    pub detection_window_minutes: u32,
}

impl TrustDropTrigger {
    pub fn new(
        agent_id: String,
        previous_trust: f64,
        current_trust: f64,
        threshold: f64,
        detection_window_minutes: u32,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            agent_id,
            previous_trust,
            current_trust,
            timestamp: Utc::now().timestamp(),
            delta: previous_trust - current_trust,
            threshold,
            detection_window_minutes,
        }
    }
    
    pub fn percentage_drop(&self) -> f64 {
        if self.previous_trust <= 0.0 {
            return 0.0;
        }
        (self.delta / self.previous_trust) * 100.0
    }
    
    pub fn severity(&self) -> u8 {
        let drop_pct = self.percentage_drop();
        if drop_pct >= 25.0 {
            5 // Critical
        } else if drop_pct >= 15.0 {
            4 // High
        } else if drop_pct >= 10.0 {
            3 // Medium
        } else if drop_pct >= 5.0 {
            2 // Low
        } else {
            1 // Minor
        }
    }
}

/// Detection engine for trust drops 
pub fn detect_trust_drop(
    agent_id: &str,
    prev: f64,
    curr: f64,
    threshold: f64,
    window_minutes: u32,
) -> Option<TrustDropTrigger> {
    let delta = prev - curr;
    let percentage_drop = if prev > 0.0 { (delta / prev) * 100.0 } else { 0.0 };
    
    if percentage_drop > threshold {
        Some(TrustDropTrigger::new(
            agent_id.to_string(),
            prev,
            curr,
            threshold,
            window_minutes,
        ))
    } else {
        None
    }
}

/// Configuration for the trust regression analyzer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustRegressionConfig {
    pub enabled: bool,
    pub default_threshold_percentage: f64,
    pub detection_window_minutes: u32,
    pub history_buffer_size: u32,
    pub store_days: u32,
    pub agent_thresholds: HashMap<String, f64>,
    pub auto_report_generation: bool,
}

impl Default for TrustRegressionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_threshold_percentage: 5.0,
            detection_window_minutes: 10,
            history_buffer_size: 50,
            store_days: 30,
            agent_thresholds: HashMap::new(),
            auto_report_generation: true,
        }
    }
}

// ===============================================================
// 28.B.2 - REGRESSION PATH BUILDER
// ===============================================================

/// Enum to categorize agent events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentEventType {
    TrustUpdate,
    StrategyExecution,
    MemoryAccess,
    RoleChange,
    DecisionMade,
    AnomalyDetected,
    HealingAttempt,
    ConfigChange,
    Other(String),
}

/// Represents a single event in an agent's timeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub id: String,
    pub agent_id: String,
    pub timestamp: String,
    pub event_type: AgentEventType,
    pub description: String,
    pub metadata: HashMap<String, String>,
    pub tags: Vec<String>,
}

/// Represents a node in an agent's reasoning process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasonNode {
    pub id: String,
    pub agent_id: String,
    pub timestamp: String,
    pub reasoning: String,
    pub confidence: f64,
    pub dependencies: Vec<String>,
    pub outcome: String,
}

/// Represents changes to an agent's memory between two points in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryDiff {
    pub shard_id: String,
    pub before_hash: String,
    pub after_hash: String,
    pub changed_keys: Vec<String>,
    pub added_keys: Vec<String>,
    pub removed_keys: Vec<String>,
    pub key_diffs: HashMap<String, (Option<String>, Option<String>)>,
}

/// Represents a complete trust regression path
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustRegressionPath {
    pub id: String,
    pub agent_id: String,
    pub triggered_at: i64,
    pub previous_score: f64,
    pub current_score: f64,
    pub drop_percentage: f64,
    pub severity: u8, // 1-5
    pub event_chain: Vec<AgentEvent>,
    pub anomalies: Vec<crate::commands::agent_anomaly_monitor::AnomalyEvent>,
    pub recent_reasons: Vec<ReasonNode>,
    pub memory_diff: Option<MemoryDiff>,
    pub tags: Vec<String>,
    pub explanation: Option<String>,
    pub attribution: Option<Vec<AttributionScore>>,
}

/// Represents a weighted blame score for a category of trust regression
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributionScore {
    pub category: AttributionCategory,
    pub score: f64,
    pub reasons: Vec<String>,
}

/// Categories for attribution scores that identify causes of trust regression
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AttributionCategory {
    StrategyFailure,
    MemoryCorruption,
    RoleConflict,
    TrustDecayFlag,
    AnomalySpike,
    DelayedReaction,
    ReasonDrift,
    NetworkLatency,
    DecisionContradiction,
    UnauthorizedAccess,
    PoorPerformance,
    PolicyViolation,
}

// ===============================================================
// 28.B.4 - REGRESSION REPORT GENERATOR
// ===============================================================

/// A complete narrative and data audit of a trust regression event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustRegressionReport {
    pub agent_id: String,
    pub event_id: String,
    pub timestamp: i64,
    pub summary: String,
    pub causes: Vec<AttributionScore>,
    pub timeline: Vec<String>,
    pub memory_diff: Option<MemoryDiff>,
    pub reasoning_trace: Vec<String>,
    pub verdict: String,
    pub severity: u8,
    pub previous_score: f64,
    pub current_score: f64,
    pub drop_percentage: f64,
}

/// Analyzes a trust regression path and scores the likely causes of the trust drop
pub fn score_regression(path: &TrustRegressionPath) -> Vec<AttributionScore> {
    let mut scores: HashMap<AttributionCategory, Vec<String>> = HashMap::new();

    // Strategy failures
    let strategy_failures = path.event_chain.iter().filter(|e| 
        matches!(e.event_type, AgentEventType::StrategyExecution) && 
        (e.description.contains("failed") || e.description.contains("error"))
    ).count();
    
    if strategy_failures > 0 {
        scores.entry(AttributionCategory::StrategyFailure)
            .or_insert_with(Vec::new)
            .push(format!("{} strategy execution failures detected", strategy_failures));
    }
    
    // Strategy oscillation (alternating strategies)
    let mut prev_strategy: Option<&str> = None;
    let mut strategy_changes = 0;
    
    for event in path.event_chain.iter().filter(|e| matches!(e.event_type, AgentEventType::StrategyExecution)) {
        if let Some(strategy) = event.metadata.get("strategy") {
            if let Some(prev) = prev_strategy {
                if prev != strategy {
                    strategy_changes += 1;
                }
            }
            prev_strategy = Some(strategy);
        }
    }
    
    if strategy_changes >= 3 {
        scores.entry(AttributionCategory::StrategyFailure)
            .or_insert_with(Vec::new)
            .push(format!("Strategy oscillation detected with {} changes", strategy_changes));
    }

    // Anomaly spikes
    if path.anomalies.len() > 2 {
        scores.entry(AttributionCategory::AnomalySpike)
            .or_insert_with(Vec::new)
            .push(format!("Multiple concurrent anomalies detected: {}", path.anomalies.len()));
        
        // Group anomalies by type
        let mut anomaly_types = HashMap::new();
        for anomaly in &path.anomalies {
            *anomaly_types.entry(&anomaly.anomaly_type).or_insert(0) += 1;
        }
        
        for (anomaly_type, count) in anomaly_types {
            scores.entry(AttributionCategory::AnomalySpike)
                .or_insert_with(Vec::new)
                .push(format!("{} instances of {} anomalies", count, anomaly_type));
        }
    }

    // Memory diff analysis
    if let Some(diff) = &path.memory_diff {
        if !diff.removed_keys.is_empty() {
            scores.entry(AttributionCategory::MemoryCorruption)
                .or_insert_with(Vec::new)
                .push(format!("Lost memory keys: {}", diff.removed_keys.join(", ")));
        }
        
        if !diff.changed_keys.is_empty() {
            scores.entry(AttributionCategory::MemoryCorruption)
                .or_insert_with(Vec::new)
                .push(format!("Modified memory keys: {}", diff.changed_keys.join(", ")));
        }
        
        // Look for trust-related memory changes
        for key in &diff.changed_keys {
            if key.contains("trust") && diff.key_diffs.contains_key(key) {
                if let Some((before, after)) = diff.key_diffs.get(key) {
                    scores.entry(AttributionCategory::TrustDecayFlag)
                        .or_insert_with(Vec::new)
                        .push(format!("Trust parameter change: {} from '{}' to '{}'", 
                            key, 
                            before.as_deref().unwrap_or("null"),
                            after.as_deref().unwrap_or("null")));
                }
            }
        }
    }

    // Role conflict
    let role_changes = path.event_chain.iter()
        .filter(|e| matches!(e.event_type, AgentEventType::RoleChange))
        .collect::<Vec<_>>();
    
    if !role_changes.is_empty() {
        let revocations = role_changes.iter()
            .filter(|e| e.description.contains("revoked"))
            .count();
        
        if revocations > 0 {
            scores.entry(AttributionCategory::RoleConflict)
                .or_insert_with(Vec::new)
                .push(format!("{} role revocations detected", revocations));
        }
        
        for event in role_changes {
            if let (Some(prev), Some(new)) = (
                event.metadata.get("previous_role"),
                event.metadata.get("new_role")
            ) {
                scores.entry(AttributionCategory::RoleConflict)
                    .or_insert_with(Vec::new)
                    .push(format!("Role changed from '{}' to '{}'", prev, new));
            }
        }
    }

    // Reason drift analysis
    if !path.recent_reasons.is_empty() {
        // Look for low confidence reasoning
        let low_confidence_reasons = path.recent_reasons.iter()
            .filter(|r| r.confidence < 0.6)
            .count();
        
        if low_confidence_reasons > 0 {
            scores.entry(AttributionCategory::ReasonDrift)
                .or_insert_with(Vec::new)
                .push(format!("{} instances of low confidence reasoning", low_confidence_reasons));
        }
        
        // Look for contradictions or uncertainty in reasoning text
        for reason in &path.recent_reasons {
            if reason.reasoning.contains("contradiction") || 
               reason.reasoning.contains("uncertain") ||
               reason.reasoning.contains("conflicting") {
                scores.entry(AttributionCategory::ReasonDrift)
                    .or_insert_with(Vec::new)
                    .push(format!("Reasoning contradiction detected: '{}'", 
                                 reason.reasoning.chars().take(50).collect::<String>() + "..."));
            }
        }
    }

    // Decision contradictions
    let decision_events = path.event_chain.iter()
        .filter(|e| matches!(e.event_type, AgentEventType::DecisionMade))
        .collect::<Vec<_>>();
    
    let mut decisions_by_context: HashMap<&str, Vec<&str>> = HashMap::new();
    for event in decision_events {
        if let (Some(context), Some(decision)) = (
            event.metadata.get("context"),
            event.metadata.get("decision")
        ) {
            decisions_by_context.entry(context)
                .or_insert_with(Vec::new)
                .push(decision);
        }
    }
    
    for (context, decisions) in decisions_by_context {
        if decisions.len() > 1 {
            let mut unique_decisions = decisions.clone();
            unique_decisions.sort();
            unique_decisions.dedup();
            
            if unique_decisions.len() > 1 {
                scores.entry(AttributionCategory::DecisionContradiction)
                    .or_insert_with(Vec::new)
                    .push(format!("Context '{}' had contradictory decisions: {}", 
                                 context, unique_decisions.join(" → ")));
            }
        }
    }

    // Unauthorized access
    let unauthorized_access = path.event_chain.iter()
        .filter(|e| 
            matches!(e.event_type, AgentEventType::MemoryAccess) && 
            (e.description.contains("denied") || e.description.contains("blocked"))
        )
        .count();
    
    if unauthorized_access > 0 {
        scores.entry(AttributionCategory::UnauthorizedAccess)
            .or_insert_with(Vec::new)
            .push(format!("{} instances of unauthorized access attempts", unauthorized_access));
    }

    // Trust decay flags
    let trust_penalties = path.event_chain.iter()
        .filter(|e| 
            matches!(e.event_type, AgentEventType::TrustUpdate) && 
            e.description.contains("penalty")
        )
        .collect::<Vec<_>>();
    
    if !trust_penalties.is_empty() {
        scores.entry(AttributionCategory::TrustDecayFlag)
            .or_insert_with(Vec::new)
            .push(format!("{} trust penalties applied", trust_penalties.len()));
        
        for event in trust_penalties {
            if let Some(reason) = event.metadata.get("reason") {
                scores.entry(AttributionCategory::TrustDecayFlag)
                    .or_insert_with(Vec::new)
                    .push(format!("Trust penalty reason: {}", reason));
            }
        }
    }
    
    // Performance issues
    let performance_issues = path.event_chain.iter()
        .filter(|e| 
            e.description.to_lowercase().contains("performance") || 
            e.description.to_lowercase().contains("timeout") ||
            e.description.to_lowercase().contains("slow")
        )
        .count();
    
    if performance_issues > 0 {
        scores.entry(AttributionCategory::PoorPerformance)
            .or_insert_with(Vec::new)
            .push(format!("{} performance-related issues detected", performance_issues));
    }

    // Policy violations
    let policy_violations = path.event_chain.iter()
        .filter(|e| 
            e.description.to_lowercase().contains("policy") || 
            e.description.to_lowercase().contains("violation") ||
            e.description.to_lowercase().contains("breach")
        )
        .count();
    
    if policy_violations > 0 {
        scores.entry(AttributionCategory::PolicyViolation)
            .or_insert_with(Vec::new)
            .push(format!("{} policy violations detected", policy_violations));
    }

    // Convert to final scoring model with weighted scores
    let mut attribution_scores: Vec<AttributionScore> = scores.into_iter().map(|(category, reasons)| {
        // Base weight is the number of reasons
        let base_weight = reasons.len() as f64;
        
        // Adjust weight based on category importance
        let category_multiplier = match category {
            AttributionCategory::AnomalySpike => 1.5,       // Anomalies are strong indicators
            AttributionCategory::TrustDecayFlag => 2.0,     // Direct trust penalties are very significant
            AttributionCategory::RoleConflict => 1.8,       // Role revocations are serious
            AttributionCategory::PolicyViolation => 1.7,    // Policy violations are serious
            AttributionCategory::StrategyFailure => 1.3,    // Strategy issues are moderately serious
            AttributionCategory::DecisionContradiction => 1.4, // Decision contradictions indicate reasoning issues
            AttributionCategory::MemoryCorruption => 1.2,   // Memory issues can be consequential
            _ => 1.0,                                      // Default multiplier
        };
        
        AttributionScore {
            category,
            score: base_weight * 10.0 * category_multiplier, // Weighted scoring
            reasons,
        }
    }).collect();
    
    // Sort by score in descending order
    attribution_scores.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    
    attribution_scores
}

/// Generates a comprehensive human-readable report from a regression path
pub fn generate_report(path: &TrustRegressionPath) -> TrustRegressionReport {
    // Get attribution scores if not already computed
    let attribution = if let Some(attr) = &path.attribution {
        attr.clone()
    } else {
        score_regression(path)
    };
    
    let timestamp = path.triggered_at;
    let agent_id = path.agent_id.clone();
    
    // Generate summary
    let summary = format!(
        "Agent {} experienced a trust score drop of {:.2}% at {}. The score decreased from {:.4} to {:.4}. {} primary attribution factors identified.",
        agent_id,
        path.drop_percentage,
        timestamp_to_datetime(timestamp).format("%Y-%m-%d %H:%M:%S"),
        path.previous_score,
        path.current_score,
        attribution.len()
    );
    
    // Build timeline of events
    let mut timeline = Vec::new();
    for event in &path.event_chain {
        let timestamp = match DateTime::parse_from_rfc3339(&event.timestamp) {
            Ok(dt) => dt.with_timezone(&Utc).format("%Y-%m-%d %H:%M:%S").to_string(),
            Err(_) => event.timestamp.clone(),
        };
        
        timeline.push(format!(
            "{} – {} – {}",
            timestamp,
            format_event_type(&event.event_type),
            event.description
        ));
    }
    
    // Extract reasoning trace
    let reasoning_trace: Vec<String> = path.recent_reasons
        .iter()
        .map(|r| {
            let timestamp = match DateTime::parse_from_rfc3339(&r.timestamp) {
                Ok(dt) => dt.with_timezone(&Utc).format("%Y-%m-%d %H:%M:%S").to_string(),
                Err(_) => r.timestamp.clone(),
            };
            
            format!(
                "🧠 {} (Confidence: {:.2}) – {}",
                timestamp,
                r.confidence,
                r.reasoning
            )
        })
        .collect();
    
    // Generate verdict
    let mut verdict = String::new();
    
    // Find the top causes (those with highest attribution scores)
    if !attribution.is_empty() {
        let total_score: f64 = attribution.iter().map(|a| a.score).sum();
        let top_cause = &attribution[0]; // Already sorted in score_regression
        
        let primary_percentage = if total_score > 0.0 {
            (top_cause.score / total_score) * 100.0
        } else {
            0.0
        };
        
        verdict.push_str(&format!(
            "Primary failure attributed to {} with {:.1}% contribution.\n\n",
            format_attribution_category(&top_cause.category),
            primary_percentage
        ));
        
        // Add more context based on the top 3 causes
        for (i, cause) in attribution.iter().take(3).enumerate() {
            if !cause.reasons.is_empty() {
                let main_reason = &cause.reasons[0];
                verdict.push_str(&format!("{}. {}\n", i + 1, main_reason));
            }
        }
        
        // Add explanation from path if available
        if let Some(explanation) = &path.explanation {
            verdict.push_str(&format!("\nOverall: {}", explanation));
        }
    } else {
        verdict = "No clear attribution factors identified. The trust drop may have been caused by external factors or cumulative minor issues.".to_string();
    }
    
    // Create the final report
    TrustRegressionReport {
        agent_id,
        event_id: path.id.clone(),
        timestamp,
        summary,
        causes: attribution,
        timeline,
        memory_diff: path.memory_diff.clone(),
        reasoning_trace,
        verdict,
        severity: path.severity,
        previous_score: path.previous_score,
        current_score: path.current_score,
        drop_percentage: path.drop_percentage,
    }
}

/// Exports a regression report to JSON format
pub fn export_report_json(report: &TrustRegressionReport) -> Result<String> {
    Ok(serde_json::to_string_pretty(report)?)
}

/// Exports a regression report to Markdown format
pub fn export_report_markdown(report: &TrustRegressionReport) -> String {
    let mut md = String::new();
    
    // Header
    md.push_str(&format!("# Trust Regression Report – Agent {}\n\n", report.agent_id));
    md.push_str(&format!("> Event ID: {}\n", report.event_id));
    md.push_str(&format!("> Timestamp: {}\n", timestamp_to_datetime(report.timestamp).format("%Y-%m-%d %H:%M:%S")));
    md.push_str(&format!("> Severity: {}\n\n", severity_to_string(report.severity)));
    
    // Summary
    md.push_str(&format!("## 🧩 Summary\n{}\n\n", report.summary));
    
    // Trust Score Details
    md.push_str("## 📉 Trust Score Change\n");
    md.push_str(&format!("- Previous Score: **{:.4}**\n", report.previous_score));
    md.push_str(&format!("- Current Score: **{:.4}**\n", report.current_score));
    md.push_str(&format!("- Drop Percentage: **{:.2}%**\n\n", report.drop_percentage));
    
    // Attribution Causes
    md.push_str("## 📊 Attribution Factors\n");
    if report.causes.is_empty() {
        md.push_str("No clear attribution factors identified.\n\n");
    } else {
        let total_score: f64 = report.causes.iter().map(|a| a.score).sum();
        
        for cause in &report.causes {
            let percentage = if total_score > 0.0 { (cause.score / total_score) * 100.0 } else { 0.0 };
            
            md.push_str(&format!(
                "### {} (Score: {:.1}, {:.1}%)\n",
                format_attribution_category(&cause.category),
                cause.score,
                percentage
            ));
            
            for reason in &cause.reasons {
                md.push_str(&format!("- {}\n", reason));
            }
            md.push_str("\n");
        }
    }
    
    // Memory Diff
    if let Some(diff) = &report.memory_diff {
        md.push_str("## 🧠 Memory Changes\n");
        
        if !diff.changed_keys.is_empty() {
            md.push_str("### Changed Keys\n");
            for key in &diff.changed_keys {
                if let Some((before, after)) = diff.key_diffs.get(key) {
                    md.push_str(&format!(
                        "- `{}`: '{}' → '{}'\n",
                        key,
                        before.as_deref().unwrap_or("null"),
                        after.as_deref().unwrap_or("null")
                    ));
                }
            }
            md.push_str("\n");
        }
        
        if !diff.added_keys.is_empty() {
            md.push_str("### Added Keys\n");
            for key in &diff.added_keys {
                md.push_str(&format!("- `{}`\n", key));
            }
            md.push_str("\n");
        }
        
        if !diff.removed_keys.is_empty() {
            md.push_str("### Removed Keys\n");
            for key in &diff.removed_keys {
                md.push_str(&format!("- `{}`\n", key));
            }
            md.push_str("\n");
        }
    }
    
    // Reasoning Trace
    md.push_str("## 🧠 Recent Reasoning\n");
    if report.reasoning_trace.is_empty() {
        md.push_str("No recent reasoning traces available.\n\n");
    } else {
        for trace in &report.reasoning_trace {
            md.push_str(&format!("- {}\n", trace));
        }
        md.push_str("\n");
    }
    
    // Timeline
    md.push_str("## ⏱️ Event Timeline\n");
    if report.timeline.is_empty() {
        md.push_str("No event timeline available.\n\n");
    } else {
        for event in &report.timeline {
            md.push_str(&format!("- {}\n", event));
        }
        md.push_str("\n");
    }
    
    // Verdict
    md.push_str(&format!("## ✅ Final Verdict\n{}\n", report.verdict));
    
    md
}

impl TrustRegressionPath {
    pub fn new(trigger: &TrustDropTrigger) -> Self {
        Self {
            id: trigger.id.clone(),
            agent_id: trigger.agent_id.clone(),
            triggered_at: trigger.timestamp,
            previous_score: trigger.previous_trust,
            current_score: trigger.current_trust,
            drop_percentage: trigger.percentage_drop(),
            severity: trigger.severity(),
            event_chain: Vec::new(),
            anomalies: Vec::new(),
            recent_reasons: Vec::new(),
            memory_diff: None,
            tags: Vec::new(),
            explanation: None,
            attribution: None,
        }
    }
    
    pub fn add_tag(&mut self, tag: &str) {
        if !self.tags.contains(&tag.to_string()) {
            self.tags.push(tag.to_string());
        }
    }
}

// ===============================================================
// MAIN COMMAND HANDLING FUNCTIONS
// ===============================================================

/// Main entry point for the trust regression command
pub async fn run_trust_regression_command(
    command: &TrustRegressionCommand, 
    redis_client: Arc<RedisClient>,
    trust_engine: Arc<dyn TrustScoreEngine>,
    decay_service: Arc<dyn TrustDecayService>
) -> Result<()> {
    match &command.subcommand {
        TrustRegressionSubcommand::Analyze(args) => {
            analyze_regression(args, &redis_client, &*trust_engine).await
        },
        TrustRegressionSubcommand::Explain(args) => {
            explain_regression(args, &redis_client).await
        },
        TrustRegressionSubcommand::Configure(args) => {
            configure_regression(args, &redis_client).await
        },
        TrustRegressionSubcommand::List(args) => {
            list_regressions(args, &redis_client).await
        },
        TrustRegressionSubcommand::Attribution(args) => {
            analyze_attribution(args, &redis_client).await
        },
        TrustRegressionSubcommand::Report(args) => {
            generate_regression_report(args, &redis_client).await
        },
    }
}

/// Analyze trust regression for a specific agent
pub async fn analyze_regression(
    args: &AnalyzeArgs, 
    redis_client: &RedisClient,
    trust_engine: &dyn TrustScoreEngine
) -> Result<()> {
    println!("{}", "Trust Regression Analysis".bold().green());
    println!("Agent ID: {}", args.agent_id);
    
    // Parse the time period
    let since = parse_time_period(&args.since)?;
    println!("Time period: Last {}", humanize_duration(&since));
    
    // Get current trust score
    let current_score = trust_engine.get_trust_score(&args.agent_id).await
        .context("Failed to fetch current trust score")?;
    
    println!("Current trust score: {:.4}", current_score.score);
    
    // Fetch trust score buffer
    let trust_history = fetch_trust_score_buffer(&args.agent_id, redis_client).await?;
    
    if trust_history.is_empty() {
        println!("No trust score history found for agent. Please wait for the agent to accumulate trust data.");
        return Ok(());
    }
    
    // Find significant drops
    let mut drops = Vec::new();
    let mut prev_score = trust_history[0].1;
    let mut prev_time = trust_history[0].0;
    
    for (ts, score) in trust_history.iter().skip(1) {
        let drop = prev_score - score;
        let pct_drop = if prev_score > 0.0 { (drop / prev_score) * 100.0 } else { 0.0 };
        
        if pct_drop >= args.min_drop {
            // Found a drop that exceeds threshold
            drops.push(TrustDropTrigger::new(
                args.agent_id.clone(),
                prev_score,
                *score,
                args.min_drop,
                duration_to_minutes(&(*ts - prev_time)),
            ));
        }
        
        prev_score = *score;
        prev_time = *ts;
    }
    
    if drops.is_empty() {
        println!("No significant trust drops detected within the specified period.");
        return Ok(());
    }
    
    // Sort by severity (most severe first)
    drops.sort_by(|a, b| b.severity().cmp(&a.severity()));
    
    // Display drops
    println!("\nDetected Trust Score Drops:");
    println!("-------------------------");
    
    let mut table = Table::new();
    table.set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Time", "Previous", "Current", "Drop", "Drop %", "Severity"
        ]);
    
    for drop in &drops {
        let severity_cell = match drop.severity() {
            5 => Cell::new("Critical").fg(comfy_table::Color::Red),
            4 => Cell::new("High").fg(comfy_table::Color::Red),
            3 => Cell::new("Medium").fg(comfy_table::Color::Yellow),
            2 => Cell::new("Low").fg(comfy_table::Color::Green),
            _ => Cell::new("Minor").fg(comfy_table::Color::Green),
        };
        
        table.add_row(vec![
            Cell::new(format!("{}", timestamp_to_datetime(drop.timestamp).format("%Y-%m-%d %H:%M:%S"))),
            Cell::new(format!("{:.4}", drop.previous_trust)),
            Cell::new(format!("{:.4}", drop.current_trust)),
            Cell::new(format!("{:.4}", drop.delta)),
            Cell::new(format!("{:.2}%", drop.percentage_drop())),
            severity_cell,
        ]);
    }
    
    println!("{}", table);
    
    // Analyze the most severe drop in detail
    if args.detailed && !drops.is_empty() {
        println!("\n{}", "Detailed Analysis of Most Severe Drop".bold().yellow());
        let most_severe = &drops[0];
        
        let path = build_regression_path(most_severe, redis_client).await?;
        
        // Display the regression path
        display_regression_path(&path, args.detailed);
        
        // Store the regression path
        store_regression_path(&path, redis_client).await?;
        
        // Generate output file if requested
        if let Some(output_path) = &args.output {
            match args.format.as_str() {
                "json" => {
                    let json = serde_json::to_string_pretty(&path)?;
                    std::fs::write(output_path, json)?;
                    println!("\nDetailed analysis saved to: {}", output_path);
                },
                _ => {
                    // Text output
                    let mut text = format!(
                        "Trust Regression Analysis\n\
                        Agent ID: {}\n\
                        Time: {}\n\
                        Previous Score: {:.4}\n\
                        Current Score: {:.4}\n\
                        Drop: {:.2}%\n\
                        Severity: {}\n\n",
                        path.agent_id,
                        timestamp_to_datetime(path.triggered_at).format("%Y-%m-%d %H:%M:%S"),
                        path.previous_score,
                        path.current_score,
                        path.drop_percentage,
                        severity_to_string(path.severity)
                    );
                    
                    if let Some(explanation) = &path.explanation {
                        text.push_str(&format!("Explanation: {}\n\n", explanation));
                    }
                    
                    text.push_str("Tagged Factors:\n");
                    for tag in &path.tags {
                        text.push_str(&format!("- {}\n", tag));
                    }
                    
                    text.push_str("\nEvent Timeline:\n");
                    for event in &path.event_chain {
                        text.push_str(&format!(
                            "[{}] {}: {}\n",
                            event.timestamp,
                            format_event_type(&event.event_type),
                            event.description
                        ));
                    }
                    
                    std::fs::write(output_path, text)?;
                    println!("\nDetailed analysis saved to: {}", output_path);
                }
            }
        }
    }
    
    Ok(())
}

/// Explain a specific trust regression event
pub async fn explain_regression(args: &ExplainArgs, redis_client: &RedisClient) -> Result<()> {
    println!("{}", "Trust Regression Explanation".bold().green());
    
    // Fetch the regression path
    let path = fetch_regression_path(&args.event_id, redis_client).await?
        .context(format!("Regression event with ID {} not found", args.event_id))?;
    
    // Display the regression path
    display_regression_path(&path, args.detailed);
    
    Ok(())
}

/// Configure trust regression detection parameters
pub async fn configure_regression(args: &ConfigureArgs, redis_client: &RedisClient) -> Result<()> {
    if args.reset {
        println!("{}", "Resetting trust regression configuration to defaults...".green());
        
        let default_config = TrustRegressionConfig::default();
        store_regression_config(&default_config, redis_client).await?;
        
        println!("Configuration reset complete.");
        display_regression_config(&default_config);
        return Ok(());
    }
    
    // Fetch current configuration
    let mut config = fetch_regression_config(redis_client).await?;
    
    if args.view {
        println!("{}", "Current Trust Regression Configuration:".green());
        display_regression_config(&config);
        return Ok(());
    }
    
    // Update configuration if options are specified
    let mut updated = false;
    
    if let Some(threshold) = args.threshold {
        println!("Setting default drop threshold to: {:.2}%", threshold);
        config.default_threshold_percentage = threshold;
        updated = true;
    }
    
    if let Some(window) = args.window {
        println!("Setting detection window to: {} minutes", window);
        config.detection_window_minutes = window;
        updated = true;
    }
    
    if let Some(buffer_size) = args.buffer_size {
        println!("Setting history buffer size to: {} entries", buffer_size);
        config.history_buffer_size = buffer_size;
        updated = true;
    }
    
    if let Some(enable) = args.enable {
        println!("{} trust regression detection", if enable { "Enabling" } else { "Disabling" });
        config.enabled = enable;
        updated = true;
    }
    
    if let Some(auto_report) = args.auto_report {
        println!("{} automatic report generation", if auto_report { "Enabling" } else { "Disabling" });
        config.auto_report_generation = auto_report;
        updated = true;
    }
    
    if updated {
        // Save the updated configuration
        store_regression_config(&config, redis_client).await?;
        
        println!("\n{}", "Updated configuration:".green());
        display_regression_config(&config);
    } else {
        println!("No configuration changes specified.");
    }
    
    Ok(())
}

/// List recent trust regression events
pub async fn list_regressions(args: &ListArgs, redis_client: &RedisClient) -> Result<()> {
    println!("{}", "Recent Trust Regression Events".bold().green());
    
    // Create the key pattern based on whether an agent_id filter is provided
    let key_pattern = if let Some(agent_id) = &args.agent_id {
        println!("Agent ID: {}", agent_id);
        format!("agent:{}:trust_regression:*", agent_id)
    } else {
        println!("All agents");
        "agent:*:trust_regression:*".to_string()
    };
    
    // Fetch matching keys from Redis
    let keys = redis_client.keys(&key_pattern)?;
    let mut events = Vec::new();
    
    // Process each key to retrieve regression events
    for key in keys {
        match redis_client.get::<String>(&key) {
            Ok(json) => {
                match serde_json::from_str::<TrustRegressionPath>(&json) {
                    Ok(path) => {
                        // Apply severity filter
                        if path.severity >= args.min_severity {
                            events.push(path);
                        }
                    },
                    Err(e) => {
                        eprintln!("Error parsing regression path from {}: {}", key, e);
                    }
                }
            },
            Err(e) => {
                eprintln!("Error retrieving regression path from {}: {}", key, e);
            }
        }
    }
    
    if events.is_empty() {
        println!("No regression events found matching the criteria.");
        return Ok(());
    }
    
    // Sort by timestamp (most recent first)
    events.sort_by(|a, b| b.triggered_at.cmp(&a.triggered_at));
    
    // Apply limit
    let events = events.into_iter().take(args.limit).collect::<Vec<_>>();
    
    // Display events
    let mut table = Table::new();
    table.set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![
            "Time", "Agent ID", "Previous", "Current", "Drop %", "Severity", "Tags", "ID"
        ]);
    
    for event in &events {
        let severity_cell = match event.severity {
            5 => Cell::new("Critical").fg(comfy_table::Color::Red),
            4 => Cell::new("High").fg(comfy_table::Color::Red),
            3 => Cell::new("Medium").fg(comfy_table::Color::Yellow),
            2 => Cell::new("Low").fg(comfy_table::Color::Green),
            _ => Cell::new("Minor").fg(comfy_table::Color::Green),
        };
        
        table.add_row(vec![
            Cell::new(format!("{}", timestamp_to_datetime(event.triggered_at).format("%Y-%m-%d %H:%M:%S"))),
            Cell::new(&event.agent_id),
            Cell::new(format!("{:.4}", event.previous_score)),
            Cell::new(format!("{:.4}", event.current_score)),
            Cell::new(format!("{:.2}%", event.drop_percentage)),
            severity_cell,
            Cell::new(event.tags.join(", ")),
            Cell::new(&event.id),
        ]);
    }
    
    println!("{}", table);
    println!("\nUse 'trust-regression explain --event-id <ID>' for detailed information about a specific event.");
    
    Ok(())
}

/// Analyze attribution factors for a specific regression event
pub async fn analyze_attribution(args: &AttributionArgs, redis_client: &RedisClient) -> Result<()> {
    println!("{}", "Trust Regression Attribution Analysis".bold().green());
    
    // Fetch the regression path
    let path = fetch_regression_path(&args.event_id, redis_client).await?
        .context(format!("Regression event with ID {} not found", args.event_id))?;
    
    println!("Agent ID: {}", path.agent_id);
    println!("Event Time: {}", timestamp_to_datetime(path.triggered_at).format("%Y-%m-%d %H:%M:%S"));
    println!("Trust Drop: {:.2}%", path.drop_percentage);
    
    let attribution = if let Some(attr) = &path.attribution {
        attr.clone()
    } else {
        // If attribution wasn't computed previously, calculate it now
        score_regression(&path)
    };
    
    if attribution.is_empty() {
        println!("\nNo attribution factors could be identified for this regression event.");
        return Ok(());
    }
    
    println!("\n{}", "Attribution Analysis".bold().yellow());
    println!("-------------------------");
    
    let total_score: f64 = attribution.iter().map(|a| a.score).sum();
    
    // For text output to console
    if args.format == "text" {
        let mut table = Table::new();
        table.set_content_arrangement(ContentArrangement::Dynamic)
            .set_header(vec!["Category", "Score", "Percentage", "Impact"]);
        
        for score in &attribution {
            let percentage = if total_score > 0.0 { (score.score / total_score) * 100.0 } else { 0.0 };
            
            let impact_cell = match percentage as u32 {
                p if p > 30 => Cell::new("High").fg(comfy_table::Color::Red),
                p if p > 15 => Cell::new("Medium").fg(comfy_table::Color::Yellow),
                _ => Cell::new("Low").fg(comfy_table::Color::Green),
            };
            
            table.add_row(vec![
                Cell::new(format_attribution_category(&score.category)),
                Cell::new(format!("{:.1}", score.score)),
                Cell::new(format!("{:.1}%", percentage)),
                impact_cell,
            ]);
        }
        
        println!("{}", table);
        
        // Display detailed reasons if requested
        if args.detailed {
            println!("\n{}", "Detailed Attribution Factors:".bold().yellow());
            
            for score in &attribution {
                println!("\n{}:", format_attribution_category(&score.category));
                for reason in &score.reasons {
                    println!("  • {}", reason);
                }
            }
        }
    }
    
    // Generate output file if requested
    if let Some(output_path) = &args.output {
        match args.format.as_str() {
            "json" => {
                #[derive(Serialize)]
                struct AttributionReport {
                    agent_id: String,
                    event_id: String,
                    event_time: String,
                    trust_drop: f64,
                    factors: Vec<AttributionScore>,
                }
                
                let report = AttributionReport {
                    agent_id: path.agent_id.clone(),
                    event_id: path.id.clone(),
                    event_time: timestamp_to_datetime(path.triggered_at).format("%Y-%m-%d %H:%M:%S").to_string(),
                    trust_drop: path.drop_percentage,
                    factors: attribution,
                };
                
                let json = serde_json::to_string_pretty(&report)?;
                std::fs::write(output_path, json)?;
                println!("\nAttribution analysis saved to: {}", output_path);
            },
            _ => {
                // Text output
                let mut text = format!(
                    "Trust Regression Attribution Analysis\n\
                    Agent ID: {}\n\
                    Event ID: {}\n\
                    Time: {}\n\
                    Trust Drop: {:.2}%\n\n\
                    Attribution Factors:\n\
                    -------------------\n",
                    path.agent_id,
                    path.id,
                    timestamp_to_datetime(path.triggered_at).format("%Y-%m-%d %H:%M:%S"),
                    path.drop_percentage
                );
                
                let total_score: f64 = attribution.iter().map(|a| a.score).sum();
                
                for score in &attribution {
                    let percentage = if total_score > 0.0 { (score.score / total_score) * 100.0 } else { 0.0 };
                    
                    text.push_str(&format!(
                        "\n{} - Score: {:.1} ({:.1}%)\n",
                        format_attribution_category(&score.category), score.score, percentage
                    ));
                    
                    if args.detailed {
                        for reason in &score.reasons {
                            text.push_str(&format!("  • {}\n", reason));
                        }
                    }
                }
                
                std::fs::write(output_path, text)?;
                println!("\nAttribution analysis saved to: {}", output_path);
            }
        }
    }
    
    println!("\nUse '--detailed' flag to see specific reasons for each attribution category.");
    
    Ok(())
}

/// Generate a comprehensive report for a specific regression event
pub async fn generate_regression_report(args: &ReportArgs, redis_client: &RedisClient) -> Result<()> {
    println!("{}", "Trust Regression Report Generator".bold().green());
    
    // Fetch the regression path
    let path = fetch_regression_path(&args.event_id, redis_client).await?
        .context(format!("Regression event with ID {} not found", args.event_id))?;
    
    // Validate agent ID if provided
    if let Some(agent_id) = &args.agent_id {
        if *agent_id != path.agent_id {
            anyhow::bail!("Event ID {} does not belong to agent {}", args.event_id, agent_id);
        }
    }
    
    // Generate the report
    let report = generate_report(&path);
    
    // Store the report in Redis if requested
    if args.store {
        store_regression_report(&report, redis_client).await?;
        println!("Report stored in Redis.");
    }
    
    // Handle output based on format
    match args.format.as_str() {
        "json" => {
            let json = export_report_json(&report)?;
            
            if let Some(output_path) = &args.output {
                std::fs::write(output_path, json)?;
                println!("Report saved to: {}", output_path);
            } else {
                println!("{}", json);
            }
        },
        "markdown" => {
            let markdown = export_report_markdown(&report);
            
            if let Some(output_path) = &args.output {
                std::fs::write(output_path, markdown)?;
                println!("Report saved to: {}", output_path);
            } else {
                println!("{}", markdown);
            }
        },
        _ => {
            // Text format (console friendly)
            println!("\n{}", "========== TRUST REGRESSION REPORT ==========".bold().yellow());
            println!("Agent ID: {}", report.agent_id);
            println!("Event ID: {}", report.event_id);
            println!("Time: {}", timestamp_to_datetime(report.timestamp).format("%Y-%m-%d %H:%M:%S"));
            println!("Severity: {}", severity_to_string(report.severity));
            
            println!("\n{}", "Summary:".bold());
            println!("{}", report.summary);
            
            println!("\n{}", "Trust Score Change:".bold());
            println!("Previous Score: {:.4}", report.previous_score);
            println!("Current Score: {:.4}", report.current_score);
            println!("Drop Percentage: {:.2}%", report.drop_percentage);
            
            println!("\n{}", "Attribution Factors:".bold());
            if report.causes.is_empty() {
                println!("No clear attribution factors identified.");
            } else {
                let total_score: f64 = report.causes.iter().map(|a| a.score).sum();
                
                let mut table = Table::new();
                table.set_content_arrangement(ContentArrangement::Dynamic)
                    .set_header(vec!["Category", "Score", "Percentage", "Reasons"]);
                
                for cause in &report.causes {
                    let percentage = if total_score > 0.0 { (cause.score / total_score) * 100.0 } else { 0.0 };
                    
                    let reasons = if cause.reasons.is_empty() {
                        "N/A".to_string()
                    } else {
                        cause.reasons[0].clone() + 
                            if cause.reasons.len() > 1 { 
                                format!(" (+{} more)", cause.reasons.len() - 1) 
                            } else { 
                                "".to_string() 
                            }
                    };
                    
                    table.add_row(vec![
                        Cell::new(format_attribution_category(&cause.category)),
                        Cell::new(format!("{:.1}", cause.score)),
                        Cell::new(format!("{:.1}%", percentage)),
                        Cell::new(reasons),
                    ]);
                }
                
                println!("{}", table);
            }
            
            // Memory changes summary (simplified)
            if let Some(diff) = &report.memory_diff {
                println!("\n{}", "Memory Changes:".bold());
                println!("Changed Keys: {}", diff.changed_keys.len());
                println!("Added Keys: {}", diff.added_keys.len());
                println!("Removed Keys: {}", diff.removed_keys.len());
            }
            
            // Recent reasoning summary
            if !report.reasoning_trace.is_empty() {
                println!("\n{}", "Recent Reasoning:".bold());
                println!("{} reasoning traces available.", report.reasoning_trace.len());
            }
            
            // Timeline summary
            if !report.timeline.is_empty() {
                println!("\n{}", "Event Timeline:".bold());
                println!("{} events recorded in the timeline.", report.timeline.len());
                
                // Show the first few and last few events
                let show_count = std::cmp::min(3, report.timeline.len());
                
                if show_count > 0 {
                    println!("First {} events:", show_count);
                    for i in 0..show_count {
                        println!("- {}", report.timeline[i]);
                    }
                    
                    if report.timeline.len() > show_count * 2 {
                        println!("...");
                        
                        println!("Last {} events:", show_count);
                        for i in report.timeline.len() - show_count..report.timeline.len() {
                            println!("- {}", report.timeline[i]);
                        }
                    }
                }
            }
            
            // Verdict
            println!("\n{}", "Final Verdict:".bold());
            println!("{}", report.verdict);
            
            // Output file info
            if let Some(output_path) = &args.output {
                // Write the full text report to file
                let full_report = export_report_markdown(&report);
                std::fs::write(output_path, full_report)?;
                println!("\nFull report saved to: {}", output_path);
            } else {
                println!("\nUse '--format markdown --output <file>' for a complete detailed report.");
            }
        }
    }
    
    Ok(())
}

// ===============================================================
// DATA HANDLING FUNCTIONS
// ===============================================================

/// Detect if a trust score drop meets the criteria for a regression event
pub fn detect_trust_drop(
    agent_id: &str,
    previous_score: f64,
    current_score: f64,
    threshold_percentage: f64,
    detection_window_minutes: u32,
) -> Option<TrustDropTrigger> {
    // Calculate the drop
    let drop = previous_score - current_score;
    let pct_drop = if previous_score > 0.0 { (drop / previous_score) * 100.0 } else { 0.0 };
    
    // Check if the drop exceeds the threshold
    if pct_drop >= threshold_percentage {
        Some(TrustDropTrigger::new(
            agent_id.to_string(),
            previous_score,
            current_score,
            threshold_percentage,
            detection_window_minutes,
        ))
    } else {
        None
    }
}

/// Store a buffer of recent trust scores for an agent in Redis
pub async fn store_trust_score_buffer(agent_id: &str, score: f64, redis_client: &RedisClient) -> Result<()> {
    // Fetch current configuration
    let config = fetch_regression_config(redis_client).await?;
    
    if !config.enabled {
        return Ok(()); // Skip if disabled
    }
    
    // Get the current buffer key
    let buffer_key = format!("agent:{}:trust_buffer", agent_id);
    
    // Get the current timestamp
    let now = Utc::now();
    let timestamp = now.timestamp();
    
    // Serialize the new entry
    let entry = format!("{}:{}", timestamp, score);
    
    // Add the new entry to the buffer using LPUSH (prepend)
    redis_client.lpush(&buffer_key, &entry)?;
    
    // Trim the buffer to the configured size
    redis_client.ltrim(&buffer_key, 0, config.history_buffer_size as i64 - 1)?;
    
    // Check for trust drops
    let threshold = config
        .agent_thresholds
        .get(agent_id)
        .copied()
        .unwrap_or(config.default_threshold_percentage);
    
    let history = fetch_trust_score_buffer(agent_id, redis_client).await?;
    
    if history.len() >= 2 {
        let window_start = now - Duration::minutes(config.detection_window_minutes as i64);
        
        // Find the highest score within the detection window
        let mut highest_score = score;
        let mut highest_ts = now;
        
        for (ts, s) in &history {
            let entry_time = timestamp_to_datetime(*ts);
            if entry_time >= window_start && *s > highest_score {
                highest_score = *s;
                highest_ts = entry_time;
            }
        }
        
        // Check if the current score is significantly lower than the highest score
        if highest_score > score {
            if let Some(trigger) = detect_trust_drop(
                agent_id,
                highest_score,
                score,
                threshold,
                config.detection_window_minutes,
            ) {
                // Create and store a regression path
                let path = build_regression_path(&trigger, redis_client).await?;
                store_regression_path(&path, redis_client).await?;
                
                // Optionally, notify about the regression
                // This would be a good place to emit an event or alert
            }
        }
    }
    
    Ok(())
}

/// Fetch the trust score buffer for an agent from Redis
pub async fn fetch_trust_score_buffer(agent_id: &str, redis_client: &RedisClient) -> Result<Vec<(i64, f64)>> {
    let buffer_key = format!("agent:{}:trust_buffer", agent_id);
    
    // Get all entries in the buffer
    let entries: Vec<String> = match redis_client.lrange(&buffer_key, 0, -1) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()), // Return empty list if key doesn't exist
    };
    
    // Parse each entry
    let mut result = Vec::new();
    for entry in entries {
        if let Some((ts_str, score_str)) = entry.split_once(':') {
            if let (Ok(ts), Ok(score)) = (ts_str.parse::<i64>(), score_str.parse::<f64>()) {
                result.push((ts, score));
            }
        }
    }
    
    // Sort by timestamp (oldest first)
    result.sort_by(|a, b| a.0.cmp(&b.0));
    
    Ok(result)
}

/// Store a regression configuration in Redis
pub async fn store_regression_config(config: &TrustRegressionConfig, redis_client: &RedisClient) -> Result<()> {
    let config_key = "system:trust_regression:config";
    let json = serde_json::to_string(config)?;
    redis_client.set(config_key, &json)?;
    Ok(())
}

/// Fetch the regression configuration from Redis
pub async fn fetch_regression_config(redis_client: &RedisClient) -> Result<TrustRegressionConfig> {
    let config_key = "system:trust_regression:config";
    
    match redis_client.get::<String>(config_key) {
        Ok(json) => {
            match serde_json::from_str::<TrustRegressionConfig>(&json) {
                Ok(config) => Ok(config),
                Err(e) => {
                    eprintln!("Error parsing regression config, using defaults: {}", e);
                    Ok(TrustRegressionConfig::default())
                }
            }
        },
        Err(_) => {
            // Create default config if it doesn't exist
            let config = TrustRegressionConfig::default();
            store_regression_config(&config, redis_client).await?;
            Ok(config)
        }
    }
}

/// Build a regression path from a trust drop trigger
pub async fn build_regression_path(trigger: &TrustDropTrigger, redis_client: &RedisClient) -> Result<TrustRegressionPath> {
    let mut path = TrustRegressionPath::new(trigger);
    let agent_id = &trigger.agent_id;
    
    // Get the time window
    let trigger_time = timestamp_to_datetime(trigger.timestamp);
    let window_start = trigger_time - Duration::minutes(trigger.detection_window_minutes as i64);
    
    // Fetch events within the window
    path.event_chain = fetch_agent_events(agent_id, window_start, redis_client).await?;
    
    // Fetch recent anomalies
    path.anomalies = fetch_agent_anomalies(agent_id, window_start, redis_client).await?;
    
    // Fetch recent reasoning chain
    path.recent_reasons = fetch_agent_reason_chain(agent_id, 5, redis_client).await?;
    
    // Compute memory diff
    path.memory_diff = compute_memory_diff(agent_id, window_start, trigger_time, redis_client).await?;
    
    // Tag events and determine factors
    path.tags = tag_events(&mut path.event_chain, &path.anomalies);
    
    // Generate an explanation
    path.explanation = Some(generate_explanation(&path));
    
    // Compute attribution scores
    path.attribution = Some(score_regression(&path));
    
    // Optionally generate and store a report
    // Read configuration to see if auto-report generation is enabled
    let config = fetch_regression_config(redis_client).await?;
    if config.enabled && config.auto_report_generation {
        // Generate a report
        let report = generate_report(&path);
        
        // Store the report in Redis
        match store_regression_report(&report, redis_client).await {
            Ok(_) => {},
            Err(e) => eprintln!("Warning: Failed to store regression report: {}", e)
        }
    }
    
    Ok(path)
}

/// Fetch recent events for an agent
pub async fn fetch_agent_events(agent_id: &str, since: DateTime<Utc>, redis_client: &RedisClient) -> Result<Vec<AgentEvent>> {
    let key_pattern = format!("agent:{}:event_log:*", agent_id);
    let keys = redis_client.keys(&key_pattern)?;
    let mut events = Vec::new();
    
    let since_ts = since.timestamp();
    
    for key in keys {
        match redis_client.get::<String>(&key) {
            Ok(json) => {
                if let Ok(event) = serde_json::from_str::<AgentEvent>(&json) {
                    // Parse the timestamp to check if it's within the window
                    if let Ok(event_time) = DateTime::parse_from_rfc3339(&event.timestamp) {
                        if event_time.timestamp() >= since_ts {
                            events.push(event);
                        }
                    }
                }
            },
            Err(e) => {
                eprintln!("Error retrieving event from {}: {}", key, e);
            }
        }
    }
    
    // If no events found in Redis, generate some mock events for demonstration
    if events.is_empty() {
        events = generate_mock_events(agent_id, since);
    }
    
    // Sort by timestamp
    events.sort_by(|a, b| {
        if let (Ok(a_time), Ok(b_time)) = (DateTime::parse_from_rfc3339(&a.timestamp), DateTime::parse_from_rfc3339(&b.timestamp)) {
            a_time.cmp(&b_time)
        } else {
            std::cmp::Ordering::Equal
        }
    });
    
    Ok(events)
}

/// Fetch anomalies for an agent
pub async fn fetch_agent_anomalies(agent_id: &str, since: DateTime<Utc>, redis_client: &RedisClient) -> Result<Vec<crate::commands::agent_anomaly_monitor::AnomalyEvent>> {
    use crate::commands::agent_anomaly_monitor::AnomalyEvent;
    
    let key_pattern = format!("agent:{}:anomalies:*", agent_id);
    let keys = redis_client.keys(&key_pattern)?;
    let mut anomalies = Vec::new();
    
    let since_ts = since.format("%Y-%m-%d").to_string();
    
    for key in keys {
        match redis_client.get::<String>(&key) {
            Ok(json) => {
                if let Ok(anomaly) = serde_json::from_str::<AnomalyEvent>(&json) {
                    // Check if the anomaly timestamp is after the since timestamp
                    if anomaly.timestamp >= since_ts {
                        anomalies.push(anomaly);
                    }
                }
            },
            Err(e) => {
                eprintln!("Error retrieving anomaly from {}: {}", key, e);
            }
        }
    }
    
    // Sort by timestamp (most recent first)
    anomalies.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    
    Ok(anomalies)
}

/// Fetch recent reasoning chain for an agent
pub async fn fetch_agent_reason_chain(agent_id: &str, limit: usize, redis_client: &RedisClient) -> Result<Vec<ReasonNode>> {
    let key_pattern = format!("agent:{}:reason_chain:*", agent_id);
    let keys = redis_client.keys(&key_pattern)?;
    let mut reasons = Vec::new();
    
    for key in keys {
        match redis_client.get::<String>(&key) {
            Ok(json) => {
                if let Ok(reason) = serde_json::from_str::<ReasonNode>(&json) {
                    reasons.push(reason);
                }
            },
            Err(e) => {
                eprintln!("Error retrieving reason from {}: {}", key, e);
            }
        }
    }
    
    // Sort by timestamp (most recent first)
    reasons.sort_by(|a, b| {
        if let (Ok(a_time), Ok(b_time)) = (DateTime::parse_from_rfc3339(&a.timestamp), DateTime::parse_from_rfc3339(&b.timestamp)) {
            b_time.cmp(&a_time)
        } else {
            std::cmp::Ordering::Equal
        }
    });
    
    // Take only the most recent reasons
    let reasons = reasons.into_iter().take(limit).collect();
    
    Ok(reasons)
}

/// Compute memory diff between two points in time
pub async fn compute_memory_diff(agent_id: &str, before: DateTime<Utc>, after: DateTime<Utc>, redis_client: &RedisClient) -> Result<Option<MemoryDiff>> {
    // In a real implementation, we would fetch memory snapshots from different times
    // and compute the diff between them. For now, we'll return a mock diff.
    
    let before_key = format!("agent:{}:memory:snapshot:{}", agent_id, before.timestamp());
    let after_key = format!("agent:{}:memory:snapshot:{}", agent_id, after.timestamp());
    
    let before_exists = redis_client.exists(&before_key)?;
    let after_exists = redis_client.exists(&after_key)?;
    
    if before_exists && after_exists {
        // Real implementation would fetch and compare real memory snapshots
        // This is just a placeholder for now
    }
    
    // Return a mock diff for demonstration
    let shard_id = format!("memory:{}:primary", agent_id);
    let mock_diff = MemoryDiff {
        shard_id,
        before_hash: "0x1a2b3c4d".to_string(),
        after_hash: "0x5e6f7g8h".to_string(),
        changed_keys: vec!["trust_factor".to_string(), "decision_threshold".to_string()],
        added_keys: vec!["recovery_attempt".to_string()],
        removed_keys: vec!["outdated_pattern".to_string()],
        key_diffs: {
            let mut diffs = HashMap::new();
            diffs.insert("trust_factor".to_string(), (Some("0.85".to_string()), Some("0.65".to_string())));
            diffs.insert("decision_threshold".to_string(), (Some("0.5".to_string()), Some("0.7".to_string())));
            diffs.insert("recovery_attempt".to_string(), (None, Some("1".to_string())));
            diffs.insert("outdated_pattern".to_string(), (Some("pattern_x".to_string()), None));
            diffs
        },
    };
    
    Ok(Some(mock_diff))
}

/// Tag events with descriptive factors and return all tags
pub fn tag_events(events: &mut Vec<AgentEvent>, anomalies: &[crate::commands::agent_anomaly_monitor::AnomalyEvent]) -> Vec<String> {
    let mut tags = Vec::new();
    
    // Check for strategy oscillation
    let mut strategy_changes = 0;
    let mut prev_strategy: Option<&str> = None;
    
    for event in events.iter() {
        if let AgentEventType::StrategyExecution = event.event_type {
            if let Some(strategy) = event.metadata.get("strategy") {
                if let Some(prev) = prev_strategy {
                    if prev != strategy {
                        strategy_changes += 1;
                    }
                }
                prev_strategy = Some(strategy);
            }
        }
    }
    
    if strategy_changes >= 3 {
        tags.push("🧠 Strategy Oscillation".to_string());
        
        // Tag the relevant events
        for event in events.iter_mut() {
            if let AgentEventType::StrategyExecution = event.event_type {
                event.tags.push("🧠 Strategy Oscillation".to_string());
            }
        }
    }
    
    // Check for conflicting decisions
    let mut decisions = HashMap::new();
    let mut has_conflicts = false;
    
    for event in events.iter() {
        if let AgentEventType::DecisionMade = event.event_type {
            if let Some(context) = event.metadata.get("context") {
                if let Some(decision) = event.metadata.get("decision") {
                    if let Some(prev_decision) = decisions.get(context) {
                        if prev_decision != decision {
                            has_conflicts = true;
                        }
                    }
                    decisions.insert(context.clone(), decision.clone());
                }
            }
        }
    }
    
    if has_conflicts {
        tags.push("🗯️ Conflicting Decisions".to_string());
        
        // Tag the relevant events
        for event in events.iter_mut() {
            if let AgentEventType::DecisionMade = event.event_type {
                if let Some(context) = event.metadata.get("context") {
                    if decisions.get(context).is_some() {
                        event.tags.push("🗯️ Conflicting Decisions".to_string());
                    }
                }
            }
        }
    }
    
    // Check for role revocation
    let has_role_revocation = events.iter().any(|e| 
        matches!(e.event_type, AgentEventType::RoleChange) && 
        e.description.contains("revoked")
    );
    
    if has_role_revocation {
        tags.push("🚨 Recent Role Revocation".to_string());
        
        // Tag the relevant events
        for event in events.iter_mut() {
            if matches!(event.event_type, AgentEventType::RoleChange) && 
               event.description.contains("revoked") {
                event.tags.push("🚨 Recent Role Revocation".to_string());
            }
        }
    }
    
    // Check for trust score penalties
    let has_trust_penalties = events.iter().any(|e| 
        matches!(e.event_type, AgentEventType::TrustUpdate) && 
        e.description.contains("penalty")
    );
    
    if has_trust_penalties {
        tags.push("📉 Trust Score Penalty".to_string());
        
        // Tag the relevant events
        for event in events.iter_mut() {
            if matches!(event.event_type, AgentEventType::TrustUpdate) && 
               event.description.contains("penalty") {
                event.tags.push("📉 Trust Score Penalty".to_string());
            }
        }
    }
    
    // Check for repeated failures
    let failure_count = events.iter().filter(|e| 
        e.description.contains("failed") || 
        e.description.contains("error") || 
        e.description.contains("exception")
    ).count();
    
    if failure_count >= 3 {
        tags.push("🔁 Repeated Failure".to_string());
        
        // Tag the relevant events
        for event in events.iter_mut() {
            if event.description.contains("failed") || 
               event.description.contains("error") || 
               event.description.contains("exception") {
                event.tags.push("🔁 Repeated Failure".to_string());
            }
        }
    }
    
    // Check for memory access denied
    let has_memory_access_denied = events.iter().any(|e| 
        matches!(e.event_type, AgentEventType::MemoryAccess) && 
        (e.description.contains("denied") || e.description.contains("blocked"))
    );
    
    if has_memory_access_denied {
        tags.push("🔒 Memory Access Denied".to_string());
        
        // Tag the relevant events
        for event in events.iter_mut() {
            if matches!(event.event_type, AgentEventType::MemoryAccess) && 
               (event.description.contains("denied") || event.description.contains("blocked")) {
                event.tags.push("🔒 Memory Access Denied".to_string());
            }
        }
    }
    
    // Add tags from anomalies
    if !anomalies.is_empty() {
        tags.push("⚠️ Anomalies Detected".to_string());
        
        // Check specific anomaly types
        let has_trust_deviation = anomalies.iter().any(|a| a.anomaly_type == "Trust Deviation");
        let has_decision_contradiction = anomalies.iter().any(|a| a.anomaly_type == "Decision Contradiction");
        let has_bio_signal_anomaly = anomalies.iter().any(|a| a.anomaly_type == "Bio-Signal Anomaly");
        
        if has_trust_deviation {
            tags.push("⚠️ Trust Deviation Anomaly".to_string());
        }
        
        if has_decision_contradiction {
            tags.push("⚠️ Decision Contradiction Anomaly".to_string());
        }
        
        if has_bio_signal_anomaly {
            tags.push("🧬 Bio-Signal Anomaly".to_string());
        }
    }
    
    tags
}

/// Generate an explanation based on the regression path
fn generate_explanation(path: &TrustRegressionPath) -> String {
    let mut explanations = Vec::new();
    
    // Check for different factors and add corresponding explanations
    for tag in &path.tags {
        match tag.as_str() {
            "🧠 Strategy Oscillation" => {
                explanations.push("Agent rapidly switched between different strategies, indicating potential confusion or inconsistency in decision making.");
            },
            "🗯️ Conflicting Decisions" => {
                explanations.push("Agent made contradictory decisions for the same context, suggesting reasoning instability.");
            },
            "🚨 Recent Role Revocation" => {
                explanations.push("Agent recently had one or more roles revoked, reducing its authority and capabilities.");
            },
            "📉 Trust Score Penalty" => {
                explanations.push("Agent received explicit trust penalties, likely due to policy violations or performance issues.");
            },
            "🔁 Repeated Failure" => {
                explanations.push("Agent experienced multiple consecutive failures in operations or task execution.");
            },
            "🔒 Memory Access Denied" => {
                explanations.push("Agent was denied access to required memory resources, limiting its ability to function properly.");
            },
            "⚠️ Trust Deviation Anomaly" => {
                explanations.push("Anomaly detection system identified unusual patterns in trust score fluctuations.");
            },
            "⚠️ Decision Contradiction Anomaly" => {
                explanations.push("Anomaly detection system flagged inconsistent decision patterns in agent reasoning.");
            },
            "⚠️ Anomalies Detected" => {
                if !explanations.iter().any(|e| e.contains("Anomaly")) {
                    explanations.push("One or more anomalies were detected during the regression period.");
                }
            },
            _ => {}
        }
    }
    
    if explanations.is_empty() {
        return "Trust score drop occurred without clear identifiable factors. May require further investigation.".to_string();
    }
    
    // Combine all explanations into a single paragraph
    explanations.join(" ")
}

/// Store a regression path in Redis
pub async fn store_regression_path(path: &TrustRegressionPath, redis_client: &RedisClient) -> Result<()> {
    let key = format!("agent:{}:trust_regression:{}", path.agent_id, path.id);
    let json = serde_json::to_string(path)?;
    
    redis_client.set(&key, &json)?;
    
    // Set expiration based on config
    let config = fetch_regression_config(redis_client).await?;
    let expiry_seconds = config.store_days as i64 * 24 * 60 * 60;
    redis_client.expire(&key, expiry_seconds)?;
    
    Ok(())
}

/// Fetch a regression path from Redis
pub async fn fetch_regression_path(id: &str, redis_client: &RedisClient) -> Result<Option<TrustRegressionPath>> {
    // We need to find the key since we don't know the agent_id
    let key_pattern = format!("agent:*:trust_regression:{}", id);
    let keys = redis_client.keys(&key_pattern)?;
    
    if keys.is_empty() {
        return Ok(None);
    }
    
    let key = &keys[0]; // Take the first matching key
    
    match redis_client.get::<String>(key) {
        Ok(json) => {
            match serde_json::from_str::<TrustRegressionPath>(&json) {
                Ok(path) => Ok(Some(path)),
                Err(e) => anyhow::bail!("Error parsing regression path: {}", e)
            }
        },
        Err(e) => anyhow::bail!("Error retrieving regression path: {}", e)
    }
}

/// Store a regression report in Redis
pub async fn store_regression_report(report: &TrustRegressionReport, redis_client: &RedisClient) -> Result<()> {
    let key = format!("agent:{}:trust_regression:{}:report", report.agent_id, report.event_id);
    let json = serde_json::to_string(report)?;
    
    redis_client.set(&key, &json)?;
    
    // Set expiration based on config
    let config = fetch_regression_config(redis_client).await?;
    let expiry_seconds = config.store_days as i64 * 24 * 60 * 60;
    redis_client.expire(&key, expiry_seconds)?;
    
    Ok(())
}

/// Fetch a regression report from Redis
pub async fn fetch_regression_report(agent_id: &str, event_id: &str, redis_client: &RedisClient) -> Result<Option<TrustRegressionReport>> {
    let key = format!("agent:{}:trust_regression:{}:report", agent_id, event_id);
    
    match redis_client.get::<String>(&key) {
        Ok(json) => {
            match serde_json::from_str::<TrustRegressionReport>(&json) {
                Ok(report) => Ok(Some(report)),
                Err(e) => anyhow::bail!("Error parsing regression report: {}", e)
            }
        },
        Err(_) => {
            // If the report doesn't exist but the path does, generate it on demand
            match fetch_regression_path(event_id, redis_client).await? {
                Some(path) => {
                    let report = generate_report(&path);
                    store_regression_report(&report, redis_client).await?;
                    Ok(Some(report))
                },
                None => Ok(None)
            }
        }
    }
}

/// Generate mock events for testing and demonstration
fn generate_mock_events(agent_id: &str, since: DateTime<Utc>) -> Vec<AgentEvent> {
    let mut events = Vec::new();
    let mut current_time = since;
    
    // Strategy execution with oscillation
    for i in 0..5 {
        current_time = current_time + Duration::minutes(i + 1);
        let strategy = if i % 2 == 0 { "trend_following" } else { "mean_reversion" };
        
        let mut metadata = HashMap::new();
        metadata.insert("strategy".to_string(), strategy.to_string());
        metadata.insert("confidence".to_string(), "0.85".to_string());
        
        events.push(AgentEvent {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            timestamp: current_time.to_rfc3339(),
            event_type: AgentEventType::StrategyExecution,
            description: format!("Executed {} strategy", strategy),
            metadata,
            tags: Vec::new(),
        });
    }
    
    // Add a role change
    current_time = current_time + Duration::minutes(2);
    let mut metadata = HashMap::new();
    metadata.insert("previous_role".to_string(), "primary_trader".to_string());
    metadata.insert("new_role".to_string(), "observer".to_string());
    
    events.push(AgentEvent {
        id: Uuid::new_v4().to_string(),
        agent_id: agent_id.to_string(),
        timestamp: current_time.to_rfc3339(),
        event_type: AgentEventType::RoleChange,
        description: "Role 'primary_trader' revoked due to performance concerns".to_string(),
        metadata,
        tags: Vec::new(),
    });
    
    // Add conflicting decisions
    for i in 0..2 {
        current_time = current_time + Duration::minutes(i + 1);
        let decision = if i % 2 == 0 { "buy" } else { "sell" };
        
        let mut metadata = HashMap::new();
        metadata.insert("context".to_string(), "market_volatility".to_string());
        metadata.insert("decision".to_string(), decision.to_string());
        metadata.insert("confidence".to_string(), "0.72".to_string());
        
        events.push(AgentEvent {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            timestamp: current_time.to_rfc3339(),
            event_type: AgentEventType::DecisionMade,
            description: format!("Decided to {} based on market conditions", decision),
            metadata,
            tags: Vec::new(),
        });
    }
    
    // Add trust update with penalty
    current_time = current_time + Duration::minutes(3);
    let mut metadata = HashMap::new();
    metadata.insert("previous_score".to_string(), "0.85".to_string());
    metadata.insert("new_score".to_string(), "0.75".to_string());
    metadata.insert("reason".to_string(), "strategy_inconsistency".to_string());
    
    events.push(AgentEvent {
        id: Uuid::new_v4().to_string(),
        agent_id: agent_id.to_string(),
        timestamp: current_time.to_rfc3339(),
        event_type: AgentEventType::TrustUpdate,
        description: "Applied trust score penalty due to strategy inconsistency".to_string(),
        metadata,
        tags: Vec::new(),
    });
    
    // Add memory access denied
    current_time = current_time + Duration::minutes(2);
    let mut metadata = HashMap::new();
    metadata.insert("memory_key".to_string(), "global_market_state".to_string());
    metadata.insert("access_type".to_string(), "write".to_string());
    metadata.insert("reason".to_string(), "insufficient_privileges".to_string());
    
    events.push(AgentEvent {
        id: Uuid::new_v4().to_string(),
        agent_id: agent_id.to_string(),
        timestamp: current_time.to_rfc3339(),
        event_type: AgentEventType::MemoryAccess,
        description: "Memory access denied for 'global_market_state'".to_string(),
        metadata,
        tags: Vec::new(),
    });
    
    events
}

// ===============================================================
// HELPER FUNCTIONS
// ===============================================================

fn display_regression_path(path: &TrustRegressionPath, detailed: bool) {
    println!("Agent ID: {}", path.agent_id);
    println!("Time: {}", timestamp_to_datetime(path.triggered_at).format("%Y-%m-%d %H:%M:%S"));
    println!("Previous Score: {:.4}", path.previous_score);
    println!("Current Score: {:.4}", path.current_score);
    println!("Drop: {:.2}%", path.drop_percentage);
    
    let severity = match path.severity {
        5 => "Critical".red(),
        4 => "High".red(),
        3 => "Medium".yellow(),
        2 => "Low".green(),
        _ => "Minor".green(),
    };
    println!("Severity: {}", severity);
    
    if let Some(explanation) = &path.explanation {
        println!("\nExplanation: {}", explanation);
    }
    
    // Display attribution scores if available
    if let Some(attribution) = &path.attribution {
        println!("\n{}", "Attribution Analysis:".bold().yellow());
        
        let total_score: f64 = attribution.iter().map(|a| a.score).sum();
        
        for score in attribution {
            let percentage = if total_score > 0.0 { (score.score / total_score) * 100.0 } else { 0.0 };
            let category_str = format_attribution_category(&score.category);
            
            let color = if percentage > 30.0 {
                category_str.red().bold()
            } else if percentage > 15.0 {
                category_str.yellow().bold()
            } else {
                category_str.normal()
            };
            
            println!("- {} ({:.1}%)", color, percentage);
            
            if detailed {
                for reason in &score.reasons {
                    println!("  • {}", reason);
                }
            }
        }
    }
    
    println!("\n{}", "Identified Factors:".bold().yellow());
    for tag in &path.tags {
        println!("- {}", tag);
    }
    
    if detailed {
        println!("\n{}", "Event Timeline:".bold().yellow());
        for event in &path.event_chain {
            let timestamp = match DateTime::parse_from_rfc3339(&event.timestamp) {
                Ok(dt) => dt.with_timezone(&Utc).format("%H:%M:%S").to_string(),
                Err(_) => event.timestamp.clone(),
            };
            
            println!("[{}] {}: {}", 
                timestamp,
                format_event_type(&event.event_type),
                event.description
            );
        }
        
        if !path.anomalies.is_empty() {
            println!("\n{}", "Related Anomalies:".bold().yellow());
            for anomaly in &path.anomalies {
                println!("- {} (Severity: {}): {}", 
                    anomaly.anomaly_type,
                    anomaly.severity,
                    anomaly.description
                );
            }
        }
        
        if !path.recent_reasons.is_empty() {
            println!("\n{}", "Recent Reasoning:".bold().yellow());
            for reason in &path.recent_reasons {
                println!("- {}", reason.reasoning);
                println!("  Outcome: {}, Confidence: {:.2}", reason.outcome, reason.confidence);
            }
        }
        
        if let Some(memory_diff) = &path.memory_diff {
            println!("\n{}", "Memory Changes:".bold().yellow());
            println!("Shard ID: {}", memory_diff.shard_id);
            println!("Changed Keys: {}", memory_diff.changed_keys.len());
            println!("Added Keys: {}", memory_diff.added_keys.len());
            println!("Removed Keys: {}", memory_diff.removed_keys.len());
            
            if !memory_diff.changed_keys.is_empty() {
                println!("\nChanged Keys:");
                for key in &memory_diff.changed_keys {
                    if let Some((before, after)) = memory_diff.key_diffs.get(key) {
                        println!("  {}: '{}' -> '{}'", 
                            key, 
                            before.as_deref().unwrap_or("null"),
                            after.as_deref().unwrap_or("null")
                        );
                    }
                }
            }
        }
    }
}

fn display_regression_config(config: &TrustRegressionConfig) {
    println!("Enabled: {}", if config.enabled { "Yes".green() } else { "No".red() });
    println!("Default Drop Threshold: {:.2}%", config.default_threshold_percentage);
    println!("Detection Window: {} minutes", config.detection_window_minutes);
    println!("History Buffer Size: {} entries", config.history_buffer_size);
    println!("Data Retention: {} days", config.store_days);
    println!("Auto Report Generation: {}", if config.auto_report_generation { "Yes".green() } else { "No".red() });
    
    if !config.agent_thresholds.is_empty() {
        println!("\nAgent-specific Thresholds:");
        for (agent_id, threshold) in &config.agent_thresholds {
            println!("  {}: {:.2}%", agent_id, threshold);
        }
    }
}

fn format_event_type(event_type: &AgentEventType) -> String {
    match event_type {
        AgentEventType::TrustUpdate => "Trust Update".to_string(),
        AgentEventType::StrategyExecution => "Strategy".to_string(),
        AgentEventType::MemoryAccess => "Memory".to_string(),
        AgentEventType::RoleChange => "Role Change".to_string(),
        AgentEventType::DecisionMade => "Decision".to_string(),
        AgentEventType::AnomalyDetected => "Anomaly".to_string(),
        AgentEventType::HealingAttempt => "Healing".to_string(),
        AgentEventType::ConfigChange => "Config".to_string(),
        AgentEventType::Other(s) => s.clone(),
    }
}

fn format_attribution_category(category: &AttributionCategory) -> String {
    match category {
        AttributionCategory::StrategyFailure => "Strategy Failure",
        AttributionCategory::MemoryCorruption => "Memory Corruption",
        AttributionCategory::RoleConflict => "Role Conflict",
        AttributionCategory::TrustDecayFlag => "Trust Decay Flag",
        AttributionCategory::AnomalySpike => "Anomaly Spike",
        AttributionCategory::DelayedReaction => "Delayed Reaction",
        AttributionCategory::ReasonDrift => "Reasoning Drift",
        AttributionCategory::NetworkLatency => "Network Latency",
        AttributionCategory::DecisionContradiction => "Decision Contradiction",
        AttributionCategory::UnauthorizedAccess => "Unauthorized Access",
        AttributionCategory::PoorPerformance => "Poor Performance",
        AttributionCategory::PolicyViolation => "Policy Violation",
    }.to_string()
}

fn severity_to_string(severity: u8) -> String {
    match severity {
        5 => "Critical",
        4 => "High",
        3 => "Medium",
        2 => "Low",
        _ => "Minor",
    }.to_string()
}

fn parse_time_period(period: &str) -> Result<Duration> {
    let mut chars = period.chars();
    let num_str: String = chars.by_ref().take_while(|c| c.is_ascii_digit()).collect();
    let num = num_str.parse::<i64>().context("Invalid time period format")?;
    
    let unit: String = chars.collect();
    match unit.as_str() {
        "s" | "sec" | "secs" | "second" | "seconds" => Ok(Duration::seconds(num)),
        "m" | "min" | "mins" | "minute" | "minutes" => Ok(Duration::minutes(num)),
        "h" | "hr" | "hrs" | "hour" | "hours" => Ok(Duration::hours(num)),
        "d" | "day" | "days" => Ok(Duration::days(num)),
        _ => anyhow::bail!("Unknown time unit: {}", unit),
    }
}

fn humanize_duration(duration: &Duration) -> String {
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

fn duration_to_minutes(duration: &Duration) -> u32 {
    duration.num_minutes() as u32
}

fn timestamp_to_datetime(ts: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(ts, 0).unwrap_or_else(|| Utc::now())
} 