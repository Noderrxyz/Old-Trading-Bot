/**
 * Market Types
 * 
 * Defines types and enums related to market state and regimes.
 */

/**
 * Market regime states
 */
export enum MarketRegimeState {
  Unknown = 'unknown',
  Bull = 'bull',
  Bear = 'bear',
  Sideways = 'sideways',
  Volatile = 'volatile'
}

/**
 * Market data point
 */
export interface MarketDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  liquidity: number;
  volatility: number;
  orderBook?: {
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
  };
  trades?: Array<{
    price: number;
    volume: number;
    side: 'buy' | 'sell';
    timestamp: number;
  }>;
}

/**
 * Market metrics
 */
export interface MarketMetrics {
  price: number;
  volume: number;
  volatility: number;
  liquidity: number;
  trend: number;  // -1 to 1
  momentum: number;  // -1 to 1
  regime: MarketRegimeState;
  regimeConfidence: number;  // 0 to 1
  timestamp: number;
} 