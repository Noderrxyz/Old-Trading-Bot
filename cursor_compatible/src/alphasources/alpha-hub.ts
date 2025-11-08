/**
 * Alpha Hub
 * 
 * Central manager for all alpha sources that coordinates data collection,
 * blending, and distribution of alpha signals
 */

import { BaseAlphaSource } from './base-alpha-source.js';
import { AlphaFrame, AlphaHubConfig, AlphaSource, AlphaSourceConfig } from './types.js';
import { AlphaWeightingEngine } from './weighting-engine.js';
import { AlphaFusionEngine, FusedAlphaFrame } from './fusion-engine.js';
import { VolatilityCalculator } from './volatility-calculator.js';
import { VolatilityScaler } from './volatility-scaler.js';
import { TimeOfDayBiasAdjuster } from './time-bias-adjuster.js';
import { OnchainAlphaSource } from './onchain-alpha.js';
import { TwitterAlphaSource } from './twitter-alpha.js';
import { createLogger } from '../common/logger.js';

/**
 * Configuration for volatility scaling in AlphaHub
 */
export interface VolatilityScalingConfig {
  /** Whether volatility scaling is enabled */
  enabled: boolean;
  
  /** Maximum volatility value (e.g., 0.10 = 10%) */
  maxVolatility: number;
  
  /** Minimum position size after scaling */
  minSize: number;
  
  /** Maximum position size after scaling */
  maxSize: number;
  
  /** Default volatility to use when no data is available */
  defaultVolatility: number;
}

/**
 * Default volatility scaling configuration
 */
const DEFAULT_VOLATILITY_CONFIG: VolatilityScalingConfig = {
  enabled: true,
  maxVolatility: 0.10, // 10%
  minSize: 0.05,
  maxSize: 1.0,
  defaultVolatility: 0.02 // 2%
};

export class AlphaHub {
  private sources: AlphaSource[] = [];
  private latestAlpha: Map<string, Map<string, AlphaFrame>> = new Map();
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly config: AlphaHubConfig;
  private readonly logger: any; // Would use proper Logger type in real implementation
  private readonly weightingEngine: AlphaWeightingEngine;
  private readonly fusionEngine: AlphaFusionEngine;
  private readonly volatilityCalculator: VolatilityCalculator;
  private readonly volatilityScaler: VolatilityScaler;
  private readonly timeBiasAdjuster: TimeOfDayBiasAdjuster;
  private lastMarketVolatility: number = 0.3; // Default medium volatility
  private latestFusedSignals: FusedAlphaFrame[] = [];
  private fusedSignalHistory: FusedAlphaFrame[] = [];
  private readonly maxHistorySize: number = 1000; // Maximum number of historical fused signals to keep
  private readonly volatilityConfig: VolatilityScalingConfig;

  /**
   * Create a new AlphaHub
   * @param config Hub configuration
   * @param volatilityConfig Optional volatility scaling configuration
   */
  constructor(
    config: AlphaHubConfig,
    volatilityConfig: Partial<VolatilityScalingConfig> = {}
  ) {
    this.config = config;
    this.logger = createLogger('AlphaHub');
    this.volatilityConfig = { ...DEFAULT_VOLATILITY_CONFIG, ...volatilityConfig };
    
    // Initialize weighting engine
    this.weightingEngine = new AlphaWeightingEngine({
      persistMetrics: true
    });
    
    // Initialize fusion engine
    this.fusionEngine = new AlphaFusionEngine({
      logDetailedCalculations: true
    });
    
    // Initialize volatility calculator
    this.volatilityCalculator = new VolatilityCalculator({
      defaultVolatility: this.volatilityConfig.defaultVolatility,
      logDetailedCalculations: true
    });
    
    // Initialize volatility scaler
    this.volatilityScaler = new VolatilityScaler({
      enabled: this.volatilityConfig.enabled,
      maxVolatility: this.volatilityConfig.maxVolatility,
      minSize: this.volatilityConfig.minSize,
      maxSize: this.volatilityConfig.maxSize,
      logDetailedCalculations: true
    });
    
    // Initialize time bias adjuster
    this.timeBiasAdjuster = new TimeOfDayBiasAdjuster({
      enabled: config.timeBias?.enabled !== false, // Enable by default unless explicitly disabled
      bucketIntervalMinutes: config.timeBias?.bucketIntervalMinutes || 60,
      minDataPoints: config.timeBias?.minDataPoints || 20,
      smoothing: config.timeBias?.smoothing || 0.1,
      clampRange: config.timeBias?.clampRange || [0.1, 1.0],
      logDetailedAdjustments: config.timeBias?.logDetailedAdjustments || false
    });
  }

