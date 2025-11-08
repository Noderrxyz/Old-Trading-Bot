/**
 * Reward Emitter
 * 
 * Handles emitting reward events to WebSocket connections, 
 * logging systems, and notification channels.
 */

import { RewardEventType, RewardCalculatedEvent, RewardEvent } from './RewardTypes.js';
import { RedisService } from '../../infrastructure/RedisService.js';
import { EventEmitter } from '../../../utils/EventEmitter.js';

/**
 * Configuration options for the reward emitter
 */
export interface RewardEmitterConfig {
  /** Enable WebSocket event publishing */
  enableWebSocket?: boolean;
  
  /** Enable Discord webhook notifications */
  enableDiscord?: boolean;
  
  /** Enable Redis pub/sub for inter-service communication */
  enableRedisPubSub?: boolean;
  
  /** Send high-value reward notifications */
  notifyHighValueRewards?: boolean;
  
  /** The threshold for high-value reward notifications */
  highValueThreshold?: number;
  
  /** Additional webhook URLs for notifications */
  webhookUrls?: string[];
}

/**
 * Default emitter configuration
 */
const DEFAULT_CONFIG: RewardEmitterConfig = {
  enableWebSocket: true,
  enableDiscord: false,
  enableRedisPubSub: true,
  notifyHighValueRewards: true,
  highValueThreshold: 50
};

/**
 * Handles emitting reward events to various channels
 */
export class RewardEmitter {
  private config: RewardEmitterConfig;
  private redisService: RedisService;
  private eventEmitter: EventEmitter;
  
  /**
   * Create a new RewardEmitter
   * 
   * @param redisService Redis service for pub/sub events
   * @param eventEmitter EventEmitter for system events
   * @param config Custom configuration options
   */
  constructor(
    redisService: RedisService,
    eventEmitter: EventEmitter,
    config: Partial<RewardEmitterConfig> = {}
  ) {
    this.redisService = redisService;
    this.eventEmitter = eventEmitter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Process and emit reward events to all configured destinations
   * 
   * @param rewardEvent The reward event to emit
   */
  public async emit(rewardEvent: RewardCalculatedEvent): Promise<void> {
    // Add timestamp if not present
    if (!rewardEvent.timestamp) {
      rewardEvent.timestamp = Date.now();
    }

    // Emit to each configured destination
    await Promise.all([
      this.emitRedis(rewardEvent),
      this.emitWebhooks(rewardEvent),
      this.emitEvents(rewardEvent)
    ]);
  }
  
  /**
   * Emit to Redis for persistence
   * 
   * @param eventPayload Reward calculated event
   */
  private async emitRedis(eventPayload: RewardCalculatedEvent): Promise<void> {
    try {
      if (!this.redisService) {
        console.warn('Redis service not available for reward event persistence');
        return;
      }

      const key = `rewards:${eventPayload.agentId}:${eventPayload.reward.eventType}:${eventPayload.timestamp}`;
      await this.redisService.set(key, JSON.stringify(eventPayload));
      
      // Add to time series for analytics
      // Store as a list entry with timestamp in the key name instead of using sorted sets
      const timeSeriesKey = `rewards:timeseries:${eventPayload.reward.eventType}:${eventPayload.timestamp}`;
      const data = JSON.stringify({
        agentId: eventPayload.agentId,
        value: eventPayload.reward.finalAmount,
        key
      });
      await this.redisService.set(timeSeriesKey, data);
      
      // Also add to a list for chronological access
      const listKey = `rewards:list:${eventPayload.reward.eventType}`;
      await this.redisService.lpush(listKey, timeSeriesKey);
      
      // Keep list trimmed to a reasonable size (last 1000 entries)
      await this.redisService.ltrim(listKey, 0, 999);
    } catch (error) {
      console.error('Redis emission error:', error);
    }
  }
  
  /**
   * Emit to custom webhooks
   * 
   * @param eventPayload Reward calculated event
   */
  private async emitWebhooks(eventPayload: RewardCalculatedEvent): Promise<void> {
    try {
      if (!this.config?.webhookUrls || this.config.webhookUrls.length === 0) {
        return;
      }
      
      // In a real implementation, this would send HTTP requests to webhooks
      // For now, just log that we would send to webhooks
      for (const url of this.config.webhookUrls) {
        if (url) {
          console.log(`[Webhook] Would send reward event to webhook URL: ${url}`);
        }
      }
      
      // Construct webhook payload
      const timestamp = eventPayload.timestamp ?? Date.now();
      const payload = {
        eventType: 'reward',
        timestamp: new Date().toISOString(),
        data: {
          ...eventPayload,
          humanReadableTimestamp: new Date(timestamp).toISOString()
        }
      };
      
      console.log('[Webhook] Payload:', JSON.stringify(payload));
    } catch (error) {
      console.error('Webhook emission error:', error);
    }
  }
  
  /**
   * Emit via the EventEmitter for real-time observers
   * 
   * @param eventPayload Reward calculated event
   */
  private async emitEvents(eventPayload: RewardCalculatedEvent): Promise<void> {
    try {
      if (!this.eventEmitter) {
        console.warn('Event emitter not available for reward events');
        return;
      }
      
      this.eventEmitter.emit('reward:calculated', eventPayload);
      
      // Also emit on a reward-type specific channel
      if (eventPayload.reward && eventPayload.reward.eventType) {
        this.eventEmitter.emit(`reward:${eventPayload.reward.eventType}`, eventPayload);
      }
    } catch (error) {
      console.error('Event emission error:', error);
    }
  }
}