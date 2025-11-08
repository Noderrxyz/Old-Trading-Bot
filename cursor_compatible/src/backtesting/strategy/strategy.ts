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
 * Core strategy interface for the backtesting engine
 * All strategies must implement this interface to be compatible with the backtester
 */
export interface IStrategy {
  // Lifecycle methods
  initialize(context: BacktestContext): void;
  onStart(): void;
  onEnd(): void;
  
  // Market data handlers
  onBar(bar: Bar, context: BacktestContext): Promise<void>;
  onTick(tick: Tick, context: BacktestContext): void;
  onOrderBook(orderBook: OrderBook, context: BacktestContext): void;
  
  // Order-related callbacks
  onOrderPlaced(order: Order, context: BacktestContext): void;
  onOrderFilled(fill: Fill, context: BacktestContext): void;
  onOrderCancelled(order: Order, context: BacktestContext): void;
  
  // Position and portfolio callbacks
  onPositionChanged(position: Position, context: BacktestContext): void;
  onCashChanged(cash: number, context: BacktestContext): void;
  
  // Optional: custom event handlers
  onCustomEvent?(eventType: string, data: any, context: BacktestContext): void;
}

/**
 * Parameter definition for strategy configuration
 */
export interface StrategyParameter<T> {
  value: T;
  type: 'number' | 'boolean' | 'string' | 'enum';
  range?: [number, number]; // For numeric parameters (min, max)
  step?: number; // For numeric parameters
  options?: T[]; // For enum parameters
  description?: string; // Documentation for the parameter
}

/**
 * Strategy configuration object
 */
export interface StrategyConfig {
  // Strategy identification
  id: string;
  name: string;
  version: string;
  
  // Parameters (can be optimized)
  parameters: {
    [key: string]: StrategyParameter<any>;
  };
  
  // Trading universe
  symbols: string[];
  
  // Data requirements
  dataRequirements: {
    timeframes: Timeframe[];
    indicators?: string[];
    depth?: number; // For order book data
  };
  
  // Risk management
  riskControls?: {
    maxPositionSize?: number | string; // Absolute or percentage
    maxDrawdown?: number; // Percentage
    stopLoss?: number | string; // Points or percentage
    takeProfit?: number | string; // Points or percentage
  };
}

/**
 * Abstract base class for strategies to extend
 * Provides default implementations for all methods
 */
export abstract class BaseStrategy implements IStrategy {
  protected config: StrategyConfig;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  initialize(context: BacktestContext): void {
    // Default implementation does nothing
  }

  onStart(): void {
    // Default implementation does nothing
  }

  onEnd(): void {
    // Default implementation does nothing
  }

  async onBar(bar: Bar, context: BacktestContext): Promise<void> {
    // Default implementation does nothing
    return Promise.resolve();
  }

  onTick(tick: Tick, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onOrderBook(orderBook: OrderBook, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onOrderPlaced(order: Order, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onOrderFilled(fill: Fill, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onOrderCancelled(order: Order, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onPositionChanged(position: Position, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onCashChanged(cash: number, context: BacktestContext): void {
    // Default implementation does nothing
  }

  onCustomEvent(eventType: string, data: any, context: BacktestContext): void {
    // Default implementation does nothing
  }
  
  /**
   * Get the strategy configuration
   */
  getConfig(): StrategyConfig {
    return this.config;
  }
} 