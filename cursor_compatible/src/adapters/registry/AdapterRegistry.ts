import { 
  IChainAdapter, 
  createAdapter, 
  ChainAdapterStatus, 
  Asset,
  TradeOrder,
  TradeResult
} from '../index';
import { IAdapter, AdapterStatus } from '../IAdapter';
import { IAssetAdapter } from '../IAssetAdapter';

/**
 * Configuration for the adapter registry
 */
export interface AdapterRegistryConfig {
  /**
   * Default configuration to apply to all adapters
   */
  defaultAdapterConfig?: Record<string, any>;
  
  /**
   * Chain-specific configurations (overrides default config)
   */
  chainConfigs?: Record<number, Record<string, any>>;
  
  /**
   * Whether to auto-initialize adapters when registering them
   */
  autoInitialize?: boolean;
  
  /**
   * RPC timeout in milliseconds
   */
  rpcTimeout?: number;
  
  /**
   * Maximum retry attempts for RPC calls
   */
  maxRetries?: number;

  /**
   * Base delay for exponential backoff (milliseconds)
   */
  retryBaseDelayMs?: number;

  /**
   * Maximum backoff delay (milliseconds)
   */
  retryMaxDelayMs?: number;

  /**
   * Circuit breaker failure threshold
   */
  circuitBreakerThreshold?: number;

  /**
   * Circuit breaker reset timeout (milliseconds)
   */
  circuitBreakerResetTimeoutMs?: number;
  
  /**
   * Logger function (defaults to console.log)
   */
  logger?: (message: string, context?: any) => void;

  /**
   * Metrics collection enabled
   */
  metricsEnabled?: boolean;
}

/**
 * Registry status information
 */
export interface RegistryStatus {
  /**
   * Number of registered adapters
   */
  adapterCount: number;
  
  /**
   * Array of registered chain IDs
   */
  supportedChains: number[];
  
  /**
   * Status of each adapter, keyed by chain ID
   */
  adapters: Record<number, {
    status: ChainAdapterStatus | null;
    error?: string;
    circuitOpen?: boolean;
    failureCount?: number;
    lastFailureTime?: number;
  }>;
  
  /**
   * Whether all adapters are connected
   */
  allConnected: boolean;
  
  /**
   * Time of last status check
   */
  timestamp: number;

  /**
   * Health status
   */
  health: 'healthy' | 'degraded' | 'unhealthy';
}

/**
 * Circuit breaker state for an adapter
 */
interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  resetTimeoutId?: NodeJS.Timeout;
}

/**
 * Health check result for a single adapter
 */
export interface AdapterHealth {
  name: string;
  type: 'chain' | 'asset' | 'other';
  healthy: boolean;
  status: AdapterStatus;
  lastCheck: number;
  errorMessage?: string;
  chainId?: number;
  network?: string;
}

/**
 * System-wide health check result
 */
export interface SystemHealth {
  healthy: boolean;
  timestamp: number;
  adapters: AdapterHealth[];
  errorCount: number;
  chainAdapters: Record<string, boolean>;
  assetAdapters: Record<string, boolean>;
  crossChainRouter: {
    healthy: boolean;
    activeFallbacks: number;
  };
}

/**
 * AdapterRegistry - Central registry for all adapters in the system
 * 
 * This class provides a unified way to access and monitor all adapters,
 * and offers a health check endpoint for system monitoring.
 */
