/**
 * CrossChainExecutionRouter - Coordinates execution across multiple blockchain networks
 * 
 * This router manages the routing of trade requests to appropriate chain adapters,
 * handles cross-chain strategy execution, and provides circuit breaker functionality
 * for resilient operation.
 */

import { IChainAdapter, ChainId, TradeRequest, TradeOptions, 
         TransactionResponse, NetworkStatus } from './IChainAdapter';
import { ICrossChainAdapter, CrossChainSwapParams, SwapResult } from './interfaces/ICrossChainAdapter';
import { BlockchainTelemetry } from './telemetry/BlockchainTelemetry';
import { CircuitBreakerState } from './telemetry/CircuitBreaker';

// Registry types for chain adapters
type AdapterRegistry = Map<number, IChainAdapter>;

/**
 * Strategy definition for cross-chain execution
 */
export interface Strategy {
  id: string;
  name: string;
  description?: string;
  chains: number[];
  enabled: boolean;
  useUniversalX?: boolean; // Flag to use UniversalX for this strategy
  preferredAdapter?: 'universalx' | 'legacy' | 'auto'; // Adapter preference
  rateLimit?: {
    maxRequestsPerMinute: number;
    maxDailyRequests: number;
  };
  fallbacks?: {
    chainId: number;
    priority: number;
  }[];
}

/**
 * Cross-chain trade request
 */
export interface CrossChainTradeRequest {
  strategyId: string;
  chainId: number;
  tradeRequest: TradeRequest;
  options?: TradeOptions & {
    fallbackEnabled?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
    useUniversalX?: boolean; // Override strategy setting
  };
}

/**
 * Batch execution request for multiple trades
 */
export interface BatchExecutionRequest {
  strategyId: string;
  trades: {
    chainId: number;
    tradeRequest: TradeRequest;
  }[];
  options?: TradeOptions & {
    fallbackEnabled?: boolean;
    sequential?: boolean;
    abortOnFailure?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
    useUniversalX?: boolean; // Override strategy setting
  };
}

/**
 * Result of a cross-chain trade
 */
export interface CrossChainTradeResult {
  strategyId: string;
  chainId: number;
  originalChainId?: number; // If fallback was used
  success: boolean;
  txHash?: string;
  txResponse?: TransactionResponse;
  usedFallback: boolean;
  usedUniversalX?: boolean; // Whether UniversalX was used
  error?: string;
  timestamp: number;
}

/**
 * Result of a batch execution
 */
export interface BatchExecutionResult {
  strategyId: string;
  results: CrossChainTradeResult[];
  allSucceeded: boolean;
  timestamp: number;
  error?: string;
}

/**
 * Configuration for the cross-chain execution router
 */
export interface CrossChainExecutionRouterConfig {
  adapters: IChainAdapter[];
  crossChainAdapter?: ICrossChainAdapter; // Optional UniversalX adapter
  strategies?: Strategy[];
  defaultMaxRetries?: number;
  defaultRetryDelay?: number;
  telemetry?: BlockchainTelemetry;
  enableCircuitBreakers?: boolean;
  enableRateLimiting?: boolean;
  defaultFallbackChainId?: number;
  enableUniversalX?: boolean; // Global flag to enable UniversalX
}

/**
 * CrossChainExecutionRouter implementation
 */
export class CrossChainExecutionRouter {
  // Registry of chain adapters
  private adapterRegistry: AdapterRegistry = new Map();
  
  // Cross-chain adapter (UniversalX)
  private crossChainAdapter?: ICrossChainAdapter;
  
  // Registry of strategies
  private strategies: Map<string, Strategy> = new Map();
  
  // Configuration
  private config: CrossChainExecutionRouterConfig;
  
  // Request tracking (for rate limiting)
  private strategyRequests: Map<string, {
    minuteCounter: number;
    minuteReset: number;
    dailyCounter: number;
    dailyReset: number;
  }> = new Map();
  
  // Telemetry
  private telemetry?: BlockchainTelemetry;
  
  /**
   * Constructor for the cross-chain execution router
   * @param config Router configuration
   */
  constructor(config: CrossChainExecutionRouterConfig) {
    this.config = {
      defaultMaxRetries: 3,
      defaultRetryDelay: 2000,
      enableCircuitBreakers: true,
      enableRateLimiting: true,
      enableUniversalX: false,
      ...config
    };
    
    this.telemetry = config.telemetry;
    this.crossChainAdapter = config.crossChainAdapter;
    
    // Register adapters
    this.registerAdapters(config.adapters);
    
    // Register strategies if provided
    if (config.strategies) {
      this.registerStrategies(config.strategies);
    }
  }
  
