/**
 * Agent Governance Models
 * 
 * Defines models and enums for the agent governance system,
 * including roles, permissions, and delegation rules.
 */

/**
 * Governance roles that can be assigned to agents
 */
export enum GovernanceRole {
  LEADER = 'leader',
  WATCHER = 'watcher',
  AUDITOR = 'auditor',
  SENTINEL = 'sentinel',
  CANDIDATE = 'candidate'
}

/**
 * Role assignment history entry
 */
export interface RoleAssignmentHistory {
  /**
   * Previous role (null if this is the first assignment)
   */
  from: string | null;
  
  /**
   * New role
   */
  to: string;
  
  /**
   * Reason for the assignment change
   */
  reason: string;
  
  /**
   * Timestamp when the change was made
   */
  timestamp: number;
}

/**
 * Agent role information
 */
export interface AgentRoleInfo {
  /**
   * Agent ID
   */
  agentId: string;
  
  /**
   * Current governance role
   */
  role: GovernanceRole;
  
  /**
   * When the role was assigned
   */
  assignedAt: number;
  
  /**
   * Who/what assigned the role (user ID or system)
   */
  assignedBy: string;
  
  /**
   * Role assignment history
   */
  history: RoleAssignmentHistory[];
}

/**
 * Redis key formats for governance-related data
 */
export const GovernanceKeys = {
  /**
   * Key for an agent's current role
   * @param agentId Agent ID
   */
  agentRole: (agentId: string) => `agent:${agentId}:role`,
  
  /**
   * Key for an agent's role history
   * @param agentId Agent ID
   */
  agentRoleHistory: (agentId: string) => `agent:${agentId}:role:history`,
  
  /**
   * Key for set of agent IDs with a specific role
   * @param role Governance role
   */
  roleMembers: (role: string) => `governance:roles:${role}`,
} 