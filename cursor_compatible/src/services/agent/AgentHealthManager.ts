/**
 * Agent Health Manager
 * 
 * Manages agent self-healing behaviors based on trust scores.
 * This service adjusts agent behavior when in self-healing mode
 * to help agents recover trust through improved performance.
 */

import { TrustScoreService } from './TrustScoreService.js';
import { RedisService } from '../infrastructure/RedisService.js';
import { AgentHealthMode } from '../../types/agent.types.js';

export interface HealthAdjustment {
  // Multiplier to reduce signal frequency (0-1)
  signalThrottleMultiplier: number;
  
  // Minimum confidence threshold for emitting signals
  minConfidenceThreshold: number;
  
  // Whether the agent is completely suppressed
  isSuppressed: boolean;
  
  // Recovery boost percentage (added to successful actions)
  recoveryBoost: number;
}

export class AgentHealthManager {
  // Minimum time in self-healing mode (15 minutes)
  private readonly MIN_HEALING_TIME_MS = 15 * 60 * 1000;
  
  // Minimum successful operations for recovery consideration
  private readonly MIN_SUCCESS_COUNT = 5;
  
  constructor(
    private readonly trustService: TrustScoreService,
    private readonly redis: RedisService
  ) {}
  
  /**
   * Get behavior adjustments based on agent's health mode
   * @param agentId Agent identifier
   * @returns Health adjustment parameters
   */
  async getHealthAdjustments(agentId: string): Promise<HealthAdjustment> {
    const trustState = await this.trustService.getTrustState(agentId);
    
    switch (trustState.mode) {
      case AgentHealthMode.SELF_HEALING:
        return {
          signalThrottleMultiplier: 0.5, // Reduce signal frequency by half
          minConfidenceThreshold: 0.85, // Only emit high-confidence signals
          isSuppressed: false,
          recoveryBoost: 2.0 // Boost successful actions by 2x
        };
        
      case AgentHealthMode.CRITICAL:
        return {
          signalThrottleMultiplier: 0.1, // Severely reduce signals
          minConfidenceThreshold: 0.95, // Only emit extremely high-confidence signals
          isSuppressed: true, // Suppress all output
          recoveryBoost: 3.0 // Greater boost for successful actions when allowed
        };
        
      case AgentHealthMode.NORMAL:
      default:
        return {
          signalThrottleMultiplier: 1.0, // Normal operation
          minConfidenceThreshold: 0.5, // Regular confidence threshold
          isSuppressed: false,
          recoveryBoost: 1.0 // No recovery boost
        };
    }
  }
  
  /**
   * Record a successful operation for an agent in self-healing mode
   * @param agentId Agent identifier
   * @returns Updated trust score
   */
  async recordHealingSuccess(agentId: string): Promise<number> {
    const trustState = await this.trustService.getTrustState(agentId);
    
    // Only apply healing boost for agents in self-healing mode
    if (trustState.mode !== AgentHealthMode.SELF_HEALING) {
      return trustState.score;
    }
    
    // Get healing adjustment
    const adjustment = await this.getHealthAdjustments(agentId);
    
    // Increment success counter
    const metaKey = `agent:${agentId}:trust_meta`;
    const successCountRaw = await this.redis.hget(metaKey, 'healing_success_count');
    const successCount = successCountRaw ? parseInt(successCountRaw) : 0;
    await this.redis.hset(metaKey, 'healing_success_count', (successCount + 1).toString());
    
    // Apply trust boost with recovery multiplier
    const boost = 0.5 * adjustment.recoveryBoost; // Base boost of 0.5 points * recovery multiplier
    const newScore = await this.trustService.adjustScore(agentId, boost);
    
    // Check if agent can exit self-healing mode
    await this.checkRecoveryEligibility(agentId, successCount + 1);
    
    return newScore;
  }
  
  /**
   * Check if agent is eligible to exit self-healing mode
   * @param agentId Agent identifier
   * @param successCount Current success count
   */
  private async checkRecoveryEligibility(agentId: string, successCount: number): Promise<void> {
    const trustState = await this.trustService.getTrustState(agentId);
    
    // Only check recovery for agents in self-healing mode
    if (trustState.mode !== AgentHealthMode.SELF_HEALING) {
      return;
    }
    
    // Check time in self-healing mode
    const healingTimeMs = trustState.enteredSelfHealingAt 
      ? Date.now() - trustState.enteredSelfHealingAt 
      : 0;
    
    // Check if agent meets recovery criteria:
    // 1. Score back above healing threshold
    // 2. Minimum time in self-healing mode
    // 3. Minimum successful operations
    if (
      trustState.score >= this.trustService['HEALING_THRESHOLD'] &&
      healingTimeMs >= this.MIN_HEALING_TIME_MS &&
      successCount >= this.MIN_SUCCESS_COUNT
    ) {
      // Reset healing metadata
      const metaKey = `agent:${agentId}:trust_meta`;
      await this.redis.hdel(metaKey, 'enteredSelfHealingAt', 'healing_success_count');
      
      // Log recovery
      console.log(`Agent ${agentId} has met recovery criteria and exited self-healing mode`);
      
      // Apply small recovery bonus
      await this.trustService.adjustScore(agentId, 2);
    }
  }
  
  /**
   * Record a failed operation for an agent
   * @param agentId Agent identifier
   * @param severity How severe the failure was (0-1)
   * @returns Updated trust score
   */
  async recordFailure(agentId: string, severity: number = 0.5): Promise<number> {
    const trustState = await this.trustService.getTrustState(agentId);
    
    // Calculate penalty based on severity and current mode
    let penalty = -1 * severity;
    
    // Increased penalties in self-healing mode
    if (trustState.mode === AgentHealthMode.SELF_HEALING) {
      penalty *= 1.5; // 50% greater penalties while healing
    }
    
    // Apply trust penalty
    return await this.trustService.adjustScore(agentId, penalty);
  }
} 