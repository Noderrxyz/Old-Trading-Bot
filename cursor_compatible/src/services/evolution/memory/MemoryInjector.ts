/**
 * Memory Injector Service
 * 
 * Injects successful strategies and their learnings into agent memory
 * to enable meta-learning and knowledge retention across evolutionary cycles.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { EvaluationResult } from '../evaluation/EvaluationResult.js';
import { TradingStrategy } from '../mutation/strategy-model.js';
import { MutationResult } from '../mutation/types.js';
import { PromotionIntent } from '../evaluation/PromotionManager.js';

// Memory entry interface that's compatible with the agent memory system
export interface StrategyMemoryEntry {
  id: string;
  timestamp: number;
  source: 'evolution';
  type: 'strategy_learning';
  agentId: string;
  strategyId: string;
  generationId: string;
  confidence: number;
  content: {
    learnings: StrategyLearning[];
    performanceMetrics: Record<string, number>;
    strategySnapshot: Partial<TradingStrategy>;
  };
  tags: string[];
  metadata: {
    fitnessScore: number;
    promotionId?: string;
    parentStrategyId?: string;
    mutationType?: string;
  };
}

/**
 * Represents a specific learning extracted from a strategy's performance
 */
export interface StrategyLearning {
  id: string;
  insight: string;
  context: string;
  confidence: number;
  supportingMetrics: Record<string, number>;
  applicabilityTags: string[];
}

/**
 * Configuration for Memory Injector
 */
export interface MemoryInjectorConfig {
  /** Minimum fitness score required for memory injection */
  minInjectionScore: number;
  
  /** Maximum number of learnings to extract per strategy */
  maxLearningsPerStrategy: number;
  
  /** Whether to include full strategy snapshots in memory entries */
  includeStrategySnapshots: boolean;
  
  /** Confidence threshold for learnings (0-1) */
  learningConfidenceThreshold: number;
  
  /** Tags to apply to memory entries for retrieval */
  memoryTags: string[];
  
  /** Memory retention time in days (null = permanent) */
  retentionDays: number | null;
}

/**
 * Default configuration for Memory Injector
 */
const DEFAULT_CONFIG: MemoryInjectorConfig = {
  minInjectionScore: 0.75,
  maxLearningsPerStrategy: 5,
  includeStrategySnapshots: true,
  learningConfidenceThreshold: 0.7,
  memoryTags: ['evolution', 'strategy_learning', 'meta_knowledge'],
  retentionDays: 90 // 3 months
};

/**
 * Service that extracts learnings from successful strategies and
 * injects them into agent memory for future use.
 */
export class MemoryInjector {
  private config: MemoryInjectorConfig;
  private agentMemoryService: any; // Will be replaced with actual AgentMemoryService type
  
