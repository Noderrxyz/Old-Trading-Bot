/**
 * Regret Scorer Engine
 * 
 * Analyzes past decisions to calculate regret scores based on the difference
 * between actual outcomes and hypothetical optimal outcomes.
 */

import { AgentMemoryEntry } from '../../types/metaAgent.types.js';
import { MemoryReplaySimulator } from './MemoryReplaySimulator.js';

export interface RegretAnalysisResult {
  memoryId: string;
  strategyId: string;
  timestamp: number;
  actionTaken: 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'EVALUATION' | 'ANALYSIS';
  context: any;
  actualOutcome: number;
  optimalOutcome: number;
  regretScore: number;
  confidenceLevel: number;
}

export class RegretScorerEngine {
  constructor(
    private readonly memoryReplaySimulator: MemoryReplaySimulator,
    private readonly contextComparisonThreshold = 0.8,
    private readonly confidenceThreshold = 0.7
  ) {}

  /**
   * Analyze a batch of memory entries to calculate regret scores
   * @param memories Array of memory entries to analyze
   * @returns Array of regret analysis results
   */
  async calculateRegretScores(memories: AgentMemoryEntry[]): Promise<RegretAnalysisResult[]> {
    const results: RegretAnalysisResult[] = [];
    
    // Group memories by context similarity
    const contextGroups = this.groupByContextSimilarity(memories);
    
    // Process each context group
    for (const group of contextGroups) {
      // Find the optimal outcome within this context group
      const optimalOutcome = Math.max(...group.map(entry => entry.outcome || 0));
      
      // Calculate regret for each entry in the group
      for (const entry of group) {
        // Skip entries without outcomes
        if (entry.outcome === undefined) continue;
        
        // Calculate the confidence based on sample size and consistency
        const confidenceLevel = this.calculateConfidenceLevel(group);
        
        // Calculate regret as the difference between optimal and actual outcomes
        const regretScore = optimalOutcome - entry.outcome;
        
        results.push({
          memoryId: entry.id || '',
          strategyId: entry.strategyId || '',
          timestamp: entry.timestamp || 0,
          actionTaken: entry.actionType,
          context: entry.context,
          actualOutcome: entry.outcome,
          optimalOutcome,
          regretScore,
          confidenceLevel
        });
      }
    }
    
    return results;
  }

  /**
   * Calculate regret scores for a specific strategy
   * @param strategyId The ID of the strategy to analyze
   * @returns Array of regret analysis results
   */
  async calculateStrategyRegret(strategyId: string): Promise<RegretAnalysisResult[]> {
    // Get all memories for the strategy
    const memories = await this.memoryReplaySimulator.replayStrategy(strategyId);
    
    // Calculate regret scores for these memories
    return this.calculateRegretScores(memories);
  }

  /**
   * Calculate average regret and confidence for a strategy
   * @param strategyId The ID of the strategy to analyze
   * @returns Average regret and confidence metrics
   */
  async calculateAverageMetrics(strategyId: string): Promise<{
    averageRegret: number;
    averageConfidence: number;
    sampleSize: number;
  }> {
    const results = await this.calculateStrategyRegret(strategyId);
    
    if (results.length === 0) {
      return {
        averageRegret: 0,
        averageConfidence: 0,
        sampleSize: 0
      };
    }
    
    const totalRegret = results.reduce((sum, result) => sum + result.regretScore, 0);
    const totalConfidence = results.reduce((sum, result) => sum + result.confidenceLevel, 0);
    
    return {
      averageRegret: totalRegret / results.length,
      averageConfidence: totalConfidence / results.length,
      sampleSize: results.length
    };
  }

  /**
   * Group memory entries by context similarity
   * @param memories Array of memory entries
   * @returns Array of groups where each group contains similar contexts
   */
  private groupByContextSimilarity(memories: AgentMemoryEntry[]): AgentMemoryEntry[][] {
    const groups: AgentMemoryEntry[][] = [];
    
    // Simple implementation that groups by exact context key matching
    // In production, this should use more sophisticated similarity metrics
    const contextKeyGroups = new Map<string, AgentMemoryEntry[]>();
    
    for (const memory of memories) {
      if (!memory.context) continue;
      
      // Create a simple string key from the context's primary keys
      const contextKey = this.getContextSignature(memory.context);
      
      if (!contextKeyGroups.has(contextKey)) {
        contextKeyGroups.set(contextKey, []);
      }
      
      contextKeyGroups.get(contextKey)?.push(memory);
    }
    
    // Convert the map to array of groups
    for (const group of contextKeyGroups.values()) {
      if (group.length > 0) {
        groups.push(group);
      }
    }
    
    return groups;
  }

  /**
   * Generate a signature string from a context object
   * @param context Context object from memory entry
   * @returns String signature representing the context
   */
  private getContextSignature(context: any): string {
    if (!context) return 'null';
    
    // Extract key properties that define similar decision contexts
    // This is a simplified version - production would need more complex similarity
    const keyProps = ['asset', 'timeframe', 'marketCondition', 'signalType'];
    
    const sigParts: string[] = [];
    for (const key of keyProps) {
      if (context[key] !== undefined) {
        sigParts.push(`${key}:${context[key]}`);
      }
    }
    
    return sigParts.join('|') || JSON.stringify(Object.keys(context).sort());
  }

  /**
   * Calculate confidence level based on group consistency
   * @param group Group of similar memory entries
   * @returns Confidence level between 0 and 1
   */
  private calculateConfidenceLevel(group: AgentMemoryEntry[]): number {
    if (group.length <= 1) return 0.1; // Low confidence with just one sample
    
    // Extract outcomes, filtering out undefined
    const outcomes = group
      .map(entry => entry.outcome)
      .filter((outcome): outcome is number => outcome !== undefined);
    
    if (outcomes.length <= 1) return 0.1;
    
    // Calculate standard deviation to measure consistency
    const mean = outcomes.reduce((sum, val) => sum + val, 0) / outcomes.length;
    const squaredDiffs = outcomes.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / outcomes.length;
    const stdDev = Math.sqrt(variance);
    
    // Normalize standard deviation to a confidence level
    // Lower stdDev = higher confidence
    const maxStdDev = Math.abs(mean) || 1; // Avoid division by zero
    const normalizedStdDev = Math.min(stdDev / maxStdDev, 1);
    
    // Convert to confidence (1 - normalized stdDev)
    let confidence = 1 - normalizedStdDev;
    
    // Adjust confidence based on sample size
    // More samples = higher confidence
    const sampleSizeFactor = Math.min(group.length / 10, 1); // Max out at 10 samples
    
    // Combine factors, weighting sample size less than consistency
    confidence = (confidence * 0.7) + (sampleSizeFactor * 0.3);
    
    return Math.max(0.1, Math.min(confidence, 0.99)); // Clamp between 0.1 and 0.99
  }
} 