/**
 * Strategy Runner - Phase 5: Strategy Engine Integration
 * 
 * Bridges strategy signal generation to paper trading execution via MockExchangeConnector.
 * Provides lifecycle management, signal-to-order translation, and execution feedback.
 * Operates with zero real-world costs in full simulation mode.
 */

import { EventEmitter } from 'events';
import { MockExchangeConnector } from '../adapters/mock/MockExchangeConnector';
import { IDataFeed } from '../adapters/interfaces/IDataFeed';
import { createSimulatedDataFeed } from '../adapters/factories/DataFeedFactory';
import { AdaptiveStrategy, Signal } from './AdaptiveStrategy';
import { SimulatedPerformanceTracker } from '../metrics/SimulatedPerformanceTracker';
import { isPaperMode, logPaperModeCall } from '../config/PaperModeConfig';
import { logger } from '../utils/logger';
import { OrderRequest, OrderResponse, Quote, OrderBook } from '../adapters/interfaces/IExchangeConnector';
import { MarketFeatures } from '../regime/RegimeClassifier';

export interface StrategyRunnerConfig {
  strategyId: string;
  symbols: string[];
  initialCapital: number;
  maxConcurrentOrders: number;
  enablePerformanceTracking: boolean;
  enableMEVSimulation: boolean;
  dataFeedConfig?: {
    type: 'auto' | 'historical' | 'simulated' | 'hybrid';
    replaySpeed: number;
    volatilityMultiplier: number;
  };
  riskConfig?: {
    maxPositionSize: number;
    maxDrawdown: number;
    stopLossPercent: number;
  };
}

export interface StrategySignal {
  id: string;
  strategyId: string;
  symbol: string;
  direction: 'buy' | 'sell' | 'hold';
  strength: number; // 0-1
  confidence: number; // 0-1
  targetPrice?: number;
  positionSize?: number;
  metadata?: Record<string, any>;
  timestamp: number;
  ttl?: number; // Time to live in milliseconds
}

export interface StrategyExecution {
  signalId: string;
  orderId: string;
  status: 'pending' | 'executed' | 'failed' | 'cancelled' | 'expired';
  executedPrice?: number;
  executedAmount?: number;
  fees?: number;
  slippage?: number;
  executionTime?: number;
  error?: string;
}