  /**
   * Create a new MemoryInjector
   * 
   * @param agentMemoryService - Service for storing agent memories
   * @param config - Configuration options
   */
  constructor(
    agentMemoryService: any, // Will be replaced with actual AgentMemoryService type
    config: Partial<MemoryInjectorConfig> = {}
  ) {
    this.agentMemoryService = agentMemoryService;
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`MemoryInjector initialized with minInjectionScore: ${this.config.minInjectionScore}`);
  }
  
  /**
   * Process a promoted strategy and inject its learnings into agent memory
   * 
   * @param promotionIntent - Intent to promote a strategy
   * @param evaluationResult - Evaluation result for the strategy
   * @param mutationResult - Original mutation result
   * @returns Injected memory entry ID or null if not injected
   */
  public async processPromotedStrategy(
    promotionIntent: PromotionIntent,
    evaluationResult: EvaluationResult,
    mutationResult: MutationResult
  ): Promise<string | null> {
    const { strategyId, agentId, fitnessScore, generationId } = promotionIntent;
    const { strategy, parentStrategyId, mutationType } = mutationResult;
    
    // Check if this strategy meets the minimum score requirement
    if (fitnessScore < this.config.minInjectionScore) {
      logger.info(`Strategy ${strategyId} (score: ${fitnessScore}) below minimum injection threshold (${this.config.minInjectionScore})`);
      return null;
    }
    
    try {
      // 1. Extract learnings from the strategy
      const learnings = await this.extractLearnings(strategy, evaluationResult, mutationResult);
      
      if (learnings.length === 0) {
        logger.info(`No significant learnings extracted from strategy ${strategyId}`);
        return null;
      }
      
      // 2. Create memory entry
      const memoryEntry: StrategyMemoryEntry = {
        id: uuidv4(),
        timestamp: Date.now(),
        source: 'evolution',
        type: 'strategy_learning',
        agentId,
        strategyId,
        generationId,
        confidence: this.calculateConfidence(fitnessScore, learnings),
        content: {
          learnings,
          performanceMetrics: this.extractPerformanceMetrics(evaluationResult),
          strategySnapshot: this.config.includeStrategySnapshots 
            ? this.createStrategySnapshot(strategy) 
            : { id: strategy.id, name: strategy.name, version: strategy.version }
        },
        tags: [...this.config.memoryTags],
        metadata: {
          fitnessScore,
          promotionId: promotionIntent.intentId,
          parentStrategyId,
          mutationType: mutationType?.toString()
        }
      };
      
      // 3. Add market condition tags for better retrieval
      if (strategy.marketConditions?.length > 0) {
        strategy.marketConditions.forEach((condition: string) => {
          memoryEntry.tags.push(`market_${condition}`);
        });
      }
      
      // 4. Store in agent memory
      const expiresAt = this.config.retentionDays 
        ? Date.now() + (this.config.retentionDays * 24 * 60 * 60 * 1000)
        : undefined;
        
      await this.agentMemoryService.storeMemory(
        agentId,
        memoryEntry,
        expiresAt
      );
      
      logger.info(`Injected strategy learning memory for ${strategyId} with ${learnings.length} insights`);
      
      return memoryEntry.id;
    } catch (error) {
      logger.error(`Error injecting memory for strategy ${strategyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Extract learnings from a strategy and its performance
   * 
   * @param strategy - The trading strategy
   * @param evaluationResult - Evaluation result
   * @param mutationResult - Mutation result
   * @returns Array of strategy learnings
   */
  private async extractLearnings(
    strategy: TradingStrategy,
    evaluationResult: EvaluationResult,
    mutationResult: MutationResult
  ): Promise<StrategyLearning[]> {
    const learnings: StrategyLearning[] = [];
    
    // 1. Extract learnings from performance metrics
    this.extractPerformanceLearnings(evaluationResult, strategy).forEach(learning => {
      if (learning.confidence >= this.config.learningConfidenceThreshold) {
        learnings.push(learning);
      }
    });
    
    // 2. Extract learnings from mutation improvements
    this.extractMutationLearnings(mutationResult, evaluationResult).forEach(learning => {
      if (learning.confidence >= this.config.learningConfidenceThreshold) {
        learnings.push(learning);
      }
    });
    
    // 3. Extract learnings from strategy configuration
    this.extractConfigurationLearnings(strategy, evaluationResult).forEach(learning => {
      if (learning.confidence >= this.config.learningConfidenceThreshold) {
        learnings.push(learning);
      }
    });
    
    // Limit number of learnings to the configured maximum
    return learnings.sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxLearningsPerStrategy);
  }
  
  /**
   * Extract learnings from performance metrics
   * 
   * @param evaluationResult - Evaluation result
   * @param strategy - The trading strategy
   * @returns Array of strategy learnings
   */
  private extractPerformanceLearnings(
    evaluationResult: EvaluationResult,
    strategy: TradingStrategy
  ): StrategyLearning[] {
    const learnings: StrategyLearning[] = [];
    const { sharpe, maxDrawdown, winRate, volatilityResilience, regretIndex, rawMetrics } = evaluationResult;
    
    // Learning about sharpe ratio
    if (sharpe > 1.5) {
      learnings.push({
        id: uuidv4(),
        insight: `Strong risk-adjusted returns achieved with ${strategy.indicators.rsi ? 'RSI-based' : 'indicator'} signal combination and ${strategy.riskParameters.stopLoss * 100}% stop-loss strategy`,
        context: "High Sharpe ratio indicates good risk-adjusted performance",
        confidence: Math.min(1, 0.7 + (sharpe - 1) * 0.2),
        supportingMetrics: {
          sharpe,
          winRate,
          maxDrawdown
        },
        applicabilityTags: [...strategy.marketConditions || [], 'high_sharpe']
      });
    }
    
    // Learning about drawdown management
    if (maxDrawdown < 0.15) {
      learnings.push({
        id: uuidv4(),
        insight: `Effective drawdown control achieved with ${strategy.riskParameters.stopLoss * 100}% stop-loss and ${strategy.riskParameters.maxPositionSize * 100}% position sizing`,
        context: "Low maximum drawdown indicates good risk management",
        confidence: Math.min(1, 0.7 + (0.2 - maxDrawdown)),
        supportingMetrics: {
          maxDrawdown,
          winRate,
          positionSize: strategy.riskParameters.maxPositionSize
        },
        applicabilityTags: ['risk_management', 'drawdown_control']
      });
    }
    
    // Learning about win rate
    if (winRate > 0.55) {
      learnings.push({
        id: uuidv4(),
        insight: `High win rate strategy using ${strategy.signalSettings.combinationMethod} signal combination with threshold ${strategy.signalSettings.threshold}`,
        context: "Win rate above 55% indicates strong signal quality",
        confidence: Math.min(1, 0.7 + (winRate - 0.5) * 2),
        supportingMetrics: {
          winRate,
          signalThreshold: strategy.signalSettings.threshold,
          signalConfidence: strategy.signalSettings.minConfidence
        },
        applicabilityTags: ['high_winrate', 'signal_quality']
      });
    }
    
    // Learning about volatility resilience
    if (volatilityResilience > 0.7) {
      learnings.push({
        id: uuidv4(),
        insight: `Strategy demonstrates strong resilience to volatility using ${strategy.indicators.bollingerBands ? 'Bollinger Bands' : 'volatility-aware indicators'}`,
        context: "High volatility resilience indicates adaptability to changing market conditions",
        confidence: Math.min(1, 0.7 + (volatilityResilience - 0.6) * 2),
        supportingMetrics: {
          volatilityResilience,
          sharpe,
          winRate
        },
        applicabilityTags: ['volatility_resilient', 'adaptive']
      });
    }
    
    // Add more raw metrics based learnings
    if (rawMetrics) {
      if (rawMetrics.profitFactor > 2) {
        learnings.push({
          id: uuidv4(),
          insight: `Excellent profit factor (${rawMetrics.profitFactor.toFixed(2)}) achieved with asymmetric exit conditions (${strategy.signalSettings.exitConditions.length} conditions)`,
          context: "Profit factor indicates the ratio of gross profits to gross losses",
          confidence: Math.min(1, 0.7 + (rawMetrics.profitFactor - 1.5) * 0.2),
          supportingMetrics: {
            profitFactor: rawMetrics.profitFactor,
            avgProfit: rawMetrics.avgProfit,
            winRate
          },
          applicabilityTags: ['high_profit_factor', 'exit_strategy']
        });
      }
      
      if (rawMetrics.recoveryFactor > 3) {
        learnings.push({
          id: uuidv4(),
          insight: `Strong recovery factor indicating quick recovery from drawdowns using dynamic position sizing`,
          context: "Recovery factor measures how quickly a strategy recovers from drawdowns",
          confidence: Math.min(1, 0.7 + (rawMetrics.recoveryFactor - 2) * 0.1),
          supportingMetrics: {
            recoveryFactor: rawMetrics.recoveryFactor,
            maxDrawdown,
            totalReturn: rawMetrics.totalReturn
          },
          applicabilityTags: ['quick_recovery', 'resilient']
        });
      }
    }
    
    return learnings;
  }
  
  /**
   * Extract learnings from mutation changes
   * 
   * @param mutationResult - Mutation result
   * @param evaluationResult - Evaluation result
   * @returns Array of strategy learnings
   */
  private extractMutationLearnings(
    mutationResult: MutationResult,
    evaluationResult: EvaluationResult
  ): StrategyLearning[] {
    const learnings: StrategyLearning[] = [];
    const { mutation, parentStrategyId } = mutationResult;
    
    // No mutation details available
    if (!mutation || !mutation.operations || mutation.operations.length === 0) {
      return learnings;
    }
    
    // Group operations by path prefix
    const operationsByPrefix: Record<string, any[]> = {};
    
    for (const op of mutation.operations) {
      const pathParts = op.path.split('.');
      const prefix = pathParts[0];
      
      if (!operationsByPrefix[prefix]) {
        operationsByPrefix[prefix] = [];
      }
      
      operationsByPrefix[prefix].push(op);
    }
    
    // Generate learnings for signal settings changes
    if (operationsByPrefix.signalSettings && operationsByPrefix.signalSettings.length > 0) {
      learnings.push({
        id: uuidv4(),
        insight: `Improved signal processing with ${operationsByPrefix.signalSettings.length} signal parameter adjustments resulted in better performance`,
        context: "Signal parameter optimization improved strategy performance",
        confidence: 0.8,
        supportingMetrics: {
          fitnessScore: evaluationResult.fitnessScore,
          mutationCount: operationsByPrefix.signalSettings.length,
          improvementConfidence: mutation.confidence || 0.5
        },
        applicabilityTags: ['signal_optimization', 'parameter_tuning']
      });
    }
    
    // Generate learnings for indicator changes
    if (operationsByPrefix.indicators && operationsByPrefix.indicators.length > 0) {
      learnings.push({
        id: uuidv4(),
        insight: `Indicator parameter tuning (${operationsByPrefix.indicators.length} changes) led to more accurate market condition identification`,
        context: "Tuning indicator parameters improved signal quality",
        confidence: 0.8,
        supportingMetrics: {
          fitnessScore: evaluationResult.fitnessScore,
          winRate: evaluationResult.winRate,
          sharpe: evaluationResult.sharpe
        },
        applicabilityTags: ['indicator_tuning', 'signal_quality']
      });
    }
    
    // Generate learnings for risk parameter changes
    if (operationsByPrefix.riskParameters && operationsByPrefix.riskParameters.length > 0) {
      learnings.push({
        id: uuidv4(),
        insight: `Risk parameter optimization (${operationsByPrefix.riskParameters.length} changes) reduced drawdown while maintaining returns`,
        context: "Optimizing risk parameters improved risk-adjusted performance",
        confidence: 0.8,
        supportingMetrics: {
          maxDrawdown: evaluationResult.maxDrawdown,
          sharpe: evaluationResult.sharpe,
          regretIndex: evaluationResult.regretIndex
        },
        applicabilityTags: ['risk_optimization', 'drawdown_control']
      });
    }
    
    return learnings;
  }
  
  /**
   * Extract learnings from strategy configuration
   * 
   * @param strategy - The trading strategy 
   * @param evaluationResult - Evaluation result
   * @returns Array of strategy learnings
   */
  private extractConfigurationLearnings(
    strategy: TradingStrategy,
    evaluationResult: EvaluationResult
  ): StrategyLearning[] {
    const learnings: StrategyLearning[] = [];
    
    // Extract indicator combinations that work well
    const enabledIndicators = Object.entries(strategy.indicators)
      .filter(([key, indicator]) => indicator && indicator.enabled)
      .map(([key]) => key);
    
    if (enabledIndicators.length >= 2 && evaluationResult.winRate > 0.52) {
      learnings.push({
        id: uuidv4(),
        insight: `Effective multi-indicator strategy combining ${enabledIndicators.join(', ')} with ${strategy.signalSettings.combinationMethod} method`,
        context: "Specific indicator combinations provide stronger signals",
        confidence: Math.min(1, 0.7 + (evaluationResult.winRate - 0.5) * 2),
        supportingMetrics: {
          winRate: evaluationResult.winRate,
          sharpe: evaluationResult.sharpe,
          indicatorCount: enabledIndicators.length
        },
        applicabilityTags: ['indicator_combination', 'multi_factor']
      });
    }
    
    // Extract time settings that work well
    if (evaluationResult.sharpe > 1.2) {
      learnings.push({
        id: uuidv4(),
        insight: `Effective timeframe selection with ${strategy.timeSettings.timeframe} timeframe for ${strategy.marketConditions?.join(', ') || 'various'} market conditions`,
        context: "Appropriate timeframe selection improves signal quality",
        confidence: Math.min(1, 0.7 + (evaluationResult.sharpe - 1) * 0.3),
        supportingMetrics: {
          sharpe: evaluationResult.sharpe,
          winRate: evaluationResult.winRate,
          timeframeValue: this.timeframeToNumeric(strategy.timeSettings.timeframe)
        },
        applicabilityTags: ['timeframe_selection', ...strategy.marketConditions || []]
      });
    }
    
    // Extract entry condition patterns
    if (strategy.signalSettings.entryConditions.length > 1 && evaluationResult.winRate > 0.54) {
      const entryTypes = strategy.signalSettings.entryConditions.map(c => c.type);
      learnings.push({
        id: uuidv4(),
        insight: `Effective entry strategy using combination of ${entryTypes.join(' + ')} conditions`,
        context: "Specific entry condition combinations improve win rate",
        confidence: Math.min(1, 0.7 + (evaluationResult.winRate - 0.5) * 2),
        supportingMetrics: {
          winRate: evaluationResult.winRate,
          entryConditionCount: strategy.signalSettings.entryConditions.length
        },
        applicabilityTags: ['entry_strategy', 'condition_combination']
      });
    }
    
    return learnings;
  }
  
  /**
   * Extract key performance metrics from evaluation result
   * 
   * @param evaluationResult - Evaluation result
   * @returns Object with key performance metrics
   */
  private extractPerformanceMetrics(evaluationResult: EvaluationResult): Record<string, number> {
    const { sharpe, maxDrawdown, winRate, volatilityResilience, regretIndex, rawMetrics } = evaluationResult;
    
    const metrics: Record<string, number> = {
      sharpe,
      maxDrawdown,
      winRate,
      volatilityResilience,
      regretIndex
    };
    
    // Add selected raw metrics if available
    if (rawMetrics) {
      const keysToInclude = [
        'totalReturn', 'tradeCount', 'avgProfit', 'profitFactor', 
        'marketExposure', 'recoveryFactor'
      ];
      
      for (const key of keysToInclude) {
        if (rawMetrics[key] !== undefined) {
          metrics[key] = rawMetrics[key];
        }
      }
    }
    
    return metrics;
  }
  
  /**
   * Create a reduced snapshot of a strategy for memory storage
   * 
   * @param strategy - The trading strategy
   * @returns Partial strategy snapshot with essential details
   */
  private createStrategySnapshot(strategy: TradingStrategy): Partial<TradingStrategy> {
    // Create a minimal strategy snapshot with just the essential components
    return {
      id: strategy.id,
      name: strategy.name,
      version: strategy.version,
      description: strategy.description,
      indicators: strategy.indicators,
      riskParameters: strategy.riskParameters,
      signalSettings: strategy.signalSettings,
      timeSettings: strategy.timeSettings,
      assetClasses: strategy.assetClasses,
      marketConditions: strategy.marketConditions
    };
  }
  
  /**
   * Calculate overall confidence level for the memory entry
   * 
   * @param fitnessScore - Fitness score of the strategy
   * @param learnings - Array of extracted learnings
   * @returns Confidence score between 0-1
   */
  private calculateConfidence(fitnessScore: number, learnings: StrategyLearning[]): number {
    // Base confidence from fitness score
    const baseConfidence = Math.min(1, 0.5 + fitnessScore * 0.5);
    
    // Average confidence from learnings
    const avgLearningConfidence = learnings.reduce((sum, learning) => sum + learning.confidence, 0) / learnings.length;
    
    // Combined confidence (60% fitness score, 40% learning confidence)
    return baseConfidence * 0.6 + avgLearningConfidence * 0.4;
  }
  
  /**
   * Update configuration options
   * 
   * @param config - Partial configuration to update
   */
  public updateConfig(config: Partial<MemoryInjectorConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    logger.info(`MemoryInjector configuration updated: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Convert timeframe string to numeric value in minutes for metrics
   * 
   * @param timeframe - Timeframe string (e.g., '1m', '1h', '1d')
   * @returns Numeric value in minutes
   */
  private timeframeToNumeric(timeframe: string): number {
    const match = timeframe.match(/(\d+)([mhd])/);
    
    if (!match) {
      return 60; // Default to 60 minutes if format not recognized
    }
    
    const [_, value, unit] = match;
    const numValue = parseInt(value, 10);
    
    switch (unit) {
      case 'm': return numValue;
      case 'h': return numValue * 60;
      case 'd': return numValue * 24 * 60;
      default: return 60;
    }
  }
} 