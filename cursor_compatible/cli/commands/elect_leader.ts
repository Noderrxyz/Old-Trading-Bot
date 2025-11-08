#!/usr/bin/env ts-node

/**
 * Elect Leader CLI Command
 * 
 * Automatically assigns leadership roles to agents based on trust score, 
 * uptime and activity metrics.
 */

import { Command } from 'commander';
import { getRedisClient } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { broadcastMessage } from '../lib/messaging.js';

// Agent role types
enum AgentRole {
  LEADER = 'leader',
  WATCHER = 'watcher',
  AUDITOR = 'auditor',
  MEMBER = 'member',
}

// Agent metrics interface
interface AgentMetrics {
  id: string;
  trustScore: number;
  uptime: number;
  activityScore: number;
  lastActiveTimestamp: number;
  combinedScore: number;
}

// Command options interface
interface ElectLeaderOptions {
  minTrust: string;
  activityWindow: string;
  snapshot: boolean;
  broadcast: boolean;
  dryRun: boolean;
}

/**
 * Calculate the time window in ms
 * @param hours Number of hours
 * @returns Time window in milliseconds
 */
function calculateTimeWindow(hours: number): number {
  return hours * 60 * 60 * 1000;
}

/**
 * Calculate eligibility and combined score for agents
 * @param agents List of agent metrics
 * @param minTrustScore Minimum trust score required
 * @param activityWindowHours Activity window in hours
 * @returns Sorted list of eligible agents with combined scores
 */
function calculateEligibleAgents(
  agents: AgentMetrics[],
  minTrustScore: number,
  activityWindowHours: number
): AgentMetrics[] {
  const now = Date.now();
  const activityWindow = calculateTimeWindow(activityWindowHours);
  
  // Filter eligible agents
  const eligibleAgents = agents.filter((agent) => {
    // Check minimum trust score
    if (agent.trustScore < minTrustScore / 100) {
      logger.debug(`Agent ${agent.id} ineligible: trust score ${agent.trustScore * 100}% below minimum ${minTrustScore}%`);
      return false;
    }
    
    // Check activity within window
    const lastActive = agent.lastActiveTimestamp;
    if (now - lastActive > activityWindow) {
      logger.debug(`Agent ${agent.id} ineligible: inactive for ${((now - lastActive) / (1000 * 60 * 60)).toFixed(1)} hours`);
      return false;
    }
    
    return true;
  });
  
  // Calculate combined score
  // Formula: 50% trust score + 30% uptime + 20% activity score
  const scoredAgents = eligibleAgents.map((agent) => {
    const combinedScore = 
      (agent.trustScore * 0.5) + 
      (agent.uptime * 0.3) + 
      (agent.activityScore * 0.2);
    
    return {
      ...agent,
      combinedScore,
    };
  });
  
  // Sort by combined score (descending)
  return scoredAgents.sort((a, b) => b.combinedScore - a.combinedScore);
}

/**
 * Assign roles to agents based on their ranking
 * @param rankedAgents List of agents sorted by score
 * @returns Map of agent IDs to roles
 */
function assignRoles(rankedAgents: AgentMetrics[]): Map<string, AgentRole> {
  const roleAssignments = new Map<string, AgentRole>();
  
  // Assign roles based on position
  rankedAgents.forEach((agent, index) => {
    let role = AgentRole.MEMBER;
    
    if (index === 0) {
      role = AgentRole.LEADER;
    } else if (index <= 2) {
      role = AgentRole.WATCHER;
    } else if (index <= 4) {
      role = AgentRole.AUDITOR;
    }
    
    roleAssignments.set(agent.id, role);
  });
  
  return roleAssignments;
}

/**
 * Save role assignments to Redis
 * @param redisClient Redis client
 * @param roleAssignments Map of agent IDs to roles
 */
async function saveRoleAssignments(
  redisClient: any,
  roleAssignments: Map<string, AgentRole>
): Promise<void> {
  // Set current roles
  for (const [agentId, role] of roleAssignments.entries()) {
    await redisClient.hset(`agent:${agentId}:metadata`, { role });
    logger.info(`Assigned role ${role} to agent ${agentId}`);
  }
  
  // Save snapshot of the current leadership structure
  const timestamp = Date.now();
  const snapshotKey = `governance:roles:snapshot:${timestamp}`;
  
  for (const [agentId, role] of roleAssignments.entries()) {
    await redisClient.hset(snapshotKey, { [agentId]: role });
  }
  
  // Set expiration for snapshot (30 days)
  await redisClient.expire(snapshotKey, 30 * 24 * 60 * 60);
  
  // Update latest leadership pointer
  await redisClient.set('governance:roles:latest', String(timestamp));
  
  logger.info(`Saved governance snapshot to ${snapshotKey}`);
}

