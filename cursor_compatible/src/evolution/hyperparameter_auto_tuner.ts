/**
 * Hyperparameter Auto-Tuner
 * 
 * Dynamically optimizes strategy hyperparameters based on live performance feedback.
 */

import { TradingStrategy } from '../strategy/trading_strategy.js';
import logger from '../utils/logger.js';

/**
 * Hyperparameter bounds
 */
export interface HyperparameterBounds {
  min: number;
  max: number;
  defaultValue: number;
}

/**
 * Auto-tuner configuration
 */
export interface HyperparameterAutoTunerConfig {
  enabled: boolean;
  performanceBufferSize: number;
  learningRate: number;
  explorationRate: number;
  bounds: {
    stopLossPct: HyperparameterBounds;
    takeProfitPct: HyperparameterBounds;
    mutationRate: HyperparameterBounds;
    crossoverRate: HyperparameterBounds;
    alphaDecayRate: HyperparameterBounds;
  };
  volatilityThresholds: {
    high: number;    // 0.3 for 30% volatility
    medium: number;  // 0.2 for 20% volatility
    low: number;     // 0.1 for 10% volatility
  };
  updateIntervalMs: number;
}

/**
 * Default configuration
 */
export const DEFAULT_AUTO_TUNER_CONFIG: HyperparameterAutoTunerConfig = {
  enabled: true,
  performanceBufferSize: 100,
  learningRate: 0.01,
  explorationRate: 0.1,
  bounds: {
    stopLossPct: { min: 0.01, max: 0.05, defaultValue: 0.02 },
    takeProfitPct: { min: 0.02, max: 0.1, defaultValue: 0.04 },
    mutationRate: { min: 0.1, max: 0.5, defaultValue: 0.3 },
    crossoverRate: { min: 0.2, max: 0.8, defaultValue: 0.5 },
    alphaDecayRate: { min: 0.01, max: 0.1, defaultValue: 0.05 }
  },
  volatilityThresholds: {
    high: 0.3,
    medium: 0.2,
    low: 0.1
  },
  updateIntervalMs: 3600000 // 1 hour
};

/**
 * Performance metrics for tuning
 */
export interface TuningMetrics {
  volatility: number;
  winRate: number;
  roi: number;
  trustScore: number;
  recentPnL: number[];
  timestamp: number;
}

/**
 * Hyperparameter Auto-Tuner class
 */
