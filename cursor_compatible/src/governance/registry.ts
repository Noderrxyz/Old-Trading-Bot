/**
 * Agent Registry
 * 
 * Manages agent reputation scores, roles, and registration status
 * in the governance system.
 */

import { RedisClient, createMockRedisClient } from '../common/redis.js';
import { createLogger } from '../common/logger.js';

// Logger for registry events
const logger = createLogger('AgentRegistry');

// Agent roles in the governance system
export type AgentRole = 'member' | 'validator' | 'moderator' | 'admin';

// Redis client singleton
let redisClientInstance: RedisClient | null = null;

/**
 * Get the current reputation score for an agent
 * 
 * @param agentId The agent ID to look up
 * @returns Reputation score (0-100)
 */
export async function getAgentReputation(agentId: string): Promise<number> {
  const redisClient = await getRedisClient();
  
  const storedRep = await redisClient.get(`agent:${agentId}:reputation`);
  if (!storedRep) {
    // Default reputation for new agents
    return 50;
  }
  
  return parseFloat(storedRep);
}

/**
 * Update an agent's reputation score
 * 
 * @param agentId The agent ID
 * @param newScore The new reputation score (0-100)
 */
export async function updateAgentReputation(
  agentId: string, 
  newScore: number
): Promise<void> {
  const redisClient = await getRedisClient();
  
  // Ensure score is within bounds
  const boundedScore = Math.max(0, Math.min(100, newScore));
  
  await redisClient.set(`agent:${agentId}:reputation`, boundedScore.toString());
  
  logger.info(`Updated reputation for ${agentId}: ${boundedScore}`);
  
  // Record historical data point
  await recordReputationHistory(redisClient, agentId, boundedScore);
}

/**
 * Adjust an agent's reputation by a delta
 * 
 * @param agentId The agent ID
 * @param delta The change in reputation (positive or negative)
 * @returns The new reputation score
 */
export async function adjustAgentReputation(
  agentId: string,
  delta: number
): Promise<number> {
  const currentRep = await getAgentReputation(agentId);
  const newRep = currentRep + delta;
  
  await updateAgentReputation(agentId, newRep);
  
  return newRep;
}

/**
 * Get an agent's current role in the governance system
 * 
 * @param agentId The agent ID
 * @returns The agent's current role
 */
export async function getCurrentRole(agentId: string): Promise<AgentRole> {
  const redisClient = await getRedisClient();
  
  const storedRole = await redisClient.get(`agent:${agentId}:role`);
  if (!storedRole) {
    // Default role for new agents
    return 'member';
  }
  
  return storedRole as AgentRole;
}

/**
 * Update an agent's role
 * 
 * @param agentId The agent ID
 * @param newRole The new role to assign
 */
export async function updateAgentRole(
  agentId: string,
  newRole: AgentRole
): Promise<void> {
  const redisClient = await getRedisClient();
  
  const oldRole = await getCurrentRole(agentId);
  
  await redisClient.set(`agent:${agentId}:role`, newRole);
  
  logger.info(`Updated role for ${agentId}: ${oldRole} -> ${newRole}`);
  
  // Record role change in history
  await redisClient.rpush(
    `agent:${agentId}:role_history`,
    JSON.stringify({
      from: oldRole,
      to: newRole,
      timestamp: Date.now()
    })
  );
  
  // Keep history at reasonable size
  await redisClient.ltrim(`agent:${agentId}:role_history`, -100, -1);
}

/**
 * Check if an agent is registered in the governance system
 * 
 * @param agentId The agent ID to check
 * @returns Boolean indicating if agent is registered
 */
export async function isAgentRegistered(agentId: string): Promise<boolean> {
  const redisClient = await getRedisClient();
  
  const result = await redisClient.get(`agent:${agentId}:registered`);
  return result !== null;
}

/**
 * Register an agent in the governance system
 * 
 * @param agentId The agent ID to register
 * @param initialRole Optional initial role (defaults to 'member')
 * @param initialReputation Optional initial reputation (defaults to 50)
 */
export async function registerAgent(
  agentId: string,
  initialRole: AgentRole = 'member',
  initialReputation: number = 50
): Promise<void> {
  const redisClient = await getRedisClient();
  
  // Mark as registered
  await redisClient.set(`agent:${agentId}:registered`, '1');
  
  // Set initial role
  await redisClient.set(`agent:${agentId}:role`, initialRole);
  
  // Set initial reputation
  await redisClient.set(`agent:${agentId}:reputation`, initialReputation.toString());
  
  // Record registration time
  await redisClient.set(`agent:${agentId}:registered_at`, Date.now().toString());
  
  logger.info(
    `Registered agent ${agentId} with role ${initialRole} and reputation ${initialReputation}`
  );
}

// Private helper functions

/**
 * Record a reputation change in history
 */
async function recordReputationHistory(
  redisClient: RedisClient, 
  agentId: string, 
  score: number
): Promise<void> {
  const historyKey = `agent:${agentId}:reputation_history`;
  
  await redisClient.rpush(
    historyKey,
    JSON.stringify({
      score,
      timestamp: Date.now()
    })
  );
  
  // Keep history at reasonable size (last 1000 points)
  await redisClient.ltrim(historyKey, -1000, -1);
}

/**
 * Get the Redis client singleton
 */
async function getRedisClient(): Promise<RedisClient> {
  // If we already have an instance, return it
  if (redisClientInstance) {
    return redisClientInstance;
  }
  
  // Otherwise, create the client
  redisClientInstance = await createMockRedisClient();
  
  return redisClientInstance!;
} 