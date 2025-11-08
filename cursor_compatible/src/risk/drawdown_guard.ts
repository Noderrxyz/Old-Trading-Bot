/**
 * Drawdown Guard
 * 
 * Tracks and manages drawdowns in real-time to prevent catastrophic losses.
 * Monitors per-agent, per-strategy, and global drawdowns.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';

/**
 * Drawdown guard configuration
 */
export interface DrawdownGuardConfig {
  enabled: boolean;
  maxAgentDrawdownPct: number;
  maxStrategyDrawdownPct: number;
  globalDrawdownThresholdPct: number;
  emergencyFreezeEnabled: boolean;
  alertThresholdPct: number;
  checkIntervalMs: number;
}

/**
 * Default drawdown guard configuration
 */
export const DEFAULT_DRAWDOWN_GUARD_CONFIG: DrawdownGuardConfig = {
  enabled: true,
  maxAgentDrawdownPct: -15,
  maxStrategyDrawdownPct: -20,
  globalDrawdownThresholdPct: -25,
  emergencyFreezeEnabled: true,
  alertThresholdPct: -10,
  checkIntervalMs: 1000
};

/**
 * Drawdown metrics for an agent
 */
interface AgentDrawdownMetrics {
  agentId: string;
  currentDrawdownPct: number;
  peakDrawdownPct: number;
  lastUpdate: number;
  isFrozen: boolean;
}

/**
 * Drawdown metrics for a strategy
 */
interface StrategyDrawdownMetrics {
  strategyId: string;
  currentDrawdownPct: number;
  peakDrawdownPct: number;
  lastUpdate: number;
  isFrozen: boolean;
}

/**
 * Drawdown Guard class
 */
