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

pub mod strategy;
pub mod market;
pub mod risk;
pub mod execution;
pub mod telemetry;
pub mod entropy;
pub mod strategy_executor;
pub mod trust_buffer;
pub mod examples;
pub mod storage;
pub mod api;
pub mod analytics;
pub mod telemetry_streamer;
pub mod websocket_manager;
pub mod trust_score_engine;
pub mod simulation;
pub mod trust_decay_service;
pub mod correlation_engine;
pub mod risk_allocation;
pub mod drawdown;
pub mod microstructure;
pub mod market_regime;
pub mod asset_allocator;
pub mod execution_metrics;
pub mod strategy_feedback;
pub mod strategy_attribution;
pub mod factor_analysis;
pub mod redis;
pub mod healing_orchestrator;
pub mod agent_controller;
pub mod trust_monitor;
pub mod treasury_service;
pub mod memory_service;
pub mod meta;
pub mod governance;
// New latency-critical modules
pub mod order_router;
pub mod execution_strategy;
pub mod risk_calc;
pub mod trade_sizer;
pub mod drawdown_monitor;
pub mod venue_latency;
pub mod shared_memory;
pub mod orderbook;
pub mod strategy_engine;
pub mod market_data;
pub mod position;
// NAPI bindings
#[cfg(feature = "napi")]
pub mod bindings;
pub mod cpu_affinity;
pub mod market_data_soa;
pub mod telemetry_enhanced;
pub mod fast_risk_layer;

