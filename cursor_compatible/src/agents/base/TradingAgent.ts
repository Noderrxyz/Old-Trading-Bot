/**
 * Trading Agent
 * 
 * Abstract base class for all trading agents in the Noderr system.
 * Defines the common interface and functionality for agents.
 */

import { AgentContext, AgentLifecycleState, RiskProfile, MarketScope, ExecutionConfig } from './AgentContext.js';
import { RedisClient } from '../../common/redis.js';

/**
 * Base signal interface for agents
 */
export interface Signal {
  // Asset pair (e.g., "BTC/USD")
  asset: string;
  
  // Signal strength: -1.0 to 1.0 (negative = sell, positive = buy)
  strength: number;
  
  // Confidence score (0.0 to 1.0)
  confidence: number;
  
  // Signal source or strategy id
  source: string;
  
  // Signal timestamp
  timestamp: number;
  
  // Optional target position size (0.0 to 1.0 representing % of capital)
  targetPositionSize?: number;
  
  // Optional signal duration in ms
  expectedDurationMs?: number;
  
  // Optional expected return
  expectedReturn?: number;
  
  // Optional metadata
  metadata?: Record<string, any>;
}

/**
 * Order interface for agent execution
 */
export interface Order {
  // Order ID
  id: string;
  
  // Agent ID that generated this order
  agentId: string;
  
  // Asset pair
  asset: string;
  
  // Side: buy or sell
  side: 'buy' | 'sell';
  
  // Type: market, limit, etc.
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'adaptive';
  
  // Amount to buy/sell
  amount: number;
  
  // Price (for limit orders)
  price?: number;
  
  // Stop price (for stop orders)
  stopPrice?: number;
  
  // Order timeInForce: GTC, IOC, FOK
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  
  // Max slippage in basis points
  maxSlippageBps?: number;
  
  // Time-to-live in ms
  ttlMs?: number;
  
  // Whether order can be partially filled
  allowPartial?: boolean;
  
  // Signal that generated this order
  sourceSignal: Signal;
  
  // Order tags
  tags?: string[];
  
  // Order timestamp
  timestamp: number;
}

/**
 * Position interface
 */
export interface Position {
  // Asset pair
  asset: string;
  
  // Position size
  size: number;
  
  // Entry price
  entryPrice: number;
  
  // Current price
  currentPrice: number;
  
  // Position PnL
  pnl: number;
  
  // Unrealized PnL %
  pnlPct: number;
  
  // Position open timestamp
  openTimestamp: number;
  
  // Source tags
  tags: string[];
}

/**
 * Market data needed by agents
 */
export interface MarketData {
  // Asset pair
  asset: string;
  
  // Current price data
  price: {
    bid: number;
    ask: number;
    last: number;
    mid: number;
  };
  
  // 24h stats
  stats: {
    volume: number;
    volumeUsd: number;
    high: number;
    low: number;
    priceChange: number;
    priceChangePct: number;
  };
  
  // Liquidity indicators
  liquidity: {
    bps10: number; // Depth within 0.1%
    bps50: number; // Depth within 0.5%
    bps100: number; // Depth within 1.0%
  };
  
  // Volatility indicators
  volatility: {
    hourly: number;
    daily: number;
  };
  
  // Timestamp
  timestamp: number;
}

/**
 * Agent initialization options
 */
export interface AgentInitOptions {
  // Agent ID
  agentId: string;
  
  // Redis client
  redis: RedisClient;
  
  // Risk profile
  riskProfile?: Partial<RiskProfile>;
  
  // Market scope
  marketScope?: Partial<MarketScope>;
  
  // Execution config
  executionConfig?: Partial<ExecutionConfig>;
  
  // Initial state
  initialState?: AgentLifecycleState;
  
  // Strategy model or specific config
  strategyModel?: any;
  
  // Signal source to use
  signalSource?: string;
}

/**
 * Abstract base class for all trading agents
 */
export abstract class TradingAgent {
  // Agent context
  protected context: AgentContext;
  
  // Current positions
  protected positions: Map<string, Position> = new Map();
  
  // Strategy model (implementation-specific)
  protected strategyModel: any;
  
  // Signal source
  protected signalSource: string;
  
