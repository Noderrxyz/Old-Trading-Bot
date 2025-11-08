/**
 * Trend Signal Aggregator
 * 
 * Collects predictions from all active agents across assets and timeframes
 * to enable global consensus calculations.
 */

import { TrendSignal } from '../../types/global.types.js';

/**
 * Interface for Redis operations needed by this class
 */
interface RedisInterface {
  hset(key: string, field: string, value: string): Promise<any>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<any>;
  del(key: string): Promise<any>;
}

export class TrendSignalAggregator {
  private readonly key = 'global:trend:signals';

  constructor(private readonly redis: RedisInterface) {}

  /**
   * Submit a new trend signal from an agent
   * @param agentId ID of the agent submitting the signal
   * @param signal The trend signal data
   */
  async submit(agentId: string, signal: TrendSignal): Promise<void> {
    const id = `${Date.now()}-${agentId}`;
    await this.redis.hset(this.key, id, JSON.stringify(signal));
    await this.redis.expire(this.key, 60 * 5); // keep signals for 5 minutes
  }

  /**
   * Get all recent trend signals
   * @returns Array of recent trend signals
   */
  async getRecent(): Promise<TrendSignal[]> {
    const all = await this.redis.hgetall(this.key);
    return Object.values(all).map((v) => JSON.parse(v) as TrendSignal);
  }

  /**
   * Clear all trend signals (used for testing)
   */
  async clear(): Promise<void> {
    await this.redis.del(this.key);
  }
} 