use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use crate::redis::RedisClient;
use anyhow::{anyhow, Result};
use ndarray::{Array1, ArrayView1};

/// Memory event types for agent timeline
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum MemoryEvent {
    #[serde(rename = "trust_decline")]
    TrustDecline {
        score_before: u32,
        score_after: u32,
        reason: String,
        timestamp: u64,
    },
    
    #[serde(rename = "trust_recovery")]
    TrustRecovery {
        score_before: u32,
        score_after: u32,
        reason: String,
        timestamp: u64,
    },
    
    #[serde(rename = "vote_alignment")]
    VoteAlignment {
        vote_id: String,
        alignment_score: f64,
        outcome: String,
        timestamp: u64,
    },
    
    #[serde(rename = "escalation")]
    Escalation {
        trigger: String,
        resolved_by: String,
        timestamp: u64,
    },
    
    #[serde(rename = "strategy_outcome")]
    StrategyOutcome {
        strategy_id: String,
        success: bool,
        performance: f64,
        timestamp: u64,
    },
    
    #[serde(rename = "canary_feedback")]
    CanaryFeedback {
        canary_id: String,
        feedback: String,
        severity: u32,
        timestamp: u64,
    },
    
    #[serde(rename = "tier_change")]
    TierChange {
        previous_tier: String,
        new_tier: String,
        reason: String,
        timestamp: u64,
    },
    
    #[serde(rename = "role_change")]
    RoleChange {
        previous_roles: Vec<String>,
        new_roles: Vec<String>,
        reason: String,
        timestamp: u64,
    },
    
    #[serde(rename = "signal_contribution")]
    SignalContribution {
        signal_id: String,
        quality_score: f64,
        timestamp: u64,
    },
    
    #[serde(rename = "custom")]
    Custom {
        event_name: String,
        data: HashMap<String, serde_json::Value>,
        timestamp: u64,
    },
}

/// Agent identity embedding vector
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEmbedding {
    /// The embedding vector
    pub vector: Vec<f64>,
    
    /// Timestamp when embedding was last updated
    pub updated_at: u64,
    
    /// Description of the embedding components
    pub components: HashMap<String, f64>,
}

/// Agent memory interface
#[async_trait]
pub trait MemoryService: Send + Sync {
    /// Record a memory event for an agent
    async fn record_event(&self, agent_id: &str, event: MemoryEvent) -> Result<()>;
    
    /// Get agent's timeline of events
    async fn get_timeline(&self, agent_id: &str) -> Result<Vec<MemoryEvent>>;
    
    /// Get filtered timeline events
    async fn get_filtered_timeline(&self, agent_id: &str, event_type: Option<&str>) -> Result<Vec<MemoryEvent>>;
    
    /// Update an agent's embedding
    async fn update_embedding(&self, agent_id: &str, embedding: AgentEmbedding) -> Result<()>;
    
    /// Get an agent's embedding
    async fn get_embedding(&self, agent_id: &str) -> Result<Option<AgentEmbedding>>;
    
    /// Find similar agents by embedding similarity
    async fn find_similar_agents(&self, agent_id: &str, limit: usize) -> Result<Vec<(String, f64)>>;
    
    /// Reset specific memory types for an agent
    async fn reset_memory(&self, agent_id: &str, memory_type: Option<&str>) -> Result<()>;
    
    /// Compare two agents' timelines and embeddings
    async fn compare_agents(&self, agent_id1: &str, agent_id2: &str) -> Result<AgentComparison>;
}

/// Agent comparison result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentComparison {
    /// Cosine similarity between agent embeddings
    pub embedding_similarity: Option<f64>,
    
    /// Timeline event type distribution comparison
    pub event_distribution: HashMap<String, (usize, usize)>,
    
    /// Vote alignment similarity
    pub vote_alignment_similarity: Option<f64>,
    
    /// Strategy performance comparison
    pub strategy_performance: Option<(f64, f64)>,
    
    /// Common and different events
    pub common_events: usize,
    pub different_events: usize,
}

