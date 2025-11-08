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

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

use crate::storage::{StrategyStorage, StorageError, TimeRange, StoredExecution, PerformanceImpact};
use crate::strategy::{StrategyId, StrategyPerformance};
use crate::execution::{ExecutionStatus};
use crate::telemetry::{TelemetryEvent, TelemetryLevel};

/// Time periods for trend analysis
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimePeriod {
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
}

/// Trend direction indicator
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrendDirection {
    Up,
    Down,
    Neutral,
}

/// Represents a time series of values with trend analysis
#[derive(Debug, Clone)]
pub struct TrendLine {
    /// The data points in the trend line
    pub data_points: Vec<(DateTime<Utc>, f64)>,
    /// Direction of the trend
    pub trend_direction: TrendDirection,
    /// Percent change from first to last data point
    pub percent_change: f64,
    /// Time period used for grouping data
    pub time_period: TimePeriod,
}

/// Filter for analytics queries
#[derive(Debug, Clone)]
pub struct AnalyticsFilter {
    /// Filter by specific symbols
    pub symbols: Option<HashSet<String>>,
    /// Filter by position directions
    pub directions: Option<HashSet<PositionDirection>>,
    /// Filter by execution statuses
    pub execution_statuses: Option<HashSet<ExecutionStatus>>,
    /// Filter for only successful executions
    pub only_successful: Option<bool>,
    /// Filter by minimum confidence
    pub min_confidence: Option<f64>,
}

/// Performance summary for a strategy
#[derive(Debug, Clone)]
pub struct PerformanceSummary {
    /// Total number of trades
    pub total_trades: usize,
    /// Number of winning trades
    pub winning_trades: usize,
    /// Number of losing trades
    pub losing_trades: usize,
    /// Win rate as percentage
    pub win_rate: f64,
    /// Total profit and loss
    pub total_pnl: f64,
    /// Profit factor (gross profit / gross loss)
    pub profit_factor: f64,
    /// Maximum drawdown percentage
    pub max_drawdown: f64,
    /// Current drawdown percentage
    pub current_drawdown: f64,
    /// Average profit per winning trade
    pub avg_profit: f64,
    /// Average loss per losing trade
    pub avg_loss: f64,
    /// Sharpe ratio
    pub sharpe_ratio: f64,
    /// Sortino ratio
    pub sortino_ratio: f64,
    /// Average holding time in seconds
    pub avg_holding_time_seconds: i64,
}

/// Execution statistics
#[derive(Debug, Clone)]
pub struct ExecutionStats {
    /// Total executions
    pub total_executions: usize,
    /// Number of filled executions
    pub filled_count: usize,
    /// Number of partially filled executions
    pub partial_count: usize,
    /// Number of failed executions
    pub failed_count: usize,
    /// Number of rejected executions
    pub rejected_count: usize,
    /// Average fill rate for partially filled orders
    pub avg_fill_rate: f64,
    /// Average execution latency in milliseconds
    pub avg_latency_ms: i64,
    /// Minimum latency in milliseconds
    pub min_latency_ms: i64,
    /// Maximum latency in milliseconds
    pub max_latency_ms: i64,
}

/// Types of anomalies that can be detected
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnomalyType {
    /// Sudden drawdown spike
    DrawdownSpike,
    /// Latency outlier in execution
    LatencyOutlier,
    /// Unusual trading pattern
    UnusualTradingPattern,
    /// Execution failure rate increase
    ExecutionFailureIncrease,
}

/// Detected anomaly with context
#[derive(Debug, Clone)]
pub struct Anomaly {
    /// When the anomaly was detected
    pub timestamp: DateTime<Utc>,
    /// Type of anomaly
    pub anomaly_type: AnomalyType,
    /// Severity level (higher is more severe)
    pub severity: f64,
    /// Description of the anomaly
    pub description: String,
}

/// Error types for analytics operations
#[derive(Debug, Error)]
pub enum AnalyticsError {
    #[error("Storage error: {0}")]
    StorageError(String),
    
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

/// Result type for analytics operations
pub type AnalyticsResult<T> = Result<T, AnalyticsError>;

/// Analytics trait for strategy performance analysis
pub trait Analytics {
    /// Get a performance summary for a strategy
    async fn get_performance_summary(
        &self,
        strategy_id: &str,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
        filter: Option<&AnalyticsFilter>,
    ) -> AnalyticsResult<PerformanceSummary>;
    
