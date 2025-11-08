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

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json;
use tokio::sync::Mutex;
use tokio::time;
use tracing::{debug, error, info, warn};

use crate::execution::ExecutionResult;
use crate::factor_analysis::{
    AlphaFactor, FactorAnalysisConfig, FactorAnalysisEngine, FactorAnalysisError,
    FactorAnalysisResult, FactorAlert, FactorAlertType, FactorExposure,
    FactorRegressionResult, StrategyFactorProfile
};
use crate::redis::{RedisClient, RedisClientError, RedisClientResult};
use crate::strategy::StrategyId;
use crate::telemetry::TelemetryReporter;

// Redis key constants
const FACTOR_RETURN_SERIES_KEY: &str = "factor:returns:";
const FACTOR_PROFILE_KEY: &str = "factor:profile:";
const FACTOR_HISTORY_KEY: &str = "factor:history:";
const FACTOR_ALERT_KEY: &str = "factor:alerts:";
const FACTOR_DATA_KEY: &str = "factor:data:";

/// Redis-based implementation of the FactorAnalysisEngine
pub struct RedisFactorAnalysisEngine {
    /// Redis client for data storage
    redis: Arc<dyn RedisClient>,
    
    /// Telemetry reporter for alerts and metrics
    telemetry: Arc<TelemetryReporter>,
    
    /// Configuration
    config: FactorAnalysisConfig,
    
    /// Execution tracker handle
    execution_tracker: Arc<Mutex<HashMap<StrategyId, Vec<(DateTime<Utc>, f64)>>>>,
    
    /// Factor series data
    factor_series: Arc<RwLock<HashMap<AlphaFactor, Vec<(DateTime<Utc>, f64)>>>>,
    
    /// Previous factor profiles for drift detection
    previous_profiles: Arc<RwLock<HashMap<StrategyId, StrategyFactorProfile>>>,
    
    /// Flag to indicate whether the engine is running
    running: Arc<RwLock<bool>>,
}

impl RedisFactorAnalysisEngine {
    /// Create a new Redis-based factor analysis engine
    pub fn new(
        redis: Arc<dyn RedisClient>,
        telemetry: Arc<TelemetryReporter>,
        config: FactorAnalysisConfig,
    ) -> Self {
        Self {
            redis,
            telemetry,
            config,
            execution_tracker: Arc::new(Mutex::new(HashMap::new())),
            factor_series: Arc::new(RwLock::new(HashMap::new())),
            previous_profiles: Arc::new(RwLock::new(HashMap::new())),
            running: Arc::new(RwLock::new(false)),
        }
    }
    
    /// Create a new Redis-based factor analysis engine with default config
    pub fn new_with_default_config(
        redis: Arc<dyn RedisClient>,
        telemetry: Arc<TelemetryReporter>,
    ) -> Self {
        Self::new(redis, telemetry, FactorAnalysisConfig::default())
    }
    
    /// Generate Redis key for return series
    fn returns_key(&self, strategy_id: &StrategyId) -> String {
        format!("{}{}", FACTOR_RETURN_SERIES_KEY, strategy_id)
    }
    
    /// Generate Redis key for factor profile
    fn profile_key(&self, strategy_id: &StrategyId) -> String {
        format!("{}{}", FACTOR_PROFILE_KEY, strategy_id)
    }
    
    /// Generate Redis key for factor history
    fn history_key(&self, strategy_id: &StrategyId) -> String {
        format!("{}{}", FACTOR_HISTORY_KEY, strategy_id)
    }
    
    /// Generate Redis key for factor alerts
    fn alert_key(&self, strategy_id: &StrategyId) -> String {
        format!("{}{}", FACTOR_ALERT_KEY, strategy_id)
    }
    
    /// Generate Redis key for factor data
    fn factor_data_key(&self, factor: &AlphaFactor) -> String {
        format!("{}{}", FACTOR_DATA_KEY, factor.as_str())
    }
    
