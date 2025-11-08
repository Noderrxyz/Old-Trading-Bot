/**
 * Circuit Breaker Pattern Implementation
 * 
 * This module implements the circuit breaker pattern for blockchain operations.
 * It prevents cascading failures by stopping operations when a service is failing,
 * and provides automatic recovery when the service becomes available again.
 */

// Import telemetry function for circuit breaker state changes
import { updateCircuitBreakerState } from '../../../telemetry/metrics.js';

// Circuit breaker states
export const CircuitState = {
  CLOSED: 'CLOSED',   // Normal operation
  OPEN: 'OPEN',       // Failing, rejecting requests
  HALF_OPEN: 'HALF_OPEN' // Testing recovery
};

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  /**
   * Create a new circuit breaker
   * 
   * @param {Object} options Circuit breaker options
   * @param {number} options.failureThreshold Number of failures before opening
   * @param {number} options.resetTimeoutMs Timeout before trying to recover (ms)
   * @param {number} options.halfOpenSuccessThreshold Successes needed to close circuit
   * @param {number} options.chainId Chain ID this circuit breaker is for
   * @param {boolean} options.isMainnet Whether this is for a mainnet chain
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000; // 30 seconds
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold || 2;
    this.chainId = options.chainId || 0;
    this.isMainnet = options.isMainnet !== undefined ? options.isMainnet : true;
    
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastError = null;
    this.openCount = 0; // Times circuit breaker has opened
    this.resetTimer = null;
    
    // Try to import metrics module - this is dynamic because we're in a JS file
    // importing from a TS file, so we handle the potential failure gracefully
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
        this.recordCircuitBreakerStateMetric();
      } catch (error) {
        console.warn('Could not import metrics for circuit breaker', error.message);
      }
    }
  }
  
  /**
   * Record circuit breaker state to metrics
   */
  recordCircuitBreakerStateMetric() {
    try {
      if (this.metricsImported) {
        // Only call updateCircuitBreakerState if we successfully imported metrics
        updateCircuitBreakerState(
          this.chainId,
          this.isMainnet,
          this.state === CircuitState.OPEN
        );
      }
    } catch (error) {
      console.warn('Error recording circuit breaker state metric:', error.message);
    }
  }

  /**
   * Execute an operation with circuit breaker protection
   * 
   * @param {Function} operation The operation to execute
   * @returns {Promise<any>} Result of the operation
   */
  async execute(operation) {
    if (this.state === CircuitState.OPEN) {
      // Circuit is open, reject all requests
      const error = new Error(`Circuit breaker open for chain ${this.chainId}`);
      error.code = 'CIRCUIT_BREAKER_OPEN';
      throw error;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.close();
      }
    }
    
    // Reset failure count if circuit is closed
    if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed operation
   * 
   * @param {Error} error The error that occurred
   */
  recordFailure(error) {
    this.lastFailureTime = Date.now();
    this.lastError = error.message;
    
    if (this.state === CircuitState.HALF_OPEN) {
      // If we're testing the waters and still getting failures, reopen the circuit
      this.open();
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount++;
      
      if (this.failureCount >= this.failureThreshold) {
        this.open();
      }
    }
  }

  /**
   * Open the circuit (stop operations)
   */
  open() {
    // Only trigger events if state is changing
    const wasOpen = this.state === CircuitState.OPEN;
    
    this.state = CircuitState.OPEN;
    this.failureCount = 0;
    this.successCount = 0;
    this.openCount++;
    
    // Record state change in metrics
    if (!wasOpen) {
      this.recordCircuitBreakerStateMetric();
    }
    
    // Set a timer to try to recover
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.resetTimeoutMs);
  }

  /**
   * Set circuit to half-open (testing recovery)
   */
  halfOpen() {
    // Only trigger events if state is changing
    const wasHalfOpen = this.state === CircuitState.HALF_OPEN;
    
    this.state = CircuitState.HALF_OPEN;
    this.failureCount = 0;
    this.successCount = 0;
    
    // Record state change in metrics
    if (!wasHalfOpen) {
      this.recordCircuitBreakerStateMetric();
    }
  }

  /**
   * Close the circuit (resume normal operation)
   */
  close() {
    // Only trigger events if state is changing
    const wasClosed = this.state === CircuitState.CLOSED;
    
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    
    // Record state change in metrics
    if (!wasClosed) {
      this.recordCircuitBreakerStateMetric();
    }
    
    // Clear any reset timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Check if the circuit is open
   * 
   * @returns {boolean} True if open, false otherwise
   */
  isOpen() {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Force reset the circuit to closed state
   */
  forceReset() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    const previousState = this.state;
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    
    // Record state change in metrics if needed
    if (previousState !== CircuitState.CLOSED) {
      this.recordCircuitBreakerStateMetric();
    }
  }
}

export default CircuitBreaker; 