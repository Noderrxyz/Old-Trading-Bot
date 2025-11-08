import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { Exporter } from './exporters/Exporter';
import { MetricAggregator } from './aggregators/MetricAggregator';
import { TelemetryConfig, defaultTelemetryConfig } from './TelemetryConfig';

// Mock implementation of Prometheus metrics for demonstration purposes
class Histogram {
  private name: string;
  private help: string;
  private labelNames: string[];
  private buckets: number[];
  
  constructor(options: { name: string; help: string; labelNames: string[]; buckets: number[] }) {
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labelNames;
    this.buckets = options.buckets;
  }
  
  observe(labels: Record<string, string>, value: number): void {
    // In a real implementation, this would record the observation
    console.log(`[MOCK HISTOGRAM] ${this.name} with labels ${JSON.stringify(labels)}: ${value}`);
  }
}

class Counter {
  private name: string;
  private help: string;
  private labelNames: string[];
  
  constructor(options: { name: string; help: string; labelNames: string[] }) {
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labelNames;
  }
  
  inc(labels: Record<string, string>, value: number = 1): void {
    // In a real implementation, this would increment the counter
    console.log(`[MOCK COUNTER] ${this.name} with labels ${JSON.stringify(labels)} += ${value}`);
  }
}

class Gauge {
  private name: string;
  private help: string;
  private labelNames: string[];
  
  constructor(options: { name: string; help: string; labelNames: string[] }) {
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labelNames;
  }
  
  set(labels: Record<string, string>, value: number): void {
    // In a real implementation, this would set the gauge value
    console.log(`[MOCK GAUGE] ${this.name} with labels ${JSON.stringify(labels)} = ${value}`);
  }
}

/**
 * Events emitted by telemetry
 */
export enum TelemetryEvents {
  METRIC_RECORDED = 'metric_recorded',
  ERROR_RECORDED = 'error_recorded',
  THRESHOLD_EXCEEDED = 'threshold_exceeded',
  METRICS_FLUSHED = 'metrics_flushed',
  EVENT_RECORDED = 'event_recorded'
}

/**
 * Telemetry severity levels
 */
export enum SeverityLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
  CRITICAL = 4
}

/**
 * Metric data structure
 */
export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * Error data structure
 */
export interface ErrorRecord {
  component: string;
  message: string;
  stack?: string;
  timestamp: number;
  severity: SeverityLevel;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Event data structure
 */
export interface EventRecord {
  name: string;
  component: string;
  timestamp: number;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Rate limiter state
 */
interface RateLimiterState {
  count: number;
  lastReset: number;
}

/**
 * Core telemetry system for monitoring and observability
 */
export class Telemetry extends EventEmitter {
  private static instance: Telemetry;
  private config: TelemetryConfig;
  private exporters: Exporter[] = [];
  private aggregator: MetricAggregator;
  private flushInterval: NodeJS.Timeout | null = null;
  private errorBuffer: ErrorRecord[] = [];
  private errorBufferFlushTimeout: NodeJS.Timeout | null = null;
  private eventBuffer: EventRecord[] = [];
  private rateLimiters: Map<string, RateLimiterState> = new Map();
  private fallbackMode: boolean = false;
  private exporterFailures: Map<string, number> = new Map();

  /**
   * Private constructor - use getInstance()
   */
  private constructor(config: Partial<TelemetryConfig> = {}) {
    super();
    this.config = { ...defaultTelemetryConfig, ...config };
    this.aggregator = new MetricAggregator(this.config);
    
    // Set up flush interval
    if (this.config.metricsFlushIntervalMs > 0) {
      this.flushInterval = setInterval(() => this.flush(), this.config.metricsFlushIntervalMs);
    }
    
    logger.info('Telemetry initialized');
  }

  /**
   * Get singleton instance of telemetry
   */
  public static getInstance(config?: Partial<TelemetryConfig>): Telemetry {
    if (!Telemetry.instance) {
      Telemetry.instance = new Telemetry(config);
    } else if (config) {
      Telemetry.instance.updateConfig(config);
    }
    return Telemetry.instance;
  }

