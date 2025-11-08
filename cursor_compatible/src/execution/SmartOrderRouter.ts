import { OrderRetryEngine, RetryContext } from './OrderRetryEngine.js';
import { TrustManager } from '../governance/TrustManager.js';
import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { ExecutionTracer, TraceEventType } from './ExecutionTracer';
import { MEVProtectionManager } from './MEVProtectionManager';
import { isPaperMode, logPaperModeCall, getSimulationConfig } from '../config/PaperModeConfig';

interface Order {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  venues: string[];
}

interface ExecutionResult {
  success: boolean;
  venue: string;
  reason?: 'revert' | 'outOfGas' | 'slippageTooHigh';
  transactionId?: string;
  executedPrice?: number;
  executedAmount?: number;
  fees?: number;
  error?: string;
}

// [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Enhanced performance metrics with separate storage
interface PerformanceMetrics {
  executionTimes: Map<string, number[]>; // venue -> execution times
  successRates: Map<string, number>; // venue -> success rate
  lastUpdated: Map<string, number>; // venue -> last update timestamp
}

// [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Object pool for reusable objects
interface PooledObject {
  id: string;
  data: any;
  inUse: boolean;
  lastUsed: number;
}

// [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Memoization cache entry
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
}

export class SmartOrderRouter {
  private static instance: SmartOrderRouter;
  private retryEngine: OrderRetryEngine;
  private trustManager: TrustManager;
  
  // [FIX][CRITICAL] - Add missing production integrations
  private telemetryBus: TelemetryBus;
  private tracer: ExecutionTracer;
  private mevProtection: MEVProtectionManager;
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Enhanced performance tracking
  private performanceMetrics: PerformanceMetrics;
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Object pooling for memory optimization
  private objectPool: Map<string, PooledObject[]> = new Map();
  private readonly maxPoolSize = 20;
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Memoization cache with TTL and LRU
  private memoCache: Map<string, CacheEntry<any>> = new Map();
  private readonly cacheTTL = 10000; // 10 seconds TTL
  private readonly maxCacheSize = 1000; // Maximum cache entries
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Array optimization - pre-allocated arrays
  private preallocatedArrays: {
    venues: string[];
    results: ExecutionResult[];
    metrics: number[];
  };
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Cleanup timers
  private cacheCleanupTimer?: NodeJS.Timeout;
  private poolCleanupTimer?: NodeJS.Timeout;

  private constructor() {
    this.retryEngine = OrderRetryEngine.getInstance();
    this.trustManager = TrustManager.getInstance();
    
    // [FIX][CRITICAL] - Initialize production integrations
    this.telemetryBus = TelemetryBus.getInstance();
    this.tracer = ExecutionTracer.getInstance();
    this.mevProtection = MEVProtectionManager.getInstance();
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Initialize performance metrics
    this.performanceMetrics = {
      executionTimes: new Map(),
      successRates: new Map(),
      lastUpdated: new Map()
    };
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Pre-allocate arrays for performance
    this.preallocatedArrays = {
      venues: new Array(50), // Pre-allocate for up to 50 venues
      results: new Array(50),
      metrics: new Array(100)
    };
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Start cleanup timers
    this.startCleanupTimers();
  }

