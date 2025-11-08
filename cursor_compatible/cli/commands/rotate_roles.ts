#!/usr/bin/env ts-node

/**
 * Role Rotation CLI Command
 * 
 * Automatically rotates agent roles based on trust score, activity,
 * and performance metrics. This implements a dynamic governance system
 * where leadership roles are reassigned based on current agent performance.
 */

// Node.js types
/// <reference types="node" />

import { Command } from 'commander';
import { createMockRedisClient, RedisClient } from '../../src/common/redis.js';
import { createLogger } from '../../src/common/logger.js';
import { 
  getCurrentRoles, 
  getAgentScore, 
  assignRole,
  AgentRole,
  ROLE_THRESHOLDS
} from '../lib/roleUtils.js';

// Define getRedisClient function
async function getRedisClient(): Promise<RedisClient> {
  // In production, this would connect to a real Redis instance
  // For now, we're using the mock for simplicity
  return createMockRedisClient();
}

const logger = createLogger('CLI:RotateRoles');

// Interface for eligible agents
interface EligibleAgent {
  id: string;
  score: number;
  trust: number;
  lastActive: number;
  hasPenalty: boolean;
}

/**
 * Check if an agent should be rotated out of their role
 */
async function checkRotateOut(
  redisClient: RedisClient,
  roles: Record<string, string>
): Promise<void> {
  const now = Date.now();
  
  for (const [role, agentId] of Object.entries(roles)) {
    if (!agentId) continue;
    
    // Get agent metrics
    const trustScoreStr = await redisClient.get(`agent:${agentId}:trust_score`);
    const lastActiveStr = await redisClient.get(`agent:${agentId}:last_active`);
    const penaltyExists = await redisClient.get(`agent:${agentId}:penalty`);
    
    // Parse values
    const trust = parseFloat(trustScoreStr || '0') * 100; // Convert to 0-100 scale
    const lastActive = parseInt(lastActiveStr || '0', 10);
    const inactive = now - lastActive;
    const hasPenalty = penaltyExists !== null;
    
    // Check against role thresholds
    const roleKey = role as AgentRole;
    const threshold = ROLE_THRESHOLDS[roleKey];
    
    if (!threshold) {
      logger.warn(`Unknown role ${role} for agent ${agentId}`);
      continue;
    }
    
    let rotateOutReason = null;
    
    // Check trust score
    if (trust < threshold.trustScore) {
      rotateOutReason = `Trust score ${trust.toFixed(1)}% below required ${threshold.trustScore}%`;
    }
    // Check inactivity
    else if (inactive > threshold.maxInactivity) {
      const inactiveHours = inactive / (60 * 60 * 1000);
      rotateOutReason = `Inactive for ${inactiveHours.toFixed(1)}h (max: ${threshold.maxInactivity / (60 * 60 * 1000)}h)`;
    }
    // Check penalties
    else if (hasPenalty && threshold.allowedViolations === 0) {
      rotateOutReason = 'Has active penalty flag';
    }
    
    // Rotate out if needed
    if (rotateOutReason) {
      logger.warn(`Agent ${agentId} rotated out from ${role}: ${rotateOutReason}`);
      await assignRole(redisClient, agentId, AgentRole.MEMBER, rotateOutReason);
      
      // Clear the role in our local copy for reassignment
      roles[role] = '';
    }
  }
}

/**
 * Find eligible agents for role assignment
 */
async function findEligibleAgents(
  redisClient: RedisClient
): Promise<EligibleAgent[]> {
  const now = Date.now();
  const allAgentIds = await redisClient.smembers('agents:all');
  const eligible: EligibleAgent[] = [];
  
  // Process each agent
  for (const id of allAgentIds) {
    // Get agent metrics
    const trustScoreStr = await redisClient.get(`agent:${id}:trust_score`);
    const lastActiveStr = await redisClient.get(`agent:${id}:last_active`);
    const penaltyExists = await redisClient.get(`agent:${id}:penalty`);
    
    // Parse values
    const trust = parseFloat(trustScoreStr || '0') * 100; // Convert to 0-100 scale
    const lastActive = parseInt(lastActiveStr || '0', 10);
    const inactive = now - lastActive;
    const hasPenalty = penaltyExists !== null;
    
    // Basic eligibility: trust >= 75%, active in last 24h, no penalties
    if (
      trust >= ROLE_THRESHOLDS[AgentRole.WATCHER].trustScore && 
      inactive < 24 * 60 * 60 * 1000 && 
      !hasPenalty
    ) {
      // Calculate full score
      const score = await getAgentScore(redisClient, id);
      
      eligible.push({
        id,
        score,
        trust,
        lastActive,
        hasPenalty
      });
    }
  }
  
  // Sort by score (descending)
  return eligible.sort((a, b) => b.score - a.score);
}

/**
 * Fill open roles with eligible agents
 */
