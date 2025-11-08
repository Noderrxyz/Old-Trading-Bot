/**
 * Trust Score Service
 * 
 * Centralized service for retrieving agent trust scores
 * This service integrates with multiple trust data sources
 * and provides a unified interface for trust score access.
 */

import { RedisService } from '../infrastructure/RedisService.js';
import { TrustScoreProvider } from '../global/TrustWeightedConsensusEngine.js';
import { AgentHealthMode, AgentTrustState } from '../../types/agent.types.js';
import { 
  TRUST_SLASH_THRESHOLD,
  TRUST_QUARANTINE_THRESHOLD, 
  MAX_VIOLATIONS, 
  VIOLATION_WINDOW_DAYS,
  DEFAULT_TRUST_SCORE
} from '../../constants/trust.js';
import logger from '../../utils/logger.js';
import { QuarantineService, QuarantineReason } from './QuarantineService.js';

/**
 * Trust history entry type
 */
interface TrustHistoryEntry {
  timestamp: number;
  score: number;
}

/**
 * Violation report type
 */
export interface ViolationReport {
  agentId: string;
  violations: number;
  firstViolation: number;
  lastViolation: number;
  nextResetTime: number;
}

export class TrustScoreService implements TrustScoreProvider {
  // Trust thresholds for agent health modes
  private readonly HEALING_THRESHOLD = 35;
  private readonly CRITICAL_THRESHOLD = 15;

  // Quarantine service for managing agent quarantines
  private quarantineService: QuarantineService;

  constructor(private readonly redis: RedisService) {
    this.quarantineService = new QuarantineService(redis);
  }

  /**
   * Get the trust score for an agent
   * @param agentId Agent identifier
   * @returns Trust score between 0 and 100
   */
  async getScore(agentId: string): Promise<number> {
    const raw = await this.redis.get(`agent:${agentId}:trust_score`);
    return raw ? parseFloat(raw) : DEFAULT_TRUST_SCORE; // fallback to neutral weight
  }

  /**
   * Get normalized trust weight for an agent (between 0.1 and 1.0)
   * @param agentId Agent identifier
   * @returns Normalized trust weight
   */
  async getWeight(agentId: string): Promise<number> {
    const score = await this.getScore(agentId);
    return Math.max(0.1, score / 100); // normalize to 0.1–1.0 minimum
  }

  /**
   * Get trust score for an agent normalized to 0-1 range
   * Implements TrustScoreProvider interface for the TrustWeightedConsensusEngine
   * @param agentId Agent identifier
   * @returns Trust score normalized to 0-1 range
   */
  async getAgentTrustScore(agentId: string): Promise<number> {
    const score = await this.getScore(agentId);
    return score / 100; // normalize to 0-1 range
  }

  /**
   * Get the current trust state for an agent
   * @param agentId Agent identifier
   * @returns Agent trust state including health mode
   */
  async getTrustState(agentId: string): Promise<AgentTrustState> {
    const score = await this.getScore(agentId);
    const metaKey = `agent:${agentId}:trust_meta`;

    // Determine agent health mode based on trust score
    let mode = AgentHealthMode.NORMAL;
    if (score < this.HEALING_THRESHOLD && score >= this.CRITICAL_THRESHOLD) {
      mode = AgentHealthMode.SELF_HEALING;
    } else if (score < this.CRITICAL_THRESHOLD) {
      mode = AgentHealthMode.CRITICAL;
    }

    // Manage self-healing mode metadata
    if (mode === AgentHealthMode.SELF_HEALING) {
      const enteredAt = await this.redis.hget(metaKey, 'enteredSelfHealingAt');
      if (!enteredAt) {
        // Agent just entered self-healing mode
        await this.redis.hset(metaKey, 'enteredSelfHealingAt', Date.now().toString());
        // Log this transition for monitoring
        console.log(`Agent ${agentId} entered self-healing mode with trust score ${score}`);
        // Publish event for realtime monitoring
        await this.emitTrustStateEvent(agentId, score, mode, Date.now());
      }
    } else if (mode === AgentHealthMode.NORMAL) {
      // Check if agent just recovered from self-healing mode
      const enteredAt = await this.redis.hget(metaKey, 'enteredSelfHealingAt');
      if (enteredAt) {
        console.log(`Agent ${agentId} recovered from self-healing mode with trust score ${score}`);
        await this.redis.hdel(metaKey, 'enteredSelfHealingAt');
        // Publish recovery event
        await this.emitTrustStateEvent(agentId, score, mode);
      }
    }

    // Build complete trust state
    let enteredSelfHealingAt: number | undefined;
    if (mode === AgentHealthMode.SELF_HEALING) {
      const enteredAt = await this.redis.hget(metaKey, 'enteredSelfHealingAt');
      enteredSelfHealingAt = enteredAt ? parseInt(enteredAt) : undefined;
    }

    return {
      score,
      mode,
      enteredSelfHealingAt
    };
  }

