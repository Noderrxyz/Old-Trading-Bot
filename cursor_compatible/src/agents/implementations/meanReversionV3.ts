/**
 * Mean Reversion V3 Agent
 * 
 * A trading agent that implements a sophisticated mean reversion strategy.
 * It looks for price deviations from a moving average and trades to profit
 * from the expected reversion to the mean.
 */

import { TradingAgent, MarketData, Signal, Order } from '../base/TradingAgent.js';
import { AgentInitOptions } from '../base/TradingAgent.js';
import { createLogger } from '../../common/logger.js';

// Mock UUID implementation
const uuidv4 = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Mean reversion agent configuration
 */
export interface MeanReversionConfig {
  // Short SMA period
  shortPeriod: number;
  
  // Long SMA period
  longPeriod: number;
  
  // Deviation threshold to trigger entry (in standard deviations)
  entryThreshold: number;
  
  // Deviation threshold to trigger exit (in standard deviations)
  exitThreshold: number;
  
  // Position size as percentage of available capital
  positionSizePercent: number;
  
  // Maximum holding period in milliseconds
  maxHoldingPeriodMs: number;
  
  // Whether to use Bollinger Bands for mean reversion
  useBollingerBands: boolean;
  
  // Bollinger Band multiplier
  bollingerMultiplier: number;
  
  // Stop loss percentage
  stopLossPercent: number;
  
  // Take profit percentage
  takeProfitPercent: number;
  
  // Custom configuration properties
  [key: string]: any;
}

/**
 * Default mean reversion configuration
 */
const DEFAULT_CONFIG: MeanReversionConfig = {
  shortPeriod: 20,
  longPeriod: 50,
  entryThreshold: 2.0,
  exitThreshold: 0.5,
  positionSizePercent: 10,
  maxHoldingPeriodMs: 24 * 60 * 60 * 1000, // 24 hours
  useBollingerBands: true,
  bollingerMultiplier: 2.0,
  stopLossPercent: 2.0,
  takeProfitPercent: 3.0
};

/**
 * Mean reversion agent implementation
 */
export class MeanReversionAgent extends TradingAgent {
  // Agent configuration
  private config: MeanReversionConfig;
  
  // Price history for calculating moving averages
  private priceHistory: Map<string, number[]> = new Map();
  
  // Latest calculated signals
  private latestSignals: Map<string, Signal> = new Map();
  
  // Timestamp of last price update
  private lastUpdateTime: Map<string, number> = new Map();
  
  // Entry prices for active positions
  private entryPrices: Map<string, number> = new Map();
  
  // Entry times for active positions
  private entryTimes: Map<string, number> = new Map();
  
  /**
   * Create a new mean reversion agent
   */
  constructor(options: AgentInitOptions) {
    super(options);
    
    // Parse configuration
    this.config = {
      ...DEFAULT_CONFIG,
      ...(options.strategyModel || {})
    };
    
    // Initialize with logger
    this.context.logger.info(`Created mean reversion agent with periods: ${this.config.shortPeriod}/${this.config.longPeriod}`);
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
        // In a real implementation, this would submit to an execution service
        // For this example, we'll just log it
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
    
    // Keep only what we need for the longer period
    const maxLength = Math.max(this.config.longPeriod, this.config.shortPeriod) * 3;
    if (history.length > maxLength) {
      this.priceHistory.set(asset, history.slice(-maxLength));
    }
    
    // Update last update time
    this.lastUpdateTime.set(asset, marketData.timestamp);
  }
  
