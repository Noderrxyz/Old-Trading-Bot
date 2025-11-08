#!/usr/bin/env ts-node

/**
 * Vote Proposal CLI Command
 * 
 * Creates a new governance proposal for voting
 */

import { Command } from 'commander';
import { createLogger } from '../../src/common/logger.js';
import { createMockRedisClient } from '../../src/common/redis.js';
import { ProposalService, ProposalType } from '../../src/governance/proposalService.js';

const logger = createLogger('CLI:VotePropose');

// Command options interface
interface VoteProposeOptions {
  agentId: string;
  type: string;
  title: string;
  description: string;
  expiryHours?: string;
  quorum?: string;
  threshold?: string;
  dryRun: boolean;
}

// Helper to read the proposal data from stdin
async function readProposalData(): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let data = '';
    
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    
    process.stdin.on('end', () => {
      try {
        const parsedData = JSON.parse(data);
        resolve(parsedData);
      } catch (e) {
        logger.error('Failed to parse proposal data as JSON');
        resolve({});
      }
    });
  });
}

// Get Redis client
async function getRedisClient(dryRun: boolean) {
  // In a real implementation, this would connect to the actual Redis
  // For now, use mock for demonstration
  return createMockRedisClient();
}

// Create command
export const command = new Command('vote:propose')
  .description('Create a new governance proposal for voting')
  .requiredOption('--agent-id <id>', 'ID of the agent creating the proposal')
  .requiredOption('--type <type>', 'Type of proposal', /^(strategy_approval|parameter_change|agent_role_change|system_upgrade|emergency_action)$/)
  .requiredOption('--title <title>', 'Proposal title')
  .requiredOption('--description <description>', 'Proposal description')
  .option('--expiry-hours <hours>', 'Voting period in hours (default: 48)')
  .option('--quorum <score>', 'Required quorum weighted score (default: 2.5)')
  .option('--threshold <score>', 'Required approval threshold (default: 2.0)')
  .option('--dry-run', 'Simulate without making changes', false)
  .action(async (options: VoteProposeOptions) => {
    try {
      logger.info('Creating new governance proposal');
      
      // Convert proposal type
      const type = options.type as ProposalType;
      
      // Parse options
      const expiryHours = options.expiryHours ? parseFloat(options.expiryHours) : 48;
      const quorum = options.quorum ? parseFloat(options.quorum) : 2.5;
      const threshold = options.threshold ? parseFloat(options.threshold) : 2.0;
      
      logger.info(`Proposal Type: ${type}`);
      logger.info(`Title: ${options.title}`);
      logger.info(`Description: ${options.description}`);
      logger.info(`Agent ID: ${options.agentId}`);
      logger.info(`Expiry: ${expiryHours} hours`);
      logger.info(`Required Quorum: ${quorum}`);
      logger.info(`Approval Threshold: ${threshold}`);
      
      // Read proposal data from stdin
      logger.info('Reading proposal data from stdin (JSON)...');
      const proposalData = await readProposalData();
      
      if (Object.keys(proposalData).length === 0) {
        logger.error('No proposal data provided. Exiting.');
        process.exit(1);
      }
      
      // Log the data
      logger.info('Proposal Data:');
      for (const [key, value] of Object.entries(proposalData)) {
        logger.info(`- ${key}: ${JSON.stringify(value)}`);
      }
      
      // Dry run check
      if (options.dryRun) {
        logger.info('Dry run - no changes will be made');
        process.exit(0);
      }
      
      // Get Redis client
      const redisClient = await getRedisClient(options.dryRun);
      
      // Create proposal service
      const proposalService = new ProposalService(redisClient);
      
      // Create the proposal
      const proposal = await proposalService.createProposal(
        options.agentId,
        options.title,
        options.description,
        type,
        proposalData,
        {
          expiryHours,
          requiredQuorum: quorum,
          requiredApprovalThreshold: threshold
        }
      );
      
      logger.info(`Proposal created successfully with ID: ${proposal.id}`);
      logger.info(`Voting is open until: ${new Date(proposal.expiresAt).toISOString()}`);
      
      // Output the proposal ID for piping to other commands
      console.log(proposal.id);
      
    } catch (error) {
      logger.error('Error creating proposal:', (error as Error).message);
      process.exit(1);
    }
  });

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 