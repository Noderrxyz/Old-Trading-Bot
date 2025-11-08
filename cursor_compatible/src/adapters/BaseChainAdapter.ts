/**
 * BaseChainAdapter - Abstract base class for blockchain adapters
 * 
 * This class implements common functionality for all blockchain adapters,
 * reducing duplication and ensuring consistent behavior across different
 * blockchain implementations.
 */

import { 
  IChainAdapter, 
  ChainAdapterStatus, 
  Asset, 
  AssetInfo, 
  MevProtectionConfig,
  TransactionRequest,
  TransactionResponse,
  TradeOrder,
  TradeResult,
  GasEstimate,
  TransactionReceipt,
  TradeRequest,
  TradeOptions,
  NetworkStatus
} from './IChainAdapter';
import { AdapterCapability, AdapterStatus, IAdapter } from './IAdapter';

// [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: RPC Provider optimization interfaces
interface RPCProvider {
  url: string;
  name: string;
  region?: string;
  apiKey?: string;
  weight: number; // For weighted round-robin (higher = more preferred)
  priority: number; // 1-10, 1 = highest priority
}

interface RPCHealthMetrics {
  latency: number; // Average latency in ms
  errorRate: number; // Error rate (0-1)
  successRate: number; // Success rate (0-1)
  lastSuccessTime: number; // Timestamp of last successful request
  consecutiveFailures: number; // Number of consecutive failures
  totalRequests: number; // Total requests made
  totalErrors: number; // Total errors encountered
  circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  circuitBreakerOpenTime?: number; // When circuit was opened
}

interface RPCRequest {
  method: string;
  params: any[];
  timeout: number;
  retryCount?: number;
  startTime: number;
  id: string;
}

interface RPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  latency: number;
  provider: string;
  retryCount: number;
}

/**
 * Chain adapter configuration options
 */
export interface ChainAdapterConfig {
  chainId: number;
  networkName: string;
  rpcUrl: string;
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Enhanced RPC configuration
  rpcProviders?: RPCProvider[]; // Multiple RPC providers for failover
  rpcFailoverEnabled?: boolean; // Enable automatic failover
  rpcHealthCheckInterval?: number; // Health check interval in ms
  rpcCircuitBreakerThreshold?: number; // Failure threshold to open circuit
  rpcCircuitBreakerTimeout?: number; // How long to keep circuit open
  rpcConcurrentRacing?: boolean; // Race multiple providers for critical requests
  rpcPrewarmConnections?: boolean; // Pre-warm backup connections
  rpcLatencyThreshold?: number; // Latency threshold for provider selection (ms)
  isMainnet: boolean;
  blockExplorerUrl?: string;
  gasMultiplier?: number; // Multiplier for gas price (default: 1.1)
  maxRetries?: number; // Maximum number of retries for failed requests
  timeout?: number; // Timeout in milliseconds for requests
  apiKey?: string; // API key if required
  proxyUrl?: string; // Proxy URL if required
  websocketUrl?: string; // Websocket URL for real-time updates
  defaultGasLimit?: string; // Default gas limit for transactions
  confirmations?: number; // Required confirmations to consider a tx confirmed
  mevProtection?: MevProtectionConfig; // MEV protection configuration
  telemetryEnabled?: boolean; // Whether to enable telemetry for this adapter
  cacheTimeout?: number; // How long to cache results (ms)
  concurrencyLimit?: number; // Maximum number of concurrent requests
}

/**
 * Abstract base class for blockchain adapters
 * Implements common functionality and enforces interface contracts
 */