    /// Get execution statistics for a strategy
    async fn get_execution_stats(
        &self, 
        strategy_id: &str,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
    ) -> AnalyticsResult<ExecutionStats>;
    
    /// Get PnL over time for a strategy
    async fn get_pnl_over_time(
        &self,
        strategy_id: &str,
        period: TimePeriod,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
        filter: Option<&AnalyticsFilter>,
    ) -> AnalyticsResult<TrendLine>;
    
    /// Detect anomalies in strategy performance
    async fn detect_anomalies(
        &self,
        strategy_id: &str,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
    ) -> AnalyticsResult<Vec<Anomaly>>;
}

/// Storage interface for analytics
pub trait AnalyticsStorage: Send + Sync {
    /// Get all executions for a strategy
    async fn get_strategy_executions(&self, strategy_id: &str) -> Result<Vec<StoredExecution>, StorageError>;
    
    /// Get all strategies
    async fn get_all_strategies(&self) -> Result<Vec<StrategyId>, StorageError>;
}

/// Adapter to make StrategyStorage implement AnalyticsStorage
pub struct StrategyStorageAnalyticsAdapter {
    /// The strategy storage to adapt
    storage: Arc<dyn StrategyStorage>,
}

impl StrategyStorageAnalyticsAdapter {
    /// Create a new adapter for the given strategy storage
    pub fn new(storage: Arc<dyn StrategyStorage>) -> Self {
        Self { storage }
    }
}

#[async_trait]
impl AnalyticsStorage for StrategyStorageAnalyticsAdapter {
    async fn get_strategy_executions(&self, strategy_id: &str) -> Result<Vec<StoredExecution>, StorageError> {
        // Convert string to StrategyId
        let strategy_id = StrategyId(strategy_id.to_string());
        
        // Fetch all executions for this strategy from the storage
        let stored_executions = self.storage.query_executions_by_strategy(
            &strategy_id,
            TimeRange::All,
            None,
        ).await?;
        
        // Convert storage::StoredExecution to analytics::StoredExecution
        let executions = stored_executions.into_iter()
            .map(|exec| self.convert_to_analytics_execution(exec))
            .collect();
        
        Ok(executions)
    }
    
    async fn get_all_strategies(&self) -> Result<Vec<StrategyId>, StorageError> {
        // This would typically query the database for all strategy IDs
        // Since StrategyStorage doesn't have this method directly, we'll 
        // implement a reasonable approach based on available methods
        
        // This is a simplified implementation - in a real implementation,
        // we would query the database directly for all strategy IDs
        let query_result = self.storage.query_telemetry_events(
            None,
            None,
            TimeRange::All,
            None,
        ).await?;
        
        // Extract unique strategy IDs from telemetry events
        let mut unique_ids = HashSet::new();
        for event in query_result {
            if let Some(id) = event.strategy_id {
                unique_ids.insert(id);
            }
        }
        
        Ok(unique_ids.into_iter().collect())
    }
}

impl StrategyStorageAnalyticsAdapter {
    /// Convert storage::StoredExecution to analytics::StoredExecution
    fn convert_to_analytics_execution(&self, exec: crate::storage::StoredExecution) -> StoredExecution {
        StoredExecution {
            id: exec.id,
            strategy_id: exec.strategy_id.0,
            timestamp: exec.timestamp,
            symbol: exec.symbol,
            signal: exec.signal,
            result: exec.result,
            performance_impact: exec.performance_impact.map(|impact| PerformanceImpact {
                is_win: impact.is_win,
                pnl: impact.pnl_change,
                roi_percent: 0.0, // Not directly available in storage impact
                duration_seconds: None, // Not directly available in storage impact
            }),
        }
    }
}

/// Create an analytics storage adapter from strategy storage
pub fn create_analytics_storage(strategy_storage: Arc<dyn StrategyStorage>) -> Arc<dyn AnalyticsStorage> {
    Arc::new(StrategyStorageAnalyticsAdapter::new(strategy_storage))
}

/// Represents a stored execution in the database
#[derive(Debug, Clone)]
pub struct StoredExecution {
    /// Execution ID
    pub id: String,
    /// Strategy ID that generated this execution
    pub strategy_id: String,
    /// Timestamp when execution was initiated
    pub timestamp: DateTime<Utc>,
    /// The trading signal that triggered this execution
    pub signal: Signal,
    /// The result of the execution
    pub result: ExecutionResult,
    /// Performance impact of this execution
    pub performance_impact: Option<PerformanceImpact>,
}

/// Performance impact of an execution
#[derive(Debug, Clone)]
pub struct PerformanceImpact {
    /// Whether this execution resulted in a win
    pub is_win: bool,
    /// The profit/loss amount
    pub pnl: f64,
    /// Return on investment percentage
    pub roi_percent: f64,
    /// Duration of the trade in seconds
    pub duration_seconds: Option<i64>,
}

/// Default implementation of Analytics
pub struct DefaultAnalytics {
    /// Storage for retrieving execution data
    storage: Arc<dyn AnalyticsStorage>,
}

impl DefaultAnalytics {
    /// Create a new DefaultAnalytics instance
    pub fn new(storage: Arc<dyn AnalyticsStorage>) -> Self {
        Self { storage }
    }
    
