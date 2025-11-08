use anyhow::Result;
use std::any::Any;
use async_trait::async_trait;

/// Interface for controlling agent lifecycle
#[async_trait]
pub trait AgentController: Send + Sync {
    /// Start an agent
    async fn start_agent(&self, agent_id: &str) -> Result<()>;
    
    /// Pause an agent
    async fn pause_agent(&self, agent_id: &str, reason: &str) -> Result<()>;
    
    /// Stop an agent
    async fn stop_agent(&self, agent_id: &str) -> Result<()>;
    
    /// Restart an agent
    async fn restart_agent(&self, agent_id: &str) -> Result<()>;
    
    /// Mark an agent as canary (reduced capacity mode)
    async fn mark_as_canary(&self, agent_id: &str) -> Result<()>;
    
    /// Get agent status
    async fn get_agent_status(&self, agent_id: &str) -> Result<AgentStatus>;
    
    /// List all agents
    async fn list_agents(&self) -> Result<Vec<AgentInfo>>;
    
    /// Allow downcasting to concrete implementation
    fn as_any(&self) -> &dyn Any where Self: 'static;
}

/// Information about an agent
#[derive(Debug, Clone)]
pub struct AgentInfo {
    /// Agent ID
    pub agent_id: String,
    
    /// Agent name/description
    pub name: String,
    
    /// Current status
    pub status: AgentStatus,
    
    /// Agent type/category
    pub agent_type: String,
    
    /// When the agent was created
    pub created_at: i64,
    
    /// When the agent was last updated
    pub updated_at: i64,
}

/// Current status of an agent
#[derive(Debug, Clone, PartialEq)]
pub enum AgentStatus {
    /// Agent is running
    Running,
    
    /// Agent is paused
    Paused { reason: String },
    
    /// Agent is stopped
    Stopped,
    
    /// Agent is in canary mode (reduced capacity)
    Canary,
    
    /// Agent is in error state
    Error { message: String },
    
    /// Agent status is unknown
    Unknown,
} 