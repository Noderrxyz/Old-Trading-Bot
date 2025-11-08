/**
 * Alpha Scoring Engine
 * 
 * Evaluates and scores trading strategies based on multiple performance metrics,
 * including ROI, drawdown, risk-adjusted returns, and trust scores.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';

/**
 * Alpha scoring configuration
 */
export interface AlphaScoringConfig {
  enabled: boolean;
  weights: {
    roi: number;
    drawdown: number;
    sharpe: number;
    volatility: number;
    trust: number;
  };
  performanceWindow: number; // Days
  minDataPoints: number;
  updateIntervalMs: number;
}

/**
 * Default alpha scoring configuration
 */
export const DEFAULT_ALPHA_SCORING_CONFIG: AlphaScoringConfig = {
  enabled: true,
  weights: {
    roi: 0.3,
    drawdown: 0.2,
    sharpe: 0.25,
    volatility: 0.15,
    trust: 0.1
  },
  performanceWindow: 30, // 30 days
  minDataPoints: 10,
  updateIntervalMs: 3600000 // 1 hour
};

/**
 * Performance metrics for a strategy
 */
export interface StrategyMetrics {
  strategyId: string;
  agentId: string;
  roi: number;
  maxDrawdown: number;
  sharpeRatio: number;
  volatility: number;
  trustScore: number;
  lastUpdate: number;
  dataPoints: number;
}

/**
 * Alpha score calculation result
 */
export interface AlphaScore {
  strategyId: string;
  agentId: string;
  score: number;
  components: {
    roi: number;
    drawdown: number;
    sharpe: number;
    volatility: number;
    trust: number;
  };
  timestamp: number;
}

/**
 * Alpha Scoring Engine class
 */
