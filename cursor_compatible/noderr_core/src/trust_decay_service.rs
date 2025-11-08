// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

use crate::telemetry::{TelemetryReporter, TelemetryMessageType};
use crate::telemetry_streamer::TelemetryStreamer;
use crate::trust_score_engine::{TrustScoreEngine, TrustScore};
use crate::strategy_storage::StrategyStorage;
use crate::simulation::trust_decay_simulator::DecaySimulationParams;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use tokio::time;
use tracing::{debug, error, info, warn};
use anyhow::{Result, Context, anyhow};

/// Configuration for the trust decay service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDecayConfig {
    /// Whether trust decay is enabled globally
    pub enabled: bool,
    
    /// Default decay factor applied per day (0.98 = 2% decay per day)
    pub default_decay_factor_per_day: f64,
    
    /// Interval between decay applications in seconds (e.g., 3600 = hourly)
    pub decay_interval_seconds: u64,
    
    /// How long a strategy can be inactive before decay begins (in hours)
    pub inactivity_threshold_hours: u64,
    
    /// Whether to pause decay during active trading
    pub pause_during_trading: bool,
    
    /// Trust threshold for warning alerts
    pub warning_threshold: f64,
    
    /// Trust threshold for critical alerts
    pub critical_threshold: f64,
    
    /// Whether to emit telemetry events on threshold crossings
    pub emit_threshold_events: bool,
    
    /// Strategies excluded from automatic decay
    pub excluded_strategies: Vec<String>,
    
    /// Strategy-specific decay factors
    /// Format: HashMap<strategy_id, decay_factor>
    pub strategy_decay_factors: HashMap<String, f64>,
}

impl Default for TrustDecayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_decay_factor_per_day: 0.98, // 2% decay per day
            decay_interval_seconds: 3600,        // Apply decay hourly
            inactivity_threshold_hours: 24,      // Start decay after 24h inactivity
            pause_during_trading: true,
            warning_threshold: 0.5,
            critical_threshold: 0.3,
            emit_threshold_events: true,
            excluded_strategies: Vec::new(),
            strategy_decay_factors: HashMap::new(),
        }
    }
}

/// Status of a strategy's trading activity
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StrategyActivityStatus {
    /// Strategy is actively trading
    Active,
    
    /// Strategy is inactive but still within the inactivity threshold
    RecentlyInactive {
        /// Last activity timestamp
        last_activity: DateTime<Utc>,
    },
    
    /// Strategy has been inactive beyond the threshold
    Inactive {
        /// Last activity timestamp
        last_activity: DateTime<Utc>,
        
        /// When decay started
        decay_started: DateTime<Utc>,
    },
}

/// Interface for the trust decay service
#[async_trait]
pub trait TrustDecayService: Send + Sync {
    /// Start the background decay service
    async fn start(&self) -> Result<()>;
    
    /// Stop the background decay service
    async fn stop(&self) -> Result<()>;
    
    /// Get the current decay configuration
    fn get_config(&self) -> TrustDecayConfig;
    
    /// Update the decay configuration
    async fn update_config(&self, config: TrustDecayConfig) -> Result<()>;
    
    /// Record strategy activity to reset or pause decay
    async fn record_strategy_activity(&self, strategy_id: &str) -> Result<()>;
    
    /// Get a strategy's current activity status
    async fn get_strategy_activity_status(&self, strategy_id: &str) -> Result<StrategyActivityStatus>;
    
    /// Apply decay manually to a specific strategy
    async fn apply_decay_to_strategy(&self, strategy_id: &str, decay_factor: Option<f64>) -> Result<TrustScore>;
    
    /// Get strategies currently undergoing decay
    async fn get_decaying_strategies(&self) -> Result<Vec<String>>;
}

/// Implementation of the trust decay service
pub struct DefaultTrustDecayService {
    /// Trust decay configuration
    config: RwLock<TrustDecayConfig>,
    
