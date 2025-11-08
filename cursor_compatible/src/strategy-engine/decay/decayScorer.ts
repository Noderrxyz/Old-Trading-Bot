/**
 * Strategy Decay Scorer
 * 
 * Computes drift and decay scores for strategies based on performance metrics
 * to determine when a strategy is becoming stale or underperforming.
 */

import { createLogger } from '../../common/logger.js';
import { RedisClient } from '../../common/redis.js';

const logger = createLogger('DecayScorer');

/**
 * Decay flags indicating specific issues with a strategy
 */
export enum DecayFlag {
  WIN_RATE_DROP = 'win_rate_drop',       // Win rate drops > 15% over 7 days
  LOW_SHARPE = 'low_sharpe',             // Sharpe ratio below 1.0 for 3 days
  DECLINING_ALPHA = 'declining_alpha',   // Declining alpha against BTC/ETH
  ABNORMAL_FREQUENCY = 'abnormal_frequency', // Trading frequency outside historical bands
  WEAK_ATTRIBUTION = 'weak_attribution',  // Signal contributions weakening
  HIGH_DRAWDOWN = 'high_drawdown',       // Excessive drawdown
  CONFIDENCE_DECLINE = 'confidence_decline', // Average signal confidence dropping
  EXECUTION_QUALITY_DROP = 'execution_quality_drop' // Execution quality metrics dropping
}

/**
 * Strategy performance metrics used to calculate decay
 */
export interface StrategyMetrics {
  strategyId: string;
  // Win rate metrics
  winRate7d: number;
  winRate30d: number;
  // Sharpe ratio metrics
  sharpeRatio3d: number;
  sharpeRatio7d: number;
  // Alpha/Beta metrics
  alpha7d: number;
  alphaPrevious7d: number;
  betaBtc: number;
  betaEth: number;
  // Trade frequency metrics
  tradeFrequency7d: number;
  avgTradeFrequency30d: number;
  stdDevTradeFrequency30d: number;
  // Attribution metrics
  signalContribution: number;
  prevSignalContribution: number;
  // Additional metrics
  maxDrawdown: number;
  avgConfidence: number;
  executionQuality: number; // % of intended execution achieved (slippage, etc.)
  // Last rotation timestamp
  lastRotationTimestamp: number;
}

/**
 * Result of decay score calculation
 */
export interface DecayResult {
  strategyId: string;
  decayScore: number;          // 0-1 score where higher means more decay
  flags: DecayFlag[];          // Specific issues detected
  lastRotation: number;        // Timestamp of last rotation
  recentAlpha: number;         // Recent alpha value
  winRate7d: number;           // 7-day win rate
  winRate30d: number;          // 30-day win rate
  rotationRecommended: boolean; // Whether rotation is recommended
  timestamp: number;           // When this score was calculated
}

/**
 * Configuration for decay score thresholds
 */
export interface DecayConfig {
  // Win rate thresholds
  winRateDropThreshold: number;      // % drop to trigger flag
  
  // Sharpe ratio thresholds
  lowSharpeThreshold: number;        // Sharpe below this triggers flag
  
  // Alpha thresholds
  alphaDeclineThreshold: number;     // % decline to trigger flag
  
  // Trade frequency thresholds
  freqDeviationThreshold: number;    // StdDev multiplier for abnormal frequency
  
  // Attribution thresholds
  attributionDeclineThreshold: number; // % decline to trigger flag
  
  // Drawdown thresholds
  maxDrawdownThreshold: number;      // Max drawdown to trigger flag
  
  // Confidence thresholds
  confidenceDeclineThreshold: number; // % decline to trigger flag
  
  // Execution quality thresholds
  executionQualityThreshold: number; // Min acceptable execution quality
  
  // Overall decay score thresholds
  highDecayThreshold: number;        // Score above this triggers auto-disable
  moderateDecayThreshold: number;    // Score above this triggers model replacement
  lowDecayThreshold: number;         // Score above this triggers weight adjustment
}

/**
 * Default configuration values
 */