  /**
   * Initialize the hub with the configured alpha sources
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing AlphaHub with supported assets:', this.config.supportedAssets);
    
    // Create alpha sources
    await this.initializeSources();
    
    // Start refresh cycles
    this.startRefreshCycles();
    
    // Perform initial signal fusion
    this.fuseCombinedSignals();
    
    this.logger.info(`AlphaHub initialized with ${this.sources.length} sources`);
  }

  /**
   * Initialize alpha sources
   */
  private async initializeSources(): Promise<void> {
    try {
      // Initialize onchain alpha if configured
      if (this.config.sources.onchain?.enabled) {
        const onchainSource = new OnchainAlphaSource(
          this.config.sources.onchain,
          this.config.supportedAssets
        );
        await onchainSource.initialize();
        this.sources.push(onchainSource);
      }
      
      // Initialize Twitter alpha if configured
      if (this.config.sources.twitter?.enabled) {
        const twitterSource = new TwitterAlphaSource(
          this.config.sources.twitter,
          this.config.supportedAssets
        );
        await twitterSource.initialize();
        this.sources.push(twitterSource);
      }
      
      // Initialize other sources as needed
      // ...

      this.logger.info(`Initialized ${this.sources.length} alpha sources`);
    } catch (error) {
      this.logger.error('Failed to initialize alpha sources:', error);
      throw error;
    }
  }

  /**
   * Start refresh cycles for each source
   */
  private startRefreshCycles(): void {
    for (const source of this.sources) {
      if (!source.isEnabled()) continue;
      
      const sourceName = source.getName();
      const refreshInterval = this.getRefreshInterval(sourceName);
      
      // Clear existing interval if any
      if (this.refreshIntervals.has(sourceName)) {
        clearInterval(this.refreshIntervals.get(sourceName));
      }
      
      // Set new interval
      const interval = setInterval(async () => {
        try {
          await this.refreshSource(source);
        } catch (error) {
          this.logger.error(`Error refreshing source ${sourceName}:`, error);
        }
      }, refreshInterval);
      
      this.refreshIntervals.set(sourceName, interval);
      this.logger.info(`Started refresh cycle for ${sourceName} every ${refreshInterval}ms`);
      
      // Initial refresh
      this.refreshSource(source).catch(error => {
        this.logger.error(`Error in initial refresh for ${sourceName}:`, error);
      });
    }
  }

  /**
   * Refresh a single alpha source
   * @param source Alpha source to refresh
   */
  private async refreshSource(source: AlphaSource): Promise<void> {
    const sourceName = source.getName();
    this.logger.debug(`Refreshing alpha source: ${sourceName}`);
    
    try {
      // Get fresh alpha
      const frames = await source.getAlpha();
      if (!frames.length) {
        this.logger.debug(`No alpha frames returned from ${sourceName}`);
        return;
      }
      
      // Store latest frames by symbol
      let sourceMap = this.latestAlpha.get(sourceName);
      if (!sourceMap) {
        sourceMap = new Map();
        this.latestAlpha.set(sourceName, sourceMap);
      }
      
      // Weight and update latest frames
      const weightedFrames = frames.map(frame => this.weightingEngine.scoreAlpha(frame));
      
      // Update latest frames
      for (const frame of weightedFrames) {
        sourceMap.set(frame.symbol, frame);
      }
      
      this.logger.debug(`Refreshed ${frames.length} alpha frames from ${sourceName}`);
      
      // Fuse signals after update
      this.fuseCombinedSignals();
      
      // Trigger any subscribers
      this.notifySubscribers(sourceName, weightedFrames);
    } catch (error) {
      this.logger.error(`Failed to refresh alpha source ${sourceName}:`, error);
    }
  }

