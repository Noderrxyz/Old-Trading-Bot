export type FeedSource = 'uniswap_v3' | 'binance' | 'coinbase';

export interface MarketSnapshot {
  source: FeedSource;
  symbol: string;
  timestamp: number;
  bestBid?: number;
  bestAsk?: number;
  lastPrice?: number;
  lastSize?: number;
  depth?: {
    bids: number[][]; // [price, size][]
    asks: number[][]; // [price, size][]
  };
  txHash?: string; // for DEX
  latencyMs?: number;
}

export interface FeedConfig {
  source: FeedSource;
  symbol: string;
  wsUrl?: string;
  rpcUrl?: string;
  contractAddress?: string;
  pollingIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface FeedStats {
  source: FeedSource;
  symbol: string;
  lastUpdate: number;
  latencyMs: number;
  uptimePct: number;
  errorCount: number;
  messageCount: number;
} 