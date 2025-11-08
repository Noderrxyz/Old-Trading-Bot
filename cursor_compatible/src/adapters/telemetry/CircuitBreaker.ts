/**
 * CircuitBreaker - Implements the circuit breaker pattern for error handling
 * 
 * This module provides a circuit breaker implementation to prevent cascading failures
 * by temporarily disabling operations after a threshold of failures has been reached.
 */

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 0, // Normal operation, requests go through
  OPEN = 1,   // Circuit is open, requests fail fast
  HALF_OPEN = 2 // Testing if service is back up, limited requests
}

/**
 * Configuration for the circuit breaker
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes in half-open state to close
  resetTimeoutMs: number;        // Time to wait before trying again (half-open)
  halfOpenMaxRequests: number;   // Max requests to allow in half-open state
  monitorWindowMs: number;       // Time window for failure counting
  minimumRequestThreshold: number; // Min requests before opening circuit
}

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailure?: number;
  lastSuccess?: number;
  nextRetry?: number;
  consecutiveSuccesses?: number;
  requestCount?: number;
}

/**
 * CircuitBreaker implementation
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  
  // Counters
  private failureCount: number = 0;
  private consecutiveSuccesses: number = 0;
  private requestCount: number = 0;
  
  // Timestamps
  private firstFailureTime: number = 0;
  private lastFailureTime: number = 0;
  private lastSuccessTime: number = 0;
  private openTime: number = 0;
  private halfOpenRequests: number = 0;
  
  /**
   * Constructor
   * @param config Circuit breaker configuration
   */
  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    // Default configuration values
    this.config = {
      failureThreshold: 5,       // Open after 5 failures
      successThreshold: 2,       // Close after 2 successes in half-open state
      resetTimeoutMs: 30000,     // Try again after 30 seconds
      halfOpenMaxRequests: 3,    // Allow 3 requests in half-open state
      monitorWindowMs: 60000,    // 1-minute window for failures
      minimumRequestThreshold: 3, // At least 3 requests before opening
      ...config
    };
  }
  
  /**
   * Record a successful operation
   */
  public recordSuccess(): void {
    this.requestCount++;
    this.lastSuccessTime = Date.now();
    
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // In closed state, just record the success and reset failures
        // if enough time has passed since the first failure
        if (this.failureCount > 0 && 
            (Date.now() - this.firstFailureTime) > this.config.monitorWindowMs) {
          this.resetFailures();
        }
        break;
        
      case CircuitBreakerState.HALF_OPEN:
        // In half-open state, count consecutive successes to possibly close the circuit
        this.consecutiveSuccesses++;
        
        if (this.consecutiveSuccesses >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;
        
      case CircuitBreakerState.OPEN:
        // Shouldn't happen, but just in case
        // If we got a success while open, move to half-open
        this.transitionToHalfOpen();
        break;
    }
  }
  
  /**
   * Record a failed operation
   */
  public recordFailure(): void {
    this.requestCount++;
    this.lastFailureTime = Date.now();
    
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Record the first failure time if this is the first failure
        if (this.failureCount === 0) {
          this.firstFailureTime = Date.now();
        }
        
        this.failureCount++;
        
        // Check if we've hit the threshold and have enough requests
        if (this.failureCount >= this.config.failureThreshold && 
            this.requestCount >= this.config.minimumRequestThreshold) {
          this.transitionToOpen();
        }
        break;
        
      case CircuitBreakerState.HALF_OPEN:
        // Any failure in half-open state sends us back to open
        this.transitionToOpen();
        break;
        
      case CircuitBreakerState.OPEN:
        // Already open, just update the stats
        this.failureCount++;
        break;
    }
  }
  
  /**
   * Check if the circuit is allowing requests
   * @returns Whether the circuit allows the request
   */
  public allowRequest(): boolean {
    const now = Date.now();
    
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Always allow in closed state
        return true;
        
      case CircuitBreakerState.OPEN:
        // Check if it's time to try again
        if (now - this.openTime >= this.config.resetTimeoutMs) {
          this.transitionToHalfOpen();
          return this.allowRequest(); // Re-check with new state
        }
        return false;
        
      case CircuitBreakerState.HALF_OPEN:
        // Allow a limited number of requests
        if (this.halfOpenRequests < this.config.halfOpenMaxRequests) {
          this.halfOpenRequests++;
          return true;
        }
        return false;
        
      default:
        return false;
    }
  }
  
  /**
   * Reset the circuit breaker to closed state and clear all counters
   */
  public reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this.requestCount = 0;
    this.firstFailureTime = 0;
    this.lastFailureTime = 0;
    this.openTime = 0;
    this.halfOpenRequests = 0;
  }
  
  /**
   * Get the current state of the circuit breaker
   * @returns Current state
   */
  public getState(): CircuitBreakerState {
    return this.state;
  }
  
  /**
   * Get detailed status of the circuit breaker
   * @returns Circuit breaker status
   */
  public getStatus(): CircuitBreakerStatus {
    const now = Date.now();
    
    const status: CircuitBreakerStatus = {
      state: this.state,
      failureCount: this.failureCount,
    };
    
    if (this.lastFailureTime > 0) {
      status.lastFailure = this.lastFailureTime;
    }
    
    if (this.lastSuccessTime > 0) {
      status.lastSuccess = this.lastSuccessTime;
    }
    
    if (this.state === CircuitBreakerState.OPEN) {
      const nextRetry = this.openTime + this.config.resetTimeoutMs;
      if (nextRetry > now) {
        status.nextRetry = nextRetry;
      }
    }
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      status.consecutiveSuccesses = this.consecutiveSuccesses;
    }
    
    status.requestCount = this.requestCount;
    
    return status;
  }
  
  /**
   * Transition to the open state
   */
  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.openTime = Date.now();
    this.consecutiveSuccesses = 0;
    this.halfOpenRequests = 0;
  }
  
  /**
   * Transition to the half-open state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.consecutiveSuccesses = 0;
    this.halfOpenRequests = 0;
  }
  
  /**
   * Transition to the closed state
   */
  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.resetFailures();
  }
  
  /**
   * Reset failure counters
   */
  private resetFailures(): void {
    this.failureCount = 0;
    this.firstFailureTime = 0;
    this.consecutiveSuccesses = 0;
  }
} 