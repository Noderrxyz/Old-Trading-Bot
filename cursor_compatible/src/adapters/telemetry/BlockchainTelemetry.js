/**
 * Blockchain Telemetry Handler
 * 
 * This module provides specialized telemetry functions for blockchain adapters,
 * integrating with the metrics system to ensure consistent
 * monitoring and observability.
 */

// Import metrics functions from the new metrics module
import {
  recordRpcMetrics,
  recordBlockchainOperation,
  updateBlockchainConnectionStatus,
  updateCircuitBreakerState,
  recordTradeExecution,
  recordRetryAttempt
} from '../../telemetry/metrics.js';

/**
 * Categorizes blockchain errors for better tracking and handling
 */
export function categorizeBlockchainError(error) {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code;
  
  // Network errors
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('socket') ||
    errorMessage.includes('connection')
  ) {
    return 'network';
  }
  
  // RPC errors
  if (
    errorMessage.includes('rpc') ||
    errorMessage.includes('server') ||
    errorMessage.includes('method not found') ||
    errorMessage.includes('service unavailable') ||
    (errorCode && (errorCode === -32000 || errorCode === -32603))
  ) {
    return 'rpc';
  }
  
  // Transaction errors
  if (
    errorMessage.includes('transaction') ||
    errorMessage.includes('gas') ||
    errorMessage.includes('underpriced') ||
    errorMessage.includes('nonce') ||
    errorMessage.includes('rejected')
  ) {
    return 'transaction';
  }
  
  // Validation errors
  if (
    errorMessage.includes('invalid') ||
    errorMessage.includes('not found') ||
    errorMessage.includes('not supported') ||
    errorMessage.includes('cannot')
  ) {
    return 'validation';
  }
  
  // Circuit breaker
  if (errorMessage.includes('circuit breaker')) {
    return 'circuit_breaker';
  }
  
  // Rate limit
  if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('exceeded')
  ) {
    return 'rate_limit';
  }
  
  // Default classification
  return 'unknown';
}

/**
 * BlockchainTelemetry class handles all telemetry for blockchain adapters
 */
export class BlockchainTelemetry {
  /**
   * Create a new blockchain telemetry instance
   * 
   * @param {number} chainId The chain ID
   * @param {boolean} isMainnet Whether this is a mainnet chain
   */
  constructor(chainId, isMainnet = true) {
    this.chainId = chainId;
    this.isMainnet = isMainnet;
    this.operationCounts = {
      total: 0,
      success: 0,
      failure: 0
    };
    this.lastError = null;
    this.lastLatency = null;
  }
  
  /**
   * Track performance of a blockchain operation with timing and success/failure metrics
   * 
   * @param {string} operationType The operation type (connect, getBalance, etc.)
   * @param {Function} operation The async operation to execute and track
   * @returns {Promise<any>} The result of the operation
   */
  async trackOperation(operationType, operation) {
    const startTime = Date.now();
    let success = false;
    let errorType = null;
    
    try {
      // Execute the operation
      const result = await operation();
      
      // Mark as successful
      success = true;
      
      return result;
    } catch (error) {
      // Categorize the error
      errorType = categorizeBlockchainError(error);
      
      // Rethrow after recording
      throw error;
    } finally {
      // Record operation metrics
      recordBlockchainOperation(
        this.chainId,
        operationType,
        this.isMainnet,
        startTime,
        success
      );
      
      // Record additional metrics based on operation type
      if (operationType.startsWith('rpc_')) {
        // Format: rpc_eth_call, rpc_eth_getBalance, etc.
        const method = operationType.replace('rpc_', '');
        recordRpcMetrics(
          this.chainId,
          method,
          this.isMainnet,
          startTime,
          success,
          success ? null : errorType
        );
      }
      
      // Update internal counters
      this.operationCounts.total++;
      if (success) {
        this.operationCounts.success++;
      } else {
        this.operationCounts.failure++;
        this.lastError = errorType;
      }
      
      this.lastLatency = Date.now() - startTime;
    }
  }
  
  /**
   * Update blockchain status information
   * 
   * @param {boolean} connected Connection status
   * @param {number} blockHeight Current block height
   * @param {number} gasPrice Current gas price
   */
  updateStatus(connected, blockHeight, gasPrice) {
    updateBlockchainConnectionStatus(
      this.chainId,
      this.isMainnet,
      connected,
      blockHeight,
      gasPrice
    );
  }
  
  /**
   * Update circuit breaker state
   * 
   * @param {boolean} isOpen Whether circuit breaker is open
   */
  updateCircuitBreaker(isOpen) {
    updateCircuitBreakerState(
      this.chainId,
      this.isMainnet,
      isOpen
    );
  }
  
