/**
 * Multi-Objective Strategy Scorer
 * 
 * Evaluates trading strategies based on multiple weighted metrics to find robust,
 * well-performing strategies rather than just lucky ones.
 */

import logger from '../utils/logger.js';
import { TradingStrategy } from './types.js';

/**
 * Configuration for multi-objective scoring
 */
export interface MultiObjectiveScorerConfig {
  weights: {
    netProfit: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    timeToAlpha: number;
  };
  minTradesForEvaluation: number;
  timeToAlphaThreshold: number; // Days
}

/**
 * Default configuration for multi-objective scoring
 */
export const DEFAULT_MULTI_OBJECTIVE_SCORER_CONFIG: MultiObjectiveScorerConfig = {
  weights: {
    netProfit: 0.4,
    maxDrawdown: -0.2,
    sharpeRatio: 0.3,
    winRate: 0.2,
    timeToAlpha: -0.1
  },
  minTradesForEvaluation: 10,
  timeToAlphaThreshold: 30 // Days
};

/**
 * Multi-objective scorer for trading strategies
 */
export class MultiObjectiveScorer {
  private readonly config: MultiObjectiveScorerConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[MultiObjectiveScorer] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[MultiObjectiveScorer] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[MultiObjectiveScorer] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[MultiObjectiveScorer] ${msg}`, ...args)
  };

  constructor(config: Partial<MultiObjectiveScorerConfig> = {}) {
    this.config = { ...DEFAULT_MULTI_OBJECTIVE_SCORER_CONFIG, ...config };
    this.validateWeights();
  }

  /**
   * Validate that weights sum to 1.0
   */
  private validateWeights(): void {
    const sum = Object.values(this.config.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.0001) {
      throw new Error(`Weights must sum to 1.0, got ${sum}`);
    }
  }

  /**
   * Calculate normalized score for a metric
   * @param value Raw metric value
   * @param min Minimum value in population
   * @param max Maximum value in population
   * @returns Normalized score between 0 and 1
   */
  private normalizeScore(value: number, min: number, max: number): number {
    if (min === max) return 0.5;
    return (value - min) / (max - min);
  }

  /**
   * Calculate time-to-alpha score
   * @param strategy Strategy to evaluate
   * @returns Time-to-alpha score
   */
  private calculateTimeToAlphaScore(strategy: TradingStrategy): number {
    if (!strategy.performance?.firstProfitDate) return 0;
    
    const firstProfitDate = new Date(strategy.performance.firstProfitDate);
    const creationDate = new Date(strategy.createdAt);
    const daysToProfit = (firstProfitDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // Lower score for longer time to profit
    return Math.max(0, 1 - (daysToProfit / this.config.timeToAlphaThreshold));
  }

  /**
   * Evaluate a single strategy
   * @param strategy Strategy to evaluate
   * @param populationStats Population statistics for normalization
   * @returns Composite score
   */
  public evaluateStrategy(
    strategy: TradingStrategy,
    populationStats: {
      minNetProfit: number;
      maxNetProfit: number;
      minMaxDrawdown: number;
      maxMaxDrawdown: number;
      minSharpeRatio: number;
      maxSharpeRatio: number;
      minWinRate: number;
      maxWinRate: number;
    }
  ): number {
    if (!strategy.performance || strategy.performance.totalTrades < this.config.minTradesForEvaluation) {
      this.logger.debug(`Strategy ${strategy.id} has insufficient trades for evaluation`);
      return 0;
    }

    const {
      netProfit,
      maxDrawdown,
      sharpeRatio,
      winRate
    } = strategy.performance;

    // Calculate normalized scores
    const netProfitScore = this.normalizeScore(netProfit, populationStats.minNetProfit, populationStats.maxNetProfit);
    const maxDrawdownScore = this.normalizeScore(maxDrawdown, populationStats.minMaxDrawdown, populationStats.maxMaxDrawdown);
    const sharpeRatioScore = this.normalizeScore(sharpeRatio, populationStats.minSharpeRatio, populationStats.maxSharpeRatio);
    const winRateScore = this.normalizeScore(winRate, populationStats.minWinRate, populationStats.maxWinRate);
    const timeToAlphaScore = this.calculateTimeToAlphaScore(strategy);

    // Calculate weighted composite score
    const compositeScore = 
      this.config.weights.netProfit * netProfitScore +
      this.config.weights.maxDrawdown * maxDrawdownScore +
      this.config.weights.sharpeRatio * sharpeRatioScore +
      this.config.weights.winRate * winRateScore +
      this.config.weights.timeToAlpha * timeToAlphaScore;

    this.logger.debug(
      `Strategy ${strategy.id} scores: ` +
      `Net Profit: ${netProfitScore.toFixed(3)}, ` +
      `Max Drawdown: ${maxDrawdownScore.toFixed(3)}, ` +
      `Sharpe: ${sharpeRatioScore.toFixed(3)}, ` +
      `Win Rate: ${winRateScore.toFixed(3)}, ` +
      `Time to Alpha: ${timeToAlphaScore.toFixed(3)}, ` +
      `Composite: ${compositeScore.toFixed(3)}`
    );

    return compositeScore;
  }

  /**
   * Evaluate a population of strategies
   * @param strategies Strategies to evaluate
   * @returns Array of strategies with updated scores
   */
  public evaluatePopulation(strategies: TradingStrategy[]): TradingStrategy[] {
    if (strategies.length === 0) {
      this.logger.warn('No strategies provided for evaluation');
      return [];
    }

    // Calculate population statistics for normalization
    const populationStats = {
      minNetProfit: Math.min(...strategies.map(s => s.performance?.netProfit || 0)),
      maxNetProfit: Math.max(...strategies.map(s => s.performance?.netProfit || 0)),
      minMaxDrawdown: Math.min(...strategies.map(s => s.performance?.maxDrawdown || 0)),
      maxMaxDrawdown: Math.max(...strategies.map(s => s.performance?.maxDrawdown || 0)),
      minSharpeRatio: Math.min(...strategies.map(s => s.performance?.sharpeRatio || 0)),
      maxSharpeRatio: Math.max(...strategies.map(s => s.performance?.sharpeRatio || 0)),
      minWinRate: Math.min(...strategies.map(s => s.performance?.winRate || 0)),
      maxWinRate: Math.max(...strategies.map(s => s.performance?.winRate || 0))
    };

    // Evaluate each strategy
    return strategies.map(strategy => {
      const score = this.evaluateStrategy(strategy, populationStats);
      return {
        ...strategy,
        fitness: {
          ...strategy.fitness,
          overallScore: score
        }
      };
    });
  }
} 