  /**
   * Create a new trading agent
   */
  constructor(options: AgentInitOptions) {
    // Create agent context
    this.context = new AgentContext(
      options.agentId,
      options.redis,
      options.riskProfile,
      options.marketScope,
      options.executionConfig
    );
    
    // Store strategy model (implementation-specific)
    this.strategyModel = options.strategyModel;
    
    // Store signal source
    this.signalSource = options.signalSource || 'internal';
    
    // Set initial state if specified
    if (options.initialState) {
      this.context.setLifecycleState(options.initialState);
    }
  }
  
  /**
   * Initialize the agent
   * This should be called before using the agent
   */
  public async initialize(): Promise<void> {
    // Load agent state from Redis
    await this.context.loadState();
    
    // Load positions
    await this.loadPositions();
    
    // Set to running state after initialization
    if (this.context.lifecycleState === AgentLifecycleState.INITIALIZING) {
      this.context.setLifecycleState(AgentLifecycleState.RUNNING);
    }
    
    this.context.logger.info(`Agent ${this.context.agentId} initialized`);
  }
  
  /**
   * Process incoming data update
   * @param marketData Current market data
   */
  public abstract processUpdate(marketData: MarketData): Promise<void>;
  
  /**
   * Generate trading signal
   * Each agent implementation should provide its own signal generation logic
   * @param marketData Current market data
   */
  protected abstract generateSignal(marketData: MarketData): Promise<Signal | null>;
  
  /**
   * Process a trading signal and potentially create an order
   * @param signal The signal to process
   * @param marketData Current market data
   */
  protected abstract processSignal(signal: Signal, marketData: MarketData): Promise<Order | null>;
  
  /**
   * Load current positions from storage
   */
  protected async loadPositions(): Promise<void> {
    try {
      const positionsKey = `agent:${this.context.agentId}:positions`;
      const positionsData = await this.context.redis.get(positionsKey);
      
      if (positionsData) {
        const positions = JSON.parse(positionsData);
        
        // Convert to Map
        this.positions = new Map();
        for (const [asset, position] of Object.entries(positions)) {
          this.positions.set(asset, position as Position);
        }
        
        this.context.logger.info(`Loaded ${this.positions.size} positions from Redis`);
      }
    } catch (error) {
      this.context.logger.error(`Failed to load positions: ${error}`);
    }
  }
  
  /**
   * Save positions to storage
   */
  protected async savePositions(): Promise<void> {
    try {
      const positionsKey = `agent:${this.context.agentId}:positions`;
      
      // Convert Map to Object
      const positions: Record<string, Position> = {};
      for (const [asset, position] of this.positions.entries()) {
        positions[asset] = position;
      }
      
      await this.context.redis.set(positionsKey, JSON.stringify(positions));
    } catch (error) {
      this.context.logger.error(`Failed to save positions: ${error}`);
    }
  }
  
  /**
   * Update position data with current market prices
   * @param marketData Current market data
   */
  protected updatePositions(marketData: MarketData): void {
    const position = this.positions.get(marketData.asset);
    
    if (position) {
      // Update current price
      position.currentPrice = marketData.price.mid;
      
      // Calculate PnL
      if (position.size > 0) {
        // Long position
        position.pnl = (position.currentPrice - position.entryPrice) * position.size;
        position.pnlPct = (position.currentPrice / position.entryPrice - 1) * 100;
      } else if (position.size < 0) {
        // Short position
        position.pnl = (position.entryPrice - position.currentPrice) * Math.abs(position.size);
        position.pnlPct = (position.entryPrice / position.currentPrice - 1) * 100;
      }
      
      // Update map
      this.positions.set(marketData.asset, position);
    }
  }
  
  /**
   * Add a new position
   * @param order The executed order
   * @param fillPrice The price at which the order was filled
   */
  protected addPosition(order: Order, fillPrice: number): void {
    const now = Date.now();
    
    // Create new position
    const position: Position = {
      asset: order.asset,
      size: order.side === 'buy' ? order.amount : -order.amount,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      pnl: 0,
      pnlPct: 0,
      openTimestamp: now,
      tags: order.tags || []
    };
    
    // Add to positions
    this.positions.set(order.asset, position);
    
    // Save to Redis
    this.savePositions();
    
    this.context.logger.info(
      `Added position: ${order.asset} ${position.size > 0 ? 'LONG' : 'SHORT'} ` +
      `${Math.abs(position.size)} @ ${position.entryPrice}`
    );
  }
  
