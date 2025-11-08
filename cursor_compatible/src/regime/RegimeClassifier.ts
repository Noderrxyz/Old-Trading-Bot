/**
 * Market regime classification for adaptive strategy execution
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
   * Raw scores for each regime type (for debugging)
   */
  scores: Record<MarketRegime, number>;
  
  /**
   * Classification timestamp
   */
  timestamp: Date;
  
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
  currentRegimeStartTime: Date;
  
  /**
   * Duration of current regime in milliseconds
   */
  currentRegimeDurationMs: number;
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
  maxHistoryItems: 100
};

/**
 * Regime classifier for market adaptive strategy execution
 */
export class RegimeClassifier {
  private config: RegimeClassifierConfig;
  private regimeHistory: Map<string, RegimeHistory>;
  private static instance: RegimeClassifier | null = null;
  
  /**
   * Create a new RegimeClassifier
   * @param config Configuration options
   */
  private constructor(config: Partial<RegimeClassifierConfig> = {}) {
    this.config = {
      ...DEFAULT_REGIME_CLASSIFIER_CONFIG,
      ...config
    };
    
    this.regimeHistory = new Map<string, RegimeHistory>();
  }
  
  /**
   * Get singleton instance
   * @param config Configuration options
   */
  public static getInstance(config: Partial<RegimeClassifierConfig> = {}): RegimeClassifier {
    if (!RegimeClassifier.instance) {
      RegimeClassifier.instance = new RegimeClassifier(config);
    }
    return RegimeClassifier.instance;
  }
  
  /**
   * Classify market regime based on features
   * @param symbol Market symbol
   * @param features Market features
   * @returns Regime classification
   */
  public classifyRegime(symbol: string, features: MarketFeatures): RegimeClassification {
    // Calculate scores for each regime
    const scores = this.calculateRegimeScores(features);
    
    // Find the highest scoring regime
    let highestScore = -Infinity;
    let primaryRegime = MarketRegime.Unknown;
    let secondaryRegime: MarketRegime | null = null;
    let secondHighestScore = -Infinity;
    
    Object.entries(scores).forEach(([regime, score]) => {
      if (score > highestScore) {
        secondHighestScore = highestScore;
        secondaryRegime = primaryRegime;
        highestScore = score;
        primaryRegime = regime as MarketRegime;
      } else if (score > secondHighestScore) {
        secondHighestScore = score;
        secondaryRegime = regime as MarketRegime;
      }
    });
    
    // Calculate confidence as the difference between highest and second highest scores
    // normalized to [0, 1] range
    const confidence = Math.min(1, Math.max(0, (highestScore - secondHighestScore) / 2 + 0.5));
    
    // Create classification result
    const classification: RegimeClassification = {
      primaryRegime,
      secondaryRegime: secondaryRegime === MarketRegime.Unknown ? null : secondaryRegime,
      confidence,
      scores: scores as Record<MarketRegime, number>,
      timestamp: new Date(),
      features
    };
    
    // Update history
    this.updateHistory(symbol, classification);
    
    return classification;
  }
  
  /**
   * Get the current regime for a symbol
   * @param symbol Market symbol
   * @returns Current regime classification or null if not available
   */
  public getCurrentRegime(symbol: string): RegimeClassification | null {
    const history = this.regimeHistory.get(symbol);
    if (!history || history.classifications.length === 0) {
      return null;
    }
    
    return history.classifications[0];
  }
  
  /**
   * Get the current primary regime for a symbol
   * @param symbol Market symbol
   * @returns Current primary regime or Unknown if not available
   */
  public getCurrentPrimaryRegime(symbol: string): MarketRegime {
    const regime = this.getCurrentRegime(symbol);
    return regime?.primaryRegime || MarketRegime.Unknown;
  }
  
  /**
   * Get regime history for a symbol
   * @param symbol Market symbol
   * @returns Regime history or null if not available
   */
  public getRegimeHistory(symbol: string): RegimeHistory | null {
    return this.regimeHistory.get(symbol) || null;
  }
  
