/**
 * Role Weighting System for Multi-Agent Consensus
 * 
 * Assigns dynamic weights to agent roles (leader, watcher, auditor, member)
 * so that consensus votes, arbitration decisions, and strategy approvals
 * reflect trust-adjusted authority.
 */

import { RedisClient } from '../common/redis.js';
import { enforceQuorum } from './quorumEnforcement.js';

// Define role weight constants
export const ROLE_WEIGHTS: Record<string, number> = {
  leader: 1.0,
  watcher: 0.75,
  auditor: 0.5,
  member: 0.25
};

// Vote types
export type VoteOption = 'yes' | 'no' | 'abstain';

// Vote record interface
export interface AgentVoteRecord {
  agentId: string;
  vote: VoteOption;
  timestamp: number;
  score: number;
  role: string;
  trustScore: number;
}

// Proposal vote summary
export interface VoteSummary {
  proposalId: string;
  totalScore: number;
  yesScore: number;
  noScore: number;
  abstainScore: number;
  votes: AgentVoteRecord[];
  quorumReached: boolean;
  passed: boolean;
  timestamp: number;
}

/**
 * Compute the weighted score for an agent based on role and trust score
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @returns Weighted score (role weight × normalized trust score)
 */
export async function computeWeightedScore(
  redisClient: RedisClient,
  agentId: string
): Promise<number> {
  // Get agent's role and trust score
  const [role, rawTrustStr] = await Promise.all([
    redisClient.get(`agent:${agentId}:role`),
    redisClient.get(`agent:${agentId}:trust_score`)
  ]);
  
  // Parse trust score and normalize to 0-1 range
  const rawTrust = parseFloat(rawTrustStr || '0');
  const normalized = Math.min(Math.max(rawTrust, 0), 1);
  
  // Get role weight (default to member if role not found)
  const roleWeight = ROLE_WEIGHTS[role || 'member'] || ROLE_WEIGHTS.member;
  
  // Calculate and return weighted score (4 decimal precision)
  return parseFloat((normalized * roleWeight).toFixed(4));
}

/**
 * Cast a vote on a proposal
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param proposalId Proposal ID
 * @param vote Vote ('yes', 'no', 'abstain')
 * @returns The weighted score of the vote
 */
export async function castVote(
  redisClient: RedisClient,
  agentId: string,
  proposalId: string,
  vote: VoteOption
): Promise<number> {
  // Get agent's weighted score
  const score = await computeWeightedScore(redisClient, agentId);
  
  // Get agent's role and trust for the record
  const [role, trustScoreStr] = await Promise.all([
    redisClient.get(`agent:${agentId}:role`),
    redisClient.get(`agent:${agentId}:trust_score`)
  ]);
  
  // Prepare vote record
  const voteRecord: AgentVoteRecord = {
    agentId,
    vote,
    timestamp: Date.now(),
    score,
    role: role || 'member',
    trustScore: parseFloat(trustScoreStr || '0')
  };
  
  // Store vote in Redis
  await redisClient.set(
    `agent:${agentId}:vote:${proposalId}`,
    JSON.stringify(voteRecord)
  );
  
  // Update the governance:votes entry
  await updateVoteTally(redisClient, proposalId);
  
  return score;
}

/**
 * Update the vote tally for a proposal
 * 
 * @param redisClient Redis client
 * @param proposalId Proposal ID
 * @returns Summary of the vote
 */
export async function updateVoteTally(
  redisClient: RedisClient,
  proposalId: string
): Promise<VoteSummary> {
  // Get all votes for this proposal
  const voteKeys = await redisClient.keys(`agent:*:vote:${proposalId}`);
  const votes: AgentVoteRecord[] = [];
  
  // Collect all vote records
  for (const key of voteKeys) {
    const voteData = await redisClient.get(key);
    if (voteData) {
      votes.push(JSON.parse(voteData));
    }
  }
  
  // Calculate totals
  let yesScore = 0;
  let noScore = 0;
  let abstainScore = 0;
  
  votes.forEach(vote => {
    if (vote.vote === 'yes') {
      yesScore += vote.score;
    } else if (vote.vote === 'no') {
      noScore += vote.score;
    } else if (vote.vote === 'abstain') {
      abstainScore += vote.score;
    }
  });
  
  const totalScore = yesScore + noScore + abstainScore;
  
  // Determine if proposal passed (threshold of 2.0 by default)
  const threshold = 2.0;
  const passed = yesScore >= threshold;
  
  // Check quorum using advanced quorum enforcement
  const quorumReached = await enforceQuorum(redisClient, proposalId);
  
  // Prepare vote summary
  const summary: VoteSummary = {
    proposalId,
    totalScore,
    yesScore,
    noScore,
    abstainScore,
    votes,
    quorumReached,
    passed,
    timestamp: Date.now()
  };
  
  // Store summary in Redis
  await redisClient.set(
    `governance:votes:${proposalId}`,
    JSON.stringify(summary)
  );
  
  return summary;
}

/**
 * Get the current status of a vote
 * 
 * @param redisClient Redis client
 * @param proposalId Proposal ID
 * @returns Vote summary or null if not found
 */
export async function getVoteStatus(
  redisClient: RedisClient,
  proposalId: string
): Promise<VoteSummary | null> {
  const voteData = await redisClient.get(`governance:votes:${proposalId}`);
  
  if (!voteData) {
    // If vote summary doesn't exist yet, calculate it
    const voteKeys = await redisClient.keys(`agent:*:vote:${proposalId}`);
    
    if (voteKeys.length === 0) {
      return null;
    }
    
    return updateVoteTally(redisClient, proposalId);
  }
  
  return JSON.parse(voteData);
}

/**
 * Check if an agent has sufficient weight to perform a governance action
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param requiredWeight Minimum weight required
 * @returns Boolean indicating if agent meets weight requirement
 */
export async function hasRequiredWeight(
  redisClient: RedisClient,
  agentId: string,
  requiredWeight: number
): Promise<boolean> {
  const weight = await computeWeightedScore(redisClient, agentId);
  return weight >= requiredWeight;
}

/**
 * Check if an agent has a specific role or higher
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param requiredRole Minimum role required
 * @returns Boolean indicating if agent meets role requirement
 */
export async function hasRequiredRole(
  redisClient: RedisClient,
  agentId: string,
  requiredRole: string
): Promise<boolean> {
  const role = await redisClient.get(`agent:${agentId}:role`);
  
  if (!role) {
    return false;
  }
  
  const roleValue = ROLE_WEIGHTS[role];
  const requiredValue = ROLE_WEIGHTS[requiredRole];
  
  return roleValue >= requiredValue;
} 