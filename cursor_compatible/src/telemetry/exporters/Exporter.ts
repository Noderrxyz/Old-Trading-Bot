import { Metric, ErrorRecord } from '../Telemetry';

/**
 * Interface for telemetry exporters
 */
export interface Exporter {
  /**
   * Export a single metric
   */
  exportMetric(metric: Metric): void;
  
  /**
   * Export multiple metrics in batch
   */
  exportMetrics(metrics: Metric[]): void;
  
  /**
   * Export a single error
   */
  exportError(error: ErrorRecord): void;
  
  /**
   * Export multiple errors in batch
   */
  exportErrors(errors: ErrorRecord[]): void;
} 