  /**
   * Check if a regime change has occurred
   * @param symbol Market symbol
   * @param lookbackItems Number of items to look back (default: 2)
   * @returns True if a regime change has occurred
   */
  public hasRegimeChanged(symbol: string, lookbackItems: number = 2): boolean {
    const history = this.regimeHistory.get(symbol);
    if (!history || history.classifications.length < lookbackItems) {
      return false;
    }
    
    const currentRegime = history.classifications[0].primaryRegime;
    const previousRegime = history.classifications[lookbackItems - 1].primaryRegime;
    
    return currentRegime !== previousRegime;
  }
  
  /**
   * Get all symbols being tracked
   * @returns Array of tracked symbols
   */
  public getTrackedSymbols(): string[] {
    return Array.from(this.regimeHistory.keys());
  }
  
  /**
   * Reset history for a symbol
   * @param symbol Market symbol
   */
  public resetHistory(symbol: string): void {
    this.regimeHistory.delete(symbol);
  }
  
  /**
   * Reset all history
   */
  public resetAllHistory(): void {
    this.regimeHistory.clear();
  }
  
  /**
   * Update regime history for a symbol
   * @param symbol Market symbol
   * @param classification New classification
   */
  private updateHistory(symbol: string, classification: RegimeClassification): void {
    let history = this.regimeHistory.get(symbol);
    
    if (!history) {
      // Create new history
      history = {
        symbol,
        classifications: [],
        currentRegimeStartTime: new Date(),
        currentRegimeDurationMs: 0
      };
      this.regimeHistory.set(symbol, history);
    }
    
    // Check if regime has changed
    const hasChanged = history.classifications.length > 0 && 
      history.classifications[0].primaryRegime !== classification.primaryRegime;
    
    if (hasChanged) {
      // Update regime start time
      history.currentRegimeStartTime = new Date();
      history.currentRegimeDurationMs = 0;
    } else if (history.classifications.length > 0) {
      // Update duration
      history.currentRegimeDurationMs = Date.now() - history.currentRegimeStartTime.getTime();
    }
    
    // Add to history
    history.classifications.unshift(classification);
    
    // Trim history if needed
    if (history.classifications.length > this.config.maxHistoryItems) {
      history.classifications = history.classifications.slice(0, this.config.maxHistoryItems);
    }
  }
  
  /**
   * Calculate scores for each regime
   * @param features Market features
   * @returns Scores for each regime (higher is more likely)
   */
  private calculateRegimeScores(features: MarketFeatures): Record<string, number> {
    const scores: Record<string, number> = {};
    
    // Trend scores
    scores[MarketRegime.BullishTrend] = this.calculateBullishTrendScore(features);
    scores[MarketRegime.BearishTrend] = this.calculateBearishTrendScore(features);
    
    // Mean-reversion scores
    scores[MarketRegime.Rangebound] = this.calculateRangeboundScore(features);
    scores[MarketRegime.MeanReverting] = this.calculateMeanRevertingScore(features);
    
    // Volatility scores
    scores[MarketRegime.HighVolatility] = this.calculateHighVolatilityScore(features);
    scores[MarketRegime.LowVolatility] = this.calculateLowVolatilityScore(features);
    
    // Liquidity scores
    scores[MarketRegime.HighLiquidity] = this.calculateHighLiquidityScore(features);
    scores[MarketRegime.LowLiquidity] = this.calculateLowLiquidityScore(features);
    
    // Combined scores
    scores[MarketRegime.BullVolatile] = (scores[MarketRegime.BullishTrend] + scores[MarketRegime.HighVolatility]) / 2;
    scores[MarketRegime.BearVolatile] = (scores[MarketRegime.BearishTrend] + scores[MarketRegime.HighVolatility]) / 2;
    scores[MarketRegime.RangeboundLowVol] = (scores[MarketRegime.Rangebound] + scores[MarketRegime.LowVolatility]) / 2;
    
    // Special periods
    scores[MarketRegime.MarketStress] = this.calculateMarketStressScore(features);
    scores[MarketRegime.Unknown] = 0;
    
    return scores;
  }
  
