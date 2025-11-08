import { v4 as uuidv4 } from 'uuid';
// @ts-ignore
import Logger from '@noderr/logger';
import { RedisService } from '../infrastructure/RedisService.js';
import { TrustScoreService } from './TrustScoreService.js';
import { EventEmitter } from '../../utils/EventEmitter.js';
import { AgentInfluence } from '../../types/metaAgent.types.js';

/**
 * Configuration for the Agent Influence Service
 */
class AgentInfluenceConfig {
  // Redis key prefix
  redisKeyPrefix = 'noderr:agent:influence';
  
  // Default influence score for new agents
  defaultBaseScore = 1.0;
  
  // Maximum boost multiplier
  maxBoostMultiplier = 3.0;
  
  // Default boost duration in ms (24 hours)
  defaultBoostDuration = 24 * 60 * 60 * 1000;
  
  // History retention period in ms (30 days)
  historyRetention = 30 * 24 * 60 * 60 * 1000;
  
  // How often to recalculate influence scores (1 hour)
  recalculationInterval = 60 * 60 * 1000;
  
  // Trust score weight in influence calculation
  trustScoreWeight = 0.5;
  
  // Activity weight in influence calculation
  activityWeight = 0.3;
  
  // Performance weight in influence calculation
  performanceWeight = 0.2;
}

/**
 * Service for managing agent influence scores
 * Agent influence determines how much weight an agent's actions have
 * in the ecosystem, including voting power and reward distribution
 */
export class AgentInfluenceService {
  constructor(redisService, trustScoreService, eventEmitter) {
    this.logger = new Logger('AgentInfluenceService');
    this.config = new AgentInfluenceConfig();
    this.redisService = redisService;
    this.trustScoreService = trustScoreService;
    this.eventEmitter = eventEmitter;
    
    // Setup recalculation interval
    setInterval(() => {
      this.recalculateAllInfluenceScores().catch(err => {
        this.logger.error('Failed to recalculate influence scores', err);
      });
    }, this.config.recalculationInterval);
    
    // Subscribe to relevant events
    this.eventEmitter.on('agent:reputation:updated', (data) => {
      this.handleReputationUpdate(data.agentId, data.newScore).catch(err => {
        this.logger.error(`Failed to handle reputation update for ${data.agentId}`, err);
      });
    });
  }
  
  /**
   * Get the current influence score for an agent
   * 
   * @param agentId The agent ID to get influence for
   * @returns The current effective influence score
   */
  async getAgentInfluence(agentId) {
    const influence = await this.getAgentInfluenceData(agentId);
    return influence.effectiveInfluence;
  }
  
  /**
   * Get the full influence data for an agent
   * 
   * @param agentId The agent ID
   * @returns Complete influence data including base score, boost, and history
   */
  async getAgentInfluenceData(agentId) {
    const redisKey = `${this.config.redisKeyPrefix}:${agentId}`;
    const exists = await this.redisService.exists(redisKey);
    
    if (!exists) {
      // Initialize new influence data for this agent
      const newInfluence = this.createDefaultInfluence(agentId);
      await this.saveAgentInfluence(newInfluence);
      return newInfluence;
    }
    
    // Get existing influence data
    const rawData = await this.redisService.hgetall(redisKey);
    
    // Parse the influence data
    const influence = {
      agentId,
      baseScore: parseFloat(rawData.baseScore || this.config.defaultBaseScore.toString()),
      boostMultiplier: parseFloat(rawData.boostMultiplier || '1.0'),
      effectiveInfluence: parseFloat(rawData.effectiveInfluence || this.config.defaultBaseScore.toString()),
      lastCalculated: parseInt(rawData.lastCalculated || Date.now().toString(), 10)
    };
    
    // Add optional fields if they exist
    if (rawData.boostExpiresAt) {
      influence.boostExpiresAt = parseInt(rawData.boostExpiresAt, 10);
    }
    
    // Parse history if it exists
    if (rawData.history) {
      try {
        influence.history = JSON.parse(rawData.history);
      } catch (err) {
        this.logger.error(`Failed to parse influence history for ${agentId}`, err);
        influence.history = [];
      }
    }
    
    // Check if any boosts have expired
    const now = Date.now();
    if (influence.boostExpiresAt && influence.boostExpiresAt < now) {
      // Reset boost multiplier to 1.0
      influence.boostMultiplier = 1.0;
      delete influence.boostExpiresAt;
      
      // Recalculate effective influence
      influence.effectiveInfluence = influence.baseScore * influence.boostMultiplier;
      influence.lastCalculated = now;
      
      // Save the updated influence
      await this.saveAgentInfluence(influence);
    }
    
    return influence;
  }
  