/**
 * Broadcast role assignments to the network
 * @param roleAssignments Map of agent IDs to roles
 */
async function broadcastRoleAssignments(
  roleAssignments: Map<string, AgentRole>
): Promise<void> {
  const message = {
    type: 'GOVERNANCE_UPDATE',
    timestamp: Date.now(),
    roles: Object.fromEntries(roleAssignments),
  };
  
  await broadcastMessage(message);
  logger.info('Broadcasted governance update to network');
}

export const command = new Command('elect-leader')
  .description('Elect leadership roles for agents based on performance metrics')
  .option('--min-trust <score>', 'Minimum trust score (0-100) required for eligibility', '75')
  .option('--activity-window <hours>', 'Time window in hours to consider agent as active', '24')
  .option('--snapshot', 'Save a snapshot of the election results', true)
  .option('--broadcast', 'Broadcast results to the network', false)
  .option('-d, --dry-run', 'Run election without making changes', false)
  .action(async (options: ElectLeaderOptions) => {
    try {
      const {
        minTrust,
        activityWindow,
        snapshot,
        broadcast,
        dryRun
      } = options;
      
      logger.info('Starting agent role election process');
      logger.info(`Configuration: min trust score ${minTrust}%, activity window ${activityWindow}h, dry run: ${dryRun}`);
      
      // Connect to Redis
      const redisClient = await getRedisClient();
      
      // Get all agent keys
      const agentKeys = await redisClient.keys('agent:*:metrics');
      logger.info(`Found ${agentKeys.length} agents in the system`);
      
      if (agentKeys.length === 0) {
        logger.warn('No agents found. Election aborted.');
        return;
      }
      
      // Collect agent metrics
      const agentMetrics: AgentMetrics[] = [];
      
      for (const key of agentKeys) {
        const agentId = key.split(':')[1];
        const metrics = await redisClient.hgetall(key);
        
        // Convert string values to numbers
        agentMetrics.push({
          id: agentId,
          trustScore: parseFloat(metrics.trustScore || '0'),
          uptime: parseFloat(metrics.uptime || '0'),
          activityScore: parseFloat(metrics.activityScore || '0'),
          lastActiveTimestamp: parseInt(metrics.lastActiveTimestamp || '0', 10),
          combinedScore: 0, // Will be calculated later
        });
      }
      
      // Calculate eligible agents and their scores
      const eligibleAgents = calculateEligibleAgents(
        agentMetrics,
        parseInt(minTrust, 10),
        parseInt(activityWindow, 10)
      );
      
      logger.info(`Found ${eligibleAgents.length} eligible agents out of ${agentMetrics.length} total`);
      
      // Log eligible agents and their scores
      eligibleAgents.forEach((agent, index) => {
        logger.info(`Rank ${index + 1}: Agent ${agent.id} - Score: ${(agent.combinedScore * 100).toFixed(2)}%`);
      });
      
      // Assign roles
      const roleAssignments = assignRoles(eligibleAgents);
      
      // Print role assignments
      logger.info('Role assignments:');
      roleAssignments.forEach((role, agentId) => {
        logger.info(`- ${role.toUpperCase()}: Agent ${agentId}`);
      });
      
      // If dry run, exit here
      if (dryRun) {
        logger.info('Dry run complete. No changes made.');
        return;
      }
      
      // Save role assignments if requested
      if (snapshot) {
        await saveRoleAssignments(redisClient, roleAssignments);
      }
      
      // Broadcast if requested
      if (broadcast) {
        await broadcastRoleAssignments(roleAssignments);
      }
      
      logger.info('Agent role election completed successfully');
    } catch (error) {
      logger.error('Error during agent role election:', (error as Error).message);
      throw error;
    }
  });

// Allow direct execution
if (typeof require !== 'undefined' && require.main === module) {
  command.parse(process.argv);
}

export default command; 