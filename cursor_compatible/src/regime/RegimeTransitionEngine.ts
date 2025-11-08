import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { MarketRegimeClassifier } from './MarketRegimeClassifier';
import {
  MarketRegime,
  RegimeTransitionState,
  RegimeClassification,
  RegimeTransition
} from './MarketRegimeTypes';

/**
 * Listener for regime transitions
 */
export type RegimeTransitionListener = (
  transition: RegimeTransition,
  symbol: string
) => void;

/**
 * Listener for regime classifications
 */
export type RegimeClassificationListener = (
  classification: RegimeClassification,
  symbol: string
) => void;

/**
 * Configuration for the Regime Transition Engine
 */
export interface RegimeTransitionEngineConfig {
  /**
   * Minimum confidence for transitions to be reported
   */
  minimumTransitionConfidence: number;
  
  /**
   * How many samples to use for smoothing regime transitions
   */
  transitionSmoothingWindow: number;
  
  /**
   * Maximum time (ms) to consider two classifications part of the same transition
   */
  maxTransitionTimeMs: number;
  
  /**
   * Emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RegimeTransitionEngineConfig = {
  minimumTransitionConfidence: 0.7,
  transitionSmoothingWindow: 3,
  maxTransitionTimeMs: 86400000, // 24 hours
  emitDetailedTelemetry: true
};

/**
 * Engine that tracks and processes market regime transitions
 */
export class RegimeTransitionEngine {
  private static instance: RegimeTransitionEngine | null = null;
  private config: RegimeTransitionEngineConfig;
  private classifier: MarketRegimeClassifier;
  private telemetry: TelemetryBus;
  
