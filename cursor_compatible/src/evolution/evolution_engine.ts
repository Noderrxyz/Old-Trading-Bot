/**
 * Evolution Engine
 * 
 * Manages the evolution of trading strategies through mutation, selection,
 * and scoring based on performance metrics.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';
import { AlphaScoringEngine, StrategyMetrics, AlphaScore } from './alpha_scoring_engine.js';
import { MutationEngine } from './mutation_engine.js';
import { StrategyRegistry } from '../registry/strategy_registry.js';
import { TradingStrategy } from '../strategy/trading_strategy.js';

/**
 * Evolution engine configuration
 */
export interface EvolutionEngineConfig {
  enabled: boolean;
  topPercentile: number;
  bottomPercentile: number;
  variationsPerTopStrategy: number;
  quarantineBottomPerformers: boolean;
  updateIntervalMs: number;
}

/**
 * Default evolution engine configuration
 */
export const DEFAULT_EVOLUTION_ENGINE_CONFIG: EvolutionEngineConfig = {
  enabled: true,
  topPercentile: 0.2, // Top 20%
  bottomPercentile: 0.1, // Bottom 10%
  variationsPerTopStrategy: 3,
  quarantineBottomPerformers: true,
  updateIntervalMs: 3600000 // 1 hour
};

export class EvolutionEngine {
  private static instance: EvolutionEngine | null = null;
  private config: EvolutionEngineConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[EvolutionEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[EvolutionEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[EvolutionEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[EvolutionEngine] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private alphaScoringEngine: AlphaScoringEngine;
  private mutationEngine: MutationEngine;
  private strategyRegistry: StrategyRegistry;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  private constructor(config: Partial<EvolutionEngineConfig> = {}) {
    this.config = { ...DEFAULT_EVOLUTION_ENGINE_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.alphaScoringEngine = AlphaScoringEngine.getInstance();
    this.mutationEngine = MutationEngine.getInstance();
    this.strategyRegistry = StrategyRegistry.getInstance();
  }

  // ... existing code ...

  /**
   * Update strategy metrics and scores
   */
  private updateStrategyMetrics(): void {
    for (const [strategyId, strategy] of this.strategyRegistry.getAllStrategies()) {
      const metrics = this.calculateStrategyMetrics(strategy);
      this.alphaScoringEngine.updateStrategyMetrics(metrics);
    }
  }

  /**
   * Calculate strategy metrics
   */
  private calculateStrategyMetrics(strategy: TradingStrategy): StrategyMetrics {
    const performance = strategy.getPerformanceMetrics();
    const trustScore = strategy.getTrustScore();

    return {
      strategyId: strategy.id,
      agentId: strategy.agentId,
      roi: performance.roi,
      maxDrawdown: performance.maxDrawdown,
      sharpeRatio: performance.sharpeRatio,
      volatility: performance.volatility,
      trustScore,
      lastUpdate: Date.now(),
      dataPoints: performance.dataPoints
    };
  }

  /**
   * Run evolution cycle
   */
  private runEvolutionCycle(): void {
    if (!this.config.enabled || !this.isRunning) return;

    try {
      // Update strategy metrics and scores
      this.updateStrategyMetrics();

      // Get current strategy scores
      const scores = this.alphaScoringEngine.getAllStrategyScores();
      if (scores.length === 0) {
        this.logger.warn('No strategy scores available for evolution');
        return;
      }

      // Sort strategies by score
      const sortedStrategies = scores.sort((a, b) => b.score - a.score);

      // Apply evolution rules
      this.applyEvolutionRules(sortedStrategies);

      this.logger.info(`Completed evolution cycle with ${scores.length} strategies`);
    } catch (error) {
      this.logger.error(`Error in evolution cycle: ${error}`);
    }
  }

  /**
   * Apply evolution rules based on strategy scores
   */
  private applyEvolutionRules(sortedStrategies: AlphaScore[]): void {
    const totalStrategies = sortedStrategies.length;
    const topPercentile = Math.ceil(totalStrategies * this.config.topPercentile);
    const bottomPercentile = Math.ceil(totalStrategies * this.config.bottomPercentile);

    // Process top performers
    for (let i = 0; i < topPercentile; i++) {
      const score = sortedStrategies[i];
      const strategy = this.strategyRegistry.getStrategy(score.strategyId);
      if (!strategy) continue;

      // Create variations of top performers
      for (let j = 0; j < this.config.variationsPerTopStrategy; j++) {
        const variation = this.mutationEngine.mutateStrategy(strategy);
        this.strategyRegistry.registerStrategy(variation);
      }
    }

    // Process bottom performers
    for (let i = totalStrategies - bottomPercentile; i < totalStrategies; i++) {
      const score = sortedStrategies[i];
      const strategy = this.strategyRegistry.getStrategy(score.strategyId);
      if (!strategy) continue;

      // Remove or quarantine bottom performers
      if (this.config.quarantineBottomPerformers) {
        strategy.setQuarantined(true);
        this.logger.info(`Quarantined strategy ${strategy.id} due to poor performance`);
      } else {
        this.strategyRegistry.unregisterStrategy(strategy.id);
        this.logger.info(`Removed strategy ${strategy.id} due to poor performance`);
      }
    }
  }
} 