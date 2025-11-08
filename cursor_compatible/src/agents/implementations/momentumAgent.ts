/**
 * Momentum Trading Agent
 * 
 * A trading agent that implements a momentum strategy.
 * It buys when price trends up and sells when price trends down.
 */

import { TradingAgent, MarketData, Signal, Order } from '../base/TradingAgent.js';
import { AgentInitOptions } from '../base/TradingAgent.js';
import { createLogger } from '../../common/logger.js';

// UUID implementation
const uuidv4 = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Momentum agent configuration
 */
export interface MomentumConfig {
  // EMA period for trend detection
  emaPeriod: number;
  
  // ROC (Rate of Change) period
  rocPeriod: number;
  
  // Momentum threshold to trigger entry (percentage)
  entryThreshold: number;
  
  // Momentum threshold to trigger exit (percentage)
  exitThreshold: number;
  
  // Position size as percentage of available capital
  positionSizePercent: number;
  
  // Stop loss percentage
  stopLossPercent: number;
  
  // Take profit percentage
  takeProfitPercent: number;
  
  // Maximum holding period in milliseconds
  maxHoldingPeriodMs: number;
  
  // Custom configuration properties
  [key: string]: any;
}

/**
 * Default momentum configuration
 */
const DEFAULT_CONFIG: MomentumConfig = {
  emaPeriod: 20,
  rocPeriod: 10,
  entryThreshold: 1.0,  // 1% change to enter
  exitThreshold: 0.5,   // 0.5% change to exit
  positionSizePercent: 10,
  stopLossPercent: 2.0,
  takeProfitPercent: 5.0,
  maxHoldingPeriodMs: 7 * 24 * 60 * 60 * 1000 // 7 days
};

/**
 * Momentum agent implementation
 */
export class MomentumAgent extends TradingAgent {
  // Agent configuration
  private config: MomentumConfig;
  
  // Price history for calculating indicators
  private priceHistory: Map<string, number[]> = new Map();
  
  // EMA values
  private emaValues: Map<string, number> = new Map();
  
  // Latest calculated signals
  private latestSignals: Map<string, Signal> = new Map();
  
  // Entry prices for active positions
  private entryPrices: Map<string, number> = new Map();
  
  // Entry times for active positions
  private entryTimes: Map<string, number> = new Map();
  
  /**
   * Create a new momentum agent
   */
  constructor(options: AgentInitOptions) {
    super(options);
    
    // Parse configuration
    this.config = {
      ...DEFAULT_CONFIG,
      ...(options.strategyModel || {})
    };
    
    // Initialize with logger
    this.context.logger.info(`Created momentum agent with EMA period: ${this.config.emaPeriod}, ROC period: ${this.config.rocPeriod}`);
  }
  
  /**
   * Process market data update
   */
  public async processUpdate(marketData: MarketData): Promise<void> {
    // Update positions with current prices
    this.updatePositions(marketData);
    
    // Update price history
    this.updatePriceHistory(marketData);
    
    // Check for exit signals on existing positions
    await this.checkExitSignals(marketData);
    
    // Generate signal
    const signal = await this.generateSignal(marketData);
    
    // Process signal if present
    if (signal) {
      this.latestSignals.set(marketData.asset, signal);
      
      // Create order if appropriate
      const order = await this.processSignal(signal, marketData);
      
      if (order) {
        // Log the generated order
        this.context.logger.info(
          `Generated order: ${order.side} ${order.amount} ${order.asset} @ ${order.price || 'MARKET'}`
        );
        
        // Submit order to get executed
        await this.submitOrder(order);
      }
    }
  }
  
  /**
   * Update price history with new data
   */
  private updatePriceHistory(marketData: MarketData): void {
    const { asset } = marketData;
    const price = marketData.price.mid;
    
    // Initialize if not exists
    if (!this.priceHistory.has(asset)) {
      this.priceHistory.set(asset, []);
    }
    
    const history = this.priceHistory.get(asset)!;
    
    // Add new price
    history.push(price);
    
    // Keep only what we need
    const maxLength = Math.max(this.config.emaPeriod, this.config.rocPeriod) * 3;
    if (history.length > maxLength) {
      this.priceHistory.set(asset, history.slice(-maxLength));
    }
  }
  
