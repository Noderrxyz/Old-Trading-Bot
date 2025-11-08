/**
 * Exposure Limiter
 * 
 * Enforces maximum position size limits per asset, trading pair, and agent.
 * Adapts limits dynamically based on volatility, liquidity, and portfolio diversification.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';

/**
 * Exposure limiter configuration
 */
export interface ExposureLimiterConfig {
  enabled: boolean;
  basePositionSizeLimit: number;
  maxPositionSizePct: number;
  maxAssetExposurePct: number;
  maxPairExposurePct: number;
  maxAgentExposurePct: number;
  volatilityAdjustmentEnabled: boolean;
  liquidityAdjustmentEnabled: boolean;
  diversificationAdjustmentEnabled: boolean;
  checkIntervalMs: number;
}

/**
 * Default exposure limiter configuration
 */
export const DEFAULT_EXPOSURE_LIMITER_CONFIG: ExposureLimiterConfig = {
  enabled: true,
  basePositionSizeLimit: 10000,
  maxPositionSizePct: 0.1,
  maxAssetExposurePct: 0.2,
  maxPairExposurePct: 0.15,
  maxAgentExposurePct: 0.25,
  volatilityAdjustmentEnabled: true,
  liquidityAdjustmentEnabled: true,
  diversificationAdjustmentEnabled: true,
  checkIntervalMs: 1000
};

/**
 * Position metrics for an asset
 */
interface AssetPositionMetrics {
  assetId: string;
  currentExposure: number;
  maxExposure: number;
  lastUpdate: number;
}

/**
 * Position metrics for a trading pair
 */
interface PairPositionMetrics {
  pairId: string;
  currentExposure: number;
  maxExposure: number;
  lastUpdate: number;
}

/**
 * Position metrics for an agent
 */
interface AgentPositionMetrics {
  agentId: string;
  currentExposure: number;
  maxExposure: number;
  lastUpdate: number;
}

/**
 * Market conditions for adjustment
 */
interface MarketConditions {
  volatility: number;
  liquidity: number;
  diversification: number;
}

/**
 * Exposure Limiter class
 */
