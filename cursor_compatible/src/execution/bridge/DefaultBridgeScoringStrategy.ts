import { Bridge } from '../types/Bridge';
import { BridgeScoringStrategy, BridgeSelectionCriteria, BridgeMetrics } from './BridgeSelector';
import { logger } from '../../utils/logger';

/**
 * Configuration for the default scoring strategy
 */
export interface DefaultScoringConfig {
  /**
   * Weight for liquidity score (0-1)
   */
  liquidityWeight: number;
  
  /**
   * Weight for fee score (0-1)
   */
  feeWeight: number;
  
  /**
   * Weight for time score (0-1)
   */
  timeWeight: number;
  
  /**
   * Weight for reliability score (0-1)
   */
  reliabilityWeight: number;
  
  /**
   * Weight for security score (0-1)
   */
  securityWeight: number;
  
  /**
   * Minimum liquidity threshold in USD
   */
  minLiquidityThreshold: number;
  
  /**
   * Maximum acceptable fee in USD
   */
  maxFeeThreshold: number;
  
  /**
   * Maximum acceptable time in seconds
   */
  maxTimeThreshold: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DefaultScoringConfig = {
  liquidityWeight: 0.3,
  feeWeight: 0.2,
  timeWeight: 0.15,
  reliabilityWeight: 0.2,
  securityWeight: 0.15,
  minLiquidityThreshold: 100000, // $100k minimum liquidity
  maxFeeThreshold: 100, // $100 maximum fee
  maxTimeThreshold: 3600 // 1 hour maximum
};

/**
 * DefaultBridgeScoringStrategy - Implements a sophisticated scoring algorithm
 * for bridge selection based on multiple weighted factors
 */
export class DefaultBridgeScoringStrategy implements BridgeScoringStrategy {
  private config: DefaultScoringConfig;
  
  constructor(config: Partial<DefaultScoringConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validateConfig();
  }
  
  /**
   * Score a bridge based on the provided criteria and metrics
   */
  public score(
    bridge: Bridge,
    criteria: BridgeSelectionCriteria,
    metrics: BridgeMetrics
  ): number {
    try {
      // Calculate individual component scores
      const liquidityScore = this.calculateLiquidityScore(metrics.liquidityUsd, criteria.amountUsd);
      const feeScore = this.calculateFeeScore(metrics.feeUsd, criteria.amountUsd);
      const timeScore = this.calculateTimeScore(metrics.estimatedTimeSeconds);
      const reliabilityScore = metrics.reliabilityScore;
      const securityScore = metrics.securityScore;
      
      // Apply weights and combine scores
      const weightedScore = 
        liquidityScore * this.config.liquidityWeight +
        feeScore * this.config.feeWeight +
        timeScore * this.config.timeWeight +
        reliabilityScore * this.config.reliabilityWeight +
        securityScore * this.config.securityWeight;
      
      // Log scoring details for debugging
      logger.debug('Bridge scoring details', {
        bridgeId: bridge.id,
        liquidityScore,
        feeScore,
        timeScore,
        reliabilityScore,
        securityScore,
        weightedScore
      });
      
      return weightedScore;
    } catch (error) {
      logger.error('Error scoring bridge', {
        bridgeId: bridge.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0; // Return 0 score on error
    }
  }
  
  /**
   * Calculate liquidity score based on available liquidity and required amount
   */
  private calculateLiquidityScore(liquidityUsd: number, requiredAmountUsd: number): number {
    if (liquidityUsd < this.config.minLiquidityThreshold) {
      return 0;
    }
    
    // Score based on liquidity ratio, with diminishing returns
    const ratio = liquidityUsd / requiredAmountUsd;
    return Math.min(1, Math.log10(ratio + 1) / Math.log10(10));
  }
  
  /**
   * Calculate fee score based on fee amount and transaction size
   */
  private calculateFeeScore(feeUsd: number, amountUsd: number): number {
    if (feeUsd > this.config.maxFeeThreshold) {
      return 0;
    }
    
    // Score based on fee percentage, with lower being better
    const feePercentage = feeUsd / amountUsd;
    return Math.max(0, 1 - (feePercentage * 100));
  }
  
  /**
   * Calculate time score based on estimated completion time
   */
  private calculateTimeScore(estimatedTimeSeconds: number): number {
    if (estimatedTimeSeconds > this.config.maxTimeThreshold) {
      return 0;
    }
    
    // Score based on time ratio, with lower being better
    return Math.max(0, 1 - (estimatedTimeSeconds / this.config.maxTimeThreshold));
  }
  
  /**
   * Validate configuration
   */
  private validateConfig(): void {
    const weights = [
      this.config.liquidityWeight,
      this.config.feeWeight,
      this.config.timeWeight,
      this.config.reliabilityWeight,
      this.config.securityWeight
    ];
    
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    
    if (Math.abs(totalWeight - 1) > 0.0001) {
      throw new Error('Scoring weights must sum to 1');
    }
    
    if (this.config.minLiquidityThreshold <= 0) {
      throw new Error('Minimum liquidity threshold must be positive');
    }
    
    if (this.config.maxFeeThreshold <= 0) {
      throw new Error('Maximum fee threshold must be positive');
    }
    
    if (this.config.maxTimeThreshold <= 0) {
      throw new Error('Maximum time threshold must be positive');
    }
  }
} 