  /**
   * Update an existing position after a partial fill
   * @param order The executed order
   * @param fillPrice The price at which the order was filled
   * @param fillAmount The amount that was filled
   */
  protected updatePosition(order: Order, fillPrice: number, fillAmount: number): void {
    const position = this.positions.get(order.asset);
    
    if (!position) {
      // If position doesn't exist, create it
      this.addPosition({ ...order, amount: fillAmount }, fillPrice);
      return;
    }
    
    // Calculate new position
    const oldSize = position.size;
    const orderSize = order.side === 'buy' ? fillAmount : -fillAmount;
    
    // If position direction is changing, close old position and open new
    if ((position.size > 0 && orderSize < 0 && Math.abs(orderSize) >= Math.abs(position.size)) ||
        (position.size < 0 && orderSize > 0 && Math.abs(orderSize) >= Math.abs(position.size))) {
      
      // Close old position and create new one
      this.closePosition(order.asset);
      this.addPosition({ ...order, amount: Math.abs(orderSize) - Math.abs(position.size) }, fillPrice);
      return;
    }
    
    // Update existing position with weighted average price
    const newSize = position.size + orderSize;
    const newEntryPrice = (position.entryPrice * Math.abs(position.size) + fillPrice * Math.abs(orderSize)) /
                         (Math.abs(position.size) + Math.abs(orderSize));
    
    position.size = newSize;
    position.entryPrice = newEntryPrice;
    position.currentPrice = fillPrice;
    
    // Calculate PnL
    if (position.size > 0) {
      position.pnl = (position.currentPrice - position.entryPrice) * position.size;
      position.pnlPct = (position.currentPrice / position.entryPrice - 1) * 100;
    } else if (position.size < 0) {
      position.pnl = (position.entryPrice - position.currentPrice) * Math.abs(position.size);
      position.pnlPct = (position.entryPrice / position.currentPrice - 1) * 100;
    }
    
    // Update map
    this.positions.set(order.asset, position);
    
    // Save to Redis
    this.savePositions();
    
    this.context.logger.info(
      `Updated position: ${order.asset} ${oldSize > 0 ? 'LONG' : 'SHORT'} ${Math.abs(oldSize)} -> ` +
      `${position.size > 0 ? 'LONG' : 'SHORT'} ${Math.abs(position.size)} @ ${position.entryPrice}`
    );
  }
  
  /**
   * Close a position
   * @param asset Asset pair to close
   */
  protected closePosition(asset: string): void {
    const position = this.positions.get(asset);
    
    if (position) {
      // Calculate final PnL
      const finalPnl = position.pnl;
      const finalPnlPct = position.pnlPct;
      
      // Remove from positions
      this.positions.delete(asset);
      
      // Save to Redis
      this.savePositions();
      
      // Log position close
      this.context.logger.info(
        `Closed position: ${asset} ${position.size > 0 ? 'LONG' : 'SHORT'} ${Math.abs(position.size)} ` +
        `@ ${position.currentPrice} (PnL: ${finalPnl.toFixed(2)} USD, ${finalPnlPct.toFixed(2)}%)`
      );
      
      // Record in position history
      this.recordPositionHistory(position, finalPnl, finalPnlPct);
    }
  }
  
  /**
   * Record closed position in history
   * @param position The closed position
   * @param finalPnl Final PnL in USD
   * @param finalPnlPct Final PnL in percent
   */
  protected async recordPositionHistory(position: Position, finalPnl: number, finalPnlPct: number): Promise<void> {
    try {
      const historyKey = `agent:${this.context.agentId}:position_history`;
      
      const historyEntry = {
        asset: position.asset,
        size: position.size,
        entryPrice: position.entryPrice,
        exitPrice: position.currentPrice,
        openTimestamp: position.openTimestamp,
        closeTimestamp: Date.now(),
        durationMs: Date.now() - position.openTimestamp,
        pnl: finalPnl,
        pnlPct: finalPnlPct,
        tags: position.tags
      };
      
      // Add to Redis list
      await this.context.redis.lpush(historyKey, JSON.stringify(historyEntry));
      
      // Trim list to reasonable size (keep last 100)
      await this.context.redis.ltrim(historyKey, 0, 99);
      
      // Update metrics
      this.updateMetricsFromTrade(historyEntry);
      
      // Update trade counter
      this.context.recordTrade();
    } catch (error) {
      this.context.logger.error(`Failed to record position history: ${error}`);
    }
  }
  
