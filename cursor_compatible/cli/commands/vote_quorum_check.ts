#!/usr/bin/env ts-node

/**
 * Vote Quorum Check CLI Command
 * 
 * Check if a proposal meets quorum requirements
 */

/// <reference types="node" />

import { Command } from 'commander';
import { createLogger } from '../../src/common/logger.js';
import { createMockRedisClient } from '../../src/common/redis.js';
import { checkQuorum, QuorumCheckResult } from '../../src/governance/quorumEnforcement.js';
import { ProposalService } from '../../src/governance/proposalService.js';

const logger = createLogger('CLI:QuorumCheck');

// Command options interface
interface QuorumCheckOptions {
  proposalId: string;
  json: boolean;
}

// Get Redis client
async function getRedisClient() {
  // In a real implementation, this would connect to the actual Redis
  // For now, use mock for demonstration
  return createMockRedisClient();
}

// Create command
export const command = new Command('vote:quorum-check')
  .description('Check if a proposal meets quorum requirements')
  .requiredOption('--proposal-id <id>', 'ID of the proposal to check')
  .option('--json', 'Output in JSON format', false)
  .action(async (options: QuorumCheckOptions) => {
    try {
      // Get Redis client
      const redisClient = await getRedisClient();
      
      // Create proposal service
      const proposalService = new ProposalService(redisClient);
      
      // Get proposal details
      const proposal = await proposalService.getProposal(options.proposalId);
      
      if (!proposal) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Proposal not found' }));
        } else {
          logger.error(`Proposal ${options.proposalId} not found`);
        }
        process.exit(1);
      }
      
      // Get quorum check result
      const result = await checkQuorum(redisClient, options.proposalId);
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      // Regular output (not JSON)
      logger.info(`===== Quorum Check for Proposal: ${proposal.title} =====`);
      logger.info(`ID: ${proposal.id}`);
      logger.info(`Type: ${proposal.type}`);
      logger.info(`Status: ${proposal.status}`);
      
      logger.info('\n===== Quorum Details =====');
      logger.info(`Number of Votes: ${result.votes}`);
      logger.info(`Total Weight: ${result.weight_total}`);
      logger.info(`Roles Present: ${result.roles.join(', ')}`);
      
      logger.info('\n===== Requirements =====');
      logger.info(`Headcount: ${result.details.passes_headcount ? '✓' : '✗'}`);
      logger.info(`Weight Threshold: ${result.details.passes_weight ? '✓' : '✗'}`);
      logger.info(`Role Diversity: ${result.details.passes_role_diversity ? '✓' : '✗'}`);
      
      logger.info(`\nOverall Quorum Status: ${result.quorum_passed ? 'PASSED' : 'FAILED'}`);
      
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: (error as Error).message }));
      } else {
        logger.error('Error checking quorum:', (error as Error).message);
      }
      process.exit(1);
    }
  });

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 