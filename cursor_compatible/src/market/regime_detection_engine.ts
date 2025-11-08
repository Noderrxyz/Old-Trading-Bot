/**
 * Regime Detection Engine
 * 
 * Detects current market regime (Bullish, Bearish, Sideways/Chop) in real-time
 * and provides confidence scores and regime change history.
 */

import { logger } from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';
import { MarketRegimeState, MarketMetrics } from './types/market.types.js';

/**
 * Configuration for regime detection
 */
export interface RegimeDetectionConfig {
  enabled: boolean;
  trendLookbackPeriods: number;  // Number of periods for trend analysis
  volatilityLookbackPeriods: number;  // Number of periods for volatility analysis
  momentumLookbackPeriods: number;  // Number of periods for momentum analysis
  bullTrendThreshold: number;  // Threshold for bullish trend (0-1)
  bearTrendThreshold: number;  // Threshold for bearish trend (0-1)
  volatilityThreshold: number;  // Threshold for high volatility (0-1)
  regimeTransitionSmoothing: number;  // Smoothing factor for regime transitions (0-1)
  updateIntervalMs: number;  // How often to update regime detection
}

const DEFAULT_CONFIG: RegimeDetectionConfig = {
  enabled: true,
  trendLookbackPeriods: 100,
  volatilityLookbackPeriods: 50,
  momentumLookbackPeriods: 20,
  bullTrendThreshold: 0.6,
  bearTrendThreshold: 0.4,
  volatilityThreshold: 0.7,
  regimeTransitionSmoothing: 0.3,
  updateIntervalMs: 60000  // 1 minute
};

/**
 * Regime detection metrics
 */
interface RegimeMetrics {
  trendStrength: number;  // -1 to 1
  volatility: number;  // 0 to 1
  momentum: number;  // -1 to 1
  liquidity: number;  // 0 to 1
  confidence: number;  // 0 to 1
}

/**
 * Regime change history entry
 */
interface RegimeChange {
  timestamp: number;
  from: MarketRegimeState;
  to: MarketRegimeState;
  confidence: number;
  metrics: RegimeMetrics;
}

/**
 * Regime Detection Engine
 */
export class RegimeDetectionEngine {
  private static instance: RegimeDetectionEngine | null = null;
  private config: RegimeDetectionConfig;
  private telemetryEngine: ExecutionTelemetryEngine;
  private currentRegime: Map<string, MarketRegimeState>;
  private regimeConfidence: Map<string, number>;
  private regimeMetrics: Map<string, RegimeMetrics>;
  private regimeHistory: Map<string, RegimeChange[]>;
  private lastUpdate: Map<string, number>;
  private updateInterval: NodeJS.Timeout | null;
  private isRunning: boolean;

  /**
   * Get singleton instance
   */
  public static getInstance(): RegimeDetectionEngine {
    if (!RegimeDetectionEngine.instance) {
      RegimeDetectionEngine.instance = new RegimeDetectionEngine();
    }
    return RegimeDetectionEngine.instance;
  }

  constructor(config: Partial<RegimeDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.currentRegime = new Map();
    this.regimeConfidence = new Map();
    this.regimeMetrics = new Map();
    this.regimeHistory = new Map();
    this.lastUpdate = new Map();
    this.updateInterval = null;
    this.isRunning = false;
  }

