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

use std::sync::Arc;
use async_trait::async_trait;
use tracing::{info, warn};

use crate::strategy::{Strategy, Signal, StrategyPerformance, SignalAction, SignalExt, SignalStatus};
use crate::execution::{ExecutionService, ExecutionStatus, ExecutionResult};
use crate::telemetry::TelemetryReporter;
use crate::risk::{RiskManager, RiskError};

/// Default async strategy executor
pub struct DefaultStrategyExecutor {
    pub execution_engine: Arc<ExecutionService>,
    pub risk_manager: Arc<dyn RiskManager>,
    pub telemetry: Arc<TelemetryReporter>,
    pub performance: StrategyPerformance,
}

impl DefaultStrategyExecutor {
    pub fn new(
        execution_engine: Arc<ExecutionService>,
        risk_manager: Arc<dyn RiskManager>,
        telemetry: Arc<TelemetryReporter>,
    ) -> Self {
        Self {
            execution_engine,
            risk_manager,
            telemetry,
            performance: StrategyPerformance::new(),
        }
    }
    
    /// Record a signal rejection in performance metrics
    fn record_rejection(&mut self, signal: &Signal, reason: String) {
        // Update rejection metrics
        self.performance.signals_rejected += 1;
        
        // Track rejection reason if available
        let reason_key = reason.clone();
        self.performance.signal_metrics.rejection_reasons
            .entry(reason_key)
            .and_modify(|count| *count += 1)
            .or_insert(1);
            
        // Update confidence metrics
        if let Some(avg) = &mut self.performance.signal_metrics.avg_confidence {
            *avg = (*avg * (self.performance.signals_generated as f64 - 1.0) 
                + signal.confidence) / self.performance.signals_generated as f64;
        } else {
            self.performance.signal_metrics.avg_confidence = Some(signal.confidence);
        }
    }
    
    /// Record a signal skip in performance metrics 
    fn record_skip(&mut self, signal: &Signal, reason: String) {
        // We don't count skips as rejections in our metrics
        // But we do track the signal in our generated count
        self.performance.signals_generated += 1;
        
        // Add to metadata for reporting
        if let Some(ref mut metadata) = signal.metadata {
            metadata.insert("skip_reason".to_string(), reason);
        }
    }
    
    /// Record execution results in performance metrics
    fn record_execution(&mut self, signal: &Signal, result: &ExecutionResult) {
        // Update execution counts
        self.performance.signals_executed += 1;
        
        // Update trade counts based on result status
        match result.status {
            ExecutionStatus::Filled | ExecutionStatus::Completed => {
                self.performance.successful_trades += 1;
                
                // Update PnL if available
                if result.realized_pnl != 0.0 {
                    self.performance.pnl += result.realized_pnl;
                }
            },
            ExecutionStatus::Partial | ExecutionStatus::PartiallyFilled => {
                // Count partial fills as partial success
                self.performance.successful_trades += 1;
                
                // Update PnL proportionally if available
                if let (Some(executed), Some(requested)) = (result.executed_quantity, signal.quantity) {
                    let fill_ratio = executed / requested;
                    if result.realized_pnl != 0.0 {
                        self.performance.pnl += result.realized_pnl * fill_ratio;
                    }
                }
            },
            _ => {
                self.performance.unsuccessful_trades += 1;
            }
        }
        
        // Update win rate
        let total_trades = self.performance.successful_trades + self.performance.unsuccessful_trades;
        if total_trades > 0 {
            self.performance.win_rate = self.performance.successful_trades as f64 / total_trades as f64;
        }
        
        // Update execution latency if available
        if let Some(latency) = result.latency_profile.as_ref().map(|p| p.total_ms) {
            if let Some(avg) = self.performance.avg_execution_latency_ms {
                self.performance.avg_execution_latency_ms = Some(
                    (avg * (self.performance.signals_executed as f64 - 1.0) + latency as f64) 
                    / self.performance.signals_executed as f64
                );
            } else {
                self.performance.avg_execution_latency_ms = Some(latency as f64);
            }
        }
        
        // Update execution quality metrics
        self.performance.execution_quality.fill_rate_pct = 
            self.performance.signals_executed as f64 / self.performance.signals_generated.max(1) as f64 * 100.0;
    }
}

