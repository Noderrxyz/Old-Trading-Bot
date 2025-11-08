use crate::error::{Error, Result};
use crate::memory_service::MemoryService;
use crate::redis::RedisClient;
use crate::trust_score_engine::{TrustScoreEngine, TrustScoreFeatures};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, error, info, warn};

/// Supervision level for meta-agents
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SupervisionLevel {
    /// Minimal supervision, high autonomy
    Low,
    /// Standard supervision
    Medium,
    /// Heavy supervision, limited autonomy
    High,
    /// Full supervision, minimal autonomy
    Critical,
}

impl Default for SupervisionLevel {
    fn default() -> Self {
        Self::Medium
    }
}

/// Domain of expertise for a meta-agent
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MetaAgentDomain {
    /// Governance and policy enforcement
    Governance,
    /// Risk assessment and management
    RiskManagement,
    /// Network optimization and resilience
    NetworkOptimization,
    /// Agent performance and quality control
    QualityControl,
    /// Security and threat detection
    Security,
    /// Resource allocation and efficiency
    ResourceAllocation,
    /// Behavioral analysis and prediction
    BehavioralAnalysis,
    /// Custom domain with specific focus
    Custom(String),
}

impl Default for MetaAgentDomain {
    fn default() -> Self {
        Self::Governance
    }
}

/// Status of a meta-agent
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MetaAgentStatus {
    /// Active and operational
    Active,
    /// In test/evaluation mode
    Testing,
    /// Temporarily paused
    Paused,
    /// Decommissioned
    Retired,
    /// Under review due to anomalies
    UnderReview,
}

impl Default for MetaAgentStatus {
    fn default() -> Self {
        Self::Testing
    }
}

/// Configuration for a meta-agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaAgentConfig {
    /// Unique identifier for the meta-agent
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Domain of expertise
    pub domain: MetaAgentDomain,
    /// Level of supervision required
    pub supervision_level: SupervisionLevel,
    /// Target agents this meta-agent oversees (empty means all)
    pub target_agents: Vec<String>,
    /// Polling interval in seconds
    pub polling_interval: u64,
    /// Maximum concurrency for operations
    pub max_concurrency: u32,
    /// Custom parameters for specialized behavior
    pub parameters: HashMap<String, String>,
}

impl Default for MetaAgentConfig {
    fn default() -> Self {
        Self {
            id: String::from("meta-default"),
            name: String::from("Default Meta-Agent"),
            domain: MetaAgentDomain::default(),
            supervision_level: SupervisionLevel::default(),
            target_agents: Vec::new(),
            polling_interval: 300, // 5 minutes
            max_concurrency: 10,
            parameters: HashMap::new(),
        }
    }
}

/// Decision made by a meta-agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaAgentDecision {
    /// Unique identifier for the decision
    pub id: String,
    /// ID of the meta-agent making the decision
    pub meta_agent_id: String,
    /// IDs of affected agents
    pub affected_agents: Vec<String>,
    /// Timestamp when decision was made
    pub timestamp: DateTime<Utc>,
    /// Reasoning behind the decision
    pub reasoning: String,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
    /// Whether the decision was automatically applied
    pub auto_applied: bool,
    /// Current status of the decision
    pub status: DecisionStatus,
    /// Actions to be taken
    pub actions: Vec<MetaAgentAction>,
}

/// Status of a meta-agent decision
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DecisionStatus {
    /// Proposed but not approved
    Proposed,
    /// Approved for implementation
    Approved,
    /// Being implemented
    InProgress,
    /// Successfully implemented
    Completed,
    /// Implementation failed
    Failed,
    /// Decision was rejected
    Rejected,
    /// Implementation was rolled back
    RolledBack,
}

/// Action to be taken by a meta-agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaAgentAction {
    /// Type of action
    pub action_type: ActionType,
    /// Target agent ID
    pub target_agent_id: String,
    /// Parameters for the action
    pub parameters: HashMap<String, String>,
    /// Priority level (1-10)
    pub priority: u8,
    /// Whether action requires human approval
    pub requires_approval: bool,
}

