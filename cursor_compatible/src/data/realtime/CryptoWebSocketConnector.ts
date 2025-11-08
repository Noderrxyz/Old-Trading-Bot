import { EventEmitter } from 'events';
import WebSocket from 'ws';
import * as ccxt from 'ccxt';
import { createHash } from 'crypto';
import { Bar, OrderBook, Tick, Timeframe } from '../../backtesting/models/types';

/**
 * Connection pool for each exchange
 */
interface ConnectionPool {
  connections: WebSocket[];
  currentIndex: number;
  maxConnections: number;
}

/**
 * Message batch for reducing CPU overhead
 */
interface MessageBatch {
  messages: any[];
  timer: NodeJS.Timeout | null;
  lastFlush: number;
}

/**
 * Supported crypto exchanges
 */
export enum Exchange {
  BINANCE = 'binance',
  COINBASE = 'coinbase',
}

/**
 * Connection states for WebSocket
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/**
 * WebSocket subscription types
 */
export enum SubscriptionType {
  TICKER = 'ticker',
  TRADES = 'trades',
  ORDERBOOK = 'orderbook',
  KLINE = 'kline',
}

/**
 * Subscription configuration
 */
export interface Subscription {
  exchange: Exchange;
  type: SubscriptionType;
  symbol: string;
  timeframe?: Timeframe; // Only for KLINE subscriptions
}

/**
 * Configuration for WebSocket connector
 */
export interface WebSocketConnectorConfig {
  // Auto reconnect on connection loss
  autoReconnect?: boolean;
  
  // Reconnection attempt delay in ms
  reconnectDelay?: number;
  
  // Maximum number of reconnection attempts
  maxReconnectAttempts?: number;
  
  // OPTIMIZED: Reduced ping interval from 30s to 5s for active trading
  pingInterval?: number;
  
  // OPTIMIZED: Connection pooling configuration
  connectionPoolSize?: number;
  
  // OPTIMIZED: Message batching configuration
  batchMessages?: boolean;
  batchInterval?: number;
  maxBatchSize?: number;
  
  // OPTIMIZED: Compression support
  enableCompression?: boolean;
  
  // OPTIMIZED: Binary message support
  enableBinaryMessages?: boolean;
  
  // API keys for exchanges
  apiKeys?: {
    [exchange in Exchange]?: {
      apiKey: string;
      secret: string;
    };
  };
}

/**
 * Base class for WebSocket connection to crypto exchanges
 */
export class CryptoWebSocketConnector extends EventEmitter {
  private config: Required<WebSocketConnectorConfig>;
  // OPTIMIZED: Changed to connection pools instead of single connections
  private connectionPools: Map<Exchange, ConnectionPool> = new Map();
  private connectionStates: Map<Exchange, ConnectionState> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private pingIntervals: Map<Exchange, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<Exchange, number> = new Map();
  
  // OPTIMIZED: Message batching support
  private messageBatches: Map<Exchange, MessageBatch> = new Map();
  
  /**
   * Create a new CryptoWebSocketConnector
   */
  constructor(config: WebSocketConnectorConfig = {}) {
    super();
    
    // OPTIMIZED: Enhanced default configuration with performance settings
    this.config = {
      autoReconnect: true,
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      pingInterval: 5000, // OPTIMIZED: Reduced from 30s to 5s
      connectionPoolSize: 3, // OPTIMIZED: 3 connections per exchange
      batchMessages: true, // OPTIMIZED: Enable message batching
      batchInterval: 10, // OPTIMIZED: 10ms batch window
      maxBatchSize: 100, // OPTIMIZED: Max 100 messages per batch
      enableCompression: true, // OPTIMIZED: Enable compression
      enableBinaryMessages: true, // OPTIMIZED: Enable binary for Binance
      apiKeys: {},
      ...config,
    };
    
    // Initialize connection states and pools
    for (const exchange of Object.values(Exchange)) {
      this.connectionStates.set(exchange, ConnectionState.DISCONNECTED);
      this.reconnectAttempts.set(exchange, 0);
      
      // OPTIMIZED: Initialize connection pool
      this.connectionPools.set(exchange, {
        connections: [],
        currentIndex: 0,
        maxConnections: this.config.connectionPoolSize
      });
      
      // OPTIMIZED: Initialize message batch
      this.messageBatches.set(exchange, {
        messages: [],
        timer: null,
        lastFlush: Date.now()
      });
    }
  }
  
