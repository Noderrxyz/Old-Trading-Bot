#!/usr/bin/env ts-node
/**
 * agent-graph-consolidate.ts
 * 
 * CLI tool for running the Policy Graph Consolidation Engine.
 * 
 * Usage:
 *   ts-node agent-graph-consolidate.ts --agent=<agent_id> [--force] [--dry-run] [--verbose]
 *   ts-node agent-graph-consolidate.ts --batch [--max=50] [--dry-run] [--verbose]
 */

import dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { RedisService } from '../services/infrastructure/RedisService.js';
import { RegretBuffer } from '../services/agent/RegretBuffer.js';
import { TrustScoreService } from '../services/agent/TrustScoreService.js';
import { PolicyGraphConsolidationService } from '../services/agent/policy-graph/PolicyGraphConsolidationService.js';
import logger from '../utils/logger.js';

// Load environment variables
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('agent', {
    alias: 'a',
    description: 'Agent ID to consolidate',
    type: 'string'
  })
  .option('batch', {
    alias: 'b',
    description: 'Run batch consolidation for all eligible agents',
    type: 'boolean'
  })
  .option('max', {
    alias: 'm',
    description: 'Maximum agents to process in batch mode',
    type: 'number',
    default: 50
  })
  .option('force', {
    alias: 'f',
    description: 'Force consolidation even if recently consolidated',
    type: 'boolean',
    default: false
  })
  .option('dry-run', {
    alias: 'd',
    description: 'Run in dry-run mode (no actual changes)',
    type: 'boolean',
    default: false
  })
  .option('verbose', {
    alias: 'v',
    description: 'Enable verbose logging',
    type: 'boolean',
    default: false
  })
  .help()
  .alias('help', 'h')
  .epilogue('For more information, see the documentation')
  .argv;

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  
  try {
    // Set up logging
    if (argv.verbose) {
      logger.level = 'debug';
    }
    
    logger.info('Starting Policy Graph Consolidation Engine', {
      mode: argv.batch ? 'batch' : 'single',
      dryRun: argv['dry-run'],
      force: argv.force
    });
    
    // Initialize services
    const services = await initializeServices();
    
    // Run consolidation
    if (argv.batch) {
      await runBatchConsolidation(services);
    } else if (argv.agent) {
      await runSingleAgentConsolidation(services, argv.agent);
    } else {
      logger.error('Neither --agent nor --batch specified. Use --help for usage information.');
      process.exit(1);
    }
    
    const duration = (Date.now() - startTime) / 1000;
    logger.info(`Consolidation completed in ${duration.toFixed(2)} seconds`);
    
    // Clean exit
    await cleanupServices(services);
    process.exit(0);
  } catch (error) {
    logger.error('Error running consolidation', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    process.exit(1);
  }
}

/**
 * Initialize required services
 */
async function initializeServices() {
  try {
    // Initialize Redis
    const redisService = new RedisService();
    
    // Initialize RegretBuffer
    const regretBuffer = new RegretBuffer(redisService);
    
    // Initialize TrustScoreService
    const trustScoreService = new TrustScoreService(redisService);
    
    // Initialize PolicyGraphConsolidationService
    const consolidationService = PolicyGraphConsolidationService.createService(
      regretBuffer,
      trustScoreService,
      redisService,
      {
        dryRun: argv['dry-run'],
        maxAgentsPerBatch: argv.max
      }
    );
    
    logger.info('Services initialized successfully');
    
    return {
      redisService,
      regretBuffer,
      trustScoreService,
      consolidationService
    };
  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    throw error;
  }
}

/**
 * Run consolidation for a single agent
 */
async function runSingleAgentConsolidation(
  services: any,
  agentId: string
) {
  logger.info('Running consolidation for agent', { agentId });
  
  // Run consolidation
  const result = await services.consolidationService.consolidateAgent(
    agentId,
    argv.force
  );
  
  if (!result.updatedGraph) {
    logger.warn('No graph found for agent or consolidation failed', { agentId });
    return;
  }
  
  // Log results
  logger.info('Consolidation results', {
    agentId,
    suggestionCount: result.suggestions.length,
    changesApplied: result.changes.length,
    dryRun: argv['dry-run']
  });
  
  if (argv.verbose) {
    // Show details of changes
    for (const change of result.changes) {
      logger.debug('Applied change', {
        type: change.type,
        reason: change.reason,
        targetIds: change.targetIds
      });
    }
    
    // Show unused suggestions
    const unusedSuggestions = result.suggestions.filter(
      s => !result.changes.some(c => 
        c.type === s.type && 
        c.targetIds.some(id => s.targetIds.includes(id))
      )
    );
    
    if (unusedSuggestions.length > 0) {
      logger.debug('Unused suggestions', {
        count: unusedSuggestions.length,
        reasons: unusedSuggestions.map(s => s.reason)
      });
    }
  }
}

/**
 * Run batch consolidation for all eligible agents
 */
async function runBatchConsolidation(services: any) {
  logger.info('Running batch consolidation', {
    maxAgents: argv.max
  });
  
  // Run batch consolidation
  const results = await services.consolidationService.consolidateBatch();
  
  // Summarize results
  const successful = results.filter(r => r.success);
  const withChanges = results.filter(r => r.changesApplied > 0);
  const totalChanges = results.reduce((sum, r) => sum + r.changesApplied, 0);
  
  logger.info('Batch consolidation results', {
    totalAgents: results.length,
    successfulAgents: successful.length,
    agentsWithChanges: withChanges.length,
    totalChangesApplied: totalChanges,
    dryRun: argv['dry-run']
  });
  
  if (argv.verbose) {
    // Show details for each agent
    for (const result of results) {
      logger.debug('Agent result', {
        agentId: result.agentId,
        success: result.success,
        changesApplied: result.changesApplied
      });
    }
  }
}

/**
 * Clean up services before exit
 */
async function cleanupServices(services: any) {
  try {
    // Close Redis connection
    await services.redisService.close();
    
    logger.info('Services cleaned up successfully');
  } catch (error) {
    logger.error('Error cleaning up services', {
      error: error instanceof Error ? error.message : String(error)
    });
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