/**
 * RetryHandler - Advanced retry mechanism with exponential backoff
 * 
 * This module implements sophisticated retry logic for blockchain operations
 * with configurable backoff strategies, jitter, and selective retry based on
 * error types.
 */

import { BlockchainTelemetry } from '../../telemetry/BlockchainTelemetry.js';
import { recordRetryAttempt } from '../../../telemetry/metrics.js';

/**
 * Check if an error should be retried
 * 
 * @param {Error} error The error to check
 * @returns {boolean} True if the error is retriable
 */
function isRetriableError(error) {
  // Never retry circuit breaker errors
  if (error?.message?.includes('Circuit breaker open')) {
    return false;
  }
  
  // Get error message
  const errorMessage = String(error?.message || '').toLowerCase();
  const errorCode = error?.code;
  
  // RPC errors that should be retried
  const retriableRpcCodes = [
    -32000, // Generic execution error
    -32002, // Not recognized
    -32005, // Method limit exceeded
    -32010, // Request rate limited
    -32603, // Internal error
    429,    // Too many requests
    502,    // Bad gateway
    503,    // Service unavailable
    504     // Gateway timeout
  ];
  
  // Check error code
  if (errorCode && retriableRpcCodes.includes(errorCode)) {
    return true;
  }
  
  // Network errors
  const networkErrorPatterns = [
    'network', 'connection', 'econnreset', 'etimedout', 'timeout',
    'econnrefused', 'disconnected', 'socket', 'request timed out',
    'response size exceeded', 'rate limit', 'too many requests',
    'service unavailable', 'server error', 'server not responding',
    'timed out', 'exceeded', 'capacity', 'temporarily unavailable',
    'try again', 'overloaded'
  ];
  
  // Check if error message contains any retriable patterns
  for (const pattern of networkErrorPatterns) {
    if (errorMessage.includes(pattern)) {
      return true;
    }
  }
  
  // Transaction errors that should be retried
  const retriableTxErrors = [
    'nonce', 'underpriced', 'transaction underpriced',
    'replacement transaction underpriced',
    'gas price', 'insufficient funds for gas',
    'already known', 'known transaction'
  ];
  
  for (const pattern of retriableTxErrors) {
    if (errorMessage.includes(pattern)) {
      return true;
    }
  }
  
  // By default, don't retry errors not explicitly matched
  return false;
}

/**
 * RetryHandler class
 */
export class RetryHandler {
  /**
   * Create a new RetryHandler
   * 
   * @param {Object} options Configuration options
   * @param {number} options.maxRetries Maximum number of retry attempts (default: 3)
   * @param {number} options.baseDelayMs Base delay in ms for first retry (default: 500)
   * @param {number} options.maxDelayMs Maximum delay in ms (default: 10000)
   * @param {number} options.chainId The chain ID for telemetry (optional)
   * @param {boolean} options.isMainnet Whether this is for mainnet (for telemetry)
   * @param {boolean} options.useJitter Whether to use random jitter (default: true)
   * @param {boolean} options.exponential Whether to use exponential backoff (default: true)
   */
  constructor(options = {}) {
    this.options = {
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 10000,
      chainId: 0,
      isMainnet: true,
      useJitter: true,
      exponential: true,
      ...options
    };
    
    // Retry statistics
    this.retryCount = 0;
    this.lastRetryTime = null;
    
    // Try to import metrics module
    this.metricsImported = false;
    this.tryImportMetrics();
  }
  
  /**
   * Attempt to dynamically import metrics
   */
  async tryImportMetrics() {
    if (!this.metricsImported) {
      try {
        // We don't store the module since we'll use the exported function directly
        await import('../../../telemetry/metrics.js');
        this.metricsImported = true;
      } catch (error) {
        console.warn('Could not import metrics for retry handler', error.message);
      }
    }
  }
  
  /**
   * Record retry attempt metric
   * 
   * @param {string} operation Operation being retried
   */
  recordRetryMetric(operation) {
    try {
      if (this.metricsImported) {
        recordRetryAttempt(this.chainId, operation, this.isMainnet);
      }
    } catch (error) {
      console.warn('Error recording retry metric:', error.message);
    }
  }
  