export class ExposureLimiter {
  private static instance: ExposureLimiter | null = null;
  private config: ExposureLimiterConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[ExposureLimiter] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[ExposureLimiter] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[ExposureLimiter] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[ExposureLimiter] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private assetMetrics: Map<string, AssetPositionMetrics>;
  private pairMetrics: Map<string, PairPositionMetrics>;
  private agentMetrics: Map<string, AgentPositionMetrics>;
  private marketConditions: MarketConditions;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): ExposureLimiter {
    if (!ExposureLimiter.instance) {
      ExposureLimiter.instance = new ExposureLimiter();
    }
    return ExposureLimiter.instance;
  }

  constructor(config: Partial<ExposureLimiterConfig> = {}) {
    this.config = { ...DEFAULT_EXPOSURE_LIMITER_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.assetMetrics = new Map();
    this.pairMetrics = new Map();
    this.agentMetrics = new Map();
    this.marketConditions = {
      volatility: 1.0,
      liquidity: 1.0,
      diversification: 1.0
    };
  }

  /**
   * Start exposure monitoring
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Exposure limiter is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Exposure limiter is already running');
      return;
    }

    this.isRunning = true;
    this.checkInterval = setInterval(() => this.checkExposures(), this.config.checkIntervalMs);
    this.logger.info('Exposure limiter started');
  }

  /**
   * Stop exposure monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Exposure limiter stopped');
  }

  /**
   * Update asset position metrics
   */
  public updateAssetPosition(assetId: string, exposure: number): void {
    if (!this.config.enabled) return;

    const metrics = this.assetMetrics.get(assetId) || {
      assetId,
      currentExposure: 0,
      maxExposure: this.config.basePositionSizeLimit * this.config.maxAssetExposurePct,
      lastUpdate: Date.now()
    };

    metrics.currentExposure = exposure;
    metrics.lastUpdate = Date.now();

    this.assetMetrics.set(assetId, metrics);
    this.logger.debug(`Updated asset ${assetId} exposure to ${exposure}`);
  }

  /**
   * Update pair position metrics
   */
  public updatePairPosition(pairId: string, exposure: number): void {
    if (!this.config.enabled) return;

    const metrics = this.pairMetrics.get(pairId) || {
      pairId,
      currentExposure: 0,
      maxExposure: this.config.basePositionSizeLimit * this.config.maxPairExposurePct,
      lastUpdate: Date.now()
    };

    metrics.currentExposure = exposure;
    metrics.lastUpdate = Date.now();

    this.pairMetrics.set(pairId, metrics);
    this.logger.debug(`Updated pair ${pairId} exposure to ${exposure}`);
  }

  /**
   * Update agent position metrics
   */
  public updateAgentPosition(agentId: string, exposure: number): void {
    if (!this.config.enabled) return;

    const metrics = this.agentMetrics.get(agentId) || {
      agentId,
      currentExposure: 0,
      maxExposure: this.config.basePositionSizeLimit * this.config.maxAgentExposurePct,
      lastUpdate: Date.now()
    };

    metrics.currentExposure = exposure;
    metrics.lastUpdate = Date.now();

    this.agentMetrics.set(agentId, metrics);
    this.logger.debug(`Updated agent ${agentId} exposure to ${exposure}`);
  }

  /**
   * Update market conditions
   */
  public updateMarketConditions(conditions: Partial<MarketConditions>): void {
    if (!this.config.enabled) return;

    this.marketConditions = {
      ...this.marketConditions,
      ...conditions
    };

    this.logger.debug(
      `Updated market conditions: ` +
      `Volatility: ${this.marketConditions.volatility.toFixed(2)}, ` +
      `Liquidity: ${this.marketConditions.liquidity.toFixed(2)}, ` +
      `Diversification: ${this.marketConditions.diversification.toFixed(2)}`
    );
  }

  /**
   * Calculate adjusted position size limit
   */
  public calculateAdjustedLimit(baseLimit: number): number {
    if (!this.config.enabled) return baseLimit;

    let adjustedLimit = baseLimit;

    // Adjust for volatility
    if (this.config.volatilityAdjustmentEnabled) {
      adjustedLimit *= (1 / this.marketConditions.volatility);
    }

    // Adjust for liquidity
    if (this.config.liquidityAdjustmentEnabled) {
      adjustedLimit *= this.marketConditions.liquidity;
    }

    // Adjust for diversification
    if (this.config.diversificationAdjustmentEnabled) {
      adjustedLimit *= this.marketConditions.diversification;
    }

    // Ensure limit doesn't exceed maximum percentage
    const maxLimit = this.config.basePositionSizeLimit * this.config.maxPositionSizePct;
    return Math.min(adjustedLimit, maxLimit);
  }

  /**
   * Check all exposures and trigger alerts if needed
   */
  private checkExposures(): void {
    if (!this.config.enabled) return;

    // Check asset exposures
    for (const [assetId, metrics] of this.assetMetrics.entries()) {
      const adjustedLimit = this.calculateAdjustedLimit(metrics.maxExposure);
      if (metrics.currentExposure > adjustedLimit) {
        this.handleExposureBreach('asset', assetId, metrics.currentExposure, adjustedLimit);
      }
    }

    // Check pair exposures
    for (const [pairId, metrics] of this.pairMetrics.entries()) {
      const adjustedLimit = this.calculateAdjustedLimit(metrics.maxExposure);
      if (metrics.currentExposure > adjustedLimit) {
        this.handleExposureBreach('pair', pairId, metrics.currentExposure, adjustedLimit);
      }
    }

    // Check agent exposures
    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      const adjustedLimit = this.calculateAdjustedLimit(metrics.maxExposure);
      if (metrics.currentExposure > adjustedLimit) {
        this.handleExposureBreach('agent', agentId, metrics.currentExposure, adjustedLimit);
      }
    }
  }

  /**
   * Handle exposure breach
   */
  private handleExposureBreach(
    type: 'asset' | 'pair' | 'agent',
    id: string,
    currentExposure: number,
    limit: number
  ): void {
    this.logger.warn(
      `${type} ${id} exposure breach: ${currentExposure} ` +
      `(limit: ${limit})`
    );

    this.telemetryEngine.emitRiskEvent({
      type: 'EXPOSURE_BREACH',
      entityType: type,
      entityId: id,
      currentExposure,
      limit,
      timestamp: Date.now()
    });
  }

  /**
   * Get asset position metrics
   */
  public getAssetMetrics(assetId: string): AssetPositionMetrics | undefined {
    return this.assetMetrics.get(assetId);
  }

  /**
   * Get pair position metrics
   */
  public getPairMetrics(pairId: string): PairPositionMetrics | undefined {
    return this.pairMetrics.get(pairId);
  }

  /**
   * Get agent position metrics
   */
  public getAgentMetrics(agentId: string): AgentPositionMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  /**
   * Get market conditions
   */
  public getMarketConditions(): MarketConditions {
    return { ...this.marketConditions };
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.assetMetrics.clear();
    this.pairMetrics.clear();
    this.agentMetrics.clear();
    this.marketConditions = {
      volatility: 1.0,
      liquidity: 1.0,
      diversification: 1.0
    };
    this.logger.info('Exposure metrics reset');
  }
} 