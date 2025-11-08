/**
 * Alpha Fusion Engine
 * 
 * Combines multiple alpha signals into a single fused signal with confidence,
 * direction, and size suggestion — driven by source weights and diversity.
 */

import { AlphaFrame } from './types.js';
import { createLogger } from '../common/logger.js';

/**
 * Direction of the alpha signal
 */
export enum SignalDirection {
  LONG = 'long',
  SHORT = 'short',
  NEUTRAL = 'neutral'
}

/**
 * Configuration for the Alpha Fusion Engine
 */
export interface FusionEngineConfig {
  /** Minimum confidence threshold for generating a signal */
  minConfidenceThreshold: number;
  
  /** Maximum position size (0-1) */
  maxPositionSize: number;
  
  /** Minimum position size (0-1) */
  minPositionSize: number;
  
  /** Weight to give to source diversity in confidence calculation */
  diversityWeight: number;
  
  /** Weight to give to signal agreement in confidence calculation */
  agreementWeight: number;
  
  /** Weight to give to score strength in confidence calculation */
  strengthWeight: number;
  
  /** Minimum number of sources for high confidence */
  minSourcesForHighConfidence: number;
  
  /** Log detailed fusion calculations */
  logDetailedCalculations: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: FusionEngineConfig = {
  minConfidenceThreshold: 0.4,
  maxPositionSize: 1.0,
  minPositionSize: 0.1,
  diversityWeight: 0.3,
  agreementWeight: 0.4,
  strengthWeight: 0.3,
  minSourcesForHighConfidence: 3,
  logDetailedCalculations: false
};

/**
 * Fused alpha frame output 
 */
export interface FusedAlphaFrame {
  /** Asset symbol (e.g., "BTC/USDC") */
  symbol: string;
  
  /** Signal direction (long, short, neutral) */
  direction: SignalDirection;
  
  /** Confidence in the signal (0-1) */
  confidence: number;
  
  /** Suggested position size (0-1) */
  size: number;
  
  /** Sources that contributed to this signal */
  sources: string[];
  
  /** Detailed information about the signal */
  details: Array<AlphaFrame & { weight?: number }>;
  
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Internal score calculation for a symbol
 */
interface SymbolScores {
  /** Total weighted score for long signals */
  longScore: number;
  
  /** Total weighted score for short signals */
  shortScore: number;
  
  /** Total weights for all signals */
  totalWeight: number;
  
  /** Number of signals */
  signalCount: number;
  
  /** Number of unique sources */
  uniqueSources: Set<string>;
  
  /** Signal details */
  signals: Array<AlphaFrame & { weight?: number }>;
  
  /** Latest timestamp */
  latestTimestamp: number;
}

/**
 * Alpha Fusion Engine
 */
export class AlphaFusionEngine {
  private readonly logger;
  private readonly config: FusionEngineConfig;
  
  /**
   * Create a new Alpha Fusion Engine
   * @param config Engine configuration
   */
  constructor(config: Partial<FusionEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('AlphaFusionEngine');
    
    this.logger.info('Alpha Fusion Engine initialized');
  }
  
  /**
   * Fuse multiple alpha signals into a single signal
   * @param signals Alpha signals to fuse
   * @returns Fused alpha signal
   */
  public fuse(signals: Array<AlphaFrame & { weight?: number }>): FusedAlphaFrame[] {
    if (!signals.length) {
      this.logger.debug('No signals to fuse');
      return [];
    }
    
    this.logger.debug(`Fusing ${signals.length} alpha signals`);
    
    // Group signals by symbol
    const symbolGroups = this.groupBySymbol(signals);
    
    // Calculate fused signals for each symbol
    const fusedSignals: FusedAlphaFrame[] = [];
    
    for (const [symbol, scores] of symbolGroups.entries()) {
      const fusedSignal = this.fuseSymbolSignals(symbol, scores);
      
      // Add signal if confidence is above threshold
      if (fusedSignal.confidence >= this.config.minConfidenceThreshold) {
        fusedSignals.push(fusedSignal);
      }
    }
    
    this.logger.info(`Fused ${signals.length} signals into ${fusedSignals.length} signals`);
    return fusedSignals;
  }
  
  /**
   * Group signals by symbol
   * @param signals Alpha signals
   * @returns Map of symbol to symbol scores
   */
  private groupBySymbol(signals: Array<AlphaFrame & { weight?: number }>): Map<string, SymbolScores> {
    const symbolGroups = new Map<string, SymbolScores>();
    
    for (const signal of signals) {
      const symbol = signal.symbol;
      let scores = symbolGroups.get(symbol);
      
      // Create new scores object if it doesn't exist
      if (!scores) {
        scores = {
          longScore: 0,
          shortScore: 0,
          totalWeight: 0,
          signalCount: 0,
          uniqueSources: new Set<string>(),
          signals: [],
          latestTimestamp: 0
        };
        symbolGroups.set(symbol, scores);
      }
      
      // Get signal weight (default to 1.0)
      const weight = signal.weight !== undefined ? signal.weight : 1.0;
      
      // Determine direction based on score
      // Score > 0.5 is bullish, score < 0.5 is bearish
      if (signal.score >= 0.5) {
        scores.longScore += (signal.score - 0.5) * 2 * weight; // Normalize to 0-1
      } else {
        scores.shortScore += (0.5 - signal.score) * 2 * weight; // Normalize to 0-1
      }
      
      // Update scores
      scores.totalWeight += weight;
      scores.signalCount++;
      scores.uniqueSources.add(signal.source);
      scores.signals.push(signal);
      scores.latestTimestamp = Math.max(scores.latestTimestamp, signal.timestamp);
    }
    
    return symbolGroups;
  }
  
