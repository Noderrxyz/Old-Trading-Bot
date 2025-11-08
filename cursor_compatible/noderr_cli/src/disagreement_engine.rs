use anyhow::{anyhow, Result};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::fs;

/// Context information for strategy execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyContext {
    /// The agent ID associated with this context
    pub agent_id: String,
    /// The market or symbol being evaluated
    pub market: String,
    /// The timestamp of the context creation
    pub timestamp: i64,
    /// Additional context properties as key-value pairs
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

/// A vote for a strategy from a specific model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyVote {
    /// The model ID that provided this vote
    pub model_id: String,
    /// The strategy ID that was voted for
    pub strategy_id: String,
    /// The score assigned to this strategy
    pub score: f32,
    /// The confidence level of this vote
    pub confidence: f32,
    /// Optional reasoning chain explaining the vote
    pub reason_chain: Option<Vec<String>>,
}

/// Record of a disagreement between strategy models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisagreementRecord {
    /// Timestamp when the disagreement was detected
    pub timestamp: i64,
    /// The agent ID involved in the disagreement
    pub agent_id: String,
    /// The context in which the disagreement occurred
    pub context: StrategyContext,
    /// The votes from different strategy models
    pub strategy_votes: Vec<StrategyVote>,
    /// The strategy that was ultimately chosen (if any)
    pub dominant_strategy: Option<String>,
    /// A score representing the severity of disagreement
    pub disagreement_score: f32,
}

// Singleton for database connection management
lazy_static::lazy_static! {
    static ref DB_CONNECTION: Arc<Mutex<Option<Connection>>> = Arc::new(Mutex::new(None));
}

/// Storage for disagreement records
pub struct DisagreementStore;

impl DisagreementStore {
    /// Database path
    pub fn db_path() -> Result<String> {
        let data_dir = dirs::data_dir()
            .ok_or_else(|| anyhow!("Could not determine data directory"))?
            .join("noderr");
        
        // Create directory if it doesn't exist
        fs::create_dir_all(&data_dir)?;
        
        Ok(data_dir.join("meta_disagreements.db").to_string_lossy().into_owned())
    }

    /// Initialize the database
    pub async fn initialize() -> Result<()> {
        let mut conn_guard = DB_CONNECTION.lock().await;
        
        if conn_guard.is_some() {
            return Ok(());
        }
        
        let db_path = Self::db_path()?;
        let conn = Connection::open(&db_path)?;
        
        // Create the meta_disagreements table if it doesn't exist
        conn.execute(
            "CREATE TABLE IF NOT EXISTS meta_disagreements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER,
                agent_id TEXT,
                context TEXT,
                votes TEXT,
                score REAL,
                dominant_strategy TEXT
            )",
            [],
        )?;
        
