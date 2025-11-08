#!/usr/bin/env ts-node

/**
 * List Agent Roles CLI Command
 * 
 * Command-line utility for listing all agent role assignments.
 */

import { program } from 'commander';
import { createMockRedisClient } from '../../src/common/redis.js';
import { createLogger } from '../../src/common/logger.js';
import { GovernanceService } from '../../src/agents/governance/service.js';
import { GovernanceRole } from '../../src/agents/governance/models.js';

const logger = createLogger('CLI:ListRoles');

// Define the command options
program
  .name('list:agent-roles')
  .description('List all agent role assignments')
  .option('-r, --role <role>', 'Filter by specific role')
  .option('-j, --json', 'Output as JSON')
  .parse(process.argv);

const opts = program.opts();

// Validate the role if provided
if (opts.role) {
  const validRoles = Object.values(GovernanceRole);
  if (!validRoles.includes(opts.role)) {
    logger.error(`Invalid role: ${opts.role}`);
    logger.info(`Valid roles: ${validRoles.join(', ')}`);
    process.exit(1);
  }
}

// Main function
(async () => {
  try {
    const redis = createMockRedisClient();
    const governanceService = new GovernanceService(redis);
    
    // If filtering by role
    if (opts.role) {
      const agents = await governanceService.getAgentsWithRole(opts.role);
      
      if (opts.json) {
        console.log(JSON.stringify({ role: opts.role, agents }, null, 2));
      } else {
        logger.info(`Agents with role '${opts.role}': ${agents.length}`);
        if (agents.length === 0) {
          logger.info('No agents found with this role');
        } else {
          agents.forEach((agentId, index) => {
            logger.info(`${index + 1}. ${agentId}`);
          });
        }
      }
    } else {
      // Get all role assignments
      const roleMap = await governanceService.getAllRoleAssignments();
      
      if (opts.json) {
        // Convert Map to object for JSON serialization
        const result: Record<string, string[]> = {};
        for (const [role, agents] of roleMap.entries()) {
          result[role] = agents;
        }
        console.log(JSON.stringify(result, null, 2));
      } else {
        logger.info('Agent Role Assignments:');
        logger.info('----------------------');
        
        let totalAgents = 0;
        
        for (const [role, agents] of roleMap.entries()) {
          logger.info(`Role: ${role} (${agents.length} agents)`);
          
          if (agents.length > 0) {
            agents.forEach((agentId, index) => {
              logger.info(`  ${index + 1}. ${agentId}`);
            });
          } else {
            logger.info('  No agents assigned');
          }
          
          logger.info('');
          totalAgents += agents.length;
        }
        
        logger.info(`Total: ${totalAgents} agent role assignments`);
      }
    }
  } catch (error) {
    logger.error(`Failed to list roles: ${error.message}`);
    process.exit(1);
  }
})(); 