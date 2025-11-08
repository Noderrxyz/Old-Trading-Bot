/**
 * Smart Retry Manager
 * 
 * Manages transaction retries and panic protection for the trading bot.
 * Integrates with existing execution components to provide intelligent retry
 * logic and panic protection.
 */

import { createLogger } from '../common/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { TransactionGuard } from './risk/TransactionGuard.js';
import { ProtectiveWrapper, ProtectiveStrategy } from './risk/ProtectiveWrapper.js';
import { OrderIntent, ExecutedOrder } from '../types/execution.types.js';
import { SimulationEventType } from '../simulation/types/simulation.types.js';

const logger = createLogger('SmartRetryManager');

/**
 * Configuration for the smart retry manager
 */
export interface SmartRetryConfig {
  // Maximum number of retry attempts per transaction
  maxRetries: number;
  
  // Base delay between retries in milliseconds
  baseDelayMs: number;
  
  // Maximum delay between retries in milliseconds
  maxDelayMs: number;
  
  // Jitter factor for delay randomization (0-1)
  jitterFactor: number;
  
  // Whether to use exponential backoff
  useExponentialBackoff: boolean;
  
  // Panic protection thresholds
  panicThresholds: {
    // Maximum number of consecutive failures before panic
    maxConsecutiveFailures: number;
    
    // Maximum number of failures per minute before panic
    maxFailuresPerMinute: number;
    
    // Maximum gas price multiplier before panic
    maxGasPriceMultiplier: number;
    
    // Maximum slippage percentage before panic
    maxSlippagePercentage: number;
  };
  
  // Circuit breaker settings
  circuitBreaker: {
    // Time to wait after panic before allowing new trades (ms)
    cooldownPeriodMs: number;
    
    // Whether to automatically recover after cooldown
    autoRecover: boolean;
    
    // Whether to require manual intervention after panic
    requireManualIntervention: boolean;
  };
}

const DEFAULT_CONFIG: SmartRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterFactor: 0.2,
  useExponentialBackoff: true,
  panicThresholds: {
    maxConsecutiveFailures: 5,
    maxFailuresPerMinute: 10,
    maxGasPriceMultiplier: 3.0,
    maxSlippagePercentage: 5.0
  },
  circuitBreaker: {
    cooldownPeriodMs: 300000, // 5 minutes
    autoRecover: true,
    requireManualIntervention: false
  }
};

/**
 * Transaction failure reason
 */
export type FailureReason = 
  | 'gas_too_low'
  | 'slippage_too_high'
  | 'insufficient_liquidity'
  | 'chain_congestion'
  | 'oracle_delay'
  | 'contract_reverted'
  | 'unknown';

/**
 * Transaction failure details
 */
export interface FailureDetails {
  reason: FailureReason;
  message: string;
  data?: any;
  recoverable: boolean;
}

/**
 * Retry metrics
 */
export interface RetryMetrics {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  averageDelayMs: number;
  maxDelayMs: number;
  panicEvents: number;
  lastPanicTime?: number;
  consecutiveFailures: number;
  failuresInLastMinute: number;
}

export class SmartRetryManager {
  private static instance: SmartRetryManager | null = null;
  private config: SmartRetryConfig;
  private metrics: RetryMetrics;
  private isPanicMode: boolean = false;
  private panicStartTime?: number;
  private failureTimestamps: number[] = [];
  private transactionGuard: TransactionGuard;
  private protectiveWrapper: ProtectiveWrapper;