  /**
   * Fuse all current alpha signals into combined signals
   */
  private fuseCombinedSignals(): void {
    this.logger.info('Fusing signals from all sources...');
    
    // Get symbols from latest alpha frames
    const symbols = new Set<string>();
    this.latestAlpha.forEach((sourceMap) => {
      sourceMap.forEach((_, symbol) => {
        symbols.add(symbol);
      });
    });
    
    // Create alpha frames map for fusion engine
    const allAlphaMap = new Map<string, AlphaFrame[]>();
    symbols.forEach(symbol => {
      const frames: AlphaFrame[] = [];
      this.sources.forEach(source => {
        const sourceId = source.getId();
        const sourceMap = this.latestAlpha.get(sourceId);
        if (sourceMap && sourceMap.has(symbol)) {
          const frame = sourceMap.get(symbol);
          if (frame) {
            // Apply weighting to confidence
            const weightedFrame = { ...frame };
            const weight = this.weightingEngine.getWeight(sourceId);
            weightedFrame.confidence *= weight;
            frames.push(weightedFrame);
          }
        }
      });
      if (frames.length > 0) {
        allAlphaMap.set(symbol, frames);
      }
    });
    
    // Fuse signals
    this.latestFusedSignals = this.fusionEngine.fuseSignals(allAlphaMap);
    
    // Apply volatility scaling if enabled
    if (this.volatilityConfig.enabled) {
      // Get volatility for all symbols
      const symbolsArray = Array.from(symbols);
      const volatilityMap = this.volatilityCalculator.getVolatilityMap(symbolsArray);
      
      // Apply scaling based on volatility
      this.latestFusedSignals = this.volatilityScaler.scaleSignals(
        this.latestFusedSignals,
        volatilityMap
      );
      
      this.logger.info(`Applied volatility scaling to ${this.latestFusedSignals.length} fused signals`);
    }
    
    // Apply time-of-day bias adjustment
    this.latestFusedSignals = this.latestFusedSignals.map(signal => {
      return this.timeBiasAdjuster.adjustSignal(signal);
    });
    
    this.logger.info(`Applied time-of-day bias adjustment to ${this.latestFusedSignals.length} fused signals`);
    
    // Add to history
    this.fusedSignalHistory = [
      ...this.latestFusedSignals,
      ...this.fusedSignalHistory
    ].slice(0, this.maxHistorySize);
    
    this.logger.info(`Generated ${this.latestFusedSignals.length} fused signals`);
  }
  
  /**
   * Get the latest fused signals
   * @returns Array of fused alpha signals
   */
  public getLatestFusedSignals(): FusedAlphaFrame[] {
    return [...this.latestFusedSignals];
  }
  
  /**
   * Get the fused signal history
   * @param limit Maximum number of signals to return (newest first)
   * @param symbol Optional symbol filter
   * @returns Array of historical fused signals
   */
  public getFusedSignalHistory(limit?: number, symbol?: string): FusedAlphaFrame[] {
    let history = [...this.fusedSignalHistory];
    
    // Filter by symbol if provided
    if (symbol) {
      history = history.filter(signal => signal.symbol === symbol);
    }
    
    // Sort by timestamp (newest first)
    history.sort((a, b) => b.timestamp - a.timestamp);
    
    // Apply limit if provided
    if (limit && limit > 0) {
      history = history.slice(0, limit);
    }
    
    return history;
  }
  
