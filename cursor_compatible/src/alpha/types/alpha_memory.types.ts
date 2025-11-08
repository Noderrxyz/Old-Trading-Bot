/**
 * Strategy performance metrics in a specific regime
 */
export interface RegimeStrategyPerformance {
  /** Number of trades executed */
  count: number;
  
  /** Average PnL per trade */
  avgPnl: number;
  
  /** Last update timestamp */
  lastUpdate: number;
  
  /** Weighted score (decayed over time) */
  weightedScore: number;
}

/**
 * Regime-strategy performance map
 */
export interface RegimeStrategyMap {
  [regime: string]: {
    [strategy: string]: RegimeStrategyPerformance;
  };
}

/**
 * Alpha memory configuration
 */
export interface AlphaMemoryConfig {
  /** Whether memory tracking is enabled */
  enabled: boolean;
  
  /** Decay rate per day (0-1) */
  decayRate: number;
  
  /** Minimum trades required for strategy selection */
  minTradesForDecision: number;
  
  /** Save interval in seconds */
  saveIntervalSec: number;
  
  /** Memory visualization settings */
  visualization: {
    /** Whether visualization is enabled */
    enabled: boolean;
    
    /** Update interval in seconds */
    updateIntervalSec: number;
  };
}

/**
 * Default alpha memory configuration
 */
export const DEFAULT_ALPHA_MEMORY_CONFIG: AlphaMemoryConfig = {
  enabled: true,
  decayRate: 0.01,  // 1% decay per day
  minTradesForDecision: 10,
  saveIntervalSec: 3600,  // 1 hour
  visualization: {
    enabled: true,
    updateIntervalSec: 3600  // 1 hour
  }
}; 