export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private chainAdapters: Map<number, IChainAdapter> = new Map();
  private assetAdapters: Map<string, IAssetAdapter> = new Map();
  private otherAdapters: Map<string, IAdapter> = new Map();
  private healthHistory: SystemHealth[] = [];
  
  // Constructor (making it public for testing purposes)
  constructor() {}
  
  /**
   * Get singleton instance
   */
  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }
  
  /**
   * Register a chain adapter
   * @param chainId Chain ID
   * @param adapter Adapter instance to register
   * @returns True if registration was successful
   */
  public registerChainAdapter(chainId: number, adapter: IChainAdapter): boolean {
    if (this.chainAdapters.has(chainId)) {
      this.log(`Adapter for chain ${chainId} already registered, replacing`);
    }
    
    this.chainAdapters.set(chainId, adapter);
    
    // Initialize circuit breaker
    this.circuitBreakers.set(chainId, {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: 0
    });

    // Initialize metrics
    if (this.config.metricsEnabled) {
      this.adapterMetrics.set(chainId, {
        latencies: [],
        successCount: 0,
        failureCount: 0,
        lastCallTime: 0
      });
    }
    
    this.log(`Registered adapter for chain ${chainId}`);
    
    // Initialize if auto-initialize is enabled
    if (this.config.autoInitialize && this.initialized) {
      this.initializeAdapter(chainId)
        .catch(error => {
          this.log(`Failed to initialize adapter for chain ${chainId}:`, error);
        });
    }
    
    return true;
  }
  
  /**
   * Register an adapter for a chain ID using the factory function
   * @param chainId Chain ID to register
   * @returns True if registration was successful
   */
  public registerChain(chainId: number): boolean {
    try {
      // Get chain-specific config and merge with default
      const chainConfig = {
        ...this.config.defaultAdapterConfig,
        ...this.config.chainConfigs?.[chainId] || {},
        rpcTimeout: this.config.rpcTimeout,
        maxRetries: this.config.maxRetries
      };
      
      const adapter = createAdapter(chainId, chainConfig);
      return this.registerChainAdapter(chainId, adapter);
    } catch (error) {
      this.log(`Failed to create adapter for chain ${chainId}:`, error);
      return false;
    }
  }
  
  /**
   * Initialize all registered adapters
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      this.log('Adapter registry already initialized');
      return;
    }
    
    if (this.chainAdapters.size === 0) {
      this.log('No adapters registered');
      this.initialized = true;
      return;
    }
    
    this.log(`Initializing ${this.chainAdapters.size} adapters`);
    
    const initPromises: Promise<void>[] = [];
    
    for (const [chainId] of this.chainAdapters.entries()) {
      initPromises.push(this.initializeAdapter(chainId));
    }
    
    await Promise.allSettled(initPromises);
    this.initialized = true;
    
    this.log('Adapter registry initialization complete');
  }
  
  /**
   * Initialize a specific adapter
   * @param chainId Chain ID of the adapter to initialize
   */
  private async initializeAdapter(chainId: number): Promise<void> {
    const adapter = this.chainAdapters.get(chainId);
    if (!adapter) {
      throw new Error(`No adapter registered for chain ${chainId}`);
    }
    
    try {
      // Get chain-specific config
      const chainConfig = {
        ...this.config.defaultAdapterConfig,
        ...this.config.chainConfigs?.[chainId] || {}
      };
      
      this.log(`Initializing adapter for chain ${chainId}`);
      await adapter.initialize(chainConfig);
      
      // Only connect if initialization was successful
      try {
        this.log(`Connecting to chain ${chainId}`);
        await adapter.connect();
      } catch (error) {
        this.log(`Failed to connect to chain ${chainId}:`, error);
        // Record failure but don't rethrow
        this.recordFailure(chainId, error);
      }
    } catch (error) {
      this.log(`Failed to initialize adapter for chain ${chainId}:`, error);
      this.recordFailure(chainId, error);
      throw error;
    }
  }
  
  /**
   * Shut down the registry and all adapters
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      this.log('Adapter registry not initialized');
      return;
    }
    
    this.log(`Shutting down ${this.chainAdapters.size} adapters`);
    
    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Clear all circuit breaker timeouts
    for (const [chainId, state] of this.circuitBreakers.entries()) {
      if (state.resetTimeoutId) {
        clearTimeout(state.resetTimeoutId);
      }
    }
    
    const shutdownPromises: Promise<void>[] = [];
    
    for (const [chainId, adapter] of this.chainAdapters.entries()) {
      shutdownPromises.push(
        adapter.shutdown().catch(error => {
          this.log(`Error shutting down adapter for chain ${chainId}:`, error);
        })
      );
    }
    
    await Promise.allSettled(shutdownPromises);
    
    this.chainAdapters.clear();
    this.circuitBreakers.clear();
    this.adapterMetrics.clear();
    this.initialized = false;
    
    this.log('Adapter registry shutdown complete');
  }
  
  /**
   * Get adapter for a chain
   * @param chainId Chain ID
   * @returns Adapter instance or undefined if not found
   */
  public getChainAdapter(chainId: number): IChainAdapter | undefined {
    return this.chainAdapters.get(chainId);
  }
  
  /**
   * Check if a chain is supported
   * @param chainId Chain ID
   * @returns True if the chain is supported
   */
  public supportsChain(chainId: number): boolean {
    return this.chainAdapters.has(chainId);
  }
  
  /**
   * Get array of supported chain IDs
   * @returns Array of chain IDs
   */
  public getSupportedChains(): number[] {
    return Array.from(this.chainAdapters.keys());
  }
  
  /**
   * Get registry status
   * @returns Registry status
   */
  public async getStatus(): Promise<RegistryStatus> {
    const status: RegistryStatus = {
      adapterCount: this.chainAdapters.size,
      supportedChains: this.getSupportedChains(),
      adapters: {},
      allConnected: true,
      timestamp: Date.now(),
      health: 'healthy'
    };
    
    let connectedCount = 0;
    let unhealthyCount = 0;
    
    for (const [chainId, adapter] of this.chainAdapters.entries()) {
      try {
        const adapterStatus = await adapter.getStatus();
        status.adapters[chainId] = { status: adapterStatus };
        
        if (adapterStatus.isConnected) {
          connectedCount++;
        } else {
          status.allConnected = false;
        }
        
        // Add circuit breaker state
        const circuitState = this.circuitBreakers.get(chainId);
        if (circuitState) {
          status.adapters[chainId].circuitOpen = circuitState.isOpen;
          status.adapters[chainId].failureCount = circuitState.failureCount;
          status.adapters[chainId].lastFailureTime = circuitState.lastFailureTime;
          
          if (circuitState.isOpen) {
            unhealthyCount++;
          }
        }
        
      } catch (error) {
        status.adapters[chainId] = {
          status: null,
          error: error instanceof Error ? error.message : String(error)
        };
        status.allConnected = false;
        unhealthyCount++;
      }
    }
    
    // Set overall health status
    if (unhealthyCount === this.chainAdapters.size) {
      status.health = 'unhealthy';
    } else if (unhealthyCount > 0) {
      status.health = 'degraded';
    }
    
    return status;
  }
  
  /**
   * Get quote for trading assets
   * @param fromAsset Source asset
   * @param toAsset Target asset
   * @param amount Amount to trade
   * @returns Quote information
   */
  public async getQuote(
    fromAsset: Asset, 
    toAsset: Asset, 
    amount: string
  ): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
    crossChain: boolean;
  }> {
    // Ensure assets have chain IDs
    if (!fromAsset.chainId) {
      throw new Error('fromAsset must have a chainId');
    }
    
    if (!toAsset.chainId) {
      throw new Error('toAsset must have a chainId');
    }
    
    // Check if cross-chain trade
    const isCrossChain = fromAsset.chainId !== toAsset.chainId;
    
    // For cross-chain trades, we need to estimate bridging costs
    if (isCrossChain) {
      return this.getCrossChainQuote(fromAsset, toAsset, amount);
    }
    
    // Same-chain trade - use appropriate adapter
    const chainId = fromAsset.chainId;
    
    // Execute with retry and circuit breaker
    return this.executeWithProtection(chainId, 'getQuote', async (adapter) => {
      const quote = await adapter.getQuote(fromAsset, toAsset, amount);
      return {
        ...quote,
        crossChain: false
      };
    });
  }

  /**
   * Get quote for cross-chain trading
   * @param fromAsset Source asset
   * @param toAsset Target asset
   * @param amount Amount to trade
   * @returns Quote information
   */
  private async getCrossChainQuote(
    fromAsset: Asset,
    toAsset: Asset,
    amount: string
  ): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
    crossChain: boolean;
  }> {
    // This is a simplified implementation - in a real system, you would:
    // 1. Find optimal bridging path
    // 2. Get quotes for each leg of the journey
    // 3. Calculate combined gas costs and bridge fees
    
    this.log(`Cross-chain quote requested from ${fromAsset.chainId} to ${toAsset.chainId}`);
    
    // Get quote from source chain in native asset of target chain
    // For now, we'll use a simplified placeholder response
    return {
      expectedOutput: '0',
      priceImpact: 2.5, // Higher due to cross-chain nature
      route: [
        `${fromAsset.symbol} on Chain ${fromAsset.chainId}`,
        `Bridge to Chain ${toAsset.chainId}`,
        `${toAsset.symbol} on Chain ${toAsset.chainId}`
      ],
      crossChain: true
    };
  }
  
  /**
   * Execute a trade
   * @param order Trade order
   * @returns Trade result
   */
  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    // Ensure chainId exists
    if (!order.fromAsset.chainId) {
      throw new Error('order.fromAsset must have a chainId');
    }
    
    const chainId = order.fromAsset.chainId;
    
    // Execute with retry and circuit breaker
    return this.executeWithProtection(chainId, 'executeTrade', async (adapter) => {
      return adapter.executeTrade(order);
    });
  }
  
  /**
   * Get balance for address
   * @param chainId Chain ID
   * @param address Wallet address
   * @param asset Optional asset (default: native token)
   * @returns Balance as string
   */
  public async getBalance(chainId: number, address: string, asset?: Asset): Promise<string> {
    // Execute with retry and circuit breaker
    return this.executeWithProtection(chainId, 'getBalance', async (adapter) => {
      return adapter.getBalance(address, asset);
    });
  }
  
  /**
   * Get transaction status
   * @param chainId Chain ID
   * @param txHash Transaction hash
   * @returns Transaction status
   */
  public async getTransactionStatus(
    chainId: number, 
    txHash: string
  ): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    receipt?: any;
  }> {
    // Execute with retry and circuit breaker
    return this.executeWithProtection(chainId, 'getTransactionStatus', async (adapter) => {
      return adapter.getTransactionStatus(txHash);
    });
  }

  /**
   * Execute an adapter method with retry and circuit breaker protection
   * @param chainId Chain ID
   * @param operation Operation name (for logging)
   * @param fn Function to execute
   * @returns Result of the function
   */
  private async executeWithProtection<T>(
    chainId: number, 
    operation: string, 
    fn: (adapter: IChainAdapter) => Promise<T>
  ): Promise<T> {
    const adapter = this.chainAdapters.get(chainId);
    if (!adapter) {
      throw new Error(`No adapter registered for chain ${chainId}`);
    }
    
    // Check circuit breaker
    const circuitState = this.circuitBreakers.get(chainId);
    if (circuitState?.isOpen) {
      throw new Error(`Circuit breaker open for chain ${chainId}`);
    }
    
    // Start tracking time for metrics
    const startTime = Date.now();
    let attempt = 0;
    
    while (attempt < this.config.maxRetries!) {
      try {
        attempt++;
        const result = await fn(adapter);
        
        // Record success and latency
        this.recordSuccess(chainId, Date.now() - startTime);
        
        return result;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        
        // Log the error
        this.log(`Error in ${operation} for chain ${chainId} (attempt ${attempt}):`, error);
        
        // Last attempt - record failure and rethrow
        if (attempt >= this.config.maxRetries!) {
          this.recordFailure(chainId, error);
          throw error;
        }
        
        // Calculate backoff delay using exponential backoff
        const delay = Math.min(
          this.config.retryBaseDelayMs! * Math.pow(2, attempt - 1),
          this.config.retryMaxDelayMs!
        );
        
        this.log(`Retrying ${operation} for chain ${chainId} in ${delay}ms (attempt ${attempt}/${this.config.maxRetries})`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Should never reach here due to throw in last attempt, but TypeScript needs this
    throw new Error(`All ${this.config.maxRetries} attempts failed for operation ${operation} on chain ${chainId}`);
  }

  /**
   * Record a successful operation for metrics
   * @param chainId Chain ID
   * @param latencyMs Latency in milliseconds
   */
  private recordSuccess(chainId: number, latencyMs: number): void {
    // Reset circuit breaker failure count
    const circuitState = this.circuitBreakers.get(chainId);
    if (circuitState) {
      circuitState.failureCount = 0;
    }
    
    // Record metric
    if (this.config.metricsEnabled) {
      const metrics = this.adapterMetrics.get(chainId);
      if (metrics) {
        metrics.latencies.push(latencyMs);
        // Keep only the last 100 latency measurements
        if (metrics.latencies.length > 100) {
          metrics.latencies.shift();
        }
        metrics.successCount++;
        metrics.lastCallTime = Date.now();
      }
    }
  }

  /**
   * Record a failed operation and update circuit breaker
   * @param chainId Chain ID
   * @param error Error that occurred
   */
  private recordFailure(chainId: number, error: any): void {
    const circuitState = this.circuitBreakers.get(chainId);
    if (!circuitState) return;
    
    // Update circuit breaker state
    circuitState.failureCount++;
    circuitState.lastFailureTime = Date.now();
    
    // Record metric
    if (this.config.metricsEnabled) {
      const metrics = this.adapterMetrics.get(chainId);
      if (metrics) {
        metrics.failureCount++;
        metrics.lastCallTime = Date.now();
      }
    }
    
    // Check if we need to open the circuit
    if (circuitState.failureCount >= this.config.circuitBreakerThreshold!) {
      this.openCircuit(chainId);
    }
  }

  /**
   * Open circuit breaker for a chain
   * @param chainId Chain ID
   */
  private openCircuit(chainId: number): void {
    const circuitState = this.circuitBreakers.get(chainId);
    if (!circuitState || circuitState.isOpen) return;
    
    this.log(`Opening circuit breaker for chain ${chainId}`);
    
    // Set circuit to open
    circuitState.isOpen = true;
    
    // Schedule reset
    circuitState.resetTimeoutId = setTimeout(() => {
      this.resetCircuit(chainId);
    }, this.config.circuitBreakerResetTimeoutMs);
  }

  /**
   * Reset circuit breaker for a chain
   * @param chainId Chain ID
   */
  private resetCircuit(chainId: number): void {
    const circuitState = this.circuitBreakers.get(chainId);
    if (!circuitState) return;
    
    this.log(`Resetting circuit breaker for chain ${chainId}`);
    
    // Reset state
    circuitState.isOpen = false;
    circuitState.failureCount = 0;
    circuitState.resetTimeoutId = undefined;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    // Run health check every minute
    this.healthCheckInterval = setInterval(() => {
      this.runHealthCheck().catch(error => {
        this.log('Health check error:', error);
      });
    }, 60000);
  }

  /**
   * Run a health check on all adapters
   */
  private async runHealthCheck(): Promise<void> {
    if (!this.initialized) return;
    
    this.log('Running health check on all adapters');
    
    for (const [chainId, adapter] of this.chainAdapters.entries()) {
      try {
        const status = await adapter.getStatus();
        
        // If adapter is not connected, try to reconnect
        if (!status.isConnected) {
          this.log(`Adapter ${chainId} is disconnected, attempting to reconnect`);
          
          try {
            await adapter.connect();
            this.log(`Successfully reconnected to chain ${chainId}`);
          } catch (error) {
            this.log(`Failed to reconnect to chain ${chainId}:`, error);
          }
        }
      } catch (error) {
        this.log(`Health check failed for chain ${chainId}:`, error);
      }
    }
  }

  /**
   * Get performance metrics for all adapters
   */
  public getMetrics(): Record<number, {
    averageLatencyMs: number;
    successRate: number;
    callVolume: number;
    circuitBreakerStatus: 'open' | 'closed';
  }> {
    const result: Record<number, any> = {};
    
    for (const [chainId, metrics] of this.adapterMetrics.entries()) {
      const circuitState = this.circuitBreakers.get(chainId);
      const totalCalls = metrics.successCount + metrics.failureCount;
      
      result[chainId] = {
        averageLatencyMs: metrics.latencies.length > 0 
          ? metrics.latencies.reduce((sum, val) => sum + val, 0) / metrics.latencies.length 
          : 0,
        successRate: totalCalls > 0 
          ? (metrics.successCount / totalCalls) * 100 
          : 100,
        callVolume: totalCalls,
        circuitBreakerStatus: circuitState?.isOpen ? 'open' : 'closed'
      };
    }
    
    return result;
  }
  
  /**
   * Log message with optional context
   * @param message Message to log
   * @param context Optional context
   */
  private log(message: string, context?: any): void {
    if (this.config.logger) {
      this.config.logger(`[AdapterRegistry] ${message}`, context);
    }
  }

  /**
   * Register an asset adapter
   */
  public registerAssetAdapter(name: string, adapter: IAssetAdapter): void {
    this.assetAdapters.set(name, adapter);
  }
  
  /**
   * Register another type of adapter
   */
  public registerAdapter(name: string, adapter: IAdapter): void {
    this.otherAdapters.set(name, adapter);
  }
  
  /**
   * Get an asset adapter by name
   */
  public getAssetAdapter(name: string): IAssetAdapter | undefined {
    return this.assetAdapters.get(name);
  }
  
  /**
   * Get another type of adapter by name
   */
  public getAdapter(name: string): IAdapter | undefined {
    return this.otherAdapters.get(name);
  }
  
  /**
   * Get all registered chain adapters
   */
  public getAllChainAdapters(): Map<number, IChainAdapter> {
    return this.chainAdapters;
  }
  
  /**
   * Get all registered asset adapters
   */
  public getAllAssetAdapters(): Map<string, IAssetAdapter> {
    return this.assetAdapters;
  }
  
  /**
   * Perform a health check on all registered adapters
   */
  public async checkHealth(): Promise<SystemHealth> {
    const adapterResults: AdapterHealth[] = [];
    let errorCount = 0;
    const chainAdapterHealth: Record<string, boolean> = {};
    const assetAdapterHealth: Record<string, boolean> = {};
    
    // Check chain adapters
    for (const [chainId, adapter] of this.chainAdapters.entries()) {
      try {
        const status = await adapter.getStatus();
        const health: AdapterHealth = {
          name: adapter.getName(),
          type: 'chain',
          healthy: status.isConnected && (!status.errors || status.errors.length === 0),
          status,
          lastCheck: Date.now(),
          chainId: chainId,
          network: Network[chainId] || 'unknown'
        };
        
        if (!health.healthy) {
          health.errorMessage = status.errors?.join(', ');
          errorCount++;
        }
        
        adapterResults.push(health);
        chainAdapterHealth[chainId.toString()] = health.healthy;
      } catch (error) {
        adapterResults.push({
          name: adapter.getName(),
          type: 'chain',
          healthy: false,
          status: {
            isConnected: false,
            name: adapter.getName(),
            version: adapter.getVersion(),
            errors: [error instanceof Error ? error.message : String(error)]
          },
          lastCheck: Date.now(),
          chainId: chainId,
          network: Network[chainId] || 'unknown',
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        
        chainAdapterHealth[chainId.toString()] = false;
        errorCount++;
      }
    }
    
    // Check asset adapters
    for (const [name, adapter] of this.assetAdapters.entries()) {
      try {
        const status = await adapter.getStatus();
        const health: AdapterHealth = {
          name: adapter.getName(),
          type: 'asset',
          healthy: (!status.errors || status.errors.length === 0),
          status,
          lastCheck: Date.now()
        };
        
        if (!health.healthy) {
          health.errorMessage = status.errors?.join(', ');
          errorCount++;
        }
        
        adapterResults.push(health);
        assetAdapterHealth[name] = health.healthy;
      } catch (error) {
        adapterResults.push({
          name: adapter.getName(),
          type: 'asset',
          healthy: false,
          status: {
            isConnected: false,
            name: adapter.getName(),
            version: adapter.getVersion(),
            errors: [error instanceof Error ? error.message : String(error)]
          },
          lastCheck: Date.now(),
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        
        assetAdapterHealth[name] = false;
        errorCount++;
      }
    }
    
    // Check other adapters
    for (const [name, adapter] of this.otherAdapters.entries()) {
      try {
        const status = await adapter.getStatus();
        const health: AdapterHealth = {
          name: adapter.getName(),
          type: 'other',
          healthy: (!status.errors || status.errors.length === 0),
          status,
          lastCheck: Date.now()
        };
        
        if (!health.healthy) {
          health.errorMessage = status.errors?.join(', ');
          errorCount++;
        }
        
        adapterResults.push(health);
      } catch (error) {
        adapterResults.push({
          name: adapter.getName(),
          type: 'other',
          healthy: false,
          status: {
            isConnected: false,
            name: adapter.getName(),
            version: adapter.getVersion(),
            errors: [error instanceof Error ? error.message : String(error)]
          },
          lastCheck: Date.now(),
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        
        errorCount++;
      }
    }
    
    // Determine if the overall system is healthy
    const systemHealthy = errorCount === 0;
    
    // Determine cross-chain router health (simple check for now)
    const crossChainRouterHealthy = this.checkCrossChainRouterHealth();
    
    // Create system health result
    const result: SystemHealth = {
      healthy: systemHealthy,
      timestamp: Date.now(),
      adapters: adapterResults,
      errorCount,
      chainAdapters: chainAdapterHealth,
      assetAdapters: assetAdapterHealth,
      crossChainRouter: {
        healthy: crossChainRouterHealthy.healthy,
        activeFallbacks: crossChainRouterHealthy.activeFallbacks
      }
    };
    
    // Store health history (keep last 10 results)
    this.healthHistory.push(result);
    if (this.healthHistory.length > 10) {
      this.healthHistory.shift();
    }
    
    return result;
  }
  
  /**
   * Get the health history
   */
  public getHealthHistory(): SystemHealth[] {
    return this.healthHistory;
  }
  
  /**
   * Check if the cross-chain router is healthy
   */
  private checkCrossChainRouterHealth(): { healthy: boolean, activeFallbacks: number } {
    // This would be replaced with actual checks against the CrossChainExecutionRouter
    // For now, we just check if we have at least one healthy chain adapter
    let healthyAdapters = 0;
    let activeFallbacks = 0;
    
    for (const [_, adapter] of this.chainAdapters.entries()) {
      const lastStatus = adapter.getStatus();
      if (lastStatus instanceof Promise) {
        // Skip async checks here for simplicity
        continue;
      }
      
      if (lastStatus.isConnected && (!lastStatus.errors || lastStatus.errors.length === 0)) {
        healthyAdapters++;
      }
      
      // In a real implementation, we would check for active fallbacks in the router
    }
    
    return {
      healthy: healthyAdapters > 0,
      activeFallbacks
    };
  }
  
  /**
   * Create a status endpoint handler
   * 
   * This method returns a handler that can be used with Express or similar web frameworks.
   */
  public createStatusEndpoint(): (req: any, res: any) => Promise<void> {
    return async (req: any, res: any) => {
      try {
        const health = await this.checkHealth();
        
        // Set appropriate HTTP status code based on health
        const statusCode = health.healthy ? 200 : 503; // Service Unavailable if unhealthy
        
        res.status(statusCode).json(health);
      } catch (error) {
        res.status(500).json({
          healthy: false,
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };
  }
} 