import { ScoredSocialSignal } from './types';
import { SocialScoringPipeline } from './socialScoringPipeline';

/**
 * Redis client for storing and retrieving scored social signals
 * Uses Redis Sorted Sets to store signals by ticker with scores for ranking
 */
export class SocialRedisClient {
  private redisClient: any; // Redis client instance
  private pipeline: SocialScoringPipeline;
  private ttlSeconds: number;
  
  constructor(config: {
    redisClient: any;
    pipeline: SocialScoringPipeline;
    ttlSeconds?: number;
  }) {
    this.redisClient = config.redisClient;
    this.pipeline = config.pipeline;
    this.ttlSeconds = config.ttlSeconds || 24 * 60 * 60; // Default TTL: 24 hours
  }
  
  /**
   * Store a scored social signal in Redis
   * For each ticker mentioned in the signal, add to the corresponding sorted set
   */
  public async storeSignal(signal: ScoredSocialSignal): Promise<void> {
    // Calculate combined score for ranking
    const score = this.pipeline.calculateCombinedScore(signal);
    
    // Store signal in Redis for each mentioned ticker
    for (const ticker of signal.tickers) {
      const key = this.pipeline.createRedisKey(ticker);
      
      try {
        // Add to sorted set (ZADD key score value)
        await this.redisClient.zadd(
          key,
          score,
          JSON.stringify(signal)
        );
        
        // Set TTL on the key if not already set
        // Note: This operation is idempotent and won't reset TTL if already set
        await this.redisClient.expire(key, this.ttlSeconds);
      } catch (error) {
        console.error(`Error storing signal for ticker ${ticker}:`, error);
      }
    }
  }
  
  /**
   * Retrieve top scored signals for a specific ticker
   */
  public async getTopSignals(ticker: string, limit: number = 10): Promise<ScoredSocialSignal[]> {
    const key = this.pipeline.createRedisKey(ticker);
    
    try {
      // Get top signals (ZREVRANGE key start stop)
      // Start at 0, stop at limit-1, with scores
      const results = await this.redisClient.zrevrange(
        key,
        0,
        limit - 1,
        'WITHSCORES'
      );
      
      // Parse results
      const signals: ScoredSocialSignal[] = [];
      for (let i = 0; i < results.length; i += 2) {
        const signal = JSON.parse(results[i]);
        const score = parseInt(results[i + 1], 10);
        
        signals.push({
          ...signal,
          redisScore: score // Add Redis score for reference
        } as ScoredSocialSignal);
      }
      
      return signals;
    } catch (error) {
      console.error(`Error retrieving signals for ticker ${ticker}:`, error);
      return [];
    }
  }
  
  /**
   * Retrieve signals for a specific ticker within a time range
   */
  public async getSignalsByTimeRange(
    ticker: string,
    startTime: number,
    endTime: number,
    limit: number = 100
  ): Promise<ScoredSocialSignal[]> {
    const key = this.pipeline.createRedisKey(ticker);
    
    try {
      // Get all signals for the ticker
      const allResults = await this.redisClient.zrevrange(
        key,
        0,
        -1,
        'WITHSCORES'
      );
      
      // Parse and filter by time range
      const signals: ScoredSocialSignal[] = [];
      for (let i = 0; i < allResults.length; i += 2) {
        const signal = JSON.parse(allResults[i]);
        const score = parseInt(allResults[i + 1], 10);
        
        if (signal.timestamp >= startTime && signal.timestamp <= endTime) {
          signals.push({
            ...signal,
            redisScore: score
          } as ScoredSocialSignal);
          
          if (signals.length >= limit) {
            break;
          }
        }
      }
      
      return signals;
    } catch (error) {
      console.error(`Error retrieving signals by time range for ticker ${ticker}:`, error);
      return [];
    }
  }
  
  /**
   * Filter signals by tag for a specific ticker
   */
  public async getSignalsByTag(
    ticker: string,
    tag: string,
    limit: number = 10
  ): Promise<ScoredSocialSignal[]> {
    const key = this.pipeline.createRedisKey(ticker);
    
    try {
      // Get all signals for the ticker
      const allResults = await this.redisClient.zrevrange(
        key,
        0,
        -1,
        'WITHSCORES'
      );
      
      // Parse and filter by tag
      const signals: ScoredSocialSignal[] = [];
      for (let i = 0; i < allResults.length; i += 2) {
        const signal = JSON.parse(allResults[i]);
        const score = parseInt(allResults[i + 1], 10);
        
        if (signal.tags.includes(tag)) {
          signals.push({
            ...signal,
            redisScore: score
          } as ScoredSocialSignal);
          
          if (signals.length >= limit) {
            break;
          }
        }
      }
      
      return signals;
    } catch (error) {
      console.error(`Error retrieving signals by tag for ticker ${ticker}:`, error);
      return [];
    }
  }
  
  /**
   * Clean up old signals (older than TTL)
   */
  public async pruneOldSignals(): Promise<void> {
    try {
      // Get all keys matching the pattern
      const keys = await this.redisClient.keys('scored_social:*');
      
      const now = Date.now();
      const cutoffTime = now - (this.ttlSeconds * 1000);
      
      for (const key of keys) {
        // Get all signals for the key
        const allResults = await this.redisClient.zrange(
          key,
          0,
          -1,
          'WITHSCORES'
        );
        
        // Find signals older than cutoff time
        const toRemove: string[] = [];
        for (let i = 0; i < allResults.length; i += 2) {
          const signal = JSON.parse(allResults[i]);
          
          if (signal.timestamp < cutoffTime) {
            toRemove.push(allResults[i]);
          }
        }
        
        // Remove old signals
        if (toRemove.length > 0) {
          await this.redisClient.zrem(key, ...toRemove);
        }
      }
    } catch (error) {
      console.error('Error pruning old signals:', error);
    }
  }
} 