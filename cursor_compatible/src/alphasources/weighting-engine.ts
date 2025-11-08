/**
 * Alpha Weighting Engine
 * 
 * Dynamically assigns confidence weights to each alpha source based on recent
 * performance, volatility regime, and source trustworthiness.
 */

import { AlphaFrame } from './types.js';
import { createLogger } from '../common/logger.js';

/**
 * Performance data for a single alpha source
 */
interface SourcePerformance {
  /** Current weight assigned to this source (0-1) */
  weight: number;
  
  /** Exponentially weighted average return */
  ewmaReturn: number;
  
  /** Exponentially weighted average squared return (for variance) */
  ewmaSquaredReturn: number;
  
  /** Number of alpha signals from this source */
  signalCount: number;
  
  /** Last timestamp this source was updated */
  lastUpdated: number;
  
  /** Last n return values (for Sharpe calculation) */
  recentReturns: number[];
  
  /** Historical Sharpe ratio */
  sharpeRatio: number;
  
  /** Number of profitable signals */
  profitableCount: number;
  
  /** Volatility regime performance map */
  volatilityPerformance: Map<string, number>;
  
  /** Unique symbols in recent signals (for diversity) */
  recentSymbols: Set<string>;
  
  /** Metrics for signal diversity evaluation */
  diversityScore: number;
}

/**
 * Volatility regime categories
 */
enum VolatilityRegime {
  LOW = 'low',     // Low volatility
  MEDIUM = 'med',  // Medium volatility
  HIGH = 'high'    // High volatility
}

/**
 * Configuration for the Alpha Weighting Engine
 */
interface WeightingEngineConfig {
  /** Default weight for new sources */
  defaultWeight: number;
  
  /** Weight decay factor (0-1) */
  weightDecay: number;
  
  /** EWMA factor for return averaging (0-1) */
  ewmaFactor: number;
  
  /** Maximum size of recent returns buffer */
  maxRecentReturns: number;
  
  /** Maximum number of recent symbols to track */
  maxRecentSymbols: number;
  
  /** Minimum weight threshold */
  minWeightThreshold: number;
  
  /** Minimum signal count before evaluating performance */
  minSignalCount: number;
  
  /** Whether to persist performance metrics */
  persistMetrics: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: WeightingEngineConfig = {
  defaultWeight: 1.0,
  weightDecay: 0.98,
  ewmaFactor: 0.1,
  maxRecentReturns: 100,
  maxRecentSymbols: 50,
  minWeightThreshold: 0.2,
  minSignalCount: 10,
  persistMetrics: false
};

/**
 * Alpha Weighting Engine for dynamic signal weighting
 */
export class AlphaWeightingEngine {
  private readonly logger;
  private readonly config: WeightingEngineConfig;
  private performanceData: Map<string, SourcePerformance>;
  private currentVolatilityRegime: VolatilityRegime;
  
  /**
   * Create a new Alpha Weighting Engine
   * @param config Engine configuration
   */
  constructor(config: Partial<WeightingEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('AlphaWeightingEngine');
    this.performanceData = new Map();
    this.currentVolatilityRegime = VolatilityRegime.MEDIUM;
    
    this.logger.info('Alpha Weighting Engine initialized');
  }
  
  /**
   * Update the current volatility regime
   * @param volatilityIndex Market volatility index (0-1)
   */
  public updateVolatilityRegime(volatilityIndex: number): void {
    const previousRegime = this.currentVolatilityRegime;
    
    if (volatilityIndex < 0.3) {
      this.currentVolatilityRegime = VolatilityRegime.LOW;
    } else if (volatilityIndex < 0.7) {
      this.currentVolatilityRegime = VolatilityRegime.MEDIUM;
    } else {
      this.currentVolatilityRegime = VolatilityRegime.HIGH;
    }
    
    if (previousRegime !== this.currentVolatilityRegime) {
      this.logger.info(`Volatility regime changed: ${previousRegime} → ${this.currentVolatilityRegime}`);
    }
  }
  
