/**
 * Protective Wrapper for High-Risk Transactions
 * 
 * This module implements various strategies for wrapping high-risk transactions
 * with protective measures to reduce the likelihood of failures.
 */

import { OrderIntent, ExecutedOrder } from '../../types/execution.types.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('ProtectiveWrapper');

/**
 * Protective strategy options
 */
export enum ProtectiveStrategy {
  // Try/catch pattern for transactions
  FAIL_SILENT = 'fail_silent',
  
  // Multiple sequential attempts with increasing gas
  RETRY_WITH_BACKOFF = 'retry_with_backoff',
  
  // Split large trades into smaller chunks
  SPLIT_TRADE = 'split_trade',
  
  // Use flashbots bundle or similar private transaction mechanism
  PRIVATE_TX = 'private_tx',
  
  // Use a surrogate contract with recovery logic
  SURROGATE_CONTRACT = 'surrogate_contract'
}

/**
 * Configuration for protective wrappers
 */
export interface ProtectiveWrapperConfig {
  // Default strategy to use
  defaultStrategy: ProtectiveStrategy;
  
  // Whether to automatically choose strategy based on transaction type
  autoSelectStrategy: boolean;
  
  // Maximum gas increase for retry strategy (e.g. 1.5 = 50% more)
  maxGasIncrease: number;
  
  // Maximum number of retry attempts
  maxRetryAttempts: number;
  
  // Maximum transaction chunks for split strategy
  maxTradeSplits: number;
  
  // Whether to include revert reasons in debug logs
  captureRevertReasons: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ProtectiveWrapperConfig = {
  defaultStrategy: ProtectiveStrategy.FAIL_SILENT,
  autoSelectStrategy: true,
  maxGasIncrease: 1.5,
  maxRetryAttempts: 3,
  maxTradeSplits: 4,
  captureRevertReasons: true
};

/**
 * Result of a protected transaction execution
 */
export interface ProtectionResult {
  // Whether the transaction completed successfully
  success: boolean;
  
  // The executed order (if successful)
  executedOrder?: ExecutedOrder;
  
  // Strategy that was used
  strategyUsed: ProtectiveStrategy;
  
  // Error information (if failed)
  error?: {
    message: string;
    code?: string;
    data?: any;
  };
  
  // Number of attempts made
  attempts: number;
  
  // Total gas used across all attempts
  totalGasUsed: number;
  
  // Whether the transaction was modified during protection
  modified: boolean;
  
  // If transaction was split, information about the splits
  splitInfo?: {
    originalQuantity: number;
    chunks: number;
    successfulChunks: number;
  };
}

/**
 * Protective wrapper for transactions
 */
export class ProtectiveWrapper {
  /**
   * Create a new protective wrapper
   */
  constructor(
    private readonly config: ProtectiveWrapperConfig = DEFAULT_CONFIG
  ) {
    logger.info('Protective Wrapper initialized');
  }
  
  /**
   * Wrap a transaction execution with protective measures
   * @param executeFunc Function that executes the transaction
   * @param order The order to execute
   * @param strategy Optional strategy override
   * @returns Protection result
   */
  public async wrapExecution(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent,
    strategy?: ProtectiveStrategy
  ): Promise<ProtectionResult> {
    // Determine which strategy to use
    const selectedStrategy = strategy || 
      (this.config.autoSelectStrategy ? this.selectStrategy(order) : this.config.defaultStrategy);
    
    logger.info(`Using ${selectedStrategy} protection strategy for ${order.asset} ${order.side} order`);
    
    // Apply the selected strategy
    switch (selectedStrategy) {
      case ProtectiveStrategy.FAIL_SILENT:
        return this.applyFailSilentStrategy(executeFunc, order);
        
      case ProtectiveStrategy.RETRY_WITH_BACKOFF:
        return this.applyRetryStrategy(executeFunc, order);
        
      case ProtectiveStrategy.SPLIT_TRADE:
        return this.applySplitTradeStrategy(executeFunc, order);
        
      case ProtectiveStrategy.PRIVATE_TX:
        return this.applyPrivateTxStrategy(executeFunc, order);
        
      case ProtectiveStrategy.SURROGATE_CONTRACT:
        return this.applySurrogateStrategy(executeFunc, order);
        
      default:
        // Fallback to fail silent if unknown strategy
        logger.warn(`Unknown strategy ${selectedStrategy}, falling back to FAIL_SILENT`);
        return this.applyFailSilentStrategy(executeFunc, order);
    }
  }
  