  private constructor(
    transactionGuard: TransactionGuard,
    config: Partial<SmartRetryConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.transactionGuard = transactionGuard;
    this.protectiveWrapper = new ProtectiveWrapper();
    this.metrics = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageDelayMs: 0,
      maxDelayMs: 0,
      panicEvents: 0,
      consecutiveFailures: 0,
      failuresInLastMinute: 0
    };
  }

  public static getInstance(
    transactionGuard: TransactionGuard,
    config?: Partial<SmartRetryConfig>
  ): SmartRetryManager {
    if (!SmartRetryManager.instance) {
      SmartRetryManager.instance = new SmartRetryManager(transactionGuard, config);
    }
    return SmartRetryManager.instance;
  }

  /**
   * Execute a transaction with smart retry logic
   */
  public async executeWithRetry(
    executeFunc: (order: OrderIntent) => Promise<ExecutedOrder>,
    order: OrderIntent
  ): Promise<ExecutedOrder> {
    if (this.isPanicMode) {
      throw new Error('System is in panic mode - no new transactions allowed');
    }

    let lastError: any = null;
    let lastFailureDetails: FailureDetails | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Update metrics
        this.metrics.totalAttempts++;
        
        // Execute with protective wrapper
        const result = await this.protectiveWrapper.wrapExecution(
          executeFunc,
          order,
          this.selectProtectionStrategy(attempt, lastFailureDetails)
        );

        if (result.success) {
          // Successful execution
          this.metrics.successfulRetries += attempt > 0 ? 1 : 0;
          this.resetFailureMetrics();
          return result.executedOrder!;
        }

        // Handle failure
        lastError = result.error;
        lastFailureDetails = this.analyzeFailure(result.error);
        
        if (!lastFailureDetails.recoverable) {
          this.triggerPanic('non_recoverable_failure', lastFailureDetails);
          throw new Error(`Non-recoverable failure: ${lastFailureDetails.message}`);
        }

        // Check panic thresholds
        if (this.shouldTriggerPanic()) {
          this.triggerPanic('threshold_exceeded', lastFailureDetails);
          throw new Error('Panic triggered due to threshold exceeded');
        }

        // Calculate delay with backoff and jitter
        const delayMs = this.calculateDelay(attempt);
        this.metrics.averageDelayMs = (this.metrics.averageDelayMs * (this.metrics.totalAttempts - 1) + delayMs) / this.metrics.totalAttempts;
        this.metrics.maxDelayMs = Math.max(this.metrics.maxDelayMs, delayMs);

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delayMs));

      } catch (error) {
        lastError = error;
        this.metrics.failedRetries++;
        this.metrics.consecutiveFailures++;
        this.failureTimestamps.push(Date.now());
        this.cleanupOldFailures();
        
        if (attempt === this.config.maxRetries) {
          this.triggerPanic('max_retries_exceeded', {
            reason: 'unknown',
            message: 'Maximum retry attempts exceeded',
            recoverable: false
          });
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if system should enter panic mode
   */
  private shouldTriggerPanic(): boolean {
    // Check consecutive failures
    if (this.metrics.consecutiveFailures >= this.config.panicThresholds.maxConsecutiveFailures) {
      return true;
    }

    // Check failures per minute
    if (this.metrics.failuresInLastMinute >= this.config.panicThresholds.maxFailuresPerMinute) {
      return true;
    }

    return false;
  }

  /**
   * Trigger panic mode
   */
  private triggerPanic(reason: string, details: FailureDetails): void {
    this.isPanicMode = true;
    this.panicStartTime = Date.now();
    this.metrics.panicEvents++;
    
    // Emit panic event
    ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
      type: SimulationEventType.ChaosEvent,
      eventType: 'chain_congestion',
      severity: 1.0,
      durationMs: this.config.circuitBreaker.cooldownPeriodMs,
      timestamp: Date.now()
    });

    logger.error(`Panic triggered: ${reason}`, details);

    // Start recovery timer if auto-recovery is enabled
    if (this.config.circuitBreaker.autoRecover) {
      setTimeout(() => this.attemptRecovery(), this.config.circuitBreaker.cooldownPeriodMs);
    }
  }

  /**
   * Attempt to recover from panic mode
   */
  private attemptRecovery(): void {
    if (!this.isPanicMode) return;

    // Check if manual intervention is required
    if (this.config.circuitBreaker.requireManualIntervention) {
      logger.info('Manual intervention required for recovery');
      return;
    }

    // Reset panic mode
    this.isPanicMode = false;
    this.panicStartTime = undefined;
    this.resetFailureMetrics();

    logger.info('System recovered from panic mode');
  }

  /**
   * Reset failure metrics
   */
  private resetFailureMetrics(): void {
    this.metrics.consecutiveFailures = 0;
    this.failureTimestamps = [];
    this.metrics.failuresInLastMinute = 0;
  }

  /**
   * Clean up old failure timestamps
   */
  private cleanupOldFailures(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.failureTimestamps = this.failureTimestamps.filter(timestamp => timestamp > oneMinuteAgo);
    this.metrics.failuresInLastMinute = this.failureTimestamps.length;
  }

  /**
   * Calculate delay with backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    let delay = this.config.baseDelayMs;

    if (this.config.useExponentialBackoff) {
      delay *= Math.pow(2, attempt);
    }

    // Add jitter
    const jitter = delay * this.config.jitterFactor * (Math.random() * 2 - 1);
    delay += jitter;

    // Cap at maximum delay
    return Math.min(delay, this.config.maxDelayMs);
  }

  /**
   * Analyze failure and determine if it's recoverable
   */
  private analyzeFailure(error: any): FailureDetails {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for common failure patterns
    if (errorMessage.includes('gas too low')) {
      return {
        reason: 'gas_too_low',
        message: errorMessage,
        data: error,
        recoverable: true
      };
    }

    if (errorMessage.includes('slippage')) {
      return {
        reason: 'slippage_too_high',
        message: errorMessage,
        data: error,
        recoverable: true
      };
    }

    if (errorMessage.includes('insufficient liquidity')) {
      return {
        reason: 'insufficient_liquidity',
        message: errorMessage,
        data: error,
        recoverable: false
      };
    }

    if (errorMessage.includes('reverted')) {
      return {
        reason: 'contract_reverted',
        message: errorMessage,
        data: error,
        recoverable: false
      };
    }

    // Default to unknown but potentially recoverable
    return {
      reason: 'unknown',
      message: errorMessage,
      data: error,
      recoverable: true
    };
  }

  /**
   * Select protection strategy based on attempt and failure details
   */
  private selectProtectionStrategy(
    attempt: number,
    lastFailure: FailureDetails | null
  ): ProtectiveStrategy {
    if (attempt === 0) {
      return ProtectiveStrategy.FAIL_SILENT;
    }

    if (lastFailure?.reason === 'gas_too_low') {
      return ProtectiveStrategy.RETRY_WITH_BACKOFF;
    }

    if (lastFailure?.reason === 'slippage_too_high') {
      return ProtectiveStrategy.SPLIT_TRADE;
    }

    if (lastFailure?.reason === 'chain_congestion') {
      return ProtectiveStrategy.PRIVATE_TX;
    }

    return ProtectiveStrategy.RETRY_WITH_BACKOFF;
  }

  /**
   * Get current metrics
   */
  public getMetrics(): RetryMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if system is in panic mode
   */
  public isInPanicMode(): boolean {
    return this.isPanicMode;
  }

  /**
   * Manually recover from panic mode
   */
  public manualRecovery(): void {
    this.attemptRecovery();
  }
} 