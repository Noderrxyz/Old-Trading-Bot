import { WebSocket } from 'ws';
import { TrustManager } from '../governance/TrustManager.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export interface RetryContext {
  symbol: string;
  venue: string;
  reason: 'revert' | 'outOfGas' | 'slippageTooHigh';
  attempt: number;
  maxRetries: number;
  availableVenues?: string[];
}

interface RetryLogEntry {
  symbol: string;
  reason: string;
  venue: string;
  attempt: number;
  success: boolean;
  timestamp: number;
}

interface RetryConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  logFilePath: string;
  wsAlertUrl?: string;
}

const DEFAULT_CONFIG: RetryConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  maxRetries: 3,
  logFilePath: path.join(process.cwd(), 'logs', 'execution', 'retry_log.jsonl')
};

export class OrderRetryEngine {
  private static instance: OrderRetryEngine;
  private config: RetryConfig;
  private wsClient: WebSocket | null;
  private retryQueue: Map<string, RetryContext>;

  private constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.wsClient = this.config.wsAlertUrl ? new WebSocket(this.config.wsAlertUrl) : null;
    this.retryQueue = new Map();
    this.setupLogDirectory();
  }

  public static getInstance(config?: Partial<RetryConfig>): OrderRetryEngine {
    if (!OrderRetryEngine.instance) {
      OrderRetryEngine.instance = new OrderRetryEngine(config);
    }
    return OrderRetryEngine.instance;
  }

  private setupLogDirectory(): void {
    const logDir = path.dirname(this.config.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  public async retry(context: RetryContext): Promise<boolean> {
    const { symbol, venue, reason, attempt, maxRetries, availableVenues } = context;
    const retryKey = `${symbol}-${venue}-${attempt}`;

    if (attempt >= maxRetries) {
      this.handleMaxRetriesExhausted(context);
      return false;
    }

    // Calculate exponential backoff delay
    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, attempt),
      this.config.maxDelayMs
    );

    // Log retry attempt
    this.logRetryAttempt({
      symbol,
      reason,
      venue,
      attempt,
      success: false,
      timestamp: Date.now()
    });

    // If we have multiple venues available, try rotating
    if (availableVenues && availableVenues.length > 1) {
      const nextVenue = this.rotateVenue(venue, availableVenues);
      if (nextVenue) {
        logger.info(`Rotating from ${venue} to ${nextVenue} for ${symbol}`);
        context.venue = nextVenue;
      }
    }

    // Add to retry queue
    this.retryQueue.set(retryKey, context);

    // Wait for backoff period
    await new Promise(resolve => setTimeout(resolve, delay));

    // Remove from queue after delay
    this.retryQueue.delete(retryKey);

    return true;
  }

  private rotateVenue(currentVenue: string, availableVenues: string[]): string | null {
    const currentIndex = availableVenues.indexOf(currentVenue);
    if (currentIndex === -1) return null;

    // Get next venue in rotation
    const nextIndex = (currentIndex + 1) % availableVenues.length;
    return availableVenues[nextIndex];
  }

  private handleMaxRetriesExhausted(context: RetryContext): void {
    const { symbol, venue, reason, attempt } = context;

    // Log final failure
    this.logRetryAttempt({
      symbol,
      reason,
      venue,
      attempt,
      success: false,
      timestamp: Date.now()
    });

    // Emit WebSocket alert
    this.emitAlert({
      type: 'execution_failure',
      symbol,
      reason,
      attempts: attempt
    });

    // Decay trust in the venue
    TrustManager.getInstance().decay(venue);

    logger.error(`Max retries exhausted for ${symbol} on ${venue} (${reason})`);
  }

  private logRetryAttempt(entry: RetryLogEntry): void {
    try {
      fs.appendFileSync(
        this.config.logFilePath,
        JSON.stringify(entry) + '\n'
      );
    } catch (error) {
      logger.error('Failed to log retry attempt:', error);
    }
  }

  private emitAlert(data: any): void {
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify(data));
    }
  }

  public cleanup(): void {
    if (this.wsClient) {
      this.wsClient.close();
    }
    this.retryQueue.clear();
  }
} 