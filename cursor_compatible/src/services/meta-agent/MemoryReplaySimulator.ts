/**
 * Memory Replay Simulator
 * 
 * Reconstructs agent state/action/outcome sequences for a given time period
 * to enable offline analysis and learning from past decisions.
 */

import { AgentMemoryEntry } from '../../types/metaAgent.types.js';
import { MemoryManager } from './MemoryManager.js';

/**
 * Simulator for replaying agent memory sequences
 */
export class MemoryReplaySimulator {
  constructor(private readonly memoryManager: MemoryManager) {}

  /**
   * Replay a sequence of memory entries in chronological order
   * @param limit Maximum number of entries to replay
   * @returns Chronologically sorted memory entries
   */
  async replay(limit = 1000): Promise<AgentMemoryEntry[]> {
    // Retrieve recent memories from the memory manager
    const entries = await this.memoryManager.getRecentMemories(limit);
    
    // Sort entries by timestamp to ensure chronological order
    return entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * Replay memories for a specific strategy
   * @param strategyId The ID of the strategy to replay
   * @param limit Maximum number of entries to replay
   * @returns Chronologically sorted memory entries for the strategy
   */
  async replayStrategy(strategyId: string, limit = 1000): Promise<AgentMemoryEntry[]> {
    const entries = await this.memoryManager.getMemoriesByStrategy(strategyId, limit);
    return entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * Generate a reward curve from memory replay
   * @param strategyId Optional strategy ID to filter by
   * @returns Array of cumulative reward values
   */
  async simulateRewardCurve(strategyId?: string): Promise<{
    timestamps: number[];
    cumulativeRewards: number[];
    outcomes: number[];
  }> {
    // Get memories to analyze (filtered by strategy if provided)
    const log = strategyId 
      ? await this.replayStrategy(strategyId)
      : await this.replay();
    
    // Initialize tracking variables
    let cumulativeReward = 0;
    const cumulativeRewards: number[] = [];
    const timestamps: number[] = [];
    const outcomes: number[] = [];
    
    // Process each memory entry chronologically
    for (const entry of log) {
      // Skip entries without outcomes
      if (entry.outcome === undefined) continue;
      
      // Add the outcome to the cumulative reward
      cumulativeReward += entry.outcome;
      
      // Record values for the curves
      cumulativeRewards.push(cumulativeReward);
      timestamps.push(entry.timestamp || 0);
      outcomes.push(entry.outcome);
    }
    
    return {
      timestamps,
      cumulativeRewards,
      outcomes
    };
  }

  /**
   * Calculate performance metrics for a time period
   * @param strategyId Optional strategy ID to filter by
   * @returns Analyzed performance metrics
   */
  async calculatePerformanceMetrics(strategyId?: string): Promise<{
    winRate: number;
    profitFactor: number;
    averageOutcome: number;
    totalEntries: number;
  }> {
    // Get memories to analyze
    const log = strategyId 
      ? await this.replayStrategy(strategyId)
      : await this.replay();
    
    // Filter out entries without outcomes
    const entriesWithOutcomes = log.filter(entry => entry.outcome !== undefined);
    
    if (entriesWithOutcomes.length === 0) {
      return {
        winRate: 0,
        profitFactor: 0,
        averageOutcome: 0,
        totalEntries: 0
      };
    }
    
    // Calculate metrics
    const wins = entriesWithOutcomes.filter(entry => (entry.outcome || 0) > 0).length;
    const totalProfit = entriesWithOutcomes
      .filter(entry => (entry.outcome || 0) > 0)
      .reduce((sum, entry) => sum + (entry.outcome || 0), 0);
    
    const totalLoss = Math.abs(
      entriesWithOutcomes
        .filter(entry => (entry.outcome || 0) < 0)
        .reduce((sum, entry) => sum + (entry.outcome || 0), 0)
    );
    
    const totalOutcome = entriesWithOutcomes.reduce((sum, entry) => sum + (entry.outcome || 0), 0);
    
    return {
      winRate: wins / entriesWithOutcomes.length,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
      averageOutcome: totalOutcome / entriesWithOutcomes.length,
      totalEntries: entriesWithOutcomes.length
    };
  }
} 