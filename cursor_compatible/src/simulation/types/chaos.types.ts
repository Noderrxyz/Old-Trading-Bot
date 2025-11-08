import { MarketDataPoint } from './market.types.js';

/**
 * Chaos event types
 */
export enum ChaosEventType {
  GasSpike = 'GAS_SPIKE',
  OracleDelay = 'ORACLE_DELAY',
  MarketCrash = 'MARKET_CRASH',
  ChainCongestion = 'CHAIN_CONGESTION',
  TradeRejection = 'TRADE_REJECTION',
  LatencySpike = 'LATENCY_SPIKE',
  SlippageBurst = 'SLIPPAGE_BURST',
  DEXDowntime = 'DEX_DOWNTIME'
}

/**
 * Chaos event severity levels
 */
export enum ChaosSeverity {
  Low = 'LOW',
  Medium = 'MEDIUM',
  High = 'HIGH',
  Critical = 'CRITICAL'
}

/**
 * Base chaos event interface
 */
export interface ChaosEvent {
  type: ChaosEventType;
  severity: ChaosSeverity;
  timestamp: number;
  duration: number;
  probability: number;
}

/**
 * Gas spike event
 */
export interface GasSpikeEvent extends ChaosEvent {
  type: ChaosEventType.GasSpike;
  multiplier: number;  // 10x-100x
  affectedRoutes: string[];
}

/**
 * Oracle delay event
 */
export interface OracleDelayEvent extends ChaosEvent {
  type: ChaosEventType.OracleDelay;
  delayMs: number;  // 2000-30000ms
  affectedOracles: string[];
}

/**
 * Market crash event
 */
export interface MarketCrashEvent extends ChaosEvent {
  type: ChaosEventType.MarketCrash;
  dropPercentage: number;  // 20-60%
  durationMs: number;
  affectedMarkets: string[];
}

/**
 * Chain congestion event
 */
export interface ChainCongestionEvent extends ChaosEvent {
  type: ChaosEventType.ChainCongestion;
  blockDelay: number;  // blocks
  affectedChains: string[];
}

/**
 * Trade rejection event
 */
export interface TradeRejectionEvent extends ChaosEvent {
  type: ChaosEventType.TradeRejection;
  rejectionRate: number;  // 0-1
  affectedVenues: string[];
}

/**
 * Latency spike event
 */
export interface LatencySpikeEvent extends ChaosEvent {
  type: ChaosEventType.LatencySpike;
  delayMs: number;  // ms
  affectedEndpoints: string[];
}

/**
 * Slippage burst event
 */
export interface SlippageBurstEvent extends ChaosEvent {
  type: ChaosEventType.SlippageBurst;
  slippageMultiplier: number;  // 1-10x
  affectedPairs: string[];
}

/**
 * DEX downtime event
 */
export interface DEXDowntimeEvent extends ChaosEvent {
  type: ChaosEventType.DEXDowntime;
  affectedDEXs: string[];
  downtimeMs: number;
}

/**
 * Chaos scenario configuration
 */
export interface ChaosScenario {
  name: string;
  description: string;
  events: ChaosEvent[];
  durationMs: number;
  repeatCount: number;
}

/**
 * Chaos engine configuration
 */
export interface ChaosEngineConfig {
  enabled: boolean;
  scenarios: ChaosScenario[];
  checkIntervalMs: number;
  maxConcurrentEvents: number;
  telemetryEnabled: boolean;
}

/**
 * Default chaos engine configuration
 */
export const DEFAULT_CHAOS_CONFIG: ChaosEngineConfig = {
  enabled: true,
  scenarios: [],
  checkIntervalMs: 1000,
  maxConcurrentEvents: 3,
  telemetryEnabled: true
};

/**
 * Chaos simulation metrics
 */
export interface ChaosMetrics {
  agentDeathRate: number;  // 0-1
  capitalRetention: number;  // 0-1
  trustScoreErosion: number;  // 0-1
  recoverySpeed: number;  // ms
  routeFlappingCount: number;
}

/**
 * Chaos simulation report
 */
export interface ChaosReport {
  scenarioName: string;
  startTime: number;
  endTime: number;
  metrics: ChaosMetrics;
  events: ChaosEvent[];
  systemReactions: {
    timestamp: number;
    event: ChaosEvent;
    reaction: string;
    outcome: string;
  }[];
}

/**
 * Chaos telemetry event
 */
export interface ChaosTelemetryEvent {
  type: ChaosEventType;
  severity: ChaosSeverity;
  timestamp: number;
  metrics: {
    capitalDrawdown: number;
    trustScore: number;
    alphaRetention: number;
    routeChanges: number;
  };
} 