  /**
   * Update the trust score for an agent
   * @param agentId Agent identifier
   * @param score New trust score value (0 to 100)
   */
  async updateScore(agentId: string, score: number): Promise<void> {
    // Ensure the score is within valid range
    const normalizedScore = Math.max(0, Math.min(100, score));
    
    await this.redis.set(`agent:${agentId}:trust_score`, normalizedScore.toString());
    
    // Record this update in history
    const timestamp = Date.now();
    const historyEntry = JSON.stringify({
      timestamp,
      score: normalizedScore
    });
    
    await this.redis.lpush(`agent:${agentId}:trust_history`, historyEntry);
    // Keep only the last 100 entries
    await this.redis.ltrim(`agent:${agentId}:trust_history`, 0, 99);
    
    // Check if this update changes the agent's health mode
    const prevState = await this.redis.get(`agent:${agentId}:health_mode`);
    const trustState = await this.getTrustState(agentId);
    
    // If health mode changed, emit an event
    if (!prevState || prevState !== trustState.mode) {
      await this.redis.set(`agent:${agentId}:health_mode`, trustState.mode);
      await this.emitTrustStateEvent(agentId, normalizedScore, trustState.mode, trustState.enteredSelfHealingAt);
    }
    
    // Check for enforcement actions based on new score
    await this.checkAndEnforce(agentId);
  }

  /**
   * Adjust an agent's trust score by a delta amount
   * @param agentId Agent identifier
   * @param delta Change to apply to the trust score (can be positive or negative)
   * @returns Updated trust score
   */
  async adjustScore(agentId: string, delta: number): Promise<number> {
    const currentScore = await this.getScore(agentId);
    const newScore = Math.max(0, Math.min(100, currentScore + delta));
    
    await this.updateScore(agentId, newScore);
    return newScore;
  }

  /**
   * Reset an agent's trust score to default
   * @param agentId Agent identifier
   * @returns The default trust score
   */
  async resetScore(agentId: string): Promise<number> {
    await this.updateScore(agentId, DEFAULT_TRUST_SCORE);
    
    // Record this reset in the agent's history
    await this.redis.lpush(
      `agent:${agentId}:trust_events`, 
      JSON.stringify({
        type: 'reset',
        timestamp: Date.now(),
        newScore: DEFAULT_TRUST_SCORE
      })
    );
    
    return DEFAULT_TRUST_SCORE;
  }

  /**
   * Get trust history for an agent
   * @param agentId Agent identifier
   * @param limit Maximum number of history entries to retrieve
   * @returns Array of trust history entries
   */
  async getHistory(agentId: string, limit: number = 100): Promise<TrustHistoryEntry[]> {
    const history = await this.redis.lrange(`agent:${agentId}:trust_history`, 0, limit - 1);
    
    return history.map((entry: string) => JSON.parse(entry) as TrustHistoryEntry);
  }

