import { Bar, LogLevel, OrderSide, OrderType, Timeframe } from '../models/types';
import { BacktestContext } from '../models/context';
import { BaseStrategy, StrategyConfig } from './strategy';

/**
 * Configuration options for MovingAverageCrossoverStrategy
 */
export interface MovingAverageCrossoverConfig {
  id: string;
  name: string;
  symbols: string[];
  fastPeriod: number;
  slowPeriod: number;
  stopLossPercentage?: number;
  takeProfitPercentage?: number;
  positionSizing?: number;
}

/**
 * A simple moving average crossover strategy
 * 
 * Goes long when the fast MA crosses above the slow MA
 * Goes short or exits when the fast MA crosses below the slow MA
 */
export class MovingAverageCrossoverStrategy extends BaseStrategy {
  private fastPeriod: number;
  private slowPeriod: number;
  private fastValues: Map<string, number[]> = new Map();
  private slowValues: Map<string, number[]> = new Map();
  private positions: Map<string, 'long' | 'short' | null> = new Map();
  private previousFastMAs: Map<string, number>;
  private previousSlowMAs: Map<string, number>;
  protected parameters: Record<string, any>;
  
  constructor(config: MovingAverageCrossoverConfig) {
    // Convert to BaseStrategy config
    const baseConfig: StrategyConfig = {
      id: config.id,
      name: config.name,
      version: '1.0.0',
      parameters: {
        fastPeriod: {
          value: config.fastPeriod,
          type: 'number',
          range: [2, 200],
          step: 1,
          description: 'Fast moving average period'
        },
        slowPeriod: {
          value: config.slowPeriod,
          type: 'number',
          range: [5, 200],
          step: 1,
          description: 'Slow moving average period'
        }
      },
      symbols: config.symbols,
      dataRequirements: {
        timeframes: [Timeframe.ONE_DAY]
      }
    };
    
    // Add additional parameters if provided
    if (config.stopLossPercentage !== undefined) {
      baseConfig.parameters.stopLossPercentage = {
        value: config.stopLossPercentage,
        type: 'number',
        range: [1, 50],
        step: 0.5,
        description: 'Stop loss percentage'
      };
    }
    
    if (config.takeProfitPercentage !== undefined) {
      baseConfig.parameters.takeProfitPercentage = {
        value: config.takeProfitPercentage,
        type: 'number',
        range: [1, 100],
        step: 0.5,
        description: 'Take profit percentage'
      };
    }
    
    if (config.positionSizing !== undefined) {
      baseConfig.parameters.positionSizing = {
        value: config.positionSizing,
        type: 'number',
        range: [0.01, 1],
        step: 0.01,
        description: 'Position sizing as percentage of available capital'
      };
    }
    
    super(baseConfig);
    
    // Initialize state
    this.fastPeriod = config.fastPeriod;
    this.slowPeriod = config.slowPeriod;
    this.previousFastMAs = new Map<string, number>();
    this.previousSlowMAs = new Map<string, number>();
    
    // Store parameters for easy access
    this.parameters = {
      fastPeriod: config.fastPeriod,
      slowPeriod: config.slowPeriod,
      stopLossPercentage: config.stopLossPercentage,
      takeProfitPercentage: config.takeProfitPercentage,
      positionSizing: config.positionSizing
    };
  }
  
  /**
   * Initialize the strategy with the backtest context
   */
  initialize(context: BacktestContext): void {
    // Get parameters from context
    const params = context.getParameters();
    
    // Override default parameters if provided in context
    if (params.has('fastPeriod')) {
      this.fastPeriod = params.get('fastPeriod');
      this.parameters.fastPeriod = this.fastPeriod;
    }
    
    if (params.has('slowPeriod')) {
      this.slowPeriod = params.get('slowPeriod');
      this.parameters.slowPeriod = this.slowPeriod;
    }
    
    if (params.has('stopLossPercentage')) {
      this.parameters.stopLossPercentage = params.get('stopLossPercentage');
    }
    
    if (params.has('takeProfitPercentage')) {
      this.parameters.takeProfitPercentage = params.get('takeProfitPercentage');
    }
    
    if (params.has('positionSizing')) {
      this.parameters.positionSizing = params.get('positionSizing');
    }
    
    // Validate parameters
    if (this.fastPeriod >= this.slowPeriod) {
      context.log('Fast period must be less than slow period. Resetting to defaults.', LogLevel.WARNING);
      this.fastPeriod = 10;
      this.slowPeriod = 30;
    }
    
    // Initialize position tracking
    for (const symbol of this.config.symbols) {
      this.positions.set(symbol, null);
      this.fastValues.set(symbol, []);
      this.slowValues.set(symbol, []);
    }
    
    context.log(`Initialized strategy with fastPeriod=${this.fastPeriod}, slowPeriod=${this.slowPeriod}`, LogLevel.INFO);
  }
  
