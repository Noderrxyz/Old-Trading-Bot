/**
 * Cluster Types
 * 
 * Types for autonomous multi-agent governance clusters
 */

export enum ClusterType {
  CONSENSUS = 'consensus',
  DELIBERATIVE = 'deliberative',
  HIERARCHICAL = 'hierarchical',
  HYBRID = 'hybrid'
}

export enum ClusterStatus {
  FORMING = 'forming',
  ACTIVE = 'active',
  PAUSED = 'paused',
  DISSOLVED = 'dissolved'
}

export enum AgentRole {
  LEADER = 'leader',
  PARTICIPANT = 'participant',
  OBSERVER = 'observer',
  FACILITATOR = 'facilitator',
  SPECIALIST = 'specialist'
}

export interface ClusterAgent {
  did: string;
  name: string;
  role: AgentRole;
  capabilities: string[];
  joinedAt: number;
  status: 'active' | 'inactive';
  metadata?: Record<string, any>;
}

export interface QuorumRule {
  type: 'percentage' | 'count';
  threshold: number;
  minParticipants?: number;
  specialRules?: Record<string, any>;
}

export interface ClusterScope {
  domain: string;
  capabilities: string[];
  constraints?: Record<string, any>;
}

export interface ClusterDefinition {
  id: string;
  name: string;
  description: string;
  type: ClusterType;
  status: ClusterStatus;
  createdAt: number;
  updatedAt: number;
  owner: string;
  agents: ClusterAgent[];
  quorumRules: QuorumRule;
  scope: ClusterScope;
  metadata?: Record<string, any>;
}

export interface ClusterListFilters {
  status?: ClusterStatus[];
  type?: ClusterType[];
  owner?: string;
  agentDid?: string;
  domain?: string;
} 