  /**
   * Update source performance with actual return
   * @param source Source name
   * @param actualReturn Actual return (positive = profit, negative = loss)
   * @param symbol Optional symbol that generated the signal
   */
  public updatePerformance(source: string, actualReturn: number, symbol?: string): void {
    let sourceData = this.performanceData.get(source);
    
    // Create new performance data if it doesn't exist
    if (!sourceData) {
      sourceData = this.createSourcePerformance();
      this.performanceData.set(source, sourceData);
    }
    
    // Update signal count
    sourceData.signalCount++;
    
    // Update EWMA return
    const alpha = this.config.ewmaFactor;
    sourceData.ewmaReturn = (alpha * actualReturn) + ((1 - alpha) * sourceData.ewmaReturn);
    sourceData.ewmaSquaredReturn = (alpha * actualReturn * actualReturn) + 
                                 ((1 - alpha) * sourceData.ewmaSquaredReturn);
    
    // Update recent returns buffer
    sourceData.recentReturns.push(actualReturn);
    if (sourceData.recentReturns.length > this.config.maxRecentReturns) {
      sourceData.recentReturns.shift();
    }
    
    // Update profitable count
    if (actualReturn > 0) {
      sourceData.profitableCount++;
    }
    
    // Update symbol diversity if provided
    if (typeof symbol === 'string') {
      sourceData.recentSymbols.add(symbol);
      // Maintain max size
      if (sourceData.recentSymbols.size > this.config.maxRecentSymbols) {
        this.removeOldestSymbol(sourceData.recentSymbols);
      }
    }
    
    // Update volatility regime performance
    const currentRegime = this.currentVolatilityRegime;
    const regimePerf = sourceData.volatilityPerformance.get(currentRegime) || 0;
    sourceData.volatilityPerformance.set(
      currentRegime, 
      (regimePerf * 0.9) + (0.1 * (actualReturn > 0 ? 1 : -1))
    );
    
    // Calculate Sharpe ratio if we have enough data
    if (sourceData.recentReturns.length >= 5) {
      const mean = sourceData.recentReturns.reduce((sum, val) => sum + val, 0) / 
                 sourceData.recentReturns.length;
      
      const variance = sourceData.recentReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / 
                     sourceData.recentReturns.length;
      
      const stdDev = Math.sqrt(variance);
      sourceData.sharpeRatio = stdDev > 0 ? mean / stdDev : 0;
    }
    
    // Calculate diversity score (0-1)
    const uniqueSymbolRatio = sourceData.recentSymbols.size / 
                            Math.min(sourceData.signalCount, this.config.maxRecentSymbols);
    sourceData.diversityScore = uniqueSymbolRatio;
    
    // Update weight based on performance metrics
    this.recalculateWeight(source, sourceData);
    
    sourceData.lastUpdated = Date.now();
    
    this.logger.debug(
      `Updated ${source} performance: weight=${sourceData.weight.toFixed(2)}, ` +
      `ewmaReturn=${sourceData.ewmaReturn.toFixed(4)}, ` +
      `sharpe=${sourceData.sharpeRatio.toFixed(2)}, ` +
      `diversity=${sourceData.diversityScore.toFixed(2)}`
    );
    
    // Persist metrics if configured
    if (this.config.persistMetrics) {
      this.persistPerformanceMetrics(source, sourceData);
    }
  }
  
  /**
   * Get the current weight for a source
   * @param source Source name
   * @returns Weight value (0-1)
   */
  public getWeight(source: string): number {
    const sourceData = this.performanceData.get(source);
    if (!sourceData) {
      return this.config.defaultWeight;
    }
    
    // Apply time decay if source hasn't been updated recently
    const now = Date.now();
    const daysSinceUpdate = (now - sourceData.lastUpdated) / (1000 * 60 * 60 * 24);
    
    // Decay weight by 2% per day of inactivity
    if (daysSinceUpdate > 1) {
      const decayFactor = Math.pow(this.config.weightDecay, daysSinceUpdate);
      sourceData.weight *= decayFactor;
      sourceData.lastUpdated = now;
      
      this.logger.debug(`Applied decay to ${source}: ${daysSinceUpdate.toFixed(1)} days inactive, new weight=${sourceData.weight.toFixed(2)}`);
    }
    
    return Math.max(sourceData.weight, this.config.minWeightThreshold);
  }
  
  /**
   * Score an alpha frame based on source performance
   * @param alpha Alpha frame to score
   * @returns Scored alpha frame with weight
   */
  public scoreAlpha(alpha: AlphaFrame): AlphaFrame & { weight: number } {
    const weight = this.getWeight(alpha.source);
    
    // Track symbol for diversity calculation on next update
    const sourceData = this.performanceData.get(alpha.source);
    if (sourceData && typeof alpha.symbol === 'string') {
      sourceData.recentSymbols.add(alpha.symbol);
      // Maintain max size
      if (sourceData.recentSymbols.size > this.config.maxRecentSymbols) {
        this.removeOldestSymbol(sourceData.recentSymbols);
      }
    }
    
    return {
      ...alpha,
      weight
    };
  }
  
  /**
   * Calculate confidence multiplier based on volatility regime match
   * @param sourceData Source performance data
   * @returns Confidence multiplier (0.8-1.2)
   */
  private getRegimeConfidence(sourceData: SourcePerformance): number {
    // Default confidence
    const defaultConfidence = 1.0;
    
    // If we don't have enough data, return default
    if (sourceData.signalCount < this.config.minSignalCount) {
      return defaultConfidence;
    }
    
    // Get current regime performance
    const regimePerf = sourceData.volatilityPerformance.get(this.currentVolatilityRegime);
    if (regimePerf === undefined) {
      return defaultConfidence;
    }
    
    // Scale regime performance to a confidence multiplier
    // Range: 0.8 (poor) to 1.2 (excellent)
    return 1.0 + (regimePerf * 0.2);
  }
  
