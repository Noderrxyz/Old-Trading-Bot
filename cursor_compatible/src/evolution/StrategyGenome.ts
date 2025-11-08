import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';

/**
 * Strategy genome metrics
 */
interface StrategyMetrics {
  pnlStability: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgTradeDuration: number;
}

/**
 * Strategy genome metadata
 */
interface StrategyMetadata {
  locked: string[];
  createdAt: number;
  lastModified: number;
  version: string;
  tags: string[];
}

/**
 * Strategy genome parameters
 */
interface StrategyParameters {
  [key: string]: any;
}

/**
 * Strategy Genome
 */
export class StrategyGenome {
  public readonly id: string;
  public readonly metrics: StrategyMetrics;
  public readonly metadata: StrategyMetadata;
  public readonly parameters: StrategyParameters;

  constructor(
    id: string,
    metrics: Partial<StrategyMetrics> = {},
    metadata: Partial<StrategyMetadata> = {},
    parameters: StrategyParameters = {}
  ) {
    this.id = id;
    this.metrics = {
      pnlStability: metrics.pnlStability || 0,
      sharpeRatio: metrics.sharpeRatio || 0,
      maxDrawdown: metrics.maxDrawdown || 0,
      winRate: metrics.winRate || 0,
      avgTradeDuration: metrics.avgTradeDuration || 0
    };
    this.metadata = {
      locked: metadata.locked || [],
      createdAt: metadata.createdAt || Date.now(),
      lastModified: metadata.lastModified || Date.now(),
      version: metadata.version || '1.0.0',
      tags: metadata.tags || []
    };
    this.parameters = parameters;
  }

  /**
   * Clone genome
   */
  public clone(): StrategyGenome {
    return new StrategyGenome(
      this.id + '_clone_' + Date.now(),
      { ...this.metrics },
      { ...this.metadata },
      { ...this.parameters }
    );
  }

  /**
   * Check if parameter is locked
   */
  public isParameterLocked(param: string): boolean {
    return this.metadata.locked.includes(param);
  }

  /**
   * Lock parameter
   */
  public lockParameter(param: string): void {
    if (!this.metadata.locked.includes(param)) {
      this.metadata.locked.push(param);
      this.metadata.lastModified = Date.now();
    }
  }

  /**
   * Unlock parameter
   */
  public unlockParameter(param: string): void {
    const index = this.metadata.locked.indexOf(param);
    if (index !== -1) {
      this.metadata.locked.splice(index, 1);
      this.metadata.lastModified = Date.now();
    }
  }

  /**
   * Update parameter
   */
  public updateParameter(param: string, value: any): boolean {
    if (this.isParameterLocked(param)) {
      logger.warn(`Attempted to update locked parameter: ${param}`);
      return false;
    }

    this.parameters[param] = value;
    this.metadata.lastModified = Date.now();
    return true;
  }

  /**
   * Update metrics
   */
  public updateMetrics(metrics: Partial<StrategyMetrics>): void {
    Object.assign(this.metrics, metrics);
    this.metadata.lastModified = Date.now();
  }

  /**
   * Add tag
   */
  public addTag(tag: string): void {
    if (!this.metadata.tags.includes(tag)) {
      this.metadata.tags.push(tag);
      this.metadata.lastModified = Date.now();
    }
  }

  /**
   * Remove tag
   */
  public removeTag(tag: string): void {
    const index = this.metadata.tags.indexOf(tag);
    if (index !== -1) {
      this.metadata.tags.splice(index, 1);
      this.metadata.lastModified = Date.now();
    }
  }
} 