/// Redis-based memory service implementation
pub struct RedisMemoryService {
    redis: Arc<RedisClient>,
}

impl RedisMemoryService {
    pub fn new(redis: Arc<RedisClient>) -> Self {
        Self { redis }
    }
    
    /// Get the timeline key for an agent
    fn timeline_key(&self, agent_id: &str) -> String {
        format!("memory:agent:{}:timeline", agent_id)
    }
    
    /// Get the embedding key for an agent
    fn embedding_key(&self, agent_id: &str) -> String {
        format!("memory:agent:{}:embedding", agent_id)
    }
    
    /// Get all agent IDs with embeddings
    async fn get_all_agent_ids_with_embeddings(&self) -> Result<Vec<String>> {
        let embedding_keys = self.redis.keys("memory:agent:*:embedding").await?;
        let mut agent_ids = Vec::with_capacity(embedding_keys.len());
        
        for key in embedding_keys {
            // Extract agent ID from "memory:agent:<id>:embedding"
            if let Some(agent_id) = key.strip_prefix("memory:agent:").and_then(|s| s.strip_suffix(":embedding")) {
                agent_ids.push(agent_id.to_string());
            }
        }
        
        Ok(agent_ids)
    }
    
    /// Calculate cosine similarity between two vectors
    fn cosine_similarity(&self, vec1: &[f64], vec2: &[f64]) -> f64 {
        if vec1.len() != vec2.len() || vec1.is_empty() {
            return 0.0;
        }
        
        let a = Array1::from_vec(vec1.to_vec());
        let b = Array1::from_vec(vec2.to_vec());
        
        let a_view = a.view();
        let b_view = b.view();
        
        let dot_product = a_view.dot(&b_view);
        let norm_a = (a_view.dot(&a_view)).sqrt();
        let norm_b = (b_view.dot(&b_view)).sqrt();
        
        if norm_a > 0.0 && norm_b > 0.0 {
            dot_product / (norm_a * norm_b)
        } else {
            0.0
        }
    }
}

#[async_trait]
impl MemoryService for RedisMemoryService {
    async fn record_event(&self, agent_id: &str, event: MemoryEvent) -> Result<()> {
        let timeline_key = self.timeline_key(agent_id);
        
        // Get existing timeline
        let timeline_data: Option<String> = self.redis.get(&timeline_key).await?;
        
        let mut timeline = match timeline_data {
            Some(data) => serde_json::from_str::<Vec<MemoryEvent>>(&data)?,
            None => Vec::new(),
        };
        
        // Add new event
        timeline.push(event);
        
        // Save updated timeline
        self.redis.set(&timeline_key, &serde_json::to_string(&timeline)?).await?;
        
        Ok(())
    }
    
    async fn get_timeline(&self, agent_id: &str) -> Result<Vec<MemoryEvent>> {
        let timeline_key = self.timeline_key(agent_id);
        
        // Get timeline from Redis
        let timeline_data: Option<String> = self.redis.get(&timeline_key).await?;
        
        match timeline_data {
            Some(data) => Ok(serde_json::from_str(&data)?),
            None => Ok(Vec::new()),
        }
    }
    
    async fn get_filtered_timeline(&self, agent_id: &str, event_type: Option<&str>) -> Result<Vec<MemoryEvent>> {
        let timeline = self.get_timeline(agent_id).await?;
        
        if let Some(filter_type) = event_type {
            // Filter events by type
            let filtered = timeline.into_iter()
                .filter(|event| {
                    match event {
                        MemoryEvent::TrustDecline { .. } => filter_type == "trust_decline",
                        MemoryEvent::TrustRecovery { .. } => filter_type == "trust_recovery",
                        MemoryEvent::VoteAlignment { .. } => filter_type == "vote_alignment",
                        MemoryEvent::Escalation { .. } => filter_type == "escalation",
                        MemoryEvent::StrategyOutcome { .. } => filter_type == "strategy_outcome",
                        MemoryEvent::CanaryFeedback { .. } => filter_type == "canary_feedback",
                        MemoryEvent::TierChange { .. } => filter_type == "tier_change",
                        MemoryEvent::RoleChange { .. } => filter_type == "role_change",
                        MemoryEvent::SignalContribution { .. } => filter_type == "signal_contribution",
                        MemoryEvent::Custom { .. } => filter_type == "custom",
                    }
                })
                .collect();
            
            Ok(filtered)
        } else {
            // Return all events
            Ok(timeline)
        }
    }
    
