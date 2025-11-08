import { 
  Bar, 
  Fill, 
  Order, 
  OrderBook, 
  Position, 
  Tick, 
  Timeframe 
} from '../models/types';
import { BacktestContext } from '../models/context';

/**
 * Parameter definition for strategy configuration
 */
export interface StrategyParameter {
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object';
  range?: [number, number]; // For numeric parameters
  options?: any[]; // For enum parameters
  step?: number; // For numeric parameters
  description?: string;
}

/**
 * Strategy configuration interface
 */
export interface StrategyConfig {
  id: string;
  name: string;
  version: string;
  description?: string;
  parameters: Record<string, StrategyParameter>;
  symbols: string[];
  dataRequirements: {
    timeframes: Timeframe[];
    orderBookRequired?: boolean;
    ticksRequired?: boolean;
  };
}

/**
 * Core strategy interface for the backtesting engine
 * All strategies must implement this interface to be compatible with the backtester
 */
export interface IStrategy {
  // Lifecycle methods
  initialize(context: BacktestContext): void;
  onStart(): void;
  onEnd(): void;
  
  // Market data handlers
  onBar(bar: Bar, context: BacktestContext): void;
  onTick(tick: Tick, context: BacktestContext): void;
  onOrderBook(orderBook: OrderBook, context: BacktestContext): void;
  
  // Order-related callbacks
  onOrderPlaced(order: Order, context: BacktestContext): void;
  onOrderFilled(fill: Fill, context: BacktestContext): void;
  onOrderCancelled(order: Order, context: BacktestContext): void;
  
  // Position & portfolio callbacks
  onPositionChanged(position: Position, context: BacktestContext): void;
  onCashChanged(cash: number, context: BacktestContext): void;
  
  // Optional custom event handler
  onCustomEvent?(eventType: string, data: any, context: BacktestContext): void;
}

/**
 * Base strategy class with common functionality
 * Extends this class to create your own strategy
 */
export abstract class BaseStrategy implements IStrategy {
  protected config: StrategyConfig;
  protected isInitialized: boolean = false;
  
  constructor(config: StrategyConfig) {
    this.config = this.validateConfig(config);
  }
  
  /**
   * Initialize the strategy with the backtest context
   */
  initialize(context: BacktestContext): void {
    this.isInitialized = true;
  }
  
  /**
   * Called when the backtest starts
   */
  onStart(): void {
    // Override in your strategy implementation
  }
  
  /**
   * Called when the backtest ends
   */
  onEnd(): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle new bar data
   */
  onBar(bar: Bar, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle new tick data
   */
  onTick(tick: Tick, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle new order book data
   */
  onOrderBook(orderBook: OrderBook, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle order placed event
   */
  onOrderPlaced(order: Order, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle order filled event
   */
  onOrderFilled(fill: Fill, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle order cancelled event
   */
  onOrderCancelled(order: Order, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle position changed event
   */
  onPositionChanged(position: Position, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle cash changed event
   */
  onCashChanged(cash: number, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Handle custom event
   */
  onCustomEvent?(eventType: string, data: any, context: BacktestContext): void {
    // Override in your strategy implementation
  }
  
  /**
   * Get the strategy configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }
  
  /**
   * Validate the strategy configuration
   * Throws an error if the configuration is invalid
   */
  private validateConfig(config: StrategyConfig): StrategyConfig {
    // Check required fields
    if (!config.id) {
      throw new Error('Strategy ID is required');
    }
    
    if (!config.name) {
      throw new Error('Strategy name is required');
    }
    
    if (!config.version) {
      throw new Error('Strategy version is required');
    }
    
    if (!config.parameters) {
      config.parameters = {};
    }
    
    if (!config.symbols || config.symbols.length === 0) {
      throw new Error('At least one symbol is required');
    }
    
    if (!config.dataRequirements) {
      throw new Error('Data requirements are required');
    }
    
    if (!config.dataRequirements.timeframes || config.dataRequirements.timeframes.length === 0) {
      throw new Error('At least one timeframe is required in data requirements');
    }
    
    return config;
  }
} 