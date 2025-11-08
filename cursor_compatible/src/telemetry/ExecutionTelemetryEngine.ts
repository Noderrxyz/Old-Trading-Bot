/**
 * Execution Telemetry Engine
 * 
 * Handles telemetry and event emission for the trading system.
 * Provides centralized logging and monitoring capabilities.
 */

import logger from '../utils/logger.js';
import { 
  TransactionTelemetry, 
  TelemetryConfig, 
  DEFAULT_TELEMETRY_CONFIG,
  TransactionErrorCode
} from './types/execution_telemetry.types.js';

/**
 * Telemetry event types
 */
export type TelemetryEventType = 
  | 'MARKET_DATA'
  | 'MARKET_DATA_REPLAY'
  | 'SCENARIO_ACTIVATED'
  | 'SCENARIO_COMPLETED'
  | 'TRUST_SCORE_UPDATE'
  | 'AGENT_DRAWDOWN_BREACH'
  | 'STRATEGY_DRAWDOWN_BREACH'
  | 'GLOBAL_DRAWDOWN_BREACH'
  | 'EMERGENCY_FREEZE'
  | 'DRAWDOWN_ALERT'
  | 'EXPOSURE_BREACH'
  | 'CAPITAL_REBALANCE'
  | 'ALPHA_SCORE_UPDATE';

/**
 * Base telemetry event
 */
export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: number;
}

/**
 * Market data event
 */
export interface MarketDataEvent extends TelemetryEvent {
  type: 'MARKET_DATA';
  data: {
    timestamp: number;
    price: number;
    volume: number;
    liquidity: number;
    volatility: number;
    oracleLag?: number;
    txLatency?: number;
    dexAvailable?: boolean;
  };
}

/**
 * Market data replay event
 */
export interface MarketDataReplayEvent extends TelemetryEvent {
  type: 'MARKET_DATA_REPLAY';
  data: {
    timestamp: number;
    price: number;
    volume: number;
    liquidity: number;
    volatility: number;
    orderBook?: {
      bids: [number, number][];
      asks: [number, number][];
    };
    trades?: {
      price: number;
      size: number;
      side: 'buy' | 'sell';
    }[];
    index: number;
    total: number;
  };
}

/**
 * Scenario event
 */
export interface ScenarioEvent extends TelemetryEvent {
  type: 'SCENARIO_ACTIVATED' | 'SCENARIO_COMPLETED';
  scenario: string;
}

/**
 * Trust score event
 */
export interface TrustScoreEvent extends TelemetryEvent {
  type: 'TRUST_SCORE_UPDATE';
  agentId: string;
  oldScore: number;
  newScore: number;
}

/**
 * Drawdown event
 */
export interface DrawdownEvent extends TelemetryEvent {
  type: 'AGENT_DRAWDOWN_BREACH' | 'STRATEGY_DRAWDOWN_BREACH' | 'GLOBAL_DRAWDOWN_BREACH';
  entityId: string;
  drawdownPct: number;
  threshold: number;
}

/**
 * Emergency freeze event
 */
export interface EmergencyFreezeEvent extends TelemetryEvent {
  type: 'EMERGENCY_FREEZE';
  entityType: 'agent' | 'strategy' | 'global';
  entityId: string;
}

/**
 * Drawdown alert event
 */
export interface DrawdownAlertEvent extends TelemetryEvent {
  type: 'DRAWDOWN_ALERT';
  entityType: 'agent' | 'strategy' | 'global';
  entityId: string;
  drawdownPct: number;
  threshold: number;
}

/**
 * Exposure breach event
 */
export interface ExposureBreachEvent extends TelemetryEvent {
  type: 'EXPOSURE_BREACH';
  entityType: 'asset' | 'pair' | 'agent';
  entityId: string;
  currentExposure: number;
  limit: number;
}

/**
 * Capital rebalance event
 */
export interface CapitalRebalanceEvent extends TelemetryEvent {
  type: 'CAPITAL_REBALANCE';
  agentId: string;
  oldAllocation: number;
  newAllocation: number;
  allocationPct: number;
}

/**
 * Alpha score update event
 */
export interface AlphaScoreUpdateEvent extends TelemetryEvent {
  type: 'ALPHA_SCORE_UPDATE';
  strategyId: string;
  agentId: string;
  score: number;
  components: {
    roi: number;
    drawdown: number;
    sharpe: number;
    volatility: number;
    trust: number;
  };
  timestamp: number;
}

/**
 * Union type for all telemetry events
 */
