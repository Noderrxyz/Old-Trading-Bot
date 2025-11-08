/**
 * Strategy Consensus Adapter
 * 
 * Adjusts agent strategy weights and thresholds based on global consensus data.
 * Facilitates coordination between independent agents through consensus-based
 * parameter tuning.
 */

import { TrendDirection } from '../global/TrendConsensusEngine.js';
import { TrendConsensusEngine } from '../global/TrendConsensusEngine.js';
import { StrategyConfig } from '../../strategies/engine/weights.js';

/**
 * Interface for Redis operations needed by this class
 */
interface RedisInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<any>;
}

export class StrategyConsensusAdapter {
  constructor(
    private readonly consensusEngine: TrendConsensusEngine,
    private readonly redis: RedisInterface
  ) {}

  /**
   * Apply consensus-based adjustments to strategy thresholds
   * @param agentId ID of the agent owning the strategies
   * @param strategies Array of strategy configurations
   */
  async applyConsensusAdjustments(agentId: string, strategies: StrategyConfig[]): Promise<void> {
    // Get global consensus data
    const consensus = await this.consensusEngine.calculateConsensus();
    const detailedConsensus = await this.consensusEngine.calculateDetailedConsensus();
    
    for (const strategy of strategies) {
      // Create a key from asset and timeframe
      // Note: Default strategy configs don't have timeframe, so we'll assume "1h" as default
      const timeframe = strategy.lookbackWindow ? `${Math.floor(strategy.lookbackWindow / 60)}m` : '1h';
      const key = `${strategy.asset}:${timeframe}`;
      
      // Check if we have consensus for this key
      const globalDirection = consensus[key];
      const detailedInfo = detailedConsensus[key];
      
      if (!globalDirection) {
        continue; // No consensus data for this asset/timeframe
      }
      
      // Get current threshold for this strategy
      const thresholdKey = `agent:${agentId}:strategy:${strategy.strategyId}:threshold`;
      const currentThresholdStr = await this.redis.get(thresholdKey);
      const currentThreshold = currentThresholdStr ? parseFloat(currentThresholdStr) : strategy.threshold;
      
      // Calculate adjustment based on consensus
      let adjustedThreshold = currentThreshold;
      
      // Apply different adjustments based on global market direction
      // For uptrend: lower the entry threshold (making it easier to enter)
      // For downtrend: raise the entry threshold (making it harder to enter)
      // The strength of adjustment depends on consensus confidence
      if (detailedInfo) {
        const confidenceFactor = detailedInfo.confidence;
        const signalStrength = Math.min(0.2, confidenceFactor * 0.1); // Cap at 20% adjustment
        
        if (globalDirection === 'up') {
          // In uptrend, make it easier to enter (lower threshold)
          adjustedThreshold = currentThreshold * (1 - signalStrength);
        } else if (globalDirection === 'down') {
          // In downtrend, make it harder to enter (raise threshold)
          adjustedThreshold = currentThreshold * (1 + signalStrength);
        }
        
        // Ensure threshold stays within reasonable bounds (0.2 to 0.9)
        adjustedThreshold = Math.max(0.2, Math.min(0.9, adjustedThreshold));
      }
      
      // Store the updated threshold
      await this.redis.set(thresholdKey, adjustedThreshold.toFixed(3));
    }
  }
  
  /**
   * Get current consensus-adjusted threshold for a strategy
   * @param agentId ID of the agent owning the strategy
   * @param strategyId Strategy identifier
   * @param defaultThreshold Default threshold to use if no adjustment exists
   * @returns The adjusted threshold value
   */
  async getAdjustedThreshold(
    agentId: string, 
    strategyId: string, 
    defaultThreshold: number
  ): Promise<number> {
    const thresholdKey = `agent:${agentId}:strategy:${strategyId}:threshold`;
    const value = await this.redis.get(thresholdKey);
    
    return value ? parseFloat(value) : defaultThreshold;
  }
} 