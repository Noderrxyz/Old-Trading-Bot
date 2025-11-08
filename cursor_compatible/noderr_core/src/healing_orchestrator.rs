use anyhow::Result;
use std::any::Any;
use async_trait::async_trait;

/// Interface for orchestrating healing of strategies/agents
#[async_trait]
pub trait HealingOrchestrator: Send + Sync {
    /// Run healing orchestration for a strategy/agent
    async fn run(&self, strategy_id: &str) -> Result<()>;
    
    /// Check if healing is currently active for a strategy/agent
    async fn is_healing_active(&self, strategy_id: &str) -> Result<bool>;
    
    /// Get the current healing status for a strategy/agent
    async fn get_healing_status(&self, strategy_id: &str) -> Result<HealingStatus>;
    
    /// Abort ongoing healing for a strategy/agent
    async fn abort_healing(&self, strategy_id: &str) -> Result<()>;
    
    /// Allow downcasting to concrete implementation
    fn as_any(&self) -> &dyn Any where Self: 'static;
}

/// Current healing status for a strategy/agent
#[derive(Debug, Clone, PartialEq)]
pub enum HealingStatus {
    /// No healing is active
    NotActive,
    
    /// Healing is in progress
    InProgress {
        /// Current step
        current_step: String,
        
        /// Progress percentage (0-100)
        progress: u8,
        
        /// Timestamp when healing started
        started_at: i64,
    },
    
    /// Healing was successful
    Succeeded {
        /// Applied healing action
        action: String,
        
        /// Timestamp when healing completed
        completed_at: i64,
    },
    
    /// Healing failed
    Failed {
        /// Error message
        error: String,
        
        /// Timestamp when healing failed
        failed_at: i64,
    },
} 