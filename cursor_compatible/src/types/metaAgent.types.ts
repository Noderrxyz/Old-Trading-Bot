/**
 * Meta-Agent System Types
 * 
 * Type definitions for the meta-agent system, including memory entries,
 * strategy status, and related concepts.
 */

/**
 * Agent memory entry representing a single decision or action taken by the system
 */
export interface AgentMemoryEntry {
  /** Unique identifier for this memory entry */
  id?: string;
  
  /** Timestamp when this memory was created */
  timestamp?: number;
  
  /** ID of the strategy that generated this memory */
  strategyId: string;
  
  /** Asset or symbol this memory relates to */
  asset: string;
  
  /** Type of action or decision taken */
  actionType: 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'EVALUATION' | 'ANALYSIS';
  
  /** Direction of the action (if applicable) */
  direction?: 'LONG' | 'SHORT' | 'NEUTRAL';
  
  /** Description of the action taken */
  action: string;
  
  /** Context at the time of the decision (market state, etc.) */
  context: {
    marketState?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'VOLATILE';
    timeframe?: string;
    indicators?: Record<string, number>;
    externalFactors?: string[];
    [key: string]: any;
  };
  
  /** Serialized feature vector representing the state (for similarity search) */
  stateVector?: number[];
  
  /** Outcome of the action (positive = good, negative = bad) */
  outcome?: number;
  
  /** Size or magnitude of the action */
  magnitude?: number;
  
  /** Regret score - how much the agent regrets this decision */
  regret?: number;
  
  /** Confidence level in the decision (0-1) */
  confidence?: number;
  
  /** Tags for categorization and filtering */
  tags?: string[];
  
  /** Any additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Strategy lifecycle status
 */
export enum StrategyStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  TESTING = 'TESTING',
  DEPRECATED = 'DEPRECATED',
  PENDING_APPROVAL = 'PENDING_APPROVAL'
}

/**
 * Strategy health indicators
 */
export enum StrategyHealth {
  EXCELLENT = 'EXCELLENT',
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  POOR = 'POOR',
  CRITICAL = 'CRITICAL'
}

/**
 * Strategy lifecycle snapshot
 */
export interface StrategyLifecycleSnapshot {
  /** Unique identifier for the strategy */
  id: string;
  
  /** Strategy name */
  name: string;
  
  /** Current status of the strategy */
  status: StrategyStatus;
  
  /** Health assessment of the strategy */
  health: StrategyHealth;
  
  /** Performance metrics */
  metrics: {
    winRate?: number;
    profitFactor?: number;
    sharpe?: number;
    drawdown?: number;
    [key: string]: number | undefined;
  };
  
  /** When the strategy was created */
  createdAt: number;
  
  /** Last time the strategy was updated */
  updatedAt: number;
  
  /** Assets this strategy can trade */
  assets: string[];
  
  /** Configuration parameters */
  parameters: Record<string, any>;
  
  /** Decay rates for various metrics */
  decayRates?: {
    winRate?: number;
    profitFactor?: number;
    [key: string]: number | undefined;
  };
}

/**
 * Reinforcement adjustment parameters for modifying rewards
 */
export interface ReinforcementParameters {
  // Penalty for strategies with high decay rates
  decayPenaltyThreshold: number;
  decayPenaltyFactor: number;
  
  // Penalty for strategies with poor regime match
  regimeMismatchThreshold: number;
  regimeMismatchPenaltyFactor: number;
  
  // Boost for strategies with proven reliability
  trustBoostThreshold: number;
  trustBoostFactor: number;
  
  // Penalty for high drawdown strategies
  drawdownPenaltyThreshold: number;
  drawdownPenaltyFactor: number;
  
  // Scaling factor for overall adjustment
  globalAdjustmentScale: number;
}

/**
 * Meta-agent state for tracking reinforcement learning progress
 */
export interface MetaAgentState {
  // Last pruning operation timestamp
  lastPruneTimestamp: number;
  
  // Number of strategies currently active
  activeStrategies: number;
  
  // Number of strategies pruned
  prunedStrategies: number;
  
  // Total memory entries stored
  memorySize: number;
  
  // Global performance metrics
  globalMetrics: {
    averageSharpe: number;
    averageDecayRate: number;
    explorationRate: number;
  };
  
  // Last update timestamp
  lastUpdated: number;
}

/**
 * Types for Meta-Reward Engine
 */

/**
 * Source of a reward event
 */
export enum RewardSource {
  SYSTEM = 'system',           // Automatic reward from system
  AGENT = 'agent',             // From another agent
  SELF = 'self',               // Self-identified by the agent
  VERIFIED = 'verified',       // Verified by other agents/system
  HUMAN = 'human'              // Human operator
}

/**
 * Meta-reward event structure
 */
export interface MetaRewardEvent {
  // Unique ID for the reward event
  id: string;
  
  // ID of the reward vector from configuration
  vectorId: string;
  
  // Recipient agent ID
  recipientAgentId: string;
  
  // Source agent ID (if from an agent)
  sourceAgentId?: string;
  
  // Source type of the reward
  source: RewardSource;
  
  // Raw reward value
  value: number;
  
  // Adjusted value after applying weights and multipliers
  adjustedValue: number;
  
  // Reason/context for the reward
  reason: string;
  
  // Associated data (e.g., signal ID, strategy ID)
  context?: Record<string, any>;
  
  // Timestamp when the reward was granted
  timestamp: number;
  
  // Decay half-life in milliseconds
  decayHalfLifeMs: number;
  
  // Whether this reward has been verified
  verified: boolean;
  
  // Who verified the reward
  verifiedBy?: string;
  
  // Verification timestamp
  verificationTimestamp?: number;
}

/**
 * Represents a pending verification for a reward that requires it
 */
export interface RewardVerificationRequest {
  // Verification request ID
  id: string;
  
  // The reward event to verify
  rewardEvent: MetaRewardEvent;
  
  // Status of the verification
  status: 'pending' | 'approved' | 'rejected';
  
  // Agents that have voted on this verification
  votes: {
    agentId: string;
    vote: 'approve' | 'reject';
    timestamp: number;
    reason?: string;
  }[];
  
  // Creation timestamp
  createdAt: number;
  
  // Resolution timestamp (when approved/rejected)
  resolvedAt?: number;
}

/**
 * Represents a vote to reinforce another agent's insight or decision
 */
export interface ReinforcementVote {
  // Vote ID
  id: string;
  
  // Agent casting the vote
  sourceAgentId: string;
  
  // Agent receiving the reinforcement
  targetAgentId: string;
  
  // Associated context (e.g., signal, strategy, or insight)
  contextType: 'signal' | 'strategy' | 'insight' | 'decision';
  
  // ID of the context object
  contextId: string;
  
  // Vote strength (based on source agent's trust & influence)
  strength: number;
  
  // Vote timestamp
  timestamp: number;
  
  // Vote expiration
  expiresAt: number;
  
  // Reason for reinforcement
  reason: string;
}

/**
 * Agent influence score and metadata
 */
export interface AgentInfluence {
  // Agent ID
  agentId: string;
  
  // Base influence score
  baseScore: number;
  
  // Current active boost multiplier
  boostMultiplier: number;
  
  // Timestamp when the boost expires (if any)
  boostExpiresAt?: number;
  
  // Current effective influence
  effectiveInfluence: number;
  
  // Last calculation timestamp
  lastCalculated: number;
  
  // Historical influence data points
  history?: {
    timestamp: number;
    influence: number;
  }[];
} 