export enum StrategyRunnerState {
  IDLE = 'idle',
  STARTING = 'starting', 
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export class StrategyRunner extends EventEmitter {
  private config: StrategyRunnerConfig;
  private strategy: AdaptiveStrategy;
  private exchange: MockExchangeConnector;
  private dataFeed?: IDataFeed;
  private performanceTracker?: SimulatedPerformanceTracker;
  
  // State management
  private state: StrategyRunnerState = StrategyRunnerState.IDLE;
  private runningOrderCounter: number = 0;
  
  // Signal and execution tracking
  private activeSignals: Map<string, StrategySignal> = new Map();
  private activeExecutions: Map<string, StrategyExecution> = new Map();
  private executionHistory: StrategyExecution[] = [];
  
  // Timers and intervals
  private tickInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  
  // Performance metrics
  private startTime?: number;
  private lastTickTime?: number;
  private totalSignals: number = 0;
  private totalExecutions: number = 0;
  private successfulExecutions: number = 0;

  constructor(strategy: AdaptiveStrategy, config: StrategyRunnerConfig) {
    super();
    
    // Validate paper mode
    if (!isPaperMode()) {
      throw new Error('StrategyRunner requires paper mode to be enabled');
    }
    
    this.strategy = strategy;
    this.config = config;
    
    // Initialize exchange connector
    this.exchange = new MockExchangeConnector(
      `strategy-${config.strategyId}`,
      `Strategy ${config.strategyId} Exchange`,
      {
        enableDataFeed: true,
        dataFeedType: config.dataFeedConfig?.type || 'simulated',
        replaySpeed: config.dataFeedConfig?.replaySpeed || 1,
        enableRealisticSlippage: true,
        enableMEVSimulation: config.enableMEVSimulation
      }
    );
    
    // Initialize performance tracker if enabled
    if (config.enablePerformanceTracking) {
      this.performanceTracker = new SimulatedPerformanceTracker({
        initialCapital: config.initialCapital,
        trackingId: config.strategyId
      });
    }
    
    // Set up event listeners
    this.setupEventHandlers();
    
    logger.info(`[STRATEGY_RUNNER] Initialized runner for strategy ${config.strategyId}`, {
      symbols: config.symbols,
      initialCapital: config.initialCapital,
      paperMode: isPaperMode()
    });
  }

  /**
   * Start the strategy runner
   */
  public async start(): Promise<void> {
    logPaperModeCall('StrategyRunner', 'start', { strategyId: this.config.strategyId });
    
    if (this.state !== StrategyRunnerState.IDLE && this.state !== StrategyRunnerState.STOPPED) {
      throw new Error(`Cannot start strategy runner in state: ${this.state}`);
    }
    
    this.setState(StrategyRunnerState.STARTING);
    
    try {
      // Connect to exchange
      const connected = await this.exchange.connect();
      if (!connected) {
        throw new Error('Failed to connect to exchange');
      }
      
      // Initialize data feed
      await this.initializeDataFeed();
      
      // Initialize strategy
      await this.initializeStrategy();
      
      // Start execution loop
      this.startExecutionLoop();
      
      // Start cleanup timer
      this.startCleanupTimer();
      
      this.startTime = Date.now();
      this.setState(StrategyRunnerState.RUNNING);
      
      this.emit('started', { strategyId: this.config.strategyId });
      
      logger.info(`[STRATEGY_RUNNER] Started strategy ${this.config.strategyId}`);
      
    } catch (error) {
      this.setState(StrategyRunnerState.ERROR);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the strategy runner
   */
  public async stop(): Promise<void> {
    logPaperModeCall('StrategyRunner', 'stop', { strategyId: this.config.strategyId });
    
    this.setState(StrategyRunnerState.STOPPING);
    
    try {
      // Stop execution loop
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = undefined;
      }
      
      // Stop cleanup timer
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }
      
      // Cancel all active orders
      await this.cancelAllActiveOrders();
      
      // Clean up data feed
      if (this.dataFeed) {
        await this.dataFeed.stop();
        await this.dataFeed.cleanup();
        this.dataFeed = undefined;
      }
      
      // Disconnect exchange
      await this.exchange.disconnect();
      this.exchange.cleanup();
      
      this.setState(StrategyRunnerState.STOPPED);
      
      this.emit('stopped', { 
        strategyId: this.config.strategyId,
        runtime: this.startTime ? Date.now() - this.startTime : 0
      });
      
      logger.info(`[STRATEGY_RUNNER] Stopped strategy ${this.config.strategyId}`);
      
    } catch (error) {
      this.setState(StrategyRunnerState.ERROR);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Pause the strategy runner
   */
  public async pause(): Promise<void> {
    logPaperModeCall('StrategyRunner', 'pause', { strategyId: this.config.strategyId });
    
    if (this.state !== StrategyRunnerState.RUNNING) {
      throw new Error(`Cannot pause strategy runner in state: ${this.state}`);
    }
    
    this.setState(StrategyRunnerState.PAUSED);
    
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
    
    this.emit('paused', { strategyId: this.config.strategyId });
    logger.info(`[STRATEGY_RUNNER] Paused strategy ${this.config.strategyId}`);
  }

  /**
   * Resume the strategy runner
   */
  public async resume(): Promise<void> {
    logPaperModeCall('StrategyRunner', 'resume', { strategyId: this.config.strategyId });
    
    if (this.state !== StrategyRunnerState.PAUSED) {
      throw new Error(`Cannot resume strategy runner in state: ${this.state}`);
    }
    
    this.setState(StrategyRunnerState.RUNNING);
    this.startExecutionLoop();
    
    this.emit('resumed', { strategyId: this.config.strategyId });
    logger.info(`[STRATEGY_RUNNER] Resumed strategy ${this.config.strategyId}`);
  }

  /**
   * Reset the strategy runner state
   */
  public async reset(): Promise<void> {
    logPaperModeCall('StrategyRunner', 'reset', { strategyId: this.config.strategyId });
    
    // Stop if running
    if (this.state === StrategyRunnerState.RUNNING || this.state === StrategyRunnerState.PAUSED) {
      await this.stop();
    }
    
    // Clear state
    this.activeSignals.clear();
    this.activeExecutions.clear();
    this.executionHistory = [];
    this.runningOrderCounter = 0;
    this.totalSignals = 0;
    this.totalExecutions = 0;
    this.successfulExecutions = 0;
    this.startTime = undefined;
    this.lastTickTime = undefined;
    
    // Reset performance tracker
    if (this.performanceTracker) {
      this.performanceTracker.reset();
    }
    
    // Reset strategy (AdaptiveStrategy has enable/disable but no reset method)
    this.strategy.disable();
    this.strategy.enable();
    
    this.setState(StrategyRunnerState.IDLE);
    
    this.emit('reset', { strategyId: this.config.strategyId });
    logger.info(`[STRATEGY_RUNNER] Reset strategy ${this.config.strategyId}`);
  }

  /**
   * Execute a strategy signal manually
   */
  public async executeSignal(signal: StrategySignal): Promise<string> {
    logPaperModeCall('StrategyRunner', 'executeSignal', { 
      signalId: signal.id,
      direction: signal.direction,
      symbol: signal.symbol 
    });
    
    if (this.state !== StrategyRunnerState.RUNNING) {
      throw new Error(`Cannot execute signal in state: ${this.state}`);
    }
    
    return this.processSignal(signal);
  }

  /**
   * Get current performance metrics
   */
  public getPerformanceMetrics(): any {
    if (!this.performanceTracker) {
      return null;
    }
    
    return this.performanceTracker.getMetrics();
  }

  /**
   * Get strategy runner statistics
   */
  public getStatistics(): any {
    const runtime = this.startTime ? Date.now() - this.startTime : 0;
    
    return {
      strategyId: this.config.strategyId,
      state: this.state,
      runtime,
      signals: {
        total: this.totalSignals,
        active: this.activeSignals.size
      },
      executions: {
        total: this.totalExecutions,
        successful: this.successfulExecutions,
        active: this.activeExecutions.size,
        successRate: this.totalExecutions > 0 ? this.successfulExecutions / this.totalExecutions : 0
      },
      performance: this.getPerformanceMetrics(),
      lastTick: this.lastTickTime
    };
  }

  /**
   * Get current strategy state
   */
  public getState(): StrategyRunnerState {
    return this.state;
  }

  /**
   * Check if strategy runner is active
   */
  public isActive(): boolean {
    return this.state === StrategyRunnerState.RUNNING;
  }

  // Private methods

  private setState(newState: StrategyRunnerState): void {
    const oldState = this.state;
    this.state = newState;
    
    this.emit('stateChanged', {
      strategyId: this.config.strategyId,
      oldState,
      newState
    });
  }

  private setupEventHandlers(): void {
    // Handle errors
    this.on('error', (error) => {
      logger.error(`[STRATEGY_RUNNER] Error in strategy ${this.config.strategyId}:`, error);
    });
  }

  private async initializeDataFeed(): Promise<void> {
    this.dataFeed = await createSimulatedDataFeed(
      this.config.symbols,
      {
        simulationParameters: {
          volatility: 0.25,
          timeScale: this.config.dataFeedConfig?.replaySpeed || 1
        }
      },
      {
        replaySpeed: this.config.dataFeedConfig?.replaySpeed || 1,
        volatilityMultiplier: this.config.dataFeedConfig?.volatilityMultiplier || 1.0,
        enableAnomalies: this.config.enableMEVSimulation
      }
    );
    
    await this.dataFeed.start();
    
    logger.info(`[STRATEGY_RUNNER] Data feed initialized for strategy ${this.config.strategyId}`);
  }

  private async initializeStrategy(): Promise<void> {
    // Strategy is already initialized, just ensure it's enabled
    this.strategy.enable();
    logger.info(`[STRATEGY_RUNNER] Strategy ${this.config.strategyId} initialized`);
  }

  private startExecutionLoop(): void {
    // Main execution loop - tick every 100ms
    this.tickInterval = setInterval(async () => {
      try {
        await this.executeTick();
      } catch (error) {
        logger.error(`[STRATEGY_RUNNER] Error in execution tick:`, error);
        this.emit('error', error);
      }
    }, 100);
  }

  private startCleanupTimer(): void {
    // Cleanup expired signals every 5 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSignals();
    }, 5000);
  }

  private async executeTick(): Promise<void> {
    if (this.state !== StrategyRunnerState.RUNNING) {
      return;
    }
    
    this.lastTickTime = Date.now();
    
    try {
      // Generate signals for each symbol
      for (const symbol of this.config.symbols) {
        const signal = await this.generateSignalForSymbol(symbol);
        if (signal) {
          await this.processSignal(signal);
        }
      }
      
      // Update performance metrics
      if (this.performanceTracker) {
        await this.updatePerformanceMetrics();
      }
      
    } catch (error) {
      logger.error(`[STRATEGY_RUNNER] Error in execution tick:`, error);
    }
  }

  private async generateSignalForSymbol(symbol: string): Promise<StrategySignal | null> {
    try {
      // Get current market data
      const quote = await this.exchange.getQuote(symbol);
      const orderBook = await this.exchange.getOrderBook(symbol, 5);
      
      // Create market features from current data
      const marketFeatures: MarketFeatures = {
        price: quote.bid,
        returns1d: 0.01, // Simplified - should calculate from historical data
        returns5d: 0.05,
        returns20d: 0.10,
        volatility1d: 0.02,
        volatility5d: 0.03,
        volatility20d: 0.04,
        volumeRatio1d: 1.0,
        volumeRatio5d: 1.0,
        rsi14: 50, // Neutral RSI
        atr14: quote.spread * 2,
        bbWidth: 0.04, // 4% width
        macdHistogram: 0,
        advanceDeclineRatio: 1.0,
        marketCap: 1000000000 // 1B market cap
      };
      
      // Generate signal from strategy
      const strategySignal = await this.strategy.generateSignal(marketFeatures);
      
      if (!strategySignal || strategySignal.direction === 'hold') {
        return null;
      }
      
      // Convert to StrategySignal format - only process buy/sell signals
      const signal: StrategySignal = {
        id: `signal-${this.config.strategyId}-${this.totalSignals++}`,
        strategyId: this.config.strategyId,
        symbol,
        direction: strategySignal.direction as 'buy' | 'sell', // Exclude hold at compile time
        strength: strategySignal.strength || 0.5,
        confidence: strategySignal.confidence || 0.5,
        targetPrice: strategySignal.metadata?.targetPrice,
        positionSize: strategySignal.metadata?.positionSize,
        metadata: strategySignal.metadata,
        timestamp: Date.now(),
        ttl: 30000 // 30 second TTL
      };
      
      return signal;
      
    } catch (error) {
      logger.error(`[STRATEGY_RUNNER] Error generating signal for ${symbol}:`, error);
      return null;
    }
  }

  private calculateOrderBookImbalance(orderBook: OrderBook): number {
    if (orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      return 0;
    }
    
    const bidVolume = orderBook.bids.reduce((sum, bid) => sum + bid.quantity, 0);
    const askVolume = orderBook.asks.reduce((sum, ask) => sum + ask.quantity, 0);
    const totalVolume = bidVolume + askVolume;
    
    if (totalVolume === 0) return 0;
    
    return (bidVolume - askVolume) / totalVolume;
  }

  private async processSignal(signal: StrategySignal): Promise<string> {
    // Check if we have too many concurrent orders
    if (this.activeExecutions.size >= this.config.maxConcurrentOrders) {
      logger.warn(`[STRATEGY_RUNNER] Max concurrent orders reached, skipping signal ${signal.id}`);
      return '';
    }
    
    // Store active signal
    this.activeSignals.set(signal.id, signal);
    
    try {
      // Convert signal to order
      const order = this.convertSignalToOrder(signal);
      
      // Submit order
      const orderResponse = await this.exchange.submitOrder(order);
      
      // Track execution
      const execution: StrategyExecution = {
        signalId: signal.id,
        orderId: orderResponse.orderId,
        status: 'pending'
      };
      
      this.activeExecutions.set(signal.id, execution);
      this.totalExecutions++;
      
      // Monitor order execution
      this.monitorOrderExecution(signal, orderResponse);
      
      this.emit('signalExecuted', { signal, orderResponse });
      
      return orderResponse.orderId;
      
    } catch (error) {
      logger.error(`[STRATEGY_RUNNER] Error processing signal ${signal.id}:`, error);
      
      // Update execution with error
      const execution: StrategyExecution = {
        signalId: signal.id,
        orderId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
      
      this.activeExecutions.set(signal.id, execution);
      this.emit('signalFailed', { signal, error });
      
      return '';
    }
  }

  private convertSignalToOrder(signal: StrategySignal): OrderRequest {
    // Only process buy/sell signals (hold signals are filtered out earlier)
    if (signal.direction === 'hold') {
      throw new Error('Cannot convert hold signal to order');
    }
    
    // Calculate position size
    let amount = signal.positionSize || this.calculateDefaultPositionSize(signal);
    
    // Apply signal strength as a multiplier
    amount *= signal.strength;
    
    // Apply risk limits
    if (this.config.riskConfig?.maxPositionSize) {
      amount = Math.min(amount, this.config.riskConfig.maxPositionSize);
    }
    
    return {
      symbol: signal.symbol,
      side: signal.direction, // Now guaranteed to be 'buy' | 'sell'
      type: signal.targetPrice ? 'limit' : 'market',
      amount,
      price: signal.targetPrice,
      clientOrderId: signal.id
    };
  }

  private calculateDefaultPositionSize(signal: StrategySignal): number {
    // Default to 1% of initial capital per trade
    const portfolioValue = this.config.initialCapital;
    const positionValue = portfolioValue * 0.01; // 1%
    
    // Get current price estimate - use a reasonable fallback
    const currentPrice = 45000; // BTC price fallback
    
    return positionValue / currentPrice;
  }

  private async monitorOrderExecution(signal: StrategySignal, orderResponse: OrderResponse): Promise<void> {
    // Monitor order status asynchronously
    setTimeout(async () => {
      try {
        const orderStatus = await this.exchange.getOrderStatus(orderResponse.orderId);
        const execution = this.activeExecutions.get(signal.id);
        
        if (!execution) return;
        
        if (orderStatus.status === 'filled') {
          execution.status = 'executed';
          execution.executedPrice = orderStatus.executedPrice;
          execution.executedAmount = orderStatus.executedAmount;
          execution.fees = orderStatus.fees;
          execution.executionTime = Date.now() - signal.timestamp;
          
          this.successfulExecutions++;
          
          // Update performance tracker
          if (this.performanceTracker && orderStatus.executedPrice && orderStatus.executedAmount) {
            // Only record trades for buy/sell signals, not hold
            if (signal.direction !== 'hold') {
              this.performanceTracker.recordTrade({
                symbol: signal.symbol,
                side: signal.direction, // Now guaranteed to be 'buy' | 'sell'
                amount: orderStatus.executedAmount,
                price: orderStatus.executedPrice,
                fees: orderStatus.fees || 0,
                timestamp: Date.now()
              });
            }
          }
          
          this.emit('orderFilled', { signal, orderStatus });
          
        } else if (orderStatus.status === 'rejected' || orderStatus.status === 'cancelled') {
          execution.status = 'failed';
          execution.error = `Order ${orderStatus.status}`;
          
          this.emit('orderFailed', { signal, orderStatus });
        }
        
        // Move to history if completed
        if (execution.status === 'executed' || execution.status === 'failed') {
          this.executionHistory.push(execution);
          this.activeExecutions.delete(signal.id);
          this.activeSignals.delete(signal.id);
        }
        
      } catch (error) {
        logger.error(`[STRATEGY_RUNNER] Error monitoring order ${orderResponse.orderId}:`, error);
      }
    }, 500); // Check after 500ms
  }

  private async updatePerformanceMetrics(): Promise<void> {
    if (!this.performanceTracker) return;
    
    try {
      // Get current balances
      const balances = await this.exchange.getBalances();
      
      // Update portfolio value
      let totalValue = 0;
      for (const balance of balances) {
        if (balance.asset === 'USDT' || balance.asset === 'USDC') {
          totalValue += balance.total;
        } else {
          // Convert to USD value (simplified)
          try {
            const quote = await this.exchange.getQuote(`${balance.asset}/USDT`);
            totalValue += balance.total * quote.bid;
          } catch (error) {
            // Skip assets we can't price
            logger.debug(`[STRATEGY_RUNNER] Could not price asset ${balance.asset}`);
          }
        }
      }
      
      this.performanceTracker.updatePortfolioValue(totalValue);
      
    } catch (error) {
      logger.error(`[STRATEGY_RUNNER] Error updating performance metrics:`, error);
    }
  }

  private cleanupExpiredSignals(): void {
    const now = Date.now();
    
    for (const [signalId, signal] of this.activeSignals) {
      if (signal.ttl && (now - signal.timestamp) > signal.ttl) {
        // Signal expired
        const execution = this.activeExecutions.get(signalId);
        if (execution && execution.status === 'pending') {
          execution.status = 'expired';
          this.executionHistory.push(execution);
          this.activeExecutions.delete(signalId);
        }
        
        this.activeSignals.delete(signalId);
        this.emit('signalExpired', { signal });
      }
    }
  }

  private async cancelAllActiveOrders(): Promise<void> {
    const promises: Promise<any>[] = [];
    
    for (const execution of this.activeExecutions.values()) {
      if (execution.status === 'pending' && execution.orderId) {
        promises.push(
          this.exchange.cancelOrder(execution.orderId).catch(error => {
            logger.warn(`[STRATEGY_RUNNER] Failed to cancel order ${execution.orderId}:`, error);
          })
        );
      }
    }
    
    await Promise.all(promises);
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    if (this.state === StrategyRunnerState.RUNNING || this.state === StrategyRunnerState.PAUSED) {
      await this.stop();
    }
    
    this.removeAllListeners();
    
    logger.info(`[STRATEGY_RUNNER] Cleaned up strategy runner ${this.config.strategyId}`);
  }
} 