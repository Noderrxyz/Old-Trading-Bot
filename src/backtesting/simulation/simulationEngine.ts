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
 * Event data structure
 */
export interface Event {
  type: EventType;
  timestamp: Date;
  data: any;
}

/**
 * Configuration for the simulation engine
 */
export interface SimulationConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols: string[];
  timeframes: Timeframe[];
  commission?: number;
  slippage?: number;
  dataDelay?: number;
  executionDelay?: number;
  marginEnabled?: boolean;
  maxLeverage?: number;
  parameters?: Map<string, any>;
}

/**
 * The core simulation engine for backtesting strategies
 */
export class SimulationEngine {
  private config: SimulationConfig;
  private dataManager: DataManager;
  private strategy: IStrategy;
  private eventQueue: EventQueue = new EventQueue();
  private marketSimulator: MarketSimulator;
  private portfolioManager: PortfolioManager;
  private context: BacktestContextImpl;
  private currentTime: Date;
  private isRunning: boolean = false;
  private logs: { level: string; message: string; timestamp: Date }[] = [];
  private notifications: { level: string; message: string; timestamp: Date }[] = [];
  
  constructor(
    config: SimulationConfig,
    dataManager: DataManager,
    strategy: IStrategy
  ) {
    this.config = this.validateConfig(config);
    this.dataManager = dataManager;
    this.strategy = strategy;
    this.currentTime = new Date(this.config.startDate);
    
    // Initialize market simulator
    this.marketSimulator = new MarketSimulator({
      commission: this.config.commission,
      slippage: this.config.slippage,
      executionDelay: this.config.executionDelay
    });
    
    // Initialize portfolio manager
    this.portfolioManager = new PortfolioManager({
      initialCash: this.config.initialCapital,
      marginEnabled: this.config.marginEnabled,
      maxLeverage: this.config.maxLeverage
    });
    
    // Create backtest context
    this.context = this.createContext();
  }
  
  /**
   * Run the simulation
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Simulation is already running');
    }
    
    this.isRunning = true;
    
    try {
      // Initialize components
      await this.initialize();
      
      // Process events until the queue is empty or we reach the end date
      while (!this.eventQueue.isEmpty() && this.currentTime <= this.config.endDate) {
        // Get the next event
        const event = this.eventQueue.dequeue();
        
        // Update current time
        this.currentTime = new Date(event.timestamp);
        this.context.updateCurrentTime(this.currentTime);
        
        // Process the event
        await this.processEvent(event);
      }
      
      // Call strategy's onEnd method
      this.strategy.onEnd();
      
      this.log('Simulation completed', LogLevel.INFO);
    } catch (error) {
      this.log(`Simulation error: ${error}`, LogLevel.ERROR);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * Initialize the simulation
   */
  private async initialize(): Promise<void> {
    this.log('Initializing simulation...', LogLevel.INFO);
    
    // Reset components
    this.eventQueue.clear();
    this.marketSimulator.reset();
    this.portfolioManager.reset();
    this.logs = [];
    this.notifications = [];
    
    // Register callbacks
    this.marketSimulator.registerCallbacks({
      onFill: this.handleFill.bind(this),
      onOrderUpdate: this.handleOrderUpdate.bind(this)
    });
    
    // Load historical data and queue events
    await this.loadHistoricalData();
    
    // Initialize the strategy
    this.strategy.initialize(this.context);
    this.strategy.onStart();
    
    this.log('Simulation initialized', LogLevel.INFO);
  }
  
