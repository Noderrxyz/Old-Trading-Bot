/**
 * Chaos Simulation Bus
 * 
 * Provides pub/sub and WebSocket hooks for chaos simulation events.
 * Enables live monitoring and recording of simulation activities.
 */

import { RedisService } from '../services/infrastructure/RedisService.js';
import { ChaosEventType } from '../types/chaos.types.js';
import logger from '../utils/logger.js';

export class ChaosSimulationBus {
  constructor(private readonly redis: RedisService) {}
  
  /**
   * Broadcast a chaos simulation event
   * @param event Event type
   * @param payload Event data
   */
  async broadcast(event: ChaosEventType, payload?: any): Promise<void> {
    const timestamp = Date.now();
    const eventData = JSON.stringify({
      event,
      timestamp,
      payload
    });
    
    // Publish to Redis channel for subscribers
    await this.redis.publish('chaos:events', eventData);
    
    // Store event in Redis for history/replay
    await this.redis.lpush('chaos:events:history', eventData);
    await this.redis.ltrim('chaos:events:history', 0, 999); // Keep last 1000 events
    
    // Also log to console for local development/debugging
    logger.debug(`🧪 CHAOS [${event}]: ${JSON.stringify(payload || {})}`);
  }
  
  /**
   * Record a specific agent's response to chaos stimuli
   * @param agentId Agent identifier
   * @param stimuli Applied stimuli
   * @param response Agent's response
   */
  async recordAgentResponse(agentId: string, stimuli: any, response: any): Promise<void> {
    const record = {
      agentId,
      timestamp: Date.now(),
      stimuli,
      response,
      responseTimeMs: response.responseTimeMs || 0
    };
    
    // Store in Redis for analytics
    await this.redis.lpush(`chaos:agent:${agentId}:responses`, JSON.stringify(record));
    await this.redis.ltrim(`chaos:agent:${agentId}:responses`, 0, 99); // Keep last 100 responses
    
    // Broadcast the response event
    await this.broadcast('agent:responded', record);
  }
  
  /**
   * Record a trust score change during chaos simulation
   * @param agentId Agent identifier
   * @param previousScore Previous trust score
   * @param newScore New trust score
   * @param reason Reason for the change
   */
  async recordTrustChange(
    agentId: string, 
    previousScore: number, 
    newScore: number,
    reason: string
  ): Promise<void> {
    const change = newScore - previousScore;
    const record = {
      agentId,
      timestamp: Date.now(),
      previousScore,
      newScore,
      change,
      reason
    };
    
    // Determine if trust improved or degraded
    const event: ChaosEventType = change >= 0 ? 'trust:improved' : 'trust:degraded';
    
    // Broadcast the trust change event
    await this.broadcast(event, record);
    
    // Store in Redis for analytics
    await this.redis.lpush('chaos:trust:changes', JSON.stringify(record));
    await this.redis.ltrim('chaos:trust:changes', 0, 999); // Keep last 1000 changes
  }
  
  /**
   * Get historical simulation events
   * @param limit Maximum number of events to retrieve
   * @returns Array of historical events
   */
  async getEventHistory(limit: number = 100): Promise<any[]> {
    const events = await this.redis.lrange('chaos:events:history', 0, limit - 1);
    return events.map(e => JSON.parse(e));
  }
  
  /**
   * Get agent response history from chaos simulations
   * @param agentId Agent identifier
   * @param limit Maximum number of responses to retrieve
   * @returns Array of agent responses
   */
  async getAgentResponseHistory(agentId: string, limit: number = 50): Promise<any[]> {
    const responses = await this.redis.lrange(`chaos:agent:${agentId}:responses`, 0, limit - 1);
    return responses.map(r => JSON.parse(r));
  }
  
  /**
   * Get trust change history from chaos simulations
   * @param limit Maximum number of changes to retrieve
   * @returns Array of trust changes
   */
  async getTrustChangeHistory(limit: number = 100): Promise<any[]> {
    const changes = await this.redis.lrange('chaos:trust:changes', 0, limit - 1);
    return changes.map(c => JSON.parse(c));
  }
} 