    /// Run the factor analysis loop
    async fn run_analysis_loop(self: Arc<Self>) {
        info!("Starting factor analysis loop with interval of {}s", self.config.analysis_interval_sec);
        
        let interval_duration = Duration::from_secs(self.config.analysis_interval_sec);
        let mut interval = time::interval(interval_duration);
        
        loop {
            // Check if we should stop
            if !*self.running.read().unwrap() {
                break;
            }
            
            interval.tick().await;
            
            // Run the analysis cycle
            match self.run_factor_analysis_cycle().await {
                Ok(results) => {
                    info!("Completed factor analysis cycle for {} strategies", results.len());
                    
                    // Report aggregated metrics
                    if !results.is_empty() && self.config.emit_telemetry {
                        self.report_aggregated_metrics(&results).await;
                    }
                }
                Err(e) => {
                    error!("Failed to run factor analysis cycle: {}", e);
                }
            }
        }
        
        info!("Factor analysis loop stopped");
    }
    
    /// Report aggregated metrics from analysis results
    async fn report_aggregated_metrics(&self, results: &HashMap<StrategyId, StrategyFactorProfile>) {
        // Calculate average R-squared
        let avg_r_squared = results.values()
            .map(|p| p.r_squared)
            .sum::<f64>() / results.len() as f64;
        
        // Calculate factor exposure distribution
        let mut factor_counts = HashMap::new();
        for profile in results.values() {
            if let Some((factor, _)) = profile.dominant_factor() {
                *factor_counts.entry(factor).or_insert(0) += 1;
            }
        }
        
        // Report to telemetry
        let metrics_data = serde_json::json!({
            "strategy_count": results.len(),
            "avg_r_squared": avg_r_squared,
            "factor_distribution": factor_counts.iter()
                .map(|(k, v)| (k.as_str(), v))
                .collect::<HashMap<_, _>>(),
            "timestamp": Utc::now(),
        });
        
        self.telemetry.report_custom(
            "factor_analysis_summary", 
            metrics_data.as_object().unwrap().clone()
        ).await;
    }
    
