use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use log::{debug, info, warn};
use noderr_core::trust_decay_service::{
    TrustDecayService, TrustDecayConfig, StrategyActivityStatus,
};
use noderr_core::trust_score_engine::{TrustScore, TrustScoreEngine, TrustScoreSnapshot};
use noderr_core::strategy_storage::StrategyStorage;
use rand::Rng;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::time::sleep;
use colored::Colorize;
use crate::persistence::PersistenceManager;

/// A mock implementation of TrustDecayService for testing CLI commands
pub struct MockTrustDecayService {
    // Configuration
    config: Mutex<TrustDecayConfig>,
    
    // Trust score engine for reading and writing trust scores
    trust_score_engine: Arc<dyn TrustScoreEngine>,
    
    // Strategy storage
    strategy_storage: Arc<dyn StrategyStorage>,
    
    // Last activity timestamps for each strategy
    activity_timestamps: Mutex<HashMap<String, DateTime<Utc>>>,
    
    // Active strategies set
    active_strategies: Mutex<HashSet<String>>,
    
    // Running state
    is_running: Mutex<bool>,
    
    // Service status
    status: Mutex<TrustDecayStatus>,
    
    // Persistence manager
    persistence: Option<Arc<PersistenceManager>>,
}

impl MockTrustDecayService {
    /// Create a new mock trust decay service
    pub fn new(
        trust_score_engine: Arc<dyn TrustScoreEngine>,
        strategy_storage: Arc<dyn StrategyStorage>,
        persistence: Option<Arc<PersistenceManager>>,
    ) -> Self {
        // Load config from persistence if available
        let config = if let Some(persistence) = &persistence {
            persistence.get_decay_config()
        } else {
            TrustDecayConfig::default()
        };
        
        // Create instance
        let service = Self {
            config: Mutex::new(config),
            trust_score_engine,
            strategy_storage,
            activity_timestamps: Mutex::new(HashMap::new()),
            active_strategies: Mutex::new(HashSet::new()),
            is_running: Mutex::new(false),
            status: Mutex::new(TrustDecayStatus {
                enabled: true,
                next_run: Utc::now() + Duration::hours(24),
                last_run: Some(Utc::now() - Duration::hours(24)),
                strategies_count: 5,
            }),
            persistence,
        };
        
        // Initialize with activity data
        service.init_activity_data();
        
        service
    }
    
    /// Initialize activity data - either from persistence or mock data
    fn init_activity_data(&self) {
        let mut timestamps = self.activity_timestamps.lock().unwrap();
        let mut active = self.active_strategies.lock().unwrap();
        
        // Try to load from persistence first
        if let Some(persistence) = &self.persistence {
            for strategy_id in persistence.get_all_strategy_ids() {
                if let Some(timestamp) = persistence.get_activity_timestamp(&strategy_id) {
                    timestamps.insert(strategy_id.clone(), timestamp);
                    
                    // Mark as active if the timestamp is recent
                    let config = self.config.lock().unwrap();
                    let now = Utc::now();
                    let duration = now.signed_duration_since(timestamp);
                    
                    if duration < Duration::hours(config.inactivity_threshold_hours as i64 / 2) {
                        active.insert(strategy_id);
                    }
                }
            }
        }
        
        // If we have no persisted data, generate random data
        if timestamps.is_empty() {
            let mut rng = rand::thread_rng();
            
            // Initialize activity timestamps for strategies
            let strategy_ids = vec![
                "strategy-1".to_string(),
                "strategy-2".to_string(),
                "strategy-3".to_string(),
                "strategy-4".to_string(),
                "strategy-5".to_string(),
            ];
            
            for strategy_id in strategy_ids {
                // Generate a random timestamp within the last week
                let hours_ago = rng.gen_range(0..168); // 0 to 7 days in hours
                let timestamp = Utc::now() - Duration::hours(hours_ago);
                timestamps.insert(strategy_id.clone(), timestamp);
                
                // Randomly mark some strategies as active
                if rng.gen_bool(0.3) {
                    active.insert(strategy_id);
                }
            }
        }
    }
}

#[async_trait]
impl TrustDecayService for MockTrustDecayService {
    async fn start(&self) -> Result<()> {
        let mut running = self.is_running.lock().unwrap();
        if *running {
            return Err(anyhow!("Trust decay service is already running"));
        }
        
        *running = true;
        info!("Mock trust decay service started");
        Ok(())
    }
    
    async fn stop(&self) -> Result<()> {
        let mut running = self.is_running.lock().unwrap();
        if !*running {
            return Err(anyhow!("Trust decay service is not running"));
        }
        
        *running = false;
        info!("Mock trust decay service stopped");
        Ok(())
    }
    