  /**
   * OPTIMIZED: Connect to an exchange WebSocket API with connection pooling
   */
  async connect(exchange: Exchange): Promise<void> {
    // Check if already connected
    if (this.connectionStates.get(exchange) === ConnectionState.CONNECTED) {
      return;
    }
    
    // Update connection state
    this.connectionStates.set(exchange, ConnectionState.CONNECTING);
    
    try {
      const pool = this.connectionPools.get(exchange)!;
      
      // OPTIMIZED: Create multiple connections for the pool
      for (let i = 0; i < pool.maxConnections; i++) {
        await this.createPooledConnection(exchange, i);
      }
      
      // Begin ping interval
      this.setupPingInterval(exchange);
      
      this.connectionStates.set(exchange, ConnectionState.CONNECTED);
      this.emit('connected', exchange);
      
    } catch (error) {
      this.connectionStates.set(exchange, ConnectionState.ERROR);
      this.emit('error', exchange, error);
      
      // Attempt reconnection if enabled
      if (this.config.autoReconnect) {
        this.attemptReconnect(exchange);
      }
    }
  }
  
  /**
   * OPTIMIZED: Create a single pooled connection with performance optimizations
   */
  private async createPooledConnection(exchange: Exchange, connectionIndex: number): Promise<void> {
    const wsUrl = this.getWebSocketUrl(exchange);
    
    // OPTIMIZED: WebSocket options with compression and performance settings
    const wsOptions: any = {
      perMessageDeflate: this.config.enableCompression,
      maxCompressedSize: 1024 * 1024, // 1MB max compressed
      maxWindow: 13, // Compression window
    };
    
    const ws = new WebSocket(wsUrl, undefined, wsOptions);
    
    // Set up event handlers
    ws.on('open', () => this.handlePooledOpen(exchange, connectionIndex));
    ws.on('message', (data: WebSocket.Data) => this.handlePooledMessage(exchange, data));
    ws.on('error', (error: Error) => this.handlePooledError(exchange, connectionIndex, error));
    ws.on('close', (code: number, reason: string) => this.handlePooledClose(exchange, connectionIndex, code, reason));
    
    // OPTIMIZED: Store in connection pool
    const pool = this.connectionPools.get(exchange)!;
    pool.connections[connectionIndex] = ws;
  }
  
  /**
   * OPTIMIZED: Get next available connection from pool (round-robin)
   */
  private getNextConnection(exchange: Exchange): WebSocket | null {
    const pool = this.connectionPools.get(exchange);
    if (!pool || pool.connections.length === 0) return null;
    
    // Find next healthy connection
    for (let i = 0; i < pool.maxConnections; i++) {
      const connectionIndex = (pool.currentIndex + i) % pool.maxConnections;
      const ws = pool.connections[connectionIndex];
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        pool.currentIndex = (connectionIndex + 1) % pool.maxConnections;
        return ws;
      }
    }
    
