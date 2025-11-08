import { MarketRegimeState } from '../../market/types/market.types.js';

/**
 * Strategy performance metrics for a specific regime
 */
export interface RegimePerformanceMetrics {
  roi: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trustScore: number;
  winRate: number;
  avgTradeDuration: number;
  regime: MarketRegimeState;
  timestamp: number;
}

/**
 * Memory window configuration
 */
export interface MemoryWindowConfig {
  windowSize: number;  // Number of periods to keep in memory
  decayFactor: number;  // How quickly old memories fade (0-1)
  minConfidence: number;  // Minimum confidence to include in memory
  updateIntervalMs: number;  // How often to update memory windows
}

/**
 * Memory window for a specific regime
 */
export interface RegimeMemoryWindow {
  regime: MarketRegimeState;
  topStrategies: Array<{
    strategyId: string;
    metrics: RegimePerformanceMetrics;
    weight: number;
  }>;
  lastUpdate: number;
  confidence: number;
}

/**
 * Alpha memory manager configuration
 */
export interface AlphaMemoryConfig {
  enabled: boolean;
  memoryWindows: {
    [K in MarketRegimeState]: MemoryWindowConfig;
  };
  trustScoreBoost: {
    [K in MarketRegimeState]: number;
  };
  decayRate: {
    [K in MarketRegimeState]: number;
  };
  rebalancingThreshold: number;
  updateIntervalMs: number;
}

/**
 * Default configuration for alpha memory manager
 */
export const DEFAULT_ALPHA_MEMORY_CONFIG: AlphaMemoryConfig = {
  enabled: true,
  memoryWindows: {
    [MarketRegimeState.Bull]: {
      windowSize: 100,
      decayFactor: 0.95,
      minConfidence: 0.7,
      updateIntervalMs: 60000
    },
    [MarketRegimeState.Bear]: {
      windowSize: 100,
      decayFactor: 0.95,
      minConfidence: 0.7,
      updateIntervalMs: 60000
    },
    [MarketRegimeState.Sideways]: {
      windowSize: 100,
      decayFactor: 0.95,
      minConfidence: 0.7,
      updateIntervalMs: 60000
    },
    [MarketRegimeState.Volatile]: {
      windowSize: 100,
      decayFactor: 0.95,
      minConfidence: 0.7,
      updateIntervalMs: 60000
    },
    [MarketRegimeState.Unknown]: {
      windowSize: 100,
      decayFactor: 0.95,
      minConfidence: 0.7,
      updateIntervalMs: 60000
    }
  },
  trustScoreBoost: {
    [MarketRegimeState.Bull]: 0.2,
    [MarketRegimeState.Bear]: 0.2,
    [MarketRegimeState.Sideways]: 0.2,
    [MarketRegimeState.Volatile]: 0.2,
    [MarketRegimeState.Unknown]: 0.0
  },
  decayRate: {
    [MarketRegimeState.Bull]: 0.1,
    [MarketRegimeState.Bear]: 0.1,
    [MarketRegimeState.Sideways]: 0.1,
    [MarketRegimeState.Volatile]: 0.1,
    [MarketRegimeState.Unknown]: 0.0
  },
  rebalancingThreshold: 0.3,
  updateIntervalMs: 60000
}; 