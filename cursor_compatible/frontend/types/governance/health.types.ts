/**
 * Cluster Health Types
 * 
 * Types for monitoring and tracking health status of governance clusters
 */

export enum AnomalyType {
  PROPOSAL_DROPOUT = 'proposal_dropout',
  REPEATED_INDECISION = 'repeated_indecision',
  ROGUE_AGENT = 'rogue_agent',
  LOW_PARTICIPATION = 'low_participation',
  QUORUM_FAILURE = 'quorum_failure',
  VOTING_PATTERN_SHIFT = 'voting_pattern_shift'
}

export interface ClusterAnomaly {
  id: string;
  clusterId: string;
  type: AnomalyType;
  timestamp: number;
  details: Record<string, any>;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
  resolutionDetails?: Record<string, any>;
}

export interface AgentHealthMetrics {
  agentDid: string;
  voteCount: number;
  participationRate: number;
  consensusAlignment: number; // How often agent votes with the majority
  lastActiveTimestamp: number;
  avgResponseTime: number;
  healthScore: number;
}

export interface ClusterHealthMetrics {
  clusterId: string;
  timestamp: number;
  proposalCount: number;
  activeProposals: number;
  completedProposals: number;
  failedProposals: number;
  averageParticipation: number;
  quorumSuccessRate: number;
  averageTimeToResolution: number;
  anomalies: ClusterAnomaly[];
  healthScore: number;
  agentMetrics: Record<string, AgentHealthMetrics>;
} 