  /**
   * Check if an agent is currently in quarantine
   * @param agentId Agent identifier
   * @returns Whether the agent is quarantined
   */
  async isQuarantined(agentId: string): Promise<boolean> {
    return this.quarantineService.isQuarantined(agentId);
  }

  /**
   * Check current trust score and enforce rules
   * Applies slashing and quarantine based on trust thresholds
   * @param agentId Agent identifier
   */
  async checkAndEnforce(agentId: string): Promise<void> {
    const score = await this.getScore(agentId);
    const isQuarantined = await this.isQuarantined(agentId);
    
    // Skip enforcement if already quarantined
    if (isQuarantined) {
      return;
    }
    
    // Apply quarantine for critically low trust
    if (score <= TRUST_QUARANTINE_THRESHOLD) {
      logger.warn(`🔒 Agent ${agentId} trust score ${score} below quarantine threshold ${TRUST_QUARANTINE_THRESHOLD}`);
      
      await this.quarantineService.quarantineAgent(
        agentId, 
        QuarantineReason.LOW_TRUST, 
        score
      );
      
      // Record the enforcement action
      await this.recordEnforcementAction(agentId, 'quarantine', score);
      
      return;
    }
    
    // Handle slashing for scores below slash threshold
    if (score <= TRUST_SLASH_THRESHOLD) {
      const violationsKey = `agent:${agentId}:trust_violations`;
      const count = await this.redis.incr(violationsKey);
      
      // Set expiration for violations counter
      const expirySeconds = VIOLATION_WINDOW_DAYS * 24 * 60 * 60;
      await this.redis.expire(violationsKey, expirySeconds);
      
      if (count === 1) {
        // First violation, record timestamp
        await this.redis.set(`${violationsKey}:first`, Date.now().toString());
      }
      
      // Update last violation timestamp
      await this.redis.set(`${violationsKey}:last`, Date.now().toString());
      
      logger.warn(`🔪 Agent ${agentId} recorded violation ${count}/${MAX_VIOLATIONS} (score: ${score})`);
      
      // Record the slash action
      await this.recordEnforcementAction(agentId, 'violation', score, {
        violationCount: count,
        maxViolations: MAX_VIOLATIONS
      });
      
      // Apply quarantine if max violations reached
      if (count >= MAX_VIOLATIONS) {
        logger.error(`🩸 Agent ${agentId} has reached ${MAX_VIOLATIONS} violations and will be quarantined`);
        
        await this.quarantineService.quarantineAgent(
          agentId, 
          QuarantineReason.REPEATED_VIOLATIONS, 
          score,
          undefined, // Use default quarantine duration
          `Reached ${count} violations within ${VIOLATION_WINDOW_DAYS} days`
        );
        
        // Record the enforcement action
        await this.recordEnforcementAction(agentId, 'slash_quarantine', score, {
          violationCount: count,
          maxViolations: MAX_VIOLATIONS
        });
      }
    }
  }
  
  /**
   * Get violation report for an agent
   * @param agentId Agent identifier
   * @returns Violation report or null if no violations
   */
  async getViolationReport(agentId: string): Promise<ViolationReport | null> {
    const violationsKey = `agent:${agentId}:trust_violations`;
    const countStr = await this.redis.get(violationsKey);
    
    if (!countStr) {
      return null;
    }
    
    const count = parseInt(countStr);
    const firstViolationStr = await this.redis.get(`${violationsKey}:first`);
    const lastViolationStr = await this.redis.get(`${violationsKey}:last`);
    const ttl = await this.redis.ttl(violationsKey);
    
    const firstViolation = firstViolationStr ? parseInt(firstViolationStr) : Date.now();
    const lastViolation = lastViolationStr ? parseInt(lastViolationStr) : Date.now();
    const nextResetTime = Date.now() + (ttl * 1000);
    
    return {
      agentId,
      violations: count,
      firstViolation,
      lastViolation,
      nextResetTime
    };
  }
  
