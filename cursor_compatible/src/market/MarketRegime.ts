/**
 * Market regime types for strategy execution
 * [FIX][CRITICAL] - Unified MarketRegime enum with consistent string values
 */
export enum MarketRegime {
  // Trend-following regimes
  BULLISH_TREND = 'bullish_trend',
  BEARISH_TREND = 'bearish_trend',
  
  // Mean-reversion regimes
  RANGEBOUND = 'rangebound',
  MEAN_REVERTING = 'mean_reverting',
  
  // Volatility regimes
  HIGH_VOLATILITY = 'high_volatility',
  LOW_VOLATILITY = 'low_volatility',
  
  // Liquidity regimes
  HIGH_LIQUIDITY = 'high_liquidity',
  LOW_LIQUIDITY = 'low_liquidity',
  
  // Combined regimes
  BULL_VOLATILE = 'bull_volatile',
  BEAR_VOLATILE = 'bear_volatile',
  RANGEBOUND_LOW_VOL = 'rangebound_low_vol',
  
  // Special periods
  MARKET_STRESS = 'market_stress',
  UNKNOWN = 'unknown'
}

/**
 * Market regime detection result
 */
export interface MarketRegimeDetection {
  regime: MarketRegime;
  confidence: number;
  timestamp: number;
  indicators: {
    trend: number;
    volatility: number;
    volume: number;
    momentum: number;
  };
} 