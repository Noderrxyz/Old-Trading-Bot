use anyhow::{anyhow, Result};
use chrono::{DateTime, Duration, Utc};
use noderr_core::trust_score_engine::{TrustScore, TrustScoreEngine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;
use tokio::time;
use crate::persistence::PersistenceManager;

/// Configuration for trust decay
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDecayConfig {
    /// Whether trust decay is enabled
    pub enabled: bool,
    
    /// Decay interval in hours
    pub decay_interval_hours: u32,
    
    /// Decay rate per interval (0.0-1.0)
    pub decay_rate: f64,
    
    /// Minimum score after decay
    pub min_score: f64,
    
    /// Inactivity threshold in days before decay starts
    pub inactivity_threshold_days: u32,
}

impl Default for TrustDecayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            decay_interval_hours: 24,
            decay_rate: 0.05,
            min_score: 0.5,
            inactivity_threshold_days: 7,
        }
    }
}

/// Service that handles trust score decay based on strategy activity
pub struct TrustDecayService {
    /// Engine that manages trust scores
    trust_score_engine: Arc<dyn TrustScoreEngine + Send + Sync>,
    
    /// Persistence manager for storing activity timestamps
    persistence: Arc<PersistenceManager>,
    
    /// Last activity time for each strategy
    activity_timestamps: Mutex<HashMap<String, DateTime<Utc>>>,
    
    /// Decay configuration
    config: Mutex<TrustDecayConfig>,
    
    /// Whether the service is running
    running: Mutex<bool>,
}

impl TrustDecayService {
    /// Create a new trust decay service
    pub fn new(
        trust_score_engine: Arc<dyn TrustScoreEngine + Send + Sync>,
        persistence: Arc<PersistenceManager>,
    ) -> Self {
        // Load activity timestamps from persistence
        let activity_timestamps = persistence.get_all_activity_timestamps();
        
        // Load decay configuration from persistence
        let config = persistence.get_trust_decay_config().unwrap_or_default();
        
        Self {
            trust_score_engine,
            persistence,
            activity_timestamps: Mutex::new(activity_timestamps),
            config: Mutex::new(config),
            running: Mutex::new(false),
        }
    }
    
    /// Record activity for a strategy
    pub fn record_activity(&self, strategy_id: &str) -> Result<()> {
        let timestamp = Utc::now();
        
        // Update in memory
        let mut activity_timestamps = self.activity_timestamps.lock().unwrap();
        activity_timestamps.insert(strategy_id.to_string(), timestamp);
        
        // Update in persistence
        self.persistence.set_activity_timestamp(strategy_id, timestamp)?;
        self.persistence.save()?;
        
        Ok(())
    }
    
    /// Get the last activity timestamp for a strategy
    pub fn get_last_activity(&self, strategy_id: &str) -> Option<DateTime<Utc>> {
        let activity_timestamps = self.activity_timestamps.lock().unwrap();
        activity_timestamps.get(strategy_id).cloned()
    }
    
    /// Get the decay configuration
    pub fn get_config(&self) -> TrustDecayConfig {
        let config = self.config.lock().unwrap();
        config.clone()
    }
    
    /// Update the decay configuration
    pub fn update_config(&self, new_config: TrustDecayConfig) -> Result<()> {
        // Update in memory
        let mut config = self.config.lock().unwrap();
        *config = new_config.clone();
        
        // Update in persistence
        self.persistence.update_trust_decay_config(new_config)?;
        self.persistence.save()?;
        
        Ok(())
    }
    
    /// Check if a strategy is considered inactive
    pub fn is_inactive(&self, strategy_id: &str) -> bool {
        let config = self.config.lock().unwrap();
        if !config.enabled {
            return false;
        }
        
        let activity_timestamps = self.activity_timestamps.lock().unwrap();
        if let Some(last_activity) = activity_timestamps.get(strategy_id) {
            let inactivity_threshold = Duration::days(config.inactivity_threshold_days as i64);
            let now = Utc::now();
            
            now.signed_duration_since(*last_activity) > inactivity_threshold
        } else {
            // No recorded activity, so consider it inactive
            true
        }
    }
    
    /// Calculate the new score after decay
    pub fn calculate_decayed_score(&self, current_score: f64) -> f64 {
        let config = self.config.lock().unwrap();
        let decay_amount = current_score * config.decay_rate;
        let new_score = current_score - decay_amount;
        new_score.max(config.min_score)
    }
    
    /// Start the trust decay service
    pub async fn start(&self) -> Result<()> {
        let mut running = self.running.lock().unwrap();
        if *running {
            return Err(anyhow!("Trust decay service already running"));
        }
        
        *running = true;
        drop(running);
        
        tokio::spawn(self.run_decay_loop());
        
        Ok(())
    }
    
    /// Stop the trust decay service
    pub fn stop(&self) -> Result<()> {
        let mut running = self.running.lock().unwrap();
        if !*running {
            return Err(anyhow!("Trust decay service not running"));
        }
        
        *running = false;
        
        Ok(())
    }
    
