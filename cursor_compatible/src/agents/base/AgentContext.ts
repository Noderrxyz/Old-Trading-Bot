/**
 * Agent Context
 * 
 * Defines the execution context for trading agents, including
 * configuration, market data access, risk parameters, and local state.
 */

import { RedisClient } from '../../common/redis.js';
import { createLogger, Logger } from '../../common/logger.js';

/**
 * Risk profile for a trading agent
 */
export interface RiskProfile {
  // Maximum drawdown percentage allowed before risk reduction
  maxDrawdownPct: number;
  
  // Maximum leverage allowed for this agent
  maxLeverage: number;
  
  // Maximum position size as percentage of capital
  maxPositionSizePct: number;
  
  // Whether to apply risk normalization across holdings
  applyRiskNormalization: boolean;
  
  // Minimum time between trades (ms)
  minTimeBetweenTrades: number;
  
  // Maximum daily trade count
  maxDailyTradeCount: number;
  
  // Whether agent can go short
  allowShort: boolean;
  
  // Whether agent can trade during high volatility
  allowVolatilityTrading: boolean;
  
  // Custom risk parameters for specific agent implementation
  customParams?: Record<string, any>;
}

/**
 * Default risk profile with conservative settings
 */
export const DEFAULT_RISK_PROFILE: RiskProfile = {
  maxDrawdownPct: 10,
  maxLeverage: 1.0,
  maxPositionSizePct: 20,
  applyRiskNormalization: true,
  minTimeBetweenTrades: 60000, // 1 minute
  maxDailyTradeCount: 10,
  allowShort: false,
  allowVolatilityTrading: false
};

/**
 * Market scope for an agent
 */
export interface MarketScope {
  // Asset pairs this agent can trade
  tradableAssets: string[];
  
  // Exchange-specific settings
  exchangeParams?: Record<string, any>;
  
  // Minimum required liquidity (in USD)
  minLiquidityUsd: number;
  
  // Minimum volume (in USD)
  minVolumeUsd: number;
  
  // Maximum spread allowed for trading (bps)
  maxSpreadBps: number;
  
  // Custom market parameters
  customParams?: Record<string, any>;
}

/**
 * Default market scope
 */
export const DEFAULT_MARKET_SCOPE: MarketScope = {
  tradableAssets: ['BTC/USD', 'ETH/USD'],
  minLiquidityUsd: 1000000, // $1M
  minVolumeUsd: 500000, // $500k
  maxSpreadBps: 20 // 0.2%
};

/**
 * Agent execution mode
 */
export type ExecutionMode = 'live' | 'dry-run' | 'canary';

/**
 * Agent execution configuration
 */
export interface ExecutionConfig {
  // Execution mode: live, dry-run, or canary
  // - live: actually execute trades
  // - dry-run: no trades, no simulation
  // - canary: simulate execution but don't actually trade
  mode: ExecutionMode;
  
  // Strategy execution style: passive, normal, aggressive
  executionStyle: 'passive' | 'normal' | 'aggressive';
  
  // Order type to use by default
  defaultOrderType: 'market' | 'limit' | 'adaptive';
  
  // Maximum slippage tolerance in basis points
  maxSlippageBps: number;
  
  // Time-to-live for orders in ms
  orderTtlMs: number;
  
  // Whether to use retry logic for failed orders
  useRetryLogic: boolean;
  
  // Whether agent is in canary mode (simulation only)
  // @deprecated Use mode='canary' instead
  canaryMode: boolean;
  
  // Custom execution parameters
  customParams?: Record<string, any>;
}

/**
 * Default execution configuration
 */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: 'live',
  executionStyle: 'normal',
  defaultOrderType: 'limit',
  maxSlippageBps: 10, // 0.1%
  orderTtlMs: 30000, // 30 seconds
  useRetryLogic: true,
  canaryMode: false
};

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
 * Agent metrics interface for telemetry
 */
export interface AgentMetrics {
  // Current PnL
  pnl: number;
  
  // Sharpe ratio
  sharpe: number;
  
  // Current drawdown percentage
  currentDrawdownPct: number;
  
  // Win rate (%)
  winRate: number;
  
