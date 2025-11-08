/**
 * Alpha Cache Manager Implementation
 * 
 * Provides temporary caching for alpha signals with configurable decay models
 * to better manage signal freshness and prevent duplicate processing.
 */

import { FusedAlphaFrame } from '../fusion-engine.js';
import { AlphaCacheConfig, DEFAULT_ALPHA_CACHE_CONFIG } from './alpha-cache-config.js';
import { MemoryCache } from './memory-cache.js';
import { RedisClient } from '../../infra/core/RedisClient.js';
import { createLogger } from '../../common/logger.js';

export class AlphaCacheManager {
  private config: AlphaCacheConfig;
  private memoryCache: MemoryCache<FusedAlphaFrame> | null = null;
  private redisClient: RedisClient | null = null;
  private logger = createLogger('AlphaCacheManager');
  private purgeInterval: NodeJS.Timeout | null = null;
  
  /**
   * Create a new Alpha Cache Manager
   * @param config Configuration for the cache manager
   * @param redisClient Optional Redis client to use (if using Redis backend)
   */
  constructor(
    config: Partial<AlphaCacheConfig> = {},
    redisClient?: RedisClient
  ) {
    this.config = { ...DEFAULT_ALPHA_CACHE_CONFIG, ...config };
    
    if (!this.config.enabled) {
      this.logger.warn('Alpha cache is disabled, signals will not be cached');
      return;
    }
    
    if (this.config.cacheBackend === 'redis') {
      if (redisClient) {
        this.redisClient = redisClient;
        this.logger.info('Using Redis for alpha signal caching');
      } else {
        this.logger.warn('Redis cache backend configured but no Redis client provided. Falling back to memory cache.');
        this.initializeMemoryCache();
      }
    } else {
      this.initializeMemoryCache();
    }
    
    // Set up regular purging of expired signals
    this.startPurgeInterval();
  }
  
  /**
   * Initialize the memory cache
   */
  private initializeMemoryCache(): void {
    const maxSize = this.config.memory?.maxSize || 1000;
    const checkExpiration = this.config.memory?.checkExpirationOnAccess !== false;
    
    this.memoryCache = new MemoryCache<FusedAlphaFrame>(
      maxSize,
      checkExpiration
    );
    
    this.logger.info(`Using memory cache for alpha signal caching (max size: ${maxSize})`);
  }
  
  /**
   * Start the interval for regular purging of expired signals
   */
  private startPurgeInterval(): void {
    // Run purge every minute by default
    const purgeIntervalMs = 60000;
    
    this.purgeInterval = setInterval(() => {
      this.purgeExpired();
    }, purgeIntervalMs);
    
    // Prevent the interval from keeping the process alive
    if (this.purgeInterval.unref) {
      this.purgeInterval.unref();
    }
  }
  
  /**
   * Clean up resources used by the cache manager
   */
  public dispose(): void {
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
      this.purgeInterval = null;
    }
    
    if (this.memoryCache) {
      this.memoryCache.clear();
      this.memoryCache = null;
    }
    
