import { VenueLatencyTrackerJs } from './VenueLatencyTrackerJs';
import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry/types';
import { logger } from '../utils/logger';
import { tryNativeOrFallback, createFallbackProxy } from '../utils/fallback';

// Define types that match the Rust native interface
interface NapiVenueLatencyTracker {
  record_latency(venue: string, latencyNs: number): void;
  get_latency_stats(venue: string): any | null;
  get_avg_latency(venue: string): number | null;
  get_p99_latency(venue: string): number | null;
  get_recent_avg_latency(venue: string): number | null;
  reset(venue: string): void;
  reset_all(): void;
  get_tracked_venues(): string[];
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
 * High-performance Rust-powered venue latency tracker
 * Used to measure and monitor exchange latency for optimal order routing
 */
export class VenueLatencyTrackerRust {
  private native: NapiVenueLatencyTracker | null = null;
  private fallback: VenueLatencyTrackerJs;
  private usingFallback: boolean = false;
  private static instance: VenueLatencyTrackerRust | null = null;
  private componentName = 'VenueLatencyTracker';
  
  // Conversion factor from ns to ms
  private static readonly NS_TO_MS = 1e-6;
  // Conversion factor from ms to ns
  private static readonly MS_TO_NS = 1e6;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    // Initialize the fallback JavaScript implementation
    this.fallback = VenueLatencyTrackerJs.getInstance();
    
    // Try to initialize the native Rust implementation
    try {
      // Use dynamic import to avoid direct reference to NapiVenueLatencyTracker
      this.native = new (require('@noderr/core').NapiVenueLatencyTracker)();
      
      // Record successful initialization in telemetry
      telemetry.recordMetric(`${this.componentName}.initialization`, 1, {
        implementation: 'rust',
        status: 'success'
      });
      
      logger.info('Initialized native Rust VenueLatencyTracker');
    } catch (error) {
      this.native = null;
      this.usingFallback = true;
      
      // Record initialization failure in telemetry
      telemetry.recordError(
        this.componentName,
        `Failed to initialize native VenueLatencyTracker: ${(error as Error).message}`,
        SeverityLevel.WARNING
      );
      
      telemetry.recordMetric(`${this.componentName}.initialization`, 0, {
        implementation: 'rust',
        status: 'failed',
        error: (error as Error).name || 'unknown',
        message: (error as Error).message || 'unknown'
      });
      
      logger.warn(`Failed to initialize native VenueLatencyTracker: ${error}`);
      logger.info('Using JavaScript fallback for VenueLatencyTracker');
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): VenueLatencyTrackerRust {
    if (!VenueLatencyTrackerRust.instance) {
      VenueLatencyTrackerRust.instance = new VenueLatencyTrackerRust();
    }
    return VenueLatencyTrackerRust.instance;
  }

  /**
   * Record a latency measurement for a venue
   * @param venue Venue identifier
   * @param latencyMs Latency in milliseconds
   */
  public record(venue: string, latencyMs: number): void {
    try {
      if (this.usingFallback || !this.native) {
        this.fallback.record(venue, latencyMs);
        return;
      }
      
      // Convert ms to ns for the native tracker
      const latencyNs = latencyMs * VenueLatencyTrackerRust.MS_TO_NS;
      
      try {
        this.native.record_latency(venue, latencyNs);
        
        // Record metric in telemetry
        telemetry.recordMetric(`${this.componentName}.record`, latencyMs, {
          venue,
          implementation: 'rust'
        });
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.record failed, using fallback: ${error}`);
        
        // Record error in telemetry
        telemetry.recordError(
          this.componentName,
          `Native record_latency failed: ${(error as Error).message}`,
          SeverityLevel.WARNING,
          { venue, latency_ms: latencyMs.toString() }
        );
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        this.fallback.record(venue, latencyMs);
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.record: ${error}`);
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
      if (this.usingFallback || !this.native) {
        return this.fallback.getStats(venue);
      }
      
      try {
        const stats = this.native.get_latency_stats(venue);
        if (!stats) return null;

        const result = {
          avgMs: stats.avg_ns * VenueLatencyTrackerRust.NS_TO_MS,
          p50Ms: stats.p50_ns * VenueLatencyTrackerRust.NS_TO_MS,
          p90Ms: stats.p90_ns * VenueLatencyTrackerRust.NS_TO_MS,
          p95Ms: stats.p95_ns * VenueLatencyTrackerRust.NS_TO_MS,
          p99Ms: stats.p99_ns * VenueLatencyTrackerRust.NS_TO_MS,
          minMs: stats.min_ns * VenueLatencyTrackerRust.NS_TO_MS,
          maxMs: stats.max_ns * VenueLatencyTrackerRust.NS_TO_MS,
          recentAvgMs: stats.recent_avg_ns * VenueLatencyTrackerRust.NS_TO_MS,
          sampleCount: stats.sample_count,
        };
        
        // Record successful stats retrieval
        telemetry.recordMetric(`${this.componentName}.get_stats`, 1, {
          venue,
          implementation: 'rust',
          sample_count: stats.sample_count.toString()
        });
        
        return result;
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.getStats failed, using fallback: ${error}`);
        
        // Record error in telemetry
        telemetry.recordError(
          this.componentName,
          `Native get_latency_stats failed: ${(error as Error).message}`,
          SeverityLevel.WARNING,
          { venue }
        );
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        return this.fallback.getStats(venue);
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.getStats: ${error}`);
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
      if (this.usingFallback || !this.native) {
        return this.fallback.getAvgLatency(venue);
      }
      
      try {
        const avgNs = this.native.get_avg_latency(venue);
        const result = avgNs !== null ? avgNs * VenueLatencyTrackerRust.NS_TO_MS : -1;
        
        // Record telemetry for successful retrieval
        if (result >= 0) {
          telemetry.recordMetric(`${this.componentName}.avg_latency`, result, {
            venue,
            implementation: 'rust'
          });
        }
        
        return result;
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.getAvgLatency failed, using fallback: ${error}`);
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        return this.fallback.getAvgLatency(venue);
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.getAvgLatency: ${error}`);
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
      if (this.usingFallback || !this.native) {
        return this.fallback.getP99Latency(venue);
      }
      
      try {
        const p99Ns = this.native.get_p99_latency(venue);
        const result = p99Ns !== null ? p99Ns * VenueLatencyTrackerRust.NS_TO_MS : -1;
        
        // Record telemetry for successful retrieval
        if (result >= 0) {
          telemetry.recordMetric(`${this.componentName}.p99_latency`, result, {
            venue,
            implementation: 'rust'
          });
        }
        
        return result;
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.getP99Latency failed, using fallback: ${error}`);
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        return this.fallback.getP99Latency(venue);
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.getP99Latency: ${error}`);
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
      if (this.usingFallback || !this.native) {
        return this.fallback.getRecentAvgLatency(venue);
      }
      
      try {
        const recentAvgNs = this.native.get_recent_avg_latency(venue);
        const result = recentAvgNs !== null ? recentAvgNs * VenueLatencyTrackerRust.NS_TO_MS : -1;
        
        // Record telemetry for successful retrieval
        if (result >= 0) {
          telemetry.recordMetric(`${this.componentName}.recent_avg_latency`, result, {
            venue,
            implementation: 'rust'
          });
        }
        
        return result;
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.getRecentAvgLatency failed, using fallback: ${error}`);
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        return this.fallback.getRecentAvgLatency(venue);
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.getRecentAvgLatency: ${error}`);
      return -1;
    }
  }

