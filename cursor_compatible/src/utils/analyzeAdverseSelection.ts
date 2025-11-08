/**
 * Adverse Selection Analysis
 * 
 * Analyzes post-trade price movements to detect adverse selection,
 * which occurs when the market moves against a trader immediately after execution.
 */

import { ExecutionTelemetry } from '../types/execution.types.js';

/**
 * Calculate the average value of an array
 * @param values Array of values to average
 * @returns The average value
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Analyze a price series for adverse selection after a fill
 * @param fill Execution telemetry data
 * @param priceSeries Array of prices after the fill
 * @param window Number of price points to analyze
 * @returns Adverse selection score (positive = good fill, negative = adverse)
 */
export function analyzeAdverseSelection(
  fill: ExecutionTelemetry, 
  priceSeries: number[],
  window: number = 5
): number {
  const { filledPrice, side } = fill;
  
  // Ensure we have enough data points
  const dataPoints = Math.min(window, priceSeries.length);
  if (dataPoints === 0) return 0;
  
  // Calculate price movement relative to our trade direction
  // For buys, price going up after our fill is bad (negative score)
  // For sells, price going down after our fill is bad (negative score)
  const postFillMove = priceSeries.slice(0, dataPoints).map(price => {
    const priceDiff = price - filledPrice;
    return side === 'buy' ? -priceDiff : priceDiff;
  });
  
  // Return average movement as our adverse selection score
  // Positive means price moved in our favor (good)
  // Negative means price moved against us (adverse selection)
  return average(postFillMove);
}

/**
 * Calculate a normalized adverse selection score between 0-1
 * @param fill Execution telemetry data
 * @param priceSeries Array of prices after the fill
 * @param window Number of price points to analyze
 * @param maxMovement Maximum expected price movement to normalize against
 * @returns Normalized adverse selection score (0 = worst, 1 = best)
 */
export function normalizedAdverseSelectionScore(
  fill: ExecutionTelemetry,
  priceSeries: number[],
  window: number = 5,
  maxMovement: number = 0.01 // 1% as default max movement
): number {
  const score = analyzeAdverseSelection(fill, priceSeries, window);
  
  // Normalize the score to a 0-1 range
  // 0 = worst adverse selection (price moved against us by maxMovement or more)
  // 1 = best outcome (price moved in our favor by maxMovement or more)
  const normalizedScore = 0.5 + (score / (2 * maxMovement));
  
  // Clamp the result to the 0-1 range
  return Math.max(0, Math.min(1, normalizedScore));
}

/**
 * Detect if a fill likely suffered from adverse selection
 * @param fill Execution telemetry data
 * @param priceSeries Array of prices after the fill
 * @param threshold Negative threshold to classify as adverse selection
 * @returns True if adverse selection likely occurred
 */
export function hasAdverseSelection(
  fill: ExecutionTelemetry,
  priceSeries: number[],
  threshold: number = -0.001 // -0.1% as default threshold
): boolean {
  const score = analyzeAdverseSelection(fill, priceSeries);
  return score < threshold;
} 