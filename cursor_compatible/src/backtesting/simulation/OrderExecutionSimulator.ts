import { 
  Order, 
  OrderRequest, 
  OrderStatus, 
  OrderType, 
  OrderSide, 
  Fill, 
  OrderBook,
  Bar,
  Fee
} from '../models/types';
import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';

/**
 * Latency profile configurations for simulating different network conditions
 */
export enum LatencyProfile {
  HIGH_FREQUENCY = 'high_frequency', // < 10ms
  FAST = 'fast',                     // 10-50ms
  NORMAL = 'normal',                 // 50-200ms
  DEGRADED = 'degraded',             // 200-500ms
  POOR = 'poor',                     // 500-1000ms
  RANDOM = 'random'                  // Random variation
}

/**
 * Parameters for the latency model
 */
export interface LatencyModelParams {
  profile: LatencyProfile;
  minLatencyMs: number;
  maxLatencyMs: number;
  jitterMs?: number;
  probabilityOfTimeout?: number;
  timeoutMs?: number;
}

/**
 * Configuration for slippage model
 */
export interface SlippageModelParams {
  // Base slippage as percentage (e.g., 0.001 = 0.1%)
  baseSlippagePercent: number;
  
  // How much impact volatility has on slippage (multiplier)
  volatilityFactor: number;
  
  // How much impact order size has on slippage (multiplier)
  sizeFactor: number;
  
  // Maximum slippage allowed (percentage)
  maxSlippagePercent: number;
  
  // Probability of extreme slippage (e.g., flash crash/spike)
  extremeSlippageProbability?: number;
  
  // Multiplier for extreme slippage
  extremeSlippageMultiplier?: number;
}

/**
 * Parameters for the fill model
 */
export interface FillModelParams {
  // Probability of getting a partial fill
  partialFillProbability: number;
  
  // Minimum percentage of order to fill in partial fill scenario
  minPartialFillPercent: number;
  
  // Maximum number of partial fills before completing
  maxPartialFills: number;
  
  // Probability of order being rejected
  rejectionProbability: number;
  
  // Whether to simulate time-based fill delays
  enableTimedFills: boolean;
}

/**
 * Parameters for order book depth model
 */
export interface OrderBookDepthParams {
  // Minimum depth to consider for limit orders
  minDepth: number;
  
  // Whether to use real or synthetic order books
  useSyntheticBook: boolean;
  
  // Number of price levels to generate for synthetic book
  syntheticLevels: number;
  
  // Spread as percentage for synthetic book
  syntheticSpreadPercent: number;
}

/**
 * Fee model parameters
 */
export interface FeeModelParams {
  // Maker fee percentage (limit orders that provide liquidity)
  makerFeePercent: number;
  
  // Taker fee percentage (market orders or limit orders that take liquidity)
  takerFeePercent: number;
  
  // Fee currency (e.g., 'USD', 'BTC', or 'native' for the traded asset)
  feeCurrency: 'base' | 'quote' | 'USD';
}

/**
 * Execution simulator configuration
 */
export interface OrderExecutionSimulatorConfig {
  // Latency model parameters
  latencyModel: LatencyModelParams;
  
  // Slippage model parameters
  slippageModel: SlippageModelParams;
  
  // Fill model parameters
  fillModel: FillModelParams;
  
  // Order book depth model parameters
  orderBookModel: OrderBookDepthParams;
  
  // Fee model parameters
  feeModel: FeeModelParams;
  
  // Whether to enable logging of execution details
  verbose?: boolean;
  
  // Default exchange to simulate (can be overridden per order)
  exchange?: string;
  
  // Random seed for deterministic simulation
  seed?: number;
}

/**
 * Simulates order execution with realistic fills, slippage, and latency
 */
export class OrderExecutionSimulator extends EventEmitter {
  private config: OrderExecutionSimulatorConfig;
  private pendingOrders: Map<string, Order> = new Map();
  private orderBookCache: Map<string, OrderBook> = new Map();
  private lastPrices: Map<string, number> = new Map();
  private volatilityCache: Map<string, number> = new Map();
  private lastOrderId = 0;
  private random: () => number;
  