    async fn update_embedding(&self, agent_id: &str, embedding: AgentEmbedding) -> Result<()> {
        let embedding_key = self.embedding_key(agent_id);
        
        // Save embedding
        self.redis.set(&embedding_key, &serde_json::to_string(&embedding)?).await?;
        
        Ok(())
    }
    
    async fn get_embedding(&self, agent_id: &str) -> Result<Option<AgentEmbedding>> {
        let embedding_key = self.embedding_key(agent_id);
        
        // Get embedding from Redis
        let embedding_data: Option<String> = self.redis.get(&embedding_key).await?;
        
        match embedding_data {
            Some(data) => Ok(Some(serde_json::from_str(&data)?)),
            None => Ok(None),
        }
    }
    
    async fn find_similar_agents(&self, agent_id: &str, limit: usize) -> Result<Vec<(String, f64)>> {
        // Get the embedding for the specified agent
        let source_embedding = match self.get_embedding(agent_id).await? {
            Some(embedding) => embedding,
            None => return Err(anyhow!("No embedding found for agent {}", agent_id)),
        };
        
        // Get all other agent IDs
        let all_agent_ids = self.get_all_agent_ids_with_embeddings().await?;
        
        // Calculate similarities
        let mut similarities = Vec::new();
        
        for other_id in all_agent_ids {
            // Skip comparison with self
            if other_id == agent_id {
                continue;
            }
            
            // Get embedding for other agent
            if let Some(other_embedding) = self.get_embedding(&other_id).await? {
                // Calculate similarity
                let similarity = self.cosine_similarity(
                    &source_embedding.vector,
                    &other_embedding.vector
                );
                
                similarities.push((other_id, similarity));
            }
        }
        
        // Sort by similarity (highest first)
        similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        // Limit results
        Ok(similarities.into_iter().take(limit).collect())
    }
    
    async fn reset_memory(&self, agent_id: &str, memory_type: Option<&str>) -> Result<()> {
        match memory_type {
            Some("trust") => {
                // Get timeline
                let timeline_key = self.timeline_key(agent_id);
                let timeline_data: Option<String> = self.redis.get(&timeline_key).await?;
                
                if let Some(data) = timeline_data {
                    let mut timeline: Vec<MemoryEvent> = serde_json::from_str(&data)?;
                    
                    // Filter out trust-related events
                    timeline.retain(|event| {
                        !matches!(event, 
                            MemoryEvent::TrustDecline { .. } | 
                            MemoryEvent::TrustRecovery { .. }
                        )
                    });
                    
                    // Save filtered timeline
                    self.redis.set(&timeline_key, &serde_json::to_string(&timeline)?).await?;
                }
                
                Ok(())
            },
            Some("votes") => {
                // Get timeline
                let timeline_key = self.timeline_key(agent_id);
                let timeline_data: Option<String> = self.redis.get(&timeline_key).await?;
                
                if let Some(data) = timeline_data {
                    let mut timeline: Vec<MemoryEvent> = serde_json::from_str(&data)?;
                    
                    // Filter out vote-related events
                    timeline.retain(|event| {
                        !matches!(event, MemoryEvent::VoteAlignment { .. })
                    });
                    
                    // Save filtered timeline
                    self.redis.set(&timeline_key, &serde_json::to_string(&timeline)?).await?;
                }
                
                Ok(())
            },
            Some("all") | None => {
                // Delete all memory
                let timeline_key = self.timeline_key(agent_id);
                let embedding_key = self.embedding_key(agent_id);
                
                // Delete timeline and embedding
                self.redis.del(&timeline_key).await?;
                self.redis.del(&embedding_key).await?;
                
                Ok(())
            },
            Some(other) => Err(anyhow!("Unsupported memory type: {}", other)),
        }
    }
    
