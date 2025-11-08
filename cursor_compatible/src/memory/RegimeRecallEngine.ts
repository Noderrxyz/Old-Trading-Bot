import logger from '../utils/logger.js';
import { AlphaMemoryEngine } from './AlphaMemoryEngine.js';
import { RegimeClassifier } from './models/RegimeClassifier.js';
import { MarketRegime, AlphaSnapshot, AlphaMetrics } from '../types/AlphaSnapshot.js';

interface RecallConfig {
  minConfidence: number;
  adaptationThreshold: number;
  maxAdaptations: number;
  decayFactor: number;
}

const DEFAULT_CONFIG: RecallConfig = {
  minConfidence: 0.7,
  adaptationThreshold: 0.1, // 10% performance difference triggers adaptation
  maxAdaptations: 3,
  decayFactor: 0.95 // 5% decay per adaptation
};

export class RegimeRecallEngine {
  private static instance: RegimeRecallEngine;
  private config: RecallConfig;
  private memoryEngine: AlphaMemoryEngine;
  private regimeClassifier: RegimeClassifier;
  private currentStrategy: AlphaSnapshot | null;
  private adaptationCount: number;

  private constructor(config: Partial<RecallConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memoryEngine = AlphaMemoryEngine.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.currentStrategy = null;
    this.adaptationCount = 0;
  }

  public static getInstance(config?: Partial<RecallConfig>): RegimeRecallEngine {
    if (!RegimeRecallEngine.instance) {
      RegimeRecallEngine.instance = new RegimeRecallEngine(config);
    }
    return RegimeRecallEngine.instance;
  }

  public async recallStrategy(): Promise<AlphaSnapshot | null> {
    const { regime, confidence } = this.regimeClassifier.getCurrentRegime();
    
    if (confidence < this.config.minConfidence) {
      logger.warn('Regime confidence too low for strategy recall');
      return null;
    }

    // Query memory for best performing strategy in current regime
    const candidates = await this.memoryEngine.querySnapshots({
      regime,
      minSharpeRatio: 1.0,
      minTrust: 0.7
    });

    if (candidates.length === 0) {
      logger.warn('No suitable strategies found for current regime');
      return null;
    }

    // Select best performing strategy
    const bestStrategy = candidates.reduce((best: AlphaSnapshot, current: AlphaSnapshot) => {
      const bestScore = this.calculateStrategyScore(best);
      const currentScore = this.calculateStrategyScore(current);
      return currentScore > bestScore ? current : best;
    });

    this.currentStrategy = bestStrategy;
    this.adaptationCount = 0;

    logger.info(`Recalled strategy for ${regime} regime: ${bestStrategy.strategy}`);
    return bestStrategy;
  }

  public async adaptStrategy(performanceMetrics: AlphaMetrics): Promise<AlphaSnapshot | null> {
    if (!this.currentStrategy) {
      logger.warn('No current strategy to adapt');
      return null;
    }

    const performanceDiff = this.calculatePerformanceDifference(
      this.currentStrategy.metrics,
      performanceMetrics
    );

    if (Math.abs(performanceDiff) < this.config.adaptationThreshold) {
      return this.currentStrategy;
    }

    if (this.adaptationCount >= this.config.maxAdaptations) {
      logger.warn('Max adaptations reached, recalling new strategy');
      return this.recallStrategy();
    }

    // Create adapted strategy
    const adaptedStrategy: AlphaSnapshot = {
      ...this.currentStrategy,
      id: `${this.currentStrategy.id}_adapt_${this.adaptationCount + 1}`,
      parentId: this.currentStrategy.id,
      metrics: this.adaptMetrics(this.currentStrategy.metrics, performanceDiff),
      tags: [...this.currentStrategy.tags, 'adapted'],
      lineage: [...this.currentStrategy.lineage, 'adapted']
    };

    // Save adapted strategy
    await this.memoryEngine.saveSnapshot(adaptedStrategy);
    
    this.currentStrategy = adaptedStrategy;
    this.adaptationCount++;

    logger.info(`Adapted strategy ${adaptedStrategy.id} with performance diff: ${performanceDiff}`);
    return adaptedStrategy;
  }

  private calculateStrategyScore(strategy: AlphaSnapshot): number {
    const { metrics } = strategy;
    const decay = Math.pow(this.config.decayFactor, this.adaptationCount);
    
    return (
      metrics.sharpeRatio * 0.4 +
      metrics.trust * 0.3 +
      metrics.winRate * 0.2 +
      (1 - metrics.maxDrawdown) * 0.1
    ) * decay;
  }

  private calculatePerformanceDifference(
    original: AlphaMetrics,
    current: AlphaMetrics
  ): number {
    const originalScore = this.calculateStrategyScore({ metrics: original } as AlphaSnapshot);
    const currentScore = this.calculateStrategyScore({ metrics: current } as AlphaSnapshot);
    
    return (currentScore - originalScore) / originalScore;
  }

  private adaptMetrics(original: AlphaMetrics, performanceDiff: number): AlphaMetrics {
    const adaptationFactor = 1 + (performanceDiff * 0.5); // Dampen the adaptation
    const decay = Math.pow(this.config.decayFactor, this.adaptationCount);

    return {
      ...original,
      roi: original.roi * adaptationFactor * decay,
      sharpeRatio: original.sharpeRatio * adaptationFactor * decay,
      maxDrawdown: original.maxDrawdown * (2 - adaptationFactor) * decay,
      trust: original.trust * decay,
      volatility: original.volatility * (2 - adaptationFactor) * decay,
      winRate: original.winRate * adaptationFactor * decay,
      avgTradeDuration: original.avgTradeDuration * (2 - adaptationFactor) * decay
    };
  }

  public getCurrentStrategy(): AlphaSnapshot | null {
    return this.currentStrategy;
  }

  public cleanup(): void {
    this.currentStrategy = null;
    this.adaptationCount = 0;
  }
} 