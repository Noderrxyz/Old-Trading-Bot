/**
 * Reward Fetcher
 * 
 * Handles loading and storing reward events from Redis,
 * with caching for performance optimization.
 */

import { RewardEvent, RewardEventType, RewardStreak } from './RewardTypes.js';

/**
 * Configuration for the reward fetcher
 */
export interface RewardFetcherConfig {
  /** Cache TTL in milliseconds */
  cacheTtlMs: number;
  
  /** Maximum cache size (number of agent histories) */
  maxCacheSize: number;
  
  /** Default number of reward events to retrieve */
  defaultLimit: number;
  
  /** Redis key prefix for reward events */
  rewardKeyPrefix: string;
  
  /** Redis key prefix for reward streaks */
  streakKeyPrefix: string;
}

/**
 * Default fetcher configuration
 */
const DEFAULT_CONFIG: RewardFetcherConfig = {
  cacheTtlMs: 60000, // 1 minute
  maxCacheSize: 100,
  defaultLimit: 50,
  rewardKeyPrefix: 'agent:reward:',
  streakKeyPrefix: 'agent:streak:'
};

/**
 * Cache entry for reward history
 */
interface CacheEntry {
  /** When the cache entry expires */
  expiresAt: number;
  
  /** Cached reward events */
  rewards: RewardEvent[];
  
  /** Cached reward streaks */
  streaks: RewardStreak[];
}

/**
 * Fetches and caches reward data for agents
 */
export class RewardFetcher {
  private config: RewardFetcherConfig;
  private redisService: any;
  private cache: Map<string, CacheEntry> = new Map();
  
