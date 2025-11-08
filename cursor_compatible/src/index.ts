/**
 * AI Core Module - Main Entry Point
 * Exports all public APIs for the AI/ML trading system
 */

// Export all components from the scoring module
export * from './scoring/index.js';

// Export news feed ingestion module
export * from './news_feed_ingestion/index.js';

// Export social signals module
export * from './social-signals/index.js';

// Export DEX execution infrastructure
export * from './infra/router/SmartOrderRouter.js';
export * from './infra/venues/dex/UniswapVenue.js';
export * from './infra/venues/dex/SushiswapVenue.js';

// Export Transaction Risk Mitigation Layer
export * from './execution/risk/TransactionGuard.js';
export * from './execution/risk/ProtectiveWrapper.js';

// Export Feed Graph components
export * from './feed/index.js';

// Export Control components
// Commented out due to JSX issues - enable after JSX configuration is set
// export * from './components/control/HotbarControls.js';
// export * from './components/control/SystemVitals.js';

// Export Analytics components
// Commented out due to JSX issues - enable after JSX configuration is set
// export * from './components/analytics/RegimeHeatmap.js';

// Export API routes
export * from './routes/api/control.js';
export * from './routes/api/panic.js';
export * from './routes/api/system.js';

// Export Monitoring components
export * from './monitor/PostLaunchSentinel.js';
export * from './healing/PostMortemTracker.js';

// Export Alpha Stabilization components
export * from './memory/AlphaHistoryStore.js';
export * from './engine/FeedbackLoopEngine.js';
export * from './risk/AutoDegrader.js';

// Export Memory Compression components
export * from './memory/AlphaCompressor.js';

// Export Mutation Scoring components
export * from './models/StrategyPerformance.js';
export * from './mutation/MutationScorer.js';

// Export Evolution components
export * from './evolution/BiasEngine.js';
export * from './evolution/MutationPlanner.js';
export * from './evolution/MutationEngine.js';
export * from './evolution/StrategyGenome.js';
export * from './evolution/strategy_pruner.js';
export * from './evolution/StrategyMutationEngine.js';

// Export Optimization components
export * from './optimizer/StrategyPortfolioOptimizer.js';

// Export Capital Allocation components
export * from './capital/RegimeCapitalAllocator.js';

// Export Integration components
export * from './integration/AdaptiveIntelligenceSystem';
export * from './integration/RegimeClassificationIntegration';

// Re-export Rust implementations with fallbacks
export { SmartOrderRouterRust } from './execution/SmartOrderRouterRust';
export { SmartOrderRouterJs } from './execution/SmartOrderRouterJs';

export { ExecutionStrategyRouterRust, ExecutionAlgorithm } from './execution/ExecutionStrategyRouterRust';
export { ExecutionStrategyRouterJs } from './execution/ExecutionStrategyRouterJs';

export { RiskCalculatorRust } from './risk/RiskCalculatorRust';
export { RiskCalculatorJs } from './risk/RiskCalculatorJs';

export { DynamicTradeSizerRust } from './risk/DynamicTradeSizerRust';
export { DynamicTradeSizerJs } from './risk/DynamicTradeSizerJs';

export { DrawdownMonitorRust } from './risk/DrawdownMonitorRust';
export { DrawdownMonitorJs } from './risk/DrawdownMonitorJs';

export { VenueLatencyTrackerRust } from './execution/VenueLatencyTrackerRust';
export { VenueLatencyTrackerJs } from './execution/VenueLatencyTrackerJs';

export { SharedMemoryManagerRust, BatchProcessorRust } from './memory/SharedMemoryManagerRust';
export { SharedMemoryManagerJs, BatchProcessorJs } from './memory/SharedMemoryManagerJs';

// Export interfaces
export type { 
  // Execution
  TWAPConfig, 
  VWAPConfig, 
  ExecutionStrategyConfig,
} from './execution/ExecutionStrategyRouterRust';

export type {
  // Risk
  RiskConfig,
  PositionExposure,
} from './risk/RiskCalculatorJs';

export type {
  TradeSizerConfig,
} from './risk/DynamicTradeSizerRust';

export type {
  DrawdownMonitorConfig,
  TradeDataPoint,
  DrawdownState,
} from './risk/DrawdownMonitorRust';

export type {
  // Shared Memory
  BufferConfig,
  BufferType,
} from './memory/SharedMemoryManagerRust';

// Export Adaptive Intelligence interfaces
export type {
  AdaptiveIntelligenceSystemConfig,
  SystemStatusInfo
} from './integration/AdaptiveIntelligenceSystem';

// Import logger
import { logger } from './utils/logger';

// Export common components
export { RegimeClassifier, MarketRegime } from './regime/RegimeClassifier';
export { MarketRegimeClassifier } from './regime/MarketRegimeClassifier';
export { RegimeTransitionEngine } from './regime/RegimeTransitionEngine';
export { 
  MarketRegime as MarketRegimeType,
  RegimeTransitionState,
  MarketFeatures,
  RegimeClassification,
  RegimeHistory,
  RegimeTransition
} from './regime/MarketRegimeTypes';
export { TelemetryBus } from './telemetry/TelemetryBus';