// Re-export common types
pub use market::MarketData;
pub use strategy::{Strategy, Signal, EntropyConfig, EntropyInjector};
pub use entropy::{DefaultEntropyInjector, EntropyInjectorFactory};
pub use risk::{RiskManager, RiskError, RiskMetrics};
pub use execution::{ExecutionService, ExecutionResult, ExecutionError, LatencyProfile, FeeInfo, ExecutionLog, ExecutionQualityScore, ExecutionOutcomeReason};
pub use telemetry::TelemetryReporter;
pub use strategy_executor::StrategyExecutor;
pub use trust_buffer::{TrustBuffer, TrustScoreUpdate, TimeRange, TrustStatistics};
pub use storage::{StrategyStorage, StorageConfig, StorageType, create_storage};
pub use api::create_api_router;
pub use analytics::{
    Analytics, AnalyticsResult, AnalyticsError, create_analytics,
    StrategyStorageAnalyticsAdapter, create_analytics_storage, setup_analytics,
    PerformanceSummary, ExecutionStats, TrendLine, Anomaly, TimePeriod
};
pub use telemetry_streamer::{TelemetryStreamer, TelemetryStreamerConfig, create_telemetry_streamer};
pub use websocket_manager::{WebSocketManager, WebSocketMessage, create_websocket_manager};
pub use trust_score_engine::{
    TrustScoreEngine, TrustScore, TrustScoreFeatures, TrustScoreConfig, 
    TrustScoreWeights, TrustScoreHistory, TrustScoreError, TrustScoreResult,
    create_trust_score_engine
};
pub use simulation::trust_decay_simulator::{
    DecaySimulationParams, SimulatedTrustScore, simulate_trust_score_decay, apply_recovery_events
};
pub use trust_decay_service::{
    TrustDecayService, TrustDecayConfig, StrategyActivityStatus,
    create_trust_decay_service
};
pub use correlation_engine::{
    CorrelationEngine, CorrelationEngineConfig, CorrelationMatrix, StrategyRiskWeights,
    StrategyReturnSnapshot, CorrelationError, CorrelationResult, CorrelationEngineFactory,
    create_correlation_engine, create_correlation_engine_with_config
};
pub use risk_allocation::{
    RiskAllocator, RiskAllocationConfig, PortfolioAllocation, StrategyAllocation,
    RiskAllocationError, RiskAllocationResult, 
    create_risk_allocator, create_risk_allocator_with_config
};
pub use drawdown::{
    DrawdownTracker, DrawdownSnapshot, DrawdownState, DrawdownConfig,
    RecoveryRampMode, DrawdownError, DrawdownResult, DrawdownTrackerFactory,
    create_drawdown_tracker, create_drawdown_tracker_with_config, create_mock_drawdown_tracker
};
pub use microstructure::{
    OrderFlowAnalyzer, OrderFlowMetrics, OrderFlowEvent, TradeAggression,
    OrderImbalance, create_order_flow_analyzer
};
pub use market_regime::{
    MarketRegimeDetector, MarketRegimeState, MarketRegime, MarketRegimeConfig,
    MarketRegimeError, MarketRegimeResult, MarketRegimeMetrics,
    create_market_regime_detector, create_market_regime_detector_with_config,
    HiddenMarkovModel, MarketObservation, HmmRegimeConfig,
    HmmMarketRegimeDetector, create_hmm_regime_detector, create_default_hmm_regime_detector,
    // Leading indicator and warning system
    LeadingIndicator, IndicatorDirection, RegimeWarning, IndicatorConfig,
    RegimeForecast, StrategyPrepSignal, StrategyPrepAction,
    RegimeWarningConfig, RegimeWarningEngine, RegimeWarningError,
    create_regime_warning_engine, create_regime_warning_engine_with_config
};
pub use asset_allocator::{
    AssetAllocator, AssetAllocationConfig, PortfolioAllocation as AssetPortfolioAllocation,
    AssetAllocation, AssetRiskClass, AssetMetadata, AssetAllocationError, AssetAllocationResult,
    create_asset_allocator, create_asset_allocator_with_config
};
pub use execution_metrics::{
    ExecutionMetricsCollector, ExecutionMetricsConfig, ExecutionMetricsError, ExecutionMetricsResult,
    create_execution_metrics_collector, create_default_execution_metrics_collector
};
pub use strategy_feedback::{
    StrategyFeedbackLoop, StrategyFeedbackConfig, StrategyFeedbackError, AdaptiveStrategyStatus,
    AdaptationEvent, AllocationWeights, create_strategy_feedback_loop, create_default_strategy_feedback_loop
};
pub use strategy_attribution::{
    AttributionEngine, StrategyAttribution, AttributionConfig, AttributionError, AttributionResult
};
pub use factor_analysis::{
    FactorAnalysisEngine, AlphaFactor, FactorExposure, StrategyFactorProfile,
    FactorAnalysisConfig, FactorRegressionResult, FactorAnalysisError,
    FactorAnalysisResult, FactorAlert, FactorAlertType, 
    create_factor_analysis_engine, create_factor_analysis_engine_with_config
};
pub use redis::{RedisClient, RedisConfig, RedisClientError, RedisClientResult};
pub use treasury_service::{
    TreasuryService, TreasuryAccount, TreasuryTransaction, TreasuryEvent,
    RedisTreasuryService, create_treasury_service, run_daily_tier_evaluation
};
pub use memory_service::{
    MemoryService, MemoryEvent, AgentEmbedding, AgentComparison,
    create_memory_service, generate_agent_embedding
};

// Re-export new latency-critical modules
pub use order_router::{
    SmartOrderRouter, OrderRetryEngine, Order, OrderSide as RouterOrderSide, 
    RetryContext, VenueExecutionResult, OrderRouterError, ExecutionFailureReason
};
pub use execution_strategy::{
    ExecutionStrategyRouter, ExecutionStrategy, ExecutionAlgorithm,
    ExecutionStrategyConfig, TWAPConfig, VWAPConfig, 
    ExecutionStrategyError, ExecutionStrategyDetails
};
pub use risk_calc::{
    RiskCalculator, RiskConfig, PositionExposure, VenueExposure,
    RiskCheckResult, RiskViolation, RiskViolationType, RiskViolationSeverity
};
pub use trade_sizer::{
    DynamicTradeSizer, TradeSizerConfig, TradeSizerError
};
pub use drawdown_monitor::{
    DrawdownMonitor, DrawdownConfig as FastDrawdownConfig, 
    TradeDataPoint, TradeType, DrawdownEventType, DrawdownState as FastDrawdownState,
    DrawdownEvent, DrawdownWindow, KillSwitch, DrawdownError as FastDrawdownError
};

