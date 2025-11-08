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

#[cfg(feature = "napi")]
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::order_router::{Order, OrderSide, SmartOrderRouter, ExecutionFailureReason};
use crate::execution_strategy::{ExecutionAlgorithm, ExecutionStrategyConfig, ExecutionStrategyRouter, TWAPConfig, VWAPConfig};
use crate::risk_calc::{RiskCalculator, RiskConfig, PositionExposure, VenueExposure, RiskViolationType};
use crate::trade_sizer::{DynamicTradeSizer, TradeSizerConfig};
use crate::drawdown_monitor::{DrawdownMonitor, DrawdownConfig, TradeDataPoint, TradeType, KillSwitch};
use crate::venue_latency::{VenueLatencyTracker, VenueLatencyStats};
use crate::shared_memory::{SharedMemoryManager, BufferConfig, BufferType, SharedRingBuffer, BatchProcessor, BatchResult};
use crate::orderbook::{OrderBookManager};
use crate::strategy_engine::{StrategyEngine, StrategyEngineConfig, StrategyEngineMode, StrategyEngineError, SignalEvaluation, SignalMetrics};
use crate::position_manager::{PositionManager, PositionManagerConfig, Side, OrderOrFill, SymbolPosition, AgentPosition};

/// NAPI wrapper for SmartOrderRouter
#[cfg_attr(feature = "napi", napi(js_name = "SmartOrderRouter"))]
pub struct NapiSmartOrderRouter {
    inner: Arc<SmartOrderRouter>,
}

/// NAPI wrapper for Order parameters
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct OrderParams {
    pub symbol: String,
    pub side: String,
    pub amount: f64,
    pub price: f64,
    pub venues: Vec<String>,
    pub id: String,
    pub max_slippage: Option<f64>,
    pub max_retries: Option<u32>,
    pub additional_params: HashMap<String, serde_json::Value>,
}

