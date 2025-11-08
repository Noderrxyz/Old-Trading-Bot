/**
 * Promotion Manager
 * 
 * Manages promotion of successful strategies and re-mutation of failed strategies.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { RedisService } from '../../redis/RedisService.js';
import { EvaluationResult } from './EvaluationResult.js';

/**
 * Intent to promote a strategy
 */
export interface PromotionIntent {
  /** Intent type */
  intent: 'PROMOTE';
  
  /** ID of the strategy to promote */
  strategyId: string;
  
  /** ID of the agent that owns this strategy */
  agentId: string;
  
  /** Fitness score that qualified the strategy */
  fitnessScore: number;
  
  /** ID of the generation this strategy belongs to */
  generationId: string;
  
  /** Timestamp when this intent was created */
  timestamp: number;
  
  /** Intent ID */
  intentId: string;
}

/**
 * Intent to re-mutate a strategy
 */
export interface RemutationIntent {
  /** Intent type */
  intent: 'REMUTATE';
  
  /** ID of the strategy to re-mutate */
  strategyId: string;
  
  /** ID of the agent that owns this strategy */
  agentId: string;
  
  /** Fitness score that failed the strategy */
  fitnessScore: number;
  
  /** ID of the generation this strategy belongs to */
  generationId: string;
  
  /** Information about weaknesses to target in re-mutation */
  weaknesses: {
    /** Performance metrics that performed poorly */
    lowPerformanceMetrics: string[];
    
    /** Risk metrics that performed poorly */
    riskIssues?: string[];
    
    /** Suggested areas to focus mutation on */
    mutationFocus?: string[];
  };
  
  /** Timestamp when this intent was created */
  timestamp: number;
  
  /** Intent ID */
  intentId: string;
}

/**
 * Configuration for the promotion manager
 */
export interface PromotionManagerConfig {
  /** Redis key prefix for promotion queue */
  redisKeyPrefix: string;
  
  /** Time-to-live for intents in Redis (seconds) */
  intentTtlSeconds: number;
  
  /** WebSocket channel for broadcasting promotion intents */
  promotionWsChannel: string;
  
  /** WebSocket channel for broadcasting re-mutation intents */
  remutationWsChannel: string;
  
  /** Minimum score difference to promote over previous generation */
  minPromotionScoreDelta: number;
}

/**
 * Default configuration for promotion manager
 */
const DEFAULT_CONFIG: PromotionManagerConfig = {
  redisKeyPrefix: 'evolution:promotion',
  intentTtlSeconds: 86400, // 24 hours
  promotionWsChannel: 'EVOLUTION_PROMOTION_INTENT',
  remutationWsChannel: 'EVOLUTION_REMUTATION_INTENT',
  minPromotionScoreDelta: 0.05 // 5% improvement required
};

/**
 * Service that manages promotion and re-mutation of strategies
 */
export class PromotionManager {
  private config: PromotionManagerConfig;
  private redisService: RedisService;
  
