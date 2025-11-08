/**
 * Reputation-Weighted Arbitration Engine
 * 
 * Resolves conflicts and disputes between agents based on trust scores,
 * roles, and historical performance.
 */

import { createLogger } from '../common/logger.js';
import { RedisClient } from '../common/redis.js';
import { ROLE_WEIGHTS } from './voteWeighting.js';

const logger = createLogger('ArbitrationEngine');

/**
 * Arbitration weights configuration
 */
export interface ArbitrationWeights {
  trust: number;
  leader_bonus: number;
  uptime_bonus_threshold: number;
  uptime_bonus: number;
  past_accuracy_factor: number;
}

/**
 * Arbitration result
 */
export interface ArbitrationResult {
  proposal_id: string;
  winner: string;
  winning_option: string;
  total_trust: number;
  agent_count: number;
  reason: string;
  details: {
    options: Record<string, {
      total_trust: number;
      agents: string[];
      weighted_score: number;
    }>;
  };
}

/**
 * Set default arbitration weights if none exist
 * 
 * @param redis Redis client
 * @returns Arbitration weights configuration
 */
export async function ensureDefaultArbitrationWeights(redis: RedisClient): Promise<ArbitrationWeights> {
  // Check if config exists by trying to get it
  const configData = await redis.hgetall('governance:config:arbitration_weights');
  const exists = Object.keys(configData).length > 0;
  
  if (!exists) {
    const defaultConfig: ArbitrationWeights = {
      trust: 1.0,
      leader_bonus: 1.2,
      uptime_bonus_threshold: 30,
      uptime_bonus: 1.1,
      past_accuracy_factor: 1.0
    };
    
    await redis.hset('governance:config:arbitration_weights', {
      trust: defaultConfig.trust.toString(),
      leader_bonus: defaultConfig.leader_bonus.toString(),
      uptime_bonus_threshold: defaultConfig.uptime_bonus_threshold.toString(),
      uptime_bonus: defaultConfig.uptime_bonus.toString(),
      past_accuracy_factor: defaultConfig.past_accuracy_factor.toString(),
    });
    
    logger.info('Default arbitration weights created');
    return defaultConfig;
  }
  
  return getArbitrationWeights(redis);
}

/**
 * Get arbitration weights configuration
 * 
 * @param redis Redis client
 * @returns Arbitration weights configuration
 */
export async function getArbitrationWeights(redis: RedisClient): Promise<ArbitrationWeights> {
  const config = await redis.hgetall('governance:config:arbitration_weights');
  
  // Parse the config values to appropriate types
  return {
    trust: parseFloat(config.trust || '1.0'),
    leader_bonus: parseFloat(config.leader_bonus || '1.2'),
    uptime_bonus_threshold: parseFloat(config.uptime_bonus_threshold || '30'),
    uptime_bonus: parseFloat(config.uptime_bonus || '1.1'),
    past_accuracy_factor: parseFloat(config.past_accuracy_factor || '1.0')
  };
}

/**
 * Set arbitration weights configuration
 * 
 * @param redis Redis client
 * @param config Arbitration weights configuration
 */
export async function setArbitrationWeights(redis: RedisClient, config: ArbitrationWeights): Promise<void> {
  await redis.hset('governance:config:arbitration_weights', {
    trust: config.trust.toString(),
    leader_bonus: config.leader_bonus.toString(),
    uptime_bonus_threshold: config.uptime_bonus_threshold.toString(),
    uptime_bonus: config.uptime_bonus.toString(),
    past_accuracy_factor: config.past_accuracy_factor.toString()
  });
  
  logger.info('Arbitration weights updated', config);
}

/**
 * Calculate agent weighted score for arbitration
 * 
 * @param redis Redis client
 * @param agentId Agent ID
 * @param weights Arbitration weights
 * @returns Weighted score for arbitration
 */
