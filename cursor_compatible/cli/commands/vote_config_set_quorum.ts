#!/usr/bin/env ts-node

/**
 * Vote Config: Set Quorum CLI Command
 * 
 * Configure quorum thresholds and requirements for the governance system
 */

/// <reference types="node" />

import { Command } from 'commander';
import { createLogger } from '../../src/common/logger.js';
import { createMockRedisClient } from '../../src/common/redis.js';
import { 
  getQuorumConfig, 
  setQuorumConfig, 
  QuorumConfig 
} from '../../src/governance/quorumEnforcement.js';

const logger = createLogger('CLI:SetQuorum');

// Command options interface
interface SetQuorumOptions {
  minAgents?: string;
  minWeightScore?: string;
  enforceRoles?: boolean;
  requiredRoles?: string;
  dryRun: boolean;
}

// Get Redis client
async function getRedisClient() {
  // In a real implementation, this would connect to the actual Redis
  // For now, use mock for demonstration
  return createMockRedisClient();
}

// Create command
export const command = new Command('vote:config:set-quorum')
  .description('Configure quorum thresholds and requirements')
  .option('--min-agents <number>', 'Minimum number of agents required for quorum')
  .option('--min-weight-score <number>', 'Minimum total weight score required for quorum')
  .option('--enforce-roles [boolean]', 'Whether to enforce role diversity requirements')
  .option('--required-roles <roles>', 'Comma-separated list of required roles (e.g., "leader,auditor")')
  .option('--dry-run', 'Show what would be set without making changes', false)
  .action(async (options: SetQuorumOptions) => {
    try {
      logger.info('Setting quorum configuration...');
      
      // Get Redis client
      const redisClient = await getRedisClient();
      
      // Get current config
      const currentConfig = await getQuorumConfig(redisClient);
      
      logger.info('Current quorum configuration:');
      logger.info(`- Minimum Agents: ${currentConfig.min_agents}`);
      logger.info(`- Minimum Weight Score: ${currentConfig.min_weight_score}`);
      logger.info(`- Enforce Roles: ${currentConfig.enforce_roles}`);
      logger.info(`- Required Roles: ${currentConfig.required_roles?.join(', ') || 'none'}`);
      
      // Prepare new config (using current values as defaults)
      const newConfig: QuorumConfig = {
        min_agents: options.minAgents ? parseInt(options.minAgents, 10) : currentConfig.min_agents,
        min_weight_score: options.minWeightScore ? parseFloat(options.minWeightScore) : currentConfig.min_weight_score,
        enforce_roles: options.enforceRoles !== undefined ? options.enforceRoles : currentConfig.enforce_roles,
        required_roles: options.requiredRoles ? options.requiredRoles.split(',') : currentConfig.required_roles
      };
      
      logger.info('\nNew quorum configuration:');
      logger.info(`- Minimum Agents: ${newConfig.min_agents}`);
      logger.info(`- Minimum Weight Score: ${newConfig.min_weight_score}`);
      logger.info(`- Enforce Roles: ${newConfig.enforce_roles}`);
      logger.info(`- Required Roles: ${newConfig.required_roles?.join(', ') || 'none'}`);
      
      // Validate config
      if (newConfig.min_agents < 1) {
        throw new Error('Minimum agents must be at least 1');
      }
      
      if (newConfig.min_weight_score <= 0) {
        throw new Error('Minimum weight score must be positive');
      }
      
      if (newConfig.enforce_roles && (!newConfig.required_roles || newConfig.required_roles.length === 0)) {
        throw new Error('Required roles must be specified when enforce_roles is true');
      }
      
      // Dry run check
      if (options.dryRun) {
        logger.info('\nDry run mode - no changes made');
        return;
      }
      
      // Set the new configuration
      await setQuorumConfig(redisClient, newConfig);
      logger.info('\nQuorum configuration updated successfully');
      
    } catch (error) {
      logger.error('Error setting quorum configuration:', (error as Error).message);
      process.exit(1);
    }
  });

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 