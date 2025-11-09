/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Circuit tripped, blocking operations
  HALF_OPEN = 'half_open', // Testing if system recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes to close from half-open
  timeout: number;               // Time in ms before trying half-open
  monitoringWindow: number;      // Time window for failure counting
  maxDrawdownBps: number;        // Max portfolio drawdown before tripping (basis points)
  maxGasPrice: bigint;           // Max gas price before tripping
  minHealthScore: number;        // Min health score (0-100) before tripping
}

/**
 * Circuit breaker event
 */
export interface CircuitBreakerEvent {
  timestamp: number;
  state: CircuitState;
  previousState: CircuitState;
  reason: string;
  metadata?: Record<string, any>;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  score: number; // 0-100
  checks: {
    name: string;
    passed: boolean;
    message?: string;
  }[];
}

/**
 * Circuit Breaker for automatic safety mechanisms
 * 
 * Features:
 * - Automatic pause on failures
 * - Drawdown protection
 * - Gas price protection
 * - Health monitoring
 * - Automatic recovery testing
 * - Event logging
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private config: CircuitBreakerConfig;
  private failures: number[] = []; // Timestamps of failures
  private successes: number = 0;
  private lastStateChange: number = Date.now();
  private events: CircuitBreakerEvent[] = [];
  private halfOpenTimeout?: NodeJS.Timeout;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      successThreshold: config?.successThreshold ?? 3,
      timeout: config?.timeout ?? 60000, // 1 minute
      monitoringWindow: config?.monitoringWindow ?? 300000, // 5 minutes
      maxDrawdownBps: config?.maxDrawdownBps ?? 500, // 5%
      maxGasPrice: config?.maxGasPrice ?? ethers.parseUnits('100', 'gwei'),
      minHealthScore: config?.minHealthScore ?? 70,
    };
  }

  /**
   * Check if operation is allowed
   */
  async isOperationAllowed(): Promise<{ allowed: boolean; reason?: string }> {
    if (this.state === CircuitState.OPEN) {
      return {
        allowed: false,
        reason: 'Circuit breaker is OPEN - operations are blocked',
      };
    }

    if (this.state === CircuitState.HALF_OPEN) {
      return {
        allowed: true,
        reason: 'Circuit breaker is HALF_OPEN - testing recovery',
      };
    }

    return { allowed: true };
  }

  /**
   * Record operation success
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED, 'Success threshold reached');
        this.successes = 0;
        this.failures = [];
      }
    }
  }

  /**
   * Record operation failure
   */
  recordFailure(reason: string): void {
    const now = Date.now();
    this.failures.push(now);

    // Remove old failures outside monitoring window
    this.failures = this.failures.filter(
      timestamp => now - timestamp < this.config.monitoringWindow
    );

    // Check if failure threshold exceeded
    if (this.failures.length >= this.config.failureThreshold) {
      this.trip(reason);
    }
  }

  /**
   * Trip circuit breaker (open it)
   */
  trip(reason: string, metadata?: Record<string, any>): void {
    if (this.state === CircuitState.OPEN) {
      return; // Already open
    }

    this.transitionTo(CircuitState.OPEN, reason, metadata);

    // Schedule transition to half-open
    this.halfOpenTimeout = setTimeout(() => {
      this.transitionTo(CircuitState.HALF_OPEN, 'Timeout reached, testing recovery');
    }, this.config.timeout);
  }

  /**
   * Manually reset circuit breaker
   */
  reset(reason: string = 'Manual reset'): void {
    if (this.halfOpenTimeout) {
      clearTimeout(this.halfOpenTimeout);
      this.halfOpenTimeout = undefined;
    }

    this.failures = [];
    this.successes = 0;
    this.transitionTo(CircuitState.CLOSED, reason);
  }

  /**
   * Check portfolio drawdown
   */
  async checkDrawdown(currentValue: bigint, peakValue: bigint): Promise<void> {
    if (peakValue === 0n) {
      return;
    }

    const drawdownBps = Number(((peakValue - currentValue) * 10000n) / peakValue);

    if (drawdownBps > this.config.maxDrawdownBps) {
      this.trip('Drawdown limit exceeded', {
        drawdownBps,
        maxDrawdownBps: this.config.maxDrawdownBps,
        currentValue: currentValue.toString(),
        peakValue: peakValue.toString(),
      });
    }
  }

  /**
   * Check gas price
   */
  async checkGasPrice(currentGasPrice: bigint): Promise<void> {
    if (currentGasPrice > this.config.maxGasPrice) {
      this.trip('Gas price too high', {
        currentGasPrice: currentGasPrice.toString(),
        maxGasPrice: this.config.maxGasPrice.toString(),
      });
    }
  }

  /**
   * Check system health
   */
  async checkHealth(healthResult: HealthCheckResult): Promise<void> {
    if (healthResult.score < this.config.minHealthScore) {
      this.trip('Health score too low', {
        score: healthResult.score,
        minScore: this.config.minHealthScore,
        failedChecks: healthResult.checks.filter(c => !c.passed),
      });
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current statistics
   */
  getStatistics() {
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.successes,
      lastStateChange: this.lastStateChange,
      timeSinceLastChange: Date.now() - this.lastStateChange,
      events: this.events.length,
    };
  }

  /**
   * Get recent events
   */
  getEvents(limit: number = 10): CircuitBreakerEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState, reason: string, metadata?: Record<string, any>): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    // Log event
    const event: CircuitBreakerEvent = {
      timestamp: this.lastStateChange,
      state: newState,
      previousState,
      reason,
      metadata,
    };
    this.events.push(event);

    // Keep only last 100 events
    if (this.events.length > 100) {
      this.events = this.events.slice(-100);
    }

    console.log(`Circuit breaker: ${previousState} -> ${newState} (${reason})`);
  }
}

// Import ethers for gas price parsing
import { ethers } from 'ethers';