#[async_trait]
impl StrategyExecutor for DefaultStrategyExecutor {
    async fn execute_signal(&mut self, strategy_id: &str, mut signal: Signal) {
        let sid = signal.id.clone();
        info!("[{}] 🔍 Validating signal: {}", strategy_id, sid);

        // Increment signal count
        self.performance.signals_generated += 1;

        // Step 1: Risk Validation
        if let Err(err) = self.risk_manager.validate_signal(strategy_id, &signal).await {
            warn!("[{}] ❌ Signal rejected: {}", strategy_id, err);
            self.record_rejection(&signal, err.to_string());
            self.risk_manager.update_metrics(strategy_id, &self.performance);
            return;
        }

        // Step 2: Position Sizing
        let sizing = self.risk_manager.calculate_position_size(strategy_id, &signal).await;
        if sizing.effective_size() <= 0.0 {
            warn!("[{}] ⚠️ Sizing returned zero size; skipping", strategy_id);
            self.record_skip(&signal, "Zero position size".to_string());
            self.risk_manager.update_metrics(strategy_id, &self.performance);
            return;
        }

        // Set the quantity on the signal
        signal.quantity = Some(sizing.effective_size());
        
        // Update signal status
        signal.status = SignalStatus::Validated;

        // Step 3: Execute
        info!("[{}] 🚀 Executing signal: {} (qty {:.4})", strategy_id, sid, sizing.effective_size());
        let exec_result = self.execution_engine.execute_signal(signal.clone()).await;
        
        match &exec_result {
            Ok(result) => {
                // Update signal with execution result
                signal.execution_result = Some(result.clone());
                
                // Step 4: Performance Tracking
                self.record_execution(&signal, result);
                self.risk_manager.update_metrics(strategy_id, &self.performance);
                
                // Step 5: Telemetry
                self.telemetry.report_execution_complete(strategy_id, result).await;
                
                // Step 6: Logging
                match result.status {
                    ExecutionStatus::Filled | ExecutionStatus::Completed => 
                        info!("[{}] ✅ Signal filled: {}", strategy_id, sid),
                    ExecutionStatus::Rejected => 
                        warn!("[{}] ❌ Signal execution rejected: {}", strategy_id, sid),
                    ExecutionStatus::Failed => 
                        warn!("[{}] ⚠️ Signal failed during execution: {}", strategy_id, sid),
                    ExecutionStatus::Partial | ExecutionStatus::PartiallyFilled => 
                        info!("[{}] 🟡 Signal partially filled: {}", strategy_id, sid),
                    _ => {}
                }
            },
            Err(err) => {
                // Handle execution error
                warn!("[{}] 🔥 Execution error: {}", strategy_id, err);
                self.performance.unsuccessful_trades += 1;
                
                // Update risk metrics
                self.risk_manager.update_metrics(strategy_id, &self.performance);
                
                // Report error to telemetry
                self.telemetry.report_execution_error(strategy_id, &err.to_string()).await;
            }
        }
    }
}

/// Trait for strategy execution functionality
#[async_trait]
pub trait StrategyExecutor: Send + Sync {
    /// Execute a signal for a specific strategy
    async fn execute_signal(&mut self, strategy_id: &str, signal: Signal);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::risk::{RiskManagerConfig, DefaultRiskManager};
    use crate::strategy::{SignalAction, PositionDirection};
    use crate::execution::{ExecutionResult, ExecutionStatus, ExecutionMode, ExecutionError};
    use std::collections::HashMap;
    use std::sync::Mutex;
    
    // Mock ExecutionService implementation for testing
    struct MockExecutionService {
        execution_results: Mutex<HashMap<String, ExecutionResult>>,
    }
    
    impl MockExecutionService {
        fn new() -> Self {
            Self {
                execution_results: Mutex::new(HashMap::new()),
            }
        }
        
        fn add_mock_result(&self, signal_id: &str, result: ExecutionResult) {
            let mut results = self.execution_results.lock().unwrap();
            results.insert(signal_id.to_string(), result);
        }
    }
    
