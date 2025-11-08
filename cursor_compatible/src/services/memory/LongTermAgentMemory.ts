/**
 * Long-Term Agent Memory Service
 * 
 * Persists top-performing evolved agents into long-term memory for 
 * use in future training cycles, strategy seeding, or forensic audits.
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import logger from '../../utils/logger.js';
import { RedisService } from '../redis/RedisService.js';
import { TradingStrategy } from '../evolution/mutation/strategy-model.js';
import { EvaluationResult } from '../evolution/evaluation/EvaluationResult.js';
import { MEMORY_INJECTION_CONFIG, daysToMs } from '../../config/agent_meta_rewards.config.js';

/**
 * Snapshot of an evolved agent's state for persistence
 */
export interface EvolvedAgentSnapshot {
  // Core identifiers
  id: string;
  agentId: string;
  strategyId: string;
  
  // Hash to uniquely identify this agent strategy configuration
  strategyHash: string;
  
  // Performance scores
  rewardScore: number;
  fitnessScore: number;
  
  // Trust information
  trustScore: number | null;
  violationCount: number;
  
  // History data
  epochHistory: {
    epochId: string;
    timestamp: number;
    score: number;
  }[];
  
  // Performance characteristics
  traits: {
    performanceMetrics: Record<string, number>;
    marketConditions: string[];
    specializations: string[];
  };
  
  // Strategy data
  strategy: Partial<TradingStrategy> | null;
  
  // Metadata
  createdAt: number;
  lastUpdatedAt: number;
  generationId: string;
  evolutionMetadata: {
    mutationHistory: string[];
    parentAgentIds: string[];
    iterationConsistency: number;
    description: string;
  };
  
  // Persistence metadata
  memoryTags: string[];
  performanceCategory: 'exceptional' | 'high' | 'medium' | 'low';
  ttlMs: number | null;
}

/**
 * Configuration options for the Long-Term Agent Memory service
 */
export interface LongTermMemoryConfig {
  redisKeyPrefix: string;
  topN: number;
  persistThreshold: number;
  ttlLowRankingMs: number;
  highRankingThreshold: number;
  minConsistencyCount: number;
  requireZeroViolations: boolean;
  memoryTags: string[];
  includeFullStrategySnapshots: boolean;
}

/**
 * Service that manages persistence of evolved agents in long-term memory
 */
export class LongTermAgentMemory {
  private config: LongTermMemoryConfig;
  private redisService: RedisService;
  private trustScoreService: any | null; // Will be properly typed once available
  
  /**
   * Create a new LongTermAgentMemory service
   * 
   * @param redisService - Redis service for data storage
   * @param trustScoreService - Optional trust score service
   * @param config - Configuration options
   */
  constructor(
    redisService: RedisService,
    trustScoreService: any | null = null,
    config: Partial<LongTermMemoryConfig> = {}
  ) {
    this.redisService = redisService;
    this.trustScoreService = trustScoreService;
    
    // Apply configuration with defaults from global config
    this.config = {
      redisKeyPrefix: MEMORY_INJECTION_CONFIG.redisKeyPrefix,
      topN: MEMORY_INJECTION_CONFIG.topN,
      persistThreshold: MEMORY_INJECTION_CONFIG.persistThreshold,
      ttlLowRankingMs: MEMORY_INJECTION_CONFIG.ttlLowRankingMs,
      highRankingThreshold: MEMORY_INJECTION_CONFIG.highRankingThreshold,
      minConsistencyCount: MEMORY_INJECTION_CONFIG.minConsistencyCount,
      requireZeroViolations: MEMORY_INJECTION_CONFIG.requireZeroViolations,
      memoryTags: MEMORY_INJECTION_CONFIG.memoryTags,
      includeFullStrategySnapshots: MEMORY_INJECTION_CONFIG.includeFullStrategySnapshots,
      ...config
    };
    
    logger.info(`LongTermAgentMemory service initialized with persistence threshold: ${this.config.persistThreshold}`);
  }
  