export abstract class BaseChainAdapter implements IChainAdapter {
  protected config: ChainAdapterConfig;
  protected _isInitialized: boolean = false;
  protected _isConnected: boolean = false;
  protected _version: string = '1.0.0';
  protected _name: string = 'BaseChainAdapter';
  protected _lastError?: Error;
  protected _startTime: number;
  protected _lastBlockHeight?: number;
  protected _capabilities: Set<string> = new Set();
  protected _mevProtectionEnabled: boolean = false;
  protected provider: any; // Blockchain provider (e.g., ethers.providers.Provider)
  protected wallet: any; // Wallet instance (e.g., ethers.Wallet)
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: RPC optimization state
  protected rpcProviders: RPCProvider[] = [];
  protected rpcHealthMetrics: Map<string, RPCHealthMetrics> = new Map();
  protected currentProviderIndex: number = 0;
  protected rpcHealthCheckTimer?: NodeJS.Timeout;
  protected prewarmedConnections: Map<string, any> = new Map();
  protected rpcRequestQueue: RPCRequest[] = [];
  protected rpcConcurrentLimit: number = 5;
  protected rpcLatencyHistory: Map<string, number[]> = new Map(); // Last 10 latencies per provider
  
  /**
   * Base constructor for chain adapters
   */
  constructor(config?: Partial<ChainAdapterConfig>) {
    this._startTime = Date.now();
    
    // Initialize with default configuration
    this.config = {
      chainId: 1, // Default to Ethereum Mainnet
      networkName: 'Unknown Network',
      rpcUrl: '',
      // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: RPC optimization defaults
      rpcFailoverEnabled: true,
      rpcHealthCheckInterval: 30000, // 30 seconds
      rpcCircuitBreakerThreshold: 3, // 3 consecutive failures
      rpcCircuitBreakerTimeout: 60000, // 60 seconds
      rpcConcurrentRacing: true,
      rpcPrewarmConnections: true,
      rpcLatencyThreshold: 500, // 500ms threshold
      isMainnet: true,
      gasMultiplier: 1.1,
      maxRetries: 3,
      timeout: 30000, // 30 seconds
      confirmations: 1,
      cacheTimeout: 60000, // 1 minute
      concurrencyLimit: 5,
      ...config
    };
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Initialize RPC providers
    this.initializeRPCProviders();
    
    // Add base capabilities
    this._capabilities.add(AdapterCapability.CORE);
  }
  
  // IChainAdapter interface implementation - required properties
  get name(): string {
    return this._name;
  }
  
