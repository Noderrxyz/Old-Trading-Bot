use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use noderr_core::trust_score_engine::{TrustScoreEngine, TrustScore, TrustScoreSnapshot};
use noderr_core::trust_decay_service::{TrustDecayConfig, StrategyActivityStatus};
use noderr_core::strategy_storage::StrategyStorage;
use rand::Rng;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use colored::Colorize;

/// Status of the trust decay service
#[derive(Debug, Clone)]
pub struct TrustDecayStatus {
    pub enabled: bool,
    pub next_run: DateTime<Utc>,
    pub last_run: Option<DateTime<Utc>>,
    pub strategies_count: usize,
}

/// Simulation result for trust decay over time
pub struct DecaySimulation {
    pub days: usize,
    pub data_points: Vec<SimulationPoint>,
}

/// A single point in a decay simulation
pub struct SimulationPoint {
    pub day: usize,
    pub score: f64,
    pub is_recovery: bool,
}

/// Mock implementation of the TrustDecayService for CLI testing
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
}

impl MockTrustDecayService {
    /// Create a new mock trust decay service
    pub fn new(
        trust_score_engine: Arc<dyn TrustScoreEngine>,
        strategy_storage: Arc<dyn StrategyStorage>,
    ) -> Self {
        // Create instance
        let service = Self {
            config: Mutex::new(TrustDecayConfig::default()),
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
        };
        
        // Initialize with simulated activity data
        service.init_mock_data();
        
        service
    }
    
    /// Initialize mock data for testing
    fn init_mock_data(&self) {
        let mut rng = rand::thread_rng();
        let mut timestamps = self.activity_timestamps.lock().unwrap();
        let mut active = self.active_strategies.lock().unwrap();
        
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

    /// Run a single decay cycle
    async fn run_decay_cycle(&self) -> Result<usize> {
        let config = self.config.lock().unwrap();
        
        if !config.enabled {
            return Ok(0);
        }
        
        // For mock implementation, we'll just update the status
        let mut status = self.status.lock().unwrap();
        status.last_run = Some(Utc::now());
        status.next_run = Utc::now() + Duration::hours(24);
        
        // In a real implementation, we would actually apply decay to each strategy
        // Here we'll just simulate it for the known strategies
        let strategy_ids = vec![
            "strategy-1".to_string(),
            "strategy-2".to_string(),
            "strategy-3".to_string(),
            "strategy-4".to_string(),
            "strategy-5".to_string(),
        ];
        
        let mut decayed_count = 0;
        
        // Apply decay to each strategy
        for strategy_id in &strategy_ids {
            // Check if strategy should be decayed
            if let Ok(status) = self.get_strategy_activity_status(strategy_id).await {
                match status {
                    StrategyActivityStatus::Inactive { .. } => {
                        // Apply decay
                        if self.apply_decay_to_strategy(strategy_id, None).await.is_ok() {
                            decayed_count += 1;
                        }
                    },
                    _ => {
                        // Skip active or recently inactive strategies
                    }
                }
            }
        }
        
        Ok(decayed_count)
    }

    /// Get the current status of the decay service
    pub async fn get_status(&self) -> Result<TrustDecayStatus> {
        Ok(self.status.lock().unwrap().clone())
    }
    
    /// Simulate decay for a given number of days
    pub async fn simulate_decay(&self, 
        initial_score: f64,
        decay_factor: f64,
        jitter: f64,
        days: usize,
        recovery_points: Vec<usize>
    ) -> Result<DecaySimulation> {
        let mut rng = rand::thread_rng();
        
        let mut data_points = Vec::new();
        let mut current_score = initial_score;
        
        for day in 0..days {
            // Apply random jitter to decay factor
            let actual_decay = if jitter > 0.0 {
                let jitter_amount = (rng.gen::<f64>() - 0.5) * 2.0 * jitter * decay_factor;
                decay_factor + jitter_amount
            } else {
                decay_factor
            };
            
            // Check if this is a recovery point
            let is_recovery = recovery_points.contains(&day);
            
            if is_recovery {
                // Apply recovery (increase score)
                current_score = (current_score + decay_factor * 3.0).min(1.0);
            } else {
                // Apply decay
                current_score = (current_score - actual_decay).max(0.0);
            }
            
            data_points.push(SimulationPoint {
                day,
                score: current_score,
                is_recovery,
            });
        }
        
        Ok(DecaySimulation {
            days,
            data_points,
        })
    }

    /// Check if a trust score crosses any thresholds and emit events
    async fn check_threshold_crossings(
        &self,
        strategy_id: &str,
        old_score: f64,
        new_score: f64
    ) -> Result<()> {
        let config = self.config.lock().unwrap();
        
        // Skip if threshold events are disabled
        if !config.emit_threshold_events {
            return Ok(());
        }
        
        // Check for warning threshold crossing (higher -> lower)
        if old_score >= config.warning_threshold && new_score < config.warning_threshold {
            println!("{}", format!("⚠️ WARNING: Trust score for strategy {} dropped below warning threshold ({:.2})", 
                    strategy_id, config.warning_threshold).yellow());
            
            // In real implementation, this would publish to telemetry system
        }
        
        // Check for critical threshold crossing (higher -> lower)
        if old_score >= config.critical_threshold && new_score < config.critical_threshold {
            println!("{}", format!("🚨 CRITICAL: Trust score for strategy {} dropped below critical threshold ({:.2})", 
                    strategy_id, config.critical_threshold).red().bold());
            
            // In real implementation, this would publish to telemetry system
        }
        
        Ok(())
    }
}

#[async_trait]
impl noderr_core::trust_decay_service::TrustDecayService for MockTrustDecayService {
    async fn start(&self) -> Result<()> {
        let mut running = self.is_running.lock().unwrap();
        if *running {
            return Err(anyhow!("Trust decay service is already running"));
        }
        
        *running = true;
        
        // Update service status
        let mut status = self.status.lock().unwrap();
        status.enabled = true;
        
        Ok(())
    }
    
