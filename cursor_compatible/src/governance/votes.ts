/**
 * Voting System with Governance Enforcement
 * 
 * Provides middleware hooks for vote submission that enforce
 * governance rules before allowing votes to be cast.
 */

import Redis from 'ioredis';
import { createLogger } from '../common/logger.js';
import { enforceGovernanceRules } from './enforcement/enforcer.js';
import { VoteOption, castVote } from './voteWeighting.js';
import { ethers } from 'ethers';

// Import VoteRecord from a more accessible location or define it inline for immediate usage
export interface VoteRecord {
  agentDid: string;
  signature: string;
  vote: 'yes' | 'no' | 'abstain';
  role: 'validator' | 'guardian' | 'builder';
  weight: number;
  timestamp: number;
  verified?: boolean;
}

// Logger for voting events
const logger = createLogger('VotingSystem');

/**
 * Submit a vote with governance enforcement
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID submitting the vote
 * @param proposalId Proposal ID to vote on
 * @param vote Vote option ('yes', 'no', 'abstain')
 * @param context Additional context for the vote
 * @returns Vote weight if successful
 */
export async function submitVote(
  redisClient: Redis,
  agentId: string,
  proposalId: string,
  vote: VoteOption,
  context: Record<string, any> = {}
): Promise<number> {
  logger.info(`Agent ${agentId} attempting to vote ${vote} on proposal ${proposalId}`);
  
  // Enforce governance rules before submission
  const check = await enforceGovernanceRules(
    redisClient,
    agentId,
    'vote',
    { 
      proposalId,
      vote,
      ...context
    }
  );

  if (!check.allowed) {
    const reasons = check.violations.map(v => v.reason).join('; ');
    logger.warn(`Vote submission blocked: ${reasons}`);
    throw new Error(`Governance block: ${reasons}`);
  }
  
  // If governance check passes, proceed with vote submission
  logger.info(`Governance check passed, submitting vote from ${agentId}`);
  
  // Cast the vote using the weight system
  const weight = await castVote(
    redisClient,
    agentId,
    proposalId,
    vote
  );
  
  // Record the vote for audit purposes
  await recordVoteSubmission(
    redisClient,
    agentId,
    proposalId,
    vote,
    weight
  );
  
  return weight;
}

/**
 * Record a vote submission for auditing
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param proposalId Proposal ID
 * @param vote Vote option
 * @param weight Vote weight
 */
async function recordVoteSubmission(
  redisClient: Redis,
  agentId: string,
  proposalId: string,
  vote: VoteOption,
  weight: number
): Promise<void> {
  const voteLog = {
    agentId,
    proposalId,
    vote,
    weight,
    timestamp: Date.now()
  };
  
  // Log to Redis streams for audit trail
  await redisClient.xadd(
    'governance:votes:audit',
    '*',
    { 
      agentId,
      proposalId,
      vote,
      weight: weight.toString(),
      timestamp: Date.now().toString()
    }
  );
  
  // Keep track of agent's voting history
  await redisClient.rpush(
    `agent:${agentId}:votes`,
    JSON.stringify(voteLog)
  );
  
  // Trim the voting history to 100 entries
  const voteHistoryLength = await redisClient.llen(`agent:${agentId}:votes`);
  if (voteHistoryLength > 100) {
    await redisClient.ltrim(`agent:${agentId}:votes`, -100, -1);
  }
}

/**
 * Check if an agent has voted on a proposal
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID to check
 * @param proposalId Proposal ID
 * @returns Whether the agent has voted
 */
export async function hasVoted(
  redisClient: Redis,
  agentId: string,
  proposalId: string
): Promise<boolean> {
  const key = `agent:${agentId}:vote:${proposalId}`;
  const exists = await redisClient.get(key);
  return !!exists;
}

/**
 * Get an agent's vote on a proposal
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID to check
 * @param proposalId Proposal ID
 * @returns The agent's vote record or null if not found
 */
export async function getAgentVote(
  redisClient: Redis,
  agentId: string,
  proposalId: string
): Promise<{ vote: VoteOption; weight: number; timestamp: number } | null> {
  const key = `agent:${agentId}:vote:${proposalId}`;
  const voteData = await redisClient.get(key);
  
  if (!voteData) {
    return null;
  }
  
  try {
    const voteRecord = JSON.parse(voteData);
    return {
      vote: voteRecord.vote,
      weight: voteRecord.score || 0,
      timestamp: voteRecord.timestamp
    };
  } catch (error) {
    logger.error(`Failed to parse vote data for ${agentId} on ${proposalId}: ${error}`);
    return null;
  }
}

/**
 * Verify the signature of a vote
 * 
 * @param vote VoteRecord to verify
 * @returns Whether the signature is valid
 */
export const verifyVoteSignature = (vote: VoteRecord): boolean => {
  const message = `Vote:${vote.vote}:${vote.timestamp}`;
  try {
    // Use ethers v6 syntax if available
    const hash = ethers.hashMessage(message);
    const recovered = ethers.recoverAddress(hash, vote.signature);
    return recovered.toLowerCase() === vote.agentDid.toLowerCase().split(':').pop();
  } catch (error) {
    // Fallback to ethers v5 syntax
    try {
      const hash = ethers.utils.hashMessage(message);
      const recovered = ethers.utils.recoverAddress(hash, vote.signature);
      return recovered.toLowerCase() === vote.agentDid.toLowerCase().split(':').pop();
    } catch (innerError) {
      logger.error(`Failed to verify vote signature: ${innerError}`);
      return false;
    }
  }
}; 