use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::path::Path;
use std::fs;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;
use std::collections::HashMap;
use uuid::Uuid;

// ReasonChainExport struct as specified in the requirements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasonChainExport {
    pub decision_id: String,
    pub agent_id: String,
    pub context: String,  // JSON serialized context
    pub timestamp: i64,
    pub steps: Vec<String>,
    pub final_strategy: String,
    pub final_score: f32,
    pub confidence: f32,
}

// Singleton for database connection management
lazy_static::lazy_static! {
    static ref DB_CONNECTION: Arc<Mutex<Option<Connection>>> = Arc::new(Mutex::new(None));
}

/// Storage for reason chains
pub struct ReasonChainStore;

impl ReasonChainStore {
    /// Database path
    pub fn db_path() -> Result<String> {
        let data_dir = dirs::data_dir()
            .ok_or_else(|| anyhow!("Could not determine data directory"))?
            .join("noderr");
        
        // Create directory if it doesn't exist
        fs::create_dir_all(&data_dir)?;
        
        Ok(data_dir.join("reason_chains.db").to_string_lossy().into_owned())
    }

    /// Initialize the database
    pub async fn initialize() -> Result<()> {
        let mut conn_guard = DB_CONNECTION.lock().await;
        
        if conn_guard.is_some() {
            return Ok(());
        }
        
        let db_path = Self::db_path()?;
        let conn = Connection::open(&db_path)?;
        
        // Create the reason_chains table if it doesn't exist
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reason_chains (
                decision_id TEXT PRIMARY KEY,
                agent_id TEXT,
                context TEXT,
                timestamp INTEGER,
                steps TEXT,
                final_strategy TEXT,
                final_score REAL,
                confidence REAL
            )",
            [],
        )?;
        
        // Create indexes for common queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_reason_chains_agent_id ON reason_chains(agent_id)",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_reason_chains_timestamp ON reason_chains(timestamp)",
            [],
        )?;
        
        *conn_guard = Some(conn);
        Ok(())
    }

    /// Persist a reason chain to the database
    pub async fn persist(chain: &ReasonChainExport) -> Result<()> {
        Self::initialize().await?;
        
        let mut conn_guard = DB_CONNECTION.lock().await;
        let conn = conn_guard.as_mut()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Serialize steps
        let steps_json = serde_json::to_string(&chain.steps)?;
        
        conn.execute(
            "INSERT OR REPLACE INTO reason_chains 
            (decision_id, agent_id, context, timestamp, steps, final_strategy, final_score, confidence)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                chain.decision_id,
                chain.agent_id,
                chain.context,
                chain.timestamp,
                steps_json,
                chain.final_strategy,
                chain.final_score,
                chain.confidence,
            ],
        )?;
        
        Ok(())
    }

    /// Get a reason chain by decision ID
    pub async fn get_by_id(decision_id: &str) -> Result<Option<ReasonChainExport>> {
        Self::initialize().await?;
        
        let conn_guard = DB_CONNECTION.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        let mut stmt = conn.prepare(
            "SELECT decision_id, agent_id, context, timestamp, steps, final_strategy, final_score, confidence
             FROM reason_chains
             WHERE decision_id = ?"
        )?;
        
        let mut rows = stmt.query(params![decision_id])?;
        
        if let Some(row) = rows.next()? {
            let steps_json: String = row.get(4)?;
            let steps: Vec<String> = serde_json::from_str(&steps_json)?;
            
            Ok(Some(ReasonChainExport {
                decision_id: row.get(0)?,
                agent_id: row.get(1)?,
                context: row.get(2)?,
                timestamp: row.get(3)?,
                steps,
                final_strategy: row.get(5)?,
                final_score: row.get(6)?,
                confidence: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Query reason chains by agent ID with limit and time range
    pub async fn query_by_agent(
        agent_id: &str, 
        limit: usize, 
        hours_ago: Option<u64>
    ) -> Result<Vec<ReasonChainExport>> {
        Self::initialize().await?;
        
        let conn_guard = DB_CONNECTION.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        let mut query = String::from(
            "SELECT decision_id, agent_id, context, timestamp, steps, final_strategy, final_score, confidence
             FROM reason_chains
             WHERE agent_id = ?"
        );
        
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(agent_id.to_string())];
        
        if let Some(hours) = hours_ago {
            let cutoff = Utc::now().timestamp() - (hours as i64 * 3600);
            query.push_str(" AND timestamp >= ?");
            params_vec.push(Box::new(cutoff));
        }
        
        query.push_str(" ORDER BY timestamp DESC LIMIT ?");
        params_vec.push(Box::new(limit as i64));
        
        let mut stmt = conn.prepare(&query)?;
        let mut rows = stmt.query(rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())))?;
        
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            let steps_json: String = row.get(4)?;
            let steps: Vec<String> = serde_json::from_str(&steps_json)?;
            
            results.push(ReasonChainExport {
                decision_id: row.get(0)?,
                agent_id: row.get(1)?,
                context: row.get(2)?,
                timestamp: row.get(3)?,
                steps,
                final_strategy: row.get(5)?,
                final_score: row.get(6)?,
                confidence: row.get(7)?,
            });
        }
        
        Ok(results)
    }
}

/// The exporter for reason chains
pub struct ReasonChainExporter;

impl ReasonChainExporter {
    /// Export a reason chain
    pub async fn export(chain: ReasonChainExport) -> Result<()> {
        ReasonChainStore::persist(&chain).await
    }
    
    /// Get reason chains by agent ID
    pub async fn get_chains_by_agent(
        agent_id: &str,
        limit: usize,
        hours_ago: Option<u64>
    ) -> Result<Vec<ReasonChainExport>> {
        ReasonChainStore::query_by_agent(agent_id, limit, hours_ago).await
    }
    
    /// Get a chain by decision ID
    pub async fn get_chain_by_id(decision_id: &str) -> Result<Option<ReasonChainExport>> {
        ReasonChainStore::get_by_id(decision_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::env;
    
    #[tokio::test]
    async fn test_persist_and_retrieve() -> Result<()> {
        // Use a temporary directory for the test database
        let temp_dir = tempdir()?;
        let db_path = temp_dir.path().join("test_reason_chains.db");
        
        // Override the database path for this test
        env::set_var("NODERR_DB_PATH", db_path.to_string_lossy().as_ref());
        
        // Create a test reason chain
        let chain = ReasonChainExport {
            decision_id: Uuid::new_v4().to_string(),
            agent_id: "test_agent".to_string(),
            context: r#"{"market":"BTC/USD"}"#.to_string(),
            timestamp: Utc::now().timestamp(),
            steps: vec![
                "Signal X exceeded threshold".to_string(),
                "Strategy A outperformed past 7 days".to_string(),
                "Selected Strategy C based on reward-to-risk".to_string(),
            ],
            final_strategy: "strat_c".to_string(),
            final_score: 0.92,
            confidence: 0.81,
        };
        
        // Export the chain
        ReasonChainExporter::export(chain.clone()).await?;
        
        // Retrieve the chain
        let retrieved = ReasonChainExporter::get_chain_by_id(&chain.decision_id).await?;
        
        assert!(retrieved.is_some());
        let retrieved = retrieved.unwrap();
        
        assert_eq!(retrieved.decision_id, chain.decision_id);
        assert_eq!(retrieved.agent_id, chain.agent_id);
        assert_eq!(retrieved.final_strategy, chain.final_strategy);
        assert_eq!(retrieved.steps.len(), chain.steps.len());
        
        Ok(())
    }
} 