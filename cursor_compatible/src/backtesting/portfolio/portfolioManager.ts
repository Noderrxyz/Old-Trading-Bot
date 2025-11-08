import { Fill, OrderSide, Position } from '../models/types';

/**
 * Configuration options for the PortfolioManager
 */
export interface PortfolioManagerOptions {
  initialCash: number;
  marginEnabled?: boolean;
  maxLeverage?: number;
}

/**
 * Manages positions, capital, and performs accounting functions
 */
export class PortfolioManager {
  private options: PortfolioManagerOptions;
  private cash: number;
  private positions: Map<string, Position> = new Map();
  private transactionLog: any[] = [];
  
  constructor(options: PortfolioManagerOptions) {
    this.options = {
      marginEnabled: false,
      maxLeverage: 1,
      ...options
    };
    
    this.cash = options.initialCash;
  }
  
  /**
   * Process a fill and update positions and cash
   */
  processFill(fill: Fill): Position {
    // Log the transaction
    this.logTransaction(fill);
    
    // Process the fill
    const { symbol, side, price, quantity } = fill;
    
    // Calculate fill cost including fees
    const fillCost = price * quantity;
    const fee = fill.fee ? fill.fee.amount : 0;
    const totalCost = fillCost + fee;
    
    // Get existing position or create a new one
    let position = this.positions.get(symbol);
    
    if (!position) {
      // Create a new position
      position = {
        symbol,
        quantity: 0,
        averageEntryPrice: 0,
        currentPrice: price,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openTime: new Date(),
        updateTime: new Date(),
        side: 'long'
      };
      
      this.positions.set(symbol, position);
    }
    
    // Current position size and value
    const currentQuantity = position.quantity;
    const currentValue = currentQuantity * position.averageEntryPrice;
    
    // Update cash balance
    if (side === OrderSide.BUY) {
      // Buying increases position, decreases cash
      this.cash -= totalCost;
    } else {
      // Selling decreases position, increases cash
      this.cash += fillCost - fee;
    }
    
    // Calculate realized P&L for sells
    let realizedPnl = 0;
    
    if (side === OrderSide.SELL) {
      if (currentQuantity > 0) {
        // Selling long position -> realize P&L
        const sellQuantity = Math.min(quantity, currentQuantity);
        realizedPnl = (price - position.averageEntryPrice) * sellQuantity;
        position.realizedPnl += realizedPnl;
      } else if (currentQuantity < 0 && quantity + currentQuantity >= 0) {
        // Covering short position -> realize P&L
        const coverQuantity = Math.min(quantity, Math.abs(currentQuantity));
        realizedPnl = (position.averageEntryPrice - price) * coverQuantity;
        position.realizedPnl += realizedPnl;
      }
    }
    
    // Update position quantity
    if (side === OrderSide.BUY) {
      position.quantity += quantity;
    } else {
      position.quantity -= quantity;
    }
    
    // Update average entry price for new buys or shorts
    if ((side === OrderSide.BUY && currentQuantity >= 0) || 
        (side === OrderSide.SELL && currentQuantity <= 0)) {
      
      // Adding to existing position or creating new position
      if (position.quantity !== 0) {
        position.averageEntryPrice = (currentValue + fillCost) / Math.abs(position.quantity);
      }
    }
    
    // Update position side
    position.side = position.quantity >= 0 ? 'long' : 'short';
    
    // Update current price and unrealized P&L
    position.currentPrice = price;
    if (position.quantity !== 0) {
      if (position.side === 'long') {
        position.unrealizedPnl = (price - position.averageEntryPrice) * position.quantity;
      } else {
        position.unrealizedPnl = (position.averageEntryPrice - price) * Math.abs(position.quantity);
      }
    } else {
      position.unrealizedPnl = 0;
    }
    
    // Update position timestamp
    position.updateTime = new Date();
    
    // Remove position if quantity is zero
    if (position.quantity === 0) {
      this.positions.delete(symbol);
      return { ...position }; // Return a copy
    }
    
    return { ...position }; // Return a copy
  }
  
  /**
   * Get the current cash balance
   */
  getCash(): number {
    return this.cash;
  }
  
  /**
   * Get position for a symbol
   */
  getPosition(symbol: string): Position | null {
    const position = this.positions.get(symbol);
    
    if (!position) {
      return null;
    }
    
    return { ...position }; // Return a copy
  }
  
  /**
   * Get all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values()).map(position => ({ ...position }));
  }
  
  /**
   * Get the total portfolio value (cash + positions)
   */
  getPortfolioValue(): number {
    let positionsValue = 0;
    
    for (const position of this.positions.values()) {
      positionsValue += position.quantity * position.currentPrice;
    }
    
    return this.cash + positionsValue;
  }
  
  /**
   * Get the total unrealized P&L
   */
  getUnrealizedPnl(): number {
    let unrealizedPnl = 0;
    
    for (const position of this.positions.values()) {
      unrealizedPnl += position.unrealizedPnl;
    }
    
    return unrealizedPnl;
  }
  
  /**
   * Get the total realized P&L
   */
  getRealizedPnl(): number {
    let realizedPnl = 0;
    
    for (const position of this.positions.values()) {
      realizedPnl += position.realizedPnl;
    }
    
    return realizedPnl;
  }
  
  /**
   * Get the transaction log
   */
  getTransactionLog(): any[] {
    return [...this.transactionLog];
  }
  
  /**
   * Log a transaction
   */
  private logTransaction(fill: Fill): void {
    this.transactionLog.push({
      timestamp: new Date(),
      type: 'fill',
      data: { ...fill }
    });
  }
  
  /**
   * Reset the portfolio manager
   */
  reset(initialCash?: number): void {
    this.cash = initialCash ?? this.options.initialCash;
    this.positions.clear();
    this.transactionLog = [];
  }
} 