    async fn compare_agents(&self, agent_id1: &str, agent_id2: &str) -> Result<AgentComparison> {
        // Get embeddings for both agents
        let embedding1 = self.get_embedding(agent_id1).await?;
        let embedding2 = self.get_embedding(agent_id2).await?;
        
        // Calculate embedding similarity if both have embeddings
        let embedding_similarity = match (embedding1, embedding2) {
            (Some(e1), Some(e2)) => Some(self.cosine_similarity(&e1.vector, &e2.vector)),
            _ => None,
        };
        
        // Get timelines for both agents
        let timeline1 = self.get_timeline(agent_id1).await?;
        let timeline2 = self.get_timeline(agent_id2).await?;
        
        // Compare event distributions
        let mut event_distribution = HashMap::new();
        
        // Count event types for agent 1
        for event in &timeline1 {
            let event_type = match event {
                MemoryEvent::TrustDecline { .. } => "trust_decline",
                MemoryEvent::TrustRecovery { .. } => "trust_recovery",
                MemoryEvent::VoteAlignment { .. } => "vote_alignment",
                MemoryEvent::Escalation { .. } => "escalation",
                MemoryEvent::StrategyOutcome { .. } => "strategy_outcome",
                MemoryEvent::CanaryFeedback { .. } => "canary_feedback",
                MemoryEvent::TierChange { .. } => "tier_change",
                MemoryEvent::RoleChange { .. } => "role_change",
                MemoryEvent::SignalContribution { .. } => "signal_contribution",
                MemoryEvent::Custom { .. } => "custom",
            };
            
            let entry = event_distribution.entry(event_type.to_string()).or_insert((0, 0));
            entry.0 += 1;
        }
        
        // Count event types for agent 2
        for event in &timeline2 {
            let event_type = match event {
                MemoryEvent::TrustDecline { .. } => "trust_decline",
                MemoryEvent::TrustRecovery { .. } => "trust_recovery",
                MemoryEvent::VoteAlignment { .. } => "vote_alignment",
                MemoryEvent::Escalation { .. } => "escalation",
                MemoryEvent::StrategyOutcome { .. } => "strategy_outcome",
                MemoryEvent::CanaryFeedback { .. } => "canary_feedback",
                MemoryEvent::TierChange { .. } => "tier_change",
                MemoryEvent::RoleChange { .. } => "role_change",
                MemoryEvent::SignalContribution { .. } => "signal_contribution",
                MemoryEvent::Custom { .. } => "custom",
            };
            
            let entry = event_distribution.entry(event_type.to_string()).or_insert((0, 0));
            entry.1 += 1;
        }
        
        // Calculate vote alignment similarity
        let vote_alignment_similarity = {
            let votes1: Vec<&MemoryEvent> = timeline1.iter()
                .filter(|e| matches!(e, MemoryEvent::VoteAlignment { .. }))
                .collect();
                
            let votes2: Vec<&MemoryEvent> = timeline2.iter()
                .filter(|e| matches!(e, MemoryEvent::VoteAlignment { .. }))
                .collect();
                
            if !votes1.is_empty() && !votes2.is_empty() {
                // Calculate average alignment score for both agents
                let avg1: f64 = votes1.iter()
                    .filter_map(|e| {
                        if let MemoryEvent::VoteAlignment { alignment_score, .. } = e {
                            Some(*alignment_score)
                        } else {
                            None
                        }
                    })
                    .sum::<f64>() / votes1.len() as f64;
                    
                let avg2: f64 = votes2.iter()
                    .filter_map(|e| {
                        if let MemoryEvent::VoteAlignment { alignment_score, .. } = e {
                            Some(*alignment_score)
                        } else {
                            None
                        }
                    })
                    .sum::<f64>() / votes2.len() as f64;
                    
                // Calculate similarity as inverse of difference
                Some(1.0 - (avg1 - avg2).abs())
            } else {
                None
            }
        };
        
        // Calculate strategy performance comparison
        let strategy_performance = {
            let strategies1: Vec<&MemoryEvent> = timeline1.iter()
                .filter(|e| matches!(e, MemoryEvent::StrategyOutcome { .. }))
                .collect();
                
            let strategies2: Vec<&MemoryEvent> = timeline2.iter()
                .filter(|e| matches!(e, MemoryEvent::StrategyOutcome { .. }))
                .collect();
                
            if !strategies1.is_empty() && !strategies2.is_empty() {
                // Calculate average performance for both agents
                let avg1: f64 = strategies1.iter()
                    .filter_map(|e| {
                        if let MemoryEvent::StrategyOutcome { performance, .. } = e {
                            Some(*performance)
                        } else {
                            None
                        }
                    })
                    .sum::<f64>() / strategies1.len() as f64;
                    
                let avg2: f64 = strategies2.iter()
                    .filter_map(|e| {
                        if let MemoryEvent::StrategyOutcome { performance, .. } = e {
                            Some(*performance)
                        } else {
                            None
                        }
                    })
                    .sum::<f64>() / strategies2.len() as f64;
                    
                Some((avg1, avg2))
            } else {
                None
            }
        };
        
        // Count common and different events
        let mut common_events = 0;
        let mut different_events = 0;
        
        for (_, (count1, count2)) in &event_distribution {
            let common = count1.min(count2);
            let different = (count1 - count2).abs();
            
            common_events += common;
            different_events += different;
        }
        
        Ok(AgentComparison {
            embedding_similarity,
            event_distribution,
            vote_alignment_similarity,
            strategy_performance,
            common_events,
            different_events,
        })
    }
}

