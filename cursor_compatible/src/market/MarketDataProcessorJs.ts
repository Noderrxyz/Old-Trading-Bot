import { logger } from '../utils/logger';
import { 
  MarketTick, 
  MarketFeatures, 
  MarketAnomaly, 
  MarketDataProcessorConfig,
  AnomalyType
} from './MarketDataProcessorRust';

/**
 * JavaScript implementation of Market Data Processor
 * Used as a fallback when the native Rust implementation is unavailable
 */
export class MarketDataProcessorJs {
  // Configuration
  private config: MarketDataProcessorConfig;
  
  // Storage for tick history per symbol
  private tickHistory: Map<string, MarketTick[]> = new Map();
  
  // Storage for calculated features per symbol
  private features: Map<string, MarketFeatures> = new Map();
  
  // Storage for detected anomalies
  private anomalies: MarketAnomaly[] = [];
  
  // Timers for feature calculation and anomaly detection
  private featureTimer: NodeJS.Timeout | null = null;
  private anomalyTimer: NodeJS.Timeout | null = null;
  
  /**
   * Create a new MarketDataProcessorJs instance
   */
  constructor(config: MarketDataProcessorConfig) {
    this.config = config;
    
    // Initialize timers
    this.startTimers();
    
    logger.info('MarketDataProcessorJs initialized with config:', config);
  }
  
