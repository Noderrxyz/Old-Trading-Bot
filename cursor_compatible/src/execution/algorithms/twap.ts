import { logger } from '../../utils/logger.js';
import { Order, OrderType, ExecutionResult } from '../types/execution.types.js';
import { GasEstimator } from '../gas_estimator.js';
import { VenueLiquidityTracker } from '../venue_liquidity_tracker.js';

/**
 * Configuration for TWAP execution
 */
export interface TWAPConfig {
  numSlices: number;
  sliceIntervalMs: number;
  maxGasPerSlice: number;
  minLiquidityThreshold: number;
}

/**
 * Default TWAP configuration
 */
export const DEFAULT_TWAP_CONFIG: TWAPConfig = {
  numSlices: 10,
  sliceIntervalMs: 60000, // 1 minute
  maxGasPerSlice: 1000000,
  minLiquidityThreshold: 0.1 // 10% of total order size
};

/**
 * TWAP Execution Algorithm
 */
export class TWAPExecutor {
  private config: TWAPConfig;
  private gasEstimator: GasEstimator;
  private liquidityTracker: VenueLiquidityTracker;
  private executionTimer: NodeJS.Timeout | null = null;
  private currentSlice: number = 0;
  private totalSlices: number = 0;
  private order: Order | null = null;
  private onComplete: ((results: ExecutionResult[]) => void) | null = null;

  constructor(config: Partial<TWAPConfig> = {}) {
    this.config = { ...DEFAULT_TWAP_CONFIG, ...config };
    this.gasEstimator = GasEstimator.getInstance();
    this.liquidityTracker = VenueLiquidityTracker.getInstance();
  }

  /**
   * Execute an order using TWAP algorithm
   */
  public async execute(
    order: Order,
    onComplete: (results: ExecutionResult[]) => void
  ): Promise<void> {
    if (this.executionTimer) {
      throw new Error('TWAP execution already in progress');
    }

    this.order = order;
    this.onComplete = onComplete;
    this.currentSlice = 0;
    this.totalSlices = this.config.numSlices;

    logger.info(`Starting TWAP execution for order ${order.id} with ${this.totalSlices} slices`);

    // Start the execution timer
    this.executionTimer = setInterval(
      () => this.executeNextSlice(),
      this.config.sliceIntervalMs
    );

    // Execute first slice immediately
    await this.executeNextSlice();
  }

  /**
   * Execute the next slice of the order
   */
  private async executeNextSlice(): Promise<void> {
    if (!this.order || !this.onComplete) {
      this.stopExecution();
      return;
    }

    try {
      const sliceSize = this.calculateSliceSize();
      const sliceOrder: Order = {
        ...this.order,
        amount: sliceSize,
        id: `${this.order.id}_slice_${this.currentSlice + 1}`
      };

      // Check gas and liquidity constraints
      const gasEstimate = await this.gasEstimator.estimateGas(sliceOrder);
      const venueLiquidity = await this.liquidityTracker.getLiquidity(
        this.order.venue,
        this.order.symbol
      );

      if (gasEstimate > this.config.maxGasPerSlice) {
        logger.warn(`Gas estimate ${gasEstimate} exceeds max per slice ${this.config.maxGasPerSlice}`);
        this.stopExecution();
        return;
      }

      if (venueLiquidity < this.config.minLiquidityThreshold * sliceSize) {
        logger.warn(`Venue liquidity ${venueLiquidity} below threshold for slice ${sliceSize}`);
        this.stopExecution();
        return;
      }

      // Execute the slice
      const result = await this.executeSlice(sliceOrder);
      
      this.currentSlice++;
      
      if (this.currentSlice >= this.totalSlices) {
        this.stopExecution();
        this.onComplete([result]);
      }
    } catch (error) {
      logger.error('Error executing TWAP slice:', error);
      this.stopExecution();
    }
  }

  /**
   * Calculate the size of the next slice
   */
  private calculateSliceSize(): number {
    if (!this.order) return 0;
    
    const remainingSlices = this.totalSlices - this.currentSlice;
    return this.order.amount / remainingSlices;
  }

  /**
   * Execute a single slice
   */
  private async executeSlice(order: Order): Promise<ExecutionResult> {
    // TODO: Implement actual order execution
    // This is a placeholder that should be replaced with real execution logic
    return {
      orderId: order.id,
      status: 'filled',
      filledAmount: order.amount,
      averagePrice: 0, // Should be calculated from actual execution
      timestamp: Date.now()
    };
  }

  /**
   * Stop the execution process
   */
  private stopExecution(): void {
    if (this.executionTimer) {
      clearInterval(this.executionTimer);
      this.executionTimer = null;
    }
    this.order = null;
    this.onComplete = null;
  }

  /**
   * Estimate the impact of executing an order using TWAP
   */
  public async estimateImpact(order: Order): Promise<number> {
    const sliceSize = order.amount / this.config.numSlices;
    const venueLiquidity = await this.liquidityTracker.getLiquidity(
      order.venue,
      order.symbol
    );
    
    // Calculate impact as a ratio of slice size to venue liquidity
    return sliceSize / venueLiquidity;
  }

  /**
   * Get cost estimate for executing an order using TWAP
   */
  public async getCostEstimate(order: Order): Promise<number> {
    const gasEstimate = await this.gasEstimator.estimateGas(order);
    const gasPrice = await this.gasEstimator.getCurrentGasPrice();
    
    return gasEstimate * gasPrice * this.config.numSlices;
  }
} 