  /**
   * Apply a temporary boost to an agent's influence
   * 
   * @param agentId The agent to boost
   * @param multiplier The boost multiplier (e.g., 1.5 = 50% boost)
   * @param durationMs How long the boost should last (default: 24 hours)
   * @param reason Optional reason for the boost
   * @returns The updated influence data
   */
  async boostAgentInfluence(agentId, multiplier, durationMs = this.config.defaultBoostDuration, reason = '') {
    // Get current influence data
    const influence = await this.getAgentInfluenceData(agentId);
    
    // Ensure multiplier is within valid range
    const validMultiplier = Math.min(
      Math.max(1.0, multiplier),
      this.config.maxBoostMultiplier
    );
    
    // Apply the boost
    influence.boostMultiplier = validMultiplier;
    influence.boostExpiresAt = Date.now() + durationMs;
    
    // Calculate new effective influence
    influence.effectiveInfluence = influence.baseScore * influence.boostMultiplier;
    influence.lastCalculated = Date.now();
    
    // Save the updated influence
    await this.saveAgentInfluence(influence);
    
    // Emit event for the boost
    this.eventEmitter.emit('agent:influence:boosted', {
      agentId,
      multiplier: validMultiplier,
      duration: durationMs,
      reason,
      newEffectiveInfluence: influence.effectiveInfluence
    });
    
    return influence;
  }
  
  /**
   * Update an agent's base influence score
   * 
   * @param agentId The agent to update
   * @param baseScore The new base score (will be normalized)
   * @param reason Optional reason for the update
   * @returns The updated influence data
   */
  async updateBaseInfluence(agentId, baseScore, reason = '') {
    // Get current influence data
    const influence = await this.getAgentInfluenceData(agentId);
    
    // Ensure score is positive
    const normalizedScore = Math.max(0, baseScore);
    
    // Record previous score for event
    const previousScore = influence.baseScore;
    
    // Update base score
    influence.baseScore = normalizedScore;
    
    // Recalculate effective influence
    influence.effectiveInfluence = influence.baseScore * influence.boostMultiplier;
    influence.lastCalculated = Date.now();
    
    // Add to history
    if (!influence.history) {
      influence.history = [];
    }
    
    influence.history.push({
      timestamp: Date.now(),
      influence: influence.effectiveInfluence
    });
    
    // Prune old history entries
    const historyRetentionThreshold = Date.now() - this.config.historyRetention;
    influence.history = influence.history.filter(entry => entry.timestamp >= historyRetentionThreshold);
    
    // Save the updated influence
    await this.saveAgentInfluence(influence);
    
    // Emit event for the update
    this.eventEmitter.emit('agent:influence:updated', {
      agentId,
      previousBaseScore: previousScore,
      newBaseScore: normalizedScore,
      newEffectiveInfluence: influence.effectiveInfluence,
      reason
    });
    
    return influence;
  }
  