  /**
   * Register chain adapters
   * @param adapters Array of chain adapters to register
   */
  private registerAdapters(adapters: IChainAdapter[]): void {
    for (const adapter of adapters) {
      if (!adapter.isInitialized()) {
        throw new Error(`Adapter ${adapter.getName()} is not initialized`);
      }
      
      const chainId = adapter.getChainId();
      
      if (this.adapterRegistry.has(chainId)) {
        console.warn(`Overriding existing adapter for chain ID ${chainId}`);
      }
      
      this.adapterRegistry.set(chainId, adapter);
    }
    
    console.log(`Registered ${adapters.length} chain adapters`);
  }
  
  /**
   * Register execution strategies
   * @param strategies Array of strategies to register
   */
  public registerStrategies(strategies: Strategy[]): void {
    for (const strategy of strategies) {
      // Validate strategy chains
      for (const chainId of strategy.chains) {
        if (!this.adapterRegistry.has(chainId)) {
          throw new Error(`Strategy ${strategy.id} requires chain ID ${chainId}, but no adapter is registered`);
        }
      }
      
      // Validate fallbacks
      if (strategy.fallbacks) {
        for (const fallback of strategy.fallbacks) {
          if (!this.adapterRegistry.has(fallback.chainId)) {
            throw new Error(`Strategy ${strategy.id} has fallback for chain ID ${fallback.chainId}, but no adapter is registered`);
          }
        }
      }
      
      // Register strategy
      this.strategies.set(strategy.id, strategy);
      
      // Initialize rate limiting counters
      if (strategy.rateLimit) {
        this.strategyRequests.set(strategy.id, {
          minuteCounter: 0,
          minuteReset: Date.now() + 60000,
          dailyCounter: 0,
          dailyReset: Date.now() + 86400000
        });
      }
    }
    
    console.log(`Registered ${strategies.length} strategies`);
  }
  
  /**
   * Get a chain adapter by chain ID
   * @param chainId Blockchain chain ID
   * @returns Chain adapter for the specified chain
   */
  public getAdapter(chainId: number): IChainAdapter {
    const adapter = this.adapterRegistry.get(chainId);
    
    if (!adapter) {
      throw new Error(`No adapter registered for chain ID ${chainId}`);
    }
    
    return adapter;
  }
  
  /**
   * Get a strategy by ID
   * @param strategyId Strategy ID
   * @returns Strategy configuration
   */
  public getStrategy(strategyId: string): Strategy {
    const strategy = this.strategies.get(strategyId);
    
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    
    return strategy;
  }
  
  /**
   * Determine if UniversalX should be used for a trade
   */
  private shouldUseUniversalX(strategy: Strategy, options?: CrossChainTradeRequest['options']): boolean {
    // Check if UniversalX is globally enabled
    if (!this.config.enableUniversalX || !this.crossChainAdapter) {
      return false;
    }
    
    // Check option override
    if (options?.useUniversalX !== undefined) {
      return options.useUniversalX;
    }
    
    // Check strategy preference
    if (strategy.preferredAdapter === 'universalx') {
      return true;
    }
    
    if (strategy.preferredAdapter === 'legacy') {
      return false;
    }
    
    // Auto mode or default: use strategy flag
    return strategy.useUniversalX || false;
  }
  
