/**
 * API Types and Schemas
 * Defines common types and interfaces used throughout the API
 */

/**
 * Agent execution mode
 */
export type ExecutionMode = 'live' | 'dry-run' | 'canary';

/**
 * Agent lifecycle state
 */
export enum AgentLifecycleState {
  // Initializing and warming up
  INITIALIZING = 'initializing',
  
  // Running normally
  RUNNING = 'running',
  
  // Temporarily paused (e.g., during high volatility)
  PAUSED = 'paused',
  
  // Running in reduced risk mode (e.g., due to drawdown)
  RISK_REDUCED = 'risk_reduced',
  
  // Decaying - performance degrading, needs attention
  DECAYING = 'decaying',
  
  // Disabled - not trading
  DISABLED = 'disabled',
  
  // Error state - encountered issues
  ERROR = 'error'
}

/**
 * Agent performance snapshot
 */
export interface AgentPerformanceSnapshot {
  // Agent identifier
  agentId: string;
  
  // Agent name (if available)
  name?: string;
  
  // Execution mode
  mode: ExecutionMode;
  
  // Agent state
  state: AgentLifecycleState;
  
  // Cumulative PnL
  cumulativePnL: number;
  
  // Realized and unrealized PnL
  realizedPnL: number;
  unrealizedPnL: number;
  
  // Win rate
  winRate: number;
  
  // Number of signals processed
  signalCount: number;
  
  // Average latency from signal to execution (ms)
  avgLatency: number;
  
  // Drawdown metrics
  currentDrawdownPct: number;
  maxDrawdownPct: number;
  
  // Time since agent started
  uptime: number;
  
  // Whether this is a canary agent
  isCanary: boolean;
  
  // Last trade information
  lastTrade?: {
    timestamp: number;
    price: number;
    type: 'buy' | 'sell';
    asset: string;
  };
  
  // Timestamp of this snapshot
  timestamp: number;
}

/**
 * Agent comparison update (for WebSocket)
 */
export interface AgentComparisonUpdate {
  agents: {
    id: string;
    name?: string;
    mode: 'live' | 'canary';
    cumulativePnL: number;
    avgLatency: number;
    winRate: number;
    drawdownMax: number;
    signalCount: number;
    timestamp: number;
  }[];
}

/**
 * Historical agent performance data point
 */
export interface AgentPerformanceHistoryPoint {
  agentId: string;
  timestamp: number;
  cumulativePnL: number;
  drawdownPct: number;
  exposure: number;
}

/**
 * Agent comparison query parameters
 */
export interface AgentCompareQueryParams {
  agentIds?: string[];
  timeRange?: string; // '1h', '1d', '7d', etc.
  metrics?: string[]; // Which metrics to include
}

/**
 * Agent history query parameters
 */
export interface AgentHistoryQueryParams {
  agentIds?: string[];
  timeRange?: string; // '1h', '1d', '7d', etc.
  resolution?: string; // '1m', '5m', '1h', etc.
  metrics?: string[]; // Which metrics to include
} 