export class AlphaScoringEngine {
  private static instance: AlphaScoringEngine | null = null;
  private config: AlphaScoringConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[AlphaScoringEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[AlphaScoringEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[AlphaScoringEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[AlphaScoringEngine] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private strategyMetrics: Map<string, StrategyMetrics>;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): AlphaScoringEngine {
    if (!AlphaScoringEngine.instance) {
      AlphaScoringEngine.instance = new AlphaScoringEngine();
    }
    return AlphaScoringEngine.instance;
  }

  private constructor(config: Partial<AlphaScoringConfig> = {}) {
    this.config = { ...DEFAULT_ALPHA_SCORING_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.strategyMetrics = new Map();
  }

  /**
   * Start alpha scoring engine
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Alpha scoring engine is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Alpha scoring engine is already running');
      return;
    }

    this.isRunning = true;
    this.updateInterval = setInterval(() => this.updateScores(), this.config.updateIntervalMs);
    this.logger.info('Alpha scoring engine started');
  }

  /**
   * Stop alpha scoring engine
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Alpha scoring engine stopped');
  }

  /**
   * Update strategy metrics
   */
  public updateStrategyMetrics(metrics: StrategyMetrics): void {
    if (!this.config.enabled) return;

    this.strategyMetrics.set(metrics.strategyId, metrics);
    this.logger.debug(`Updated metrics for strategy ${metrics.strategyId}`);
  }

  /**
   * Calculate alpha score for a strategy
   */
  private calculateAlphaScore(metrics: StrategyMetrics): AlphaScore {
    // Normalize components to 0-1 range
    const normalizedRoi = this.normalizeRoi(metrics.roi);
    const normalizedDrawdown = this.normalizeDrawdown(metrics.maxDrawdown);
    const normalizedSharpe = this.normalizeSharpe(metrics.sharpeRatio);
    const normalizedVolatility = this.normalizeVolatility(metrics.volatility);
    const normalizedTrust = this.normalizeTrust(metrics.trustScore);

    // Calculate weighted score
    const score = 
      normalizedRoi * this.config.weights.roi +
      normalizedDrawdown * this.config.weights.drawdown +
      normalizedSharpe * this.config.weights.sharpe +
      normalizedVolatility * this.config.weights.volatility +
      normalizedTrust * this.config.weights.trust;

    return {
      strategyId: metrics.strategyId,
      agentId: metrics.agentId,
      score,
      components: {
        roi: normalizedRoi,
        drawdown: normalizedDrawdown,
        sharpe: normalizedSharpe,
        volatility: normalizedVolatility,
        trust: normalizedTrust
      },
      timestamp: Date.now()
    };
  }

  /**
   * Normalize ROI to 0-1 range
   */
  private normalizeRoi(roi: number): number {
    // Assuming typical ROI range of -50% to +100%
    return Math.max(0, Math.min(1, (roi + 0.5) / 1.5));
  }

  /**
   * Normalize drawdown to 0-1 range
   */
  private normalizeDrawdown(drawdown: number): number {
    // Assuming typical drawdown range of 0% to 50%
    return Math.max(0, Math.min(1, 1 - (drawdown / 0.5)));
  }

  /**
   * Normalize Sharpe ratio to 0-1 range
   */
  private normalizeSharpe(sharpe: number): number {
    // Assuming typical Sharpe range of -2 to +4
    return Math.max(0, Math.min(1, (sharpe + 2) / 6));
  }

  /**
   * Normalize volatility to 0-1 range
   */
  private normalizeVolatility(volatility: number): number {
    // Assuming typical volatility range of 0% to 100%
    return Math.max(0, Math.min(1, 1 - (volatility / 1)));
  }

  /**
   * Normalize trust score to 0-1 range
   */
  private normalizeTrust(trust: number): number {
    // Trust score is already in 0-1 range
    return Math.max(0, Math.min(1, trust));
  }

  /**
   * Update all strategy scores
   */
  private updateScores(): void {
    if (!this.config.enabled || !this.isRunning) return;

    for (const [strategyId, metrics] of this.strategyMetrics.entries()) {
      // Skip if not enough data points
      if (metrics.dataPoints < this.config.minDataPoints) {
        this.logger.debug(`Skipping score update for strategy ${strategyId} - insufficient data`);
        continue;
      }

      // Skip if metrics are too old
      const age = Date.now() - metrics.lastUpdate;
      if (age > this.config.performanceWindow * 24 * 60 * 60 * 1000) {
        this.logger.debug(`Skipping score update for strategy ${strategyId} - data too old`);
        continue;
      }

      // Calculate and emit score
      const score = this.calculateAlphaScore(metrics);
      this.emitScore(score);
    }
  }

  /**
   * Emit alpha score to telemetry
   */
  private emitScore(score: AlphaScore): void {
    this.telemetryEngine.emitSimulationEvent({
      type: 'ALPHA_SCORE_UPDATE',
      strategyId: score.strategyId,
      agentId: score.agentId,
      score: score.score,
      components: score.components,
      timestamp: score.timestamp
    });

    this.logger.debug(
      `Emitted alpha score for strategy ${score.strategyId}: ` +
      `Score=${score.score.toFixed(3)}, ` +
      `ROI=${score.components.roi.toFixed(3)}, ` +
      `Drawdown=${score.components.drawdown.toFixed(3)}, ` +
      `Sharpe=${score.components.sharpe.toFixed(3)}, ` +
      `Volatility=${score.components.volatility.toFixed(3)}, ` +
      `Trust=${score.components.trust.toFixed(3)}`
    );
  }

  /**
   * Get current alpha score for a strategy
   */
  public getStrategyScore(strategyId: string): AlphaScore | null {
    const metrics = this.strategyMetrics.get(strategyId);
    if (!metrics) return null;

    return this.calculateAlphaScore(metrics);
  }

  /**
   * Get all strategy scores
   */
  public getAllStrategyScores(): AlphaScore[] {
    const scores: AlphaScore[] = [];
    for (const metrics of this.strategyMetrics.values()) {
      scores.push(this.calculateAlphaScore(metrics));
    }
    return scores;
  }

  /**
   * Reset alpha scoring engine
   */
  public reset(): void {
    this.strategyMetrics.clear();
    this.logger.info('Alpha scoring engine reset');
  }
} 