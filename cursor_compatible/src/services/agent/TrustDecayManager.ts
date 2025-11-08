/**
 * Trust Decay Manager
 * 
 * Manages the decay and slashing of agent trust scores over time,
 * based on performance, behavior, and other factors.
 */

import { TrustScoreService } from './TrustScoreService.js';
import { RedisService } from '../infrastructure/RedisService.js';

/**
 * Trust decay configuration
 */
export interface TrustDecayConfig {
  // Base rate at which trust decays over time (points per day)
  baseDailyDecayRate: number;
  
  // Multiplier for high-trust agents (over 80)
  highTrustDecayMultiplier: number;
  
  // Multiplier for low-trust agents (under 30)
  lowTrustDecayMultiplier: number;
  
  // Minimum trust level that can be reached through decay
  minimumDecayLevel: number;
  
  // Amount of time in milliseconds between decay operations
  decayIntervalMs: number;
}

/**
 * Slashing configuration for trust violations
 */
export interface TrustSlashingConfig {
  // Trust points deducted for minor violations
  minorViolationPenalty: number;
  
  // Trust points deducted for moderate violations
  moderateViolationPenalty: number;
  
  // Trust points deducted for severe violations
  severeViolationPenalty: number;
}

/**
 * Trust violation severity levels
 */
export enum ViolationSeverity {
  MINOR = 'MINOR',
  MODERATE = 'MODERATE',
  SEVERE = 'SEVERE'
}

/**
 * Trust decay manager
 */
export class TrustDecayManager {
  private decayConfig: TrustDecayConfig;
  private slashingConfig: TrustSlashingConfig;
  private decayInterval: NodeJS.Timeout | null = null;
  
  constructor(
    private readonly trustService: TrustScoreService,
    private readonly redis: RedisService,
    config?: Partial<TrustDecayConfig & TrustSlashingConfig>
  ) {
    // Default decay configuration
    this.decayConfig = {
      baseDailyDecayRate: 1.0,         // 1 point per day
      highTrustDecayMultiplier: 1.5,   // High trust decays faster
      lowTrustDecayMultiplier: 0.5,    // Low trust decays slower
      minimumDecayLevel: 30,           // Decay won't reduce below 30
      decayIntervalMs: 24 * 60 * 60 * 1000, // Daily
      ...config
    };
    
    // Default slashing configuration
    this.slashingConfig = {
      minorViolationPenalty: 5,
      moderateViolationPenalty: 15,
      severeViolationPenalty: 30,
      ...config
    };
  }
  
  /**
   * Start the trust decay process
   */
  start(): void {
    if (this.decayInterval) {
      return; // Already started
    }
    
    // Schedule periodic trust decay
    this.decayInterval = setInterval(
      () => this.runDecayProcess(), 
      this.decayConfig.decayIntervalMs
    );
    
    console.log(`Trust decay process started with interval of ${this.decayConfig.decayIntervalMs}ms`);
  }
  
