/**
 * Reward Calculator
 * 
 * Calculates rewards for agent activities including multipliers,
 * streaks, and trust-based adjustments.
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  RewardContext, 
  RewardEvent, 
  RewardEventType, 
  RewardMultipliers,
  RewardStreak,
  RewardResult,
  RewardConfig,
  TrustScoreProvider
} from './RewardTypes.js';

/**
 * Default reward configuration
 */
const DEFAULT_CONFIG: RewardConfig = {
  baseRewards: {
    [RewardEventType.CORRECT_PREDICTION]: 25,
    [RewardEventType.CONSENSUS_CONTRIBUTION]: 15,
    [RewardEventType.MARKET_MAKING]: 10,
    [RewardEventType.NOVEL_INSIGHT]: 30,
    [RewardEventType.TIMELY_SIGNAL]: 20,
    [RewardEventType.VERIFICATION]: 15,
    [RewardEventType.PROPAGATED]: 5
  },
  maxRewardsPerDay: {
    [RewardEventType.CORRECT_PREDICTION]: 100,
    [RewardEventType.CONSENSUS_CONTRIBUTION]: 75,
    [RewardEventType.MARKET_MAKING]: 50,
    [RewardEventType.NOVEL_INSIGHT]: 90,
    [RewardEventType.TIMELY_SIGNAL]: 80,
    [RewardEventType.VERIFICATION]: 60,
    [RewardEventType.PROPAGATED]: 30
  },
  maxStreakMultiplier: 3.0,
  trustScoreMultiplierFactor: 1.5,
  decay: {
    halfLifeHours: 24,
    minimum: 0.1
  },
  propagation: {
    maxDepth: 3,
    decayFactor: 0.5,
    minInfluence: 0.1,
    maxAgentsPerLevel: 5
  }
};

/**
 * Calculates rewards for agent activities
 */
export class RewardCalculator {
  private config: RewardConfig;
  private trustScoreProvider: TrustScoreProvider;
  private assetImportanceCache: Map<string, number> = new Map();
  