    /// Filters a collection of execution data based on provided criteria
    fn apply_filter<'a>(
        &self,
        executions: Vec<StoredExecution>,
        filter: Option<&'a AnalyticsFilter>,
    ) -> Vec<StoredExecution> {
        if let Some(filter) = filter {
            executions
                .into_iter()
                .filter(|exec| {
                    // Filter by symbols
                    if let Some(symbols) = &filter.symbols {
                        if !symbols.contains(&exec.symbol) {
                            return false;
                        }
                    }
                    
                    // Filter by position direction
                    if let Some(directions) = &filter.directions {
                        if let Some(direction) = exec.signal.direction {
                            if !directions.contains(&direction) {
                                return false;
                            }
                        } else {
                            return false;
                        }
                    }
                    
                    // Filter by execution status
                    if let Some(statuses) = &filter.execution_statuses {
                        if !statuses.contains(&exec.result.status) {
                            return false;
                        }
                    }
                    
                    // Filter by successful executions
                    if let Some(only_successful) = filter.only_successful {
                        if only_successful {
                            if !matches!(exec.result.status, ExecutionStatus::Completed | ExecutionStatus::Filled) {
                                return false;
                            }
                        }
                    }
                    
                    // Filter by minimum confidence
                    if let Some(min_confidence) = filter.min_confidence {
                        if let Some(confidence) = exec.signal.confidence {
                            if confidence < min_confidence {
                                return false;
                            }
                        } else {
                            return false;
                        }
                    }
                    
                    true
                })
                .collect()
        } else {
            executions
        }
    }
    
    /// Groups data points by specified time period and returns a HashMap with
    /// timestamp as key and vector of values as value
    fn group_by_time_period<T: Clone>(
        &self,
        data: &[(DateTime<Utc>, T)],
        period: TimePeriod,
    ) -> HashMap<DateTime<Utc>, Vec<T>> {
        let mut grouped: HashMap<DateTime<Utc>, Vec<T>> = HashMap::new();
        
        for (timestamp, value) in data {
            // Create a normalized timestamp based on the period
            let normalized = match period {
                TimePeriod::Hourly => {
                    // Truncate to hour
                    DateTime::<Utc>::from_timestamp(
                        (timestamp.timestamp() / 3600) * 3600,
                        0,
                    ).unwrap()
                },
                TimePeriod::Daily => {
                    // Truncate to day
                    DateTime::<Utc>::from_timestamp(
                        (timestamp.timestamp() / 86400) * 86400,
                        0,
                    ).unwrap()
                },
                TimePeriod::Weekly => {
                    // Get day of week (0 = Monday, 6 = Sunday)
                    let day_of_week = timestamp.weekday().num_days_from_monday() as i64;
                    // Subtract days to get to most recent Monday, then truncate to day
                    let monday_timestamp = timestamp.timestamp() - (day_of_week * 86400);
                    DateTime::<Utc>::from_timestamp(
                        (monday_timestamp / 86400) * 86400,
                        0,
                    ).unwrap()
                },
                TimePeriod::Monthly => {
                    // Create a new datetime with the same year/month but day = 1
                    Utc.with_ymd_and_hms(
                        timestamp.year(),
                        timestamp.month(),
                        1,
                        0,
                        0,
                        0,
                    ).unwrap()
                },
                TimePeriod::Quarterly => {
                    // Calculate quarter (0-based)
                    let quarter = (timestamp.month() - 1) / 3;
                    // Create a new datetime with the same year but first day of quarter
                    Utc.with_ymd_and_hms(
                        timestamp.year(),
                        quarter * 3 + 1,
                        1,
                        0,
                        0,
                        0,
                    ).unwrap()
                },
                TimePeriod::Yearly => {
                    // Create a new datetime with the same year but January 1
                    Utc.with_ymd_and_hms(
                        timestamp.year(),
                        1,
                        1,
                        0,
                        0,
                        0,
                    ).unwrap()
                },
            };
            
            grouped.entry(normalized).or_default().push(value.clone());
        }
        
        grouped
    }
    
