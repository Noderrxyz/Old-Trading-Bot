/**
 * Capital Allocator
 * 
 * Dynamically allocates capital across agents based on trust scores and performance.
 * Routes more size to higher-trust agents and penalizes underperforming agents.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';

/**
 * Capital allocator configuration
 */
export interface CapitalAllocatorConfig {
  enabled: boolean;
  baseAllocation: number;
  minAllocationPct: number;
  maxAllocationPct: number;
  trustScoreWeight: number;
  performanceWeight: number;
  drawdownPenalty: number;
  inactivityPenalty: number;
  rebalanceIntervalMs: number;
}

/**
 * Default capital allocator configuration
 */
export const DEFAULT_CAPITAL_ALLOCATOR_CONFIG: CapitalAllocatorConfig = {
  enabled: true,
  baseAllocation: 100000,
  minAllocationPct: 0.05,
  maxAllocationPct: 0.3,
  trustScoreWeight: 0.6,
  performanceWeight: 0.4,
  drawdownPenalty: 0.1,
  inactivityPenalty: 0.05,
  rebalanceIntervalMs: 60000
};

/**
 * Agent allocation metrics
 */
interface AgentAllocationMetrics {
  agentId: string;
  currentAllocation: number;
  targetAllocation: number;
  trustScore: number;
  performanceScore: number;
  lastActivity: number;
  lastDrawdown: number;
}

/**
 * Capital Allocator class
 */
export class CapitalAllocator {
  private static instance: CapitalAllocator | null = null;
  private config: CapitalAllocatorConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[CapitalAllocator] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[CapitalAllocator] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[CapitalAllocator] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[CapitalAllocator] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private agentMetrics: Map<string, AgentAllocationMetrics>;
  private rebalanceInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): CapitalAllocator {
    if (!CapitalAllocator.instance) {
      CapitalAllocator.instance = new CapitalAllocator();
    }
    return CapitalAllocator.instance;
  }

  constructor(config: Partial<CapitalAllocatorConfig> = {}) {
    this.config = { ...DEFAULT_CAPITAL_ALLOCATOR_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.agentMetrics = new Map();
  }

  /**
   * Start capital allocation monitoring
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Capital allocator is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Capital allocator is already running');
      return;
    }

    this.isRunning = true;
    this.rebalanceInterval = setInterval(() => this.rebalanceAllocations(), this.config.rebalanceIntervalMs);
    this.logger.info('Capital allocator started');
  }

  /**
   * Stop capital allocation monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Capital allocator stopped');
  }

  /**
   * Update agent metrics
   */
  public updateAgentMetrics(
    agentId: string,
    trustScore: number,
    performanceScore: number,
    drawdown: number
  ): void {
    if (!this.config.enabled) return;

    const metrics = this.agentMetrics.get(agentId) || {
      agentId,
      currentAllocation: 0,
      targetAllocation: 0,
      trustScore: 0,
      performanceScore: 0,
      lastActivity: Date.now(),
      lastDrawdown: 0
    };

    metrics.trustScore = trustScore;
    metrics.performanceScore = performanceScore;
    metrics.lastDrawdown = drawdown;
    metrics.lastActivity = Date.now();

    this.agentMetrics.set(agentId, metrics);
    this.logger.debug(
      `Updated agent ${agentId} metrics: ` +
      `Trust: ${trustScore.toFixed(2)}, ` +
      `Performance: ${performanceScore.toFixed(2)}, ` +
      `Drawdown: ${drawdown.toFixed(2)}%`
    );
  }

  /**
   * Calculate agent allocation score
   */
  private calculateAllocationScore(metrics: AgentAllocationMetrics): number {
    // Base score from trust and performance
    let score = 
      metrics.trustScore * this.config.trustScoreWeight +
      metrics.performanceScore * this.config.performanceWeight;

    // Apply drawdown penalty
    if (metrics.lastDrawdown < 0) {
      score *= (1 + metrics.lastDrawdown * this.config.drawdownPenalty);
    }

    // Apply inactivity penalty
    const inactivityHours = (Date.now() - metrics.lastActivity) / (1000 * 60 * 60);
    if (inactivityHours > 24) {
      score *= (1 - Math.min(1, inactivityHours / 24) * this.config.inactivityPenalty);
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Rebalance capital allocations
   */
  private rebalanceAllocations(): void {
    if (!this.config.enabled) return;

    // Calculate total allocation score
    let totalScore = 0;
    const agentScores = new Map<string, number>();

    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      const score = this.calculateAllocationScore(metrics);
      agentScores.set(agentId, score);
      totalScore += score;
    }

    if (totalScore === 0) {
      this.logger.warn('No valid allocation scores found');
      return;
    }

    // Calculate new allocations
    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      const score = agentScores.get(agentId) || 0;
      const allocationPct = score / totalScore;

      // Apply min/max allocation constraints
      const constrainedPct = Math.max(
        this.config.minAllocationPct,
        Math.min(this.config.maxAllocationPct, allocationPct)
      );

      const newAllocation = this.config.baseAllocation * constrainedPct;
      const oldAllocation = metrics.currentAllocation;

      if (Math.abs(newAllocation - oldAllocation) > 0.01) {
        metrics.targetAllocation = newAllocation;
        this.agentMetrics.set(agentId, metrics);

        this.logger.info(
          `Rebalanced agent ${agentId} allocation: ` +
          `${oldAllocation.toFixed(2)} -> ${newAllocation.toFixed(2)} ` +
          `(${(constrainedPct * 100).toFixed(2)}%)`
        );

        this.telemetryEngine.emitRiskEvent({
          type: 'CAPITAL_REBALANCE',
          agentId,
          oldAllocation,
          newAllocation,
          allocationPct: constrainedPct,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Get agent allocation metrics
   */
  public getAgentMetrics(agentId: string): AgentAllocationMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  /**
   * Get all agent metrics
   */
  public getAllAgentMetrics(): AgentAllocationMetrics[] {
    return Array.from(this.agentMetrics.values());
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.agentMetrics.clear();
    this.logger.info('Capital allocation metrics reset');
  }
} 