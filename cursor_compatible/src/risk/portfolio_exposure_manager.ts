/**
 * Portfolio Exposure Manager
 * 
 * Enforces hard and soft limits on overall portfolio exposure across:
 * - Single assets (e.g., ETH, BTC, SOL)
 * - Single sectors (optional)
 * - Single strategies/agents
 * - Total system exposure
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';
import { LivePosition } from '../risk/types/position_exposure.types.js';
import { StrategyMetrics } from '../strategy/types/strategy.types.js';

/**
 * Portfolio exposure configuration
 */
export interface PortfolioExposureConfig {
  enabled: boolean;
  maxAssetExposurePct: number;      // Maximum exposure per asset (e.g., 20%)
  maxSectorExposurePct: number;     // Maximum exposure per sector (e.g., 40%)
  maxAgentExposurePct: number;      // Maximum exposure per agent (e.g., 30%)
  maxSystemExposurePct: number;     // Maximum total system exposure (e.g., 60%)
  softLimitThreshold: number;       // Percentage of hard limit to trigger warnings (e.g., 80%)
  rebalanceIntervalMs: number;      // How often to check and rebalance
  minRebalanceSizePct: number;      // Minimum position size to trigger rebalance
  preferNewerPositions: boolean;    // Whether to prefer trimming newer positions
  sectorMapping: Record<string, string[]>; // Asset to sector mapping
}

const DEFAULT_CONFIG: PortfolioExposureConfig = {
  enabled: true,
  maxAssetExposurePct: 20,
  maxSectorExposurePct: 40,
  maxAgentExposurePct: 30,
  maxSystemExposurePct: 60,
  softLimitThreshold: 80,
  rebalanceIntervalMs: 60000,
  minRebalanceSizePct: 1,
  preferNewerPositions: true,
  sectorMapping: {}
};

/**
 * Exposure metrics for an entity (asset, sector, agent)
 */
interface ExposureMetrics {
  currentExposure: number;
  maxExposure: number;
  lastUpdate: number;
  positions: LivePosition[];
}

/**
 * Rebalancing action
 */
interface RebalanceAction {
  type: 'SCALE_DOWN' | 'LIQUIDATE' | 'BLOCK';
  entityId: string;
  entityType: 'asset' | 'sector' | 'agent' | 'system';
  currentExposure: number;
  targetExposure: number;
  affectedPositions: LivePosition[];
}

/**
 * Portfolio Exposure Manager
 */
export class PortfolioExposureManager {
  private static instance: PortfolioExposureManager | null = null;
  private config: PortfolioExposureConfig;
  private telemetryEngine: ExecutionTelemetryEngine;
  private assetMetrics: Map<string, ExposureMetrics>;
  private sectorMetrics: Map<string, ExposureMetrics>;
  private agentMetrics: Map<string, ExposureMetrics>;
  private systemMetrics: ExposureMetrics;
  private rebalanceInterval: NodeJS.Timeout | null;
  private isRunning: boolean;

  /**
   * Get singleton instance
   */
  public static getInstance(): PortfolioExposureManager {
    if (!PortfolioExposureManager.instance) {
      PortfolioExposureManager.instance = new PortfolioExposureManager();
    }
    return PortfolioExposureManager.instance;
  }

  constructor(config: Partial<PortfolioExposureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.assetMetrics = new Map();
    this.sectorMetrics = new Map();
    this.agentMetrics = new Map();
    this.systemMetrics = {
      currentExposure: 0,
      maxExposure: this.config.maxSystemExposurePct,
      lastUpdate: Date.now(),
      positions: []
    };
    this.rebalanceInterval = null;
    this.isRunning = false;
  }

