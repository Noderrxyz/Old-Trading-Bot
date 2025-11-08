/**
 * Meta-Reward Rules Configuration
 * 
 * This file defines the reward vectors and weightings for agent behaviors
 * that earn meta-rewards in the AI trading ecosystem.
 */

/**
 * Meta-Reward Rule Interface
 */
export interface MetaRewardRule {
  id: string;              // Unique identifier for the reward rule
  label: string;           // Human-readable label
  description: string;     // Detailed description
  weight: number;          // Base points value
  decayHalfLifeHours: number; // How quickly rewards decay (half-life in hours)
  appliesToRoles?: string[]; // Optional array of agent roles this reward applies to
  triggerType: 'event' | 'metric' | 'manual'; // How the reward is triggered
  triggerKey: string;      // Event name or metric key that triggers the reward
  trustScoreDelta?: number; // Optional impact on trust score
  cooldownHours?: number;  // Optional cooldown period in hours
  tags?: string[];         // Optional tags for categorizing rewards
}

/**
 * Meta-Reward Rules
 */
export const META_REWARD_RULES: MetaRewardRule[] = [
  {
    id: 'correct_prediction',
    label: 'Correct Prediction',
    description: 'Agent made a correct market prediction with high confidence.',
    weight: 25,
    decayHalfLifeHours: 168, // 7 days
    triggerType: 'event',
    triggerKey: 'agent:prediction:correct',
    trustScoreDelta: 0.002,
    tags: ['prediction', 'accuracy']
  },
  {
    id: 'accurate_analysis',
    label: 'Accurate Analysis',
    description: 'Agent provided market analysis that was verified as accurate.',
    weight: 20,
    decayHalfLifeHours: 144, // 6 days
    triggerType: 'event',
    triggerKey: 'agent:analysis:accurate',
    tags: ['analysis', 'accuracy']
  },
  {
    id: 'data_contribution',
    label: 'Data Contribution',
    description: 'Agent contributed valuable data or insights to the collective knowledge base.',
    weight: 15,
    decayHalfLifeHours: 120, // 5 days
    triggerType: 'event',
    triggerKey: 'agent:data:contribution',
    tags: ['data', 'collaboration']
  },
  {
    id: 'reinforcement_vote',
    label: 'Reinforcement Vote',
    description: 'Agent voted to reinforce another agent\'s insight.',
    weight: 10,
    decayHalfLifeHours: 72, // 3 days
    triggerType: 'event',
    triggerKey: 'agent:reinforcement:vote',
    cooldownHours: 6,
    tags: ['reinforcement', 'collaboration']
  },
  {
    id: 'signal_verification',
    label: 'Signal Verification',
    description: 'Agent verified trading signals or identified market anomalies.',
    weight: 15,
    decayHalfLifeHours: 96, // 4 days
    triggerType: 'event',
    triggerKey: 'agent:signal:verification',
    trustScoreDelta: 0.001,
    tags: ['verification', 'signals']
  },
  {
    id: 'strategy_outperformance',
    label: 'Strategy Outperformance',
    description: 'Agent\'s model outperformed peers over rolling window.',
    weight: 30,
    decayHalfLifeHours: 240, // 10 days
    triggerType: 'metric',
    triggerKey: 'metrics:strategy:outperformance',
    trustScoreDelta: 0.003,
    tags: ['performance', 'strategy']
  },
  {
    id: 'consensus_alignment',
    label: 'Consensus Alignment',
    description: 'Agent\'s signals consistently align with trusted consensus.',
    weight: 15,
    decayHalfLifeHours: 120, // 5 days
    triggerType: 'metric',
    triggerKey: 'metrics:consensus:alignment',
    tags: ['consensus', 'alignment']
  },
  {
    id: 'early_detection',
    label: 'Early Signal Detection',
    description: 'Agent detected market signals earlier than most others.',
    weight: 25,
    decayHalfLifeHours: 168, // 7 days
    triggerType: 'metric',
    triggerKey: 'metrics:signal:early_detection',
    trustScoreDelta: 0.002,
    tags: ['detection', 'timeliness']
  },
  {
    id: 'human_commendation',
    label: 'Human Commendation',
    description: 'Agent received positive feedback from human operators.',
    weight: 35,
    decayHalfLifeHours: 336, // 14 days
    triggerType: 'manual',
    triggerKey: 'manual:human:commendation',
    trustScoreDelta: 0.005,
    tags: ['human', 'feedback']
  }
];

/**
 * Meta-Reward System Configuration
 */
export const META_REWARD_CONFIG = {
  // Trust thresholds
  minimumTrustToReceiveRewards: 0.3,
  minimumTrustToGrantRewards: 0.5,
  
  // Reward effects
  trustScoreMultiplier: 1.0,
  influenceMultiplier: 0.5,
  humanRewardMultiplier: 2.0,
  humanTrustDeltaMultiplier: 1.5,
  
  // Verification
  requireVerificationThreshold: 30, // Points threshold requiring verification
  verificationRequiredCount: 3, // Number of verifications required
  verificationMinimumTrust: 0.6, // Minimum trust to verify rewards
  
  // Cooldowns and caps
  defaultCooldownHours: 24,
  defaultDecayHalfLifeHours: 168, // Default decay half-life (1 week)
  dailyRewardCap: 250, // Maximum rewards per day
  
  // Decay
  rewardDecayRate: 0.995, // Daily decay rate for all rewards (~0.5% per day)
};

/**
 * Memory Injection Configuration for evolved agents
 */
export const MEMORY_INJECTION_CONFIG = {
  // Number of top performing agents to persist
  topN: 5,
  
  // Minimum fitness score threshold for agent persistence
  persistThreshold: 0.85,
  
  // TTL for low-ranking agents (60 days in milliseconds)
  ttlLowRankingMs: 1000 * 60 * 60 * 24 * 60,
  
  // Fitness score threshold for considering an agent high-ranking
  highRankingThreshold: 0.92,
  
  // Minimum consistency score required (number of successful iterations)
  minConsistencyCount: 3,
  
  // Zero violation requirement (requires trust scoring system)
  requireZeroViolations: true,
  
  // Memory entry TTL by performance level (in days)
  ttlDays: {
    exceptional: null, // Null means indefinite storage
    high: 365, // 1 year
    medium: 180, // 6 months
    low: 60 // 2 months
  },
  
  // Memory tags for categorization and retrieval
  memoryTags: ['evolution', 'long_term', 'agent_snapshot'],
  
  // Additional metadata to store with agents
  includeMetadata: ['traits', 'performance_history', 'evolution_path'],
  
  // Redis key prefixes
  redisKeyPrefix: 'agent:memory:longterm',
  
  // Include full strategy snapshots (can be storage intensive)
  includeFullStrategySnapshots: true
};

/**
 * Helper Functions
 */

/**
 * Convert hours to milliseconds
 */
export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

/**
 * Get decay rate in milliseconds
 */
export function getDecayRateMs(rule: MetaRewardRule): number {
  return hoursToMs(rule.decayHalfLifeHours);
}

/**
 * Convert days to milliseconds
 */
export function daysToMs(days: number | null): number | null {
  return days === null ? null : days * 24 * 60 * 60 * 1000;
}

/**
 * Get cooldown period in milliseconds
 */
export function getCooldownMs(rule: MetaRewardRule): number {
  return hoursToMs(rule.cooldownHours || META_REWARD_CONFIG.defaultCooldownHours);
}

/**
 * Find a reward rule by ID
 */
export function findRewardRule(id: string): MetaRewardRule | undefined {
  return META_REWARD_RULES.find(rule => rule.id === id);
} 