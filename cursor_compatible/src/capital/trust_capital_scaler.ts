/**
 * Trust-Weighted Capital Scaling System
 * 
 * Dynamically allocates capital to strategies based on trust scores and recent alpha.
 */

import { StrategyMetrics } from '../strategy/types/strategy.types.js';
import { logger } from '../utils/logger.js';

/**
 * Trust Capital Scaler Configuration
 */
interface TrustCapitalScalerConfig {
  trustWeight: number;          // Weight for trust score in allocation
  alphaWeight: number;          // Weight for recent alpha in allocation
  maxAllocationPct: number;     // Maximum allocation percentage
  minAllocationPct: number;     // Minimum allocation percentage
  alphaLookback: number;        // Number of periods to look back for alpha
  updateIntervalMs: number;     // Update interval in milliseconds
}

const DEFAULT_CONFIG: TrustCapitalScalerConfig = {
  trustWeight: 0.6,
  alphaWeight: 0.4,
  maxAllocationPct: 0.3,
  minAllocationPct: 0.05,
  alphaLookback: 30,
  updateIntervalMs: 60000
};

/**
 * Trust Capital Scaler
 * 
 * Dynamically allocates capital to strategies based on trust scores and recent alpha.
 */
export class TrustCapitalScaler {
  private config: TrustCapitalScalerConfig;
  private strategyMetrics: Map<string, StrategyMetrics>;
  private allocations: Map<string, number>;
  private updateInterval: NodeJS.Timeout | null;
  private logger: typeof logger;

  constructor(config: Partial<TrustCapitalScalerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.strategyMetrics = new Map();
    this.allocations = new Map();
    this.updateInterval = null;
    this.logger = logger;
  }

  /**
   * Start the capital scaler
   */
  start(): void {
    if (this.updateInterval) {
      this.logger.warn('Scaler already running');
      return;
    }

    this.updateInterval = setInterval(() => {
      this.updateAllocations();
    }, this.config.updateIntervalMs);

    this.logger.info('Started capital scaler');
  }

  /**
   * Stop the capital scaler
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.logger.info('Stopped capital scaler');
  }

  /**
   * Update strategy metrics
   */
  updateStrategyMetrics(strategyId: string, metrics: StrategyMetrics): void {
    this.strategyMetrics.set(strategyId, metrics);
    this.logger.debug(`Updated metrics for strategy ${strategyId}`);
  }

  /**
   * Calculate recent alpha for a strategy
   */
  private calculateRecentAlpha(metrics: StrategyMetrics): number {
    const recentPnL = metrics.recentPnL.slice(-this.config.alphaLookback);
    if (recentPnL.length === 0) return 0;
    
    const avgPnL = recentPnL.reduce((sum: number, pnl: number) => sum + pnl, 0) / recentPnL.length;
    return avgPnL / metrics.volatility || 1;
  }

  /**
   * Update capital allocations
   */
  private updateAllocations(): void {
    if (this.strategyMetrics.size === 0) {
      this.logger.warn('No strategy metrics available');
      return;
    }

    // Calculate weights for each strategy
    const weights = new Map<string, number>();
    let totalWeight = 0;

    for (const [strategyId, metrics] of this.strategyMetrics) {
      const trustScore = metrics.trustScore;
      const recentAlpha = this.calculateRecentAlpha(metrics);
      
      const weight = (trustScore * this.config.trustWeight) + 
                    (recentAlpha * this.config.alphaWeight);
      
      weights.set(strategyId, weight);
      totalWeight += weight;
    }

    // Normalize and apply allocation limits
    for (const [strategyId, weight] of weights) {
      const normalizedWeight = weight / totalWeight;
      const allocation = this.clamp(
        normalizedWeight,
        this.config.minAllocationPct,
        this.config.maxAllocationPct
      );
      
      this.allocations.set(strategyId, allocation);
      this.logger.debug(`Allocated ${(allocation * 100).toFixed(2)}% to strategy ${strategyId}`);
    }
  }

  /**
   * Get current allocation for a strategy
   */
  getAllocation(strategyId: string): number {
    return this.allocations.get(strategyId) || this.config.minAllocationPct;
  }

  /**
   * Get all current allocations
   */
  getAllAllocations(): Map<string, number> {
    return new Map(this.allocations);
  }

  /**
   * Clamp a value between min and max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
} 