  // Alpha (excess return vs market)
  alpha: number;
  
  // Beta (market sensitivity)
  beta: number;
  
  // Number of trades executed
  tradeCount: number;
  
  // Average holding period (ms)
  avgHoldingPeriodMs: number;
  
  // Current exposure (% of capital)
  currentExposurePct: number;
  
  // Custom metrics
  custom: Record<string, number>;
}

/**
 * The execution context for a trading agent
 */
export class AgentContext {
  // Agent identifier
  public readonly agentId: string;
  
  // Logger instance
  public readonly logger: Logger;
  
  // Redis client for state storage
  public readonly redis: RedisClient;
  
  // Agent configuration
  public readonly riskProfile: RiskProfile;
  public readonly marketScope: MarketScope;
  public readonly executionConfig: ExecutionConfig;
  
  // Lifecycle state
  private _lifecycleState: AgentLifecycleState = AgentLifecycleState.INITIALIZING;
  
  // Agent metrics
  private _metrics: AgentMetrics = {
    pnl: 0,
    sharpe: 0,
    currentDrawdownPct: 0,
    winRate: 0,
    alpha: 0,
    beta: 1,
    tradeCount: 0,
    avgHoldingPeriodMs: 0,
    currentExposurePct: 0,
    custom: {}
  };
  
  // Last trade timestamp
  private _lastTradeTimestamp: number = 0;
  
  // Daily trade counter
  private _dailyTradeCount: number = 0;
  
  // Last reset date for daily counters
  private _lastResetDate: string = '';
  
  /**
   * Create a new agent context
   */
  constructor(
    agentId: string,
    redis: RedisClient,
    riskProfile: Partial<RiskProfile> = {},
    marketScope: Partial<MarketScope> = {},
    executionConfig: Partial<ExecutionConfig> = {}
  ) {
    this.agentId = agentId;
    this.redis = redis;
    this.logger = createLogger(`Agent:${agentId}`);
    
    // Merge configurations with defaults
    this.riskProfile = { ...DEFAULT_RISK_PROFILE, ...riskProfile };
    this.marketScope = { ...DEFAULT_MARKET_SCOPE, ...marketScope };
    this.executionConfig = { ...DEFAULT_EXECUTION_CONFIG, ...executionConfig };
    
    // Ensure backward compatibility for canaryMode
    if (this.executionConfig.canaryMode && this.executionConfig.mode === 'live') {
      this.executionConfig.mode = 'canary';
    }
    
    // Initialize daily counters
    this._resetDailyCountersIfNeeded();
  }
  
  /**
   * Get the current lifecycle state
   */
  public get lifecycleState(): AgentLifecycleState {
    return this._lifecycleState;
  }
  
  /**
   * Update the agent's lifecycle state
   */
  public setLifecycleState(state: AgentLifecycleState): void {
    if (this._lifecycleState !== state) {
      this.logger.info(`Agent state changed: ${this._lifecycleState} -> ${state}`);
      this._lifecycleState = state;
      
      // Emit state change event
      this._emitStateChangeEvent(state);
    }
  }
  
  /**
   * Get the agent's metrics
   */
  public get metrics(): AgentMetrics {
    return { ...this._metrics };
  }
  
  /**
   * Update agent metrics
   */
  public updateMetrics(metrics: Partial<AgentMetrics>): void {
    this._metrics = { ...this._metrics, ...metrics };
    
    // Save metrics to Redis
    this._persistMetrics();
  }
  
  /**
   * Check if the agent can trade right now
   * @returns true if the agent can trade, false otherwise
   */
  public canTrade(): boolean {
    // Check agent state
    if (this._lifecycleState !== AgentLifecycleState.RUNNING && 
        this._lifecycleState !== AgentLifecycleState.RISK_REDUCED) {
      return false;
    }
    
    // Check simulation modes - allow trade signal generation even if we won't execute
    if (this.executionConfig.mode === 'canary' || this.executionConfig.mode === 'dry-run' || this.executionConfig.canaryMode) {
      return true; // These modes just simulate or skip execution, so always allowed
    }
    
    // Check time between trades
    const now = Date.now();
    if (now - this._lastTradeTimestamp < this.riskProfile.minTimeBetweenTrades) {
      return false;
    }
    
    // Check daily trade limit
    this._resetDailyCountersIfNeeded();
    if (this._dailyTradeCount >= this.riskProfile.maxDailyTradeCount) {
      return false;
    }
    
    // Check drawdown
    if (this._metrics.currentDrawdownPct > this.riskProfile.maxDrawdownPct) {
      // Set to risk reduced mode
      this.setLifecycleState(AgentLifecycleState.RISK_REDUCED);
      // Still allow trading, but strategy should reduce risk
    }
    
    return true;
  }
  
