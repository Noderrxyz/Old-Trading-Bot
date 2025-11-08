#!/usr/bin/env ts-node
/**
 * agent-graph-consolidation.ts
 * 
 * Recurring job that runs the Policy Graph Consolidation Engine
 * periodically to optimize agent policy graphs based on regret,
 * performance, and decision trace alignment.
 */

import dotenv from 'dotenv';
import { RedisService } from '../services/infrastructure/RedisService.js';
import { RegretBuffer } from '../services/agent/RegretBuffer.js';
import { TrustScoreService } from '../services/agent/TrustScoreService.js';
import { PolicyGraphConsolidationService } from '../services/agent/policy-graph/PolicyGraphConsolidationService.js';
import logger from '../utils/logger.js';

// Load environment variables
dotenv.config();

// Configuration
const CONFIG = {
  // How often to run the job (default: every 24 hours)
  runIntervalMs: parseInt(process.env.GRAPH_CONSOLIDATION_INTERVAL_MS || '86400000'),
  
  // Maximum agents to process per run
  maxAgentsPerBatch: parseInt(process.env.GRAPH_CONSOLIDATION_BATCH_SIZE || '50'),
  
  // Whether to run in dry run mode (simulate but don't apply changes)
  dryRun: process.env.GRAPH_CONSOLIDATION_DRY_RUN === 'true',
  
  // Redis connection
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
  }
};

// Services
let redisService: RedisService;
let regretBuffer: RegretBuffer;
let trustScoreService: TrustScoreService;
let consolidationService: PolicyGraphConsolidationService;

/**
 * Initialize required services
 */
async function initializeServices(): Promise<void> {
  try {
    // Initialize Redis
    redisService = new RedisService(`redis://${CONFIG.redis.host}:${CONFIG.redis.port}`);
    
    // Initialize RegretBuffer
    regretBuffer = new RegretBuffer(redisService);
    
    // Initialize TrustScoreService
    trustScoreService = new TrustScoreService(redisService);
    
    // Initialize PolicyGraphConsolidationService
    consolidationService = PolicyGraphConsolidationService.createService(
      regretBuffer,
      trustScoreService,
      redisService,
      {
        dryRun: CONFIG.dryRun,
        maxAgentsPerBatch: CONFIG.maxAgentsPerBatch
      }
    );
    
    logger.info('Services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    throw error;
  }
}

/**
 * Run the consolidation process
 */
async function runConsolidation(): Promise<void> {
  try {
    logger.info('Starting policy graph consolidation job', {
      dryRun: CONFIG.dryRun,
      maxAgentsPerBatch: CONFIG.maxAgentsPerBatch
    });
    
    // Run batch consolidation
    const results = await consolidationService.consolidateBatch();
    
    // Log results
    const successfulAgents = results.filter(r => r.success);
    const agentsWithChanges = results.filter(r => r.changesApplied > 0);
    const totalChanges = results.reduce((sum, r) => sum + r.changesApplied, 0);
    
    logger.info('Consolidation job complete', {
      totalAgents: results.length,
      successfulAgents: successfulAgents.length,
      agentsWithChanges: agentsWithChanges.length,
      totalChangesApplied: totalChanges,
      dryRun: CONFIG.dryRun
    });
  } catch (error) {
    logger.error('Error running consolidation job', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Cleanup resources before exit
 */
async function cleanup(): Promise<void> {
  try {
    // Close Redis connection
    await redisService.close();
    
    logger.info('Resources cleaned up');
  } catch (error) {
    logger.error('Error cleaning up resources', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Main function that runs once or periodically
 */
async function main(): Promise<void> {
  try {
    // Initialize services
    await initializeServices();
    
    // Check if this is a one-time run or continuous job
    const isOneTimeRun = process.argv.includes('--once');
    
    if (isOneTimeRun) {
      // Run once and exit
      await runConsolidation();
      await cleanup();
      process.exit(0);
    } else {
      // Run immediately, then schedule recurring runs
      await runConsolidation();
      
      // Schedule recurring runs
      logger.info(`Scheduling next run in ${CONFIG.runIntervalMs / (60 * 1000)} minutes`);
      
      setInterval(async () => {
        try {
          await runConsolidation();
        } catch (error) {
          logger.error('Error in scheduled consolidation', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }, CONFIG.runIntervalMs);
      
      // Handle process termination
      process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down');
        await cleanup();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down');
        await cleanup();
        process.exit(0);
      });
    }
  } catch (error) {
    logger.error('Fatal error in consolidation job', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  logger.error('Unhandled error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  
  process.exit(1);
}); 