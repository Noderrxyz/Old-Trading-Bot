#!/usr/bin/env node

/**
 * Agent Memory Persistence Job
 * 
 * This job persists top-performing agents into long-term memory for future
 * training cycles, strategy seeding, and forensic audits.
 * 
 * This enables evolution to build on successful patterns and preserves
 * architectural patterns that have proven effective.
 */

import { RedisService } from '../services/redis/RedisService.js';
import { LongTermAgentMemory } from '../services/memory/LongTermAgentMemory.js';
import logger from '../utils/logger.js';
import { MEMORY_INJECTION_CONFIG } from '../config/agent_meta_rewards.config.js';
import { TrustScoreService } from '../services/agent/TrustScoreService.js';

// Create service instances
let redisService: RedisService;
let trustScoreService: TrustScoreService;
let memoryService: LongTermAgentMemory;

/**
 * Initialize services required for the job
 */
async function initializeServices(): Promise<void> {
  try {
    // Initialize Redis
    redisService = new RedisService({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
    });
    
    await redisService.connect();
    logger.info('Connected to Redis');
    
    // Initialize Trust Score Service (if available)
    try {
      trustScoreService = new TrustScoreService(redisService);
      logger.info('Initialized Trust Score Service');
    } catch (error) {
      logger.warn(`Could not initialize Trust Score Service: ${error instanceof Error ? error.message : String(error)}`);
      trustScoreService = null as any;
    }
    
    // Initialize Long-Term Memory Service
    memoryService = new LongTermAgentMemory(
      redisService,
      trustScoreService,
      {
        redisKeyPrefix: MEMORY_INJECTION_CONFIG.redisKeyPrefix,
        topN: MEMORY_INJECTION_CONFIG.topN,
        persistThreshold: MEMORY_INJECTION_CONFIG.persistThreshold,
        ttlLowRankingMs: MEMORY_INJECTION_CONFIG.ttlLowRankingMs,
        highRankingThreshold: MEMORY_INJECTION_CONFIG.highRankingThreshold,
        minConsistencyCount: MEMORY_INJECTION_CONFIG.minConsistencyCount,
        requireZeroViolations: MEMORY_INJECTION_CONFIG.requireZeroViolations,
        memoryTags: MEMORY_INJECTION_CONFIG.memoryTags,
        includeFullStrategySnapshots: MEMORY_INJECTION_CONFIG.includeFullStrategySnapshots
      }
    );
    
    logger.info('Initialized Memory Service');
  } catch (error) {
    logger.error(`Error initializing services: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Clean up resources before exiting
 */
async function cleanup(): Promise<void> {
  try {
    if (redisService) {
      await redisService.disconnect();
      logger.info('Disconnected from Redis');
    }
  } catch (error) {
    logger.error(`Error during cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get list of agent IDs from Redis
 */
async function getAgentIds(): Promise<string[]> {
  try {
    // Get all agent IDs from the registry
    const agentKeys = await redisService.redis.keys('agent:*:config');
    
    // Extract agent IDs from keys
    return agentKeys.map(key => {
      const parts = key.split(':');
      return parts[1]; // agent:ID:config
    });
  } catch (error) {
    logger.error(`Error fetching agent IDs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get agent fitness scores
 */
async function getAgentFitnessScores(agentId: string): Promise<Array<{
  timestamp: number;
  fitnessScore: number;
  metrics?: Record<string, number>;
}>> {
  try {
    // Get fitness scores from Redis
    const scoresKey = `agent:${agentId}:fitness:history`;
    const jsonScores = await redisService.redis.lrange(scoresKey, 0, -1);
    
    if (!jsonScores || jsonScores.length === 0) {
      return [];
    }
    
    // Parse and return scores
    return jsonScores.map(json => JSON.parse(json));
  } catch (error) {
    logger.error(`Error fetching fitness scores for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get agent config
 */
async function getAgentConfig(agentId: string): Promise<Record<string, any> | null> {
  try {
    const configKey = `agent:${agentId}:config`;
    const json = await redisService.redis.get(configKey);
    
    if (!json) {
      return null;
    }
    
    return JSON.parse(json);
  } catch (error) {
    logger.error(`Error fetching config for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Process agent data for persistence
 */
async function processAgentsForPersistence(): Promise<void> {
  try {
    // Get list of agent IDs
    const agentIds = await getAgentIds();
    
    if (agentIds.length === 0) {
      logger.info('No agents found for memory persistence');
      return;
    }
    
    logger.info(`Found ${agentIds.length} agents for memory persistence processing`);
    
    // Process each agent
    const agentEvaluations = new Map();
    const agentStrategies = new Map();
    
    for (const agentId of agentIds) {
      try {
        // Get agent fitness scores
        const fitnessScores = await getAgentFitnessScores(agentId);
        
        if (fitnessScores.length === 0) {
          logger.info(`No fitness scores found for agent ${agentId}, skipping`);
          continue;
        }
        
        logger.info(`Processing ${fitnessScores.length} fitness scores for agent ${agentId}`);
        
        // Get agent config
        const agentConfig = await getAgentConfig(agentId);
        
        if (!agentConfig) {
          logger.warn(`No config found for agent ${agentId}, skipping`);
          continue;
        }
        
        // Add to collections for persistence
        // These collections will be passed to the memoryService.persistTopPerformers method
        // See implementation in EvolutionEngine for details on expected structure
        
        // Implementation details would go here...
        // This example job uses simplified direct persistence instead
        
        // For each qualifying score, create and persist a snapshot
        const qualifyingScores = fitnessScores.filter(
          score => score.fitnessScore >= MEMORY_INJECTION_CONFIG.persistThreshold
        ).sort((a, b) => b.fitnessScore - a.fitnessScore);
        
        // Keep only top N scores
        const topScores = qualifyingScores.slice(0, MEMORY_INJECTION_CONFIG.topN);
        
        // Add to persistence batch
        if (topScores.length > 0) {
          logger.info(`Agent ${agentId} has ${topScores.length} qualifying scores for persistence`);
          
          // Get trust score if available
          let trustScore = null;
          let violationCount = 0;
          
          if (trustScoreService) {
            try {
              trustScore = await trustScoreService.getAgentTrustScore(agentId);
              violationCount = await trustScoreService.getViolationCount(agentId);
              
              if (violationCount > 0 && MEMORY_INJECTION_CONFIG.requireZeroViolations) {
                logger.info(`Agent ${agentId} has ${violationCount} violations, skipping persistence`);
                continue;
              }
            } catch (error) {
              logger.warn(`Error getting trust score for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          
          // Simple direct persistence example
          const persistedCount = await directPersistAgent(agentId, topScores, agentConfig, trustScore, violationCount);
          logger.info(`Persisted ${persistedCount} snapshots for agent ${agentId}`);
        }
      } catch (error) {
        logger.error(`Error processing agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    logger.error(`Error processing agents for persistence: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Direct persistence implementation for simple standalone job
 */
async function directPersistAgent(
  agentId: string,
  topScores: Array<{ timestamp: number; fitnessScore: number; metrics?: Record<string, number> }>,
  agentConfig: Record<string, any>,
  trustScore: number | null,
  violationCount: number
): Promise<number> {
  let persistedCount = 0;
  
  try {
    // Check for consistency
    const isConsistent = topScores.length >= MEMORY_INJECTION_CONFIG.minConsistencyCount;
    
    for (const score of topScores) {
      try {
        // Create strategy
        const strategyId = `${agentId}-strategy-${score.timestamp}`;
        const strategy = createStrategyFromAgentConfig(agentId, strategyId, agentConfig);
        
        // Create evaluation result
        const evaluation = {
          agentId,
          strategyId,
          sharpe: score.metrics?.sharpe || 0,
          maxDrawdown: score.metrics?.maxDrawdown || 0.2,
          winRate: score.metrics?.winRate || 0.5,
          volatilityResilience: score.metrics?.volatility || 0.5,
          regretIndex: 0.1,
          fitnessScore: score.fitnessScore,
          passed: true,
          timestamp: score.timestamp,
          generationId: `gen-${score.timestamp}`,
          rawMetrics: score.metrics
        };
        
        // Create and persist snapshot
        const snapshot = await memoryService.createAgentSnapshot(
          agentId,
          evaluation as any,
          strategy as any,
          trustScore,
          topScores.map(s => ({
            epochId: `epoch-${s.timestamp}`,
            timestamp: s.timestamp,
            score: s.fitnessScore
          }))
        );
        
        // Update consistency count
        snapshot.evolutionMetadata.iterationConsistency = isConsistent 
          ? topScores.length 
          : 1;
        
        // Inject snapshot
        const memoryId = await memoryService.injectAgentMemorySnapshot(snapshot);
        
        if (memoryId) {
          persistedCount++;
        }
      } catch (error) {
        logger.error(`Error persisting score for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return persistedCount;
  } catch (error) {
    logger.error(`Error in direct persistence for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
    return persistedCount;
  }
}

/**
 * Create a trading strategy from agent configuration
 */
function createStrategyFromAgentConfig(
  agentId: string,
  strategyId: string,
  agentConfig: Record<string, any>
): any {
  // Create a trading strategy from agent configuration
  // This would need to be customized based on your agent config structure
  return {
    id: strategyId,
    name: agentConfig.name || `Agent ${agentId} Strategy`,
    version: agentConfig.version || '1.0.0',
    description: agentConfig.description || `Strategy for agent ${agentId}`,
    indicators: {
      rsi: agentConfig.indicators?.rsi || {
        enabled: true,
        weight: 1.0,
        period: 14,
        overboughtThreshold: 70,
        oversoldThreshold: 30
      },
      macd: agentConfig.indicators?.macd || {
        enabled: true,
        weight: 1.0,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9
      },
      bollingerBands: agentConfig.indicators?.bollingerBands || {
        enabled: true,
        weight: 1.0,
        period: 20,
        stdDev: 2
      }
    },
    riskParameters: {
      maxPositionSize: agentConfig.risk?.maxPositionSize || 0.1,
      stopLoss: agentConfig.risk?.stopLoss || 0.02,
      takeProfit: agentConfig.risk?.takeProfit || 0.04,
      maxDrawdown: agentConfig.risk?.maxDrawdown || 0.15,
      maxOpenPositions: agentConfig.risk?.maxOpenPositions || 5
    },
    signalSettings: {
      threshold: agentConfig.signal?.threshold || 0.5,
      minConfidence: agentConfig.signal?.minConfidence || 0.6,
      combinationMethod: agentConfig.signal?.combinationMethod || 'weighted',
      entryConditions: agentConfig.signal?.entryConditions || [],
      exitConditions: agentConfig.signal?.exitConditions || []
    },
    timeSettings: {
      tradingHours: agentConfig.time?.tradingHours || {
        start: '00:00',
        end: '23:59'
      },
      tradingDays: agentConfig.time?.tradingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      timeframe: agentConfig.time?.timeframe || '1h'
    },
    assetClasses: agentConfig.assetClasses || ['crypto'],
    marketConditions: agentConfig.marketConditions || ['trending', 'volatile', 'sideways'],
    customParameters: agentConfig.customParameters || {},
    createdAt: agentConfig.createdAt || Date.now(),
    updatedAt: agentConfig.updatedAt || Date.now(),
    parentId: agentConfig.parentId
  };
}

/**
 * Run the memory persistence job
 */
async function runMemoryPersistenceJob(): Promise<void> {
  try {
    logger.info('Starting agent memory persistence job');
    
    // Initialize services
    await initializeServices();
    
    // Process agents
    await processAgentsForPersistence();
    
    logger.info('Agent memory persistence job completed successfully');
  } catch (error) {
    logger.error(`Memory persistence job failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    // Clean up
    await cleanup();
  }
}

// Run the job when the script is executed directly
if (require.main === module) {
  runMemoryPersistenceJob()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Unhandled error in memory persistence job:', error);
      process.exit(1);
    });
} 