// Export memory and evolution components
export { AlphaMemory } from './memory/AlphaMemory';
export { MutationScorer } from './mutation/MutationScorer';

// Initialize logging
logger.info("🚀 Noderr Protocol Core initialized.");
logger.info("📊 High-performance Rust components initialized. Javascript fallbacks available.");
logger.info("⚡ Target latency: <5ms per operation.");

// Initialize adaptive intelligence components
logger.info("🧠 Adaptive intelligence components loaded.");
logger.info("📈 Strategy evolution engine ready.");
logger.info("💰 Regime-aware capital allocation initialized.");
logger.info("🔬 Portfolio optimization engine prepared.");

// Export version information
export const VERSION = {
  core: '0.9.2',
  buildDate: new Date().toISOString()
};

// Re-export Execution Infrastructure
export { CrossChainExecutionRouter } from './execution/CrossChainExecutionRouter';
export { CrossChainStrategyRegistry } from './execution/CrossChainStrategyRegistry';
export { ExecutionSecurityLayer } from './execution/ExecutionSecurityLayer';
export { IExecutionAdapter, ExecutionParams, ExecutionResult, FeeEstimation, ChainHealthStatus } from './execution/interfaces/IExecutionAdapter';

// Chain Adapters
export { EthereumAdapter } from './execution/adapters/EthereumAdapter';
export { SolanaAdapter } from './execution/adapters/SolanaAdapter';
export { CosmosAdapter } from './execution/adapters/CosmosAdapter';

// Configuration
export { ChainConfigRepository, Environment } from './execution/config/ChainConfig';
export { initializeChainConfigurations, getCurrentChainConfig } from './execution/config/chains.config';

import metricsRouter from './metrics';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loggingMiddleware, errorLoggerMiddleware } from './utils/logger';
import authRoutes from './auth/authRoutes';
import { authenticate, authorize } from './auth/authMiddleware';
import { Permission } from './auth/types';
import { initializeTracing } from './telemetry/tracing';
import { registerGlobalShutdownHooks } from './utils/shutdown';
import { validateBody } from './middleware/validationMiddleware';
import { loginSchema } from './middleware/validationMiddleware';

// Initialize observability
initializeTracing();
registerGlobalShutdownHooks();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Medium: security hardening with safe defaults
const DEV_ORIGIN = 'http://localhost:3000';
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet());
app.use(cors({ origin: isProd ? [] : [DEV_ORIGIN] }));
app.use(express.json({ limit: '1mb' }));
app.use(loggingMiddleware);

// Security headers middleware
app.use((req, res, next) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  
  // Remove headers that might disclose server information
  res.removeHeader('X-Powered-By');
  
  next();
});

// Routes
app.use('/api/auth', authRoutes);

// Protected routes examples
app.get('/api/trading/orders', 
  authenticate, 
  authorize(Permission.TRADE_READ),
  (req, res) => {
    res.json({ 
      message: 'Orders retrieved successfully',
      userId: req.user?.sub,
      data: [
        { id: '1', symbol: 'BTC-USDT', side: 'buy', status: 'filled' },
        { id: '2', symbol: 'ETH-USDT', side: 'sell', status: 'pending' }
      ]
    });
  }
);

app.post('/api/trading/orders', 
  authenticate, 
  authorize(Permission.TRADE_EXECUTE),
  validateBody(loginSchema), // This would be a specific order schema in the real implementation
  (req, res) => {
    res.status(201).json({ 
      message: 'Order placed successfully',
      userId: req.user?.sub,
      orderId: '12345'
    });
  }
);

// Health check route (unprotected)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Error handling middleware
app.use(errorLoggerMiddleware);
app.use((err: Error, req: any, res: any, next: any) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Export main service
export { AICoreService } from './services/AICoreService';

// Export ML models
export { TransformerPredictor } from './ml/TransformerPredictor';
export { ReinforcementLearner } from './ml/ReinforcementLearner';

// Export core components
export { FractalPatternDetector } from './core/FractalPatternDetector';

// Export types
export * from './types';

// Version information
export const VERSION = '1.0.0';
export const MODULE_NAME = 'ai-core';

// Default configuration
export const DEFAULT_CONFIG = {
  transformer: {
    sequenceLength: 100,
    embeddingDim: 256,
    numHeads: 8,
    numLayers: 6,
    ffDim: 1024,
    dropoutRate: 0.1,
    learningRate: 0.0001,
    batchSize: 32
  },
  reinforcement: {
    algorithm: 'DOUBLE_DQN',
    gamma: 0.99,
    bufferSize: 100000,
    batchSize: 64,
    learningStarts: 10000
  },
  fractal: {
    minDataPoints: 100,
    patternTypes: ['ELLIOTT_WAVE', 'HARMONIC', 'WYCKOFF', 'MARKET_PROFILE']
  }
}; 