    /// Calculates the trend direction of a series of data points
    /// using linear regression to determine if the trend is up, down, or neutral
    fn calculate_trend_direction<T>(&self, data_points: &[(DateTime<Utc>, T)]) -> TrendDirection 
    where
        T: Into<f64> + Copy,
    {
        if data_points.len() < 2 {
            return TrendDirection::Neutral;
        }
        
        // Convert timestamps to x values (seconds since first timestamp)
        let base_timestamp = data_points[0].0.timestamp() as f64;
        
        // Collect x and y values
        let mut x_values = Vec::with_capacity(data_points.len());
        let mut y_values = Vec::with_capacity(data_points.len());
        
        for (timestamp, value) in data_points {
            let x = (timestamp.timestamp() as f64) - base_timestamp;
            let y: f64 = (*value).into();
            
            x_values.push(x);
            y_values.push(y);
        }
        
        // Calculate means
        let n = x_values.len() as f64;
        let mean_x = x_values.iter().sum::<f64>() / n;
        let mean_y = y_values.iter().sum::<f64>() / n;
        
        // Calculate slope using linear regression
        let mut numerator = 0.0;
        let mut denominator = 0.0;
        
        for i in 0..x_values.len() {
            let x_diff = x_values[i] - mean_x;
            let y_diff = y_values[i] - mean_y;
            
            numerator += x_diff * y_diff;
            denominator += x_diff * x_diff;
        }
        
        // Avoid division by zero
        if denominator.abs() < 1e-10 {
            return TrendDirection::Neutral;
        }
        
        let slope = numerator / denominator;
        
        // Determine trend direction based on slope
        // Use a small threshold to avoid classifying very slight trends
        const SLOPE_THRESHOLD: f64 = 1e-5;
        
        if slope > SLOPE_THRESHOLD {
            TrendDirection::Up
        } else if slope < -SLOPE_THRESHOLD {
            TrendDirection::Down
        } else {
            TrendDirection::Neutral
        }
    }
    
    /// Calculates the percent change from first to last data point
    fn calculate_percent_change<T>(&self, data_points: &[(DateTime<Utc>, T)]) -> Option<f64> 
    where
        T: Into<f64> + Copy,
    {
        if data_points.len() < 2 {
            return None;
        }
        
        let first_value: f64 = data_points.first()?.1.into();
        let last_value: f64 = data_points.last()?.1.into();
        
        // Avoid division by zero
        if first_value.abs() < 1e-10 {
            return None;
        }
        
        Some((last_value - first_value) / first_value * 100.0)
    }
    
    /// Calculate Sharpe ratio
    fn calculate_sharpe_ratio(&self, returns: &[f64], risk_free_rate: f64) -> Option<f64> {
        if returns.is_empty() {
            return None;
        }
        
        let mean_return: f64 = returns.iter().sum::<f64>() / returns.len() as f64;
        let excess_return = mean_return - risk_free_rate;
        
        // Calculate standard deviation
        let variance = returns.iter()
            .map(|r| (r - mean_return).powi(2))
            .sum::<f64>() / returns.len() as f64;
        
        let std_dev = variance.sqrt();
        
        if std_dev < f64::EPSILON {
            return None;
        }
        
        Some(excess_return / std_dev)
    }
    
