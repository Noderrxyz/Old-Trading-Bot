import { 
  Bar, 
  Fill, 
  LogLevel, 
  NotificationLevel, 
  Order, 
  OrderBook, 
  OrderRequest, 
  OrderSide, 
  OrderStatus, 
  OrderType, 
  Position, 
  Tick, 
  Timeframe 
} from '../models/types';
import { BacktestContext, BacktestContextImpl } from '../models/context';
import { DataManager } from '../data/dataManager';
import { IStrategy } from '../strategy/strategy';
import { EventQueue } from './eventQueue';
import { MarketSimulator } from './marketSimulator';
import { PortfolioManager } from '../portfolio/portfolioManager';
import { v4 as uuidv4 } from 'uuid';

/**
 * Types of events in the simulation engine
 */
export enum EventType {
  BAR = 'bar',
  TICK = 'tick',
  ORDER_BOOK = 'orderbook',
  ORDER_PLACED = 'order_placed',
  ORDER_FILLED = 'order_filled',
  ORDER_CANCELLED = 'order_cancelled',
  POSITION_CHANGED = 'position_changed',
  CASH_CHANGED = 'cash_changed',
  CUSTOM = 'custom'
}

/**
 * Generic event interface for the event queue
 */
export interface Event {
  type: EventType;
  timestamp: Date;
  data: any;
}

/**
 * Configuration options for simulation engine
 */
export interface SimulationConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols: string[];
  timeframes: Timeframe[];
  
  // Optional features
  commission?: number | ((order: Order) => number);
  slippage?: number | ((order: Order) => number);
  dataDelay?: number; // Milliseconds of data delay to simulate
  executionDelay?: number; // Milliseconds of execution delay to simulate
  processOrderBookData?: boolean;
  processTickData?: boolean;
  minuteTimeframeBarCount?: number; // How many 1m bars to preload
  dailyTimeframeBarCount?: number; // How many 1d bars to preload
  timePrecision?: 'ms' | 's' | 'm' | 'h'; // Time precision level for simulation
}

/**
 * Cash history entry interface
 */
export interface CashHistoryEntry {
  timestamp: Date;
  cash: number;
}

/**
 * Position history entry interface
 */
export interface PositionHistoryEntry {
  timestamp: Date;
  position: Position;
}

/**
 * Main simulation engine for running backtests
 */
export class SimulationEngine {
  private config: SimulationConfig;
  private dataManager: DataManager;
  private strategy: IStrategy;
  private eventQueue: EventQueue;
  private marketSimulator: MarketSimulator;
  private portfolioManager: PortfolioManager;
  private context: BacktestContextImpl;
  private currentTime: Date;
  private isRunning: boolean = false;
  private logs: { level: LogLevel; message: string; timestamp: Date }[] = [];
  private notifications: { level: NotificationLevel; message: string; timestamp: Date }[] = [];
  
  // Track orders, fills, cash and position history for performance analysis
  private orders: Order[] = [];
  private fills: Fill[] = [];
  private cashHistory: CashHistoryEntry[] = [];
  private positionHistory: PositionHistoryEntry[] = [];
  
  constructor(
    config: SimulationConfig, 
    dataManager: DataManager, 
    strategy: IStrategy
  ) {
    this.config = this.validateAndDefaultConfig(config);
    this.dataManager = dataManager;
    this.strategy = strategy;
    this.eventQueue = new EventQueue();
    this.marketSimulator = new MarketSimulator({
      commission: this.config.commission,
      slippage: this.config.slippage,
      executionDelay: this.config.executionDelay
    });
    this.portfolioManager = new PortfolioManager({
      initialCash: this.config.initialCapital
    });
    this.currentTime = new Date(this.config.startDate);
    
    // Create the backtest context
    this.context = this.createBacktestContext();
    
    // Initial cash history entry
    this.recordCashChange(this.config.initialCapital);
  }
  
  /**
   * Validate and set default values for the simulation config
   */
  private validateAndDefaultConfig(config: SimulationConfig): SimulationConfig {
    if (!config.startDate || !config.endDate) {
      throw new Error('Start and end dates are required');
    }
    
    if (config.startDate > config.endDate) {
      throw new Error('Start date must be before end date');
    }
    
    if (!config.initialCapital || config.initialCapital <= 0) {
      throw new Error('Initial capital must be positive');
    }
    
    if (!config.symbols || config.symbols.length === 0) {
      throw new Error('At least one symbol must be specified');
    }
    
    if (!config.timeframes || config.timeframes.length === 0) {
      throw new Error('At least one timeframe must be specified');
    }
    
    // Set default values for optional parameters
    return {
      ...config,
      commission: config.commission ?? 0,
      slippage: config.slippage ?? 0,
      dataDelay: config.dataDelay ?? 0,
      executionDelay: config.executionDelay ?? 0,
      processOrderBookData: config.processOrderBookData ?? false,
      processTickData: config.processTickData ?? true,
      minuteTimeframeBarCount: config.minuteTimeframeBarCount ?? 200,
      dailyTimeframeBarCount: config.dailyTimeframeBarCount ?? 50,
      timePrecision: config.timePrecision ?? 's'
    };
  }
  
