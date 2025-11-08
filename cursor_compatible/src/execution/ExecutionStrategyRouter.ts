import { logger } from '../utils/logger.js';
import { Order, ExecutionResult } from './types/execution.types.js';
import { TWAPExecutor, TWAPConfig } from './algorithms/twap.js';
import { VWAPExecutor, VWAPConfig } from './algorithms/vwap.js';

/**
 * Configuration for execution strategy router
 */
export interface ExecutionStrategyConfig {
  defaultStrategy: 'TWAP' | 'VWAP';
  twapConfig?: Partial<TWAPConfig>;
  vwapConfig?: Partial<VWAPConfig>;
  minOrderSizeForTWAP: number;
  minOrderSizeForVWAP: number;
}

/**
 * Default configuration for execution strategy router
 */
export const DEFAULT_EXECUTION_STRATEGY_CONFIG: ExecutionStrategyConfig = {
  defaultStrategy: 'TWAP',
  minOrderSizeForTWAP: 1000,
  minOrderSizeForVWAP: 5000
};

/**
 * Execution Strategy Router
 */
export class ExecutionStrategyRouter {
  private static instance: ExecutionStrategyRouter | null = null;
  private config: ExecutionStrategyConfig;
  private twapExecutor: TWAPExecutor;
  private vwapExecutor: VWAPExecutor;

  private constructor(config: Partial<ExecutionStrategyConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTION_STRATEGY_CONFIG, ...config };
    this.twapExecutor = new TWAPExecutor(this.config.twapConfig);
    this.vwapExecutor = new VWAPExecutor(this.config.vwapConfig);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ExecutionStrategyConfig>): ExecutionStrategyRouter {
    if (!ExecutionStrategyRouter.instance) {
      ExecutionStrategyRouter.instance = new ExecutionStrategyRouter(config);
    }
    return ExecutionStrategyRouter.instance;
  }

  /**
   * Execute an order using the appropriate strategy
   */
  public async execute(
    order: Order,
    onComplete: (results: ExecutionResult[]) => void
  ): Promise<void> {
    try {
      const strategy = this.selectExecutionStrategy(order);
      logger.info(`Selected ${strategy} execution strategy for order ${order.id}`);

      if (strategy === 'TWAP') {
        await this.twapExecutor.execute(order, onComplete);
      } else {
        await this.vwapExecutor.execute(order, onComplete);
      }
    } catch (error) {
      logger.error('Error in execution strategy router:', error);
      throw error;
    }
  }

  /**
   * Select the appropriate execution strategy based on order parameters
   */
  private selectExecutionStrategy(order: Order): 'TWAP' | 'VWAP' {
    // Check if order has a specific execution mode
    if (order.executionMode === 'TWAP') return 'TWAP';
    if (order.executionMode === 'VWAP') return 'VWAP';

    // Select based on order size
    if (order.amount >= this.config.minOrderSizeForVWAP) {
      return 'VWAP';
    } else if (order.amount >= this.config.minOrderSizeForTWAP) {
      return 'TWAP';
    }

    // Default to configured strategy
    return this.config.defaultStrategy;
  }

  /**
   * Estimate the impact of executing an order
   */
  public async estimateImpact(order: Order): Promise<number> {
    const strategy = this.selectExecutionStrategy(order);
    
    if (strategy === 'TWAP') {
      return this.twapExecutor.estimateImpact(order);
    } else {
      return this.vwapExecutor.estimateImpact(order);
    }
  }

  /**
   * Get cost estimate for executing an order
   */
  public async getCostEstimate(order: Order): Promise<number> {
    const strategy = this.selectExecutionStrategy(order);
    
    if (strategy === 'TWAP') {
      return this.twapExecutor.getCostEstimate(order);
    } else {
      return this.vwapExecutor.getCostEstimate(order);
    }
  }
} 