  /**
   * Create a new PromotionManager instance
   * 
   * @param redisService - Redis service for queue management
   * @param config - Configuration options
   */
  constructor(
    redisService: RedisService,
    config: Partial<PromotionManagerConfig> = {}
  ) {
    this.redisService = redisService;
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`PromotionManager initialized with minPromotionScoreDelta: ${this.config.minPromotionScoreDelta}`);
  }
  
  /**
   * Queue a strategy for promotion
   * 
   * @param result - Evaluation result
   * @returns Promotion intent or RemutationIntent if not promoted
   */
  public async queueForPromotion(result: EvaluationResult): Promise<PromotionIntent | RemutationIntent> {
    const { strategyId, agentId, fitnessScore, generationId } = result;
    
    // Check if this strategy is significantly better than the current best
    const shouldPromote = await this.shouldPromoteStrategy(result);
    
    if (!shouldPromote) {
      logger.info(`Strategy ${strategyId} passed evaluation but was not promoted (score: ${fitnessScore})`);
      return await this.queueForRemutation(result);
    }
    
    // Create promotion intent
    const intentId = uuidv4();
    const intent: PromotionIntent = {
      intent: 'PROMOTE',
      strategyId,
      agentId,
      fitnessScore,
      generationId,
      timestamp: Date.now(),
      intentId
    };
    
    // Store intent in Redis
    const intentKey = `${this.config.redisKeyPrefix}:intent:${intentId}`;
    await this.redisService.redis.set(
      intentKey,
      JSON.stringify(intent),
      'EX',
      this.config.intentTtlSeconds
    );
    
    // Add to promotion queue
    const queueKey = `${this.config.redisKeyPrefix}:queue:promote`;
    await this.redisService.redis.zadd(
      queueKey,
      Date.now(),
      JSON.stringify(intent)
    );
    
    // Broadcast to WebSocket
    await this.redisService.redis.publish(
      this.config.promotionWsChannel,
      JSON.stringify(intent)
    );
    
    logger.info(`Queued strategy ${strategyId} for promotion with score ${fitnessScore}`);
    
    return intent;
  }
  
  /**
   * Queue a strategy for re-mutation
   * 
   * @param result - Evaluation result
   * @returns Re-mutation intent
   */
  public async queueForRemutation(result: EvaluationResult): Promise<RemutationIntent> {
    const { strategyId, agentId, fitnessScore, generationId } = result;
    
    // Analyze weaknesses to target in re-mutation
    const weaknesses = this.analyzeWeaknesses(result);
    
    // Create re-mutation intent
    const intentId = uuidv4();
    const intent: RemutationIntent = {
      intent: 'REMUTATE',
      strategyId,
      agentId,
      fitnessScore,
      generationId,
      weaknesses,
      timestamp: Date.now(),
      intentId
    };
    
    // Store intent in Redis
    const intentKey = `${this.config.redisKeyPrefix}:intent:${intentId}`;
    await this.redisService.redis.set(
      intentKey,
      JSON.stringify(intent),
      'EX',
      this.config.intentTtlSeconds
    );
    
    // Add to re-mutation queue
    const queueKey = `${this.config.redisKeyPrefix}:queue:remutate`;
    await this.redisService.redis.zadd(
      queueKey,
      Date.now(),
      JSON.stringify(intent)
    );
    
    // Broadcast to WebSocket
    await this.redisService.redis.publish(
      this.config.remutationWsChannel,
      JSON.stringify(intent)
    );
    
    logger.info(`Queued strategy ${strategyId} for re-mutation with score ${fitnessScore}`);
    
    return intent;
  }
  
  /**
   * Determine if a strategy should be promoted
   * 
   * @param result - Evaluation result
   * @returns Whether the strategy should be promoted
   */
  private async shouldPromoteStrategy(result: EvaluationResult): Promise<boolean> {
    const { strategyId, agentId, fitnessScore, generationId } = result;
    
    // Get the current best strategy for this agent
    const bestKey = `${this.config.redisKeyPrefix}:bestStrategy:${agentId}`;
    const bestJson = await this.redisService.redis.get(bestKey);
    
    if (!bestJson) {
      // No current best, so promote this one
      await this.redisService.redis.set(bestKey, JSON.stringify({
        strategyId,
        fitnessScore,
        generationId,
        timestamp: Date.now()
      }));
      return true;
    }
    
    const best = JSON.parse(bestJson);
    
    // Check if this strategy is significantly better
    const improvement = fitnessScore - best.fitnessScore;
    
    if (improvement >= this.config.minPromotionScoreDelta) {
      // Update the best strategy
      await this.redisService.redis.set(bestKey, JSON.stringify({
        strategyId,
        fitnessScore,
        generationId,
        timestamp: Date.now()
      }));
      
      logger.info(`Strategy ${strategyId} improves on previous best by ${improvement.toFixed(4)}`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Analyze weaknesses of a failed strategy
   * 
   * @param result - Evaluation result
   * @returns Weaknesses analysis
   */
  private analyzeWeaknesses(result: EvaluationResult): RemutationIntent['weaknesses'] {
    const lowPerformanceMetrics: string[] = [];
    
    // Check for low performance metrics
    if (result.sharpe < 0.5) {
      lowPerformanceMetrics.push('sharpe');
    }
    
    if (result.maxDrawdown > 0.2) {
      lowPerformanceMetrics.push('maxDrawdown');
    }
    
    if (result.winRate < 0.45) {
      lowPerformanceMetrics.push('winRate');
    }
    
    if (result.volatilityResilience < 0.5) {
      lowPerformanceMetrics.push('volatilityResilience');
    }
    
    // Risk issues
    const riskIssues: string[] = [];
    if (result.regretIndex > 0.7) {
      riskIssues.push('highRegretIndex');
    }
    
    // Determine mutation focus
    const mutationFocus: string[] = [];
    
    if (lowPerformanceMetrics.includes('sharpe') || lowPerformanceMetrics.includes('winRate')) {
      mutationFocus.push('signalQuality');
    }
    
    if (lowPerformanceMetrics.includes('maxDrawdown')) {
      mutationFocus.push('riskManagement');
    }
    
    if (lowPerformanceMetrics.includes('volatilityResilience')) {
      mutationFocus.push('adaptability');
    }
    
    return {
      lowPerformanceMetrics,
      riskIssues: riskIssues.length > 0 ? riskIssues : undefined,
      mutationFocus: mutationFocus.length > 0 ? mutationFocus : undefined
    };
  }
  
  /**
   * Get the next promotion intent from the queue
   * 
   * @returns The next promotion intent, or null if the queue is empty
   */
  public async getNextPromotionIntent(): Promise<PromotionIntent | null> {
    const queueKey = `${this.config.redisKeyPrefix}:queue:promote`;
    const items = await this.redisService.redis.zrange(queueKey, 0, 0);
    
    if (items.length === 0) {
      return null;
    }
    
    const intentJson = items[0];
    const intent = JSON.parse(intentJson) as PromotionIntent;
    
    // Remove from queue
    await this.redisService.redis.zrem(queueKey, intentJson);
    
    return intent;
  }
  
  /**
   * Get the next re-mutation intent from the queue
   * 
   * @returns The next re-mutation intent, or null if the queue is empty
   */
  public async getNextRemutationIntent(): Promise<RemutationIntent | null> {
    const queueKey = `${this.config.redisKeyPrefix}:queue:remutate`;
    const items = await this.redisService.redis.zrange(queueKey, 0, 0);
    
    if (items.length === 0) {
      return null;
    }
    
    const intentJson = items[0];
    const intent = JSON.parse(intentJson) as RemutationIntent;
    
    // Remove from queue
    await this.redisService.redis.zrem(queueKey, intentJson);
    
    return intent;
  }
} 