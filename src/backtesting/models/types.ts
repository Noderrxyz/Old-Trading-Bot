/**
 * Core data types for the Noderr Backtesting Engine
 */

/**
 * Represents a time frame/interval for market data
 */
export enum Timeframe {
  TICK = 'tick',
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  THIRTY_MINUTES = '30m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w',
  ONE_MONTH = '1M'
}

/**
 * OHLCV Bar data structure
 */
export interface Bar {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number; // Optional volume-weighted average price
  trades?: number; // Optional trade count
}

/**
 * Individual trade/tick data
 */
export interface Tick {
  symbol: string;
  timestamp: Date;
  price: number;
  volume: number;
  side?: 'buy' | 'sell'; // Optional trade direction
  exchange?: string; // Optional exchange identifier
}

/**
 * Order book data (market depth)
 */
export interface OrderBook {
  symbol: string;
  timestamp: Date;
  bids: { price: number; volume: number }[];
  asks: { price: number; volume: number }[];
  depth?: number; // Optional depth level of the order book
}

/**
 * Order side enumeration
 */
export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

/**
 * Order type enumeration
 */
export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP = 'stop',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop'
}

/**
 * Order status enumeration
 */
export enum OrderStatus {
  CREATED = 'created',
  PENDING = 'pending',
  PARTIAL = 'partial',
  FILLED = 'filled',
  CANCELED = 'canceled',
  REJECTED = 'rejected',
  EXPIRED = 'expired'
}

/**
 * Time in force enumeration
 */
export enum TimeInForce {
  GTC = 'gtc', // Good till canceled
  IOC = 'ioc', // Immediate or cancel
  FOK = 'fok', // Fill or kill
  DAY = 'day'  // Good for day
}

/**
 * Order request parameters
 */
export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;            // Required for limit and stop-limit orders
  stopPrice?: number;        // Required for stop and stop-limit orders
  trailingAmount?: number;   // Required for trailing stop orders
  timeInForce?: TimeInForce; // Optional time in force
  clientOrderId?: string;    // Optional client-assigned order ID
  reduceOnly?: boolean;      // Optional flag to only reduce position
  postOnly?: boolean;        // Optional flag to only act as a maker
  recvWindow?: number;       // Optional timeout for the order
  leverage?: number;         // Optional leverage for margin trading
}

/**
 * Order data structure
 */
export interface Order extends OrderRequest {
  id: string;
  status: OrderStatus;
  filledQuantity: number;
  averagePrice?: number;
  createTime: Date;
  updateTime: Date;
  lastTradeTime?: Date;
  fees?: Fee[];
}

/**
 * Fee data structure
 */
export interface Fee {
  asset: string;
  amount: number;
  feeRate: number;
}

/**
 * Fill/execution data structure
 */
export interface Fill {
  orderId: string;
  tradeId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  timestamp: Date;
  fee?: Fee;
}

/**
 * Position data structure
 */
export interface Position {
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  openTime: Date;
  updateTime: Date;
  side: 'long' | 'short';
  leverage?: number;
  liquidationPrice?: number;
  marginType?: 'isolated' | 'cross';
}

/**
 * Balance data structure
 */
export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

/**
 * Log level enumeration
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error'
}

/**
 * Notification level enumeration
 */
export enum NotificationLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}
