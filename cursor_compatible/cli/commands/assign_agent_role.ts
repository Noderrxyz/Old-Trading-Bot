#!/usr/bin/env ts-node

/**
 * Assign Agent Role CLI Command
 * 
 * Command-line utility for assigning governance roles to agents.
 */

import { program } from 'commander';
import { createMockRedisClient } from '../../src/common/redis.js';
import { createLogger } from '../../src/common/logger.js';
import { GovernanceService } from '../../src/agents/governance/service.js';
import { GovernanceRole } from '../../src/agents/governance/models.js';

const logger = createLogger('CLI:AssignRole');

// Define the command options
program
  .name('assign:agent-role')
  .description('Assign a governance role to an agent')
  .requiredOption('-a, --agent <id>', 'Agent ID')
  .requiredOption('-r, --role <role>', 'Role to assign')
  .option('--reason <text>', 'Reason for assignment', 'manual CLI assignment')
  .option('--by <assignor>', 'Who is assigning the role', 'cli-user')
  .parse(process.argv);

const opts = program.opts();

// Validate the role
const validRoles = Object.values(GovernanceRole);
if (!validRoles.includes(opts.role)) {
  logger.error(`Invalid role: ${opts.role}`);
  logger.info(`Valid roles: ${validRoles.join(', ')}`);
  process.exit(1);
}

// Main function
(async () => {
  try {
    const redis = createMockRedisClient();
    const governanceService = new GovernanceService(redis);
    
    // Get current role
    const currentRole = await governanceService.getAgentRole(opts.agent);
    
    // Assign new role
    await governanceService.assignRole(
      opts.agent,
      opts.role,
      opts.reason,
      opts.by
    );
    
    logger.success(`Assigned role '${opts.role}' to agent ${opts.agent}`);
    if (currentRole) {
      logger.info(`Previous role was: ${currentRole}`);
    }
    
    // Show current assignments for the role
    const agentsWithRole = await governanceService.getAgentsWithRole(opts.role);
    
    logger.info(`Agents with role '${opts.role}': ${agentsWithRole.length}`);
    agentsWithRole.forEach(agentId => {
      logger.info(`- ${agentId}`);
    });
  } catch (error) {
    logger.error(`Failed to assign role: ${error.message}`);
    process.exit(1);
  }
})(); 