        // Create indexes for common queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_meta_disagreements_agent_id ON meta_disagreements(agent_id)",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_meta_disagreements_timestamp ON meta_disagreements(timestamp)",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_meta_disagreements_score ON meta_disagreements(score)",
            [],
        )?;
        
        *conn_guard = Some(conn);
        Ok(())
    }

    /// Persist a disagreement record to the database
    pub async fn persist(record: &DisagreementRecord) -> Result<i64> {
        Self::initialize().await?;
        
        let mut conn_guard = DB_CONNECTION.lock().await;
        let conn = conn_guard.as_mut()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Serialize context and votes
        let context_json = serde_json::to_string(&record.context)?;
        let votes_json = serde_json::to_string(&record.strategy_votes)?;
        
        // Insert the record
        conn.execute(
            "INSERT INTO meta_disagreements 
            (timestamp, agent_id, context, votes, score, dominant_strategy)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                record.timestamp,
                record.agent_id,
                context_json,
                votes_json,
                record.disagreement_score,
                record.dominant_strategy,
            ],
        )?;
        
        // Get the last inserted rowid
        let id = conn.last_insert_rowid();
        
        Ok(id)
    }

    /// Query disagreement records with filtering
    pub async fn query(
        agent_id: Option<&str>,
        min_score: Option<f32>,
        limit: usize,
        days_ago: Option<u64>
    ) -> Result<Vec<DisagreementRecord>> {
        Self::initialize().await?;
        
        let conn_guard = DB_CONNECTION.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Build the query with conditional WHERE clauses
        let mut query = String::from(
            "SELECT timestamp, agent_id, context, votes, score, dominant_strategy
             FROM meta_disagreements
             WHERE 1=1"
        );
        
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        
        // Add agent_id filter if specified
        if let Some(agent) = agent_id {
            query.push_str(" AND agent_id = ?");
            params_vec.push(Box::new(agent.to_string()));
        }
        
        // Add min_score filter if specified
        if let Some(score) = min_score {
            query.push_str(" AND score >= ?");
            params_vec.push(Box::new(score));
        }
        
        // Add time range filter if specified
        if let Some(days) = days_ago {
            let cutoff = Utc::now().timestamp() - (days as i64 * 86400);
            query.push_str(" AND timestamp >= ?");
            params_vec.push(Box::new(cutoff));
        }
        
        // Add order by and limit
        query.push_str(" ORDER BY timestamp DESC LIMIT ?");
        params_vec.push(Box::new(limit as i64));
        
        // Execute the query
        let mut stmt = conn.prepare(&query)?;
        let mut rows = stmt.query(rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())))?;
        
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            // Extract row data
            let timestamp: i64 = row.get(0)?;
            let agent_id: String = row.get(1)?;
            let context_json: String = row.get(2)?;
            let votes_json: String = row.get(3)?;
            let score: f32 = row.get(4)?;
            let dominant_strategy: Option<String> = row.get(5)?;
            
            // Deserialize JSON
            let context: StrategyContext = serde_json::from_str(&context_json)?;
            let strategy_votes: Vec<StrategyVote> = serde_json::from_str(&votes_json)?;
            
            // Construct DisagreementRecord
            results.push(DisagreementRecord {
                timestamp,
                agent_id,
                context,
                strategy_votes,
                dominant_strategy,
                disagreement_score: score,
            });
        }
        
        Ok(results)
    }
}

/// Engine for detecting and managing disagreements between strategy models
pub struct MetaAgentDisagreementEngine;

impl MetaAgentDisagreementEngine {
    /// Calculate the disagreement score for a set of strategy votes
    pub fn calc_disagreement_score(votes: &[StrategyVote]) -> f32 {
        // Determine the number of unique strategies
        let strategies: HashSet<_> = votes.iter().map(|v| &v.strategy_id).collect();
        let unique_count = strategies.len();
        
        // Early exit if all votes are for the same strategy
        if unique_count <= 1 {
            return 0.0;
        }
        
        // Calculate average confidence across votes
        let avg_conf = votes.iter().map(|v| v.confidence).sum::<f32>() / votes.len().max(1) as f32;
        
        // Disagreement is more severe when there are many unique strategies with high confidence
        (unique_count as f32 - 1.0) * avg_conf
    }
    
