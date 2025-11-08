/**
 * Realistic Exchange Connector - Production-Grade Paper Trading Simulation
 * 
 * Extends MockExchangeConnector with realistic constraints including:
 * - Rate limiting simulation
 * - Realistic latency profiles
 * - Infrastructure failure modeling
 * - Partial fill simulation
 * - Realism validation and tracking
 */

import { MockExchangeConnector, MockExchangeConfig } from './MockExchangeConnector';
import { RateLimiter, RateLimitResult, EndpointLimits } from '../../utils/RateLimiter';
import { LatencyProfile, LatencyResult, EndpointLatencies, NetworkCondition } from '../../utils/LatencyProfile';
import { FailureSimulator, FailureResult, FailureConfig, FailureType } from '../../utils/FailureSimulator';
import { RealismTracker, RealismMetrics, RealismAlert, RealismThresholds } from '../../utils/RealismTracker';
import { 
  OrderRequest, 
  OrderResponse, 
  OrderBook, 
  Quote, 
  TradeHistory, 
  ExchangeStatus, 
  BalanceInfo 
} from '../interfaces/IExchangeConnector';
import { logger } from '../../utils/logger';

export type RealismLevel = 'low' | 'medium' | 'high' | 'maximum';

export interface RealisticConfig extends MockExchangeConfig {
  // Realism settings
  realismLevel?: RealismLevel;
  enableRateLimiting?: boolean;
  enableLatencySimulation?: boolean;
  enableFailureSimulation?: boolean;
  enablePartialFills?: boolean;
  enableRealismTracking?: boolean;
  
  // Component-specific configs
  rateLimitConfig?: Partial<EndpointLimits>;
  latencyConfig?: Partial<EndpointLatencies>;
  failureConfig?: Partial<FailureConfig>;
  realismThresholds?: Partial<RealismThresholds>;
  
  // Network conditions
  initialNetworkCondition?: string;
  dynamicConditions?: boolean;
  
  // Partial fill settings
  partialFillProbability?: number;
  minFillPercentage?: number;
  maxFillTime?: number;
}

export interface RealisticExecutionResult {
  success: boolean;
  rateLimited: boolean;
  latency: number;
  partialFill: boolean;
  fillPercentage: number;
  slippage: number;
  errorCode?: number;
  errorMessage?: string;
  retryAfter?: number;
}

export class RealisticExchangeConnector extends MockExchangeConnector {
  private realismConfig: RealisticConfig;
  
  // Realism components - initialized in constructor
  private rateLimiter!: RateLimiter;
  private latencyProfile!: LatencyProfile;
  private failureSimulator!: FailureSimulator;
  private realismTracker!: RealismTracker;
  
  // State tracking
  private executionCount: number = 0;
  private partialFillOrders: Map<string, { original: OrderResponse; fillProgress: number; lastUpdate: number }> = new Map();
  private networkConditionTimer?: NodeJS.Timeout;
  
