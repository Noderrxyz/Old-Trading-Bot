declare module 'ccxt' {
  interface ExchangeOptions {
    apiKey?: string;
    secret?: string;
    password?: string;
    enableRateLimit?: boolean;
    timeout?: number;
    proxy?: string;
    [key: string]: any;
  }

  interface Market {
    id: string;
    symbol: string;
    base: string;
    quote: string;
    active: boolean;
    precision: {
      price: number;
      amount: number;
      cost: number;
    };
    limits: {
      amount: {
        min: number;
        max: number;
      };
      price: {
        min: number;
        max: number;
      };
      cost: {
        min: number;
        max: number;
      };
    };
    [key: string]: any;
  }

  interface OrderBook {
    asks: [number, number][];
    bids: [number, number][];
    timestamp?: number;
    datetime?: string;
    nonce?: number;
  }

  class Exchange {
    readonly id: string;
    readonly markets: { [key: string]: Market };

    constructor(options?: ExchangeOptions);

    fetchMarkets(): Promise<Market[]>;
    fetchOHLCV(
      symbol: string,
      timeframe?: string,
      since?: number,
      limit?: number,
      params?: any
    ): Promise<[number, number, number, number, number, number][]>;
    fetchOrderBook(
      symbol: string,
      limit?: number,
      params?: any
    ): Promise<OrderBook>;
  }

  // Add all supported exchanges dynamically
  const exchanges: string[];

  // Define exchange classes dynamically
  interface ExchangeConstructors {
    [key: string]: typeof Exchange;
  }

  const binance: typeof Exchange;
  const coinbase: typeof Exchange;
  const kraken: typeof Exchange;
  const kucoin: typeof Exchange;
  const ftx: typeof Exchange;
  const bitfinex: typeof Exchange;
  const bitstamp: typeof Exchange;
  const huobi: typeof Exchange;
  const okex: typeof Exchange;
  const bybit: typeof Exchange;
  // Add any other exchanges you need

  // Export as a namespace and individual classes
  export { Exchange, Market, OrderBook, ExchangeOptions };
  export default ExchangeConstructors;
} 