use anyhow::{Result, Context, anyhow};
use chrono::{DateTime, Utc};
use dirs;
use noderr_core::trust_score_engine::{TrustScore, TrustScoreSnapshot};
use noderr_core::trust_decay_service::TrustDecayConfig;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Struct to hold all data that needs to be persisted
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PersistedState {
    /// Trust scores for strategies
    pub trust_scores: HashMap<String, TrustScore>,
    
    /// Trust score history for strategies
    pub trust_score_history: HashMap<String, Vec<TrustScoreSnapshot>>,
    
    /// Activity timestamps for strategies
    pub activity_timestamps: HashMap<String, DateTime<Utc>>,
    
    /// Trust decay service configuration
    pub decay_config: TrustDecayConfig,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            trust_scores: HashMap::new(),
            trust_score_history: HashMap::new(),
            activity_timestamps: HashMap::new(),
            decay_config: TrustDecayConfig::default(),
        }
    }
}

/// Manages persistence for CLI testing tools
pub struct PersistenceManager {
    /// Path to the state file
    path: PathBuf,
    
    /// Current state
    state: Mutex<PersistedState>,
}

impl PersistenceManager {
    /// Create a new persistence manager
    pub fn new(path: PathBuf) -> Result<Self> {
        let state = if path.exists() {
            // Try to load existing state
            let mut file = File::open(&path)?;
            let mut contents = String::new();
            file.read_to_string(&mut contents)?;
            serde_json::from_str(&contents)?
        } else {
            // Create directory if it doesn't exist
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            PersistedState::default()
        };
        
        Ok(Self {
            path,
            state: Mutex::new(state),
        })
    }
    
    /// Save current state to disk
    pub fn save(&self) -> Result<()> {
        let state = self.state.lock().unwrap();
        let json = serde_json::to_string_pretty(&*state)?;
        
        let mut file = File::create(&self.path)?;
        file.write_all(json.as_bytes())?;
        
        Ok(())
    }
    
    /// Update trust score for a strategy
    pub fn update_trust_score(&self, strategy_id: &str, score: TrustScore) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.trust_scores.insert(strategy_id.to_string(), score);
        Ok(())
    }
    
    /// Get trust score for a strategy
    pub fn get_trust_score(&self, strategy_id: &str) -> Option<TrustScore> {
        let state = self.state.lock().unwrap();
        state.trust_scores.get(strategy_id).cloned()
    }
    
    /// Add a trust score snapshot to history
    pub fn add_trust_score_snapshot(&self, strategy_id: &str, snapshot: TrustScoreSnapshot) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let history = state.trust_score_history
            .entry(strategy_id.to_string())
            .or_insert_with(Vec::new);
        
        history.push(snapshot);
        
        // Keep only the last 90 days of history
        if history.len() > 90 {
            history.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            history.drain(0..(history.len() - 90));
        }
        
        Ok(())
    }
    
    /// Get trust score history for a strategy
    pub fn get_trust_score_history(&self, strategy_id: &str, limit: Option<usize>) -> Vec<TrustScoreSnapshot> {
        let state = self.state.lock().unwrap();
        let history = state.trust_score_history
            .get(strategy_id)
            .cloned()
            .unwrap_or_default();
        
        if let Some(limit) = limit {
            if limit < history.len() {
                let mut limited = history;
                limited.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)); // newest first
                limited.truncate(limit);
                return limited;
            }
        }
        
        history
    }
    
    /// Update activity timestamp for a strategy
    pub fn update_activity_timestamp(&self, strategy_id: &str, timestamp: DateTime<Utc>) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.activity_timestamps.insert(strategy_id.to_string(), timestamp);
        Ok(())
    }
    
    /// Get activity timestamp for a strategy
    pub fn get_activity_timestamp(&self, strategy_id: &str) -> Option<DateTime<Utc>> {
        let state = self.state.lock().unwrap();
        state.activity_timestamps.get(strategy_id).cloned()
    }
    
    /// Get all strategy IDs with recorded activity
    pub fn get_all_strategy_ids(&self) -> Vec<String> {
        let state = self.state.lock().unwrap();
        state.activity_timestamps.keys().cloned().collect()
    }
    
    /// Update trust decay configuration
    pub fn update_decay_config(&self, config: TrustDecayConfig) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.decay_config = config;
        Ok(())
    }
    
    /// Get trust decay configuration
    pub fn get_decay_config(&self) -> TrustDecayConfig {
        let state = self.state.lock().unwrap();
        state.decay_config.clone()
    }
    
    pub fn get_value(&self, key: &str) -> Result<String, anyhow::Error> {
        let state = self.state.lock().map_err(|_| anyhow::anyhow!("Failed to lock state"))?;
        
        match state.get(key) {
            Some(serde_json::Value::String(s)) => Ok(s.clone()),
            Some(value) => Ok(value.to_string()),
            None => Err(anyhow::anyhow!("Key not found: {}", key)),
        }
    }
}

/// Get default persistence path based on the system
pub fn get_default_persistence_path() -> Result<PathBuf> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| anyhow!("Could not determine data directory"))?;
    
    Ok(data_dir.join("noderr").join("cli-state.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[test]
    fn test_persistence_manager_save_load() -> Result<()> {
        // Create a temporary directory for testing
        let temp_dir = tempdir()?;
        let state_path = temp_dir.path().join("test-state.json");
        
        // Create a new persistence manager
        let persistence = PersistenceManager::new(state_path.clone())?;
        
        // Add some test data
        let strategy_id = "test-strategy";
        let score = TrustScore {
            value: 0.85,
            strategy_id: strategy_id.to_string(),
            last_updated: Utc::now(),
        };
        
        persistence.update_trust_score(strategy_id, score.clone())?;
        
        // Add a snapshot
        let snapshot = TrustScoreSnapshot {
            score: 0.85,
            timestamp: Utc::now(),
            reason: Some("Test snapshot".to_string()),
        };
        persistence.add_trust_score_snapshot(strategy_id, snapshot.clone())?;
        
        // Set activity timestamp
        let activity_time = Utc::now();
        persistence.update_activity_timestamp(strategy_id, activity_time)?;
        
        // Update decay config
        let mut config = TrustDecayConfig::default();
        config.default_decay_factor = 0.95;
        persistence.update_decay_config(config.clone())?;
        
        // Save to disk
        persistence.save()?;
        
        // Create a new persistence manager to load the data
        let loaded = PersistenceManager::new(state_path)?;
        
        // Verify the data was loaded correctly
        let loaded_score = loaded.get_trust_score(strategy_id).unwrap();
        assert_eq!(loaded_score.value, score.value);
        
        let loaded_history = loaded.get_trust_score_history(strategy_id, None);
        assert_eq!(loaded_history.len(), 1);
        
        let loaded_timestamp = loaded.get_activity_timestamp(strategy_id).unwrap();
        assert_eq!(loaded_timestamp, activity_time);
        
        let loaded_config = loaded.get_decay_config();
        assert_eq!(loaded_config.default_decay_factor, 0.95);
        
        Ok(())
    }
} 