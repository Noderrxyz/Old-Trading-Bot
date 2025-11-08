/**
 * Strategy performance metrics
 */
export interface StrategyPerformance {
  /** Strategy name */
  strategyName: string;
  
  /** Profit and Loss */
  pnl: number;
  
  /** Sharpe ratio */
  sharpe: number;
  
  /** Volatility */
  volatility: number;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Strategy configuration
 */
export interface StrategyConfig {
  /** Risk per trade */
  riskPerTrade: number;
  
  /** Profit target */
  profitTarget: number;
  
  /** Stop loss */
  stopLoss: number;
  
  /** Signal sensitivity */
  signalSensitivity: number;
  
  /** Additional parameters */
  [key: string]: number;
}

/**
 * Strategy mutation result
 */
export interface StrategyMutation {
  /** Original strategy name */
  originalStrategy: string;
  
  /** Mutated strategy name */
  mutatedStrategy: string;
  
  /** Original configuration */
  originalConfig: StrategyConfig;
  
  /** Mutated configuration */
  mutatedConfig: StrategyConfig;
  
  /** Mutation timestamp */
  timestamp: number;
}

/**
 * Adaptive mutation configuration
 */
export interface AdaptiveMutationConfig {
  /** Whether mutation is enabled */
  enabled: boolean;
  
  /** Evaluation interval in seconds */
  evaluationIntervalSec: number;
  
  /** Sharpe ratio mutation threshold */
  sharpeMutationThreshold: number;
  
  /** PnL mutation threshold */
  pnlMutationThreshold: number;
  
  /** Mutation strength (random variation percentage) */
  mutationStrength: number;
  
  /** Maximum mutations per hour */
  maxMutationsPerHour: number;
  
  /** Whether to auto-activate best mutation */
  autoActivateBestMutation: boolean;
  
  /** Performance history retention in seconds */
  performanceHistorySec: number;
}

/**
 * Default adaptive mutation configuration
 */
export const DEFAULT_ADAPTIVE_MUTATION_CONFIG: AdaptiveMutationConfig = {
  enabled: true,
  evaluationIntervalSec: 300,  // 5 minutes
  sharpeMutationThreshold: 0.3,
  pnlMutationThreshold: -0.01,
  mutationStrength: 0.05,      // 5% default random variation
  maxMutationsPerHour: 5,
  autoActivateBestMutation: true,
  performanceHistorySec: 3600  // 1 hour
}; 