export class DrawdownGuard {
  private static instance: DrawdownGuard | null = null;
  private config: DrawdownGuardConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[DrawdownGuard] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[DrawdownGuard] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[DrawdownGuard] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[DrawdownGuard] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private agentMetrics: Map<string, AgentDrawdownMetrics>;
  private strategyMetrics: Map<string, StrategyDrawdownMetrics>;
  private globalDrawdownPct: number;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): DrawdownGuard {
    if (!DrawdownGuard.instance) {
      DrawdownGuard.instance = new DrawdownGuard();
    }
    return DrawdownGuard.instance;
  }

  constructor(config: Partial<DrawdownGuardConfig> = {}) {
    this.config = { ...DEFAULT_DRAWDOWN_GUARD_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.agentMetrics = new Map();
    this.strategyMetrics = new Map();
    this.globalDrawdownPct = 0;
  }

  /**
   * Start drawdown monitoring
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Drawdown guard is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Drawdown guard is already running');
      return;
    }

    this.isRunning = true;
    this.checkInterval = setInterval(() => this.checkDrawdowns(), this.config.checkIntervalMs);
    this.logger.info('Drawdown guard started');
  }

  /**
   * Stop drawdown monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Drawdown guard stopped');
  }

  /**
   * Update agent drawdown metrics
   */
  public updateAgentDrawdown(agentId: string, drawdownPct: number): void {
    if (!this.config.enabled) return;

    const metrics = this.agentMetrics.get(agentId) || {
      agentId,
      currentDrawdownPct: 0,
      peakDrawdownPct: 0,
      lastUpdate: Date.now(),
      isFrozen: false
    };

    metrics.currentDrawdownPct = drawdownPct;
    metrics.peakDrawdownPct = Math.min(metrics.peakDrawdownPct, drawdownPct);
    metrics.lastUpdate = Date.now();

    this.agentMetrics.set(agentId, metrics);
    this.logger.debug(`Updated agent ${agentId} drawdown to ${drawdownPct.toFixed(2)}%`);
  }

  /**
   * Update strategy drawdown metrics
   */
  public updateStrategyDrawdown(strategyId: string, drawdownPct: number): void {
    if (!this.config.enabled) return;

    const metrics = this.strategyMetrics.get(strategyId) || {
      strategyId,
      currentDrawdownPct: 0,
      peakDrawdownPct: 0,
      lastUpdate: Date.now(),
      isFrozen: false
    };

    metrics.currentDrawdownPct = drawdownPct;
    metrics.peakDrawdownPct = Math.min(metrics.peakDrawdownPct, drawdownPct);
    metrics.lastUpdate = Date.now();

    this.strategyMetrics.set(strategyId, metrics);
    this.logger.debug(`Updated strategy ${strategyId} drawdown to ${drawdownPct.toFixed(2)}%`);
  }

  /**
   * Update global drawdown
   */
  public updateGlobalDrawdown(drawdownPct: number): void {
    if (!this.config.enabled) return;

    this.globalDrawdownPct = drawdownPct;
    this.logger.debug(`Updated global drawdown to ${drawdownPct.toFixed(2)}%`);
  }

  /**
   * Check all drawdowns and trigger alerts/freezes if needed
   */
  private checkDrawdowns(): void {
    if (!this.config.enabled) return;

    // Check agent drawdowns
    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      if (metrics.isFrozen) continue;

      if (metrics.currentDrawdownPct <= this.config.maxAgentDrawdownPct) {
        this.handleAgentDrawdownBreach(agentId, metrics);
      } else if (metrics.currentDrawdownPct <= this.config.alertThresholdPct) {
        this.emitDrawdownAlert('agent', agentId, metrics.currentDrawdownPct);
      }
    }

    // Check strategy drawdowns
    for (const [strategyId, metrics] of this.strategyMetrics.entries()) {
      if (metrics.isFrozen) continue;

      if (metrics.currentDrawdownPct <= this.config.maxStrategyDrawdownPct) {
        this.handleStrategyDrawdownBreach(strategyId, metrics);
      } else if (metrics.currentDrawdownPct <= this.config.alertThresholdPct) {
        this.emitDrawdownAlert('strategy', strategyId, metrics.currentDrawdownPct);
      }
    }

    // Check global drawdown
    if (this.globalDrawdownPct <= this.config.globalDrawdownThresholdPct) {
      this.handleGlobalDrawdownBreach();
    } else if (this.globalDrawdownPct <= this.config.alertThresholdPct) {
      this.emitDrawdownAlert('global', 'system', this.globalDrawdownPct);
    }
  }

  /**
   * Handle agent drawdown breach
   */
  private handleAgentDrawdownBreach(agentId: string, metrics: AgentDrawdownMetrics): void {
    this.logger.warn(
      `Agent ${agentId} drawdown breach: ${metrics.currentDrawdownPct.toFixed(2)}% ` +
      `(threshold: ${this.config.maxAgentDrawdownPct}%)`
    );

    if (this.config.emergencyFreezeEnabled) {
      this.triggerEmergencyFreeze('agent', agentId);
      metrics.isFrozen = true;
      this.agentMetrics.set(agentId, metrics);
    }

    this.telemetryEngine.emitRiskEvent({
      type: 'AGENT_DRAWDOWN_BREACH',
      agentId,
      drawdownPct: metrics.currentDrawdownPct,
      threshold: this.config.maxAgentDrawdownPct,
      timestamp: Date.now()
    });
  }

  /**
   * Handle strategy drawdown breach
   */
  private handleStrategyDrawdownBreach(strategyId: string, metrics: StrategyDrawdownMetrics): void {
    this.logger.warn(
      `Strategy ${strategyId} drawdown breach: ${metrics.currentDrawdownPct.toFixed(2)}% ` +
      `(threshold: ${this.config.maxStrategyDrawdownPct}%)`
    );

    if (this.config.emergencyFreezeEnabled) {
      this.triggerEmergencyFreeze('strategy', strategyId);
      metrics.isFrozen = false;
      this.strategyMetrics.set(strategyId, metrics);
    }

    this.telemetryEngine.emitRiskEvent({
      type: 'STRATEGY_DRAWDOWN_BREACH',
      strategyId,
      drawdownPct: metrics.currentDrawdownPct,
      threshold: this.config.maxStrategyDrawdownPct,
      timestamp: Date.now()
    });
  }

  /**
   * Handle global drawdown breach
   */
  private handleGlobalDrawdownBreach(): void {
    this.logger.warn(
      `Global drawdown breach: ${this.globalDrawdownPct.toFixed(2)}% ` +
      `(threshold: ${this.config.globalDrawdownThresholdPct}%)`
    );

    if (this.config.emergencyFreezeEnabled) {
      this.triggerEmergencyFreeze('global', 'system');
    }

    this.telemetryEngine.emitRiskEvent({
      type: 'GLOBAL_DRAWDOWN_BREACH',
      drawdownPct: this.globalDrawdownPct,
      threshold: this.config.globalDrawdownThresholdPct,
      timestamp: Date.now()
    });
  }

  /**
   * Trigger emergency freeze
   */
  private triggerEmergencyFreeze(type: 'agent' | 'strategy' | 'global', id: string): void {
    this.logger.error(`Emergency freeze triggered for ${type} ${id}`);

    this.telemetryEngine.emitRiskEvent({
      type: 'EMERGENCY_FREEZE',
      entityType: type,
      entityId: id,
      timestamp: Date.now()
    });

    // TODO: Implement actual freeze logic (e.g., stop all trading, close positions)
  }

  /**
   * Emit drawdown alert
   */
  private emitDrawdownAlert(type: 'agent' | 'strategy' | 'global', id: string, drawdownPct: number): void {
    this.telemetryEngine.emitRiskEvent({
      type: 'DRAWDOWN_ALERT',
      entityType: type,
      entityId: id,
      drawdownPct,
      threshold: this.config.alertThresholdPct,
      timestamp: Date.now()
    });
  }

  /**
   * Get agent drawdown metrics
   */
  public getAgentMetrics(agentId: string): AgentDrawdownMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  /**
   * Get strategy drawdown metrics
   */
  public getStrategyMetrics(strategyId: string): StrategyDrawdownMetrics | undefined {
    return this.strategyMetrics.get(strategyId);
  }

  /**
   * Get global drawdown
   */
  public getGlobalDrawdown(): number {
    return this.globalDrawdownPct;
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.agentMetrics.clear();
    this.strategyMetrics.clear();
    this.globalDrawdownPct = 0;
    this.logger.info('Drawdown metrics reset');
  }
} 