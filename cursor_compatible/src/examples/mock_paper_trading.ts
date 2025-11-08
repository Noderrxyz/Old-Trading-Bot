/**
 * Mock Paper Trading Example
 * 
 * This is a simplified implementation to demonstrate the paper trading concept
 * without relying on the actual implementation
 */

// Simple enums for order side and type
enum OrderSide {
  Buy = 'buy',
  Sell = 'sell'
}

enum OrderType {
  Market = 'market',
  Limit = 'limit'
}

enum OrderStatus {
  Created = 'created',
  Submitted = 'submitted',
  Filled = 'filled',
  Rejected = 'rejected'
}

enum PositionDirection {
  Long = 'long',
  Short = 'short'
}

// Basic order interface
interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price: number;
  status?: OrderStatus;
  filledAmount?: number;
  avgFillPrice?: number;
  commission?: number;
}

// Position interface
interface Position {
  symbol: string;
  direction: PositionDirection;
  size: number;
  entryPrice: number;
  currentPrice: number;
  value: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

// Portfolio snapshot
interface Portfolio {
  cashBalance: number;
  positions: Position[];
  portfolioValue: number;
  totalPnl: number;
}

// Event interfaces
interface PositionUpdateEvent {
  position: Position;
  updateType: 'open' | 'update' | 'close';
}

/**
 * Simple mock paper trading adapter
 */
class MockPaperTrading {
  private cashBalance: number;
  private positions: Map<string, Position> = new Map();
  private priceCache: Map<string, number> = new Map();
  private totalPnl: number = 0;
  private listeners: Map<string, Function[]> = new Map();
  
  constructor(initialBalance: number = 10000) {
    this.cashBalance = initialBalance;
    console.log(`Initialized paper trading with $${initialBalance} balance`);
  }
  
  /**
   * Update price for a symbol
   */
  updatePrice(symbol: string, price: number): void {
    this.priceCache.set(symbol, price);
    console.log(`Updated price for ${symbol}: $${price}`);
    
    // Update position value if exists
    const position = this.positions.get(symbol);
    if (position) {
      position.currentPrice = price;
      position.value = position.size * price;
      
      // Calculate unrealized P&L
      if (position.direction === PositionDirection.Long) {
        position.unrealizedPnl = (price - position.entryPrice) * position.size;
      } else {
        position.unrealizedPnl = (position.entryPrice - price) * position.size;
      }
      
      position.unrealizedPnlPct = (position.unrealizedPnl / position.value) * 100;
      
      this.positions.set(symbol, position);
      this.emit('position_update', { position, updateType: 'update' });
    }
  }
  
  /**
   * Execute an order
   */
  executeOrder(order: Order): Order {
    console.log(`Executing ${order.side} order for ${order.amount} ${order.symbol} at $${order.price}`);
    
    // Make sure price is available
    if (!this.priceCache.has(order.symbol)) {
      this.priceCache.set(order.symbol, order.price);
    }
    
    // Current price - we just set it if not available, so it's safe to use !
    const currentPrice = this.priceCache.get(order.symbol)!;
    
    // Set status to submitted
    order.status = OrderStatus.Submitted;
    
    // Apply random slippage (0.1% to 0.5%)
    const slippagePct = 0.1 + Math.random() * 0.4;
    const executionPrice = order.side === OrderSide.Buy 
      ? currentPrice * (1 + slippagePct / 100) 
      : currentPrice * (1 - slippagePct / 100);
    
    // Calculate commission (0.1%)
    const commission = order.amount * executionPrice * 0.001;
    
    // Complete the order
    order.status = OrderStatus.Filled;
    order.filledAmount = order.amount;
    order.avgFillPrice = executionPrice;
    order.commission = commission;
    
    // Update cash balance
    if (order.side === OrderSide.Buy) {
      // Buy: decrease cash
      this.cashBalance -= (order.amount * executionPrice) + commission;
      
      // Update position
      this.updatePosition(order.symbol, order.amount, executionPrice, PositionDirection.Long);
    } else {
      // Sell: increase cash
      this.cashBalance += (order.amount * executionPrice) - commission;
      
      // Update position
      this.updatePosition(order.symbol, -order.amount, executionPrice, PositionDirection.Short);
    }
    
    // Emit the order event
    this.emit('order_executed', order);
    
    return order;
  }
  