  /**
   * Inject an agent snapshot into long-term memory
   * 
   * @param agent - Evolved agent snapshot
   * @returns Promise resolving to the memory ID if successful, null otherwise
   */
  public async injectAgentMemorySnapshot(agent: EvolvedAgentSnapshot): Promise<string | null> {
    try {
      // Calculate TTL based on performance category if not already set
      if (agent.ttlMs === undefined) {
        agent.ttlMs = this.calculateTtl(agent.performanceCategory);
      }
      
      // Generate a unique memory ID
      const memoryId = agent.id || uuidv4();
      
      // Prepare Redis storage
      const agentKey = `${this.config.redisKeyPrefix}:agent:${agent.agentId}:${memoryId}`;
      const indexKey = `${this.config.redisKeyPrefix}:index:by_score`;
      const hashKey = `${this.config.redisKeyPrefix}:hash:${agent.strategyHash}`;
      
      // Store the agent snapshot
      await this.redisService.redis.set(
        agentKey,
        JSON.stringify(agent),
        agent.ttlMs ? 'PX' : null,
        agent.ttlMs ?? undefined
      );
      
      // Store in sorted index by score
      await this.redisService.redis.zadd(
        indexKey,
        agent.rewardScore,
        `${agent.agentId}:${memoryId}`
      );
      
      // Store mapping from strategy hash to agent ID for deduplication
      await this.redisService.redis.set(
        hashKey,
        `${agent.agentId}:${memoryId}`,
        agent.ttlMs ? 'PX' : null,
        agent.ttlMs ?? undefined
      );
      
      // Store by market conditions for efficient retrieval
      if (agent.traits.marketConditions && agent.traits.marketConditions.length > 0) {
        for (const condition of agent.traits.marketConditions) {
          const conditionKey = `${this.config.redisKeyPrefix}:market:${condition}`;
          await this.redisService.redis.zadd(
            conditionKey,
            agent.rewardScore,
            `${agent.agentId}:${memoryId}`
          );
        }
      }
      
      logger.info(`Injected agent ${agent.agentId} strategy ${agent.strategyId} into long-term memory (ID: ${memoryId})`);
      
      return memoryId;
    } catch (error) {
      logger.error(`Error injecting agent memory snapshot: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Create an agent snapshot from evaluation results and strategy
   * 
   * @param agentId - ID of the agent
   * @param evaluationResult - Evaluation result
   * @param strategy - Trading strategy
   * @param trustScore - Optional trust score
   * @param epochHistory - Optional history of previous performance
   * @returns Evolved agent snapshot
   */
  public async createAgentSnapshot(
    agentId: string,
    evaluationResult: EvaluationResult,
    strategy: TradingStrategy,
    trustScore?: number,
    epochHistory?: EvolvedAgentSnapshot['epochHistory']
  ): Promise<EvolvedAgentSnapshot> {
    // Get trust score if service is available and not provided
    let finalTrustScore = trustScore;
    let violationCount = 0;
    
    if (this.trustScoreService && finalTrustScore === undefined) {
      try {
        finalTrustScore = await this.trustScoreService.getAgentTrustScore(agentId);
        violationCount = await this.trustScoreService.getViolationCount(agentId);
      } catch (error) {
        logger.warn(`Could not retrieve trust score for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
        finalTrustScore = null;
      }
    }
    
    // Generate a strategy hash to identify duplicate strategies
    const strategyHash = this.generateStrategyHash(strategy);
    
    // Determine performance category based on fitness score
    const performanceCategory = this.categorizePerformance(evaluationResult.fitnessScore, finalTrustScore);
    
    // Create the snapshot
    const snapshot: EvolvedAgentSnapshot = {
      id: uuidv4(),
      agentId,
      strategyId: evaluationResult.strategyId,
      strategyHash,
      rewardScore: evaluationResult.fitnessScore, // Using fitness score as reward score
      fitnessScore: evaluationResult.fitnessScore,
      trustScore: finalTrustScore,
      violationCount: violationCount,
      epochHistory: epochHistory || [{
        epochId: evaluationResult.generationId,
        timestamp: evaluationResult.timestamp,
        score: evaluationResult.fitnessScore
      }],
      traits: {
        performanceMetrics: {
          sharpe: evaluationResult.sharpe,
          maxDrawdown: evaluationResult.maxDrawdown,
          winRate: evaluationResult.winRate,
          volatilityResilience: evaluationResult.volatilityResilience,
          ...(evaluationResult.rawMetrics || {})
        },
        marketConditions: strategy.marketConditions || [],
        specializations: strategy.assetClasses || []
      },
      strategy: this.config.includeFullStrategySnapshots 
        ? strategy 
        : {
            id: strategy.id,
            name: strategy.name,
            version: strategy.version,
            marketConditions: strategy.marketConditions,
            assetClasses: strategy.assetClasses
          },
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      generationId: evaluationResult.generationId,
      evolutionMetadata: {
        mutationHistory: [evaluationResult.mutationType?.toString() || 'unknown'],
        parentAgentIds: strategy.parentId ? [strategy.parentId] : [],
        iterationConsistency: 1, // Start with 1, increment when found consistent
        description: `${strategy.name} v${strategy.version}: ${strategy.description || 'No description'}`
      },
      memoryTags: [...this.config.memoryTags],
      performanceCategory,
      ttlMs: this.calculateTtl(performanceCategory)
    };
    
    return snapshot;
  }
  
