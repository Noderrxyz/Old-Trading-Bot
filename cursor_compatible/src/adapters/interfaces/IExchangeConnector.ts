/**
 * Exchange Connector Interface
 * 
 * Standardized interface for both real and mock exchange connectors.
 * Ensures drop-in compatibility for paper mode simulation.
 */

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop-limit';
  amount: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  clientOrderId?: string;
}

export interface OrderResponse {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  amount: number;
  price?: number;
  status: 'pending' | 'open' | 'filled' | 'partial' | 'cancelled' | 'rejected';
  executedAmount: number;
  executedPrice?: number;
  remainingAmount: number;
  fees: number;
  timestamp: number;
  transactionId?: string;
}

export interface OrderBook {
  symbol: string;
  bids: Array<{ price: number; quantity: number; orders?: number }>;
  asks: Array<{ price: number; quantity: number; orders?: number }>;
  timestamp: number;
  sequenceId?: number;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  spreadPercentage: number;
  timestamp: number;
  exchange: string;
}

export interface TradeHistory {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  fee: number;
  timestamp: number;
  orderId: string;
}

export interface ExchangeStatus {
  operational: boolean;
  maintenance: boolean;
  latency: number;
  lastUpdate: number;
  supportedSymbols: string[];
  tradingEnabled: boolean;
}

export interface BalanceInfo {
  asset: string;
  available: number;
  locked: number;
  total: number;
}

/**
 * Main Exchange Connector Interface
 */
export interface IExchangeConnector {
  /**
   * Exchange identification
   */
  getExchangeId(): string;
  getExchangeName(): string;
  
  /**
   * Connection management
   */
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  /**
   * Market data
   */
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
  getQuote(symbol: string): Promise<Quote>;
  getTicker(symbol: string): Promise<any>;
  getMarketStatus(): Promise<ExchangeStatus>;
  getSupportedSymbols(): Promise<string[]>;
  
  /**
   * Trading operations
   */
  submitOrder(order: OrderRequest): Promise<OrderResponse>;
  cancelOrder(orderId: string, symbol?: string): Promise<boolean>;
  getOrderStatus(orderId: string, symbol?: string): Promise<OrderResponse>;
  getOpenOrders(symbol?: string): Promise<OrderResponse[]>;
  getOrderHistory(symbol?: string, limit?: number): Promise<OrderResponse[]>;
  
  /**
   * Account management
   */
  getBalances(): Promise<BalanceInfo[]>;
  getBalance(asset: string): Promise<BalanceInfo>;
  getTradeHistory(symbol?: string, limit?: number): Promise<TradeHistory[]>;
  
  /**
   * Fee information
   */
  getTradingFees(symbol?: string): Promise<{ maker: number; taker: number }>;
  
  /**
   * Real-time subscriptions (if supported)
   */
  subscribeOrderBook?(symbol: string, callback: (orderbook: OrderBook) => void): Promise<void>;
  subscribeQuotes?(symbol: string, callback: (quote: Quote) => void): Promise<void>;
  subscribeTrades?(symbol: string, callback: (trade: any) => void): Promise<void>;
  unsubscribe?(symbol: string, type: 'orderbook' | 'quotes' | 'trades'): Promise<void>;
} 