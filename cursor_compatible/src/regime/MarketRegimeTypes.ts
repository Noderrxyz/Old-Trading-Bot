/**
 * Market regime types and related interfaces
 */

/**
 * Market regime types
 */
export enum MarketRegime {
  // Trend-following regimes
  BullishTrend = 'bullish_trend',
  BearishTrend = 'bearish_trend',
  
  // Mean-reversion regimes
  Rangebound = 'rangebound',
  MeanReverting = 'mean_reverting',
  
  // Volatility regimes
  HighVolatility = 'high_volatility',
  LowVolatility = 'low_volatility',
  
  // Liquidity regimes
  HighLiquidity = 'high_liquidity',
  LowLiquidity = 'low_liquidity',
  
  // Combined regimes
  BullVolatile = 'bull_volatile',
  BearVolatile = 'bear_volatile',
  RangeboundLowVol = 'rangebound_low_vol',
  
  // Special periods
  MarketStress = 'market_stress',
  Unknown = 'unknown'
}

/**
 * Regime transition states
 */
export enum RegimeTransitionState {
  /**
   * Stable regime with high confidence
   */
  Stable = 'stable',

  /**
   * Possible regime transition developing
   */
  Developing = 'developing',

  /**
   * Confirmed regime transition in progress
   */
  Transitioning = 'transitioning',

  /**
   * Regime with low confidence or conflicting signals
   */
  Ambiguous = 'ambiguous'
}

/**
 * Market features used for regime classification
 */
export interface MarketFeatures {
  // Price and returns
  price: number;
  returns1d: number;
  returns5d: number;
  returns20d: number;
  
  // Volatility features
  volatility1d: number;
  volatility5d: number;
  volatility20d: number;
  
  // Volume features
  volumeRatio1d: number;
  volumeRatio5d: number;
  
  // Technical indicators
  rsi14: number;
  atr14: number;
  bbWidth: number;
  macdHistogram: number;
  
  // Market breadth
  advanceDeclineRatio: number;
  marketCap: number;
  
  // Optional macro features
  vix?: number;
  usdIndex?: number;
  yieldCurve?: number;
}

/**
 * Result of a regime classification
 */
export interface RegimeClassification {
  /**
   * Primary market regime
   */
  primaryRegime: MarketRegime;
  
  /**
   * Secondary market regime (if applicable)
   */
  secondaryRegime: MarketRegime | null;
  
  /**
   * Confidence score for the classification (0-1)
   */
  confidence: number;

  /**
   * Transition state
   */
  transitionState: RegimeTransitionState;
  
  /**
   * Raw scores for each regime type (for debugging)
   */
  scores: Record<MarketRegime, number>;
  
  /**
   * Classification timestamp
   */
  timestamp: number;
  
  /**
   * Features used for classification
   */
  features: MarketFeatures;
}

/**
 * History of regime classifications
 */
export interface RegimeHistory {
  /**
   * Market symbol
   */
  symbol: string;
  
  /**
   * Most recent classifications (newest first)
   */
  classifications: RegimeClassification[];
  
  /**
   * First detection of current regime
   */
  currentRegimeStartTime: number;
  
  /**
   * Duration of current regime in milliseconds
   */
  currentRegimeDurationMs: number;

  /**
   * Transition history
   */
  transitions: RegimeTransition[];
}

/**
 * Regime transition event
 */
export interface RegimeTransition {
  /**
   * Previous regime
   */
  fromRegime: MarketRegime;
  
  /**
   * New regime
   */
  toRegime: MarketRegime;
  
  /**
   * Timestamp when transition was detected
   */
  detectedAt: number;
  
  /**
   * Estimated timestamp when transition began
   */
  estimatedStartTime: number;
  
  /**
   * Transition confidence (0-1)
   */
  confidence: number;
  
  /**
   * Duration of transition period in milliseconds
   */
  transitionDurationMs: number;
}

/**
 * Configuration for regime classifier
 */
export interface RegimeClassifierConfig {
  /**
   * Window size for trend detection (in days)
   */
  trendWindow: number;
  
  /**
   * Window size for volatility calculation (in days)
   */
  volatilityWindow: number;
  
  /**
   * RSI threshold for overbought condition
   */
  rsiOverbought: number;
  
  /**
   * RSI threshold for oversold condition
   */
  rsiOversold: number;
  
  /**
   * High volatility threshold (annualized)
   */
  highVolatilityThreshold: number;
  
  /**
   * Minimum confidence threshold for classification
   */
  minimumConfidence: number;
  
  /**
   * Max history items to keep per symbol
   */
  maxHistoryItems: number;

  /**
   * Regime transition confidence threshold
   */
  transitionConfidenceThreshold: number;

  /**
   * Number of consecutive readings required to confirm regime change
   */
  regimeConfirmationCount: number;

  /**
   * Emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
}

/**
 * Default configuration for regime classifier
 */
export const DEFAULT_REGIME_CLASSIFIER_CONFIG: RegimeClassifierConfig = {
  trendWindow: 20,
  volatilityWindow: 20,
  rsiOverbought: 70,
  rsiOversold: 30,
  highVolatilityThreshold: 30, // 30% annualized volatility
  minimumConfidence: 0.6,
  maxHistoryItems: 100,
  transitionConfidenceThreshold: 0.75,
  regimeConfirmationCount: 3,
  emitDetailedTelemetry: true
}; 