  /**
   * Recalculate weight for a source based on performance
   * @param source Source name
   * @param sourceData Source performance data
   */
  private recalculateWeight(source: string, sourceData: SourcePerformance): void {
    // Don't adjust weight until we have enough signals
    if (sourceData.signalCount < this.config.minSignalCount) {
      return;
    }
    
    // Start with baseline weight
    let weight = sourceData.weight;
    
    // Adjust based on EWMA return
    // Positive returns boost weight, negative returns reduce it
    const returnFactor = 1.0 + (sourceData.ewmaReturn * 2);
    weight *= returnFactor;
    
    // Adjust based on Sharpe ratio
    // Higher Sharpe = better risk-adjusted returns
    const sharpeFactor = 1.0 + (Math.max(0, sourceData.sharpeRatio) * 0.1);
    weight *= sharpeFactor;
    
    // Adjust based on volatility regime performance
    const regimeFactor = this.getRegimeConfidence(sourceData);
    weight *= regimeFactor;
    
    // Adjust based on diversity score
    // Lower diversity = higher risk of overfitting
    const diversityFactor = 0.5 + (sourceData.diversityScore * 0.5);
    weight *= diversityFactor;
    
    // Normalize to 0-1 range
    weight = Math.max(0, Math.min(1, weight));
    
    // Apply minimum threshold
    weight = Math.max(weight, this.config.minWeightThreshold);
    
    sourceData.weight = weight;
  }
  
  /**
   * Create new performance data for a source
   * @returns Source performance data
   */
  private createSourcePerformance(): SourcePerformance {
    return {
      weight: this.config.defaultWeight,
      ewmaReturn: 0,
      ewmaSquaredReturn: 0,
      signalCount: 0,
      lastUpdated: Date.now(),
      recentReturns: [],
      sharpeRatio: 0,
      profitableCount: 0,
      volatilityPerformance: new Map(),
      recentSymbols: new Set(),
      diversityScore: 1.0
    };
  }
  
  /**
   * Get performance metrics for all sources
   * @returns Map of source names to performance metrics
   */
  public getPerformanceMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    for (const [source, data] of this.performanceData.entries()) {
      metrics[source] = {
        weight: data.weight,
        ewmaReturn: data.ewmaReturn,
        sharpeRatio: data.sharpeRatio,
        signalCount: data.signalCount,
        profitableRatio: data.signalCount > 0 ? data.profitableCount / data.signalCount : 0,
        diversityScore: data.diversityScore,
        regimePerformance: Object.fromEntries(data.volatilityPerformance),
        lastUpdated: data.lastUpdated
      };
    }
    
    return metrics;
  }
  
  /**
   * Get sources that meet the minimum weight threshold
   * @returns Array of source names
   */
  public getActiveSourcesAboveThreshold(): string[] {
    return Array.from(this.performanceData.entries())
      .filter(([_, data]) => data.weight >= this.config.minWeightThreshold)
      .map(([source]) => source);
  }
  
  /**
   * Persist performance metrics to storage
   * @param source Source name
   * @param data Source performance data
   */
  private persistPerformanceMetrics(source: string, data: SourcePerformance): void {
    // In a real implementation, this would persist to Redis, a database, or a file
    // For now, this is a placeholder
    this.logger.debug(`Would persist metrics for ${source} here if storage was configured`);
  }
  
  /**
   * Remove the oldest symbol from a Set
   * @param symbolSet Set of symbols
   */
  private removeOldestSymbol(symbolSet: Set<string>): void {
    if (symbolSet.size > 0) {
      const oldest = symbolSet.values().next().value;
      if (typeof oldest === 'string') {
        symbolSet.delete(oldest);
      }
    }
  }
  
  /**
   * Update the current market volatility value
   * @param volatility New volatility value (0-1)
   */
  public updateVolatility(volatility: number): void {
    // Clamp volatility to valid range
    const clampedVolatility = Math.max(0, Math.min(1, volatility));
    
    // Determine volatility regime based on volatility value
    if (clampedVolatility < 0.3) {
      this.updateVolatilityRegime(clampedVolatility);
    } else if (clampedVolatility < 0.7) {
      this.updateVolatilityRegime(clampedVolatility);
    } else {
      this.updateVolatilityRegime(clampedVolatility);
    }
    
    this.logger.debug(`Updated volatility to ${clampedVolatility.toFixed(4)}`);
  }
} 