use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use noderr_core::trust_score_engine::{TrustScore, TrustScoreConfig, TrustScoreEngine, TrustScoreSnapshot};
use rand::{Rng, thread_rng};
use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::persistence::PersistenceManager;

/// A mock implementation of the TrustScoreEngine for use in CLI testing
pub struct MockTrustScoreEngine {
    /// Mutex-protected map of trust scores by strategy ID
    scores: Mutex<HashMap<String, TrustScore>>,
    
    /// Mutex-protected map of trust score history by strategy ID
    history: Mutex<HashMap<String, Vec<TrustScoreSnapshot>>>,
    
    /// Mock configuration
    config: Mutex<TrustScoreConfig>,
    
    /// Optional persistence manager
    persistence: Option<Arc<PersistenceManager>>,
}

impl MockTrustScoreEngine {
    /// Create a new mock trust score engine
    pub fn new(persistence: Option<Arc<PersistenceManager>>) -> Self {
        let mut engine = Self {
            scores: Mutex::new(HashMap::new()),
            history: Mutex::new(HashMap::new()),
            config: Mutex::new(TrustScoreConfig::default()),
            persistence,
        };
        
        // Load data from persistence if available, otherwise initialize with mock data
        engine.init_data();
        
        engine
    }
    
    /// Initialize data from persistence or create mock data
    fn init_data(&self) {
        if let Some(persistence) = &self.persistence {
            // Try to load scores and history from persistence
            self.init_from_persistence(persistence);
        } else {
            // Initialize with mock data
            self.init_mock_data();
        }
    }
    
    /// Initialize data from persistence
    fn init_from_persistence(&self, persistence: &PersistenceManager) {
        // Get all strategy IDs
        let strategy_ids = persistence.get_all_strategy_ids();
        
        let mut scores = self.scores.lock().unwrap();
        let mut history = self.history.lock().unwrap();
        
        for strategy_id in strategy_ids {
            // Get trust score for this strategy
            if let Some(score) = persistence.get_trust_score(&strategy_id) {
                scores.insert(strategy_id.clone(), score);
            } else {
                // If no score exists, create a default one
                let score = TrustScore {
                    value: 0.75,
                    strategy_id: strategy_id.clone(),
                    last_updated: Utc::now(),
                };
                scores.insert(strategy_id.clone(), score);
            }
            
            // Get history for this strategy
            let snapshots = persistence.get_trust_score_history(&strategy_id, None);
            if !snapshots.is_empty() {
                history.insert(strategy_id, snapshots);
            }
        }
        
        // If no data was loaded, initialize with mock data
        if scores.is_empty() {
            drop(scores);
            drop(history);
            self.init_mock_data();
        }
    }
    
    /// Initialize with mock data
    fn init_mock_data(&self) {
        let mut scores = self.scores.lock().unwrap();
        let mut history = self.history.lock().unwrap();
        
        let strategy_ids = vec![
            "strat_bb_rsi_daily",
            "strat_macd_trend_1h",
            "strat_support_resistance_4h", 
            "strat_bollinger_bounce_15m",
            "strat_dmi_adx_crossing_1h"
        ];
        
        // Generate mock scores for each strategy
        for &strategy_id in &strategy_ids {
            let mut rng = thread_rng();
            let value = rng.gen_range(0.65..0.95);
            
            let score = TrustScore {
                value,
                strategy_id: strategy_id.to_string(),
                last_updated: Utc::now(),
            };
            
            scores.insert(strategy_id.to_string(), score);
            
            // Generate 30 days of history with some random variations
            let mut snapshots = Vec::new();
            let now = Utc::now();
            let mut current_score = value;
            
            for days_ago in (0..30).rev() {
                let timestamp = now - Duration::days(days_ago);
                let change = rng.gen_range(-0.03..0.03);
                current_score = (current_score + change).clamp(0.0, 1.0);
                
                let snapshot = TrustScoreSnapshot {
                    score: current_score,
                    timestamp,
                    reason: Some(format!("Day {} update", days_ago)),
                };
                
                snapshots.push(snapshot);
            }
            
            history.insert(strategy_id.to_string(), snapshots);
        }
    }
}

#[async_trait]
impl TrustScoreEngine for MockTrustScoreEngine {
    /// Compute trust score for a strategy
    async fn compute_trust_score(&self, strategy_id: &str) -> Result<TrustScore> {
        let scores = self.scores.lock().unwrap();
        
        if let Some(score) = scores.get(strategy_id) {
            Ok(score.clone())
        } else {
            // Generate a new random score if one doesn't exist
            let mut rng = thread_rng();
            let value = rng.gen_range(0.65..0.95);
            
            let score = TrustScore {
                value,
                strategy_id: strategy_id.to_string(),
                last_updated: Utc::now(),
            };
            
            // Store in persistence if available
            if let Some(persistence) = &self.persistence {
                persistence.update_trust_score(strategy_id, score.clone())?;
                persistence.save()?;
            }
            
            Ok(score)
        }
    }
    
