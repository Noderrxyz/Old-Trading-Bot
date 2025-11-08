/**
 * Fitness Scorer
 * 
 * Calculates fitness scores for evaluated strategies based on their performance metrics.
 */

import { EvaluationResult } from './EvaluationResult.js';
import logger from '../../../utils/logger.js';

/**
 * Configuration options for the fitness scorer
 */
export interface FitnessScorerConfig {
  /** Minimum fitness score required to pass evaluation */
  minFitnessThreshold: number;
  
  /** Weight for Sharpe ratio in fitness calculation */
  sharpeWeight: number;
  
  /** Weight for max drawdown in fitness calculation */
  drawdownWeight: number;
  
  /** Weight for win rate in fitness calculation */
  winRateWeight: number;
  
  /** Weight for volatility resilience in fitness calculation */
  volatilityResilienceWeight: number;
  
  /** Weight for regret index in fitness calculation */
  regretIndexWeight: number;
}

/**
 * Default fitness scorer configuration
 */
const DEFAULT_CONFIG: FitnessScorerConfig = {
  minFitnessThreshold: 0.65,
  sharpeWeight: 0.4,
  drawdownWeight: 0.2,
  winRateWeight: 0.2,
  volatilityResilienceWeight: 0.1,
  regretIndexWeight: 0.1
};

/**
 * Service to calculate fitness scores for evaluated strategies
 */
export class FitnessScorer {
  private config: FitnessScorerConfig;
  
  /**
   * Create a new FitnessScorer instance
   * 
   * @param config - Configuration options
   */
  constructor(config: Partial<FitnessScorerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`FitnessScorer initialized with threshold: ${this.config.minFitnessThreshold}`);
  }
  
  /**
   * Calculate the fitness score for an evaluation result
   * 
   * @param result - Partial evaluation result with performance metrics
   * @returns Complete evaluation result with fitness score and pass status
   */
  public calculateFitness(result: Omit<EvaluationResult, 'fitnessScore' | 'passed'>): EvaluationResult {
    // Ensure key metrics are within expected ranges
    const normalizedResult = this.normalizeMetrics(result);
    
    // Calculate the weighted fitness score using the formula:
    // fitnessScore = (sharpe * w1) + (1 - maxDrawdown) * w2 + (winRate * w3) + (volatilityResilience * w4) - (regretIndex * w5)
    const fitnessScore = 
      (normalizedResult.sharpe * this.config.sharpeWeight) +
      ((1 - normalizedResult.maxDrawdown) * this.config.drawdownWeight) +
      (normalizedResult.winRate * this.config.winRateWeight) +
      (normalizedResult.volatilityResilience * this.config.volatilityResilienceWeight) -
      (normalizedResult.regretIndex * this.config.regretIndexWeight);
    
    // Round to 4 decimal places for consistency
    const roundedScore = Math.round(fitnessScore * 10000) / 10000;
    
    // Determine if the score passes the threshold
    const passed = roundedScore >= this.config.minFitnessThreshold;
    
    logger.info(`Strategy ${result.strategyId} fitness score: ${roundedScore} (passed: ${passed})`);
    
    return {
      ...result,
      fitnessScore: roundedScore,
      passed
    };
  }
  
  /**
   * Normalize metrics to ensure they're within expected ranges
   * 
   * @param result - Evaluation result
   * @returns Normalized evaluation result
   */
  private normalizeMetrics(result: Omit<EvaluationResult, 'fitnessScore' | 'passed'>): Omit<EvaluationResult, 'fitnessScore' | 'passed'> {
    // Create a copy to avoid modifying the original
    const normalized = { ...result };
    
    // Clamp sharpe ratio to a reasonable range (-3 to 5)
    normalized.sharpe = Math.max(-3, Math.min(5, normalized.sharpe));
    // Normalize sharpe to 0-1 range for fitness calculation
    normalized.sharpe = (normalized.sharpe + 3) / 8;
    
    // Ensure maxDrawdown is within 0-1 range
    normalized.maxDrawdown = Math.max(0, Math.min(1, normalized.maxDrawdown));
    
    // Ensure winRate is within 0-1 range
    normalized.winRate = Math.max(0, Math.min(1, normalized.winRate));
    
    // Ensure volatilityResilience is within 0-1 range
    normalized.volatilityResilience = Math.max(0, Math.min(1, normalized.volatilityResilience));
    
    // Ensure regretIndex is within 0-1 range
    normalized.regretIndex = Math.max(0, Math.min(1, normalized.regretIndex));
    
    return normalized;
  }
  
  /**
   * Update the fitness scorer configuration
   * 
   * @param config - New configuration options
   */
  public updateConfig(config: Partial<FitnessScorerConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    logger.info(`FitnessScorer configuration updated: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Get the current fitness scorer configuration
   * 
   * @returns Current configuration
   */
  public getConfig(): FitnessScorerConfig {
    return { ...this.config };
  }
} 