    /// Detect if there is significant disagreement among strategy votes
    pub fn detect(votes: Vec<StrategyVote>, context: StrategyContext) -> Option<DisagreementRecord> {
        // Need at least two votes to have disagreement
        if votes.len() <= 1 {
            return None;
        }
        
        // Calculate disagreement score
        let score = Self::calc_disagreement_score(&votes);
        
        // If score below threshold, no significant disagreement
        if score < 0.3 {
            return None;
        }
        
        // Determine the dominant strategy (highest score)
        let dominant_strategy = votes.iter()
            .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal))
            .map(|v| v.strategy_id.clone());
        
        // Create disagreement record
        Some(DisagreementRecord {
            timestamp: Utc::now().timestamp(),
            agent_id: context.agent_id.clone(),
            context,
            strategy_votes: votes,
            dominant_strategy,
            disagreement_score: score,
        })
    }
    
    /// Resolve a disagreement using fallback rules
    pub fn resolve(record: &DisagreementRecord) -> Option<String> {
        // First try to select the strategy with the highest combined score * confidence
        let weighted_winner = record.strategy_votes.iter()
            .max_by(|a, b| {
                let a_weighted = a.score * a.confidence;
                let b_weighted = b.score * b.confidence;
                a_weighted.partial_cmp(&b_weighted).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|v| v.strategy_id.clone());
        
        // If there's no clear winner, fall back to the highest confidence
        let confidence_winner = if weighted_winner.is_none() {
            record.strategy_votes.iter()
                .max_by(|a, b| {
                    a.confidence.partial_cmp(&b.confidence).unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|v| v.strategy_id.clone())
        } else {
            None
        };
        
        // Return the best available winner
        weighted_winner.or(confidence_winner)
    }
    
    /// Store a detected disagreement
    pub async fn store(record: DisagreementRecord) -> Result<i64> {
        DisagreementStore::persist(&record).await
    }
    
    /// Detect, resolve, and store a disagreement
    pub async fn detect_and_store(votes: Vec<StrategyVote>, context: StrategyContext) -> Result<Option<DisagreementRecord>> {
        // Detect disagreement
        let mut record = match Self::detect(votes, context) {
            Some(record) => record,
            None => return Ok(None),
        };
        
        // Resolve the disagreement
        record.dominant_strategy = Self::resolve(&record);
        
        // Store the disagreement
        let _id = Self::store(record.clone()).await?;
        
        Ok(Some(record))
    }
    
    /// Query stored disagreements
    pub async fn query(
        agent_id: Option<&str>,
        min_score: Option<f32>,
        limit: usize,
        days_ago: Option<u64>
    ) -> Result<Vec<DisagreementRecord>> {
        DisagreementStore::query(agent_id, min_score, limit, days_ago).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    
    fn create_test_context() -> StrategyContext {
        StrategyContext {
            agent_id: "test_agent".to_string(),
            market: "BTC/USD".to_string(),
            timestamp: Utc::now().timestamp(),
            properties: HashMap::new(),
        }
    }
    
    fn create_test_votes(num_votes: usize, num_strategies: usize) -> Vec<StrategyVote> {
        let mut votes = Vec::new();
        
        for i in 0..num_votes {
            // Determine which strategy this vote is for
            let strategy_index = i % num_strategies;
            
            votes.push(StrategyVote {
                model_id: format!("model_{}", i),
                strategy_id: format!("strategy_{}", strategy_index),
                score: 0.7 + (i as f32 * 0.05), // Different scores
                confidence: 0.8,
                reason_chain: Some(vec![format!("Reason {}", i)]),
            });
        }
        
        votes
    }
    
    #[test]
    fn test_disagreement_score_calculation() {
        // No disagreement - single strategy
        let votes = create_test_votes(3, 1);
        assert_eq!(MetaAgentDisagreementEngine::calc_disagreement_score(&votes), 0.0);
        
        // 3 votes for 2 different strategies with confidence 0.8
        let votes = create_test_votes(3, 2);
        let expected_score = (2.0 - 1.0) * 0.8;
        assert!((MetaAgentDisagreementEngine::calc_disagreement_score(&votes) - expected_score).abs() < 0.0001);
        
        // 5 votes for 3 different strategies with confidence 0.8
        let votes = create_test_votes(5, 3);
        let expected_score = (3.0 - 1.0) * 0.8;
        assert!((MetaAgentDisagreementEngine::calc_disagreement_score(&votes) - expected_score).abs() < 0.0001);
    }
    
    #[test]
    fn test_detect_no_disagreement() {
        // Single vote - no disagreement possible
        let votes = create_test_votes(1, 1);
        let context = create_test_context();
        let result = MetaAgentDisagreementEngine::detect(votes, context);
        assert!(result.is_none());
        
        // Multiple votes for same strategy - no disagreement
        let votes = create_test_votes(3, 1);
        let context = create_test_context();
        let result = MetaAgentDisagreementEngine::detect(votes, context);
        assert!(result.is_none());
    }
    
    #[test]
    fn test_detect_disagreement() {
        // Multiple votes for different strategies - disagreement detected
        let votes = create_test_votes(5, 3);
        let context = create_test_context();
        let result = MetaAgentDisagreementEngine::detect(votes, context);
        assert!(result.is_some());
        
        let record = result.unwrap();
        assert_eq!(record.agent_id, "test_agent");
        assert_eq!(record.strategy_votes.len(), 5);
        assert!(record.disagreement_score > 0.3);
    }
    
    #[test]
    fn test_resolve_disagreement() {
        // Create a disagreement record
        let votes = create_test_votes(5, 3);
        let context = create_test_context();
        let record = MetaAgentDisagreementEngine::detect(votes, context).unwrap();
        
        // Resolve the disagreement
        let resolved = MetaAgentDisagreementEngine::resolve(&record);
        assert!(resolved.is_some());
        
        // Should select the strategy with highest score*confidence
        assert_eq!(resolved.unwrap(), "strategy_2"); // Last strategy gets highest scores
    }
} 