  /**
   * Generate a trading signal based on market data
   */
  protected async generateSignal(marketData: MarketData): Promise<Signal | null> {
    const { asset } = marketData;
    
    // Get price history
    const history = this.priceHistory.get(asset);
    if (!history || history.length < this.config.longPeriod) {
      // Not enough history yet
      return null;
    }
    
    // Calculate short and long period moving averages
    const shortSMA = this.calculateSMA(history, this.config.shortPeriod);
    const longSMA = this.calculateSMA(history, this.config.longPeriod);
    
    // Calculate standard deviation for Bollinger Bands
    const stdDev = this.calculateStandardDeviation(history, this.config.shortPeriod);
    
    // Current price
    const currentPrice = marketData.price.mid;
    
    // Calculate upper and lower Bollinger Bands
    const upperBand = shortSMA + (stdDev * this.config.bollingerMultiplier);
    const lowerBand = shortSMA - (stdDev * this.config.bollingerMultiplier);
    
    // Determine deviation from mean (in standard deviations)
    const deviationFromMean = (currentPrice - shortSMA) / stdDev;
    
    // Create base signal
    const signal: Signal = {
      asset,
      strength: 0,
      confidence: 0,
      source: this.signalSource,
      timestamp: marketData.timestamp,
      metadata: {
        shortSMA,
        longSMA,
        currentPrice,
        upperBand,
        lowerBand,
        stdDev,
        deviationFromMean
      }
    };
    
    // Check for mean reversion conditions
    const currentPosition = this.positions.get(asset);
    
    if (!currentPosition) {
      // No position - check for entry signal
      if (this.config.useBollingerBands) {
        // Using Bollinger Bands for entry
        if (currentPrice <= lowerBand) {
          // Price below lower band - buy signal
          signal.strength = 1.0;
          signal.confidence = Math.min(1.0, Math.abs(deviationFromMean) / this.config.entryThreshold);
        } else if (currentPrice >= upperBand) {
          // Price above upper band - sell signal (if short allowed)
          if (this.context.riskProfile.allowShort) {
            signal.strength = -1.0;
            signal.confidence = Math.min(1.0, Math.abs(deviationFromMean) / this.config.entryThreshold);
          }
        }
      } else {
        // Using standard deviation threshold
        if (deviationFromMean <= -this.config.entryThreshold) {
          // Price significantly below mean - buy signal
          signal.strength = 1.0;
          signal.confidence = Math.min(1.0, Math.abs(deviationFromMean) / this.config.entryThreshold);
        } else if (deviationFromMean >= this.config.entryThreshold) {
          // Price significantly above mean - sell signal (if short allowed)
          if (this.context.riskProfile.allowShort) {
            signal.strength = -1.0;
            signal.confidence = Math.min(1.0, Math.abs(deviationFromMean) / this.config.entryThreshold);
          }
        }
      }
    } else {
      // Existing position - check for exit signal
      if (currentPosition.size > 0) {
        // Long position - exit if price reverts to mean or higher
        if (deviationFromMean >= this.config.exitThreshold) {
          signal.strength = -1.0;
          signal.confidence = 0.8;
        }
      } else if (currentPosition.size < 0) {
        // Short position - exit if price reverts to mean or lower
        if (deviationFromMean <= -this.config.exitThreshold) {
          signal.strength = 1.0;
          signal.confidence = 0.8;
        }
      }
      
      // Also check stop loss or take profit
      if (currentPosition.size > 0) {
        // Long position
        const pnlPct = ((currentPrice / currentPosition.entryPrice) - 1) * 100;
        
        if (pnlPct <= -this.config.stopLossPercent) {
          // Stop loss hit - exit
          signal.strength = -1.0;
          signal.confidence = 1.0;
        } else if (pnlPct >= this.config.takeProfitPercent) {
          // Take profit hit - exit
          signal.strength = -1.0;
          signal.confidence = 1.0;
        }
      } else if (currentPosition.size < 0) {
        // Short position
        const pnlPct = ((currentPosition.entryPrice / currentPrice) - 1) * 100;
        
        if (pnlPct <= -this.config.stopLossPercent) {
          // Stop loss hit - exit
          signal.strength = 1.0;
          signal.confidence = 1.0;
        } else if (pnlPct >= this.config.takeProfitPercent) {
          // Take profit hit - exit
          signal.strength = 1.0;
          signal.confidence = 1.0;
        }
      }
      
      // Check max holding period
      const entryTime = this.entryTimes.get(asset);
      if (entryTime && marketData.timestamp - entryTime >= this.config.maxHoldingPeriodMs) {
        // Max holding period reached - exit
        signal.strength = currentPosition.size > 0 ? -1.0 : 1.0;
        signal.confidence = 0.9;
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
      tags: ['mean_reversion', `confidence_${Math.round(signal.confidence * 10)}`],
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
      tags: ['mean_reversion', 'exit', reason],
      timestamp: Date.now()
    };
    
    this.context.logger.info(
      `Exiting position ${asset} (${reason}): ${order.side} ${order.amount} @ MARKET`
    );
    
    // Submit order
    await this.submitOrder(order);
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
   * Calculate standard deviation for a given period
   */
  private calculateStandardDeviation(data: number[], period: number): number {
    if (data.length < period) {
      return 0;
    }
    
    const slice = data.slice(-period);
    const mean = slice.reduce((sum, value) => sum + value, 0) / period;
    
    const squaredDiffs = slice.map(value => Math.pow(value - mean, 2));
    const variance = squaredDiffs.reduce((sum, value) => sum + value, 0) / period;
    
    return Math.sqrt(variance);
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
 * Mean Reversion Agent Factory
 */
export class MeanReversionAgentFactory {
  /**
   * Create a new mean reversion agent
   */
  public async createAgent(agentId: string, config: any): Promise<TradingAgent> {
    return new MeanReversionAgent({
      agentId,
      redis: null as any, // This would be injected by the AgentEngine
      strategyModel: config
    });
  }
  
  /**
   * Get agent type
   */
  public getAgentType(): string {
    return 'mean_reversion_v3';
  }
} 