import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry/types';
import { logger } from '../utils/logger';
import { ExecutionResult, ExecutionStatus, LatencyProfile } from './types';
import { Order, OrderSide, OrderType } from './order';

/**
 * Execution algorithm types
 */
export enum ExecutionAlgorithm {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  TWAP = 'TWAP',
  VWAP = 'VWAP',
  ICEBERG = 'ICEBERG',
  SPREAD = 'SPREAD',
  POV = 'POV',
  ADAPTIVE = 'ADAPTIVE',
}

/**
 * Configuration for TWAP execution
 */
export interface TWAPConfig {
  slices: number;
  intervalMs: number;
  maxIntervalDeviationMs: number;
  minExecutionPct: number;
  randomizeSizes: boolean;
  sizeDeviationPct: number;
}

/**
 * Configuration for VWAP execution
 */
export interface VWAPConfig {
  startTimeOffsetMs: number;
  endTimeOffsetMs: number;
  maxParticipationRate: number;
  minExecutionPct: number;
  useHistoricalProfile: boolean;
  volumeProfile?: number[];
}

/**
 * Configuration for the execution strategy router
 */
export interface ExecutionStrategyConfig {
  defaultStrategy: ExecutionAlgorithm;
  minOrderSizeForTwap: number;
  minOrderSizeForVwap: number;
  twapConfig?: TWAPConfig;
  vwapConfig?: VWAPConfig;
  maxExecutionTimeMs: number;
  symbolStrategyMap: Record<string, ExecutionAlgorithm>;
}

/**
 * Default execution strategy router configuration
 */
const DEFAULT_CONFIG: ExecutionStrategyConfig = {
  defaultStrategy: ExecutionAlgorithm.TWAP,
  minOrderSizeForTwap: 1000,
  minOrderSizeForVwap: 5000,
  maxExecutionTimeMs: 300000, // 5 minutes
  symbolStrategyMap: {},
  twapConfig: {
    slices: 5,
    intervalMs: 60000, // 1 minute
    maxIntervalDeviationMs: 10000, // 10 seconds
    minExecutionPct: 0.95, // 95%
    randomizeSizes: true,
    sizeDeviationPct: 0.1, // 10%
  },
  vwapConfig: {
    startTimeOffsetMs: 0,
    endTimeOffsetMs: 3600000, // 1 hour
    maxParticipationRate: 0.25, // 25%
    minExecutionPct: 0.95, // 95%
    useHistoricalProfile: true,
    volumeProfile: undefined,
  }
};

/**
 * JavaScript fallback implementation of the execution strategy router
 */
export class ExecutionStrategyRouterJs {
  private config: ExecutionStrategyConfig;
  private activeExecutions: Map<string, NodeJS.Timeout> = new Map();
  private static instance: ExecutionStrategyRouterJs | null = null;

