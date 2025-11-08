use anyhow::{anyhow, Result};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::fs;
use uuid::Uuid;

/// Complete snapshot of an agent's state at a specific point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub snapshot_id: String,
    pub agent_id: String,
    pub timestamp: i64,
    pub trust_score: f32,
    pub current_role: String,
    pub memory_shard_hash: String,
    pub reason_chain: Vec<String>,
    pub strategy_state: Option<StrategyState>,
    pub context: AgentContext,
}

/// Agent context information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentContext {
    pub environment: String,
    pub execution_mode: String,
    pub permissions: Vec<String>,
    pub configuration: HashMap<String, serde_json::Value>,
    pub custom_data: Option<serde_json::Value>,
}

/// Strategy state information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyState {
    pub strategy_id: String,
    pub parameters: HashMap<String, serde_json::Value>,
    pub active_positions: Vec<Position>,
    pub last_execution_time: Option<i64>,
    pub performance_metrics: HashMap<String, f64>,
}

/// Position information for strategy state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub asset: String,
    pub size: f64,
    pub entry_price: f64,
    pub entry_time: i64,
    pub side: String,
    pub pnl: f64,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Agent instance representation for snapshot creation
pub struct AgentInstance {
    pub id: String,
    pub trust_state: TrustState,
    pub role: String,
    pub memory: AgentMemory,
    pub strategy_state: Option<StrategyState>,
    pub context: AgentContext,
    pub reason_chain_history: Vec<String>,
}

/// Trust state for an agent
#[derive(Debug, Clone)]
pub struct TrustState {
    pub score: f32,
    pub last_updated: i64,
    pub factors: HashMap<String, f32>,
}

/// Agent memory interface for exporting memory hashes
pub trait AgentMemory {
    fn export_hash(&self) -> Result<String>;
}

// Simple mock implementation for testing
pub struct MockAgentMemory {
    memory_hash: String,
}

impl MockAgentMemory {
    pub fn new(hash: &str) -> Self {
        Self {
            memory_hash: hash.to_string(),
        }
    }
}

impl AgentMemory for MockAgentMemory {
    fn export_hash(&self) -> Result<String> {
        Ok(self.memory_hash.clone())
    }
}

// Extension trait for AgentInstance
pub trait AgentInstanceExt {
    fn recent_reason_chain(&self) -> Vec<String>;
}

impl AgentInstanceExt for AgentInstance {
    fn recent_reason_chain(&self) -> Vec<String> {
        // Return the most recent reason chain entries (up to 10)
        let len = self.reason_chain_history.len();
        if len <= 10 {
            self.reason_chain_history.clone()
        } else {
            self.reason_chain_history[len - 10..].to_vec()
        }
    }
}

// Singleton for database connection management
lazy_static::lazy_static! {
    static ref DB_CONNECTION: Arc<Mutex<Option<Connection>>> = Arc::new(Mutex::new(None));
}

/// Manager for agent snapshots
pub struct AgentSnapshotManager {
    db: Arc<Mutex<Option<Connection>>>,
}

impl AgentSnapshotManager {
    /// Create a new AgentSnapshotManager
    pub fn new() -> Self {
        Self {
            db: DB_CONNECTION.clone(),
        }
    }

    /// Get the database path
    pub fn db_path() -> Result<String> {
        let data_dir = dirs::data_dir()
            .ok_or_else(|| anyhow!("Could not determine data directory"))?
            .join("noderr");
        
        // Create directory if it doesn't exist
        fs::create_dir_all(&data_dir)?;
        
        Ok(data_dir.join("agent_snapshots.db").to_string_lossy().into_owned())
    }

    /// Initialize the database
    pub async fn initialize(&self) -> Result<()> {
        let mut conn_guard = self.db.lock().await;
        
        if conn_guard.is_some() {
            return Ok(());
        }
        
        let db_path = Self::db_path()?;
        let conn = Connection::open(&db_path)?;
        
        // Create the agent_snapshots table if it doesn't exist
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_snapshots (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                trust_score REAL NOT NULL,
                role TEXT NOT NULL,
                memory_hash TEXT NOT NULL,
                reason_chain TEXT NOT NULL,
                strategy_state TEXT,
                context TEXT NOT NULL
            )",
            [],
        )?;
        