async function fillOpenRoles(
  redisClient: RedisClient,
  roles: Record<string, string>,
  eligible: EligibleAgent[]
): Promise<void> {
  // Define role priorities (the order in which to fill roles)
  const rolePriorities = [
    AgentRole.LEADER,
    AgentRole.WATCHER, // First watcher
    AgentRole.WATCHER, // Second watcher
    AgentRole.AUDITOR, // First auditor
    AgentRole.AUDITOR  // Second auditor
  ];
  
  // Create a copy of eligible agents we can modify
  const availableAgents = [...eligible];
  const now = Date.now();
  
  // Fill each role in priority order
  for (const roleKey of rolePriorities) {
    // Skip if this role is already filled
    let isRoleFilled = false;
    
    // For multiple watchers/auditors, check if we need to handle specially
    if (roleKey === AgentRole.WATCHER && roles['watcher']) {
      // For now, we handle only one watcher in our data structure
      // TODO: Extend to handle multiple watchers/auditors
      isRoleFilled = true;
    } else if (roleKey === AgentRole.AUDITOR && roles['auditor']) {
      // Same for auditor
      isRoleFilled = true;
    } else {
      isRoleFilled = !!roles[roleKey];
    }
    
    if (isRoleFilled) {
      continue;
    }
    
    // Get next available agent that meets the threshold
    const threshold = ROLE_THRESHOLDS[roleKey];
    const agentIndex = availableAgents.findIndex(a => 
      a.trust >= threshold.trustScore && 
      (now - a.lastActive) <= threshold.maxInactivity &&
      (threshold.allowedViolations > 0 || !a.hasPenalty)
    );
    
    // No eligible agent found for this role
    if (agentIndex === -1) {
      logger.warn(`No eligible agent found for role ${roleKey}`);
      continue;
    }
    
    // Get the agent and remove from available list
    const agent = availableAgents.splice(agentIndex, 1)[0];
    
    // Assign the role
    const reason = `Highest scoring eligible agent (score: ${agent.score.toFixed(1)})`;
    await assignRole(redisClient, agent.id, roleKey, reason);
    
    // Update our local roles map
    roles[roleKey] = agent.id;
    
    logger.info(`Assigned ${roleKey} role to agent ${agent.id} (score: ${agent.score.toFixed(1)})`);
  }
}

/**
 * Broadcast role changes to the network
 */
async function broadcastRoleChanges(
  redisClient: RedisClient,
  roles: Record<string, string>
): Promise<void> {
  // Format the current roles for broadcast
  const formattedRoles: Record<string, string> = {};
  
  // Add all roles
  for (const [role, agentId] of Object.entries(roles)) {
    if (agentId) {
      formattedRoles[role] = agentId;
    }
  }
  
  // Save to Redis for API access
  await redisClient.set(
    'governance:current_roles', 
    JSON.stringify(formattedRoles)
  );
  
  // TODO: Implement WebSocket broadcast if needed
  logger.info('Updated governance:current_roles in Redis');
}

// Define command options interface
interface RotateRolesOptions {
  dryRun: boolean;
  broadcast: boolean;
}

// Create CLI command
export const command = new Command('rotate-roles')
  .description('Dynamically rotate agent roles based on trust and performance')
  .option('-d, --dry-run', 'Run without making changes', false)
  .option('-b, --broadcast', 'Broadcast role changes to network', false)
  .action(async (options: RotateRolesOptions) => {
    try {
      const { dryRun, broadcast } = options;
      
      logger.info('Starting agent role rotation process');
      
      // Get Redis client (or mock for dry run)
      const redisClient = dryRun 
        ? createMockRedisClient()
        : await getRedisClient();
      
      // Get current role assignments
      const currentRoles = await getCurrentRoles(redisClient);
      logger.info('Current roles:', currentRoles);
      
      // Check for agents to rotate out
      if (!dryRun) {
        await checkRotateOut(redisClient, currentRoles);
      } else {
        logger.info('Dry run: skipping rotate-out checks');
      }
      
      // Find eligible agents for rotation
      const eligibleAgents = await findEligibleAgents(redisClient);
      logger.info(`Found ${eligibleAgents.length} eligible agents for role assignment`);
      
      // Display top candidates
      eligibleAgents.slice(0, 5).forEach((agent, i) => {
        logger.info(`Candidate #${i+1}: Agent ${agent.id} - Score: ${agent.score.toFixed(1)}`);
      });
      
      // Fill open roles with eligible agents
      if (!dryRun) {
        await fillOpenRoles(redisClient, currentRoles, eligibleAgents);
      } else {
        logger.info('Dry run: skipping role assignments');
      }
      
      // Broadcast changes if requested
      if (broadcast && !dryRun) {
        await broadcastRoleChanges(redisClient, currentRoles);
      }
      
      logger.info('Role rotation completed successfully');
    } catch (error) {
      logger.error('Error during role rotation:', (error as Error).message);
      // Exit with error code
      process.exit(1);
    }
  });

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  command.parse(process.argv);
}

export default command; 