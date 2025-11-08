import logger from '../utils/logger.js';
import { AlphaSnapshot, AlphaMetrics, MarketRegime } from '../types/AlphaSnapshot.js';

interface MutationConfig {
  mutationRate: number;
  mutationStrength: number;
  maxMutations: number;
  minConfidence: number;
  successThreshold: number;
}

const DEFAULT_CONFIG: MutationConfig = {
  mutationRate: 0.2, // 20% chance of mutation
  mutationStrength: 0.1, // 10% parameter change
  maxMutations: 5,
  minConfidence: 0.7,
  successThreshold: 0.05 // 5% improvement required
};

export class BiasedMutationEngine {
  private static instance: BiasedMutationEngine;
  private config: MutationConfig;
  private mutationHistory: Map<string, number>;
  private successHistory: Map<string, boolean[]>;

  private constructor(config: Partial<MutationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mutationHistory = new Map();
    this.successHistory = new Map();
  }

  public static getInstance(config?: Partial<MutationConfig>): BiasedMutationEngine {
    if (!BiasedMutationEngine.instance) {
      BiasedMutationEngine.instance = new BiasedMutationEngine(config);
    }
    return BiasedMutationEngine.instance;
  }

  public async mutateStrategy(
    strategy: AlphaSnapshot,
    currentMetrics: AlphaMetrics,
    regime: MarketRegime
  ): Promise<AlphaSnapshot | null> {
    const mutationCount = this.mutationHistory.get(strategy.id) || 0;
    
    if (mutationCount >= this.config.maxMutations) {
      logger.warn(`Strategy ${strategy.id} has reached max mutations`);
      return null;
    }

    const successRate = this.calculateSuccessRate(strategy.id);
    if (successRate < this.config.minConfidence && mutationCount > 2) {
      logger.warn(`Strategy ${strategy.id} has low success rate: ${successRate}`);
      return null;
    }

    const mutationBias = this.calculateMutationBias(currentMetrics, strategy.metrics);
    if (Math.random() > this.config.mutationRate * mutationBias) {
      return null;
    }

    // Create mutated strategy
    const mutatedStrategy: AlphaSnapshot = {
      ...strategy,
      id: `${strategy.id}_mut_${mutationCount + 1}`,
      parentId: strategy.id,
      metrics: this.mutateTradingParameters(strategy.metrics, mutationBias),
      tags: [...strategy.tags, 'mutated'],
      lineage: [...strategy.lineage, 'mutated']
    };

    // Update mutation history
    this.mutationHistory.set(strategy.id, mutationCount + 1);

    logger.info(`Created mutated strategy ${mutatedStrategy.id} with bias ${mutationBias}`);
    return mutatedStrategy;
  }

  public recordMutationResult(strategyId: string, success: boolean): void {
    const history = this.successHistory.get(strategyId) || [];
    history.push(success);
    this.successHistory.set(strategyId, history);
  }

  private calculateSuccessRate(strategyId: string): number {
    const history = this.successHistory.get(strategyId);
    if (!history || history.length === 0) return 1;
    
    const successes = history.filter(success => success).length;
    return successes / history.length;
  }

  private calculateMutationBias(current: AlphaMetrics, original: AlphaMetrics): number {
    const performanceDiff = (
      (current.sharpeRatio - original.sharpeRatio) / Math.abs(original.sharpeRatio) +
      (current.winRate - original.winRate) / Math.abs(original.winRate) +
      (original.maxDrawdown - current.maxDrawdown) / Math.abs(original.maxDrawdown)
    ) / 3;

    // Increase mutation rate for poor performance
    if (performanceDiff < -this.config.successThreshold) {
      return 2.0;
    }
    
    // Decrease mutation rate for good performance
    if (performanceDiff > this.config.successThreshold) {
      return 0.5;
    }

    return 1.0;
  }

  private mutateTradingParameters(metrics: AlphaMetrics, bias: number): AlphaMetrics {
    const mutationStrength = this.config.mutationStrength * bias;
    const randomChange = () => (Math.random() - 0.5) * 2 * mutationStrength;

    return {
      ...metrics,
      roi: metrics.roi * (1 + randomChange()),
      sharpeRatio: metrics.sharpeRatio * (1 + randomChange()),
      maxDrawdown: metrics.maxDrawdown * (1 + randomChange()),
      trust: metrics.trust * (1 + randomChange()),
      volatility: metrics.volatility * (1 + randomChange()),
      winRate: metrics.winRate * (1 + randomChange()),
      avgTradeDuration: metrics.avgTradeDuration * (1 + randomChange())
    };
  }

  public cleanup(): void {
    this.mutationHistory.clear();
    this.successHistory.clear();
  }
} 