// Re-export venue latency tracker
pub use venue_latency::{VenueLatencyTracker, VenueLatencyStats, create_venue_latency_tracker};

// Re-export shared memory manager
pub use shared_memory::{
    SharedMemoryManager, BufferConfig, BufferType, SharedRingBuffer, 
    BatchProcessor, BatchResult, create_shared_memory_manager
};

// Re-export order book manager
pub use orderbook::{
    OrderBookManager, OrderSide, UpdateType, PriceLevel, create_order_book_manager
};

// Re-export strategy engine
pub use strategy_engine::{
    StrategyEngine, StrategyEngineConfig, StrategyEngineMode,
    SignalEvaluation, SignalMetrics, create_strategy_engine
};

// Re-export market data processor
pub use market_data::{
    MarketDataProcessor, MarketTick, MarketFeatures, MarketAnomaly, AnomalyType,
    MarketDataProcessorConfig, create_market_data_processor, 
    create_market_data_processor_with_config, create_market_data_processor_with_shared_memory
};

// Re-export position manager
pub use position::{
    PositionManager, PositionManagerConfig, 
    AgentPosition, SymbolPosition, OrderOrFill, Side,
    PositionError, PositionResult,
    create_position_manager, create_position_manager_with_config
};

// Re-export NAPI bindings
#[cfg(feature = "napi")]
pub use bindings::{
    NapiSmartOrderRouter, OrderParams,
    NapiRiskCalculator, RiskConfigParams, PositionExposureParams,
    NapiDynamicTradeSizer, TradeSizerConfigParams,
    NapiDrawdownMonitor, DrawdownConfigParams, TradeDataPointParams,
    NapiExecutionStrategyRouter, ExecutionStrategyConfigParams, TWAPConfigParams, VWAPConfigParams,
    NapiVenueLatencyTracker, VenueLatencyStatsParams,
    NapiSharedMemoryManager, BufferConfigParams, NapiBatchProcessor,
    NapiOrderBookManager, NapiOrderSide, NapiPriceLevel, NapiUpdateType,
    NapiStrategyEngine, StrategyEngineConfigParams, SignalEvaluationParams, SignalMetricsParams,
    NapiMarketDataProcessor, MarketDataProcessorConfigParams, MarketTickParams,
    MarketFeaturesParams, MarketAnomalyParams
};

use std::sync::Arc;
use std::collections::HashMap;
use risk::RiskManagerConfig;
use risk::RiskManagerFactory;

/// Create a smart order router
pub fn create_smart_order_router() -> Arc<SmartOrderRouter> {
    Arc::new(SmartOrderRouter::new())
}

/// Create a smart order router with custom retry engine
pub fn create_smart_order_router_with_retry(
    max_retries: u32,
    base_delay_ms: u64,
    max_delay_ms: u64,
    initial_trust_scores: HashMap<String, f64>,
) -> Arc<SmartOrderRouter> {
    let retry_engine = Arc::new(OrderRetryEngine::new(max_retries, base_delay_ms, max_delay_ms));
    Arc::new(SmartOrderRouter::with_retry_engine(retry_engine, initial_trust_scores))
}

/// Create an execution strategy router
pub fn create_execution_strategy_router(
    config: ExecutionStrategyConfig,
    twap_executor: Arc<dyn ExecutionStrategy>,
    vwap_executor: Arc<dyn ExecutionStrategy>,
) -> Arc<ExecutionStrategyRouter> {
    Arc::new(ExecutionStrategyRouter::new(config, twap_executor, vwap_executor))
}