    async fn stop(&self) -> Result<()> {
        let mut running = self.is_running.lock().unwrap();
        if !*running {
            return Err(anyhow!("Trust decay service is not running"));
        }
        
        *running = false;
        
        // Update service status
        let mut status = self.status.lock().unwrap();
        status.enabled = false;
        
        Ok(())
    }
    
    fn get_config(&self) -> TrustDecayConfig {
        self.config.lock().unwrap().clone()
    }
    
    async fn update_config(&self, config: TrustDecayConfig) -> Result<()> {
        let mut current_config = self.config.lock().unwrap();
        *current_config = config;
        
        // Update next run time based on new interval
        let mut status = self.status.lock().unwrap();
        status.next_run = status.last_run.unwrap_or(Utc::now()) 
            + Duration::seconds(current_config.decay_interval_seconds as i64);
        
        Ok(())
    }
    
    async fn record_strategy_activity(&self, strategy_id: &str) -> Result<()> {
        let mut timestamps = self.activity_timestamps.lock().unwrap();
        let mut active = self.active_strategies.lock().unwrap();
        
        timestamps.insert(strategy_id.to_string(), Utc::now());
        active.insert(strategy_id.to_string());
        
        Ok(())
    }
    
    async fn get_strategy_activity_status(&self, strategy_id: &str) -> Result<StrategyActivityStatus> {
        let now = Utc::now();
        let config = self.config.lock().unwrap();
        
        // Check if strategy is currently active
        if self.active_strategies.lock().unwrap().contains(strategy_id) {
            return Ok(StrategyActivityStatus::Active);
        }
        
        // Get last activity timestamp
        let last_activity = match self.activity_timestamps.lock().unwrap().get(strategy_id) {
            Some(timestamp) => *timestamp,
            None => {
                // If no activity recorded, assume it's new and active
                return Ok(StrategyActivityStatus::Active);
            }
        };
        
        // Calculate inactivity duration
        let inactivity_duration = now.signed_duration_since(last_activity);
        let inactivity_threshold = Duration::hours(config.inactivity_threshold_hours as i64);
        
        if inactivity_duration < inactivity_threshold {
            // Recently inactive (within threshold)
            Ok(StrategyActivityStatus::RecentlyInactive { last_activity })
        } else {
            // Inactive beyond threshold
            let decay_started = last_activity + inactivity_threshold;
            Ok(StrategyActivityStatus::Inactive { 
                last_activity, 
                decay_started,
            })
        }
    }
    
    async fn apply_decay_to_strategy(&self, strategy_id: &str, decay_factor: Option<f64>) -> Result<TrustScore> {
        let config = self.config.lock().unwrap();
        
        // Get current trust score
        let current_score = self.trust_score_engine.get_trust_score(strategy_id).await?;
        
        // Determine decay factor to use
        let decay_factor = decay_factor.unwrap_or_else(|| {
            config.strategy_decay_factors
                .get(strategy_id)
                .copied()
                .unwrap_or(config.default_decay_factor_per_day)
        });
        
        // Convert daily decay factor to hourly
        // hourly_factor = daily_factor^(1/24)
        let hourly_decay_factor = decay_factor.powf(1.0/24.0);
        
        // Apply decay to score
        let old_score_value = current_score;
        let new_score_value = (old_score_value * hourly_decay_factor).max(0.0).min(1.0);
        
        // Create mock TrustScore
        let mock_score = TrustScore {
            strategy_id: strategy_id.to_string(),
            score: new_score_value, 
            timestamp: Utc::now(),
        };
        
        // Check for threshold crossings before updating
        self.check_threshold_crossings(strategy_id, old_score_value, new_score_value).await?;
        
        // Update score in trust engine
        self.trust_score_engine.update_trust_score(
            strategy_id, 
            new_score_value, 
            Some("Trust decay applied".to_string())
        ).await?;
        
        Ok(mock_score)
    }
    