/// Create a Memory Service
pub fn create_memory_service(redis: Arc<RedisClient>) -> Arc<dyn MemoryService> {
    Arc::new(RedisMemoryService::new(redis))
}

/// Generate embedding for agent based on timeline events
pub async fn generate_agent_embedding(memory_service: &dyn MemoryService, agent_id: &str) -> Result<AgentEmbedding> {
    // Get agent timeline
    let timeline = memory_service.get_timeline(agent_id).await?;
    
    if timeline.is_empty() {
        return Err(anyhow!("Cannot generate embedding: no timeline events for agent {}", agent_id));
    }
    
    // Initialize component weights
    let mut components = HashMap::new();
    
    // Voting alignment average (0-1 scale)
    let vote_events: Vec<&MemoryEvent> = timeline.iter()
        .filter(|e| matches!(e, MemoryEvent::VoteAlignment { .. }))
        .collect();
        
    if !vote_events.is_empty() {
        let avg_alignment: f64 = vote_events.iter()
            .filter_map(|e| {
                if let MemoryEvent::VoteAlignment { alignment_score, .. } = e {
                    Some(*alignment_score)
                } else {
                    None
                }
            })
            .sum::<f64>() / vote_events.len() as f64;
            
        components.insert("voting_alignment".to_string(), avg_alignment);
    } else {
        components.insert("voting_alignment".to_string(), 0.5); // Neutral default
    }
    
    // Strategy success rate (0-1 scale)
    let strategy_events: Vec<&MemoryEvent> = timeline.iter()
        .filter(|e| matches!(e, MemoryEvent::StrategyOutcome { .. }))
        .collect();
        
    if !strategy_events.is_empty() {
        let success_count = strategy_events.iter()
            .filter(|e| {
                if let MemoryEvent::StrategyOutcome { success, .. } = e {
                    *success
                } else {
                    false
                }
            })
            .count();
            
        let success_rate = success_count as f64 / strategy_events.len() as f64;
        components.insert("strategy_success_rate".to_string(), success_rate);
        
        // Average strategy performance
        let avg_performance: f64 = strategy_events.iter()
            .filter_map(|e| {
                if let MemoryEvent::StrategyOutcome { performance, .. } = e {
                    Some(*performance)
                } else {
                    None
                }
            })
            .sum::<f64>() / strategy_events.len() as f64;
            
        components.insert("strategy_performance".to_string(), avg_performance);
    } else {
        components.insert("strategy_success_rate".to_string(), 0.5); // Neutral default
        components.insert("strategy_performance".to_string(), 0.5); // Neutral default
    }
    
    // Trust stability (higher value means more stable)
    let trust_events: Vec<&MemoryEvent> = timeline.iter()
        .filter(|e| matches!(e, MemoryEvent::TrustDecline { .. } | MemoryEvent::TrustRecovery { .. }))
        .collect();
        
    if !trust_events.is_empty() {
        // Calculate trust volatility (normalized change magnitude)
        let total_trust_change: f64 = trust_events.iter()
            .filter_map(|e| {
                match e {
                    MemoryEvent::TrustDecline { score_before, score_after, .. } => {
                        Some((*score_before as f64 - *score_after as f64).abs())
                    },
                    MemoryEvent::TrustRecovery { score_before, score_after, .. } => {
                        Some((*score_after as f64 - *score_before as f64).abs())
                    },
                    _ => None,
                }
            })
            .sum::<f64>();
            
        let avg_change = total_trust_change / trust_events.len() as f64;
        let trust_stability = 1.0 - (avg_change / 100.0).min(1.0); // Normalize and invert
        
        components.insert("trust_stability".to_string(), trust_stability);
    } else {
        components.insert("trust_stability".to_string(), 1.0); // Default to stable
    }
    
    // Escalation frequency (lower is better)
    let escalation_events = timeline.iter()
        .filter(|e| matches!(e, MemoryEvent::Escalation { .. }))
        .count();
        
    let escalation_rate = if timeline.len() > 0 {
        escalation_events as f64 / timeline.len() as f64
    } else {
        0.0
    };
    
    let escalation_score = 1.0 - escalation_rate;
    components.insert("escalation_score".to_string(), escalation_score);
    
    // Canary feedback (higher is better)
    let canary_events: Vec<&MemoryEvent> = timeline.iter()
        .filter(|e| matches!(e, MemoryEvent::CanaryFeedback { .. }))
        .collect();
        
    if !canary_events.is_empty() {
        let avg_severity: f64 = canary_events.iter()
            .filter_map(|e| {
                if let MemoryEvent::CanaryFeedback { severity, .. } = e {
                    Some(*severity as f64)
                } else {
                    None
                }
            })
            .sum::<f64>() / canary_events.len() as f64;
            
        // Convert to 0-1 scale (assuming severity is 0-10)
        let canary_score = 1.0 - (avg_severity / 10.0).min(1.0);
        components.insert("canary_feedback".to_string(), canary_score);
    } else {
        components.insert("canary_feedback".to_string(), 1.0); // Default to perfect
    }
    
    // Signal quality (higher is better)
    let signal_events: Vec<&MemoryEvent> = timeline.iter()
        .filter(|e| matches!(e, MemoryEvent::SignalContribution { .. }))
        .collect();
        
    if !signal_events.is_empty() {
        let avg_quality: f64 = signal_events.iter()
            .filter_map(|e| {
                if let MemoryEvent::SignalContribution { quality_score, .. } = e {
                    Some(*quality_score)
                } else {
                    None
                }
            })
            .sum::<f64>() / signal_events.len() as f64;
            
        components.insert("signal_quality".to_string(), avg_quality);
    } else {
        components.insert("signal_quality".to_string(), 0.5); // Neutral default
    }
    
    // Convert components to embedding vector
    // The order of components in the vector must be consistent
    let mut vector = Vec::new();
    
    // Add components in a fixed order
    let component_keys = vec![
        "voting_alignment",
        "strategy_success_rate",
        "strategy_performance",
        "trust_stability",
        "escalation_score",
        "canary_feedback",
        "signal_quality",
    ];
    
    for key in component_keys {
        vector.push(*components.get(key).unwrap_or(&0.5));
    }
    
    // Create embedding
    let embedding = AgentEmbedding {
        vector,
        updated_at: Utc::now().timestamp_millis() as u64,
        components,
    };
    
    Ok(embedding)
} 