    /// Calculate Sortino ratio (only considers downside deviation)
    fn calculate_sortino_ratio(&self, returns: &[f64], risk_free_rate: f64) -> Option<f64> {
        if returns.is_empty() {
            return None;
        }
        
        let mean_return: f64 = returns.iter().sum::<f64>() / returns.len() as f64;
        let excess_return = mean_return - risk_free_rate;
        
        // Calculate downside deviation (only negative returns)
        let downside_returns: Vec<f64> = returns.iter()
            .filter_map(|r| if *r < 0.0 { Some(r.powi(2)) } else { None })
            .collect();
        
        if downside_returns.is_empty() {
            return None;
        }
        
        let downside_deviation = (downside_returns.iter().sum::<f64>() / downside_returns.len() as f64).sqrt();
        
        if downside_deviation < f64::EPSILON {
            return None;
        }
        
        Some(excess_return / downside_deviation)
    }
    
    /// Calculate drawdown metrics
    fn calculate_drawdown_metrics(&self, values: &[f64]) -> (f64, f64) {
        if values.is_empty() {
            return (0.0, 0.0);
        }
        
        let mut max_drawdown = 0.0;
        let mut current_drawdown = 0.0;
        let mut peak = values[0];
        
        for &value in values {
            if value > peak {
                peak = value;
                current_drawdown = 0.0;
            } else {
                let drawdown = if peak > 0.0 { (peak - value) / peak } else { 0.0 };
                current_drawdown = drawdown;
                max_drawdown = max_drawdown.max(drawdown);
            }
        }
        
        (max_drawdown * 100.0, current_drawdown * 100.0)
    }
    
    /// Extract daily returns from executions
    fn extract_daily_returns(&self, executions: &[StoredExecution]) -> Vec<f64> {
        if executions.is_empty() {
            return Vec::new();
        }
        
        // Group executions by day
        let mut daily_pnl = HashMap::new();
        
        for exec in executions {
            if let Some(impact) = &exec.performance_impact {
                let day = Utc.with_ymd_and_hms(
                    exec.timestamp.year(),
                    exec.timestamp.month(),
                    exec.timestamp.day(),
                    0, 0, 0
                ).unwrap();
                
                *daily_pnl.entry(day).or_insert(0.0) += impact.pnl;
            }
        }
        
        // Sort by date
        let mut days: Vec<_> = daily_pnl.keys().collect();
        days.sort();
        
        // Extract returns
        days.iter().map(|&day| daily_pnl[day]).collect()
    }
}

