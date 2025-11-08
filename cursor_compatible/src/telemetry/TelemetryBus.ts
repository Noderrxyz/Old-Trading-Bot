import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * Telemetry event
 */
// High: strengthen typing and add discriminated unions for events
export interface SystemMetrics {
  memoryUsage: number;
  threadCount: number;
  errorCount: number;
  retryRate: number;
  trustDecay: number;
  timestamp: number;
}

export interface AgentMetrics {
  id: string;
  entropy: number;
  stability: number;
  errorRate: number;
}

export type TelemetryEvent =
  | ({ type: 'system_metrics' } & SystemMetrics)
  | ({ type: 'agent_metrics' } & AgentMetrics)
  | { type: string; timestamp: number; [key: string]: any };

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  logFilePath: string;
  maxLogSize: number;
  maxLogFiles: number;
  flushIntervalMs: number;
  // Medium: SLOs/backpressure
  maxBatchSize?: number;
  maxQueueSize?: number;
  warnAtPercent?: number;
}

/**
 * Default telemetry configuration
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  logFilePath: 'telemetry.log',
  maxLogSize: 10485760, // 10MB
  maxLogFiles: 5,
  flushIntervalMs: 60000, // 1 minute
  maxBatchSize: parseInt(process.env.TELEMETRY_MAX_BATCH_SIZE || '500', 10),
  maxQueueSize: parseInt(process.env.TELEMETRY_MAX_QUEUE_SIZE || '10000', 10),
  warnAtPercent: parseInt(process.env.TELEMETRY_WARN_AT_PERCENT || '80', 10)
};

/**
 * Telemetry Bus
 */
export class TelemetryBus extends EventEmitter {
  private static instance: TelemetryBus | null = null;
  private config: TelemetryConfig;
  private logStream: fs.WriteStream | null = null;
  private eventListeners: Map<string, Set<(event: TelemetryEvent) => void>>;
  private flushInterval: NodeJS.Timeout | null = null;
  // Critical: buffer writes and avoid sync FS
  private writeQueue: string[] = [];
  private draining = false;
  // Medium: counters
  private droppedEvents = 0;
  private writeErrors = 0;
  // Optional sink
  private sink: { writeBatch(events: TelemetryEvent[]): Promise<void> } | null = null;

  private constructor(config: Partial<TelemetryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    this.eventListeners = new Map();
    this.setupLogStream();
    this.startFlushInterval();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<TelemetryConfig>): TelemetryBus {
    if (!TelemetryBus.instance) {
      TelemetryBus.instance = new TelemetryBus(config);
    }
    return TelemetryBus.instance;
  }