const DEFAULT_DECAY_CONFIG: DecayConfig = {
  winRateDropThreshold: 15,
  lowSharpeThreshold: 1.0,
  alphaDeclineThreshold: 30,
  freqDeviationThreshold: 2.0,
  attributionDeclineThreshold: 20,
  maxDrawdownThreshold: 15,
  confidenceDeclineThreshold: 25,
  executionQualityThreshold: 75,
  highDecayThreshold: 0.8,
  moderateDecayThreshold: 0.6,
  lowDecayThreshold: 0.4
};

/**
 * Class for scoring strategy decay
 */
export class DecayScorer {
  private redis: RedisClient;
  private config: DecayConfig;
  
  /**
   * Create a new decay scorer
   * @param redis Redis client for storing and retrieving metrics
   * @param config Configuration for decay scoring
   */
  constructor(redis: RedisClient, config: Partial<DecayConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
  }
  
  /**
   * Calculate the decay score for a strategy
   * @param metrics Performance metrics for the strategy
   * @returns Decay score result
   */
  public calculateDecayScore(metrics: StrategyMetrics): DecayResult {
    const flags: DecayFlag[] = [];
    
    // Check for win rate drop
    const winRateDrop = metrics.winRate30d - metrics.winRate7d;
    if (winRateDrop >= this.config.winRateDropThreshold) {
      flags.push(DecayFlag.WIN_RATE_DROP);
    }
    
    // Check for low Sharpe ratio
    if (metrics.sharpeRatio3d < this.config.lowSharpeThreshold) {
      flags.push(DecayFlag.LOW_SHARPE);
    }
    
    // Check for declining alpha
    const alphaDrop = ((metrics.alphaPrevious7d - metrics.alpha7d) / Math.max(0.01, metrics.alphaPrevious7d)) * 100;
    if (alphaDrop >= this.config.alphaDeclineThreshold) {
      flags.push(DecayFlag.DECLINING_ALPHA);
    }
    
    // Check for abnormal trade frequency
    const freqLower = metrics.avgTradeFrequency30d - (this.config.freqDeviationThreshold * metrics.stdDevTradeFrequency30d);
    const freqUpper = metrics.avgTradeFrequency30d + (this.config.freqDeviationThreshold * metrics.stdDevTradeFrequency30d);
    if (metrics.tradeFrequency7d < freqLower || metrics.tradeFrequency7d > freqUpper) {
      flags.push(DecayFlag.ABNORMAL_FREQUENCY);
    }
    
    // Check for weak signal attribution
    const attributionDrop = ((metrics.prevSignalContribution - metrics.signalContribution) / 
                            Math.max(0.01, metrics.prevSignalContribution)) * 100;
    if (attributionDrop >= this.config.attributionDeclineThreshold) {
      flags.push(DecayFlag.WEAK_ATTRIBUTION);
    }
    
    // Check for high drawdown
    if (metrics.maxDrawdown >= this.config.maxDrawdownThreshold) {
      flags.push(DecayFlag.HIGH_DRAWDOWN);
    }
    
    // Check for confidence decline
    if (metrics.avgConfidence < (1 - this.config.confidenceDeclineThreshold / 100)) {
      flags.push(DecayFlag.CONFIDENCE_DECLINE);
    }
    
    // Check for execution quality
    if (metrics.executionQuality < this.config.executionQualityThreshold) {
      flags.push(DecayFlag.EXECUTION_QUALITY_DROP);
    }
    
    // Calculate overall decay score (0-1)
    // Weighted average of individual factors
    const decayScore = this.computeOverallDecayScore(flags, metrics);
    
    // Determine if rotation is recommended
    const rotationRecommended = decayScore >= this.config.moderateDecayThreshold;
    
    return {
      strategyId: metrics.strategyId,
      decayScore,
      flags,
      lastRotation: metrics.lastRotationTimestamp,
      recentAlpha: metrics.alpha7d,
      winRate7d: metrics.winRate7d,
      winRate30d: metrics.winRate30d,
      rotationRecommended,
      timestamp: Date.now()
    };
  }
  
