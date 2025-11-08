/**
 * Temporal Risk Models + Time-of-Day Intelligence
 * 
 * Types for tracking time-based patterns in trading metrics, allowing the system
 * to adapt execution strategies, signal weightings, and risk controls based on
 * temporal patterns.
 */

/**
 * Metrics aggregated by time period
 */
export interface TemporalMetrics {
  timestamp: string; // ISO string
  hourBucket: number; // 0-23
  spreadAvg: number;
  volatility: number;
  slippage: number;
  alphaDecay: number;
  winRate: number;
}

/**
 * Time of day risk profile with average metrics
 */
export interface TimeOfDayProfile {
  hour: number;
  avgSpread: number;
  avgVolatility: number;
  avgSlippage: number;
  alphaDecayRate: number;
  confidenceAdjustment: number;
} 