  /**
   * Handle new bar data
   */
  async onBar(bar: Bar, context: BacktestContext): Promise<void> {
    const { symbol, close } = bar;
    
    // Get historical bars for moving average calculation
    const maxPeriod = Math.max(this.fastPeriod, this.slowPeriod);
    const lookbackBars = await context.getHistoricalBars(symbol, Timeframe.ONE_DAY, maxPeriod + 1);
    
    // Need enough data to calculate moving averages
    if (lookbackBars.length <= maxPeriod) {
      return;
    }
    
    // Calculate moving averages
    const prices = lookbackBars.map((b: Bar) => b.close);
    const fastMA = this.calculateSMA(prices, this.fastPeriod);
    const slowMA = this.calculateSMA(prices, this.slowPeriod);
    
    // Get previous moving averages
    const prevFastMA = this.previousFastMAs.get(symbol) || 0;
    const prevSlowMA = this.previousSlowMAs.get(symbol) || 0;
    
    // Store current moving averages for next bar
    this.previousFastMAs.set(symbol, fastMA);
    this.previousSlowMAs.set(symbol, slowMA);
    
    // Log current moving averages
    context.log(`${symbol} - Fast MA: ${fastMA.toFixed(2)}, Slow MA: ${slowMA.toFixed(2)}`);
    
    // Check for crossovers if we have previous values
    if (prevFastMA > 0 && prevSlowMA > 0) {
      // Check for bullish crossover (fast MA crosses above slow MA)
      if (prevFastMA <= prevSlowMA && fastMA > slowMA) {
        const position = context.getPosition(symbol);
        
        // Only enter if we don't have a position already
        if (!position || position.quantity <= 0) {
          // Calculate position size
          const cash = context.getCash();
          const positionSizing = this.parameters.positionSizing || 1.0;
          const positionValue = cash * positionSizing;
          const quantity = positionValue / close;
          
          context.log(`BUY SIGNAL: Fast MA crossed above Slow MA - ${fastMA.toFixed(2)} > ${slowMA.toFixed(2)}`);
          context.placeOrder({
            symbol,
            type: OrderType.MARKET,
            side: OrderSide.BUY,
            quantity
          });
        }
      }
      // Check for bearish crossover (fast MA crosses below slow MA)
      else if (prevFastMA >= prevSlowMA && fastMA < slowMA) {
        const position = context.getPosition(symbol);
        
        // Only exit if we have a long position
        if (position && position.quantity > 0) {
          context.log(`SELL SIGNAL: Fast MA crossed below Slow MA - ${fastMA.toFixed(2)} < ${slowMA.toFixed(2)}`);
          context.placeOrder({
            symbol,
            type: OrderType.MARKET,
            side: OrderSide.SELL,
            quantity: position.quantity
          });
        }
      }
    }
  }
  
  /**
   * Handle position changes
   */
  onPositionChanged(position: any, context: BacktestContext): void {
    const { symbol, quantity, side } = position;
    
    if (quantity === 0) {
      // Position closed
      this.positions.set(symbol, null);
    } else {
      // Position opened or modified
      this.positions.set(symbol, side);
    }
  }
  
  /**
   * Update the moving averages with a new price
   */
  private updateMovingAverages(symbol: string, price: number): void {
    // Update fast MA values
    const fastValues = this.fastValues.get(symbol)!;
    fastValues.push(price);
    
    // Trim to keep only the required period plus one (for previous value)
    if (fastValues.length > this.fastPeriod + 1) {
      fastValues.shift();
    }
    
    // Update slow MA values
    const slowValues = this.slowValues.get(symbol)!;
    slowValues.push(price);
    
    // Trim to keep only the required period plus one (for previous value)
    if (slowValues.length > this.slowPeriod + 1) {
      slowValues.shift();
    }
    
    // Update the maps
    this.fastValues.set(symbol, fastValues);
    this.slowValues.set(symbol, slowValues);
  }
  
  /**
   * Check if we have enough data to calculate signals
   */
  private hasSufficientData(symbol: string): boolean {
    const fastValues = this.fastValues.get(symbol)!;
    const slowValues = this.slowValues.get(symbol)!;
    
    return fastValues.length >= this.fastPeriod + 1 && slowValues.length >= this.slowPeriod + 1;
  }
  
  /**
   * Get the latest moving average value
   */
  private getLatestMA(symbol: string, isFast: boolean): number {
    const values = isFast ? this.fastValues.get(symbol)! : this.slowValues.get(symbol)!;
    const period = isFast ? this.fastPeriod : this.slowPeriod;
    
    // Calculate simple moving average
    const prices = values.slice(-period);
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / period;
  }
  
  /**
   * Get the previous moving average value
   */
  private getPreviousMA(symbol: string, isFast: boolean): number {
    const values = isFast ? this.fastValues.get(symbol)! : this.slowValues.get(symbol)!;
    const period = isFast ? this.fastPeriod : this.slowPeriod;
    
    // Calculate previous simple moving average
    const prices = values.slice(-(period + 1), -1);
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / period;
  }
  
  /**
   * Calculate Simple Moving Average
   */
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return 0;
    }
    
    const relevantPrices = prices.slice(prices.length - period);
    const sum = relevantPrices.reduce((total, price) => total + price, 0);
    return sum / period;
  }
} 