  /**
   * Generate a trading signal based on market data
   */
  protected async generateSignal(marketData: MarketData): Promise<Signal | null> {
    const { asset } = marketData;
    
    // Get price history
    const history = this.priceHistory.get(asset);
    if (!history || history.length < Math.max(this.config.emaPeriod, this.config.rocPeriod)) {
      // Not enough history yet
      return null;
    }
    
    // Current price
    const currentPrice = marketData.price.mid;
    
    // Calculate EMA
    const ema = this.calculateEMA(history, this.config.emaPeriod);
    
    // Calculate ROC (Rate of Change)
    const rocPeriod = this.config.rocPeriod;
    const priceNow = history[history.length - 1];
    const priceThen = history.length > rocPeriod ? history[history.length - 1 - rocPeriod] : history[0];
    const roc = ((priceNow - priceThen) / priceThen) * 100;
    
    // Price position relative to EMA
    const priceVsEma = ((currentPrice / ema) - 1) * 100; // percentage above/below EMA
    
    // Create base signal
    const signal: Signal = {
      asset,
      strength: 0,
      confidence: 0,
      source: this.signalSource,
      timestamp: marketData.timestamp,
      metadata: {
        ema,
        currentPrice,
        roc,
        priceVsEma
      }
    };
    
    // Check for momentum signals
    const currentPosition = this.positions.get(asset);
    
    if (!currentPosition) {
      // No position - check for entry
      if (roc > this.config.entryThreshold && priceVsEma > 0) {
        // Uptrend - buy signal
        signal.strength = 1.0;
        signal.confidence = Math.min(1.0, roc / (this.config.entryThreshold * 3));
      } else if (roc < -this.config.entryThreshold && priceVsEma < 0 && this.context.riskProfile.allowShort) {
        // Downtrend - sell signal (if short allowed)
        signal.strength = -1.0;
        signal.confidence = Math.min(1.0, Math.abs(roc) / (this.config.entryThreshold * 3));
      }
    } else {
      // Existing position - check for exit signal
      if (currentPosition.size > 0) {
        // Long position - exit if momentum turns negative
        if (roc < -this.config.exitThreshold || priceVsEma < -this.config.exitThreshold) {
          signal.strength = -1.0;
          signal.confidence = 0.8;
        }
      } else if (currentPosition.size < 0) {
        // Short position - exit if momentum turns positive
        if (roc > this.config.exitThreshold || priceVsEma > this.config.exitThreshold) {
          signal.strength = 1.0;
          signal.confidence = 0.8;
        }
      }
    }
    
    // Return signal if actionable, otherwise null
    if (Math.abs(signal.strength) > 0.1 && signal.confidence > 0.2) {
      return signal;
    }
    
    return null;
  }
  
  /**
   * Process a trading signal to create an order
   */
  protected async processSignal(signal: Signal, marketData: MarketData): Promise<Order | null> {
    // Check if we can trade
    if (!this.context.canTrade()) {
      return null;
    }
    
    const { asset } = signal;
    const currentPosition = this.positions.get(asset);
    
    // Determine side
    let side: 'buy' | 'sell';
    if (signal.strength > 0) {
      side = 'buy';
    } else {
      side = 'sell';
    }
    
    // Check if signal is for closing existing position
    const isCloseSignal = currentPosition && 
      ((currentPosition.size > 0 && side === 'sell') || 
       (currentPosition.size < 0 && side === 'buy'));
    
    // Determine amount
    let amount: number;
    
    if (isCloseSignal) {
      // Close existing position
      amount = Math.abs(currentPosition!.size);
    } else {
      // New position or adding to existing
      // Calculate position size based on config
      amount = this.calculatePositionSize(marketData, this.config.positionSizePercent);
      
      // If adding to existing position, check risk limits
      if (currentPosition && 
          ((currentPosition.size > 0 && side === 'buy') || 
           (currentPosition.size < 0 && side === 'sell'))) {
        // Adding to existing position - check if it exceeds max position size
        const totalSize = Math.abs(currentPosition.size) + amount;
        const maxSize = this.calculatePositionSize(marketData, this.context.riskProfile.maxPositionSizePct);
        
        if (totalSize > maxSize) {
          // Cap at max size
          amount = Math.max(0, maxSize - Math.abs(currentPosition.size));
          
          if (amount <= 0) {
            // Already at or exceeding max size
            return null;
          }
        }
      }
    }
    
    // Create order
    const order: Order = {
      id: uuidv4(),
      agentId: this.context.agentId,
      asset,
      side,
      type: this.context.executionConfig.defaultOrderType,
      amount,
      price: marketData.price.mid,
      maxSlippageBps: this.context.executionConfig.maxSlippageBps,
      ttlMs: this.context.executionConfig.orderTtlMs,
      allowPartial: true,
      sourceSignal: signal,
      tags: ['momentum', `confidence_${Math.round(signal.confidence * 10)}`],
      timestamp: Date.now()
    };
    
    // Validate against risk limits
    if (!this.validateRiskLimits(order)) {
      return null;
    }
    
    return order;
  }
  
