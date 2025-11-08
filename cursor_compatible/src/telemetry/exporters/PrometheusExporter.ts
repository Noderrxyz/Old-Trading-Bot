import * as http from 'http';
import { Exporter } from './Exporter';
import { Metric, ErrorRecord } from '../Telemetry';
import { logger } from '../../utils/logger';

/**
 * Prometheus exporter configuration
 */
export interface PrometheusExporterConfig {
  /**
   * Port to expose metrics on
   */
  port: number;
  
  /**
   * Path for metrics endpoint
   */
  metricsPath: string;
  
  /**
   * Default labels to add to all metrics
   */
  defaultLabels: Record<string, string>;
  
  /**
   * Maximum age of metrics to expose (in milliseconds)
   */
  metricMaxAgeMs: number;
  
  /**
   * Convert error counts to metrics
   */
  exposeErrorsAsMetrics: boolean;
}

/**
 * Default Prometheus exporter configuration
 */
const defaultConfig: PrometheusExporterConfig = {
  port: 9090,
  metricsPath: '/metrics',
  defaultLabels: {
    service: 'noderr-trading',
    environment: process.env.NODE_ENV || 'development'
  },
  metricMaxAgeMs: 300000, // 5 minutes
  exposeErrorsAsMetrics: true
};

/**
 * Metric data for Prometheus
 */
interface PrometheusMetric {
  name: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
}

/**
 * Exports telemetry data in Prometheus format
 */
export class PrometheusExporter implements Exporter {
  private config: PrometheusExporterConfig;
  private metrics: Map<string, PrometheusMetric> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private server: http.Server | null = null;

  /**
   * Create a new Prometheus exporter
   */
  constructor(config: Partial<PrometheusExporterConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.startServer();
  }

  /**
   * Export a single metric
   */
  exportMetric(metric: Metric): void {
    // Convert metric to Prometheus format
    const promMetric = this.convertMetric(metric);
    
    // Store with compound key (name + labels)
    const key = this.getMetricKey(promMetric);
    this.metrics.set(key, promMetric);
  }
  
  /**
   * Export multiple metrics in batch
   */
  exportMetrics(metrics: Metric[]): void {
    for (const metric of metrics) {
      this.exportMetric(metric);
    }
  }
  
  /**
   * Export a single error
   */
  exportError(error: ErrorRecord): void {
    if (!this.config.exposeErrorsAsMetrics) {
      return;
    }
    
    // Count errors by component and severity
    const key = `${error.component}:${error.severity}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
    
    // Also export as metrics
    this.exportMetric({
      name: 'error_count',
      value: this.errorCounts.get(key) || 1,
      timestamp: error.timestamp,
      tags: {
        component: error.component,
        severity: String(error.severity),
        ...error.tags
      }
    });
  }
  
  /**
   * Export multiple errors in batch
   */
  exportErrors(errors: ErrorRecord[]): void {
    for (const error of errors) {
      this.exportError(error);
    }
  }
  
  /**
   * Start HTTP server to expose metrics
   */
  private startServer(): void {
    try {
      this.server = http.createServer((req, res) => {
        if (req.url === this.config.metricsPath && req.method === 'GET') {
          // Return metrics in Prometheus format
          const metricsOutput = this.formatMetrics();
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(metricsOutput);
        } else {
          // 404 for all other paths
          res.writeHead(404);
          res.end();
        }
      });
      
      this.server.listen(this.config.port, () => {
        logger.info(`Prometheus metrics available at http://localhost:${this.config.port}${this.config.metricsPath}`);
      });
      
      this.server.on('error', (error) => {
        logger.error(`Prometheus exporter server error: ${error}`);
      });
    } catch (error) {
      logger.error(`Failed to start Prometheus exporter: ${error}`);
    }
  }
  
  /**
   * Format metrics in Prometheus format
   */
  private formatMetrics(): string {
    const now = Date.now();
    const lines: string[] = [];
    const exportedMetrics = new Set<string>();
    
    // Clean up old metrics
    this.cleanupOldMetrics();
    
    // Add help and type for each metric
    for (const [key, metric] of this.metrics.entries()) {
      const { name, value, labels, type } = metric;
      
      // Add TYPE header if not already exported
      if (!exportedMetrics.has(name)) {
        lines.push(`# HELP ${name} Automatically exported from telemetry`);
        lines.push(`# TYPE ${name} ${type}`);
        exportedMetrics.add(name);
      }
      
      // Format labels
      const labelString = this.formatLabels(labels);
      
      // Add value
      lines.push(`${name}${labelString} ${value}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) {
      return '';
    }
    
    const labelPairs = Object.entries(labels)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}="${this.escapeValue(String(value))}"`);
    
    return `{${labelPairs.join(',')}}`;
  }
  
  /**
   * Escape string for Prometheus
   */
  private escapeValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }
  
  /**
   * Convert a telemetry metric to Prometheus format
   */
  private convertMetric(metric: Metric): PrometheusMetric {
    const { name, value, timestamp, tags = {} } = metric;
    
    // Determine metric type based on name conventions
    let type: 'counter' | 'gauge' | 'histogram' | 'summary' = 'gauge';
    
    if (name.endsWith('_total') || name.endsWith('_count') || name.startsWith('count_')) {
      type = 'counter';
    } else if (name.endsWith('_bucket')) {
      type = 'histogram';
    } else if (name.includes('_quantile_')) {
      type = 'summary';
    }
    
    // Combine default labels with metric tags
    const labels = {
      ...this.config.defaultLabels,
      ...tags
    };
    
    return {
      name,
      value,
      timestamp,
      labels,
      type
    };
  }
  
  /**
   * Get unique key for a metric
   */
  private getMetricKey(metric: PrometheusMetric): string {
    const labelString = Object.entries(metric.labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    
    return `${metric.name}{${labelString}}`;
  }
  
  /**
   * Remove old metrics
   */
  private cleanupOldMetrics(): void {
    const now = Date.now();
    const cutoff = now - this.config.metricMaxAgeMs;
    
    for (const [key, metric] of this.metrics.entries()) {
      if (metric.timestamp < cutoff) {
        this.metrics.delete(key);
      }
    }
  }
  
  /**
   * Stop HTTP server
   */
  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info('Prometheus exporter stopped');
    }
  }
} 