  /**
   * Initialize telemetry with configuration and exporters
   */
  public init(config: Partial<TelemetryConfig> = {}, exporters: Exporter[] = []): void {
    // Update configuration
    this.updateConfig(config);
    
    // Clear existing exporters if any
    this.exporters = [];
    
    // Register provided exporters
    for (const exporter of exporters) {
      this.registerExporter(exporter);
    }
    
    logger.info(`Telemetry initialized with ${exporters.length} exporters`);
  }

  /**
   * Update telemetry configuration
   */
  public updateConfig(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
    this.aggregator.updateConfig(this.config);
    
    // Update flush interval if needed
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    if (this.config.metricsFlushIntervalMs > 0) {
      this.flushInterval = setInterval(() => this.flush(), this.config.metricsFlushIntervalMs);
    }
    
    logger.debug('Telemetry config updated');
  }

  /**
   * Register an exporter
   */
  public registerExporter(exporter: Exporter): void {
    this.exporters.push(exporter);
    logger.debug(`Registered exporter: ${exporter.constructor.name}`);
  }

  /**
   * Record a metric
   */
  public recordMetric(
    name: string,
    value: number,
    tags: Record<string, string> = {}
  ): void {
    try {
      // Skip if telemetry is disabled
      if (!this.config.enabled) {
        return;
      }

      // Apply sampling
      if (!this.shouldSample(name)) {
        return;
      }
      
      // Check if we're rate limited
      if (this.isRateLimited(name)) {
        return;
      }
      
      const timestamp = Date.now();
      const metric: Metric = { name, value, timestamp, tags };
      
      // Add to aggregator
      this.aggregator.addMetric(metric);
      
      // Emit event
      this.emit(TelemetryEvents.METRIC_RECORDED, metric);
      
      // Check against thresholds
      this.checkThresholds(metric);
      
      // If immediate export is enabled, send to exporters
      if (this.config.immediateMetricExport) {
        this.exportMetric(metric);
      }
    } catch (error) {
      logger.error(`Error recording metric: ${error}`);
    }
  }

  /**
   * Record an error
   */
  public recordError(
    component: string,
    error: Error | string,
    severity: SeverityLevel = SeverityLevel.ERROR,
    tags: Record<string, string> = {},
    metadata: Record<string, any> = {}
  ): void {
    try {
      // Skip if telemetry is disabled
      if (!this.config.enabled) {
        return;
      }
      
      const timestamp = Date.now();
      const errorRecord: ErrorRecord = {
        component,
        message: typeof error === 'string' ? error : error.message,
        stack: typeof error === 'string' ? undefined : error.stack,
        timestamp,
        severity,
        tags,
        metadata
      };
      
      // Add to buffer
      this.errorBuffer.push(errorRecord);
      
      // Truncate buffer if it exceeds max size
      if (this.errorBuffer.length > this.config.errorBufferSize) {
        this.errorBuffer = this.errorBuffer.slice(-this.config.errorBufferSize);
      }
      
      // Emit event
      this.emit(TelemetryEvents.ERROR_RECORDED, errorRecord);
      
      // Record error count metric
      this.recordMetric(
        `${component}.error_count`,
        1,
        {
          severity: SeverityLevel[severity],
          error_type: typeof error === 'string' ? 'string' : error.name || 'Error',
          ...tags
        }
      );
      
      // If immediate export is enabled, send to exporters
      if (this.config.immediateErrorExport) {
        this.exportError(errorRecord);
      } else {
        // Schedule buffer flush if not already scheduled
        this.scheduleErrorBufferFlush();
      }
      
      // Log critical errors
      if (severity === SeverityLevel.CRITICAL) {
        logger.error(`CRITICAL ERROR in ${component}: ${errorRecord.message}`);
      }
    } catch (error) {
      logger.error(`Error recording error: ${error}`);
    }
  }