  /**
   * Get fused signal for a specific symbol
   * @param symbol Asset symbol
   * @returns Fused signal or null if not found
   */
  public getFusedSignal(symbol: string): FusedAlphaFrame | null {
    return this.latestFusedSignals.find(signal => signal.symbol === symbol) || null;
  }

  /**
   * Get the refresh interval for a source
   * @param sourceName Name of the source
   * @returns Refresh interval in milliseconds
   */
  private getRefreshInterval(sourceName: string): number {
    // Get source-specific interval or fall back to default
    const sourceConfig = (this.config.sources as Record<string, AlphaSourceConfig>)[sourceName];
    return (sourceConfig?.refreshIntervalMs || this.config.defaultRefreshIntervalMs);
  }

  /**
   * Notify subscribers of new alpha frames
   * @param sourceName Source name
   * @param frames New alpha frames
   */
  private notifySubscribers(sourceName: string, frames: AlphaFrame[]): void {
    // In a real implementation, this would notify subscribers via event emitter, callbacks, etc.
    // This is just a placeholder
  }

  /**
   * Get the latest alpha frame for a specific symbol and source
   * @param symbol Asset symbol (e.g., "BTC/USDC")
   * @param sourceName Optional source name filter
   * @returns The latest alpha frame or null if not available
   */
  getLatestAlpha(symbol: string, sourceName?: string): AlphaFrame | null {
    // If source specified, get from that source only
    if (sourceName) {
      const sourceMap = this.latestAlpha.get(sourceName);
      if (!sourceMap) return null;
      return sourceMap.get(symbol) || null;
    }
    
    // Otherwise, find the most recent frame across all sources
    let latestFrame: AlphaFrame | null = null;
    
    for (const [source, sourceMap] of this.latestAlpha.entries()) {
      const frame = sourceMap.get(symbol);
      if (!frame) continue;
      
      if (!latestFrame || frame.timestamp > latestFrame.timestamp) {
        latestFrame = frame;
      }
    }
    
    return latestFrame;
  }

  /**
   * Get blended alpha for a symbol across all enabled sources
   * @param symbol Asset symbol (e.g., "BTC/USDC")
   * @returns Blended alpha score between 0 and 1, or null if no data
   */
  getBlendedAlpha(symbol: string): number | null {
    // Collect alpha frames from all sources for this symbol
    const frames: Array<AlphaFrame & { weight?: number }> = [];
    
    for (const [sourceName, sourceMap] of this.latestAlpha.entries()) {
      const frame = sourceMap.get(symbol);
      if (frame) frames.push(frame);
    }
    
    if (frames.length === 0) {
      return null;
    }
    
    // Calculate weighted average of scores
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const frame of frames) {
      // Use frame's weight if available (from weighting engine), otherwise get from config or use default
      const weight = frame.weight !== undefined ? 
        frame.weight : 
        this.getSourceWeight(frame.source);
        
      weightedSum += frame.score * weight;
      totalWeight += weight;
    }
    
    if (totalWeight === 0) {
      return null;
    }
    
