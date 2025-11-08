import { logger } from '../../utils/logger';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { Bridge } from '../types/Bridge';
import { BridgeMetrics } from './BridgeSelector';

/**
 * Configuration for the metrics collector
 */
export interface BridgeMetricsCollectorConfig {
  /**
   * Cache TTL for metrics (in ms)
   */
  cacheTtlMs: number;
  
  /**
   * Maximum number of retries for failed metric fetches
   */
  maxRetries: number;
  
  /**
   * Timeout for metric fetches (in ms)
   */
  fetchTimeoutMs: number;
  
  /**
   * Whether to enable fallback to cached metrics on failure
   */
  enableFallback: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: BridgeMetricsCollectorConfig = {
  cacheTtlMs: 30000, // 30 seconds
  maxRetries: 3,
  fetchTimeoutMs: 5000,
  enableFallback: true
};

/**
 * BridgeMetricsCollector - Collects and caches real-time bridge metrics
 */
export class BridgeMetricsCollector {
  private static instance: BridgeMetricsCollector | null = null;
  private config: BridgeMetricsCollectorConfig;
  private telemetryBus: TelemetryBus;
  private metricsCache: Map<string, {
    metrics: BridgeMetrics;
    timestamp: number;
  }> = new Map();
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(config: Partial<BridgeMetricsCollectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    
    logger.info('BridgeMetricsCollector initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<BridgeMetricsCollectorConfig>): BridgeMetricsCollector {
    if (!BridgeMetricsCollector.instance) {
      BridgeMetricsCollector.instance = new BridgeMetricsCollector(config);
    } else if (config) {
      BridgeMetricsCollector.instance.updateConfig(config);
    }
    return BridgeMetricsCollector.instance;
  }
  
  /**
   * Get metrics for a bridge
   */
  public async getMetrics(bridge: Bridge): Promise<BridgeMetrics> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cached = this.metricsCache.get(bridge.id);
      
      if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
        logger.debug(`Using cached metrics for bridge ${bridge.id}`);
        return cached.metrics;
      }
      
      // Fetch fresh metrics
      const metrics = await this.fetchMetricsWithRetry(bridge);
      
      // Update cache
      this.metricsCache.set(bridge.id, {
        metrics,
        timestamp: Date.now()
      });
      
      // Emit telemetry
      this.telemetryBus.emit('bridge_metrics_updated', {
        bridgeId: bridge.id,
        bridgeName: bridge.name,
        metrics,
        executionTimeMs: Date.now() - startTime
      });
      
      return metrics;
    } catch (error) {
      logger.error(`Error fetching metrics for bridge ${bridge.id}:`, error);
      
      // Emit telemetry for error
      this.telemetryBus.emit('bridge_metrics_error', {
        bridgeId: bridge.id,
        bridgeName: bridge.name,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime
      });
      
      // Return fallback metrics if enabled
      if (this.config.enableFallback) {
        const cached = this.metricsCache.get(bridge.id);
        if (cached) {
          logger.warn(`Using stale metrics for bridge ${bridge.id} due to fetch failure`);
          return cached.metrics;
        }
      }
      
      // Return default metrics as last resort
      return this.getDefaultMetrics(bridge);
    }
  }
  
  /**
   * Fetch metrics with retry logic
   */
  private async fetchMetricsWithRetry(bridge: Bridge): Promise<BridgeMetrics> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.fetchMetrics(bridge);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Attempt ${attempt}/${this.config.maxRetries} failed for bridge ${bridge.id}:`, lastError);
        
        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw lastError || new Error(`Failed to fetch metrics for bridge ${bridge.id} after ${this.config.maxRetries} attempts`);
  }
  
  /**
   * Fetch metrics from external sources
   */
  private async fetchMetrics(bridge: Bridge): Promise<BridgeMetrics> {
    // TODO: Implement actual metric fetching from external sources
    // For now, return mock data
    return {
      liquidityUsd: 1000000,
      feeUsd: 10,
      estimatedTimeSeconds: 300,
      reliabilityScore: 0.95,
      securityScore: 0.9
    };
  }
  
  /**
   * Get default metrics for a bridge
   */
  private getDefaultMetrics(bridge: Bridge): BridgeMetrics {
    return {
      liquidityUsd: bridge.minAmountUsd,
      feeUsd: 0,
      estimatedTimeSeconds: bridge.estimatedTimeSeconds,
      reliabilityScore: 0.5,
      securityScore: 0.5
    };
  }
  
  /**
   * Update configuration
   */
  private updateConfig(config: Partial<BridgeMetricsCollectorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('BridgeMetricsCollector configuration updated');
  }
} 