export class HyperparameterAutoTuner {
  private static instance: HyperparameterAutoTuner | null = null;
  private config: HyperparameterAutoTunerConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[HyperparameterAutoTuner] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[HyperparameterAutoTuner] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[HyperparameterAutoTuner] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[HyperparameterAutoTuner] ${msg}`, ...args)
  };
  private performanceHistory: Map<string, TuningMetrics[]> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): HyperparameterAutoTuner {
    if (!HyperparameterAutoTuner.instance) {
      HyperparameterAutoTuner.instance = new HyperparameterAutoTuner();
    }
    return HyperparameterAutoTuner.instance;
  }

  private constructor(config: Partial<HyperparameterAutoTunerConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_TUNER_CONFIG, ...config };
  }

  /**
   * Start the auto-tuner
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Hyperparameter auto-tuner is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Hyperparameter auto-tuner is already running');
      return;
    }

    this.isRunning = true;
    this.updateInterval = setInterval(() => this.update(), this.config.updateIntervalMs);
    this.logger.info('Hyperparameter auto-tuner started');
  }

  /**
   * Stop the auto-tuner
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Hyperparameter auto-tuner stopped');
  }

  /**
   * Update strategy metrics
   */
  public updateStrategyMetrics(strategy: TradingStrategy, metrics: Partial<TuningMetrics>): void {
    const history = this.performanceHistory.get(strategy.id) || [];
    const newMetrics: TuningMetrics = {
      volatility: metrics.volatility ?? 0,
      winRate: metrics.winRate ?? 0,
      roi: metrics.roi ?? 0,
      trustScore: metrics.trustScore ?? 0,
      recentPnL: metrics.recentPnL ?? [],
      timestamp: Date.now()
    };

    history.push(newMetrics);
    if (history.length > this.config.performanceBufferSize) {
      history.shift();
    }

    this.performanceHistory.set(strategy.id, history);
    this.logger.debug(`Updated metrics for strategy ${strategy.id}`);
  }

  /**
   * Tune strategy hyperparameters
   */
  public tuneStrategy(strategy: TradingStrategy): void {
    if (!this.config.enabled) return;

    const history = this.performanceHistory.get(strategy.id);
    if (!history || history.length < 10) {
      this.logger.debug(`Insufficient history for tuning strategy ${strategy.id}`);
      return;
    }

    const recentMetrics = history[history.length - 1];
    const adjustments = this.calculateAdjustments(recentMetrics);

    // Apply adjustments with bounds checking
    strategy.parameters = {
      ...strategy.parameters,
      stopLossPct: this.clampValue(
        strategy.parameters.stopLossPct + adjustments.stopLossPct,
        this.config.bounds.stopLossPct
      ),
      takeProfitPct: this.clampValue(
        strategy.parameters.takeProfitPct + adjustments.takeProfitPct,
        this.config.bounds.takeProfitPct
      )
    };

    this.logger.info(
      `Tuned strategy ${strategy.id}: ` +
      `SL=${strategy.parameters.stopLossPct.toFixed(4)}, ` +
      `TP=${strategy.parameters.takeProfitPct.toFixed(4)}`
    );
  }

  /**
   * Calculate parameter adjustments based on metrics
   */
  private calculateAdjustments(metrics: TuningMetrics): {
    stopLossPct: number;
    takeProfitPct: number;
    mutationRate: number;
    crossoverRate: number;
    alphaDecayRate: number;
  } {
    const { volatility, winRate, roi, trustScore } = metrics;
    const { learningRate, explorationRate } = this.config;

    // Base adjustments
    let stopLossPct = 0;
    let takeProfitPct = 0;
    let mutationRate = 0;
    let crossoverRate = 0;
    let alphaDecayRate = 0;

    // Volatility-based adjustments
    if (volatility > this.config.volatilityThresholds.high) {
      stopLossPct += learningRate * 0.5; // Widen stop-loss
      takeProfitPct += learningRate * 0.5; // Widen take-profit
    } else if (volatility < this.config.volatilityThresholds.low) {
      stopLossPct -= learningRate * 0.3; // Tighten stop-loss
      takeProfitPct -= learningRate * 0.3; // Tighten take-profit
    }

    // Win rate-based adjustments
    if (winRate < 0.4) {
      mutationRate -= learningRate * 0.5; // Reduce mutation rate
      crossoverRate += learningRate * 0.3; // Increase crossover rate
    }

    // ROI-based adjustments
    if (roi < 0) {
      crossoverRate += learningRate * 0.4; // Increase crossover rate
      alphaDecayRate += learningRate * 0.2; // Increase alpha decay
    }

    // Trust score-based adjustments
    if (trustScore < 0.5) {
      stopLossPct -= learningRate * 0.4; // Tighten stop-loss
      takeProfitPct -= learningRate * 0.2; // Tighten take-profit
    }

    // Add exploration noise
    const noise = (Math.random() - 0.5) * explorationRate;
    stopLossPct += noise;
    takeProfitPct += noise;
    mutationRate += noise;
    crossoverRate += noise;
    alphaDecayRate += noise;

    return {
      stopLossPct,
      takeProfitPct,
      mutationRate,
      crossoverRate,
      alphaDecayRate
    };
  }

  /**
   * Clamp a value within bounds
   */
  private clampValue(value: number, bounds: HyperparameterBounds): number {
    return Math.max(bounds.min, Math.min(bounds.max, value));
  }

  /**
   * Reset auto-tuner state
   */
  public reset(): void {
    this.performanceHistory.clear();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    this.logger.info('Hyperparameter auto-tuner reset');
  }
} 