/// Create a risk calculator
pub fn create_risk_calculator(
    config: RiskConfig,
    initial_portfolio_value: f64,
) -> Arc<RiskCalculator> {
    Arc::new(RiskCalculator::new(config, initial_portfolio_value))
}

/// Create a dynamic trade sizer
pub fn create_dynamic_trade_sizer(
    config: TradeSizerConfig,
) -> Arc<DynamicTradeSizer> {
    Arc::new(DynamicTradeSizer::with_config(config))
}

/// Create a drawdown monitor
pub fn create_drawdown_monitor(
    config: FastDrawdownConfig,
    kill_switch: Arc<dyn KillSwitch>,
) -> Arc<DrawdownMonitor> {
    Arc::new(DrawdownMonitor::new(config, kill_switch))
}

/// Create a risk manager with drawdown tracking for adaptive exposure
pub fn create_risk_manager_with_drawdown(redis: Arc<dyn RedisClient>) -> Arc<dyn RiskManager> {
    let drawdown_tracker = create_drawdown_tracker(redis);
    RiskManagerFactory::create_with_drawdown_tracker(
        RiskManagerConfig::default(),
        drawdown_tracker
    )
}

/// Create a risk manager with drawdown tracking and custom configs
pub fn create_risk_manager_with_drawdown_and_config(
    redis: Arc<dyn RedisClient>, 
    risk_config: RiskManagerConfig,
    drawdown_config: DrawdownConfig
) -> Arc<dyn RiskManager> {
    let drawdown_tracker = create_drawdown_tracker_with_config(redis, drawdown_config);
    RiskManagerFactory::create_with_drawdown_tracker(
        risk_config, 
        drawdown_tracker
    )
}

/// Create a strategy executor with drawdown tracking
pub fn create_strategy_executor_with_drawdown(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    redis: Arc<dyn RedisClient>
) -> StrategyExecutor {
    let drawdown_tracker = create_drawdown_tracker(redis);
    StrategyExecutor::with_drawdown_tracker(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        drawdown_tracker
    )
}

/// Create a strategy executor with custom configuration and drawdown tracking
pub fn create_strategy_executor_with_config_and_drawdown(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    config: strategy_executor::StrategyExecutorConfig,
    redis: Arc<dyn RedisClient>,
    drawdown_config: Option<DrawdownConfig>
) -> StrategyExecutor {
    
    let drawdown_tracker = match drawdown_config {
        Some(config) => create_drawdown_tracker_with_config(redis, config),
        None => create_drawdown_tracker(redis)
    };
    
    StrategyExecutor::with_drawdown_tracker_and_config(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        config,
        drawdown_tracker
    )
}

/// Create a regime-aware allocator 
pub fn create_regime_aware_allocator(
    redis: Arc<dyn RedisClient>,
    correlation_engine: Arc<dyn CorrelationEngine>,
    regime_config: Option<MarketRegimeConfig>,
    allocation_config: Option<AssetAllocationConfig>
) -> (Arc<dyn MarketRegimeDetector>, Arc<dyn AssetAllocator>) {
    
    let regime_detector = match regime_config {
        Some(config) => create_market_regime_detector_with_config(redis.clone(), config),
        None => create_market_regime_detector(redis.clone())
    };
    
    let allocator = match allocation_config {
        Some(config) => create_asset_allocator_with_config(
            redis, correlation_engine, Some(regime_detector.clone()), config
        ),
        None => create_asset_allocator(redis, correlation_engine, Some(regime_detector.clone()))
    };
    
    (regime_detector, allocator)
}

