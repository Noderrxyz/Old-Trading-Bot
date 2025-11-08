// UnifiedMarketData.types.ts
// Canonical, versioned schema for all normalized market data

export interface UnifiedMarketDataV1 {
  /** Schema version */
  version: 1;

  /** Source exchange or protocol (e.g., 'binance', 'uniswap_v3') */
  source: string;

  /** Chain/network identifier (e.g., 'ethereum', 'bsc', 'polygon') */
  chainId?: string;

  /** Trading pair or symbol (e.g., 'BTC/USDT') */
  symbol: string;

  /** Timestamp in ms since epoch */
  timestamp: number;

  /** Last traded price */
  price: number;

  /** Trade volume in base asset */
  volume: number;

  /** Liquidity metric (e.g., TVL, orderbook depth) */
  liquidity?: number;

  /** Volatility metric (e.g., realized, implied) */
  volatility?: number;

  /** Orderbook snapshot (if available) */
  orderbook?: any;

  /** Trades or recent fills (if available) */
  trades?: any;

  /** Funding rate (for derivatives, if available) */
  fundingRate?: number;

  /** Open interest (for derivatives, if available) */
  openInterest?: number;

  /** Additional metadata (source-specific, extensible) */
  metadata?: Record<string, any>;
}

// For future extensibility, use a discriminated union
export type UnifiedMarketData = UnifiedMarketDataV1; 