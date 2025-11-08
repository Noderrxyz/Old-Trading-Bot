import { telemetry } from '../telemetry';
import { logger } from '../utils/logger';

/**
 * Structure to store latency samples for a venue
 */
interface VenueLatencySamples {
  samples: number[];
  recentSamples: number[];
  lastUpdate: number;
}

/**
 * Venue latency statistics
 */
export interface VenueLatencyStats {
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  recentAvgMs: number;
  sampleCount: number;
}

/**
 * JavaScript fallback implementation of VenueLatencyTracker
 * Used when the native Rust implementation is not available
 */
export class VenueLatencyTrackerJs {
  private venues: Map<string, VenueLatencySamples> = new Map();
  private static instance: VenueLatencyTrackerJs | null = null;
  
  // Maximum number of samples to store per venue
  private static readonly MAX_SAMPLES = 1000;
  // Number of recent samples to track for recent average
  private static readonly RECENT_SAMPLES = 50;
  // Maximum age of a sample in ms before it is considered stale
  private static readonly MAX_SAMPLE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    // Initialize telemetry for the JS implementation
    telemetry.recordMetric('venue_latency_tracker.initialization', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Initialized JavaScript fallback VenueLatencyTracker');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): VenueLatencyTrackerJs {
    if (!VenueLatencyTrackerJs.instance) {
      VenueLatencyTrackerJs.instance = new VenueLatencyTrackerJs();
    }
    return VenueLatencyTrackerJs.instance;
  }

  /**
   * Record a latency measurement for a venue
   * @param venue Venue identifier
   * @param latencyMs Latency in milliseconds
   */
  public record(venue: string, latencyMs: number): void {
    try {
      // Ignore negative or unreasonably large values
      if (latencyMs < 0 || latencyMs > 60000) {
        logger.warn(`Ignoring suspicious latency value: ${latencyMs}ms for venue: ${venue}`);
        return;
      }
      
      // Get or create venue samples
      let venueSamples = this.venues.get(venue);
      
      if (!venueSamples) {
        venueSamples = {
          samples: [],
          recentSamples: [],
          lastUpdate: Date.now()
        };
        this.venues.set(venue, venueSamples);
      }
      
      // Update last update time
      venueSamples.lastUpdate = Date.now();
      
      // Add sample to the venue's samples
      venueSamples.samples.push(latencyMs);
      
      // Keep only the latest MAX_SAMPLES
      if (venueSamples.samples.length > VenueLatencyTrackerJs.MAX_SAMPLES) {
        venueSamples.samples.shift();
      }
      
      // Update recent samples
      venueSamples.recentSamples.push(latencyMs);
      if (venueSamples.recentSamples.length > VenueLatencyTrackerJs.RECENT_SAMPLES) {
        venueSamples.recentSamples.shift();
      }
      
      // Record metric in telemetry
      telemetry.recordMetric('venue_latency_tracker.record', latencyMs, {
        venue,
        implementation: 'javascript'
      });
    } catch (error) {
      logger.error(`Error recording venue latency: ${error}`);
    }
  }

  /**
   * Start timing an operation
   * @returns Timestamp in milliseconds
   */
  public startTiming(): number {
    return Date.now();
  }

  /**
   * Finish timing an operation and record the latency
   * @param venue Venue identifier
   * @param startTime Timestamp from startTiming()
   */
  public finishTiming(venue: string, startTime: number): void {
    const latencyMs = Date.now() - startTime;
    this.record(venue, latencyMs);
  }

  /**
   * Get comprehensive latency statistics for a venue
   * @param venue Venue identifier
   * @returns Latency statistics or null if no data exists
   */
  public getStats(venue: string): VenueLatencyStats | null {
    try {
      const venueSamples = this.venues.get(venue);
      if (!venueSamples || venueSamples.samples.length === 0) {
        return null;
      }
      
      // Create a copy of the samples array and sort it for percentile calculations
      const sortedSamples = [...venueSamples.samples].sort((a, b) => a - b);
      const sampleCount = sortedSamples.length;
      
      // Calculate statistics
      const avgMs = this.calculateAverage(sortedSamples);
      const p50Ms = this.calculatePercentile(sortedSamples, 50);
      const p90Ms = this.calculatePercentile(sortedSamples, 90);
      const p95Ms = this.calculatePercentile(sortedSamples, 95);
      const p99Ms = this.calculatePercentile(sortedSamples, 99);
      const minMs = sortedSamples[0];
      const maxMs = sortedSamples[sortedSamples.length - 1];
      const recentAvgMs = this.calculateAverage(venueSamples.recentSamples);
      
      return {
        avgMs,
        p50Ms,
        p90Ms,
        p95Ms,
        p99Ms,
        minMs,
        maxMs,
        recentAvgMs,
        sampleCount,
      };
    } catch (error) {
      logger.error(`Error getting venue latency stats: ${error}`);
      return null;
    }
  }

