/**
 * Strategy Mutation Engine
 * 
 * Responsible for generating, validating, and applying mutations to trading strategies.
 * Supports adaptive mutation intensity and directed mutation based on historical performance.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import { 
  TradingStrategy,
  MutationResult,
  EvolutionStats,
  FitnessStats
} from './types.js';
import { StrategyMemoryVault } from './strategy_memory_vault.js';

/**
 * Mutation engine configuration
 */
export interface MutationEngineConfig {
  enabled: boolean;
  populationSize: number;
  eliteCount: number;
  baseMutationRates: {
    indicators: number;
    entryConditions: number;
    exitConditions: number;
    riskParameters: number;
    timeSettings: number;
  };
  crossoverRate: number;
  selectionPressure: number;
  maxGenerations: number;
  fitnessWeights: {
    returns: number;
    sharpeRatio: number;
    drawdown: number;
    winRate: number;
    profitFactor: number;
  };
  adaptiveMutation: {
    enabled: boolean;
    performanceWindow: number; // Number of generations to consider
    targetImprovement: number; // Target improvement per generation
    maxMutationRate: number; // Maximum mutation rate
    minMutationRate: number; // Minimum mutation rate
  };
  directedMutation: {
    enabled: boolean;
    memoryBiasStrength: number; // How much to bias towards historical bests
    parameterRegionSize: number; // Size of parameter region to favor
  };
}

/**
 * Default mutation engine configuration
 */
export const DEFAULT_MUTATION_ENGINE_CONFIG: MutationEngineConfig = {
  enabled: true,
  populationSize: 20,
  eliteCount: 2,
  baseMutationRates: {
    indicators: 0.3,
    entryConditions: 0.4,
    exitConditions: 0.35,
    riskParameters: 0.25,
    timeSettings: 0.15
  },
  crossoverRate: 0.7,
  selectionPressure: 1.5,
  maxGenerations: 30,
  fitnessWeights: {
    returns: 1.0,
    sharpeRatio: 1.5,
    drawdown: -1.0,
    winRate: 0.8,
    profitFactor: 1.0
  },
  adaptiveMutation: {
    enabled: true,
    performanceWindow: 5,
    targetImprovement: 0.01,
    maxMutationRate: 0.5,
    minMutationRate: 0.1
  },
  directedMutation: {
    enabled: true,
    memoryBiasStrength: 0.3,
    parameterRegionSize: 0.1
  }
};

/**
 * Strategy Mutation Engine
 */
