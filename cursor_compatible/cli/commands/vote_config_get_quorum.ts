#!/usr/bin/env ts-node

/**
 * Vote Config: Get Quorum CLI Command
 * 
 * Display current quorum configuration for the governance system
 */

/// <reference types="node" />

import { Command } from 'commander';
import { createLogger } from '../../src/common/logger.js';
import { createMockRedisClient } from '../../src/common/redis.js';
import { 
  getQuorumConfig, 
  ensureDefaultQuorumConfig 
} from '../../src/governance/quorumEnforcement.js';

const logger = createLogger('CLI:GetQuorum');

// Command options interface
interface GetQuorumOptions {
  json: boolean;
}

// Get Redis client
async function getRedisClient() {
  // In a real implementation, this would connect to the actual Redis
  // For now, use mock for demonstration
  return createMockRedisClient();
}

// Create command
export const command = new Command('vote:config:get-quorum')
  .description('Display current quorum configuration for the governance system')
  .option('--json', 'Output in JSON format', false)
  .action(async (options: GetQuorumOptions) => {
    try {
      // Get Redis client
      const redisClient = await getRedisClient();
      
      // Ensure default config exists and get current config
      const config = await ensureDefaultQuorumConfig(redisClient);
      
      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      
      // Display human-readable output
      logger.info('===== Governance Quorum Configuration =====');
      logger.info(`Minimum Agents: ${config.min_agents}`);
      logger.info(`Minimum Weight Score: ${config.min_weight_score}`);
      logger.info(`Enforce Role Diversity: ${config.enforce_roles ? 'Yes' : 'No'}`);
      
      if (config.enforce_roles && config.required_roles) {
        logger.info(`Required Roles: ${config.required_roles.join(', ')}`);
      }
      
      // Display help text
      logger.info('\nTo modify these settings, use:');
      logger.info('vote:config:set-quorum --min-agents <num> --min-weight-score <score> [--enforce-roles] [--required-roles <roles>]');
      
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: (error as Error).message }));
      } else {
        logger.error('Error getting quorum configuration:', (error as Error).message);
      }
      process.exit(1);
    }
  });

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 