    return null;
  }
  
  /**
   * Disconnect from an exchange WebSocket API
   */
  disconnect(exchange: Exchange): void {
    // Clear ping interval
    if (this.pingIntervals.has(exchange)) {
      clearInterval(this.pingIntervals.get(exchange)!);
      this.pingIntervals.delete(exchange);
    }
    
    // OPTIMIZED: Clear message batch timer
    const batch = this.messageBatches.get(exchange);
    if (batch?.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    
    // OPTIMIZED: Close all pooled connections
    const pool = this.connectionPools.get(exchange);
    if (pool) {
      pool.connections.forEach(ws => {
        if (ws) {
          try {
            ws.close();
          } catch (error) {
            console.error(`Error closing WebSocket connection to ${exchange}:`, error);
          }
        }
      });
      pool.connections = [];
    }
    
    // Update connection state
    this.connectionStates.set(exchange, ConnectionState.DISCONNECTED);
    this.reconnectAttempts.set(exchange, 0);
    
    this.emit('disconnected', exchange);
  }
  
  /**
   * Subscribe to market data
   */
  subscribe(subscription: Subscription): string {
    const subId = this.generateSubscriptionId(subscription);
    
    // Store subscription
    this.subscriptions.set(subId, subscription);
    
    // If connected, send subscription message
    if (this.connectionStates.get(subscription.exchange) === ConnectionState.CONNECTED) {
      this.sendSubscription(subscription);
    }
    
    return subId;
  }
  
  /**
   * Unsubscribe from market data
   */
  unsubscribe(subscriptionId: string): boolean {
    // Get subscription
    if (!this.subscriptions.has(subscriptionId)) {
      return false;
    }
    
    const subscription = this.subscriptions.get(subscriptionId)!;
    
    // If connected, send unsubscription message
    if (this.connectionStates.get(subscription.exchange) === ConnectionState.CONNECTED) {
      this.sendUnsubscription(subscription);
    }
    
    // Remove subscription
    this.subscriptions.delete(subscriptionId);
    
    return true;
  }
  
  /**
   * Get connection state for an exchange
   */
  getConnectionState(exchange: Exchange): ConnectionState {
    return this.connectionStates.get(exchange) || ConnectionState.DISCONNECTED;
  }
  
  /**
   * Check if connected to an exchange
   */
  isConnected(exchange: Exchange): boolean {
    return this.connectionStates.get(exchange) === ConnectionState.CONNECTED;
  }
  
  /**
   * Get all active subscriptions
   */
  getSubscriptions(): Map<string, Subscription> {
    return new Map(this.subscriptions);
  }
  
  /**
   * OPTIMIZED: Handle WebSocket open event for pooled connections
   */
  private handlePooledOpen(exchange: Exchange, connectionIndex: number): void {
    console.log(`WebSocket connection ${connectionIndex} to ${exchange} opened`);
    
    // Check if all connections in pool are ready
    const pool = this.connectionPools.get(exchange)!;
    const readyConnections = pool.connections.filter(ws => ws && ws.readyState === WebSocket.OPEN);
    
    // If this is the first connection or all are ready, update state
    if (readyConnections.length === 1 || readyConnections.length === pool.maxConnections) {
      this.connectionStates.set(exchange, ConnectionState.CONNECTED);
      this.reconnectAttempts.set(exchange, 0);
      
      if (readyConnections.length === 1) {
        this.emit('connected', exchange);
        
        // Re-subscribe to all active subscriptions for this exchange
        for (const [subId, subscription] of this.subscriptions.entries()) {
          if (subscription.exchange === exchange) {
            this.sendSubscription(subscription);
          }
        }
      }
    }
  }
  
  /**
   * OPTIMIZED: Handle WebSocket message event with batching support
   */
  private handlePooledMessage(exchange: Exchange, data: WebSocket.Data): void {
    try {
      let message: any;
      
      // OPTIMIZED: Handle binary messages for Binance
      if (this.config.enableBinaryMessages && exchange === Exchange.BINANCE && Buffer.isBuffer(data)) {
        // For Binance, binary messages are still JSON but compressed
        message = JSON.parse(data.toString());
      } else {
        message = JSON.parse(data.toString());
      }
      
      // OPTIMIZED: Use message batching to reduce CPU overhead
      if (this.config.batchMessages) {
        this.addToMessageBatch(exchange, message);
      } else {
        this.processMessage(exchange, message);
      }
    } catch (error) {
      console.error(`Error handling WebSocket message from ${exchange}:`, error);
      this.emit('error', exchange, error);
    }
  }
  
  /**
   * OPTIMIZED: Add message to batch for processing
   */
  private addToMessageBatch(exchange: Exchange, message: any): void {
    const batch = this.messageBatches.get(exchange)!;
    batch.messages.push(message);
    
    // Flush batch if max size reached
    if (batch.messages.length >= this.config.maxBatchSize) {
      this.flushMessageBatch(exchange);
      return;
    }
    
    // Set timer for batch flush if not already set
    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        this.flushMessageBatch(exchange);
      }, this.config.batchInterval);
    }
  }
  
  /**
   * OPTIMIZED: Flush and process batched messages
   */
  private flushMessageBatch(exchange: Exchange): void {
    const batch = this.messageBatches.get(exchange)!;
    
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    
    if (batch.messages.length === 0) return;
    
    // Process all messages in batch
    for (const message of batch.messages) {
      this.processMessage(exchange, message);
    }
    
    // Clear batch
    batch.messages = [];
    batch.lastFlush = Date.now();
  }
  
  /**
   * OPTIMIZED: Process individual message
   */
  private processMessage(exchange: Exchange, message: any): void {
    // Normalize and emit the data based on exchange and message type
    const normalized = this.normalizeMessage(exchange, message);
    
    if (normalized) {
      this.emit('data', exchange, normalized);
    }
  }
  
  /**
   * OPTIMIZED: Handle WebSocket error event for pooled connections
   */
  private handlePooledError(exchange: Exchange, connectionIndex: number, error: Error): void {
    console.error(`WebSocket error from ${exchange} connection ${connectionIndex}:`, error);
    
    // Check if any connections are still healthy
    const pool = this.connectionPools.get(exchange)!;
    const healthyConnections = pool.connections.filter(ws => ws && ws.readyState === WebSocket.OPEN);
    
    if (healthyConnections.length === 0) {
      this.connectionStates.set(exchange, ConnectionState.ERROR);
      this.emit('error', exchange, error);
    }
  }
  
  /**
   * OPTIMIZED: Handle WebSocket close event for pooled connections
   */
  private handlePooledClose(exchange: Exchange, connectionIndex: number, code: number, reason: string): void {
    console.log(`WebSocket connection ${connectionIndex} to ${exchange} closed:`, code, reason);
    
    const pool = this.connectionPools.get(exchange)!;
    
    // Remove the closed connection
    if (pool.connections[connectionIndex]) {
      pool.connections[connectionIndex] = null as any;
    }
    
    // Check if any connections are still healthy
    const healthyConnections = pool.connections.filter(ws => ws && ws.readyState === WebSocket.OPEN);
    
    if (healthyConnections.length === 0) {
      // All connections closed
      this.connectionStates.set(exchange, ConnectionState.DISCONNECTED);
      this.emit('disconnected', exchange, code, reason);
      
      // Clear ping interval
      if (this.pingIntervals.has(exchange)) {
        clearInterval(this.pingIntervals.get(exchange)!);
        this.pingIntervals.delete(exchange);
      }
      
      // Attempt reconnection if enabled
      if (this.config.autoReconnect) {
        this.attemptReconnect(exchange);
      }
    } else {
      // Some connections still healthy, try to recreate this one
      setTimeout(() => {
        this.createPooledConnection(exchange, connectionIndex).catch(error => {
          console.error(`Failed to recreate connection ${connectionIndex} for ${exchange}:`, error);
        });
      }, 1000);
    }
  }
  
  /**
   * Set up ping interval to keep connection alive
   */
  private setupPingInterval(exchange: Exchange): void {
    // Clear existing interval
    if (this.pingIntervals.has(exchange)) {
      clearInterval(this.pingIntervals.get(exchange)!);
    }
    
    // Set new interval
    const interval = setInterval(() => {
      this.sendPing(exchange);
    }, this.config.pingInterval);
    
    this.pingIntervals.set(exchange, interval);
  }
  
  /**
   * OPTIMIZED: Send ping to keep connections alive (uses connection pool)
   */
  private sendPing(exchange: Exchange): void {
    const pool = this.connectionPools.get(exchange);
    if (!pool) return;
    
    // Send ping through all healthy connections
    pool.connections.forEach((ws, index) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          // Different exchanges have different ping formats
          switch (exchange) {
            case Exchange.BINANCE:
              ws.send(JSON.stringify({ method: 'ping' }));
              break;
            case Exchange.COINBASE:
              ws.send(JSON.stringify({ type: 'ping' }));
              break;
            default:
              // Default ping (may not work for all exchanges)
              ws.ping();
          }
        } catch (error) {
          console.error(`Error sending ping to ${exchange} connection ${index}:`, error);
        }
      }
    });
  }
  
  /**
   * Get WebSocket URL for an exchange
   */
  private getWebSocketUrl(exchange: Exchange): string {
    switch (exchange) {
      case Exchange.BINANCE:
        return 'wss://stream.binance.com:9443/ws';
      case Exchange.COINBASE:
        return 'wss://ws-feed.exchange.coinbase.com';
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
  
  /**
   * OPTIMIZED: Send subscription message to exchange (uses connection pool)
   */
  private sendSubscription(subscription: Subscription): void {
    const ws = this.getNextConnection(subscription.exchange);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      const message = this.createSubscriptionMessage(subscription);
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`Error sending subscription to ${subscription.exchange}:`, error);
      this.emit('error', subscription.exchange, error);
    }
  }
  
  /**
   * OPTIMIZED: Send unsubscription message to exchange (uses connection pool)
   */
  private sendUnsubscription(subscription: Subscription): void {
    const ws = this.getNextConnection(subscription.exchange);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      const message = this.createUnsubscriptionMessage(subscription);
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`Error sending unsubscription to ${subscription.exchange}:`, error);
      this.emit('error', subscription.exchange, error);
    }
  }
  
  /**
   * Create subscription message based on exchange
   */
  private createSubscriptionMessage(subscription: Subscription): any {
    const { exchange, type, symbol, timeframe } = subscription;
    
    switch (exchange) {
      case Exchange.BINANCE:
        // Format: { method: "SUBSCRIBE", params: ["btcusdt@trade"], id: 1 }
        const stream = this.getBinanceStreamName(symbol, type, timeframe);
        return {
          method: 'SUBSCRIBE',
          params: [stream],
          id: Date.now(),
        };
        
      case Exchange.COINBASE:
        // Format: { type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }
        const channel = this.getCoinbaseChannelName(type);
        return {
          type: 'subscribe',
          product_ids: [this.formatSymbolForExchange(symbol, exchange)],
          channels: [channel],
        };
        
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
  
  /**
   * Create unsubscription message based on exchange
   */
  private createUnsubscriptionMessage(subscription: Subscription): any {
    const { exchange, type, symbol, timeframe } = subscription;
    
    switch (exchange) {
      case Exchange.BINANCE:
        // Format: { method: "UNSUBSCRIBE", params: ["btcusdt@trade"], id: 1 }
        const stream = this.getBinanceStreamName(symbol, type, timeframe);
        return {
          method: 'UNSUBSCRIBE',
          params: [stream],
          id: Date.now(),
        };
        
      case Exchange.COINBASE:
        // Format: { type: "unsubscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }
        const channel = this.getCoinbaseChannelName(type);
        return {
          type: 'unsubscribe',
          product_ids: [this.formatSymbolForExchange(symbol, exchange)],
          channels: [channel],
        };
        
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
  
  /**
   * Get Binance stream name for subscription
   */
  private getBinanceStreamName(
    symbol: string,
    type: SubscriptionType,
    timeframe?: Timeframe
  ): string {
    const formattedSymbol = this.formatSymbolForExchange(symbol, Exchange.BINANCE).toLowerCase();
    
    switch (type) {
      case SubscriptionType.TICKER:
        return `${formattedSymbol}@ticker`;
      case SubscriptionType.TRADES:
        return `${formattedSymbol}@trade`;
      case SubscriptionType.ORDERBOOK:
        return `${formattedSymbol}@depth20@100ms`; // 20 levels, 100ms updates
      case SubscriptionType.KLINE:
        const interval = this.timeframeToExchangeInterval(timeframe!, Exchange.BINANCE);
        return `${formattedSymbol}@kline_${interval}`;
      default:
        throw new Error(`Unsupported subscription type: ${type}`);
    }
  }
  
  /**
   * Get Coinbase channel name for subscription
   */
  private getCoinbaseChannelName(type: SubscriptionType): string {
    switch (type) {
      case SubscriptionType.TICKER:
        return 'ticker';
      case SubscriptionType.TRADES:
        return 'matches';
      case SubscriptionType.ORDERBOOK:
        return 'level2';
      case SubscriptionType.KLINE:
        // Coinbase doesn't directly support kline/candle subscriptions
        // We'll use ticker data and aggregate it ourselves
        return 'ticker';
      default:
        throw new Error(`Unsupported subscription type: ${type}`);
    }
  }
  
  /**
   * Convert timeframe to exchange-specific interval
   */
  private timeframeToExchangeInterval(timeframe: Timeframe, exchange: Exchange): string {
    switch (exchange) {
      case Exchange.BINANCE:
        switch (timeframe) {
          case Timeframe.ONE_MINUTE:
            return '1m';
          case Timeframe.FIVE_MINUTES:
            return '5m';
          case Timeframe.FIFTEEN_MINUTES:
            return '15m';
          case Timeframe.THIRTY_MINUTES:
            return '30m';
          case Timeframe.ONE_HOUR:
            return '1h';
          case Timeframe.FOUR_HOURS:
            return '4h';
          case Timeframe.ONE_DAY:
            return '1d';
          case Timeframe.ONE_WEEK:
            return '1w';
          case Timeframe.ONE_MONTH:
            return '1M';
          default:
            throw new Error(`Unsupported timeframe: ${timeframe}`);
        }
        
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
  
  /**
   * Format symbol for exchange-specific format
   */
  private formatSymbolForExchange(symbol: string, exchange: Exchange): string {
    switch (exchange) {
      case Exchange.BINANCE:
        // Convert BTC/USD to BTCUSDT
        return symbol.replace('/', '') + (symbol.endsWith('/USD') ? 'T' : '');
        
      case Exchange.COINBASE:
        // Convert BTC/USD to BTC-USD
        return symbol.replace('/', '-');
        
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
  
  /**
   * Normalize WebSocket message based on exchange
   */
  private normalizeMessage(exchange: Exchange, message: any): Tick | Bar | OrderBook | null {
    try {
      switch (exchange) {
        case Exchange.BINANCE:
          return this.normalizeBinanceMessage(message);
        case Exchange.COINBASE:
          return this.normalizeCoinbaseMessage(message);
        default:
          return null;
      }
    } catch (error) {
      console.error(`Error normalizing message from ${exchange}:`, error);
      return null;
    }
  }
  
  /**
   * Normalize Binance WebSocket message
   */
  private normalizeBinanceMessage(message: any): Tick | Bar | OrderBook | null {
    // Handle ping/pong messages
    if (message.result !== undefined || message.id !== undefined) {
      return null;
    }
    
    // Handle different stream types
    if (message.e === 'trade') {
      // Trade message
      return {
        symbol: this.normalizeSymbol(message.s),
        timestamp: new Date(message.T),
        price: parseFloat(message.p),
        volume: parseFloat(message.q),
        side: message.m ? 'sell' : 'buy',
        id: message.t.toString(),
      } as Tick;
    } else if (message.e === 'kline') {
      // Kline/candlestick message
      const kline = message.k;
      return {
        symbol: this.normalizeSymbol(message.s),
        timestamp: new Date(kline.t),
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v),
      } as Bar;
    } else if (message.e === 'depthUpdate') {
      // Order book update
      return {
        symbol: this.normalizeSymbol(message.s),
        timestamp: new Date(message.E),
        bids: message.b.map((bid: string[]) => ({
          price: parseFloat(bid[0]),
          volume: parseFloat(bid[1]),
        })),
        asks: message.a.map((ask: string[]) => ({
          price: parseFloat(ask[0]),
          volume: parseFloat(ask[1]),
        })),
      } as OrderBook;
    } else if (message.e === '24hrTicker') {
      // Ticker message - convert to Tick
      return {
        symbol: this.normalizeSymbol(message.s),
        timestamp: new Date(message.E),
        price: parseFloat(message.c), // Last price
        volume: parseFloat(message.v), // 24h volume
        side: 'buy', // Default side for ticker (not specified)
        id: message.E.toString(), // Use event time as ID
      } as Tick;
    }
    
    return null;
  }
  
  /**
   * Normalize Coinbase WebSocket message
   */
  private normalizeCoinbaseMessage(message: any): Tick | Bar | OrderBook | null {
    // Handle heartbeat messages
    if (message.type === 'heartbeat' || message.type === 'subscriptions') {
      return null;
    }
    
    // Get normalized symbol
    const symbol = message.product_id ? this.normalizeSymbol(message.product_id) : '';
    
    // Handle different message types
    switch (message.type) {
      case 'ticker':
        // Ticker message
        return {
          symbol,
          timestamp: new Date(message.time),
          price: parseFloat(message.price),
          volume: parseFloat(message.last_size || '0'),
          side: message.side || 'buy',
          id: message.trade_id?.toString() || Date.now().toString(),
        } as Tick;
        
      case 'match':
      case 'last_match':
        // Trade message
        return {
          symbol,
          timestamp: new Date(message.time),
          price: parseFloat(message.price),
          volume: parseFloat(message.size),
          side: message.side,
          id: message.trade_id.toString(),
        } as Tick;
        
      case 'snapshot':
        // Order book snapshot
        return {
          symbol,
          timestamp: new Date(),
          bids: message.bids.map((bid: string[]) => ({
            price: parseFloat(bid[0]),
            volume: parseFloat(bid[1]),
          })),
          asks: message.asks.map((ask: string[]) => ({
            price: parseFloat(ask[0]),
            volume: parseFloat(ask[1]),
          })),
        } as OrderBook;
        
      case 'l2update':
        // Order book update (need to apply changes to existing book)
        // This requires maintaining local state of the order book
        // For now, we'll just return the changes
        return {
          symbol,
          timestamp: new Date(message.time),
          bids: message.changes
            .filter((change: string[]) => change[0] === 'buy')
            .map((change: string[]) => ({
              price: parseFloat(change[1]),
              volume: parseFloat(change[2]),
            })),
          asks: message.changes
            .filter((change: string[]) => change[0] === 'sell')
            .map((change: string[]) => ({
              price: parseFloat(change[1]),
              volume: parseFloat(change[2]),
            })),
        } as OrderBook;
        
      default:
        return null;
    }
  }
  
  /**
   * Normalize exchange symbol to standard format (BTC/USD)
   */
  private normalizeSymbol(symbol: string): string {
    // Convert BTCUSDT to BTC/USD
    if (symbol.endsWith('USDT')) {
      return symbol.replace('USDT', '/USD');
    }
    // Convert BTC-USD to BTC/USD
    else if (symbol.includes('-')) {
      return symbol.replace('-', '/');
    }
    
    return symbol;
  }
  
  /**
   * Generate a unique ID for a subscription
   */
  private generateSubscriptionId(subscription: Subscription): string {
    const { exchange, type, symbol, timeframe } = subscription;
    const key = `${exchange}:${type}:${symbol}:${timeframe || ''}`;
    return createHash('md5').update(key).digest('hex');
  }
  
  /**
   * Handle WebSocket open event
   */
  private handleOpen(exchange: Exchange): void {
    // Update connection state
    this.connectionStates.set(exchange, ConnectionState.CONNECTED);
    this.reconnectAttempts.set(exchange, 0);
    
    this.emit('connected', exchange);
    
    // Re-subscribe to all active subscriptions for this exchange
    for (const [subId, subscription] of this.subscriptions.entries()) {
      if (subscription.exchange === exchange) {
        this.sendSubscription(subscription);
      }
    }
  }
  
  /**
   * Handle WebSocket message event
   */
  private handleMessage(exchange: Exchange, data: WebSocket.Data): void {
    try {
      // Parse message data
      const message = JSON.parse(data.toString());
      
      // Normalize and emit the data based on exchange and message type
      const normalized = this.normalizeMessage(exchange, message);
      
      if (normalized) {
        this.emit('data', exchange, normalized);
      }
    } catch (error) {
      console.error(`Error handling WebSocket message from ${exchange}:`, error);
      this.emit('error', exchange, error);
    }
  }
  
  /**
   * Handle WebSocket error event
   */
  private handleError(exchange: Exchange, error: Error): void {
    console.error(`WebSocket error from ${exchange}:`, error);
    
    this.connectionStates.set(exchange, ConnectionState.ERROR);
    this.emit('error', exchange, error);
  }
  
  /**
   * Handle WebSocket close event
   */
  private handleClose(exchange: Exchange, code: number, reason: string): void {
    console.log(`WebSocket connection to ${exchange} closed:`, code, reason);
    
    // Clear ping interval
    if (this.pingIntervals.has(exchange)) {
      clearInterval(this.pingIntervals.get(exchange)!);
      this.pingIntervals.delete(exchange);
    }
    
    // Update connection state
    this.connectionStates.set(exchange, ConnectionState.DISCONNECTED);
    
    this.emit('disconnected', exchange, code, reason);
    
    // Attempt reconnection if enabled
    if (this.config.autoReconnect) {
      this.attemptReconnect(exchange);
    }
  }
  
  /**
   * Attempt to reconnect to an exchange
   */
  private attemptReconnect(exchange: Exchange): void {
    const attempts = this.reconnectAttempts.get(exchange) || 0;
    
    // Check if max attempts reached
    if (attempts >= this.config.maxReconnectAttempts) {
      console.error(`Maximum reconnection attempts (${this.config.maxReconnectAttempts}) reached for ${exchange}`);
      this.emit('reconnect_failed', exchange);
      return;
    }
    
    // Increment reconnect attempts
    this.reconnectAttempts.set(exchange, attempts + 1);
    
    // Update connection state
    this.connectionStates.set(exchange, ConnectionState.RECONNECTING);
    
    // Attempt to reconnect after delay
    const delay = this.config.reconnectDelay * Math.pow(1.5, attempts); // Exponential backoff
    
    console.log(`Attempting to reconnect to ${exchange} in ${delay}ms (attempt ${attempts + 1}/${this.config.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect(exchange);
    }, delay);
  }
} 