#[async_trait]
impl Analytics for DefaultAnalytics {
    async fn get_performance_summary(
        &self,
        strategy_id: &str,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
        filter: Option<&AnalyticsFilter>,
    ) -> AnalyticsResult<PerformanceSummary> {
        // Get executions for the strategy
        let mut executions = match self.storage.get_strategy_executions(strategy_id).await {
            Ok(execs) => execs,
            Err(e) => return Err(AnalyticsError::StorageError(e.to_string())),
        };
        
        // Apply time range filter
        if let Some((start, end)) = time_range {
            executions.retain(|exec| exec.timestamp >= start && exec.timestamp <= end);
        }
        
        // Apply custom filters
        executions = self.apply_filter(executions, filter);
        
        // Check if we have enough data
        if executions.is_empty() {
            return Err(AnalyticsError::InsufficientData(
                "No executions available for performance summary".to_string()
            ));
        }
        
        // Calculate performance metrics
        let mut winning_trades = 0;
        let mut losing_trades = 0;
        let mut total_pnl = 0.0;
        let mut gross_profit = 0.0;
        let mut gross_loss = 0.0;
        let mut total_holding_time = 0;
        let mut profits = Vec::new();
        let mut losses = Vec::new();
        let mut values = Vec::new();
        let mut current_value = 0.0;
        
        // Track executions with performance impact
        let executions_with_impact: Vec<_> = executions.iter()
            .filter(|exec| exec.performance_impact.is_some())
            .collect();
        
        for exec in &executions_with_impact {
            if let Some(impact) = &exec.performance_impact {
                current_value += impact.pnl;
                values.push(current_value);
                
                if impact.is_win {
                    winning_trades += 1;
                    gross_profit += impact.pnl;
                    profits.push(impact.pnl);
                } else {
                    losing_trades += 1;
                    gross_loss += impact.pnl.abs();
                    losses.push(impact.pnl);
                }
                
                total_pnl += impact.pnl;
                
                if let Some(duration) = impact.duration_seconds {
                    total_holding_time += duration;
                }
            }
        }
        
        // Calculate risk-adjusted returns
        let daily_returns = self.extract_daily_returns(&executions);
        let risk_free_rate = 0.0; // Assume 0% risk-free rate
        
        // Calculate drawdown metrics
        let (max_drawdown, current_drawdown) = self.calculate_drawdown_metrics(&values);
        
        // Total trades count
        let total_trades = winning_trades + losing_trades;
        
        // Compute win rate
        let win_rate = if total_trades > 0 {
            (winning_trades as f64 / total_trades as f64) * 100.0
        } else {
            0.0
        };
        
        // Compute profit factor
        let profit_factor = if gross_loss > 0.0 {
            gross_profit / gross_loss
        } else if gross_profit > 0.0 {
            f64::INFINITY
        } else {
            0.0
        };
        
        // Compute average profit and loss
        let avg_profit = if !profits.is_empty() {
            profits.iter().sum::<f64>() / profits.len() as f64
        } else {
            0.0
        };
        
        let avg_loss = if !losses.is_empty() {
            losses.iter().sum::<f64>() / losses.len() as f64
        } else {
            0.0
        };
        
        // Compute average holding time
        let avg_holding_time = if total_trades > 0 {
            total_holding_time / total_trades as i64
        } else {
            0
        };
        
        Ok(PerformanceSummary {
            total_trades,
            winning_trades,
            losing_trades,
            win_rate,
            total_pnl,
            profit_factor,
            max_drawdown,
            current_drawdown,
            avg_profit,
            avg_loss,
            sharpe_ratio: self.calculate_sharpe_ratio(&daily_returns, risk_free_rate).unwrap_or(0.0),
            sortino_ratio: self.calculate_sortino_ratio(&daily_returns, risk_free_rate).unwrap_or(0.0),
            avg_holding_time_seconds: avg_holding_time,
        })
    }
    
    async fn get_execution_stats(
        &self, 
        strategy_id: &str,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
    ) -> AnalyticsResult<ExecutionStats> {
        // Get executions for the strategy
        let mut executions = match self.storage.get_strategy_executions(strategy_id).await {
            Ok(execs) => execs,
            Err(e) => return Err(AnalyticsError::StorageError(e.to_string())),
        };
        
        // Apply time range filter
        if let Some((start, end)) = time_range {
            executions.retain(|exec| exec.timestamp >= start && exec.timestamp <= end);
        }
        
        // Check if we have enough data
        if executions.is_empty() {
            return Err(AnalyticsError::InsufficientData(
                "No executions available for statistics".to_string()
            ));
        }
        
        // Count execution statuses
        let mut filled_count = 0;
        let mut partial_count = 0;
        let mut failed_count = 0;
        let mut rejected_count = 0;
        let mut latencies = Vec::new();
        let mut fill_rates = Vec::new();
        
        for exec in &executions {
            match exec.result.status {
                ExecutionStatus::Filled => filled_count += 1,
                ExecutionStatus::PartiallyFilled => {
                    partial_count += 1;
                    if let Some(fill_rate) = exec.result.fill_rate {
                        fill_rates.push(fill_rate);
                    }
                },
                ExecutionStatus::Failed => failed_count += 1,
                ExecutionStatus::Rejected => rejected_count += 1,
                _ => {}
            }
            
            if let Some(latency) = exec.result.execution_latency_ms {
                latencies.push(latency);
            }
        }
        
        // Calculate latency statistics
        let (min_latency, max_latency, avg_latency) = if !latencies.is_empty() {
            let min = *latencies.iter().min().unwrap_or(&0);
            let max = *latencies.iter().max().unwrap_or(&0);
            let avg = latencies.iter().sum::<i64>() / latencies.len() as i64;
            (min, max, avg)
        } else {
            (0, 0, 0)
        };
        
        // Calculate average fill rate
        let avg_fill_rate = if !fill_rates.is_empty() {
            fill_rates.iter().sum::<f64>() / fill_rates.len() as f64
        } else {
            0.0
        };
        
        Ok(ExecutionStats {
            total_executions: executions.len(),
            filled_count,
            partial_count,
            failed_count,
            rejected_count,
            avg_fill_rate,
            avg_latency_ms: avg_latency,
            min_latency_ms: min_latency,
            max_latency_ms: max_latency,
        })
    }
    
