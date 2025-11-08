/**
 * Adapter Registry
 * 
 * This module implements a registry for blockchain adapters that provides
 * reliability features including circuit breakers, retry mechanisms,
 * and fallback chains.
 */

import { createAdapter } from '../index.js';
import { CircuitBreaker, CircuitState } from './reliability/CircuitBreaker.js';
import { RetryHandler } from './reliability/RetryHandler.js';
import { BlockchainTelemetry, enhanceAdapterWithTelemetry } from '../telemetry/BlockchainTelemetry.js';
import { DEFAULT_REGISTRY_CONFIG } from '../constants.js';
// Import new metrics functions - these will need to be dynamically imported at runtime
// since we're mixing JS and TS files
let metricsModule = null;

// Dynamically import metrics - will be replaced by proper import when converting to TypeScript
async function importMetrics() {
  if (!metricsModule) {
    try {
      // Dynamic import for the metrics module
      metricsModule = await import('../../telemetry/metrics.js');
      console.log('Metrics module loaded successfully for blockchain adapters');
    } catch (error) {
      console.warn('Could not load metrics module, metrics recording disabled:', error.message);
    }
  }
  return metricsModule;
}

// Initialize metrics import
importMetrics();

/**
 * The AdapterRegistry manages a collection of blockchain adapters
 * and provides reliability and monitoring features.
 */