  /**
   * Update position after an order
   */
  private updatePosition(symbol: string, amount: number, price: number, direction: PositionDirection): void {
    let position = this.positions.get(symbol);
    let pnl = 0;
    
    if (!position) {
      // New position
      position = {
        symbol,
        direction,
        size: Math.abs(amount),
        entryPrice: price,
        currentPrice: price,
        value: Math.abs(amount) * price,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0
      };
      
      this.positions.set(symbol, position);
      this.emit('position_update', { position, updateType: 'open' });
      return;
    }
    
    // Existing position
    if (amount > 0 && position.direction === PositionDirection.Long) {
      // Adding to long position
      const newSize = position.size + amount;
      const newValue = position.value + (amount * price);
      position.entryPrice = newValue / newSize;
      position.size = newSize;
      position.value = newValue;
    } 
    else if (amount < 0 && position.direction === PositionDirection.Long) {
      // Reducing long position
      const reduceAmount = Math.min(position.size, Math.abs(amount));
      
      // Calculate realized PnL
      pnl = (price - position.entryPrice) * reduceAmount;
      this.totalPnl += pnl;
      
      position.size -= reduceAmount;
      
      if (position.size <= 0) {
        // Position closed
        this.positions.delete(symbol);
        this.emit('position_update', { position, updateType: 'close' });
        return;
      }
      
      position.value = position.size * price;
    }
    else if (amount < 0 && position.direction === PositionDirection.Short) {
      // Adding to short position
      const newSize = position.size + Math.abs(amount);
      const newValue = position.value + (Math.abs(amount) * price);
      position.entryPrice = newValue / newSize;
      position.size = newSize;
      position.value = newValue;
    }
    else if (amount > 0 && position.direction === PositionDirection.Short) {
      // Reducing short position
      const reduceAmount = Math.min(position.size, amount);
      
      // Calculate realized PnL
      pnl = (position.entryPrice - price) * reduceAmount;
      this.totalPnl += pnl;
      
      position.size -= reduceAmount;
      
      if (position.size <= 0) {
        // Position closed
        this.positions.delete(symbol);
        this.emit('position_update', { position, updateType: 'close' });
        return;
      }
      
      position.value = position.size * price;
    }
    
    // Update current price and unrealized P&L
    position.currentPrice = price;
    
    if (position.direction === PositionDirection.Long) {
      position.unrealizedPnl = (price - position.entryPrice) * position.size;
    } else {
      position.unrealizedPnl = (position.entryPrice - price) * position.size;
    }
    
    position.unrealizedPnlPct = (position.unrealizedPnl / position.value) * 100;
    
    // Update position in map
    this.positions.set(symbol, position);
    
    // Emit update
    this.emit('position_update', { position, updateType: 'update' });
    
    if (pnl !== 0) {
      console.log(`Realized P&L: $${pnl.toFixed(2)}`);
    }
  }
  
  /**
   * Get portfolio snapshot
   */
  getPortfolio(): Portfolio {
    let portfolioValue = this.cashBalance;
    
    // Add position values
    for (const position of this.positions.values()) {
      portfolioValue += position.value;
    }
    
    return {
      cashBalance: this.cashBalance,
      positions: Array.from(this.positions.values()),
      portfolioValue,
      totalPnl: this.totalPnl
    };
  }
  
  /**
   * Register event listener
   */
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.push(callback);
    }
  }
  
  /**
   * Emit event
   */
  private emit(event: string, data: any): void {
    if (!this.listeners.has(event)) {
      return;
    }
    
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(data);
      }
    }
  }
}

// Run a simple example
async function runPaperTradingExample() {
  console.log('Starting Mock Paper Trading Example');
  
  // Create paper trading instance
  const paperTrading = new MockPaperTrading(10000);
  
  // Set up event listeners
  paperTrading.on('position_update', (event: PositionUpdateEvent) => {
    const { position, updateType } = event;
    console.log(`Position ${updateType}: ${position.symbol} ${position.direction} ${position.size} @ $${position.entryPrice.toFixed(2)}`);
    
    if (position.unrealizedPnl !== 0) {
      console.log(`Unrealized P&L: $${position.unrealizedPnl.toFixed(2)} (${position.unrealizedPnlPct.toFixed(2)}%)`);
    }
  });
  
  paperTrading.on('order_executed', (order: Order) => {
    console.log(`Order executed: ${order.symbol} ${order.side} ${order.filledAmount} @ $${order.avgFillPrice!.toFixed(2)}`);
    console.log(`Commission paid: $${order.commission!.toFixed(2)}`);
  });
  
  // Update initial prices
  paperTrading.updatePrice('BTC/USD', 50000);
  paperTrading.updatePrice('ETH/USD', 3000);
  
  // Create and execute a buy order
  console.log('\n--- Creating Buy Order ---');
  const buyOrder: Order = {
    id: '1',
    symbol: 'BTC/USD',
    side: OrderSide.Buy,
    type: OrderType.Market,
    amount: 0.1,
    price: 50000
  };
  
  const executedBuyOrder = paperTrading.executeOrder(buyOrder);
  
  // Show portfolio
  console.log('\nPortfolio after buy:');
  const portfolioAfterBuy = paperTrading.getPortfolio();
  console.log(`Cash Balance: $${portfolioAfterBuy.cashBalance.toFixed(2)}`);
  console.log(`Portfolio Value: $${portfolioAfterBuy.portfolioValue.toFixed(2)}`);
  
  // Simulate price change
  console.log('\n--- Price Change ---');
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  paperTrading.updatePrice('BTC/USD', 52000);
  
  // Show updated portfolio
  console.log('\nPortfolio after price change:');
  const portfolioAfterPriceChange = paperTrading.getPortfolio();
  console.log(`Cash Balance: $${portfolioAfterPriceChange.cashBalance.toFixed(2)}`);
  console.log(`Portfolio Value: $${portfolioAfterPriceChange.portfolioValue.toFixed(2)}`);
  
  // Create and execute a sell order
  console.log('\n--- Creating Sell Order ---');
  const sellOrder: Order = {
    id: '2',
    symbol: 'BTC/USD',
    side: OrderSide.Sell,
    type: OrderType.Market,
    amount: 0.1,
    price: 52000
  };
  
  const executedSellOrder = paperTrading.executeOrder(sellOrder);
  
  // Show final portfolio
  console.log('\nFinal Portfolio:');
  const finalPortfolio = paperTrading.getPortfolio();
  console.log(`Cash Balance: $${finalPortfolio.cashBalance.toFixed(2)}`);
  console.log(`Portfolio Value: $${finalPortfolio.portfolioValue.toFixed(2)}`);
  console.log(`Total P&L: $${finalPortfolio.totalPnl.toFixed(2)}`);
  
  console.log('\nExample completed successfully!');
}

// Run the example
runPaperTradingExample().catch(err => {
  console.error('Error running paper trading example:', err);
}); 