export class MutationEngine {
  private static instance: MutationEngine | null = null;
  private config: MutationEngineConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[MutationEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[MutationEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[MutationEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[MutationEngine] ${msg}`, ...args)
  };
  private memoryVault: StrategyMemoryVault | null = null;
  private isRunning: boolean = false;
  private generationInterval: NodeJS.Timeout | null = null;
  private population: TradingStrategy[] = [];
  private stats: EvolutionStats;
  private recentPerformance: number[] = [];

  /**
   * Get singleton instance
   */
  public static getInstance(): MutationEngine {
    if (!MutationEngine.instance) {
      MutationEngine.instance = new MutationEngine();
    }
    return MutationEngine.instance;
  }

  constructor(config: Partial<MutationEngineConfig> = {}) {
    this.config = { ...DEFAULT_MUTATION_ENGINE_CONFIG, ...config };
    this.stats = {
      generation: 0,
      populationSize: 0,
      averageFitness: 0,
      bestFitness: 0,
      mutationRate: this.getBaseMutationRate(),
      crossoverRate: this.config.crossoverRate,
      timestamp: Date.now()
    };
  }

  /**
   * Set memory vault instance
   */
  public setMemoryVault(vault: StrategyMemoryVault): void {
    this.memoryVault = vault;
  }

  /**
   * Get base mutation rate
   */
  private getBaseMutationRate(): number {
    return Object.values(this.config.baseMutationRates).reduce((a, b) => a + b, 0) / 
      Object.keys(this.config.baseMutationRates).length;
  }

  /**
   * Calculate adaptive mutation rate based on recent performance
   */
  private calculateAdaptiveMutationRate(): number {
    if (!this.config.adaptiveMutation.enabled || this.recentPerformance.length < 2) {
      return this.getBaseMutationRate();
    }

    // Calculate average improvement over performance window
    const window = this.recentPerformance.slice(-this.config.adaptiveMutation.performanceWindow);
    const improvements = window.slice(1).map((score, i) => score - window[i]);
    const avgImprovement = improvements.reduce((a, b) => a + b, 0) / improvements.length;

    // Adjust mutation rate based on performance
    let mutationRate = this.getBaseMutationRate();
    if (avgImprovement < this.config.adaptiveMutation.targetImprovement) {
      // Increase mutation rate if performance is below target
      mutationRate = Math.min(
        this.config.adaptiveMutation.maxMutationRate,
        mutationRate * (1 + (this.config.adaptiveMutation.targetImprovement - avgImprovement))
      );
    } else {
      // Decrease mutation rate if performance is above target
      mutationRate = Math.max(
        this.config.adaptiveMutation.minMutationRate,
        mutationRate * (1 - (avgImprovement - this.config.adaptiveMutation.targetImprovement))
      );
    }

    this.logger.debug(
      `Adaptive mutation rate: ${mutationRate.toFixed(3)} ` +
      `(avg improvement: ${avgImprovement.toFixed(3)})`
    );

    return mutationRate;
  }

  /**
   * Apply directed mutation based on historical bests
   */
  private async applyDirectedMutation(strategy: TradingStrategy): Promise<TradingStrategy> {
    if (!this.config.directedMutation.enabled || !this.memoryVault) {
      return strategy;
    }

    try {
      const memoryBias = await this.memoryVault.getMemoryBias();
      if (memoryBias.length === 0) {
        return strategy;
      }

      // Select a random historical best strategy
      const referenceStrategy = memoryBias[Math.floor(Math.random() * memoryBias.length)];
      
      // Create a mutated copy
      const mutated = JSON.parse(JSON.stringify(strategy));

      // Bias parameters towards reference strategy
      if (Math.random() < this.config.directedMutation.memoryBiasStrength) {
        // Bias indicator parameters
        for (const [indicator, params] of Object.entries(referenceStrategy.indicators)) {
          if (mutated.indicators[indicator]) {
            for (const [param, value] of Object.entries(params)) {
              if (typeof value === 'number' && param !== 'enabled') {
                const region = this.config.directedMutation.parameterRegionSize;
                const min = value * (1 - region);
                const max = value * (1 + region);
                mutated.indicators[indicator][param] = min + Math.random() * (max - min);
              }
            }
          }
        }

        // Bias risk parameters
        for (const [param, value] of Object.entries(referenceStrategy.riskParameters)) {
          const region = this.config.directedMutation.parameterRegionSize;
          const min = value * (1 - region);
          const max = value * (1 + region);
          mutated.riskParameters[param] = min + Math.random() * (max - min);
        }
      }

      return mutated;
    } catch (error) {
      this.logger.error('Failed to apply directed mutation', error);
      return strategy;
    }
  }

  /**
   * Mutate indicator parameters
   */
  private mutateIndicatorParameters(strategy: TradingStrategy): TradingStrategy {
    const mutated = JSON.parse(JSON.stringify(strategy));
    
    // Example: mutate RSI parameters
    if (mutated.indicators.rsi && mutated.indicators.rsi.enabled) {
      if (Math.random() < 0.5) {
        mutated.indicators.rsi.period = Math.max(2, Math.min(50, mutated.indicators.rsi.period + Math.floor(Math.random() * 5) - 2));
      }
      if (Math.random() < 0.3) {
        mutated.indicators.rsi.overbought = Math.max(60, Math.min(90, mutated.indicators.rsi.overbought + Math.floor(Math.random() * 7) - 3));
      }
      if (Math.random() < 0.3) {
        mutated.indicators.rsi.oversold = Math.max(10, Math.min(40, mutated.indicators.rsi.oversold + Math.floor(Math.random() * 7) - 3));
      }
    }
    
    // Example: mutate MACD parameters
    if (mutated.indicators.macd && mutated.indicators.macd.enabled) {
      if (Math.random() < 0.4) {
        mutated.indicators.macd.fastPeriod = Math.max(3, Math.min(30, mutated.indicators.macd.fastPeriod + Math.floor(Math.random() * 5) - 2));
      }
      if (Math.random() < 0.4) {
        mutated.indicators.macd.slowPeriod = Math.max(mutated.indicators.macd.fastPeriod + 1, Math.min(50, mutated.indicators.macd.slowPeriod + Math.floor(Math.random() * 7) - 3));
      }
      if (Math.random() < 0.3) {
        mutated.indicators.macd.signalPeriod = Math.max(2, Math.min(20, mutated.indicators.macd.signalPeriod + Math.floor(Math.random() * 3) - 1));
      }
    }
    
    return mutated;
  }

  /**
   * Mutate entry conditions
   */
  private mutateEntryConditions(strategy: TradingStrategy): TradingStrategy {
    const mutated = JSON.parse(JSON.stringify(strategy));
    
    if (mutated.entryConditions.conditions.length > 0) {
      const randomConditionIndex = Math.floor(Math.random() * mutated.entryConditions.conditions.length);
      const condition = mutated.entryConditions.conditions[randomConditionIndex];
      
      // Mutate the selected condition
      if (Math.random() < 0.4) {
        // Mutate comparison value
        if (condition.value !== undefined) {
          condition.value = condition.value + (Math.random() * 10) - 5;
        }
      }
      
      if (Math.random() < 0.3) {
        // Mutate comparison operator
        const operators = ['ABOVE', 'BELOW', 'EQUAL', 'CROSS_ABOVE', 'CROSS_BELOW'];
        const currentIndex = operators.indexOf(condition.comparison);
        const newIndex = Math.floor(Math.random() * operators.length);
        condition.comparison = operators[newIndex !== currentIndex ? newIndex : (newIndex + 1) % operators.length];
      }
    }
    
    // Occasionally change logic operator
    if (Math.random() < 0.2) {
      mutated.entryConditions.logicOperator = mutated.entryConditions.logicOperator === 'AND' ? 'OR' : 'AND';
    }
    
    return mutated;
  }

  /**
   * Mutate exit conditions
   */
  private mutateExitConditions(strategy: TradingStrategy): TradingStrategy {
    const mutated = JSON.parse(JSON.stringify(strategy));
    
    if (mutated.exitConditions.conditions.length > 0) {
      const randomConditionIndex = Math.floor(Math.random() * mutated.exitConditions.conditions.length);
      const condition = mutated.exitConditions.conditions[randomConditionIndex];
      
      // Mutate the selected condition
      if (Math.random() < 0.4 && condition.value !== undefined) {
        // Mutate comparison value
        condition.value = condition.value + (Math.random() * 10) - 5;
      }
      
      if (Math.random() < 0.3 && condition.referenceMultiplier !== undefined) {
        // Mutate reference multiplier for stop loss/take profit
        condition.referenceMultiplier = Math.max(0.5, Math.min(5, condition.referenceMultiplier + (Math.random() - 0.5)));
      }
    }
    
    return mutated;
  }

  /**
   * Mutate risk parameters
   */
  private mutateRiskParameters(strategy: TradingStrategy): TradingStrategy {
    const mutated = JSON.parse(JSON.stringify(strategy));
    const risk = mutated.riskParameters;
    
    // Mutate position size
    if (Math.random() < 0.4) {
      risk.positionSizePercent = Math.max(0.01, Math.min(0.2, risk.positionSizePercent + (Math.random() * 0.04) - 0.02));
    }
    
    // Mutate stop loss
    if (Math.random() < 0.4) {
      risk.stopLossPercent = Math.max(0.01, Math.min(0.15, risk.stopLossPercent + (Math.random() * 0.03) - 0.015));
    }
    
    // Mutate take profit
    if (Math.random() < 0.4) {
      risk.takeProfitPercent = Math.max(0.01, Math.min(0.3, risk.takeProfitPercent + (Math.random() * 0.05) - 0.025));
    }
    
    // Mutate max open positions
    if (Math.random() < 0.3) {
      risk.maxOpenPositions = Math.max(1, Math.min(10, risk.maxOpenPositions + Math.floor(Math.random() * 3) - 1));
    }
    
    return mutated;
  }

  /**
   * Mutate timeframe settings
   */
  private mutateTimeSettings(strategy: TradingStrategy): TradingStrategy {
    const mutated = JSON.parse(JSON.stringify(strategy));
    
    if (Math.random() < 0.3) {
      const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      const currentIndex = timeframes.indexOf(mutated.timeSettings.timeframe);
      
      if (currentIndex !== -1) {
        // Shift up or down by 1-2 positions in the timeframe array
        const shift = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
        const newIndex = Math.max(0, Math.min(timeframes.length - 1, currentIndex + shift));
        mutated.timeSettings.timeframe = timeframes[newIndex];
      }
    }
    
    return mutated;
  }

  /**
   * Mutate a strategy
   */
  public async mutateStrategy(strategy: TradingStrategy): Promise<MutationResult> {
    if (!this.config.enabled) {
      return { success: false, strategy, error: 'Mutation engine is disabled' };
    }

    try {
      // Apply adaptive mutation rate
      const mutationRate = this.calculateAdaptiveMutationRate();
      
      // Create a mutated copy
      let mutated = JSON.parse(JSON.stringify(strategy));
      
      // Apply directed mutation
      mutated = await this.applyDirectedMutation(mutated);
      
      // Apply random mutations based on mutation rate
      if (Math.random() < mutationRate * this.config.baseMutationRates.indicators) {
        mutated = this.mutateIndicatorParameters(mutated);
      }
      
      if (Math.random() < mutationRate * this.config.baseMutationRates.entryConditions) {
        mutated = this.mutateEntryConditions(mutated);
      }
      
      if (Math.random() < mutationRate * this.config.baseMutationRates.exitConditions) {
        mutated = this.mutateExitConditions(mutated);
      }
      
      if (Math.random() < mutationRate * this.config.baseMutationRates.riskParameters) {
        mutated = this.mutateRiskParameters(mutated);
      }
      
      if (Math.random() < mutationRate * this.config.baseMutationRates.timeSettings) {
        mutated = this.mutateTimeSettings(mutated);
      }

      // Update strategy metadata
      mutated.id = uuidv4();
      mutated.version = (strategy.version || 0) + 1;
      mutated.parentId = strategy.id;
      mutated.createdAt = new Date().toISOString();
      mutated.updatedAt = new Date().toISOString();

      return { success: true, strategy: mutated };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to mutate strategy', error);
      return { success: false, strategy, error: errorMessage };
    }
  }

  /**
   * Update recent performance history
   */
  private updatePerformanceHistory(score: number): void {
    this.recentPerformance.push(score);
    if (this.recentPerformance.length > this.config.adaptiveMutation.performanceWindow) {
      this.recentPerformance.shift();
    }
  }

  /**
   * Get current mutation engine statistics
   */
  public getStats(): EvolutionStats {
    return { ...this.stats };
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    if (this.generationInterval) {
      clearInterval(this.generationInterval);
      this.generationInterval = null;
    }
    this.isRunning = false;
    this.population = [];
    this.recentPerformance = [];
  }
} 