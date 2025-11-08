#!/usr/bin/env ts-node

/**
 * Remove Agent Role CLI Command
 * 
 * Command-line utility for removing governance roles from agents.
 */

import { program } from 'commander';
import { createMockRedisClient } from '../../src/common/redis.js';
import { createLogger } from '../../src/common/logger.js';
import { GovernanceService } from '../../src/agents/governance/service.js';

const logger = createLogger('CLI:RemoveRole');

// Define the command options
program
  .name('remove:agent-role')
  .description('Remove a governance role from an agent')
  .requiredOption('-a, --agent <id>', 'Agent ID')
  .option('--reason <text>', 'Reason for removal', 'manual CLI removal')
  .parse(process.argv);

const opts = program.opts();

// Main function
(async () => {
  try {
    const redis = createMockRedisClient();
    const governanceService = new GovernanceService(redis);
    
    // Get current role
    const currentRole = await governanceService.getAgentRole(opts.agent);
    
    if (!currentRole) {
      logger.warn(`Agent ${opts.agent} doesn't have any role assigned`);
      process.exit(0);
    }
    
    // Remove role
    await governanceService.removeRole(opts.agent, opts.reason);
    
    logger.success(`Removed role '${currentRole}' from agent ${opts.agent}`);
    
    // Show remaining agents with that role (currentRole is guaranteed to be non-null here)
    const roleToCheck: string = currentRole;
    const agentsWithRole = await governanceService.getAgentsWithRole(roleToCheck);
    
    logger.info(`Remaining agents with role '${roleToCheck}': ${agentsWithRole.length}`);
    if (agentsWithRole.length > 0) {
      agentsWithRole.forEach(agentId => {
        logger.info(`- ${agentId}`);
      });
    }
  } catch (error) {
    logger.error(`Failed to remove role: ${error.message}`);
    process.exit(1);
  }
})(); 