import { OrderBook, OrderBookLevel } from '../models/types';

/**
 * Parameters for synthetic order book generation
 */
export interface OrderBookGeneratorParams {
  // Number of price levels to generate on each side
  levels: number;
  
  // Spread as percentage of price
  spreadPercent: number;
  
  // Depth decay factor - how quickly volume decreases away from the mid price
  depthDecayFactor: number;
  
  // Randomness factor for volume (0-1)
  volumeRandomness: number;
  
  // Base volume at best bid/ask level
  baseVolume: number;
  
  // Price increment between levels as percentage of price
  priceIncrementPercent: number;
  
  // Random seed for deterministic generation (optional)
  seed?: number;
}

/**
 * Generates realistic synthetic order books for simulation
 */
export class OrderBookGenerator {
  private params: OrderBookGeneratorParams;
  private random: () => number;
  private seed: number;
  
  /**
   * Create a new order book generator
   */
  constructor(params: Partial<OrderBookGeneratorParams> = {}) {
    // Default parameters
    this.params = {
      levels: params.levels ?? 10,
      spreadPercent: params.spreadPercent ?? 0.001, // 0.1%
      depthDecayFactor: params.depthDecayFactor ?? 0.8,
      volumeRandomness: params.volumeRandomness ?? 0.3,
      baseVolume: params.baseVolume ?? 1.0,
      priceIncrementPercent: params.priceIncrementPercent ?? 0.0002, // 0.02%
      seed: params.seed
    };
    
    // Initialize random number generator
    this.seed = this.params.seed ?? Math.floor(Math.random() * 1000000);
    if (this.params.seed !== undefined) {
      let seed = this.params.seed;
      this.random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };
    } else {
      this.random = Math.random;
    }
  }
  
  /**
   * Generate a synthetic order book
   * 
   * @param symbol The symbol to generate for
   * @param price The mid price to build around
   * @param timestamp The timestamp for the order book
   * @param volatility Optional volatility to adjust spread (higher = wider spread)
   * @returns A synthetic order book
   */
  generateOrderBook(
    symbol: string,
    price: number,
    timestamp: Date = new Date(),
    volatility?: number
  ): OrderBook {
    // Adjust spread based on volatility if provided
    const effectiveSpread = volatility 
      ? this.params.spreadPercent * (1 + volatility * 10)
      : this.params.spreadPercent;
    
    // Calculate bid and ask prices
    const halfSpread = (price * effectiveSpread) / 2;
    const bestBidPrice = price - halfSpread;
    const bestAskPrice = price + halfSpread;
    
    // Generate bids and asks
    const bids = this.generateLevels(bestBidPrice, false);
    const asks = this.generateLevels(bestAskPrice, true);
    
    return {
      symbol,
      timestamp,
      bids,
      asks
    };
  }
  
  /**
   * Generate price levels for one side of the book
   * 
   * @param startPrice The best price to start from
   * @param isAsk Whether this is the ask side (true) or bid side (false)
   * @returns Array of order book levels
   */
  private generateLevels(startPrice: number, isAsk: boolean): OrderBookLevel[] {
    const levels: OrderBookLevel[] = [];
    
    // Direction multiplier: -1 for bids (decreasing), +1 for asks (increasing)
    const direction = isAsk ? 1 : -1;
    
    // Generate levels
    for (let i = 0; i < this.params.levels; i++) {
      // Calculate price for this level
      const priceOffset = direction * i * startPrice * this.params.priceIncrementPercent;
      const price = startPrice + priceOffset;
      
      // Calculate volume for this level
      // Volume decreases as we move away from the best price
      const depthFactor = Math.pow(this.params.depthDecayFactor, i);
      
      // Add some randomness to the volume
      const randomFactor = 1 + (this.random() * 2 - 1) * this.params.volumeRandomness;
      
      // Calculate final volume
      const volume = this.params.baseVolume * depthFactor * randomFactor;
      
      // Add the level
      levels.push({
        price,
        volume,
        orders: Math.floor(3 + this.random() * 10) // Random number of orders
      });
    }
    
    return levels;
  }
  
  /**
   * Update an existing order book with new market activity
   * 
   * @param book The existing order book
   * @param price The new mid price
   * @param volumeProfile The volume profile (0-1, higher = more volume)
   * @param timestamp New timestamp
   * @returns Updated order book
   */
  updateOrderBook(
    book: OrderBook,
    price: number,
    volumeProfile: number = 0.5,
    timestamp: Date = new Date()
  ): OrderBook {
    // Calculate the new best bid and ask prices
    const halfSpread = (price * this.params.spreadPercent) / 2;
    const newBestBid = price - halfSpread;
    const newBestAsk = price + halfSpread;
    
    // Get old best prices
    const oldBestBid = book.bids[0]?.price || 0;
    const oldBestAsk = book.asks[0]?.price || Infinity;
    
    // Determine price change
    const bidPriceChange = newBestBid - oldBestBid;
    const askPriceChange = newBestAsk - oldBestAsk;
    
    // Update bids and asks with price change
    const updatedBids = this.updatePriceLevels(book.bids, bidPriceChange, volumeProfile, false);
    const updatedAsks = this.updatePriceLevels(book.asks, askPriceChange, volumeProfile, true);
    
    return {
      symbol: book.symbol,
      timestamp,
      bids: updatedBids,
      asks: updatedAsks
    };
  }
  
  /**
   * Update price levels based on price change
   */
  private updatePriceLevels(
    levels: OrderBookLevel[],
    priceChange: number,
    volumeProfile: number,
    isAsk: boolean
  ): OrderBookLevel[] {
    // If no levels, return empty array
    if (levels.length === 0) return [];
    
    // Update each level
    return levels.map((level, index) => {
      // Update price
      const newPrice = level.price + priceChange;
      
      // Update volume with some randomness
      const volumeChangePct = (this.random() * 2 - 1) * 0.2; // ±20% change
      const volumeMultiplier = 1 + volumeChangePct * volumeProfile;
      const newVolume = Math.max(0.00001, level.volume * volumeMultiplier);
      
      // Sometimes change the number of orders
      const orderChange = Math.random() > 0.7 ? Math.floor(this.random() * 5) - 2 : 0;
      const newOrders = Math.max(1, (level.orders || 1) + orderChange);
      
      return {
        price: newPrice,
        volume: newVolume,
        orders: newOrders
      };
    });
  }
  
  /**
   * Generate realistic order book with imbalance
   * 
   * @param symbol The symbol to generate for
   * @param price The current price
   * @param imbalance -1 to 1 value indicating buy/sell pressure (-1 = strong sell, 1 = strong buy)
   * @param timestamp Timestamp for the order book
   * @returns Order book with buy/sell imbalance
   */
  generateImbalancedOrderBook(
    symbol: string,
    price: number,
    imbalance: number,
    timestamp: Date = new Date()
  ): OrderBook {
    // Clamp imbalance to [-1, 1]
    imbalance = Math.max(-1, Math.min(1, imbalance));
    
    // Generate base order book
    const book = this.generateOrderBook(symbol, price, timestamp);
    
    // Calculate volume adjustments based on imbalance
    const bidMultiplier = 1 + imbalance;
    const askMultiplier = 1 - imbalance;
    
    // Apply volume adjustments
    book.bids = book.bids.map(level => ({
      ...level,
      volume: level.volume * bidMultiplier
    }));
    
    book.asks = book.asks.map(level => ({
      ...level,
      volume: level.volume * askMultiplier
    }));
    
    return book;
  }
  
  /**
   * Get the current parameters
   */
  getParams(): OrderBookGeneratorParams {
    return { ...this.params };
  }
  
  /**
   * Update generator parameters
   */
  updateParams(params: Partial<OrderBookGeneratorParams>): void {
    this.params = { ...this.params, ...params };
    
    // Update seed if provided
    if (params.seed !== undefined) {
      this.seed = params.seed;
      let seed = params.seed;
      this.random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };
    }
  }
} 