/// Types of actions a meta-agent can take
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ActionType {
    /// Adjust trust score
    TrustScoreAdjustment,
    /// Impose restrictions
    Restriction,
    /// Reset agent state
    Reset,
    /// Training recommendation
    TrainingRecommendation,
    /// Resource allocation change
    ResourceAdjustment,
    /// Policy enforcement
    PolicyEnforcement,
    /// Agent suspension
    Suspension,
    /// Custom action type
    Custom(String),
}

/// Service for managing meta-agents
#[async_trait]
pub trait MetaAgentService: Send + Sync {
    /// Register a new meta-agent
    async fn register_meta_agent(&self, config: MetaAgentConfig) -> Result<String>;
    
    /// Get a meta-agent configuration by ID
    async fn get_meta_agent(&self, id: &str) -> Result<MetaAgentConfig>;
    
    /// Update an existing meta-agent configuration
    async fn update_meta_agent(&self, config: MetaAgentConfig) -> Result<()>;
    
    /// List all registered meta-agents
    async fn list_meta_agents(&self) -> Result<Vec<MetaAgentConfig>>;
    
    /// Deactivate a meta-agent
    async fn deactivate_meta_agent(&self, id: &str) -> Result<()>;
    
    /// Record a decision made by a meta-agent
    async fn record_decision(&self, decision: MetaAgentDecision) -> Result<String>;
    
    /// Get decision by ID
    async fn get_decision(&self, id: &str) -> Result<MetaAgentDecision>;
    
    /// List decisions for a specific meta-agent
    async fn list_decisions(&self, meta_agent_id: &str, limit: u32) -> Result<Vec<MetaAgentDecision>>;
    
    /// Update decision status
    async fn update_decision_status(&self, id: &str, status: DecisionStatus) -> Result<()>;
    
    /// Get performance metrics for a meta-agent
    async fn get_meta_agent_metrics(&self, id: &str) -> Result<MetaAgentMetrics>;
}

/// Performance metrics for meta-agents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaAgentMetrics {
    /// ID of the meta-agent
    pub meta_agent_id: String,
    /// Total number of decisions made
    pub total_decisions: u64,
    /// Number of successful decisions
    pub successful_decisions: u64,
    /// Number of failed decisions
    pub failed_decisions: u64,
    /// Average confidence score
    pub avg_confidence: f64,
    /// Average response time in ms
    pub avg_response_time_ms: u64,
    /// Health score (0.0-1.0)
    pub health_score: f64,
    /// Additional custom metrics
    pub custom_metrics: HashMap<String, f64>,
    /// Last update timestamp
    pub last_updated: DateTime<Utc>,
}

/// Implementation of MetaAgentService using Redis
pub struct RedisMetaAgentService {
    redis_client: Arc<dyn RedisClient>,
    memory_service: Arc<dyn MemoryService>,
    trust_score_engine: Arc<dyn TrustScoreEngine>,
}

impl RedisMetaAgentService {
    /// Create a new RedisMetaAgentService
    pub fn new(
        redis_client: Arc<dyn RedisClient>,
        memory_service: Arc<dyn MemoryService>,
        trust_score_engine: Arc<dyn TrustScoreEngine>,
    ) -> Self {
        Self {
            redis_client,
            memory_service,
            trust_score_engine,
        }
    }
    
    // Helper method to generate a unique ID
    fn generate_id(&self, prefix: &str) -> String {
        format!("{}-{}", prefix, uuid::Uuid::new_v4())
    }
    
    // Key for storing meta-agent config in Redis
    fn meta_agent_key(&self, id: &str) -> String {
        format!("meta:agent:{}", id)
    }
    
    // Key for storing meta-agent decision in Redis
    fn decision_key(&self, id: &str) -> String {
        format!("meta:decision:{}", id)
    }
    
    // Key for storing meta-agent metrics in Redis
    fn metrics_key(&self, id: &str) -> String {
        format!("meta:metrics:{}", id)
    }
    
    // Key for storing the list of all meta-agents
    fn meta_agents_list_key(&self) -> String {
        "meta:agents".to_string()
    }
    