  /**
   * Check if the agent is in simulation mode (canary or dry-run)
   * @returns true if the agent is in a simulation mode
   */
  public isSimulationMode(): boolean {
    return this.executionConfig.mode === 'canary' || 
           this.executionConfig.mode === 'dry-run' || 
           this.executionConfig.canaryMode;
  }
  
  /**
   * Record a trade execution
   */
  public recordTrade(): void {
    this._lastTradeTimestamp = Date.now();
    this._dailyTradeCount++;
    this._metrics.tradeCount++;
    
    // Persist to Redis
    this._persistTradeStats();
  }
  
  /**
   * Load agent state from Redis
   */
  public async loadState(): Promise<void> {
    try {
      // Load metrics
      const metricsKey = `agent:${this.agentId}:metrics`;
      const metricsData = await this.redis.get(metricsKey);
      
      if (metricsData) {
        this._metrics = JSON.parse(metricsData);
      }
      
      // Load trade stats
      const statsKey = `agent:${this.agentId}:trade_stats`;
      const statsData = await this.redis.get(statsKey);
      
      if (statsData) {
        const stats = JSON.parse(statsData);
        this._lastTradeTimestamp = stats.lastTradeTimestamp || 0;
        this._dailyTradeCount = stats.dailyTradeCount || 0;
        this._lastResetDate = stats.lastResetDate || '';
      }
      
      // Load lifecycle state
      const stateKey = `agent:${this.agentId}:state`;
      const stateData = await this.redis.get(stateKey);
      
      if (stateData) {
        this._lifecycleState = stateData as AgentLifecycleState;
      }
      
      this.logger.info(`Loaded agent state from Redis: ${this._lifecycleState}`);
    } catch (error) {
      this.logger.error(`Failed to load agent state: ${error}`);
    }
  }
  
  /**
   * Reset daily counters if needed
   */
  private _resetDailyCountersIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    
    if (this._lastResetDate !== today) {
      this._dailyTradeCount = 0;
      this._lastResetDate = today;
    }
  }
  
  /**
   * Persist metrics to Redis
   */
  private _persistMetrics(): void {
    const metricsKey = `agent:${this.agentId}:metrics`;
    
    this.redis.set(metricsKey, JSON.stringify(this._metrics))
      .catch(error => this.logger.error(`Failed to persist metrics: ${error}`));
  }
  
  /**
   * Persist trade stats to Redis
   */
  private _persistTradeStats(): void {
    const statsKey = `agent:${this.agentId}:trade_stats`;
    const stats = {
      lastTradeTimestamp: this._lastTradeTimestamp,
      dailyTradeCount: this._dailyTradeCount,
      lastResetDate: this._lastResetDate
    };
    
    this.redis.set(statsKey, JSON.stringify(stats))
      .catch(error => this.logger.error(`Failed to persist trade stats: ${error}`));
  }
  
  /**
   * Emit a state change event
   */
  private _emitStateChangeEvent(state: AgentLifecycleState): void {
    const stateKey = `agent:${this.agentId}:state`;
    
    // Update state in Redis
    this.redis.set(stateKey, state)
      .catch(error => this.logger.error(`Failed to persist state: ${error}`));
    
    // Log state change to Redis stream
    const streamKey = `agent_events:${this.agentId}`;
    
    this.redis.xadd(
      streamKey,
      '*',
      {
        type: 'state_change',
        old_state: this._lifecycleState,
        new_state: state,
        timestamp: Date.now().toString()
      }
    ).catch(error => this.logger.error(`Failed to emit state change event: ${error}`));
  }
} 