use anyhow::Result;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use uuid::Uuid;
use noderr_core::execution::{ExecutionResult, ExecutionStatus};
use noderr_core::market::MarketData;
use noderr_core::strategy::{Signal, Strategy, StrategyId};
use noderr_core::strategy_executor::StrategyExecutor;
use noderr_core::risk::{PositionSizing, RiskMetrics};
use crate::commands::reason_chain::ReasonChainBuilder;

/// Wrapper for StrategyExecutor that captures reasoning chains
pub struct ReasonChainExecutorWrapper {
    /// The underlying strategy executor
    executor: Arc<StrategyExecutor>,
    /// Active reasoning chain builders by strategy ID
    reasoning_chains: Arc<Mutex<HashMap<StrategyId, ReasonChainBuilder>>>,
}

impl ReasonChainExecutorWrapper {
    /// Create a new wrapper around a strategy executor
    pub fn new(executor: Arc<StrategyExecutor>) -> Self {
        Self {
            executor,
            reasoning_chains: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    /// Get the underlying executor
    pub fn executor(&self) -> Arc<StrategyExecutor> {
        self.executor.clone()
    }
    
    /// Execute a strategy with reasoning chain capture
    pub async fn execute_strategy(&self, strategy: &dyn Strategy, market_data: &MarketData) -> Result<Option<(Signal, ReasonChainBuilder)>> {
        let strategy_id = strategy.id();
        
        // Create a new reasoning chain builder for this execution
        let mut builder = ReasonChainBuilder::new(strategy_id.0.clone());
        
        // Add initial context
        builder.with_context("strategy_name", strategy.name())?;
        builder.with_context("market_data_timestamp", market_data.timestamp.to_rfc3339())?;
        builder.with_context("execution_start", Utc::now().to_rfc3339())?;
        
        // Record initial step
        builder.push(format!("Strategy execution started for {}", strategy.name()));
        
        // Store the builder in our active map
        {
            let mut chains = self.reasoning_chains.lock().unwrap();
            chains.insert(strategy_id.clone(), builder.clone());
        }
        
        // Get risk profile (and record reasoning)
        let risk_profile = strategy.get_risk_profile().await;
        builder.push(format!("Retrieved risk profile: max allocation = {:.2}%, risk tolerance = {}", 
            risk_profile.max_allocation_percent, 
            risk_profile.risk_tolerance_level));
        
        // Generate signal from strategy
        match strategy.generate_signal(market_data).await {
            Ok(Some(signal)) => {
                builder.push(format!("Generated signal: {} {} at {}", 
                    signal.action,
                    signal.symbol,
                    signal.price.unwrap_or(0.0)));
                
                // Record signal details
                builder.with_context("signal_action", signal.action.to_string())?;
                builder.with_context("signal_symbol", signal.symbol.to_string())?;
                builder.with_context("signal_timestamp", signal.timestamp.to_rfc3339())?;
                
                // Return the signal and reasoning chain
                Ok(Some((signal, builder)))
            },
            Ok(None) => {
                builder.push("No signal generated for current market conditions");
                Ok(None)
            },
            Err(e) => {
                builder.push(format!("Error generating signal: {}", e));
                Err(anyhow::anyhow!("Strategy error: {}", e))
            }
        }
    }
    
    /// Process a signal through risk management with reasoning capture
    pub async fn process_through_risk_management(
        &self, 
        strategy_id: &StrategyId, 
        signal: &Signal, 
        market_data: &MarketData
    ) -> Result<(PositionSizing, ReasonChainBuilder)> {
        // Retrieve the reasoning chain
        let mut builder = self.get_or_create_chain(strategy_id).await;
        
        // Validate the signal through risk management
        match self.executor.risk_manager().validate_signal(strategy_id, signal, market_data) {
            Ok(()) => {
                builder.push("Signal passed risk validation");
            },
            Err(e) => {
                builder.push(format!("Signal rejected by risk management: {}", e));
                return Err(anyhow::anyhow!("Risk error: {}", e));
            }
        }
        
        // Calculate position sizing
        let sizing = self.executor.risk_manager().calculate_position_size(strategy_id, signal, market_data);
        
        // Record the reasoning
        match sizing.clone() {
            PositionSizing::Fixed { size, currency } => {
                builder.push(format!("Position sizing: Fixed {:.2} {}", size, currency));
            },
            PositionSizing::Percentage { pct_account, limit, currency } => {
                builder.push(format!("Position sizing: {:.2}% of account with limit of {:.2} {}", 
                    pct_account * 100.0, limit.unwrap_or(0.0), currency));
            },
            PositionSizing::RiskBased { risk_amount, stop_distance_points, .. } => {
                builder.push(format!("Position sizing: Risk-based with ${:.2} risked and stop distance of {} points", 
                    risk_amount, stop_distance_points));
            },
            _ => {
                builder.push("Position sizing: Custom or unknown type");
            }
        }
        
        Ok((sizing, builder))
    }
    
    /// Execute a signal with reasoning capture
    pub async fn execute_signal(
        &self,
        strategy_id: &StrategyId,
        signal: &Signal,
        position_sizing: PositionSizing
    ) -> Result<(ExecutionResult, ReasonChainBuilder)> {
        // Retrieve the reasoning chain
        let mut builder = self.get_or_create_chain(strategy_id).await;
        
        // Create execution request
        builder.push("Creating execution request");
        
        // Execute the signal
        builder.push(format!("Sending execution request for {} {}", signal.action, signal.symbol));
        
        let result = self.executor.execution_service().execute(signal.to_execution_request(position_sizing)).await
            .map_err(|e| anyhow::anyhow!("Execution error: {}", e))?;
        
        // Record the result
        match result.status {
            ExecutionStatus::Completed => {
                builder.push(format!("Execution completed successfully: Trade ID {}", result.trade_id));
                if let Some(fill_price) = result.fill_price {
                    builder.push(format!("Filled at price: {:.6}", fill_price));
                }
            },
            ExecutionStatus::PartiallyFilled => {
                builder.push(format!("Execution partially filled: Trade ID {}", result.trade_id));
            },
            ExecutionStatus::Rejected => {
                builder.push(format!("Execution rejected: {}", result.reject_reason.unwrap_or_default()));
            },
            ExecutionStatus::Failed => {
                builder.push(format!("Execution failed: {}", result.error_message.unwrap_or_default()));
            },
            ExecutionStatus::Pending => {
                builder.push("Execution status: Pending");
            }
        }
        
        // Record final information
        builder.with_context("execution_status", result.status.to_string())?;
        builder.with_context("execution_end", Utc::now().to_rfc3339())?;
        
        Ok((result, builder))
    }
    
    /// Get the current reasoning chain for a strategy, or create a new one if none exists
    async fn get_or_create_chain(&self, strategy_id: &StrategyId) -> ReasonChainBuilder {
        let chains = self.reasoning_chains.lock().unwrap();
        
        match chains.get(strategy_id) {
            Some(chain) => chain.clone(),
            None => {
                // Create a new chain if one doesn't exist
                let builder = ReasonChainBuilder::new(strategy_id.0.clone());
                builder
            }
        }
    }
    
    /// Finalize a reasoning chain and export it to storage
    pub async fn finalize_and_export(
        &self,
        strategy_id: &StrategyId,
        final_strategy: String,
        confidence: f32
    ) -> Result<String> {
        let mut chains = self.reasoning_chains.lock().unwrap();
        
        match chains.remove(strategy_id) {
            Some(chain) => {
                // Export the chain
                let decision_id = chain.decision_id().to_string();
                chain.export(final_strategy, 1.0, confidence).await?;
                Ok(decision_id)
            },
            None => {
                // Create and export a minimal chain if none exists
                let builder = ReasonChainBuilder::new(strategy_id.0.clone());
                let decision_id = builder.decision_id().to_string();
                builder.export(final_strategy, 1.0, confidence).await?;
                Ok(decision_id)
            }
        }
    }
} 