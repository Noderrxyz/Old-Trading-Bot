/**
 * Live position data
 */
export interface LivePosition {
  /** Asset symbol */
  symbol: string;
  
  /** Asset identifier */
  asset: string;
  
  /** Agent identifier */
  agentId: string;
  
  /** Position size */
  size: number;
  
  /** Entry price */
  entryPrice: number;
  
  /** Current price */
  currentPrice: number;
  
  /** Position side (long/short) */
  side: 'long' | 'short';
  
  /** Position value in quote currency */
  value: number;
  
  /** Unrealized P&L */
  unrealizedPnL: number;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Last update timestamp */
  timestamp: number;
}

/**
 * Volatility metric
 */
export interface VolatilityMetric {
  /** Asset symbol */
  symbol: string;
  
  /** Realized volatility */
  realizedVol: number;
  
  /** Baseline volatility */
  baselineVol: number;
  
  /** Volatility ratio (realized/baseline) */
  volRatio: number;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Enforcement action
 */
export interface EnforcementAction {
  /** Whether the action is allowed */
  allowed: boolean;
  
  /** Suggested position size */
  suggestedSize: number;
  
  /** Enforcement reason */
  reason: string;
}

/**
 * Position exposure configuration
 */
export interface PositionExposureConfig {
  /** Whether exposure governance is enabled */
  enabled: boolean;
  
  /** Maximum position size as percentage of equity */
  maxPositionPctEquity: number;
  
  /** Minimum position size as percentage of equity */
  minPositionPctEquity: number;
  
  /** Whether volatility scaling is enabled */
  volatilityScalingEnabled: boolean;
  
  /** Volatility scaling threshold */
  volScaleThreshold: number;
  
  /** Account equity */
  accountEquity: number;
}

/**
 * Default position exposure configuration
 */
export const DEFAULT_POSITION_EXPOSURE_CONFIG: PositionExposureConfig = {
  enabled: true,
  maxPositionPctEquity: 5,
  minPositionPctEquity: 2,
  volatilityScalingEnabled: true,
  volScaleThreshold: 1.5,
  accountEquity: 100000 // Default to 100k for testing
}; 