  /**
   * Emit a telemetry event
   */
  public emit(type: string, data: any): boolean {
    const event: TelemetryEvent = { type, timestamp: Date.now(), ...(
      typeof data === 'object' && data !== null ? data : { value: data }
    ) } as TelemetryEvent;

    // Notify listeners
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          logger.error(`Error in telemetry listener for ${type}:`, error);
        }
      }
    }

    // Log event
    this.enqueueLog(event);
    return super.emit(type, event);
  }

  /**
   * Subscribe to telemetry events
   */
  public on(type: string, listener: (event: TelemetryEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  /**
   * Unsubscribe from telemetry events
   */
  public off(type: string, listener: (event: TelemetryEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(type);
      }
    }
  }

  /**
   * Remove all listeners for a specific event type or all events
   * @param type Optional event type. If not provided, all listeners for all events will be removed
   */
  public removeAllListeners(type?: string): void {
    if (type) {
      // Remove all listeners for the specified event type
      this.eventListeners.delete(type);
    } else {
      // Remove all listeners for all event types
      this.eventListeners.clear();
    }
    logger.debug(`Removed all listeners${type ? ` for event: ${type}` : ''}`);
  }

  /**
   * Log a telemetry event
   */
  private enqueueLog(event: TelemetryEvent): void {
    try {
      const logEntry = JSON.stringify(event) + '\n';
      if (this.config.maxQueueSize && this.writeQueue.length >= this.config.maxQueueSize) {
        // Drop oldest entry
        this.writeQueue.shift();
        this.droppedEvents++;
      }
      this.writeQueue.push(logEntry);
      const usedPct = Math.floor((this.writeQueue.length / (this.config.maxQueueSize || 1)) * 100);
      if (this.config.warnAtPercent && usedPct >= this.config.warnAtPercent) {
        logger.warn('Telemetry queue high water mark', { usedPct, size: this.writeQueue.length });
      }
      if (!this.draining) {
        // fire and forget
        void this.drainQueue();
      }
    } catch (error) {
      logger.error('Failed to enqueue telemetry event', error);
    }
  }

  private async drainQueue(): Promise<void> {
    if (!this.logStream || this.draining) return;
    this.draining = true;
    try {
      while (this.writeQueue.length > 0) {
        const batchSize = Math.max(1, Math.min(this.writeQueue.length, this.config.maxBatchSize || 500));
        const batch = this.writeQueue.splice(0, batchSize);
        const chunk = batch.join('');
        await new Promise<void>((resolve, reject) => {
          this.logStream!.write(chunk, (err) => (err ? reject(err) : resolve()));
        });
        if (this.sink) {
          try {
            // Parse a subset for sink; safe in paper-mode only
            const events: TelemetryEvent[] = batch.map(line => JSON.parse(line)).filter(Boolean);
            await this.sink.writeBatch(events);
          } catch (e) {
            this.writeErrors++;
            logger.warn('Telemetry sink write failed', { error: e instanceof Error ? e.message : String(e) });
          }
        }
        // Periodically check rotation
        await this.checkLogSizeAsync();
      }
    } catch (error) {
      logger.error('Error draining telemetry log queue:', error);
    } finally {
      this.draining = false;
    }
  }

  /**
   * Check log size and rotate if needed
   */
  private async checkLogSizeAsync(): Promise<void> {
    if (!this.logStream) return;
    try {
      const stats = await fs.promises.stat(this.config.logFilePath);
      if (stats.size >= this.config.maxLogSize) {
        await this.rotateLogAsync();
      }
    } catch (error) {
      // Ignore ENOENT during rotation
      if ((error as any)?.code !== 'ENOENT') {
        logger.error('Error checking telemetry log size:', error);
      }
    }
  }

  /**
   * Rotate log file
   */
  private async rotateLogAsync(): Promise<void> {
    if (!this.logStream) return;
    try {
      await new Promise<void>((resolve) => this.logStream!.end(resolve));
      // Rotate existing log files
      for (let i = this.config.maxLogFiles - 1; i >= 0; i--) {
        const currentPath = i === 0 ? this.config.logFilePath : `${this.config.logFilePath}.${i}`;
        const nextPath = `${this.config.logFilePath}.${i + 1}`;
        try {
          await fs.promises.access(currentPath, fs.constants.F_OK);
        } catch {
          continue;
        }
        if (i === this.config.maxLogFiles - 1) {
          await fs.promises.unlink(currentPath);
        } else {
          await fs.promises.rename(currentPath, nextPath);
        }
      }
      this.setupLogStream();
    } catch (error) {
      logger.error('Error rotating telemetry log:', error);
    }
  }

  /**
   * Setup log stream
   */
  private setupLogStream(): void {
    try {
      const logDir = path.dirname(this.config.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      this.logStream = fs.createWriteStream(this.config.logFilePath, { flags: 'a' });
    } catch (error) {
      logger.error('Error setting up telemetry log stream:', error);
    }
  }

  /**
   * Start flush interval
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(
      () => this.flushLog(),
      this.config.flushIntervalMs
    );
  }

  /**
   * Flush log stream
   */
  private flushLog(): void {
    if (this.logStream && this.writeQueue.length > 0) {
      void this.drainQueue();
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
    this.removeAllListeners();
  }

  // Medium: counters and sink controls
  public getQueueSize(): number { return this.writeQueue.length; }
  public getDroppedEvents(): number { return this.droppedEvents; }
  public getWriteErrors(): number { return this.writeErrors; }
  public setSink(sink: { writeBatch(events: TelemetryEvent[]): Promise<void> } | null): void { this.sink = sink; }
} 