import { NapiOrderBookManager, NapiOrderSide, NapiUpdateType, NapiPriceLevel } from '../../noderr_core';
import { logger } from '../utils/logger';

/**
 * OrderSide enum - represents the side of an order (bid or ask)
 */
export enum OrderSide {
  Bid = 0,
  Ask = 1
}

/**
 * UpdateType enum - represents the type of update to the order book
 */
export enum UpdateType {
  New = 0,
  Update = 1,
  Delete = 2
}

/**
 * PriceLevel interface - represents a price level in the order book
 */
export interface PriceLevel {
  price: number;
  size: number;
  orderCount: number;
  timestamp: number;
}

/**
 * OrderBookSnapshot type - represents a snapshot of the order book
 * Contains arrays of price levels for bids and asks
 */
export type OrderBookSnapshot = [PriceLevel[], PriceLevel[]];

/**
 * OrderBookManager class - provides a TypeScript interface to the Rust OrderBookManager
 * Handles order book updates and queries
 */
export class OrderBookManager {
  private static instance: OrderBookManager | null = null;
  private nativeManager: NapiOrderBookManager;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    try {
      this.nativeManager = new NapiOrderBookManager();
      logger.info('OrderBookManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize OrderBookManager:', error);
      throw new Error('Failed to initialize OrderBookManager');
    }
  }

  /**
   * Get the singleton instance of OrderBookManager
   */
  public static getInstance(): OrderBookManager {
    if (!OrderBookManager.instance) {
      OrderBookManager.instance = new OrderBookManager();
    }
    return OrderBookManager.instance;
  }

  /**
   * Process a single update to the order book
   * @param symbol - Market symbol
   * @param price - Price level
   * @param size - Size at price level
   * @param side - Order side (bid or ask)
   * @param updateId - Unique identifier for the update
   * @returns The type of update that was processed
   */
  public processUpdate(symbol: string, price: number, size: number, side: OrderSide, updateId: number): UpdateType {
    try {
      const result = this.nativeManager.process_update(
        symbol, 
        price, 
        size, 
        side as unknown as NapiOrderSide, 
        updateId
      );
      return result as unknown as UpdateType;
    } catch (error) {
      logger.error(`Error processing update for ${symbol}:`, error);
      throw new Error(`Failed to process order book update for ${symbol}`);
    }
  }

  /**
   * Process multiple updates to the order book at once
   * @param symbol - Market symbol
   * @param updates - Array of updates in format [price, size, side, updateId]
   * @returns Array of update types that were processed
   */
  public processUpdates(symbol: string, updates: Array<[number, number, number, number]>): UpdateType[] {
    try {
      const results = this.nativeManager.process_updates(symbol, updates);
      return results as unknown as UpdateType[];
    } catch (error) {
      logger.error(`Error processing batch updates for ${symbol}:`, error);
      throw new Error(`Failed to process batch order book updates for ${symbol}`);
    }
  }

  /**
   * Get a snapshot of the order book for a symbol
   * @param symbol - Market symbol
   * @param depth - Number of price levels to include
   * @returns Promise resolving to the order book snapshot or null if not available
   */
  public async getSnapshot(symbol: string, depth: number): Promise<OrderBookSnapshot | null> {
    try {
      const snapshot = await this.nativeManager.get_snapshot(symbol, depth);
      if (!snapshot) return null;
      
      // Convert from NapiPriceLevel to PriceLevel
      return snapshot.map(levels => 
        levels.map(level => ({
          price: level.price,
          size: level.size,
          orderCount: level.order_count,
          timestamp: level.timestamp
        }))
      ) as OrderBookSnapshot;
    } catch (error) {
      logger.error(`Error getting snapshot for ${symbol}:`, error);
      throw new Error(`Failed to get order book snapshot for ${symbol}`);
    }
  }

  /**
   * Get the mid price for a symbol
   * @param symbol - Market symbol
   * @returns The mid price or null if not available
   */
  public getMidPrice(symbol: string): number | null {
    try {
      return this.nativeManager.get_mid_price(symbol);
    } catch (error) {
      logger.error(`Error getting mid price for ${symbol}:`, error);
      throw new Error(`Failed to get mid price for ${symbol}`);
    }
  }

  /**
   * Calculate the order book imbalance
   * @param symbol - Market symbol
   * @param depth - Depth to consider for imbalance calculation
   * @returns The imbalance value or null if not available
   */
  public calculateImbalance(symbol: string, depth: number): number | null {
    try {
      return this.nativeManager.calculate_imbalance(symbol, depth);
    } catch (error) {
      logger.error(`Error calculating imbalance for ${symbol}:`, error);
      throw new Error(`Failed to calculate order book imbalance for ${symbol}`);
    }
  }

  /**
   * Get the volume-weighted average price for a market order of given size
   * @param symbol - Market symbol
   * @param size - Order size to calculate VWAP for
   * @param side - Order side (bid or ask)
   * @returns The VWAP or null if not available
   */
  public getVWAP(symbol: string, size: number, side: OrderSide): number | null {
    try {
      return this.nativeManager.get_vwap(
        symbol, 
        size, 
        side as unknown as NapiOrderSide
      );
    } catch (error) {
      logger.error(`Error getting VWAP for ${symbol}:`, error);
      throw new Error(`Failed to get VWAP for ${symbol}`);
    }
  }

  /**
   * List all symbols that have order books
   * @returns Array of symbol strings
   */
  public listSymbols(): string[] {
    try {
      return this.nativeManager.list_symbols();
    } catch (error) {
      logger.error('Error listing symbols:', error);
      throw new Error('Failed to list order book symbols');
    }
  }

  /**
   * Remove an order book for a symbol
   * @param symbol - Market symbol to remove
   * @returns Boolean indicating success
   */
  public removeOrderBook(symbol: string): boolean {
    try {
      return this.nativeManager.remove_order_book(symbol);
    } catch (error) {
      logger.error(`Error removing order book for ${symbol}:`, error);
      throw new Error(`Failed to remove order book for ${symbol}`);
    }
  }
} 