  /**
   * Create a new RewardFetcher
   * 
   * @param redisService Redis service for data retrieval
   * @param config Custom configuration options
   */
  constructor(redisService: any, config?: Partial<RewardFetcherConfig>) {
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Get recent reward events for an agent
   * 
   * @param agentId Agent ID
   * @param limit Maximum number of events to retrieve (defaults to config value)
   * @returns Promise resolving to array of reward events
   */
  async getRecent(agentId: string, limit?: number): Promise<RewardEvent[]> {
    // Check cache first
    const cacheEntry = this.cache.get(agentId);
    if (cacheEntry && Date.now() < cacheEntry.expiresAt) {
      return cacheEntry.rewards.slice(0, limit || this.config.defaultLimit);
    }
    
    try {
      // Not in cache or expired, fetch from Redis
      const actualLimit = limit || this.config.defaultLimit;
      const key = `${this.config.rewardKeyPrefix}${agentId}`;
      
      const rewardData = await this.redisService.lrange(key, 0, actualLimit - 1);
      const rewards = rewardData.map((data: string) => JSON.parse(data));
      
      // Update cache
      this.updateCache(agentId, rewards, await this.getStreaks(agentId));
      
      return rewards;
    } catch (error) {
      console.error(`Error fetching recent rewards for ${agentId}:`, error);
      
      // If cache exists but expired, still use it in case of Redis errors
      if (cacheEntry) {
        return cacheEntry.rewards.slice(0, limit || this.config.defaultLimit);
      }
      
      return [];
    }
  }
  
  /**
   * Get reward events of a specific type for an agent
   * 
   * @param agentId Agent ID
   * @param eventType Type of reward event to filter by
   * @param limit Maximum number of events to retrieve
   * @returns Promise resolving to array of reward events
   */
  async getByType(agentId: string, eventType: RewardEventType, limit?: number): Promise<RewardEvent[]> {
    const allRewards = await this.getRecent(agentId, limit ? limit * 2 : undefined);
    
    // Filter by event type and take the requested limit
    const filteredRewards = allRewards
      .filter(reward => reward.eventType === eventType)
      .slice(0, limit || this.config.defaultLimit);
      
    return filteredRewards;
  }
  
  /**
   * Get all reward events related to a specific asset
   * 
   * @param agentId Agent ID
   * @param asset Asset symbol
   * @param limit Maximum number of events to retrieve
   * @returns Promise resolving to array of reward events
   */
  async getByAsset(agentId: string, asset: string, limit?: number): Promise<RewardEvent[]> {
    const allRewards = await this.getRecent(agentId, limit ? limit * 2 : undefined);
    
    // Filter by asset and take the requested limit
    const filteredRewards = allRewards
      .filter(reward => reward.asset === asset)
      .slice(0, limit || this.config.defaultLimit);
      
    return filteredRewards;
  }
  
  /**
   * Get reward streaks for an agent
   * 
   * @param agentId Agent ID
   * @returns Promise resolving to array of reward streaks
   */
  async getStreaks(agentId: string): Promise<RewardStreak[]> {
    // Check cache first
    const cacheEntry = this.cache.get(agentId);
    if (cacheEntry && Date.now() < cacheEntry.expiresAt) {
      return cacheEntry.streaks;
    }
    
    try {
      // Not in cache or expired, fetch from Redis
      const key = `${this.config.streakKeyPrefix}${agentId}`;
      const streakData = await this.redisService.get(key);
      
      if (!streakData) {
        return [];
      }
      
      return JSON.parse(streakData);
    } catch (error) {
      console.error(`Error fetching streaks for ${agentId}:`, error);
      
      // If cache exists but expired, still use it in case of Redis errors
      if (cacheEntry) {
        return cacheEntry.streaks;
      }
      
      return [];
    }
  }
  
  /**
   * Store a new reward event
   * 
   * @param reward Reward event to store
   * @returns Promise resolving to success status
   */
  async storeReward(reward: RewardEvent): Promise<boolean> {
    try {
      const key = `${this.config.rewardKeyPrefix}${reward.agentId}`;
      
      // Store in Redis
      await this.redisService.lpush(key, JSON.stringify(reward));
      
      // Update cache if it exists for this agent
      const cacheEntry = this.cache.get(reward.agentId);
      if (cacheEntry) {
        cacheEntry.rewards.unshift(reward);
        cacheEntry.expiresAt = Date.now() + this.config.cacheTtlMs;
      }
      
      return true;
    } catch (error) {
      console.error(`Error storing reward for ${reward.agentId}:`, error);
      return false;
    }
  }
  
  /**
   * Update agent streaks based on a new reward
   * 
   * @param agentId Agent ID
   * @param reward New reward event
   * @returns Promise resolving to updated streaks
   */
  async updateStreaks(agentId: string, reward: RewardEvent): Promise<RewardStreak[]> {
    try {
      // Get current streaks
      const streaks = await this.getStreaks(agentId);
      
      // Find matching streak or create a new one
      let matchingStreak = streaks.find(streak => 
        streak.eventType === reward.eventType && 
        (!streak.asset || streak.asset === reward.asset)
      );
      
      if (matchingStreak) {
        // Update existing streak
        matchingStreak.count += 1;
        matchingStreak.lastUpdated = Date.now();
      } else {
        // Create new streak
        const newStreak: RewardStreak = {
          count: 1,
          eventType: reward.eventType,
          lastUpdated: Date.now(),
          asset: reward.asset
        };
        
        streaks.push(newStreak);
      }
      
      // Store updated streaks
      const key = `${this.config.streakKeyPrefix}${agentId}`;
      await this.redisService.set(key, JSON.stringify(streaks));
      
      // Update cache if it exists
      const cacheEntry = this.cache.get(agentId);
      if (cacheEntry) {
        cacheEntry.streaks = streaks;
        cacheEntry.expiresAt = Date.now() + this.config.cacheTtlMs;
      }
      
      return streaks;
    } catch (error) {
      console.error(`Error updating streaks for ${agentId}:`, error);
      return [];
    }
  }
  
  /**
   * Update cache with new data
   * 
   * @param agentId Agent ID
   * @param rewards Reward events
   * @param streaks Reward streaks
   */
  private updateCache(agentId: string, rewards: RewardEvent[], streaks: RewardStreak[]): void {
    // Ensure cache doesn't exceed max size by removing oldest entries if needed
    if (this.cache.size >= this.config.maxCacheSize && !this.cache.has(agentId)) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt < oldestTime) {
          oldestTime = entry.expiresAt;
          oldestKey = key;
        }
      }
      
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    // Update or set cache entry
    this.cache.set(agentId, {
      expiresAt: Date.now() + this.config.cacheTtlMs,
      rewards,
      streaks
    });
  }
  
  /**
   * Clear cache for specific agent or all agents
   * 
   * @param agentId Optional agent ID (if not provided, clears all cache)
   */
  clearCache(agentId?: string): void {
    if (agentId) {
      this.cache.delete(agentId);
    } else {
      this.cache.clear();
    }
  }
} 