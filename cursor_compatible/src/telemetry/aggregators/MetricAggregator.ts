import { Metric } from '../Telemetry';
import { TelemetryConfig } from '../TelemetryConfig';

/**
 * Time series data point
 */
interface TimeSeriesPoint {
  value: number;
  timestamp: number;
}

/**
 * Handles metric aggregation and calculation of statistics
 */
export class MetricAggregator {
  private config: TelemetryConfig;
  private metrics: Map<string, TimeSeriesPoint[]> = new Map();
  private currentValues: Map<string, number> = new Map();
  private lastFlushTime: number = Date.now();

  /**
   * Create a new metric aggregator
   */
  constructor(config: TelemetryConfig) {
    this.config = config;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: TelemetryConfig): void {
    this.config = config;
  }

  /**
   * Add a metric to the aggregator
   */
  public addMetric(metric: Metric): void {
    const { name, value, timestamp } = metric;
    
    // Update current value
    this.currentValues.set(name, value);
    
    // Add to time series
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const points = this.metrics.get(name)!;
    
    // Add new point
    points.push({ value, timestamp });
    
    // Trim if needed
    if (points.length > this.config.maxMetricsPerType) {
      points.shift();
    }
  }

  /**
   * Get current metric values
   */
  public getCurrentValues(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, value] of this.currentValues.entries()) {
      result[name] = value;
    }
    return result;
  }

  /**
   * Get aggregated metrics for a time window
   */
  public getAggregatedMetrics(
    windowMs: number = this.config.aggregationWindowMs
  ): Record<string, { avg: number; min: number; max: number; count: number }> {
    const result: Record<string, { avg: number; min: number; max: number; count: number }> = {};
    const now = Date.now();
    const cutoff = now - windowMs;
    
    for (const [name, points] of this.metrics.entries()) {
      // Filter points in time window
      const windowPoints = points.filter(p => p.timestamp >= cutoff);
      
      if (windowPoints.length === 0) {
        continue;
      }
      
      // Calculate statistics
      let sum = 0;
      let min = windowPoints[0].value;
      let max = windowPoints[0].value;
      
      for (const point of windowPoints) {
        sum += point.value;
        min = Math.min(min, point.value);
        max = Math.max(max, point.value);
      }
      
      const avg = sum / windowPoints.length;
      
      result[name] = {
        avg,
        min,
        max,
        count: windowPoints.length
      };
    }
    
    return result;
  }

  /**
   * Get metrics for flush
   */
  public getMetricsForFlush(): Metric[] {
    const result: Metric[] = [];
    const now = Date.now();
    
    // Include current values
    for (const [name, value] of this.currentValues.entries()) {
      result.push({
        name,
        value,
        timestamp: now,
        tags: { ...this.config.defaultTags }
      });
    }
    
    // Calculate aggregated values
    const aggregatedMetrics = this.getAggregatedMetrics();
    
    // Add aggregate metrics with special tags
    for (const [name, stats] of Object.entries(aggregatedMetrics)) {
      // Add avg
      result.push({
        name: `${name}.avg`,
        value: stats.avg,
        timestamp: now,
        tags: { 
          ...this.config.defaultTags,
          aggregation: 'avg',
          base_metric: name
        }
      });
      
      // Add min
      result.push({
        name: `${name}.min`,
        value: stats.min,
        timestamp: now,
        tags: { 
          ...this.config.defaultTags,
          aggregation: 'min',
          base_metric: name
        }
      });
      
      // Add max
      result.push({
        name: `${name}.max`,
        value: stats.max,
        timestamp: now,
        tags: { 
          ...this.config.defaultTags,
          aggregation: 'max',
          base_metric: name
        }
      });
      
      // Add count
      result.push({
        name: `${name}.count`,
        value: stats.count,
        timestamp: now,
        tags: { 
          ...this.config.defaultTags,
          aggregation: 'count',
          base_metric: name
        }
      });
    }
    
    this.lastFlushTime = now;
    return result;
  }

  /**
   * Clear all metrics
   */
  public clear(): void {
    this.metrics.clear();
    this.currentValues.clear();
  }

  /**
   * Reset the aggregator (but keep current values)
   */
  public reset(): void {
    this.metrics.clear();
  }

  /**
   * Clean up old metric points
   */
  public cleanupOldPoints(maxAgeMs: number = this.config.aggregationWindowMs * 2): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    
    for (const [name, points] of this.metrics.entries()) {
      const filteredPoints = points.filter(p => p.timestamp >= cutoff);
      this.metrics.set(name, filteredPoints);
    }
  }
} 