/**
 * Liquid Adaptive Governance Types
 * 
 * Types for the Neural Quorum Flow governance system where votes flow, decay,
 * and re-weight over time based on agent participation, trust, and performance.
 */

export type AgentID = string;
export type ProposalID = string;

/**
 * Vote options including abstain and delegate
 */
export type LiquidVoteOption = 'yes' | 'no' | 'abstain' | 'delegate';

/**
 * Decay models for how votes lose weight over time
 */
export enum VoteDecayModel {
  /** Linear decay from full weight to zero over decay period */
  LINEAR = 'linear',
  
  /** Exponential decay using exponential function */
  EXPONENTIAL = 'exponential',
  
  /** Step-wise decay at specific time intervals */
  STEP = 'step',
  
  /** Sudden drop after grace period followed by slow decay */
  CLIFF = 'cliff',
  
  /** No decay - votes retain full weight (not recommended) */
  NONE = 'none'
}

/**
 * Configuration for how vote weights decay over time
 */
export interface VoteDecayConfig {
  /** Model to use for vote decay */
  model: VoteDecayModel;
  
  /** Base half-life in milliseconds when vote loses half its weight */
  halfLifeMs: number;
  
  /** Minimum weight a vote can decay to before being removed */
  minWeight: number;
  
  /** Parameters specific to the chosen decay model */
  parameters?: Record<string, number>;
}

/**
 * A vote cast by an agent on a proposal within the liquid governance system
 */
export interface LiquidVote {
  /** The agent casting the vote */
  agentId: AgentID;
  
  /** The proposal being voted on */
  proposalId: ProposalID;
  
  /** The agent's vote choice */
  vote: LiquidVoteOption;
  
  /** If delegating, the agent receiving the delegation */
  delegatedTo?: AgentID;
  
  /** The original base weight of the vote when cast */
  originalWeight: number;
  
  /** The current weight of the vote after decay and other adjustments */
  currentWeight: number;
  
  /** When the vote was cast */
  timestamp: number;
  
  /** When the vote was last updated or recalculated */
  lastUpdated: number;
  
  /** How confident the agent is in their vote (0-1) */
  confidence?: number;
  
  /** Optional justification for the vote */
  justification?: string;
  
  /** Tags or categories for the vote (useful for analysis) */
  tags?: string[];
  
  /** Whether this vote is active (can be deactivated if agent delegates later) */
  active: boolean;
}

/**
 * Delegation relationship between agents
 */
export interface VoteDelegation {
  /** Agent delegating their vote */
  fromAgent: AgentID;
  
  /** Agent receiving the delegation */
  toAgent: AgentID;
  
  /** The proposal this delegation applies to (null if global) */
  proposalId?: ProposalID;
  
  /** When the delegation was created */
  createdAt: number;
  
  /** When the delegation expires (null if permanent until revoked) */
  expiresAt?: number;
  
  /** Whether the delegation is domain-specific */
  domain?: string;
  
  /** Total weight being delegated */
  weight: number;
  
  /** Whether this delegation is currently active */
  active: boolean;
}

/**
 * Maps the neural influence paths between agents on a proposal
 */
export interface NeuralInfluencePath {
  /** Source agent with influence */
  sourceAgent: AgentID;
  
  /** Target agent influenced by source */
  targetAgent: AgentID;
  
  /** Strength of the influence */
  strength: number;
  
  /** Type of influence relationship */
  type: 'direct' | 'delegated' | 'trust' | 'social';
  
  /** When this path was last calculated */
  updatedAt: number;
}

/**
 * A real-time snapshot of the quorum state of a proposal
 */
export interface QuorumFlowSnapshot {
  /** Proposal ID */
  proposalId: ProposalID;
  
  /** Total weighted votes for yes */
  yesWeight: number;
  
  /** Total weighted votes for no */
  noWeight: number;
  
  /** Total weighted votes for abstain */
  abstainWeight: number;
  
  /** Total weight of agents who haven't voted or delegated */
  undecidedWeight: number;
  
  /** Total potential weight of all eligible voters */
  totalPossibleWeight: number;
  
  /** Map of active delegations (fromAgent -> toAgent) */
  activeDelegations: Record<AgentID, AgentID>;
  
  /** Map of agent influence (agentId -> influence strength) */
  neuralPathMap: Record<AgentID, number>;
  
  /** Time this snapshot was taken */
  timestamp: number;
  
  /** Whether quorum is currently reached */
  quorumReached: boolean;
  
  /** The current winning option */
  currentWinner: 'yes' | 'no' | 'tie' | 'insufficient';
  