    /// Load historical factor data from Redis
    async fn load_factor_data(&self) -> FactorAnalysisResult<()> {
        // Initialize factor series with empty vectors
        {
            let mut series = self.factor_series.write().unwrap();
            for factor in AlphaFactor::all() {
                series.insert(factor, Vec::new());
            }
        }
        
        // Load data for each factor
        for factor in AlphaFactor::all() {
            let key = self.factor_data_key(&factor);
            
            // Get data from Redis
            match self.redis.get_json::<Vec<(DateTime<Utc>, f64)>>(&key).await {
                Ok(Some(data)) => {
                    let mut series = self.factor_series.write().unwrap();
                    if let Some(vec) = series.get_mut(&factor) {
                        *vec = data;
                        debug!("Loaded {} data points for factor {}", vec.len(), factor.as_str());
                    }
                }
                Ok(None) => {
                    debug!("No historical data found for factor {}", factor.as_str());
                }
                Err(e) => {
                    warn!("Failed to load historical data for factor {}: {}", factor.as_str(), e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Run linear regression to calculate factor exposures
    fn run_regression(
        &self,
        strategy_id: &StrategyId,
        returns: &[(DateTime<Utc>, f64)],
        factor_data: &HashMap<AlphaFactor, Vec<(DateTime<Utc>, f64)>>,
    ) -> FactorAnalysisResult<FactorRegressionResult> {
        // Ensure we have enough data points
        if returns.len() < self.config.min_data_points {
            return Err(FactorAnalysisError::InsufficientData(format!(
                "Insufficient return data points for strategy {}: got {}, need at least {}",
                strategy_id, returns.len(), self.config.min_data_points
            )));
        }
        
        // Extract return values (dependent variable)
        let return_values: Vec<f64> = returns.iter().map(|(_, r)| *r).collect();
        
        // Prepare factor data (independent variables)
        let mut factor_values: HashMap<AlphaFactor, Vec<f64>> = HashMap::new();
        
        // Align factor data with return timestamps
        for (factor, data) in factor_data {
            let mut aligned_values = Vec::with_capacity(returns.len());
            
            for (return_ts, _) in returns {
                // Find closest factor data point
                let closest = data.iter()
                    .min_by_key(|(ts, _)| (*ts - *return_ts).num_milliseconds().abs() as u64)
                    .map(|(_, v)| *v)
                    .unwrap_or(0.0);
                
                aligned_values.push(closest);
            }
            
            factor_values.insert(factor.clone(), aligned_values);
        }
        
        // Create design matrix (X) with intercept
        let mut x = Vec::with_capacity(returns.len());
        for i in 0..returns.len() {
            let mut row = Vec::with_capacity(factor_values.len() + 1);
            row.push(1.0); // Intercept
            
            for factor in AlphaFactor::all() {
                if let Some(values) = factor_values.get(&factor) {
                    if i < values.len() {
                        row.push(values[i]);
                    } else {
                        row.push(0.0);
                    }
                } else {
                    row.push(0.0);
                }
            }
            
            x.push(row);
        }
        
        // Calculate OLS regression using a simple matrix approach
        // This is a simplified implementation - in a production system, 
        // you would use a statistical library like ndarray or linfa
        
        // Create a basic mock implementation for demo purposes
        let mut result = FactorRegressionResult::new(strategy_id.clone());
        
        // Set coefficients to some reasonable values based on the strategy's return pattern
        // In a real implementation, this would be the result of proper OLS calculation
        let return_mean = return_values.iter().sum::<f64>() / return_values.len() as f64;
        let return_std = (return_values.iter()
            .map(|v| (*v - return_mean).powi(2))
            .sum::<f64>() / return_values.len() as f64)
            .sqrt();
        
        // Assign coefficients based on return pattern
        for factor in AlphaFactor::all() {
            let beta = match factor {
                AlphaFactor::Momentum => {
                    // High autocorrelation suggests momentum factor exposure
                    let autocorr = calculate_autocorrelation(&return_values, 1);
                    if autocorr > 0.2 { 0.4 } else { 0.1 }
                },
                AlphaFactor::MeanReversion => {
                    // Negative autocorrelation suggests mean reversion
                    let autocorr = calculate_autocorrelation(&return_values, 1);
                    if autocorr < -0.2 { 0.3 } else { 0.05 }
                },
                AlphaFactor::Volatility => {
                    // Higher returns during volatile periods suggest volatility exposure
                    0.2
                },
                AlphaFactor::Value => 0.1,
                AlphaFactor::Sentiment => 0.15,
                AlphaFactor::Liquidity => 0.1,
                AlphaFactor::MacroExposure => 0.05,
            };
            
            result.coefficients.insert(factor.clone(), beta);
            result.standard_errors.insert(factor.clone(), return_std * 0.2);
            result.t_statistics.insert(factor.clone(), beta / (return_std * 0.2));
            result.p_values.insert(factor.clone(), 0.05);
        }
        
        // Set R-squared (mock value)
        result.r_squared = 0.65;
        result.adj_r_squared = 0.6;
        result.timestamp = Utc::now();
        
        // Create mock residuals
        result.residuals = return_values.iter()
            .map(|v| *v * 0.3) // 30% unexplained
            .collect();
        
        result.residual_mean = result.residuals.iter().sum::<f64>() / result.residuals.len() as f64;
        result.residual_std = (result.residuals.iter()
            .map(|v| (*v - result.residual_mean).powi(2))
            .sum::<f64>() / result.residuals.len() as f64)
            .sqrt();
        
        Ok(result)
    }
}

/// Helper function to calculate autocorrelation 
fn calculate_autocorrelation(series: &[f64], lag: usize) -> f64 {
    if series.len() <= lag {
        return 0.0;
    }
    
    let n = series.len() - lag;
    let mean = series.iter().sum::<f64>() / series.len() as f64;
    
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    
    for i in 0..n {
        numerator += (series[i] - mean) * (series[i + lag] - mean);
    }
    
    for i in 0..series.len() {
        denominator += (series[i] - mean).powi(2);
    }
    
    if denominator.abs() < 1e-10 {
        0.0
    } else {
        numerator / denominator
    }
}

#[async_trait]
impl FactorAnalysisEngine for RedisFactorAnalysisEngine {
    async fn start(&self) -> FactorAnalysisResult<()> {
        // Check if already running
        {
            let mut running = self.running.write().unwrap();
            if *running {
                return Ok(());
            }
            *running = true;
        }
        
        // Load historical factor data
        self.load_factor_data().await?;
        
        // Start the analysis loop
        let engine = Arc::new(self.clone());
        tokio::spawn(async move {
            engine.run_analysis_loop().await;
        });
        
        info!("Factor analysis engine started");
        Ok(())
    }
    
    async fn stop(&self) -> FactorAnalysisResult<()> {
        // Set running flag to false
        {
            let mut running = self.running.write().unwrap();
            *running = false;
        }
        
        info!("Factor analysis engine stopped");
        Ok(())
    }
    
    async fn record_return(
        &self, 
        strategy_id: &StrategyId, 
        timestamp: DateTime<Utc>, 
        returns: f64
    ) -> FactorAnalysisResult<()> {
        // Add to execution tracker
        {
            let mut tracker = self.execution_tracker.lock().await;
            let returns_vec = tracker.entry(strategy_id.clone())
                .or_insert_with(Vec::new);
            
            returns_vec.push((timestamp, returns));
            
            // Trim old data
            let cutoff = Utc::now() - ChronoDuration::hours(self.config.analysis_window_hours);
            returns_vec.retain(|(ts, _)| *ts >= cutoff);
        }
        
        // Store in Redis
        let key = self.returns_key(strategy_id);
        let data = (timestamp, returns);
        
        // Add to sorted set with timestamp as score
        self.redis.zadd_object(
            &key, 
            timestamp.timestamp_millis() as f64, 
            &data
        ).await?;
        
        // Trim old data
        let cutoff = Utc::now() - ChronoDuration::hours(self.config.analysis_window_hours);
        self.redis.zremrangebyscore(
            &key, 
            0.0, 
            cutoff.timestamp_millis() as f64
        ).await?;
        
        Ok(())
    }
    
    async fn record_execution(
        &self, 
        strategy_id: &StrategyId, 
        result: &ExecutionResult
    ) -> FactorAnalysisResult<()> {
        // Extract PnL from execution result
        let pnl = result.realized_pnl;
        
        // Only record significant executions
        if pnl.abs() < 0.00001 {
            return Ok(());
        }
        
        // Record as return
        self.record_return(strategy_id, Utc::now(), pnl).await
    }
    
    async fn calculate_factor_exposures(
        &self, 
        strategy_id: &StrategyId
    ) -> FactorAnalysisResult<StrategyFactorProfile> {
        // Get return data
        let key = self.returns_key(strategy_id);
        let returns: Vec<(DateTime<Utc>, f64)> = self.redis
            .zrange_objects(&key, 0, -1)
            .await?
            .unwrap_or_default();
        
        if returns.len() < self.config.min_data_points {
            return Err(FactorAnalysisError::InsufficientData(format!(
                "Insufficient data points for strategy {}: {} (need {})",
                strategy_id, returns.len(), self.config.min_data_points
            )));
        }
        
        // Get factor data
        let factor_data = {
            let series = self.factor_series.read().unwrap();
            series.clone()
        };
        
        // Run regression
        let regression_result = self.run_regression(strategy_id, &returns, &factor_data)?;
        
        // Convert to factor profile
        let profile = regression_result.to_factor_profile();
        
        // Store the profile
        let profile_key = self.profile_key(strategy_id);
        self.redis.set_json(&profile_key, &profile).await?;
        
        // Add to history
        let history_key = self.history_key(strategy_id);
        self.redis.zadd_object(
            &history_key,
            Utc::now().timestamp_millis() as f64,
            &profile
        ).await?;
        
        // Limit history size
        self.redis.zremrangebyrank(&history_key, 0, -101).await?;
        
        // Store previous profile for drift detection
        {
            let mut profiles = self.previous_profiles.write().unwrap();
            profiles.insert(strategy_id.clone(), profile.clone());
        }
        
        // Check for alerts
        if self.config.enable_alerts {
            if let Ok(alerts) = self.check_factor_alerts(strategy_id, &profile).await {
                for alert in alerts {
                    // Store alert
                    let alert_key = self.alert_key(strategy_id);
                    self.redis.zadd_object(
                        &alert_key,
                        Utc::now().timestamp_millis() as f64,
                        &alert
                    ).await?;
                    
                    // Emit telemetry if enabled
                    if self.config.emit_telemetry {
                        let alert_data = serde_json::json!({
                            "strategy_id": strategy_id.to_string(),
                            "alert_type": format!("{:?}", alert.alert_type),
                            "message": alert.message,
                            "factor": alert.factor.map(|f| f.as_str()),
                            "current_value": alert.current_value,
                            "threshold": alert.threshold,
                            "suggested_action": alert.suggested_action,
                            "timestamp": alert.timestamp,
                        });
                        
                        self.telemetry.report_custom(
                            "factor_analysis_alert", 
                            alert_data.as_object().unwrap().clone()
                        ).await;
                    }
                }
            }
        }
        
        Ok(profile)
    }
    
    async fn run_factor_analysis_cycle(&self) -> FactorAnalysisResult<HashMap<StrategyId, StrategyFactorProfile>> {
        // Get list of active strategies from return keys
        let pattern = format!("{}*", FACTOR_RETURN_SERIES_KEY);
        let keys = self.redis.keys(&pattern).await?;
        
        let mut results = HashMap::new();
        
        for key in keys {
            // Extract strategy_id from key
            let strategy_id = key.strip_prefix(FACTOR_RETURN_SERIES_KEY)
                .unwrap_or(&key)
                .to_string();
            
            // Calculate factor exposures
            match self.calculate_factor_exposures(&strategy_id).await {
                Ok(profile) => {
                    results.insert(strategy_id, profile);
                }
                Err(e) => {
                    warn!("Failed to calculate factor exposures for strategy {}: {}", strategy_id, e);
                }
            }
        }
        
        Ok(results)
    }
    
    async fn get_latest_factor_profile(
        &self, 
        strategy_id: &StrategyId
    ) -> FactorAnalysisResult<StrategyFactorProfile> {
        let key = self.profile_key(strategy_id);
        
        match self.redis.get_json::<StrategyFactorProfile>(&key).await? {
            Some(profile) => Ok(profile),
            None => Err(FactorAnalysisError::InsufficientData(format!(
                "No factor profile found for strategy {}", strategy_id
            ))),
        }
    }
    
    async fn get_factor_profile_history(
        &self, 
        strategy_id: &StrategyId, 
        limit: Option<usize>
    ) -> FactorAnalysisResult<Vec<StrategyFactorProfile>> {
        let key = self.history_key(strategy_id);
        let limit = limit.unwrap_or(100) as isize;
        
        let profiles: Vec<StrategyFactorProfile> = self.redis
            .zrevrange_objects(&key, 0, limit - 1)
            .await?
            .unwrap_or_default();
        
        Ok(profiles)
    }
    
    async fn check_factor_drift(
        &self, 
        strategy_id: &StrategyId
    ) -> FactorAnalysisResult<HashMap<AlphaFactor, f64>> {
        // Get current factor profile
        let current = match self.get_latest_factor_profile(strategy_id).await {
            Ok(profile) => profile,
            Err(e) => return Err(e),
        };
        
        // Get previous factor profile
        let previous = {
            let profiles = self.previous_profiles.read().unwrap();
            profiles.get(strategy_id).cloned()
        };
        
        if let Some(previous) = previous {
            let mut drifts = HashMap::new();
            
            // Calculate drift for each factor
            for factor in AlphaFactor::all() {
                let current_beta = *current.exposures.get(&factor).unwrap_or(&0.0);
                let previous_beta = *previous.exposures.get(&factor).unwrap_or(&0.0);
                
                if previous_beta.abs() > 0.01 {
                    let drift = (current_beta - previous_beta).abs() / previous_beta.abs();
                    if drift > self.config.factor_drift_threshold {
                        drifts.insert(factor, drift);
                    }
                }
            }
            
            Ok(drifts)
        } else {
            Err(FactorAnalysisError::InsufficientData(format!(
                "No previous factor profile found for strategy {}", strategy_id
            )))
        }
    }
    
    async fn check_factor_alerts(
        &self, 
        strategy_id: &StrategyId, 
        profile: &StrategyFactorProfile
    ) -> FactorAnalysisResult<Vec<FactorAlert>> {
        let mut alerts = Vec::new();
        
        // Check for overexposure to a single factor
        if let Some((factor, beta)) = profile.dominant_factor() {
            if beta.abs() > self.config.single_factor_overexposure_threshold {
                alerts.push(FactorAlert {
                    strategy_id: strategy_id.clone(),
                    alert_type: FactorAlertType::SingleFactorOverexposure,
                    message: format!(
                        "Strategy {} is overexposed to {} factor (beta = {:.2})",
                        strategy_id, factor.as_str(), beta
                    ),
                    factor: Some(factor.clone()),
                    current_value: beta.abs(),
                    threshold: self.config.single_factor_overexposure_threshold,
                    previous_value: None,
                    timestamp: Utc::now(),
                    suggested_action: Some(format!(
                        "Consider adjusting strategy parameters to reduce {} exposure",
                        factor.as_str()
                    )),
                });
            }
        }
        
        // Check for high combined exposure magnitude
        let total_magnitude = profile.total_exposure_magnitude();
        if total_magnitude > self.config.total_exposure_magnitude_threshold {
            alerts.push(FactorAlert {
                strategy_id: strategy_id.clone(),
                alert_type: FactorAlertType::CombinedExposureHigh,
                message: format!(
                    "Strategy {} has high combined factor exposure magnitude ({:.2})",
                    strategy_id, total_magnitude
                ),
                factor: None,
                current_value: total_magnitude,
                threshold: self.config.total_exposure_magnitude_threshold,
                previous_value: None,
                timestamp: Utc::now(),
                suggested_action: Some(
                    "Consider reducing overall factor sensitivity by adjusting parameters"
                    .to_string()
                ),
            });
        }
        
        // Check for low R-squared (unexplainable returns)
        if profile.r_squared < self.config.low_r_squared_threshold {
            alerts.push(FactorAlert {
                strategy_id: strategy_id.clone(),
                alert_type: FactorAlertType::UnexplainableReturns,
                message: format!(
                    "Strategy {} has low R-squared ({:.2}) - returns not well explained by factors",
                    strategy_id, profile.r_squared
                ),
                factor: None,
                current_value: profile.r_squared,
                threshold: self.config.low_r_squared_threshold,
                previous_value: None,
                timestamp: Utc::now(),
                suggested_action: Some(
                    "Investigate strategy for potential overfitting or review factor model"
                    .to_string()
                ),
            });
        }
        
        // Check for factor drift
        if let Ok(drifts) = self.check_factor_drift(strategy_id).await {
            for (factor, drift) in drifts {
                alerts.push(FactorAlert {
                    strategy_id: strategy_id.clone(),
                    alert_type: FactorAlertType::FactorDrift,
                    message: format!(
                        "Strategy {} {} factor exposure has drifted significantly ({:.1}%)",
                        strategy_id, factor.as_str(), drift * 100.0
                    ),
                    factor: Some(factor.clone()),
                    current_value: drift,
                    threshold: self.config.factor_drift_threshold,
                    previous_value: None,
                    timestamp: Utc::now(),
                    suggested_action: Some(
                        "Monitor strategy behavior for regime change or model deterioration"
                        .to_string()
                    ),
                });
            }
        }
        
        Ok(alerts)
    }
}

impl Clone for RedisFactorAnalysisEngine {
    fn clone(&self) -> Self {
        Self {
            redis: Arc::clone(&self.redis),
            telemetry: Arc::clone(&self.telemetry),
            config: self.config.clone(),
            execution_tracker: Arc::clone(&self.execution_tracker),
            factor_series: Arc::clone(&self.factor_series),
            previous_profiles: Arc::clone(&self.previous_profiles),
            running: Arc::clone(&self.running),
        }
    }
} 