  /**
   * Persist the top N performing agents
   * 
   * @param agentEvaluations - Map of agent IDs to their evaluations
   * @param agentStrategies - Map of strategy IDs to their strategy details
   * @returns Number of agents successfully persisted
   */
  public async persistTopPerformers(
    agentEvaluations: Map<string, EvaluationResult[]>,
    agentStrategies: Map<string, TradingStrategy>
  ): Promise<number> {
    let persistedCount = 0;
    
    try {
      // Process each agent
      for (const [agentId, evaluations] of agentEvaluations.entries()) {
        if (evaluations.length === 0) {
          continue;
        }
        
        // Filter evaluations that meet the minimum threshold
        const qualifyingEvaluations = evaluations
          .filter(evaluation => evaluation.fitnessScore >= this.config.persistThreshold)
          .sort((a, b) => b.fitnessScore - a.fitnessScore);
        
        if (qualifyingEvaluations.length === 0) {
          continue;
        }
        
        // Check for consistency across multiple evaluations/iterations
        const isConsistent = qualifyingEvaluations.length >= this.config.minConsistencyCount;
        
        // Take the top N evaluations
        const topEvaluations = qualifyingEvaluations.slice(0, this.config.topN);
        
        // Persist each qualifying strategy
        for (const evaluation of topEvaluations) {
          const strategy = agentStrategies.get(evaluation.strategyId);
          
          if (!strategy) {
            logger.warn(`Strategy ${evaluation.strategyId} not found for agent ${agentId}`);
            continue;
          }
          
          // Check trust requirements if enabled
          let trustScore: number | undefined;
          let violationCount = 0;
          
          if (this.config.requireZeroViolations && this.trustScoreService) {
            try {
              trustScore = await this.trustScoreService.getAgentTrustScore(agentId);
              violationCount = await this.trustScoreService.getViolationCount(agentId);
              
              if (violationCount > 0) {
                logger.info(`Agent ${agentId} has ${violationCount} violations, skipping persistence`);
                continue;
              }
            } catch (error) {
              logger.warn(`Error checking violations for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          
          // Create epoch history from multiple evaluations
          const epochHistory = qualifyingEvaluations.map(eval => ({
            epochId: eval.generationId,
            timestamp: eval.timestamp,
            score: eval.fitnessScore
          }));
          
          // Create and persist the agent snapshot
          const snapshot = await this.createAgentSnapshot(
            agentId,
            evaluation,
            strategy,
            trustScore,
            epochHistory
          );
          
          // Update consistency count based on history
          snapshot.evolutionMetadata.iterationConsistency = isConsistent 
            ? qualifyingEvaluations.length 
            : 1;
          
          const memoryId = await this.injectAgentMemorySnapshot(snapshot);
          
          if (memoryId) {
            persistedCount++;
          }
        }
      }
      
      logger.info(`Persisted ${persistedCount} agents to long-term memory`);
      
      return persistedCount;
    } catch (error) {
      logger.error(`Error persisting top performers: ${error instanceof Error ? error.message : String(error)}`);
      return persistedCount;
    }
  }
  
  /**
   * Retrieve agent snapshots for a specific agent
   * 
   * @param agentId - ID of the agent
   * @returns Array of agent snapshots
   */
  public async getAgentSnapshots(agentId: string): Promise<EvolvedAgentSnapshot[]> {
    try {
      const pattern = `${this.config.redisKeyPrefix}:agent:${agentId}:*`;
      const keys = await this.redisService.redis.keys(pattern);
      
      const snapshots: EvolvedAgentSnapshot[] = [];
      
      for (const key of keys) {
        const json = await this.redisService.redis.get(key);
        
        if (json) {
          snapshots.push(JSON.parse(json) as EvolvedAgentSnapshot);
        }
      }
      
      return snapshots.sort((a, b) => b.rewardScore - a.rewardScore);
    } catch (error) {
      logger.error(`Error retrieving agent snapshots: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Retrieve top performing agent snapshots across all agents
   * 
   * @param limit - Maximum number of snapshots to return
   * @returns Array of agent snapshots
   */
  public async getTopPerformingSnapshots(limit: number = 10): Promise<EvolvedAgentSnapshot[]> {
    try {
      const indexKey = `${this.config.redisKeyPrefix}:index:by_score`;
      const results = await this.redisService.redis.zrevrange(indexKey, 0, limit - 1, 'WITHSCORES');
      
      const snapshots: EvolvedAgentSnapshot[] = [];
      
      // Redis returns [member1, score1, member2, score2, ...]
      for (let i = 0; i < results.length; i += 2) {
        const [agentId, memoryId] = results[i].split(':');
        const key = `${this.config.redisKeyPrefix}:agent:${agentId}:${memoryId}`;
        const json = await this.redisService.redis.get(key);
        
        if (json) {
          snapshots.push(JSON.parse(json) as EvolvedAgentSnapshot);
        }
      }
      
      return snapshots;
    } catch (error) {
      logger.error(`Error retrieving top performing snapshots: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Retrieve agent snapshots by market condition
   * 
   * @param marketCondition - Market condition to filter by
   * @param limit - Maximum number of snapshots to return
   * @returns Array of agent snapshots
   */
  public async getSnapshotsByMarketCondition(marketCondition: string, limit: number = 10): Promise<EvolvedAgentSnapshot[]> {
    try {
      const conditionKey = `${this.config.redisKeyPrefix}:market:${marketCondition}`;
      const results = await this.redisService.redis.zrevrange(conditionKey, 0, limit - 1);
      
      const snapshots: EvolvedAgentSnapshot[] = [];
      
      for (const result of results) {
        const [agentId, memoryId] = result.split(':');
        const key = `${this.config.redisKeyPrefix}:agent:${agentId}:${memoryId}`;
        const json = await this.redisService.redis.get(key);
        
        if (json) {
          snapshots.push(JSON.parse(json) as EvolvedAgentSnapshot);
        }
      }
      
      return snapshots;
    } catch (error) {
      logger.error(`Error retrieving snapshots by market condition: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Delete an agent snapshot
   * 
   * @param agentId - ID of the agent
   * @param memoryId - ID of the memory snapshot
   * @returns Whether the deletion was successful
   */
  public async deleteAgentSnapshot(agentId: string, memoryId: string): Promise<boolean> {
    try {
      const key = `${this.config.redisKeyPrefix}:agent:${agentId}:${memoryId}`;
      const indexKey = `${this.config.redisKeyPrefix}:index:by_score`;
      
      // Get the snapshot first to clean up other references
      const json = await this.redisService.redis.get(key);
      
      if (!json) {
        return false;
      }
      
      const snapshot = JSON.parse(json) as EvolvedAgentSnapshot;
      
      // Delete the main snapshot
      await this.redisService.redis.del(key);
      
      // Remove from score index
      await this.redisService.redis.zrem(indexKey, `${agentId}:${memoryId}`);
      
      // Remove from hash index
      const hashKey = `${this.config.redisKeyPrefix}:hash:${snapshot.strategyHash}`;
      await this.redisService.redis.del(hashKey);
      
      // Remove from market condition indexes
      if (snapshot.traits.marketConditions) {
        for (const condition of snapshot.traits.marketConditions) {
          const conditionKey = `${this.config.redisKeyPrefix}:market:${condition}`;
          await this.redisService.redis.zrem(conditionKey, `${agentId}:${memoryId}`);
        }
      }
      
      logger.info(`Deleted agent snapshot ${memoryId} for agent ${agentId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error deleting agent snapshot: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Generate a hash for a trading strategy to identify duplicates
   * 
   * @param strategy - Trading strategy
   * @returns Hash string
   */
  private generateStrategyHash(strategy: TradingStrategy): string {
    // Create a simplified representation of the strategy for hashing
    const hashableStrategy = {
      indicators: strategy.indicators,
      riskParameters: strategy.riskParameters,
      signalSettings: strategy.signalSettings,
      timeSettings: strategy.timeSettings
    };
    
    // Create a hash of the JSON string
    return createHash('sha256')
      .update(JSON.stringify(hashableStrategy))
      .digest('hex');
  }
  
  /**
   * Categorize performance based on fitness score and trust score
   * 
   * @param fitnessScore - Fitness score
   * @param trustScore - Optional trust score
   * @returns Performance category
   */
  private categorizePerformance(
    fitnessScore: number, 
    trustScore: number | null | undefined
  ): EvolvedAgentSnapshot['performanceCategory'] {
    // Exceptional: Very high fitness and high trust
    if (
      fitnessScore >= this.config.highRankingThreshold && 
      (trustScore === null || trustScore === undefined || trustScore >= 0.9)
    ) {
      return 'exceptional';
    }
    
    // High: High fitness
    if (fitnessScore >= this.config.highRankingThreshold) {
      return 'high';
    }
    
    // Medium: Good fitness
    if (fitnessScore >= this.config.persistThreshold + 0.05) {
      return 'medium';
    }
    
    // Low: Meets minimum threshold
    return 'low';
  }
  
  /**
   * Calculate TTL in milliseconds based on performance category
   * 
   * @param category - Performance category
   * @returns TTL in milliseconds or null for indefinite
   */
  private calculateTtl(category: EvolvedAgentSnapshot['performanceCategory']): number | null {
    const ttlDays = MEMORY_INJECTION_CONFIG.ttlDays[category];
    return daysToMs(ttlDays);
  }
} 