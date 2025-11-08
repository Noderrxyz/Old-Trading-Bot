/**
 * Volatility Calculator
 * 
 * Calculates realized volatility for trading pairs based on historical price data.
 */

import { createLogger } from '../common/logger.js';

/**
 * Configuration for the Volatility Calculator
 */
export interface VolatilityCalculatorConfig {
  /** Default volatility when no data is available */
  defaultVolatility: number;
  
  /** Window size in milliseconds for volatility calculation */
  windowSizeMs: number;
  
  /** Minimum number of data points required for volatility calculation */
  minDataPoints: number;
  
  /** Maximum volatility to report (higher values will be clamped) */
  maxVolatility: number;
  
  /** Volatility decay factor for smoothing (0-1) */
  decayFactor: number;
  
  /** Log detailed calculations */
  logDetailedCalculations: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: VolatilityCalculatorConfig = {
  defaultVolatility: 0.02, // 2%
  windowSizeMs: 24 * 60 * 60 * 1000, // 24 hours
  minDataPoints: 10,
  maxVolatility: 0.20, // 20%
  decayFactor: 0.95, // 5% weight to new readings
  logDetailedCalculations: false
};

/**
 * Price data point for volatility calculation
 */
interface PriceDataPoint {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  
  /** Price value */
  price: number;
}

/**
 * Volatility Calculator for computing realized volatility
 */
export class VolatilityCalculator {
  private readonly logger;
  private readonly config: VolatilityCalculatorConfig;
  private priceData: Map<string, PriceDataPoint[]>;
  private volatilityCache: Map<string, { volatility: number; lastUpdated: number }>;
  
  /**
   * Create a new Volatility Calculator
   * @param config Calculator configuration
   */
  constructor(config: Partial<VolatilityCalculatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('VolatilityCalculator');
    this.priceData = new Map();
    this.volatilityCache = new Map();
    
    this.logger.info('Volatility Calculator initialized');
  }
  
  /**
   * Add a new price data point
   * @param symbol Asset symbol
   * @param price Current price
   * @param timestamp Optional timestamp (defaults to now)
   */
  public addPriceData(symbol: string, price: number, timestamp?: number): void {
    const currentTime = timestamp || Date.now();
    
    // Get existing data for this symbol
    let symbolData = this.priceData.get(symbol);
    
    // Create new array if it doesn't exist
    if (!symbolData) {
      symbolData = [];
      this.priceData.set(symbol, symbolData);
    }
    
    // Add new data point
    symbolData.push({
      timestamp: currentTime,
      price
    });
    
    // Remove old data points outside the window
    const cutoffTime = currentTime - this.config.windowSizeMs;
    const newSymbolData = symbolData.filter(data => data.timestamp >= cutoffTime);
    
    // Update price data
    this.priceData.set(symbol, newSymbolData);
    
    // Invalidate cache for this symbol
    this.volatilityCache.delete(symbol);
    
    if (this.config.logDetailedCalculations) {
      this.logger.debug(`Added price data for ${symbol}: ${price.toFixed(6)} at ${new Date(currentTime).toISOString()}`);
      this.logger.debug(`Price data window size for ${symbol}: ${newSymbolData.length} points`);
    }
  }
  
  /**
   * Calculate realized volatility for a symbol
   * @param symbol Asset symbol
   * @returns Realized volatility (0-1 range)
   */
  public calculateVolatility(symbol: string): number {
    // Check cache first
    const cachedValue = this.volatilityCache.get(symbol);
    if (cachedValue && Date.now() - cachedValue.lastUpdated < 60000) { // 1 minute cache
      return cachedValue.volatility;
    }
    
    // Get price data for this symbol
    const symbolData = this.priceData.get(symbol);
    
    // If no data or not enough data, return default
    if (!symbolData || symbolData.length < this.config.minDataPoints) {
      this.logger.debug(`Insufficient data for ${symbol}, using default volatility`);
      return this.config.defaultVolatility;
    }
    
    // Sort data by timestamp
    const sortedData = [...symbolData].sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < sortedData.length; i++) {
      const prevPrice = sortedData[i - 1].price;
      const currentPrice = sortedData[i].price;
      
      // Skip if previous price is 0 or NaN
      if (!prevPrice) continue;
      
      // Log return = ln(current/previous)
      const logReturn = Math.log(currentPrice / prevPrice);
      returns.push(logReturn);
    }
    
    // Not enough return data
    if (returns.length < 2) {
      return this.config.defaultVolatility;
    }
    
    // Calculate mean return
    const meanReturn = returns.reduce((sum, val) => sum + val, 0) / returns.length;
    
    // Calculate sum of squared deviations
    const sumSquaredDeviations = returns.reduce(
      (sum, val) => sum + Math.pow(val - meanReturn, 2), 0
    );
    
    // Calculate variance and annualize
    const timeSpanMs = sortedData[sortedData.length - 1].timestamp - sortedData[0].timestamp;
    const timeSpanDays = timeSpanMs / (24 * 60 * 60 * 1000);
    const periodsPerYear = 365 / timeSpanDays;
    
    // Standard formula: annualized_vol = sample_std_dev * sqrt(periods_per_year)
    const variance = sumSquaredDeviations / (returns.length - 1);
    let volatility = Math.sqrt(variance * periodsPerYear);
    
    // Clamp to max volatility
    volatility = Math.min(volatility, this.config.maxVolatility);
    
    // Blend with previous value if available
    if (cachedValue) {
      volatility = (
        this.config.decayFactor * cachedValue.volatility +
        (1 - this.config.decayFactor) * volatility
      );
    }
    
    // Update cache
    this.volatilityCache.set(symbol, {
      volatility,
      lastUpdated: Date.now()
    });
    
    if (this.config.logDetailedCalculations) {
      this.logger.debug(`Calculated volatility for ${symbol}: ${volatility.toFixed(6)} (${(volatility * 100).toFixed(2)}%)`);
    }
    
    return volatility;
  }
  
  /**
   * Get volatility for multiple symbols
   * @param symbols Array of symbols to get volatility for
   * @returns Map of symbol to volatility
   */
  public getVolatilityMap(symbols: string[]): Map<string, number> {
    const volatilityMap = new Map<string, number>();
    
    for (const symbol of symbols) {
      volatilityMap.set(symbol, this.calculateVolatility(symbol));
    }
    
    return volatilityMap;
  }
  
  /**
   * Reset price data for a symbol
   * @param symbol Asset symbol
   */
  public resetData(symbol: string): void {
    this.priceData.delete(symbol);
    this.volatilityCache.delete(symbol);
  }
  
  /**
   * Reset all price data
   */
  public resetAllData(): void {
    this.priceData.clear();
    this.volatilityCache.clear();
  }
  
  /**
   * Get current volatility cache
   * @returns Map of symbol to volatility
   */
  public getVolatilityCache(): Map<string, number> {
    const result = new Map<string, number>();
    
    for (const [symbol, data] of this.volatilityCache.entries()) {
      result.set(symbol, data.volatility);
    }
    
    return result;
  }
} 