  get chainId(): string {
    return this.config.chainId.toString();
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Initialize RPC providers with fallback logic
  protected initializeRPCProviders(): void {
    // Use provided RPC providers or create default from rpcUrl
    if (this.config.rpcProviders && this.config.rpcProviders.length > 0) {
      this.rpcProviders = [...this.config.rpcProviders];
    } else if (this.config.rpcUrl) {
      // Create default provider from single URL
      this.rpcProviders = [{
        url: this.config.rpcUrl,
        name: 'default',
        weight: 100,
        priority: 1
      }];
    }
    
    // Initialize health metrics for each provider
    for (const provider of this.rpcProviders) {
      this.rpcHealthMetrics.set(provider.url, {
        latency: 0,
        errorRate: 0,
        successRate: 1,
        lastSuccessTime: Date.now(),
        consecutiveFailures: 0,
        totalRequests: 0,
        totalErrors: 0,
        circuitBreakerState: 'CLOSED'
      });
      
      // Initialize latency history
      this.rpcLatencyHistory.set(provider.url, []);
    }
    
    // Sort providers by priority (highest first)
    this.rpcProviders.sort((a, b) => a.priority - b.priority);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Weighted round-robin provider selection
  protected selectOptimalRPCProvider(): RPCProvider | null {
    const availableProviders = this.rpcProviders.filter(provider => {
      const metrics = this.rpcHealthMetrics.get(provider.url);
      return metrics && 
             metrics.circuitBreakerState !== 'OPEN' &&
             metrics.successRate > 0.5; // At least 50% success rate
    });
    
    if (availableProviders.length === 0) {
      // All providers are down, try to use least bad one
      return this.selectFallbackProvider();
    }
    
    // Calculate weighted scores based on latency, success rate, and priority
    const scoredProviders = availableProviders.map(provider => {
      const metrics = this.rpcHealthMetrics.get(provider.url)!;
      const latencyScore = Math.max(0, 1 - (metrics.latency / 1000)); // Normalize to 0-1
      const reliabilityScore = metrics.successRate;
      const priorityScore = (11 - provider.priority) / 10; // Higher priority = higher score
      
      const totalScore = (latencyScore * 0.4) + (reliabilityScore * 0.4) + (priorityScore * 0.2);
      
      return { provider, score: totalScore };
    });
    
    // Sort by score (highest first)
    scoredProviders.sort((a, b) => b.score - a.score);
    
    // Weighted random selection from top 3 providers
    const topProviders = scoredProviders.slice(0, 3);
    const totalWeight = topProviders.reduce((sum, item) => sum + item.provider.weight, 0);
    
    if (totalWeight === 0) {
      return topProviders[0]?.provider || null;
    }
    
    const random = Math.random() * totalWeight;
    let cumulativeWeight = 0;
    
    for (const item of topProviders) {
      cumulativeWeight += item.provider.weight;
      if (random <= cumulativeWeight) {
        return item.provider;
      }
    }
    
    return topProviders[0]?.provider || null;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Fallback provider selection when all are failing
  protected selectFallbackProvider(): RPCProvider | null {
    if (this.rpcProviders.length === 0) return null;
    
    // Find provider with oldest failure time (most likely to have recovered)
    let bestProvider = this.rpcProviders[0];
    let oldestFailureTime = Infinity;
    
    for (const provider of this.rpcProviders) {
      const metrics = this.rpcHealthMetrics.get(provider.url);
      if (metrics && metrics.circuitBreakerState === 'OPEN' && metrics.circuitBreakerOpenTime) {
        if (metrics.circuitBreakerOpenTime < oldestFailureTime) {
          oldestFailureTime = metrics.circuitBreakerOpenTime;
          bestProvider = provider;
        }
      }
    }
    
    return bestProvider;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Concurrent RPC racing for critical requests
  protected async raceRPCProviders<T>(
    method: string,
    params: any[],
    isCritical: boolean = false
  ): Promise<RPCResponse<T>> {
    const providers = isCritical && this.config.rpcConcurrentRacing
      ? this.getTopRPCProviders(3) // Race top 3 providers for critical requests
      : [this.selectOptimalRPCProvider()].filter(Boolean) as RPCProvider[];
    
    if (providers.length === 0) {
      throw new Error('No available RPC providers');
    }
    
    const requestPromises = providers.map(provider => 
      this.makeRPCRequest<T>(provider, method, params)
    );
    
    try {
      // Race the requests and return the first successful one
      const result = await Promise.race(requestPromises);
      
      // Cancel other requests (if possible)
      // In a real implementation, you'd want to abort the other requests
      
      return result;
    } catch (error) {
      // If racing fails, try sequential fallback
      return this.sequentialRPCFallback<T>(method, params);
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Get top performing RPC providers
  protected getTopRPCProviders(count: number): RPCProvider[] {
    return this.rpcProviders
      .filter(provider => {
        const metrics = this.rpcHealthMetrics.get(provider.url);
        return metrics && metrics.circuitBreakerState !== 'OPEN';
      })
      .slice(0, count);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Sequential RPC fallback
  protected async sequentialRPCFallback<T>(
    method: string,
    params: any[]
  ): Promise<RPCResponse<T>> {
    let lastError: Error | null = null;
    
    for (const provider of this.rpcProviders) {
      const metrics = this.rpcHealthMetrics.get(provider.url);
      if (metrics && metrics.circuitBreakerState === 'OPEN') {
        continue; // Skip providers with open circuit breakers
      }
      
      try {
        const result = await this.makeRPCRequest<T>(provider, method, params);
        if (result.success) {
          return result;
        }
      } catch (error) {
        lastError = error as Error;
        continue;
      }
    }
    
    throw lastError || new Error('All RPC providers failed');
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Make individual RPC request with metrics tracking
  protected async makeRPCRequest<T>(
    provider: RPCProvider,
    method: string,
    params: any[],
    timeout?: number
  ): Promise<RPCResponse<T>> {
    const requestId = `${method}-${Date.now()}-${Math.random()}`;
    const startTime = Date.now();
    const requestTimeout = timeout || this.config.timeout || 30000;
    
    const metrics = this.rpcHealthMetrics.get(provider.url)!;
    metrics.totalRequests++;
    
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('RPC request timeout')), requestTimeout);
      });
      
      // Make actual RPC request (implementation-specific)
      const requestPromise = this.executeRPCRequest<T>(provider, method, params, requestId);
      
      // Race against timeout
      const data = await Promise.race([requestPromise, timeoutPromise]);
      
      const latency = Date.now() - startTime;
      
      // Update metrics for successful request
      this.updateRPCMetrics(provider.url, true, latency);
      
      return {
        success: true,
        data,
        latency,
        provider: provider.url,
        retryCount: 0
      };
      
    } catch (error) {
      const latency = Date.now() - startTime;
      
      // Update metrics for failed request
      this.updateRPCMetrics(provider.url, false, latency);
      
      return {
        success: false,
        error: (error as Error).message,
        latency,
        provider: provider.url,
        retryCount: 0
      };
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Abstract method for actual RPC execution (to be implemented by subclasses)
  protected abstract executeRPCRequest<T>(
    provider: RPCProvider,
    method: string,
    params: any[],
    requestId: string
  ): Promise<T>;
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Update RPC provider health metrics
  protected updateRPCMetrics(providerUrl: string, success: boolean, latency: number): void {
    const metrics = this.rpcHealthMetrics.get(providerUrl);
    if (!metrics) return;
    
    // Update latency history
    const latencyHistory = this.rpcLatencyHistory.get(providerUrl) || [];
    latencyHistory.push(latency);
    if (latencyHistory.length > 10) {
      latencyHistory.shift(); // Keep only last 10 measurements
    }
    this.rpcLatencyHistory.set(providerUrl, latencyHistory);
    
    // Calculate average latency
    metrics.latency = latencyHistory.reduce((sum, l) => sum + l, 0) / latencyHistory.length;
    
    if (success) {
      metrics.lastSuccessTime = Date.now();
      metrics.consecutiveFailures = 0;
      
      // Update success rate
      metrics.successRate = (metrics.totalRequests - metrics.totalErrors) / metrics.totalRequests;
      
      // Close circuit breaker if it was open
      if (metrics.circuitBreakerState === 'OPEN') {
        metrics.circuitBreakerState = 'HALF_OPEN';
      } else if (metrics.circuitBreakerState === 'HALF_OPEN') {
        metrics.circuitBreakerState = 'CLOSED';
      }
      
    } else {
      metrics.totalErrors++;
      metrics.consecutiveFailures++;
      metrics.errorRate = metrics.totalErrors / metrics.totalRequests;
      metrics.successRate = (metrics.totalRequests - metrics.totalErrors) / metrics.totalRequests;
      
      // Open circuit breaker if threshold reached
      if (metrics.consecutiveFailures >= (this.config.rpcCircuitBreakerThreshold || 3)) {
        metrics.circuitBreakerState = 'OPEN';
        metrics.circuitBreakerOpenTime = Date.now();
        
        // Schedule circuit breaker reset
        setTimeout(() => {
          metrics.circuitBreakerState = 'HALF_OPEN';
        }, this.config.rpcCircuitBreakerTimeout || 60000);
      }
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Background health check for all providers
  protected startRPCHealthChecks(): void {
    if (this.rpcHealthCheckTimer) {
      clearInterval(this.rpcHealthCheckTimer);
    }
    
    this.rpcHealthCheckTimer = setInterval(async () => {
      await this.performRPCHealthChecks();
    }, this.config.rpcHealthCheckInterval || 30000);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Perform health checks on all RPC providers
  protected async performRPCHealthChecks(): Promise<void> {
    const healthCheckPromises = this.rpcProviders.map(async provider => {
      try {
        // Simple health check - get latest block number
        const startTime = Date.now();
        await this.executeRPCRequest(provider, 'eth_blockNumber', [], 'health-check');
        const latency = Date.now() - startTime;
        
        this.updateRPCMetrics(provider.url, true, latency);
        
      } catch (error) {
        this.updateRPCMetrics(provider.url, false, 0);
      }
    });
    
    await Promise.allSettled(healthCheckPromises);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Pre-warm backup connections
  protected async prewarmConnections(): Promise<void> {
    if (!this.config.rpcPrewarmConnections) return;
    
    const prewarmPromises = this.rpcProviders.slice(1, 4).map(async provider => {
      try {
        // Pre-warm connection with a lightweight request
        const connection = await this.createPrewarmedConnection(provider);
        this.prewarmedConnections.set(provider.url, connection);
      } catch (error) {
        // Silently fail pre-warming - it's not critical
      }
    });
    
    await Promise.allSettled(prewarmPromises);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Create pre-warmed connection (implementation-specific)
  protected abstract createPrewarmedConnection(provider: RPCProvider): Promise<any>;
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Start congestion monitoring
  protected startCongestionMonitoring(): void {
    // Implementation for congestion monitoring
    // This would monitor network conditions and adjust provider selection
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Start bridge metrics collection
  protected startBridgeMetricsCollection(): void {
    // Implementation for bridge metrics collection
    // This would collect metrics on cross-chain bridge performance
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Get RPC health status for monitoring
  public getRPCHealthStatus(): Record<string, RPCHealthMetrics> {
    const status: Record<string, RPCHealthMetrics> = {};
    
    for (const [url, metrics] of this.rpcHealthMetrics) {
      status[url] = { ...metrics };
    }
    
    return status;
  }
  
  /**
   * Initialize the adapter with configuration
   */
  public async initialize(config?: Partial<ChainAdapterConfig>): Promise<void> {
    if (this._isInitialized) {
      return;
    }
    
    // Update configuration if provided
    if (config) {
      this.config = {
        ...this.config,
        ...config
      };
    }
    
    // Validate the configuration
    this.validateConfig();
    
    // Call the implementation-specific initialization
    await this.initializeImpl();
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_RPC]: Start RPC optimizations
    if (this.config.rpcFailoverEnabled) {
      this.startRPCHealthChecks();
      await this.prewarmConnections();
    }
    
    this._isInitialized = true;
  }
  
  /**
   * Implementation-specific initialization
   * Should be overridden by concrete adapters
   */
  protected abstract initializeImpl(): Promise<void>;
  
  /**
   * Validate the adapter configuration
   * @throws Error if configuration is invalid
   */
  protected validateConfig(): void {
    if (!this.config.chainId) {
      throw new Error(`${this._name}: chainId is required`);
    }
    
    if (!this.config.rpcUrl) {
      throw new Error(`${this._name}: rpcUrl is required`);
    }
    
    if (!this.config.networkName) {
      throw new Error(`${this._name}: networkName is required`);
    }
  }
  
  /**
   * Connect to the blockchain network
   */
  public async connect(): Promise<void> {
    if (!this._isInitialized) {
      throw new Error('Adapter not initialized');
    }
    
    if (this._isConnected) {
      return;
    }
    
    // Call the implementation-specific connection logic
    await this.connectImpl();
    
    this._isConnected = true;
  }
  
  /**
   * Implementation-specific connection logic
   * Should be overridden by concrete adapters
   */
  protected abstract connectImpl(): Promise<void>;
  
  /**
   * Disconnect from the blockchain network
   */
  public async disconnect(): Promise<void> {
    if (!this._isConnected) {
      return;
    }
    
    // Call the implementation-specific disconnection logic
    await this.disconnectImpl();
    
    this._isConnected = false;
  }
  
  /**
   * Implementation-specific disconnection logic
   * Should be overridden by concrete adapters
   */
  protected abstract disconnectImpl(): Promise<void>;
  
  /**
   * Shutdown the adapter and release resources
   */
  public async shutdown(): Promise<void> {
    // Disconnect if connected
    if (this._isConnected) {
      await this.disconnect();
    }
    
    // Call implementation-specific shutdown
    await this.shutdownImpl();
    
    this._isInitialized = false;
  }
  
  /**
   * Implementation-specific shutdown logic
   * Should be overridden by concrete adapters
   */
  protected abstract shutdownImpl(): Promise<void>;
  
  /**
   * Get the current status of the adapter
   */
  public async getStatus(): Promise<ChainAdapterStatus> {
    // Base status information
    const baseStatus: ChainAdapterStatus = {
      name: this._name,
      version: this._version,
      isConnected: this._isConnected,
      errors: this._lastError ? [this._lastError.message] : undefined,
      chainId: this.config.chainId,
      networkName: this.config.networkName,
      isMainnet: this.config.isMainnet
    };
    
    try {
      // Get implementation-specific status
      const implStatus = await this.getStatusImpl();
      
      // Merge base and implementation status
      return {
        ...baseStatus,
        ...implStatus
      };
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      
      // Return base status with error
      return {
        ...baseStatus,
        errors: [this._lastError.message]
      };
    }
  }
  
  /**
   * Implementation-specific status information
   * Should be overridden by concrete adapters
   */
  protected abstract getStatusImpl(): Promise<Partial<ChainAdapterStatus>>;
  
  /**
   * Get the balance of an address for a specific asset
   */
  public abstract getBalance(address: string, asset?: Asset): Promise<string>;
  
  /**
   * Execute a trade on the blockchain
   */
  public abstract executeTrade(order: TradeOrder): Promise<TradeResult>;
  
  /**
   * Get a quote for a potential trade
   */
  public abstract getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }>;
  
  /**
   * Get the transaction status
   */
  public abstract getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    receipt?: TransactionReceipt;
  }>;
  
  /**
   * Get detailed information about an asset
   */
  public async getAssetInfo(asset: Asset): Promise<AssetInfo> {
    // Basic implementation returns the asset with default values
    // Concrete adapters should override this with chain-specific logic
    return {
      ...asset,
      totalSupply: '0',
      verified: false,
      contractType: asset.isNative ? 'NATIVE' : 'ERC20'
    };
  }
  
  /**
   * Get current gas price estimate
   */
  public abstract getGasPrice(): Promise<GasEstimate>;
  
  /**
   * Estimate gas for a transaction
   */
  public abstract estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string>;
  
  /**
   * Configure MEV protection
   */
  public async configureMevProtection(config: MevProtectionConfig): Promise<void> {
    if (!config.enabled) {
      this._mevProtectionEnabled = false;
      return;
    }
    
    try {
      // Call implementation-specific configuration
      await this.configureMevProtectionImpl(config);
      
      this._mevProtectionEnabled = true;
      this.addCapability(AdapterCapability.MEV_PROTECTION);
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      throw this._lastError;
    }
  }
  
  /**
   * Implementation-specific MEV protection configuration
   */
  protected abstract configureMevProtectionImpl(config: MevProtectionConfig): Promise<void>;
  
  /**
   * Check if the blockchain network is healthy
   */
  public async checkHealth(): Promise<{
    healthy: boolean;
    latency: number;
    blockDelay: number;
    errors?: string[];
  }> {
    if (!this._isInitialized || !this._isConnected) {
      return {
        healthy: false,
        latency: 0,
        blockDelay: 0,
        errors: ['Adapter not initialized or connected']
      };
    }
    
    const errors: string[] = [];
    let latency = 0;
    let blockDelay = 0;
    
    try {
      // Measure latency
      const startTime = Date.now();
      const currentBlockHeight = await this.provider.getBlockNumber();
      latency = Date.now() - startTime;
      
      // Update last block height
      this._lastBlockHeight = currentBlockHeight;
      
      // Calculate block delay
      blockDelay = await this.calculateBlockDelay(currentBlockHeight);
      
      // Basic health determination
      // A healthy node should respond in under 1000ms and be at most 5 blocks behind
      const healthy = latency < 1000 && blockDelay < 5;
      
      if (latency >= 1000) {
        errors.push(`High latency: ${latency}ms`);
      }
      
      if (blockDelay >= 5) {
        errors.push(`Chain sync delayed by ${blockDelay} blocks`);
      }
      
      return {
        healthy,
        latency,
        blockDelay,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      
      return {
        healthy: false,
        latency,
        blockDelay,
        errors: [this._lastError.message]
      };
    }
  }
  
  /**
   * Calculate the block delay compared to the canonical chain
   */
  protected abstract calculateBlockDelay(currentBlockHeight: number): Promise<number>;
  
  /**
   * Submit a raw transaction
   */
  public abstract submitTransaction(signedTx: string, mevProtection?: boolean): Promise<string>;
  
  /**
   * Get the chain ID
   */
  public getChainId(): number {
    return this.config.chainId;
  }
  
  /**
   * Get the adapter name
   */
  public getName(): string {
    return this._name;
  }
  
  /**
   * Get the adapter version
   */
  public getVersion(): string {
    return this._version;
  }
  
  /**
   * Reset the adapter to its initial state
   */
  public async reset(): Promise<void> {
    try {
      // Disconnect if connected
      if (this._isConnected) {
        await this.disconnect();
      }
      
      // Call implementation-specific reset
      await this.resetImpl();
      
      // Reset state
      this._isInitialized = false;
      this._isConnected = false;
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      throw this._lastError;
    }
  }
  
  /**
   * Implementation-specific reset
   */
  protected abstract resetImpl(): Promise<void>;
  
  /**
   * Check if adapter is initialized
   */
  public isInitialized(): boolean {
    return this._isInitialized;
  }
  
  /**
   * Get supported capabilities
   */
  public getCapabilities(): string[] {
    return Array.from(this._capabilities);
  }
  
  /**
   * Check if adapter has a specific capability
   */
  public hasCapability(capability: AdapterCapability): boolean {
    return this._capabilities.has(capability);
  }
  
  /**
   * Add a capability to the adapter
   */
  protected addCapability(capability: string): void {
    this._capabilities.add(capability);
  }
  
  /**
   * Remove a capability from the adapter
   */
  protected removeCapability(capability: string): void {
    this._capabilities.delete(capability);
  }
  
  /**
   * Get network status
   * @returns Network status information
   */
  public abstract getNetworkStatus(): Promise<NetworkStatus>;
  
  /**
   * Submit a trade transaction
   * @param request Trade request
   * @param options Trade options
   * @returns Transaction response
   */
  public abstract submitTrade(request: TradeRequest, options?: TradeOptions): Promise<TransactionResponse>;
  
  /**
   * Sign a transaction
   * @param transaction Transaction to sign
   * @returns Signed transaction
   */
  public abstract signTransaction(transaction: TransactionRequest): Promise<string>;
  
  /**
   * Send a transaction
   * @param transaction Transaction to send
   * @returns Transaction response
   */
  public abstract sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse>;
  
  /**
   * Get the current block number
   * @returns Current block number
   */
  public abstract getBlockNumber(): Promise<number>;
  
  /**
   * Get the wallet address
   * @returns Wallet address
   */
  public abstract getWalletAddress(): Promise<string>;
  
  /**
   * Get market data for trading pairs
   * @returns Market data
   */
  public abstract getMarketData(): Promise<any>;
  
  /**
   * Get the underlying provider instance
   * @returns Provider instance
   */
  public getProvider(): any {
    return this.provider;
  }
} 