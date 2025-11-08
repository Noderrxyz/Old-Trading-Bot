/**
 * Evolution Strategy Evaluation System
 * 
 * Exports all components of the strategy evaluation subsystem.
 */

// Core evaluation types
export * from './EvaluationResult.js';

// Fitness scoring
export { FitnessScorer, FitnessScorerConfig } from './FitnessScorer.js';

// Evaluation runner
export { EvaluationRunner, EvaluationRunnerConfig } from './EvaluationRunner.js';

// Evaluation queue
export { EvaluationQueue, EvaluationQueueConfig } from './EvaluationQueue.js';

// Promotion management
export { 
  PromotionManager, 
  PromotionManagerConfig,
  PromotionIntent,
  RemutationIntent
} from './PromotionManager.js';

// Audit logging
export { AuditLogger, AuditLoggerConfig } from './auditLogger.js';

// Prometheus metrics
export * from './metrics.js';

// Import all dependencies directly to avoid dynamic imports
import { FitnessScorer, FitnessScorerConfig } from './FitnessScorer.js';
import { EvaluationRunner, EvaluationRunnerConfig } from './EvaluationRunner.js';
import { EvaluationQueue, EvaluationQueueConfig } from './EvaluationQueue.js';
import { PromotionManager, PromotionManagerConfig } from './PromotionManager.js';
import { AuditLogger, AuditLoggerConfig } from './auditLogger.js';
import * as metrics from './metrics.js';

/**
 * Initialize the evaluation subsystem with default configuration.
 * This function creates all necessary components and wires them together.
 * 
 * @param redisService - Redis service for queue management
 * @param postgresClient - Postgres client for storing results
 * @param backtestEngine - Engine for running backtests
 * @param replaySimulator - Simulator for running strategy replays
 * @param trustScoreService - Service for checking agent trust scores
 * @param config - Optional configuration overrides
 * @returns Initialized components
 */
export function initEvaluationSystem(
  redisService: any, // Replace with actual RedisService type
  postgresClient: any, // Replace with actual Postgres client type
  backtestEngine: any, // Replace with actual BacktestEngine type
  replaySimulator: any, // Replace with actual ReplaySimulator type
  trustScoreService: any, // Replace with actual TrustScoreService type
  config: {
    fitnessScorer?: Partial<FitnessScorerConfig>;
    evaluationRunner?: Partial<EvaluationRunnerConfig>;
    evaluationQueue?: Partial<EvaluationQueueConfig>;
    promotionManager?: Partial<PromotionManagerConfig>;
    auditLogger?: Partial<AuditLoggerConfig>;
  } = {}
) {
  // Create components in dependency order
  const fitnessScorer = new FitnessScorer(config.fitnessScorer);
  
  const evaluationRunner = new EvaluationRunner(
    backtestEngine,
    replaySimulator,
    trustScoreService,
    fitnessScorer,
    config.evaluationRunner
  );
  
  const promotionManager = new PromotionManager(
    redisService,
    config.promotionManager
  );
  
  const auditLogger = new AuditLogger(config.auditLogger);
  
  const evaluationQueue = new EvaluationQueue(
    redisService,
    evaluationRunner,
    promotionManager,
    postgresClient,
    config.evaluationQueue
  );
  
  // Set up periodic metrics collection
  setInterval(async () => {
    const queueSize = await evaluationQueue.getQueueLength();
    const activeCount = evaluationQueue.getActiveCount();
    metrics.updateQueueMetrics(queueSize, activeCount);
  }, 10000); // Update every 10 seconds
  
  return {
    fitnessScorer,
    evaluationRunner,
    evaluationQueue,
    promotionManager,
    auditLogger
  };
} 