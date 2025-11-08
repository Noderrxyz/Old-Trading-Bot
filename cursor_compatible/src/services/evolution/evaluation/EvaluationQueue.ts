/**
 * Evaluation Queue
 * 
 * Processes strategy evaluations in order with configurable concurrency limits.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { RedisService } from '../../redis/RedisService.js';
import { 
  EvaluationResult, 
  EvaluationRequest, 
  EvaluationStatus,
  EvaluationStatusUpdate
} from './EvaluationResult.js';
import { EvaluationRunner } from './EvaluationRunner.js';
import { MutationResult } from '../mutation/types.js';
import { PromotionManager } from './PromotionManager.js';

/**
 * Configuration for the evaluation queue
 */
export interface EvaluationQueueConfig {
  /** Maximum number of concurrent evaluations */
  maxConcurrentEvaluations: number;
  
  /** Queue check interval in milliseconds */
  checkIntervalMs: number;
  
  /** Redis key prefix for evaluation queue */
  redisKeyPrefix: string;
  
  /** Auto-start processing when queue is created */
  autoStart: boolean;
  
  /** Time-to-live for evaluation results in Redis (seconds) */
  resultsTtlSeconds: number;
  
  /** WebSocket channel for broadcasting evaluation updates */
  wsChannel: string;
}

/**
 * Default configuration for evaluation queue
 */
const DEFAULT_CONFIG: EvaluationQueueConfig = {
  maxConcurrentEvaluations: 5,
  checkIntervalMs: 1000,
  redisKeyPrefix: 'evolution:eval',
  autoStart: true,
  resultsTtlSeconds: 86400, // 24 hours
  wsChannel: 'EVOLUTION_SCORE_UPDATE'
};

/**
 * Service that manages a queue of strategy evaluations
 */
export class EvaluationQueue {
  private config: EvaluationQueueConfig;
  private redisService: RedisService;
  private evaluationRunner: EvaluationRunner;
  private promotionManager: PromotionManager;
  private isProcessing: boolean = false;
  private activeEvaluations: Set<string> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;
  private postgresClient: any; // Replace with actual Postgres client type
  
  /**
   * Create a new EvaluationQueue instance
   * 
   * @param redisService - Redis service for queue management
   * @param evaluationRunner - Runner for evaluating strategies
   * @param promotionManager - Manager for promoting successful strategies
   * @param postgresClient - Postgres client for storing results
   * @param config - Configuration options
   */
  constructor(
    redisService: RedisService,
    evaluationRunner: EvaluationRunner,
    promotionManager: PromotionManager,
    postgresClient: any, // Replace with actual Postgres client type
    config: Partial<EvaluationQueueConfig> = {}
  ) {
    this.redisService = redisService;
    this.evaluationRunner = evaluationRunner;
    this.promotionManager = promotionManager;
    this.postgresClient = postgresClient;
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`EvaluationQueue initialized with concurrency: ${this.config.maxConcurrentEvaluations}`);
    
