import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AlphaMemoryManager, MarketRegime, StrategyPattern } from './AlphaMemoryManager.js';
import { MarketRegimeDetector } from '../market/MarketRegimeDetector.js';

/**
 * Recall configuration
 */
interface RecallConfig {
  minPatternAgeMs: number;
  maxPatternsPerRecall: number;
  minTrustScore: number;
  minConsistency: number;
  regimeTransitionBufferMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RecallConfig = {
  minPatternAgeMs: 3600000, // 1 hour
  maxPatternsPerRecall: 5,
  minTrustScore: 0.7,
  minConsistency: 0.6,
  regimeTransitionBufferMs: 300000 // 5 minutes
};

/**
 * Recall result
 */
interface RecallResult {
  regime: MarketRegime;
  patterns: StrategyPattern[];
  confidence: number;
  timestamp: number;
}

/**
 * Memory Recall Engine
 */
export class MemoryRecallEngine {
  private static instance: MemoryRecallEngine;
  private config: RecallConfig;
  private telemetryBus: TelemetryBus;
  private alphaMemory: AlphaMemoryManager;
  private regimeDetector: MarketRegimeDetector;
  private lastRegimeTransition: number;

  private constructor(config: Partial<RecallConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.alphaMemory = AlphaMemoryManager.getInstance();
    this.regimeDetector = MarketRegimeDetector.getInstance();
    this.lastRegimeTransition = 0;
  }

  public static getInstance(config?: Partial<RecallConfig>): MemoryRecallEngine {
    if (!MemoryRecallEngine.instance) {
      MemoryRecallEngine.instance = new MemoryRecallEngine(config);
    }
    return MemoryRecallEngine.instance;
  }

  /**
   * Recall patterns for current regime
   */
  public async recall(agentId: string): Promise<RecallResult> {
    const currentRegime = this.regimeDetector.getCurrentRegime();
    const now = Date.now();

    // Check if we're in a regime transition buffer period
    if (now - this.lastRegimeTransition < this.config.regimeTransitionBufferMs) {
      logger.info('In regime transition buffer period, using previous regime patterns');
      return this.getPreviousRegimePatterns(agentId);
    }

    // Get patterns for current regime
    const patterns = this.alphaMemory.getPatterns(
      agentId,
      currentRegime,
      this.config.minTrustScore
    );

    // Filter and sort patterns
    const filteredPatterns = this.filterAndSortPatterns(patterns);

    // Calculate confidence
    const confidence = this.calculateConfidence(filteredPatterns);

    const result: RecallResult = {
      regime: currentRegime,
      patterns: filteredPatterns,
      confidence,
      timestamp: now
    };

    this.telemetryBus.emit('memory_recall', {
      agentId,
      result
    });

    return result;
  }

  /**
   * Get patterns from previous regime
   */
  private async getPreviousRegimePatterns(agentId: string): Promise<RecallResult> {
    const previousRegime = this.regimeDetector.getPreviousRegime();
    const patterns = this.alphaMemory.getPatterns(
      agentId,
      previousRegime,
      this.config.minTrustScore
    );

    const filteredPatterns = this.filterAndSortPatterns(patterns);
    const confidence = this.calculateConfidence(filteredPatterns);

    return {
      regime: previousRegime,
      patterns: filteredPatterns,
      confidence,
      timestamp: Date.now()
    };
  }

  /**
   * Filter and sort patterns
   */
  private filterAndSortPatterns(patterns: StrategyPattern[]): StrategyPattern[] {
    const now = Date.now();

    return patterns
      .filter(pattern => {
        const ageInMs = now - pattern.timestamp;
        return (
          ageInMs >= this.config.minPatternAgeMs &&
          pattern.trustScore >= this.config.minTrustScore &&
          pattern.consistency >= this.config.minConsistency
        );
      })
      .sort((a, b) => {
        const scoreA = this.alphaMemory.calculateAlphaScore(a);
        const scoreB = this.alphaMemory.calculateAlphaScore(b);
        return scoreB - scoreA;
      })
      .slice(0, this.config.maxPatternsPerRecall);
  }

  /**
   * Calculate confidence in recalled patterns
   */
  private calculateConfidence(patterns: StrategyPattern[]): number {
    if (patterns.length === 0) return 0;

    const now = Date.now();
    const totalWeight = patterns.reduce((sum, pattern) => {
      const ageInDays = (now - pattern.timestamp) / (24 * 60 * 60 * 1000);
      const recencyWeight = Math.exp(-ageInDays / 7); // 7-day half-life
      return sum + recencyWeight;
    }, 0);

    const weightedScore = patterns.reduce((sum, pattern, index) => {
      const ageInDays = (now - pattern.timestamp) / (24 * 60 * 60 * 1000);
      const recencyWeight = Math.exp(-ageInDays / 7);
      const patternWeight = recencyWeight / totalWeight;
      return sum + patternWeight * this.alphaMemory.calculateAlphaScore(pattern);
    }, 0);

    return Math.min(1, weightedScore);
  }

  /**
   * Handle regime transition
   */
  public handleRegimeTransition(): void {
    this.lastRegimeTransition = Date.now();
    this.telemetryBus.emit('regime_transition', {
      timestamp: this.lastRegimeTransition
    });
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    // No cleanup needed
  }
} 