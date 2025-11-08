/**
 * Trend Consensus Engine
 * 
 * Calculates consensus among trend signals from multiple agents
 * to identify dominant market trends.
 */

import { TrendSignal } from '../../types/global.types.js';
import { TrendSignalAggregator } from './TrendSignalAggregator.js';

export type TrendDirection = 'up' | 'down' | 'neutral';

export interface ConsensusResult {
  direction: TrendDirection;
  confidence: number;
  signalCount: number;
}

export class TrendConsensusEngine {
  constructor(protected readonly aggregator: TrendSignalAggregator) {}

  /**
   * Calculate consensus across all assets and timeframes
   * @returns Record of asset:timeframe keys mapped to their consensus direction
   */
  async calculateConsensus(): Promise<Record<string, TrendDirection>> {
    const signals = await this.aggregator.getRecent();
    const consensusDetails = await this.calculateDetailedConsensus();
    
    const result: Record<string, TrendDirection> = {};
    
    for (const [key, consensus] of Object.entries(consensusDetails)) {
      result[key] = consensus.direction;
    }
    
    return result;
  }

  /**
   * Calculate detailed consensus including confidence levels
   * @returns Record of asset:timeframe keys mapped to detailed consensus info
   */
  async calculateDetailedConsensus(): Promise<Record<string, ConsensusResult>> {
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
      const scores: Record<TrendDirection, number> = { 
        up: 0, 
        down: 0, 
        neutral: 0 
      };
      
      // Sum confidence scores by direction
      for (const signal of group) {
        scores[signal.direction] += signal.confidence;
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
} 