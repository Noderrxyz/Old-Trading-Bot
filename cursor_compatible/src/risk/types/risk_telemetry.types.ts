/**
 * Risk level thresholds
 */
export interface RiskScoreThresholds {
  /** Low risk threshold */
  low: number;
  
  /** Medium risk threshold */
  medium: number;
  
  /** High risk threshold */
  high: number;
  
  /** Critical risk threshold */
  critical: number;
}

/**
 * Risk telemetry configuration
 */
export interface RiskTelemetryConfig {
  /** Whether telemetry is enabled */
  enabled: boolean;
  
  /** Snapshot interval in seconds */
  snapshotIntervalSec: number;
  
  /** Risk score thresholds */
  riskScoreThresholds: RiskScoreThresholds;
  
  /** Snapshot retention period in seconds */
  snapshotRetentionSec: number;
  
  /** Redis connection URL (optional) */
  redisUrl?: string;
}

/**
 * Risk snapshot data
 */
export interface RiskSnapshot {
  /** Timestamp */
  timestamp: number;
  
  /** Risk scores by symbol */
  symbolRisk: Record<string, number>;
  
  /** Exposure amounts by symbol */
  symbolExposure: Record<string, number>;
  
  /** Total system risk */
  totalRisk: number;
}

/**
 * Default risk score thresholds
 */
export const DEFAULT_RISK_SCORE_THRESHOLDS: RiskScoreThresholds = {
  low: 0.2,
  medium: 0.5,
  high: 0.75,
  critical: 0.9
};

/**
 * Default risk telemetry configuration
 */
export const DEFAULT_RISK_TELEMETRY_CONFIG: RiskTelemetryConfig = {
  enabled: true,
  snapshotIntervalSec: 15,
  riskScoreThresholds: DEFAULT_RISK_SCORE_THRESHOLDS,
  snapshotRetentionSec: 86400 // 1 day
}; 