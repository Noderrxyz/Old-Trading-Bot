import { ReinforcementLog, ReinforcementEvent } from './ReinforcementLog.js';
import Logger from '../../utils/Logger.js';

/**
 * Configuration for propagating rewards through agent networks
 */
export interface PropagationConfig {
  /** Decay factor for each hop (e.g., 0.85 means next-hop reward is 85% of previous) */
  decayFactor: number;
  
  /** Maximum propagation depth (e.g., 3 hops max) */
  maxDepth: number;
  
  /** Minimum weight threshold to continue propagation */
  minWeightThreshold?: number;
  
  /** Optional prefix for propagated reward reasons */
  reasonPrefix?: string;
  
  /** Maximum propagation breadth at each level */
  maxBreadth?: number;
}

/**
 * RewardPropagator handles cascading rewards through agent networks
 * 
 * This class enables rewards to propagate from one agent to others that have influenced them,
 * creating a natural reinforcement mechanism throughout the system.
 */
export class RewardPropagator {
  private logger: any;
  private defaultConfig: PropagationConfig = {
    decayFactor: 0.85,
    maxDepth: 3,
    minWeightThreshold: 0.01,
    reasonPrefix: 'propagated',
    maxBreadth: 5
  };

  /**
   * Create a new RewardPropagator
   * 
   * @param log The reinforcement log tracking agent interactions
   * @param config Configuration for reward propagation
   */
  constructor(
    private log: ReinforcementLog, 
    private config: Partial<PropagationConfig> = {}
  ) {
    this.logger = Logger.getInstance('RewardPropagator');
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Propagate a reward through the influence network
   * 
   * @param initial The initial reinforcement event to propagate from
   */
  propagate(initial: ReinforcementEvent): void {
    this._propagateRecursive(
      initial.targetAgent, 
      initial.weight, 
      initial.reason, 
      0, 
      new Set([initial.sourceAgent, initial.targetAgent])
    );
  }

  /**
   * Internal recursive method to propagate rewards
   * 
   * @param agentId Current agent ID in the propagation chain
   * @param weight Current weight to propagate
   * @param reason Original reason for the reward
   * @param depth Current propagation depth
   * @param visited Set of already visited agents to prevent loops
   */
  private _propagateRecursive(
    agentId: string,
    weight: number,
    reason: string,
    depth: number,
    visited: Set<string>
  ): void {
    const config = this.config as PropagationConfig;
    
    // Check termination conditions
    if (
      depth >= config.maxDepth || 
      weight < (config.minWeightThreshold || 0.01) ||
      visited.has(agentId)
    ) {
      return;
    }

    // Mark this agent as visited
    visited.add(agentId);

    // Find all agents that influenced the current agent
    const influencers = this.log.getByTargetAgent(agentId);
    
    // Sort by weight (descending) and limit to maxBreadth
    const sortedInfluencers = influencers
      .sort((a, b) => b.weight - a.weight)
      .slice(0, config.maxBreadth || 5);
    
    for (const infl of sortedInfluencers) {
      // Skip if the influencer is already in the propagation path
      if (visited.has(infl.sourceAgent)) continue;
      
      // Calculate the propagated weight
      const propagatedWeight = weight * config.decayFactor;
      
      // Create a new reason with optional prefix
      const prefix = config.reasonPrefix || 'propagated';
      const newReason = `${prefix}: ${reason}`;

      // Create a propagated reinforcement event
      const newEvent: Omit<ReinforcementEvent, 'id' | 'timestamp'> = {
        sourceAgent: agentId,
        targetAgent: infl.sourceAgent,
        reason: newReason,
        weight: propagatedWeight,
        decayTTL: infl.decayTTL,
        tags: ['propagated', ...(infl.tags || [])]
      };

      // Record the propagated reward
      this.log.record(newEvent);
      
      // Log the propagation
      this.logger.debug(
        `[RewardPropagator] ${agentId} ➜ ${infl.sourceAgent} (+${propagatedWeight.toFixed(3)}) [${newReason}]`
      );

      // Continue propagation to the next level
      this._propagateRecursive(
        infl.sourceAgent,
        propagatedWeight,
        newReason,
        depth + 1,
        new Set(visited) // Create a new copy to avoid cross-branch contamination
      );
    }
  }

  /**
   * Update the propagation configuration
   * 
   * @param config New propagation configuration
   */
  updateConfig(config: Partial<PropagationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current propagation configuration
   * 
   * @returns The current configuration
   */
  getConfig(): PropagationConfig {
    return this.config as PropagationConfig;
  }
} 