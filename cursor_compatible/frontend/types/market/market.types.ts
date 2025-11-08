/**
 * Market-related type definitions
 */

/**
 * Represents a single entry in the orderbook
 */
export interface OrderbookEntry {
  // Price level
  price: number;
  
  // Quantity available at this price
  quantity: number;
  
  // Number of orders at this price (if available)
  count?: number;
  
  // Optional exchange-specific data
  extras?: Record<string, any>;
}

/**
 * Represents a market's orderbook with bids and asks
 */
export interface Orderbook {
  // Buy orders, sorted by price in descending order
  bids: OrderbookEntry[];
  
  // Sell orders, sorted by price in ascending order
  asks: OrderbookEntry[];
  
  // Last update timestamp
  timestamp: string;
  
  // Market depth as a percentage of total volume
  depthPct?: number;
  
  // Exchange-specific sequence number for orderbook updates
  sequenceNumber?: number;
  
  // Whether this is a partial or full orderbook
  isPartial?: boolean;
  
  // Additional orderbook metadata
  metadata?: Record<string, any>;
}

/**
 * Ticker data for a market
 */
export interface Ticker {
  // Current best bid price
  bid: number;
  
  // Current best ask price
  ask: number;
  
  // Last trade price
  last: number;
  
  // 24h volume in base currency
  volume: number;
  
  // 24h price change percentage
  change24h: number;
  
  // 24h high price
  high24h: number;
  
  // 24h low price
  low24h: number;
  
  // Total 24h quote currency volume
  quoteVolume: number;
}

/**
 * Candlestick data
 */
export interface Candle {
  // Opening timestamp of the candle
  timestamp: string;
  
  // Opening price
  open: number;
  
  // Highest price during the period
  high: number;
  
  // Lowest price during the period
  low: number;
  
  // Closing price
  close: number;
  
  // Trading volume during the period
  volume: number;
  
  // Optional number of trades
  tradeCount?: number;
  
  // Optional volume in quote currency
  quoteVolume?: number;
  
  // Optional additional data specific to the exchange or pair
  extras?: Record<string, any>;
}

/**
 * Technical indicators for a market
 */
export interface TechnicalIndicators {
  // Moving Average Convergence Divergence values (MACD line, signal line, histogram)
  macd?: [number, number, number];
  
  // Relative Strength Index (0-100)
  rsi?: number;
  
  // Bollinger Bands (lower, middle, upper)
  bollingerBands?: [number, number, number];
  
  // Simple Moving Averages for different periods
  sma?: Record<number, number>;
  
  // Exponential Moving Averages for different periods
  ema?: Record<number, number>;
  
  // Average True Range - volatility indicator
  atr?: number;
  
  // Stochastic Oscillator (K%, D%)
  stoch?: [number, number];
  
  // On-Balance Volume
  obv?: number;
  
  // Ichimoku Cloud components (conversion, base, leading_span_a, leading_span_b, lagging_span)
  ichimoku?: [number, number, number, number, number];
  
  // Custom indicators that don't fit into predefined categories
  custom?: Record<string, number>;
}

/**
 * Market sentiment data
 */
export interface MarketSentiment {
  // Overall sentiment score (-1.0 to 1.0, where -1 is very bearish, 1 is very bullish)
  score: number;
  
  // Confidence level of the sentiment (0.0 to 1.0)
  confidence: number;
  
  // Volume of social media mentions
  socialVolume?: number;
  
  // Social sentiment score (-1.0 to 1.0)
  socialSentiment?: number;
  
  // News sentiment score (-1.0 to 1.0)
  newsSentiment?: number;
  
  // Options put/call ratio
  putCallRatio?: number;
  
  // Long/short ratio from exchange data
  longShortRatio?: number;
  
  // Fear and greed index (0-100)
  fearGreedIndex?: number;
  
  // Timestamp when sentiment was measured
  timestamp: number;
  
  // Custom sentiment metrics that don't fit into predefined categories
  customMetrics?: Record<string, number>;
}

/**
 * Complete market data
 */
export interface MarketData {
  // Exchange identifier
  exchange: string;
  
  // Trading pair (e.g., "BTC/USDT")
  symbol: string;
  
  // Current ticker data
  ticker: Ticker;
  
  // Current orderbook snapshot
  orderbook?: Orderbook;
  
  // Recent candles at different timeframes
  candles?: Record<string, Candle[]>;
  
  // Technical indicators calculated from candle data
  indicators: TechnicalIndicators;
  
  // Market sentiment data
  sentiment?: MarketSentiment;
  
  // Timestamp when this data was last updated
  lastUpdated: number;
  
  // Data source (e.g., "realtime", "cached", "simulated")
  source: string;
}

/**
 * Different market regime states
 */
export enum MarketRegimeState {
  // Bullish trend with positive momentum
  Bull = 'Bull',
  
  // Bearish trend with negative momentum
  Bear = 'Bear',
  
  // Sideways/ranging market with no clear direction
  Sideways = 'Sideways',
  
  // High volatility/uncertain market
  Volatile = 'Volatile',
  
  // Unknown state (insufficient data)
  Unknown = 'Unknown'
}

/**
 * Order execution types
 */
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'adaptive';

/**
 * Order side types
 */
export type OrderSide = 'buy' | 'sell';

/**
 * Order time-in-force options
 */
export type TimeInForce = 'GTC' | 'IOC' | 'FOK'; 