import { Strategy } from '../../strategy/types/strategy.types.js';
import { TrustScore } from '../../trust/types/trust.types.js';
import { ChaosEvent } from '../../simulation/types/chaos.types.js';

/**
 * Agent deployment status
 */
export enum AgentStatus {
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Paused = 'PAUSED',
  Stopped = 'STOPPED',
  Terminated = 'TERMINATED'
}

/**
 * Agent health metrics
 */
export interface AgentHealthMetrics {
  cpuUsage: number;  // 0-1
  memoryUsage: number;  // 0-1
  latencyMs: number;
  errorRate: number;  // 0-1
  trustScore: number;  // 0-1
  lastHeartbeat: number;
  performanceScore: number;
}

/**
 * Agent deployment configuration
 */
export interface AgentConfig {
  strategy: Strategy;
  walletAddress: string;
  maxGasPrice: number;
  targetRegions: string[];
  minTrustScore: number;
  warmupDurationMs: number;
  cooldownDurationMs: number;
  maxConcurrentTrades: number;
  riskLimit: number;
  trustScoreThreshold: number;
}

/**
 * Live agent information
 */
export interface LiveAgent {
  id: string;
  status: AgentStatus;
  config: AgentConfig;
  health: AgentHealthMetrics;
  lastUpdate: number;
  startTime: number;
  activeVenues: string[];
  metrics: {
    tradesExecuted: number;
    capitalDeployed: number;
    pnl: number;
    slippage: number;
  };
}

/**
 * Launch control configuration
 */
export interface LaunchControlConfig {
  maxConcurrentTrades: number;
  riskLimit: number;
  trustScoreThreshold: number;
  launchTimeoutMs: number;
  healthCheckIntervalMs: number;
}

/**
 * Auto-scaling configuration
 */
export interface AutoScaleConfig {
  minAgents: number;
  maxAgents: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  scaleIntervalMs: number;
}

/**
 * Launch policy configuration
 */
export interface LaunchPolicy {
  id: string;
  name: string;
  description: string;
  condition: (agent: LiveAgent) => boolean;
  action: (agent: LiveAgent) => Promise<void>;
}

/**
 * Launch control events
 */
export interface LaunchEvent {
  type: 'DEPLOY' | 'PAUSE' | 'STOP' | 'SCALE' | 'PANIC';
  timestamp: number;
  agentId: string;
  details: Record<string, any>;
}

/**
 * Default configurations
 */
export const DEFAULT_LAUNCH_CONTROL_CONFIG: LaunchControlConfig = {
  maxConcurrentTrades: 10,
  riskLimit: 1000,
  trustScoreThreshold: 0.8,
  launchTimeoutMs: 30000,
  healthCheckIntervalMs: 5000
};

export const DEFAULT_AUTO_SCALE_CONFIG: AutoScaleConfig = {
  minAgents: 2,
  maxAgents: 10,
  scaleUpThreshold: 0.8,
  scaleDownThreshold: 0.2,
  scaleIntervalMs: 60000
}; 