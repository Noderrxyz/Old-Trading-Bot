use anyhow::Result;
use std::any::Any;
use async_trait::async_trait;
use std::collections::HashMap;

/// Interface for monitoring agent trust and validation
#[async_trait]
pub trait TrustMonitor: Send + Sync {
    /// Begin a trial period for an agent with optional baseline snapshot
    async fn begin_trial(&self, agent_id: &str, baseline_snapshot: Option<TrustSnapshot>) -> Result<()>;
    
    /// End trial period and determine if the agent should be promoted
    async fn end_trial(&self, agent_id: &str) -> Result<TrialResult>;
    
    /// Get current trial status for an agent
    async fn get_trial_status(&self, agent_id: &str) -> Result<TrialStatus>;
    
    /// Capture current trust metrics for an agent
    async fn capture_snapshot(&self, agent_id: &str) -> Result<TrustSnapshot>;
    
    /// Compare current metrics to baseline
    async fn compare_to_baseline(&self, agent_id: &str) -> Result<TrustComparison>;
    
    /// Allow downcasting to concrete implementation
    fn as_any(&self) -> &dyn Any where Self: 'static;
}

/// Snapshot of trust metrics for an agent
#[derive(Debug, Clone)]
pub struct TrustSnapshot {
    /// Agent ID
    pub agent_id: String,
    
    /// Timestamp when the snapshot was taken
    pub timestamp: i64,
    
    /// Trust score
    pub trust_score: f64,
    
    /// Error rate
    pub error_rate: f64,
    
    /// PnL stability
    pub pnl_stability: f64,
    
    /// Signal entropy
    pub signal_entropy: f64,
    
    /// Other metrics
    pub metrics: HashMap<String, f64>,
}

/// Status of an agent trial
#[derive(Debug, Clone, PartialEq)]
pub enum TrialStatus {
    /// No trial is active
    NoTrial,
    
    /// Trial is active
    Active {
        /// When the trial started
        started_at: i64,
        
        /// When the trial is scheduled to end
        ends_at: i64,
        
        /// Current progress (0-100)
        progress: u8,
        
        /// Preliminary result (if available)
        preliminary_result: Option<bool>,
    },
    
    /// Trial was completed
    Completed {
        /// Trial result
        result: TrialResult,
        
        /// When the trial was completed
        completed_at: i64,
    },
}

/// Result of a trial
#[derive(Debug, Clone, PartialEq)]
pub enum TrialResult {
    /// Agent was promoted
    Promoted,
    
    /// Agent failed validation
    Failed { reason: String },
    
    /// Trial was inconclusive
    Inconclusive { reason: String },
}

/// Comparison between current metrics and baseline
#[derive(Debug, Clone)]
pub struct TrustComparison {
    /// Agent ID
    pub agent_id: String,
    
    /// Current snapshot
    pub current: TrustSnapshot,
    
    /// Baseline snapshot
    pub baseline: TrustSnapshot,
    
    /// Trust score change (positive is better)
    pub trust_score_change: f64,
    
    /// Error rate change (negative is better)
    pub error_rate_change: f64,
    
    /// PnL stability change (positive is better)
    pub pnl_stability_change: f64,
    
    /// Signal entropy change (contextual)
    pub signal_entropy_change: f64,
    
    /// Overall improvement (-1.0 to 1.0, positive is better)
    pub overall_improvement: f64,
    
    /// List of improved metrics
    pub improved_metrics: Vec<String>,
    
    /// List of worsened metrics
    pub worsened_metrics: Vec<String>,
} 