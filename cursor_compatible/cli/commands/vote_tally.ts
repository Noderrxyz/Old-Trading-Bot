#!/usr/bin/env ts-node

/**
 * Vote Tally CLI Command
 * 
 * Show the current tally of votes for a governance proposal
 */

/// <reference types="node" />

import { Command } from 'commander';
import { createLogger } from '../../src/common/logger.js';
import { createMockRedisClient } from '../../src/common/redis.js';
import { ProposalService } from '../../src/governance/proposalService.js';
import { getVoteStatus } from '../../src/governance/voteWeighting.js';

const logger = createLogger('CLI:VoteTally');

// Command options interface
interface VoteTallyOptions {
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
export const command = new Command('vote:tally')
  .description('Show the current tally of votes for a governance proposal')
  .requiredOption('--proposal-id <id>', 'ID of the proposal to tally')
  .option('--json', 'Output in JSON format', false)
  .action(async (options: VoteTallyOptions) => {
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
      
      // Get vote status
      const voteStatus = await getVoteStatus(redisClient, options.proposalId);
      
      if (!voteStatus) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'No votes found for this proposal' }));
        } else {
          logger.error(`No votes found for proposal ${options.proposalId}`);
        }
        process.exit(1);
      }
      
      // Determine proposal status
      let statusMessage = 'Pending';
      if (proposal.status !== 'open') {
        statusMessage = proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1);
      } else {
        if (voteStatus.passed) {
          statusMessage = 'Passing';
        } else if (voteStatus.noScore >= proposal.requiredApprovalThreshold) {
          statusMessage = 'Failing';
        } else if (voteStatus.quorumReached) {
          statusMessage = 'Quorum reached (no decision yet)';
        } else {
          statusMessage = 'Quorum not reached';
        }
      }
      
      // If JSON output is requested
      if (options.json) {
        const result = {
          proposal_id: proposal.id,
          title: proposal.title,
          type: proposal.type,
          status: proposal.status,
          created_by: proposal.createdBy,
          created_at: proposal.createdAt,
          expires_at: proposal.expiresAt,
          vote_summary: {
            yes_score: voteStatus.yesScore,
            no_score: voteStatus.noScore,
            abstain_score: voteStatus.abstainScore,
            total_score: voteStatus.totalScore,
            quorum_reached: voteStatus.quorumReached,
            passed: voteStatus.passed,
            status_message: statusMessage,
            votes_count: voteStatus.votes.length
          },
          thresholds: {
            quorum: proposal.requiredQuorum,
            approval: proposal.requiredApprovalThreshold
          }
        };
        
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      // Regular output (not JSON)
      logger.info(`===== Proposal: ${proposal.title} =====`);
      logger.info(`ID: ${proposal.id}`);
      logger.info(`Type: ${proposal.type}`);
      logger.info(`Status: ${proposal.status} (${statusMessage})`);
      logger.info(`Created by: ${proposal.createdBy}`);
      logger.info(`Created at: ${new Date(proposal.createdAt).toISOString()}`);
      logger.info(`Expires at: ${new Date(proposal.expiresAt).toISOString()}`);
      
      logger.info('\n===== Vote Summary =====');
      logger.info(`Yes Score: ${voteStatus.yesScore.toFixed(4)}`);
      logger.info(`No Score: ${voteStatus.noScore.toFixed(4)}`);
      logger.info(`Abstain Score: ${voteStatus.abstainScore.toFixed(4)}`);
      logger.info(`Total Score: ${voteStatus.totalScore.toFixed(4)}`);
      logger.info(`Quorum Reached: ${voteStatus.quorumReached ? 'Yes' : 'No'} (Required: ${proposal.requiredQuorum})`);
      logger.info(`Approval Threshold: ${proposal.requiredApprovalThreshold}`);
      logger.info(`Number of Votes: ${voteStatus.votes.length}`);
      
      logger.info('\n===== Individual Votes =====');
      voteStatus.votes.forEach((vote, index) => {
        logger.info(`Vote #${index + 1}:`);
        logger.info(`- Agent: ${vote.agentId}`);
        logger.info(`- Role: ${vote.role}`);
        logger.info(`- Vote: ${vote.vote}`);
        logger.info(`- Weighted Score: ${vote.score.toFixed(4)}`);
        logger.info(`- Trust Score: ${(vote.trustScore * 100).toFixed(1)}%`);
        logger.info('');
      });
      
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: (error as Error).message }));
      } else {
        logger.error('Error tallying votes:', (error as Error).message);
      }
      process.exit(1);
    }
  });

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 