  /**
   * Record an event
   */
  public recordEvent(
    name: string,
    component: string,
    tags: Record<string, string> = {},
    metadata: Record<string, any> = {}
  ): void {
    try {
      // Skip if telemetry is disabled
      if (!this.config.enabled) {
        return;
      }
      
      const timestamp = Date.now();
      const event: EventRecord = {
        name,
        component,
        timestamp,
        tags,
        metadata
      };
      
      // Add to buffer
      this.eventBuffer.push(event);
      
      // Emit event
      this.emit(TelemetryEvents.EVENT_RECORDED, event);
      
      // Record event count metric
      this.recordMetric(
        `${component}.event.${name}`,
        1,
        tags
      );
      
      // Export immediately
      this.exportEvent(event);
    } catch (error) {
      logger.error(`Error recording event: ${error}`);
    }
  }

  /**
   * Get all current metric values
   */
  public getMetrics(): Record<string, number> {
    return this.aggregator.getCurrentValues();
  }

  /**
   * Get aggregated metrics for a time window
   */
  public getAggregatedMetrics(
    windowMs: number = 60000
  ): Record<string, { avg: number; min: number; max: number; count: number }> {
    return this.aggregator.getAggregatedMetrics(windowMs);
  }

  /**
   * Get recent errors
   */
  public getRecentErrors(limit: number = 100): ErrorRecord[] {
    return [...this.errorBuffer].slice(-limit);
  }

  /**
   * Get recent events
   */
  public getRecentEvents(limit: number = 100): EventRecord[] {
    return [...this.eventBuffer].slice(-limit);
  }

  /**
   * Clear all metrics
   */
  public clearMetrics(): void {
    this.aggregator.clear();
  }

  /**
   * Clear error buffer
   */
  public clearErrors(): void {
    this.errorBuffer = [];
  }

  /**
   * Clear event buffer
   */
  public clearEvents(): void {
    this.eventBuffer = [];
  }

  /**
   * Flush metrics to all exporters
   */
  public flush(): void {
    try {
      const metrics = this.aggregator.getMetricsForFlush();
      if (metrics.length === 0) {
        return;
      }
      
      // Send to all exporters
      if (!this.fallbackMode) {
        for (const exporter of this.exporters) {
          try {
            exporter.exportMetrics(metrics);
          } catch (error) {
            this.handleExporterFailure(exporter, error);
          }
        }
      } else {
        // In fallback mode, only use the most reliable exporter
        const reliableExporter = this.findMostReliableExporter();
        if (reliableExporter) {
          try {
            reliableExporter.exportMetrics(metrics);
          } catch (error) {
            logger.error(`Error in fallback exporter ${reliableExporter.constructor.name}: ${error}`);
          }
        }
      }
      
      // Emit event
      this.emit(TelemetryEvents.METRICS_FLUSHED, metrics);
      
      // Reset aggregator if configured
      if (this.config.resetMetricsAfterFlush) {
        this.aggregator.reset();
      }
    } catch (error) {
      logger.error(`Error flushing metrics: ${error}`);
    }
  }