    /// Trust score engine for reading and writing trust scores
    trust_score_engine: Arc<dyn TrustScoreEngine>,
    
    /// Strategy storage for accessing strategy information
    strategy_storage: Arc<dyn StrategyStorage>,
    
    /// Telemetry reporter for logging events
    telemetry: Arc<TelemetryReporter>,
    
    /// Telemetry streamer for publishing real-time updates
    telemetry_streamer: Option<Arc<TelemetryStreamer>>,
    
    /// Last recorded activity time per strategy
    activity_timestamps: RwLock<HashMap<String, DateTime<Utc>>>,
    
    /// Strategies currently excluded from decay due to active trading
    active_strategies: RwLock<HashSet<String>>,
    
    /// Background task handle
    decay_task_handle: RwLock<Option<tokio::task::JoinHandle<()>>>,
    
    /// Flag to indicate service is shutting down
    shutdown_signal: Arc<tokio::sync::Notify>,
}

impl DefaultTrustDecayService {
    /// Create a new default trust decay service
    pub fn new(
        config: TrustDecayConfig,
        trust_score_engine: Arc<dyn TrustScoreEngine>,
        strategy_storage: Arc<dyn StrategyStorage>,
        telemetry: Arc<TelemetryReporter>,
        telemetry_streamer: Option<Arc<TelemetryStreamer>>,
    ) -> Self {
        Self {
            config: RwLock::new(config),
            trust_score_engine,
            strategy_storage,
            telemetry,
            telemetry_streamer,
            activity_timestamps: RwLock::new(HashMap::new()),
            active_strategies: RwLock::new(HashSet::new()),
            decay_task_handle: RwLock::new(None),
            shutdown_signal: Arc::new(tokio::sync::Notify::new()),
        }
    }
    
    /// Run a single decay cycle for all strategies
    async fn run_decay_cycle(&self) -> Result<()> {
        // Skip if decay is disabled
        if !self.config.read().unwrap().enabled {
            debug!("Trust decay cycle skipped: decay is disabled");
            return Ok(());
        }
        
        let strategy_ids = self.strategy_storage.get_all_strategy_ids().await?;
        let now = Utc::now();
        let config = self.config.read().unwrap().clone();
        
        info!("Running trust decay cycle for {} strategies", strategy_ids.len());
        
        let mut decayed_strategies = 0;
        let mut excluded_strategies = 0;
        let mut active_strategies = 0;
        let mut error_count = 0;
        
        for strategy_id in strategy_ids {
            // Skip excluded strategies
            if config.excluded_strategies.contains(&strategy_id) {
                excluded_strategies += 1;
                continue;
            }
            
            // Skip active strategies if configured to pause during trading
            if config.pause_during_trading && self.active_strategies.read().unwrap().contains(&strategy_id) {
                active_strategies += 1;
                continue;
            }
            
            // Check if strategy has been inactive long enough to decay
            let activity_status = self.get_strategy_activity_status(&strategy_id).await?;
            
            match activity_status {
                StrategyActivityStatus::Active | StrategyActivityStatus::RecentlyInactive { .. } => {
                    // Skip strategies that are active or recently inactive
                    continue;
                },
                StrategyActivityStatus::Inactive { .. } => {
                    // Apply decay to inactive strategies
                    match self.apply_decay_to_strategy(&strategy_id, None).await {
                        Ok(_) => {
                            decayed_strategies += 1;
                        },
                        Err(err) => {
                            error!("Failed to apply decay to strategy {}: {}", strategy_id, err);
                            error_count += 1;
                        }
                    }
                }
            }
        }
        
        info!(
            "Decay cycle completed: {} strategies decayed, {} active, {} excluded, {} errors",
            decayed_strategies, active_strategies, excluded_strategies, error_count
        );
        
        Ok(())
    }
    
