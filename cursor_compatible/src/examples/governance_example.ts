/**
 * Role Weighting System Example
 * 
 * Shows how to use the role weighting system for governance voting
 * and permission checks in code.
 */

import { createMockRedisClient } from '../common/redis.js';
import { createLogger } from '../common/logger.js';
import {
  ProposalService,
  ProposalType,
  computeWeightedScore,
  hasRequiredRole,
  withRolePermission,
  withWeightPermission
} from '../governance/index.js';

const logger = createLogger('GovernanceExample');

/**
 * Run the governance example
 */
async function runExample() {
  logger.info('Starting governance example...');
  
  // Create a mock Redis client
  const redisClient = createMockRedisClient();
  
  // Set up some test agents with roles and trust scores
  await setupTestAgents(redisClient);
  
  // Create a proposal service
  const proposalService = new ProposalService(redisClient);
  
  // Example 1: Calculate weighted scores for each agent
  logger.info('\n=== Example 1: Agent Weighted Scores ===');
  await calculateAgentScores(redisClient);
  
  // Example 2: Create a proposal and vote on it
  logger.info('\n=== Example 2: Voting Process ===');
  const proposal = await createAndVoteOnProposal(proposalService);
  
  // Example 3: Using role-based permissions
  logger.info('\n=== Example 3: Role-Based Permissions ===');
  await checkRolePermissions(redisClient);
  
  // Example 4: Using weighted permissions with higher-level functions
  logger.info('\n=== Example 4: Permission Wrappers ===');
  await demonstratePermissionWrappers(redisClient);
  
  logger.info('\nGovernance example completed!');
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
  
  // Setup regular members
  await redisClient.set('agent:member-1:role', 'member');
  await redisClient.set('agent:member-1:trust_score', '0.70'); // 70%
  
  await redisClient.set('agent:member-2:role', 'member');
  await redisClient.set('agent:member-2:trust_score', '0.60'); // 60%
  
  logger.info('Test agents created with roles and trust scores');
}

/**
 * Calculate and display weighted scores for each agent
 */
async function calculateAgentScores(redisClient: any) {
  const agentIds = [
    'leader-1',
    'watcher-1',
    'watcher-2',
    'auditor-1',
    'member-1',
    'member-2'
  ];
  
  for (const agentId of agentIds) {
    const score = await computeWeightedScore(redisClient, agentId);
    const role = await redisClient.get(`agent:${agentId}:role`);
    const trustStr = await redisClient.get(`agent:${agentId}:trust_score`);
    const trust = parseFloat(trustStr || '0') * 100;
    
    logger.info(
      `Agent ${agentId}: Role=${role}, Trust=${trust.toFixed(1)}%, ` +
      `Weighted Score=${score.toFixed(4)}`
    );
  }
}

/**
 * Create a proposal and cast votes on it
 */
async function createAndVoteOnProposal(proposalService: ProposalService) {
  // Create a new proposal for parameter change
  const proposal = await proposalService.createProposal(
    'leader-1',
    'Adjust Max Drawdown Parameters',
    'Modify the maximum allowed drawdown for strategies',
    ProposalType.PARAMETER_CHANGE,
    {
      parameterKey: 'max_drawdown_percent',
      parameterValue: 5.0,
      reason: 'Risk management improvement'
    },
    {
      expiryHours: 24,
      requiredQuorum: 2.0, // Lower for example
      requiredApprovalThreshold: 1.5 // Lower for example
    }
  );
  
  logger.info(`Created proposal: ${proposal.id} (${proposal.title})`);
  
  // Cast votes from different agents
  // Leader votes yes
  await proposalService.vote('leader-1', proposal.id, 'yes');
  logger.info('Leader-1 voted: yes');
  
  // First watcher votes yes
  await proposalService.vote('watcher-1', proposal.id, 'yes');
  logger.info('Watcher-1 voted: yes');
  
  // Second watcher votes no
  await proposalService.vote('watcher-2', proposal.id, 'no');
  logger.info('Watcher-2 voted: no');
  
  // Auditor abstains
  await proposalService.vote('auditor-1', proposal.id, 'abstain');
  logger.info('Auditor-1 voted: abstain');
  
  // Get the current vote status
  const redisClient = proposalService['redisClient'];
  const voteStatus = await proposalService['redisClient'].get(
    `governance:votes:${proposal.id}`
  );
  
  const voteSummary = JSON.parse(voteStatus || '{}');
  
  logger.info('\nVote Summary:');
  logger.info(`- Yes Score: ${voteSummary.yesScore?.toFixed(4) || 0}`);
  logger.info(`- No Score: ${voteSummary.noScore?.toFixed(4) || 0}`);
  logger.info(`- Abstain Score: ${voteSummary.abstainScore?.toFixed(4) || 0}`);
  logger.info(`- Total Score: ${voteSummary.totalScore?.toFixed(4) || 0}`);
  logger.info(`- Quorum Reached: ${voteSummary.quorumReached ? 'Yes' : 'No'}`);
  logger.info(`- Proposal Passed: ${voteSummary.passed ? 'Yes' : 'No'}`);
  
  // Get updated proposal status
  const updatedProposal = await proposalService.getProposal(proposal.id);
  logger.info(`Proposal Status: ${updatedProposal?.status}`);
  
  return proposal;
}

