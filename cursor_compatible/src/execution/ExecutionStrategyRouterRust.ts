import { 
  NapiExecutionStrategyRouter, 
  ExecutionStrategyConfigParams, 
  TWAPConfigParams,
  VWAPConfigParams,
  ExecutionAlgorithm
} from '@noderr/core';
import { ExecutionResult } from './types';
import { Order } from './order';

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

// Re-export ExecutionAlgorithm to maintain compatibility
export { ExecutionAlgorithm };

/**
 * Rust-powered execution strategy router
 * High-performance implementation using native Rust code
 */
export class ExecutionStrategyRouterRust {
  private router: NapiExecutionStrategyRouter;
  private static instance: ExecutionStrategyRouterRust | null = null;

  /**
   * Create a new ExecutionStrategyRouterRust instance
   * @param config Router configuration
   */
  private constructor(config: Partial<ExecutionStrategyConfig> = {}) {
    const mergedConfig = this.mergeWithDefaultConfig(config);
    this.router = new NapiExecutionStrategyRouter(this.convertToNativeConfig(mergedConfig));
  }

  /**
   * Get singleton instance
   * @param config Optional custom configuration
   */
  public static getInstance(config?: Partial<ExecutionStrategyConfig>): ExecutionStrategyRouterRust {
    if (!ExecutionStrategyRouterRust.instance) {
      ExecutionStrategyRouterRust.instance = new ExecutionStrategyRouterRust(config);
    }
    return ExecutionStrategyRouterRust.instance;
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
      // Convert the order to native format
      const nativeOrder = this.convertOrderToNative(order);
      
      // Execute using the native router
      await this.router.execute_order(nativeOrder, onComplete);
    } catch (err) {
      console.error('Error in Rust execution strategy router:', err);
      
      // Call the completion callback with an error result
      onComplete({
        id: `failed-${Date.now()}`,
        request_id: order.id,
        signal_id: '',
        status: 'failed',
        order_id: null,
        executed_quantity: null,
        average_price: null,
        fee_info: null,
        fees: null,
        fee_currency: null,
        timestamp: new Date(),
        execution_time_ms: 0,
        latency_profile: null,
        error_message: (err as Error).message,
        error_context: 'Rust execution error',
        realized_pnl: 0,
        additional_data: {},
        rejection_details: null,
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
      const nativeOrder = this.convertOrderToNative(order);
      return await this.router.estimate_impact(nativeOrder);
    } catch (err) {
      console.error('Error estimating impact in Rust:', err);
      return 0.003; // Default fallback impact
    }
  }

  /**
   * Estimate execution cost
   * @param order Order to estimate cost for
   * @returns Estimated cost in quote currency
   */
  public async getCostEstimate(order: Order): Promise<number> {
    try {
      const nativeOrder = this.convertOrderToNative(order);
      return await this.router.get_cost_estimate(nativeOrder);
    } catch (err) {
      console.error('Error getting cost estimate in Rust:', err);
      return order.amount * order.price * 0.002; // Default fallback cost (0.2%)
    }
  }

  /**
   * Cancel execution for an order
   * @param orderId Order ID to cancel
   */
  public async cancelExecution(orderId: string): Promise<void> {
    try {
      await this.router.cancel_execution(orderId);
    } catch (err) {
      console.error('Error cancelling execution in Rust:', err);
    }
  }

  /**
   * Update router configuration
   * @param config New configuration
   */
  public async updateConfig(config: Partial<ExecutionStrategyConfig>): Promise<void> {
    try {
      const mergedConfig = this.mergeWithDefaultConfig(config);
      await this.router.update_config(this.convertToNativeConfig(mergedConfig));
    } catch (err) {
      console.error('Error updating config in Rust:', err);
    }
  }

  /**
   * Merge provided config with default config
   * @param config Partial config to merge
   * @returns Complete merged config
   */
  private mergeWithDefaultConfig(config: Partial<ExecutionStrategyConfig>): ExecutionStrategyConfig {
    // Create a new symbol strategy map that merges default and provided values
    const symbolStrategyMap: Record<string, ExecutionAlgorithm> = { ...DEFAULT_CONFIG.symbolStrategyMap };
    
    // Copy over any strategy mappings from the provided config
    if (config.symbolStrategyMap) {
      Object.assign(symbolStrategyMap, config.symbolStrategyMap);
    }

    return {
      defaultStrategy: config.defaultStrategy ?? DEFAULT_CONFIG.defaultStrategy,
      minOrderSizeForTwap: config.minOrderSizeForTwap ?? DEFAULT_CONFIG.minOrderSizeForTwap,
      minOrderSizeForVwap: config.minOrderSizeForVwap ?? DEFAULT_CONFIG.minOrderSizeForVwap,
      maxExecutionTimeMs: config.maxExecutionTimeMs ?? DEFAULT_CONFIG.maxExecutionTimeMs,
      symbolStrategyMap,
      twapConfig: config.twapConfig 
        ? { ...DEFAULT_CONFIG.twapConfig, ...config.twapConfig } 
        : DEFAULT_CONFIG.twapConfig,
      vwapConfig: config.vwapConfig 
        ? { ...DEFAULT_CONFIG.vwapConfig, ...config.vwapConfig } 
        : DEFAULT_CONFIG.vwapConfig,
    };
  }

  /**
   * Convert typescript config to native config format
   * @param config TypeScript config
   * @returns Native config format
   */
  private convertToNativeConfig(config: ExecutionStrategyConfig): ExecutionStrategyConfigParams {
    return {
      default_strategy: config.defaultStrategy,
      min_order_size_for_twap: config.minOrderSizeForTwap,
      min_order_size_for_vwap: config.minOrderSizeForVwap,
      max_execution_time_ms: config.maxExecutionTimeMs,
      symbol_strategy_map: config.symbolStrategyMap,
      twap_config: config.twapConfig ? {
        slices: config.twapConfig.slices,
        interval_ms: config.twapConfig.intervalMs,
        max_interval_deviation_ms: config.twapConfig.maxIntervalDeviationMs,
        min_execution_pct: config.twapConfig.minExecutionPct,
        randomize_sizes: config.twapConfig.randomizeSizes,
        size_deviation_pct: config.twapConfig.sizeDeviationPct,
      } : undefined,
      vwap_config: config.vwapConfig ? {
        start_time_offset_ms: config.vwapConfig.startTimeOffsetMs,
        end_time_offset_ms: config.vwapConfig.endTimeOffsetMs,
        max_participation_rate: config.vwapConfig.maxParticipationRate,
        min_execution_pct: config.vwapConfig.minExecutionPct,
        use_historical_profile: config.vwapConfig.useHistoricalProfile,
        volume_profile: config.vwapConfig.volumeProfile,
      } : undefined,
    };
  }

  /**
   * Convert Order to native format
   * @param order TypeScript order object
   * @returns Native order format
   */
  private convertOrderToNative(order: Order): any {
    return {
      symbol: order.symbol,
      side: order.side.toLowerCase(),
      amount: order.amount,
      price: order.price || 0,
      venues: order.venues || [],
      id: order.id,
      max_slippage: order.maxSlippage,
      max_retries: order.maxRetries,
      additional_params: {
        ...(order.additionalParams || {}),
        // Include any execution mode from additionalParams
        executionMode: order.additionalParams?.executionMode,
      },
    };
  }
} 