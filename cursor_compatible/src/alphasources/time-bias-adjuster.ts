/**
 * Time-of-Day Bias Adjuster
 * 
 * Tracks and applies time-based bias adjustments to alpha signals based on
 * historical performance patterns across different hours of the day.
 */

import { FusedAlphaFrame } from './fusion-engine.js';
import { createLogger } from '../common/logger.js';

/**
 * Extended fused alpha frame with metadata
 */
interface ExtendedFusedAlphaFrame extends FusedAlphaFrame {
  /** Additional metadata for the signal */
  metadata?: Record<string, any>;
}

/**
 * Configuration for the Time-of-Day Bias Adjuster
 */
export interface TimeBiasConfig {
  /** Whether time-of-day bias adjustment is enabled */
  enabled: boolean;
  
  /** Duration of each time bucket in minutes */
  bucketIntervalMinutes: number;
  
  /** Minimum number of data points needed before applying bias */
  minDataPoints: number;
  
  /** Smoothing factor for moving average calculations (0-1) */
  smoothing: number;
  
  /** Confidence adjustment clamp range [min, max] */
  clampRange: [number, number];
  
  /** Whether to log detailed adjustments */
  logDetailedAdjustments: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: TimeBiasConfig = {
  enabled: true,
  bucketIntervalMinutes: 60,
  minDataPoints: 20,
  smoothing: 0.1,
  clampRange: [0.1, 1.0],
  logDetailedAdjustments: false
};

/**
 * Time bucket statistics
 */
interface BucketStats {
  /** Total signals recorded in this bucket */
  signalCount: number;
  
  /** Cumulative outcome score (>0 means positive returns) */
  cumulativeOutcome: number;
  
  /** Mean outcome score */
  meanOutcome: number;
  
  /** Bias factor to apply to signals in this bucket */
  biasFactor: number;
  
  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Time-of-Day Bias Adjuster
 */
export class TimeOfDayBiasAdjuster {
  private readonly logger;
  private readonly config: TimeBiasConfig;
  
  /** Buckets for time-of-day statistics */
  private buckets: Map<number, BucketStats> = new Map();
  
  /** Keep track of signals we've seen for outcomes */
  private processedSignals: Map<string, ExtendedFusedAlphaFrame> = new Map();
  
  /**
   * Create a new Time-of-Day Bias Adjuster
   * @param config Configuration options
   */
  constructor(config: Partial<TimeBiasConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('TimeOfDayBiasAdjuster');
    
    // Initialize buckets if not loaded from storage
    this.initializeBuckets();
    
    this.logger.info('Time-of-Day Bias Adjuster initialized', {
      bucketIntervalMinutes: this.config.bucketIntervalMinutes,
      minDataPoints: this.config.minDataPoints
    });
  }
  
  /**
   * Initialize time buckets
   */
  private initializeBuckets(): void {
    // Calculate number of buckets in a day
    const minutesInDay = 24 * 60;
    const bucketCount = minutesInDay / this.config.bucketIntervalMinutes;
    
    // Create empty buckets if they don't exist
    for (let i = 0; i < bucketCount; i++) {
      if (!this.buckets.has(i)) {
        this.buckets.set(i, {
          signalCount: 0,
          cumulativeOutcome: 0,
          meanOutcome: 0,
          biasFactor: 1.0, // Default is neutral
          lastUpdated: 0
        });
      }
    }
  }
  
  /**
   * Adjust a signal's confidence based on time-of-day bias
   * @param signal The alpha signal to adjust
   * @returns Adjusted signal
   */
  public adjustSignal(signal: FusedAlphaFrame): ExtendedFusedAlphaFrame {
    if (!this.config.enabled) {
      return signal as ExtendedFusedAlphaFrame;
    }
    
    // Determine which bucket this signal belongs to
    const bucketIndex = this.getBucketIndex(signal.timestamp);
    const bucket = this.buckets.get(bucketIndex);
    
    if (!bucket) {
      this.logger.warn(`No bucket found for index ${bucketIndex}`);
      return signal as ExtendedFusedAlphaFrame;
    }
    
    // Only apply adjustment if we have enough data points
    if (bucket.signalCount < this.config.minDataPoints) {
      if (this.config.logDetailedAdjustments) {
        this.logger.debug(
          `Not enough data for bucket ${bucketIndex} ` +
          `(${bucket.signalCount}/${this.config.minDataPoints})`
        );
      }
      return signal as ExtendedFusedAlphaFrame;
    }
    
    // Clone the signal to avoid modifying the original
    const adjustedSignal = { ...signal } as ExtendedFusedAlphaFrame;
    
    // Store the original confidence for logging
    const originalConfidence = adjustedSignal.confidence;
    
    // Apply bias factor to confidence
    adjustedSignal.confidence *= bucket.biasFactor;
    
    // Clamp confidence to configured range
    adjustedSignal.confidence = Math.max(
      this.config.clampRange[0],
      Math.min(this.config.clampRange[1], adjustedSignal.confidence)
    );
    
    // Add bias factor to metadata if it doesn't exist
    adjustedSignal.metadata = {
      ...(adjustedSignal.metadata || {}),
      timeBiasFactor: bucket.biasFactor,
      timeOfDayBucket: bucketIndex,
      samplesInBucket: bucket.signalCount
    };
    
    // Log adjustment if enabled
    if (this.config.logDetailedAdjustments) {
      this.logger.debug(
        `Adjusted confidence for ${signal.symbol} from ${originalConfidence.toFixed(4)} ` +
        `to ${adjustedSignal.confidence.toFixed(4)} (factor: ${bucket.biasFactor.toFixed(4)})`, 
        {
          bucket: bucketIndex,
          samples: bucket.signalCount,
          meanOutcome: bucket.meanOutcome
        }
      );
    }
    
    // Save the signal so we can match it with outcomes later
    const signalId = this.getSignalId(adjustedSignal);
    this.processedSignals.set(signalId, adjustedSignal);
    
    return adjustedSignal;
  }
  
