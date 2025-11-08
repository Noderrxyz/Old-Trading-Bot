use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use noderr_core::trust_score_engine::{
    TrustScore, TrustScoreEngine, TrustScoreFeatures, TrustScoreHistory, TrustScoreHistoryEntry,
    TrustScoreConfig, TrustScoreSnapshot,
};
use rand::Rng;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use noderr_core::strategy_storage::StrategyStorage;
use crate::persistence::PersistenceManager;

/// Mock implementation of TrustScoreEngine for CLI testing
pub struct MockTrustScoreEngine {
    scores: Mutex<HashMap<String, f64>>,
    history: Mutex<HashMap<String, Vec<TrustScoreSnapshot>>>,
    persistence: Option<Arc<PersistenceManager>>,
}

impl MockTrustScoreEngine {
    pub fn new() -> Self {
        Self::new_with_persistence(None)
    }
    
    pub fn new_with_persistence(persistence: Option<Arc<PersistenceManager>>) -> Self {
        let mut scores = HashMap::new();
        let mut history = HashMap::new();
        
        // If we have persistence, use it to initialize
        if let Some(persistence) = &persistence {
            // Load strategy IDs and scores
            for strategy_id in persistence.get_all_strategy_ids() {
                if let Some(score) = persistence.get_trust_score(&strategy_id) {
                    scores.insert(strategy_id.clone(), score);
                }
                
                // Load history
                let snapshots = persistence.get_score_history(&strategy_id);
                if !snapshots.is_empty() {
                    history.insert(strategy_id, snapshots);
                }
            }
        }
        
        // If we don't have any persisted data, use defaults
        if scores.is_empty() {
            // Initialize with some mock data
            scores.insert("strategy-1".to_string(), 0.92);
            scores.insert("strategy-2".to_string(), 0.87);
            scores.insert("strategy-3".to_string(), 0.76);
            scores.insert("strategy-4".to_string(), 0.65);
            scores.insert("strategy-5".to_string(), 0.98);
            
            // Generate history data
            let mut rng = rand::thread_rng();
            
            for strategy_id in scores.keys() {
                let mut snapshots = Vec::new();
                let mut score = *scores.get(strategy_id).unwrap();
                
                // Generate 30 days of historical data
                for i in (0..30).rev() {
                    let timestamp = Utc::now() - Duration::days(i);
                    
                    // Add some random variations to the score for history
                    let variation = if i > 0 {
                        (rng.gen::<f64>() - 0.5) * 0.05
                    } else {
                        0.0 // Last day has exact current score
                    };
                    
                    let historical_score = (score + variation).max(0.0).min(1.0);
                    
                    // For historical data, we'll have earlier scores generally be higher
                    score = if i > 0 { 
                        (historical_score + 0.002).min(1.0) 
                    } else { 
                        historical_score 
                    };
                    
                    snapshots.push(TrustScoreSnapshot {
                        timestamp,
                        score: historical_score,
                        reason: Some("Historical data point".to_string()),
                    });
                }
                
                history.insert(strategy_id.clone(), snapshots);
            }
        }
        
        MockTrustScoreEngine {
            scores: Mutex::new(scores),
            history: Mutex::new(history),
            persistence,
        }
    }
}

#[async_trait]
impl TrustScoreEngine for MockTrustScoreEngine {
    async fn compute_trust_score(&self, strategy_id: &str) -> Result<f64> {
        // In a mock implementation, we'll just return the current score
        let scores = self.scores.lock().unwrap();
        let score = scores.get(strategy_id).cloned().unwrap_or(0.75);
        Ok(score)
    }
    
    async fn get_trust_score(&self, strategy_id: &str) -> Result<f64> {
        let scores = self.scores.lock().unwrap();
        let score = scores.get(strategy_id).cloned().unwrap_or(0.75);
        Ok(score)
    }
    
    async fn update_trust_score(&self, strategy_id: &str, new_score: f64, reason: Option<String>) -> Result<()> {
        // Update in-memory state
        {
            let mut scores = self.scores.lock().unwrap();
            scores.insert(strategy_id.to_string(), new_score);
            
            // Update history
            let mut history = self.history.lock().unwrap();
            let snapshots = history.entry(strategy_id.to_string()).or_insert_with(Vec::new);
            
            snapshots.push(TrustScoreSnapshot {
                timestamp: Utc::now(),
                score: new_score,
                reason: reason.clone(),
            });
        }
        
        // Update persistence if available
        if let Some(persistence) = &self.persistence {
            persistence.update_trust_score(strategy_id, new_score, reason)?;
        }
        
        Ok(())
    }
    
    async fn get_trust_score_history(&self, strategy_id: &str, limit: Option<usize>) -> Result<TrustScoreHistory> {
        let history = self.history.lock().unwrap();
        let snapshots = history.get(strategy_id)
            .cloned()
            .unwrap_or_default();
        
        let limited_snapshots = match limit {
            Some(n) if n < snapshots.len() => snapshots[snapshots.len() - n..].to_vec(),
            _ => snapshots,
        };
        
        Ok(TrustScoreHistory {
            strategy_id: strategy_id.to_string(),
            snapshots: limited_snapshots,
        })
    }
    
    async fn get_config(&self) -> Result<TrustScoreConfig> {
        // Return a default mock configuration
        Ok(TrustScoreConfig::default())
    }
    
    async fn update_config(&self, _config: TrustScoreConfig) -> Result<()> {
        // In mock implementation, we don't actually update the config
        Ok(())
    }
    
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// A mock implementation of StrategyStorage for testing
pub struct MockStrategyStorage {
    strategy_ids: Vec<String>,
}

impl MockStrategyStorage {
    pub fn new() -> Self {
        Self {
            strategy_ids: vec![
                "strategy-1".to_string(),
                "strategy-2".to_string(),
                "strategy-3".to_string(),
                "strategy-4".to_string(),
                "strategy-5".to_string(),
            ],
        }
    }
    
    pub fn get_strategy_ids(&self) -> Result<Vec<String>> {
        Ok(self.strategy_ids.clone())
    }
}

#[async_trait]
impl noderr_core::strategy_storage::StrategyStorage for MockStrategyStorage {
    async fn get_all_strategy_ids(&self) -> Result<Vec<String>> {
        Ok(self.strategy_ids.clone())
    }
    
    // Other methods would be implemented here, but we only need get_all_strategy_ids for CLI testing
}

/// Initialize a mock trust score engine for testing
pub async fn init_mock_trust_score_engine(persistence: Arc<PersistenceManager>) -> Result<Arc<dyn TrustScoreEngine>> {
    Ok(Arc::new(MockTrustScoreEngine::new_with_persistence(Some(persistence))))
}

/// Initialize a mock strategy storage for testing
pub async fn init_mock_strategy_storage() -> Result<Arc<dyn noderr_core::strategy_storage::StrategyStorage>> {
    Ok(Arc::new(MockStrategyStorage::new()))
} 