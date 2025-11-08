import { SeverityLevel } from './Telemetry';

/**
 * Metric threshold configuration
 */
export interface MetricThreshold {
  min?: number;
  max?: number;
  logLevel?: SeverityLevel;
  alertOnExceed?: boolean;
}

/**
 * Telemetry configuration options
 */
export interface TelemetryConfig {
  /**
   * Whether telemetry is enabled
   */
  enabled: boolean;

  /**
   * Default labels added to all metrics
   */
  defaultLabels: Record<string, string>;

  /**
   * Legacy default tags name used in some files
   * @deprecated Use defaultLabels instead
   */
  defaultTags: Record<string, string>;

  /**
   * How often to flush metrics (in milliseconds)
   */
  metricsFlushIntervalMs: number;

  /**
   * Whether to export metrics immediately or wait for flush
   */
  immediateMetricExport: boolean;

  /**
   * Whether to export errors immediately or buffer them
   */
  immediateErrorExport: boolean;

  /**
   * Maximum number of errors to buffer
   */
  errorBufferSize: number;

  /**
   * Error buffer flush interval in milliseconds
   */
  errorBufferFlushIntervalMs: number;

  /**
   * Whether to reset error buffer after flush
   */
  resetErrorBufferAfterFlush: boolean;

  /**
   * Whether to reset aggregator after flush
   */
  resetMetricsAfterFlush: boolean;

  /**
   * How long to keep metrics in memory (in milliseconds)
   */
  metricRetentionMs: number;

  /**
   * Maximum number of metrics per flush
   */
  maxMetricsPerFlush: number;

  /**
   * Maximum number of metrics per type to store
   */
  maxMetricsPerType: number;

  /**
   * Aggregation window for metrics (in milliseconds)
   */
  aggregationWindowMs: number;

  /**
   * Rate limit for metric recording (calls per second)
   */
  metricRateLimit: number;

  /**
   * Rate limits per metric name (calls per second)
   */
  metricRateLimitPerSecond: Record<string, number>;

  /**
   * Rate limit window size (in milliseconds)
   */
  rateLimitWindowMs: number;

  /**
   * Metric thresholds configuration
   */
  metricThresholds: Record<string, MetricThreshold>;

  /**
   * Sampling rate (0.0-1.0) for metrics
   * 1.0 means record all, 0.1 means record 10%
   */
  samplingRate: number;

  /**
   * Metrics that are always recorded regardless of sampling
   */
  alwaysSampledMetrics: string[];
}

/**
 * Default telemetry configuration
 */
export const defaultTelemetryConfig: TelemetryConfig = {
  enabled: true,
  defaultLabels: {
    service: 'noderr-trading',
    environment: process.env.NODE_ENV || 'development'
  },
  defaultTags: {
    service: 'noderr-trading',
    environment: process.env.NODE_ENV || 'development'
  },
  metricsFlushIntervalMs: 10000,
  immediateMetricExport: false,
  immediateErrorExport: true,
  errorBufferSize: 1000,
  errorBufferFlushIntervalMs: 10000,
  resetErrorBufferAfterFlush: true,
  resetMetricsAfterFlush: false,
  metricRetentionMs: 86400000, // 24 hours
  maxMetricsPerFlush: 500,
  maxMetricsPerType: 1000,
  aggregationWindowMs: 60000, // 1 minute
  metricRateLimit: 100,
  metricRateLimitPerSecond: {},
  rateLimitWindowMs: 1000,
  metricThresholds: {},
  samplingRate: 1.0, // Record all by default
  alwaysSampledMetrics: [
    // Critical metrics that are always recorded
    'error_count',
    'critical_error_count',
    'order_execution_latency',
    'position_update_latency',
    'risk_check_duration',
    'tick_processing_latency',
    'strategy_eval_latency'
  ]
}; 