    // Key for storing decisions for a specific meta-agent
    fn meta_agent_decisions_key(&self, id: &str) -> String {
        format!("meta:agent:{}:decisions", id)
    }
}

#[async_trait]
impl MetaAgentService for RedisMetaAgentService {
    async fn register_meta_agent(&self, mut config: MetaAgentConfig) -> Result<String> {
        // Generate ID if not provided
        if config.id.is_empty() {
            config.id = self.generate_id("meta");
        }
        
        // Serialize the config
        let config_json = serde_json::to_string(&config)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        // Store in Redis
        let key = self.meta_agent_key(&config.id);
        self.redis_client.set(&key, &config_json, None).await?;
        
        // Add to list of meta-agents
        self.redis_client.sadd(&self.meta_agents_list_key(), &[&config.id]).await?;
        
        // Initialize metrics
        let metrics = MetaAgentMetrics {
            meta_agent_id: config.id.clone(),
            total_decisions: 0,
            successful_decisions: 0,
            failed_decisions: 0,
            avg_confidence: 0.0,
            avg_response_time_ms: 0,
            health_score: 1.0,
            custom_metrics: HashMap::new(),
            last_updated: Utc::now(),
        };
        
        let metrics_json = serde_json::to_string(&metrics)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        self.redis_client.set(&self.metrics_key(&config.id), &metrics_json, None).await?;
        
        info!("Registered new meta-agent: {}", config.id);
        Ok(config.id)
    }
    
    async fn get_meta_agent(&self, id: &str) -> Result<MetaAgentConfig> {
        let key = self.meta_agent_key(id);
        let json = self.redis_client.get(&key).await?
            .ok_or_else(|| Error::NotFound(format!("Meta-agent with ID {} not found", id)))?;
        
        serde_json::from_str(&json)
            .map_err(|e| Error::DeserializationError(e.to_string()))
    }
    
    async fn update_meta_agent(&self, config: MetaAgentConfig) -> Result<()> {
        // Check if meta-agent exists
        let key = self.meta_agent_key(&config.id);
        if !self.redis_client.exists(&key).await? {
            return Err(Error::NotFound(format!("Meta-agent with ID {} not found", config.id)));
        }
        
        // Serialize and update
        let config_json = serde_json::to_string(&config)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        self.redis_client.set(&key, &config_json, None).await?;
        info!("Updated meta-agent: {}", config.id);
        Ok(())
    }
    
    async fn list_meta_agents(&self) -> Result<Vec<MetaAgentConfig>> {
        let ids = self.redis_client.smembers(&self.meta_agents_list_key()).await?;
        let mut configs = Vec::with_capacity(ids.len());
        
        for id in ids {
            match self.get_meta_agent(&id).await {
                Ok(config) => configs.push(config),
                Err(e) => {
                    warn!("Error retrieving meta-agent {}: {}", id, e);
                    continue;
                }
            }
        }
        
        Ok(configs)
    }
    
    async fn deactivate_meta_agent(&self, id: &str) -> Result<()> {
        // Get current config
        let mut config = self.get_meta_agent(id).await?;
        
        // Update status to Retired
        config.supervision_level = SupervisionLevel::Critical;
        
        // Update config
        let config_json = serde_json::to_string(&config)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        let key = self.meta_agent_key(id);
        self.redis_client.set(&key, &config_json, None).await?;
        
        info!("Deactivated meta-agent: {}", id);
        Ok(())
    }
    
    async fn record_decision(&self, mut decision: MetaAgentDecision) -> Result<String> {
        // Generate ID if not provided
        if decision.id.is_empty() {
            decision.id = self.generate_id("decision");
        }
        
        // Serialize the decision
        let decision_json = serde_json::to_string(&decision)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        // Store in Redis
        let key = self.decision_key(&decision.id);
        self.redis_client.set(&key, &decision_json, None).await?;
        
        // Add to list of decisions for this meta-agent
        let decisions_key = self.meta_agent_decisions_key(&decision.meta_agent_id);
        self.redis_client.zadd(
            &decisions_key,
            &[(decision.timestamp.timestamp_millis() as f64, decision.id.clone())]
        ).await?;
        
        // Update metrics
        self.update_metrics_for_decision(&decision).await?;
        
        info!("Recorded new decision {} by meta-agent {}", decision.id, decision.meta_agent_id);
        Ok(decision.id)
    }
    