  /**
   * Reset latency history for a venue
   * @param venue Venue identifier
   */
  public reset(venue: string): void {
    try {
      // Always reset in the fallback to keep them in sync
      this.fallback.reset(venue);
      
      if (this.usingFallback || !this.native) {
        return;
      }
      
      try {
        this.native.reset(venue);
        
        // Record successful reset
        telemetry.recordMetric(`${this.componentName}.reset`, 1, {
          venue,
          implementation: 'rust'
        });
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.reset failed: ${error}`);
        
        // Record error in telemetry
        telemetry.recordError(
          this.componentName,
          `Native reset failed: ${(error as Error).message}`,
          SeverityLevel.WARNING,
          { venue }
        );
        
        // Continue using the JS fallback which was already reset
        this.usingFallback = true;
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.reset: ${error}`);
    }
  }

  /**
   * Reset all latency history
   */
  public resetAll(): void {
    try {
      // Always reset in the fallback to keep them in sync
      this.fallback.resetAll();
      
      if (this.usingFallback || !this.native) {
        return;
      }
      
      try {
        this.native.reset_all();
        
        // Record successful reset_all
        telemetry.recordMetric(`${this.componentName}.reset_all`, 1, {
          implementation: 'rust'
        });
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.resetAll failed: ${error}`);
        
        // Record error in telemetry
        telemetry.recordError(
          this.componentName,
          `Native reset_all failed: ${(error as Error).message}`,
          SeverityLevel.WARNING
        );
        
        // Continue using the JS fallback which was already reset
        this.usingFallback = true;
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.resetAll: ${error}`);
    }
  }

  /**
   * Get all venue IDs being tracked
   * @returns Array of venue IDs
   */
  public getTrackedVenues(): string[] {
    try {
      if (this.usingFallback || !this.native) {
        return this.fallback.getTrackedVenues();
      }
      
      try {
        const venues = this.native.get_tracked_venues();
        
        // Record successful venues retrieval
        telemetry.recordMetric(`${this.componentName}.get_tracked_venues`, 1, {
          implementation: 'rust',
          venue_count: venues.length.toString()
        });
        
        return venues;
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.getTrackedVenues failed, using fallback: ${error}`);
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        return this.fallback.getTrackedVenues();
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.getTrackedVenues: ${error}`);
      return [];
    }
  }

  /**
   * Calculate a venue routing score based on latency metrics
   * Lower score means better routing performance
   * @param venue Venue identifier
   * @returns Routing score (0-100, lower is better) or 100 if no data
   */
  public getRoutingScore(venue: string): number {
    try {
      if (this.usingFallback || !this.native) {
        return this.fallback.getRoutingScore(venue);
      }
      
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
        
        // Record the routing score in telemetry
        telemetry.recordMetric(`${this.componentName}.routing_score`, weightedScore, {
          venue,
          implementation: 'rust'
        });
        
        return weightedScore;
      } catch (error) {
        logger.warn(`Native VenueLatencyTracker.getRoutingScore calculation failed, using fallback: ${error}`);
        
        // Fall back to JavaScript implementation
        this.usingFallback = true;
        return this.fallback.getRoutingScore(venue);
      }
    } catch (error) {
      logger.error(`Error in VenueLatencyTracker.getRoutingScore: ${error}`);
      return 100; // Default to worst score on error
    }
  }
  
  /**
   * Check if using JavaScript fallback implementation
   * @returns True if using JavaScript fallback
   */
  public isUsingFallback(): boolean {
    return this.usingFallback;
  }
} 