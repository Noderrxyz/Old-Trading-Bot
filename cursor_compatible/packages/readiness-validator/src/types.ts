/**
 * Type definitions for Readiness Validator
 */

export enum CheckType {
  STARTUP = 'STARTUP',
  MESSAGE_BUS = 'MESSAGE_BUS',
  SIMULATION = 'SIMULATION',
  LOGS = 'LOGS',
  DASHBOARD = 'DASHBOARD'
}

export interface ValidationResult {
  success: boolean;
  checkType: CheckType;
  timestamp: number;
  details: ValidationDetail[];
  metrics?: Record<string, number | string>;
  error?: Error;
}

export interface ValidationDetail {
  success: boolean;
  message: string;
  metadata?: Record<string, any>;
}

export interface CheckOptions {
  timeout?: number;
  retries?: number;
  verbose?: boolean;
}

export interface ModuleStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  version: string;
  uptime: number;
  lastHealthCheck: number;
  metrics?: {
    cpu: number;
    memory: number;
    latency: number;
    errors: number;
  };
}

export interface MessageBusMetrics {
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  throughput: number;
  queueSize: number;
  errorRate: number;
}

export interface SimulationResult {
  trades: number;
  pnl: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  errors: number;
}

export interface LogTestResult {
  logsWritten: number;
  logsFlushed: number;
  errors: number;
  latency: number;
}

export interface DashboardStatus {
  grafanaUp: boolean;
  prometheusUp: boolean;
  lokiUp: boolean;
  dashboardsLoaded: number;
  metricsCollected: number;
} 