  /**
   * Get average latency for a venue in milliseconds
   * @param venue Venue identifier
   * @returns Average latency or -1 if no data exists
   */
  public getAvgLatency(venue: string): number {
    try {
      const venueSamples = this.venues.get(venue);
      if (!venueSamples || venueSamples.samples.length === 0) {
        return -1;
      }
      
      return this.calculateAverage(venueSamples.samples);
    } catch (error) {
      logger.error(`Error getting average venue latency: ${error}`);
      return -1;
    }
  }

  /**
   * Get 99th percentile latency for a venue in milliseconds
   * @param venue Venue identifier
   * @returns P99 latency or -1 if no data exists
   */
  public getP99Latency(venue: string): number {
    try {
      const venueSamples = this.venues.get(venue);
      if (!venueSamples || venueSamples.samples.length === 0) {
        return -1;
      }
      
      // Sort samples if needed
      const sortedSamples = [...venueSamples.samples].sort((a, b) => a - b);
      return this.calculatePercentile(sortedSamples, 99);
    } catch (error) {
      logger.error(`Error getting P99 venue latency: ${error}`);
      return -1;
    }
  }

  /**
   * Get recent average latency for a venue in milliseconds
   * @param venue Venue identifier
   * @returns Recent average latency or -1 if no data exists
   */
  public getRecentAvgLatency(venue: string): number {
    try {
      const venueSamples = this.venues.get(venue);
      if (!venueSamples || venueSamples.recentSamples.length === 0) {
        return -1;
      }
      
      return this.calculateAverage(venueSamples.recentSamples);
    } catch (error) {
      logger.error(`Error getting recent average venue latency: ${error}`);
      return -1;
    }
  }

  /**
   * Reset latency history for a venue
   * @param venue Venue identifier
   */
  public reset(venue: string): void {
    try {
      this.venues.delete(venue);
      
      // Record in telemetry
      telemetry.recordMetric('venue_latency_tracker.reset', 1, {
        venue,
        implementation: 'javascript'
      });
    } catch (error) {
      logger.error(`Error resetting venue latency: ${error}`);
    }
  }

  /**
   * Reset all latency history
   */
  public resetAll(): void {
    try {
      this.venues.clear();
      
      // Record in telemetry
      telemetry.recordMetric('venue_latency_tracker.reset_all', 1, {
        implementation: 'javascript'
      });
    } catch (error) {
      logger.error(`Error resetting all venue latencies: ${error}`);
    }
  }

  /**
   * Get all venue IDs being tracked
   * @returns Array of venue IDs
   */
  public getTrackedVenues(): string[] {
    return Array.from(this.venues.keys());
  }

  /**
   * Calculate a venue routing score based on latency metrics
   * Lower score means better routing performance
   * @param venue Venue identifier
   * @returns Routing score (0-100, lower is better) or 100 if no data
   */
  public getRoutingScore(venue: string): number {
    try {
      const stats = this.getStats(venue);
      if (!stats || stats.sampleCount < 5) {
        return 100; // Default to worst score if insufficient data
      }

      // Weights for different latency metrics
      const weights = {
        recent: 0.5,  // Recent average has highest weight
        avg: 0.2,     // Overall average
        p99: 0.3,     // P99 to account for outliers
      };

      // Baseline "good" latency in ms (adjust based on your environment)
      const baselineGood = 50;
      
      // Calculate normalized scores (0-100 where lower is better)
      const recentScore = Math.min(100, (stats.recentAvgMs / baselineGood) * 50);
      const avgScore = Math.min(100, (stats.avgMs / baselineGood) * 50);
      const p99Score = Math.min(100, (stats.p99Ms / (baselineGood * 2)) * 50);
      
      // Calculate weighted score
      const weightedScore = 
        (recentScore * weights.recent) + 
        (avgScore * weights.avg) + 
        (p99Score * weights.p99);
      
      return weightedScore;
    } catch (error) {
      logger.error(`Error calculating venue routing score: ${error}`);
      return 100; // Default to worst score on error
    }
  }

  /**
   * Calculate the average of an array of numbers
   * @param values Array of numbers
   * @returns Average value
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }

  /**
   * Calculate a percentile value from a sorted array
   * @param sortedValues Sorted array of numbers
   * @param percentile Percentile to calculate (0-100)
   * @returns Percentile value
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];
    
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
  }

  /**
   * Clean up stale venue data (not called automatically)
   */
  public cleanupStaleData(): void {
    try {
      const now = Date.now();
      let cleanedCount = 0;
      
      for (const [venue, venueSamples] of this.venues.entries()) {
        if (now - venueSamples.lastUpdate > VenueLatencyTrackerJs.MAX_SAMPLE_AGE_MS) {
          this.venues.delete(venue);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} stale venue latency entries`);
      }
    } catch (error) {
      logger.error(`Error cleaning up stale venue data: ${error}`);
    }
  }
} 