    async fn get_decision(&self, id: &str) -> Result<MetaAgentDecision> {
        let key = self.decision_key(id);
        let json = self.redis_client.get(&key).await?
            .ok_or_else(|| Error::NotFound(format!("Decision with ID {} not found", id)))?;
        
        serde_json::from_str(&json)
            .map_err(|e| Error::DeserializationError(e.to_string()))
    }
    
    async fn list_decisions(&self, meta_agent_id: &str, limit: u32) -> Result<Vec<MetaAgentDecision>> {
        let decisions_key = self.meta_agent_decisions_key(meta_agent_id);
        
        // Get the most recent decision IDs, sorted by timestamp
        let ids = self.redis_client.zrevrange(&decisions_key, 0, limit as i64 - 1).await?;
        let mut decisions = Vec::with_capacity(ids.len());
        
        for id in ids {
            match self.get_decision(&id).await {
                Ok(decision) => decisions.push(decision),
                Err(e) => {
                    warn!("Error retrieving decision {}: {}", id, e);
                    continue;
                }
            }
        }
        
        Ok(decisions)
    }
    
    async fn update_decision_status(&self, id: &str, status: DecisionStatus) -> Result<()> {
        // Get current decision
        let mut decision = self.get_decision(id).await?;
        
        // Update status
        decision.status = status;
        
        // Serialize and update
        let decision_json = serde_json::to_string(&decision)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        let key = self.decision_key(id);
        self.redis_client.set(&key, &decision_json, None).await?;
        
        // Update metrics based on new status
        self.update_metrics_for_decision(&decision).await?;
        
        info!("Updated decision {} status to {:?}", id, status);
        Ok(())
    }
    
    async fn get_meta_agent_metrics(&self, id: &str) -> Result<MetaAgentMetrics> {
        let key = self.metrics_key(id);
        let json = self.redis_client.get(&key).await?
            .ok_or_else(|| Error::NotFound(format!("Metrics for meta-agent with ID {} not found", id)))?;
        
        serde_json::from_str(&json)
            .map_err(|e| Error::DeserializationError(e.to_string()))
    }
}

impl RedisMetaAgentService {
    // Helper method to update metrics when a new decision is recorded or status changes
    async fn update_metrics_for_decision(&self, decision: &MetaAgentDecision) -> Result<()> {
        let metrics_key = self.metrics_key(&decision.meta_agent_id);
        
        // Get current metrics
        let json = match self.redis_client.get(&metrics_key).await? {
            Some(j) => j,
            None => {
                // Initialize metrics if not found
                let metrics = MetaAgentMetrics {
                    meta_agent_id: decision.meta_agent_id.clone(),
                    total_decisions: 0,
                    successful_decisions: 0,
                    failed_decisions: 0,
                    avg_confidence: 0.0,
                    avg_response_time_ms: 0,
                    health_score: 1.0,
                    custom_metrics: HashMap::new(),
                    last_updated: Utc::now(),
                };
                
                serde_json::to_string(&metrics)
                    .map_err(|e| Error::SerializationError(e.to_string()))?
            }
        };
        
        let mut metrics: MetaAgentMetrics = serde_json::from_str(&json)
            .map_err(|e| Error::DeserializationError(e.to_string()))?;
        
        // Update metrics based on decision status
        metrics.total_decisions += 1;
        
        match decision.status {
            DecisionStatus::Completed => {
                metrics.successful_decisions += 1;
            }
            DecisionStatus::Failed | DecisionStatus::RolledBack => {
                metrics.failed_decisions += 1;
            }
            _ => {}
        }
        
        // Update average confidence
        metrics.avg_confidence = ((metrics.avg_confidence * (metrics.total_decisions - 1) as f64) 
            + decision.confidence) / metrics.total_decisions as f64;
        
        // Update health score (simple calculation - could be more sophisticated)
        if metrics.total_decisions > 0 {
            metrics.health_score = metrics.successful_decisions as f64 / metrics.total_decisions as f64;
        }
        
        metrics.last_updated = Utc::now();
        
        // Save updated metrics
        let updated_json = serde_json::to_string(&metrics)
            .map_err(|e| Error::SerializationError(e.to_string()))?;
        
        self.redis_client.set(&metrics_key, &updated_json, None).await?;
        
        Ok(())
    }
}