    /// Run the decay loop
    async fn run_decay_loop(self: Arc<Self>) {
        loop {
            // Check if we should still be running
            {
                let running = self.running.lock().unwrap();
                if !*running {
                    break;
                }
            }
            
            // Get the current config
            let config = self.get_config();
            if !config.enabled {
                // If decay is disabled, sleep and check again later
                time::sleep(StdDuration::from_secs(3600)).await; // Sleep for an hour
                continue;
            }
            
            // Process decay for all strategies
            let result = self.process_decay().await;
            if let Err(e) = result {
                eprintln!("Error in trust decay process: {}", e);
            }
            
            // Sleep until next interval
            let interval_secs = config.decay_interval_hours as u64 * 3600;
            time::sleep(StdDuration::from_secs(interval_secs)).await;
        }
    }
    
    /// Process decay for all strategies
    async fn process_decay(&self) -> Result<()> {
        let activity_timestamps = self.activity_timestamps.lock().unwrap();
        let strategy_ids: Vec<String> = activity_timestamps.keys().cloned().collect();
        drop(activity_timestamps);
        
        for strategy_id in strategy_ids {
            if self.is_inactive(&strategy_id) {
                // Get current trust score
                match self.trust_score_engine.get_trust_score(&strategy_id).await {
                    Ok(trust_score) => {
                        // Calculate new score after decay
                        let new_score = self.calculate_decayed_score(trust_score.value);
                        
                        // Only update if the score has changed
                        if (new_score - trust_score.value).abs() > 0.001 {
                            // Update the trust score
                            let reason = Some(format!(
                                "Trust decay due to inactivity since {}", 
                                self.get_last_activity(&strategy_id)
                                    .map(|ts| ts.to_rfc3339())
                                    .unwrap_or_else(|| "unknown".to_string())
                            ));
                            
                            self.trust_score_engine
                                .update_trust_score(&strategy_id, new_score, reason)
                                .await?;
                        }
                    },
                    Err(e) => {
                        eprintln!("Error getting trust score for {}: {}", strategy_id, e);
                    }
                }
            }
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock_trust_score_engine::MockTrustScoreEngine;
    use tempfile::tempdir;
    
    #[tokio::test]
    async fn test_trust_decay_service_basic() -> Result<()> {
        // Create a temporary directory for testing
        let temp_dir = tempdir()?;
        let state_path = temp_dir.path().join("test-state.json");
        
        // Create persistence manager
        let persistence = Arc::new(PersistenceManager::new(state_path)?);
        
        // Create mock trust score engine
        let trust_score_engine = Arc::new(MockTrustScoreEngine::new(Some(persistence.clone())));
        
        // Create trust decay service
        let decay_service = Arc::new(TrustDecayService::new(trust_score_engine.clone(), persistence));
        
        // Update config for faster testing
        let test_config = TrustDecayConfig {
            enabled: true,
            decay_interval_hours: 1,
            decay_rate: 0.1,
            min_score: 0.5,
            inactivity_threshold_days: 1,
        };
        decay_service.update_config(test_config)?;
        
        // Create a strategy with initial score
        let strategy_id = "test_strategy";
        trust_score_engine.update_trust_score(strategy_id, 0.8, Some("Initial score".to_string())).await?;
        
        // Record activity now
        decay_service.record_activity(strategy_id)?;
        
        // Verify not inactive yet
        assert!(!decay_service.is_inactive(strategy_id));
        
        // Manually set last activity to 2 days ago (making it inactive)
        let two_days_ago = Utc::now() - Duration::days(2);
        {
            let mut activity_timestamps = decay_service.activity_timestamps.lock().unwrap();
            activity_timestamps.insert(strategy_id.to_string(), two_days_ago);
        }
        decay_service.persistence.set_activity_timestamp(strategy_id, two_days_ago)?;
        decay_service.persistence.save()?;
        
        // Verify now inactive
        assert!(decay_service.is_inactive(strategy_id));
        
        // Manually process decay
        decay_service.process_decay().await?;
        
        // Verify score has been decayed
        let updated_score = trust_score_engine.get_trust_score(strategy_id).await?;
        assert!(updated_score.value < 0.8);
        assert_eq!(updated_score.value, 0.72); // 0.8 - (0.8 * 0.1)
        
        Ok(())
    }
    
    #[tokio::test]
    async fn test_calculate_decayed_score() -> Result<()> {
        // Create a temporary directory for testing
        let temp_dir = tempdir()?;
        let state_path = temp_dir.path().join("test-state.json");
        
        // Create persistence manager
        let persistence = Arc::new(PersistenceManager::new(state_path)?);
        
        // Create mock trust score engine
        let trust_score_engine = Arc::new(MockTrustScoreEngine::new(Some(persistence.clone())));
        
        // Create trust decay service
        let decay_service = TrustDecayService::new(trust_score_engine, persistence);
        
        // Test with different configurations
        
        // Default config (5% decay)
        assert_eq!(decay_service.calculate_decayed_score(0.8), 0.76); // 0.8 - (0.8 * 0.05)
        
        // Update to 10% decay
        let config = TrustDecayConfig {
            decay_rate: 0.1,
            ..TrustDecayConfig::default()
        };
        decay_service.update_config(config)?;
        assert_eq!(decay_service.calculate_decayed_score(0.8), 0.72); // 0.8 - (0.8 * 0.1)
        
        // Test minimum score
        let config = TrustDecayConfig {
            decay_rate: 0.5,
            min_score: 0.6,
            ..TrustDecayConfig::default()
        };
        decay_service.update_config(config)?;
        assert_eq!(decay_service.calculate_decayed_score(0.8), 0.6); // Would be 0.4, but min is 0.6
        
        Ok(())
    }
}