/// NAPI wrapper for SmartOrderRouter creation
#[cfg_attr(feature = "napi", napi)]
impl NapiSmartOrderRouter {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(SmartOrderRouter::new()),
        }
    }

    #[cfg_attr(feature = "napi", napi(factory))]
    pub fn with_trust_scores(trust_scores: HashMap<String, f64>) -> Self {
        let retry_engine = Arc::new(crate::order_router::OrderRetryEngine::new(3, 1000, 30000));
        Self {
            inner: Arc::new(SmartOrderRouter::with_retry_engine(retry_engine, trust_scores)),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn execute_order(&self, params: OrderParams) -> napi::Result<serde_json::Value> {
        let order = Order {
            symbol: params.symbol,
            side: match params.side.as_str() {
                "buy" => OrderSide::Buy,
                "sell" => OrderSide::Sell,
                _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid order side")),
            },
            amount: params.amount,
            price: params.price,
            venues: params.venues,
            id: params.id,
            max_slippage: params.max_slippage,
            max_retries: params.max_retries,
            additional_params: params.additional_params,
        };

        match self.inner.execute_order(order).await {
            Ok(result) => Ok(serde_json::to_value(result)?),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Execution error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_venue_trust_score(&self, venue: String) -> napi::Result<f64> {
        Ok(self.inner.get_venue_trust_score(&venue).await)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn set_venue_trust_score(&self, venue: String, score: f64) -> napi::Result<()> {
        // We need to implement this method in SmartOrderRouter
        // For now, we'll use improve_trust_score as a proxy
        if score > 0.5 {
            self.inner.improve_trust_score(&venue, score - 0.5).await;
        } else {
            self.inner.decay_trust_score(&venue, 0.5 - score).await;
        }
        Ok(())
    }
}

/// NAPI wrapper for RiskCalculator
#[cfg_attr(feature = "napi", napi(js_name = "RiskCalculator"))]
pub struct NapiRiskCalculator {
    inner: Arc<RiskCalculator>,
}

/// NAPI wrapper for RiskConfig
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct RiskConfigParams {
    pub max_position_size_pct: f64,
    pub max_leverage: f64,
    pub max_drawdown_pct: f64,
    pub min_trust_score: f64,
    pub max_exposure_per_symbol: f64,
    pub max_exposure_per_venue: f64,
    pub exempt_strategies: Vec<String>,
    pub fast_risk_mode: bool,
}

/// NAPI wrapper for PositionExposure
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct PositionExposureParams {
    pub symbol: String,
    pub venue: String,
    pub size: f64,
    pub value: f64,
    pub leverage: f64,
    pub trust_score: f64,
    pub direction: String,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiRiskCalculator {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new(config_params: RiskConfigParams, portfolio_value: f64) -> Self {
        let exempt_strategies = config_params.exempt_strategies.into_iter().collect();
        
        let config = RiskConfig {
            max_position_size_pct: config_params.max_position_size_pct,
            max_leverage: config_params.max_leverage,
            max_drawdown_pct: config_params.max_drawdown_pct,
            min_trust_score: config_params.min_trust_score,
            max_exposure_per_symbol: config_params.max_exposure_per_symbol,
            max_exposure_per_venue: config_params.max_exposure_per_venue,
            rebalance_interval_ms: 300000, // Default
            webhook_url: None,
            exempt_strategies,
            fast_risk_mode: config_params.fast_risk_mode,
        };

        Self {
            inner: Arc::new(RiskCalculator::new(config, portfolio_value)),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn validate_position(&self, params: PositionExposureParams) -> napi::Result<bool> {
        let direction = match params.direction.as_str() {
            "long" => crate::risk::PositionDirection::Long,
            "short" => crate::risk::PositionDirection::Short,
            _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid position direction")),
        };

        let position = PositionExposure::new(
            &params.symbol,
            &params.venue,
            params.size,
            params.value,
            params.leverage,
            params.trust_score,
            direction,
        );

        match self.inner.add_position(position).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn fast_risk_check(&self, params: PositionExposureParams, strategy_id: Option<String>) -> napi::Result<serde_json::Value> {
        let direction = match params.direction.as_str() {
            "long" => crate::risk::PositionDirection::Long,
            "short" => crate::risk::PositionDirection::Short,
            _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid position direction")),
        };

        let position = PositionExposure::new(
            &params.symbol,
            &params.venue,
            params.size,
            params.value,
            params.leverage,
            params.trust_score,
            direction,
        );

        let result = self.inner.fast_risk_check(&position, strategy_id.as_deref()).await;
        Ok(serde_json::to_value(result)?)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn update_portfolio_value(&self, value: f64) -> napi::Result<()> {
        self.inner.update_portfolio_value(value).await;
        Ok(())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_symbol_exposure(&self, symbol: String) -> napi::Result<f64> {
        Ok(self.inner.get_symbol_exposure(&symbol).await)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn set_trust_score(&self, venue: String, score: f64) -> napi::Result<()> {
        self.inner.set_trust_score(&venue, score).await;
        Ok(())
    }
}

/// NAPI wrapper for DynamicTradeSizer
#[cfg_attr(feature = "napi", napi(js_name = "DynamicTradeSizer"))]
pub struct NapiDynamicTradeSizer {
    inner: Arc<DynamicTradeSizer>,
}

/// NAPI wrapper for TradeSizerConfig
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct TradeSizerConfigParams {
    pub base_size: f64,
    pub max_volatility_threshold: f64,
    pub volatility_window_size: usize,
    pub min_size_factor: f64,
    pub max_size_factor: f64,
    pub enable_logging: bool,
    pub symbol_scale_factors: HashMap<String, f64>,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiDynamicTradeSizer {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DynamicTradeSizer::new()),
        }
    }

    #[cfg_attr(feature = "napi", napi(factory))]
    pub fn with_config(config_params: TradeSizerConfigParams) -> Self {
        let config = TradeSizerConfig {
            base_size: config_params.base_size,
            max_volatility_threshold: config_params.max_volatility_threshold,
            volatility_window_size: config_params.volatility_window_size,
            min_size_factor: config_params.min_size_factor,
            max_size_factor: config_params.max_size_factor,
            log_file_path: "logs/risk/trade_sizing.jsonl".to_string(), // Default
            enable_logging: config_params.enable_logging,
            symbol_scale_factors: config_params.symbol_scale_factors,
        };

        Self {
            inner: Arc::new(DynamicTradeSizer::with_config(config)),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn calculate_position_size(&self, symbol: String, base_size: f64) -> napi::Result<f64> {
        match self.inner.calculate_position_size(&symbol, base_size).await {
            Ok(size) => Ok(size),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Sizing error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn update_volatility(&self, symbol: String, price: f64) -> napi::Result<f64> {
        match self.inner.update_volatility(&symbol, price, None).await {
            Ok(volatility) => Ok(volatility),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Volatility update error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_volatility(&self, symbol: String) -> napi::Result<f64> {
        match self.inner.get_volatility(&symbol).await {
            Ok(volatility) => Ok(volatility),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Get volatility error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn clear_symbol_data(&self, symbol: String) -> napi::Result<()> {
        self.inner.clear_symbol_data(&symbol).await;
        Ok(())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_tracked_symbols(&self) -> napi::Result<Vec<String>> {
        Ok(self.inner.get_tracked_symbols().await)
    }
}

/// Custom KillSwitch implementation for NAPI
struct NapiKillSwitch {
    callback: Arc<dyn Fn(&str, &str, &str) -> bool + Send + Sync>,
}

#[async_trait::async_trait]
impl KillSwitch for NapiKillSwitch {
    async fn trigger(&self, agent_id: &str, reason: &str, message: &str) -> bool {
        (self.callback)(agent_id, reason, message)
    }
}

/// NAPI wrapper for DrawdownMonitor
#[cfg_attr(feature = "napi", napi(js_name = "DrawdownMonitor"))]
pub struct NapiDrawdownMonitor {
    inner: Arc<DrawdownMonitor>,
}

/// NAPI wrapper for DrawdownConfig
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct DrawdownConfigParams {
    pub max_drawdown_pct: f64,
    pub alert_threshold_pct: f64,
    pub rolling_window_size: usize,
    pub min_trades_for_drawdown: usize,
    pub cooldown_period_ms: u64,
}

/// NAPI wrapper for TradeDataPoint
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct TradeDataPointParams {
    pub agent_id: String,
    pub symbol: String,
    pub amount: f64,
    pub price: f64,
    pub trade_type: String,
    pub equity: f64,
    pub trade_id: String,
    pub pnl: f64,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiDrawdownMonitor {
    #[cfg_attr(feature = "napi", napi(factory))]
    pub fn create(config_params: DrawdownConfigParams, kill_switch_callback: napi::JsFunction) -> napi::Result<Self> {
        let callback = move |agent_id: &str, reason: &str, message: &str| -> bool {
            let env = kill_switch_callback.env;
            let this = env.get_undefined().unwrap();
            let args = &[
                env.create_string(agent_id).unwrap().into_unknown(),
                env.create_string(reason).unwrap().into_unknown(),
                env.create_string(message).unwrap().into_unknown(),
            ];
            
            match kill_switch_callback.call(Some(&this), args) {
                Ok(result) => result.coerce_to_bool().unwrap().get_value().unwrap(),
                Err(_) => false,
            }
        };

        let kill_switch = Arc::new(NapiKillSwitch { 
            callback: Arc::new(callback) 
        });

        let config = DrawdownConfig {
            max_drawdown_pct: config_params.max_drawdown_pct,
            alert_threshold_pct: config_params.alert_threshold_pct,
            rolling_window_size: config_params.rolling_window_size,
            min_trades_for_drawdown: config_params.min_trades_for_drawdown,
            cooldown_period_ms: config_params.cooldown_period_ms,
            log_file_path: "logs/risk/drawdowns.jsonl".to_string(), // Default
        };

        Ok(Self {
            inner: Arc::new(DrawdownMonitor::new(config, kill_switch)),
        })
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn record_trade(&self, params: TradeDataPointParams) -> napi::Result<()> {
        let trade_type = match params.trade_type.as_str() {
            "buy" => TradeType::Buy,
            "sell" => TradeType::Sell,
            "close" => TradeType::Close,
            _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid trade type")),
        };

        let trade = TradeDataPoint {
            timestamp: chrono::Utc::now(),
            agent_id: params.agent_id,
            symbol: params.symbol,
            amount: params.amount,
            price: params.price,
            trade_type,
            equity: params.equity,
            trade_id: params.trade_id,
            pnl: params.pnl,
        };

        match self.inner.record_trade(trade).await {
            Ok(_) => Ok(()),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Record trade error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_current_drawdown(&self, agent_id: String) -> napi::Result<f64> {
        match self.inner.get_current_drawdown(&agent_id).await {
            Ok(drawdown) => Ok(drawdown),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Get drawdown error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn is_agent_active(&self, agent_id: String) -> napi::Result<bool> {
        match self.inner.is_agent_active(&agent_id).await {
            Ok(active) => Ok(active),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Check agent active error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn reset_agent(&self, agent_id: String) -> napi::Result<()> {
        match self.inner.reset_agent(&agent_id).await {
            Ok(_) => Ok(()),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Reset agent error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_all_states(&self) -> napi::Result<serde_json::Value> {
        let states = self.inner.get_all_states().await;
        Ok(serde_json::to_value(states)?)
    }
}

/// NAPI wrapper for ExecutionStrategyRouter
#[cfg_attr(feature = "napi", napi(js_name = "ExecutionStrategyRouter"))]
pub struct NapiExecutionStrategyRouter {
    inner: Arc<ExecutionStrategyRouter>,
}

/// NAPI wrapper for ExecutionStrategyConfig
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct ExecutionStrategyConfigParams {
    pub default_strategy: String,
    pub min_order_size_for_twap: f64,
    pub min_order_size_for_vwap: f64,
    pub twap_config: Option<TWAPConfigParams>,
    pub vwap_config: Option<VWAPConfigParams>,
    pub max_execution_time_ms: u64,
    pub symbol_strategy_map: HashMap<String, String>,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiExecutionStrategyRouter {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new(config_params: ExecutionStrategyConfigParams) -> napi::Result<Self> {
        let default_strategy = match config_params.default_strategy.as_str() {
            "TWAP" => ExecutionAlgorithm::TWAP,
            "VWAP" => ExecutionAlgorithm::VWAP,
            "ImplementationShortfall" => ExecutionAlgorithm::ImplementationShortfall,
            "Iceberg" => ExecutionAlgorithm::Iceberg,
            "Pegged" => ExecutionAlgorithm::Pegged,
            "DMA" => ExecutionAlgorithm::DMA,
            "SmartOrderRouting" => ExecutionAlgorithm::SmartOrderRouting,
            _ => return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("Invalid execution algorithm: {}", config_params.default_strategy),
            )),
        };

        let mut symbol_strategy_map = HashMap::new();
        for (symbol, strategy_str) in config_params.symbol_strategy_map {
            let strategy = match strategy_str.as_str() {
                "TWAP" => ExecutionAlgorithm::TWAP,
                "VWAP" => ExecutionAlgorithm::VWAP,
                "ImplementationShortfall" => ExecutionAlgorithm::ImplementationShortfall,
                "Iceberg" => ExecutionAlgorithm::Iceberg,
                "Pegged" => ExecutionAlgorithm::Pegged,
                "DMA" => ExecutionAlgorithm::DMA,
                "SmartOrderRouting" => ExecutionAlgorithm::SmartOrderRouting,
                _ => return Err(napi::Error::new(
                    napi::Status::InvalidArg,
                    format!("Invalid execution algorithm: {}", strategy_str),
                )),
            };
            symbol_strategy_map.insert(symbol, strategy);
        }

        let twap_config = if let Some(tc) = config_params.twap_config {
            Some(TWAPConfig {
                slices: tc.slices,
                interval_ms: tc.interval_ms,
                max_interval_deviation_ms: tc.max_interval_deviation_ms,
                min_execution_pct: tc.min_execution_pct,
                randomize_sizes: tc.randomize_sizes,
                size_deviation_pct: tc.size_deviation_pct,
            })
        } else {
            Some(TWAPConfig::default())
        };

        let vwap_config = if let Some(vc) = config_params.vwap_config {
            Some(VWAPConfig {
                start_time_offset_ms: vc.start_time_offset_ms,
                end_time_offset_ms: vc.end_time_offset_ms,
                max_participation_rate: vc.max_participation_rate,
                min_execution_pct: vc.min_execution_pct,
                use_historical_profile: vc.use_historical_profile,
                volume_profile: vc.volume_profile,
            })
        } else {
            Some(VWAPConfig::default())
        };

        let config = ExecutionStrategyConfig {
            default_strategy,
            min_order_size_for_twap: config_params.min_order_size_for_twap,
            min_order_size_for_vwap: config_params.min_order_size_for_vwap,
            twap_config,
            vwap_config,
            max_execution_time_ms: config_params.max_execution_time_ms,
            symbol_strategy_map,
        };

        // Create mock strategy executors for now - in production these would be real executors
        let mock_twap = Arc::new(crate::execution_strategy::tests::MockStrategy::new(
            ExecutionAlgorithm::TWAP,
            "TWAP".to_string(),
        ));
        let mock_vwap = Arc::new(crate::execution_strategy::tests::MockStrategy::new(
            ExecutionAlgorithm::VWAP,
            "VWAP".to_string(),
        ));

        let router = crate::create_execution_strategy_router(
            config,
            mock_twap.clone(),
            mock_vwap.clone(),
        );

        Ok(Self {
            inner: router,
        })
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn execute_order(
        &self,
        params: OrderParams,
        callback: napi::JsFunction,
    ) -> napi::Result<()> {
        let order = Order {
            symbol: params.symbol,
            side: match params.side.as_str() {
                "buy" => OrderSide::Buy,
                "sell" => OrderSide::Sell,
                _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid order side")),
            },
            amount: params.amount,
            price: params.price,
            venues: params.venues,
            id: params.id,
            max_slippage: params.max_slippage,
            max_retries: params.max_retries,
            additional_params: params.additional_params,
        };

        let env = callback.env;
        let js_callback = Arc::new(move |result: crate::execution::ExecutionResult| {
            // Convert the result to a JavaScript object
            let this = env.get_undefined().unwrap();
            let result_value = serde_json::to_value(&result).unwrap();
            let js_result = env.to_js_value(&result_value).unwrap();
            
            let args = &[js_result.into_unknown()];
            let _ = callback.call(Some(&this), args);
        });

        match self.inner.execute(order, js_callback).await {
            Ok(()) => Ok(()),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Execution error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn estimate_impact(&self, params: OrderParams) -> napi::Result<f64> {
        let order = Order {
            symbol: params.symbol,
            side: match params.side.as_str() {
                "buy" => OrderSide::Buy,
                "sell" => OrderSide::Sell,
                _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid order side")),
            },
            amount: params.amount,
            price: params.price,
            venues: params.venues,
            id: params.id,
            max_slippage: params.max_slippage,
            max_retries: params.max_retries,
            additional_params: params.additional_params,
        };

        match self.inner.estimate_impact(&order).await {
            Ok(impact) => Ok(impact),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Impact estimation error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn get_cost_estimate(&self, params: OrderParams) -> napi::Result<f64> {
        let order = Order {
            symbol: params.symbol,
            side: match params.side.as_str() {
                "buy" => OrderSide::Buy,
                "sell" => OrderSide::Sell,
                _ => return Err(napi::Error::new(napi::Status::InvalidArg, "Invalid order side")),
            },
            amount: params.amount,
            price: params.price,
            venues: params.venues,
            id: params.id,
            max_slippage: params.max_slippage,
            max_retries: params.max_retries,
            additional_params: params.additional_params,
        };

        match self.inner.get_cost_estimate(&order).await {
            Ok(cost) => Ok(cost),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Cost estimation error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn cancel_execution(&self, order_id: String) -> napi::Result<()> {
        match self.inner.cancel_execution(&order_id).await {
            Ok(()) => Ok(()),
            Err(e) => Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Execution cancellation error: {}", e),
            )),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub async fn update_config(&self, config_params: ExecutionStrategyConfigParams) -> napi::Result<()> {
        let default_strategy = match config_params.default_strategy.as_str() {
            "TWAP" => ExecutionAlgorithm::TWAP,
            "VWAP" => ExecutionAlgorithm::VWAP,
            "ImplementationShortfall" => ExecutionAlgorithm::ImplementationShortfall,
            "Iceberg" => ExecutionAlgorithm::Iceberg,
            "Pegged" => ExecutionAlgorithm::Pegged,
            "DMA" => ExecutionAlgorithm::DMA,
            "SmartOrderRouting" => ExecutionAlgorithm::SmartOrderRouting,
            _ => return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("Invalid execution algorithm: {}", config_params.default_strategy),
            )),
        };

        let mut symbol_strategy_map = HashMap::new();
        for (symbol, strategy_str) in config_params.symbol_strategy_map {
            let strategy = match strategy_str.as_str() {
                "TWAP" => ExecutionAlgorithm::TWAP,
                "VWAP" => ExecutionAlgorithm::VWAP,
                "ImplementationShortfall" => ExecutionAlgorithm::ImplementationShortfall,
                "Iceberg" => ExecutionAlgorithm::Iceberg,
                "Pegged" => ExecutionAlgorithm::Pegged,
                "DMA" => ExecutionAlgorithm::DMA,
                "SmartOrderRouting" => ExecutionAlgorithm::SmartOrderRouting,
                _ => return Err(napi::Error::new(
                    napi::Status::InvalidArg,
                    format!("Invalid execution algorithm: {}", strategy_str),
                )),
            };
            symbol_strategy_map.insert(symbol, strategy);
        }

        let twap_config = if let Some(tc) = config_params.twap_config {
            Some(TWAPConfig {
                slices: tc.slices,
                interval_ms: tc.interval_ms,
                max_interval_deviation_ms: tc.max_interval_deviation_ms,
                min_execution_pct: tc.min_execution_pct,
                randomize_sizes: tc.randomize_sizes,
                size_deviation_pct: tc.size_deviation_pct,
            })
        } else {
            Some(TWAPConfig::default())
        };

        let vwap_config = if let Some(vc) = config_params.vwap_config {
            Some(VWAPConfig {
                start_time_offset_ms: vc.start_time_offset_ms,
                end_time_offset_ms: vc.end_time_offset_ms,
                max_participation_rate: vc.max_participation_rate,
                min_execution_pct: vc.min_execution_pct,
                use_historical_profile: vc.use_historical_profile,
                volume_profile: vc.volume_profile,
            })
        } else {
            Some(VWAPConfig::default())
        };

        let config = ExecutionStrategyConfig {
            default_strategy,
            min_order_size_for_twap: config_params.min_order_size_for_twap,
            min_order_size_for_vwap: config_params.min_order_size_for_vwap,
            twap_config,
            vwap_config,
            max_execution_time_ms: config_params.max_execution_time_ms,
            symbol_strategy_map,
        };

        self.inner.update_config(config).await;
        Ok(())
    }
}

/// NAPI wrapper for TWAPConfig
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct TWAPConfigParams {
    pub slices: u32,
    pub interval_ms: u64,
    pub max_interval_deviation_ms: u64,
    pub min_execution_pct: f64,
    pub randomize_sizes: bool,
    pub size_deviation_pct: f64,
}

/// NAPI wrapper for VWAPConfig
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct VWAPConfigParams {
    pub start_time_offset_ms: i64,
    pub end_time_offset_ms: i64,
    pub max_participation_rate: f64,
    pub min_execution_pct: f64,
    pub use_historical_profile: bool,
    pub volume_profile: Option<Vec<f64>>,
}

/// NAPI wrapper for VenueLatencyTracker
#[cfg_attr(feature = "napi", napi(js_name = "VenueLatencyTracker"))]
pub struct NapiVenueLatencyTracker {
    inner: Arc<VenueLatencyTracker>,
}

/// NAPI wrapper for venue latency statistics
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct VenueLatencyStatsParams {
    pub avg_ns: f64,
    pub p50_ns: f64,
    pub p90_ns: f64,
    pub p95_ns: f64,
    pub p99_ns: f64,
    pub min_ns: u64, // u128 isn't supported by NAPI, so we use u64
    pub max_ns: u64, // u128 isn't supported by NAPI, so we use u64
    pub recent_avg_ns: f64,
    pub sample_count: u32,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiVenueLatencyTracker {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(VenueLatencyTracker::new()),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn record_latency(&self, venue_id: String, duration_ns: f64) -> napi::Result<()> {
        // Convert f64 to u128, capping at u128::MAX if necessary
        let duration_u128 = if duration_ns > u128::MAX as f64 {
            u128::MAX
        } else if duration_ns < 0.0 {
            0
        } else {
            duration_ns as u128
        };
        
        self.inner.record_latency(&venue_id, duration_u128);
        Ok(())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_latency_stats(&self, venue_id: String) -> napi::Result<Option<VenueLatencyStatsParams>> {
        let stats = self.inner.get_latency_stats(&venue_id).map(|stats| {
            // Convert potential u128 values to u64, capping if necessary
            let min_ns = if stats.min_ns > u64::MAX as u128 { 
                u64::MAX 
            } else { 
                stats.min_ns as u64 
            };
            
            let max_ns = if stats.max_ns > u64::MAX as u128 { 
                u64::MAX 
            } else { 
                stats.max_ns as u64 
            };
            
            VenueLatencyStatsParams {
                avg_ns: stats.avg_ns,
                p50_ns: stats.p50_ns,
                p90_ns: stats.p90_ns,
                p95_ns: stats.p95_ns,
                p99_ns: stats.p99_ns,
                min_ns,
                max_ns,
                recent_avg_ns: stats.recent_avg_ns,
                sample_count: stats.sample_count as u32,
            }
        });
        
        Ok(stats)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_avg_latency(&self, venue_id: String) -> napi::Result<Option<f64>> {
        Ok(self.inner.get_avg_latency(&venue_id))
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_p99_latency(&self, venue_id: String) -> napi::Result<Option<f64>> {
        Ok(self.inner.get_p99_latency(&venue_id))
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_recent_avg_latency(&self, venue_id: String) -> napi::Result<Option<f64>> {
        Ok(self.inner.get_recent_avg_latency(&venue_id))
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn reset(&self, venue_id: String) -> napi::Result<()> {
        self.inner.reset(&venue_id);
        Ok(())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn reset_all(&self) -> napi::Result<()> {
        self.inner.reset_all();
        Ok(())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_tracked_venues(&self) -> napi::Result<Vec<String>> {
        Ok(self.inner.get_tracked_venues())
    }
}

/// NAPI wrapper for SharedMemoryManager
#[cfg_attr(feature = "napi", napi(js_name = "SharedMemoryManager"))]
pub struct NapiSharedMemoryManager {
    inner: Arc<SharedMemoryManager>,
}

/// NAPI wrapper for buffer configuration
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct BufferConfigParams {
    pub capacity: usize,
    pub buffer_type: String,
    pub allow_overwrites: bool,
    pub auto_compact: bool,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiSharedMemoryManager {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new() -> Self {
        Self {
            inner: crate::shared_memory::create_shared_memory_manager(),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn create_market_data_buffer(&self, name: String, config: BufferConfigParams) -> napi::Result<bool> {
        let buffer_type = match config.buffer_type.as_str() {
            "MarketData" => BufferType::MarketData,
            "OrderBookDeltas" => BufferType::OrderBookDeltas,
            "OrderEvents" => BufferType::OrderEvents,
            "TradeEvents" => BufferType::TradeEvents,
            "LatencyMetrics" => BufferType::LatencyMetrics,
            "StrategyStates" => BufferType::StrategyStates,
            "RiskStates" => BufferType::RiskStates,
            _ => BufferType::Custom(0),
        };

        let buffer_config = BufferConfig {
            capacity: config.capacity,
            buffer_type,
            allow_overwrites: config.allow_overwrites,
            auto_compact: config.auto_compact,
        };

        // Create a buffer for JSON-serializable market data
        self.inner.create_buffer::<serde_json::Value>(&name, buffer_config);
        Ok(true)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn push_market_data(&self, buffer_name: String, data: serde_json::Value) -> napi::Result<i64> {
        let buffer = match self.inner.get_buffer::<serde_json::Value>(&buffer_name) {
            Some(buf) => buf,
            None => return Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Buffer not found: {}", buffer_name),
            )),
        };

        let sequence = buffer.push(data);
        Ok(sequence as i64)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn push_market_data_batch(&self, buffer_name: String, data_batch: Vec<serde_json::Value>) -> napi::Result<Vec<i64>> {
        let buffer = match self.inner.get_buffer::<serde_json::Value>(&buffer_name) {
            Some(buf) => buf,
            None => return Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Buffer not found: {}", buffer_name),
            )),
        };

        let sequences = buffer.push_batch(data_batch);
        Ok(sequences.into_iter().map(|seq| seq as i64).collect())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_recent_market_data(&self, buffer_name: String, limit: u32) -> napi::Result<Vec<serde_json::Value>> {
        let buffer = match self.inner.get_buffer::<serde_json::Value>(&buffer_name) {
            Some(buf) => buf,
            None => return Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Buffer not found: {}", buffer_name),
            )),
        };

        let events = buffer.get_recent(limit as usize);
        let result: Vec<serde_json::Value> = events.into_iter().map(|event| event.data).collect();
        Ok(result)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_market_data_after_sequence(&self, buffer_name: String, sequence: i64) -> napi::Result<Vec<serde_json::Value>> {
        let buffer = match self.inner.get_buffer::<serde_json::Value>(&buffer_name) {
            Some(buf) => buf,
            None => return Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Buffer not found: {}", buffer_name),
            )),
        };

        let events = buffer.get_after_sequence(sequence as u64);
        let result: Vec<serde_json::Value> = events.into_iter().map(|event| event.data).collect();
        Ok(result)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_market_data_after_timestamp(&self, buffer_name: String, timestamp: i64) -> napi::Result<Vec<serde_json::Value>> {
        let buffer = match self.inner.get_buffer::<serde_json::Value>(&buffer_name) {
            Some(buf) => buf,
            None => return Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Buffer not found: {}", buffer_name),
            )),
        };

        let events = buffer.get_after_timestamp(timestamp as u64);
        let result: Vec<serde_json::Value> = events.into_iter().map(|event| event.data).collect();
        Ok(result)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn clear_buffer(&self, buffer_name: String) -> napi::Result<bool> {
        let buffer = match self.inner.get_buffer::<serde_json::Value>(&buffer_name) {
            Some(buf) => buf,
            None => return Err(napi::Error::new(
                napi::Status::GenericFailure,
                format!("Buffer not found: {}", buffer_name),
            )),
        };

        buffer.clear();
        Ok(true)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn list_buffers(&self) -> napi::Result<Vec<String>> {
        Ok(self.inner.list_buffers())
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn remove_buffer(&self, buffer_name: String) -> napi::Result<bool> {
        Ok(self.inner.remove_buffer(&buffer_name))
    }
}

/// NAPI wrapper for batch processing
#[cfg_attr(feature = "napi", napi(js_name = "BatchProcessor"))]
pub struct NapiBatchProcessor {
    inner: Arc<BatchProcessor<serde_json::Value, serde_json::Value>>,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiBatchProcessor {
    #[cfg_attr(feature = "napi", napi(factory))]
    pub fn create(processor_callback: napi::JsFunction, max_batch_size: Option<u32>) -> napi::Result<Self> {
        let env = processor_callback.env;
        
        let callback = Arc::new(move |batch: Vec<serde_json::Value>| -> BatchResult<serde_json::Value> {
            let this = env.get_undefined().unwrap();
            
            // Convert the batch to a JS array
            let js_batch = env.create_array(batch.len() as u32).unwrap();
            for (i, item) in batch.iter().enumerate() {
                let js_item = env.to_js_value(&item).unwrap();
                js_batch.set_element(i as u32, js_item).unwrap();
            }
            
            let args = &[js_batch.into_unknown()];
            
            match processor_callback.call(Some(&this), args) {
                Ok(result) => {
                    // Try to convert the result back to our BatchResult structure
                    let result_obj = result.coerce_to_object().unwrap();
                    
                    let mut successes = Vec::new();
                    let mut failures = Vec::new();
                    let mut total_time_us: u64 = 0;
                    
                    // Extract successes
                    if let Ok(js_successes) = result_obj.get_named_property::<napi::JsObject>("successes") {
                        if let Ok(js_array) = js_successes.coerce_to_array() {
                            let length = js_array.get_array_length().unwrap_or(0);
                            for i in 0..length {
                                if let Ok(item) = js_array.get_element(i) {
                                    if let Ok(item_value) = env.from_js_value(item) {
                                        successes.push(item_value);
                                    }
                                }
                            }
                        }
                    }
                    
                    // Extract failures
                    if let Ok(js_failures) = result_obj.get_named_property::<napi::JsObject>("failures") {
                        if let Ok(js_array) = js_failures.coerce_to_array() {
                            let length = js_array.get_array_length().unwrap_or(0);
                            for i in 0..length {
                                if let Ok(item) = js_array.get_element(i) {
                                    if let Ok(item_obj) = item.coerce_to_object() {
                                        if let (Ok(value), Ok(error)) = (
                                            item_obj.get_named_property::<napi::JsUnknown>("value"),
                                            item_obj.get_named_property::<napi::JsString>("error")
                                        ) {
                                            if let (Ok(value_json), Ok(error_str)) = (
                                                env.from_js_value::<serde_json::Value>(value),
                                                error.into_utf8()
                                            ) {
                                                failures.push((value_json, error_str.as_str()?.to_string()));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Extract timing
                    if let Ok(js_time) = result_obj.get_named_property::<napi::JsNumber>("total_time_us") {
                        if let Ok(time) = js_time.get_int64() {
                            total_time_us = time as u64;
                        }
                    }
                    
                    BatchResult {
                        successes,
                        failures,
                        total_time_us,
                    }
                },
                Err(_) => {
                    // Return empty result on error
                    BatchResult {
                        successes: Vec::new(),
                        failures: batch.into_iter().map(|item| (item, "Callback processing failed".to_string())).collect(),
                        total_time_us: 0,
                    }
                }
            }
        });
        
        let batch_size = max_batch_size.unwrap_or(100) as usize;
        let processor = BatchProcessor::new(move |items| callback(items))
            .with_max_batch_size(batch_size);
        
        Ok(Self {
            inner: Arc::new(processor),
        })
    }
    
    #[cfg_attr(feature = "napi", napi)]
    pub fn add_item(&self, item: serde_json::Value) -> napi::Result<bool> {
        Ok(self.inner.add_item(item))
    }
    
    #[cfg_attr(feature = "napi", napi)]
    pub fn process_batch(&self) -> napi::Result<serde_json::Value> {
        let result = self.inner.process_batch();
        
        // Convert the result to a JS-friendly format
        let result_json = serde_json::json!({
            "successes": result.successes,
            "failures": result.failures.into_iter().map(|(value, error)| {
                serde_json::json!({
                    "value": value,
                    "error": error
                })
            }).collect::<Vec<_>>(),
            "total_time_us": result.total_time_us
        });
        
        Ok(result_json)
    }
    
    #[cfg_attr(feature = "napi", napi)]
    pub fn pending_count(&self) -> napi::Result<u32> {
        Ok(self.inner.pending_count() as u32)
    }
    
    #[cfg_attr(feature = "napi", napi)]
    pub fn clear_pending(&self) -> napi::Result<()> {
        self.inner.clear_pending();
        Ok(())
    }
}

// NAPI wrapper for OrderBookManager
#[cfg_attr(feature = "napi", napi(js_name = "OrderBookManager"))]
pub struct NapiOrderBookManager {
    inner: Arc<OrderBookManager>,
}

/// NAPI wrapper for OrderSide
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub enum NapiOrderSide {
    Bid,
    Ask,
}

/// NAPI wrapper for PriceLevel
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub struct NapiPriceLevel {
    pub price: f64,
    pub size: f64,
    pub order_count: u32,
    pub timestamp: i64,
}

/// NAPI wrapper for UpdateType
#[cfg_attr(feature = "napi", napi)]
#[derive(Serialize, Deserialize)]
pub enum NapiUpdateType {
    New,
    Update,
    Delete,
}

#[cfg_attr(feature = "napi", napi)]
impl NapiOrderBookManager {
    #[cfg_attr(feature = "napi", napi(constructor))]
    pub fn new() -> Self {
        Self {
            inner: crate::orderbook::create_order_book_manager(),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn process_update(&self, symbol: String, price: f64, size: f64, side: NapiOrderSide, update_id: u64) -> i32 {
        let side = match side {
            NapiOrderSide::Bid => crate::orderbook::OrderSide::Bid,
            NapiOrderSide::Ask => crate::orderbook::OrderSide::Ask,
        };

        let result = self.inner.process_update(&symbol, price, size, side, update_id);
        
        match result {
            crate::orderbook::UpdateType::New => 0,
            crate::orderbook::UpdateType::Update => 1,
            crate::orderbook::UpdateType::Delete => 2,
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn process_updates(&self, symbol: String, updates: Vec<(f64, f64, i32, u64)>) -> Vec<i32> {
        let mut native_updates = Vec::with_capacity(updates.len());
        
        for (price, size, side_int, update_id) in updates {
            let side = if side_int == 0 {
                crate::orderbook::OrderSide::Bid
            } else {
                crate::orderbook::OrderSide::Ask
            };
            
            native_updates.push((price, size, side, update_id));
        }
        
        let results = self.inner.process_updates(&symbol, native_updates);
        
        results.into_iter().map(|result| {
            match result {
                crate::orderbook::UpdateType::New => 0,
                crate::orderbook::UpdateType::Update => 1,
                crate::orderbook::UpdateType::Delete => 2,
            }
        }).collect()
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_snapshot(&self, symbol: String, depth: u32) -> napi::Result<Option<(Vec<NapiPriceLevel>, Vec<NapiPriceLevel>)>> {
        let snapshot = self.inner.get_snapshot(&symbol, depth as usize);
        
        match snapshot {
            Some((bids, asks)) => {
                let napi_bids = bids.into_iter().map(|level| {
                    NapiPriceLevel {
                        price: level.price,
                        size: level.size,
                        order_count: level.order_count as u32,
                        timestamp: level.timestamp as i64,
                    }
                }).collect();
                
                let napi_asks = asks.into_iter().map(|level| {
                    NapiPriceLevel {
                        price: level.price,
                        size: level.size,
                        order_count: level.order_count as u32,
                        timestamp: level.timestamp as i64,
                    }
                }).collect();
                
                Ok(Some((napi_bids, napi_asks)))
            },
            None => Ok(None),
        }
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_mid_price(&self, symbol: String) -> Option<f64> {
        self.inner.get_mid_price(&symbol)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn calculate_imbalance(&self, symbol: String, depth: u32) -> Option<f64> {
        self.inner.calculate_imbalance(&symbol, depth as usize)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn get_vwap(&self, symbol: String, size: f64, side: NapiOrderSide) -> Option<f64> {
        let side = match side {
            NapiOrderSide::Bid => crate::orderbook::OrderSide::Bid,
            NapiOrderSide::Ask => crate::orderbook::OrderSide::Ask,
        };
        
        self.inner.get_vwap(&symbol, size, side)
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn list_symbols(&self) -> Vec<String> {
        self.inner.list_symbols()
    }

    #[cfg_attr(feature = "napi", napi)]
    pub fn remove_order_book(&self, symbol: String) -> bool {
        self.inner.remove_order_book(&symbol)
    }
}

// ==================== StrategyEngine NAPI Bindings ====================

/// NAPI config parameters for StrategyEngine
#[napi_derive::napi(object)]
pub struct StrategyEngineConfigParams {
    /// Whether to execute signals in dryrun mode (no real orders)
    #[napi(ts_type = "boolean")]
    pub dryrun_mode: bool,
    
    /// Whether to apply risk checks
    #[napi(ts_type = "boolean")]
    pub apply_risk_checks: bool,
    
    /// Minimum trust score required for automatic execution (0.0-1.0)
    #[napi(ts_type = "number")]
    pub min_trust_score: f64,
    
    /// Default execution horizon if not specified
    #[napi(ts_type = "number")]
    pub default_execution_horizon: u32,
    
    /// Default risk grade if not specified
    #[napi(ts_type = "number")]
    pub default_risk_grade: u32,
    
    /// Whether to apply confidence-based position sizing
    #[napi(ts_type = "boolean")]
    pub confidence_based_sizing: bool,
    
    /// Whether to require signals to have explicit price
    #[napi(ts_type = "boolean")]
    pub require_price: bool,
    
    /// Maximum allowed slippage percentage
    #[napi(ts_type = "number")]
    pub max_slippage_pct: f64,
    
    /// Engine mode (0 = sync, 1 = async)
    #[napi(ts_type = "number")]
    pub engine_mode: u32,
    
    /// Whether to enforce latency budgets
    #[napi(ts_type = "boolean")]
    pub enforce_latency_budgets: bool,
}

/// NAPI struct for SignalEvaluation results
#[napi_derive::napi(object)]
pub struct SignalEvaluationParams {
    /// Signal ID
    #[napi(ts_type = "string")]
    pub signal_id: String,
    
    /// Whether the signal passed evaluation
    #[napi(ts_type = "boolean")]
    pub passed: bool,
    
    /// Execution probability (0.0-1.0)
    #[napi(ts_type = "number")]
    pub execution_probability: f64,
    
    /// Expected impact score (0.0-1.0, higher means more impact)
    #[napi(ts_type = "number")]
    pub expected_impact: f64,
    
    /// Expected slippage percentage
    #[napi(ts_type = "number")]
    pub expected_slippage_pct: f64,
    
    /// Trust score (0.0-1.0)
    #[napi(ts_type = "number")]
    pub trust_score: f64,
    
    /// Whether the signal is latency critical
    #[napi(ts_type = "boolean")]
    pub is_latency_critical: bool,
    
    /// Recommended position size as percentage of available capital
    #[napi(ts_type = "number")]
    pub recommended_position_size_pct: f64,
    
    /// Latency budget in milliseconds
    #[napi(ts_type = "number")]
    pub latency_budget_ms: u64,
    
    /// Timestamp of evaluation in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub timestamp: u64,
    
    /// Any risk violations (serialized as JSON)
    #[napi(ts_type = "string")]
    pub risk_violations: String,
}

/// NAPI struct for Signal Metrics
#[napi_derive::napi(object)]
pub struct SignalMetricsParams {
    /// Signal ID
    #[napi(ts_type = "string")]
    pub signal_id: String,
    
    /// Strategy ID
    #[napi(ts_type = "string")]
    pub strategy_id: String,
    
    /// Symbol
    #[napi(ts_type = "string")]
    pub symbol: String,
    
    /// Signal generation time in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub generation_time: u64,
    
    /// Signal execution time in milliseconds since epoch (if executed)
    #[napi(ts_type = "number | null")]
    pub execution_time: Option<u64>,
    
    /// Latency from generation to execution in milliseconds
    #[napi(ts_type = "number | null")]
    pub execution_latency_ms: Option<u64>,
    
    /// Signal confidence
    #[napi(ts_type = "number")]
    pub confidence: f64,
    
    /// Signal strength
    #[napi(ts_type = "number")]
    pub strength: f64,
    
    /// Execution success (true if successfully executed)
    #[napi(ts_type = "boolean")]
    pub success: bool,
    
    /// Order price
    #[napi(ts_type = "number | null")]
    pub price: Option<f64>,
    
    /// Actual execution price (if executed)
    #[napi(ts_type = "number | null")]
    pub execution_price: Option<f64>,
    
    /// Slippage percentage (positive means worse than expected)
    #[napi(ts_type = "number | null")]
    pub slippage_pct: Option<f64>,
    
    /// Position direction (0 = none, 1 = long, 2 = short)
    #[napi(ts_type = "number")]
    pub direction: u32,
    
    /// Position size
    #[napi(ts_type = "number | null")]
    pub position_size: Option<f64>,
    
    /// Trust score
    #[napi(ts_type = "number | null")]
    pub trust_score: Option<f64>,
    
    /// Execution status 
    #[napi(ts_type = "number")]
    pub status: u32,
    
    /// Risk grade
    #[napi(ts_type = "number")]
    pub risk_grade: u32,
    
    /// Execution horizon
    #[napi(ts_type = "number")]
    pub execution_horizon: u32,
    
    /// PnL if known
    #[napi(ts_type = "number | null")]
    pub pnl: Option<f64>,
    
    /// Additional metrics (serialized as JSON)
    #[napi(ts_type = "string")]
    pub additional_metrics: String,
}

/// NAPI wrapper for StrategyEngine
#[napi_derive::napi]
pub struct NapiStrategyEngine {
    strategy_engine: Arc<StrategyEngine>,
}

#[napi_derive::napi]
impl NapiStrategyEngine {
    /// Create a new NapiStrategyEngine instance
    #[napi(constructor)]
    pub fn new(
        router: &NapiSmartOrderRouter,
        risk_calculator: &NapiRiskCalculator,
        config: Option<StrategyEngineConfigParams>,
    ) -> Self {
        let engine_config = config.map(|c| StrategyEngineConfig {
            dryrun_mode: c.dryrun_mode,
            apply_risk_checks: c.apply_risk_checks,
            min_trust_score: c.min_trust_score,
            default_execution_horizon: match c.default_execution_horizon {
                0 => ExecutionHorizon::Immediate,
                1 => ExecutionHorizon::ShortTerm,
                2 => ExecutionHorizon::MediumTerm,
                3 => ExecutionHorizon::LongTerm,
                _ => ExecutionHorizon::ShortTerm,
            },
            default_risk_grade: match c.default_risk_grade {
                0 => RiskGrade::Low,
                1 => RiskGrade::Medium,
                2 => RiskGrade::High,
                3 => RiskGrade::Exceptional,
                _ => RiskGrade::Medium,
            },
            confidence_based_sizing: c.confidence_based_sizing,
            require_price: c.require_price,
            max_slippage_pct: c.max_slippage_pct,
            engine_mode: if c.engine_mode == 0 { StrategyEngineMode::Sync } else { StrategyEngineMode::Async },
            enforce_latency_budgets: c.enforce_latency_budgets,
        });
        
        Self {
            strategy_engine: create_strategy_engine(
                router.get_internal(),
                risk_calculator.get_internal(),
                engine_config,
            ),
        }
    }
    
    /// Create a static instance of NapiStrategyEngine
    #[napi]
    pub fn create(
        router: &NapiSmartOrderRouter,
        risk_calculator: &NapiRiskCalculator,
        config: Option<StrategyEngineConfigParams>,
    ) -> Self {
        Self::new(router, risk_calculator, config)
    }
    
    /// Execute a strategy based on a signal
    #[napi]
    pub async fn execute_strategy(
        &self,
        signal_id: String,
        strategy_id: String,
        symbol: String,
        action: u32,
        direction: u32,
        confidence: f64,
        strength: f64,
        price: Option<f64>,
        quantity: Option<f64>,
        timestamp: u64,
        expiration: Option<u64>,
        metadata: Option<String>,
        risk_grade: Option<u32>,
        execution_horizon: Option<u32>,
    ) -> napi::Result<String> {
        // Convert action to SignalAction
        let signal_action = match action {
            0 => SignalAction::Enter,
            1 => SignalAction::Exit,
            2 => SignalAction::Hold,
            _ => return Err(napi::Error::from_reason("Invalid action value")),
        };
        
        // Convert direction to PositionDirection
        let position_direction = match direction {
            0 => PositionDirection::None,
            1 => PositionDirection::Long,
            2 => PositionDirection::Short,
            _ => return Err(napi::Error::from_reason("Invalid direction value")),
        };
        
        // Convert timestamp to DateTime<Utc>
        let signal_timestamp = chrono::DateTime::<Utc>::from_utc(
            chrono::NaiveDateTime::from_timestamp_millis(timestamp as i64)
                .ok_or_else(|| napi::Error::from_reason("Invalid timestamp"))?,
            Utc,
        );
        
        // Convert expiration to DateTime<Utc> if provided
        let signal_expiration = expiration.map(|exp| {
            chrono::DateTime::<Utc>::from_utc(
                chrono::NaiveDateTime::from_timestamp_millis(exp as i64)
                    .unwrap_or_default(),
                Utc,
            )
        });
        
        // Parse metadata if provided
        let signal_metadata = metadata.map(|meta| {
            serde_json::from_str::<HashMap<String, String>>(&meta)
                .unwrap_or_default()
        });
        
        // Create signal
        let mut signal = Signal::new(
            strategy_id,
            symbol,
            signal_action,
        )
        .with_direction(position_direction)
        .with_confidence(confidence)
        .with_strength(strength);
        
        // Set ID to provided ID
        signal.id = signal_id;
        
        // Set timestamp
        signal.timestamp = signal_timestamp;
        
        // Set optional fields
        if let Some(p) = price {
            signal = signal.with_price(p);
        }
        
        if let Some(q) = quantity {
            signal = signal.with_quantity(q);
        }
        
        if let Some(exp) = signal_expiration {
            signal = signal.with_expiration(exp);
        }
        
        if let Some(meta) = signal_metadata {
            for (key, value) in meta {
                signal = signal.with_metadata(&key, &value);
            }
        }
        
        // Set risk grade if provided
        if let Some(grade) = risk_grade {
            let risk_grade = match grade {
                0 => RiskGrade::Low,
                1 => RiskGrade::Medium,
                2 => RiskGrade::High,
                3 => RiskGrade::Exceptional,
                _ => RiskGrade::Medium,
            };
            signal = signal.with_risk_grade(risk_grade);
        }
        
        // Set execution horizon if provided
        if let Some(horizon) = execution_horizon {
            let exec_horizon = match horizon {
                0 => ExecutionHorizon::Immediate,
                1 => ExecutionHorizon::ShortTerm,
                2 => ExecutionHorizon::MediumTerm,
                3 => ExecutionHorizon::LongTerm,
                _ => ExecutionHorizon::ShortTerm,
            };
            signal = signal.with_execution_horizon(exec_horizon);
        }
        
        // Execute strategy
        match self.strategy_engine.execute_strategy(&signal).await {
            Ok(result) => Ok(serde_json::to_string(&result)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize result: {}", e)))?),
            Err(err) => Err(napi::Error::from_reason(format!("Strategy execution failed: {}", err))),
        }
    }
    
    /// Evaluate a signal
    #[napi]
    pub async fn evaluate_signal(
        &self,
        signal_id: String,
        strategy_id: String,
        symbol: String,
        action: u32,
        direction: u32,
        confidence: f64,
        strength: f64,
        price: Option<f64>,
        timestamp: u64,
        risk_grade: Option<u32>,
        execution_horizon: Option<u32>,
    ) -> napi::Result<SignalEvaluationParams> {
        // Convert action to SignalAction
        let signal_action = match action {
            0 => SignalAction::Enter,
            1 => SignalAction::Exit,
            2 => SignalAction::Hold,
            _ => return Err(napi::Error::from_reason("Invalid action value")),
        };
        
        // Convert direction to PositionDirection
        let position_direction = match direction {
            0 => PositionDirection::None,
            1 => PositionDirection::Long,
            2 => PositionDirection::Short,
            _ => return Err(napi::Error::from_reason("Invalid direction value")),
        };
        
        // Convert timestamp to DateTime<Utc>
        let signal_timestamp = chrono::DateTime::<Utc>::from_utc(
            chrono::NaiveDateTime::from_timestamp_millis(timestamp as i64)
                .ok_or_else(|| napi::Error::from_reason("Invalid timestamp"))?,
            Utc,
        );
        
        // Create signal
        let mut signal = Signal::new(
            strategy_id,
            symbol,
            signal_action,
        )
        .with_direction(position_direction)
        .with_confidence(confidence)
        .with_strength(strength);
        
        // Set ID to provided ID
        signal.id = signal_id;
        
        // Set timestamp
        signal.timestamp = signal_timestamp;
        
        // Set optional fields
        if let Some(p) = price {
            signal = signal.with_price(p);
        }
        
        // Set risk grade if provided
        if let Some(grade) = risk_grade {
            let risk_grade = match grade {
                0 => RiskGrade::Low,
                1 => RiskGrade::Medium,
                2 => RiskGrade::High,
                3 => RiskGrade::Exceptional,
                _ => RiskGrade::Medium,
            };
            signal = signal.with_risk_grade(risk_grade);
        }
        
        // Set execution horizon if provided
        if let Some(horizon) = execution_horizon {
            let exec_horizon = match horizon {
                0 => ExecutionHorizon::Immediate,
                1 => ExecutionHorizon::ShortTerm,
                2 => ExecutionHorizon::MediumTerm,
                3 => ExecutionHorizon::LongTerm,
                _ => ExecutionHorizon::ShortTerm,
            };
            signal = signal.with_execution_horizon(exec_horizon);
        }
        
        // Evaluate signal
        match self.strategy_engine.evaluate_signal(&signal).await {
            Ok(evaluation) => {
                // Convert to NAPI struct
                let risk_violations_json = serde_json::to_string(&evaluation.risk_violations)
                    .unwrap_or_else(|_| "[]".to_string());
                
                Ok(SignalEvaluationParams {
                    signal_id: evaluation.signal_id,
                    passed: evaluation.passed,
                    execution_probability: evaluation.execution_probability,
                    expected_impact: evaluation.expected_impact,
                    expected_slippage_pct: evaluation.expected_slippage_pct,
                    trust_score: evaluation.trust_score,
                    is_latency_critical: evaluation.is_latency_critical,
                    recommended_position_size_pct: evaluation.recommended_position_size_pct,
                    latency_budget_ms: evaluation.latency_budget_ms,
                    timestamp: evaluation.timestamp.timestamp_millis() as u64,
                    risk_violations: risk_violations_json,
                })
            },
            Err(err) => Err(napi::Error::from_reason(format!("Signal evaluation failed: {}", err))),
        }
    }
    
    /// Calculate signal metrics
    #[napi]
    pub fn calculate_signal_metrics(
        &self,
        signal_id: String,
        strategy_id: String,
        symbol: String,
        action: u32,
        direction: u32,
        confidence: f64,
        strength: f64,
        price: Option<f64>,
        timestamp: u64,
        execution_result_json: Option<String>,
    ) -> napi::Result<SignalMetricsParams> {
        // Convert action to SignalAction
        let signal_action = match action {
            0 => SignalAction::Enter,
            1 => SignalAction::Exit,
            2 => SignalAction::Hold,
            _ => return Err(napi::Error::from_reason("Invalid action value")),
        };
        
        // Convert direction to PositionDirection
        let position_direction = match direction {
            0 => PositionDirection::None,
            1 => PositionDirection::Long,
            2 => PositionDirection::Short,
            _ => return Err(napi::Error::from_reason("Invalid direction value")),
        };
        
        // Convert timestamp to DateTime<Utc>
        let signal_timestamp = chrono::DateTime::<Utc>::from_utc(
            chrono::NaiveDateTime::from_timestamp_millis(timestamp as i64)
                .ok_or_else(|| napi::Error::from_reason("Invalid timestamp"))?,
            Utc,
        );
        
        // Create signal
        let mut signal = Signal::new(
            strategy_id,
            symbol,
            signal_action,
        )
        .with_direction(position_direction)
        .with_confidence(confidence)
        .with_strength(strength);
        
        // Set ID to provided ID
        signal.id = signal_id;
        
        // Set timestamp
        signal.timestamp = signal_timestamp;
        
        // Set optional fields
        if let Some(p) = price {
            signal = signal.with_price(p);
        }
        
        // Parse execution result if provided
        let execution_result = execution_result_json.map(|json| {
            serde_json::from_str::<ExecutionResult>(&json)
                .map_err(|e| {
                    warn!("Failed to parse execution result: {}", e);
                    None
                })
                .ok()
        }).flatten();
        
        // Calculate metrics
        let metrics = self.strategy_engine.calculate_signal_metrics(&signal, execution_result.as_ref());
        
        // Convert additional metrics to JSON
        let additional_metrics_json = serde_json::to_string(&metrics.additional_metrics)
            .unwrap_or_else(|_| "{}".to_string());
        
        // Convert to NAPI struct
        let execution_time = metrics.execution_time
            .map(|time| time.timestamp_millis() as u64);
        
        // Convert direction to u32
        let direction_u32 = match metrics.direction {
            PositionDirection::None => 0,
            PositionDirection::Long => 1,
            PositionDirection::Short => 2,
        };
        
        // Convert status to u32
        let status_u32 = match metrics.status {
            SignalStatus::Created => 0,
            SignalStatus::Validated => 1,
            SignalStatus::Rejected => 2,
            SignalStatus::Executed => 3,
            SignalStatus::Failed => 4,
            SignalStatus::InProgress => 5,
            SignalStatus::Expired => 6,
            SignalStatus::ReadyForExecution => 7,
            SignalStatus::TrustBlocked => 8,
            SignalStatus::AwaitingMarketConditions => 9,
        };
        
        // Convert risk grade to u32
        let risk_grade_u32 = match metrics.risk_grade {
            RiskGrade::Low => 0,
            RiskGrade::Medium => 1,
            RiskGrade::High => 2,
            RiskGrade::Exceptional => 3,
        };
        
        // Convert execution horizon to u32
        let execution_horizon_u32 = match metrics.execution_horizon {
            ExecutionHorizon::Immediate => 0,
            ExecutionHorizon::ShortTerm => 1,
            ExecutionHorizon::MediumTerm => 2,
            ExecutionHorizon::LongTerm => 3,
        };
        
        Ok(SignalMetricsParams {
            signal_id: metrics.signal_id,
            strategy_id: metrics.strategy_id,
            symbol: metrics.symbol,
            generation_time: metrics.generation_time.timestamp_millis() as u64,
            execution_time,
            execution_latency_ms: metrics.execution_latency_ms,
            confidence: metrics.confidence,
            strength: metrics.strength,
            success: metrics.success,
            price: metrics.price,
            execution_price: metrics.execution_price,
            slippage_pct: metrics.slippage_pct,
            direction: direction_u32,
            position_size: metrics.position_size,
            trust_score: metrics.trust_score,
            status: status_u32,
            risk_grade: risk_grade_u32,
            execution_horizon: execution_horizon_u32,
            pnl: metrics.pnl,
            additional_metrics: additional_metrics_json,
        })
    }
    
    /// Get stored metrics for a signal
    #[napi]
    pub fn get_signal_metrics(&self, signal_id: String) -> Option<SignalMetricsParams> {
        let metrics = self.strategy_engine.get_signal_metrics(&signal_id)?;
        
        // Convert additional metrics to JSON
        let additional_metrics_json = serde_json::to_string(&metrics.additional_metrics)
            .unwrap_or_else(|_| "{}".to_string());
        
        // Convert to NAPI struct
        let execution_time = metrics.execution_time
            .map(|time| time.timestamp_millis() as u64);
        
        // Convert direction to u32
        let direction_u32 = match metrics.direction {
            PositionDirection::None => 0,
            PositionDirection::Long => 1,
            PositionDirection::Short => 2,
        };
        
        // Convert status to u32
        let status_u32 = match metrics.status {
            SignalStatus::Created => 0,
            SignalStatus::Validated => 1,
            SignalStatus::Rejected => 2,
            SignalStatus::Executed => 3,
            SignalStatus::Failed => 4,
            SignalStatus::InProgress => 5,
            SignalStatus::Expired => 6,
            SignalStatus::ReadyForExecution => 7,
            SignalStatus::TrustBlocked => 8,
            SignalStatus::AwaitingMarketConditions => 9,
        };
        
        // Convert risk grade to u32
        let risk_grade_u32 = match metrics.risk_grade {
            RiskGrade::Low => 0,
            RiskGrade::Medium => 1,
            RiskGrade::High => 2,
            RiskGrade::Exceptional => 3,
        };
        
        // Convert execution horizon to u32
        let execution_horizon_u32 = match metrics.execution_horizon {
            ExecutionHorizon::Immediate => 0,
            ExecutionHorizon::ShortTerm => 1,
            ExecutionHorizon::MediumTerm => 2,
            ExecutionHorizon::LongTerm => 3,
        };
        
        Some(SignalMetricsParams {
            signal_id: metrics.signal_id,
            strategy_id: metrics.strategy_id,
            symbol: metrics.symbol,
            generation_time: metrics.generation_time.timestamp_millis() as u64,
            execution_time,
            execution_latency_ms: metrics.execution_latency_ms,
            confidence: metrics.confidence,
            strength: metrics.strength,
            success: metrics.success,
            price: metrics.price,
            execution_price: metrics.execution_price,
            slippage_pct: metrics.slippage_pct,
            direction: direction_u32,
            position_size: metrics.position_size,
            trust_score: metrics.trust_score,
            status: status_u32,
            risk_grade: risk_grade_u32,
            execution_horizon: execution_horizon_u32,
            pnl: metrics.pnl,
            additional_metrics: additional_metrics_json,
        })
    }
    
    /// Update configuration
    #[napi]
    pub fn update_config(&self, config: StrategyEngineConfigParams) -> bool {
        let engine_config = StrategyEngineConfig {
            dryrun_mode: config.dryrun_mode,
            apply_risk_checks: config.apply_risk_checks,
            min_trust_score: config.min_trust_score,
            default_execution_horizon: match config.default_execution_horizon {
                0 => ExecutionHorizon::Immediate,
                1 => ExecutionHorizon::ShortTerm,
                2 => ExecutionHorizon::MediumTerm,
                3 => ExecutionHorizon::LongTerm,
                _ => ExecutionHorizon::ShortTerm,
            },
            default_risk_grade: match config.default_risk_grade {
                0 => RiskGrade::Low,
                1 => RiskGrade::Medium,
                2 => RiskGrade::High,
                3 => RiskGrade::Exceptional,
                _ => RiskGrade::Medium,
            },
            confidence_based_sizing: config.confidence_based_sizing,
            require_price: config.require_price,
            max_slippage_pct: config.max_slippage_pct,
            engine_mode: if config.engine_mode == 0 { StrategyEngineMode::Sync } else { StrategyEngineMode::Async },
            enforce_latency_budgets: config.enforce_latency_budgets,
        };
        
        self.strategy_engine.update_config(engine_config);
        true
    }
    
    /// Get the current configuration
    #[napi]
    pub fn get_config(&self) -> StrategyEngineConfigParams {
        let config = self.strategy_engine.get_config();
        
        StrategyEngineConfigParams {
            dryrun_mode: config.dryrun_mode,
            apply_risk_checks: config.apply_risk_checks,
            min_trust_score: config.min_trust_score,
            default_execution_horizon: match config.default_execution_horizon {
                ExecutionHorizon::Immediate => 0,
                ExecutionHorizon::ShortTerm => 1,
                ExecutionHorizon::MediumTerm => 2,
                ExecutionHorizon::LongTerm => 3,
            },
            default_risk_grade: match config.default_risk_grade {
                RiskGrade::Low => 0,
                RiskGrade::Medium => 1,
                RiskGrade::High => 2,
                RiskGrade::Exceptional => 3,
            },
            confidence_based_sizing: config.confidence_based_sizing,
            require_price: config.require_price,
            max_slippage_pct: config.max_slippage_pct,
            engine_mode: match config.engine_mode {
                StrategyEngineMode::Sync => 0,
                StrategyEngineMode::Async => 1,
            },
            enforce_latency_budgets: config.enforce_latency_budgets,
        }
    }
} 

// ==================== MarketDataProcessor NAPI Bindings ====================

/// NAPI config parameters for MarketDataProcessor
#[napi_derive::napi(object)]
pub struct MarketDataProcessorConfigParams {
    /// Maximum history size per symbol
    #[napi(ts_type = "number")]
    pub max_history_size: u32,
    
    /// Feature calculation interval in milliseconds
    #[napi(ts_type = "number")]
    pub feature_calculation_interval_ms: u64,
    
    /// Anomaly detection interval in milliseconds
    #[napi(ts_type = "number")]
    pub anomaly_detection_interval_ms: u64,
    
    /// RSI period
    #[napi(ts_type = "number")]
    pub rsi_period: u32,
    
    /// Bollinger bands period
    #[napi(ts_type = "number")]
    pub bb_period: u32,
    
    /// Bollinger bands standard deviation multiplier
    #[napi(ts_type = "number")]
    pub bb_std_dev: f64,
    
    /// MACD fast period
    #[napi(ts_type = "number")]
    pub macd_fast_period: u32,
    
    /// MACD slow period
    #[napi(ts_type = "number")]
    pub macd_slow_period: u32,
    
    /// MACD signal period
    #[napi(ts_type = "number")]
    pub macd_signal_period: u32,
    
    /// ATR period
    #[napi(ts_type = "number")]
    pub atr_period: u32,
    
    /// Volume ratio period
    #[napi(ts_type = "number")]
    pub volume_ratio_period: u32,
    
    /// Price spike detection threshold
    #[napi(ts_type = "number")]
    pub price_spike_threshold: f64,
    
    /// Volume spike detection threshold
    #[napi(ts_type = "number")]
    pub volume_spike_threshold: f64,
    
    /// Spread widening threshold
    #[napi(ts_type = "number")]
    pub spread_widening_threshold: f64,
}

/// NAPI struct for MarketTick
#[napi_derive::napi(object)]
pub struct MarketTickParams {
    /// Symbol
    #[napi(ts_type = "string")]
    pub symbol: String,
    
    /// Timestamp in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub timestamp: u64,
    
    /// Last price
    #[napi(ts_type = "number")]
    pub price: f64,
    
    /// Trading volume
    #[napi(ts_type = "number")]
    pub volume: f64,
    
    /// Bid price
    #[napi(ts_type = "number | null")]
    pub bid: Option<f64>,
    
    /// Ask price
    #[napi(ts_type = "number | null")]
    pub ask: Option<f64>,
    
    /// Additional custom fields
    #[napi(ts_type = "Record<string, number>")]
    pub fields: Option<serde_json::Value>,
}

/// NAPI struct for MarketFeatures
#[napi_derive::napi(object)]
pub struct MarketFeaturesParams {
    /// Symbol
    #[napi(ts_type = "string")]
    pub symbol: String,
    
    /// Timestamp in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub timestamp: u64,
    
    /// Last price
    #[napi(ts_type = "number")]
    pub price: f64,
    
    /// 1-minute return
    #[napi(ts_type = "number")]
    pub returns_1m: f64,
    
    /// 5-minute return
    #[napi(ts_type = "number")]
    pub returns_5m: f64,
    
    /// 15-minute return
    #[napi(ts_type = "number")]
    pub returns_15m: f64,
    
    /// 1-hour return
    #[napi(ts_type = "number")]
    pub returns_1h: f64,
    
    /// 4-hour return
    #[napi(ts_type = "number")]
    pub returns_4h: f64,
    
    /// 1-day return
    #[napi(ts_type = "number")]
    pub returns_1d: f64,
    
    /// RSI (14 period)
    #[napi(ts_type = "number")]
    pub rsi_14: f64,
    
    /// Bollinger bandwidth
    #[napi(ts_type = "number")]
    pub bb_width: f64,
    
    /// MACD line
    #[napi(ts_type = "number")]
    pub macd: f64,
    
    /// MACD signal
    #[napi(ts_type = "number")]
    pub macd_signal: f64,
    
    /// MACD histogram
    #[napi(ts_type = "number")]
    pub macd_hist: f64,
    
    /// Average true range
    #[napi(ts_type = "number")]
    pub atr: f64,
    
    /// Volume ratio
    #[napi(ts_type = "number")]
    pub volume_ratio: f64,
    
    /// On-balance volume
    #[napi(ts_type = "number")]
    pub obv: f64,
    
    /// Bid-ask spread
    #[napi(ts_type = "number | null")]
    pub spread: Option<f64>,
    
    /// Additional metrics
    #[napi(ts_type = "Record<string, number>")]
    pub additional_metrics: Option<serde_json::Value>,
}

/// NAPI struct for MarketAnomaly
#[napi_derive::napi(object)]
pub struct MarketAnomalyParams {
    /// Symbol
    #[napi(ts_type = "string")]
    pub symbol: String,
    
    /// Timestamp in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub timestamp: u64,
    
    /// Type of anomaly (0=PriceSpike, 1=VolumeSpike, 2=SpreadWidening, etc.)
    #[napi(ts_type = "number")]
    pub anomaly_type: u32,
    
    /// Severity score (0.0-1.0)
    #[napi(ts_type = "number")]
    pub severity: f64,
    
    /// Description
    #[napi(ts_type = "string")]
    pub description: String,
    
    /// Related metrics
    #[napi(ts_type = "Record<string, number>")]
    pub metrics: Option<serde_json::Value>,
}

/// NAPI wrapper for MarketDataProcessor
#[napi_derive::napi]
pub struct NapiMarketDataProcessor {
    market_data_processor: Arc<crate::market_data::MarketDataProcessor>,
}

#[napi_derive::napi]
impl NapiMarketDataProcessor {
    /// Create a new NapiMarketDataProcessor instance
    #[napi(constructor)]
    pub fn new(
        shared_memory_manager: Option<&NapiSharedMemoryManager>,
        config: Option<MarketDataProcessorConfigParams>,
    ) -> Self {
        // Convert config if provided
        let config_opt = config.map(|c| crate::market_data::MarketDataProcessorConfig {
            max_history_size: c.max_history_size as usize,
            feature_calculation_interval_ms: c.feature_calculation_interval_ms,
            anomaly_detection_interval_ms: c.anomaly_detection_interval_ms,
            rsi_period: c.rsi_period as usize,
            bb_period: c.bb_period as usize,
            bb_std_dev: c.bb_std_dev,
            macd_fast_period: c.macd_fast_period as usize,
            macd_slow_period: c.macd_slow_period as usize,
            macd_signal_period: c.macd_signal_period as usize,
            atr_period: c.atr_period as usize,
            volume_ratio_period: c.volume_ratio_period as usize,
            price_spike_threshold: c.price_spike_threshold,
            volume_spike_threshold: c.volume_spike_threshold,
            spread_widening_threshold: c.spread_widening_threshold,
        });
        
        match shared_memory_manager {
            Some(manager) => {
                Self {
                    market_data_processor: crate::market_data::create_market_data_processor_with_shared_memory(
                        manager.get_internal(),
                        config_opt,
                    ),
                }
            },
            None => {
                Self {
                    market_data_processor: match config_opt {
                        Some(cfg) => crate::market_data::create_market_data_processor_with_config(cfg),
                        None => crate::market_data::create_market_data_processor(),
                    },
                }
            }
        }
    }
    
    /// Process a market tick
    #[napi]
    pub fn process_tick(&self, tick: MarketTickParams) -> napi::Result<()> {
        // Convert timestamp to DateTime<Utc>
        let timestamp = chrono::DateTime::<chrono::Utc>::from_utc(
            chrono::NaiveDateTime::from_timestamp_millis(tick.timestamp as i64)
                .ok_or_else(|| napi::Error::from_reason("Invalid timestamp"))?,
            chrono::Utc,
        );
        
        // Convert fields
        let fields = match tick.fields {
            Some(fields_value) => {
                serde_json::from_value::<HashMap<String, f64>>(fields_value)
                    .map_err(|e| napi::Error::from_reason(format!("Invalid fields format: {}", e)))?
            },
            None => HashMap::new(),
        };
        
        // Create MarketTick
        let market_tick = crate::market_data::MarketTick {
            symbol: tick.symbol,
            timestamp,
            price: tick.price,
            volume: tick.volume,
            bid: tick.bid,
            ask: tick.ask,
            fields,
        };
        
        // Process tick
        match self.market_data_processor.process_tick(market_tick) {
            Ok(_) => Ok(()),
            Err(e) => Err(napi::Error::from_reason(format!("Failed to process tick: {}", e))),
        }
    }
    
    /// Calculate features for a symbol
    #[napi]
    pub fn calculate_features(&self, symbol: String) -> napi::Result<MarketFeaturesParams> {
        // Calculate features
        match self.market_data_processor.calculate_features(&symbol) {
            Ok(features) => {
                // Convert additional metrics to JSON
                let additional_metrics = serde_json::to_value(&features.additional_metrics)
                    .map_err(|e| napi::Error::from_reason(format!("Failed to serialize metrics: {}", e)))?;
                
                Ok(MarketFeaturesParams {
                    symbol: features.symbol,
                    timestamp: features.timestamp.timestamp_millis() as u64,
                    price: features.price,
                    returns_1m: features.returns_1m,
                    returns_5m: features.returns_5m,
                    returns_15m: features.returns_15m,
                    returns_1h: features.returns_1h,
                    returns_4h: features.returns_4h,
                    returns_1d: features.returns_1d,
                    rsi_14: features.rsi_14,
                    bb_width: features.bb_width,
                    macd: features.macd,
                    macd_signal: features.macd_signal,
                    macd_hist: features.macd_hist,
                    atr: features.atr,
                    volume_ratio: features.volume_ratio,
                    obv: features.obv,
                    spread: features.spread,
                    additional_metrics: Some(additional_metrics),
                })
            },
            Err(e) => Err(napi::Error::from_reason(format!("Failed to calculate features: {}", e))),
        }
    }
    
    /// Detect anomalies across all symbols
    #[napi]
    pub fn detect_anomalies(&self) -> Vec<MarketAnomalyParams> {
        // Detect anomalies
        let anomalies = self.market_data_processor.detect_anomalies();
        
        // Convert to NAPI params
        anomalies
            .into_iter()
            .map(|anomaly| {
                // Convert metrics to JSON
                let metrics_json = serde_json::to_value(&anomaly.metrics).unwrap_or_default();
                
                // Convert anomaly type to u32
                let anomaly_type_u32 = match anomaly.anomaly_type {
                    crate::market_data::AnomalyType::PriceSpike => 0,
                    crate::market_data::AnomalyType::VolumeSpike => 1,
                    crate::market_data::AnomalyType::SpreadWidening => 2,
                    crate::market_data::AnomalyType::LiquidityDrop => 3,
                    crate::market_data::AnomalyType::CorrelationBreak => 4,
                    crate::market_data::AnomalyType::VolatilityExplosion => 5,
                };
                
                MarketAnomalyParams {
                    symbol: anomaly.symbol,
                    timestamp: anomaly.timestamp.timestamp_millis() as u64,
                    anomaly_type: anomaly_type_u32,
                    severity: anomaly.severity,
                    description: anomaly.description,
                    metrics: Some(metrics_json),
                }
            })
            .collect()
    }
    
    /// Get recent anomalies
    #[napi]
    pub fn get_recent_anomalies(&self, limit: u32) -> Vec<MarketAnomalyParams> {
        // Get recent anomalies
        let anomalies = self.market_data_processor.get_recent_anomalies(limit as usize);
        
        // Convert to NAPI params
        anomalies
            .into_iter()
            .map(|anomaly| {
                // Convert metrics to JSON
                let metrics_json = serde_json::to_value(&anomaly.metrics).unwrap_or_default();
                
                // Convert anomaly type to u32
                let anomaly_type_u32 = match anomaly.anomaly_type {
                    crate::market_data::AnomalyType::PriceSpike => 0,
                    crate::market_data::AnomalyType::VolumeSpike => 1,
                    crate::market_data::AnomalyType::SpreadWidening => 2,
                    crate::market_data::AnomalyType::LiquidityDrop => 3,
                    crate::market_data::AnomalyType::CorrelationBreak => 4,
                    crate::market_data::AnomalyType::VolatilityExplosion => 5,
                };
                
                MarketAnomalyParams {
                    symbol: anomaly.symbol,
                    timestamp: anomaly.timestamp.timestamp_millis() as u64,
                    anomaly_type: anomaly_type_u32,
                    severity: anomaly.severity,
                    description: anomaly.description,
                    metrics: Some(metrics_json),
                }
            })
            .collect()
    }
    
    /// Get latest market features for a symbol
    #[napi]
    pub fn get_latest_features(&self, symbol: String) -> Option<MarketFeaturesParams> {
        // Get latest features
        self.market_data_processor.get_latest_features(&symbol).map(|features| {
            // Convert additional metrics to JSON
            let additional_metrics = serde_json::to_value(&features.additional_metrics).unwrap_or_default();
            
            MarketFeaturesParams {
                symbol: features.symbol,
                timestamp: features.timestamp.timestamp_millis() as u64,
                price: features.price,
                returns_1m: features.returns_1m,
                returns_5m: features.returns_5m,
                returns_15m: features.returns_15m,
                returns_1h: features.returns_1h,
                returns_4h: features.returns_4h,
                returns_1d: features.returns_1d,
                rsi_14: features.rsi_14,
                bb_width: features.bb_width,
                macd: features.macd,
                macd_signal: features.macd_signal,
                macd_hist: features.macd_hist,
                atr: features.atr,
                volume_ratio: features.volume_ratio,
                obv: features.obv,
                spread: features.spread,
                additional_metrics: Some(additional_metrics),
            }
        })
    }
}

impl NapiSharedMemoryManager {
    /// Get internal reference for use in other wrappers
    pub(crate) fn get_internal(&self) -> Arc<SharedMemoryManager> {
        self.inner.clone()
    }
}

// Add export for the new NAPI class at the end of the re-export section
// ... existing code ...

// Add Position Manager bindings
#[napi]
pub struct NapiPositionManager {
    position_manager: Arc<PositionManager>,
}

#[napi]
pub enum NapiOrderSide {
    Buy,
    Sell,
}

#[napi]
pub struct OrderOrFillParams {
    /// Symbol
    #[napi(ts_type = "string")]
    pub symbol: String,

    /// Side (Buy = 0, Sell = 1)
    #[napi(ts_type = "number")]
    pub side: u32,

    /// Order size
    #[napi(ts_type = "number")]
    pub size: f64,

    /// Order price
    #[napi(ts_type = "number")]
    pub price: f64,

    /// Timestamp in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub timestamp: u64,

    /// Order ID
    #[napi(ts_type = "string")]
    pub order_id: String,

    /// Fill ID (optional)
    #[napi(ts_type = "string | null")]
    pub fill_id: Option<String>,

    /// Is this a fill or just an open order
    #[napi(ts_type = "boolean")]
    pub is_fill: bool,

    /// Venue (optional)
    #[napi(ts_type = "string | null")]
    pub venue: Option<String>,

    /// Strategy ID (optional)
    #[napi(ts_type = "string | null")]
    pub strategy_id: Option<String>,
}

#[napi]
pub struct SymbolPositionParams {
    /// Symbol
    #[napi(ts_type = "string")]
    pub symbol: String,

    /// Net position size (positive for long, negative for short)
    #[napi(ts_type = "number")]
    pub net_size: f64,

    /// Average entry price
    #[napi(ts_type = "number")]
    pub average_price: f64,

    /// Unrealized profit and loss
    #[napi(ts_type = "number")]
    pub unrealized_pnl: f64,

    /// Realized profit and loss
    #[napi(ts_type = "number")]
    pub realized_pnl: f64,

    /// Last update timestamp in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub last_update: u64,

    /// Open orders (serialized to JSON)
    #[napi(ts_type = "string")]
    pub open_orders: String,

    /// Recent fills (serialized to JSON)
    #[napi(ts_type = "string")]
    pub fills: String,
}

#[napi]
pub struct AgentPositionParams {
    /// Agent ID
    #[napi(ts_type = "string")]
    pub agent_id: String,

    /// Cash balance
    #[napi(ts_type = "number")]
    pub cash_balance: f64,

    /// Last update timestamp in milliseconds since epoch
    #[napi(ts_type = "number")]
    pub last_update: u64,

    /// Positions by symbol (serialized to JSON)
    #[napi(ts_type = "string")]
    pub positions: String,
}

#[napi]
pub struct PositionManagerConfigParams {
    /// Maximum position size per symbol (JSON mapping of symbol to max size)
    #[napi(ts_type = "string")]
    pub max_position_per_symbol: String,

    /// Default maximum position size for symbols not explicitly set
    #[napi(ts_type = "number")]
    pub default_max_position: f64,

    /// Maximum total exposure across all positions
    #[napi(ts_type = "number")]
    pub max_total_exposure: f64,

    /// Initial cash balance for new agents
    #[napi(ts_type = "number")]
    pub initial_cash_balance: f64,
}

#[napi]
impl NapiPositionManager {
    #[napi]
    pub fn new() -> Self {
        Self {
            position_manager: create_position_manager(),
        }
    }

    #[napi]
    pub fn with_config(config_params: PositionManagerConfigParams) -> napi::Result<Self> {
        // Parse max position per symbol JSON
        let max_position_per_symbol = serde_json::from_str::<HashMap<String, f64>>(&config_params.max_position_per_symbol)
            .map_err(|e| napi::Error::from_reason(format!("Invalid max_position_per_symbol format: {}", e)))?;
        
        let config = PositionManagerConfig {
            max_position_per_symbol,
            default_max_position: config_params.default_max_position,
            max_total_exposure: config_params.max_total_exposure,
            initial_cash_balance: config_params.initial_cash_balance,
        };
        
        Ok(Self {
            position_manager: create_position_manager_with_config(config),
        })
    }

    #[napi]
    pub fn update_position(&self, agent_id: String, order: OrderOrFillParams) -> napi::Result<()> {
        // Convert side to Rust enum
        let side = match order.side {
            0 => Side::Buy,
            1 => Side::Sell,
            _ => return Err(napi::Error::from_reason("Invalid order side")),
        };
        
        // Convert timestamp to DateTime<Utc>
        let timestamp = chrono::DateTime::<chrono::Utc>::from_utc(
            chrono::NaiveDateTime::from_timestamp_millis(order.timestamp as i64)
                .ok_or_else(|| napi::Error::from_reason("Invalid timestamp"))?,
            chrono::Utc,
        );
        
        // Create OrderOrFill
        let order_or_fill = OrderOrFill {
            symbol: order.symbol,
            side,
            size: order.size,
            price: order.price,
            timestamp,
            order_id: order.order_id,
            fill_id: order.fill_id,
            is_fill: order.is_fill,
            venue: order.venue,
            strategy_id: order.strategy_id,
        };
        
        // Update position
        self.position_manager.update_position(&agent_id, &order_or_fill)
            .map_err(|e| napi::Error::from_reason(format!("Failed to update position: {}", e)))
    }

    #[napi]
    pub fn calculate_exposure(&self, agent_id: String) -> napi::Result<f64> {
        self.position_manager.calculate_exposure(&agent_id)
            .map_err(|e| napi::Error::from_reason(format!("Failed to calculate exposure: {}", e)))
    }

    #[napi]
    pub fn check_limits(&self, agent_id: String, symbol: String, side: u32, size: f64) -> napi::Result<bool> {
        // Convert side to Rust enum
        let rust_side = match side {
            0 => Side::Buy,
            1 => Side::Sell,
            _ => return Err(napi::Error::from_reason("Invalid order side")),
        };
        
        self.position_manager.check_limits(&agent_id, &symbol, rust_side, size)
            .map_err(|e| napi::Error::from_reason(format!("Failed to check limits: {}", e)))
    }

    #[napi]
    pub fn update_price(&self, symbol: String, price: f64) -> napi::Result<()> {
        self.position_manager.update_price(&symbol, price)
            .map_err(|e| napi::Error::from_reason(format!("Failed to update price: {}", e)))
    }

    #[napi]
    pub fn get_symbol_position(&self, agent_id: String, symbol: String) -> napi::Result<SymbolPositionParams> {
        let position = self.position_manager.get_symbol_position(&agent_id, &symbol)
            .map_err(|e| napi::Error::from_reason(format!("Failed to get symbol position: {}", e)))?;
        
        // Serialize open orders and fills to JSON
        let open_orders_json = serde_json::to_string(&position.open_orders)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize open orders: {}", e)))?;
        
        let fills_json = serde_json::to_string(&position.fills)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize fills: {}", e)))?;
        
        Ok(SymbolPositionParams {
            symbol: position.symbol,
            net_size: position.net_size,
            average_price: position.average_price,
            unrealized_pnl: position.unrealized_pnl,
            realized_pnl: position.realized_pnl,
            last_update: position.last_update.timestamp_millis() as u64,
            open_orders: open_orders_json,
            fills: fills_json,
        })
    }

    #[napi]
    pub fn get_position(&self, agent_id: String) -> napi::Result<AgentPositionParams> {
        let position = self.position_manager.get_position(&agent_id)
            .map_err(|e| napi::Error::from_reason(format!("Failed to get agent position: {}", e)))?;
        
        // Serialize positions to JSON
        let positions_json = serde_json::to_string(&position.positions)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize positions: {}", e)))?;
        
        Ok(AgentPositionParams {
            agent_id: position.agent_id,
            cash_balance: position.cash_balance,
            last_update: position.last_update.timestamp_millis() as u64,
            positions: positions_json,
        })
    }

    #[napi]
    pub fn update_config(&self, config_params: PositionManagerConfigParams) -> napi::Result<()> {
        // Parse max position per symbol JSON
        let max_position_per_symbol = serde_json::from_str::<HashMap<String, f64>>(&config_params.max_position_per_symbol)
            .map_err(|e| napi::Error::from_reason(format!("Invalid max_position_per_symbol format: {}", e)))?;
        
        let config = PositionManagerConfig {
            max_position_per_symbol,
            default_max_position: config_params.default_max_position,
            max_total_exposure: config_params.max_total_exposure,
            initial_cash_balance: config_params.initial_cash_balance,
        };
        
        self.position_manager.update_config(config)
            .map_err(|e| napi::Error::from_reason(format!("Failed to update config: {}", e)))
    }

    #[napi]
    pub fn get_config(&self) -> napi::Result<PositionManagerConfigParams> {
        let config = self.position_manager.get_config()
            .map_err(|e| napi::Error::from_reason(format!("Failed to get config: {}", e)))?;
        
        // Serialize max position per symbol to JSON
        let max_position_per_symbol_json = serde_json::to_string(&config.max_position_per_symbol)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize max position per symbol: {}", e)))?;
        
        Ok(PositionManagerConfigParams {
            max_position_per_symbol: max_position_per_symbol_json,
            default_max_position: config.default_max_position,
            max_total_exposure: config.max_total_exposure,
            initial_cash_balance: config.initial_cash_balance,
        })
    }
}