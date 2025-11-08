/**
 * Simulation Types
 * 
 * Defines types and interfaces for simulation components.
 */

import { MarketData } from '../agents/base/TradingAgent.js';
import { TradingStrategy } from '../strategy/trading_strategy.js';

/**
 * Monte Carlo simulation configuration
 */
export interface MonteCarloConfig {
  enabled: boolean;
  numSimulations: number;
  initialPrice: number;
  timeSteps: number;
  timeStepSize: number; // in milliseconds
  drift: number;
  volatility: number;
  garchParams: {
    omega: number;
    alpha: number;
    beta: number;
  };
  jumpParams: {
    intensity: number;
    mean: number;
    std: number;
  };
  seed?: number;
}

/**
 * Simulation results for a single price path
 */
export interface SimulationResult {
  simulationId: number;
  pricePath: number[];
  pnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  volatility: number;
  winRate: number;
  survivalTime: number;
}

/**
 * Distribution
 */
export interface Distribution {
  mean: number;
  std: number;
  percentiles: number[];
}

/**
 * Confidence intervals
 */
export interface ConfidenceIntervals {
  pnl: [number, number][];
  drawdown: [number, number][];
  sharpe: [number, number][];
}

/**
 * Risk metrics
 */
export interface RiskMetrics {
  var95: number;
  var99: number;
  expectedShortfall: number;
  tailRisk: number;
}

/**
 * Aggregate statistics across all simulations
 */
export interface AggregateStats {
  meanPnl: number;
  maxDrawdownDist: Distribution;
  sharpeRatioDist: Distribution;
  survivalRate: number;
  confidenceIntervals: ConfidenceIntervals;
  riskMetrics: RiskMetrics;
}

/**
 * Simulation event types
 */
export const SimulationEventType = {
  MonteCarloProgress: 'MONTE_CARLO_PROGRESS',
  ChaosEvent: 'CHAOS_EVENT',
  ChartUpdate: 'CHART_UPDATE',
  RiskProfileUpdate: 'RISK_PROFILE_UPDATE'
} as const;

export type SimulationEventType = typeof SimulationEventType[keyof typeof SimulationEventType];

/**
 * Monte Carlo progress event
 */
export interface MonteCarloProgressEvent {
  type: typeof SimulationEventType.MonteCarloProgress;
  progress: number;
  currentSimulation: number;
  totalSimulations: number;
}

/**
 * Chaos event
 */
export interface ChaosEvent {
  type: typeof SimulationEventType.ChaosEvent;
  eventType: 'gas_spike' | 'oracle_delay' | 'chain_congestion';
  severity: number;
  durationMs: number;
  timestamp: number;
}

/**
 * Chart update event
 */
export interface ChartUpdateEvent {
  type: typeof SimulationEventType.ChartUpdate;
  data: number[];
  timestamp: number;
}

/**
 * Risk profile update event
 */
export interface RiskProfileUpdateEvent {
  type: typeof SimulationEventType.RiskProfileUpdate;
  metrics: RiskMetrics;
  timestamp: number;
}

/**
 * Simulation event
 */
export type SimulationEvent = 
  | MonteCarloProgressEvent 
  | ChaosEvent 
  | ChartUpdateEvent 
  | RiskProfileUpdateEvent;

/**
 * Chart data point
 */
export interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

/**
 * Risk profile metrics
 */
export interface RiskProfile {
  pnlStability: number;  // 0-1
  maxDrawdown: number;
  recoveryTime: number;  // ms
  slippageImpact: number;  // 0-1
  failureRecoveryRate: number;  // 0-1
  chaosResilience: number;  // 0-1
  survivalRate: number;  // 0-1
}

/**
 * Simulation report
 */
export interface SimulationReport {
  timestamp: number;
  riskProfile: RiskProfile;
  pnlDistribution: number[];
  drawdownDistribution: number[];
  volatilityDistribution: number[];
  chaosEvents: ChaosEvent[];
  weaknessMap: Record<string, number>;
} 