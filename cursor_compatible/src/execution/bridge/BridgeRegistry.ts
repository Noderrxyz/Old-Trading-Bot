import { logger } from '../../utils/logger';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { Bridge } from '../types/Bridge';
import { ChainId } from '../types/ChainId';

/**
 * Configuration for the bridge registry
 */
export interface BridgeRegistryConfig {
  /**
   * Whether to enable bridge health checks
   */
  enableHealthChecks: boolean;
  
  /**
   * Interval between health checks (in ms)
   */
  healthCheckIntervalMs: number;
  
  /**
   * Timeout for health checks (in ms)
   */
  healthCheckTimeoutMs: number;
  
  /**
   * Maximum number of retries for health checks
   */
  maxHealthCheckRetries: number;
  
  /**
   * Whether to cache bridge status
   */
  enableStatusCache: boolean;
  
  /**
   * Cache TTL for bridge status (in ms)
   */
  statusCacheTtlMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: BridgeRegistryConfig = {
  enableHealthChecks: true,
  healthCheckIntervalMs: 60000, // 1 minute
  healthCheckTimeoutMs: 5000, // 5 seconds
  maxHealthCheckRetries: 3,
  enableStatusCache: true,
  statusCacheTtlMs: 300000 // 5 minutes
};

/**
 * BridgeRegistry - Manages available bridges and their status
 * 
 * This class maintains a registry of available bridges and their
 * current status, including health checks and caching.
 */
export class BridgeRegistry {
  private static instance: BridgeRegistry | null = null;
  private config: BridgeRegistryConfig;
  private telemetryBus: TelemetryBus;
  private bridges: Map<string, Bridge> = new Map();
  private bridgeStatus: Map<string, {
    isHealthy: boolean;
    lastCheck: number;
    error?: string;
  }> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(config: Partial<BridgeRegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    
    logger.info('BridgeRegistry initialized');
    
    if (this.config.enableHealthChecks) {
      this.startHealthChecks();
    }
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<BridgeRegistryConfig>): BridgeRegistry {
    if (!BridgeRegistry.instance) {
      BridgeRegistry.instance = new BridgeRegistry(config);
    } else if (config) {
      BridgeRegistry.instance.updateConfig(config);
    }
    return BridgeRegistry.instance;
  }
  
  /**
   * Register a new bridge
   */
  public registerBridge(bridge: Bridge): void {
    this.bridges.set(bridge.id, bridge);
    
    // Initialize status
    this.bridgeStatus.set(bridge.id, {
      isHealthy: true,
      lastCheck: Date.now()
    });
    
    logger.info(`Bridge registered: ${bridge.name} (${bridge.id})`);
    
    // Emit telemetry
    this.telemetryBus.emit('bridge_registered', {
      bridgeId: bridge.id,
      bridgeName: bridge.name,
      sourceChain: bridge.sourceChain,
      destinationChain: bridge.destinationChain
    });
  }
  
  /**
   * Unregister a bridge
   */
  public unregisterBridge(bridgeId: string): void {
    const bridge = this.bridges.get(bridgeId);
    
    if (bridge) {
      this.bridges.delete(bridgeId);
      this.bridgeStatus.delete(bridgeId);
      
      logger.info(`Bridge unregistered: ${bridge.name} (${bridge.id})`);
      
      // Emit telemetry
      this.telemetryBus.emit('bridge_unregistered', {
        bridgeId: bridge.id,
        bridgeName: bridge.name
      });
    }
  }
  
  /**
   * Get all bridges for a chain
   */
  public getBridgesForChain(chainId: ChainId): Bridge[] {
    return Array.from(this.bridges.values()).filter(bridge => {
      // Check if bridge is active and healthy
      const status = this.bridgeStatus.get(bridge.id);
      return (
        bridge.sourceChain === chainId &&
        bridge.isActive &&
        (!this.config.enableHealthChecks || (status?.isHealthy ?? false))
      );
    });
  }
  
  /**
   * Get bridge by ID
   */
  public getBridge(bridgeId: string): Bridge | undefined {
    return this.bridges.get(bridgeId);
  }
  
  /**
   * Check if a bridge is healthy
   */
  public async isBridgeHealthy(bridgeId: string): Promise<boolean> {
    const bridge = this.bridges.get(bridgeId);
    
    if (!bridge) {
      return false;
    }
    
    // Check cache if enabled
    if (this.config.enableStatusCache) {
      const status = this.bridgeStatus.get(bridgeId);
      
      if (status && Date.now() - status.lastCheck < this.config.statusCacheTtlMs) {
        return status.isHealthy;
      }
    }
    
    // Perform health check
    try {
      const isHealthy = await this.performHealthCheck(bridge);
      
      // Update status
      this.bridgeStatus.set(bridgeId, {
        isHealthy,
        lastCheck: Date.now()
      });
      
      return isHealthy;
    } catch (error) {
      logger.error(`Health check failed for bridge ${bridgeId}:`, error);
      
      // Update status with error
      this.bridgeStatus.set(bridgeId, {
        isHealthy: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      });
      
      return false;
    }
  }
  
  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(
      () => this.checkAllBridges(),
      this.config.healthCheckIntervalMs
    );
    
    logger.info('Bridge health checks started');
  }
  
  /**
   * Check health of all bridges
   */
  private async checkAllBridges(): Promise<void> {
    const bridges = Array.from(this.bridges.values());
    
    for (const bridge of bridges) {
      try {
        const isHealthy = await this.isBridgeHealthy(bridge.id);
        
        // Emit telemetry
        this.telemetryBus.emit('bridge_health_check', {
          bridgeId: bridge.id,
          bridgeName: bridge.name,
          isHealthy,
          timestamp: Date.now()
        });
      } catch (error) {
        logger.error(`Error checking bridge ${bridge.id}:`, error);
      }
    }
  }
  
  /**
   * Perform health check for a bridge
   */
  private async performHealthCheck(bridge: Bridge): Promise<boolean> {
    // This would be implemented with actual health check logic
    // For now, return true if the bridge is active
    return bridge.isActive;
  }
  
  /**
   * Update configuration
   */
  private updateConfig(config: Partial<BridgeRegistryConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (this.config.enableHealthChecks) {
      this.startHealthChecks();
    } else if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    logger.info('BridgeRegistry configuration updated');
  }
} 