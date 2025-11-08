import { AlphaFrame } from '../../alphasources/types.js';

/**
 * Timescale categories for alpha signals
 */
export enum Timescale {
  SHORT_TERM = 'SHORT_TERM',  // 1m-5m signals
  MID_TERM = 'MID_TERM',      // 15m-1h signals
  LONG_TERM = 'LONG_TERM'     // 4h-1d signals
}

/**
 * Configuration for multi-timescale fusion
 */
export interface MultiTimescaleConfig {
  /** Whether multi-timescale fusion is enabled */
  enabled: boolean;
  
  /** Volatility-based weighting configuration */
  volatilityWeighting: {
    /** Threshold above which volatility is considered high */
    highVolatilityThreshold: number;
    /** Threshold below which volatility is considered low */
    lowVolatilityThreshold: number;
    /** Weight bias for short-term signals in high volatility */
    shortTermBias: number;
    /** Weight bias for long-term signals in low volatility */
    longTermBias: number;
  };
  
  /** Number of samples to consider for recent performance */
  recentPerformanceWindow: number;
  
  /** Minimum number of signals required for fusion */
  minSignalsPerTimescale: number;
  
  /** Maximum age of signals in milliseconds */
  maxSignalAgeMs: number;
}

/**
 * Performance metrics for a timescale
 */
export interface TimescalePerformance {
  /** Sharpe ratio of recent signals */
  sharpeRatio: number;
  /** Win rate of recent signals */
  winRate: number;
  /** Average return per signal */
  avgReturn: number;
  /** Number of signals in the window */
  signalCount: number;
}

/**
 * Fused alpha frame combining signals from multiple timescales
 */
export interface MultiTimescaleAlphaFrame {
  /** Asset symbol */
  symbol: string;
  
  /** Fused alpha score (0-1) */
  fusedScore: number;
  
  /** Individual contributions from each timescale */
  contributions: Record<Timescale, number>;
  
  /** Performance metrics for each timescale */
  performance: Record<Timescale, TimescalePerformance>;
  
  /** Timestamp of fusion */
  timestamp: number;
  
  /** Metadata about the fusion process */
  metadata: {
    /** Current volatility regime */
    volatilityRegime: 'HIGH' | 'MEDIUM' | 'LOW';
    /** Trend strength (0-1) */
    trendStrength: number;
    /** Number of signals used in fusion */
    signalCount: number;
  };
}

/**
 * Default configuration for multi-timescale fusion
 */
export const DEFAULT_MULTI_TIMESCALE_CONFIG: MultiTimescaleConfig = {
  enabled: true,
  volatilityWeighting: {
    highVolatilityThreshold: 0.05,
    lowVolatilityThreshold: 0.02,
    shortTermBias: 0.6,
    longTermBias: 0.4
  },
  recentPerformanceWindow: 300,
  minSignalsPerTimescale: 3,
  maxSignalAgeMs: 3600000 // 1 hour
}; 