  /**
   * Select the best protective strategy for an order
   * @param order Order intent
   * @returns Recommended strategy
   */
  private selectStrategy(order: OrderIntent): ProtectiveStrategy {
    // For large orders, split the trade
    if (order.quantity > 10000) { // Arbitrary threshold, would be asset-specific in real implementation
      return ProtectiveStrategy.SPLIT_TRADE;
    }
    
    // For urgent orders, use private transactions
    if (order.urgency === 'high') {
      return ProtectiveStrategy.PRIVATE_TX;
    }
    
    // For standard orders, use retry with backoff
    if (order.urgency === 'medium') {
      return ProtectiveStrategy.RETRY_WITH_BACKOFF;
    }
    
    // For low urgency orders, use fail silent
    return ProtectiveStrategy.FAIL_SILENT;
  }
  
  /**
   * Apply the fail-silent strategy (try/catch wrapper)
   * @param executeFunc Execution function
   * @param order Order to execute
   * @returns Protection result
   */
  private async applyFailSilentStrategy(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent
  ): Promise<ProtectionResult> {
    const result: ProtectionResult = {
      success: false,
      strategyUsed: ProtectiveStrategy.FAIL_SILENT,
      attempts: 1,
      totalGasUsed: 0,
      modified: false
    };
    
    try {
      logger.debug(`Executing ${order.asset} ${order.side} order with fail-silent protection`);
      const executedOrder = await executeFunc(order);
      
      result.success = true;
      result.executedOrder = executedOrder;
      result.totalGasUsed = executedOrder.metadata?.gasUsed || 0;
      
      return result;
    } catch (error) {
      // Capture the error but don't let it propagate
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Caught error in fail-silent wrapper: ${errorMessage}`);
      
      result.error = {
        message: errorMessage,
        data: error
      };
      
      return result;
    }
  }
  
  /**
   * Apply the retry strategy with exponential backoff
   * @param executeFunc Execution function
   * @param order Order to execute
   * @returns Protection result
   */
  private async applyRetryStrategy(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent
  ): Promise<ProtectionResult> {
    const result: ProtectionResult = {
      success: false,
      strategyUsed: ProtectiveStrategy.RETRY_WITH_BACKOFF,
      attempts: 0,
      totalGasUsed: 0,
      modified: false
    };
    
    let currentOrder = { ...order };
    let lastError: any = null;
    
    // Try multiple times with increasing gas
    for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
      result.attempts = attempt;
      
      try {
        // For later attempts, increase gas parameters
        if (attempt > 1) {
          result.modified = true;
          
          // Increase urgency if possible
          if (currentOrder.urgency === 'low') {
            currentOrder.urgency = 'medium';
          } else if (currentOrder.urgency === 'medium') {
            currentOrder.urgency = 'high';
          }
          
          // Increase max slippage for later attempts
          if (currentOrder.maxSlippageBps) {
            currentOrder.maxSlippageBps = Math.floor(
              currentOrder.maxSlippageBps * (1 + (attempt - 1) * 0.25)
            );
          }
          
          logger.info(`Retry attempt ${attempt} with urgency=${currentOrder.urgency}, slippage=${currentOrder.maxSlippageBps}bps`);
        }
        
        // Execute with current parameters
        const executedOrder = await executeFunc(currentOrder);
        
        // Successful execution
        result.success = true;
        result.executedOrder = executedOrder;
        result.totalGasUsed += executedOrder.metadata?.gasUsed || 0;
        
        return result;
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Attempt ${attempt} failed: ${errorMessage}`);
        
        // Short delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    
    // All attempts failed
    result.error = {
      message: lastError instanceof Error ? lastError.message : String(lastError),
      data: lastError
    };
    
    return result;
  }
  
