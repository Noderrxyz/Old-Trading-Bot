import { AdaptiveStrategy, Signal, StrategyContext, StrategyParameters } from './AdaptiveStrategy';
import { OrderBookManager, OrderSide } from '../execution/OrderBookManager';
import { MarketRegime, MarketFeatures } from '../regime/RegimeClassifier';
import { logger } from '../utils/logger';

/**
 * Parameters for the OrderBookStrategy
 */
export interface OrderBookStrategyParameters extends StrategyParameters {
  /** The number of levels to consider in order book */
  depth: number;
  /** Imbalance threshold to generate buy signals */
  buyThreshold: number;
  /** Imbalance threshold to generate sell signals */
  sellThreshold: number;
  /** VWAP size to consider (amount of asset to execute) */
  vwapSize: number;
  /** Threshold for price deviation from mid price (as percentage) */
  priceDeviationThreshold: number;
}

/**
 * Default parameters for the OrderBookStrategy
 */
export const DEFAULT_ORDER_BOOK_PARAMETERS: OrderBookStrategyParameters = {
  depth: 10,
  buyThreshold: 0.6,  // Positive value indicates bid-heavy book
  sellThreshold: 0.4, // Value below this indicates ask-heavy book  
  vwapSize: 1.0,      // Size in base currency units
  priceDeviationThreshold: 0.002, // 0.2% deviation from mid price
};

/**
 * Parameter ranges for optimization
 */
export const ORDER_BOOK_PARAMETER_RANGES = {
  depth: { min: 5, max: 20, step: 5 },
  buyThreshold: { min: 0.55, max: 0.75, step: 0.05 },
  sellThreshold: { min: 0.25, max: 0.45, step: 0.05 },
  vwapSize: { min: 0.5, max: 2.0, step: 0.5 },
  priceDeviationThreshold: { min: 0.001, max: 0.005, step: 0.001 }
};

/**
 * Strategy that uses order book data to generate signals
 * Analyzes order book imbalance and liquidity to make trading decisions
 */
export class OrderBookStrategy extends AdaptiveStrategy {
  private orderBookManager: OrderBookManager;

  /**
   * Constructor for the OrderBookStrategy
   */
  constructor() {
    super(
      'order_book_strategy',
      DEFAULT_ORDER_BOOK_PARAMETERS,
      ORDER_BOOK_PARAMETER_RANGES
    );
    
    try {
      this.orderBookManager = OrderBookManager.getInstance();
      logger.info('OrderBookStrategy initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize OrderBookStrategy:', error);
      throw new Error('Failed to initialize OrderBookStrategy: OrderBookManager not available');
    }
  }

  /**
   * Generate a trading signal based on order book data
   * @param context The strategy context including symbol, features, and parameters
   * @returns A trading signal or null if no signal
   */
  protected async executeStrategy(context: StrategyContext): Promise<Signal | null> {
    try {
      const { symbol, parameters } = context;
      const params = parameters as OrderBookStrategyParameters;

      // Get order book data
      const imbalance = this.orderBookManager.calculateImbalance(symbol, params.depth);
      if (imbalance === null) {
        logger.warn(`OrderBookStrategy: Could not get imbalance for ${symbol}`);
        return null;
      }

      const midPrice = this.orderBookManager.getMidPrice(symbol);
      if (midPrice === null) {
        logger.warn(`OrderBookStrategy: Could not get mid price for ${symbol}`);
        return null;
      }

      // Calculate potential execution prices
      const bidVwap = this.orderBookManager.getVWAP(symbol, params.vwapSize, OrderSide.Bid);
      const askVwap = this.orderBookManager.getVWAP(symbol, params.vwapSize, OrderSide.Ask);
      
      if (bidVwap === null || askVwap === null) {
        logger.warn(`OrderBookStrategy: Could not get VWAP for ${symbol}`);
        return null;
      }

      // Calculate price deviations
      const bidDeviation = (midPrice - bidVwap) / midPrice;
      const askDeviation = (askVwap - midPrice) / midPrice;

      // Determine signal direction and strength
      let direction: 'buy' | 'sell' | 'neutral' = 'neutral';
      let strength = 0;

      // Check for buy signal
      if (imbalance > params.buyThreshold) {
        direction = 'buy';
        
        // Calculate strength based on how far above threshold
        strength = Math.min(0.3 + (imbalance - params.buyThreshold) / (1 - params.buyThreshold) * 0.7, 1);
        
        // Adjust strength if price impact is small
        if (askDeviation < params.priceDeviationThreshold) {
          strength = Math.min(strength * 1.5, 1);
        }
      } 
      // Check for sell signal
      else if (imbalance < params.sellThreshold) {
        direction = 'sell';
        
        // Calculate strength based on how far below threshold
        strength = Math.min(0.3 + (params.sellThreshold - imbalance) / params.sellThreshold * 0.7, 1);
        
        // Adjust strength if price impact is small
        if (bidDeviation < params.priceDeviationThreshold) {
          strength = Math.min(strength * 1.5, 1);
        }
      }

      // No signal if direction is neutral
      if (direction === 'neutral') {
        return null;
      }

      // Create and return the signal
      return {
        symbol,
        direction,
        strength,
        timestamp: new Date(),
        meta: {
          imbalance,
          midPrice,
          bidVwap,
          askVwap,
          bidDeviation,
          askDeviation,
          regime: context.regime,
        }
      };
    } catch (error) {
      logger.error(`OrderBookStrategy: Error generating signal for ${context.symbol}:`, error);
      return null;
    }
  }

  /**
   * Get the type of strategy
   * @returns The strategy type string
   */
  protected getStrategyType(): string {
    return 'order_book';
  }

  /**
   * Get tags for this strategy
   * @returns Array of strategy tags
   */
  protected getStrategyTags(): string[] {
    return ['liquidity', 'microstructure', 'order_book'];
  }

  /**
   * Get the current parameters for a specific symbol and regime
   * @param symbol - The trading symbol
   * @param regime - The market regime
   * @returns The strategy parameters for the given symbol and regime
   */
  public getParameters(symbol: string, regime: MarketRegime): OrderBookStrategyParameters {
    return this.getOptimizedParameters(symbol, regime) as OrderBookStrategyParameters;
  }
} 