  /**
   * Start periodic timers for feature calculation and anomaly detection
   */
  private startTimers(): void {
    // Start feature calculation timer
    if (this.config.featureCalculationInterval > 0) {
      this.featureTimer = setInterval(() => {
        try {
          // Calculate features for all tracked symbols
          const symbols = Array.from(this.tickHistory.keys());
          for (const symbol of symbols) {
            this.calculateFeatures(symbol);
          }
        } catch (error: any) {
          logger.error(`Error in feature calculation timer: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, this.config.featureCalculationInterval);
    }

    // Start anomaly detection timer
    if (this.config.anomalyDetectionInterval > 0) {
      this.anomalyTimer = setInterval(() => {
        try {
          this.detectAnomalies();
        } catch (error: any) {
          logger.error(`Error in anomaly detection timer: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, this.config.anomalyDetectionInterval);
    }
  }
  
  /**
   * Stop all timers
   */
  private stopTimers(): void {
    if (this.featureTimer) {
      clearInterval(this.featureTimer);
      this.featureTimer = null;
    }

    if (this.anomalyTimer) {
      clearInterval(this.anomalyTimer);
      this.anomalyTimer = null;
    }
  }
  
  /**
   * Update configuration
   */
  public updateConfig(config: Partial<MarketDataProcessorConfig>): void {
    const oldConfig = this.config;
    this.config = { ...this.config, ...config };

    // Restart timers if intervals changed
    if (
      oldConfig.featureCalculationInterval !== this.config.featureCalculationInterval ||
      oldConfig.anomalyDetectionInterval !== this.config.anomalyDetectionInterval
    ) {
      this.stopTimers();
      this.startTimers();
    }
  }
  
  /**
   * Process a market tick
   * @param tick The market tick to process
   * @returns True if processing was successful
   */
  public processTick(tick: MarketTick): boolean {
    try {
      const symbol = tick.symbol;
      
      // Initialize history array if needed
      if (!this.tickHistory.has(symbol)) {
        this.tickHistory.set(symbol, []);
      }
      
      // Get history and add new tick
      const history = this.tickHistory.get(symbol)!;
      history.push({ ...tick });
      
      // Trim history if it exceeds max size
      if (history.length > this.config.maxTickHistory) {
        history.splice(0, history.length - this.config.maxTickHistory);
      }
      
      return true;
    } catch (error: any) {
      logger.error(`Error processing tick: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Calculate market features for a specific symbol
   * @param symbol The market symbol to calculate features for
   * @returns The calculated market features or null if calculation failed
   */
  public calculateFeatures(symbol: string): MarketFeatures | null {
    try {
      const history = this.tickHistory.get(symbol);
      if (!history || history.length < 2) {
        return null;
      }
      
      // Get the most recent tick
      const latestTick = history[history.length - 1];
      
      // Calculate basic features
      const features: MarketFeatures = {
        symbol,
        timestamp: Date.now(),
        volatility: this.calculateVolatility(history),
        volumeProfile: this.calculateVolumeProfile(history),
        momentum: this.calculateMomentumIndicators(history)
      };
      
      // Store features
      this.features.set(symbol, features);
      
      return features;
    } catch (error: any) {
      logger.error(`Error calculating features for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Calculate volatility from tick history
   * @param history Tick history
   * @returns The calculated volatility
   */
  private calculateVolatility(history: MarketTick[]): number {
    if (history.length < 2) return 0;
    
    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prevPrice = history[i - 1].price;
      const currentPrice = history[i].price;
      const returnPct = (currentPrice - prevPrice) / prevPrice;
      returns.push(returnPct);
    }
    
    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
    const variance = returns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Calculate volume profile from tick history
   * @param history Tick history
   * @returns The calculated volume profile
   */
  private calculateVolumeProfile(history: MarketTick[]): Record<string, number> {
    const result: Record<string, number> = {
      totalVolume: 0,
      avgVolume: 0,
      maxVolume: 0
    };
    
    if (history.length === 0) return result;
    
    // Calculate volume metrics
    let totalVolume = 0;
    let maxVolume = 0;
    
    for (const tick of history) {
      totalVolume += tick.volume;
      maxVolume = Math.max(maxVolume, tick.volume);
    }
    
    result.totalVolume = totalVolume;
    result.avgVolume = totalVolume / history.length;
    result.maxVolume = maxVolume;
    
    return result;
  }
  
  /**
   * Calculate momentum indicators from tick history
   * @param history Tick history
   * @returns The calculated momentum indicators
   */
  private calculateMomentumIndicators(history: MarketTick[]): Record<string, number> {
    const result: Record<string, number> = {
      change1m: 0,
      change5m: 0,
      change15m: 0,
      rsi: 0
    };
    
    if (history.length < 2) return result;
    
    const now = Date.now();
    const latestPrice = history[history.length - 1].price;
    
    // Find prices at different time points
    const oneMinAgo = this.findPriceAtTime(history, now - 60000);
    const fiveMinAgo = this.findPriceAtTime(history, now - 300000);
    const fifteenMinAgo = this.findPriceAtTime(history, now - 900000);
    
    if (oneMinAgo !== null) {
      result.change1m = (latestPrice - oneMinAgo) / oneMinAgo;
    }
    
    if (fiveMinAgo !== null) {
      result.change5m = (latestPrice - fiveMinAgo) / fiveMinAgo;
    }
    
    if (fifteenMinAgo !== null) {
      result.change15m = (latestPrice - fifteenMinAgo) / fifteenMinAgo;
    }
    
    // Calculate RSI if we have enough data
    if (history.length >= 14) {
      result.rsi = this.calculateRSI(history);
    }
    
    return result;
  }
  
  /**
   * Find price at a specific timestamp
   * @param history Tick history
   * @param timestamp The timestamp to find the price for
   * @returns The price at the specified timestamp or null if not found
   */
  private findPriceAtTime(history: MarketTick[], timestamp: number): number | null {
    // Find the closest tick before the timestamp
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= timestamp) {
        return history[i].price;
      }
    }
    
    return null;
  }
  
  /**
   * Calculate RSI (Relative Strength Index)
   * @param history Tick history
   * @returns The calculated RSI
   */
  private calculateRSI(history: MarketTick[], periods = 14): number {
    if (history.length < periods + 1) return 50; // Default to neutral if not enough data
    
    let gains = 0;
    let losses = 0;
    
    // Calculate average gains and losses
    for (let i = history.length - periods; i < history.length; i++) {
      const change = history[i].price - history[i - 1].price;
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change; // Make losses positive
      }
    }
    
    const avgGain = gains / periods;
    const avgLoss = losses / periods;
    
    if (avgLoss === 0) return 100; // Prevent division by zero
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
  }
  
  /**
   * Detect anomalies across all tracked symbols
   */
  public detectAnomalies(): MarketAnomaly[] {
    const newAnomalies: MarketAnomaly[] = [];
    
    try {
      // Process each symbol
      for (const [symbol, history] of this.tickHistory.entries()) {
        if (history.length < 10) continue; // Need sufficient history
        
        // Get features
        const features = this.getLatestFeatures(symbol);
        if (!features) continue;
        
        // Detect price spikes
        const priceAnomaly = this.detectPriceAnomaly(history);
        if (priceAnomaly) {
          newAnomalies.push(priceAnomaly);
        }
        
        // Detect volume spikes
        const volumeAnomaly = this.detectVolumeAnomaly(history);
        if (volumeAnomaly) {
          newAnomalies.push(volumeAnomaly);
        }
      }
      
      // Add new anomalies to the list
      this.anomalies = [...this.anomalies, ...newAnomalies];
      
      // Keep only the latest 100 anomalies
      if (this.anomalies.length > 100) {
        this.anomalies = this.anomalies.slice(this.anomalies.length - 100);
      }
      
      return newAnomalies;
    } catch (error: any) {
      logger.error(`Error detecting anomalies: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Detect price anomalies
   */
  private detectPriceAnomaly(history: MarketTick[]): MarketAnomaly | null {
    if (history.length < 10) return null;
    
    const symbol = history[0].symbol;
    const latestTick = history[history.length - 1];
    
    // Calculate price changes
    const recentPrices = history.slice(-10).map(tick => tick.price);
    const avgPrice = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const stdDev = Math.sqrt(
      recentPrices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / recentPrices.length
    );
    
    // Calculate how many standard deviations the latest price is from the average
    const zscore = Math.abs(latestTick.price - avgPrice) / (stdDev || 1); // Avoid division by zero
    
    // If price is more than 3 standard deviations from mean, flag as anomaly
    if (zscore > 3) {
      return {
        symbol,
        type: "PriceSpike",
        severity: Math.min(zscore / 10, 1), // Scale to 0-1
        timestamp: Date.now(),
        metadata: {
          currentPrice: latestTick.price,
          averagePrice: avgPrice,
          standardDeviation: stdDev,
          zScore: zscore
        }
      };
    }
    
    return null;
  }
  
  /**
   * Detect volume anomalies
   */
  private detectVolumeAnomaly(history: MarketTick[]): MarketAnomaly | null {
    if (history.length < 10) return null;
    
    const symbol = history[0].symbol;
    const latestTick = history[history.length - 1];
    
    // Calculate volume changes
    const recentVolumes = history.slice(-10).map(tick => tick.volume);
    const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    
    // If volume is more than 5x the average, flag as anomaly
    if (latestTick.volume > avgVolume * 5) {
      const severity = Math.min(latestTick.volume / (avgVolume * 10), 1); // Scale to 0-1
      
      return {
        symbol,
        type: "VolumeSpike",
        severity,
        timestamp: Date.now(),
        metadata: {
          currentVolume: latestTick.volume,
          averageVolume: avgVolume,
          ratio: latestTick.volume / avgVolume
        }
      };
    }
    
    return null;
  }
  
  /**
   * Get recent anomalies limited by count
   * @param limit Maximum number of anomalies to return
   * @returns Array of recent market anomalies
   */
  public getRecentAnomalies(limit: number): MarketAnomaly[] {
    const count = Math.min(limit, this.anomalies.length);
    return this.anomalies.slice(-count);
  }
  
  /**
   * Get latest features for a symbol
   * @param symbol The market symbol
   * @returns The latest market features or null if not available
   */
  public getLatestFeatures(symbol: string): MarketFeatures | null {
    return this.features.get(symbol) || null;
  }
} 