  /**
   * Apply the split-trade strategy (break into smaller chunks)
   * @param executeFunc Execution function
   * @param order Order to execute
   * @returns Protection result
   */
  private async applySplitTradeStrategy(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent
  ): Promise<ProtectionResult> {
    const result: ProtectionResult = {
      success: false,
      strategyUsed: ProtectiveStrategy.SPLIT_TRADE,
      attempts: 0,
      totalGasUsed: 0,
      modified: true,
      splitInfo: {
        originalQuantity: order.quantity,
        chunks: 0,
        successfulChunks: 0
      }
    };
    
    // Determine optimal number of chunks (2-4 based on size)
    const chunks = Math.min(
      this.config.maxTradeSplits,
      Math.max(2, Math.ceil(order.quantity / 5000)) // Arbitrary threshold
    );
    
    result.splitInfo!.chunks = chunks;
    
    // Calculate chunk size
    const chunkSize = order.quantity / chunks;
    
    // Partial success tracking
    let partialSuccess = false;
    let accumulatedQuantity = 0;
    let lastExecutedOrder: ExecutedOrder | null = null;
    
    logger.info(`Splitting ${order.asset} ${order.side} order into ${chunks} chunks of ${chunkSize} each`);
    
    // Execute each chunk
    for (let i = 0; i < chunks; i++) {
      result.attempts++;
      
      // Last chunk gets remainder to account for rounding
      const isLastChunk = i === chunks - 1;
      const chunkQuantity = isLastChunk 
        ? order.quantity - accumulatedQuantity
        : chunkSize;
      
      // Skip if we've already accumulated the full amount
      if (chunkQuantity <= 0) {
        continue;
      }
      
      // Create chunk order
      const chunkOrder: OrderIntent = {
        ...order,
        quantity: chunkQuantity
      };
      
      try {
        logger.debug(`Executing chunk ${i+1}/${chunks} with quantity ${chunkQuantity}`);
        const executedOrder = await executeFunc(chunkOrder);
        
        // Successfully executed this chunk
        result.splitInfo!.successfulChunks++;
        result.totalGasUsed += executedOrder.metadata?.gasUsed || 0;
        
        // Track accumulated quantity and save the order
        accumulatedQuantity += executedOrder.executedQuantity;
        lastExecutedOrder = executedOrder;
        partialSuccess = true;
        
        // Short delay between chunks to avoid self-competition
        if (!isLastChunk) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Chunk ${i+1}/${chunks} failed: ${errorMessage}`);
        
        // Continue with next chunk despite failure
        if (!isLastChunk) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Consider successful if at least one chunk succeeded
    result.success = partialSuccess;
    
    // If we have a successful order, include it
    if (lastExecutedOrder) {
      result.executedOrder = {
        ...lastExecutedOrder,
        executedQuantity: accumulatedQuantity,
        // Update status based on how much was filled
        status: accumulatedQuantity >= order.quantity * 0.95 ? 'filled' : 'partially_filled'
      };
    }
    
    return result;
  }
  
  /**
   * Apply private transaction strategy (e.g., Flashbots)
   * @param executeFunc Execution function
   * @param order Order to execute
   * @returns Protection result
   */
  private async applyPrivateTxStrategy(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent
  ): Promise<ProtectionResult> {
    const result: ProtectionResult = {
      success: false,
      strategyUsed: ProtectiveStrategy.PRIVATE_TX,
      attempts: 1,
      totalGasUsed: 0,
      modified: true
    };
    
    try {
      // In a real implementation, we would:
      // 1. Create a Flashbots bundle or similar private tx
      // 2. Sign and submit through a private RPC
      // 3. Wait for inclusion with a timeout
      
      logger.info(`Executing ${order.asset} ${order.side} order as private transaction`);
      
      // For now, just execute normally
      const executedOrder = await executeFunc(order);
      
      result.success = true;
      result.executedOrder = executedOrder;
      result.totalGasUsed = executedOrder.metadata?.gasUsed || 0;
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Private transaction failed: ${errorMessage}`);
      
      result.error = {
        message: errorMessage,
        data: error
      };
      
      return result;
    }
  }
  
  /**
   * Apply surrogate contract strategy (use safer execution contract)
   * @param executeFunc Execution function
   * @param order Order to execute
   * @returns Protection result
   */
  private async applySurrogateStrategy(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent
  ): Promise<ProtectionResult> {
    const result: ProtectionResult = {
      success: false,
      strategyUsed: ProtectiveStrategy.SURROGATE_CONTRACT,
      attempts: 1,
      totalGasUsed: 0,
      modified: true
    };
    
    try {
      // In a real implementation, we would:
      // 1. Deploy or use a pre-deployed safety wrapper contract
      // 2. Call its `safeExecute` method which handles various edge cases
      
      logger.info(`Executing ${order.asset} ${order.side} order through surrogate contract`);
      
      // For now, just execute normally
      const executedOrder = await executeFunc(order);
      
      result.success = true;
      result.executedOrder = executedOrder;
      result.totalGasUsed = executedOrder.metadata?.gasUsed || 0;
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Surrogate execution failed: ${errorMessage}`);
      
      result.error = {
        message: errorMessage,
        data: error
      };
      
      return result;
    }
  }
} 