  /**
   * Private constructor for singleton pattern
   * @param config Router configuration
   */
  private constructor(config: Partial<ExecutionStrategyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    telemetry.recordMetric('execution_strategy_router.initialization', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Initialized JavaScript fallback ExecutionStrategyRouter');
  }

  /**
   * Get singleton instance
   * @param config Optional custom configuration
   */
  public static getInstance(config?: Partial<ExecutionStrategyConfig>): ExecutionStrategyRouterJs {
    if (!ExecutionStrategyRouterJs.instance) {
      ExecutionStrategyRouterJs.instance = new ExecutionStrategyRouterJs(config);
    }
    return ExecutionStrategyRouterJs.instance;
  }

  /**
   * Execute an order with appropriate strategy
   * @param order Order to execute
   * @param onComplete Callback function for when execution is complete
   */
  public async execute(
    order: Order,
    onComplete: (result: ExecutionResult) => void
  ): Promise<void> {
    try {
      const startTime = Date.now();
      const latencyProfile: LatencyProfile = {
        requestReceived: startTime,
        strategySelected: 0,
        orderCreated: 0,
        orderSent: 0,
        orderAcknowledged: 0,
        orderCompleted: 0,
        executionCompleted: 0
      };
      
      // Validate order parameters
      if (!order.id) {
        throw new Error('Order ID is required');
      }
      
      if (!order.symbol) {
        throw new Error('Order symbol is required');
      }
      
      if (order.amount <= 0) {
        throw new Error(`Invalid order amount: ${order.amount}`);
      }
      
      // Select execution strategy
      const strategy = this.selectStrategy(order);
      latencyProfile.strategySelected = Date.now();
      
      telemetry.recordMetric('execution_strategy_router.strategy_selected', 1, {
        strategy,
        symbol: order.symbol,
        implementation: 'javascript'
      });
      
      // Create simulated execution
      const executionId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      // Record metrics
      telemetry.recordMetric('execution_strategy_router.order_created', order.amount * order.price, {
        order_id: order.id,
        execution_id: executionId,
        strategy,
        symbol: order.symbol,
        implementation: 'javascript'
      });
      
      latencyProfile.orderCreated = Date.now();
      
      // For JavaScript implementation, simulate execution with timeouts
      const executionTimeMs = this.calculateExecutionTime(order, strategy);
      
      logger.info(`Executing order ${order.id} with ${strategy} strategy, estimated time: ${executionTimeMs}ms`);
      
      // Start execution
      const timeoutId = setTimeout(() => {
        try {
          latencyProfile.orderSent = startTime + Math.floor(executionTimeMs * 0.2);
          latencyProfile.orderAcknowledged = startTime + Math.floor(executionTimeMs * 0.3);
          latencyProfile.orderCompleted = startTime + Math.floor(executionTimeMs * 0.9);
          latencyProfile.executionCompleted = Date.now();
          
          // Simulate execution results
          const executedPrice = this.simulateExecutedPrice(order, strategy);
          const executedQuantity = order.amount;
          const slippage = Math.abs((executedPrice - order.price) / order.price);
          
          // Clean up
          this.activeExecutions.delete(order.id);
          
          // Record execution metrics with more detailed telemetry
          telemetry.recordMetric('execution_strategy_router.execution_completed', 1, {
            order_id: order.id,
            execution_id: executionId,
            strategy,
            symbol: order.symbol,
            execution_time_ms: executionTimeMs.toString(),
            slippage: slippage.toString(),
            side: order.side,
            price: executedPrice.toString(),
            quantity: executedQuantity.toString(),
            implementation: 'javascript'
          });
          
          // Calculate fees (simulated)
          const fees = executedPrice * executedQuantity * 0.001; // 0.1% fee
          
          // Return result via callback
          onComplete({
            id: executionId,
            request_id: order.id,
            signal_id: order.additionalParams?.signalId || '',
            status: ExecutionStatus.Completed,
            order_id: `ord-${order.id}`,
            executed_quantity: executedQuantity,
            average_price: executedPrice,
            fee_info: 'Simulated fee: 0.1%',
            fees: fees,
            fee_currency: order.symbol.split('/')[1] || 'USD',
            timestamp: new Date(),
            execution_time_ms: executionTimeMs,
            latency_profile: latencyProfile,
            error_message: null,
            error_context: null,
            realized_pnl: 0, // Would need position data to calculate
            additional_data: {
              strategy,
              implementedBy: 'javascript-fallback'
            },
            rejection_details: null,
            trust_score: 0.8, // Simulated trust score
          });
        } catch (innerErr) {
          const error = innerErr as Error;
          logger.error(`Error in execution callback: ${error.message}`, { stack: error.stack });
          
          telemetry.recordError(
            'ExecutionStrategyRouterJs',
            `Execution callback error: ${error.message}`,
            SeverityLevel.ERROR,
            { 
              order_id: order.id,
              symbol: order.symbol,
              execution_id: executionId,
              strategy,
              error_type: error.name,
              stack: error.stack || ''
            }
          );
          
          // Call the completion callback with an error result
          onComplete({
            id: executionId,
            request_id: order.id,
            signal_id: order.additionalParams?.signalId || '',
            status: ExecutionStatus.Failed,
            order_id: null,
            executed_quantity: null,
            average_price: null,
            fee_info: null,
            fees: null,
            fee_currency: null,
            timestamp: new Date(),
            execution_time_ms: Date.now() - startTime,
            latency_profile: latencyProfile,
            error_message: `Execution callback error: ${error.message}`,
            error_context: 'JavaScript execution callback error',
            realized_pnl: 0,
            additional_data: {
              strategy,
              error_type: error.name,
              implementation: 'javascript-fallback'
            },
            rejection_details: null,
            trust_score: null,
          });
        }
      }, executionTimeMs);
      
      // Save timeout reference for potential cancellation
      this.activeExecutions.set(order.id, timeoutId);
      
    } catch (err) {
      const error = err as Error;
      logger.error(`Error in JavaScript execution strategy router: ${error.message}`, { stack: error.stack });
      
      telemetry.recordError(
        'ExecutionStrategyRouterJs',
        `Execution error: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          order_id: order.id,
          symbol: order.symbol || '',
          error_type: error.name,
          stack: error.stack || '',
          order_details: {
            side: order.side,
            amount: order.amount.toString(),
            price: order.price.toString()
          }
        }
      );
      
      // Call the completion callback with an error result
      onComplete({
        id: `failed-${Date.now()}`,
        request_id: order.id,
        signal_id: order.additionalParams?.signalId || '',
        status: ExecutionStatus.Failed,
        order_id: null,
        executed_quantity: null,
        average_price: null,
        fee_info: null,
        fees: null,
        fee_currency: null,
        timestamp: new Date(),
        execution_time_ms: 0,
        latency_profile: null,
        error_message: error.message,
        error_context: `JavaScript execution error: ${error.name}`,
        realized_pnl: 0,
        additional_data: {
          error_type: error.name,
          implementation: 'javascript-fallback'
        },
        rejection_details: {
          reason: 'execution_error',
          details: error.message
        },
        trust_score: null,
      });
    }
  }

  /**
   * Estimate market impact using selected strategy
   * @param order Order to estimate impact for
   * @returns Estimated impact as a decimal (e.g., 0.001 = 0.1%)
   */
  public async estimateImpact(order: Order): Promise<number> {
    try {
      const strategy = this.selectStrategy(order);
      
      // Simplified impact model
      let baseImpact = 0.0005; // 0.05% base impact
      
      // Adjust based on strategy
      switch (strategy) {
        case ExecutionAlgorithm.MARKET:
          baseImpact *= 2.0; // Market orders have higher impact
          break;
        case ExecutionAlgorithm.TWAP:
          baseImpact *= 0.7; // TWAP reduces impact
          break;
        case ExecutionAlgorithm.VWAP:
          baseImpact *= 0.6; // VWAP has even lower impact
          break;
        case ExecutionAlgorithm.ICEBERG:
          baseImpact *= 0.8; // Iceberg has moderate impact reduction
          break;
      }
      
      // Adjust for order size (larger orders have more impact)
      const sizeMultiplier = 1.0 + (order.amount * order.price / 100000) * 0.5;
      
      // Adjust for order side (sells might have slightly different impact than buys)
      const sideMultiplier = order.side === OrderSide.Sell ? 1.1 : 1.0;
      
      // Calculate final impact
      const impact = baseImpact * sizeMultiplier * sideMultiplier;
      
      telemetry.recordMetric('execution_strategy_router.impact_estimate', impact, {
        symbol: order.symbol,
        strategy,
        implementation: 'javascript'
      });
      
      return impact;
    } catch (err) {
      logger.error(`Error estimating impact in JavaScript: ${err}`);
      return 0.001; // Default impact
    }
  }

  /**
   * Estimate execution cost
   * @param order Order to estimate cost for
   * @returns Estimated cost in quote currency
   */
  public async getCostEstimate(order: Order): Promise<number> {
    try {
      const strategy = this.selectStrategy(order);
      
      // Base fee rate
      let feeRate = 0.001; // 0.1% base fee
      
      // Adjust based on strategy
      switch (strategy) {
        case ExecutionAlgorithm.MARKET:
          feeRate = 0.0015; // Higher fees for market orders
          break;
        case ExecutionAlgorithm.LIMIT:
          feeRate = 0.001; // Base fee for limit orders
          break;
        case ExecutionAlgorithm.TWAP:
        case ExecutionAlgorithm.VWAP:
          feeRate = 0.00125; // Slightly higher for algorithmic execution
          break;
      }
      
      // Calculate estimated fee
      const fee = order.amount * order.price * feeRate;
      
      // Calculate estimated slippage cost
      const impact = await this.estimateImpact(order);
      const slippageCost = order.amount * order.price * impact;
      
      // Total cost is fee + slippage
      const totalCost = fee + slippageCost;
      
      telemetry.recordMetric('execution_strategy_router.cost_estimate', totalCost, {
        symbol: order.symbol,
        strategy,
        fee: fee.toString(),
        slippage: slippageCost.toString(),
        implementation: 'javascript'
      });
      
      return totalCost;
    } catch (err) {
      logger.error(`Error getting cost estimate in JavaScript: ${err}`);
      return order.amount * order.price * 0.002; // Default cost
    }
  }

  /**
   * Cancel execution for an order
   * @param orderId Order ID to cancel
   */
  public async cancelExecution(orderId: string): Promise<void> {
    try {
      const timeoutId = this.activeExecutions.get(orderId);
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.activeExecutions.delete(orderId);
        
        telemetry.recordMetric('execution_strategy_router.cancel', 1, {
          order_id: orderId,
          implementation: 'javascript'
        });
        
        logger.info(`Canceled execution for order ${orderId}`);
      } else {
        logger.warn(`Order ${orderId} not found or already completed`);
      }
    } catch (err) {
      logger.error(`Error cancelling execution in JavaScript: ${err}`);
    }
  }

  /**
   * Update router configuration
   * @param config New configuration
   */
  public updateConfig(config: Partial<ExecutionStrategyConfig>): void {
    this.config = { ...this.config, ...config };
    
    telemetry.recordMetric('execution_strategy_router.config_update', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Updated ExecutionStrategyRouterJs configuration');
  }

  /**
   * Select the best execution strategy for an order
   * @param order Order to select strategy for
   * @returns Selected execution algorithm
   */
  private selectStrategy(order: Order): ExecutionAlgorithm {
    // Check symbol-specific strategy map
    if (this.config.symbolStrategyMap[order.symbol]) {
      return this.config.symbolStrategyMap[order.symbol];
    }
    
    // For market orders, use market execution
    if (order.type === OrderType.Market) {
      return ExecutionAlgorithm.MARKET;
    }
    
    // Size-based strategy selection
    const orderValue = order.amount * order.price;
    
    if (orderValue >= this.config.minOrderSizeForVwap) {
      return ExecutionAlgorithm.VWAP;
    } else if (orderValue >= this.config.minOrderSizeForTwap) {
      return ExecutionAlgorithm.TWAP;
    }
    
    // Default strategy
    return this.config.defaultStrategy;
  }

  /**
   * Calculate simulated execution time based on strategy and order
   * @param order Order to execute
   * @param strategy Selected strategy
   * @returns Execution time in milliseconds
   */
  private calculateExecutionTime(order: Order, strategy: ExecutionAlgorithm): number {
    let baseTimeMs = 500; // Base execution time
    
    switch (strategy) {
      case ExecutionAlgorithm.MARKET:
        return Math.min(baseTimeMs + Math.random() * 1000, 3000);
      
      case ExecutionAlgorithm.LIMIT:
        return Math.min(baseTimeMs + Math.random() * 5000, 10000);
      
      case ExecutionAlgorithm.TWAP:
        // For TWAP, use config parameters
        if (this.config.twapConfig) {
          return this.config.twapConfig.slices * this.config.twapConfig.intervalMs;
        }
        return 300000; // 5 minutes default
      
      case ExecutionAlgorithm.VWAP:
        // For VWAP, use config parameters
        if (this.config.vwapConfig) {
          return this.config.vwapConfig.endTimeOffsetMs;
        }
        return 3600000; // 1 hour default
      
      default:
        return Math.min(this.config.maxExecutionTimeMs, 30000); // Default to 30 seconds max
    }
  }

  /**
   * Simulate execution price based on strategy and current market conditions
   * @param order Order being executed
   * @param strategy Execution strategy used
   * @returns Simulated executed price
   */
  private simulateExecutedPrice(order: Order, strategy: ExecutionAlgorithm): number {
    // Base price from order
    const basePrice = order.price;
    
    // Randomize slippage based on strategy
    let maxSlippagePct: number;
    
    switch (strategy) {
      case ExecutionAlgorithm.MARKET:
        maxSlippagePct = 0.005; // 0.5% max slippage for market orders
        break;
      case ExecutionAlgorithm.LIMIT:
        maxSlippagePct = 0.0005; // 0.05% max slippage for limit orders
        break;
      case ExecutionAlgorithm.TWAP:
        maxSlippagePct = 0.002; // 0.2% max slippage for TWAP
        break;
      case ExecutionAlgorithm.VWAP:
        maxSlippagePct = 0.0015; // 0.15% max slippage for VWAP
        break;
      default:
        maxSlippagePct = 0.001; // 0.1% default max slippage
    }
    
    // Calculate random slippage (can be positive or negative)
    const slippagePct = (Math.random() * 2 - 1) * maxSlippagePct;
    
    // More slippage for sell orders than buy orders (typical market behavior)
    const adjustedSlippagePct = order.side === OrderSide.Sell ? 
      slippagePct - 0.0005 : slippagePct;
    
    // Apply slippage to price
    return basePrice * (1 + adjustedSlippagePct);
  }
} 