  /**
   * Update agent metrics based on trade result
   * @param trade The closed trade
   */
  protected updateMetricsFromTrade(trade: any): void {
    // Get current metrics
    const metrics = this.context.metrics;
    
    // Update PnL
    metrics.pnl += trade.pnl;
    
    // Update win rate
    const isWin = trade.pnl > 0;
    const totalTrades = metrics.tradeCount + 1;
    const winCount = isWin ? (metrics.winRate * metrics.tradeCount / 100) + 1 : (metrics.winRate * metrics.tradeCount / 100);
    metrics.winRate = (winCount / totalTrades) * 100;
    
    // Update average holding period
    const totalHoldingTime = (metrics.avgHoldingPeriodMs * metrics.tradeCount) + trade.durationMs;
    metrics.avgHoldingPeriodMs = totalHoldingTime / totalTrades;
    
    // Update metrics
    this.context.updateMetrics(metrics);
  }
  
  /**
   * Submit an order to the execution service
   * This should be implemented by a concrete child class
   * @param order The order to submit
   */
  protected abstract submitOrder(order: Order): Promise<void>;
  
  /**
   * Get the current portfolio exposure
   * @returns Percentage of portfolio exposed (0-100)
   */
  protected getPortfolioExposure(): number {
    let totalExposure = 0;
    
    for (const position of this.positions.values()) {
      // Simplified exposure calculation
      // In a real system, this would consider position size relative to portfolio value
      totalExposure += Math.abs(position.size * position.currentPrice) / 100; // Assuming 100 = full portfolio
    }
    
    return Math.min(100, totalExposure);
  }
  
  /**
   * Validate that a trading action respects risk limits
   * @param order Proposed order
   * @returns True if order is within risk limits
   */
  protected validateRiskLimits(order: Order): boolean {
    // Check if agent can trade
    if (!this.context.canTrade()) {
      return false;
    }
    
    // Check leverage limits
    const currentExposure = this.getPortfolioExposure();
    const newExposure = currentExposure + (order.amount * order.price! / 100);
    
    if (newExposure > this.context.riskProfile.maxLeverage * 100) {
      this.context.logger.warn(
        `Order exceeds leverage limit: ${newExposure.toFixed(1)}% > ${(this.context.riskProfile.maxLeverage * 100).toFixed(1)}%`
      );
      return false;
    }
    
    // Check position size limits
    const positionSizePct = (order.amount * order.price! / 100);
    
    if (positionSizePct > this.context.riskProfile.maxPositionSizePct) {
      this.context.logger.warn(
        `Order exceeds position size limit: ${positionSizePct.toFixed(1)}% > ${this.context.riskProfile.maxPositionSizePct.toFixed(1)}%`
      );
      return false;
    }
    
    // Check short selling permission
    if (order.side === 'sell' && !this.context.riskProfile.allowShort) {
      // Check if this is closing an existing position
      const position = this.positions.get(order.asset);
      
      if (!position || position.size < order.amount) {
        this.context.logger.warn('Short selling not allowed for this agent');
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Pause the agent
   */
  public pause(): void {
    if (this.context.lifecycleState === AgentLifecycleState.RUNNING) {
      this.context.setLifecycleState(AgentLifecycleState.PAUSED);
    }
  }
  
  /**
   * Resume the agent
   */
  public resume(): void {
    if (this.context.lifecycleState === AgentLifecycleState.PAUSED) {
      this.context.setLifecycleState(AgentLifecycleState.RUNNING);
    }
  }
  
  /**
   * Disable the agent
   */
  public disable(): void {
    this.context.setLifecycleState(AgentLifecycleState.DISABLED);
  }
  
  /**
   * Get agent ID
   */
  public get agentId(): string {
    return this.context.agentId;
  }
  
  /**
   * Get agent state
   */
  public get state(): AgentLifecycleState {
    return this.context.lifecycleState;
  }
  
  /**
   * Get agent metrics
   */
  public get agentMetrics(): Record<string, any> {
    return {
      ...this.context.metrics,
      exposurePct: this.getPortfolioExposure(),
      positionCount: this.positions.size
    };
  }
} 