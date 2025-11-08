/**
 * Memory Injection Controller
 * 
 * Connects the memory injector with the evolution evaluation system,
 * listening for promotions and injecting strategy learnings into agent memory.
 */

import logger from '../../../utils/logger.js';
import { RedisService } from '../../redis/RedisService.js';
import { MemoryInjector, MemoryInjectorConfig } from './MemoryInjector.js';
import { PromotionIntent } from '../evaluation/PromotionManager.js';
import { EvaluationResult } from '../evaluation/EvaluationResult.js';
import { MutationResult } from '../mutation/types.js';

/**
 * Configuration for Memory Injection Controller
 */
export interface MemoryInjectionControllerConfig {
  /** Redis key prefix for evolution data */
  redisKeyPrefix: string;
  
  /** WebSocket channel for promotion events */
  promotionChannel: string;
  
  /** Whether to log detailed injection activity */
  detailedLogging: boolean;
  
  /** Time-to-live for cached results (seconds) */
  cacheTtlSeconds: number;
}

/**
 * Default configuration for Memory Injection Controller
 */
const DEFAULT_CONFIG: MemoryInjectionControllerConfig = {
  redisKeyPrefix: 'evolution',
  promotionChannel: 'EVOLUTION_PROMOTION_INTENT',
  detailedLogging: true,
  cacheTtlSeconds: 86400 // 24 hours
};

/**
 * Controller that connects memory injection with the evaluation system
 */
export class MemoryInjectionController {
  private config: MemoryInjectionControllerConfig;
  private redisService: RedisService;
  private memoryInjector: MemoryInjector;
  private subscriber: any;
  private isListening: boolean = false;
  
  // Stats for monitoring
  private stats = {
    promotionsReceived: 0,
    injectionAttempts: 0,
    successfulInjections: 0,
    failedInjections: 0
  };
  
