import { 
  Bar, 
  Fill, 
  Order, 
  OrderBook, 
  OrderSide, 
  OrderStatus, 
  OrderType, 
  Tick 
} from '../models/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Configuration options for the market simulator
 */
export interface MarketSimulatorOptions {
  commission?: number | ((order: Order) => number);
  slippage?: number | ((order: Order) => number);
  executionDelay?: number;
  partialFillProbability?: number;
  partialFillMinRatio?: number;
  partialFillMaxRatio?: number;
  liquidityConstraint?: boolean;
  simulateMarketImpact?: boolean;
  marketImpactFactor?: number;
}

/**
 * Simulates exchange behavior with order matching
 */
export class MarketSimulator {
  private options: MarketSimulatorOptions;
  private orders: Map<string, Order> = new Map();
  private lastPrices: Map<string, number> = new Map();
  private orderBooks: Map<string, OrderBook> = new Map();
  private pendingFills: Fill[] = [];
  private callbacks: {
    onFill?: (fill: Fill) => void;
    onOrderUpdate?: (order: Order) => void;
  } = {};
  
  constructor(options: MarketSimulatorOptions = {}) {
    this.options = {
      commission: 0,
      slippage: 0,
      executionDelay: 0,
      partialFillProbability: 0.2,
      partialFillMinRatio: 0.1,
      partialFillMaxRatio: 0.9,
      liquidityConstraint: false,
      simulateMarketImpact: false,
      marketImpactFactor: 0.0001,
      ...options
    };
  }
  
  /**
   * Update the last price for a symbol
   */
  updatePrice(symbol: string, price: number): void {
    this.lastPrices.set(symbol, price);
  }
  
