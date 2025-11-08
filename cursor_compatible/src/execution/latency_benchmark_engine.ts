/**
 * Latency Benchmark Engine
 * 
 * Tracks transaction latency, gas efficiency, and execution reliability metrics.
 */

import { createLogger } from '../common/logger.js';
import { TransactionBenchmark, VenuePerformance, GasOptimizerConfig } from './types/benchmark.types.js';

const logger = createLogger('LatencyBenchmarkEngine');

/**
 * Engine for tracking transaction performance metrics
 */
export class LatencyBenchmarkEngine {
  private readonly benchmarks: Map<string, TransactionBenchmark[]>;
  private readonly venuePerformance: Map<string, VenuePerformance>;
  private readonly config: GasOptimizerConfig;

  /**
   * Create a new benchmark engine
   * @param config Benchmark configuration
   */
  constructor(config: GasOptimizerConfig) {
    this.benchmarks = new Map();
    this.venuePerformance = new Map();
    this.config = config;
    logger.info('Latency Benchmark Engine initialized');
  }

  /**
   * Record a new transaction benchmark
   * @param benchmark Transaction benchmark data
   */
  public recordBenchmark(benchmark: TransactionBenchmark): void {
    const venueKey = this.getVenueKey(benchmark.venue, benchmark.chain);
    
    // Get or initialize venue benchmarks
    let venueBenchmarks = this.benchmarks.get(venueKey);
    if (!venueBenchmarks) {
      venueBenchmarks = [];
      this.benchmarks.set(venueKey, venueBenchmarks);
    }
    
    // Add new benchmark
    venueBenchmarks.push(benchmark);
    
    // Trim to sample size
    if (venueBenchmarks.length > this.config.benchmarkSampleSize) {
      venueBenchmarks.shift();
    }
    
    // Update venue performance metrics
    this.updateVenuePerformance(venueKey, benchmark);
    
    if (this.config.enableLogging) {
      logger.info(`Recorded benchmark for ${venueKey}:`, {
        latency: this.getLatencySec(benchmark),
        success: benchmark.success,
        gasEfficiency: this.getGasEfficiency(benchmark)
      });
    }
  }

  /**
   * Get performance metrics for a venue
   * @param venue Venue identifier
   * @param chain Chain identifier
   * @returns Venue performance metrics
   */
  public getVenuePerformance(venue: string, chain: string): VenuePerformance | undefined {
    return this.venuePerformance.get(this.getVenueKey(venue, chain));
  }

  /**
   * Get recent benchmarks for a venue
   * @param venue Venue identifier
   * @param chain Chain identifier
   * @returns Array of recent benchmarks
   */
  public getRecentBenchmarks(venue: string, chain: string): TransactionBenchmark[] {
    return this.benchmarks.get(this.getVenueKey(venue, chain)) || [];
  }

  /**
   * Get all venue keys
   * @returns Array of venue keys
   */
  public getVenueKeys(): string[] {
    return Array.from(this.benchmarks.keys());
  }

  /**
   * Update venue performance metrics
   * @param venueKey Venue key
   * @param benchmark New benchmark
   */
  private updateVenuePerformance(venueKey: string, benchmark: TransactionBenchmark): void {
    const venueBenchmarks = this.benchmarks.get(venueKey) || [];
    const performance = this.calculateVenuePerformance(venueBenchmarks);
    this.venuePerformance.set(venueKey, performance);
  }

  /**
   * Calculate venue performance metrics
   * @param benchmarks Array of benchmarks
   * @returns Calculated performance metrics
   */
  private calculateVenuePerformance(benchmarks: TransactionBenchmark[]): VenuePerformance {
    const total = benchmarks.length;
    const successful = benchmarks.filter(b => b.success).length;
    const latencies = benchmarks.map(b => this.getLatencySec(b));
    const gasEfficiencies = benchmarks.map(b => this.getGasEfficiency(b));
    
    return {
      totalTransactions: total,
      successfulTransactions: successful,
      avgLatencySec: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      avgGasEfficiency: gasEfficiencies.reduce((a, b) => a + b, 0) / gasEfficiencies.length,
      lastUpdate: Date.now()
    };
  }

  /**
   * Get latency in seconds
   * @param benchmark Transaction benchmark
   * @returns Latency in seconds
   */
  private getLatencySec(benchmark: TransactionBenchmark): number {
    return (benchmark.timestamps.confirmed - benchmark.timestamps.sent) / 1000;
  }

  /**
   * Get gas efficiency (used/supplied)
   * @param benchmark Transaction benchmark
   * @returns Gas efficiency ratio
   */
  private getGasEfficiency(benchmark: TransactionBenchmark): number {
    return benchmark.gas.used / benchmark.gas.supplied;
  }

  /**
   * Get venue key
   * @param venue Venue identifier
   * @param chain Chain identifier
   * @returns Combined venue key
   */
  private getVenueKey(venue: string, chain: string): string {
    return `${venue}:${chain}`;
  }
} 