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
  exchange?: string; // Optional source exchange
  id?: string; // Optional unique identifier for the tick/trade
}

/**
 * Single level in an order book
 */
export interface OrderBookLevel {
  price: number;
  volume: number;
  orders?: number; // Optional order count
}

/**
 * Complete order book snapshot
 */
export interface OrderBook {
  symbol: string;
  timestamp: Date;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastUpdateId?: number; // Optional sequence number
}

/**
 * Order types supported by the backtester
 */
export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP = 'stop',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop'
}

/**
 * Order side
 */
export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

/**
 * Order status
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
 * Order request to be sent to the exchange
 */
export interface OrderRequest {
  symbol: string;
  type: OrderType;
  side: OrderSide;
  quantity: number;
  price?: number; // Required for limit orders
  stopPrice?: number; // Required for stop orders
  timeInForce?: 'GTC' | 'IOC' | 'FOK'; // Good-till-canceled, Immediate-or-cancel, Fill-or-kill
  clientOrderId?: string; // Optional client-assigned ID
  leverage?: number; // For margin/futures trading
}

/**
 * Order object returned by the exchange
 */
export interface Order extends OrderRequest {
  id: string;
  status: OrderStatus;
  filledQuantity: number;
  averagePrice?: number;
  createTime: Date;
  updateTime: Date;
  fees?: Fee[];
}

/**
 * Represents a fee charged by the exchange
 */
export interface Fee {
  asset: string;
  amount: number;
  feeRate: number;
}

/**
 * Represents a single trade fill
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
 * Represents a position in an asset
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
  leverage?: number; // For margin/futures trading
}

/**
 * Logging levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error'
}

/**
 * Notification importance
 */
export enum NotificationLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
} 