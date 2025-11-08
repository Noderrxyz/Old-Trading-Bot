/**
 * Quorum Enforcement Example
 * 
 * Demonstrates how the quorum enforcement system works in the governance system
 */

import { createMockRedisClient } from '../common/redis.js';
import { createLogger } from '../common/logger.js';
import {
  ProposalService,
  ProposalType,
  computeWeightedScore,
  hasRequiredRole,
  checkQuorum,
  getQuorumConfig,
  setQuorumConfig,
  QuorumConfig
} from '../governance/index.js';

const logger = createLogger('QuorumExample');

/**
 * Run the quorum enforcement example
 */
async function runExample() {
  logger.info('Starting quorum enforcement example...');
  
  // Create a mock Redis client
  const redisClient = createMockRedisClient();
  
  // Set up some test agents with roles and trust scores
  await setupTestAgents(redisClient);
  
  // Create a proposal service
  const proposalService = new ProposalService(redisClient);
  
  // Example 1: Configure quorum settings
  logger.info('\n=== Example 1: Configure Quorum Settings ===');
  await configureQuorum(redisClient);
  
  // Example 2: Create a proposal and cast votes until quorum is reached
  logger.info('\n=== Example 2: Voting Until Quorum is Reached ===');
  const proposalId = await createProposalAndVote(proposalService, redisClient);
  
  // Example 3: Check quorum status
  logger.info('\n=== Example 3: Checking Quorum Status ===');
  await checkQuorumStatus(redisClient, proposalId);
  
  logger.info('\nQuorum enforcement example completed!');
}

/**
 * Set up test agents with roles and trust scores
 */
async function setupTestAgents(redisClient: any) {
  // Setup leader
  await redisClient.set('agent:leader-1:role', 'leader');
  await redisClient.set('agent:leader-1:trust_score', '0.90'); // 90%
  
  // Setup watchers
  await redisClient.set('agent:watcher-1:role', 'watcher');
  await redisClient.set('agent:watcher-1:trust_score', '0.80'); // 80%
  
  await redisClient.set('agent:watcher-2:role', 'watcher');
  await redisClient.set('agent:watcher-2:trust_score', '0.85'); // 85%
  
  // Setup auditors
  await redisClient.set('agent:auditor-1:role', 'auditor');
  await redisClient.set('agent:auditor-1:trust_score', '0.75'); // 75%
  
  await redisClient.set('agent:auditor-2:role', 'auditor');
  await redisClient.set('agent:auditor-2:trust_score', '0.70'); // 70%
  
  // Setup regular members
  await redisClient.set('agent:member-1:role', 'member');
  await redisClient.set('agent:member-1:trust_score', '0.65'); // 65%
  
  await redisClient.set('agent:member-2:role', 'member');
  await redisClient.set('agent:member-2:trust_score', '0.60'); // 60%
  
  logger.info('Test agents created with roles and trust scores');
}

/**
 * Configure quorum settings
 */
async function configureQuorum(redisClient: any) {
  // Get current quorum config (this will create default if it doesn't exist)
  const currentConfig = await getQuorumConfig(redisClient);
  
  logger.info('Current quorum configuration:');
  logger.info(`- Minimum Agents: ${currentConfig.min_agents}`);
  logger.info(`- Minimum Weight Score: ${currentConfig.min_weight_score}`);
  logger.info(`- Enforce Roles: ${currentConfig.enforce_roles}`);
  logger.info(`- Required Roles: ${currentConfig.required_roles?.join(', ') || 'none'}`);
  
  // Set stricter quorum settings for the example
  const newConfig: QuorumConfig = {
    min_agents: 4, // Require at least 4 agents
    min_weight_score: 2.5, // Require at least 2.5 weighted score
    enforce_roles: true, // Enforce role diversity
    required_roles: ['leader', 'auditor', 'watcher'] // Require these roles to be present
  };
  
  await setQuorumConfig(redisClient, newConfig);
  
  logger.info('\nUpdated quorum configuration:');
  logger.info(`- Minimum Agents: ${newConfig.min_agents}`);
  logger.info(`- Minimum Weight Score: ${newConfig.min_weight_score}`);
  logger.info(`- Enforce Roles: ${newConfig.enforce_roles}`);
  logger.info(`- Required Roles: ${newConfig.required_roles?.join(', ') || 'none'}`);
}