  /**
   * Check for exit signals based on stop loss, take profit, or max holding time
   */
  private async checkExitSignals(marketData: MarketData): Promise<void> {
    const { asset } = marketData;
    const currentPosition = this.positions.get(asset);
    
    if (!currentPosition) {
      return;
    }
    
    // Check stop loss and take profit
    const currentPrice = marketData.price.mid;
    
    if (currentPosition.size > 0) {
      // Long position
      const pnlPct = ((currentPrice / currentPosition.entryPrice) - 1) * 100;
      
      if (pnlPct <= -this.config.stopLossPercent) {
        // Stop loss hit - exit
        await this.exitPosition(marketData, 'stop_loss');
      } else if (pnlPct >= this.config.takeProfitPercent) {
        // Take profit hit - exit
        await this.exitPosition(marketData, 'take_profit');
      }
    } else if (currentPosition.size < 0) {
      // Short position
      const pnlPct = ((currentPosition.entryPrice / currentPrice) - 1) * 100;
      
      if (pnlPct <= -this.config.stopLossPercent) {
        // Stop loss hit - exit
        await this.exitPosition(marketData, 'stop_loss');
      } else if (pnlPct >= this.config.takeProfitPercent) {
        // Take profit hit - exit
        await this.exitPosition(marketData, 'take_profit');
      }
    }
    
    // Check max holding period
    const entryTime = this.entryTimes.get(asset);
    if (entryTime && marketData.timestamp - entryTime >= this.config.maxHoldingPeriodMs) {
      // Max holding period reached - exit
      await this.exitPosition(marketData, 'max_holding_time');
    }
  }
  
  /**
   * Exit a position with reason
   */
  private async exitPosition(marketData: MarketData, reason: string): Promise<void> {
    const { asset } = marketData;
    const currentPosition = this.positions.get(asset);
    
    if (!currentPosition) {
      return;
    }
    
    // Create exit signal
    const signal: Signal = {
      asset,
      strength: currentPosition.size > 0 ? -1.0 : 1.0, // Opposite direction of position
      confidence: 1.0,
      source: this.signalSource,
      timestamp: marketData.timestamp,
      metadata: {
        reason,
        positionSize: currentPosition.size,
        entryPrice: currentPosition.entryPrice,
        currentPrice: marketData.price.mid,
        pnl: currentPosition.pnl,
        pnlPct: currentPosition.pnlPct
      }
    };
    
    // Create order
    const order: Order = {
      id: uuidv4(),
      agentId: this.context.agentId,
      asset,
      side: currentPosition.size > 0 ? 'sell' : 'buy',
      type: 'market', // Use market for exits
      amount: Math.abs(currentPosition.size),
      maxSlippageBps: this.context.executionConfig.maxSlippageBps * 2, // Double slippage tolerance for exits
      ttlMs: this.context.executionConfig.orderTtlMs,
      allowPartial: true,
      sourceSignal: signal,
      tags: ['momentum', 'exit', reason],
      timestamp: Date.now()
    };
    
    this.context.logger.info(
      `Exiting position ${asset} (${reason}): ${order.side} ${order.amount} @ MARKET`
    );
    
    // Submit order
    await this.submitOrder(order);
  }
  