  /**
   * Creates a new order execution simulator
   */
  constructor(config: OrderExecutionSimulatorConfig) {
    super();
    this.config = config;
    
    // Initialize random number generator with seed if provided
    if (config.seed !== undefined) {
      let seed = config.seed;
      this.random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };
    } else {
      this.random = Math.random;
    }
  }
  
  /**
   * Submit an order to the simulator
   */
  async submitOrder(request: OrderRequest): Promise<Order> {
    // Generate a unique order ID
    const orderId = `order_${nanoid(12)}`;
    
    // Create a new order from the request
    const order: Order = {
      ...request,
      id: orderId,
      status: OrderStatus.CREATED,
      filledQuantity: 0,
      createTime: new Date(),
      updateTime: new Date(),
      fees: []
    };
    
    // Store the order
    this.pendingOrders.set(orderId, order);
    
    // Log the order creation
    if (this.config.verbose) {
      console.log(`[Simulator] Order created: ${orderId} (${order.side} ${order.quantity} ${order.symbol} @ ${order.price || 'market'})`);
    }
    
    // Emit order created event
    this.emit('orderCreated', order);
    
    // Simulate network latency for order submission
    const submissionLatency = this.simulateLatency('submission');
    await new Promise(resolve => setTimeout(resolve, submissionLatency));
    
    // Update order status to pending
    order.status = OrderStatus.PENDING;
    order.updateTime = new Date();
    this.emit('orderStatusChanged', order, OrderStatus.CREATED, OrderStatus.PENDING);
    
    // Check if the order might be rejected due to invalid parameters or other issues
    if (this.shouldRejectOrder(order)) {
      order.status = OrderStatus.REJECTED;
      order.updateTime = new Date();
      this.emit('orderStatusChanged', order, OrderStatus.PENDING, OrderStatus.REJECTED);
      this.pendingOrders.delete(orderId);
      
      if (this.config.verbose) {
        console.log(`[Simulator] Order rejected: ${orderId}`);
      }
      
      return order;
    }
    
    // Return the order immediately, execution happens asynchronously
    return order;
  }
  
  /**
   * Process an update to the market price
   */
  async processMarketUpdate(symbol: string, price: number, orderBook?: OrderBook, volatility?: number): Promise<void> {
    // Update last price
    this.lastPrices.set(symbol, price);
    
    // Update order book cache if provided
    if (orderBook) {
      this.orderBookCache.set(symbol, orderBook);
    }
    
    // Update volatility cache if provided
    if (volatility !== undefined) {
      this.volatilityCache.set(symbol, volatility);
    }
    
    // Find all pending orders for this symbol
    const ordersToProcess = Array.from(this.pendingOrders.values())
      .filter(order => order.symbol === symbol && order.status === OrderStatus.PENDING);
    
    // Process each order
    for (const order of ordersToProcess) {
      await this.processOrder(order, price, orderBook);
    }
  }
  
  /**
   * Process a pending order based on current market conditions
   */
  private async processOrder(order: Order, currentPrice: number, orderBook?: OrderBook): Promise<void> {
    // Skip if order is no longer pending
    if (order.status !== OrderStatus.PENDING) {
      return;
    }
    
    // Simulate execution latency
    const executionLatency = this.simulateLatency('execution');
    await new Promise(resolve => setTimeout(resolve, executionLatency));
    
    // Calculate fill price with slippage
    const fillPrice = this.calculateFillPrice(order, currentPrice, orderBook);
    
    // For limit orders, check if the price is acceptable
    if (order.type === OrderType.LIMIT) {
      const isExecutable = this.isLimitOrderExecutable(order, fillPrice);
      if (!isExecutable) {
        // Order stays in pending state
        return;
      }
    }
    
    // Determine how much of the order to fill
    const fillResult = this.calculateFillQuantity(order, fillPrice, orderBook);
    
    // If no fill, return early
    if (fillResult.fillQuantity <= 0) {
      return;
    }
    
    // Create fill record
    const fill: Fill = {
      orderId: order.id,
      tradeId: `trade_${nanoid(8)}`,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: fillResult.fillQuantity,
      timestamp: new Date(),
      fee: this.calculateFee(fillResult.fillQuantity, fillPrice, order)
    };
    
    // Update order
    order.filledQuantity += fillResult.fillQuantity;
    order.averagePrice = order.averagePrice 
      ? (order.averagePrice * (order.filledQuantity - fillResult.fillQuantity) + fillPrice * fillResult.fillQuantity) / order.filledQuantity 
      : fillPrice;
    
    // Add fee to order
    if (fill.fee) {
      order.fees = order.fees || [];
      order.fees.push(fill.fee);
    }
    
    // Update order status
    const previousStatus = order.status;
    if (Math.abs(order.filledQuantity - order.quantity) < 0.00000001) {
      // Order is completely filled
      order.status = OrderStatus.FILLED;
      this.pendingOrders.delete(order.id);
      
      if (this.config.verbose) {
        console.log(`[Simulator] Order filled: ${order.id} (${fill.quantity} @ ${fill.price})`);
      }
    } else {
      // Order is partially filled
      order.status = OrderStatus.PARTIAL;
      
      if (this.config.verbose) {
        console.log(`[Simulator] Order partially filled: ${order.id} (${fill.quantity}/${order.quantity} @ ${fill.price})`);
      }
    }
    
    order.updateTime = new Date();
    
    // Emit events
    this.emit('fill', fill);
    this.emit('orderStatusChanged', order, previousStatus, order.status);
    
    // If partially filled and we should finish in multiple fills
    if (order.status === OrderStatus.PARTIAL && this.shouldSimulateMultipleFills(order)) {
      // Schedule next fill with a delay
      const nextFillDelay = this.calculateNextFillDelay(order);
      setTimeout(() => {
        this.processOrder(order, currentPrice, orderBook);
      }, nextFillDelay);
    }
  }
  
  /**
   * Cancel a pending order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    // Find the order
    const order = this.pendingOrders.get(orderId);
    
    // If order doesn't exist or is already in a final state
    if (!order || [OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED, OrderStatus.EXPIRED].includes(order.status)) {
      return false;
    }
    
    // Simulate network latency for cancellation
    const cancellationLatency = this.simulateLatency('cancellation');
    await new Promise(resolve => setTimeout(resolve, cancellationLatency));
    
    // Small chance that the order fills before cancellation can be processed
    if (this.random() < 0.05 && order.status === OrderStatus.PENDING) {
      // Order got filled just before cancellation
      const currentPrice = this.lastPrices.get(order.symbol) || (order.price || 0);
      const orderBook = this.orderBookCache.get(order.symbol);
      
      await this.processOrder(order, currentPrice, orderBook);
      
      // If the order was fully filled, cancellation fails
      if (order.status.toString() === OrderStatus.FILLED.toString()) {
        return false;
      }
    }
    
    // Update order status
    const previousStatus = order.status;
    order.status = OrderStatus.CANCELED;
    order.updateTime = new Date();
    
    // Remove from pending orders
    this.pendingOrders.delete(orderId);
    
    // Emit event
    this.emit('orderStatusChanged', order, previousStatus, OrderStatus.CANCELED);
    
    if (this.config.verbose) {
      console.log(`[Simulator] Order canceled: ${orderId}`);
    }
    
    return true;
  }
  
  /**
   * Simulate network and system latency
   */
  private simulateLatency(operation: 'submission' | 'execution' | 'cancellation'): number {
    const { profile, minLatencyMs, maxLatencyMs, jitterMs, probabilityOfTimeout } = this.config.latencyModel;
    
    // Check for timeout
    if (probabilityOfTimeout && this.random() < probabilityOfTimeout) {
      // Simulate a timeout by returning a very large latency
      return this.config.latencyModel.timeoutMs || 30000;
    }
    
    // Base latency by profile
    let baseLatency: number;
    
    switch (profile) {
      case LatencyProfile.HIGH_FREQUENCY:
        baseLatency = 5;
        break;
      case LatencyProfile.FAST:
        baseLatency = 30;
        break;
      case LatencyProfile.NORMAL:
        baseLatency = 100;
        break;
      case LatencyProfile.DEGRADED:
        baseLatency = 350;
        break;
      case LatencyProfile.POOR:
        baseLatency = 750;
        break;
      case LatencyProfile.RANDOM:
        baseLatency = minLatencyMs + this.random() * (maxLatencyMs - minLatencyMs);
        break;
      default:
        baseLatency = 100; // Default to normal
    }
    
    // Add operation-specific adjustments
    if (operation === 'submission') {
      // Order submission might be slightly faster
      baseLatency *= 0.9;
    } else if (operation === 'cancellation') {
      // Cancellations might be slightly slower
      baseLatency *= 1.1;
    }
    
    // Add jitter if configured
    if (jitterMs) {
      baseLatency += (this.random() * 2 - 1) * jitterMs;
    }
    
    // Ensure within limits
    return Math.max(minLatencyMs, Math.min(maxLatencyMs, baseLatency));
  }
  
  /**
   * Determine if a limit order is executable at the given price
   */
  private isLimitOrderExecutable(order: Order, currentPrice: number): boolean {
    if (!order.price) {
      return false; // Limit orders must have a price
    }
    
    // For buy orders, the current price must be less than or equal to the limit price
    if (order.side === OrderSide.BUY) {
      return currentPrice <= order.price;
    }
    
    // For sell orders, the current price must be greater than or equal to the limit price
    return currentPrice >= order.price;
  }
  
  /**
   * Calculate the fill price including slippage
   */
  private calculateFillPrice(order: Order, currentPrice: number, orderBook?: OrderBook): number {
    const { baseSlippagePercent, volatilityFactor, sizeFactor, maxSlippagePercent, extremeSlippageProbability, extremeSlippageMultiplier } = this.config.slippageModel;
    
    // Get the symbol's volatility (default to 0.01 if not available)
    const volatility = this.volatilityCache.get(order.symbol) || 0.01;
    
    // Base slippage percentage (adjust based on order size and volatility)
    let slippagePercent = baseSlippagePercent;
    
    // Adjust for volatility
    slippagePercent += volatility * volatilityFactor;
    
    // Get typical order size for this symbol (default to order quantity)
    const typicalOrderSize = 1; // This should be determined based on market data
    
    // Adjust for order size
    const relativeSizeImpact = (order.quantity / typicalOrderSize) * sizeFactor;
    slippagePercent += relativeSizeImpact;
    
    // Ensure slippage doesn't exceed maximum
    slippagePercent = Math.min(slippagePercent, maxSlippagePercent);
    
    // Check for extreme slippage events (e.g., flash crash/spike)
    if (extremeSlippageProbability && extremeSlippageMultiplier && this.random() < extremeSlippageProbability) {
      slippagePercent *= extremeSlippageMultiplier;
    }
    
    // Adjust slippage sign based on order side
    const slippageDirection = order.side === OrderSide.BUY ? 1 : -1;
    
    // If we have order book data, try to calculate a more accurate fill price
    if (orderBook) {
      return this.calculateFillPriceFromOrderBook(order, orderBook);
    }
    
    // Calculate fill price with slippage
    return currentPrice * (1 + slippageDirection * slippagePercent);
  }
  
  /**
   * Calculate fill price using order book depth
   */
  private calculateFillPriceFromOrderBook(order: Order, orderBook: OrderBook): number {
    // For limit orders, respect the limit price
    if (order.type === OrderType.LIMIT && order.price) {
      if (order.side === OrderSide.BUY) {
        // Cannot buy above limit price
        const maxPrice = order.price;
        
        // Find the minimum price needed to fill the order
        let remainingQuantity = order.quantity - order.filledQuantity;
        let totalCost = 0;
        
        for (const ask of orderBook.asks) {
          if (ask.price > maxPrice) {
            // Price exceeds limit
            break;
          }
          
          const fillQuantity = Math.min(remainingQuantity, ask.volume);
          totalCost += fillQuantity * ask.price;
          remainingQuantity -= fillQuantity;
          
          if (remainingQuantity <= 0) {
            break;
          }
        }
        
        if (remainingQuantity > 0) {
          // Not enough liquidity within price limit
          // Return the limit price (even though we can't fully fill at this price)
          return maxPrice;
        }
        
        // Calculate average fill price
        const avgPrice = totalCost / (order.quantity - order.filledQuantity);
        return avgPrice;
      } else {
        // Cannot sell below limit price
        const minPrice = order.price;
        
        // Find the maximum price we can get for selling
        let remainingQuantity = order.quantity - order.filledQuantity;
        let totalRevenue = 0;
        
        for (const bid of orderBook.bids) {
          if (bid.price < minPrice) {
            // Price below limit
            break;
          }
          
          const fillQuantity = Math.min(remainingQuantity, bid.volume);
          totalRevenue += fillQuantity * bid.price;
          remainingQuantity -= fillQuantity;
          
          if (remainingQuantity <= 0) {
            break;
          }
        }
        
        if (remainingQuantity > 0) {
          // Not enough liquidity within price limit
          // Return the limit price (even though we can't fully fill at this price)
          return minPrice;
        }
        
        // Calculate average fill price
        const avgPrice = totalRevenue / (order.quantity - order.filledQuantity);
        return avgPrice;
      }
    }
    
    // For market orders, simulate walking the order book
    if (order.side === OrderSide.BUY) {
      let remainingQuantity = order.quantity - order.filledQuantity;
      let totalCost = 0;
      
      for (const ask of orderBook.asks) {
        const fillQuantity = Math.min(remainingQuantity, ask.volume);
        totalCost += fillQuantity * ask.price;
        remainingQuantity -= fillQuantity;
        
        if (remainingQuantity <= 0) {
          break;
        }
      }
      
      if (remainingQuantity > 0) {
        // Not enough liquidity in the order book
        // Use the last ask price with a slippage multiplier for the remaining quantity
        const lastAskPrice = orderBook.asks[orderBook.asks.length - 1]?.price || this.lastPrices.get(order.symbol) || 0;
        totalCost += remainingQuantity * lastAskPrice * 1.1; // 10% penalty for exceeding order book depth
      }
      
      // Calculate average fill price
      const avgPrice = totalCost / (order.quantity - order.filledQuantity);
      return avgPrice;
    } else {
      let remainingQuantity = order.quantity - order.filledQuantity;
      let totalRevenue = 0;
      
      for (const bid of orderBook.bids) {
        const fillQuantity = Math.min(remainingQuantity, bid.volume);
        totalRevenue += fillQuantity * bid.price;
        remainingQuantity -= fillQuantity;
        
        if (remainingQuantity <= 0) {
          break;
        }
      }
      
      if (remainingQuantity > 0) {
        // Not enough liquidity in the order book
        // Use the last bid price with a slippage multiplier for the remaining quantity
        const lastBidPrice = orderBook.bids[orderBook.bids.length - 1]?.price || this.lastPrices.get(order.symbol) || 0;
        totalRevenue += remainingQuantity * lastBidPrice * 0.9; // 10% penalty for exceeding order book depth
      }
      
      // Calculate average fill price
      const avgPrice = totalRevenue / (order.quantity - order.filledQuantity);
      return avgPrice;
    }
  }
  
  /**
   * Calculate how much of the order to fill
   */
  private calculateFillQuantity(order: Order, fillPrice: number, orderBook?: OrderBook): { fillQuantity: number, complete: boolean } {
    const remainingQuantity = order.quantity - order.filledQuantity;
    
    // For limit orders, check if the price is acceptable
    if (order.type === OrderType.LIMIT && order.price) {
      if ((order.side === OrderSide.BUY && fillPrice > order.price) || 
          (order.side === OrderSide.SELL && fillPrice < order.price)) {
        // Price exceeds limit, no fill
        return { fillQuantity: 0, complete: false };
      }
    }
    
    // If we should simulate partial fills
    if (this.config.fillModel.enableTimedFills && this.random() < this.config.fillModel.partialFillProbability) {
      // Calculate a partial fill amount
      const partialPercent = this.config.fillModel.minPartialFillPercent + 
        this.random() * (1 - this.config.fillModel.minPartialFillPercent);
      
      const fillQuantity = remainingQuantity * partialPercent;
      
      return { 
        fillQuantity, 
        complete: Math.abs(fillQuantity - remainingQuantity) < 0.00000001
      };
    }
    
    // If using order book, check liquidity
    if (orderBook) {
      let availableLiquidity = 0;
      
      if (order.side === OrderSide.BUY) {
        // Sum up ask volumes at or below the fill price
        for (const ask of orderBook.asks) {
          if (ask.price <= fillPrice) {
            availableLiquidity += ask.volume;
          }
        }
      } else {
        // Sum up bid volumes at or above the fill price
        for (const bid of orderBook.bids) {
          if (bid.price >= fillPrice) {
            availableLiquidity += bid.volume;
          }
        }
      }
      
      // If not enough liquidity, partial fill
      if (availableLiquidity < remainingQuantity) {
        return { 
          fillQuantity: availableLiquidity, 
          complete: false 
        };
      }
    }
    
    // Default to full fill
    return { 
      fillQuantity: remainingQuantity, 
      complete: true 
    };
  }
  
  /**
   * Calculate fee for a fill
   */
  private calculateFee(quantity: number, price: number, order: Order): Fee | undefined {
    const { makerFeePercent, takerFeePercent, feeCurrency } = this.config.feeModel;
    
    // Determine if this is a maker or taker order
    const isMaker = order.type === OrderType.LIMIT && order.price !== undefined;
    const feePercent = isMaker ? makerFeePercent : takerFeePercent;
    
    // Calculate fee amount
    const feeAmount = quantity * price * feePercent;
    
    // Determine fee asset
    let feeAsset: string;
    if (feeCurrency === 'base') {
      // Base currency (e.g., BTC in BTC/USD)
      feeAsset = order.symbol.split('/')[0];
    } else if (feeCurrency === 'quote') {
      // Quote currency (e.g., USD in BTC/USD)
      feeAsset = order.symbol.split('/')[1] || 'USD';
    } else {
      // Default to USD
      feeAsset = 'USD';
    }
    
    return {
      asset: feeAsset,
      amount: feeAmount,
      feeRate: feePercent
    };
  }
  
  /**
   * Determine if an order should be rejected
   */
  private shouldRejectOrder(order: Order): boolean {
    // Random rejection based on configured probability
    if (this.random() < this.config.fillModel.rejectionProbability) {
      return true;
    }
    
    // Check order validity
    if (order.quantity <= 0) {
      return true;
    }
    
    if (order.type === OrderType.LIMIT && (!order.price || order.price <= 0)) {
      return true;
    }
    
    // Check if we have price data for this symbol
    if (!this.lastPrices.has(order.symbol)) {
      return false; // Don't reject just because we don't have price data yet
    }
    
    return false;
  }
  
  /**
   * Determine if we should simulate multiple fills for an order
   */
  private shouldSimulateMultipleFills(order: Order): boolean {
    // Only do multiple fills if configured
    if (!this.config.fillModel.enableTimedFills) {
      return false;
    }
    
    // Don't do multiple fills if already at the maximum
    const currentFillCount = order.fees?.length || 0;
    if (currentFillCount >= this.config.fillModel.maxPartialFills) {
      return false;
    }
    
    // More likely to do multiple fills for large orders
    const typicalOrderSize = 1; // This should be determined based on market data
    const sizeFactor = Math.min(order.quantity / typicalOrderSize, 5);
    
    return this.random() < 0.3 * sizeFactor;
  }
  
  /**
   * Calculate delay until next fill for partial fills
   */
  private calculateNextFillDelay(order: Order): number {
    // Determine a random delay between 500ms and 5000ms
    return 500 + this.random() * 4500;
  }
  
  /**
   * Update volatility for a symbol
   */
  updateVolatility(symbol: string, volatility: number): void {
    this.volatilityCache.set(symbol, volatility);
  }
  
  /**
   * Get all pending orders
   */
  getPendingOrders(): Order[] {
    return Array.from(this.pendingOrders.values());
  }
  
  /**
   * Get pending orders for a specific symbol
   */
  getPendingOrdersForSymbol(symbol: string): Order[] {
    return Array.from(this.pendingOrders.values())
      .filter(order => order.symbol === symbol);
  }
  
  /**
   * Clear all pending orders (useful for reset or testing)
   */
  clearPendingOrders(): void {
    this.pendingOrders.clear();
  }
  
  /**
   * Get simulator configuration
   */
  getConfig(): OrderExecutionSimulatorConfig {
    return { ...this.config };
  }
  
  /**
   * Update simulator configuration
   */
  updateConfig(config: Partial<OrderExecutionSimulatorConfig>): void {
    this.config = { ...this.config, ...config };
  }
} 