  /**
   * Execute a trade across chains
   * @param request Cross-chain trade request
   * @returns Result of the trade execution
   */
  public async executeTrade(request: CrossChainTradeRequest): Promise<CrossChainTradeResult> {
    const startTime = Date.now();
    const { strategyId, chainId, tradeRequest, options } = request;
    
    // Default result (will be overwritten on success)
    let result: CrossChainTradeResult = {
      strategyId,
      chainId,
      success: false,
      usedFallback: false,
      usedUniversalX: false,
      timestamp: startTime
    };
    
    try {
      // Get strategy
      const strategy = this.getStrategy(strategyId);
      
      // Check if strategy is enabled
      if (!strategy.enabled) {
        throw new Error(`Strategy ${strategyId} is disabled`);
      }
      
      // Check if requested chain is supported by the strategy
      if (!strategy.chains.includes(chainId)) {
        throw new Error(`Chain ID ${chainId} is not supported by strategy ${strategyId}`);
      }
      
      // Check rate limits
      if (this.config.enableRateLimiting && strategy.rateLimit) {
        this.checkRateLimits(strategyId, strategy.rateLimit);
      }
      
      // Determine if we should use UniversalX
      const useUniversalX = this.shouldUseUniversalX(strategy, options);
      
      if (useUniversalX && this.crossChainAdapter) {
        // Execute through UniversalX
        result.usedUniversalX = true;
        
        // Convert to cross-chain swap params
        const swapParams: CrossChainSwapParams = {
          fromChain: tradeRequest.fromAsset.chainId.toString(),
          toChain: tradeRequest.toAsset.chainId.toString(),
          fromToken: tradeRequest.fromAsset.address || tradeRequest.fromAsset.symbol,
          toToken: tradeRequest.toAsset.address || tradeRequest.toAsset.symbol,
          amount: tradeRequest.amount,
          slippageTolerance: options?.slippageTolerance || tradeRequest.slippageTolerance,
          recipient: tradeRequest.recipient,
          deadline: options?.deadline || tradeRequest.deadline
        };
        
        const swapResult = await this.crossChainAdapter.executeCrossChainSwap(swapParams);
        
        if (swapResult.success) {
          result = {
            ...result,
            success: true,
            txHash: swapResult.transactionHash,
            timestamp: Date.now()
          };
        } else {
          throw new Error(swapResult.error || 'UniversalX swap failed');
        }
      } else {
        // Execute through legacy adapters
        // Get the target adapter
        let targetChainId = chainId;
        let adapter = this.getAdapter(targetChainId);
        
        // Check circuit breaker
        if (this.config.enableCircuitBreakers && this.telemetry) {
          const circuitStatus = this.telemetry.getCircuitBreakerStatus(adapter.getName());
          
          if (circuitStatus.state === CircuitBreakerState.OPEN) {
            // Circuit is open, try fallback if available
            if (options?.fallbackEnabled && strategy.fallbacks && strategy.fallbacks.length > 0) {
              // Sort fallbacks by priority
              const sortedFallbacks = [...strategy.fallbacks].sort((a, b) => a.priority - b.priority);
              
              // Find a fallback with a healthy circuit
              for (const fallback of sortedFallbacks) {
                const fallbackAdapter = this.getAdapter(fallback.chainId);
                const fallbackCircuit = this.telemetry.getCircuitBreakerStatus(fallbackAdapter.getName());
                
                if (fallbackCircuit.state !== CircuitBreakerState.OPEN) {
                  // Use this fallback
                  targetChainId = fallback.chainId;
                  adapter = fallbackAdapter;
                  result.usedFallback = true;
                  result.originalChainId = chainId;
                  break;
                }
              }
              
              // If all fallbacks are also tripped, throw an error
              if (targetChainId === chainId) {
                throw new Error(`Circuit breaker is open for chain ID ${chainId} and all fallbacks are unavailable`);
              }
            } else {
              // No fallback available, throw an error
              throw new Error(`Circuit breaker is open for chain ID ${chainId}`);
            }
          }
        }
        
        // Execute with retry logic
        const maxRetries = options?.maxRetries ?? this.config.defaultMaxRetries ?? 3;
        const retryDelay = options?.retryDelayMs ?? this.config.defaultRetryDelay ?? 2000;
        
        let txResponse: TransactionResponse | undefined;
        let lastError: Error | undefined;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            // If this is a retry, wait before trying again
            if (attempt > 0) {
              await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
            }
            
            // Execute the trade
            txResponse = await adapter.submitTrade(tradeRequest, options);
            
            // Record successful execution
            if (this.telemetry) {
              this.telemetry.recordSuccessfulExecution(adapter.getName());
            }
            
            // Exit retry loop on success
            break;
          } catch (error) {
            // Record failed execution
            if (this.telemetry) {
              this.telemetry.recordFailedExecution(adapter.getName());
            }
            
            // Store the error
            lastError = error instanceof Error ? error : new Error(String(error));
            
            // If this was the last attempt, re-throw
            if (attempt === maxRetries) {
              throw lastError;
            }
            
            console.warn(`Trade attempt ${attempt + 1}/${maxRetries + 1} failed, retrying...`);
          }
        }
        
        // If we've reached here without a transaction response, something went wrong
        if (!txResponse) {
          throw new Error("Failed to execute trade after retries");
        }
        
        // Update the result with success data
        result = {
          ...result,
          chainId: targetChainId,
          success: true,
          txHash: txResponse.hash,
          txResponse,
          timestamp: Date.now()
        };
      }
      