/// Create a strategy executor with execution metrics
pub fn create_strategy_executor_with_metrics(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    redis: Arc<dyn RedisClient>,
    storage: Option<Arc<dyn StrategyStorage>>,
) -> (StrategyExecutor, Arc<dyn ExecutionMetricsCollector>) {
    
    let metrics = create_execution_metrics_collector(redis.clone(), storage);
    
    let executor = StrategyExecutor::with_metrics_collector(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        metrics.clone()
    );
    
    (executor, metrics)
}

/// Create a trading system with feedback loop
pub fn create_trading_system_with_feedback(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    risk_allocator: Arc<dyn RiskAllocator>,
    redis: Arc<dyn RedisClient>,
    storage: Option<Arc<dyn StrategyStorage>>,
) -> (StrategyExecutor, Arc<dyn ExecutionMetricsCollector>, Arc<dyn StrategyFeedbackLoop>) {
    
    let metrics = create_execution_metrics_collector(redis.clone(), storage.clone());
    
    let feedback = create_strategy_feedback_loop(
        redis.clone(),
        metrics.clone(),
        risk_allocator,
        storage
    );
    
    let executor = StrategyExecutor::with_metrics_and_feedback(
        strategies,
        risk_manager, 
        entropy_injector,
        telemetry,
        execution_service,
        metrics.clone(),
        feedback.clone()
    );
    
    (executor, metrics, feedback)
}

/// Create a strategy executor with factor analysis
pub fn create_strategy_executor_with_factor_analysis(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    redis: Arc<dyn RedisClient>,
) -> (StrategyExecutor, Arc<dyn FactorAnalysisEngine>) {
    
    let factor_engine = create_factor_analysis_engine(redis);
    
    let executor = StrategyExecutor::with_factor_analysis(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        factor_engine.clone()
    );
    
    (executor, factor_engine)
}

/// Create a complete strategy executor with all enhancements
pub fn create_complete_strategy_executor(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    redis: Arc<dyn RedisClient>,
    config: strategy_executor::StrategyExecutorConfig,
) -> (StrategyExecutor, Arc<dyn ExecutionMetricsCollector>, Arc<dyn FactorAnalysisEngine>) {
    
    let metrics = create_execution_metrics_collector(redis.clone(), None);
    let factor_engine = create_factor_analysis_engine(redis.clone());
    
    let executor = StrategyExecutor::with_all_enhancements(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        metrics.clone(),
        factor_engine.clone(),
        config
    );
    
    (executor, metrics, factor_engine)
}

/// Create a strategy executor with market regime detection
pub fn create_strategy_executor_with_regime_detection(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    redis: Arc<dyn RedisClient>,
) -> (StrategyExecutor, Arc<dyn MarketRegimeDetector>) {
    
    let regime_detector = create_market_regime_detector(redis);
    
    let executor = StrategyExecutor::with_regime_detector(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        regime_detector.clone()
    );
    
    (executor, regime_detector)
}

/// Create a strategy executor with regime warnings
pub fn create_strategy_executor_with_regime_warnings(
    strategies: Vec<Box<dyn Strategy>>,
    risk_manager: Arc<dyn RiskManager>,
    entropy_injector: Option<Arc<dyn EntropyInjector>>,
    telemetry: Arc<TelemetryReporter>,
    execution_service: Arc<ExecutionService>,
    redis: Arc<dyn RedisClient>,
    config: Option<RegimeWarningConfig>
) -> (StrategyExecutor, Arc<dyn MarketRegimeDetector>, Arc<RegimeWarningEngine>) {
    
    let regime_detector = create_market_regime_detector(redis.clone());
    
    let warning_engine = match config {
        Some(config) => create_regime_warning_engine_with_config(redis, regime_detector.clone(), config),
        None => create_regime_warning_engine(redis, regime_detector.clone())
    };
    
    let executor = StrategyExecutor::with_regime_warnings(
        strategies,
        risk_manager,
        entropy_injector,
        telemetry,
        execution_service,
        regime_detector.clone(),
        warning_engine.clone()
    );
    
    (executor, regime_detector, warning_engine)
} 