  /**
   * Store decay score in Redis
   * @param result Decay score result
   */
  public async storeDecayScore(result: DecayResult): Promise<void> {
    try {
      const key = `strategy_decay:${result.strategyId}`;
      
      // Store as hash
      await this.redis.hset(key, {
        decayScore: result.decayScore.toFixed(2),
        flags: JSON.stringify(result.flags),
        lastRotation: result.lastRotation,
        recentAlpha: result.recentAlpha.toFixed(4),
        winRate7d: result.winRate7d.toFixed(1),
        winRate30d: result.winRate30d.toFixed(1),
        rotationRecommended: result.rotationRecommended ? '1' : '0',
        timestamp: result.timestamp
      });
      
      // Set expiry (30 days)
      await this.redis.expire(key, 60 * 60 * 24 * 30);
      
      // Publish to Redis stream
      await this.redis.xadd(
        `strategy_decay_feed:${result.strategyId}`,
        '*',
        {
          decayScore: result.decayScore.toFixed(2),
          flags: JSON.stringify(result.flags),
          timestamp: result.timestamp.toString()
        }
      );
      
      logger.debug(`Stored decay score for ${result.strategyId}: ${result.decayScore.toFixed(2)}`);
    } catch (error) {
      logger.error(`Failed to store decay score: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the latest decay score for a strategy
   * @param strategyId ID of the strategy
   * @returns The latest decay score or null if not found
   */
  public async getDecayScore(strategyId: string): Promise<DecayResult | null> {
    try {
      const key = `strategy_decay:${strategyId}`;
      const data = await this.redis.hgetall(key);
      
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      
      return {
        strategyId,
        decayScore: parseFloat(data.decayScore),
        flags: JSON.parse(data.flags),
        lastRotation: parseInt(data.lastRotation, 10),
        recentAlpha: parseFloat(data.recentAlpha),
        winRate7d: parseFloat(data.winRate7d),
        winRate30d: parseFloat(data.winRate30d),
        rotationRecommended: data.rotationRecommended === '1',
        timestamp: parseInt(data.timestamp, 10)
      };
    } catch (error) {
      logger.error(`Failed to get decay score: ${error}`);
      return null;
    }
  }
  
  /**
   * Compute overall decay score from individual factors
   * @param flags Flags indicating issues
   * @param metrics Strategy metrics
   * @returns A score between 0-1 where higher means more decay
   */
  private computeOverallDecayScore(flags: DecayFlag[], metrics: StrategyMetrics): number {
    // Base score from number of flags
    const baseScore = Math.min(1.0, flags.length / 8);
    
    // Weight factors based on importance
    let weightedScore = 0;
    let totalWeight = 0;
    
    const weights = {
      [DecayFlag.WIN_RATE_DROP]: 0.25,
      [DecayFlag.LOW_SHARPE]: 0.20,
      [DecayFlag.DECLINING_ALPHA]: 0.20,
      [DecayFlag.ABNORMAL_FREQUENCY]: 0.10,
      [DecayFlag.WEAK_ATTRIBUTION]: 0.15,
      [DecayFlag.HIGH_DRAWDOWN]: 0.20,
      [DecayFlag.CONFIDENCE_DECLINE]: 0.15,
      [DecayFlag.EXECUTION_QUALITY_DROP]: 0.15
    };
    
    // Calculate each factor's contribution
    for (const flag of flags) {
      weightedScore += weights[flag];
      totalWeight += weights[flag];
    }
    
    // Normalize
    const normalizedScore = totalWeight > 0 ? weightedScore / Math.min(1.4, totalWeight) : 0;
    
    // Combine base score and normalized weighted score
    const finalScore = 0.4 * baseScore + 0.6 * normalizedScore;
    
    // Apply age factor - strategies with no rotation for a long time are more likely to be stale
    const daysSinceRotation = (Date.now() - metrics.lastRotationTimestamp) / (1000 * 60 * 60 * 24);
    const ageFactor = Math.min(1.0, daysSinceRotation / 90); // Max effect after 90 days
    
    // Combine with age factor (older strategies are more likely to be stale)
    return Math.min(1.0, finalScore * (1 + 0.2 * ageFactor));
  }
  
  /**
   * Update configuration
   * @param newConfig New configuration settings
   */
  public updateConfig(newConfig: Partial<DecayConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`Decay scorer config updated: ${JSON.stringify(newConfig)}`);
  }
} 