export type TelemetryEvents = 
  | MarketDataEvent
  | MarketDataReplayEvent
  | ScenarioEvent
  | TrustScoreEvent
  | DrawdownEvent
  | EmergencyFreezeEvent
  | DrawdownAlertEvent
  | ExposureBreachEvent
  | CapitalRebalanceEvent
  | AlphaScoreUpdateEvent;

/**
 * Execution Telemetry Engine class
 */
export class ExecutionTelemetryEngine {
  private static instance: ExecutionTelemetryEngine | null = null;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[TelemetryEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[TelemetryEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[TelemetryEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[TelemetryEngine] ${msg}`, ...args)
  };
  private readonly config: TelemetryConfig;
  private readonly telemetryBuffer: TransactionTelemetry[] = [];
  private readonly maxBufferSize: number;

  /**
   * Get singleton instance
   */
  public static getInstance(): ExecutionTelemetryEngine {
    if (!ExecutionTelemetryEngine.instance) {
      ExecutionTelemetryEngine.instance = new ExecutionTelemetryEngine();
    }
    return ExecutionTelemetryEngine.instance;
  }

  private constructor() {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG };
    this.maxBufferSize = this.config.telemetryMaxBufferSize;
    
    if (!this.config.enabled) {
      this.logger.warn('Execution telemetry is disabled');
    }
  }

  /**
   * Record a new transaction telemetry entry
   */
  public record(telemetry: TransactionTelemetry): void {
    if (!this.config.enabled) {
      return;
    }

    // Add to buffer and maintain size limit
    this.telemetryBuffer.push(telemetry);
    if (this.telemetryBuffer.length > this.maxBufferSize) {
      this.telemetryBuffer.shift();
    }

    // Log based on status
    if (telemetry.status === 'Success') {
      this.logger.info(`Transaction ${telemetry.txHash} executed successfully`);
    } else {
      this.logger.error(`Transaction ${telemetry.txHash} failed: ${telemetry.errorCode || 'Unknown error'}`);
    }
  }

  /**
   * Get telemetry data for a specific agent
   */
  public getAgentTelemetry(agentId: string): TransactionTelemetry[] {
    return this.telemetryBuffer.filter(t => t.agentId === agentId);
  }

  /**
   * Get telemetry data for a specific strategy
   */
  public getStrategyTelemetry(strategyId: string): TransactionTelemetry[] {
    return this.telemetryBuffer.filter(t => t.strategyId === strategyId);
  }

  /**
   * Get telemetry data within a time range
   */
  public getTelemetryInRange(startTime: number, endTime: number): TransactionTelemetry[] {
    return this.telemetryBuffer.filter(t => 
      t.timestamp >= startTime && t.timestamp <= endTime
    );
  }

  /**
   * Get telemetry data for a specific error code
   */
  public getTelemetryByErrorCode(errorCode: string): TransactionTelemetry[] {
    return this.telemetryBuffer.filter(t => t.errorCode === errorCode);
  }

  /**
   * Calculate success rate for a specific agent
   */
  public calculateAgentSuccessRate(agentId: string): number {
    const agentTelemetry = this.getAgentTelemetry(agentId);
    if (agentTelemetry.length === 0) {
      return 0;
    }
    
    const successCount = agentTelemetry.filter(t => t.status === 'Success').length;
    return successCount / agentTelemetry.length;
  }

  /**
   * Calculate average gas usage for a specific strategy
   */
  public calculateAverageGasUsage(strategyId: string): number {
    const strategyTelemetry = this.getStrategyTelemetry(strategyId);
    if (strategyTelemetry.length === 0) {
      return 0;
    }
    
    const totalGas = strategyTelemetry.reduce((sum, t) => sum + t.gasUsed, 0);
    return totalGas / strategyTelemetry.length;
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.telemetryBuffer.length = 0;
  }

  /**
   * Emit simulation event
   */
  public emitSimulationEvent(event: MarketDataEvent | MarketDataReplayEvent | ScenarioEvent | AlphaScoreUpdateEvent): void {
    this.logger.debug(`Emitted simulation event: ${event.type}`);
    // TODO: Implement actual event handling (e.g., send to monitoring system)
  }

  /**
   * Emit risk event
   */
  public emitRiskEvent(
    event: DrawdownEvent | EmergencyFreezeEvent | DrawdownAlertEvent | ExposureBreachEvent | CapitalRebalanceEvent
  ): void {
    this.logger.warn(`Emitted risk event: ${event.type}`);
    // TODO: Implement actual event handling (e.g., send to risk monitoring system)
  }

  /**
   * Emit trust score event
   */
  public emitTrustScoreEvent(event: TrustScoreEvent): void {
    this.logger.info(`Emitted trust score event: ${event.type} for agent ${event.agentId}`);
    // TODO: Implement actual event handling (e.g., send to trust score monitoring system)
  }
} 