      return result;
    } catch (error) {
      // Update the result with error data
      result = {
        ...result,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
      
      return result;
    }
  }
  
  /**
   * Execute multiple trades as a batch
   * @param request Batch execution request
   * @returns Results of the batch execution
   */
  public async executeBatch(request: BatchExecutionRequest): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const { strategyId, trades, options } = request;
    
    // Initialize results array
    const results: CrossChainTradeResult[] = [];
    
    try {
      // Get strategy
      const strategy = this.getStrategy(strategyId);
      
      // Check if strategy is enabled
      if (!strategy.enabled) {
        throw new Error(`Strategy ${strategyId} is disabled`);
      }
      
      // Validate all trades
      for (const trade of trades) {
        if (!strategy.chains.includes(trade.chainId)) {
          throw new Error(`Chain ID ${trade.chainId} is not supported by strategy ${strategyId}`);
        }
      }
      
      // Check rate limits (for the entire batch)
      if (this.config.enableRateLimiting && strategy.rateLimit) {
        // Multiply the rate limit check by the number of trades
        this.checkRateLimits(strategyId, {
          maxRequestsPerMinute: strategy.rateLimit.maxRequestsPerMinute * trades.length,
          maxDailyRequests: strategy.rateLimit.maxDailyRequests * trades.length
        });
      }
      
      // Execute trades
      if (options?.sequential) {
        // Execute sequentially
        for (const trade of trades) {
          const tradeRequest: CrossChainTradeRequest = {
            strategyId,
            chainId: trade.chainId,
            tradeRequest: trade.tradeRequest,
            options: {
              ...options,
              // Pass through the options
            }
          };
          
          const result = await this.executeTrade(tradeRequest);
          results.push(result);
          
          // If configured to abort on failure and a trade failed, stop the batch
          if (options.abortOnFailure && !result.success) {
            break;
          }
        }
      } else {
        // Execute in parallel
        const tradePromises = trades.map(trade => {
          const tradeRequest: CrossChainTradeRequest = {
            strategyId,
            chainId: trade.chainId,
            tradeRequest: trade.tradeRequest,
            options: {
              ...options,
              // Pass through the options
            }
          };
          
          return this.executeTrade(tradeRequest);
        });
        
        const parallelResults = await Promise.all(tradePromises);
        results.push(...parallelResults);
      }
      
      // Check if all trades succeeded
      const allSucceeded = results.every(result => result.success);
      
      return {
        strategyId,
        results,
        allSucceeded,
        timestamp: Date.now()
      };
    } catch (error) {
      // If there was an error at the batch level, return the error in the results
      return {
        strategyId,
        results,
        allSucceeded: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Check rate limits for a strategy
   * @param strategyId Strategy ID
   * @param rateLimit Rate limit configuration
   * @throws Error if rate limit is exceeded
   */
  private checkRateLimits(
    strategyId: string,
    rateLimit: { maxRequestsPerMinute: number; maxDailyRequests: number }
  ): void {
    const now = Date.now();
    
    // Get or initialize rate limiting counters
    let counters = this.strategyRequests.get(strategyId);
    
    if (!counters) {
      counters = {
        minuteCounter: 0,
        minuteReset: now + 60000,
        dailyCounter: 0,
        dailyReset: now + 86400000
      };
      this.strategyRequests.set(strategyId, counters);
    }
    
    // Reset counters if needed
    if (now >= counters.minuteReset) {
      counters.minuteCounter = 0;
      counters.minuteReset = now + 60000;
    }
    
    if (now >= counters.dailyReset) {
      counters.dailyCounter = 0;
      counters.dailyReset = now + 86400000;
    }
    
    // Check limits
    if (counters.minuteCounter >= rateLimit.maxRequestsPerMinute) {
      throw new Error(`Rate limit exceeded for strategy ${strategyId}: ${rateLimit.maxRequestsPerMinute} requests per minute`);
    }
    
    if (counters.dailyCounter >= rateLimit.maxDailyRequests) {
      throw new Error(`Rate limit exceeded for strategy ${strategyId}: ${rateLimit.maxDailyRequests} requests per day`);
    }
    
    // Increment counters
    counters.minuteCounter++;
    counters.dailyCounter++;
  }
  
  /**
   * Get network status for all registered chains
   * @returns Map of chain IDs to network status
   */
  public async getAllNetworkStatus(): Promise<Map<number, NetworkStatus>> {
    const statusMap = new Map<number, NetworkStatus>();
    const promises: Promise<void>[] = [];
    
    for (const [chainId, adapter] of this.adapterRegistry.entries()) {
      promises.push(
        adapter.getNetworkStatus()
          .then(status => {
            statusMap.set(chainId, status);
          })
          .catch(error => {
            // Add error status
            statusMap.set(chainId, {
              networkName: adapter.getName(),
              chainId: Number(chainId),
              isConnected: false,
              latestBlock: 0,
              blockTime: 0,
              gasPrice: BigInt(0),
              maxPriorityFeePerGas: null,
              maxFeePerGas: null,
              baseFeePerGas: null,
              congestion: "unknown",
              timestamp: Date.now(),
              error: error instanceof Error ? error.message : String(error)
            });
          })
      );
    }
    
    await Promise.all(promises);
    return statusMap;
  }
  
  /**
   * Check health of all registered adapters
   * @returns Health status of all adapters
   */
  public async getHealthStatus(): Promise<{
    healthy: boolean;
    adapters: Record<string, {
      chainId: number;
      healthy: boolean;
      circuitBreakerStatus?: {
        state: string;
        failureCount: number;
        lastFailure?: number;
        nextRetry?: number;
      };
    }>;
    strategies: Record<string, {
      id: string;
      enabled: boolean;
      supportedChains: number[];
      rateLimited: boolean;
      currentMinuteRequests?: number;
      currentDailyRequests?: number;
    }>;
  }> {
    const adapterHealth: Record<string, any> = {};
    let allHealthy = true;
    
    // Check adapter health
    for (const [chainId, adapter] of this.adapterRegistry.entries()) {
      let adapterHealthy = true;
      let circuitBreakerStatus;
      
      // Check if the adapter is initialized
      if (!adapter.isInitialized()) {
        adapterHealthy = false;
      }
      
      // Check circuit breaker if enabled
      if (this.config.enableCircuitBreakers && this.telemetry) {
        const status = this.telemetry.getCircuitBreakerStatus(adapter.getName());
        circuitBreakerStatus = {
          state: CircuitBreakerState[status.state],
          failureCount: status.failureCount,
          lastFailure: status.lastFailure,
          nextRetry: status.nextRetry
        };
        
        if (status.state === CircuitBreakerState.OPEN) {
          adapterHealthy = false;
        }
      }
      
      adapterHealth[adapter.getName()] = {
        chainId: Number(chainId),
        healthy: adapterHealthy,
        circuitBreakerStatus
      };
      
      if (!adapterHealthy) {
        allHealthy = false;
      }
    }
    
    // Check strategy health
    const strategyHealth: Record<string, any> = {};
    
    for (const [id, strategy] of this.strategies.entries()) {
      const strategyEntry = {
        id,
        enabled: strategy.enabled,
        supportedChains: strategy.chains,
        rateLimited: Boolean(strategy.rateLimit)
      };
      
      // Add rate limit counts if applicable
      if (strategy.rateLimit && this.strategyRequests.has(id)) {
        const counters = this.strategyRequests.get(id)!;
        
        // Only add to the entry if rate limiting is active
        Object.assign(strategyEntry, {
          currentMinuteRequests: counters.minuteCounter,
          currentDailyRequests: counters.dailyCounter,
          minuteReset: new Date(counters.minuteReset).toISOString(),
          dailyReset: new Date(counters.dailyReset).toISOString()
        });
      }
      
      strategyHealth[id] = strategyEntry;
    }
    
    return {
      healthy: allHealthy,
      adapters: adapterHealth,
      strategies: strategyHealth
    };
  }
  
  /**
   * Reset rate limits for a specific strategy
   * @param strategyId Strategy ID
   */
  public resetRateLimits(strategyId: string): void {
    if (!this.strategies.has(strategyId)) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    
    this.strategyRequests.set(strategyId, {
      minuteCounter: 0,
      minuteReset: Date.now() + 60000,
      dailyCounter: 0,
      dailyReset: Date.now() + 86400000
    });
  }
  
  /**
   * Reset circuit breakers for a specific chain
   * @param chainId Chain ID
   */
  public resetCircuitBreaker(chainId: number): void {
    if (!this.adapterRegistry.has(chainId)) {
      throw new Error(`No adapter registered for chain ID ${chainId}`);
    }
    
    const adapter = this.adapterRegistry.get(chainId)!;
    
    if (this.telemetry) {
      this.telemetry.resetCircuitBreaker(adapter.getName());
    }
  }
} 