    async fn get_pnl_over_time(
        &self,
        strategy_id: &str,
        period: TimePeriod,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
        filter: Option<&AnalyticsFilter>,
    ) -> AnalyticsResult<TrendLine> {
        // Get executions for the strategy
        let mut executions = match self.storage.get_strategy_executions(strategy_id).await {
            Ok(execs) => execs,
            Err(e) => return Err(AnalyticsError::StorageError(e.to_string())),
        };
        
        // Apply time range filter
        if let Some((start, end)) = time_range {
            executions.retain(|exec| exec.timestamp >= start && exec.timestamp <= end);
        }
        
        // Apply custom filters
        executions = self.apply_filter(executions, filter);
        
        // Check if we have enough data
        if executions.is_empty() {
            return Err(AnalyticsError::InsufficientData(
                "No executions available for PnL analysis".to_string()
            ));
        }
        
        // Extract PnL data points
        let mut pnl_data: Vec<(DateTime<Utc>, f64)> = executions.iter()
            .filter_map(|exec| {
                if let Some(impact) = &exec.performance_impact {
                    Some((exec.timestamp, impact.pnl))
                } else {
                    None
                }
            })
            .collect();
        
        // Sort by timestamp
        pnl_data.sort_by(|a, b| a.0.cmp(&b.0));
        
        // Group by time period
        let grouped_data = self.group_by_time_period(&pnl_data, period);
        
        // Calculate cumulative PnL for each period
        let mut period_pnl: Vec<(DateTime<Utc>, f64)> = grouped_data.iter()
            .map(|(timestamp, values)| {
                let period_sum = values.iter().sum();
                (*timestamp, period_sum)
            })
            .collect();
        
        // Sort by timestamp
        period_pnl.sort_by(|a, b| a.0.cmp(&b.0));
        
        // Calculate cumulative PnL
        let mut cumulative_pnl = 0.0;
        let mut data_points: Vec<(DateTime<Utc>, f64)> = Vec::new();
        
        for (timestamp, pnl) in period_pnl {
            cumulative_pnl += pnl;
            data_points.push((timestamp, cumulative_pnl));
        }
        
        // Check if we have enough data points
        if data_points.len() < 2 {
            return Err(AnalyticsError::InsufficientData(
                "Not enough data points for trend analysis".to_string()
            ));
        }
        
        // Calculate trend direction and percent change
        let trend_direction = self.calculate_trend_direction(&data_points);
        let percent_change = self.calculate_percent_change(&data_points).unwrap_or(0.0);
        
        Ok(TrendLine {
            data_points,
            trend_direction,
            percent_change,
            time_period: period,
        })
    }
    
