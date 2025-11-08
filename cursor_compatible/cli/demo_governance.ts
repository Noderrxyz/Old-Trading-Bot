#!/usr/bin/env ts-node

/**
 * Governance System Demonstration
 * 
 * This script demonstrates the role weighting system for multi-agent consensus
 * by simulating a complete governance workflow with multiple agents voting
 * on a proposal.
 */

/// <reference types="node" />

import { createMockRedisClient } from '../src/common/redis.js';
import { createLogger } from '../src/common/logger.js';
import {
  ProposalService,
  ProposalType,
  computeWeightedScore,
  getVoteStatus
} from '../src/governance/index.js';

const logger = createLogger('GovernanceDemo');

/**
 * Demo the governance system
 */
async function demoGovernance() {
  logger.info('===== GOVERNANCE SYSTEM DEMONSTRATION =====');
  logger.info('This demo shows the role weighting system for multi-agent consensus\n');
  
  // Create a mock Redis client for the demo
  const redisClient = createMockRedisClient();
  
  // Step 1: Set up test agents
  logger.info('Step 1: Setting up test agents with different roles and trust scores');
  await setupTestAgents(redisClient);
  
  // Step 2: Display the weighted scores for each agent
  logger.info('\nStep 2: Calculating weighted scores for each agent');
  await displayAgentScores(redisClient);
  
  // Step 3: Create a proposal for a parameter change
  logger.info('\nStep 3: Creating a proposal for parameter change');
  const proposalService = new ProposalService(redisClient);
  const proposal = await createProposal(proposalService);
  
  // Step 4: Cast votes from different agents
  logger.info('\nStep 4: Casting votes from agents with different roles');
  await castVotes(proposalService, proposal.id);
  
  // Step 5: Display the final vote tally
  logger.info('\nStep 5: Displaying final vote tally');
  await displayVoteTally(redisClient, proposalService, proposal.id);
  
  logger.info('\n===== DEMONSTRATION COMPLETE =====');
  logger.info('The role weighting system successfully applied weighted trust scores to agent votes');
  logger.info('based on their roles in the system.');
}

/**
 * Set up test agents with different roles and trust scores
 */
async function setupTestAgents(redisClient: any) {
  // Create a leader agent with high trust
  await redisClient.set('agent:leader-1:role', 'leader');
  await redisClient.set('agent:leader-1:trust_score', '0.90');
  logger.info('Created agent leader-1: role=leader, trust=90%');
  
  // Create watcher agents with different trust scores
  await redisClient.set('agent:watcher-1:role', 'watcher');
  await redisClient.set('agent:watcher-1:trust_score', '0.85');
  logger.info('Created agent watcher-1: role=watcher, trust=85%');
  
  await redisClient.set('agent:watcher-2:role', 'watcher');
  await redisClient.set('agent:watcher-2:trust_score', '0.75');
  logger.info('Created agent watcher-2: role=watcher, trust=75%');
  
  // Create auditor agents
  await redisClient.set('agent:auditor-1:role', 'auditor');
  await redisClient.set('agent:auditor-1:trust_score', '0.82');
  logger.info('Created agent auditor-1: role=auditor, trust=82%');
  
  await redisClient.set('agent:auditor-2:role', 'auditor');
  await redisClient.set('agent:auditor-2:trust_score', '0.78');
  logger.info('Created agent auditor-2: role=auditor, trust=78%');
  
  // Create regular member agents
  await redisClient.set('agent:member-1:role', 'member');
  await redisClient.set('agent:member-1:trust_score', '0.70');
  logger.info('Created agent member-1: role=member, trust=70%');
  
  await redisClient.set('agent:member-2:role', 'member');
  await redisClient.set('agent:member-2:trust_score', '0.65');
  logger.info('Created agent member-2: role=member, trust=65%');
}

/**
 * Display the weighted scores for each agent
 */
async function displayAgentScores(redisClient: any) {
  const agentIds = [
    'leader-1',
    'watcher-1',
    'watcher-2',
    'auditor-1',
    'auditor-2',
    'member-1',
    'member-2'
  ];
  
  logger.info('Agent Weighted Scores:');
  logger.info('---------------------');
  logger.info('Agent ID    | Role     | Trust Score | Role Weight | Weighted Score');
  logger.info('-----------+----------+-------------+-------------+--------------');
  
  for (const agentId of agentIds) {
    const role = await redisClient.get(`agent:${agentId}:role`);
    const trustStr = await redisClient.get(`agent:${agentId}:trust_score`);
    const trust = parseFloat(trustStr || '0') * 100;
    const score = await computeWeightedScore(redisClient, agentId);
    
    // Get role weight based on role
    let roleWeight;
    switch (role) {
      case 'leader': roleWeight = 1.0; break;
      case 'watcher': roleWeight = 0.75; break;
      case 'auditor': roleWeight = 0.5; break;
      default: roleWeight = 0.25;
    }
    
    logger.info(
      `${agentId.padEnd(11)} | ${role.padEnd(9)} | ${trust.toFixed(1).padStart(5)}%      | ${roleWeight.toFixed(2).padStart(5)}       | ${score.toFixed(4).padStart(6)}`
    );
  }
}

