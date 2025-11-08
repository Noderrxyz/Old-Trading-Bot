/**
 * Order type enum
 */
export enum OrderType {
  Market = 'market',
  Limit = 'limit',
  Stop = 'stop',
  StopLimit = 'stop_limit'
}

/**
 * Order execution mode
 */
export enum ExecutionMode {
  TWAP = 'TWAP',
  VWAP = 'VWAP',
  Immediate = 'immediate'
}

/**
 * Order status
 */
export enum OrderStatus {
  Pending = 'pending',
  Filled = 'filled',
  PartiallyFilled = 'partially_filled',
  Cancelled = 'cancelled',
  Failed = 'failed'
}

/**
 * Order interface
 */
export interface Order {
  id: string;
  symbol: string;
  venue: string;
  type: OrderType;
  side: 'buy' | 'sell';
  amount: number;
  price?: number;
  stopPrice?: number;
  executionMode?: ExecutionMode;
  timestamp: number;
}

/**
 * Execution result interface
 */
export interface ExecutionResult {
  orderId: string;
  status: OrderStatus;
  filledAmount: number;
  averagePrice: number;
  timestamp: number;
  error?: string;
}

/**
 * Venue metrics interface
 */
export interface VenueMetrics {
  venue: string;
  symbol: string;
  slippage: number;
  gasCost: number;
  latency: number;
  trustScore: number;
  timestamp: number;
}

/**
 * Execution event type
 */
export enum ExecutionEventType {
  OrderSubmitted = 'order_submitted',
  OrderFilled = 'order_filled',
  OrderCancelled = 'order_cancelled',
  OrderFailed = 'order_failed',
  TWAPStarted = 'twap_started',
  VWAPStarted = 'vwap_started',
  SliceExecuted = 'slice_executed'
}

/**
 * Execution event interface
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  orderId: string;
  timestamp: number;
  data?: any;
} 