/// Mock implementation of MetaAgentService for testing
pub struct MockMetaAgentService {
    configs: HashMap<String, MetaAgentConfig>,
    decisions: HashMap<String, MetaAgentDecision>,
    metrics: HashMap<String, MetaAgentMetrics>,
    agent_decisions: HashMap<String, Vec<String>>,
}

impl MockMetaAgentService {
    /// Create a new MockMetaAgentService
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            decisions: HashMap::new(),
            metrics: HashMap::new(),
            agent_decisions: HashMap::new(),
        }
    }
    
    // Helper method to generate a unique ID
    fn generate_id(&self, prefix: &str) -> String {
        format!("{}-{}", prefix, uuid::Uuid::new_v4())
    }
}

#[async_trait]
impl MetaAgentService for MockMetaAgentService {
    async fn register_meta_agent(&self, mut config: MetaAgentConfig) -> Result<String> {
        // Generate ID if not provided
        if config.id.is_empty() {
            config.id = self.generate_id("meta");
        }
        
        // Clone configs to allow mutation
        let mut configs = self.configs.clone();
        configs.insert(config.id.clone(), config.clone());
        
        // Update self
        let this = unsafe { &mut *(self as *const Self as *mut Self) };
        this.configs = configs;
        
        // Initialize metrics
        let metrics = MetaAgentMetrics {
            meta_agent_id: config.id.clone(),
            total_decisions: 0,
            successful_decisions: 0,
            failed_decisions: 0,
            avg_confidence: 0.0,
            avg_response_time_ms: 0,
            health_score: 1.0,
            custom_metrics: HashMap::new(),
            last_updated: Utc::now(),
        };
        
        let mut metrics_map = this.metrics.clone();
        metrics_map.insert(config.id.clone(), metrics);
        this.metrics = metrics_map;
        
        Ok(config.id)
    }
    
    async fn get_meta_agent(&self, id: &str) -> Result<MetaAgentConfig> {
        match self.configs.get(id) {
            Some(config) => Ok(config.clone()),
            None => Err(Error::NotFound(format!("Meta-agent with ID {} not found", id))),
        }
    }
    
    async fn update_meta_agent(&self, config: MetaAgentConfig) -> Result<()> {
        if !self.configs.contains_key(&config.id) {
            return Err(Error::NotFound(format!("Meta-agent with ID {} not found", config.id)));
        }
        
        // Clone configs to allow mutation
        let mut configs = self.configs.clone();
        configs.insert(config.id.clone(), config);
        
        // Update self
        let this = unsafe { &mut *(self as *const Self as *mut Self) };
        this.configs = configs;
        
        Ok(())
    }
    
    async fn list_meta_agents(&self) -> Result<Vec<MetaAgentConfig>> {
        Ok(self.configs.values().cloned().collect())
    }
    
    async fn deactivate_meta_agent(&self, id: &str) -> Result<()> {
        let config = match self.configs.get(id) {
            Some(config) => {
                let mut updated = config.clone();
                updated.supervision_level = SupervisionLevel::Critical;
                updated
            },
            None => return Err(Error::NotFound(format!("Meta-agent with ID {} not found", id))),
        };
        
        // Clone configs to allow mutation
        let mut configs = self.configs.clone();
        configs.insert(id.to_string(), config);
        
        // Update self
        let this = unsafe { &mut *(self as *const Self as *mut Self) };
        this.configs = configs;
        
        Ok(())
    }
    
