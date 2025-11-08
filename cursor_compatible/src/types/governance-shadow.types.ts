/**
 * Shadow Cabinet Governance Types
 * 
 * Types for governance shadow cabinets, parallel proposals, and counterfactual testing
 */

export type AgentID = string;

/**
 * Shadow Cabinet represents an alternative governance unit that simulates opposing proposals
 */
export interface ShadowCabinet {
  /** Unique identifier for the shadow cabinet */
  id: string;
  
  /** ID of the original/main council that this shadows */
  originCouncilId: string;
  
  /** List of agent IDs that make up this shadow cabinet */
  members: AgentID[];
  
  /** When this shadow cabinet was created */
  createdAt: number;
  
  /** List of proposal track IDs that this cabinet has simulated */
  simulatedProposals: string[];
  
  /** Optional description of the cabinet's alternative perspective */
  description?: string;
  
  /** Whether this shadow cabinet is active */
  active: boolean;
  
  /** Optional metadata for additional properties */
  metadata?: Record<string, any>;
}

/**
 * Simulation mode for parallel proposal tracks
 */
export enum SimulationMode {
  /** Run in completely isolated environment */
  ISOLATED = 'isolated',
  
  /** Use real data but don't actually execute */
  READ_ONLY = 'read_only',
  
  /** Simulate with optional real-world side effects */
  HYBRID = 'hybrid'
}

/**
 * Forked Proposal Track represents a secondary version of a proposal
 * being evaluated under different assumptions or by different agents
 */
export interface ForkedProposalTrack {
  /** Unique identifier for the forked track */
  id: string;
  
  /** ID of the original proposal this was forked from */
  originProposalId: string;
  
  /** ID of the shadow cabinet that initiated this fork */
  initiatingCabinetId: string;
  
  /** Modified parameters or changes from the original proposal */
  changes: Record<string, any>;
  
  /** When this fork was created */
  createdAt: number;
  
  /** Current status of the fork */
  status: 'pending' | 'simulating' | 'completed' | 'promoted' | 'archived';
  
  /** Simulation mode being used */
  simulationMode: SimulationMode;
  
  /** Result of the counterfactual simulation, if completed */
  simulationResult?: CounterfactualOutcome;
  
  /** Whether this fork is visible to the public */
  isPublic: boolean;
  
  /** Optional metadata for additional properties */
  metadata?: Record<string, any>;
}

/**
 * CounterfactualOutcome represents the simulated result of a proposal
 * if it had been chosen instead of the main track
 */
export interface CounterfactualOutcome {
  /** Overall impact score (-10 to 10, negative is harmful) */
  impactScore: number;
  
  /** Change in trust scores that would occur */
  trustDelta: Record<AgentID, number>;
  
  /** Whether the proposal would succeed under simulation */
  proposalSuccess: boolean;
  
  /** Key metrics that would be affected */
  metrics: Record<string, number>;
  
  /** Analysis notes from the simulation */
  notes: string;
  
  /** When the simulation was completed */
  completedAt: number;
  
  /** Optional confidence score (0-1) in the simulation accuracy */
  confidence?: number;
  
  /** Optional metadata for additional properties */
  metadata?: Record<string, any>;
}

/**
 * Comparison result between original and shadow proposal
 */
export type ProposalComparisonResult = 'original' | 'shadow' | 'undecided';

/**
 * Shadow promotion vote for determining if a shadow proposal should replace the original
 */
export interface ShadowPromotionVote {
  /** Agent casting the vote */
  agentId: AgentID;
  
  /** Whether they support promoting the shadow proposal */
  support: boolean;
  
  /** Weight of their vote */
  weight: number;
  
  /** When the vote was cast */
  timestamp: number;
  
  /** Optional reasoning for their decision */
  reasoning?: string;
} 