    async fn get_decaying_strategies(&self) -> Result<Vec<String>> {
        let mut decaying_strategies = Vec::new();
        
        let strategy_ids = vec![
            "strategy-1".to_string(),
            "strategy-2".to_string(),
            "strategy-3".to_string(),
            "strategy-4".to_string(),
            "strategy-5".to_string(),
        ];
        
        for strategy_id in strategy_ids {
            match self.get_strategy_activity_status(&strategy_id).await {
                Ok(StrategyActivityStatus::Inactive { .. }) => {
                    decaying_strategies.push(strategy_id);
                },
                _ => {}
            }
        }
        
        Ok(decaying_strategies)
    }
}

/// Create a mock trust decay service for CLI testing
pub async fn init_mock_trust_decay_service(
    trust_score_engine: Arc<dyn TrustScoreEngine>,
    strategy_storage: Arc<dyn StrategyStorage>,
) -> Result<Arc<dyn noderr_core::trust_decay_service::TrustDecayService>> {
    let service = MockTrustDecayService::new(trust_score_engine, strategy_storage);
    
    // Start the service automatically
    let service = Arc::new(service);
    service.start().await?;
    
    Ok(service)
}

// Unit tests
#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock_trust_score_engine::MockTrustScoreEngine;
    use crate::mock_strategy_storage::MockStrategyStorage;
    use noderr_core::trust_decay_service::TrustDecayService;
    
    #[tokio::test]
    async fn test_decay_application() {
        // Create dependencies
        let engine = Arc::new(MockTrustScoreEngine::new());
        let storage = Arc::new(MockStrategyStorage::new());
        
        // Create the service
        let service = MockTrustDecayService::new(engine.clone(), storage);
        
        // Get a test strategy
        let strategy_id = "strategy-1";
        
        // Get current score
        let initial_score = engine.get_trust_score(strategy_id).await.unwrap();
        
        // Apply decay with a specific factor (50% per day)
        let decay_factor = 0.5;
        let hourly_decay_factor = decay_factor.powf(1.0/24.0); // Convert to hourly
        
        let result = service.apply_decay_to_strategy(strategy_id, Some(decay_factor)).await.unwrap();
        
        // Expected score after one hourly decay
        let expected_score = (initial_score * hourly_decay_factor).max(0.0).min(1.0);
        
        // Verify the returned score matches expected
        assert!((result.score - expected_score).abs() < 0.0001, 
                "Expected score {}, got {}", expected_score, result.score);
        
        // Verify the engine was updated with the new score
        let updated_score = engine.get_trust_score(strategy_id).await.unwrap();
        assert!((updated_score - expected_score).abs() < 0.0001,
                "Engine score not updated correctly");
    }
    
    #[tokio::test]
    async fn test_activity_status() {
        // Create dependencies
        let engine = Arc::new(MockTrustScoreEngine::new());
        let storage = Arc::new(MockStrategyStorage::new());
        
        // Create the service
        let service = MockTrustDecayService::new(engine.clone(), storage);
        let strategy_id = "test-strategy";
        
        // Record activity to make strategy active
        service.record_strategy_activity(strategy_id).await.unwrap();
        
        // Check status - should be active
        let status = service.get_strategy_activity_status(strategy_id).await.unwrap();
        assert!(matches!(status, StrategyActivityStatus::Active));
        
        // Manually set activity timestamp to simulate inactivity
        let mut timestamps = service.activity_timestamps.lock().unwrap();
        let mut active = service.active_strategies.lock().unwrap();
        
        // Set to 12 hours ago (within threshold)
        timestamps.insert(strategy_id.to_string(), Utc::now() - Duration::hours(12));
        active.remove(strategy_id);
        drop(timestamps);
        drop(active);
        
        // Check status - should be recently inactive
        let status = service.get_strategy_activity_status(strategy_id).await.unwrap();
        assert!(matches!(status, StrategyActivityStatus::RecentlyInactive { .. }));
        
        // Set to 48 hours ago (beyond threshold)
        let mut timestamps = service.activity_timestamps.lock().unwrap();
        timestamps.insert(strategy_id.to_string(), Utc::now() - Duration::hours(48));
        drop(timestamps);
        
        // Override config to set lower threshold
        let mut config = service.config.lock().unwrap();
        config.inactivity_threshold_hours = 24;
        drop(config);
        
        // Check status - should be inactive
        let status = service.get_strategy_activity_status(strategy_id).await.unwrap();
        assert!(matches!(status, StrategyActivityStatus::Inactive { .. }));
    }
} 