  /**
   * Create the backtest context provided to strategies
   */
  private createBacktestContext(): BacktestContextImpl {
    return new BacktestContextImpl(
      this.currentTime,
      async (symbol, timeframe, lookback) => await this.getHistoricalBars(symbol, timeframe, lookback),
      async (symbol, timeframe) => await this.getLastBar(symbol, timeframe),
      (symbol) => this.getLastPrice(symbol),
      (order) => this.placeOrder(order),
      (orderId) => this.cancelOrder(orderId),
      (orderId) => this.getOrder(orderId),
      (filter) => this.getOrders(filter),
      (symbol) => this.getOpenOrders(symbol),
      (symbol) => this.getPosition(symbol),
      () => this.portfolioManager.getAllPositions(),
      () => this.portfolioManager.getPortfolioValue(),
      () => this.portfolioManager.getCash(),
      new Map(), // Parameters map - to be populated before running
      (message, level) => this.log(message, level),
      (message, importance) => this.notify(message, importance)
    );
  }
  
  /**
   * Run the simulation
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Simulation is already running');
    }
    
    this.isRunning = true;
    this.log('Starting simulation', LogLevel.INFO);
    
    try {
      // Initialize the strategy
      this.strategy.initialize(this.context);
      
      // Preload historical data
      await this.preloadData();
      
      // Load the initial events into the queue
      await this.loadInitialEvents();
      
      // Set the current time to the start date
      this.currentTime = new Date(this.config.startDate);
      this.context.updateCurrentTime(this.currentTime);
      
      // Call strategy onStart
      this.strategy.onStart();
      
      // Process events until the queue is empty or we reach the end date
      while (!this.eventQueue.isEmpty()) {
        // Get the next event
        const event = this.eventQueue.dequeue();
        
        // Update current time if event is in the future
        if (event.timestamp > this.currentTime) {
          this.currentTime = new Date(event.timestamp);
          this.context.updateCurrentTime(this.currentTime);
        }
        
        // If we've passed the end date, stop processing
        if (this.currentTime > this.config.endDate) {
          break;
        }
        
        // Process the event
        await this.processEvent(event);
      }
      
      // Call strategy onEnd
      this.strategy.onEnd();
      
      this.log('Simulation completed', LogLevel.INFO);
    } catch (error) {
      this.log(`Simulation failed: ${error}`, LogLevel.ERROR);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * Preload historical data for all symbols and timeframes
   */
  private async preloadData(): Promise<void> {
    this.log('Preloading historical data', LogLevel.INFO);
    
    // Calculate the amount of data to preload based on config
    const preloadStartDate = new Date(this.config.startDate);
    
    // Preload 1-minute bars
    if (this.config.timeframes.includes(Timeframe.ONE_MINUTE)) {
      preloadStartDate.setMinutes(preloadStartDate.getMinutes() - this.config.minuteTimeframeBarCount!);
    }
    
    // Preload daily bars
    if (this.config.timeframes.includes(Timeframe.ONE_DAY)) {
      preloadStartDate.setDate(preloadStartDate.getDate() - this.config.dailyTimeframeBarCount!);
    }
    
    // Preload data for each symbol and timeframe
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        try {
          await this.dataManager.getBars(
            symbol,
            timeframe,
            preloadStartDate,
            this.config.endDate
          );
          this.log(`Preloaded ${timeframe} bars for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Failed to preload ${timeframe} bars for ${symbol}: ${error}`, LogLevel.WARNING);
        }
      }
      
      // Preload tick data if enabled
      if (this.config.processTickData) {
        try {
          await this.dataManager.getTicks(
            symbol,
            preloadStartDate,
            this.config.endDate
          );
          this.log(`Preloaded ticks for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Failed to preload ticks for ${symbol}: ${error}`, LogLevel.WARNING);
        }
      }
      