  /**
   * Flush error buffer to all exporters
   */
  private flushErrorBuffer(): void {
    try {
      if (this.errorBuffer.length === 0) {
        return;
      }
      
      // Copy buffer and clear
      const errors = [...this.errorBuffer];
      if (this.config.resetErrorBufferAfterFlush) {
        this.errorBuffer = [];
      }
      
      // Send to all exporters
      if (!this.fallbackMode) {
        for (const exporter of this.exporters) {
          try {
            exporter.exportErrors(errors);
          } catch (error) {
            this.handleExporterFailure(exporter, error);
          }
        }
      } else {
        // In fallback mode, only use the most reliable exporter
        const reliableExporter = this.findMostReliableExporter();
        if (reliableExporter) {
          try {
            reliableExporter.exportErrors(errors);
          } catch (error) {
            logger.error(`Error in fallback exporter ${reliableExporter.constructor.name}: ${error}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error flushing error buffer: ${error}`);
    } finally {
      this.errorBufferFlushTimeout = null;
    }
  }

  /**
   * Schedule error buffer flush
   */
  private scheduleErrorBufferFlush(): void {
    if (this.errorBufferFlushTimeout) {
      return;
    }
    
    this.errorBufferFlushTimeout = setTimeout(
      () => this.flushErrorBuffer(),
      this.config.errorBufferFlushIntervalMs
    );
  }

  /**
   * Export a single metric to all exporters
   */
  private exportMetric(metric: Metric): void {
    if (!this.fallbackMode) {
      for (const exporter of this.exporters) {
        try {
          exporter.exportMetric(metric);
        } catch (error) {
          this.handleExporterFailure(exporter, error);
        }
      }
    } else {
      // In fallback mode, only use the most reliable exporter
      const reliableExporter = this.findMostReliableExporter();
      if (reliableExporter) {
        try {
          reliableExporter.exportMetric(metric);
        } catch (error) {
          logger.error(`Error in fallback exporter ${reliableExporter.constructor.name}: ${error}`);
        }
      }
    }
  }

  /**
   * Export a single error to all exporters
   */
  private exportError(error: ErrorRecord): void {
    if (!this.fallbackMode) {
      for (const exporter of this.exporters) {
        try {
          exporter.exportError(error);
        } catch (e) {
          this.handleExporterFailure(exporter, e);
        }
      }
    } else {
      // In fallback mode, only use the most reliable exporter
      const reliableExporter = this.findMostReliableExporter();
      if (reliableExporter) {
        try {
          reliableExporter.exportError(error);
        } catch (e) {
          logger.error(`Error in fallback exporter ${reliableExporter.constructor.name}: ${e}`);
        }
      }
    }
  }

  /**
   * Export a single event to all exporters with event support
   */
  private exportEvent(event: EventRecord): void {
    if (!this.fallbackMode) {
      for (const exporter of this.exporters) {
        try {
          if ('exportEvent' in exporter) {
            (exporter as any).exportEvent(event);
          }
        } catch (e) {
          this.handleExporterFailure(exporter, e);
        }
      }
    } else {
      // In fallback mode, only use the most reliable exporter
      const reliableExporter = this.findMostReliableExporter();
      if (reliableExporter && 'exportEvent' in reliableExporter) {
        try {
          (reliableExporter as any).exportEvent(event);
        } catch (e) {
          logger.error(`Error in fallback exporter ${reliableExporter.constructor.name}: ${e}`);
        }
      }
    }
  }

  /**
   * Handle exporter failure and track reliability
   */
  private handleExporterFailure(exporter: Exporter, error: any): void {
    const name = exporter.constructor.name;
    logger.error(`Error in exporter ${name}: ${error}`);
    
    // Track failure count
    const failCount = (this.exporterFailures.get(name) || 0) + 1;
    this.exporterFailures.set(name, failCount);
    
    // Enter fallback mode if too many exporters are failing
    if (this.shouldEnterFallbackMode()) {
      if (!this.fallbackMode) {
        logger.warn('Entering telemetry fallback mode due to exporter failures');
        this.fallbackMode = true;
      }
    }
  }

  /**
   * Check if we should enter fallback mode
   */
  private shouldEnterFallbackMode(): boolean {
    // If more than half of exporters have failed at least twice
    const threshold = Math.ceil(this.exporters.length / 2);
    const failingExporters = Array.from(this.exporterFailures.entries())
      .filter(([_, count]) => count >= 2)
      .length;
    
    return failingExporters >= threshold && this.exporters.length > 1;
  }

  /**
   * Find the most reliable exporter for fallback mode
   */
  private findMostReliableExporter(): Exporter | null {
    if (this.exporters.length === 0) {
      return null;
    }
    
    return this.exporters.reduce((mostReliable, current) => {
      const currentFailures = this.exporterFailures.get(current.constructor.name) || 0;
      const mostReliableFailures = mostReliable ? 
        (this.exporterFailures.get(mostReliable.constructor.name) || 0) : Infinity;
      
      return currentFailures < mostReliableFailures ? current : mostReliable;
    }, null as Exporter | null);
  }

  /**
   * Determine if a metric should be sampled based on configuration
   */
  private shouldSample(metricName: string): boolean {
    // Always sample metrics in the allowlist
    if (this.config.alwaysSampledMetrics.includes(metricName)) {
      return true;
    }
    
    // Apply sampling rate
    if (this.config.samplingRate < 1.0) {
      return Math.random() < this.config.samplingRate;
    }
    
    return true;
  }

  /**
   * Check if metric is rate limited
   */
  private isRateLimited(metricName: string): boolean {
    const now = Date.now();
    
    // Check specific rate limit for this metric if defined
    const specificLimit = this.config.metricRateLimitPerSecond[metricName];
    if (specificLimit !== undefined) {
      return this.checkRateLimit(metricName, specificLimit, now);
    }
    
    // Otherwise use global rate limit
    return this.checkRateLimit(`global:${metricName}`, this.config.metricRateLimit, now);
  }

  /**
   * Check rate limit for a specific key
   */
  private checkRateLimit(key: string, limit: number, now: number): boolean {
    if (limit <= 0) {
      return false; // No rate limiting
    }
    
    let state = this.rateLimiters.get(key);
    
    if (!state) {
      // Initialize
      state = { count: 1, lastReset: now };
      this.rateLimiters.set(key, state);
      return false;
    }
    
    // Reset counter if window has passed
    if (now - state.lastReset > this.config.rateLimitWindowMs) {
      state.count = 1;
      state.lastReset = now;
      return false;
    }
    
    // Increment counter and check limit
    state.count++;
    
    return state.count > limit;
  }

  /**
   * Check metric against thresholds
   */
  private checkThresholds(metric: Metric): void {
    const threshold = this.config.metricThresholds[metric.name];
    if (!threshold) {
      return;
    }
    
    let exceeded = false;
    let direction = '';
    
    if (threshold.max !== undefined && metric.value > threshold.max) {
      exceeded = true;
      direction = 'above';
    } else if (threshold.min !== undefined && metric.value < threshold.min) {
      exceeded = true;
      direction = 'below';
    }
    
    if (exceeded) {
      const thresholdEvent = {
        metric,
        threshold,
        direction
      };
      
      this.emit(TelemetryEvents.THRESHOLD_EXCEEDED, thresholdEvent);
      
      // Emit as event
      this.recordEvent(
        'threshold_exceeded',
        'telemetry',
        {
          metric_name: metric.name,
          direction,
          value: String(metric.value),
          threshold: threshold.max !== undefined ? String(threshold.max) : String(threshold.min),
          ...metric.tags || {}
        }
      );
      
      if (threshold.logLevel !== undefined) {
        const message = `Metric ${metric.name} (${metric.value}) is ${direction} threshold`;
        switch (threshold.logLevel) {
          case SeverityLevel.DEBUG:
            logger.debug(message);
            break;
          case SeverityLevel.INFO:
            logger.info(message);
            break;
          case SeverityLevel.WARNING:
            logger.warn(message);
            break;
          case SeverityLevel.ERROR:
            logger.error(message);
            break;
          case SeverityLevel.CRITICAL:
            logger.error(`CRITICAL: ${message}`);
            break;
        }
      }
    }
  }

  /**
   * Reset exporter failure tracking
   */
  public resetExporterFailures(): void {
    this.exporterFailures.clear();
    this.fallbackMode = false;
  }

  /**
   * Stop telemetry system
   */
  public stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    if (this.errorBufferFlushTimeout) {
      clearTimeout(this.errorBufferFlushTimeout);
      this.errorBufferFlushTimeout = null;
    }
    
    // Final flush
    this.flush();
    this.flushErrorBuffer();
    
    logger.info('Telemetry stopped');
  }
}

// Export singleton instance
export const telemetry = Telemetry.getInstance();

// Add the following block for blockchain adapter metrics
/**
 * Blockchain Adapter Metrics
 * 
 * These metrics track performance and reliability of blockchain adapters
 */
export const blockchainAdapterMetrics = {
  // Operation latency histogram
  operationLatency: new Histogram({
    name: 'blockchain_adapter_operation_latency_ms',
    help: 'Latency of blockchain adapter operations in milliseconds',
    labelNames: ['chain_id', 'operation_type', 'is_mainnet'],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  }),

  // Operation success counter
  operationSuccess: new Counter({
    name: 'blockchain_adapter_operation_success_total',
    help: 'Total number of successful blockchain adapter operations',
    labelNames: ['chain_id', 'operation_type', 'is_mainnet']
  }),

  // Operation failure counter
  operationFailure: new Counter({
    name: 'blockchain_adapter_operation_failure_total',
    help: 'Total number of failed blockchain adapter operations',
    labelNames: ['chain_id', 'operation_type', 'error_type', 'is_mainnet']
  }),

  // Circuit breaker state
  circuitBreakerState: new Gauge({
    name: 'blockchain_adapter_circuit_breaker_state',
    help: 'Circuit breaker state (1 = open, 0 = closed)',
    labelNames: ['chain_id', 'is_mainnet']
  }),

  // Block height
  blockHeight: new Gauge({
    name: 'blockchain_block_height',
    help: 'Current block height of the blockchain',
    labelNames: ['chain_id', 'is_mainnet']
  }),

  // Gas price
  gasPrice: new Gauge({
    name: 'blockchain_gas_price_gwei',
    help: 'Current gas price in GWEI',
    labelNames: ['chain_id', 'is_mainnet']
  }),

  // Connection status
  connectionStatus: new Gauge({
    name: 'blockchain_adapter_connected',
    help: 'Connection status (1 = connected, 0 = disconnected)',
    labelNames: ['chain_id', 'is_mainnet']
  }),

  // Trade execution metrics
  tradeExecutionLatency: new Histogram({
    name: 'blockchain_trade_execution_latency_ms',
    help: 'Trade execution latency in milliseconds',
    labelNames: ['chain_id', 'from_asset', 'to_asset', 'is_mainnet'],
    buckets: [500, 1000, 2500, 5000, 10000, 30000, 60000, 120000]
  }),

  tradeExecutionVolume: new Counter({
    name: 'blockchain_trade_execution_volume',
    help: 'Trade execution volume in USD equivalent',
    labelNames: ['chain_id', 'from_asset', 'to_asset', 'is_mainnet']
  }),

  // RPC call metrics
  rpcCallLatency: new Histogram({
    name: 'blockchain_rpc_call_latency_ms',
    help: 'RPC call latency in milliseconds',
    labelNames: ['chain_id', 'method', 'is_mainnet'],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000]
  }),

  rpcCallRetry: new Counter({
    name: 'blockchain_rpc_call_retry_total',
    help: 'Total number of RPC call retries',
    labelNames: ['chain_id', 'method', 'is_mainnet']
  })
};

// Helper function to record blockchain adapter operation
export function recordBlockchainOperation(
  chainId: number,
  operationType: 'connect' | 'disconnect' | 'getBalance' | 'executeTrade' | 'getQuote' | 'getTransactionStatus',
  isMainnet: boolean,
  startTime: number,
  success: boolean,
  errorType?: string
): void {
  const latency = Date.now() - startTime;
  const chainIdStr = chainId.toString();
  const isMainnetStr = isMainnet.toString();

  // Record latency
  blockchainAdapterMetrics.operationLatency.observe(
    { chain_id: chainIdStr, operation_type: operationType, is_mainnet: isMainnetStr },
    latency
  );

  // Record success/failure
  if (success) {
    blockchainAdapterMetrics.operationSuccess.inc({
      chain_id: chainIdStr, 
      operation_type: operationType,
      is_mainnet: isMainnetStr
    });
  } else {
    blockchainAdapterMetrics.operationFailure.inc({
      chain_id: chainIdStr, 
      operation_type: operationType, 
      error_type: errorType || 'unknown',
      is_mainnet: isMainnetStr
    });
  }
}

// Helper function to update blockchain status metrics
export function updateBlockchainStatus(
  chainId: number,
  isMainnet: boolean,
  connected: boolean,
  blockHeight?: number,
  gasPrice?: string
): void {
  const chainIdStr = chainId.toString();
  const isMainnetStr = isMainnet.toString();

  // Update connection status
  blockchainAdapterMetrics.connectionStatus.set(
    { chain_id: chainIdStr, is_mainnet: isMainnetStr },
    connected ? 1 : 0
  );

  // Update block height if available
  if (blockHeight !== undefined) {
    blockchainAdapterMetrics.blockHeight.set(
      { chain_id: chainIdStr, is_mainnet: isMainnetStr },
      blockHeight
    );
  }

  // Update gas price if available
  if (gasPrice !== undefined) {
    // Convert string gas price to number (remove units)
    let gasPriceNum = parseFloat(gasPrice.replace(/[^0-9.]/g, ''));
    
    // If the gas price is in wei, convert to gwei for consistency
    if (gasPriceNum > 1000000000) {
      gasPriceNum = gasPriceNum / 1000000000;
    }
    
    blockchainAdapterMetrics.gasPrice.set(
      { chain_id: chainIdStr, is_mainnet: isMainnetStr },
      gasPriceNum
    );
  }
}

// Helper function to record trade execution
export function recordTradeExecution(
  chainId: number,
  fromAsset: string,
  toAsset: string,
  isMainnet: boolean,
  startTime: number,
  volumeUsd: number,
  success: boolean
): void {
  const latency = Date.now() - startTime;
  const chainIdStr = chainId.toString();
  const isMainnetStr = isMainnet.toString();

  // Record trade execution latency
  blockchainAdapterMetrics.tradeExecutionLatency.observe(
    { chain_id: chainIdStr, from_asset: fromAsset, to_asset: toAsset, is_mainnet: isMainnetStr },
    latency
  );

  // Record trade volume
  if (success && volumeUsd > 0) {
    blockchainAdapterMetrics.tradeExecutionVolume.inc(
      { chain_id: chainIdStr, from_asset: fromAsset, to_asset: toAsset, is_mainnet: isMainnetStr },
      volumeUsd
    );
  }
}

// Helper function to record RPC call
export function recordRpcCall(
  chainId: number,
  method: string,
  isMainnet: boolean,
  startTime: number,
  retry: boolean
): void {
  const latency = Date.now() - startTime;
  const chainIdStr = chainId.toString();
  const isMainnetStr = isMainnet.toString();

  // Record RPC call latency
  blockchainAdapterMetrics.rpcCallLatency.observe(
    { chain_id: chainIdStr, method, is_mainnet: isMainnetStr },
    latency
  );

  // Record retry if applicable
  if (retry) {
    blockchainAdapterMetrics.rpcCallRetry.inc({
      chain_id: chainIdStr,
      method,
      is_mainnet: isMainnetStr
    });
  }
}

// Helper function to update circuit breaker state
export function updateCircuitBreakerState(
  chainId: number,
  isMainnet: boolean,
  isOpen: boolean
): void {
  const chainIdStr = chainId.toString();
  const isMainnetStr = isMainnet.toString();

  blockchainAdapterMetrics.circuitBreakerState.set(
    { chain_id: chainIdStr, is_mainnet: isMainnetStr },
    isOpen ? 1 : 0
  );
} 