/**
 * Agent Governance Service
 * 
 * Provides functionality for managing agent roles and governance operations.
 */

import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { GovernanceRole, RoleAssignmentHistory, GovernanceKeys } from './models.js';

const logger = createLogger('AgentGovernance');

/**
 * Service for managing agent roles and governance
 */
export class GovernanceService {
  private redis: RedisClient;
  
  /**
   * Create a new governance service
   * @param redis Redis client
   */
  constructor(redis: RedisClient) {
    this.redis = redis;
  }
  
  /**
   * Assign a role to an agent
   * @param agentId Agent ID
   * @param role Role to assign
   * @param reason Reason for assignment
   * @param assignedBy Who/what assigned the role
   */
  async assignRole(
    agentId: string,
    role: GovernanceRole | string,
    reason: string = 'manual',
    assignedBy: string = 'system'
  ): Promise<void> {
    // Get the current role
    const currentRole = await this.getAgentRole(agentId);
    const timestamp = Date.now();
    
    // Remove from old role set if exists
    if (currentRole) {
      await this.redis.srem(GovernanceKeys.roleMembers(currentRole), agentId);
      logger.debug(`Removed agent ${agentId} from role ${currentRole}`);
    }
    
    // Assign new role
    await this.redis.set(GovernanceKeys.agentRole(agentId), role);
    await this.redis.sadd(GovernanceKeys.roleMembers(role), agentId);
    
    // Add to history
    const historyEntry: RoleAssignmentHistory = {
      from: currentRole || null,
      to: role,
      reason,
      timestamp
    };
    
    await this.redis.rpush(
      GovernanceKeys.agentRoleHistory(agentId),
      JSON.stringify(historyEntry)
    );
    
    logger.info(`Assigned role '${role}' to agent ${agentId} (reason: ${reason}, by: ${assignedBy})`);
  }
  
  /**
   * Get the current role of an agent
   * @param agentId Agent ID
   * @returns Current role or null if not assigned
   */
  async getAgentRole(agentId: string): Promise<string | null> {
    return await this.redis.get(GovernanceKeys.agentRole(agentId));
  }
  
  /**
   * Get all agents with a specific role
   * @param role Governance role
   * @returns Array of agent IDs
   */
  async getAgentsWithRole(role: GovernanceRole | string): Promise<string[]> {
    return await this.redis.smembers(GovernanceKeys.roleMembers(role));
  }
  
  /**
   * Get role assignment history for an agent
   * @param agentId Agent ID
   * @param limit Maximum number of history entries to return
   * @returns Array of history entries
   */
  async getRoleHistory(agentId: string, limit: number = 10): Promise<RoleAssignmentHistory[]> {
    const history = await this.redis.lrange(
      GovernanceKeys.agentRoleHistory(agentId),
      0,
      limit - 1
    );
    
    return history.map(entry => JSON.parse(entry));
  }
  
  /**
   * Get all roles and their assigned agents
   * @returns Map of role to list of agent IDs
   */
  async getAllRoleAssignments(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    
    // Get all possible roles
    const roles = Object.values(GovernanceRole);
    
    // Get agents for each role
    for (const role of roles) {
      const agents = await this.getAgentsWithRole(role);
      result.set(role, agents);
    }
    
    return result;
  }
  
  /**
   * Remove an agent's role assignment
   * @param agentId Agent ID
   * @param reason Reason for removal
   */
  async removeRole(agentId: string, reason: string = 'manual'): Promise<void> {
    const currentRole = await this.getAgentRole(agentId);
    
    if (!currentRole) {
      logger.debug(`Agent ${agentId} doesn't have a role assigned, nothing to remove`);
      return;
    }
    
    // Remove from role set
    await this.redis.srem(GovernanceKeys.roleMembers(currentRole), agentId);
    
    // Delete role assignment
    await this.redis.del(GovernanceKeys.agentRole(agentId));
    
    // Add to history
    const historyEntry: RoleAssignmentHistory = {
      from: currentRole,
      to: 'none',
      reason,
      timestamp: Date.now()
    };
    
    await this.redis.rpush(
      GovernanceKeys.agentRoleHistory(agentId),
      JSON.stringify(historyEntry)
    );
    
    logger.info(`Removed role '${currentRole}' from agent ${agentId} (reason: ${reason})`);
  }
} 