/**
 * Reward Propagator Service
 * 
 * Handles propagation of rewards through the agent influence network.
 */

import Logger from '../../../utils/logger.js';
import type { ReinforcementEvent, ReinforcementLog } from '../ReinforcementLog.js';
import type { PropagationConfig, IRewardPropagator } from './types.js';

export class RewardPropagator implements IRewardPropagator {
  private logger: Logger;
  private defaultConfig: PropagationConfig = {
    decayFactor: 0.85,
    maxDepth: 3,
    minWeightThreshold: 0.01,
    reasonPrefix: 'propagated',
    maxBreadth: 5
  };
  private config: PropagationConfig;

  /**
   * Create a new RewardPropagator
   * 
   * @param log The reinforcement log tracking agent interactions
   * @param config Propagation configuration
   */
  constructor(
    private log: ReinforcementLog,
    config: Partial<PropagationConfig> = {}
  ) {
    this.logger = Logger.getInstance('RewardPropagator');
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Propagate a reward through the influence network
   * 
   * @param initial The initial reinforcement event to propagate from
   */
  public propagate(initial: ReinforcementEvent): void {
    if (!initial || !initial.targetAgent) {
      this.logger.warn('Cannot propagate from invalid event');
      return;
    }
    
    try {
      this._propagateRecursively(
        initial.targetAgent, 
        initial.weight, 
        initial.reason, 
        0, 
        new Set([initial.sourceAgent, initial.targetAgent])
      );
    } catch (err) {
      this.logger.error('Error propagating reward:', err);
    }
  }

  /**
   * Update the propagation configuration
   * 
   * @param config New propagation configuration
   */
  public updateConfig(config: Partial<PropagationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current propagation configuration
   * 
   * @returns The current configuration
   */
  public getConfig(): PropagationConfig {
    return { ...this.config };
  }

  /**
   * Internal recursive method to propagate rewards
   */
  private _propagateRecursively(
    agentId: string,
    weight: number,
    reason: string,
    depth: number,
    visited: Set<string>
  ): void {
    // Check termination conditions
    if (
      depth >= this.config.maxDepth || 
      weight < (this.config.minWeightThreshold || 0.01) ||
      visited.has(agentId)
    ) {
      return;
    }

    // Get the graph from the reinforcement log
    const graph = this.log.toGraph();
    
    // Find all influencers of the current agent
    const influencers = graph.getInfluencers(agentId);
    
    // Sort by weight (descending) and limit to maxBreadth
    const sortedInfluencers = [...influencers]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, this.config.maxBreadth || 5);
    
    for (const influencer of sortedInfluencers) {
      // Skip if the influencer is already in the propagation path
      if (visited.has(influencer.agentId)) continue;
      
      // Calculate the propagated weight
      const propagatedWeight = weight * this.config.decayFactor;
      
      // Create a new reason with prefix
      const prefix = this.config.reasonPrefix || 'propagated';
      const newReason = `${prefix}: ${reason}`;

      // Create a propagated reinforcement event
      const propagatedEvent = this.log.record({
        sourceAgent: agentId,
        targetAgent: influencer.agentId,
        reason: newReason,
        weight: propagatedWeight,
        decayTTL: 7 * 24 * 60 * 60 * 1000, // 1 week by default
        tags: ['propagated']
      });
      
      // Log the propagation
      this.logger.debug(
        `Propagated reward: ${agentId} → ${influencer.agentId} (+${propagatedWeight.toFixed(3)}) [${newReason}]`
      );

      // Continue propagation to the next level
      // Create a new copy of visited to avoid cross-branch contamination
      const newVisited = new Set(visited);
      newVisited.add(influencer.agentId);
      
      this._propagateRecursively(
        influencer.agentId,
        propagatedWeight,
        newReason,
        depth + 1,
        newVisited
      );
    }
  }
} 