  /**
   * Get ranked list of top influential agents
   * 
   * @param limit Maximum number of agents to return
   * @returns Array of agent IDs and their influence scores, sorted by influence
   */
  async getTopInfluencers(limit = 10) {
    const keys = await this.redisService.keys(`${this.config.redisKeyPrefix}:*`);
    const agentIds = keys.map(key => key.split(':').pop());
    
    // Get influence data for all agents
    const influenceData = await Promise.all(
      agentIds.map(async id => {
        const data = await this.getAgentInfluenceData(id);
        return {
          agentId: id,
          influence: data.effectiveInfluence
        };
      })
    );
    
    // Sort by influence (descending)
    influenceData.sort((a, b) => b.influence - a.influence);
    
    // Return top N
    return influenceData.slice(0, limit);
  }
  
  /**
   * Recalculate influence scores for all agents
   * This considers trust scores, activity levels, and performance
   */
  async recalculateAllInfluenceScores() {
    const keys = await this.redisService.keys(`${this.config.redisKeyPrefix}:*`);
    const agentIds = keys.map(key => key.split(':').pop());
    
    this.logger.info(`Recalculating influence for ${agentIds.length} agents`);
    
    for (const agentId of agentIds) {
      try {
        await this.recalculateAgentInfluence(agentId);
      } catch (err) {
        this.logger.error(`Failed to recalculate influence for ${agentId}`, err);
      }
    }
  }
  
  /**
   * Recalculate a single agent's influence score
   * 
   * @param agentId The agent ID to recalculate
   */
  async recalculateAgentInfluence(agentId) {
    // Get trust score
    const trustScore = await this.trustScoreService.getAgentTrustScore(agentId);
    
    // TODO: Get activity metrics and performance metrics
    // These require integration with activity tracking and performance monitoring systems
    throw new Error('NotImplementedError: Activity and performance metrics not yet implemented. Requires integration with monitoring systems.');
    
    // Future implementation will:
    // 1. Query activity metrics from telemetry system (trades executed, signals generated, etc.)
    // 2. Calculate performance score from historical trade outcomes
    // 3. Normalize scores to 0-1 range
    // 4. Apply time-based decay for older activities
    
    // Example of future implementation:
    // const activityScore = await this.telemetryService.getAgentActivityScore(agentId);
    // const performanceScore = await this.performanceService.getAgentPerformanceScore(agentId);
    
    // Calculate new base score using weighted components
    // const newBaseScore = 
    //   (trustScore / 100) * this.config.trustScoreWeight +
    //   activityScore * this.config.activityWeight +
    //   performanceScore * this.config.performanceWeight;
    
    // Update the base influence (without emitting events)
    // await this.updateBaseInfluence(agentId, newBaseScore, 'Automated recalculation');
  }
  
  /**
   * Handle reputation updates from the registry
   */
  async handleReputationUpdate(agentId, newReputationScore) {
    // Reputation updates trigger a recalculation of influence
    await this.recalculateAgentInfluence(agentId);
  }
  
  /**
   * Save agent influence data to Redis
   */
  async saveAgentInfluence(influence) {
    const redisKey = `${this.config.redisKeyPrefix}:${influence.agentId}`;
    
    // Convert influence object to format for Redis
    const data = {
      baseScore: influence.baseScore.toString(),
      boostMultiplier: influence.boostMultiplier.toString(),
      effectiveInfluence: influence.effectiveInfluence.toString(),
      lastCalculated: influence.lastCalculated.toString()
    };
    
    // Add optional fields
    if (influence.boostExpiresAt) {
      data.boostExpiresAt = influence.boostExpiresAt.toString();
    }
    
    // Add history if it exists
    if (influence.history) {
      data.history = JSON.stringify(influence.history);
    }
    
    // Save to Redis
    await this.redisService.hmset(redisKey, data);
  }
  
  /**
   * Create default influence data for a new agent
   */
  createDefaultInfluence(agentId) {
    const now = Date.now();
    return {
      agentId,
      baseScore: this.config.defaultBaseScore,
      boostMultiplier: 1.0,
      effectiveInfluence: this.config.defaultBaseScore,
      lastCalculated: now,
      history: [
        {
          timestamp: now,
          influence: this.config.defaultBaseScore
        }
      ]
    };
  }
} 