        // Create indexes for common queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_snapshots_agent_id ON agent_snapshots(agent_id)",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_snapshots_timestamp ON agent_snapshots(timestamp)",
            [],
        )?;
        
        *conn_guard = Some(conn);
        Ok(())
    }

    /// Create a snapshot of the agent's current state
    pub async fn create_snapshot(&self, agent: &AgentInstance) -> Result<AgentSnapshot> {
        let snapshot = AgentSnapshot {
            snapshot_id: Uuid::new_v4().to_string(),
            agent_id: agent.id.clone(),
            timestamp: Utc::now().timestamp(),
            trust_score: agent.trust_state.score,
            current_role: agent.role.to_string(),
            memory_shard_hash: agent.memory.export_hash()?,
            reason_chain: agent.recent_reason_chain(),
            strategy_state: agent.strategy_state.clone(),
            context: agent.context.clone(),
        };

        self.store_snapshot(&snapshot).await?;
        Ok(snapshot)
    }

    /// Store a snapshot in the database
    pub async fn store_snapshot(&self, snapshot: &AgentSnapshot) -> Result<()> {
        self.initialize().await?;
        
        let mut conn_guard = self.db.lock().await;
        let conn = conn_guard.as_mut()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Serialize complex objects to JSON
        let reason_chain_json = serde_json::to_string(&snapshot.reason_chain)?;
        let strategy_state_json = match &snapshot.strategy_state {
            Some(state) => serde_json::to_string(state)?,
            None => "null".to_string(),
        };
        let context_json = serde_json::to_string(&snapshot.context)?;
        
        // Insert the snapshot
        conn.execute(
            "INSERT INTO agent_snapshots (
                id, agent_id, timestamp, trust_score, role, 
                memory_hash, reason_chain, strategy_state, context
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
            )",
            params![
                snapshot.snapshot_id,
                snapshot.agent_id,
                snapshot.timestamp,
                snapshot.trust_score,
                snapshot.current_role,
                snapshot.memory_shard_hash,
                reason_chain_json,
                strategy_state_json,
                context_json,
            ],
        )?;
        
        Ok(())
    }

    /// Load a snapshot from the database
    pub async fn load_snapshot(&self, snapshot_id: &str) -> Result<Option<AgentSnapshot>> {
        self.initialize().await?;
        
        let conn_guard = self.db.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Query the snapshot
        let mut stmt = conn.prepare(
            "SELECT 
                id, agent_id, timestamp, trust_score, role, 
                memory_hash, reason_chain, strategy_state, context
             FROM agent_snapshots
             WHERE id = ?"
        )?;
        
        let snapshot_result = stmt.query_row(params![snapshot_id], |row| {
            // Parse row data
            let id: String = row.get(0)?;
            let agent_id: String = row.get(1)?;
            let timestamp: i64 = row.get(2)?;
            let trust_score: f32 = row.get(3)?;
            let role: String = row.get(4)?;
            let memory_hash: String = row.get(5)?;
            let reason_chain_json: String = row.get(6)?;
            let strategy_state_json: String = row.get(7)?;
            let context_json: String = row.get(8)?;
            
            // Deserialize JSON
            let reason_chain: Vec<String> = serde_json::from_str(&reason_chain_json)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
            
            let strategy_state: Option<StrategyState> = if strategy_state_json == "null" {
                None
            } else {
                serde_json::from_str(&strategy_state_json)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?
            };
            
            let context: AgentContext = serde_json::from_str(&context_json)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
            
            // Construct snapshot
            Ok(AgentSnapshot {
                snapshot_id: id,
                agent_id,
                timestamp,
                trust_score,
                current_role: role,
                memory_shard_hash: memory_hash,
                reason_chain,
                strategy_state,
                context,
            })
        });
        
        match snapshot_result {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(anyhow!("Error loading snapshot: {}", e)),
        }
    }

    /// List snapshots for an agent
    pub async fn list_snapshots(&self, agent_id: Option<&str>, limit: usize) -> Result<Vec<AgentSnapshotSummary>> {
        self.initialize().await?;
        
        let conn_guard = self.db.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Build query
        let mut query = String::from(
            "SELECT 
                id, agent_id, timestamp, trust_score, role
             FROM agent_snapshots"
        );
        
        if let Some(id) = agent_id {
            query.push_str(" WHERE agent_id = ?");
        }
        
        query.push_str(" ORDER BY timestamp DESC LIMIT ?");
        
        // Prepare and execute query
        let mut stmt = conn.prepare(&query)?;
        
        let rows = if let Some(id) = agent_id {
            stmt.query_map(params![id, limit as i64], |row| {
                map_snapshot_summary_row(row)
            })?
        } else {
            stmt.query_map(params![limit as i64], |row| {
                map_snapshot_summary_row(row)
            })?
        };
        
        // Collect results
        let mut snapshots = Vec::new();
        for row_result in rows {
            snapshots.push(row_result?);
        }
        
        Ok(snapshots)
    }

    /// Find snapshots by trust score range
    pub async fn find_by_trust_score(&self, min_score: f32, max_score: f32, limit: usize) -> Result<Vec<AgentSnapshotSummary>> {
        self.initialize().await?;
        
        let conn_guard = self.db.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Query snapshots within trust score range
        let mut stmt = conn.prepare(
            "SELECT 
                id, agent_id, timestamp, trust_score, role
             FROM agent_snapshots
             WHERE trust_score >= ? AND trust_score <= ?
             ORDER BY timestamp DESC
             LIMIT ?"
        )?;
        
        let rows = stmt.query_map(params![min_score, max_score, limit as i64], |row| {
            map_snapshot_summary_row(row)
        })?;
        
        // Collect results
        let mut snapshots = Vec::new();
        for row_result in rows {
            snapshots.push(row_result?);
        }
        
        Ok(snapshots)
    }

    /// Delete a snapshot
    pub async fn delete_snapshot(&self, snapshot_id: &str) -> Result<bool> {
        self.initialize().await?;
        
        let conn_guard = self.db.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Delete the snapshot
        let count = conn.execute(
            "DELETE FROM agent_snapshots WHERE id = ?",
            params![snapshot_id],
        )?;
        
        Ok(count > 0)
    }

    /// Compare two snapshots and return differences
    pub async fn compare_snapshots(&self, snapshot_id1: &str, snapshot_id2: &str) -> Result<SnapshotDiff> {
        let snapshot1 = self.load_snapshot(snapshot_id1).await?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id1))?;
        
        let snapshot2 = self.load_snapshot(snapshot_id2).await?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id2))?;
        
        Ok(SnapshotDiff::new(&snapshot1, &snapshot2))
    }
}