    return weightedSum / totalWeight;
  }

  /**
   * Get blended alpha details for a symbol
   * @param symbol Asset symbol
   * @returns Object with score and contributing sources
   */
  getBlendedAlphaDetails(symbol: string): { 
    score: number | null; 
    sources: Array<{ name: string; score: number; weight: number; }> 
  } {
    const sources: Array<{ name: string; score: number; weight: number }> = [];
    let totalWeight = 0;
    let weightedSum = 0;
    
    // Collect alpha frames from all sources for this symbol
    for (const [sourceName, sourceMap] of this.latestAlpha.entries()) {
      const frame = sourceMap.get(symbol);
      if (!frame) continue;
      
      const weight = this.getSourceWeight(frame.source);
      weightedSum += frame.score * weight;
      totalWeight += weight;
      
      sources.push({
        name: frame.source,
        score: frame.score,
        weight
      });
    }
    
    // Sort sources by weight (highest first)
    sources.sort((a, b) => b.weight - a.weight);
    
    return {
      score: totalWeight > 0 ? weightedSum / totalWeight : null,
      sources
    };
  }

  /**
   * Get the weight for a source
   * @param sourceName Source name
   * @returns Weight value
   */
  private getSourceWeight(sourceName: string): number {
    // Get source-specific weight or fall back to default
    return this.config.sourceWeights[sourceName] || 1.0;
  }

  /**
   * Get all supported asset symbols
   * @returns Array of supported asset symbols
   */
  getSupportedAssets(): string[] {
    return [...this.config.supportedAssets];
  }

  /**
   * Get all active alpha sources
   * @returns Array of source names
   */
  getActiveSources(): string[] {
    return this.sources.map(source => source.getName());
  }

  /**
   * Add a custom alpha source
   * @param source Alpha source instance
   */
  async addSource(source: AlphaSource): Promise<void> {
    const sourceName = source.getName();
    
    // Check if source already exists
    if (this.sources.some(s => s.getName() === sourceName)) {
      throw new Error(`Alpha source ${sourceName} already exists`);
    }
    
    // Initialize source
    await source.initialize();
    
    // Add to sources
    this.sources.push(source);
    
    // Start refresh cycle
    this.startRefreshCycles();
    
    this.logger.info(`Added new alpha source: ${sourceName}`);
  }

  /**
   * Stop all refresh cycles and clean up
   */
  shutdown(): void {
    // Clear all refresh intervals
    for (const interval of this.refreshIntervals.values()) {
      clearInterval(interval);
    }
    
    this.refreshIntervals.clear();
    this.logger.info('AlphaHub shut down');
  }

  /**
   * Update performance metrics for a source based on actual outcome
   * @param source Source name
   * @param symbol Asset symbol
   * @param actualReturn Actual return (positive = profit, negative = loss)
   */
  public updateSourcePerformance(source: string, symbol: string, actualReturn: number): void {
    this.logger.debug(`Updating performance for ${source} on ${symbol}: ${actualReturn.toFixed(4)}`);
    
    // Update market volatility if needed (would get from market data service in real implementation)
    this.updateMarketVolatility();
    
    // Update weighting engine with performance data
    this.weightingEngine.updatePerformance(source, actualReturn, symbol);
    
    this.logger.debug(`Updated performance metrics for ${source}`);
  }
  
  /**
   * Update the current market volatility estimate
   * Used to adapt weight calculations to current market conditions
   */
  private updateMarketVolatility(): void {
    // In a real implementation, this would pull data from a market service
    // For now, mock a slight random walk
    const change = (Math.random() - 0.5) * 0.05;
    this.lastMarketVolatility = Math.max(0.1, Math.min(0.9, this.lastMarketVolatility + change));
    
    // Update volatility regime in weighting engine
    this.weightingEngine.updateVolatilityRegime(this.lastMarketVolatility);
  }

  /**
   * Get performance metrics for all alpha sources
   * @returns Performance metrics by source
   */
  public getSourcePerformanceMetrics(): Record<string, any> {
    return this.weightingEngine.getPerformanceMetrics();
  }

  /**
   * Get active sources that meet the minimum weight threshold
   * @returns Array of source names
   */
  public getActiveSourcesAboveThreshold(): string[] {
    return this.weightingEngine.getActiveSourcesAboveThreshold();
  }

  /**
   * Record feedback for a fused signal to improve future signal quality
   * @param symbol Asset symbol
   * @param actualReturn Actual return from this signal
   * @param timestamp Optional timestamp of the fused signal
   */
  public recordFusedSignalFeedback(symbol: string, actualReturn: number, timestamp?: number): void {
    // Find the fused signal
    let fusedSignal: FusedAlphaFrame | null = null;
    
    if (timestamp) {
      // Look in history for specific timestamp
      fusedSignal = this.fusedSignalHistory.find(
        signal => signal.symbol === symbol && signal.timestamp === timestamp
      ) || null;
    } else {
      // Use latest signal for this symbol
      fusedSignal = this.getFusedSignal(symbol);
    }
    
    if (!fusedSignal) {
      this.logger.warn(`No fused signal found for ${symbol} to record feedback`);
      return;
    }
    
    this.logger.info(`Recording feedback for ${symbol}: ${actualReturn.toFixed(4)}`);
    
    // Record outcome for time-of-day bias adjustment
    this.timeBiasAdjuster.recordOutcome(fusedSignal, actualReturn);
    
    // Extract unique sources from the fused signal
    const sources = fusedSignal.sources;
    
    // Determine whether the signal was correct
    const signalCorrect = (fusedSignal.direction === 'long' && actualReturn > 0) || 
                        (fusedSignal.direction === 'short' && actualReturn < 0);
    
    this.logger.debug(
      `Signal ${signalCorrect ? 'was correct' : 'was incorrect'} ` +
      `(direction: ${fusedSignal.direction}, return: ${actualReturn.toFixed(4)})`
    );
    
    // Update each source's performance
    for (const source of sources) {
      // Get the source's contribution to the fused signal
      const sourceFrames = fusedSignal.details.filter(frame => frame.source === source);
      
      if (sourceFrames.length === 0) {
        continue;
      }
      
      // Calculate average source score
      const avgScore = sourceFrames.reduce((sum, frame) => sum + frame.score, 0) / sourceFrames.length;
      
      // Determine if this source was correct (in the same direction as the fused signal)
      const sourceCorrect = (fusedSignal.direction === 'long' && avgScore > 0.5) ||
                          (fusedSignal.direction === 'short' && avgScore < 0.5);
      
      // Calculate source performance score
      // Higher if source was correct AND fused signal was correct
      // Lower if source was incorrect OR fused signal was incorrect
      let sourceReturn = 0;
      
      if (sourceCorrect && signalCorrect) {
        // Source was correct and contributed to a correct fused signal
        sourceReturn = Math.abs(actualReturn) * 1.2;
      } else if (!sourceCorrect && !signalCorrect) {
        // Source was wrong, but so was the fused signal
        sourceReturn = -Math.abs(actualReturn) * 0.5;
      } else if (sourceCorrect && !signalCorrect) {
        // Source was correct, but fused signal was wrong (other sources overrode)
        sourceReturn = Math.abs(actualReturn) * 0.3;
      } else {
        // Source was wrong, but fused signal was right (saved by other sources)
        sourceReturn = -Math.abs(actualReturn) * 0.8;
      }
      
      // Update source performance in weighting engine
      this.weightingEngine.updatePerformance(source, sourceReturn, symbol);
    }
    
    // Update volatility based on actual return magnitude
    const volatilityChange = Math.min(0.1, Math.abs(actualReturn) * 0.2);
    this.lastMarketVolatility = Math.min(
      0.9,
      Math.max(0.1, this.lastMarketVolatility + (Math.abs(actualReturn) > 0.05 ? volatilityChange : -volatilityChange))
    );
    this.weightingEngine.updateVolatilityRegime(this.lastMarketVolatility);
    
    this.logger.debug(`Updated market volatility: ${this.lastMarketVolatility.toFixed(2)}`);
  }

  /**
   * Add price data for a symbol to update volatility calculations
   * @param symbol Asset symbol
   * @param price Current price
   * @param timestamp Optional timestamp (defaults to current time)
   */
  public addPriceData(symbol: string, price: number, timestamp?: number): void {
    this.volatilityCalculator.addPriceData(symbol, price, timestamp);
    
    // Get updated volatility and log it
    const volatility = this.volatilityCalculator.calculateVolatility(symbol);
    this.logger.debug(`Updated volatility for ${symbol}: ${volatility.toFixed(4)} (${(volatility * 100).toFixed(2)}%)`);
    
    // Update weighting engine with latest volatility
    this.weightingEngine.updateVolatility(volatility);
    
    // Store for potential use elsewhere
    this.lastMarketVolatility = volatility;
  }
  
  /**
   * Get current volatility for a symbol
   * @param symbol Asset symbol
   * @returns Current volatility value
   */
  public getVolatility(symbol: string): number {
    return this.volatilityCalculator.calculateVolatility(symbol);
  }
  
  /**
   * Get volatility for multiple symbols
   * @param symbols List of asset symbols
   * @returns Map of symbol to volatility
   */
  public getVolatilityMap(symbols: string[]): Map<string, number> {
    return this.volatilityCalculator.getVolatilityMap(symbols);
  }

  /**
   * Get the latest fused signals with freshness decay applied
   * @param maxAgeMs Maximum signal age in milliseconds before complete decay
   * @returns Array of fused alpha signals with adjusted confidence based on freshness
   */
  public getLatestFusedSignalsWithDecay(maxAgeMs: number = 3600000): FusedAlphaFrame[] {
    const currentTime = Date.now();
    const signals = [...this.latestFusedSignals];
    
    // Apply freshness decay to each signal
    return signals.map(signal => {
      const signalAge = currentTime - signal.timestamp;
      
      // If signal is older than maxAgeMs, it's fully decayed
      if (signalAge >= maxAgeMs) {
        return {
          ...signal,
          confidence: 0,
          size: 0
        };
      }
      
      // Linear decay based on age
      const freshnessFactor = 1 - (signalAge / maxAgeMs);
      
      // Apply decay to confidence and size
      return {
        ...signal,
        confidence: signal.confidence * freshnessFactor,
        size: signal.size * freshnessFactor
      };
    });
  }

  /**
   * Get fused signal history with freshness decay applied
   * @param limit Maximum number of signals to return (newest first)
   * @param symbol Optional symbol filter
   * @param maxAgeMs Maximum signal age in milliseconds before complete decay
   * @returns Array of historical fused signals with adjusted confidence based on freshness
   */
  public getFusedSignalHistoryWithDecay(
    limit?: number, 
    symbol?: string, 
    maxAgeMs: number = 3600000
  ): FusedAlphaFrame[] {
    const currentTime = Date.now();
    let history = this.getFusedSignalHistory(limit, symbol);
    
    // Apply freshness decay to each signal
    return history.map(signal => {
      const signalAge = currentTime - signal.timestamp;
      
      // If signal is older than maxAgeMs, it's fully decayed
      if (signalAge >= maxAgeMs) {
        return {
          ...signal,
          confidence: 0,
          size: 0
        };
      }
      
      // Linear decay based on age
      const freshnessFactor = 1 - (signalAge / maxAgeMs);
      
      // Apply decay to confidence and size
      return {
        ...signal,
        confidence: signal.confidence * freshnessFactor,
        size: signal.size * freshnessFactor
      };
    });
  }

  /**
   * Get fused signal for a specific symbol with freshness decay applied
   * @param symbol Asset symbol
   * @param maxAgeMs Maximum signal age in milliseconds before complete decay
   * @returns Fused signal or null if not found
   */
  public getFusedSignalWithDecay(symbol: string, maxAgeMs: number = 3600000): FusedAlphaFrame | null {
    const signal = this.getFusedSignal(symbol);
    if (!signal) return null;
    
    const currentTime = Date.now();
    const signalAge = currentTime - signal.timestamp;
    
    // If signal is older than maxAgeMs, it's fully decayed
    if (signalAge >= maxAgeMs) {
      return {
        ...signal,
        confidence: 0,
        size: 0
      };
    }
    
    // Linear decay based on age
    const freshnessFactor = 1 - (signalAge / maxAgeMs);
    
    // Apply decay to confidence and size
    return {
      ...signal,
      confidence: signal.confidence * freshnessFactor,
      size: signal.size * freshnessFactor
    };
  }
} 