  /**
   * Start the regime detection engine
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Regime detection engine already running');
      return;
    }

    this.updateInterval = setInterval(() => {
      this.updateRegimes();
    }, this.config.updateIntervalMs);

    this.isRunning = true;
    logger.info('Started regime detection engine');
  }

  /**
   * Stop the regime detection engine
   */
  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    logger.info('Stopped regime detection engine');
  }

  /**
   * Update market metrics and detect regime
   */
  public updateMarketMetrics(symbol: string, metrics: MarketMetrics): void {
    if (!this.config.enabled) return;

    // Calculate regime metrics
    const regimeMetrics = this.calculateRegimeMetrics(metrics);
    this.regimeMetrics.set(symbol, regimeMetrics);

    // Detect regime
    const regime = this.detectRegime(regimeMetrics);
    const confidence = this.calculateConfidence(regime, regimeMetrics);

    // Check for regime change
    const previousRegime = this.currentRegime.get(symbol);
    if (previousRegime !== regime) {
      // Record regime change
      const change: RegimeChange = {
        timestamp: Date.now(),
        from: previousRegime || MarketRegimeState.Unknown,
        to: regime,
        confidence,
        metrics: regimeMetrics
      };

      let history = this.regimeHistory.get(symbol) || [];
      history.push(change);
      this.regimeHistory.set(symbol, history);

      // Update current regime
      this.currentRegime.set(symbol, regime);
      this.regimeConfidence.set(symbol, confidence);

      // Emit telemetry
      this.telemetryEngine.emitRiskEvent({
        type: 'REGIME_CHANGE',
        symbol,
        from: previousRegime || MarketRegimeState.Unknown,
        to: regime,
        confidence,
        timestamp: Date.now()
      });

      logger.info(`Regime change for ${symbol}: ${previousRegime || 'Unknown'} -> ${regime} (confidence: ${confidence.toFixed(2)})`);
    }

    this.lastUpdate.set(symbol, Date.now());
  }

  /**
   * Get current regime for a symbol
   */
  public getCurrentRegime(symbol: string): MarketRegimeState {
    return this.currentRegime.get(symbol) || MarketRegimeState.Unknown;
  }

  /**
   * Get regime confidence for a symbol
   */
  public getRegimeConfidence(symbol: string): number {
    return this.regimeConfidence.get(symbol) || 0;
  }

  /**
   * Get regime metrics for a symbol
   */
  public getRegimeMetrics(symbol: string): RegimeMetrics | null {
    return this.regimeMetrics.get(symbol) || null;
  }

  /**
   * Get regime history for a symbol
   */
  public getRegimeHistory(symbol: string): RegimeChange[] {
    return this.regimeHistory.get(symbol) || [];
  }

  /**
   * Calculate regime metrics from market metrics
   */
  private calculateRegimeMetrics(metrics: MarketMetrics): RegimeMetrics {
    return {
      trendStrength: metrics.trend,
      volatility: metrics.volatility,
      momentum: metrics.momentum,
      liquidity: metrics.liquidity,
      confidence: metrics.regimeConfidence
    };
  }

  /**
   * Detect regime from metrics
   */
  private detectRegime(metrics: RegimeMetrics): MarketRegimeState {
    if (metrics.volatility > this.config.volatilityThreshold) {
      return MarketRegimeState.Volatile;
    } else if (metrics.trendStrength > this.config.bullTrendThreshold) {
      return MarketRegimeState.Bull;
    } else if (metrics.trendStrength < this.config.bearTrendThreshold) {
      return MarketRegimeState.Bear;
    } else {
      return MarketRegimeState.Sideways;
    }
  }

  /**
   * Calculate confidence in regime detection
   */
  private calculateConfidence(regime: MarketRegimeState, metrics: RegimeMetrics): number {
    let confidence = 0.0;

    switch (regime) {
      case MarketRegimeState.Bull:
        confidence = (metrics.trendStrength - this.config.bullTrendThreshold) / (1 - this.config.bullTrendThreshold);
        break;
      case MarketRegimeState.Bear:
        confidence = (this.config.bearTrendThreshold - metrics.trendStrength) / this.config.bearTrendThreshold;
        break;
      case MarketRegimeState.Volatile:
        confidence = (metrics.volatility - this.config.volatilityThreshold) / (1 - this.config.volatilityThreshold);
        break;
      case MarketRegimeState.Sideways:
        confidence = 1 - Math.abs(metrics.trendStrength - 0.5) * 2;
        break;
      default:
        confidence = 0.0;
    }

    // Apply smoothing
    confidence = confidence * this.config.regimeTransitionSmoothing + 
                 metrics.confidence * (1 - this.config.regimeTransitionSmoothing);

    return Math.max(0.2, Math.min(0.95, confidence));
  }

  /**
   * Update all regimes
   */
  private updateRegimes(): void {
    if (!this.config.enabled) return;

    const now = Date.now();
    for (const [symbol, lastUpdate] of this.lastUpdate.entries()) {
      if (now - lastUpdate > this.config.updateIntervalMs) {
        // Regime has not been updated recently, mark as unknown
        this.currentRegime.set(symbol, MarketRegimeState.Unknown);
        this.regimeConfidence.set(symbol, 0);
      }
    }
  }
} 