  private transitionListeners: RegimeTransitionListener[] = [];
  private classificationListeners: RegimeClassificationListener[] = [];
  private recentClassifications: Map<string, RegimeClassification[]> = new Map();
  private lastReportedRegimes: Map<string, MarketRegime> = new Map();
  private transitionCounts: Map<string, number> = new Map();
  private regimeStats: Map<MarketRegime, {
    occurrences: number,
    avgDuration: number,
    avgConfidence: number
  }> = new Map();
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor(config: Partial<RegimeTransitionEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.classifier = MarketRegimeClassifier.getInstance();
    this.telemetry = TelemetryBus.getInstance();
    
    logger.info('RegimeTransitionEngine initialized', {
      smoothingWindow: this.config.transitionSmoothingWindow,
      minimumConfidence: this.config.minimumTransitionConfidence
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<RegimeTransitionEngineConfig> = {}): RegimeTransitionEngine {
    if (!RegimeTransitionEngine.instance) {
      RegimeTransitionEngine.instance = new RegimeTransitionEngine(config);
    }
    return RegimeTransitionEngine.instance;
  }
  
  /**
   * Process a new regime classification
   * @param classification New classification
   * @param symbol Market symbol
   */
  public processClassification(classification: RegimeClassification, symbol: string): void {
    try {
      // Store classification
      this.addClassification(symbol, classification);
      
      // Apply smoothing to determine the current regime
      const smoothedRegime = this.getSmoothRegime(symbol);
      
      // Notify classification listeners
      this.notifyClassificationListeners(classification, symbol);
      
      // Check for regime transitions
      const lastReportedRegime = this.lastReportedRegimes.get(symbol);
      
      if (lastReportedRegime !== undefined && 
          lastReportedRegime !== smoothedRegime.primaryRegime &&
          smoothedRegime.confidence >= this.config.minimumTransitionConfidence) {
        
        // A transition has occurred with sufficient confidence
        this.handleRegimeTransition(symbol, lastReportedRegime, smoothedRegime);
      }
      
      // Update last reported regime
      if (smoothedRegime.confidence >= this.config.minimumTransitionConfidence) {
        this.lastReportedRegimes.set(symbol, smoothedRegime.primaryRegime);
      }
      
      // Update statistics
      this.updateRegimeStats(symbol, smoothedRegime);
      
      // Emit telemetry
      if (this.config.emitDetailedTelemetry) {
        this.telemetry.emit('regime.smoothed_classification', {
          symbol,
          regime: smoothedRegime.primaryRegime,
          confidence: smoothedRegime.confidence,
          transitionState: smoothedRegime.transitionState,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error processing regime classification for ${symbol}: ${errorMessage}`, error);
      
      this.telemetry.emit('regime.process_error', {
        symbol,
        error: errorMessage,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Register a listener for regime transitions
   * @param listener Transition listener callback
   */
  public onTransition(listener: RegimeTransitionListener): void {
    this.transitionListeners.push(listener);
  }
  
  /**
   * Register a listener for regime classifications
   * @param listener Classification listener callback
   */
  public onClassification(listener: RegimeClassificationListener): void {
    this.classificationListeners.push(listener);
  }
  
  /**
   * Remove a transition listener
   * @param listener Listener to remove
   */
  public removeTransitionListener(listener: RegimeTransitionListener): void {
    this.transitionListeners = this.transitionListeners.filter(l => l !== listener);
  }
  
  /**
   * Remove a classification listener
   * @param listener Listener to remove
   */
  public removeClassificationListener(listener: RegimeClassificationListener): void {
    this.classificationListeners = this.classificationListeners.filter(l => l !== listener);
  }
  
  /**
   * Get current regime stats
   */
  public getRegimeStats(): Record<string, {
    occurrences: number,
    avgDuration: number,
    avgConfidence: number
  }> {
    const result: Record<string, any> = {};
    
    this.regimeStats.forEach((stats, regime) => {
      result[regime] = { ...stats };
    });
    
    return result;
  }
  
  /**
   * Get number of transitions for a symbol or all symbols
   * @param symbol Optional market symbol
   */
  public getTransitionCount(symbol?: string): number {
    if (symbol) {
      return this.transitionCounts.get(symbol) || 0;
    }
    
    // Sum all transition counts
    let total = 0;
    this.transitionCounts.forEach(count => {
      total += count;
    });
    
    return total;
  }
  
  /**
   * Get smoothed regime classification 
   * @param symbol Market symbol
   */
  public getSmoothRegime(symbol: string): RegimeClassification {
    const recentClassifications = this.recentClassifications.get(symbol) || [];
    
    if (recentClassifications.length === 0) {
      return {
        primaryRegime: MarketRegime.Unknown,
        secondaryRegime: null,
        confidence: 0,
        transitionState: RegimeTransitionState.Ambiguous,
        scores: { [MarketRegime.Unknown]: 1 } as Record<MarketRegime, number>,
        timestamp: Date.now(),
        features: {} as any
      };
    }
    
    if (recentClassifications.length === 1) {
      return recentClassifications[0];
    }
    
    // Apply smoothing to recent classifications
    const window = Math.min(this.config.transitionSmoothingWindow, recentClassifications.length);
    const recent = recentClassifications.slice(0, window);
    
    // Count regime occurrences
    const regimeCounts: Record<string, { count: number, confidence: number }> = {};
    
    recent.forEach((classification, index) => {
      // Apply recency weighting (more recent classifications have higher weight)
      const weight = (window - index) / window;
      
      if (!regimeCounts[classification.primaryRegime]) {
        regimeCounts[classification.primaryRegime] = { count: 0, confidence: 0 };
      }
      
      regimeCounts[classification.primaryRegime].count += weight;
      regimeCounts[classification.primaryRegime].confidence += classification.confidence * weight;
    });
    
    // Find the most frequent regime
    let primaryRegime = MarketRegime.Unknown;
    let highestCount = 0;
    let secondaryRegime: MarketRegime | null = null;
    let secondHighestCount = 0;
    
    Object.entries(regimeCounts).forEach(([regime, data]) => {
      if (data.count > highestCount) {
        secondHighestCount = highestCount;
        secondaryRegime = primaryRegime;
        highestCount = data.count;
        primaryRegime = regime as MarketRegime;
      } else if (data.count > secondHighestCount) {
        secondHighestCount = data.count;
        secondaryRegime = regime as MarketRegime;
      }
    });
    
    // Calculate average confidence for the primary regime
    const avgConfidence = regimeCounts[primaryRegime]
      ? regimeCounts[primaryRegime].confidence / regimeCounts[primaryRegime].count
      : 0;
    
    // Determine transition state by looking at consistency
    let transitionState = RegimeTransitionState.Stable;
    
    if (highestCount < window * 0.7) {
      // Less than 70% agreement indicates potential transition
      transitionState = RegimeTransitionState.Transitioning;
    } else if (secondHighestCount > window * 0.3) {
      // Secondary regime is significant
      transitionState = RegimeTransitionState.Developing;
    } else if (avgConfidence < this.config.minimumTransitionConfidence) {
      // Low confidence
      transitionState = RegimeTransitionState.Ambiguous;
    }
    
    // Create smoothed classification
    return {
      primaryRegime,
      secondaryRegime: secondaryRegime === MarketRegime.Unknown ? null : secondaryRegime,
      confidence: avgConfidence,
      transitionState,
      scores: this.aggregateScores(recent),
      timestamp: recent[0].timestamp,
      features: recent[0].features
    };
  }
  
  /**
   * Reset data for a specific symbol
   * @param symbol Market symbol
   */
  public resetSymbol(symbol: string): void {
    this.recentClassifications.delete(symbol);
    this.lastReportedRegimes.delete(symbol);
    this.transitionCounts.delete(symbol);
    logger.info(`Reset transition data for ${symbol}`);
  }
  
  /**
   * Reset all data
   */
  public resetAll(): void {
    this.recentClassifications.clear();
    this.lastReportedRegimes.clear();
    this.transitionCounts.clear();
    this.regimeStats.clear();
    logger.info('Reset all transition data');
  }
  
  /**
   * Add classification to history
   */
  private addClassification(symbol: string, classification: RegimeClassification): void {
    if (!this.recentClassifications.has(symbol)) {
      this.recentClassifications.set(symbol, []);
    }
    
    const classifications = this.recentClassifications.get(symbol)!;
    
    // Add to the beginning (most recent first)
    classifications.unshift(classification);
    
    // Limit the size
    const maxItems = Math.max(10, this.config.transitionSmoothingWindow * 2);
    if (classifications.length > maxItems) {
      classifications.splice(maxItems);
    }
  }
  
  /**
   * Aggregate scores from multiple classifications
   */
  private aggregateScores(classifications: RegimeClassification[]): Record<MarketRegime, number> {
    const result: Record<MarketRegime, number> = {} as Record<MarketRegime, number>;
    const n = classifications.length;
    
    // Initialize scores
    Object.values(MarketRegime).forEach(regime => {
      result[regime] = 0;
    });
    
    // Sum scores
    classifications.forEach((classification, index) => {
      // Apply recency weighting
      const weight = (n - index) / n;
      
      Object.entries(classification.scores).forEach(([regime, score]) => {
        result[regime as MarketRegime] += score * weight;
      });
    });
    
    // Normalize
    Object.keys(result).forEach(regime => {
      result[regime as MarketRegime] /= n;
    });
    
    return result;
  }
  
  /**
   * Handle regime transition
   */
  private handleRegimeTransition(
    symbol: string,
    fromRegime: MarketRegime,
    toClassification: RegimeClassification
  ): void {
    // Increment transition count
    const currentCount = this.transitionCounts.get(symbol) || 0;
    this.transitionCounts.set(symbol, currentCount + 1);
    
    // Create transition event
    const transition: RegimeTransition = {
      fromRegime,
      toRegime: toClassification.primaryRegime,
      detectedAt: Date.now(),
      estimatedStartTime: this.estimateTransitionStart(symbol),
      confidence: toClassification.confidence,
      transitionDurationMs: Date.now() - this.estimateTransitionStart(symbol)
    };
    
    // Notify transition listeners
    this.notifyTransitionListeners(transition, symbol);
    
    // Emit telemetry
    this.telemetry.emit('regime.transition', {
      symbol,
      from: fromRegime,
      to: toClassification.primaryRegime,
      confidence: toClassification.confidence,
      durationMs: transition.transitionDurationMs,
      totalTransitions: this.getTransitionCount(symbol),
      timestamp: Date.now()
    });
    
    logger.info(`Regime transition for ${symbol}: ${fromRegime} -> ${toClassification.primaryRegime}`, {
      confidence: toClassification.confidence,
      durationMs: transition.transitionDurationMs
    });
  }
  
  /**
   * Estimate when a transition started
   */
  private estimateTransitionStart(symbol: string): number {
    const classifications = this.recentClassifications.get(symbol);
    if (!classifications || classifications.length < 2) {
      return Date.now();
    }
    
    // Find when the transition state first became "Developing" or "Transitioning"
    for (let i = 0; i < classifications.length; i++) {
      const state = classifications[i].transitionState;
      if (state === RegimeTransitionState.Developing || 
          state === RegimeTransitionState.Transitioning) {
        return classifications[i].timestamp;
      }
    }
    
    // No clear transition point found, use the oldest classification timestamp
    return classifications[classifications.length - 1].timestamp;
  }
  
  /**
   * Notify transition listeners
   */
  private notifyTransitionListeners(transition: RegimeTransition, symbol: string): void {
    this.transitionListeners.forEach(listener => {
      try {
        listener(transition, symbol);
      } catch (error) {
        logger.error('Error in regime transition listener', error);
      }
    });
  }
  
  /**
   * Notify classification listeners
   */
  private notifyClassificationListeners(classification: RegimeClassification, symbol: string): void {
    this.classificationListeners.forEach(listener => {
      try {
        listener(classification, symbol);
      } catch (error) {
        logger.error('Error in regime classification listener', error);
      }
    });
  }
  
  /**
   * Update regime statistics
   */
  private updateRegimeStats(symbol: string, classification: RegimeClassification): void {
    const regime = classification.primaryRegime;
    
    if (!this.regimeStats.has(regime)) {
      this.regimeStats.set(regime, {
        occurrences: 0,
        avgDuration: 0,
        avgConfidence: 0
      });
    }
    
    const stats = this.regimeStats.get(regime)!;
    
    // Update counts
    stats.occurrences++;
    
    // Update average confidence using running average
    stats.avgConfidence = 
      (stats.avgConfidence * (stats.occurrences - 1) + classification.confidence) / 
      stats.occurrences;
    
    // Update average duration if we have a history
    const history = this.classifier.getRegimeHistory(symbol);
    if (history && history.currentRegimeDurationMs > 0) {
      stats.avgDuration = 
        (stats.avgDuration * (stats.occurrences - 1) + history.currentRegimeDurationMs) / 
        stats.occurrences;
    }
  }
} 