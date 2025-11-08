/**
 * Default Trust Score Provider
 * 
 * Simple implementation of the TrustScoreProvider interface
 * that uses Redis to store and retrieve agent trust scores.
 */

import { TrustScoreProvider } from './TrustWeightedConsensusEngine.js';

/**
 * Interface for Redis operations needed by this class
 */
interface RedisInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<any>;
}

export class DefaultTrustScoreProvider implements TrustScoreProvider {
  private readonly defaultTrustScore = 0.5;
  private readonly keyPrefix = 'agent:trust:';
  
  constructor(private readonly redis: RedisInterface) {}
  
  /**
   * Get the trust score for an agent
   * @param agentId Agent identifier
   * @returns Trust score between 0 and 1
   */
  async getAgentTrustScore(agentId: string): Promise<number> {
    const key = this.keyPrefix + agentId;
    const storedValue = await this.redis.get(key);
    
    if (storedValue) {
      const score = parseFloat(storedValue);
      // Ensure the score is within valid range
      return Math.max(0, Math.min(1, score));
    }
    
    return this.defaultTrustScore;
  }
  
  /**
   * Update the trust score for an agent
   * @param agentId Agent identifier
   * @param score New trust score value (0 to 1)
   */
  async updateTrustScore(agentId: string, score: number): Promise<void> {
    // Ensure the score is within valid range
    const normalizedScore = Math.max(0, Math.min(1, score));
    const key = this.keyPrefix + agentId;
    
    await this.redis.set(key, normalizedScore.toString());
  }
  
  /**
   * Adjust an agent's trust score by a delta amount
   * @param agentId Agent identifier
   * @param delta Change to apply to the trust score (can be positive or negative)
   * @returns Updated trust score
   */
  async adjustTrustScore(agentId: string, delta: number): Promise<number> {
    const currentScore = await this.getAgentTrustScore(agentId);
    const newScore = Math.max(0, Math.min(1, currentScore + delta));
    
    await this.updateTrustScore(agentId, newScore);
    return newScore;
  }
} 