    fn get_config(&self) -> TrustDecayConfig {
        self.config.lock().unwrap().clone()
    }
    
    async fn update_config(&self, config: TrustDecayConfig) -> Result<()> {
        let mut current_config = self.config.lock().unwrap();
        *current_config = config.clone();
        
        // Update next run time based on new interval
        let mut status = self.status.lock().unwrap();
        status.next_run = status.last_run.unwrap_or(Utc::now()) 
            + Duration::seconds(current_config.decay_interval_seconds as i64);
        
        // Persist configuration if available
        if let Some(persistence) = &self.persistence {
            persistence.update_decay_config(config)?;
        }
        
        Ok(())
    }
    
    async fn record_strategy_activity(&self, strategy_id: &str) -> Result<()> {
        let now = Utc::now();
        
        // Update in-memory state
        {
            let mut timestamps = self.activity_timestamps.lock().unwrap();
            let mut active = self.active_strategies.lock().unwrap();
            
            timestamps.insert(strategy_id.to_string(), now);
            active.insert(strategy_id.to_string());
        }
        
        // Update persistence if available
        if let Some(persistence) = &self.persistence {
            persistence.update_activity_timestamp(strategy_id, now)?;
        }
        
        Ok(())
    }
    
    async fn get_strategy_activity_status(&self, strategy_id: &str) -> Result<StrategyActivityStatus> {
        let timestamps = self.activity_timestamps.lock().unwrap();
        let active = self.active_strategies.lock().unwrap();
        let config = self.config.lock().unwrap();
        
        // Check if strategy is active
        if active.contains(strategy_id) {
            return Ok(StrategyActivityStatus::Active);
        }
        
        // Check last activity time
        if let Some(last_activity) = timestamps.get(strategy_id) {
            let inactive_threshold = Duration::hours(config.inactivity_threshold_hours as i64);
            let time_since_activity = Utc::now() - *last_activity;
            
            if time_since_activity > inactive_threshold {
                return Ok(StrategyActivityStatus::Inactive);
            } else {
                return Ok(StrategyActivityStatus::Idle);
            }
        }
        
        // No activity recorded
        Ok(StrategyActivityStatus::Unknown)
    }
    
    async fn apply_decay_to_strategy(&self, strategy_id: &str, custom_factor: Option<f64>) -> Result<f64> {
        let config = self.config.lock().unwrap();
        
        // Skip if decay is disabled or strategy is excluded
        if !config.enabled || config.excluded_strategies.contains(strategy_id) {
            return Err(anyhow!("Decay is disabled or strategy is excluded"));
        }
        
        // Get current trust score
        let current_score = self.trust_score_engine.get_trust_score(strategy_id).await?;
        
        // Determine decay factor
        let decay_factor = match custom_factor {
            Some(factor) => factor,
            None => match config.custom_decay_factors.get(strategy_id) {
                Some(factor) => *factor,
                None => config.default_decay_factor,
            },
        };
        
        // Calculate new score (mock implementation)
        // In a real implementation, this would update the actual trust score in the database
        let new_score = current_score * decay_factor;
        let new_score = new_score.max(0.0).min(1.0);
        
        info!(
            "Applied decay to strategy {}: {} -> {} (factor: {})",
            strategy_id, current_score, new_score, decay_factor
        );
        
        // In the mock, we don't actually update the score
        // But we return what the new score would be
        Ok(new_score)
    }
    
    async fn get_decaying_strategies(&self) -> Result<Vec<String>> {
        let strategies = match self.strategy_storage.get_strategy_ids() {
            Ok(ids) => ids,
            Err(e) => return Err(anyhow!("Failed to get strategy IDs: {}", e)),
        };
        
        let mut decaying = Vec::new();
        
        for strategy_id in strategies {
            let status = self.get_strategy_activity_status(&strategy_id).await?;
            if status == StrategyActivityStatus::Inactive {
                decaying.push(strategy_id);
            }
        }
        
        Ok(decaying)
    }
}

/// Create a mock trust decay service for CLI testing
pub async fn init_mock_trust_decay_service(
    trust_score_engine: Arc<dyn TrustScoreEngine>,
    strategy_storage: Arc<dyn StrategyStorage>,
    persistence: Arc<PersistenceManager>,
) -> Result<Arc<dyn TrustDecayService>> {
    let service = MockTrustDecayService::new(
        trust_score_engine, 
        strategy_storage, 
        Some(persistence)
    );
    
    // Start the service automatically
    let service = Arc::new(service);
    service.start().await?;
    
    Ok(service)
} 