    /// Get current trust score for a strategy
    async fn get_trust_score(&self, strategy_id: &str) -> Result<TrustScore> {
        let scores = self.scores.lock().unwrap();
        
        scores.get(strategy_id)
            .cloned()
            .ok_or_else(|| anyhow!("No trust score available for strategy {}", strategy_id))
    }
    
    /// Update trust score for a strategy
    async fn update_trust_score(&self, strategy_id: &str, score: f64, reason: Option<String>) -> Result<()> {
        let mut scores = self.scores.lock().unwrap();
        let mut history = self.history.lock().unwrap();
        
        // Create or update score
        let trust_score = TrustScore {
            value: score,
            strategy_id: strategy_id.to_string(),
            last_updated: Utc::now(),
        };
        
        scores.insert(strategy_id.to_string(), trust_score.clone());
        
        // Create snapshot
        let snapshot = TrustScoreSnapshot {
            score,
            timestamp: Utc::now(),
            reason,
        };
        
        // Add to history
        let snapshots = history
            .entry(strategy_id.to_string())
            .or_insert_with(Vec::new);
        
        snapshots.push(snapshot.clone());
        
        // Store in persistence if available
        if let Some(persistence) = &self.persistence {
            persistence.update_trust_score(strategy_id, trust_score)?;
            persistence.add_trust_score_snapshot(strategy_id, snapshot)?;
            persistence.save()?;
        }
        
        Ok(())
    }
    
    /// Get trust score history for a strategy
    async fn get_trust_score_history(&self, strategy_id: &str, limit: Option<usize>) -> Result<Vec<TrustScoreSnapshot>> {
        let history = self.history.lock().unwrap();
        
        let snapshots = history
            .get(strategy_id)
            .cloned()
            .unwrap_or_default();
        
        if let Some(limit) = limit {
            if limit < snapshots.len() {
                let mut limited = snapshots;
                limited.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)); // newest first
                limited.truncate(limit);
                return Ok(limited);
            }
        }
        
        Ok(snapshots)
    }
    
    /// Get trust score engine configuration
    async fn get_config(&self) -> Result<TrustScoreConfig> {
        let config = self.config.lock().unwrap();
        Ok(config.clone())
    }
    
    /// Update trust score engine configuration
    async fn update_config(&self, new_config: TrustScoreConfig) -> Result<()> {
        let mut config = self.config.lock().unwrap();
        *config = new_config;
        Ok(())
    }
    
    /// Convert to Any for downcasting
    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[tokio::test]
    async fn test_mock_trust_score_engine_basic() -> Result<()> {
        let engine = MockTrustScoreEngine::new(None);
        
        // Test compute trust score
        let score = engine.compute_trust_score("test_strategy").await?;
        assert!(score.value >= 0.0 && score.value <= 1.0);
        
        // Test update trust score
        engine.update_trust_score("test_strategy", 0.8, Some("Test update".to_string())).await?;
        
        // Test get trust score
        let updated_score = engine.get_trust_score("test_strategy").await?;
        assert_eq!(updated_score.value, 0.8);
        
        // Test get history
        let history = engine.get_trust_score_history("test_strategy", None).await?;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].score, 0.8);
        assert_eq!(history[0].reason, Some("Test update".to_string()));
        
        Ok(())
    }
    
    #[tokio::test]
    async fn test_mock_trust_score_engine_with_persistence() -> Result<()> {
        // Create a temporary directory for testing
        let temp_dir = tempdir()?;
        let state_path = temp_dir.path().join("test-state.json");
        
        // Create a persistence manager
        let persistence = Arc::new(PersistenceManager::new(state_path.clone())?);
        
        // Create a trust score engine with persistence
        let engine = MockTrustScoreEngine::new(Some(persistence.clone()));
        
        // Update a score
        engine.update_trust_score("test_strategy", 0.75, Some("Initial score".to_string())).await?;
        
        // Create a new engine with the same persistence
        let engine2 = MockTrustScoreEngine::new(Some(persistence));
        
        // Verify the score was loaded
        let score = engine2.get_trust_score("test_strategy").await?;
        assert_eq!(score.value, 0.75);
        
        // Verify history was loaded
        let history = engine2.get_trust_score_history("test_strategy", None).await?;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].score, 0.75);
        
        Ok(())
    }
} 