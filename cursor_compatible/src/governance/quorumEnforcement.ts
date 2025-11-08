/**
 * Governance Quorum Enforcement
 * 
 * Enforces minimum participation thresholds for agent votes to be considered valid,
 * preventing small clusters or malicious nodes from passing critical decisions.
 */

import { createLogger } from '../common/logger.js';
import { RedisClient } from '../common/redis.js';

const logger = createLogger('QuorumEnforcement');

/**
 * Quorum configuration interface
 */
export interface QuorumConfig {
  min_agents: number;
  min_weight_score: number;
  enforce_roles: boolean;
  required_roles?: string[];
}

/**
 * Quorum check result
 */
export interface QuorumCheckResult {
  proposal_id: string;
  votes: number;
  weight_total: number;
  roles: string[];
  quorum_passed: boolean;
  details: {
    passes_headcount: boolean;
    passes_weight: boolean;
    passes_role_diversity: boolean;
  };
}

/**
 * Set default quorum configuration if none exists
 * 
 * @param redis Redis client
 * @returns Quorum configuration
 */
export async function ensureDefaultQuorumConfig(redis: RedisClient): Promise<QuorumConfig> {
  // Check if config exists by trying to get it
  const configData = await redis.hgetall('governance:config:quorum');
  const exists = Object.keys(configData).length > 0;
  
  if (!exists) {
    const defaultConfig: QuorumConfig = {
      min_agents: 3,
      min_weight_score: 2.0,
      enforce_roles: true,
      required_roles: ['leader', 'auditor']
    };
    
    await redis.hset('governance:config:quorum', {
      min_agents: defaultConfig.min_agents.toString(),
      min_weight_score: defaultConfig.min_weight_score.toString(),
      enforce_roles: defaultConfig.enforce_roles.toString(),
      required_roles: JSON.stringify(defaultConfig.required_roles)
    });
    
    logger.info('Default quorum configuration created');
    return defaultConfig;
  }
  
  return getQuorumConfig(redis);
}

/**
 * Get quorum configuration
 * 
 * @param redis Redis client
 * @returns Quorum configuration
 */
export async function getQuorumConfig(redis: RedisClient): Promise<QuorumConfig> {
  const config = await redis.hgetall('governance:config:quorum');
  
  // Parse the config values to appropriate types
  return {
    min_agents: parseInt(config.min_agents || '3', 10),
    min_weight_score: parseFloat(config.min_weight_score || '2.0'),
    enforce_roles: config.enforce_roles === 'true',
    required_roles: config.required_roles ? JSON.parse(config.required_roles) : ['leader', 'auditor']
  };
}

/**
 * Set quorum configuration
 * 
 * @param redis Redis client
 * @param config Quorum configuration
 */
export async function setQuorumConfig(redis: RedisClient, config: QuorumConfig): Promise<void> {
  await redis.hset('governance:config:quorum', {
    min_agents: config.min_agents.toString(),
    min_weight_score: config.min_weight_score.toString(),
    enforce_roles: config.enforce_roles.toString(),
    required_roles: JSON.stringify(config.required_roles || [])
  });
  
  logger.info('Quorum configuration updated', config);
}

/**
 * Enforce quorum rules for a proposal
 * 
 * @param redis Redis client
 * @param proposalId Proposal ID
 * @returns Boolean indicating if quorum is reached
 */
export async function enforceQuorum(redis: RedisClient, proposalId: string): Promise<boolean> {
  const checkResult = await checkQuorum(redis, proposalId);
  
  // Store the check result in Redis for reference
  await redis.set(
    `governance:quorum_check:${proposalId}`,
    JSON.stringify(checkResult)
  );
  
  return checkResult.quorum_passed;
}

/**
 * Check if a proposal meets quorum requirements
 * 
 * @param redis Redis client
 * @param proposalId Proposal ID
 * @returns Quorum check result with detailed information
 */
export async function checkQuorum(redis: RedisClient, proposalId: string): Promise<QuorumCheckResult> {
  const votes = await redis.keys(`agent:*:vote:${proposalId}`);
  const quorumConfig = await getQuorumConfig(redis);

  const agentIds = new Set<string>();
  let totalWeight = 0;
  const rolesSeen = new Set<string>();

  // Process all votes to gather data for quorum check
  for (const key of votes) {
    const parts = key.split(':');
    const agentId = parts[1];
    const voteData = await redis.get(key);
    
    if (voteData) {
      const vote = JSON.parse(voteData);
      agentIds.add(agentId);
      totalWeight += vote.score;

      const role = vote.role;
      if (role) rolesSeen.add(role);
    }
  }

  // Check if the quorum requirements are met
  const passesHeadcount = agentIds.size >= quorumConfig.min_agents;
  const passesWeight = totalWeight >= quorumConfig.min_weight_score;
  
  // Check if required roles are present
  let passesRoleDiversity = !quorumConfig.enforce_roles;
  if (quorumConfig.enforce_roles && quorumConfig.required_roles) {
    passesRoleDiversity = quorumConfig.required_roles.every(role => rolesSeen.has(role));
  }

  // Overall quorum check result
  const quorumPassed = passesHeadcount && passesWeight && passesRoleDiversity;

  // Create the result object
  const result: QuorumCheckResult = {
    proposal_id: proposalId,
    votes: agentIds.size,
    weight_total: parseFloat(totalWeight.toFixed(2)),
    roles: Array.from(rolesSeen),
    quorum_passed: quorumPassed,
    details: {
      passes_headcount: passesHeadcount,
      passes_weight: passesWeight,
      passes_role_diversity: passesRoleDiversity
    }
  };

  logger.info(`Quorum check for proposal ${proposalId}: ${quorumPassed ? 'PASSED' : 'FAILED'}`, result);
  return result;
}

/**
 * Get the saved quorum check result for a proposal
 * 
 * @param redis Redis client
 * @param proposalId Proposal ID
 * @returns Quorum check result if available, null otherwise
 */
export async function getQuorumCheckResult(redis: RedisClient, proposalId: string): Promise<QuorumCheckResult | null> {
  const result = await redis.get(`governance:quorum_check:${proposalId}`);
  return result ? JSON.parse(result) : null;
} 