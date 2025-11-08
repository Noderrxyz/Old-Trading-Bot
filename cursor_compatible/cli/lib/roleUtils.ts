/**
 * Role Management Utilities
 * 
 * Provides utility functions for agent role management, scoring, and rotation.
 */

import { RedisClient } from '../../src/common/redis.js';
import { createLogger } from '../../src/common/logger.js';

const logger = createLogger('RoleUtils');

// Define agent roles
export enum AgentRole {
  LEADER = 'leader',
  WATCHER = 'watcher',
  AUDITOR = 'auditor',
  MEMBER = 'member'
}

// Role thresholds
export const ROLE_THRESHOLDS = {
  [AgentRole.LEADER]: { 
    trustScore: 80, 
    maxInactivity: 6 * 60 * 60 * 1000, // 6 hours
    allowedViolations: 0
  },
  [AgentRole.WATCHER]: { 
    trustScore: 75, 
    maxInactivity: 12 * 60 * 60 * 1000, // 12 hours
    allowedViolations: 0
  },
  [AgentRole.AUDITOR]: { 
    trustScore: 70, 
    maxInactivity: 24 * 60 * 60 * 1000, // 24 hours
    allowedViolations: 1
  },
  [AgentRole.MEMBER]: { 
    trustScore: 0, 
    maxInactivity: Number.MAX_SAFE_INTEGER,
    allowedViolations: Number.MAX_SAFE_INTEGER
  }
};

/**
 * Get current roles for all agents
 * @param redisClient Redis client
 * @returns Map of roles to agent IDs
 */
export async function getCurrentRoles(
  redisClient: RedisClient
): Promise<Record<string, string>> {
  const roles: Record<string, string> = {
    leader: '',
    watcher: '',
    auditor: ''
  };
  
  // Get all agent keys
  const agentKeys = await redisClient.keys('agent:*:metadata');
  
  for (const key of agentKeys) {
    const agentId = key.split(':')[1];
    const metadata = await redisClient.hgetall(key);
    
    if (metadata.role && metadata.role !== AgentRole.MEMBER) {
      // If we already have this role filled, add to array (for watchers/auditors)
      if (roles[metadata.role] && metadata.role !== AgentRole.LEADER) {
        // We're not keeping track of multiple watchers/auditors in this implementation
        // But we could extend this to handle arrays of IDs per role
        continue;
      }
      
      roles[metadata.role] = agentId;
    }
  }
  
  return roles;
}

/**
 * Calculate agent score based on trust, uptime, and activity
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @returns Combined score (0-100)
 */
export async function getAgentScore(
  redisClient: RedisClient,
  agentId: string
): Promise<number> {
  const trustScoreStr = await redisClient.get(`agent:${agentId}:trust_score`);
  const metrics = await redisClient.hgetall(`agent:${agentId}:metrics`);
  
  // Parse values with fallbacks
  const trustScore = parseFloat(trustScoreStr || '0') * 100; // Convert from 0-1 to 0-100
  const uptime = parseFloat(metrics.uptime || '0') * 100; // Convert from 0-1 to 0-100
  const activityScore = parseFloat(metrics.activityScore || '0') * 100; // Convert from 0-1 to 0-100
  
  // Calculate combined score: 50% trust score + 30% uptime + 20% activity score
  return (trustScore * 0.5) + (uptime * 0.3) + (activityScore * 0.2);
}

/**
 * Assign a role to an agent
 * @param agentId Agent ID
 * @param role Role to assign
 * @param reason Reason for role assignment
 * @param source Source of the assignment (automatic, manual, etc.)
 */
export async function assignRole(
  redisClient: RedisClient,
  agentId: string,
  role: string,
  reason: string,
  source: string = 'rotation'
): Promise<void> {
  if (!agentId) {
    logger.warn(`Cannot assign role ${role}: no agent ID provided`);
    return;
  }
  
  // Get previous role
  const metadata = await redisClient.hgetall(`agent:${agentId}:metadata`);
  const previousRole = metadata.role || AgentRole.MEMBER;
  
  // Update role in agent metadata
  await redisClient.hset(`agent:${agentId}:metadata`, { 
    role,
    roleAssignedAt: Date.now().toString(),
    roleAssignedReason: reason,
    roleAssignedSource: source,
    previousRole
  });
  
  // Store rotation record
  if (previousRole !== role) {
    await redisClient.hset(`governance:rotated:${agentId}`, {
      timestamp: Date.now().toString(),
      from: previousRole,
      to: role,
      reason,
      source
    });
    
    // Set expiration for rotation record (30 days)
    await redisClient.expire(`governance:rotated:${agentId}`, 30 * 24 * 60 * 60);
    
    // Add to role history
    await redisClient.lpush(`governance:role_history:${agentId}`, JSON.stringify({
      timestamp: Date.now(),
      role,
      reason,
      source
    }));
    
    // Trim history to keep only last 100 entries
    await redisClient.ltrim(`governance:role_history:${agentId}`, 0, 99);
    
    logger.info(`Agent ${agentId} role changed from ${previousRole} to ${role} (reason: ${reason})`);
  }
} 