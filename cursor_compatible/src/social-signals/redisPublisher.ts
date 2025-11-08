/**
 * Redis Publisher for Social Signals
 * 
 * Publishes unified social signals to Redis streams and handles
 * real-time distribution to subscribers.
 */

import { createLogger } from '../common/logger.js';
import { RedisPublisherConfig, SocialSignalRedisKeys, UnifiedSocialSignal } from './types.js';

const logger = createLogger('RedisPublisher');

/**
 * Handles publishing social signals to Redis streams and pub/sub channels
 * for real-time consumption by strategy models.
 */
export class RedisPublisher {
  private config: RedisPublisherConfig;
  private redisClient: any; // Redis client
  private metricsLogger?: (metric: string, value: any) => void;

  constructor(config: RedisPublisherConfig, redisClient: any, metricsLogger?: (metric: string, value: any) => void) {
    this.config = config;
    this.redisClient = redisClient;
    this.metricsLogger = metricsLogger;
    
    logger.info('Redis Publisher initialized');
  }

  /**
   * Publish a social signal to Redis
   */
  public async publishSignal(signal: UnifiedSocialSignal): Promise<void> {
    try {
      if (!this.redisClient) {
        logger.warn('Redis client not configured, signal not published');
        return;
      }
      
      const token = signal.token.toUpperCase();
      const signalJson = JSON.stringify(signal);
      
      // Save to latest signal buffer
      const bufferKey = `${SocialSignalRedisKeys.SIGNAL_BUFFER}${token}`;
      await this.redisClient.set(bufferKey, signalJson, 'EX', this.config.ttlSeconds);
      
      // Add to stream
      const streamKey = `${SocialSignalRedisKeys.SIGNAL_STREAM}${token}`;
      const timestamp = Date.now().toString();
      
      // Using XADD to add to stream
      // Format: XADD key MAXLEN ~ limit * field1 value1 field2 value2 ...
      await this.redisClient.xadd(
        streamKey,
        'MAXLEN', '~', this.config.maxStreamLength.toString(),
        '*', // Automatic ID based on time
        'data', signalJson,
        'timestamp', timestamp
      );
      
      // Publish to pubsub channel for real-time notifications
      const channelName = `social_score_feed:${token}`;
      await this.redisClient.publish(channelName, signalJson);
      
      // Update metrics
      if (this.metricsLogger) {
        this.metricsLogger('social_signals.published', 1);
        this.metricsLogger(`social_signals.published.${token}`, 1);
      }
      
      logger.debug(`Published signal for ${token}`);
    } catch (error) {
      logger.error(`Error publishing signal: ${error instanceof Error ? error.message : String(error)}`);
      
      if (this.metricsLogger) {
        this.metricsLogger('social_signals.publish_errors', 1);
      }
    }
  }

  /**
   * Publish multiple signals at once
   */
  public async publishSignals(signals: UnifiedSocialSignal[]): Promise<void> {
    try {
      await Promise.all(signals.map(signal => this.publishSignal(signal)));
      
      logger.info(`Published ${signals.length} signals`);
    } catch (error) {
      logger.error(`Error batch publishing signals: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Publish metrics about social signal processing
   */
  public async publishMetrics(metrics: Record<string, number>): Promise<void> {
    try {
      if (!this.redisClient) return;
      
      const metricsKey = SocialSignalRedisKeys.SIGNAL_METRICS;
      
      // Update each metric in Redis
      for (const [metricName, value] of Object.entries(metrics)) {
        await this.redisClient.hset(metricsKey, metricName, value.toString());
      }
      
      // Set expiry
      await this.redisClient.expire(metricsKey, this.config.ttlSeconds);
      
      logger.debug('Published signal metrics');
    } catch (error) {
      logger.error(`Error publishing metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Clear old signal data for a token
   */
  public async clearSignalData(token: string): Promise<void> {
    try {
      if (!this.redisClient) return;
      
      const normalizedToken = token.toUpperCase();
      const bufferKey = `${SocialSignalRedisKeys.SIGNAL_BUFFER}${normalizedToken}`;
      const streamKey = `${SocialSignalRedisKeys.SIGNAL_STREAM}${normalizedToken}`;
      
      // Delete buffer and stream
      await this.redisClient.del(bufferKey);
      await this.redisClient.del(streamKey);
      
      logger.info(`Cleared signal data for ${token}`);
    } catch (error) {
      logger.error(`Error clearing signal data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the most recent signals from a token's stream
   */
  public async getRecentSignals(token: string, count: number = 10): Promise<UnifiedSocialSignal[]> {
    try {
      if (!this.redisClient) return [];
      
      const normalizedToken = token.toUpperCase();
      const streamKey = `${SocialSignalRedisKeys.SIGNAL_STREAM}${normalizedToken}`;
      
      // XREVRANGE gets newest items first
      const results = await this.redisClient.xrevrange(
        streamKey,
        '+', '-', // All time range
        'COUNT', count.toString()
      );
      
      if (!results || !Array.isArray(results)) {
        return [];
      }
      
      // Parse results
      const signals: UnifiedSocialSignal[] = [];
      
      for (const entry of results) {
        // Each entry is [id, [field1, value1, field2, value2, ...]]
        const [_, fields] = entry;
        
        // Find data field
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === 'data') {
            try {
              const signal = JSON.parse(fields[i + 1]) as UnifiedSocialSignal;
              signals.push(signal);
              break;
            } catch (e) {
              logger.error(`Error parsing signal JSON: ${e}`);
            }
          }
        }
      }
      
      return signals;
    } catch (error) {
      logger.error(`Error retrieving recent signals: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
} 