  /**
   * Update the order book for a symbol
   */
  updateOrderBook(orderBook: OrderBook): void {
    this.orderBooks.set(orderBook.symbol, orderBook);
    
    // Also update last price based on mid price
    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      const midPrice = (orderBook.bids[0].price + orderBook.asks[0].price) / 2;
      this.lastPrices.set(orderBook.symbol, midPrice);
    }
  }
  
  /**
   * Get the last price for a symbol
   */
  getLastPrice(symbol: string): number | null {
    return this.lastPrices.get(symbol) ?? null;
  }
  
  /**
   * Get the current order book for a symbol
   */
  getOrderBook(symbol: string): OrderBook | null {
    return this.orderBooks.get(symbol) ?? null;
  }
  
  /**
   * Place a new order
   */
  placeOrder(order: Order): string {
    // Update order status
    const updatedOrder: Order = {
      ...order,
      status: OrderStatus.PENDING,
      updateTime: new Date()
    };
    
    // Store the order
    this.orders.set(order.id, updatedOrder);
    
    // Try to execute the order immediately if it's a market order
    if (order.type === OrderType.MARKET) {
      this.tryExecuteOrder(updatedOrder);
    }
    
    return order.id;
  }
  
  /**
   * Cancel an existing order
   */
  cancelOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    
    if (!order) {
      return false;
    }
    
    if (order.status === OrderStatus.FILLED || 
        order.status === OrderStatus.CANCELED || 
        order.status === OrderStatus.REJECTED) {
      return false;
    }
    
    // Update order status
    const updatedOrder: Order = {
      ...order,
      status: OrderStatus.CANCELED,
      updateTime: new Date()
    };
    
    // Update the order
    this.orders.set(orderId, updatedOrder);
    
    // Notify about the update
    if (this.callbacks.onOrderUpdate) {
      this.callbacks.onOrderUpdate(updatedOrder);
    }
    
    return true;
  }
  
  /**
   * Get an order by ID
   */
  getOrder(orderId: string): Order | null {
    return this.orders.get(orderId) || null;
  }
  
  /**
   * Get orders that match a filter
   */
  getOrders(filter?: { symbol?: string; status?: string | string[] }): Order[] {
    let orders = Array.from(this.orders.values());
    
    if (filter) {
      // Filter by symbol
      if (filter.symbol) {
        orders = orders.filter(order => order.symbol === filter.symbol);
      }
      
      // Filter by status
      if (filter.status) {
        if (Array.isArray(filter.status)) {
          orders = orders.filter(order => filter.status!.includes(order.status));
        } else {
          orders = orders.filter(order => order.status === filter.status);
        }
      }
    }
    
    return orders;
  }
  
  /**
   * Get open orders for a symbol
   */
  getOpenOrders(symbol?: string): Order[] {
    const openStatuses = [
      OrderStatus.CREATED, 
      OrderStatus.PENDING, 
      OrderStatus.PARTIAL
    ];
    
    return this.getOrders({
      symbol,
      status: openStatuses
    });
  }
  
  /**
   * Process a bar to potentially execute orders
   */
  processBar(bar: Bar): void {
    const { symbol, open, high, low, close } = bar;
    
    // Update the last price
    this.updatePrice(symbol, close);
    
    // Get all open orders for this symbol
    const openOrders = this.getOpenOrders(symbol);
    
    for (const order of openOrders) {
      // Skip orders that aren't for this symbol
      if (order.symbol !== symbol) {
        continue;
      }
      
      // Try to execute the order based on price levels in the bar
      this.tryExecuteOrderWithBarPrices(order, open, high, low, close);
    }
    
    // Process any pending fills
    this.processPendingFills();
  }
  
  /**
   * Process a tick to potentially execute orders
   */
  processTick(tick: Tick): void {
    const { symbol, price } = tick;
    
    // Update the last price
    this.updatePrice(symbol, price);
    
    // Get all open orders for this symbol
    const openOrders = this.getOpenOrders(symbol);
    
    for (const order of openOrders) {
      // Skip orders that aren't for this symbol
      if (order.symbol !== symbol) {
        continue;
      }
      
      // Try to execute the order at the tick price
      this.tryExecuteOrderAtPrice(order, price);
    }
    
    // Process any pending fills
    this.processPendingFills();
  }
  
  /**
   * Process an order book to potentially execute orders
   */
  processOrderBook(orderBook: OrderBook): void {
    const { symbol } = orderBook;
    
    // Update the order book
    this.updateOrderBook(orderBook);
    
    // Get all open orders for this symbol
    const openOrders = this.getOpenOrders(symbol);
    
    for (const order of openOrders) {
      // Skip orders that aren't for this symbol
      if (order.symbol !== symbol) {
        continue;
      }
      
      // Try to execute the order using the order book
      this.tryExecuteOrderWithOrderBook(order, orderBook);
    }
    
    // Process any pending fills
    this.processPendingFills();
  }
  
  /**
   * Process orders (used when no specific market data is available)
   */
  processOrders(marketData?: Bar | Tick): void {
    // Get all open orders
    const openOrders = this.getOpenOrders();
    
    for (const order of openOrders) {
      // Try to execute the order using the last price
      const lastPrice = this.lastPrices.get(order.symbol);
      
      if (lastPrice) {
        this.tryExecuteOrderAtPrice(order, lastPrice);
      }
    }
    
    // Process any pending fills
    this.processPendingFills();
  }
  
  /**
   * Try to execute an order
   */
  private tryExecuteOrder(order: Order): void {
    // Skip orders that aren't open
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PARTIAL) {
      return;
    }
    
    // Get the last price for the symbol
    const lastPrice = this.lastPrices.get(order.symbol);
    
    if (lastPrice) {
      this.tryExecuteOrderAtPrice(order, lastPrice);
    }
  }
  
  /**
   * Try to execute an order at a specific price
   */
  private tryExecuteOrderAtPrice(order: Order, price: number): void {
    // Skip orders that aren't open
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PARTIAL) {
      return;
    }
    
    // Get the quantity remaining to be filled
    const remainingQuantity = order.quantity - order.filledQuantity;
    
    // Check if the order can be executed at this price
    if (this.canExecuteAtPrice(order, price)) {
      // Calculate execution price with slippage
      const executionPrice = this.calculateExecutionPrice(order, price);
      
      // Calculate fill quantity
      let fillQuantity = remainingQuantity;
      
      // Check if we should simulate a partial fill
      if (this.shouldPartialFill(order) && order.status !== OrderStatus.PARTIAL) {
        fillQuantity = this.calculatePartialFillQuantity(remainingQuantity);
      }
      
      // Create fill
      this.createFill(order, executionPrice, fillQuantity);
    }
  }
  
  /**
   * Try to execute an order using price levels from a bar
   */
  private tryExecuteOrderWithBarPrices(
    order: Order, 
    open: number, 
    high: number, 
    low: number, 
    close: number
  ): void {
    // Skip orders that aren't open
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PARTIAL) {
      return;
    }
    
    // For market orders, execute at the current close price
    if (order.type === OrderType.MARKET) {
      this.tryExecuteOrderAtPrice(order, close);
      return;
    }
    
    // For limit orders, check if price was reached
    if (order.type === OrderType.LIMIT) {
      let executed = false;
      
      if (order.side === OrderSide.BUY && low <= order.price!) {
        // Buy limit price was reached
        const executionPrice = Math.min(order.price!, open); // Can't buy lower than the low price
        this.tryExecuteOrderAtPrice(order, executionPrice);
        executed = true;
      } else if (order.side === OrderSide.SELL && high >= order.price!) {
        // Sell limit price was reached
        const executionPrice = Math.max(order.price!, open); // Can't sell higher than the high price
        this.tryExecuteOrderAtPrice(order, executionPrice);
        executed = true;
      }
      
      return;
    }
    
    // For stop orders, check if stop price was triggered
    if (order.type === OrderType.STOP) {
      if (order.side === OrderSide.BUY && high >= order.stopPrice!) {
        // Buy stop was triggered, execute as market
        this.tryExecuteOrderAtPrice(order, high);
      } else if (order.side === OrderSide.SELL && low <= order.stopPrice!) {
        // Sell stop was triggered, execute as market
        this.tryExecuteOrderAtPrice(order, low);
      }
      
      return;
    }
    
    // For stop-limit orders
    if (order.type === OrderType.STOP_LIMIT) {
      if (order.side === OrderSide.BUY && high >= order.stopPrice!) {
        // Buy stop was triggered, convert to limit
        const updatedOrder: Order = {
          ...order,
          type: OrderType.LIMIT,
          updateTime: new Date()
        };
        
        this.orders.set(order.id, updatedOrder);
        
        // Check if limit price was also reached in the same bar
        if (low <= order.price!) {
          const executionPrice = Math.min(order.price!, open);
          this.tryExecuteOrderAtPrice(updatedOrder, executionPrice);
        }
      } else if (order.side === OrderSide.SELL && low <= order.stopPrice!) {
        // Sell stop was triggered, convert to limit
        const updatedOrder: Order = {
          ...order,
          type: OrderType.LIMIT,
          updateTime: new Date()
        };
        
        this.orders.set(order.id, updatedOrder);
        
        // Check if limit price was also reached in the same bar
        if (high >= order.price!) {
          const executionPrice = Math.max(order.price!, open);
          this.tryExecuteOrderAtPrice(updatedOrder, executionPrice);
        }
      }
    }
  }
  
  /**
   * Try to execute an order using the order book
   */
  private tryExecuteOrderWithOrderBook(order: Order, orderBook: OrderBook): void {
    // Skip orders that aren't open
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PARTIAL) {
      return;
    }
    
    // Get the quantity remaining to be filled
    const remainingQuantity = order.quantity - order.filledQuantity;
    
    // For market orders, execute against the order book
    if (order.type === OrderType.MARKET) {
      let fillQuantity = remainingQuantity;
      let totalFillValue = 0;
      
      if (order.side === OrderSide.BUY) {
        // Buy market order - fill against asks
        let quantityToFill = fillQuantity;
        
        for (const level of orderBook.asks) {
          const levelFillQuantity = Math.min(quantityToFill, level.volume);
          totalFillValue += levelFillQuantity * level.price;
          quantityToFill -= levelFillQuantity;
          
          if (quantityToFill <= 0) {
            break;
          }
        }
        
        // If we couldn't fill the entire order, adjust fillQuantity
        if (quantityToFill > 0) {
          fillQuantity -= quantityToFill;
        }
      } else {
        // Sell market order - fill against bids
        let quantityToFill = fillQuantity;
        
        for (const level of orderBook.bids) {
          const levelFillQuantity = Math.min(quantityToFill, level.volume);
          totalFillValue += levelFillQuantity * level.price;
          quantityToFill -= levelFillQuantity;
          
          if (quantityToFill <= 0) {
            break;
          }
        }
        
        // If we couldn't fill the entire order, adjust fillQuantity
        if (quantityToFill > 0) {
          fillQuantity -= quantityToFill;
        }
      }
      
      // Create fill if we filled anything
      if (fillQuantity > 0) {
        const averagePrice = totalFillValue / fillQuantity;
        this.createFill(order, averagePrice, fillQuantity);
      }
      
      return;
    }
    
    // For limit orders, check if price is available in the order book
    if (order.type === OrderType.LIMIT) {
      if (order.side === OrderSide.BUY) {
        // Buy limit - check asks
        const firstAsk = orderBook.asks[0];
        if (firstAsk && firstAsk.price <= order.price!) {
          const fillQuantity = Math.min(remainingQuantity, firstAsk.volume);
          this.createFill(order, firstAsk.price, fillQuantity);
        }
      } else {
        // Sell limit - check bids
        const firstBid = orderBook.bids[0];
        if (firstBid && firstBid.price >= order.price!) {
          const fillQuantity = Math.min(remainingQuantity, firstBid.volume);
          this.createFill(order, firstBid.price, fillQuantity);
        }
      }
      
      return;
    }
    
    // For stop and stop-limit orders, check if the stop price has been triggered
    if (order.type === OrderType.STOP || order.type === OrderType.STOP_LIMIT) {
      if (order.side === OrderSide.BUY) {
        // Buy stop - check if first ask is at or above stop price
        const firstAsk = orderBook.asks[0];
        if (firstAsk && firstAsk.price >= order.stopPrice!) {
          if (order.type === OrderType.STOP) {
            // Execute immediately as market
            const fillQuantity = Math.min(remainingQuantity, firstAsk.volume);
            this.createFill(order, firstAsk.price, fillQuantity);
          } else {
            // Convert to limit
            const updatedOrder: Order = {
              ...order,
              type: OrderType.LIMIT,
              updateTime: new Date()
            };
            
            this.orders.set(order.id, updatedOrder);
            
            // Check if limit price is already satisfied
            if (firstAsk.price <= order.price!) {
              const fillQuantity = Math.min(remainingQuantity, firstAsk.volume);
              this.createFill(updatedOrder, firstAsk.price, fillQuantity);
            }
          }
        }
      } else {
        // Sell stop - check if first bid is at or below stop price
        const firstBid = orderBook.bids[0];
        if (firstBid && firstBid.price <= order.stopPrice!) {
          if (order.type === OrderType.STOP) {
            // Execute immediately as market
            const fillQuantity = Math.min(remainingQuantity, firstBid.volume);
            this.createFill(order, firstBid.price, fillQuantity);
          } else {
            // Convert to limit
            const updatedOrder: Order = {
              ...order,
              type: OrderType.LIMIT,
              updateTime: new Date()
            };
            
            this.orders.set(order.id, updatedOrder);
            
            // Check if limit price is already satisfied
            if (firstBid.price >= order.price!) {
              const fillQuantity = Math.min(remainingQuantity, firstBid.volume);
              this.createFill(updatedOrder, firstBid.price, fillQuantity);
            }
          }
        }
      }
    }
  }
  
  /**
   * Check if an order can be executed at a specific price
   */
  private canExecuteAtPrice(order: Order, price: number): boolean {
    switch (order.type) {
      case OrderType.MARKET:
        // Market orders can always execute if there's a price
        return true;
        
      case OrderType.LIMIT:
        // Buy limit: price must be <= limit price
        // Sell limit: price must be >= limit price
        if (order.side === OrderSide.BUY) {
          return price <= order.price!;
        } else {
          return price >= order.price!;
        }
        
      case OrderType.STOP:
        // Buy stop: price must be >= stop price
        // Sell stop: price must be <= stop price
        if (order.side === OrderSide.BUY) {
          return price >= order.stopPrice!;
        } else {
          return price <= order.stopPrice!;
        }
        
      case OrderType.STOP_LIMIT:
        // Stop must be triggered first, then limit condition applies
        if (order.side === OrderSide.BUY) {
          return price >= order.stopPrice! && price <= order.price!;
        } else {
          return price <= order.stopPrice! && price >= order.price!;
        }
        
      default:
        return false;
    }
  }
  
  /**
   * Calculate the execution price with slippage
   */
  private calculateExecutionPrice(order: Order, basePrice: number): number {
    let slippagePercent: number;
    
    if (typeof this.options.slippage === 'function') {
      slippagePercent = this.options.slippage(order);
    } else {
      slippagePercent = this.options.slippage as number;
    }
    
    if (slippagePercent === 0) {
      return basePrice;
    }
    
    // Apply slippage based on order side
    if (order.side === OrderSide.BUY) {
      // For buy orders, slippage increases the price
      return basePrice * (1 + slippagePercent);
    } else {
      // For sell orders, slippage decreases the price
      return basePrice * (1 - slippagePercent);
    }
  }
  
  /**
   * Check if we should simulate a partial fill
   */
  private shouldPartialFill(order: Order): boolean {
    return Math.random() < this.options.partialFillProbability!;
  }
  
  /**
   * Calculate the quantity for a partial fill
   */
  private calculatePartialFillQuantity(remainingQuantity: number): number {
    const minRatio = this.options.partialFillMinRatio!;
    const maxRatio = this.options.partialFillMaxRatio!;
    const ratio = minRatio + Math.random() * (maxRatio - minRatio);
    
    return Math.max(1, Math.floor(remainingQuantity * ratio));
  }
  
  /**
   * Create a fill for an order
   */
  private createFill(order: Order, price: number, quantity: number): void {
    // Skip if quantity is zero
    if (quantity <= 0) {
      return;
    }
    
    // Skip if order is already filled or cancelled
    if (order.status === OrderStatus.FILLED || 
        order.status === OrderStatus.CANCELED) {
      return;
    }
    
    // Calculate commission
    let commission = 0;
    if (typeof this.options.commission === 'function') {
      commission = this.options.commission(order);
    } else {
      commission = (this.options.commission as number) * price * quantity;
    }
    
    // Create the fill
    const fill: Fill = {
      orderId: order.id,
      tradeId: uuidv4(),
      symbol: order.symbol,
      side: order.side,
      price,
      quantity,
      timestamp: new Date(),
      fee: {
        asset: order.symbol.split('/')[1] || 'USD', // Use quote currency
        amount: commission,
        feeRate: commission / (price * quantity)
      }
    };
    
    // Add to pending fills (will be processed with delay if configured)
    if (this.options.executionDelay && this.options.executionDelay > 0) {
      setTimeout(() => {
        this.pendingFills.push(fill);
      }, this.options.executionDelay);
    } else {
      this.pendingFills.push(fill);
    }
  }
  
  /**
   * Process pending fills
   */
  private processPendingFills(): void {
    if (this.pendingFills.length === 0) {
      return;
    }
    
    // Process each pending fill
    for (const fill of this.pendingFills) {
      // Get the order
      const order = this.orders.get(fill.orderId);
      
      if (!order) {
        continue;
      }
      
      // Update order filled quantity
      const newFilledQuantity = order.filledQuantity + fill.quantity;
      
      // Update average price if this is the first fill
      let averagePrice = order.averagePrice || 0;
      if (order.filledQuantity === 0) {
        averagePrice = fill.price;
      } else {
        averagePrice = (order.averagePrice! * order.filledQuantity + fill.price * fill.quantity) / newFilledQuantity;
      }
      
      // Update order status
      let newStatus: OrderStatus;
      if (newFilledQuantity >= order.quantity) {
        newStatus = OrderStatus.FILLED;
      } else {
        newStatus = OrderStatus.PARTIAL;
      }
      
      // Update the order
      const updatedOrder: Order = {
        ...order,
        status: newStatus,
        filledQuantity: newFilledQuantity,
        averagePrice,
        updateTime: new Date()
      };
      
      this.orders.set(order.id, updatedOrder);
      
      // Notify about the fill
      if (this.callbacks.onFill) {
        this.callbacks.onFill(fill);
      }
      
      // Notify about the order update
      if (this.callbacks.onOrderUpdate) {
        this.callbacks.onOrderUpdate(updatedOrder);
      }
    }
    
    // Clear pending fills
    this.pendingFills = [];
  }
  
  /**
   * Register callbacks for event handling
   */
  registerCallbacks(callbacks: {
    onFill?: (fill: Fill) => void;
    onOrderUpdate?: (order: Order) => void;
  }): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }
  
  /**
   * Reset the market simulator
   */
  reset(): void {
    this.orders.clear();
    this.lastPrices.clear();
    this.orderBooks.clear();
    this.pendingFills = [];
  }
} 