      // Preload order book data if enabled
      if (this.config.processOrderBookData) {
        try {
          await this.dataManager.getOrderBooks(
            symbol,
            preloadStartDate,
            this.config.endDate
          );
          this.log(`Preloaded order book for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Failed to preload order book for ${symbol}: ${error}`, LogLevel.WARNING);
        }
      }
    }
    
    this.log('Historical data preloaded', LogLevel.INFO);
  }
  
  /**
   * Load initial events into the queue
   */
  private async loadInitialEvents(): Promise<void> {
    this.log('Loading initial events', LogLevel.INFO);
    
    // Load bar events for each symbol and timeframe
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        try {
          const bars = await this.dataManager.getBars(
            symbol,
            timeframe,
            this.config.startDate,
            this.config.endDate
          );
          
          // Add each bar as an event
          for (const bar of bars) {
            this.eventQueue.enqueue({
              type: EventType.BAR,
              timestamp: new Date(bar.timestamp),
              data: { bar, timeframe }
            });
          }
          
          this.log(`Loaded ${bars.length} ${timeframe} bar events for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Failed to load ${timeframe} bar events for ${symbol}: ${error}`, LogLevel.WARNING);
        }
      }
      
      // Load tick events if enabled
      if (this.config.processTickData) {
        try {
          const ticks = await this.dataManager.getTicks(
            symbol,
            this.config.startDate,
            this.config.endDate
          );
          
          // Add each tick as an event
          for (const tick of ticks) {
            this.eventQueue.enqueue({
              type: EventType.TICK,
              timestamp: new Date(tick.timestamp),
              data: { tick }
            });
          }
          
          this.log(`Loaded ${ticks.length} tick events for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Failed to load tick events for ${symbol}: ${error}`, LogLevel.WARNING);
        }
      }
      
      // Load order book events if enabled
      if (this.config.processOrderBookData) {
        try {
          const orderBooks = await this.dataManager.getOrderBooks(
            symbol,
            this.config.startDate,
            this.config.endDate
          );
          
          // Add each order book as an event
          for (const orderBook of orderBooks) {
            this.eventQueue.enqueue({
              type: EventType.ORDER_BOOK,
              timestamp: new Date(orderBook.timestamp),
              data: { orderBook }
            });
          }
          
          this.log(`Loaded ${orderBooks.length} order book events for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Failed to load order book events for ${symbol}: ${error}`, LogLevel.WARNING);
        }
      }
    }
    
    this.log(`Loaded ${this.eventQueue.size()} total events`, LogLevel.INFO);
  }
  
  /**
   * Process a simulation event
   */
  private async processEvent(event: Event): Promise<void> {
    switch (event.type) {
      case EventType.BAR:
        await this.processBarEvent(event.data.bar, event.data.timeframe);
        break;
      case EventType.TICK:
        await this.processTickEvent(event.data.tick);
        break;
      case EventType.ORDER_BOOK:
        await this.processOrderBookEvent(event.data.orderBook);
        break;
      case EventType.ORDER_PLACED:
        await this.processOrderPlacedEvent(event.data.order);
        break;
      case EventType.ORDER_FILLED:
        await this.processOrderFilledEvent(event.data.fill);
        break;
      case EventType.ORDER_CANCELLED:
        await this.processOrderCancelledEvent(event.data.order);
        break;
      case EventType.POSITION_CHANGED:
        await this.processPositionChangedEvent(event.data.position);
        break;
      case EventType.CASH_CHANGED:
        await this.processCashChangedEvent(event.data.cash);
        break;
      case EventType.CUSTOM:
        await this.processCustomEvent(event.data.eventType, event.data.data);
        break;
      default:
        this.log(`Unknown event type: ${event.type}`, LogLevel.WARNING);
    }
  }
  
  /**
   * Process a bar event
   */
  private async processBarEvent(bar: Bar, timeframe: Timeframe): Promise<void> {
    try {
      // Update market simulator with the latest price
      this.marketSimulator.updatePrice(bar.symbol, bar.close);
      
      // Process any orders that can be filled at this bar
      this.marketSimulator.processOrders(bar);
      
      // Call strategy's onBar handler
      await this.strategy.onBar(bar, this.context);
      
    } catch (error) {
      this.log(`Error processing bar event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process a tick event
   */
  private async processTickEvent(tick: Tick): Promise<void> {
    try {
      // Update market simulator with the latest price
      this.marketSimulator.updatePrice(tick.symbol, tick.price);
      
      // Process any orders that can be filled at this tick
      this.marketSimulator.processTick(tick);
      
      // Call strategy's onTick handler
      this.strategy.onTick(tick, this.context);
      
    } catch (error) {
      this.log(`Error processing tick event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process an order book event
   */
  private async processOrderBookEvent(orderBook: OrderBook): Promise<void> {
    try {
      // Update market simulator with the order book
      this.marketSimulator.updateOrderBook(orderBook);
      
      // Process any orders that can be filled with this order book
      this.marketSimulator.processOrderBook(orderBook);
      
      // Call strategy's onOrderBook handler
      this.strategy.onOrderBook(orderBook, this.context);
      
    } catch (error) {
      this.log(`Error processing order book event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process an order placed event
   */
  private async processOrderPlacedEvent(order: Order): Promise<void> {
    try {
      // Store the order
      this.orders.push(order);
      
      // Call strategy's onOrderPlaced handler
      this.strategy.onOrderPlaced(order, this.context);
      
    } catch (error) {
      this.log(`Error processing order placed event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process an order filled event
   */
  private async processOrderFilledEvent(fill: Fill): Promise<void> {
    try {
      // Store the fill
      this.fills.push(fill);
      
      // Update portfolio with the fill
      const position = this.portfolioManager.processFill(fill);
      
      // Record position change
      this.recordPositionChange(position);
      
      // Record cash change
      this.recordCashChange(this.portfolioManager.getCash());
      
      // Schedule position changed event
      this.eventQueue.enqueue({
        type: EventType.POSITION_CHANGED,
        timestamp: new Date(fill.timestamp),
        data: { position }
      });
      
      // Schedule cash changed event if cash has changed
      this.eventQueue.enqueue({
        type: EventType.CASH_CHANGED,
        timestamp: new Date(fill.timestamp),
        data: { cash: this.portfolioManager.getCash() }
      });
      
      // Call strategy's onOrderFilled handler
      this.strategy.onOrderFilled(fill, this.context);
      
    } catch (error) {
      this.log(`Error processing order filled event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process an order cancelled event
   */
  private async processOrderCancelledEvent(order: Order): Promise<void> {
    try {
      // Call strategy's onOrderCancelled handler
      this.strategy.onOrderCancelled(order, this.context);
      
    } catch (error) {
      this.log(`Error processing order cancelled event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process a position changed event
   */
  private async processPositionChangedEvent(position: Position): Promise<void> {
    try {
      // Call strategy's onPositionChanged handler
      this.strategy.onPositionChanged(position, this.context);
      
    } catch (error) {
      this.log(`Error processing position changed event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process a cash changed event
   */
  private async processCashChangedEvent(cash: number): Promise<void> {
    try {
      // Call strategy's onCashChanged handler
      this.strategy.onCashChanged(cash, this.context);
      
    } catch (error) {
      this.log(`Error processing cash changed event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Process a custom event
   */
  private async processCustomEvent(eventType: string, data: any): Promise<void> {
    try {
      // Call strategy's onCustomEvent handler if it exists
      if (this.strategy.onCustomEvent) {
        this.strategy.onCustomEvent(eventType, data, this.context);
      }
      
    } catch (error) {
      this.log(`Error processing custom event: ${error}`, LogLevel.ERROR);
    }
  }
  
  /**
   * Get historical bars for a symbol and timeframe
   */
  private async getHistoricalBars(symbol: string, timeframe: Timeframe, lookback: number): Promise<Bar[]> {
    // Calculate start date based on lookback and timeframe
    const startDate = new Date(this.currentTime);
    
    switch (timeframe) {
      case Timeframe.ONE_MINUTE:
        startDate.setMinutes(startDate.getMinutes() - lookback);
        break;
      case Timeframe.FIVE_MINUTES:
        startDate.setMinutes(startDate.getMinutes() - lookback * 5);
        break;
      case Timeframe.FIFTEEN_MINUTES:
        startDate.setMinutes(startDate.getMinutes() - lookback * 15);
        break;
      case Timeframe.THIRTY_MINUTES:
        startDate.setMinutes(startDate.getMinutes() - lookback * 30);
        break;
      case Timeframe.ONE_HOUR:
        startDate.setHours(startDate.getHours() - lookback);
        break;
      case Timeframe.FOUR_HOURS:
        startDate.setHours(startDate.getHours() - lookback * 4);
        break;
      case Timeframe.ONE_DAY:
        startDate.setDate(startDate.getDate() - lookback);
        break;
      case Timeframe.ONE_WEEK:
        startDate.setDate(startDate.getDate() - lookback * 7);
        break;
      case Timeframe.ONE_MONTH:
        startDate.setMonth(startDate.getMonth() - lookback);
        break;
      default:
        throw new Error(`Unsupported timeframe: ${timeframe}`);
    }
    
    // Get bars from the data manager
    return await this.dataManager.getBars(symbol, timeframe, startDate, this.currentTime);
  }
  
  /**
   * Get the last bar for a symbol and timeframe
   */
  private async getLastBar(symbol: string, timeframe: Timeframe): Promise<Bar | null> {
    const bars = await this.getHistoricalBars(symbol, timeframe, 1);
    return bars.length > 0 ? bars[bars.length - 1] : null;
  }
  
  /**
   * Get the last price for a symbol
   */
  private getLastPrice(symbol: string): number | null {
    return this.marketSimulator.getLastPrice(symbol);
  }
  
  /**
   * Place an order
   */
  private placeOrder(orderRequest: OrderRequest): string {
    // Generate a unique order ID
    const orderId = uuidv4();
    
    // Create the order
    const order: Order = {
      ...orderRequest,
      id: orderId,
      status: OrderStatus.CREATED,
      filledQuantity: 0,
      createTime: new Date(this.currentTime),
      updateTime: new Date(this.currentTime)
    };
    
    // Submit the order to the market simulator
    this.marketSimulator.placeOrder(order);
    
    // Schedule order placed event
    this.eventQueue.enqueue({
      type: EventType.ORDER_PLACED,
      timestamp: new Date(this.currentTime),
      data: { order }
    });
    
    return orderId;
  }
  
  /**
   * Cancel an order
   */
  private cancelOrder(orderId: string): boolean {
    const cancelled = this.marketSimulator.cancelOrder(orderId);
    
    if (cancelled) {
      const order = this.marketSimulator.getOrder(orderId);
      
      // Schedule order cancelled event
      this.eventQueue.enqueue({
        type: EventType.ORDER_CANCELLED,
        timestamp: new Date(this.currentTime),
        data: { order }
      });
    }
    
    return cancelled;
  }
  
  /**
   * Get an order by ID
   */
  private getOrder(orderId: string): Order | null {
    return this.marketSimulator.getOrder(orderId);
  }
  
  /**
   * Get orders - either all orders or filtered by criteria
   */
  public getOrders(filter?: { symbol?: string; status?: string | string[] }): Order[] {
    if (filter) {
      return this.marketSimulator.getOrders(filter);
    }
    return [...this.orders];
  }
  
  /**
   * Get open orders for a symbol
   */
  private getOpenOrders(symbol?: string): Order[] {
    return this.marketSimulator.getOpenOrders(symbol);
  }
  
  /**
   * Get position for a symbol
   */
  private getPosition(symbol: string): Position | null {
    return this.portfolioManager.getPosition(symbol);
  }
  
  /**
   * Log a message
   */
  private log(message: string, level: LogLevel = LogLevel.INFO): void {
    const logEntry = {
      level,
      message,
      timestamp: new Date(this.currentTime)
    };
    
    this.logs.push(logEntry);
    
    // Optional: Print to console for debugging
    // console.log(`[${level}][${logEntry.timestamp.toISOString()}] ${message}`);
  }
  
  /**
   * Send a notification
   */
  private notify(message: string, importance: NotificationLevel = NotificationLevel.MEDIUM): void {
    const notification = {
      level: importance,
      message,
      timestamp: new Date(this.currentTime)
    };
    
    this.notifications.push(notification);
    
    // Optional: Print to console for debugging
    // console.log(`[NOTIFICATION][${importance}][${notification.timestamp.toISOString()}] ${message}`);
  }
  
  /**
   * Record a cash change to the history
   */
  private recordCashChange(cash: number): void {
    this.cashHistory.push({
      timestamp: new Date(this.currentTime),
      cash
    });
  }
  
  /**
   * Record a position change to the history
   */
  private recordPositionChange(position: Position): void {
    // Clone the position to prevent later modifications
    const positionCopy: Position = { ...position };
    
    this.positionHistory.push({
      timestamp: new Date(this.currentTime),
      position: positionCopy
    });
  }
  
  /**
   * Get all fills from the simulation
   */
  public getFills(): Fill[] {
    return [...this.fills];
  }
  
  /**
   * Get cash history from the simulation
   */
  public getCashHistory(): CashHistoryEntry[] {
    return [...this.cashHistory];
  }
  
  /**
   * Get position history from the simulation
   */
  public getPositionHistory(): PositionHistoryEntry[] {
    return [...this.positionHistory];
  }
  
  /**
   * Get all logs
   */
  public getLogs(): { level: LogLevel; message: string; timestamp: Date }[] {
    return [...this.logs];
  }
  
  /**
   * Get all notifications
   */
  public getNotifications(): { level: NotificationLevel; message: string; timestamp: Date }[] {
    return [...this.notifications];
  }
} 