async function calculateAgentArbitrationWeight(
  redis: RedisClient,
  agentId: string,
  weights: ArbitrationWeights
): Promise<number> {
  // Get agent's trust score, role, and uptime
  const [trustScoreStr, role, uptimeStreakStr, pastAccuracyStr] = await Promise.all([
    redis.get(`agent:${agentId}:trust_score`),
    redis.get(`agent:${agentId}:role`),
    redis.get(`agent:${agentId}:uptime_streak`),
    redis.get(`agent:${agentId}:arbitration_accuracy`)
  ]);
  
  // Parse values with defaults
  const trustScore = parseFloat(trustScoreStr || '0');
  const uptimeStreak = parseInt(uptimeStreakStr || '0', 10);
  const pastAccuracy = parseFloat(pastAccuracyStr || '1.0');
  
  // Start with base trust score
  let weightedScore = trustScore * weights.trust;
  
  // Apply role bonus
  if (role === 'leader') {
    weightedScore *= weights.leader_bonus;
  } else if (role && ROLE_WEIGHTS[role]) {
    // Apply a smaller bonus based on role weight for non-leaders
    const roleBonus = 1.0 + ((ROLE_WEIGHTS[role] - 0.25) / 10);
    weightedScore *= roleBonus;
  }
  
  // Apply uptime bonus if agent meets threshold
  if (uptimeStreak >= weights.uptime_bonus_threshold) {
    weightedScore *= weights.uptime_bonus;
  }
  
  // Apply past arbitration accuracy factor
  weightedScore *= pastAccuracy * weights.past_accuracy_factor;
  
  return parseFloat(weightedScore.toFixed(4));
}

/**
 * Resolve conflict for a proposal through arbitration
 * 
 * @param redis Redis client
 * @param proposalId Proposal ID
 * @returns Arbitration result or null if no votes
 */
export async function resolveConflict(
  redis: RedisClient,
  proposalId: string
): Promise<ArbitrationResult | null> {
  // Get all votes for this proposal
  const voteKeys = await redis.keys(`agent:*:vote:${proposalId}`);
  
  if (voteKeys.length === 0) {
    logger.warn(`No votes found for proposal ${proposalId}`);
    return null;
  }
  
  // Get arbitration weights configuration
  const weights = await ensureDefaultArbitrationWeights(redis);
  
  // Collect vote data for each agent
  const voteData: Record<string, { trust: number; role: string; vote: string; weight: number }> = {};
  
  for (const key of voteKeys) {
    const parts = key.split(':');
    const agentId = parts[1];
    const voteDataStr = await redis.get(key);
    
    if (voteDataStr) {
      const vote = JSON.parse(voteDataStr);
      const trustScore = vote.trustScore || 0;
      const role = vote.role || 'unknown';
      
      // Calculate weighted score for this agent
      const weight = await calculateAgentArbitrationWeight(redis, agentId, weights);
      
      voteData[agentId] = { 
        trust: trustScore, 
        role, 
        vote: vote.vote,
        weight
      };
    }
  }
  
  // Group by vote option
  const grouped: Record<string, {
    total_trust: number;
    agents: string[];
    weighted_score: number;
  }> = {};
  
  // Calculate totals for each option
  for (const [agentId, data] of Object.entries(voteData)) {
    if (!grouped[data.vote]) {
      grouped[data.vote] = {
        total_trust: 0,
        agents: [],
        weighted_score: 0
      };
    }
    
    grouped[data.vote].total_trust += data.trust;
    grouped[data.vote].agents.push(agentId);
    grouped[data.vote].weighted_score += data.weight;
  }
  
  // Find option with highest weighted score
  let winningOption = '';
  let highestScore = -1;
  
  for (const [option, data] of Object.entries(grouped)) {
    if (data.weighted_score > highestScore) {
      highestScore = data.weighted_score;
      winningOption = option;
    }
  }
  
  if (!winningOption) {
    logger.warn(`No winning option found for proposal ${proposalId}`);
    return null;
  }
  
  const winner = grouped[winningOption];
  
  // Create arbitration result
  const result: ArbitrationResult = {
    proposal_id: proposalId,
    winner: winner.agents[0], // Use first agent as representative
    winning_option: winningOption,
    total_trust: parseFloat(winner.total_trust.toFixed(2)),
    agent_count: winner.agents.length,
    reason: `Selected by trust-weighted consensus (${winner.weighted_score.toFixed(2)} across ${winner.agents.length} agents)`,
    details: {
      options: grouped
    }
  };
  
  // Store arbitration result in Redis
  await redis.set(
    `governance:arbitration:${proposalId}`,
    JSON.stringify(result)
  );
  
  logger.info(`Arbitration for proposal ${proposalId} resolved:`, {
    winning_option: winningOption,
    weighted_score: highestScore,
    agents: winner.agents.length
  });
  
  return result;
}

