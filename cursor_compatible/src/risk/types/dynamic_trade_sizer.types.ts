/**
 * Trade size adjustment event
 */
export interface TradeSizeAdjustmentEvent {
  /** Asset symbol */
  symbol: string;
  
  /** Base position size */
  baseSize: number;
  
  /** Adjusted position size */
  adjustedSize: number;
  
  /** Current volatility */
  volatility: number;
  
  /** Reason for adjustment */
  adjustmentReason: string;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Dynamic trade sizer configuration
 */
export interface DynamicTradeSizerConfig {
  /** Whether dynamic sizing is enabled */
  enabled: boolean;
  
  /** Volatility measurement window in seconds */
  volatilityWindowSec: number;
  
  /** High volatility threshold (standard deviation) */
  thresholdHigh: number;
  
  /** Low volatility threshold (standard deviation) */
  thresholdLow: number;
  
  /** Scale factor for high volatility */
  highVolatilityScale: number;
  
  /** Scale factor for low volatility */
  lowVolatilityScale: number;
  
  /** Minimum position size */
  minPositionSize: number;
  
  /** Maximum position size */
  maxPositionSize: number;
  
  /** Alert webhook URL */
  alertWebhook?: string;
}

/**
 * Default dynamic trade sizer configuration
 */
export const DEFAULT_DYNAMIC_TRADE_SIZER_CONFIG: DynamicTradeSizerConfig = {
  enabled: true,
  volatilityWindowSec: 60,
  thresholdHigh: 0.03,  // 3% standard deviation
  thresholdLow: 0.01,   // 1% standard deviation
  highVolatilityScale: 0.5,
  lowVolatilityScale: 1.25,
  minPositionSize: 0.001,
  maxPositionSize: 1.0
}; 