/**
 * Create a proposal for a parameter change
 */
async function createProposal(proposalService: ProposalService) {
  // Create a proposal to change risk parameters
  const proposal = await proposalService.createProposal(
    'leader-1', // Created by the leader
    'Adjust Max Risk Parameters',
    'Proposal to change maximum risk parameters for all strategies to improve risk management',
    ProposalType.PARAMETER_CHANGE,
    {
      parameter: 'max_drawdown_percent',
      current_value: 10,
      proposed_value: 5,
      reason: 'Reduce potential losses in volatile market conditions',
      affects: 'all_strategies'
    }
  );
  
  logger.info(`Proposal created by leader-1`);
  logger.info(`ID: ${proposal.id}`);
  logger.info(`Title: ${proposal.title}`);
  logger.info(`Type: ${proposal.type}`);
  logger.info(`Description: ${proposal.description}`);
  logger.info(`Required Quorum: ${proposal.requiredQuorum}`);
  logger.info(`Required Approval Threshold: ${proposal.requiredApprovalThreshold}`);
  
  return proposal;
}

/**
 * Cast votes from different agents
 */
async function castVotes(proposalService: ProposalService, proposalId: string) {
  // Leader already voted 'yes' implicitly when creating the proposal
  logger.info('leader-1 already voted YES (auto-vote on proposal creation)');
  
  // Watchers vote
  await proposalService.vote('watcher-1', proposalId, 'yes');
  logger.info('watcher-1 voted YES');
  
  await proposalService.vote('watcher-2', proposalId, 'no');
  logger.info('watcher-2 voted NO');
  
  // Auditors vote
  await proposalService.vote('auditor-1', proposalId, 'yes');
  logger.info('auditor-1 voted YES');
  
  await proposalService.vote('auditor-2', proposalId, 'abstain');
  logger.info('auditor-2 voted ABSTAIN');
  
  // Members vote
  await proposalService.vote('member-1', proposalId, 'yes');
  logger.info('member-1 voted YES');
  
  await proposalService.vote('member-2', proposalId, 'no');
  logger.info('member-2 voted NO');
}

/**
 * Display the final vote tally
 */
async function displayVoteTally(
  redisClient: any,
  proposalService: ProposalService,
  proposalId: string
) {
  // Get the proposal and vote status
  const proposal = await proposalService.getProposal(proposalId);
  const voteStatus = await getVoteStatus(redisClient, proposalId);
  
  if (!proposal || !voteStatus) {
    logger.error('Failed to retrieve proposal or vote status');
    return;
  }
  
  logger.info('Vote Tally Results:');
  logger.info('-----------------');
  logger.info(`Proposal: ${proposal.title}`);
  logger.info(`Status: ${proposal.status}`);
  logger.info('');
  
  logger.info('Vote Summary:');
  logger.info(`- Yes Score: ${voteStatus.yesScore.toFixed(4)}`);
  logger.info(`- No Score: ${voteStatus.noScore.toFixed(4)}`);
  logger.info(`- Abstain Score: ${voteStatus.abstainScore.toFixed(4)}`);
  logger.info(`- Total Score: ${voteStatus.totalScore.toFixed(4)}`);
  logger.info(`- Quorum Reached: ${voteStatus.quorumReached ? 'Yes' : 'No'}`);
  logger.info(`- Proposal Passed: ${voteStatus.passed ? 'Yes' : 'No'}`);
  
  // Display individual votes
  logger.info('\nIndividual Votes:');
  logger.info('Agent ID    | Role     | Vote    | Weight | Score');
  logger.info('-----------+----------+---------+--------+-------');
  
  for (const vote of voteStatus.votes) {
    logger.info(
      `${vote.agentId.padEnd(11)} | ${vote.role.padEnd(9)} | ${vote.vote.padEnd(8)} | ${vote.trustScore.toFixed(2)} | ${vote.score.toFixed(4)}`
    );
  }
  
  // Final decision
  logger.info('\nFinal Decision:');
  if (voteStatus.passed) {
    logger.info('✅ PROPOSAL APPROVED');
    logger.info('The parameter change will be implemented.');
  } else if (voteStatus.noScore >= proposal.requiredApprovalThreshold) {
    logger.info('❌ PROPOSAL REJECTED');
    logger.info('The parameter change will not be implemented.');
  } else if (voteStatus.quorumReached) {
    logger.info('⏳ PROPOSAL PENDING');
    logger.info('Quorum reached but neither approval nor rejection threshold met.');
  } else {
    logger.info('⏳ QUORUM NOT REACHED');
    logger.info('Not enough weighted votes to reach a decision yet.');
  }
}

// Run the demonstration
demoGovernance().catch(error => {
  logger.error('Error running governance demonstration:', error);
  process.exit(1);
}); 