  /**
   * Create a new MemoryInjectionController
   * 
   * @param redisService - Redis service for pub/sub
   * @param memoryInjector - Memory injector service
   * @param config - Configuration options
   */
  constructor(
    redisService: RedisService,
    memoryInjector: MemoryInjector,
    config: Partial<MemoryInjectionControllerConfig> = {}
  ) {
    this.redisService = redisService;
    this.memoryInjector = memoryInjector;
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`MemoryInjectionController initialized with promotion channel: ${this.config.promotionChannel}`);
  }
  
  /**
   * Start listening for promotion events
   */
  public async start(): Promise<void> {
    if (this.isListening) {
      return;
    }
    
    try {
      // Create a separate Redis connection for subscriptions
      this.subscriber = this.redisService.redis.duplicate();
      
      await this.subscriber.subscribe(this.config.promotionChannel);
      this.isListening = true;
      
      logger.info(`Subscribed to promotion channel: ${this.config.promotionChannel}`);
      
      // Process received messages
      this.subscriber.on('message', async (channel: string, message: string) => {
        if (channel === this.config.promotionChannel) {
          this.handlePromotionEvent(message).catch(error => {
            logger.error(`Error processing promotion event: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      });
    } catch (error) {
      logger.error(`Error starting memory injection controller: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Stop listening for promotion events
   */
  public async stop(): Promise<void> {
    if (!this.isListening || !this.subscriber) {
      return;
    }
    
    try {
      await this.subscriber.unsubscribe(this.config.promotionChannel);
      this.subscriber.disconnect();
      this.isListening = false;
      
      logger.info(`Unsubscribed from promotion channel: ${this.config.promotionChannel}`);
    } catch (error) {
      logger.error(`Error stopping memory injection controller: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Handle a promotion event message
   * 
   * @param message - JSON message with promotion intent
   */
  private async handlePromotionEvent(message: string): Promise<void> {
    try {
      // Parse the promotion intent
      const promotionIntent = JSON.parse(message) as PromotionIntent;
      this.stats.promotionsReceived++;
      
      if (this.config.detailedLogging) {
        logger.info(`Received promotion event for strategy ${promotionIntent.strategyId} (score: ${promotionIntent.fitnessScore})`);
      }
      
      // Retrieve the evaluation result
      const evaluationResult = await this.getEvaluationResult(promotionIntent);
      
      if (!evaluationResult) {
        logger.warn(`No evaluation result found for promoted strategy ${promotionIntent.strategyId}`);
        return;
      }
      
      // Retrieve the mutation result
      const mutationResult = await this.getMutationResult(promotionIntent.strategyId);
      
      if (!mutationResult) {
        logger.warn(`No mutation result found for promoted strategy ${promotionIntent.strategyId}`);
        return;
      }
      
      // Process the promotion through the memory injector
      this.stats.injectionAttempts++;
      const memoryId = await this.memoryInjector.processPromotedStrategy(
        promotionIntent,
        evaluationResult,
        mutationResult
      );
      
      if (memoryId) {
        this.stats.successfulInjections++;
        
        // Store the memory ID in Redis for reference
        const memoryKey = `${this.config.redisKeyPrefix}:strategy:${promotionIntent.strategyId}:memory`;
        await this.redisService.redis.set(
          memoryKey,
          memoryId,
          'EX',
          this.config.cacheTtlSeconds
        );
        
        logger.info(`Successfully injected strategy ${promotionIntent.strategyId} learnings into memory (ID: ${memoryId})`);
      } else {
        this.stats.failedInjections++;
        logger.info(`No memory injected for strategy ${promotionIntent.strategyId}`);
      }
    } catch (error) {
      logger.error(`Error handling promotion event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Retrieve evaluation result for a promotion
   * 
   * @param promotionIntent - Promotion intent
   * @returns Evaluation result if found
   */
  private async getEvaluationResult(promotionIntent: PromotionIntent): Promise<EvaluationResult | null> {
    try {
      // Check for evaluation result in Redis
      const evaluationKey = `${this.config.redisKeyPrefix}:eval:result:${promotionIntent.intentId}`;
      const json = await this.redisService.redis.get(evaluationKey);
      
      if (!json) {
        // Try looking up by strategy ID
        const strategyResultsKey = `${this.config.redisKeyPrefix}:eval:strategy:${promotionIntent.strategyId}:results`;
        const resultsJson = await this.redisService.redis.lrange(strategyResultsKey, 0, 0);
        
        if (resultsJson && resultsJson.length > 0) {
          return JSON.parse(resultsJson[0]) as EvaluationResult;
        }
        
        return null;
      }
      
      return JSON.parse(json) as EvaluationResult;
    } catch (error) {
      logger.error(`Error retrieving evaluation result: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Retrieve mutation result for a strategy
   * 
   * @param strategyId - ID of the strategy
   * @returns Mutation result if found
   */
  private async getMutationResult(strategyId: string): Promise<MutationResult | null> {
    try {
      // Check for mutation result in Redis
      const mutationKey = `${this.config.redisKeyPrefix}:mutation:${strategyId}`;
      const json = await this.redisService.redis.get(mutationKey);
      
      if (!json) {
        return null;
      }
      
      return JSON.parse(json) as MutationResult;
    } catch (error) {
      logger.error(`Error retrieving mutation result: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Get the current injection statistics
   * 
   * @returns Current statistics
   */
  public getStatistics(): typeof this.stats {
    return { ...this.stats };
  }
  
  /**
   * Manually inject memory for a promoted strategy
   * 
   * @param strategyId - ID of the strategy
   * @returns Memory ID if injected, null otherwise
   */
  public async manuallyInjectMemory(strategyId: string): Promise<string | null> {
    try {
      // Lookup promotion intent
      const promotionKey = `${this.config.redisKeyPrefix}:promotion:strategy:${strategyId}`;
      const intentJson = await this.redisService.redis.get(promotionKey);
      
      if (!intentJson) {
        logger.warn(`No promotion intent found for strategy ${strategyId}`);
        return null;
      }
      
      const promotionIntent = JSON.parse(intentJson) as PromotionIntent;
      const evaluationResult = await this.getEvaluationResult(promotionIntent);
      
      if (!evaluationResult) {
        logger.warn(`No evaluation result found for strategy ${strategyId}`);
        return null;
      }
      
      const mutationResult = await this.getMutationResult(strategyId);
      
      if (!mutationResult) {
        logger.warn(`No mutation result found for strategy ${strategyId}`);
        return null;
      }
      
      this.stats.injectionAttempts++;
      const memoryId = await this.memoryInjector.processPromotedStrategy(
        promotionIntent,
        evaluationResult,
        mutationResult
      );
      
      if (memoryId) {
        this.stats.successfulInjections++;
        logger.info(`Manually injected strategy ${strategyId} learnings into memory (ID: ${memoryId})`);
      } else {
        this.stats.failedInjections++;
      }
      
      return memoryId;
    } catch (error) {
      logger.error(`Error manually injecting memory: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Update configuration options
   * 
   * @param config - Partial configuration to update
   */
  public updateConfig(config: Partial<MemoryInjectionControllerConfig>): void {
    const wasListening = this.isListening;
    
    // Stop listening if already running
    if (wasListening) {
      this.stop().catch(error => {
        logger.error(`Error stopping controller: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    
    this.config = {
      ...this.config,
      ...config
    };
    
    logger.info(`MemoryInjectionController configuration updated: ${JSON.stringify(this.config)}`);
    
    // Restart listening if it was running
    if (wasListening) {
      this.start().catch(error => {
        logger.error(`Error restarting controller: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
} 