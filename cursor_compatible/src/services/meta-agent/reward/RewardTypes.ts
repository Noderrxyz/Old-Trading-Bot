/**
 * Reward Types
 * 
 * Shared types and interfaces for the meta-agent reward system.
 */

/**
 * Trust score provider interface
 */
export interface TrustScoreProvider {
  /**
   * Get the trust score for an agent
   * @param agentId Agent identifier
   * @returns Trust score between 0 and 1
   */
  getAgentTrustScore(agentId: string): Promise<number>;
}

/**
 * Reward event types
 */
export enum RewardEventType {
  CORRECT_PREDICTION = 'correct_prediction',
  CONSENSUS_CONTRIBUTION = 'consensus_contribution',
  MARKET_MAKING = 'market_making',
  NOVEL_INSIGHT = 'novel_insight',
  TIMELY_SIGNAL = 'timely_signal',
  VERIFICATION = 'verification',
  PROPAGATED = 'propagated_reward'
}

/**
 * Reward context containing all necessary information for reward calculation
 */
export interface RewardContext {
  /** Type of reward event */
  eventType: RewardEventType;
  
  /** Timestamp when the event occurred */
  timestamp: number;
  
  /** Target asset for the reward event (if applicable) */
  asset?: string;
  
  /** Score or magnitude of the achievement (0-100) */
  achievementScore?: number;
  
  /** Signal quality score (0-100) if applicable */
  signalQuality?: number;
  
  /** Optional source agent ID if reward is propagated from another agent */
  sourceAgentId?: string;
  
  /** List of voters/verifiers if relevant to verification rewards */
  verifiers?: string[];
  
  /** Any custom data relevant to the specific reward type */
  metadata?: Record<string, any>;
}

/**
 * Reward event - the result of a reward calculation
 */
export interface RewardEvent {
  /** Unique identifier for the reward event */
  id: string;
  
  /** Agent that received the reward */
  agentId: string;
  
  /** Type of reward event */
  eventType: RewardEventType;
  
  /** Base reward amount before multipliers */
  baseAmount: number;
  
  /** Final reward amount after multipliers */
  finalAmount: number;
  
  /** Multipliers applied to the base reward */
  multipliers: RewardMultipliers;
  
  /** Context that triggered the reward */
  context: RewardContext;
  
  /** When the reward was calculated */
  timestamp: number;
  
  /** Optional source agent if propagated */
  sourceAgentId?: string;
  
  /** Trust score impact from this reward */
  trustScoreImpact?: number;
  
  /** Asset involved (if applicable) */
  asset?: string;
}

/**
 * Reward multipliers applied during calculation
 */
export interface RewardMultipliers {
  /** Streak multiplier for consistent performance */
  streak: number;
  
  /** Trust score multiplier */
  trust: number;
  
  /** Time decay factor */
  decay: number;
  
  /** Asset importance multiplier */
  assetImportance: number;
  
  /** Signal quality multiplier */
  signalQuality: number;
  
  /** Human verification multiplier */
  humanVerification: number;
  
  /** Cross-verification multiplier */
  crossVerification: number;
  
  /** Other custom multipliers */
  [key: string]: number;
}

/**
 * Reward streak information
 */
export interface RewardStreak {
  /** Number of consecutive successful events */
  count: number;
  
  /** Event type of the streak */
  eventType: RewardEventType;
  
  /** Last update timestamp */
  lastUpdated: number;
  
  /** Asset if streak is asset-specific */
  asset?: string;
}

/**
 * Map of agent IDs to their influence scores
 */
export type AgentInfluenceMap = Map<string, number>;

/**
 * Configuration for reward propagation
 */
export interface PropagationConfig {
  /** Maximum propagation depth */
  maxDepth: number;
  
  /** Decay factor per level */
  decayFactor: number;
  
  /** Minimum influence threshold to propagate */
  minInfluence: number;
  
  /** Maximum agents to propagate to per level */
  maxAgentsPerLevel: number;
}

/**
 * Dependencies required by reward components
 */
export interface RewardDependencies {
  /** Redis service for data persistence */
  redisService: any;
  
  /** Event emitter for publishing events */
  eventEmitter: any;
  
  /** Trust score provider */
  trustScoreProvider: TrustScoreProvider;
  
  /** Agent influence service */
  agentInfluenceService?: any;
}

/**
 * Result of a reward calculation
 */
export interface RewardResult {
  /** The calculated reward event */
  event: RewardEvent | null;
  
  /** Trust score impact */
  trustScoreImpact: number;
  
  /** Success flag */
  success: boolean;
  
  /** Error message if calculation failed */
  error?: string;
}

/**
 * Event emitted when a reward is calculated
 */
export interface RewardCalculatedEvent {
  /** The reward event */
  reward: RewardEvent;
  
  /** Original agent ID */
  agentId: string;
  
  /** Trust score impact */
  trustScoreImpact: number;
  
  /** Timestamp when calculated */
  timestamp: number;
}

/**
 * Base configuration for the reward system
 */
export interface RewardConfig {
  /** Base reward amounts by event type */
  baseRewards: Record<RewardEventType, number>;
  
  /** Maximum rewards per day by event type */
  maxRewardsPerDay: Record<RewardEventType, number>;
  
  /** Maximum streak multiplier */
  maxStreakMultiplier: number;
  
  /** Trust score multiplier factor */
  trustScoreMultiplierFactor: number;
  
  /** Time decay configuration */
  decay: {
    /** Decay half-life in hours */
    halfLifeHours: number;
    /** Minimum decay factor */
    minimum: number;
  };
  
  /** Propagation configuration */
  propagation: PropagationConfig;
} 