  /**
   * Create a new RewardCalculator
   * 
   * @param trustScoreProvider Provider for agent trust scores
   * @param config Custom reward configuration (optional)
   */
  constructor(trustScoreProvider: TrustScoreProvider, config?: Partial<RewardConfig>) {
    this.trustScoreProvider = trustScoreProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Calculate a reward for an agent based on the given context
   * 
   * @param agentId Agent ID receiving the reward
   * @param context Reward context with event details
   * @param streaks Optional agent's current streaks
   * @returns Reward calculation result
   */
  async calculate(
    agentId: string, 
    context: RewardContext, 
    streaks: RewardStreak[] = []
  ): Promise<RewardResult> {
    try {
      // Get base reward amount
      const baseAmount = this.getBaseReward(context.eventType);
      
      // Calculate multipliers
      const multipliers = await this.calculateMultipliers(agentId, context, streaks);
      
      // Calculate final reward amount
      const finalAmount = this.applyMultipliers(baseAmount, multipliers);
      
      // Create reward event
      const event: RewardEvent = {
        id: uuidv4(),
        agentId,
        eventType: context.eventType,
        baseAmount,
        finalAmount,
        multipliers,
        context,
        timestamp: Date.now(),
        sourceAgentId: context.sourceAgentId,
        asset: context.asset
      };
      
      // Calculate trust impact
      const trustScoreImpact = this.calculateTrustImpact(finalAmount, context.eventType);
      event.trustScoreImpact = trustScoreImpact;
      
      return {
        event,
        trustScoreImpact,
        success: true
      };
    } catch (error) {
      return {
        event: null,
        trustScoreImpact: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Apply all multipliers to a base reward amount
   * 
   * @param baseAmount Base reward amount
   * @param multipliers Multipliers to apply
   * @returns Final reward amount
   */
  private applyMultipliers(baseAmount: number, multipliers: RewardMultipliers): number {
    // Calculate combined multiplier
    const combinedMultiplier = Object.values(multipliers).reduce((acc, mult) => acc * mult, 1);
    
    // Apply to base amount and round to 2 decimal places
    return Math.round(baseAmount * combinedMultiplier * 100) / 100;
  }
  
  /**
   * Calculate all applicable multipliers for a reward
   * 
   * @param agentId Agent ID
   * @param context Reward context
   * @param streaks Agent's current streaks
   * @returns Calculated multipliers
   */
  private async calculateMultipliers(
    agentId: string, 
    context: RewardContext, 
    streaks: RewardStreak[]
  ): Promise<RewardMultipliers> {
    // Initialize with default multipliers
    const multipliers: RewardMultipliers = {
      streak: 1.0,
      trust: 1.0,
      decay: 1.0,
      assetImportance: 1.0,
      signalQuality: 1.0,
      humanVerification: 1.0,
      crossVerification: 1.0
    };
    
    // Apply streak multiplier if applicable
    multipliers.streak = this.calculateStreakMultiplier(context, streaks);
    
    // Apply trust score multiplier
    multipliers.trust = await this.calculateTrustMultiplier(agentId);
    
    // Apply time decay if applicable
    multipliers.decay = this.calculateDecayFactor(context.timestamp);
    
    // Apply asset importance multiplier if applicable
    if (context.asset) {
      multipliers.assetImportance = await this.getAssetImportance(context.asset);
    }
    
    // Apply signal quality multiplier if provided
    if (context.signalQuality) {
      multipliers.signalQuality = 0.5 + (0.01 * context.signalQuality);
    }
    
    // Apply human verification multiplier if applicable
    if (context.metadata?.humanVerified === true) {
      multipliers.humanVerification = 1.5;
    }
    
    // Apply cross-verification multiplier based on verifier count
    if (context.verifiers?.length) {
      // More verifiers = higher multiplier, capped at 2.0
      multipliers.crossVerification = Math.min(1 + (context.verifiers.length * 0.1), 2.0);
    }
    
    return multipliers;
  }
  
  /**
   * Calculate streak multiplier based on agent's streaks
   * 
   * @param context Reward context
   * @param streaks Agent's current streaks
   * @returns Streak multiplier
   */
  private calculateStreakMultiplier(context: RewardContext, streaks: RewardStreak[]): number {
    // Find matching streak for this event type
    const matchingStreak = streaks.find(streak => 
      streak.eventType === context.eventType &&
      (!streak.asset || streak.asset === context.asset)
    );
    
    if (!matchingStreak) {
      return 1.0; // No streak
    }
    
    // Calculate streak multiplier (increases with streak count, capped at max)
    const streakMultiplier = 1 + (Math.min(matchingStreak.count, 10) * 0.2);
    return Math.min(streakMultiplier, this.config.maxStreakMultiplier);
  }
  
  /**
   * Calculate trust score multiplier for an agent
   * 
   * @param agentId Agent ID
   * @returns Trust multiplier
   */
  private async calculateTrustMultiplier(agentId: string): Promise<number> {
    try {
      // Get agent's trust score (0-1 range)
      const trustScore = await this.trustScoreProvider.getAgentTrustScore(agentId);
      
      // Scale trust score to multiplier (e.g., 0.5-1.5 range)
      const factor = this.config.trustScoreMultiplierFactor;
      return 1 + ((trustScore - 0.5) * factor);
    } catch (error) {
      // Default to neutral multiplier (1.0) on error
      console.error(`Error getting trust score for ${agentId}:`, error);
      return 1.0;
    }
  }
  
  /**
   * Calculate time decay factor based on event timestamp
   * 
   * @param timestamp Event timestamp
   * @returns Decay factor multiplier
   */
  private calculateDecayFactor(timestamp: number): number {
    // Calculate hours elapsed since the event
    const now = Date.now();
    const hoursElapsed = (now - timestamp) / (1000 * 60 * 60);
    
    // No decay for recent events
    if (hoursElapsed <= 0) {
      return 1.0;
    }
    
    // Apply exponential decay
    const halfLife = this.config.decay.halfLifeHours;
    const decayFactor = Math.pow(0.5, hoursElapsed / halfLife);
    
    // Ensure decay doesn't go below minimum
    return Math.max(decayFactor, this.config.decay.minimum);
  }
  
  /**
   * Get asset importance multiplier
   * 
   * @param asset Asset symbol
   * @returns Asset importance multiplier
   */
  private async getAssetImportance(asset: string): Promise<number> {
    // Check cache first
    if (this.assetImportanceCache.has(asset)) {
      return this.assetImportanceCache.get(asset) || 1.0;
    }
    
    // In a real implementation, this would query external data sources
    // For now, use a simple mapping with some defaults
    const importanceMap: Record<string, number> = {
      'BTC': 1.5,
      'ETH': 1.4,
      'SOL': 1.3,
      'USDT': 1.1,
      'USDC': 1.1
    };
    
    const importance = importanceMap[asset] || 1.0;
    
    // Cache the result
    this.assetImportanceCache.set(asset, importance);
    
    return importance;
  }
  
  /**
   * Get base reward amount for an event type
   * 
   * @param eventType Type of reward event
   * @returns Base reward amount
   */
  private getBaseReward(eventType: RewardEventType): number {
    return this.config.baseRewards[eventType] || 10; // Default to 10 if not specified
  }
  
  /**
   * Calculate trust score impact from a reward
   * 
   * @param rewardAmount Final reward amount
   * @param eventType Type of reward event
   * @returns Trust score impact (0-1 scale)
   */
  private calculateTrustImpact(rewardAmount: number, eventType: RewardEventType): number {
    // Different event types have different trust impacts
    const trustImpactFactors: Record<RewardEventType, number> = {
      [RewardEventType.CORRECT_PREDICTION]: 0.01,
      [RewardEventType.CONSENSUS_CONTRIBUTION]: 0.005,
      [RewardEventType.MARKET_MAKING]: 0.002,
      [RewardEventType.NOVEL_INSIGHT]: 0.015,
      [RewardEventType.TIMELY_SIGNAL]: 0.008,
      [RewardEventType.VERIFICATION]: 0.003,
      [RewardEventType.PROPAGATED]: 0.001
    };
    
    const factor = trustImpactFactors[eventType] || 0.005;
    
    // Scale reward amount to trust impact and cap at reasonable values
    return Math.min(rewardAmount * factor, 0.05);
  }
} 