  /**
   * Calculate EMA for a given period
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) {
      return data.reduce((sum, value) => sum + value, 0) / data.length;
    }
    
    const k = 2 / (period + 1);
    
    // If first time calculating EMA, use SMA as seed value
    if (!this.emaValues.has(data[0].toString())) {
      const sma = this.calculateSMA(data.slice(0, period), period);
      this.emaValues.set(data[0].toString(), sma);
      return sma;
    }
    
    // Calculate new EMA using previous EMA and current price
    const previousEMA = this.emaValues.get(data[0].toString()) || data[data.length - period];
    const currentPrice = data[data.length - 1];
    const ema = (currentPrice * k) + (previousEMA * (1 - k));
    
    // Store updated EMA value
    this.emaValues.set(data[0].toString(), ema);
    
    return ema;
  }
  
  /**
   * Calculate SMA for a given period
   */
  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) {
      return data.reduce((sum, value) => sum + value, 0) / data.length;
    }
    
    const slice = data.slice(-period);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  }
  
  /**
   * Calculate position size based on percentage of portfolio
   */
  private calculatePositionSize(marketData: MarketData, percentOfPortfolio: number): number {
    // In a real implementation, this would calculate based on portfolio value
    // For this example, we'll use a simplified approach
    
    // Assume portfolio value of 100 units
    const portfolioValue = 100;
    
    // Calculate position size
    const positionValue = portfolioValue * (percentOfPortfolio / 100);
    
    // Convert to quantity based on price
    const quantity = positionValue / marketData.price.mid;
    
    // Round to 4 decimal places
    return Math.round(quantity * 10000) / 10000;
  }
  
  /**
   * Submit an order to the execution service
   */
  protected async submitOrder(order: Order): Promise<void> {
    try {
      // Track entry prices and times for new positions
      if ((order.side === 'buy' && !this.positions.has(order.asset)) ||
          (order.side === 'sell' && this.positions.has(order.asset) && this.positions.get(order.asset)!.size > 0)) {
        // New long position or closing existing long
        this.entryPrices.set(order.asset, order.price || 0);
        this.entryTimes.set(order.asset, Date.now());
      }
      
      // In a real implementation, this would submit to an execution service
      // For example:
      // await this.executionService.submitOrder(order);
      
      // For this example, we'll just log it
      this.context.logger.info(
        `Submitted order: ${order.side} ${order.amount} ${order.asset} @ ${order.price || 'MARKET'}`
      );
      
      // Simulate order execution (this would be done by a real execution service)
      const fillPrice = order.price ? order.price : 0;
      
      if (order.side === 'buy') {
        // Buy order - add position
        if (this.positions.has(order.asset)) {
          // Update existing position
          this.updatePosition(order, fillPrice, order.amount);
        } else {
          // Add new position
          this.addPosition(order, fillPrice);
        }
      } else {
        // Sell order
        if (this.positions.has(order.asset)) {
          const position = this.positions.get(order.asset)!;
          
          if (Math.abs(order.amount - Math.abs(position.size)) < 0.0001) {
            // Close position if amounts match (accounting for rounding errors)
            this.closePosition(order.asset);
          } else {
            // Partial close
            this.updatePosition(order, fillPrice, order.amount);
          }
        } else if (this.context.riskProfile.allowShort) {
          // New short position
          this.addPosition(order, fillPrice);
        }
      }
    } catch (error) {
      this.context.logger.error(`Failed to submit order: ${error}`);
    }
  }
}

/**
 * Momentum Agent Factory
 */
export class MomentumAgentFactory {
  /**
   * Create a new momentum agent
   */
  public async createAgent(agentId: string, config: any): Promise<TradingAgent> {
    return new MomentumAgent({
      agentId,
      redis: null as any, // This would be injected by the AgentEngine
      strategyModel: config
    });
  }
  
  /**
   * Get agent type
   */
  public getAgentType(): string {
    return 'momentum_v1';
  }
} 