  /**
   * Stop the trust decay process
   */
  stop(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
      console.log('Trust decay process stopped');
    }
  }
  
  /**
   * Process trust decay for all agents
   */
  async runDecayProcess(): Promise<void> {
    try {
      // Get all agent IDs with trust scores
      const agentIds = await this.getAllAgentsWithTrustScores();
      console.log(`Running trust decay for ${agentIds.length} agents`);
      
      // Process each agent
      for (const agentId of agentIds) {
        await this.decayAgentTrust(agentId);
      }
      
      console.log('Trust decay process completed');
    } catch (error) {
      console.error('Error in trust decay process:', error);
    }
  }
  
  /**
   * Get all agent IDs that have trust scores
   */
  private async getAllAgentsWithTrustScores(): Promise<string[]> {
    // Get all keys matching the trust score pattern
    const keys = await this.redis.keys('agent:*:trust_score');
    
    // Extract agent IDs from keys
    return keys.map((key: string) => {
      const parts = key.split(':');
      return parts[1]; // agent ID is the second part of the key
    });
  }
  
  /**
   * Decay the trust score for a specific agent
   * @param agentId Agent identifier
   */
  private async decayAgentTrust(agentId: string): Promise<void> {
    const currentScore = await this.trustService.getScore(agentId);
    
    // Skip decay if already at or below minimum
    if (currentScore <= this.decayConfig.minimumDecayLevel) {
      return;
    }
    
    // Calculate decay rate based on current trust level
    let decayRate = this.decayConfig.baseDailyDecayRate;
    
    // Adjust based on trust level
    if (currentScore >= 80) {
      decayRate *= this.decayConfig.highTrustDecayMultiplier;
    } else if (currentScore <= 30) {
      decayRate *= this.decayConfig.lowTrustDecayMultiplier;
    }
    
    // Apply decay but don't go below minimum
    const newScore = Math.max(
      this.decayConfig.minimumDecayLevel,
      currentScore - decayRate
    );
    
    if (newScore < currentScore) {
      await this.trustService.updateScore(agentId, newScore);
      console.log(`Decayed trust for agent ${agentId}: ${currentScore} -> ${newScore}`);
    }
  }
  
  /**
   * Slash an agent's trust score for a violation
   * @param agentId Agent identifier
   * @param severity Violation severity
   * @param reason Reason for the slashing
   */
  async slashTrust(
    agentId: string, 
    severity: ViolationSeverity, 
    reason: string
  ): Promise<number> {
    const currentScore = await this.trustService.getScore(agentId);
    
    // Determine penalty amount
    let penalty: number;
    switch (severity) {
      case ViolationSeverity.MINOR:
        penalty = this.slashingConfig.minorViolationPenalty;
        break;
      case ViolationSeverity.MODERATE:
        penalty = this.slashingConfig.moderateViolationPenalty;
        break;
      case ViolationSeverity.SEVERE:
        penalty = this.slashingConfig.severeViolationPenalty;
        break;
      default:
        penalty = this.slashingConfig.minorViolationPenalty;
    }
    
    // Apply penalty
    const newScore = Math.max(0, currentScore - penalty);
    await this.trustService.updateScore(agentId, newScore);
    
    // Record the slashing event
    await this.recordSlashingEvent(agentId, severity, reason, penalty, currentScore, newScore);
    
    console.log(`Slashed trust for agent ${agentId} (${severity}): ${currentScore} -> ${newScore}, Reason: ${reason}`);
    
    return newScore;
  }
  
  /**
   * Record a slashing event for auditing
   */
  private async recordSlashingEvent(
    agentId: string,
    severity: ViolationSeverity,
    reason: string,
    penalty: number,
    oldScore: number,
    newScore: number
  ): Promise<void> {
    const event = JSON.stringify({
      timestamp: Date.now(),
      agentId,
      severity,
      reason,
      penalty,
      oldScore,
      newScore
    });
    
    // Add to global slashing log
    await this.redis.lpush('global:trust:slashing_events', event);
    // Keep the log reasonably sized
    await this.redis.ltrim('global:trust:slashing_events', 0, 999);
    
    // Add to agent-specific slashing log
    await this.redis.lpush(`agent:${agentId}:trust:slashing_events`, event);
    // Keep the log reasonably sized
    await this.redis.ltrim(`agent:${agentId}:trust:slashing_events`, 0, 99);
  }
  
  /**
   * Get recent slashing events (global or for a specific agent)
   * @param agentId Optional agent ID to filter events
   * @param limit Maximum number of events to retrieve
   */
  async getRecentSlashingEvents(
    agentId?: string,
    limit: number = 100
  ): Promise<Array<{
    timestamp: number;
    agentId: string;
    severity: ViolationSeverity;
    reason: string;
    penalty: number;
    oldScore: number;
    newScore: number;
  }>> {
    const key = agentId 
      ? `agent:${agentId}:trust:slashing_events`
      : 'global:trust:slashing_events';
      
    const events = await this.redis.lrange(key, 0, limit - 1);
    
    return events.map(event => JSON.parse(event));
  }
} 