/// Helper function to map a row to a snapshot summary
fn map_snapshot_summary_row(row: &rusqlite::Row) -> rusqlite::Result<AgentSnapshotSummary> {
    Ok(AgentSnapshotSummary {
        snapshot_id: row.get(0)?,
        agent_id: row.get(1)?,
        timestamp: row.get(2)?,
        trust_score: row.get(3)?,
        role: row.get(4)?,
    })
}

/// Summary of an agent snapshot for listings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshotSummary {
    pub snapshot_id: String,
    pub agent_id: String,
    pub timestamp: i64,
    pub trust_score: f32,
    pub role: String,
}

/// Differences between two snapshots
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotDiff {
    pub snapshot_id1: String,
    pub snapshot_id2: String,
    pub time_difference: i64,
    pub trust_score_delta: f32,
    pub role_changed: bool,
    pub memory_hash_changed: bool,
    pub reason_chain_changes: Vec<ReasonChainChange>,
    pub strategy_changes: Vec<String>,
    pub context_changes: Vec<String>,
}

/// Change in reason chain between snapshots
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasonChainChange {
    pub operation: String, // "added", "removed", "changed"
    pub index: usize,
    pub value: Option<String>,
    pub previous_value: Option<String>,
}

impl SnapshotDiff {
    /// Create a diff between two snapshots
    pub fn new(snapshot1: &AgentSnapshot, snapshot2: &AgentSnapshot) -> Self {
        let mut diff = SnapshotDiff {
            snapshot_id1: snapshot1.snapshot_id.clone(),
            snapshot_id2: snapshot2.snapshot_id.clone(),
            time_difference: snapshot2.timestamp - snapshot1.timestamp,
            trust_score_delta: snapshot2.trust_score - snapshot1.trust_score,
            role_changed: snapshot1.current_role != snapshot2.current_role,
            memory_hash_changed: snapshot1.memory_shard_hash != snapshot2.memory_shard_hash,
            reason_chain_changes: Vec::new(),
            strategy_changes: Vec::new(),
            context_changes: Vec::new(),
        };
        
        // Calculate reason chain changes
        diff.reason_chain_changes = calculate_reason_chain_changes(
            &snapshot1.reason_chain, 
            &snapshot2.reason_chain
        );
        
        // Calculate strategy changes (simplified)
        if let (Some(s1), Some(s2)) = (&snapshot1.strategy_state, &snapshot2.strategy_state) {
            if s1.strategy_id != s2.strategy_id {
                diff.strategy_changes.push(format!(
                    "Strategy changed from {} to {}",
                    s1.strategy_id, s2.strategy_id
                ));
            }
            
            // Compare parameters (simplified)
            for (key, value1) in &s1.parameters {
                if let Some(value2) = s2.parameters.get(key) {
                    if value1 != value2 {
                        diff.strategy_changes.push(format!(
                            "Parameter '{}' changed", key
                        ));
                    }
                } else {
                    diff.strategy_changes.push(format!(
                        "Parameter '{}' removed", key
                    ));
                }
            }
            
            for key in s2.parameters.keys() {
                if !s1.parameters.contains_key(key) {
                    diff.strategy_changes.push(format!(
                        "Parameter '{}' added", key
                    ));
                }
            }
        } else if snapshot1.strategy_state.is_some() != snapshot2.strategy_state.is_some() {
            diff.strategy_changes.push("Strategy state presence changed".to_string());
        }
        
        // Calculate context changes (simplified)
        if snapshot1.context.environment != snapshot2.context.environment {
            diff.context_changes.push(format!(
                "Environment changed from '{}' to '{}'",
                snapshot1.context.environment, snapshot2.context.environment
            ));
        }
        
        if snapshot1.context.execution_mode != snapshot2.context.execution_mode {
            diff.context_changes.push(format!(
                "Execution mode changed from '{}' to '{}'",
                snapshot1.context.execution_mode, snapshot2.context.execution_mode
            ));
        }
        
        diff
    }
}

