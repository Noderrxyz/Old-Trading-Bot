/**
 * Temporal Risk Model
 * 
 * Analyzes time-based patterns in market metrics to generate risk profiles
 * that can be used to adjust trading strategies based on time of day.
 */

import { TemporalMetricsStore } from '../services/metrics/TemporalMetricsStore.js';
import { TimeOfDayProfile, TemporalMetrics } from '../types/temporal.types.js';

/**
 * Helper function to calculate average of an array of numbers
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Model for analyzing time-of-day trading patterns
 */
export class TemporalRiskModel {
  /**
   * Create a new temporal risk model
   * @param store Metrics store for retrieving historical data
   */
  constructor(private readonly store: TemporalMetricsStore) {}

  /**
   * Generate a risk profile for each hour of the day
   * @param asset Asset identifier
   * @returns Array of hourly risk profiles
   */
  async getRiskProfile(asset: string): Promise<TimeOfDayProfile[]> {
    const hourly = await this.store.getHourlyProfile(asset);
    const profile: TimeOfDayProfile[] = [];

    for (let hour = 0; hour < 24; hour++) {
      const data = hourly[hour] || [];
      
      // Skip hours with insufficient data
      if (data.length < 5) {
        profile.push(this.getDefaultProfileForHour(hour));
        continue;
      }
      
      const spreadAvg = average(data.map(m => m.spreadAvg));
      const volatility = average(data.map(m => m.volatility));
      const slippage = average(data.map(m => m.slippage));
      const alphaDecay = average(data.map(m => m.alphaDecay));
      
      // Calculate confidence adjustment based on alpha decay
      // Negative adjustment for high decay, positive for negative decay (alpha growth)
      const confidenceAdjustment = this.calculateConfidenceAdjustment(alphaDecay);
      
      profile.push({
        hour,
        avgSpread: spreadAvg,
        avgVolatility: volatility,
        avgSlippage: slippage,
        alphaDecayRate: alphaDecay,
        confidenceAdjustment
      });
    }
    
    return profile;
  }
  
  /**
   * Get risk profile for the current hour
   * @param asset Asset identifier
   * @returns Current hour's risk profile
   */
  async getCurrentHourProfile(asset: string): Promise<TimeOfDayProfile> {
    const currentHour = new Date().getUTCHours();
    const profile = await this.getRiskProfile(asset);
    return profile[currentHour];
  }
  
  /**
   * Calculate confidence adjustment based on alpha decay rate
   * @param alphaDecay Alpha decay rate
   * @returns Confidence adjustment factor (-0.3 to 0.3)
   */
  private calculateConfidenceAdjustment(alphaDecay: number): number {
    // High decay rates (positive values) reduce confidence
    if (alphaDecay > 0.2) return -0.3;
    if (alphaDecay > 0.1) return -0.2;
    if (alphaDecay > 0.05) return -0.1;
    
    // Negative decay (alpha growth) increases confidence
    if (alphaDecay < -0.2) return 0.3;
    if (alphaDecay < -0.1) return 0.2;
    if (alphaDecay < -0.05) return 0.1;
    
    // Near-zero decay has minimal impact
    return 0;
  }
  
  /**
   * Get a default risk profile for an hour with insufficient data
   * @param hour Hour of the day
   * @returns Default risk profile for that hour
   */
  private getDefaultProfileForHour(hour: number): TimeOfDayProfile {
    // Market hours typically have better liquidity
    const isMarketHours = hour >= 8 && hour <= 16;
    
    return {
      hour,
      avgSpread: isMarketHours ? 0.05 : 0.1,
      avgVolatility: isMarketHours ? 0.2 : 0.3,
      avgSlippage: isMarketHours ? 0.1 : 0.15,
      alphaDecayRate: isMarketHours ? 0.05 : 0.1,
      confidenceAdjustment: isMarketHours ? 0 : -0.1
    };
  }
  
  /**
   * Save a new data point to update the temporal model
   * @param asset Asset identifier
   * @param metrics Current metrics to record
   */
  async recordMetrics(asset: string, metrics: TemporalMetrics): Promise<void> {
    await this.store.record(asset, metrics.hourBucket, metrics);
  }
} 