    #[async_trait]
    impl ExecutionService for MockExecutionService {
        async fn execute_signal(&self, signal: Signal) -> Result<ExecutionResult, ExecutionError> {
            // Check if we have a mock result for this signal
            let results = self.execution_results.lock().unwrap();
            if let Some(result) = results.get(&signal.id) {
                return Ok(result.clone());
            }
            
            // Default to a successful execution
            Ok(ExecutionResult::success(
                "test-request".to_string(),
                signal.id.clone(),
                Some("test-order".to_string()),
                signal.quantity.unwrap_or(1.0),
                10000.0,
            ))
        }
    }
    
    // Mock TelemetryReporter for testing
    struct MockTelemetryReporter;
    
    #[async_trait]
    impl TelemetryReporter for MockTelemetryReporter {
        async fn report_execution_start(&self, _strategy_id: &str) {}
        async fn report_execution_complete(&self, _strategy_id: &str, _result: &ExecutionResult) {}
        async fn report_execution_error(&self, _strategy_id: &str, _error: &str) {}
        async fn report_error(&self, _strategy_id: &str, _error: &str) {}
        async fn report_risk_limit(&self, _strategy_id: &str, _error: &RiskError) {}
        async fn report_no_signal(&self, _strategy_id: &str) {}
    }
    
    // Helper to create a test signal
    fn create_test_signal(id: &str, strategy_id: &str) -> Signal {
        let mut signal = Signal::new(
            strategy_id.to_string(),
            "BTC/USD".to_string(),
            SignalAction::Enter,
        );
        signal.id = id.to_string();
        signal.direction = PositionDirection::Long;
        signal.confidence = 0.8;
        signal
    }
    
    #[tokio::test]
    async fn test_execute_signal_success() {
        // Create dependencies
        let risk_manager = Arc::new(DefaultRiskManager::default());
        let execution_service = Arc::new(MockExecutionService::new());
        let telemetry = Arc::new(MockTelemetryReporter);
        
        // Create executor
        let mut executor = DefaultStrategyExecutor::new(
            execution_service.clone(),
            risk_manager,
            telemetry,
        );
        
        // Create test signal
        let signal = create_test_signal("test-signal-1", "test-strategy");
        
        // Setup mock execution result
        let success_result = ExecutionResult::success(
            "req-1".to_string(),
            signal.id.clone(),
            Some("ord-1".to_string()),
            1.0,
            50000.0,
        );
        execution_service.add_mock_result(&signal.id, success_result);
        
        // Execute signal
        executor.execute_signal("test-strategy", signal).await;
        
        // Verify performance metrics
        assert_eq!(executor.performance.signals_generated, 1);
        assert_eq!(executor.performance.signals_executed, 1);
        assert_eq!(executor.performance.successful_trades, 1);
        assert_eq!(executor.performance.unsuccessful_trades, 0);
        assert_eq!(executor.performance.win_rate, 1.0);
    }
    
    #[tokio::test]
    async fn test_execute_signal_rejected() {
        // Create dependencies with strict risk manager
        let mut config = RiskManagerConfig::default();
        config.min_confidence = 0.9; // Set high confidence requirement to force rejection
        let risk_manager = Arc::new(DefaultRiskManager::new(config));
        let execution_service = Arc::new(MockExecutionService::new());
        let telemetry = Arc::new(MockTelemetryReporter);
        
        // Create executor
        let mut executor = DefaultStrategyExecutor::new(
            execution_service,
            risk_manager,
            telemetry,
        );
        
        // Create test signal with lower confidence
        let mut signal = create_test_signal("test-signal-2", "test-strategy");
        signal.confidence = 0.7; // Below required threshold
        
        // Execute signal (should be rejected)
        executor.execute_signal("test-strategy", signal).await;
        
        // Verify performance metrics
        assert_eq!(executor.performance.signals_generated, 1);
        assert_eq!(executor.performance.signals_executed, 0);
        assert_eq!(executor.performance.signals_rejected, 1);
        assert_eq!(executor.performance.successful_trades, 0);
    }
} 