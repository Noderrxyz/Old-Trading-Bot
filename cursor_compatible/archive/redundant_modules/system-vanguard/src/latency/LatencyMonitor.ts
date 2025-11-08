/**
 * LatencyMonitor - Ultra-precise latency tracking for 0.1% performance
 * 
 * Monitors system latency with microsecond precision and tracks
 * percentiles up to 99.99th for identifying bottlenecks.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { performance } from 'perf_hooks';
import { LatencyMetrics, ModuleLatency } from '../types';

interface LatencyTargets {
  p50: number;
  p99: number;
  p999: number;
  p9999: number;
}

interface LatencySample {
  module: string;
  operation: string;
  duration: number;
  timestamp: number;
}

export class LatencyMonitor extends EventEmitter {
  private logger: Logger;
  private targets: LatencyTargets;
  private samples: Map<string, LatencySample[]> = new Map();
  private sampleWindow: number = 60000; // 1 minute window
  private monitoringInterval?: NodeJS.Timeout;
  private defensiveMode: boolean = false;
  private aggressiveTargets: boolean = false;
  
  // High-resolution timing
  private hrStart: Map<string, [number, number]> = new Map();
  
  constructor(logger: Logger, targets: LatencyTargets) {
    super();
    this.logger = logger;
    this.targets = targets;
  }
  
  /**
   * Initialize the latency monitor
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing LatencyMonitor with targets:', this.targets);
    
    // Warm up the performance API
    for (let i = 0; i < 100; i++) {
      performance.now();
    }
    
    // Start sample cleanup
    setInterval(() => this.cleanupOldSamples(), 10000);
  }
  
  /**
   * Start timing an operation
   */
  startOperation(module: string, operation: string): string {
    const id = `${module}:${operation}:${Date.now()}:${Math.random()}`;
    this.hrStart.set(id, process.hrtime());
    return id;
  }
  
  /**
   * End timing an operation
   */
  endOperation(id: string): number {
    const start = this.hrStart.get(id);
    if (!start) {
      this.logger.warn(`No start time found for operation ${id}`);
      return 0;
    }
    
    const end = process.hrtime(start);
    const duration = (end[0] * 1000) + (end[1] / 1000000); // Convert to milliseconds
    
    this.hrStart.delete(id);
    
    // Extract module and operation from id
    const [module, operation] = id.split(':');
    
    // Record sample
    this.recordSample({
      module,
      operation,
      duration,
      timestamp: Date.now()
    });
    
    // Check against targets
    this.checkLatencyTargets(module, operation, duration);
    
    return duration;
  }
  
  /**
   * Record a latency sample
   */
  recordSample(sample: LatencySample): void {
    const key = `${sample.module}:${sample.operation}`;
    
    if (!this.samples.has(key)) {
      this.samples.set(key, []);
    }
    
    this.samples.get(key)!.push(sample);
  }
  
  /**
   * Get metrics for a specific module/operation
   */
  getMetrics(module?: string): LatencyMetrics[] {
    const results: LatencyMetrics[] = [];
    
    for (const [key, samples] of this.samples) {
      if (module && !key.startsWith(module)) {
        continue;
      }
      
      if (samples.length === 0) {
        continue;
      }
      
      // Sort samples by duration
      const sorted = [...samples].sort((a, b) => a.duration - b.duration);
      const durations = sorted.map(s => s.duration);
      
      results.push({
        p50: this.percentile(durations, 0.5),
        p90: this.percentile(durations, 0.9),
        p99: this.percentile(durations, 0.99),
        p999: this.percentile(durations, 0.999),
        p9999: this.percentile(durations, 0.9999),
        max: Math.max(...durations),
        min: Math.min(...durations),
        mean: durations.reduce((a, b) => a + b, 0) / durations.length,
        std: this.standardDeviation(durations),
        samples: durations.length,
        timestamp: Date.now()
      });
    }
    
    return results;
  }
  
  /**
   * Start continuous monitoring
   */
  startContinuousMonitoring(): void {
    if (this.monitoringInterval) {
      return;
    }
    
    this.monitoringInterval = setInterval(() => {
      this.analyzePerformance();
    }, 1000); // Analyze every second
  }
  
  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }
  
  /**
   * Enable defensive mode
   */
  enableDefensiveMode(): void {
    this.defensiveMode = true;
    this.logger.info('Latency monitor entering defensive mode');
  }
  
  /**
   * Set aggressive targets
   */
  setAggressiveTargets(): void {
    this.aggressiveTargets = true;
    this.targets = {
      p50: 0.5,   // 500 microseconds
      p99: 1,     // 1ms
      p999: 5,    // 5ms
      p9999: 10   // 10ms
    };
    this.logger.info('Aggressive latency targets set:', this.targets);
  }
  
  /**
   * Get module latency analysis
   */
  getModuleAnalysis(): ModuleLatency[] {
    const analysis: ModuleLatency[] = [];
    
    for (const [key, samples] of this.samples) {
      const [module, operation] = key.split(':');
      const metrics = this.calculateMetrics(samples);
      const bottlenecks = this.identifyBottlenecks(metrics);
      
      analysis.push({
        module,
        operation,
        metrics,
        bottlenecks
      });
    }
    
    return analysis;
  }
  
  /**
   * Private: Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
  
  /**
   * Private: Calculate standard deviation
   */
  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  }
  
  /**
   * Private: Clean up old samples
   */
  private cleanupOldSamples(): void {
    const cutoff = Date.now() - this.sampleWindow;
    
    for (const [key, samples] of this.samples) {
      const filtered = samples.filter(s => s.timestamp > cutoff);
      
      if (filtered.length === 0) {
        this.samples.delete(key);
      } else {
        this.samples.set(key, filtered);
      }
    }
  }
  
  /**
   * Private: Check latency against targets
   */
  private checkLatencyTargets(module: string, operation: string, duration: number): void {
    // Check if we're exceeding p99 target
    if (duration > this.targets.p99) {
      const samples = this.samples.get(`${module}:${operation}`) || [];
      const recentSamples = samples.slice(-100);
      const exceeding = recentSamples.filter(s => s.duration > this.targets.p99).length;
      
      if (exceeding > 5) { // More than 5% exceeding
        this.emit('latencySpike', {
          module,
          operation,
          duration,
          target: this.targets.p99,
          percentExceeding: exceeding
        });
      }
    }
  }
  
  /**
   * Private: Analyze overall performance
   */
  private analyzePerformance(): void {
    const analysis = this.getModuleAnalysis();
    
    for (const moduleAnalysis of analysis) {
      // Check p9999 against target
      if (moduleAnalysis.metrics.p9999 > this.targets.p9999) {
        this.logger.warn(`Module ${moduleAnalysis.module} exceeding p9999 target:`, {
          actual: moduleAnalysis.metrics.p9999,
          target: this.targets.p9999,
          bottlenecks: moduleAnalysis.bottlenecks
        });
      }
    }
  }
  
  /**
   * Private: Calculate metrics from samples
   */
  private calculateMetrics(samples: LatencySample[]): LatencyMetrics {
    if (samples.length === 0) {
      return {
        p50: 0,
        p90: 0,
        p99: 0,
        p999: 0,
        p9999: 0,
        max: 0,
        min: 0,
        mean: 0,
        std: 0,
        samples: 0,
        timestamp: Date.now()
      };
    }
    
    const sorted = [...samples].sort((a, b) => a.duration - b.duration);
    const durations = sorted.map(s => s.duration);
    
    return {
      p50: this.percentile(durations, 0.5),
      p90: this.percentile(durations, 0.9),
      p99: this.percentile(durations, 0.99),
      p999: this.percentile(durations, 0.999),
      p9999: this.percentile(durations, 0.9999),
      max: Math.max(...durations),
      min: Math.min(...durations),
      mean: durations.reduce((a, b) => a + b, 0) / durations.length,
      std: this.standardDeviation(durations),
      samples: durations.length,
      timestamp: Date.now()
    };
  }
  
  /**
   * Private: Identify bottlenecks
   */
  private identifyBottlenecks(metrics: LatencyMetrics): string[] {
    const bottlenecks: string[] = [];
    
    // High variance indicates unstable performance
    if (metrics.std > metrics.mean * 0.5) {
      bottlenecks.push('high_variance');
    }
    
    // Long tail problem
    if (metrics.p9999 > metrics.p99 * 5) {
      bottlenecks.push('long_tail_latency');
    }
    
    // Consistent high latency
    if (metrics.p50 > this.targets.p99) {
      bottlenecks.push('consistent_high_latency');
    }
    
    // Spikes
    if (metrics.max > metrics.p99 * 10) {
      bottlenecks.push('extreme_spikes');
    }
    
    return bottlenecks;
  }
  
  /**
   * Export metrics for analysis
   */
  exportMetrics(): any {
    const allMetrics: any = {};
    
    for (const [key, samples] of this.samples) {
      allMetrics[key] = {
        metrics: this.calculateMetrics(samples),
        sampleCount: samples.length,
        timeRange: {
          start: Math.min(...samples.map(s => s.timestamp)),
          end: Math.max(...samples.map(s => s.timestamp))
        }
      };
    }
    
    return allMetrics;
  }
} 