    /// Background task that periodically applies decay
    async fn decay_background_task(service: Arc<DefaultTrustDecayService>) {
        info!("Trust decay background task started");
        
        loop {
            // Get the current interval from config
            let interval_seconds = {
                let config = service.config.read().unwrap();
                config.decay_interval_seconds
            };
            
            let mut interval = time::interval(time::Duration::from_secs(interval_seconds));
            
            tokio::select! {
                _ = interval.tick() => {
                    if let Err(err) = service.run_decay_cycle().await {
                        error!("Error in trust decay cycle: {}", err);
                    }
                }
                _ = service.shutdown_signal.notified() => {
                    info!("Trust decay background task shutting down");
                    break;
                }
            }
        }
        
        info!("Trust decay background task stopped");
    }
    
    /// Check for threshold crossings and emit events if necessary
    async fn check_threshold_crossings(&self, strategy_id: &str, old_score: f64, new_score: f64) -> Result<()> {
        let config = self.config.read().unwrap().clone();
        
        // Skip if threshold events are disabled
        if !config.emit_threshold_events {
            return Ok(());
        }
        
        // Check for warning threshold crossing (higher -> lower)
        if old_score >= config.warning_threshold && new_score < config.warning_threshold {
            self.telemetry.report_custom(
                &format!("trust_warning_{}", strategy_id),
                &format!("Trust score for strategy {} dropped below warning threshold ({:.2})", 
                         strategy_id, config.warning_threshold),
                None,
            )?;
            
            if let Some(streamer) = &self.telemetry_streamer {
                let event = serde_json::json!({
                    "type": "trust_threshold_crossed",
                    "strategy_id": strategy_id,
                    "threshold": "warning",
                    "threshold_value": config.warning_threshold,
                    "old_score": old_score,
                    "new_score": new_score,
                    "timestamp": Utc::now(),
                });
                
                streamer.publish(TelemetryMessageType::SystemEvent, &event).await?;
            }
        }
        
        // Check for critical threshold crossing (higher -> lower)
        if old_score >= config.critical_threshold && new_score < config.critical_threshold {
            self.telemetry.report_custom(
                &format!("trust_critical_{}", strategy_id),
                &format!("Trust score for strategy {} dropped below critical threshold ({:.2})", 
                         strategy_id, config.critical_threshold),
                None,
            )?;
            
            if let Some(streamer) = &self.telemetry_streamer {
                let event = serde_json::json!({
                    "type": "trust_threshold_crossed",
                    "strategy_id": strategy_id,
                    "threshold": "critical",
                    "threshold_value": config.critical_threshold,
                    "old_score": old_score,
                    "new_score": new_score,
                    "timestamp": Utc::now(),
                });
                
                streamer.publish(TelemetryMessageType::SystemEvent, &event).await?;
            }
        }
        
        Ok(())
    }
}

#[async_trait]
impl TrustDecayService for DefaultTrustDecayService {
    async fn start(&self) -> Result<()> {
        let mut handle_guard = self.decay_task_handle.write().unwrap();
        
        // Don't start if already running
        if handle_guard.is_some() {
            return Err(anyhow!("Trust decay service is already running"));
        }
        
        // Clone the service for the background task
        let service_clone = Arc::new(self.clone());
        
        // Start the background task
        let handle = tokio::spawn(Self::decay_background_task(service_clone));
        *handle_guard = Some(handle);
        
        info!("Trust decay service started");
        Ok(())
    }
    
    async fn stop(&self) -> Result<()> {
        let mut handle_guard = self.decay_task_handle.write().unwrap();
        
        if let Some(handle) = handle_guard.take() {
            // Signal the task to shut down
            self.shutdown_signal.notify_one();
            
            // Wait for the task to complete
            match handle.await {
                Ok(()) => {
                    info!("Trust decay service stopped");
                    Ok(())
                },
                Err(err) => {
                    error!("Error stopping trust decay service: {}", err);
                    Err(anyhow!("Failed to stop trust decay service: {}", err))
                }
            }
        } else {
            // Not running, nothing to do
            info!("Trust decay service is not running");
            Ok(())
        }
    }
    
