import { ExpandedFeatureFrame } from './feature.types.js';

/**
 * Target returns frame
 */
export interface TargetFrame {
  /** Asset symbol */
  symbol: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Target returns */
  returns: {
    /** 5-minute return */
    m5: number;
    /** 15-minute return */
    m15: number;
    /** 1-hour return */
    h1: number;
  };
}

/**
 * Feature quality metrics
 */
export interface FeatureQualityMetrics {
  /** Information coefficient */
  ic: number;
  
  /** Pearson correlation */
  correlation: number;
  
  /** Feature drift percentage */
  drift: number;
  
  /** Last update timestamp */
  lastUpdate: number;
}

/**
 * Feature quality report
 */
export interface QualityReport {
  /** Asset symbol */
  symbol: string;
  
  /** Report timestamp */
  timestamp: number;
  
  /** Feature quality scores */
  featureScores: Record<string, FeatureQualityMetrics>;
  
  /** Flagged features */
  flaggedFeatures: string[];
}

/**
 * Feature monitoring configuration
 */
export interface FeatureMonitoringConfig {
  /** Whether monitoring is enabled */
  enabled: boolean;
  
  /** Rolling window size */
  windowSize: number;
  
  /** Information coefficient threshold */
  icThreshold: number;
  
  /** Correlation threshold */
  correlationThreshold: number;
  
  /** Drift threshold percentage */
  driftThreshold: number;
  
  /** Minimum samples for statistics */
  minSamples: number;
}

/**
 * Default feature monitoring configuration
 */
export const DEFAULT_FEATURE_MONITORING_CONFIG: FeatureMonitoringConfig = {
  enabled: true,
  windowSize: 100,
  icThreshold: 0.05,
  correlationThreshold: 0.05,
  driftThreshold: 15,
  minSamples: 30
}; 