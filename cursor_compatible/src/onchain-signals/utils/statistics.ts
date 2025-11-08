/**
 * Statistical utilities for onchain signal models
 * 
 * Provides common statistical functions for analyzing time series data
 */

/**
 * Calculate the simple moving average for a time series
 * 
 * @param data The time series data array
 * @param period The period for the moving average
 * @returns The simple moving average value
 */
export function simpleMovingAverage(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) {
    return 0;
  }
  
  // Use the most recent 'period' elements
  const values = data.slice(-period);
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate the exponential moving average for a time series
 * 
 * @param data The time series data array
 * @param period The period for the EMA
 * @returns The exponential moving average value
 */
export function exponentialMovingAverage(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) {
    return 0;
  }
  
  // Use at most the last 3*period elements for calculation
  const relevantData = data.slice(-Math.min(data.length, period * 3));
  
  // Calculate the multiplier
  const alpha = 2 / (period + 1);
  
  // Start with SMA for the first 'period' elements
  let ema = simpleMovingAverage(relevantData.slice(0, period), period);
  
  // Calculate EMA for the remaining elements
  for (let i = period; i < relevantData.length; i++) {
    ema = relevantData[i] * alpha + ema * (1 - alpha);
  }
  
  return ema;
}

/**
 * Calculate the standard deviation for a data series
 * 
 * @param data The data array
 * @returns The standard deviation
 */
export function standardDeviation(data: number[]): number {
  if (data.length <= 1) {
    return 0;
  }
  
  // Calculate mean
  const mean = data.reduce((acc, val) => acc + val, 0) / data.length;
  
  // Calculate sum of squared differences
  const squaredDiffs = data.map(value => {
    const diff = value - mean;
    return diff * diff;
  });
  
  // Calculate variance and then standard deviation
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / data.length;
  return Math.sqrt(variance);
}

/**
 * Calculate the z-score (number of standard deviations from mean)
 * 
 * @param value The value to calculate z-score for
 * @param mean The mean of the distribution
 * @param stdDev The standard deviation of the distribution
 * @returns The z-score
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) {
    return 0;
  }
  return (value - mean) / stdDev;
}

/**
 * Detect if a value is an outlier based on z-score
 * 
 * @param value The value to check
 * @param data The reference data set
 * @param threshold The z-score threshold (default: 2.0)
 * @returns True if the value is an outlier
 */
export function isOutlier(value: number, data: number[], threshold = 2.0): boolean {
  const mean = data.reduce((acc, val) => acc + val, 0) / data.length;
  const stdDev = standardDeviation(data);
  const score = Math.abs(zScore(value, mean, stdDev));
  return score > threshold;
}

/**
 * Linear regression to find trends in time series data
 * Returns the slope of the regression line
 * 
 * @param yValues The y values (dependent variable)
 * @param xValues Optional x values (independent variable, defaults to [0,1,2,...])
 * @returns The slope of the regression line
 */
export function linearRegressionSlope(yValues: number[], xValues?: number[]): number {
  if (yValues.length <= 1) {
    return 0;
  }
  
  // If x values are not provided, use indices
  const x = xValues || Array.from({ length: yValues.length }, (_, i) => i);
  
  if (x.length !== yValues.length) {
    throw new Error('X and Y arrays must have the same length');
  }
  
  // Calculate means
  const n = yValues.length;
  const meanX = x.reduce((acc, val) => acc + val, 0) / n;
  const meanY = yValues.reduce((acc, val) => acc + val, 0) / n;
  
  // Calculate sums for regression formula
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - meanX) * (yValues[i] - meanY);
    denominator += (x[i] - meanX) * (x[i] - meanX);
  }
  
  // Avoid division by zero
  if (denominator === 0) {
    return 0;
  }
  
  // Return the slope
  return numerator / denominator;
} 