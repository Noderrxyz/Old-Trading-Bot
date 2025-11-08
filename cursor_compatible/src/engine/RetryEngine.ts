import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  backoffStrategy: 'exponential' | 'linear';
  maxDelayMs: number;
  gasAdjustmentFactor: number;
  sizeReductionFactor: number;
  logDir: string;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffStrategy: 'exponential',
  maxDelayMs: 30000,
  gasAdjustmentFactor: 1.2,
  sizeReductionFactor: 0.8,
  logDir: 'logs/retries'
};

/**
 * Retry attempt
 */
export interface RetryAttempt {
  attemptNumber: number;
  timestamp: number;
  error: string;
  adjustedParams: {
    gasLimit?: number;
    size?: number;
    venue?: string;
  };
  success: boolean;
}

/**
 * Retry result
 */
export interface RetryResult {
  success: boolean;
  attempts: RetryAttempt[];
  finalError?: string;
}

/**
 * Retry Engine
 */
export class RetryEngine {
  private static instance: RetryEngine | null = null;
  private config: RetryConfig;
  private telemetryBus: TelemetryBus;
  private activeRetries: Map<string, RetryResult>;

  private constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.activeRetries = new Map();
    this.ensureLogDir();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<RetryConfig>): RetryEngine {
    if (!RetryEngine.instance) {
      RetryEngine.instance = new RetryEngine(config);
    }
    return RetryEngine.instance;
  }

  /**
   * Retry execution with backoff and parameter adjustments
   */
  public async retryExecution(
    agentId: string,
    strategyId: string,
    executionFn: () => Promise<any>,
    initialParams: {
      gasLimit?: number;
      size?: number;
      venue?: string;
    }
  ): Promise<RetryResult> {
    const retryId = `${agentId}_${strategyId}_${Date.now()}`;
    const result: RetryResult = {
      success: false,
      attempts: []
    };

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Calculate delay based on backoff strategy
        const delay = this.calculateDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Adjust parameters for this attempt
        const adjustedParams = this.adjustParameters(initialParams, attempt);
        
        // Execute with adjusted parameters
        const executionResult = await executionFn();

        // Record successful attempt
        const attemptResult: RetryAttempt = {
          attemptNumber: attempt,
          timestamp: Date.now(),
          error: '',
          adjustedParams,
          success: true
        };

        result.attempts.push(attemptResult);
        result.success = true;

        this.logRetry(agentId, strategyId, attemptResult);
        this.telemetryBus.emit('retry_success', {
          agentId,
          strategyId,
          attempt,
          params: adjustedParams
        });

        return result;
      } catch (error) {
        // Record failed attempt
        const attemptResult: RetryAttempt = {
          attemptNumber: attempt,
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          adjustedParams: this.adjustParameters(initialParams, attempt),
          success: false
        };

        result.attempts.push(attemptResult);
        this.logRetry(agentId, strategyId, attemptResult);

        this.telemetryBus.emit('retry_failure', {
          agentId,
          strategyId,
          attempt,
          error: attemptResult.error,
          params: attemptResult.adjustedParams
        });

        if (attempt === this.config.maxRetries) {
          result.finalError = attemptResult.error;
        }
      }
    }

    this.activeRetries.set(retryId, result);
    return result;
  }

  /**
   * Calculate delay based on backoff strategy
   */
  private calculateDelay(attempt: number): number {
    if (this.config.backoffStrategy === 'exponential') {
      return Math.min(
        this.config.baseDelayMs * Math.pow(2, attempt - 1),
        this.config.maxDelayMs
      );
    } else {
      return Math.min(
        this.config.baseDelayMs * attempt,
        this.config.maxDelayMs
      );
    }
  }

  /**
   * Adjust parameters for retry attempt
   */
  private adjustParameters(
    params: {
      gasLimit?: number;
      size?: number;
      venue?: string;
    },
    attempt: number
  ): {
    gasLimit?: number;
    size?: number;
    venue?: string;
  } {
    const adjusted = { ...params };

    if (adjusted.gasLimit) {
      adjusted.gasLimit = Math.floor(
        adjusted.gasLimit * Math.pow(this.config.gasAdjustmentFactor, attempt)
      );
    }

    if (adjusted.size) {
      adjusted.size = Math.floor(
        adjusted.size * Math.pow(this.config.sizeReductionFactor, attempt)
      );
    }

    return adjusted;
  }

  /**
   * Log retry attempt
   */
  private logRetry(
    agentId: string,
    strategyId: string,
    attempt: RetryAttempt
  ): void {
    const logDir = path.join(this.config.logDir, agentId);
    const logFile = path.join(logDir, `${strategyId}.jsonl`);

    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      fs.appendFileSync(
        logFile,
        JSON.stringify({
          ...attempt,
          agentId,
          strategyId
        }) + '\n'
      );
    } catch (error) {
      logger.error(`Error logging retry attempt: ${error}`);
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }
    } catch (error) {
      logger.error(`Error creating log directory: ${error}`);
    }
  }

  /**
   * Get retry history for agent and strategy
   */
  public getRetryHistory(
    agentId: string,
    strategyId: string
  ): RetryAttempt[] {
    const logFile = path.join(
      this.config.logDir,
      agentId,
      `${strategyId}.jsonl`
    );

    try {
      if (!fs.existsSync(logFile)) {
        return [];
      }

      const content = fs.readFileSync(logFile, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      logger.error(`Error reading retry history: ${error}`);
      return [];
    }
  }

  /**
   * Cleanup old retry data
   */
  public cleanupOldData(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [retryId, result] of this.activeRetries.entries()) {
      const lastAttempt = result.attempts[result.attempts.length - 1];
      if (now - lastAttempt.timestamp > maxAgeMs) {
        this.activeRetries.delete(retryId);
      }
    }
  }
} 