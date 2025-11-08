/**
 * Types for temporal signal evolution
 */

/**
 * Current phase of an alpha signal
 */
export enum SignalPhase {
  TRENDING = 'trending',
  MEAN_REVERTING = 'mean_reverting',
  DECAY = 'decay',
  UNSTABLE = 'unstable',
  UNKNOWN = 'unknown'
}

/**
 * Detected phase shift in signal behavior
 */
export interface DetectedPhaseShift {
  /** Signal identifier */
  signalId: string;
  
  /** Previous phase */
  previousPhase: SignalPhase;
  
  /** New phase */
  newPhase: SignalPhase;
  
  /** Magnitude of the shift (0-1) */
  magnitude: number;
  
  /** When the shift was detected */
  timestamp: number;
  
  /** Confidence in the shift detection (0-1) */
  confidence: number;
  
  /** Supporting metrics that led to detection */
  metrics: {
    driftScore: number;
    stabilityScore: number;
    trendStrength: number;
    meanReversionStrength: number;
  };
}

/**
 * Label for an alpha signal's current state
 */
export interface AlphaLabel {
  /** Signal identifier */
  signalId: string;
  
  /** Current phase */
  currentPhase: SignalPhase;
  
  /** How stable the signal behavior is (0-1) */
  stabilityScore: number;
  
  /** How much the signal has drifted from original behavior (0-1) */
  driftScore: number;
  
  /** When this label was generated */
  timestamp: number;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Report of temporal evolution analysis
 */
export interface TemporalEvolutionReport {
  /** Timestamp of analysis */
  timestamp: number;
  
  /** Current labels for all tracked signals */
  labels: AlphaLabel[];
  
  /** Phase shifts detected in this analysis */
  phaseShifts: DetectedPhaseShift[];
  
  /** Overall system health metrics */
  systemMetrics: {
    /** Percentage of signals in each phase */
    phaseDistribution: Record<SignalPhase, number>;
    /** Average stability across all signals */
    avgStability: number;
    /** Average drift across all signals */
    avgDrift: number;
    /** Number of signals being tracked */
    signalCount: number;
  };
}

/**
 * Configuration for temporal signal evolution
 */
export interface TemporalEvolutionConfig {
  /** Whether temporal evolution is enabled */
  enabled: boolean;
  
  /** Drift detection settings */
  driftDetection: {
    /** Number of samples in analysis window */
    windowSize: number;
    /** Threshold for significant drift (0-1) */
    driftThreshold: number;
  };
  
  /** Phase shift detection settings */
  phaseShiftDetection: {
    /** Minimum magnitude to consider a phase shift (0-1) */
    minShiftMagnitude: number;
    /** Cooloff period between shift detections (seconds) */
    cooloffPeriodSeconds: number;
  };
  
  /** History retention settings */
  history: {
    /** How long to keep history (days) */
    retentionDays: number;
    /** Maximum entries to keep per signal */
    maxEntriesPerSignal: number;
  };
} 