  // Performance metrics
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
    averageLatency: 0,
    totalPartialFills: 0
  };

  constructor(
    exchangeId: string = 'realistic_exchange',
    exchangeName: string = 'Realistic Mock Exchange',
    config?: RealisticConfig
  ) {
    // Initialize parent with enhanced config
    super(exchangeId, exchangeName, config);
    
    this.realismConfig = {
      realismLevel: 'high',
      enableRateLimiting: true,
      enableLatencySimulation: true,
      enableFailureSimulation: true,
      enablePartialFills: true,
      enableRealismTracking: true,
      partialFillProbability: 0.15,    // 15% chance of partial fills
      minFillPercentage: 0.3,          // Minimum 30% fill
      maxFillTime: 10000,              // 10 seconds max fill time
      initialNetworkCondition: 'good',
      dynamicConditions: true,
      ...config
    };

    // Initialize realism components
    this.initializeRealismComponents();
    
    logger.info('[REALISTIC_EXCHANGE] Realistic exchange connector initialized', {
      exchangeId,
      realismLevel: this.realismConfig.realismLevel,
      components: {
        rateLimiting: this.realismConfig.enableRateLimiting,
        latencySimulation: this.realismConfig.enableLatencySimulation,
        failureSimulation: this.realismConfig.enableFailureSimulation,
        partialFills: this.realismConfig.enablePartialFills,
        realismTracking: this.realismConfig.enableRealismTracking
      }
    });
  }

  /**
   * Enhanced connection with realistic constraints
   */
  async connect(): Promise<boolean> {
    logger.info('[REALISTIC_EXCHANGE] Attempting connection with realistic constraints');
    
    // Check rate limiting
    const rateLimitResult = this.checkRateLimit('connect');
    if (!rateLimitResult.allowed) {
      logger.warn('[REALISTIC_EXCHANGE] Connection rate limited', { retryAfter: rateLimitResult.retryAfter });
      return false;
    }
    
    // Check for failures
    const failureResult = this.checkFailure('connect');
    if (failureResult.shouldFail) {
      logger.warn('[REALISTIC_EXCHANGE] Connection failed due to simulated failure', {
        type: failureResult.failureType?.name,
        errorCode: failureResult.errorCode,
        retryAfter: failureResult.retryAfter
      });
      return false;
    }
    
    // Simulate realistic latency
    const latencyResult = await this.simulateLatencyInternal('connect');
    
    // Call parent connect method
    const success = await super.connect();
    
    // Track realism metrics
    this.trackExecution({
      success,
      rateLimited: false,
      latency: latencyResult.latency,
      partialFill: false,
      fillPercentage: success ? 1 : 0,
      slippage: 0
    });
    
    if (success && this.realismConfig.dynamicConditions) {
      this.startDynamicConditions();
    }
    
    return success;
  }

  /**
   * Enhanced order submission with realistic constraints
   */
  async submitOrder(order: OrderRequest): Promise<OrderResponse> {
    this.executionCount++;
    this.metrics.totalRequests++;
    
    logger.debug('[REALISTIC_EXCHANGE] Processing order with realistic constraints', {
      orderId: this.executionCount,
      symbol: order.symbol,
      type: order.type,
      amount: order.amount
    });
    
    // 1. Check rate limiting
    const rateLimitResult = this.checkRateLimit('submitOrder');
    if (!rateLimitResult.allowed) {
      this.metrics.rateLimitedRequests++;
      const error = new Error(`Rate limit exceeded. Retry after ${rateLimitResult.retryAfter} seconds`);
      (error as any).code = 429;
      (error as any).retryAfter = rateLimitResult.retryAfter;
      throw error;
    }
    
    // 2. Check for infrastructure failures
    const failureResult = this.checkFailure('submitOrder');
    if (failureResult.shouldFail) {
      this.metrics.failedRequests++;
      const error = new Error(failureResult.errorMessage || 'Order submission failed');
      (error as any).code = failureResult.errorCode || 500;
      (error as any).retryAfter = failureResult.retryAfter;
      throw error;
    }
    
    // 3. Simulate realistic latency
    const latencyResult = await this.simulateLatencyInternal('submitOrder');
    
    // 4. Submit order through parent
    let orderResponse: OrderResponse;
    try {
      orderResponse = await super.submitOrder(order);
      this.metrics.successfulRequests++;
    } catch (error) {
      this.metrics.failedRequests++;
      
      // Track failed execution
      this.trackExecution({
        success: false,
        rateLimited: rateLimitResult.retryAfter !== undefined,
        latency: latencyResult.latency,
        partialFill: false,
        fillPercentage: 0,
        slippage: 0
      });
      
      throw error;
    }
    
    // 5. Apply partial fill simulation
    const { shouldPartialFill, fillPercentage } = this.simulatePartialFill(orderResponse);
    
    if (shouldPartialFill) {
      orderResponse = this.applyPartialFill(orderResponse, fillPercentage);
      this.metrics.totalPartialFills++;
    }
    
    // 6. Calculate realistic slippage
    const slippage = this.calculateRealisticSlippage(order, orderResponse);
    if (slippage > 0 && orderResponse.price) {
      orderResponse.price = orderResponse.price * (1 + slippage);
    }
    
    // 7. Track execution metrics
    this.trackExecution({
      success: true,
      rateLimited: false,
      latency: latencyResult.latency,
      partialFill: shouldPartialFill,
      fillPercentage,
      slippage
    });
    
    logger.info('[REALISTIC_EXCHANGE] Order processed successfully', {
      orderId: orderResponse.orderId,
      amount: orderResponse.amount,
      partialFill: shouldPartialFill,
      fillPercentage,
      slippage: slippage.toFixed(4),
      latency: latencyResult.latency
    });
    
    return orderResponse;
  }

  /**
   * Enhanced order book retrieval with realistic constraints
   */
  async getOrderBook(symbol: string, depth: number = 50): Promise<OrderBook> {
    // Check rate limiting for market data
    const rateLimitResult = this.checkRateLimit('getOrderBook');
    if (!rateLimitResult.allowed) {
      const error = new Error(`Rate limit exceeded for market data. Retry after ${rateLimitResult.retryAfter} seconds`);
      (error as any).code = 429;
      throw error;
    }
    
    // Check for failures
    const failureResult = this.checkFailure('getOrderBook');
    if (failureResult.shouldFail) {
      const error = new Error(failureResult.errorMessage || 'Market data unavailable');
      (error as any).code = failureResult.errorCode || 503;
      throw error;
    }
    
    // Simulate latency
    await this.simulateLatencyInternal('getOrderBook');
    
    // Get order book from parent
    return await super.getOrderBook(symbol, depth);
  }

  /**
   * Enhanced quote retrieval with realistic constraints
   */
  async getQuote(symbol: string): Promise<Quote> {
    const rateLimitResult = this.checkRateLimit('getQuote');
    if (!rateLimitResult.allowed) {
      const error = new Error(`Rate limit exceeded for quotes. Retry after ${rateLimitResult.retryAfter} seconds`);
      (error as any).code = 429;
      throw error;
    }
    
    const failureResult = this.checkFailure('getQuote');
    if (failureResult.shouldFail) {
      const error = new Error(failureResult.errorMessage || 'Quote unavailable');
      (error as any).code = failureResult.errorCode || 503;
      throw error;
    }
    
    await this.simulateLatencyInternal('getQuote');
    
    return await super.getQuote(symbol);
  }

  /**
   * Enhanced balance retrieval with realistic constraints
   */
  async getBalances(): Promise<BalanceInfo[]> {
    const rateLimitResult = this.checkRateLimit('getBalances');
    if (!rateLimitResult.allowed) {
      const error = new Error(`Rate limit exceeded for account data. Retry after ${rateLimitResult.retryAfter} seconds`);
      (error as any).code = 429;
      throw error;
    }
    
    const failureResult = this.checkFailure('getBalances');
    if (failureResult.shouldFail) {
      const error = new Error(failureResult.errorMessage || 'Account data unavailable');
      (error as any).code = failureResult.errorCode || 503;
      throw error;
    }
    
    await this.simulateLatencyInternal('getBalances');
    
    return await super.getBalances();
  }

  /**
   * Get realism metrics and status
   */
  getRealismStatus(): {
    realismScore: number;
    metrics: RealismMetrics;
    alerts: RealismAlert[];
    componentStatus: {
      rateLimiter: any;
      latencyProfile: any;
      failureSimulator: any;
    };
    executionMetrics: typeof this.metrics;
  } {
    return {
      realismScore: this.realismTracker.getRealismScore(),
      metrics: this.realismTracker.getMetrics(),
      alerts: this.realismTracker.getAlerts(),
      componentStatus: {
        rateLimiter: this.rateLimiter.getStatus(),
        latencyProfile: this.latencyProfile.getStatistics(),
        failureSimulator: this.failureSimulator.getStatistics()
      },
      executionMetrics: { ...this.metrics }
    };
  }

  /**
   * Update realism configuration
   */
  updateRealismConfig(updates: Partial<RealisticConfig>): void {
    this.realismConfig = { ...this.realismConfig, ...updates };
    
    // Update component configurations
    if (updates.rateLimitConfig && this.rateLimiter) {
      // Rate limiter config updates would need individual methods
    }
    
    if (updates.initialNetworkCondition && this.latencyProfile) {
      this.latencyProfile.setNetworkCondition(updates.initialNetworkCondition);
    }
    
    if (updates.failureConfig && this.failureSimulator) {
      this.failureSimulator.updateConfig(updates.failureConfig);
    }
    
    logger.info('[REALISTIC_EXCHANGE] Realism configuration updated', updates);
  }

  /**
   * Force specific network condition (for testing)
   */
  setNetworkCondition(condition: string): boolean {
    const success = this.latencyProfile.setNetworkCondition(condition);
    if (success) {
      logger.info('[REALISTIC_EXCHANGE] Network condition changed', { condition });
    }
    return success;
  }

  /**
   * Simulate specific failure (for testing)
   */
  simulateSpecificFailure(failureType: string, endpoint: string = 'test'): FailureResult {
    return this.failureSimulator.simulateFailure(failureType, endpoint);
  }

  /**
   * Get detailed realism report
   */
  getRealismReport(): any {
    const report = this.realismTracker.getRealismReport();
    
    return {
      ...report,
      componentDetails: {
        rateLimiter: {
          status: this.rateLimiter.getStatus(),
          enabled: this.realismConfig.enableRateLimiting
        },
        latencyProfile: {
          statistics: this.latencyProfile.getStatistics(),
          currentCondition: this.latencyProfile.getCurrentCondition(),
          enabled: this.realismConfig.enableLatencySimulation
        },
        failureSimulator: {
          statistics: this.failureSimulator.getStatistics(),
          activeFailures: this.failureSimulator.getActiveFailures(),
          enabled: this.realismConfig.enableFailureSimulation
        }
      },
      executionStatistics: {
        ...this.metrics,
        successRate: this.metrics.totalRequests > 0 ? this.metrics.successfulRequests / this.metrics.totalRequests : 0,
        rateLimitedRate: this.metrics.totalRequests > 0 ? this.metrics.rateLimitedRequests / this.metrics.totalRequests : 0,
        partialFillRate: this.metrics.successfulRequests > 0 ? this.metrics.totalPartialFills / this.metrics.successfulRequests : 0
      }
    };
  }

  /**
   * Cleanup method
   */
  async cleanup(): Promise<void> {
    if (this.networkConditionTimer) {
      clearInterval(this.networkConditionTimer);
      this.networkConditionTimer = undefined;
    }
    
    await super.cleanup();
    
    logger.info('[REALISTIC_EXCHANGE] Realistic exchange connector cleaned up');
  }

  /**
   * Initialize all realism components
   */
  private initializeRealismComponents(): void {
    // Initialize rate limiter
    const rateLimitConfig = this.getRateLimitConfigForRealism();
    this.rateLimiter = new RateLimiter(rateLimitConfig, this.realismConfig.enableRateLimiting);
    
    // Initialize latency profile
    const latencyConfig = this.getLatencyConfigForRealism();
    this.latencyProfile = new LatencyProfile(
      latencyConfig, 
      this.realismConfig.enableLatencySimulation,
      this.realismConfig.initialNetworkCondition
    );
    
    // Initialize failure simulator
    const failureConfig = this.getFailureConfigForRealism();
    this.failureSimulator = new FailureSimulator(failureConfig, this.realismConfig.enableFailureSimulation);
    
    // Initialize realism tracker
    this.realismTracker = new RealismTracker(
      this.realismConfig.realismThresholds,
      this.realismConfig.enableRealismTracking
    );
    
    logger.debug('[REALISTIC_EXCHANGE] Realism components initialized', {
      realismLevel: this.realismConfig.realismLevel
    });
  }

  /**
   * Get rate limit configuration based on realism level
   */
  private getRateLimitConfigForRealism(): Partial<EndpointLimits> {
    const baseConfig = this.realismConfig.rateLimitConfig || {};
    
    switch (this.realismConfig.realismLevel) {
      case 'low':
        return {
          orders: { maxTokens: 50, refillRate: 50, refillInterval: 1000, burstAllowance: 25 },
          market_data: { maxTokens: 500, refillRate: 500, refillInterval: 1000, burstAllowance: 250 },
          ...baseConfig
        };
      case 'medium':
        return {
          orders: { maxTokens: 20, refillRate: 20, refillInterval: 1000, burstAllowance: 10 },
          market_data: { maxTokens: 200, refillRate: 200, refillInterval: 1000, burstAllowance: 100 },
          ...baseConfig
        };
      case 'high':
        return {
          orders: { maxTokens: 10, refillRate: 10, refillInterval: 1000, burstAllowance: 5 },
          market_data: { maxTokens: 100, refillRate: 100, refillInterval: 1000, burstAllowance: 50 },
          ...baseConfig
        };
      case 'maximum':
        return {
          orders: { maxTokens: 5, refillRate: 5, refillInterval: 1000, burstAllowance: 2 },
          market_data: { maxTokens: 50, refillRate: 50, refillInterval: 1000, burstAllowance: 25 },
          ...baseConfig
        };
      default:
        return baseConfig;
    }
  }

  /**
   * Get latency configuration based on realism level
   */
  private getLatencyConfigForRealism(): Partial<EndpointLatencies> {
    const baseConfig = this.realismConfig.latencyConfig || {};
    
    const multiplier = this.getLatencyMultiplier();
    
    return {
      orders: {
        baseLatency: 150 * multiplier,
        variability: 50 * multiplier,
        percentile95: 500 * multiplier,
        jitter: 0.1
      },
      market_data: {
        baseLatency: 80 * multiplier,
        variability: 30 * multiplier,
        percentile95: 200 * multiplier,
        jitter: 0.15
      },
      ...baseConfig
    };
  }

  /**
   * Get failure configuration based on realism level
   */
  private getFailureConfigForRealism(): Partial<FailureConfig> {
    const baseConfig = this.realismConfig.failureConfig || {};
    
    let probability: number;
    switch (this.realismConfig.realismLevel) {
      case 'low':
        probability = 0.005;    // 0.5% failure rate
        break;
      case 'medium':
        probability = 0.01;     // 1% failure rate
        break;
      case 'high':
        probability = 0.02;     // 2% failure rate
        break;
      case 'maximum':
        probability = 0.05;     // 5% failure rate
        break;
      default:
        probability = 0.02;
    }
    
    return {
      probability,
      escalation: this.realismConfig.realismLevel === 'maximum',
      ...baseConfig
    };
  }

  /**
   * Get latency multiplier based on realism level
   */
  private getLatencyMultiplier(): number {
    switch (this.realismConfig.realismLevel) {
      case 'low':
        return 0.5;
      case 'medium':
        return 0.8;
      case 'high':
        return 1.0;
      case 'maximum':
        return 1.5;
      default:
        return 1.0;
    }
  }

  /**
   * Check rate limiting for endpoint
   */
  private checkRateLimit(endpoint: string): RateLimitResult {
    if (!this.realismConfig.enableRateLimiting) {
      return { allowed: true, remainingTokens: 1000, resetTime: Date.now() + 60000 };
    }
    
    return this.rateLimiter.checkLimit(endpoint);
  }

  /**
   * Check for infrastructure failures
   */
  private checkFailure(endpoint: string): FailureResult {
    if (!this.realismConfig.enableFailureSimulation) {
      return { shouldFail: false, timestamp: Date.now() };
    }
    
    return this.failureSimulator.shouldFail(endpoint);
  }

  /**
   * Simulate realistic latency (internal method to avoid parent method conflict)
   */
  private async simulateLatencyInternal(endpoint: string): Promise<LatencyResult> {
    if (!this.realismConfig.enableLatencySimulation) {
      return { latency: 0, endpoint, networkCondition: 'disabled', timestamp: Date.now() };
    }
    
    return await this.latencyProfile.simulateDelay(endpoint);
  }

  /**
   * Simulate partial fills
   */
  private simulatePartialFill(order: OrderResponse): { shouldPartialFill: boolean; fillPercentage: number } {
    if (!this.realismConfig.enablePartialFills || order.status !== 'filled') {
      return { shouldPartialFill: false, fillPercentage: 1 };
    }
    
    const shouldPartialFill = Math.random() < (this.realismConfig.partialFillProbability || 0.15);
    
    if (shouldPartialFill) {
      const minFill = this.realismConfig.minFillPercentage || 0.3;
      const fillPercentage = minFill + Math.random() * (1 - minFill);
      return { shouldPartialFill: true, fillPercentage };
    }
    
    return { shouldPartialFill: false, fillPercentage: 1 };
  }

  /**
   * Apply partial fill to order
   */
  private applyPartialFill(order: OrderResponse, fillPercentage: number): OrderResponse {
    const filledAmount = order.amount * fillPercentage;
    
    return {
      ...order,
      status: fillPercentage < 1 ? 'partial' : 'filled',
      amount: filledAmount
    };
  }

  /**
   * Calculate realistic slippage
   */
  private calculateRealisticSlippage(request: OrderRequest, response: OrderResponse): number {
    // Base slippage factors
    const baseLiquidity = 0.001;  // 0.1% base slippage
    const marketImpact = request.amount > 10000 ? 0.002 : 0.0005; // Higher slippage for large orders
    const volatilityFactor = Math.random() * 0.001; // Random volatility component
    
    return baseLiquidity + marketImpact + volatilityFactor;
  }

  /**
   * Track execution for realism metrics
   */
  private trackExecution(result: RealisticExecutionResult): void {
    if (!this.realismConfig.enableRealismTracking) return;
    
    this.realismTracker.reportExecution({
      success: result.success,
      latency: result.latency,
      filled: result.fillPercentage > 0.99,
      partialFill: result.partialFill,
      slippage: result.slippage,
      rateLimited: result.rateLimited
    });
    
    // Update internal metrics
    this.metrics.averageLatency = (
      (this.metrics.averageLatency * (this.executionCount - 1)) + result.latency
    ) / this.executionCount;
  }

  /**
   * Start dynamic network condition changes
   */
  private startDynamicConditions(): void {
    if (!this.realismConfig.dynamicConditions) return;
    
    const self = this;
    this.networkConditionTimer = setInterval(() => {
      // Randomly change network conditions
      if (Math.random() < 0.1) { // 10% chance every interval
        const conditions = self.latencyProfile.getAvailableConditions();
        const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
        self.latencyProfile.setNetworkCondition(randomCondition.name);
        
        logger.debug('[REALISTIC_EXCHANGE] Dynamic network condition change', {
          newCondition: randomCondition.name
        });
      }
    }, 30000); // Check every 30 seconds
  }
} 