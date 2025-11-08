/**
 * Types for execution telemetry and smart debugging
 */

/**
 * Transaction execution status
 */
export enum TransactionStatus {
  Success = 'Success',
  Failure = 'Failure',
  Error = 'Error'
}

/**
 * Error codes for transaction failures
 */
export enum TransactionErrorCode {
  OutOfGas = 'OutOfGas',
  Underpriced = 'Underpriced',
  Reverted = 'Reverted',
  NetworkError = 'NetworkError',
  Unknown = 'Unknown'
}

/**
 * Transaction telemetry record
 */
export interface TransactionTelemetry {
  // Timestamps
  timestamp: number;
  blockTimestamp: number;
  
  // Context
  chain: string;
  dex: string;
  strategyId: string;
  agentId: string;
  txHash: string;
  
  // Gas metrics
  gasUsed: number;
  gasPrice: number;
  
  // Performance metrics
  executionLatency: number; // ms
  status: TransactionStatus;
  errorCode?: TransactionErrorCode;
  fillRate: number; // 0-1
  slippage: number; // 0-1
}

/**
 * Debug alert severity levels
 */
export enum DebugAlertSeverity {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
  Critical = 'Critical'
}

/**
 * Debug alert
 */
export interface DebugAlert {
  agentId: string;
  strategyId?: string;
  issue: string;
  severity: DebugAlertSeverity;
  recommendedAction: string;
  timestamp: number;
  metrics?: {
    failRate?: number;
    avgLatency?: number;
    avgSlippage?: number;
    fillRate?: number;
  };
}

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  // Enable/disable features
  enabled: boolean;
  smartDebuggerEnabled: boolean;
  
  // Buffer settings
  telemetryMaxBufferSize: number;
  
  // Error thresholds
  errorThresholds: {
    failRateHigh: number; // 0-1
    slippageHigh: number; // 0-1
    latencyHighMs: number;
  };
  
  // Debug settings
  debugSettings: {
    minSamplesForAnalysis: number;
    analysisWindowSec: number;
    alertCooldownSec: number;
  };
}

/**
 * Default telemetry configuration
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  smartDebuggerEnabled: true,
  telemetryMaxBufferSize: 10000,
  errorThresholds: {
    failRateHigh: 0.15,
    slippageHigh: 0.01,
    latencyHighMs: 1000
  },
  debugSettings: {
    minSamplesForAnalysis: 10,
    analysisWindowSec: 3600, // 1 hour
    alertCooldownSec: 300 // 5 minutes
  }
}; 