/**
 * Demonstrate role-based permission checks
 */
async function checkRolePermissions(redisClient: any) {
  // Define what action each role can perform
  const rolePermissions = [
    { role: 'member', action: 'read_data' },
    { role: 'auditor', action: 'view_metrics' },
    { role: 'watcher', action: 'change_parameters' },
    { role: 'leader', action: 'emergency_action' }
  ];
  
  // Check each agent against different permission requirements
  const agentIds = ['member-1', 'auditor-1', 'watcher-1', 'leader-1'];
  
  for (const agentId of agentIds) {
    const agentRole = await redisClient.get(`agent:${agentId}:role`);
    
    logger.info(`\nChecking permissions for agent ${agentId} (role: ${agentRole}):`);
    
    for (const { role, action } of rolePermissions) {
      const hasPermission = await hasRequiredRole(redisClient, agentId, role);
      logger.info(
        `- ${action} (requires '${role}' role): ${hasPermission ? 'Allowed' : 'Denied'}`
      );
    }
  }
}

/**
 * Demonstrate using the permission wrapper functions
 */
async function demonstratePermissionWrappers(redisClient: any) {
  // Try to execute an action that requires leader role
  const executeEmergencyAction = async () => {
    logger.info('Emergency action executed!');
    return { success: true, timestamp: Date.now() };
  };
  
  const executeAudit = async () => {
    logger.info('Audit process executed!');
    return { success: true, audited: true };
  };
  
  // Try with different agents
  try {
    logger.info('\nTrying emergency action with leader:');
    const result1 = await withRolePermission(
      redisClient,
      'leader-1',
      'leader',
      executeEmergencyAction
    );
    logger.info(`Result: ${JSON.stringify(result1)}`);
  } catch (error) {
    logger.error(`Error: ${(error as Error).message}`);
  }
  
  try {
    logger.info('\nTrying emergency action with watcher:');
    const result2 = await withRolePermission(
      redisClient,
      'watcher-1',
      'leader',
      executeEmergencyAction,
      'You must be a leader to execute emergency actions!'
    );
    logger.info(`Result: ${JSON.stringify(result2)}`);
  } catch (error) {
    logger.error(`Error: ${(error as Error).message}`);
  }
  
  try {
    logger.info('\nTrying audit with auditor:');
    const result3 = await withRolePermission(
      redisClient,
      'auditor-1',
      'auditor',
      executeAudit
    );
    logger.info(`Result: ${JSON.stringify(result3)}`);
  } catch (error) {
    logger.error(`Error: ${(error as Error).message}`);
  }
  
  try {
    logger.info('\nTrying action that requires weighted score >= 0.6:');
    const result4 = await withWeightPermission(
      redisClient,
      'watcher-1',
      0.6,
      async () => {
        logger.info('Action requiring weighted score of 0.6 executed!');
        return { success: true };
      }
    );
    logger.info(`Result: ${JSON.stringify(result4)}`);
  } catch (error) {
    logger.error(`Error: ${(error as Error).message}`);
  }
}

// Run the example
runExample().catch(error => {
  logger.error('Error running example:', error.message);
  process.exit(1);
}); 