    // We don't close the Redis client here as it might be shared
  }
  
  /**
   * Get the cache key for a signal
   * @param symbol Asset symbol
   * @param timestamp Timestamp (optional, uses current time if not provided)
   * @returns Cache key
   */
  private getCacheKey(symbol: string, timestamp?: number): string {
    timestamp = timestamp || Date.now();
    return `${symbol}:${timestamp}`;
  }
  
  /**
   * Add a signal to the cache
   * @param signal Alpha signal to cache
   * @returns True if the signal was cached, false otherwise
   */
  public async addSignal(signal: FusedAlphaFrame): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }
    
    const key = this.getCacheKey(signal.symbol, signal.timestamp);
    const ttlMs = this.config.ttlSeconds * 1000;
    
    try {
      if (this.redisClient) {
        // Store in Redis
        await this.redisClient.set(
          this.getRedisKey(key),
          JSON.stringify(signal),
          'EX',
          this.config.ttlSeconds
        );
      } else if (this.memoryCache) {
        // Store in memory
        this.memoryCache.set(key, signal, ttlMs);
      } else {
        return false;
      }
      
      this.logger.debug(`Cached alpha signal for ${signal.symbol} (confidence: ${signal.confidence.toFixed(2)})`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to cache alpha signal: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Get recent signals for a specific symbol within a time window
   * @param symbol Asset symbol
   * @param windowSec Time window in seconds
   * @returns Array of recent signals
   */
  public async getRecentSignals(symbol: string, windowSec: number): Promise<FusedAlphaFrame[]> {
    if (!this.config.enabled) {
      return [];
    }
    
    try {
      let signals: FusedAlphaFrame[] = [];
      
      if (this.redisClient) {
        // Get from Redis
        const pattern = this.getRedisKey(`${symbol}:*`);
        const keys = await this.redisClient.keys(pattern);
        
        for (const key of keys) {
          const data = await this.redisClient.get(key);
          if (data) {
            try {
              const signal = JSON.parse(data) as FusedAlphaFrame;
              signals.push(signal);
            } catch (e) {
              this.logger.warn(`Failed to parse cached signal: ${e}`);
            }
          }
        }
      } else if (this.memoryCache) {
        // Get from memory
        const allSignals = this.memoryCache.values();
        
        // Filter by symbol
        signals = allSignals.filter(s => s.symbol === symbol);
      }
      
      // Filter signals by time window
      const cutoffTime = Date.now() - (windowSec * 1000);
      signals = signals.filter(s => s.timestamp >= cutoffTime);
      
      // Apply confidence decay to all signals
      signals = signals.map(s => this.applyDecay(s));
      
      // Filter out signals with confidence below threshold
      signals = signals.filter(s => s.confidence >= this.config.minConfidenceThreshold);
      
      // Sort by timestamp (newest first)
      signals.sort((a, b) => b.timestamp - a.timestamp);
      
      return signals;
    } catch (error) {
      this.logger.error(`Failed to get recent signals: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Apply decay to a signal's confidence score
   * @param signal The signal to apply decay to
   * @returns Signal with updated confidence
   */
  public applyDecay(signal: FusedAlphaFrame): FusedAlphaFrame {
    if (this.config.decayType === 'none') {
      return signal;
    }
    
    const ageMs = Date.now() - signal.timestamp;
    const ageSec = ageMs / 1000;
    
    // If age is negative (future timestamp), don't decay
    if (ageSec <= 0) {
      return signal;
    }
    
    // Apply decay based on configured type
    let newConfidence = signal.confidence;
    
    if (this.config.decayType === 'linear') {
      // Linear decay: confidence decreases by decayFactor * age
      newConfidence = Math.max(
        0,
        signal.confidence - (this.config.decayFactorPerSec * ageSec)
      );
    } else if (this.config.decayType === 'exponential') {
      // Exponential decay: confidence *= (1 - decayFactor)^age
      const decayMultiplier = Math.pow(
        1 - this.config.decayFactorPerSec,
        ageSec
      );
      newConfidence = signal.confidence * decayMultiplier;
    }
    
    // Apply decay to size as well to reduce position sizing for older signals
    const newSize = signal.size * (newConfidence / signal.confidence);
    
    return {
      ...signal,
      confidence: newConfidence,
      size: newSize
    };
  }
  
  /**
   * Remove expired signals from the cache
   * @returns Number of signals purged
   */
  public async purgeExpired(): Promise<number> {
    if (!this.config.enabled) {
      return 0;
    }
    
    try {
      let purgedCount = 0;
      
      if (this.memoryCache) {
        // Purge expired from memory cache
        purgedCount = this.memoryCache.purgeExpired();
      }
      
      // For Redis, we rely on TTL expiration
      
      if (purgedCount > 0) {
        this.logger.debug(`Purged ${purgedCount} expired signals from cache`);
      }
      
      return purgedCount;
    } catch (error) {
      this.logger.error(`Failed to purge expired signals: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
  
  /**
   * Decay all signals in the cache based on their age
   * This is called manually when you want to force decay across all cached signals
   */
  public async decaySignals(): Promise<void> {
    if (!this.config.enabled || this.config.decayType === 'none') {
      return;
    }
    
    try {
      if (this.redisClient) {
        // For Redis, we'd need to load, decay, and save all signals
        // This could be expensive, so we don't do it automatically
        this.logger.warn('Manual decay of all signals in Redis is not implemented');
      } else if (this.memoryCache) {
        // For memory cache, decay is applied when signals are retrieved
        // so we don't need to do anything here
      }
    } catch (error) {
      this.logger.error(`Failed to decay signals: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Visualize the decay of a signal over time
   * @param initialConfidence Initial confidence value
   * @param timeRangeSec Time range to visualize in seconds
   * @param stepSec Step size in seconds
   * @returns Array of [time, confidence] pairs
   */
  public visualizeDecay(
    initialConfidence = 1.0,
    timeRangeSec = 300,
    stepSec = 10
  ): Array<[number, number]> {
    if (this.config.decayType === 'none') {
      return [[0, initialConfidence], [timeRangeSec, initialConfidence]];
    }
    
    const points: Array<[number, number]> = [];
    
    for (let timeSec = 0; timeSec <= timeRangeSec; timeSec += stepSec) {
      let confidence = initialConfidence;
      
      if (this.config.decayType === 'linear') {
        confidence = Math.max(
          0,
          initialConfidence - (this.config.decayFactorPerSec * timeSec)
        );
      } else if (this.config.decayType === 'exponential') {
        const decayMultiplier = Math.pow(
          1 - this.config.decayFactorPerSec,
          timeSec
        );
        confidence = initialConfidence * decayMultiplier;
      }
      
      points.push([timeSec, confidence]);
      
      // Stop if we've decayed below threshold
      if (confidence < this.config.minConfidenceThreshold) {
        break;
      }
    }
    
    return points;
  }
  
  /**
   * Get the Redis key with prefix
   * @param key Base key
   * @returns Redis key with prefix
   */
  private getRedisKey(key: string): string {
    const prefix = this.config.redis?.keyPrefix || 'noderr:alpha:cache:';
    return `${prefix}${key}`;
  }
} 