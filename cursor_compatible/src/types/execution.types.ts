/**
 * Execution types for the trading system
 */

/**
 * Order intent represents a high-level order request before routing and execution
 */
export interface OrderIntent {
  // Asset pair to trade
  asset: string;
  
  // Buy or sell side
  side: 'buy' | 'sell';
  
  // Quantity to trade
  quantity: number;
  
  // Order type (market, limit, etc)
  type?: 'market' | 'limit' | 'stop' | 'stop_limit' | 'adaptive';
  
  // Price for limit orders
  price?: number;
  
  // Execution urgency level
  urgency?: 'low' | 'medium' | 'high';
  
  // Maximum acceptable slippage in basis points
  maxSlippageBps?: number;
  
  // Time in force for the order
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  
  // Order tags for analytics and tracking
  tags?: string[];
  
  // Maximum time to attempt execution (ms)
  ttlMs?: number;
}

/**
 * Executed order details
 */
export interface ExecutedOrder {
  // Original order intent
  intent: OrderIntent;
  
  // Exchange where order was executed
  venue: string;
  
  // Order ID assigned by the venue
  orderId: string;
  
  // Price the order was executed at
  executedPrice: number;
  
  // Quantity that was filled
  executedQuantity: number;
  
  // Execution timestamp
  timestamp: number;
  
  // Order status
  status: 'filled' | 'partially_filled' | 'failed' | 'rejected';
  
  // Reason for failure or rejection
  failureReason?: string;
  
  // Execution latency in milliseconds
  latencyMs: number;
  
  // Slippage in basis points
  slippageBps: number;
  
  // Execution fees
  fees?: {
    asset: string;
    amount: number;
  };
  
  // Additional execution metadata
  metadata?: Record<string, any>;
}

/**
 * Execution style enum
 */
export enum ExecutionStyle {
  // Aggressive (taker) execution - prioritize speed over cost
  Aggressive = 'aggressive',
  
  // Passive (maker) execution - prioritize cost over speed
  Passive = 'passive',
  
  // Adaptive - system decides based on market conditions
  Adaptive = 'adaptive',
  
  // Time-weighted average price execution
  TWAP = 'twap',
  
  // Volume-weighted average price execution
  VWAP = 'vwap'
}

/**
 * Execution routing result 
 */
export interface RoutingResult {
  // Selected venue for execution
  venue: string | null;
  
  // Calculated score for the venue
  score: number;
  
  // Recommended execution style
  recommendedStyle: ExecutionStyle;
  
  // Estimated slippage in basis points
  estimatedSlippageBps: number;
  
  // Whether execution should be delayed
  shouldDelay: boolean;
  
  // Reason for delay recommendation
  delayReason?: string;
  
  // Microstructure metrics snapshot at routing time
  metricsSnapshot?: any;
  
  // Trust score for the selected venue
  trustScore?: number;
  
  // Additional routing metadata (e.g., time-of-day information)
  metadata?: Record<string, any>;
}

/**
 * Execution telemetry data captured for post-trade analysis
 */
export interface ExecutionTelemetry {
  // Unique order identifier
  orderId: string;
  
  // Asset being traded
  asset: string;
  
  // Expected price at execution time
  expectedPrice: number;
  
  // Actual fill price
  filledPrice: number;
  
  // Trade direction
  side: 'buy' | 'sell';
  
  // Execution timestamp
  timestamp: number;
  
  // Price movement after the fill (in same direction as side)
  postFillDelta: number;
  
  // Slippage from expected price (in %)
  slippage: number;
  
  // Venue where the trade was executed
  venue: string;
  
  // Fill quality score (0-100)
  fillIQ?: number;
  
  // Additional trade context
  tags?: string[];
  
  // Urgency level that was used
  urgency?: 'low' | 'medium' | 'high';
} 