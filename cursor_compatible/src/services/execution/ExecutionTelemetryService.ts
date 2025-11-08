/**
 * Execution Telemetry Service
 * 
 * Logs and retrieves execution telemetry data for performance analysis,
 * including slippage, post-fill movement, and execution quality metrics.
 */

import { ExecutionTelemetry } from '../../types/execution.types.js';

// Redis client placeholder - would be injected in a real implementation
const redis = {
  rpush: async (key: string, value: string) => {
    console.log(`[Redis] RPUSH ${key} ${value}`);
    return true;
  },
  ltrim: async (key: string, start: number, stop: number) => {
    console.log(`[Redis] LTRIM ${key} ${start} ${stop}`);
    return true;
  },
  lrange: async (key: string, start: number, stop: number): Promise<string[]> => {
    console.log(`[Redis] LRANGE ${key} ${start} ${stop}`);
    return []; // Mock implementation
  }
};

/**
 * Service for logging and retrieving execution telemetry
 */
export class ExecutionTelemetryService {
  private readonly key = 'execution:telemetry';
  private readonly maxEntries = 1000;
  private cache: Record<string, ExecutionTelemetry[]> = {};
  
  /**
   * Log execution telemetry data
   * @param data Execution telemetry data
   */
  async log(data: ExecutionTelemetry): Promise<void> {
    const assetKey = `${this.key}:${data.asset}`;
    
    // Add to Redis
    await redis.rpush(assetKey, JSON.stringify(data));
    
    // Trim to keep last N entries
    await redis.ltrim(assetKey, -this.maxEntries, -1);
    
    // Update in-memory cache if it exists for this asset
    if (this.cache[data.asset]) {
      this.cache[data.asset].push(data);
      
      // Trim local cache as well
      if (this.cache[data.asset].length > this.maxEntries) {
        this.cache[data.asset] = this.cache[data.asset].slice(-this.maxEntries);
      }
    }
    
    console.log(`Logged execution telemetry for ${data.asset}, order ${data.orderId}`);
  }
  
  /**
   * Get recent execution telemetry for an asset
   * @param asset Asset identifier
   * @returns Array of recent execution telemetry data
   */
  async getRecent(asset: string): Promise<ExecutionTelemetry[]> {
    // Check if we have cached data
    if (this.cache[asset] && this.cache[asset].length > 0) {
      return this.cache[asset];
    }
    
    // Otherwise fetch from Redis
    const raw = await redis.lrange(`${this.key}:${asset}`, 0, -1);
    
    // Parse and cache the data
    this.cache[asset] = raw.map(item => JSON.parse(item) as ExecutionTelemetry);
    return this.cache[asset];
  }
  
  /**
   * Get telemetry for a specific venue and asset
   * @param asset Asset identifier
   * @param venue Venue identifier
   * @returns Filtered execution telemetry for the venue
   */
  async getByVenue(asset: string, venue: string): Promise<ExecutionTelemetry[]> {
    const data = await this.getRecent(asset);
    return data.filter(item => item.venue === venue);
  }
  
  /**
   * Get telemetry for a time range
   * @param asset Asset identifier
   * @param startTime Start timestamp
   * @param endTime End timestamp (defaults to now)
   * @returns Filtered execution telemetry for the time range
   */
  async getByTimeRange(
    asset: string,
    startTime: number,
    endTime: number = Date.now()
  ): Promise<ExecutionTelemetry[]> {
    const data = await this.getRecent(asset);
    return data.filter(item => item.timestamp >= startTime && item.timestamp <= endTime);
  }
  
  /**
   * Clear the in-memory cache for an asset or all assets
   * @param asset Optional asset to clear cache for
   */
  clearCache(asset?: string): void {
    if (asset) {
      delete this.cache[asset];
    } else {
      this.cache = {};
    }
  }
} 