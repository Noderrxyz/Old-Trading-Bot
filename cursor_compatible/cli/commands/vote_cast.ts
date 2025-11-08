#!/usr/bin/env ts-node

/**
 * Vote Casting CLI Command
 * 
 * Cast a vote on an existing governance proposal
 */

/// <reference types="node" />

import { Command } from 'commander';
import { createLogger } from '../../src/common/logger.js';
import { createMockRedisClient } from '../../src/common/redis.js';
import { ProposalService } from '../../src/governance/proposalService.js';
import { VoteOption } from '../../src/governance/voteWeighting.js';

const logger = createLogger('CLI:VoteCast');

// Command options interface
interface VoteCastOptions {
  agentId: string;
  proposalId: string;
  vote: VoteOption;
}

// Get Redis client
async function getRedisClient() {
  // In a real implementation, this would connect to the actual Redis
  // For now, use mock for demonstration
  return createMockRedisClient();
}

// Create command
export const command = new Command('vote:cast')
  .description('Cast a vote on a governance proposal')
  .requiredOption('--agent-id <id>', 'ID of the agent voting')
  .requiredOption('--proposal-id <id>', 'ID of the proposal to vote on')
  .requiredOption('--vote <vote>', 'Vote option', /^(yes|no|abstain)$/)
  .action(async (options: VoteCastOptions) => {
    try {
      logger.info(`Agent ${options.agentId} casting vote '${options.vote}' on proposal ${options.proposalId}`);
      
      // Get Redis client
      const redisClient = await getRedisClient();
      
      // Create proposal service
      const proposalService = new ProposalService(redisClient);
      
      // Get proposal details first
      const proposal = await proposalService.getProposal(options.proposalId);
      
      if (!proposal) {
        logger.error(`Proposal ${options.proposalId} not found`);
        process.exit(1);
      }
      
      logger.info(`Proposal: ${proposal.title}`);
      logger.info(`Type: ${proposal.type}`);
      logger.info(`Status: ${proposal.status}`);
      
      if (proposal.status !== 'open') {
        logger.error(`Cannot vote on proposal with status '${proposal.status}'`);
        process.exit(1);
      }
      
      // Cast the vote
      const voteResult = await proposalService.vote(
        options.agentId,
        options.proposalId,
        options.vote as VoteOption
      );
      
      // Show vote summary
      logger.info('Vote cast successfully');
      logger.info(`Current vote summary:`);
      logger.info(`- Yes score: ${voteResult.yesScore.toFixed(4)}`);
      logger.info(`- No score: ${voteResult.noScore.toFixed(4)}`);
      logger.info(`- Abstain score: ${voteResult.abstainScore.toFixed(4)}`);
      logger.info(`- Total weighted score: ${voteResult.totalScore.toFixed(4)}`);
      logger.info(`- Quorum reached: ${voteResult.quorumReached ? 'Yes' : 'No'}`);
      logger.info(`- Proposal passed: ${voteResult.passed ? 'Yes' : 'No'}`);
      
      if (voteResult.quorumReached) {
        if (voteResult.passed) {
          logger.info('Proposal has PASSED based on current votes!');
        } else if (voteResult.noScore >= proposal.requiredApprovalThreshold) {
          logger.info('Proposal has been REJECTED based on current votes!');
        } else {
          logger.info('Quorum reached but neither approval nor rejection threshold met yet.');
        }
      } else {
        logger.info(`Quorum not yet reached. Required: ${proposal.requiredQuorum}`);
      }
      
    } catch (error) {
      logger.error('Error casting vote:', (error as Error).message);
      process.exit(1);
    }
  });

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 