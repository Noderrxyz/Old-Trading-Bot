/**
 * Orderbook-specific type definitions
 */
import { OrderbookEntry, Orderbook } from './market.types';

/**
 * Orderbook update message
 */
export interface OrderbookUpdate {
  // Exchange identifier
  exchange: string;
  
  // Trading pair
  symbol: string;
  
  // Updated orderbook
  orderbook: Orderbook;
  
  // Whether this is a snapshot or delta update
  isSnapshot: boolean;
  
  // Update sequence number for synchronization
  sequenceNumber?: number;
  
  // Timestamp of the update
  timestamp: string;
  
  // Additional data specific to the exchange
  extras?: Record<string, any>;
}

/**
 * Orderbook level update for delta updates
 */
export interface OrderbookLevelUpdate {
  // Price level
  price: number;
  
  // New quantity (0 for deletion)
  quantity: number;
  
  // Side of the orderbook (bid or ask)
  side: 'bid' | 'ask';
  
  // Number of orders at this level (if available)
  count?: number;
}

/**
 * Orderbook delta update message
 */
export interface OrderbookDeltaUpdate {
  // Exchange identifier
  exchange: string;
  
  // Trading pair
  symbol: string;
  
  // Updated levels
  updates: OrderbookLevelUpdate[];
  
  // Update sequence number for synchronization
  sequenceNumber: number;
  
  // Last update timestamp in ISO format
  timestamp: string;
  
  // Checksum for validation (if provided by exchange)
  checksum?: string;
}

/**
 * Orderbook imbalance metrics
 */
export interface OrderbookImbalance {
  // Bid/ask volume ratio
  bidAskRatio: number;
  
  // Book imbalance score (-1 to 1, negative means more asks)
  imbalanceScore: number;
  
  // Liquidity within specific price ranges from mid
  depthMap: Record<string, number>;
  
  // Buy pressure score (0-100)
  buyPressure: number;
  
  // Sell pressure score (0-100)
  sellPressure: number;
  
  // Cumulative delta over last N trades
  cumulativeDelta?: number;
  
  // Timestamp of this analysis
  timestamp: string;
}

/**
 * Orderbook visualization configuration
 */
export interface OrderbookDisplayConfig {
  // Maximum depth to show
  maxDepth: number;
  
  // Group prices by this increment
  grouping?: number;
  
  // Show cumulative quantities
  showCumulative: boolean;
  
  // Highlight top N levels
  highlightLevels: number;
  
  // Show historical trades alongside orderbook
  showTrades: boolean;
  
  // Color scheme for visualization
  colorScheme: 'light' | 'dark' | 'custom';
}

/**
 * Orderbook aggregation parameters
 */
export interface OrderbookAggregation {
  // Price grouping increment
  priceGrouping: number;
  
  // Maximum depth to include
  maxDepth: number;
  
  // Whether to include empty price levels
  includeEmpty: boolean;
}

/**
 * Direction of price action
 */
export enum PriceDirection {
  Up = 'Up',
  Down = 'Down',
  Sideways = 'Sideways'
} 