export class AdapterRegistry {
  /**
   * Create a new adapter registry
   * 
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_REGISTRY_CONFIG,
      ...config
    };
    
    // Adapter storage
    this.adapters = new Map();
    this.circuitBreakers = new Map();
    this.retryHandlers = new Map();
    this.fallbackChains = new Map();
    
    // Metrics
    this.metrics = {
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
      lastFailureTime: null,
      lastError: null,
      operationLatencies: {}
    };
    
    // Pending operations queue for metrics
    this.pendingOperations = new Map();
  }
  
  /**
   * Register a blockchain by its chain ID
   * 
   * @param {number} chainId The blockchain chain ID
   * @param {Object} adapterConfig Configuration for this specific adapter
   * @returns {AdapterRegistry} This registry instance (for chaining)
   */
  registerChain(chainId, adapterConfig = {}) {
    // Don't re-register chains
    if (this.adapters.has(chainId)) {
      console.warn(`Chain ${chainId} already registered, ignoring`);
      return this;
    }
    
    // Create adapter instance
    const adapter = createAdapter(chainId, adapterConfig);
    
    // Add telemetry if enabled
    const enhancedAdapter = this.config.metricsEnabled
      ? enhanceAdapterWithTelemetry(adapter, chainId, true)
      : adapter;
    
    // Create circuit breaker for this chain
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: this.config.circuitBreakerThreshold,
      resetTimeoutMs: this.config.circuitBreakerResetTimeoutMs,
      chainId,
      isMainnet: true
    });
    
    // Create retry handler for this chain
    const retryHandler = new RetryHandler({
      maxRetries: this.config.maxRetries, 
      baseDelayMs: this.config.retryBaseDelayMs,
      maxDelayMs: this.config.retryMaxDelayMs,
      chainId,
      isMainnet: true
    });
    
    // Store in registry
    this.adapters.set(chainId, enhancedAdapter);
    this.circuitBreakers.set(chainId, circuitBreaker);
    this.retryHandlers.set(chainId, retryHandler);
    
    // Update metrics for the new chain's circuit breaker state
    this.updateCircuitBreakerMetrics(chainId, circuitBreaker.state === 'OPEN');
    
    // Initialize queue depth for this chain as 0
    this.updateQueueDepthMetrics(chainId, 0);
    
    return this;
  }
  
  /**
   * Initialize all registered adapters
   */
  async initialize() {
    console.log(`Initializing ${this.adapters.size} blockchain adapters...`);
    
    // Initialize all adapters
    const initPromises = [];
    
    for (const [chainId, adapter] of this.adapters.entries()) {
      const initStartTime = Date.now();
      
      const initPromise = adapter.initialize({})
        .then(() => adapter.connect())
        .then(() => {
          const duration = Date.now() - initStartTime;
          // Record successful initialization metrics
          this.recordOperationMetrics(chainId, 'initialize', initStartTime, true);
          this.updateConnectionMetrics(chainId, true);
          return adapter.getStatus().then(status => {
            if (status.blockHeight) {
              this.updateBlockHeightMetrics(chainId, status.blockHeight);
            }
            if (status.gasPrice) {
              this.updateGasPriceMetrics(chainId, parseFloat(status.gasPrice));
            }
          });
        })
        .catch(error => {
          // Record failed initialization metrics
          this.recordOperationMetrics(chainId, 'initialize', initStartTime, false);
          this.updateConnectionMetrics(chainId, false);
          console.error(`Failed to initialize adapter for chain ${chainId}:`, error.message);
          throw error;
        });
      
      initPromises.push(initPromise);
    }
    
    // Wait for all to initialize
    await Promise.all(initPromises);
    
    console.log('All adapters initialized successfully');
    return this;
  }
  
  /**
   * Shutdown all adapters
   */
  async shutdown() {
    console.log(`Shutting down ${this.adapters.size} blockchain adapters...`);
    
    const shutdownPromises = [];
    
    for (const [chainId, adapter] of this.adapters.entries()) {
      const shutdownStartTime = Date.now();
      
      shutdownPromises.push(
        adapter.disconnect()
          .then(() => {
            // Record successful shutdown metrics
            this.recordOperationMetrics(chainId, 'shutdown', shutdownStartTime, true);
            this.updateConnectionMetrics(chainId, false);
          })
          .catch(error => {
            // Record failed shutdown metrics
            this.recordOperationMetrics(chainId, 'shutdown', shutdownStartTime, false);
            console.error(`Error disconnecting adapter for chain ${chainId}:`, error.message);
          })
      );
    }
    
    await Promise.all(shutdownPromises);
    
    return this;
  }
  
  /**
   * Set a fallback chain for a primary chain
   * 
   * @param {number} primaryChainId The primary chain ID
   * @param {number} fallbackChainId The fallback chain ID
   * @returns {AdapterRegistry} This registry instance (for chaining)
   */
  setFallbackChain(primaryChainId, fallbackChainId) {
    // Validate both chains exist
    if (!this.adapters.has(primaryChainId)) {
      throw new Error(`Primary chain ${primaryChainId} not registered`);
    }
    
    if (!this.adapters.has(fallbackChainId)) {
      throw new Error(`Fallback chain ${fallbackChainId} not registered`);
    }
    
    // Store fallback relationship
    this.fallbackChains.set(primaryChainId, fallbackChainId);
    
    return this;
  }
  
  /**
   * Get an adapter for a specific chain
   * 
   * @param {number} chainId The chain ID
   * @returns {Object} The chain adapter
   */
  getAdapter(chainId) {
    const adapter = this.adapters.get(chainId);
    
    if (!adapter) {
      throw new Error(`No adapter registered for chain ${chainId}`);
    }
    
    return adapter;
  }
  
  /**
   * Get the circuit breaker for a chain
   * 
   * @param {number} chainId The chain ID
   * @returns {CircuitBreaker} The circuit breaker
   */
  getCircuitBreakerForChain(chainId) {
    const circuitBreaker = this.circuitBreakers.get(chainId);
    
    if (!circuitBreaker) {
      throw new Error(`No circuit breaker for chain ${chainId}`);
    }
    
    return circuitBreaker;
  }
  
  /**
   * Get balance for an address on a specific chain
   * 
   * @param {number} chainId The chain ID
   * @param {string} address The wallet address
   * @param {boolean} useFallback Whether to use fallback chain if primary fails
   * @returns {Promise<string>} The account balance
   */
  async getBalance(chainId, address, useFallback = false) {
    return this._executeChainOperation(
      chainId,
      async (adapter) => adapter.getBalance(address),
      'getBalance',
      useFallback
    );
  }
  
  /**
   * Get a quote for swapping assets
   * 
   * @param {Object} fromAsset The source asset
   * @param {Object} toAsset The target asset
   * @param {string} amount The amount to swap
   * @param {boolean} useFallback Whether to use fallback chain if primary fails
   * @returns {Promise<Object>} The quote result
   */
  async getQuote(fromAsset, toAsset, amount, useFallback = false) {
    // Determine which chain to use based on assets
    const chainId = fromAsset.chainId || toAsset.chainId;
    
    // If cross-chain, handle specially
    if (fromAsset.chainId !== toAsset.chainId) {
      return this._executeCrossChainQuote(fromAsset, toAsset, amount);
    }
    
    return this._executeChainOperation(
      chainId,
      async (adapter) => adapter.getQuote(fromAsset, toAsset, amount),
      'getQuote',
      useFallback
    );
  }
  
  /**
   * Execute an operation on a specific chain with circuit breaker and retry support
   * 
   * @param {number} chainId The chain ID
   * @param {Function} operation The operation to execute
   * @param {string} operationName Name of the operation (for logging)
   * @param {boolean} useFallback Whether to use fallback if primary fails
   * @returns {Promise<any>} The operation result
   */
  async _executeChainOperation(chainId, operation, operationName, useFallback = false) {
    // Get required components
    const adapter = this.getAdapter(chainId);
    const circuitBreaker = this.getCircuitBreakerForChain(chainId);
    const retryHandler = this.retryHandlers.get(chainId);
    
    // Update metrics
    this.metrics.requestCount++;
    
    // Track queue depth
    this.incrementQueueDepth(chainId);
    
    // Record operation start time
    const startTime = Date.now();
    
    try {
      // Execute with circuit breaker protection
      const result = await circuitBreaker.execute(async () => {
        // Execute with retry
        return await retryHandler.execute(async () => {
          return await operation(adapter);
        }, operationName);
      });
      
      // Success handling
      this.metrics.successCount++;
      
      // Explicitly record success to ensure circuit breaker state transitions
      circuitBreaker.recordSuccess();
      
      // Update circuit breaker state in metrics
      this.updateCircuitBreakerMetrics(chainId, false);
      
      // Record operation metrics
      this.recordOperationMetrics(chainId, operationName, startTime, true);
      
      // Decrement queue depth
      this.decrementQueueDepth(chainId);
      
      return result;
    } catch (error) {
      // Record failure
      this.metrics.failureCount++;
      this.metrics.lastFailureTime = Date.now();
      this.metrics.lastError = error.message;
      
      // Update circuit breaker state in metrics if it's open
      if (circuitBreaker.state === 'OPEN') {
        this.updateCircuitBreakerMetrics(chainId, true);
      }
      
      // Record operation metrics
      this.recordOperationMetrics(chainId, operationName, startTime, false, error.name);
      
      // Decrement queue depth
      this.decrementQueueDepth(chainId);
      
      // If fallback is enabled and available, try fallback chain
      if (useFallback && this.config.useFallbackChains) {
        const fallbackChainId = this.fallbackChains.get(chainId);
        
        if (fallbackChainId) {
          console.warn(`Operation ${operationName} failed on chain ${chainId}, trying fallback chain ${fallbackChainId}`);
          
          return this._executeChainOperation(
            fallbackChainId,
            operation,
            `${operationName} (fallback)`,
            false // Don't allow recursive fallbacks
          );
        }
      }
      
      // No fallback or fallback disabled, throw the error
      throw error;
    }
  }
  
  /**
   * Handle a cross-chain quote operation
   * 
   * @param {Object} fromAsset The source asset
   * @param {Object} toAsset The target asset
   * @param {string} amount The amount to swap
   * @returns {Promise<Object>} The quote result
   */
  async _executeCrossChainQuote(fromAsset, toAsset, amount) {
    // This is a simplified implementation
    // In a real system, we would need to:
    // 1. Find a path between chains
    // 2. Calculate quotes for each hop
    // 3. Aggregate the quotes
    // 4. Consider gas costs and other factors
    
    console.log(`Cross-chain quote: ${fromAsset.symbol} (${fromAsset.chainId}) -> ${toAsset.symbol} (${toAsset.chainId})`);
    
    // Record metrics for cross-chain operation
    const startTime = Date.now();
    this.recordOperationMetrics(fromAsset.chainId, 'cross_chain_quote', startTime, true);
    this.recordOperationMetrics(toAsset.chainId, 'cross_chain_quote', startTime, true);
    
    // For now, just simulate a cross-chain quote with a dummy rate
    return {
      fromAsset,
      toAsset,
      amount,
      rate: "1.0",
      fee: "0.5",
      route: [fromAsset.chainId.toString(), toAsset.chainId.toString()]
    };
  }
  
  /**
   * Get metrics for all adapters
   * 
   * @returns {Object} Registry metrics
   */
  getMetrics() {
    const result = {
      ...this.metrics,
      chains: {},
      circuitBreakerStatus: {}
    };
    
    // Add chain-specific metrics
    for (const [chainId, adapter] of this.adapters.entries()) {
      const circuitBreaker = this.circuitBreakers.get(chainId);
      
      result.chains[chainId] = {
        status: adapter.status || 'unknown'
      };
      
      result.circuitBreakerStatus[chainId] = {
        state: circuitBreaker.state,
        failureCount: circuitBreaker.failureCount,
        openCount: circuitBreaker.openCount,
        lastError: circuitBreaker.lastError
      };
    }
    
    return result;
  }
  
  //----------------------------------------------------------------------------
  // Metrics integration methods
  //----------------------------------------------------------------------------
  
  /**
   * Record operation metrics using the metrics module
   * 
   * @param {number} chainId Chain ID
   * @param {string} operation Operation name
   * @param {number} startTime Start time (ms)
   * @param {boolean} success Whether the operation succeeded
   * @param {string} errorType Optional error type if failure
   */
  recordOperationMetrics(chainId, operation, startTime, success, errorType) {
    if (metricsModule) {
      try {
        // Record blockchain operation
        metricsModule.recordBlockchainOperation(
          chainId,
          operation,
          true, // isMainnet
          startTime,
          success
        );
        
        // If there was an error and errorType is provided, record RPC error
        if (!success && errorType) {
          metricsModule.recordRpcMetrics(
            chainId,
            operation,
            true, // isMainnet
            startTime,
            false,
            errorType
          );
        }
      } catch (error) {
        console.warn(`Error recording operation metrics: ${error.message}`);
      }
    }
  }
  
  /**
   * Update circuit breaker metrics
   * 
   * @param {number} chainId Chain ID
   * @param {boolean} isOpen Whether the circuit breaker is open
   */
  updateCircuitBreakerMetrics(chainId, isOpen) {
    if (metricsModule) {
      try {
        metricsModule.updateCircuitBreakerState(
          chainId,
          true, // isMainnet
          isOpen
        );
      } catch (error) {
        console.warn(`Error updating circuit breaker metrics: ${error.message}`);
      }
    }
  }
  
  /**
   * Update connection metrics
   * 
   * @param {number} chainId Chain ID
   * @param {boolean} connected Whether the chain is connected
   */
  updateConnectionMetrics(chainId, connected) {
    if (metricsModule) {
      try {
        metricsModule.updateBlockchainConnectionStatus(
          chainId,
          true, // isMainnet
          connected
        );
      } catch (error) {
        console.warn(`Error updating connection metrics: ${error.message}`);
      }
    }
  }
  
  /**
   * Update block height metrics
   * 
   * @param {number} chainId Chain ID
   * @param {number} height Block height
   */
  updateBlockHeightMetrics(chainId, height) {
    if (metricsModule) {
      try {
        metricsModule.updateBlockchainConnectionStatus(
          chainId,
          true, // isMainnet
          true, // connected
          height
        );
      } catch (error) {
        console.warn(`Error updating block height metrics: ${error.message}`);
      }
    }
  }
  
  /**
   * Update gas price metrics
   * 
   * @param {number} chainId Chain ID
   * @param {number} price Gas price in Gwei
   */
  updateGasPriceMetrics(chainId, price) {
    if (metricsModule) {
      try {
        metricsModule.updateBlockchainConnectionStatus(
          chainId,
          true, // isMainnet
          true, // connected
          undefined, // no block height update
          price
        );
      } catch (error) {
        console.warn(`Error updating gas price metrics: ${error.message}`);
      }
    }
  }
  
  /**
   * Increment queue depth for a chain
   * 
   * @param {number} chainId Chain ID
   */
  incrementQueueDepth(chainId) {
    const currentDepth = this.pendingOperations.get(chainId) || 0;
    this.pendingOperations.set(chainId, currentDepth + 1);
    this.updateQueueDepthMetrics(chainId, currentDepth + 1);
  }
  
  /**
   * Decrement queue depth for a chain
   * 
   * @param {number} chainId Chain ID
   */
  decrementQueueDepth(chainId) {
    const currentDepth = this.pendingOperations.get(chainId) || 0;
    const newDepth = Math.max(0, currentDepth - 1);
    this.pendingOperations.set(chainId, newDepth);
    this.updateQueueDepthMetrics(chainId, newDepth);
  }
  
  /**
   * Update queue depth metrics
   * 
   * @param {number} chainId Chain ID
   * @param {number} depth Queue depth
   */
  updateQueueDepthMetrics(chainId, depth) {
    if (metricsModule) {
      try {
        metricsModule.updateAdapterQueueDepth(
          chainId,
          true, // isMainnet
          depth
        );
      } catch (error) {
        console.warn(`Error updating queue depth metrics: ${error.message}`);
      }
    }
  }
}

export default AdapterRegistry; 