  /**
   * Track a trade execution
   * 
   * @param {number} startTime Start timestamp
   * @param {number} volumeUsd Volume in USD
   * @param {boolean} success Whether the trade succeeded
   * @param {number} slippagePercent Slippage percentage (optional)
   * @param {number} feesUsd Fees in USD (optional)
   */
  recordTrade(startTime, volumeUsd, success, slippagePercent, feesUsd) {
    recordTradeExecution(
      this.chainId,
      this.isMainnet,
      startTime,
      volumeUsd,
      success,
      slippagePercent,
      feesUsd
    );
  }
  
  /**
   * Record a retry attempt
   * 
   * @param {string} method Method or operation being retried
   */
  recordRetry(method) {
    recordRetryAttempt(
      this.chainId,
      method,
      this.isMainnet
    );
  }
}

/**
 * Enhance an adapter with telemetry
 * 
 * This function wraps adapter methods to automatically record telemetry
 * 
 * @param {Object} adapter The adapter to enhance
 * @param {number} chainId The chain ID
 * @param {boolean} isMainnet Whether this is a mainnet chain
 * @returns {Object} Enhanced adapter
 */
export function enhanceAdapterWithTelemetry(adapter, chainId, isMainnet = true) {
  // Skip if already enhanced
  if (adapter._telemetryEnhanced) {
    return adapter;
  }
  
  // Create telemetry instance
  const telemetry = new BlockchainTelemetry(chainId, isMainnet);
  
  // Create enhanced copy to avoid modifying the original
  const enhanced = Object.create(Object.getPrototypeOf(adapter));
  
  // Copy properties
  Object.getOwnPropertyNames(adapter).forEach(prop => {
    const descriptor = Object.getOwnPropertyDescriptor(adapter, prop);
    Object.defineProperty(enhanced, prop, descriptor);
  });
  
  // Attach telemetry instance
  enhanced.telemetry = telemetry;
  enhanced._telemetryEnhanced = true;
  
  // Enhance connect method
  const originalConnect = enhanced.connect;
  enhanced.connect = async function() {
    return telemetry.trackOperation('connect', async () => {
      const result = await originalConnect.apply(this, arguments);
      telemetry.updateStatus(true);
      return result;
    });
  };
  
  // Enhance disconnect method
  const originalDisconnect = enhanced.disconnect;
  enhanced.disconnect = async function() {
    return telemetry.trackOperation('disconnect', async () => {
      const result = await originalDisconnect.apply(this, arguments);
      telemetry.updateStatus(false);
      return result;
    });
  };
  
  // Enhance getBalance method
  const originalGetBalance = enhanced.getBalance;
  enhanced.getBalance = async function(address) {
    return telemetry.trackOperation('getBalance', async () => {
      return await originalGetBalance.apply(this, arguments);
    });
  };
  
  // Enhance getQuote method
  const originalGetQuote = enhanced.getQuote;
  enhanced.getQuote = async function(fromAsset, toAsset, amount) {
    return telemetry.trackOperation('getQuote', async () => {
      return await originalGetQuote.apply(this, arguments);
    });
  };
  
  // Enhance executeTrade method (if it exists)
  if (typeof enhanced.executeTrade === 'function') {
    const originalExecuteTrade = enhanced.executeTrade;
    enhanced.executeTrade = async function(quote, options) {
      const startTime = Date.now();
      
      return telemetry.trackOperation('executeTrade', async () => {
        const result = await originalExecuteTrade.apply(this, arguments);
        
        // Extract trade details if available for more detailed metrics
        const volumeUsd = quote?.amount?.usdValue || 0;
        const slippage = result?.slippage || options?.maxSlippage || 0;
        const fees = result?.fees?.usdValue || 0;
        
        telemetry.recordTrade(
          startTime,
          volumeUsd,
          true,
          slippage,
          fees
        );
        
        return result;
      });
    };
  }
  
  // Enhance getStatus method
  const originalGetStatus = enhanced.getStatus;
  enhanced.getStatus = async function() {
    return telemetry.trackOperation('getStatus', async () => {
      const result = await originalGetStatus.apply(this, arguments);
      
      // Update connection status with block height and gas price if available
      if (result) {
        telemetry.updateStatus(
          true,
          result.blockHeight,
          result.gasPrice
        );
      }
      
      return result;
    });
  };
  
  return enhanced;
}

export default {
  BlockchainTelemetry,
  enhanceAdapterWithTelemetry,
  categorizeBlockchainError
}; 