  /**
   * Calculate delay for a retry attempt using exponential backoff with jitter
   * 
   * @param {number} attempt The current attempt number (starting from 1)
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    let delay = this.options.baseDelayMs;
    
    // If exponential backoff is enabled
    if (this.options.exponential) {
      // Calculate exponential delay: base * 2^(attempt-1)
      delay = this.options.baseDelayMs * Math.pow(2, attempt - 1);
    } else {
      // Linear backoff: base * attempt
      delay = this.options.baseDelayMs * attempt;
    }
    
    // Apply jitter if enabled (helps prevent "thundering herd" issues)
    if (this.options.useJitter) {
      // Add ±30% random jitter
      const jitter = delay * 0.3 * (Math.random() * 2 - 1);
      delay = Math.floor(delay + jitter);
    }
    
    // Cap at maximum delay
    return Math.min(delay, this.options.maxDelayMs);
  }
  
  /**
   * Execute an operation with retry
   * 
   * @param {Function} operation The operation to execute
   * @param {string} operationName Name of the operation for logging
   * @returns {Promise<any>} Result of the operation
   */
  async execute(operation, operationName = 'unknown') {
    let attempt = 0;
    
    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        
        // Check if error is retriable
        if (!this.isRetriableError(error)) {
          throw error;
        }
        
        // Check if we've hit max retries
        if (attempt > this.options.maxRetries) {
          error.message = `${error.message} (after ${attempt} attempts)`;
          throw error;
        }
        
        // Calculate delay with exponential backoff
        const delayMs = this.calculateDelay(attempt);
        
        // Record retry metrics
        this.retryCount++;
        this.lastRetryTime = Date.now();
        this.recordRetryMetric(operationName);
        
        // Log retry
        console.warn(`Retrying ${operationName} (attempt ${attempt}/${this.options.maxRetries}) after ${delayMs}ms delay. Error: ${error.message}`);
        
        // Wait before retry
        await this.delay(delayMs);
      }
    }
  }

  /**
   * Execute an operation with retry and validate the result
   * 
   * @param {Function} operation The operation to execute
   * @param {Function} isValidResult Function to validate result
   * @param {string} operationName Name of the operation for logging
   * @returns {Promise<any>} Valid result of the operation
   */
  async executeWithResultValidation(operation, isValidResult, operationName = 'unknown') {
    let attempt = 0;
    
    while (true) {
      try {
        const result = await operation();
        
        // Check if result is valid
        if (isValidResult(result)) {
          return result;
        }
        
        // Invalid result, treat as retriable error
        attempt++;
        
        // Check if we've hit max retries
        if (attempt > this.options.maxRetries) {
          throw new Error(`Invalid result (after ${attempt} attempts)`);
        }
        
        // Calculate delay with exponential backoff
        const delayMs = this.calculateDelay(attempt);
        
        // Record retry metrics
        this.retryCount++;
        this.lastRetryTime = Date.now();
        this.recordRetryMetric(operationName);
        
        // Log retry
        console.warn(`Retrying ${operationName} due to invalid result (attempt ${attempt}/${this.options.maxRetries}) after ${delayMs}ms delay.`);
        
        // Wait before retry
        await this.delay(delayMs);
      } catch (error) {
        // Handle normal errors same as execute()
        attempt++;
        
        // Check if error is retriable
        if (!this.isRetriableError(error)) {
          throw error;
        }
        
        // Check if we've hit max retries
        if (attempt > this.options.maxRetries) {
          error.message = `${error.message} (after ${attempt} attempts)`;
          throw error;
        }
        
        // Calculate delay with exponential backoff
        const delayMs = this.calculateDelay(attempt);
        
        // Record retry metrics
        this.retryCount++;
        this.lastRetryTime = Date.now();
        this.recordRetryMetric(operationName);
        
        // Log retry
        console.warn(`Retrying ${operationName} (attempt ${attempt}/${this.options.maxRetries}) after ${delayMs}ms delay. Error: ${error.message}`);
        
        // Wait before retry
        await this.delay(delayMs);
      }
    }
  }
}

export default RetryHandler; 