  /**
   * Start the exposure manager
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Portfolio exposure manager already running');
      return;
    }

    this.rebalanceInterval = setInterval(() => {
      this.checkAndRebalance();
    }, this.config.rebalanceIntervalMs);

    this.isRunning = true;
    logger.info('Started portfolio exposure manager');
  }

  /**
   * Stop the exposure manager
   */
  public stop(): void {
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = null;
    }
    this.isRunning = false;
    logger.info('Stopped portfolio exposure manager');
  }

  /**
   * Update position metrics
   */
  public updatePosition(position: LivePosition): void {
    if (!this.config.enabled) return;

    // Update asset metrics
    this.updateAssetMetrics(position);

    // Update sector metrics if sector mapping exists
    if (Object.keys(this.config.sectorMapping).length > 0) {
      this.updateSectorMetrics(position);
    }

    // Update agent metrics
    this.updateAgentMetrics(position);

    // Update system metrics
    this.updateSystemMetrics(position);

    // Check for exposure breaches
    this.checkExposureBreaches();
  }

  /**
   * Update strategy metrics
   */
  public updateStrategyMetrics(agentId: string, metrics: StrategyMetrics): void {
    if (!this.config.enabled) return;

    const agentMetrics = this.agentMetrics.get(agentId) || {
      currentExposure: 0,
      maxExposure: this.config.maxAgentExposurePct,
      lastUpdate: Date.now(),
      positions: []
    };

    // Calculate exposure from positions
    agentMetrics.currentExposure = this.calculateExposure(agentMetrics.positions);
    agentMetrics.lastUpdate = Date.now();

    this.agentMetrics.set(agentId, agentMetrics);
  }

  /**
   * Get current exposure for an entity
   */
  public getExposure(entityId: string, entityType: 'asset' | 'sector' | 'agent'): number {
    switch (entityType) {
      case 'asset':
        return this.assetMetrics.get(entityId)?.currentExposure || 0;
      case 'sector':
        return this.sectorMetrics.get(entityId)?.currentExposure || 0;
      case 'agent':
        return this.agentMetrics.get(entityId)?.currentExposure || 0;
    }
  }

  /**
   * Get system-wide exposure
   */
  public getSystemExposure(): number {
    return this.systemMetrics.currentExposure;
  }

  /**
   * Update asset metrics
   */
  private updateAssetMetrics(position: LivePosition): void {
    const assetMetrics = this.assetMetrics.get(position.asset) || {
      currentExposure: 0,
      maxExposure: this.config.maxAssetExposurePct,
      lastUpdate: Date.now(),
      positions: []
    };

    // Update exposure
    assetMetrics.currentExposure = this.calculateExposure(assetMetrics.positions);
    assetMetrics.positions.push(position);
    assetMetrics.lastUpdate = Date.now();

    this.assetMetrics.set(position.asset, assetMetrics);
  }

  /**
   * Update sector metrics
   */
  private updateSectorMetrics(position: LivePosition): void {
    // Find sector for asset
    const sector = Object.entries(this.config.sectorMapping).find(([_, assets]) =>
      assets.includes(position.asset)
    )?.[0];

    if (!sector) return;

    const sectorMetrics = this.sectorMetrics.get(sector) || {
      currentExposure: 0,
      maxExposure: this.config.maxSectorExposurePct,
      lastUpdate: Date.now(),
      positions: []
    };

    // Update exposure
    sectorMetrics.currentExposure = this.calculateExposure(sectorMetrics.positions);
    sectorMetrics.positions.push(position);
    sectorMetrics.lastUpdate = Date.now();

    this.sectorMetrics.set(sector, sectorMetrics);
  }

  /**
   * Update agent metrics
   */
  private updateAgentMetrics(position: LivePosition): void {
    const agentMetrics = this.agentMetrics.get(position.agentId) || {
      currentExposure: 0,
      maxExposure: this.config.maxAgentExposurePct,
      lastUpdate: Date.now(),
      positions: []
    };

    // Update exposure
    agentMetrics.currentExposure = this.calculateExposure(agentMetrics.positions);
    agentMetrics.positions.push(position);
    agentMetrics.lastUpdate = Date.now();

    this.agentMetrics.set(position.agentId, agentMetrics);
  }

  /**
   * Update system metrics
   */
  private updateSystemMetrics(position: LivePosition): void {
    this.systemMetrics.positions.push(position);
    this.systemMetrics.currentExposure = this.calculateExposure(this.systemMetrics.positions);
    this.systemMetrics.lastUpdate = Date.now();
  }

  /**
   * Calculate exposure for a set of positions
   */
  private calculateExposure(positions: LivePosition[]): number {
    return positions.reduce((total, position) => {
      return total + (position.size * position.currentPrice);
    }, 0);
  }

  /**
   * Check for exposure breaches and trigger rebalancing if needed
   */
  private checkExposureBreaches(): void {
    // Check asset exposures
    for (const [assetId, metrics] of this.assetMetrics.entries()) {
      this.checkEntityExposure('asset', assetId, metrics);
    }

    // Check sector exposures
    for (const [sectorId, metrics] of this.sectorMetrics.entries()) {
      this.checkEntityExposure('sector', sectorId, metrics);
    }

    // Check agent exposures
    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      this.checkEntityExposure('agent', agentId, metrics);
    }

    // Check system exposure
    this.checkEntityExposure('system', 'system', this.systemMetrics);
  }

  /**
   * Check exposure for a specific entity
   */
  private checkEntityExposure(
    entityType: 'asset' | 'sector' | 'agent' | 'system',
    entityId: string,
    metrics: ExposureMetrics
  ): void {
    const softLimit = metrics.maxExposure * (this.config.softLimitThreshold / 100);

    if (metrics.currentExposure > softLimit) {
      // Emit warning if approaching limit
      this.telemetryEngine.emitRiskEvent({
        type: 'EXPOSURE_BREACH',
        entityType: entityType === 'sector' ? 'asset' : entityType === 'system' ? 'pair' : entityType,
        entityId,
        currentExposure: metrics.currentExposure,
        limit: metrics.maxExposure,
        timestamp: Date.now()
      });
    }

    if (metrics.currentExposure > metrics.maxExposure) {
      // Trigger rebalancing if limit exceeded
      const action = this.determineRebalanceAction(entityType, entityId, metrics);
      this.executeRebalanceAction(action);
    }
  }

  /**
   * Determine appropriate rebalancing action
   */
  private determineRebalanceAction(
    entityType: 'asset' | 'sector' | 'agent' | 'system',
    entityId: string,
    metrics: ExposureMetrics
  ): RebalanceAction {
    const excessExposure = metrics.currentExposure - metrics.maxExposure;
    const excessPct = (excessExposure / metrics.currentExposure) * 100;

    if (excessPct > 50) {
      // If significantly over limit, liquidate excess
      return {
        type: 'LIQUIDATE',
        entityId,
        entityType,
        currentExposure: metrics.currentExposure,
        targetExposure: metrics.maxExposure,
        affectedPositions: this.selectPositionsToLiquidate(metrics.positions)
      };
    } else if (excessPct > 20) {
      // If moderately over limit, scale down
      return {
        type: 'SCALE_DOWN',
        entityId,
        entityType,
        currentExposure: metrics.currentExposure,
        targetExposure: metrics.maxExposure,
        affectedPositions: this.selectPositionsToScale(metrics.positions)
      };
    } else {
      // If slightly over limit, block new positions
      return {
        type: 'BLOCK',
        entityId,
        entityType,
        currentExposure: metrics.currentExposure,
        targetExposure: metrics.maxExposure,
        affectedPositions: []
      };
    }
  }

  /**
   * Select positions to liquidate
   */
  private selectPositionsToLiquidate(positions: LivePosition[]): LivePosition[] {
    if (this.config.preferNewerPositions) {
      // Sort by creation time (newest first)
      return [...positions].sort((a, b) => b.createdAt - a.createdAt);
    } else {
      // Sort by size (smallest first)
      return [...positions].sort((a, b) => a.size - b.size);
    }
  }

  /**
   * Select positions to scale down
   */
  private selectPositionsToScale(positions: LivePosition[]): LivePosition[] {
    // Sort by size (largest first) to minimize number of adjustments
    return [...positions].sort((a, b) => b.size - a.size);
  }

  /**
   * Execute rebalancing action
   */
  private executeRebalanceAction(action: RebalanceAction): void {
    this.telemetryEngine.emitRiskEvent({
      type: 'CAPITAL_REBALANCE',
      agentId: action.entityId,
      oldAllocation: action.currentExposure,
      newAllocation: action.targetExposure,
      allocationPct: (action.targetExposure / action.currentExposure) * 100,
      timestamp: Date.now()
    });

    // In a real implementation, this would trigger actual position adjustments
    // through the execution engine
  }

  /**
   * Check and rebalance exposures
   */
  private checkAndRebalance(): void {
    if (!this.config.enabled) return;

    // Recalculate all exposures
    for (const [assetId, metrics] of this.assetMetrics.entries()) {
      metrics.currentExposure = this.calculateExposure(metrics.positions);
      this.checkEntityExposure('asset', assetId, metrics);
    }

    for (const [sectorId, metrics] of this.sectorMetrics.entries()) {
      metrics.currentExposure = this.calculateExposure(metrics.positions);
      this.checkEntityExposure('sector', sectorId, metrics);
    }

    for (const [agentId, metrics] of this.agentMetrics.entries()) {
      metrics.currentExposure = this.calculateExposure(metrics.positions);
      this.checkEntityExposure('agent', agentId, metrics);
    }

    this.systemMetrics.currentExposure = this.calculateExposure(this.systemMetrics.positions);
    this.checkEntityExposure('system', 'system', this.systemMetrics);
  }
} 