  /** Stability index (0-1) - how stable the current result is */
  stabilityIndex: number;
  
  /** Time until this result becomes final (if stability maintained) */
  timeUntilFinality?: number;
}

/**
 * Agent participation statistics for governance
 */
export interface AgentParticipationStats {
  /** Agent ID */
  agentId: AgentID;
  
  /** Percentage of proposals voted on (0-1) */
  participationRate: number;
  
  /** Number of proposals voted on */
  proposalsVoted: number;
  
  /** Number of proposals eligible to vote on */
  proposalsEligible: number;
  
  /** Number of votes delegated to others */
  delegationsGiven: number;
  
  /** Number of votes received from others */
  delegationsReceived: number;
  
  /** How often agent's votes aligned with final outcomes */
  outcomeAlignmentRate: number;
  
  /** Last time agent participated in governance */
  lastActivity: number;
  
  /** Historical participation scores */
  history: {
    timestamp: number;
    participationRate: number;
    delegationsReceived: number;
  }[];
}

/**
 * Configuration for the Neural Quorum Engine
 */
export interface NeuralQuorumConfig {
  /** Default decay configuration */
  defaultDecay: VoteDecayConfig;
  
  /** How much to weight trust scores in vote calculation (0-1) */
  trustScoreWeight: number;
  
  /** How much to weight participation in vote calculation (0-1) */
  participationWeight: number;
  
  /** How much to weight recency in vote calculation (0-1) */
  recencyWeight: number;
  
  /** How much to weight delegations in vote calculation (0-1) */
  delegationWeight: number;
  
  /** Minimum quorum percentage required (0-1) */
  minimumQuorum: number;
  
  /** Time window (ms) for quorum stability before finalization */
  stabilizationWindowMs: number;
  
  /** How often to recalculate weights (ms) */
  recalculationIntervalMs: number;
  
  /** Whether to auto-finalize proposals after stabilization */
  autoFinalize: boolean;
  
  /** Whether to trigger revotes if quorum flips after finalization */
  enableRevoteOnFlip: boolean;
  
  /** Minimum stability index required to finalize (0-1) */
  minStabilityForFinalization: number;
}

/**
 * Events emitted by the Neural Quorum Engine
 */
export enum NeuralQuorumEvent {
  VOTE_CAST = 'vote_cast',
  VOTE_UPDATED = 'vote_updated',
  WEIGHTS_RECALCULATED = 'weights_recalculated',
  QUORUM_CHANGED = 'quorum_changed',
  QUORUM_FLIPPED = 'quorum_flipped',
  PROPOSAL_FINALIZED = 'proposal_finalized',
  REVOTE_TRIGGERED = 'revote_triggered',
  DELEGATION_CREATED = 'delegation_created',
  DELEGATION_EXPIRED = 'delegation_expired'
}

/**
 * Status of a liquid governance proposal
 */
export enum LiquidProposalStatus {
  /** Open for voting, still evolving */
  ACTIVE = 'active',
  
  /** Quorum reached and stabilized */
  FINALIZED = 'finalized',
  
  /** Quorum never reached within timeframe */
  EXPIRED = 'expired',
  
  /** Quorum flipped, proposal reopened */
  REVOTED = 'revoted',
  
  /** Canceled by creator or admin */
  CANCELED = 'canceled'
}

/**
 * A proposal in the liquid governance system
 */
export interface LiquidProposal {
  /** Unique proposal ID */
  id: ProposalID;
  
  /** Human-readable title */
  title: string;
  
  /** Detailed description */
  description: string;
  
  /** Creator of the proposal */
  createdBy: AgentID;
  
  /** Proposal creation time */
  createdAt: number;
  
  /** When the proposal was last updated */
  updatedAt: number;
  
  /** Current status of the proposal */
  status: LiquidProposalStatus;
  
  /** When the proposal will expire if not finalized */
  expiresAt?: number;
  
  /** When the proposal was finalized */
  finalizedAt?: number;
  
  /** The final decision ('yes' or 'no') */
  finalDecision?: 'yes' | 'no';
  
  /** Minimum quorum required (overrides global setting) */
  customMinimumQuorum?: number;
  
  /** Custom decay configuration (overrides global setting) */
  customDecayConfig?: VoteDecayConfig;
  
  /** Tags or categories */
  tags?: string[];
  
  /** Proposal-specific data */
  data?: Record<string, any>;
  
  /** History of quorum snapshots */
  quorumHistory?: QuorumFlowSnapshot[];
} 