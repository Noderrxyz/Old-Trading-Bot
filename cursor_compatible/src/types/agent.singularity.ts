/**
 * Strategy Singularity Detection Types
 * 
 * Types for detecting and handling strategy singularities.
 */

/**
 * Singularity signal representing potential problematic strategy behavior
 */
export interface SingularitySignal {
  /** Agent ID that generated the signal */
  agentId: string;
  
  /** Performance Z-score compared to other agents */
  performanceZScore: number;
  
  /** Measure of how unique the strategy is (0-1) */
  strategyUniqueness: number;
  
  /** Impact of execution on market (percentage) */
  executionImpact: number;
  
  /** Clustering correlation with other agents */
  correlationClustering: number;
  
  /** Overall anomaly score */
  anomalyScore: number;
  
  /** Timestamp when this signal was generated */
  timestamp: number;
}

/**
 * Severity levels for singularity alerts
 */
export enum SingularitySeverity {
  /** Informational alert - no immediate action needed */
  INFO = 'info',
  
  /** Warning alert - monitoring required */
  WARNING = 'warning',
  
  /** Critical alert - immediate action needed */
  CRITICAL = 'critical'
}

/**
 * Containment actions that can be taken
 */
export enum ContainmentAction {
  /** Throttle execution frequency or size */
  THROTTLE = 'throttle',
  
  /** Move the strategy to a sandbox environment */
  SANDBOX = 'sandbox',
  
  /** Force diversification of the strategy */
  DIVERSIFY = 'diversify',
  
  /** Temporarily deactivate the strategy */
  DEACTIVATE = 'deactivate',
  
  /** Permanently deactivate and archive the strategy */
  ARCHIVE = 'archive'
}

/**
 * Alert for a detected singularity risk
 */
export interface SingularityAlert {
  /** Unique alert ID */
  id: string;
  
  /** Agent ID that triggered the alert */
  agentId: string;
  
  /** Severity level of the alert */
  severity: SingularitySeverity;
  
  /** Reason for the alert */
  reason: string;
  
  /** The singularity signal that triggered this alert */
  signal: SingularitySignal;
  
  /** Recommended containment action */
  recommendedAction: ContainmentAction;
  
  /** Timestamp when the alert was generated */
  timestamp: number;
  
  /** Whether the alert has been acknowledged */
  acknowledged: boolean;
  
  /** Whether the recommended action has been applied */
  actionApplied: boolean;
  
  /** Timestamp when action was applied (if any) */
  actionTimestamp?: number;
}

/**
 * Strategy risk score
 */
export interface StrategyRisk {
  /** Agent ID */
  agentId: string;
  
  /** Overall risk score (0-1) */
  riskScore: number;
  
  /** Factors contributing to singularity risk */
  singularityFactors: string[];
  
  /** History of singularity signals */
  signalHistory: SingularitySignal[];
  
  /** Timestamp of last update */
  lastUpdate: number;
}

/**
 * Throttling settings for an agent
 */
export interface ThrottleSettings {
  /** Maximum execution size (percentage of normal) */
  maxExecutionSize: number;
  
  /** Maximum execution frequency (percentage of normal) */
  maxExecutionFrequency: number;
  
  /** Minimum time between executions (ms) */
  minTimeBetweenExecutions: number;
  
  /** Reason for throttling */
  reason: string;
  
  /** When throttling expires (0 for indefinite) */
  expiresAt: number;
}

/**
 * Sandbox settings for an agent
 */
export interface SandboxSettings {
  /** Whether the agent is in sandbox mode */
  inSandbox: boolean;
  
  /** Reason for being in sandbox */
  reason: string;
  
  /** When the agent was placed in sandbox */
  sandboxedAt: number;
  
  /** When the sandbox period expires (0 for indefinite) */
  expiresAt: number;
  
  /** Whether real market data should be provided */
  provideRealData: boolean;
  
  /** Whether to simulate executions */
  simulateExecutions: boolean;
}

/**
 * Agent status regarding singularity detection and containment
 */
export interface AgentSingularityStatus {
  /** Agent ID */
  agentId: string;
  
  /** Current risk score */
  riskScore: number;
  
  /** Whether the agent is being monitored closely */
  underMonitoring: boolean;
  
  /** Current throttle settings (if throttled) */
  throttleSettings?: ThrottleSettings;
  
  /** Current sandbox settings (if sandboxed) */
  sandboxSettings?: SandboxSettings;
  
  /** History of alerts for this agent */
  alertHistory: SingularityAlert[];
  
  /** Last time the status was updated */
  lastUpdated: number;
} 