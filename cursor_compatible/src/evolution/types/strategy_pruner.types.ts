import { MarketRegimeState } from '../../market/types/market.types.js';

/**
 * Pruning configuration
 */
export interface PruningConfig {
  softPruneThreshold: number;
  hardPruneThreshold: number;
  minPruningIntervalMs: number;
  softPruneThresholds: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
  capitalPressureThresholds: {
    pnl: number;
  };
  reallocationWeights: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
}

/**
 * Default pruning configuration
 */
export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  softPruneThreshold: 0.3,
  hardPruneThreshold: 0.7,
  minPruningIntervalMs: 3600000, // 1 hour
  softPruneThresholds: {
    sharpeRatio: 0.5,
    maxDrawdown: 0.2,
    winRate: 0.4
  },
  capitalPressureThresholds: {
    pnl: -0.1
  },
  reallocationWeights: {
    sharpeRatio: 0.4,
    maxDrawdown: 0.3,
    winRate: 0.3
  }
};

/**
 * Strategy performance metrics
 */
export interface StrategyMetrics {
  strategyId: string;
  pnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  lastUpdate: number;
}

/**
 * Pruning reason codes
 */
export enum PruningReason {
  PERFORMANCE_DECAY = 'PERFORMANCE_DECAY',
  RISK_EXCEEDED = 'RISK_EXCEEDED',
  WIN_RATE_DECAY = 'WIN_RATE_DECAY',
  CAPITAL_PRESSURE = 'CAPITAL_PRESSURE'
}

/**
 * Pruning action type
 */
export enum PruningAction {
  NONE = 'NONE',
  SOFT_PRUNE = 'SOFT_PRUNE',
  HARD_PRUNE = 'HARD_PRUNE'
}

/**
 * Pruning event
 */
export interface PruningEvent {
  timestamp: number;
  strategyId: string;
  action: PruningAction;
  reasons: PruningReason[];
  metrics: StrategyMetrics;
}

/**
 * Capital reallocation result
 */
export interface ReallocationResult {
  timestamp: number;
  prunedStrategyId: string;
  allocations: Array<{
    strategyId: string;
    weight: number;
  }>;
} 