/**
 * Create a proposal and cast votes until quorum is reached
 */
async function createProposalAndVote(proposalService: ProposalService, redisClient: any): Promise<string> {
  // Create a new proposal
  const proposal = await proposalService.createProposal(
    'leader-1',
    'Test Governance Quorum',
    'A proposal to test quorum enforcement',
    ProposalType.PARAMETER_CHANGE,
    {
      parameterKey: 'test_parameter',
      parameterValue: 42
    }
  );
  
  logger.info(`Created proposal: ${proposal.id}`);
  
  // Check quorum status after initial vote (creator automatically votes yes)
  await logQuorumStatus(redisClient, proposal.id, 'Initial state (leader-1 votes yes)');
  
  // Cast more votes
  await proposalService.vote('watcher-1', proposal.id, 'yes');
  await logQuorumStatus(redisClient, proposal.id, 'After watcher-1 votes yes');
  
  await proposalService.vote('auditor-1', proposal.id, 'yes');
  await logQuorumStatus(redisClient, proposal.id, 'After auditor-1 votes yes');
  
  await proposalService.vote('member-1', proposal.id, 'yes');
  await logQuorumStatus(redisClient, proposal.id, 'After member-1 votes yes');
  
  // At this point, quorum should be reached
  return proposal.id;
}

/**
 * Log the quorum status of a proposal
 */
async function logQuorumStatus(redisClient: any, proposalId: string, label: string) {
  const result = await checkQuorum(redisClient, proposalId);
  
  logger.info(`\n${label}:`);
  logger.info(`- Votes: ${result.votes}`);
  logger.info(`- Weight Total: ${result.weight_total}`);
  logger.info(`- Roles Present: ${result.roles.join(', ')}`);
  logger.info(`- Quorum Passed: ${result.quorum_passed ? 'YES' : 'NO'}`);
  
  if (!result.quorum_passed) {
    logger.info('  Reasons:');
    if (!result.details.passes_headcount) {
      logger.info(`  - Need more agents (${result.votes} < required)`);
    }
    if (!result.details.passes_weight) {
      logger.info(`  - Need more vote weight (${result.weight_total} < required)`);
    }
    if (!result.details.passes_role_diversity) {
      logger.info('  - Missing required roles');
    }
  }
}

/**
 * Check detailed quorum status for a proposal
 */
async function checkQuorumStatus(redisClient: any, proposalId: string) {
  const quorumConfig = await getQuorumConfig(redisClient);
  const quorumResult = await checkQuorum(redisClient, proposalId);
  
  logger.info('Quorum Requirements:');
  logger.info(`- Minimum Agents: ${quorumConfig.min_agents} (Current: ${quorumResult.votes})`);
  logger.info(`- Minimum Weight: ${quorumConfig.min_weight_score} (Current: ${quorumResult.weight_total})`);
  logger.info(`- Required Roles: ${quorumConfig.required_roles?.join(', ') || 'none'}`);
  logger.info(`- Present Roles: ${quorumResult.roles.join(', ')}`);
  
  logger.info('\nQuorum Status:');
  logger.info(`- Headcount Check: ${quorumResult.details.passes_headcount ? 'PASSED' : 'FAILED'}`);
  logger.info(`- Weight Check: ${quorumResult.details.passes_weight ? 'PASSED' : 'FAILED'}`);
  logger.info(`- Role Diversity Check: ${quorumResult.details.passes_role_diversity ? 'PASSED' : 'FAILED'}`);
  logger.info(`- Overall: ${quorumResult.quorum_passed ? 'QUORUM REACHED' : 'QUORUM NOT REACHED'}`);
}

// Run the example
runExample().catch(error => {
  logger.error('Error running example:', error);
}); 