  /**
   * Calculate bullish trend score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateBullishTrendScore(features: MarketFeatures): number {
    let score = 0;
    
    // Positive returns
    if (features.returns20d > 0) score += 0.3;
    if (features.returns5d > 0) score += 0.2;
    if (features.returns1d > 0) score += 0.1;
    
    // Momentum indicators
    if (features.rsi14 > 50) score += 0.2 * (features.rsi14 - 50) / 50;
    if (features.macdHistogram > 0) score += 0.2;
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate bearish trend score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateBearishTrendScore(features: MarketFeatures): number {
    let score = 0;
    
    // Negative returns
    if (features.returns20d < 0) score += 0.3;
    if (features.returns5d < 0) score += 0.2;
    if (features.returns1d < 0) score += 0.1;
    
    // Momentum indicators
    if (features.rsi14 < 50) score += 0.2 * (50 - features.rsi14) / 50;
    if (features.macdHistogram < 0) score += 0.2;
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate rangebound score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateRangeboundScore(features: MarketFeatures): number {
    let score = 0;
    
    // Small returns
    score += 0.3 * (1 - Math.min(1, Math.abs(features.returns20d) * 10));
    score += 0.2 * (1 - Math.min(1, Math.abs(features.returns5d) * 20));
    
    // Narrow Bollinger Bands
    score += 0.3 * (1 - Math.min(1, features.bbWidth / 0.05));
    
    // Neutral RSI
    const rsiDeviation = Math.abs(features.rsi14 - 50) / 50;
    score += 0.2 * (1 - rsiDeviation);
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate mean-reverting score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateMeanRevertingScore(features: MarketFeatures): number {
    let score = 0;
    
    // Extreme RSI (either overbought or oversold)
    if (features.rsi14 > this.config.rsiOverbought || features.rsi14 < this.config.rsiOversold) {
      score += 0.4;
    }
    
    // Recent price deviation from trend
    if (Math.sign(features.returns1d) !== Math.sign(features.returns20d)) {
      score += 0.3;
    }
    
    // Narrow Bollinger Bands
    score += 0.3 * (1 - Math.min(1, features.bbWidth / 0.05));
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate high volatility score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateHighVolatilityScore(features: MarketFeatures): number {
    let score = 0;
    
    // High historical volatility
    score += 0.4 * Math.min(1, features.volatility20d / this.config.highVolatilityThreshold);
    
    // High ATR
    score += 0.3 * Math.min(1, features.atr14 / (features.price * 0.03));
    
    // Wide Bollinger Bands
    score += 0.3 * Math.min(1, features.bbWidth / 0.05);
    
    // VIX if available
    if (features.vix) {
      score = (score * 0.7) + (0.3 * Math.min(1, features.vix / 30));
    }
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate low volatility score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateLowVolatilityScore(features: MarketFeatures): number {
    let score = 0;
    
    // Low historical volatility
    score += 0.4 * (1 - Math.min(1, features.volatility20d / this.config.highVolatilityThreshold));
    
    // Low ATR
    score += 0.3 * (1 - Math.min(1, features.atr14 / (features.price * 0.03)));
    
    // Narrow Bollinger Bands
    score += 0.3 * (1 - Math.min(1, features.bbWidth / 0.05));
    
    // VIX if available
    if (features.vix) {
      score = (score * 0.7) + (0.3 * (1 - Math.min(1, features.vix / 30)));
    }
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate high liquidity score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateHighLiquidityScore(features: MarketFeatures): number {
    let score = 0;
    
    // High volume ratio
    score += 0.6 * Math.min(1, features.volumeRatio5d);
    
    // High market breadth
    score += 0.4 * Math.min(1, features.advanceDeclineRatio);
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate low liquidity score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateLowLiquidityScore(features: MarketFeatures): number {
    let score = 0;
    
    // Low volume ratio
    score += 0.6 * (1 - Math.min(1, features.volumeRatio5d));
    
    // Low market breadth
    score += 0.4 * (1 - Math.min(1, features.advanceDeclineRatio));
    
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate market stress score
   * @param features Market features
   * @returns Score between 0 and 1
   */
  private calculateMarketStressScore(features: MarketFeatures): number {
    let score = 0;
    
    // Large negative returns
    if (features.returns1d < -0.03) score += 0.2;
    if (features.returns5d < -0.1) score += 0.2;
    
    // High volatility
    score += 0.2 * Math.min(1, features.volatility5d / this.config.highVolatilityThreshold);
    
    // VIX if available
    if (features.vix) {
      score += 0.2 * Math.min(1, features.vix / 40);
    }
    
    // Yield curve inversion if available
    if (features.yieldCurve !== undefined && features.yieldCurve < 0) {
      score += 0.2;
    }
    
    return Math.min(1, Math.max(0, score));
  }
} 