    async fn record_decision(&self, mut decision: MetaAgentDecision) -> Result<String> {
        // Generate ID if not provided
        if decision.id.is_empty() {
            decision.id = self.generate_id("decision");
        }
        
        // Clone to allow mutation
        let mut decisions = self.decisions.clone();
        let mut agent_decisions = self.agent_decisions.clone();
        let mut metrics = self.metrics.clone();
        
        // Store decision
        decisions.insert(decision.id.clone(), decision.clone());
        
        // Update agent decisions list
        let agent_decisions_list = agent_decisions
            .entry(decision.meta_agent_id.clone())
            .or_insert_with(Vec::new);
        agent_decisions_list.push(decision.id.clone());
        
        // Update metrics
        if let Some(metric) = metrics.get_mut(&decision.meta_agent_id) {
            metric.total_decisions += 1;
            
            match decision.status {
                DecisionStatus::Completed => {
                    metric.successful_decisions += 1;
                }
                DecisionStatus::Failed | DecisionStatus::RolledBack => {
                    metric.failed_decisions += 1;
                }
                _ => {}
            }
            
            // Update average confidence
            metric.avg_confidence = ((metric.avg_confidence * (metric.total_decisions - 1) as f64) 
                + decision.confidence) / metric.total_decisions as f64;
            
            // Update health score
            if metric.total_decisions > 0 {
                metric.health_score = metric.successful_decisions as f64 / metric.total_decisions as f64;
            }
            
            metric.last_updated = Utc::now();
        }
        
        // Update self
        let this = unsafe { &mut *(self as *const Self as *mut Self) };
        this.decisions = decisions;
        this.agent_decisions = agent_decisions;
        this.metrics = metrics;
        
        Ok(decision.id)
    }
    
    async fn get_decision(&self, id: &str) -> Result<MetaAgentDecision> {
        match self.decisions.get(id) {
            Some(decision) => Ok(decision.clone()),
            None => Err(Error::NotFound(format!("Decision with ID {} not found", id))),
        }
    }
    
    async fn list_decisions(&self, meta_agent_id: &str, limit: u32) -> Result<Vec<MetaAgentDecision>> {
        match self.agent_decisions.get(meta_agent_id) {
            Some(ids) => {
                let mut decisions = Vec::new();
                for id in ids.iter().take(limit as usize) {
                    if let Some(decision) = self.decisions.get(id) {
                        decisions.push(decision.clone());
                    }
                }
                Ok(decisions)
            }
            None => Ok(Vec::new()),
        }
    }
    
    async fn update_decision_status(&self, id: &str, status: DecisionStatus) -> Result<()> {
        let decision = match self.decisions.get(id) {
            Some(decision) => {
                let mut updated = decision.clone();
                updated.status = status;
                updated
            },
            None => return Err(Error::NotFound(format!("Decision with ID {} not found", id))),
        };
        
        // Clone to allow mutation
        let mut decisions = self.decisions.clone();
        decisions.insert(id.to_string(), decision.clone());
        
        // Update metrics
        if let Some(metrics) = self.metrics.get(&decision.meta_agent_id) {
            let mut updated_metrics = metrics.clone();
            
            match decision.status {
                DecisionStatus::Completed => {
                    updated_metrics.successful_decisions += 1;
                }
                DecisionStatus::Failed | DecisionStatus::RolledBack => {
                    updated_metrics.failed_decisions += 1;
                }
                _ => {}
            }
            
            // Update health score
            if updated_metrics.total_decisions > 0 {
                updated_metrics.health_score = updated_metrics.successful_decisions as f64 / updated_metrics.total_decisions as f64;
            }
            
            updated_metrics.last_updated = Utc::now();
            
            let mut metrics_map = self.metrics.clone();
            metrics_map.insert(decision.meta_agent_id.clone(), updated_metrics);
            
            // Update self
            let this = unsafe { &mut *(self as *const Self as *mut Self) };
            this.metrics = metrics_map;
        }
        
        // Update self
        let this = unsafe { &mut *(self as *const Self as *mut Self) };
        this.decisions = decisions;
        
        Ok(())
    }
    
    async fn get_meta_agent_metrics(&self, id: &str) -> Result<MetaAgentMetrics> {
        match self.metrics.get(id) {
            Some(metrics) => Ok(metrics.clone()),
            None => Err(Error::NotFound(format!("Metrics for meta-agent with ID {} not found", id))),
        }
    }
} 