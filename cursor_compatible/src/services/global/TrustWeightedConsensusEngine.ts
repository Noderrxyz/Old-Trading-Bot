/**
 * Trust-Weighted Consensus Engine
 * 
 * Enhanced version of the trend consensus engine that incorporates
 * agent trust scores to give more weight to reliable agents.
 */

import { TrendSignal } from '../../types/global.types.js';
import { TrendSignalAggregator } from './TrendSignalAggregator.js';
import { TrendConsensusEngine, TrendDirection, ConsensusResult } from './TrendConsensusEngine.js';

/**
 * Service for retrieving agent trust scores
 */
export interface TrustScoreProvider {
  /**
   * Get trust score for an agent
   * @param agentId Agent identifier
   * @returns Trust score between 0 and 1
   */
  getAgentTrustScore(agentId: string): Promise<number>;
}

/**
 * Enhanced consensus engine that weights signals by agent trust scores
 */
export class TrustWeightedConsensusEngine extends TrendConsensusEngine {
  constructor(
    private readonly trustProvider: TrustScoreProvider,
    aggregator: TrendSignalAggregator
  ) {
    super(aggregator);
  }

  /**
   * Calculate detailed consensus including confidence levels, weighted by agent trust
   * @returns Record of asset:timeframe keys mapped to detailed consensus info
   */
  override async calculateDetailedConsensus(): Promise<Record<string, ConsensusResult>> {
    const signals = await this.aggregator.getRecent();
    const grouped: Record<string, TrendSignal[]> = {};

    // Group signals by asset and timeframe
    for (const signal of signals) {
      const key = `${signal.asset}:${signal.timeframe}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(signal);
    }

    // Calculate consensus for each group
    const result: Record<string, ConsensusResult> = {};
    
    for (const [key, group] of Object.entries(grouped)) {
      // Get trust scores for all agents in this group
      const trustScores = await Promise.all(
        group.map(signal => this.trustProvider.getAgentTrustScore(signal.agentId))
      );
      
      // Initialize scores for each direction
      const scores: Record<TrendDirection, number> = { 
        up: 0, 
        down: 0, 
        neutral: 0 
      };
      
      // Apply trust-weighted voting
      for (let i = 0; i < group.length; i++) {
        const signal = group[i];
        // Get trust score and ensure minimum weight of 0.1
        const trustScore = Math.max(0.1, trustScores[i]);
        
        // Weight the confidence by trust score
        // This gives more influence to highly trusted agents
        scores[signal.direction] += signal.confidence * trustScore;
      }
      
      // Find the direction with the highest score
      const sortedScores = Object.entries(scores).sort((a, b) => 
        b[1] - a[1]
      ) as [TrendDirection, number][];
      
      const totalScore = sortedScores.reduce((sum, [_, score]) => sum + score, 0);
      const dominantDirection = sortedScores[0][0];
      const dominantScore = sortedScores[0][1];
      
      // Calculate confidence as the ratio of dominant score to total score
      const confidence = totalScore > 0 ? dominantScore / totalScore : 0;
      
      result[key] = {
        direction: dominantDirection,
        confidence,
        signalCount: group.length
      };
    }

    return result;
  }
  
  /**
   * Get the raw weighted scores for each direction
   * This can be useful for detailed analysis and debugging
   * @returns Record of asset:timeframe keys mapped to raw score data
   */
  async getRawWeightedScores(): Promise<Record<string, Record<TrendDirection, number>>> {
    const signals = await this.aggregator.getRecent();
    const grouped: Record<string, TrendSignal[]> = {};

    // Group signals by asset and timeframe
    for (const signal of signals) {
      const key = `${signal.asset}:${signal.timeframe}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(signal);
    }

    // Calculate raw scores for each group
    const result: Record<string, Record<TrendDirection, number>> = {};
    
    for (const [key, group] of Object.entries(grouped)) {
      // Get trust scores for all agents in this group
      const trustScores = await Promise.all(
        group.map(signal => this.trustProvider.getAgentTrustScore(signal.agentId))
      );
      
      // Initialize scores for each direction
      result[key] = { 
        up: 0, 
        down: 0, 
        neutral: 0 
      };
      
      // Apply trust-weighted voting
      for (let i = 0; i < group.length; i++) {
        const signal = group[i];
        // Get trust score and ensure minimum weight of 0.1
        const trustScore = Math.max(0.1, trustScores[i]);
        
        // Weight the confidence by trust score
        result[key][signal.direction] += signal.confidence * trustScore;
      }
    }

    return result;
  }
} 