    fn get_config(&self) -> TrustDecayConfig {
        self.config.read().unwrap().clone()
    }
    
    async fn update_config(&self, config: TrustDecayConfig) -> Result<()> {
        let mut config_guard = self.config.write().unwrap();
        *config_guard = config;
        
        info!("Trust decay configuration updated");
        Ok(())
    }
    
    async fn record_strategy_activity(&self, strategy_id: &str) -> Result<()> {
        let now = Utc::now();
        
        // Update activity timestamp
        self.activity_timestamps.write().unwrap().insert(strategy_id.to_string(), now);
        
        // Mark strategy as active
        self.active_strategies.write().unwrap().insert(strategy_id.to_string());
        
        debug!("Recorded activity for strategy {}", strategy_id);
        Ok(())
    }
    
    async fn get_strategy_activity_status(&self, strategy_id: &str) -> Result<StrategyActivityStatus> {
        let now = Utc::now();
        let config = self.config.read().unwrap().clone();
        
        // Check if strategy is currently active
        if self.active_strategies.read().unwrap().contains(strategy_id) {
            return Ok(StrategyActivityStatus::Active);
        }
        
        // Get last activity timestamp
        let last_activity = match self.activity_timestamps.read().unwrap().get(strategy_id) {
            Some(timestamp) => *timestamp,
            None => {
                // If no activity recorded, check when the strategy was created
                let trust_score = match self.trust_score_engine.get_trust_score(strategy_id).await {
                    Ok(score) => score,
                    Err(_) => {
                        // If no trust score exists, assume it's a new strategy
                        return Ok(StrategyActivityStatus::Active);
                    }
                };
                
                trust_score.timestamp
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
        // Get current trust score
        let current_score = self.trust_score_engine.get_trust_score(strategy_id).await
            .context(format!("Failed to get trust score for strategy {}", strategy_id))?;
        
        // Determine decay factor to use
        let config = self.config.read().unwrap().clone();
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
        let old_score = current_score.score;
        let new_score = (old_score * hourly_decay_factor).max(0.0).min(1.0);
        
        // Only update if the score has changed significantly
        if (new_score - old_score).abs() > 0.0001 {
            // Create a new trust score with the decayed value
            let mut updated_score = current_score.clone();
            updated_score.score = new_score;
            updated_score.timestamp = Utc::now();
            
            // Save the updated score
            // Note: TrustScoreEngine is responsible for history updates and notifications
            self.trust_score_engine.save_trust_score(&updated_score).await
                .context(format!("Failed to save decayed trust score for strategy {}", strategy_id))?;
            
            // Check for threshold crossings
            self.check_threshold_crossings(strategy_id, old_score, new_score).await
                .context("Failed to check threshold crossings")?;
            
            info!(
                "Applied decay to strategy {}: {:.4} -> {:.4} (factor: {:.4})",
                strategy_id, old_score, new_score, hourly_decay_factor
            );
            
            Ok(updated_score)
        } else {
            // No significant change, return current score
            debug!(
                "Decay had negligible effect on strategy {}: {:.4} -> {:.4}",
                strategy_id, old_score, new_score
            );
            
            Ok(current_score)
        }
    }
    
    async fn get_decaying_strategies(&self) -> Result<Vec<String>> {
        let strategy_ids = self.strategy_storage.get_all_strategy_ids().await?;
        let mut decaying_strategies = Vec::new();
        
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

impl Clone for DefaultTrustDecayService {
    fn clone(&self) -> Self {
        let config = self.config.read().unwrap().clone();
        
        Self {
            config: RwLock::new(config),
            trust_score_engine: self.trust_score_engine.clone(),
            strategy_storage: self.strategy_storage.clone(),
            telemetry: self.telemetry.clone(),
            telemetry_streamer: self.telemetry_streamer.clone(),
            activity_timestamps: RwLock::new(self.activity_timestamps.read().unwrap().clone()),
            active_strategies: RwLock::new(self.active_strategies.read().unwrap().clone()),
            decay_task_handle: RwLock::new(None),
            shutdown_signal: Arc::new(tokio::sync::Notify::new()),
        }
    }
}

/// Factory function to create a trust decay service
pub fn create_trust_decay_service(
    config: TrustDecayConfig,
    trust_score_engine: Arc<dyn TrustScoreEngine>,
    strategy_storage: Arc<dyn StrategyStorage>,
    telemetry: Arc<TelemetryReporter>,
    telemetry_streamer: Option<Arc<TelemetryStreamer>>,
) -> Arc<dyn TrustDecayService> {
    Arc::new(DefaultTrustDecayService::new(
        config,
        trust_score_engine,
        strategy_storage,
        telemetry,
        telemetry_streamer,
    ))
}

// Unit tests
#[cfg(test)]
mod tests {
    use super::*;
    use crate::trust_score_engine::{TrustScoreFeatures, TrustScoreHistory};
    use mockall::predicate::*;
    use mockall::mock;
    
    // Mock TrustScoreEngine
    mock! {
        pub TrustScoreEngine {}
        
        #[async_trait]
        impl TrustScoreEngine for TrustScoreEngine {
            async fn compute_trust_score(&self, strategy_id: &str) -> Result<TrustScore>;
            async fn get_trust_score(&self, strategy_id: &str) -> Result<TrustScore>;
            async fn get_trust_history(&self, strategy_id: &str) -> Result<TrustScoreHistory>;
            async fn record_history(&self, strategy_id: &str) -> Result<()>;
            async fn save_trust_score(&self, score: &TrustScore) -> Result<TrustScore>;
        }
    }
    
    // Mock StrategyStorage
    mock! {
        pub StrategyStorage {}
        
        #[async_trait]
        impl StrategyStorage for StrategyStorage {
            async fn get_all_strategy_ids(&self) -> Result<Vec<String>>;
        }
    }
    
    #[tokio::test]
    async fn test_decay_calculation() {
        // Create a test trust score
        let original_score = TrustScore {
            strategy_id: "test-strategy".to_string(),
            score: 0.8,
            features: TrustScoreFeatures {
                win_rate: 0.7,
                normalized_sharpe: 0.6,
                normalized_sortino: 0.6,
                drawdown_score: 0.8,
                failure_score: 0.9,
                risk_adjusted_return: 0.75,
                consistency_score: 0.8,
            },
            timestamp: Utc::now(),
        };
        
        // Set up mocks
        let mut mock_engine = MockTrustScoreEngine::new();
        mock_engine.expect_get_trust_score()
            .with(eq("test-strategy"))
            .returning(move |_| Ok(original_score.clone()));
        
        // Expected updated score with decay
        let daily_decay_factor = 0.98;
        let hourly_decay_factor = daily_decay_factor.powf(1.0/24.0);
        let expected_new_score = 0.8 * hourly_decay_factor;
        
        mock_engine.expect_save_trust_score()
            .withf(move |score| {
                (score.score - expected_new_score).abs() < 0.0001
            })
            .returning(|score| Ok(score.clone()));
        
        let mut mock_storage = MockStrategyStorage::new();
        mock_storage.expect_get_all_strategy_ids()
            .returning(|| Ok(vec!["test-strategy".to_string()]));
        
        // Create telemetry reporter
        let telemetry = Arc::new(TelemetryReporter::new());
        
        // Create decay service
        let service = create_trust_decay_service(
            TrustDecayConfig::default(),
            Arc::new(mock_engine),
            Arc::new(mock_storage),
            telemetry,
            None,
        );
        
        // Apply decay manually to test
        let decayed_score = service.apply_decay_to_strategy("test-strategy", Some(daily_decay_factor)).await.unwrap();
        
        // Verify decay was applied correctly
        assert!((decayed_score.score - expected_new_score).abs() < 0.0001);
    }
} 