/**
 * Get the stored arbitration result for a proposal
 * 
 * @param redis Redis client
 * @param proposalId Proposal ID
 * @returns Arbitration result or null if not available
 */
export async function getArbitrationResult(
  redis: RedisClient,
  proposalId: string
): Promise<ArbitrationResult | null> {
  const result = await redis.get(`governance:arbitration:${proposalId}`);
  return result ? JSON.parse(result) : null;
}

/**
 * Track arbitration accuracy for an agent
 * 
 * @param redis Redis client
 * @param agentId Agent ID
 * @param wasCorrect Whether the agent's arbitration was correct
 */
export async function trackArbitrationAccuracy(
  redis: RedisClient,
  agentId: string,
  wasCorrect: boolean
): Promise<number> {
  // Get current accuracy
  const currentAccuracyStr = await redis.get(`agent:${agentId}:arbitration_accuracy`);
  const currentAccuracy = parseFloat(currentAccuracyStr || '1.0');
  
  // Get total attempts
  const attemptsStr = await redis.get(`agent:${agentId}:arbitration_attempts`);
  const attempts = parseInt(attemptsStr || '0', 10) + 1;
  
  // Get total correct
  const correctStr = await redis.get(`agent:${agentId}:arbitration_correct`);
  const correct = parseInt(correctStr || '0', 10) + (wasCorrect ? 1 : 0);
  
  // Calculate new accuracy (with more weight on recent results)
  const historyWeight = 0.7; // 70% weight on history, 30% on new result
  const newResult = wasCorrect ? 1.0 : 0.0;
  const newAccuracy = (currentAccuracy * historyWeight) + (newResult * (1 - historyWeight));
  
  // Update Redis
  await Promise.all([
    redis.set(`agent:${agentId}:arbitration_attempts`, attempts.toString()),
    redis.set(`agent:${agentId}:arbitration_correct`, correct.toString()),
    redis.set(`agent:${agentId}:arbitration_accuracy`, newAccuracy.toString())
  ]);
  
  logger.info(`Updated arbitration accuracy for agent ${agentId}:`, {
    wasCorrect,
    newAccuracy: newAccuracy.toFixed(4),
    attempts,
    correct
  });
  
  return newAccuracy;
}

/**
 * Get agent arbitration statistics
 * 
 * @param redis Redis client
 * @param agentId Agent ID
 * @returns Agent arbitration statistics
 */
export async function getAgentArbitrationStats(
  redis: RedisClient,
  agentId: string
): Promise<{
  accuracy: number;
  attempts: number;
  correct: number;
  success_rate: number;
}> {
  const [accuracyStr, attemptsStr, correctStr] = await Promise.all([
    redis.get(`agent:${agentId}:arbitration_accuracy`),
    redis.get(`agent:${agentId}:arbitration_attempts`),
    redis.get(`agent:${agentId}:arbitration_correct`)
  ]);
  
  const accuracy = parseFloat(accuracyStr || '1.0');
  const attempts = parseInt(attemptsStr || '0', 10);
  const correct = parseInt(correctStr || '0', 10);
  const successRate = attempts > 0 ? (correct / attempts) : 0;
  
  return {
    accuracy,
    attempts,
    correct,
    success_rate: parseFloat(successRate.toFixed(4))
  };
} 