  /**
   * Load historical data and queue events
   */
  private async loadHistoricalData(): Promise<void> {
    this.log('Loading historical data...', LogLevel.INFO);
    
    // Load bar data for each symbol and timeframe
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        this.log(`Loading ${timeframe} bars for ${symbol}...`, LogLevel.DEBUG);
        
        try {
          const bars = await this.dataManager.getBars(
            symbol,
            timeframe,
            this.config.startDate,
            this.config.endDate
          );
          
          // Queue bar events
          for (const bar of bars) {
            this.queueEvent({
              type: EventType.BAR,
              timestamp: new Date(bar.timestamp),
              data: { bar, timeframe }
            });
          }
          
          this.log(`Loaded ${bars.length} ${timeframe} bars for ${symbol}`, LogLevel.DEBUG);
        } catch (error) {
          this.log(`Error loading ${timeframe} bars for ${symbol}: ${error}`, LogLevel.ERROR);
        }
      }
    }
  }
  
  /**
   * Process a single event
   */
  private async processEvent(event: Event): Promise<void> {
    // Extract event data
    const { type, timestamp, data } = event;
    
    // Process the event based on its type
    switch (type) {
      case EventType.BAR:
        await this.processBarEvent(data.bar, data.timeframe);
        break;
        
      case EventType.TICK:
        await this.processTickEvent(data.tick);
        break;
        
      case EventType.ORDER_BOOK:
        await this.processOrderBookEvent(data.orderBook);
        break;
        
      case EventType.ORDER_PLACED:
        await this.processOrderPlacedEvent(data.order);
        break;
        
      case EventType.ORDER_FILLED:
        await this.processOrderFilledEvent(data.fill);
        break;
        
      case EventType.ORDER_CANCELLED:
        await this.processOrderCancelledEvent(data.order);
        break;
        
      case EventType.POSITION_CHANGED:
        await this.processPositionChangedEvent(data.position);
        break;
        
      case EventType.CASH_CHANGED:
        await this.processCashChangedEvent(data.cash);
        break;
        
      case EventType.CUSTOM:
        await this.processCustomEvent(data.eventType, data.eventData);
        break;
        
      default:
        this.log(`Unknown event type: ${type}`, LogLevel.WARNING);
    }
  }
  
  /**
   * Process a bar event
   */
  private async processBarEvent(bar: Bar, timeframe: Timeframe): Promise<void> {
    // Update prices in the market simulator
    this.marketSimulator.updatePrice(bar.symbol, bar.close);
    
    // Process orders at this bar's prices
    this.marketSimulator.processBar(bar);
    
    // Update portfolio positions' current prices
    const position = this.portfolioManager.getPosition(bar.symbol);
    if (position) {
      position.currentPrice = bar.close;
    }
    
    // Call the strategy's onBar method
    this.strategy.onBar(bar, this.context);
  }
  
  /**
   * Process a tick event
   */
  private async processTickEvent(tick: Tick): Promise<void> {
    // Update prices in the market simulator
    this.marketSimulator.updatePrice(tick.symbol, tick.price);
    
    // Process orders at this tick's price
    this.marketSimulator.processTick(tick);
    
    // Update portfolio positions' current prices
    const position = this.portfolioManager.getPosition(tick.symbol);
    if (position) {
      position.currentPrice = tick.price;
    }
    
    // Call the strategy's onTick method
    this.strategy.onTick(tick, this.context);
  }
  
  /**
   * Process an order book event
   */
  private async processOrderBookEvent(orderBook: OrderBook): Promise<void> {
    // Update the order book in the market simulator
    this.marketSimulator.updateOrderBook(orderBook);
    
    // Process orders using the order book
    this.marketSimulator.processOrderBook(orderBook);
    
    // Call the strategy's onOrderBook method
    this.strategy.onOrderBook(orderBook, this.context);
  }
  
  /**
   * Process an order placed event
   */
  private async processOrderPlacedEvent(order: Order): Promise<void> {
    // Call the strategy's onOrderPlaced method
    this.strategy.onOrderPlaced(order, this.context);
  }
  
  /**
   * Process an order filled event
   */
  private async processOrderFilledEvent(fill: Fill): Promise<void> {
    // Call the strategy's onOrderFilled method
    this.strategy.onOrderFilled(fill, this.context);
  }
  
  /**
   * Process an order cancelled event
   */
  private async processOrderCancelledEvent(order: Order): Promise<void> {
    // Call the strategy's onOrderCancelled method
    this.strategy.onOrderCancelled(order, this.context);
  }
  
  /**
   * Process a position changed event
   */
  private async processPositionChangedEvent(position: Position): Promise<void> {
    // Call the strategy's onPositionChanged method
    this.strategy.onPositionChanged(position, this.context);
  }
  
  /**
   * Process a cash changed event
   */
  private async processCashChangedEvent(cash: number): Promise<void> {
    // Call the strategy's onCashChanged method
    this.strategy.onCashChanged(cash, this.context);
  }
  
  /**
   * Process a custom event
   */
  private async processCustomEvent(eventType: string, eventData: any): Promise<void> {
    // Call the strategy's onCustomEvent method if it exists
    if (this.strategy.onCustomEvent) {
      this.strategy.onCustomEvent(eventType, eventData, this.context);
    }
  }
  
  /**
   * Handle a fill from the market simulator
   */
  private handleFill(fill: Fill): void {
    // Update the portfolio
    const position = this.portfolioManager.processFill(fill);
    
    // Queue an order filled event
    this.queueEvent({
      type: EventType.ORDER_FILLED,
      timestamp: fill.timestamp,
      data: { fill }
    });
    
    // Queue a position changed event
    this.queueEvent({
      type: EventType.POSITION_CHANGED,
      timestamp: fill.timestamp,
      data: { position }
    });
    
    // Queue a cash changed event
    this.queueEvent({
      type: EventType.CASH_CHANGED,
      timestamp: fill.timestamp,
      data: { cash: this.portfolioManager.getCash() }
    });
  }
  
  /**
   * Handle an order update from the market simulator
   */
  private handleOrderUpdate(order: Order): void {
    // Queue an order update event based on the order status
    if (order.status === OrderStatus.PENDING) {
      this.queueEvent({
        type: EventType.ORDER_PLACED,
        timestamp: order.updateTime,
        data: { order }
      });
    } else if (order.status === OrderStatus.CANCELED) {
      this.queueEvent({
        type: EventType.ORDER_CANCELLED,
        timestamp: order.updateTime,
        data: { order }
      });
    }
  }
  
  /**
   * Queue an event
   */
  private queueEvent(event: Event): void {
    this.eventQueue.enqueue(event);
  }
  
  /**
   * Create the backtest context for the strategy
   */
  private createContext(): BacktestContextImpl {
    return new BacktestContextImpl(
      new Date(this.currentTime),
      this.getHistoricalBars.bind(this),
      this.getLastBar.bind(this),
      this.getLastPrice.bind(this),
      this.placeOrder.bind(this),
      this.cancelOrder.bind(this),
      this.getOrder.bind(this),
      this.getOrders.bind(this),
      this.getOpenOrders.bind(this),
      this.getPosition.bind(this),
      this.getAllPositions.bind(this),
      this.getPortfolioValue.bind(this),
      this.getCash.bind(this),
      this.config.parameters || new Map<string, any>(),
      this.log.bind(this),
      this.notify.bind(this)
    );
  }
  
  /**
   * Get historical bars for the backtest context
   */
  private async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    lookback: number
  ): Promise<Bar[]> {
    try {
      // Calculate the start date based on lookback
      const startDate = this.calculateStartDateFromLookback(this.currentTime, timeframe, lookback);
      
      // Get bars from the data manager
      const bars = await this.dataManager.getBars(
        symbol,
        timeframe,
        startDate,
        this.currentTime
      );
      
      // Limit to the last 'lookback' bars
      return bars.slice(-lookback);
    } catch (error) {
      this.log(`Error getting historical bars: ${error}`, LogLevel.ERROR);
      return [];
    }
  }
  
  /**
   * Get the last bar for the backtest context
   */
  private getLastBar(symbol: string, timeframe: Timeframe): Bar | null {
    // This is a simplified implementation
    // In a real implementation, we would need to track the last bar for each symbol and timeframe
    return null;
  }
  
  /**
   * Get the last price for the backtest context
   */
  private getLastPrice(symbol: string): number | null {
    return this.marketSimulator.getLastPrice(symbol);
  }
  
  /**
   * Place an order for the backtest context
   */
  private placeOrder(orderRequest: OrderRequest): string {
    // Create a new order with a unique ID
    const order: Order = {
      ...orderRequest,
      id: uuidv4(),
      status: OrderStatus.CREATED,
      filledQuantity: 0,
      createTime: new Date(this.currentTime),
      updateTime: new Date(this.currentTime)
    };
    
    // Place the order in the market simulator
    this.marketSimulator.placeOrder(order);
    
    // Return the order ID
    return order.id;
  }
  
  /**
   * Cancel an order for the backtest context
   */
  private cancelOrder(orderId: string): boolean {
    return this.marketSimulator.cancelOrder(orderId);
  }
  
  /**
   * Get an order for the backtest context
   */
  private getOrder(orderId: string): Order | null {
    return this.marketSimulator.getOrder(orderId);
  }
  
  /**
   * Get orders for the backtest context
   */
  private getOrders(filter?: any): Order[] {
    return this.marketSimulator.getOrders(filter);
  }
  
  /**
   * Get open orders for the backtest context
   */
  private getOpenOrders(symbol?: string): Order[] {
    return this.marketSimulator.getOpenOrders(symbol);
  }
  
  /**
   * Get a position for the backtest context
   */
  private getPosition(symbol: string): Position | null {
    return this.portfolioManager.getPosition(symbol);
  }
  
  /**
   * Get all positions for the backtest context
   */
  private getAllPositions(): Position[] {
    return this.portfolioManager.getAllPositions();
  }
  
  /**
   * Get the portfolio value for the backtest context
   */
  private getPortfolioValue(): number {
    return this.portfolioManager.getPortfolioValue();
  }
  
  /**
   * Get the cash balance for the backtest context
   */
  private getCash(): number {
    return this.portfolioManager.getCash();
  }
  
  /**
   * Add a log message
   */
  private log(message: string, level: LogLevel = LogLevel.INFO): void {
    // Add to logs array
    this.logs.push({
      level,
      message,
      timestamp: new Date(this.currentTime)
    });
    
    // If debug mode is enabled, also log to console
    if (level !== LogLevel.DEBUG) {
      console.log(`[${level}] ${message}`);
    }
  }
  
  /**
   * Add a notification
   */
  private notify(message: string, importance: NotificationLevel = NotificationLevel.MEDIUM): void {
    // Add to notifications array
    this.notifications.push({
      level: importance,
      message,
      timestamp: new Date(this.currentTime)
    });
    
    // If notification level is high or critical, also log to console
    if (importance === NotificationLevel.HIGH || importance === NotificationLevel.CRITICAL) {
      console.log(`[NOTIFICATION:${importance}] ${message}`);
    }
  }
  
  /**
   * Calculate a start date based on lookback period
   */
  private calculateStartDateFromLookback(
    currentDate: Date,
    timeframe: Timeframe,
    lookback: number
  ): Date {
    const result = new Date(currentDate);
    
    switch (timeframe) {
      case Timeframe.TICK:
        // For tick data, use a large enough window
        result.setDate(result.getDate() - 30);
        break;
        
      case Timeframe.ONE_MINUTE:
        result.setMinutes(result.getMinutes() - lookback);
        break;
        
      case Timeframe.FIVE_MINUTES:
        result.setMinutes(result.getMinutes() - lookback * 5);
        break;
        
      case Timeframe.FIFTEEN_MINUTES:
        result.setMinutes(result.getMinutes() - lookback * 15);
        break;
        
      case Timeframe.THIRTY_MINUTES:
        result.setMinutes(result.getMinutes() - lookback * 30);
        break;
        
      case Timeframe.ONE_HOUR:
        result.setHours(result.getHours() - lookback);
        break;
        
      case Timeframe.FOUR_HOURS:
        result.setHours(result.getHours() - lookback * 4);
        break;
        
      case Timeframe.ONE_DAY:
        result.setDate(result.getDate() - lookback);
        break;
        
      case Timeframe.ONE_WEEK:
        result.setDate(result.getDate() - lookback * 7);
        break;
        
      case Timeframe.ONE_MONTH:
        result.setMonth(result.getMonth() - lookback);
        break;
        
      default:
        // Default to a 30-day window
        result.setDate(result.getDate() - 30);
    }
    
    return result;
  }
  
  /**
   * Validate the simulation configuration
   */
  private validateConfig(config: SimulationConfig): SimulationConfig {
    // Check required fields
    if (!config.startDate) {
      throw new Error('Start date is required');
    }
    
    if (!config.endDate) {
      throw new Error('End date is required');
    }
    
    if (config.startDate > config.endDate) {
      throw new Error('Start date must be before end date');
    }
    
    if (!config.initialCapital || config.initialCapital <= 0) {
      throw new Error('Initial capital must be positive');
    }
    
    if (!config.symbols || config.symbols.length === 0) {
      throw new Error('At least one symbol is required');
    }
    
    if (!config.timeframes || config.timeframes.length === 0) {
      throw new Error('At least one timeframe is required');
    }
    
    return config;
  }
  
  /**
   * Get the logs from the simulation
   */
  getLogs(): { level: string; message: string; timestamp: Date }[] {
    return [...this.logs];
  }
  
  /**
   * Get the notifications from the simulation
   */
  getNotifications(): { level: string; message: string; timestamp: Date }[] {
    return [...this.notifications];
  }
} 