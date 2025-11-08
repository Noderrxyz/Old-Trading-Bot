/**
 * Trust Score Engine
 * 
 * Manages dynamic trust scores for agents based on performance and risk metrics.
 * Adjusts scores based on alpha generation, drawdown profile, and risk-adjusted returns.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';

/**
 * Trust score engine configuration
 */
export interface TrustScoreEngineConfig {
  enabled: boolean;
  baseTrustScore: number;
  minTrustScore: number;
  maxTrustScore: number;
  alphaWeight: number;
  drawdownWeight: number;
  riskAdjustedReturnWeight: number;
  inactivityDecayRate: number;
  maxInactivityDays: number;
  updateIntervalMs: number;
}

/**
 * Default trust score engine configuration
 */
export const DEFAULT_TRUST_SCORE_ENGINE_CONFIG: TrustScoreEngineConfig = {
  enabled: true,
  baseTrustScore: 0.5,
  minTrustScore: 0.1,
  maxTrustScore: 1.0,
  alphaWeight: 0.4,
  drawdownWeight: 0.3,
  riskAdjustedReturnWeight: 0.3,
  inactivityDecayRate: 0.05,
  maxInactivityDays: 30,
  updateIntervalMs: 60000
};

/**
 * Agent trust metrics
 */
interface AgentTrustMetrics {
  agentId: string;
  currentTrustScore: number;
  alphaScore: number;
  drawdownScore: number;
  riskAdjustedReturnScore: number;
  lastActivity: number;
  lastUpdate: number;
}

/**
 * Trust Score Engine class
 */
export class TrustScoreEngine {
  private static instance: TrustScoreEngine | null = null;
  private config: TrustScoreEngineConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[TrustScoreEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[TrustScoreEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[TrustScoreEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[TrustScoreEngine] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private agentMetrics: Map<string, AgentTrustMetrics>;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): TrustScoreEngine {
    if (!TrustScoreEngine.instance) {
      TrustScoreEngine.instance = new TrustScoreEngine();
    }
    return TrustScoreEngine.instance;
  }

  constructor(config: Partial<TrustScoreEngineConfig> = {}) {
    this.config = { ...DEFAULT_TRUST_SCORE_ENGINE_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.agentMetrics = new Map();
  }

  /**
   * Start trust score monitoring
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Trust score engine is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Trust score engine is already running');
      return;
    }

    this.isRunning = true;
    this.updateInterval = setInterval(() => this.updateTrustScores(), this.config.updateIntervalMs);
    this.logger.info('Trust score engine started');
  }

  /**
   * Stop trust score monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Trust score engine stopped');
  }

  /**
   * Update agent metrics
   */
  public updateAgentMetrics(
    agentId: string,
    alphaScore: number,
    drawdownScore: number,
    riskAdjustedReturnScore: number
  ): void {
    if (!this.config.enabled) return;

    const metrics = this.agentMetrics.get(agentId) || {
      agentId,
      currentTrustScore: this.config.baseTrustScore,
      alphaScore: 0,
      drawdownScore: 0,
      riskAdjustedReturnScore: 0,
      lastActivity: Date.now(),
      lastUpdate: Date.now()
    };

    metrics.alphaScore = alphaScore;
    metrics.drawdownScore = drawdownScore;
    metrics.riskAdjustedReturnScore = riskAdjustedReturnScore;
    metrics.lastActivity = Date.now();

    this.agentMetrics.set(agentId, metrics);
    this.logger.debug(
      `Updated agent ${agentId} metrics: ` +
      `Alpha: ${alphaScore.toFixed(2)}, ` +
      `Drawdown: ${drawdownScore.toFixed(2)}, ` +
      `Risk Adj. Return: ${riskAdjustedReturnScore.toFixed(2)}`
    );
  }

  /**
   * Calculate trust score
   */
  private calculateTrustScore(metrics: AgentTrustMetrics): number {
    // Calculate weighted score
    let score = 
      metrics.alphaScore * this.config.alphaWeight +
      metrics.drawdownScore * this.config.drawdownWeight +
      metrics.riskAdjustedReturnScore * this.config.riskAdjustedReturnWeight;

    // Apply inactivity decay
    const inactivityDays = (Date.now() - metrics.lastActivity) / (1000 * 60 * 60 * 24);
    if (inactivityDays > 0) {
      const decayFactor = Math.min(1, inactivityDays / this.config.maxInactivityDays);
      score *= (1 - decayFactor * this.config.inactivityDecayRate);
    }

    return Math.max(this.config.minTrustScore, Math.min(this.config.maxTrustScore, score));
  }

  /**
   * Update trust scores
   */
  private updateTrustScores(): void {
    if (!this.config.enabled) return;

    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      const oldScore = metrics.currentTrustScore;
      const newScore = this.calculateTrustScore(metrics);

      if (Math.abs(newScore - oldScore) > 0.01) {
        metrics.currentTrustScore = newScore;
        metrics.lastUpdate = Date.now();
        this.agentMetrics.set(agentId, metrics);

        this.logger.info(
          `Updated agent ${agentId} trust score: ` +
          `${oldScore.toFixed(2)} -> ${newScore.toFixed(2)}`
        );

        this.telemetryEngine.emitRiskEvent({
          type: 'TRUST_SCORE_UPDATE',
          agentId,
          oldScore,
          newScore,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Get agent trust metrics
   */
  public getAgentMetrics(agentId: string): AgentTrustMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  /**
   * Get all agent metrics
   */
  public getAllAgentMetrics(): AgentTrustMetrics[] {
    return Array.from(this.agentMetrics.values());
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.agentMetrics.clear();
    this.logger.info('Trust score metrics reset');
  }
} 