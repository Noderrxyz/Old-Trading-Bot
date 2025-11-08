/**
 * Alpha Kill Switch
 * 
 * Monitors and protects against self-destructive mutations and bad strategy propagation.
 * Implements multi-layer kill conditions and quarantine mechanisms.
 */

import { TradingStrategy } from '../strategy/trading_strategy.js';
import logger from '../utils/logger.js';

/**
 * Kill switch configuration
 */
export interface AlphaKillSwitchConfig {
  enabled: boolean;
  hardFailureThresholds: {
    minRoi: number;          // -0.2 for -20%
    minTrades: number;       // Minimum trades before ROI check
    maxDrawdown: number;     // 0.3 for 30%
  };
  relativeFailureThresholds: {
    underperformancePct: number;  // 0.2 for 20% under median
    minTrades: number;            // Minimum trades for comparison
    rollingWindow: number;        // Number of trades for rolling window
  };
  entropyThresholds: {
    minDiversity: number;    // 0.3 for 30% minimum diversity
    windowSize: number;      // Number of strategies to consider
  };
  fallbackConfig: {
    maxKillsBeforeFallback: number;
    fallbackStrategyId: string;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_KILL_SWITCH_CONFIG: AlphaKillSwitchConfig = {
  enabled: true,
  hardFailureThresholds: {
    minRoi: -0.2,
    minTrades: 50,
    maxDrawdown: 0.3
  },
  relativeFailureThresholds: {
    underperformancePct: 0.2,
    minTrades: 50,
    rollingWindow: 50
  },
  entropyThresholds: {
    minDiversity: 0.3,
    windowSize: 100
  },
  fallbackConfig: {
    maxKillsBeforeFallback: 3,
    fallbackStrategyId: 'fallback_strategy'
  }
};

/**
 * Kill event metadata
 */
export interface KillEvent {
  strategyId: string;
  timestamp: number;
  reason: 'hard_failure' | 'relative_failure' | 'entropy_decay';
  metrics: {
    roi: number;
    drawdown: number;
    trades: number;
    performanceVsMedian: number;
    entropyScore: number;
  };
  metadata: {
    parameters: Record<string, any>;
    indicators: Record<string, any>;
    riskParameters: Record<string, any>;
  };
}

/**
 * Alpha Kill Switch class
 */
export class AlphaKillSwitch {
  private static instance: AlphaKillSwitch | null = null;
  private config: AlphaKillSwitchConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[AlphaKillSwitch] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[AlphaKillSwitch] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[AlphaKillSwitch] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[AlphaKillSwitch] ${msg}`, ...args)
  };
  private killEvents: KillEvent[] = [];
  private quarantinedStrategies: Set<string> = new Set();
  private recentKillCount: number = 0;
  private lastKillTime: number = 0;

  /**
   * Get singleton instance
   */
  public static getInstance(): AlphaKillSwitch {
    if (!AlphaKillSwitch.instance) {
      AlphaKillSwitch.instance = new AlphaKillSwitch();
    }
    return AlphaKillSwitch.instance;
  }

  private constructor(config: Partial<AlphaKillSwitchConfig> = {}) {
    this.config = { ...DEFAULT_KILL_SWITCH_CONFIG, ...config };
  }

  /**
   * Enable kill switch
   */
  public enable(): void {
    this.config.enabled = true;
    this.logger.info('Alpha kill switch enabled');
  }

  /**
   * Disable kill switch
   */
  public disable(): void {
    this.config.enabled = false;
    this.logger.info('Alpha kill switch disabled');
  }

  /**
   * Manually quarantine a strategy
   */
  public manualQuarantine(strategyId: string): void {
    if (!this.quarantinedStrategies.has(strategyId)) {
      this.quarantinedStrategies.add(strategyId);
      this.logger.info(`Manually quarantined strategy ${strategyId}`);
    }
  }

  /**
   * Check if a strategy is quarantined
   */
  public isQuarantined(strategyId: string): boolean {
    return this.quarantinedStrategies.has(strategyId);
  }

  /**
   * Evaluate strategy against kill conditions
   */
  public evaluateStrategy(strategy: TradingStrategy, poolMetrics: {
    medianRoi: number;
    entropyScore: number;
  }): boolean {
    if (!this.config.enabled) return false;
    if (this.isQuarantined(strategy.id)) return false;

    const metrics = strategy.metrics;
    const shouldKill = this.checkHardFailure(metrics) ||
                      this.checkRelativeFailure(metrics, poolMetrics.medianRoi) ||
                      this.checkEntropyDecay(poolMetrics.entropyScore);

    if (shouldKill) {
      this.killStrategy(strategy, poolMetrics);
      return true;
    }

    return false;
  }

  /**
   * Check hard failure conditions
   */
  private checkHardFailure(metrics: TradingStrategy['metrics']): boolean {
    const { minRoi, minTrades, maxDrawdown } = this.config.hardFailureThresholds;
    
    if (metrics.totalTrades >= minTrades) {
      if (metrics.roi < minRoi || metrics.maxDrawdown > maxDrawdown) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check relative failure conditions
   */
  private checkRelativeFailure(
    metrics: TradingStrategy['metrics'],
    poolMedianRoi: number
  ): boolean {
    const { underperformancePct, minTrades, rollingWindow } = this.config.relativeFailureThresholds;
    
    if (metrics.totalTrades >= minTrades) {
      const performanceVsMedian = (metrics.roi - poolMedianRoi) / Math.abs(poolMedianRoi);
      if (performanceVsMedian < -underperformancePct) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check entropy decay conditions
   */
  private checkEntropyDecay(entropyScore: number): boolean {
    return entropyScore < this.config.entropyThresholds.minDiversity;
  }

  /**
   * Kill a strategy and record the event
   */
  private killStrategy(
    strategy: TradingStrategy,
    poolMetrics: { medianRoi: number; entropyScore: number }
  ): void {
    const killEvent: KillEvent = {
      strategyId: strategy.id,
      timestamp: Date.now(),
      reason: this.determineKillReason(strategy.metrics, poolMetrics),
      metrics: {
        roi: strategy.metrics.roi,
        drawdown: strategy.metrics.maxDrawdown,
        trades: strategy.metrics.totalTrades,
        performanceVsMedian: (strategy.metrics.roi - poolMetrics.medianRoi) / Math.abs(poolMetrics.medianRoi),
        entropyScore: poolMetrics.entropyScore
      },
      metadata: {
        parameters: strategy.parameters,
        indicators: {}, // TODO: Add indicator metadata
        riskParameters: {
          maxPositionSize: strategy.parameters.maxPositionSize,
          maxOpenPositions: strategy.parameters.maxOpenPositions,
          stopLossPct: strategy.parameters.stopLossPct,
          takeProfitPct: strategy.parameters.takeProfitPct
        }
      }
    };

    this.quarantinedStrategies.add(strategy.id);
    this.killEvents.push(killEvent);
    this.recentKillCount++;
    this.lastKillTime = Date.now();

    this.logger.warn(`Killed strategy ${strategy.id} due to ${killEvent.reason}`);

    // Check if we need to activate fallback
    if (this.recentKillCount >= this.config.fallbackConfig.maxKillsBeforeFallback) {
      this.activateFallback();
    }
  }

  /**
   * Determine the primary reason for killing a strategy
   */
  private determineKillReason(
    metrics: TradingStrategy['metrics'],
    poolMetrics: { medianRoi: number; entropyScore: number }
  ): KillEvent['reason'] {
    if (this.checkHardFailure(metrics)) return 'hard_failure';
    if (this.checkRelativeFailure(metrics, poolMetrics.medianRoi)) return 'relative_failure';
    if (this.checkEntropyDecay(poolMetrics.entropyScore)) return 'entropy_decay';
    return 'hard_failure'; // Default to hard failure if no specific reason found
  }

  /**
   * Activate fallback strategy
   */
  private activateFallback(): void {
    this.logger.warn(
      `Activating fallback strategy ${this.config.fallbackConfig.fallbackStrategyId} ` +
      `after ${this.recentKillCount} recent kills`
    );
    // TODO: Implement fallback strategy activation
  }

  /**
   * Get recent kill events
   */
  public getRecentKillEvents(limit: number = 10): KillEvent[] {
    return this.killEvents
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Reset kill switch state
   */
  public reset(): void {
    this.quarantinedStrategies.clear();
    this.killEvents = [];
    this.recentKillCount = 0;
    this.lastKillTime = 0;
    this.logger.info('Alpha kill switch reset');
  }
} 