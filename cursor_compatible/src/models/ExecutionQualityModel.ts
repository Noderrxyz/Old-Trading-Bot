/**
 * Execution Quality Model
 * 
 * Computes Fill IQ scores and other execution quality metrics
 * to evaluate and compare venue performance.
 */

import { ExecutionTelemetry } from '../types/execution.types.js';
import { average } from '../utils/analyzeAdverseSelection.js';

/**
 * Fill quality weight factors
 */
export interface FillQualityWeights {
  slippageWeight: number;
  adverseSelectionWeight: number;
  timeToFillWeight: number;
}

/**
 * Default weights for Fill IQ calculation
 */
const DEFAULT_WEIGHTS: FillQualityWeights = {
  slippageWeight: 0.5,        // 50% weight on slippage
  adverseSelectionWeight: 0.4, // 40% weight on adverse selection
  timeToFillWeight: 0.1       // 10% weight on time to fill
};

/**
 * Compute a Fill IQ score based on execution telemetry
 * @param fill Execution telemetry data
 * @param weights Optional custom weights for different factors
 * @returns Fill IQ score (0-100, higher is better)
 */
export function computeFillIQ(
  fill: ExecutionTelemetry,
  weights: FillQualityWeights = DEFAULT_WEIGHTS
): number {
  // Calculate slippage penalty (higher slippage = lower score)
  // Cap at 10% to avoid extreme outliers dominating the score
  const slippagePenalty = Math.min(Math.abs(fill.slippage) * 100, 10); 
  
  // Calculate adverse selection penalty (higher postFillDelta = lower score)
  // Cap at 10% for the same reason
  const adversePenalty = Math.min(Math.abs(fill.postFillDelta) * 100, 10);
  
  // Compute weighted penalties
  const weightedSlippagePenalty = slippagePenalty * weights.slippageWeight;
  const weightedAdversePenalty = adversePenalty * weights.adverseSelectionWeight;
  
  // Compute base fill IQ (100 - penalties)
  const iq = 100 - weightedSlippagePenalty - weightedAdversePenalty;
  
  // Ensure the result is within 0-100 range
  return Math.max(0, Math.min(100, iq));
}

/**
 * Group execution telemetry by venue and compute average Fill IQ
 * @param telemetry Array of execution telemetry data
 * @param weights Optional weights for Fill IQ calculation
 * @returns Record mapping venue IDs to average Fill IQ scores
 */
export function getFillIQByVenue(
  telemetry: ExecutionTelemetry[],
  weights: FillQualityWeights = DEFAULT_WEIGHTS
): Record<string, number> {
  // Group telemetry by venue
  const byVenue: Record<string, ExecutionTelemetry[]> = {};
  
  for (const fill of telemetry) {
    if (!byVenue[fill.venue]) {
      byVenue[fill.venue] = [];
    }
    byVenue[fill.venue].push(fill);
  }
  
  // Compute average Fill IQ for each venue
  const result: Record<string, number> = {};
  
  for (const [venue, fills] of Object.entries(byVenue)) {
    // Compute Fill IQ for each fill
    const scores = fills.map(fill => computeFillIQ(fill, weights));
    
    // Calculate average
    result[venue] = average(scores);
  }
  
  return result;
}

/**
 * Get a list of venues sorted by Fill IQ performance
 * @param telemetry Array of execution telemetry data
 * @param minFills Minimum number of fills required to include a venue
 * @param weights Optional weights for Fill IQ calculation
 * @returns Array of venues sorted by performance (best first)
 */
export function getVenuesByPerformance(
  telemetry: ExecutionTelemetry[],
  minFills: number = 5,
  weights: FillQualityWeights = DEFAULT_WEIGHTS
): { venue: string; fillIQ: number; fillCount: number }[] {
  // Group telemetry by venue
  const byVenue: Record<string, ExecutionTelemetry[]> = {};
  
  for (const fill of telemetry) {
    if (!byVenue[fill.venue]) {
      byVenue[fill.venue] = [];
    }
    byVenue[fill.venue].push(fill);
  }
  
  // Calculate scores and filter by minimum fills
  const venueScores = Object.entries(byVenue)
    .filter(([_, fills]) => fills.length >= minFills)
    .map(([venue, fills]) => {
      const scores = fills.map(fill => computeFillIQ(fill, weights));
      return {
        venue,
        fillIQ: average(scores),
        fillCount: fills.length
      };
    });
  
  // Sort by fill IQ (descending)
  return venueScores.sort((a, b) => b.fillIQ - a.fillIQ);
} 