    if (this.config.autoStart) {
      this.startProcessing();
    }
  }
  
  /**
   * Add a mutation result to the evaluation queue
   * 
   * @param mutationResult - Result of a mutation operation
   * @param generationId - ID of the current generation
   * @param priority - Priority of this evaluation (higher = more important)
   * @returns Evaluation request with ID
   */
  public async enqueue(
    mutationResult: MutationResult,
    generationId: string,
    priority: number = 1
  ): Promise<EvaluationRequest> {
    const { strategy, strategyId, mutationType } = mutationResult;
    
    // Create evaluation request
    const evaluationId = uuidv4();
    const request: EvaluationRequest = {
      agentId: strategy.agentId,
      strategyId,
      generationId,
      mutationType,
      evaluationId,
      requestedAt: Date.now(),
      priority
    };
    
    // Add to Redis queue with score based on priority and timestamp
    const score = Date.now() + (1000000 * priority);
    await this.redisService.redis.zadd(
      this.getQueueKey(),
      score,
      JSON.stringify(request)
    );
    
    // Update status to queued
    await this.updateStatus({
      evaluationId,
      status: EvaluationStatus.QUEUED,
      timestamp: Date.now()
    });
    
    logger.info(`Enqueued evaluation for strategy ${strategyId} with priority ${priority} (id: ${evaluationId})`);
    
    return request;
  }
  
  /**
   * Start processing the queue of evaluations
   */
  public startProcessing(): void {
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;
    
    this.checkInterval = setInterval(() => {
      this.processNextBatch().catch(error => {
        logger.error(`Error processing evaluation queue: ${error.message}`, error);
      });
    }, this.config.checkIntervalMs);
    
    logger.info('Started processing evaluation queue');
  }
  
  /**
   * Stop processing the queue of evaluations
   */
  public stopProcessing(): void {
    if (!this.isProcessing) {
      return;
    }
    
    this.isProcessing = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    logger.info('Stopped processing evaluation queue');
  }
  
  /**
   * Process the next batch of evaluations from the queue
   */
  private async processNextBatch(): Promise<void> {
    // Skip if we're at max concurrency
    if (this.activeEvaluations.size >= this.config.maxConcurrentEvaluations) {
      return;
    }
    
    // Calculate how many evaluations we can take
    const available = this.config.maxConcurrentEvaluations - this.activeEvaluations.size;
    
    // Get next items from the queue
    const items = await this.redisService.redis.zrange(
      this.getQueueKey(),
      0,
      available - 1,
      'WITHSCORES'
    );
    
    // Skip if no items
    if (items.length === 0) {
      return;
    }
    
    // Process each item
    for (let i = 0; i < items.length; i += 2) {
      const requestJson = items[i];
      const request: EvaluationRequest = JSON.parse(requestJson);
      
      // Remove from queue
      await this.redisService.redis.zrem(this.getQueueKey(), requestJson);
      
      // Mark as active
      this.activeEvaluations.add(request.evaluationId);
      
      // Update status to running
      await this.updateStatus({
        evaluationId: request.evaluationId,
        status: EvaluationStatus.RUNNING,
        timestamp: Date.now()
      });
      
      // Process in background
      this.processEvaluation(request).catch(error => {
        logger.error(`Error processing evaluation ${request.evaluationId}: ${error.message}`, error);
      });
    }
  }
  
  /**
   * Process a single evaluation
   * 
   * @param request - Evaluation request to process
   */
  private async processEvaluation(request: EvaluationRequest): Promise<void> {
    try {
      logger.info(`Processing evaluation ${request.evaluationId} for strategy ${request.strategyId}`);
      
      // Get the mutation result from Redis
      const mutationKey = `${this.config.redisKeyPrefix}:mutation:${request.strategyId}`;
      const mutationJson = await this.redisService.redis.get(mutationKey);
      
      if (!mutationJson) {
        throw new Error(`Mutation result not found for strategy ${request.strategyId}`);
      }
      
      const mutationResult: MutationResult = JSON.parse(mutationJson);
      
      // Run the evaluation
      const result = await this.evaluationRunner.evaluateStrategy(
        mutationResult,
        request.generationId
      );
      
      // Store result in Redis
      const resultKey = `${this.config.redisKeyPrefix}:result:${request.evaluationId}`;
      await this.redisService.redis.set(
        resultKey,
        JSON.stringify(result),
        'EX',
        this.config.resultsTtlSeconds
      );
      
      // Store in Postgres
      await this.storeResultInPostgres(result);
      
      // Update status to completed
      await this.updateStatus({
        evaluationId: request.evaluationId,
        status: EvaluationStatus.COMPLETED,
        timestamp: Date.now(),
        result
      });
      
      // Handle promotion or re-mutation
      if (result.passed) {
        await this.promotionManager.queueForPromotion(result);
      } else {
        await this.promotionManager.queueForRemutation(result);
      }
      
      logger.info(`Completed evaluation ${request.evaluationId} for strategy ${request.strategyId} with score ${result.fitnessScore}`);
    } catch (error) {
      // Update status to failed
      await this.updateStatus({
        evaluationId: request.evaluationId,
        status: EvaluationStatus.FAILED,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`Failed evaluation ${request.evaluationId} for strategy ${request.strategyId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Remove from active set
      this.activeEvaluations.delete(request.evaluationId);
    }
  }
  
  /**
   * Update the status of an evaluation and broadcast to WebSocket
   * 
   * @param update - Status update to broadcast
   */
  private async updateStatus(update: EvaluationStatusUpdate): Promise<void> {
    // Store status in Redis
    const statusKey = `${this.config.redisKeyPrefix}:status:${update.evaluationId}`;
    await this.redisService.redis.set(
      statusKey,
      JSON.stringify(update),
      'EX',
      this.config.resultsTtlSeconds
    );
    
    // Broadcast to WebSocket
    await this.redisService.redis.publish(
      this.config.wsChannel,
      JSON.stringify(update)
    );
  }
  
  /**
   * Store evaluation result in Postgres
   * 
   * @param result - Evaluation result to store
   */
  private async storeResultInPostgres(result: EvaluationResult): Promise<void> {
    try {
      // Insert into evolution_scores table
      await this.postgresClient.query(`
        INSERT INTO evolution_scores (
          strategy_id,
          agent_id,
          generation_id,
          score,
          passed,
          timestamp,
          notes,
          sharpe,
          max_drawdown,
          win_rate,
          volatility_resilience,
          regret_index,
          mutation_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        result.strategyId,
        result.agentId,
        result.generationId,
        result.fitnessScore,
        result.passed,
        new Date(result.timestamp),
        result.notes || null,
        result.sharpe,
        result.maxDrawdown,
        result.winRate,
        result.volatilityResilience,
        result.regretIndex,
        result.mutationType || null
      ]);
      
      logger.info(`Stored evaluation result for strategy ${result.strategyId} in Postgres`);
    } catch (error) {
      logger.error(`Error storing evaluation result in Postgres: ${error instanceof Error ? error.message : String(error)}`);
      // Don't re-throw - this is a non-critical operation
    }
  }
  
  /**
   * Get the Redis key for the evaluation queue
   * 
   * @returns Redis key
   */
  private getQueueKey(): string {
    return `${this.config.redisKeyPrefix}:queue`;
  }
  
  /**
   * Get the current queue length
   * 
   * @returns Number of evaluations in the queue
   */
  public async getQueueLength(): Promise<number> {
    return this.redisService.redis.zcard(this.getQueueKey());
  }
  
  /**
   * Get the number of active evaluations
   * 
   * @returns Number of active evaluations
   */
  public getActiveCount(): number {
    return this.activeEvaluations.size;
  }
  
  /**
   * Clean up resources when shutting down
   */
  public async shutdown(): Promise<void> {
    this.stopProcessing();
    logger.info('Evaluation queue shut down');
  }
} 