  /**
   * Record the outcome of a signal to update bias factors
   * @param signal Original signal
   * @param outcome Actual return (positive = profit, negative = loss)
   */
  public recordOutcome(signal: ExtendedFusedAlphaFrame, outcome: number): void {
    if (!this.config.enabled) {
      return;
    }
    
    // Determine which bucket this signal belongs to
    const bucketIndex = this.getBucketIndex(signal.timestamp);
    const bucket = this.buckets.get(bucketIndex);
    
    if (!bucket) {
      this.logger.warn(`No bucket found for index ${bucketIndex}`);
      return;
    }
    
    // Update bucket statistics
    bucket.signalCount++;
    bucket.cumulativeOutcome += outcome;
    
    // Calculate new mean outcome with smoothing
    if (bucket.signalCount > 1) {
      // Apply exponential moving average with smoothing factor
      bucket.meanOutcome = (bucket.meanOutcome * (1 - this.config.smoothing)) +
                           (outcome * this.config.smoothing);
    } else {
      bucket.meanOutcome = outcome;
    }
    
    // Update bias factor based on mean outcome
    this.updateBiasFactor(bucket);
    
    // Update last updated timestamp
    bucket.lastUpdated = Date.now();
    
    this.logger.debug(
      `Recorded outcome ${outcome.toFixed(4)} for bucket ${bucketIndex}. ` +
      `New mean: ${bucket.meanOutcome.toFixed(4)}, bias: ${bucket.biasFactor.toFixed(4)}`
    );
    
    // Remove the signal from processed signals to free memory
    const signalId = this.getSignalId(signal);
    this.processedSignals.delete(signalId);
  }
  
  /**
   * Record outcome by matching signal ID
   * @param signalId Signal identifier (symbol + timestamp)
   * @param outcome Actual return
   * @returns Whether the signal was found and outcome recorded
   */
  public recordOutcomeById(signalId: string, outcome: number): boolean {
    const signal = this.processedSignals.get(signalId);
    
    if (!signal) {
      return false;
    }
    
    this.recordOutcome(signal, outcome);
    return true;
  }
  
  /**
   * Get a unique identifier for a signal
   * @param signal Fused alpha signal
   * @returns Signal identifier
   */
  private getSignalId(signal: ExtendedFusedAlphaFrame): string {
    return `${signal.symbol}_${signal.timestamp}`;
  }
  
  /**
   * Update the bias factor based on historical outcomes
   * @param bucket Bucket statistics to update
   */
  private updateBiasFactor(bucket: BucketStats): void {
    // If mean outcome is positive, strengthen confidence
    // If mean outcome is negative, weaken confidence
    
    if (bucket.meanOutcome > 0) {
      // For positive outcomes, scale up to 2.0 for strong performance
      bucket.biasFactor = 1.0 + Math.min(1.0, bucket.meanOutcome);
    } else {
      // For negative outcomes, scale down to 0.1 for poor performance
      bucket.biasFactor = Math.max(0.1, 1.0 + bucket.meanOutcome);
    }
  }
  
  /**
   * Get the bucket index for a timestamp
   * @param timestamp Unix timestamp in milliseconds
   * @returns Bucket index (0 to numBuckets-1)
   */
  private getBucketIndex(timestamp: number): number {
    const date = new Date(timestamp);
    const minutesInDay = date.getHours() * 60 + date.getMinutes();
    return Math.floor(minutesInDay / this.config.bucketIntervalMinutes);
  }
  
  /**
   * Get all bucket statistics
   * @returns Map of bucket index to statistics
   */
  public getBucketStats(): Map<number, BucketStats> {
    return new Map(this.buckets);
  }
  
  /**
   * Get bias factor for a specific time
   * @param timestamp Unix timestamp in milliseconds
   * @returns Bias factor for the given time
   */
  public getBiasFactor(timestamp: number): number {
    const bucketIndex = this.getBucketIndex(timestamp);
    const bucket = this.buckets.get(bucketIndex);
    
    if (!bucket || bucket.signalCount < this.config.minDataPoints) {
      return 1.0; // Default neutral factor if not enough data
    }
    
    return bucket.biasFactor;
  }
  
  /**
   * Load bucket statistics from storage
   * @param storedBuckets Previously stored bucket data
   */
  public loadStoredBuckets(storedBuckets: Map<number, BucketStats>): void {
    this.buckets = new Map(storedBuckets);
    this.initializeBuckets(); // Ensure all buckets exist
    
    this.logger.info(`Loaded ${this.buckets.size} time buckets from storage`);
  }
  
  /**
   * Reset all statistics (for testing or reset)
   */
  public reset(): void {
    this.buckets.clear();
    this.processedSignals.clear();
    this.initializeBuckets();
    
    this.logger.info('Time-of-Day Bias Adjuster reset');
  }
} 