  /**
   * Fuse signals for a single symbol
   * @param symbol Asset symbol
   * @param scores Symbol scores
   * @returns Fused alpha signal
   */
  private fuseSymbolSignals(symbol: string, scores: SymbolScores): FusedAlphaFrame {
    // Determine signal direction
    let direction: SignalDirection;
    let strengthScore: number;
    
    if (scores.longScore > scores.shortScore) {
      direction = SignalDirection.LONG;
      strengthScore = scores.longScore;
    } else if (scores.shortScore > scores.longScore) {
      direction = SignalDirection.SHORT;
      strengthScore = scores.shortScore;
    } else {
      direction = SignalDirection.NEUTRAL;
      strengthScore = 0;
    }
    
    // Calculate agreement score
    // How much do the signals agree with each other?
    let agreementScore: number;
    
    if (direction === SignalDirection.NEUTRAL) {
      agreementScore = 0.5; // No clear direction
    } else {
      const dominantScore = direction === SignalDirection.LONG ? scores.longScore : scores.shortScore;
      const oppositeScore = direction === SignalDirection.LONG ? scores.shortScore : scores.longScore;
      
      // If there's no opposite signal, agreement is perfect
      if (oppositeScore === 0) {
        agreementScore = 1.0;
      } else {
        // Calculate ratio of dominant to total directional score
        agreementScore = dominantScore / (dominantScore + oppositeScore);
      }
    }
    
    // Calculate diversity score
    // Higher when there are more unique sources
    const diversityScore = Math.min(1.0, 
      scores.uniqueSources.size / this.config.minSourcesForHighConfidence);
    
    // Calculate signal strength
    // Higher when the weighted score is stronger
    let normalizedStrengthScore: number;
    
    if (direction === SignalDirection.NEUTRAL) {
      normalizedStrengthScore = 0;
    } else {
      // Normalize by total weight
      normalizedStrengthScore = scores.totalWeight > 0 ? 
        strengthScore / scores.totalWeight : 0;
    }
    
    // Calculate final confidence
    const confidence = this.calculateConfidence(
      agreementScore,
      diversityScore,
      normalizedStrengthScore
    );
    
    // Calculate position size based on confidence
    const size = this.calculatePositionSize(confidence);
    
    // Create source list
    const sources = Array.from(scores.uniqueSources);
    
    // Log detailed calculations if enabled
    if (this.config.logDetailedCalculations) {
      this.logger.debug(`Fusion details for ${symbol}:
        Direction: ${direction}
        Agreement: ${agreementScore.toFixed(2)}
        Diversity: ${diversityScore.toFixed(2)} (${scores.uniqueSources.size} sources)
        Strength: ${normalizedStrengthScore.toFixed(2)}
        Final Confidence: ${confidence.toFixed(2)}
        Position Size: ${size.toFixed(2)}`);
    }
    
    return {
      symbol,
      direction,
      confidence,
      size,
      sources,
      details: scores.signals,
      timestamp: scores.latestTimestamp
    };
  }
  
  /**
   * Calculate signal confidence
   * @param agreementScore Agreement score
   * @param diversityScore Diversity score
   * @param strengthScore Strength score
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(
    agreementScore: number,
    diversityScore: number,
    strengthScore: number
  ): number {
    // Weighted average of the three components
    const confidence = 
      (agreementScore * this.config.agreementWeight) +
      (diversityScore * this.config.diversityWeight) +
      (strengthScore * this.config.strengthWeight);
    
    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * Calculate suggested position size
   * @param confidence Confidence score
   * @returns Suggested position size (0-1)
   */
  private calculatePositionSize(confidence: number): number {
    // Linear scaling from min to max size based on confidence
    if (confidence <= this.config.minConfidenceThreshold) {
      return 0; // Below threshold, no position
    }
    
    // Scale position size from min to max based on confidence
    const scaledConfidence = (confidence - this.config.minConfidenceThreshold) / 
                            (1 - this.config.minConfidenceThreshold);
    
    const positionSize = this.config.minPositionSize + 
                        scaledConfidence * (this.config.maxPositionSize - this.config.minPositionSize);
    
    return Math.max(0, Math.min(this.config.maxPositionSize, positionSize));
  }
  
  /**
   * Calculate entropy of signal weights
   * Use to measure source diversity
   * @param signals Array of signals with weights
   * @returns Entropy value
   */
  private calculateWeightEntropy(signals: Array<AlphaFrame & { weight?: number }>): number {
    // Group by source and sum weights
    const sourceWeights = new Map<string, number>();
    let totalWeight = 0;
    
    for (const signal of signals) {
      const weight = signal.weight !== undefined ? signal.weight : 1.0;
      const currentWeight = sourceWeights.get(signal.source) || 0;
      sourceWeights.set(signal.source, currentWeight + weight);
      totalWeight += weight;
    }
    
    // Calculate entropy
    let entropy = 0;
    
    for (const weight of sourceWeights.values()) {
      const p = weight / totalWeight;
      entropy -= p * Math.log(p);
    }
    
    // Normalize by log(n) to get a value between 0 and 1
    const maxEntropy = Math.log(sourceWeights.size);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }
  
  /**
   * Fuse multiple alpha signals from multiple sources by symbol
   * @param signalsBySymbol Map of symbol to array of signals
   * @returns Array of fused signals
   */
  public fuseSignals(signalsBySymbol: Map<string, AlphaFrame[]>): FusedAlphaFrame[] {
    const results: FusedAlphaFrame[] = [];
    
    for (const [symbol, signals] of signalsBySymbol.entries()) {
      if (!signals.length) continue;
      
      // Fuse signals for each symbol
      const fusedSignal = this.fuse(signals);
      
      if (fusedSignal.length > 0) {
        results.push(...fusedSignal);
      }
    }
    
    return results;
  }
} 