/// Calculate changes between two reason chains
fn calculate_reason_chain_changes(chain1: &[String], chain2: &[String]) -> Vec<ReasonChainChange> {
    let mut changes = Vec::new();
    
    // Find the common prefix length
    let common_length = chain1.iter().zip(chain2.iter())
        .take_while(|(a, b)| a == b)
        .count();
    
    // Items removed from chain1
    for (i, value) in chain1.iter().enumerate().skip(common_length) {
        changes.push(ReasonChainChange {
            operation: "removed".to_string(),
            index: i,
            value: None,
            previous_value: Some(value.clone()),
        });
    }
    
    // Items added in chain2
    for (i, value) in chain2.iter().enumerate().skip(common_length) {
        changes.push(ReasonChainChange {
            operation: "added".to_string(),
            index: i,
            value: Some(value.clone()),
            previous_value: None,
        });
    }
    
    changes
}

// Trait for replaying a snapshot
pub trait TrustReplayEngine: Send + Sync {
    fn replay_from_snapshot(&self, snapshot: &AgentSnapshot) -> Result<()>;
}

// Mock implementation for testing
pub struct MockTrustReplayEngine;

impl TrustReplayEngine for MockTrustReplayEngine {
    fn replay_from_snapshot(&self, snapshot: &AgentSnapshot) -> Result<()> {
        // In a real implementation, this would:
        // 1. Reconstruct agent state from the snapshot
        // 2. Set up the simulation environment 
        // 3. Begin replaying decisions from that point forward

        println!("📊 Replaying snapshot {} for agent {}", 
            snapshot.snapshot_id, snapshot.agent_id);
        println!("Starting from trust score: {}", snapshot.trust_score);
        
        // Simulate replaying
        for (i, step) in snapshot.reason_chain.iter().enumerate() {
            println!("Step {}: {}", i + 1, step);
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_agent() -> AgentInstance {
        AgentInstance {
            id: "test-agent-1".to_string(),
            trust_state: TrustState {
                score: 0.85,
                last_updated: Utc::now().timestamp(),
                factors: HashMap::new(),
            },
            role: "executor".to_string(),
            memory: MockAgentMemory::new("test-memory-hash"),
            strategy_state: Some(StrategyState {
                strategy_id: "test-strategy".to_string(),
                parameters: HashMap::new(),
                active_positions: Vec::new(),
                last_execution_time: Some(Utc::now().timestamp()),
                performance_metrics: HashMap::new(),
            }),
            context: AgentContext {
                environment: "test".to_string(),
                execution_mode: "simulation".to_string(),
                permissions: vec!["read".to_string(), "write".to_string()],
                configuration: HashMap::new(),
                custom_data: None,
            },
            reason_chain_history: vec![
                "Received market data".to_string(),
                "Analyzed trend patterns".to_string(),
                "Computed signal strength".to_string(),
            ],
        }
    }
} 