  public static getInstance(): SmartOrderRouter {
    if (!SmartOrderRouter.instance) {
      SmartOrderRouter.instance = new SmartOrderRouter();
    }
    return SmartOrderRouter.instance;
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Memoized execution with cache
  public async executeOrder(order: Order): Promise<ExecutionResult> {
    // [FIX][CRITICAL] - Start execution tracing
    const traceId = this.tracer.startTrace(
      `order-${order.symbol}-${Date.now()}`,
      order.symbol,
      order.amount,
      { side: order.side, price: order.price, venues: order.venues }
    );
    
    const cacheKey = this.generateCacheKey(order);
    
    // Check memoization cache
    const cached = this.getFromCache<ExecutionResult>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for order execution`, { symbol: order.symbol, cacheKey, traceId });
      
      // Add cache hit event to trace
      this.tracer.addEvent(traceId, TraceEventType.EXECUTION_COMPLETE, {
        cached: true,
        venue: cached.venue,
        success: cached.success
      });
      
      this.tracer.completeTrace(traceId, cached.success, { cached: true });
      return cached;
    }

    const startTime = Date.now();
    
    // [FIX][CRITICAL] - Apply MEV protection
    const mevResult = await this.mevProtection.applyMEVProtection(
      order.symbol,
      order.amount,
      order.price,
      10000 // Mock liquidity depth - should be passed from caller
    );
    
    // Add MEV protection event to trace
    this.tracer.addEvent(traceId, TraceEventType.MEV_PROTECTION, {
      strategy: mevResult.strategy,
      delayApplied: mevResult.delayApplied,
      riskMitigated: mevResult.riskMitigated
    });
    
    // Sort venues by trust score
    const rankedVenues = this.trustManager.getVenueRankings();
    const availableVenues = order.venues.filter(venue => 
      rankedVenues.some(v => v.venue === venue)
    );

    if (availableVenues.length === 0) {
      const error = `No available venues for ${order.symbol}`;
      logger.error(error, { traceId });
      
      // Add error event to trace
      this.tracer.addEvent(traceId, TraceEventType.ERROR_OCCURRED, { error });
      
      const result = { success: false, venue: '', error };
      this.storeInCache(cacheKey, result);
      
      // Emit telemetry
      this.telemetryBus.emit('order_execution_failed', {
        symbol: order.symbol,
        error,
        traceId,
        timestamp: Date.now()
      });
      
      this.tracer.completeTrace(traceId, false, { error });
      return result;
    }

    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Use object pool for execution context
    const executionContext = this.getFromPool('executionContext') || {
      attempts: 0,
      errors: [],
      startTime: Date.now()
    };

    try {
      // Try each venue in order of trust score
      for (const venue of availableVenues) {
        try {
          // Add venue selection event to trace
          const venueEventId = this.tracer.addEvent(traceId, TraceEventType.ADAPTER_CALL, {
            venue,
            attempt: executionContext.attempts
          });
          
          const result = await this.executeOnVenue(order, venue);
          
          // Complete venue event
          this.tracer.completeEvent(traceId, venueEventId, result.success, {
            venue,
            transactionId: result.transactionId,
            executedPrice: result.executedPrice,
            fees: result.fees
          }, result.error);
          
          if (result.success) {
            // Improve trust score on success
            this.trustManager.improve(venue);
            
            // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Update performance metrics
            this.updatePerformanceMetrics(venue, Date.now() - startTime, true);
            
            // Cache successful result
            this.storeInCache(cacheKey, result);
            
            // Emit telemetry for successful execution
            this.telemetryBus.emit('order_execution_success', {
              symbol: order.symbol,
              venue,
              transactionId: result.transactionId,
              executedPrice: result.executedPrice,
              executedAmount: result.executedAmount,
              fees: result.fees,
              executionTime: Date.now() - startTime,
              traceId,
              timestamp: Date.now()
            });
            
            this.tracer.completeTrace(traceId, true, {
              venue,
              transactionId: result.transactionId,
              totalExecutionTime: Date.now() - startTime
            });
            
            return result;
          }

          // Handle failure with retry
          const retryContext: RetryContext = {
            symbol: order.symbol,
            venue,
            reason: result.reason!,
            attempt: 0,
            maxRetries: 3,
            availableVenues
          };

          const shouldRetry = await this.retryEngine.retry(retryContext);
          if (shouldRetry) {
            // Add retry event to trace
            this.tracer.addEvent(traceId, TraceEventType.RETRY_ATTEMPT, {
              venue: retryContext.venue,
              attempt: retryContext.attempt,
              reason: result.reason
            });
            
            // Try again with the potentially rotated venue
            const retryResult = await this.executeOnVenue(order, retryContext.venue);
            if (retryResult.success) {
              this.trustManager.improve(retryContext.venue);
              this.updatePerformanceMetrics(retryContext.venue, Date.now() - startTime, true);
              this.storeInCache(cacheKey, retryResult);
              
              // Emit telemetry for retry success
              this.telemetryBus.emit('order_retry_success', {
                symbol: order.symbol,
                venue: retryContext.venue,
                originalVenue: venue,
                attempt: retryContext.attempt,
                traceId,
                timestamp: Date.now()
              });
              
              this.tracer.completeTrace(traceId, true, {
                venue: retryContext.venue,
                retrySuccess: true,
                totalExecutionTime: Date.now() - startTime
              });
              
              return retryResult;
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(`Error executing order on ${venue}:`, error, { traceId });
          
          // Add error event to trace
          this.tracer.addEvent(traceId, TraceEventType.ERROR_OCCURRED, {
            venue,
            error: errorMsg
          });
          
          this.updatePerformanceMetrics(venue, Date.now() - startTime, false);
          
          // Emit telemetry for execution error
          this.telemetryBus.emit('order_execution_error', {
            symbol: order.symbol,
            venue,
            error: errorMsg,
            traceId,
            timestamp: Date.now()
          });
        }
      }

      const failureResult = { 
        success: false, 
        venue: '', 
        error: 'All venues failed' 
      };
      this.storeInCache(cacheKey, failureResult);
      
      // Emit telemetry for complete failure
      this.telemetryBus.emit('order_execution_complete_failure', {
        symbol: order.symbol,
        availableVenues: availableVenues.length,
        totalExecutionTime: Date.now() - startTime,
        traceId,
        timestamp: Date.now()
      });
      
      this.tracer.completeTrace(traceId, false, {
        error: 'All venues failed',
        totalExecutionTime: Date.now() - startTime
      });
      
      return failureResult;
      
    } finally {
      // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Return object to pool
      this.returnToPool('executionContext', executionContext);
    }
  }

  private async executeOnVenue(order: Order, venue: string): Promise<ExecutionResult> {
    try {
      // Check if we're in paper mode
      if (isPaperMode()) {
        return this.executePaperModeOrder(order, venue);
      }
      
      // [PRODUCTION MODE] - Real venue execution logic
      // TODO: Implement actual venue execution logic
      // This requires integration with exchange APIs (ccxt, direct APIs, etc.)
      
      logger.warn(`[PRODUCTION MODE] Real venue execution not yet implemented for ${venue}`, {
        symbol: order.symbol,
        side: order.side,
        amount: order.amount,
        venue
      });
      
      // For now, return error in production mode until real adapters are implemented
      return {
        success: false,
        venue,
        reason: 'revert',
        error: 'Real venue execution not yet implemented'
      };
      
      // Future implementation will include:
      // 1. Connect to venue API (via ccxt or direct connection)
      // 2. Check order book depth and liquidity
      // 3. Place order with appropriate parameters
      // 4. Monitor execution status
      // 5. Handle partial fills
      // 6. Return execution result with actual fill price and quantity
    } catch (error) {
      logger.error(`Failed to execute order on ${venue}:`, error);
      return { success: false, venue, reason: 'revert' };
    }
  }

  /**
   * Execute order in paper mode with realistic simulation
   */
  private async executePaperModeOrder(order: Order, venue: string): Promise<ExecutionResult> {
    logPaperModeCall('SmartOrderRouter', 'executePaperModeOrder', {
      symbol: order.symbol,
      side: order.side,
      amount: order.amount,
      venue
    });

    const simulationConfig = getSimulationConfig();
    
    // Simulate execution latency
    const latency = simulationConfig.executionLatency.min + 
      Math.random() * (simulationConfig.executionLatency.max - simulationConfig.executionLatency.min);
    await new Promise(resolve => setTimeout(resolve, latency));
    
    // Simulate network latency
    const networkDelay = simulationConfig.networkLatency.min + 
      Math.random() * (simulationConfig.networkLatency.max - simulationConfig.networkLatency.min);
    await new Promise(resolve => setTimeout(resolve, networkDelay));
    
    // Check for simulated failure
    const shouldFail = Math.random() < simulationConfig.failureRate;
    if (shouldFail) {
      const failureReasons: Array<'revert' | 'outOfGas' | 'slippageTooHigh'> = 
        ['revert', 'outOfGas', 'slippageTooHigh'];
      const reason = failureReasons[Math.floor(Math.random() * failureReasons.length)];
      
      logger.warn(`[PAPER_MODE] Simulated execution failure on ${venue}`, {
        symbol: order.symbol,
        reason
      });
      
      return {
        success: false,
        venue,
        reason,
        error: `Simulated execution failed: ${reason}`
      };
    }
    
    // Calculate realistic execution price with slippage
    let executedPrice = order.price;
    if (simulationConfig.slippageEnabled) {
      // Apply realistic slippage based on order size and market conditions
      const baseSlippage = 0.001; // 0.1% base slippage
      const sizeImpact = Math.min(order.amount * 0.0001, 0.005); // Size impact up to 0.5%
      const volatilityImpact = simulationConfig.priceVolatility * 0.5;
      
      const totalSlippage = baseSlippage + sizeImpact + volatilityImpact;
      const slippageDirection = order.side === 'buy' ? 1 : -1;
      
      executedPrice = order.price * (1 + (slippageDirection * totalSlippage));
    }
    
    // Add price volatility simulation
    if (simulationConfig.priceVolatility > 0) {
      const volatilityAdjustment = (Math.random() - 0.5) * simulationConfig.priceVolatility;
      executedPrice *= (1 + volatilityAdjustment);
    }
    
    // Calculate fees (venue-specific simulation)
    const feeRates: Record<string, number> = {
      binance: 0.001,     // 0.1%
      coinbase: 0.005,    // 0.5%
      uniswap: 0.003,     // 0.3%
      sushiswap: 0.003,   // 0.3%
      '1inch': 0.002,     // 0.2%
      default: 0.002      // 0.2% default
    };
    
    const feeRate = feeRates[venue.toLowerCase()] || feeRates.default;
    const fees = order.amount * executedPrice * feeRate;
    
    // Simulate partial fills (occasionally)
    let executedAmount = order.amount;
    if (Math.random() < 0.1) { // 10% chance of partial fill
      executedAmount = order.amount * (0.5 + Math.random() * 0.5); // 50-100% fill
    }
    
    const result: ExecutionResult = {
      success: true,
      venue,
      transactionId: `paper-tx-${Date.now()}-${venue}-${Math.random().toString(36).substr(2, 9)}`,
      executedPrice: Math.round(executedPrice * 100) / 100, // Round to 2 decimals
      executedAmount,
      fees: Math.round(fees * 100000) / 100000 // Round to 5 decimals
    };
    
    logger.info(`[PAPER_MODE] Order executed successfully`, {
      ...result,
      latencyMs: latency + networkDelay,
      slippagePct: ((executedPrice - order.price) / order.price * 100).toFixed(4)
    });
    
    return result;
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Object pooling implementation
  private getFromPool(type: string): any {
    const pool = this.objectPool.get(type);
    if (!pool || pool.length === 0) {
      return null;
    }
    
    const obj = pool.find(o => !o.inUse);
    if (obj) {
      obj.inUse = true;
      obj.lastUsed = Date.now();
      return obj.data;
    }
    
    return null;
  }
  
  private returnToPool(type: string, obj: any): void {
    let pool = this.objectPool.get(type);
    if (!pool) {
      pool = [];
      this.objectPool.set(type, pool);
    }
    
    if (pool.length < this.maxPoolSize) {
      const pooledObj: PooledObject = {
        id: `${type}-${Date.now()}-${Math.random()}`,
        data: obj,
        inUse: false,
        lastUsed: Date.now()
      };
      pool.push(pooledObj);
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Memoization cache implementation
  private generateCacheKey(order: Order): string {
    return `${order.symbol}-${order.side}-${order.amount}-${order.price}-${order.venues.join(',')}`;
  }
  
  private getFromCache<T>(key: string): T | null {
    const entry = this.memoCache.get(key);
    if (!entry) {
      return null;
    }
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.memoCache.delete(key);
      return null;
    }
    
    // Update access count for LRU
    entry.accessCount++;
    return entry.value;
  }
  
  private storeInCache<T>(key: string, value: T): void {
    // Implement LRU eviction if cache is full
    if (this.memoCache.size >= this.maxCacheSize) {
      this.evictLRU();
    }
    
    this.memoCache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1
    });
  }
  
  private evictLRU(): void {
    let lruKey = '';
    let lruAccessCount = Infinity;
    let oldestTimestamp = Date.now();
    
    for (const [key, entry] of this.memoCache) {
      if (entry.accessCount < lruAccessCount || 
          (entry.accessCount === lruAccessCount && entry.timestamp < oldestTimestamp)) {
        lruKey = key;
        lruAccessCount = entry.accessCount;
        oldestTimestamp = entry.timestamp;
      }
    }
    
    if (lruKey) {
      this.memoCache.delete(lruKey);
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Performance metrics tracking
  private updatePerformanceMetrics(venue: string, executionTime: number, success: boolean): void {
    // Update execution times
    let times = this.performanceMetrics.executionTimes.get(venue);
    if (!times) {
      times = [];
      this.performanceMetrics.executionTimes.set(venue, times);
    }
    times.push(executionTime);
    if (times.length > 100) {
      times.shift(); // Keep only last 100 measurements
    }
    
    // Update success rates
    const currentRate = this.performanceMetrics.successRates.get(venue) || 0;
    const newRate = success ? Math.min(1, currentRate + 0.01) : Math.max(0, currentRate - 0.01);
    this.performanceMetrics.successRates.set(venue, newRate);
    
    // Update timestamp
    this.performanceMetrics.lastUpdated.set(venue, Date.now());
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_MEMORY]: Cleanup timers for memory management
  private startCleanupTimers(): void {
    // Cache cleanup every 5 minutes
    this.cacheCleanupTimer = setInterval(() => {
      this.cleanupCache();
    }, 300000);
    
    // Pool cleanup every 10 minutes
    this.poolCleanupTimer = setInterval(() => {
      this.cleanupObjectPool();
    }, 600000);
  }
  
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoCache) {
      if (now - entry.timestamp > this.cacheTTL) {
        this.memoCache.delete(key);
      }
    }
    
    logger.debug(`Cache cleanup completed, ${this.memoCache.size} entries remaining`);
  }
  
  private cleanupObjectPool(): void {
    const now = Date.now();
    const maxAge = 600000; // 10 minutes
    
    for (const [type, pool] of this.objectPool) {
      const activeObjects = pool.filter(obj => 
        obj.inUse || (now - obj.lastUsed) < maxAge
      );
      this.objectPool.set(type, activeObjects);
    }
    
    logger.debug(`Object pool cleanup completed`);
  }

  // [FIX][CRITICAL] - Add comprehensive cleanup method for memory management
  public cleanup(): void {
    logger.info('Cleaning up SmartOrderRouter resources');
    
    // Clear timers
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }
    
    if (this.poolCleanupTimer) {
      clearInterval(this.poolCleanupTimer);
      this.poolCleanupTimer = undefined;
    }
    
    // Clear all caches and pools
    this.memoCache.clear();
    this.objectPool.clear();
    
    // Clear performance metrics
    this.performanceMetrics.executionTimes.clear();
    this.performanceMetrics.successRates.clear();
    this.performanceMetrics.lastUpdated.clear();
    
    // Clear pre-allocated arrays
    this.preallocatedArrays.venues.length = 0;
    this.preallocatedArrays.results.length = 0;
    this.preallocatedArrays.metrics.length = 0;
    
    // [FIX][CRITICAL] - Cleanup integrated dependencies
    this.retryEngine.cleanup();
    this.trustManager.cleanup();
    
    // Note: TelemetryBus, ExecutionTracer, and MEVProtectionManager are singletons
    // managed by their respective classes and don't require explicit cleanup here
    
    logger.info('SmartOrderRouter cleanup completed');
  }
} 