    async fn detect_anomalies(
        &self,
        strategy_id: &str,
        time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
    ) -> AnalyticsResult<Vec<Anomaly>> {
        // Get executions for the strategy
        let mut executions = match self.storage.get_strategy_executions(strategy_id).await {
            Ok(execs) => execs,
            Err(e) => return Err(AnalyticsError::StorageError(e.to_string())),
        };
        
        // Apply time range filter
        if let Some((start, end)) = time_range {
            executions.retain(|exec| exec.timestamp >= start && exec.timestamp <= end);
        }
        
        // Check if we have enough data
        if executions.len() < 10 {
            return Err(AnalyticsError::InsufficientData(
                "Insufficient data for anomaly detection (need at least 10 executions)".to_string()
            ));
        }
        
        // Sort executions by timestamp
        executions.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        
        let mut anomalies = Vec::new();
        
        // Detect drawdown spikes
        if let Ok(summary) = self.get_performance_summary(strategy_id, time_range, None).await {
            if summary.max_drawdown > 15.0 {
                // Find when the max drawdown occurred
                let mut max_drawdown_time = Utc::now();
                let mut current_value = 0.0;
                let mut peak_value = 0.0;
                let mut peak_time = Utc::now();
                
                for exec in &executions {
                    if let Some(impact) = &exec.performance_impact {
                        current_value += impact.pnl;
                        
                        if current_value > peak_value {
                            peak_value = current_value;
                            peak_time = exec.timestamp;
                        } else {
                            let drawdown = if peak_value > 0.0 { (peak_value - current_value) / peak_value } else { 0.0 };
                            if drawdown * 100.0 > summary.max_drawdown * 0.9 {  // Close to max drawdown
                                max_drawdown_time = exec.timestamp;
                            }
                        }
                    }
                }
                
                let severity = summary.max_drawdown / 100.0;  // Scale to 0-1
                
                anomalies.push(Anomaly {
                    timestamp: max_drawdown_time,
                    anomaly_type: AnomalyType::DrawdownSpike,
                    severity,
                    description: format!("Significant drawdown of {:.2}% detected", summary.max_drawdown),
                });
            }
        }
        
        // Detect latency outliers
        if let Ok(stats) = self.get_execution_stats(strategy_id, time_range).await {
            // Look for latency outliers
            if stats.max_latency_ms > stats.avg_latency_ms * 3 && stats.max_latency_ms > 1000 {
                // Find executions with high latency
                for exec in &executions {
                    if let Some(latency) = exec.result.execution_latency_ms {
                        if latency > stats.avg_latency_ms * 3 {
                            let severity = (latency as f64 / stats.avg_latency_ms as f64) / 10.0;
                            
                            anomalies.push(Anomaly {
                                timestamp: exec.timestamp,
                                anomaly_type: AnomalyType::LatencyOutlier,
                                severity: severity.min(1.0),
                                description: format!("Execution latency of {}ms is significantly higher than average ({}ms)", 
                                    latency, stats.avg_latency_ms),
                            });
                        }
                    }
                }
            }
        }
        
        // Detect unusual trading patterns (many consecutive failures)
        let mut consecutive_failures = 0;
        let mut failure_start_time = Utc::now();
        
        for (i, exec) in executions.iter().enumerate() {
            if matches!(exec.result.status, ExecutionStatus::Failed | ExecutionStatus::Rejected) {
                if consecutive_failures == 0 {
                    failure_start_time = exec.timestamp;
                }
                consecutive_failures += 1;
            } else {
                if consecutive_failures >= 3 {
                    let severity = (consecutive_failures as f64 / 10.0).min(1.0);
                    
                    anomalies.push(Anomaly {
                        timestamp: failure_start_time,
                        anomaly_type: AnomalyType::ExecutionFailureIncrease,
                        severity,
                        description: format!("{} consecutive execution failures detected", consecutive_failures),
                    });
                }
                consecutive_failures = 0;
            }
            
            // Check at the end of the list
            if i == executions.len() - 1 && consecutive_failures >= 3 {
                let severity = (consecutive_failures as f64 / 10.0).min(1.0);
                
                anomalies.push(Anomaly {
                    timestamp: failure_start_time,
                    anomaly_type: AnomalyType::ExecutionFailureIncrease,
                    severity,
                    description: format!("{} consecutive execution failures detected", consecutive_failures),
                });
            }
        }
        
        // Sort anomalies by severity (highest first)
        anomalies.sort_by(|a, b| b.severity.partial_cmp(&a.severity).unwrap());
        
        Ok(anomalies)
    }
}

/// Create a new analytics instance
pub fn create_analytics(storage: Arc<dyn AnalyticsStorage>) -> Arc<dyn Analytics> {
    Arc::new(DefaultAnalytics::new(storage))
}

/// Create all analytics components from strategy storage
/// 
/// This function sets up both the storage adapter and the analytics service
/// in one convenient step, given a strategy storage implementation.
pub fn setup_analytics(strategy_storage: Arc<dyn StrategyStorage>) -> Arc<dyn Analytics> {
    let analytics_storage = create_analytics_storage(strategy_storage);
    create_analytics(analytics_storage)
} 