  /**
   * Manually slash an agent's trust
   * @param agentId Agent identifier
   * @param reason Reason for the manual slash
   * @param amount Amount to slash (optional, defaults to below slash threshold)
   * @returns New trust score
   */
  async manualSlash(agentId: string, reason: string, amount?: number): Promise<number> {
    const currentScore = await this.getScore(agentId);
    let newScore: number;
    
    if (amount) {
      // Apply specific amount
      newScore = Math.max(0, currentScore - amount);
    } else {
      // Force below slash threshold
      newScore = Math.min(currentScore, TRUST_SLASH_THRESHOLD - 1);
    }
    
    // Update score
    await this.updateScore(agentId, newScore);
    
    // Record manual slash
    await this.redis.lpush(
      `agent:${agentId}:trust_events`, 
      JSON.stringify({
        type: 'manual_slash',
        timestamp: Date.now(),
        oldScore: currentScore,
        newScore,
        reason,
        amount: currentScore - newScore
      })
    );
    
    logger.warn(`🔪 Agent ${agentId} manually slashed from ${currentScore} to ${newScore}: ${reason}`);
    
    // Enforce rules based on new score
    await this.checkAndEnforce(agentId);
    
    return newScore;
  }
  
  /**
   * Manually quarantine an agent
   * @param agentId Agent identifier
   * @param reason Reason for manual quarantine
   * @param durationMs Optional custom duration
   * @returns Quarantine end time
   */
  async manualQuarantine(
    agentId: string, 
    reason: string, 
    durationMs?: number
  ): Promise<number> {
    const score = await this.getScore(agentId);
    
    const endTime = await this.quarantineService.quarantineAgent(
      agentId, 
      QuarantineReason.MANUAL, 
      score,
      durationMs,
      reason
    );
    
    // Record the manual quarantine
    await this.recordEnforcementAction(agentId, 'manual_quarantine', score, {
      reason,
      endTime
    });
    
    return endTime;
  }
  
  /**
   * Manually release an agent from quarantine
   * @param agentId Agent identifier
   * @param reason Reason for release
   * @returns Whether the release was successful
   */
  async releaseFromQuarantine(agentId: string, reason: string): Promise<boolean> {
    return this.quarantineService.releaseFromQuarantine(agentId, reason);
  }
  
  /**
   * Record enforcement action for auditing
   * @param agentId Agent identifier
   * @param action Action type
   * @param score Current trust score
   * @param metadata Additional metadata
   */
  private async recordEnforcementAction(
    agentId: string, 
    action: string, 
    score: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const event = {
      type: 'enforcement',
      action,
      agentId,
      score,
      timestamp: Date.now(),
      ...metadata
    };
    
    // Add to agent's trust events
    await this.redis.lpush(
      `agent:${agentId}:trust_events`, 
      JSON.stringify(event)
    );
    
    // Add to global enforcement history
    await this.redis.lpush(
      'global:trust:enforcement_events', 
      JSON.stringify(event)
    );
    await this.redis.ltrim('global:trust:enforcement_events', 0, 999);
    
    // Emit event for real-time monitoring
    await this.redis.publish('agent:trust_enforcement', JSON.stringify(event));
  }

  /**
   * Emit a trust state change event for real-time monitoring
   * @param agentId Agent identifier
   * @param score Current trust score
   * @param mode Health mode
   * @param enteredSelfHealingAt Optional timestamp when self-healing mode was entered
   */
  private async emitTrustStateEvent(
    agentId: string, 
    score: number, 
    mode: AgentHealthMode,
    enteredSelfHealingAt?: number
  ): Promise<void> {
    const event = JSON.stringify({
      agentId,
      trustScore: score,
      mode,
      enteredSelfHealingAt,
      timestamp: Date.now()
    });

    await this.redis.publish('agent:trust_state', event);
  }
} 