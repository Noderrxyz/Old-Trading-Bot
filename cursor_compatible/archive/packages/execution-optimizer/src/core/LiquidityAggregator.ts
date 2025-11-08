import {
  Exchange,
  LiquiditySnapshot,
  ExchangeLiquidity,
  OrderBookDepth,
  PriceLevel,
  AggregatedLevel,
  Trade,
  MarketData,
  ExchangeMarketData,
  PriceSource,
  WebSocketConfig,
  Subscription,
  ChannelType,
  ExecutionError,
  ExecutionErrorCode
} from '../types';
import { Logger } from 'winston';
import EventEmitter from 'events';
import WebSocket from 'ws';
import NodeCache from 'node-cache';

interface AggregatorState {
  exchanges: Map<string, Exchange>;
  orderBooks: Map<string, Map<string, OrderBook>>; // symbol -> exchange -> orderbook
  trades: Map<string, Trade[]>;
  marketData: Map<string, MarketData>;
  connections: Map<string, WebSocket>;
  lastUpdate: Map<string, number>;
}

interface OrderBook {
  bids: PriceLevel[];
  asks: PriceLevel[];
  lastUpdate: number;
  sequenceId?: number;
}

export class LiquidityAggregator extends EventEmitter {
  private logger: Logger;
  private state: AggregatorState;
  private cache: NodeCache;
  private updateInterval?: NodeJS.Timeout;
  private reconnectAttempts: Map<string, number>;

  constructor(logger: Logger, exchanges: Exchange[]) {
    super();
    this.logger = logger;
    
    this.state = {
      exchanges: new Map(exchanges.map(e => [e.id, e])),
      orderBooks: new Map(),
      trades: new Map(),
      marketData: new Map(),
      connections: new Map(),
      lastUpdate: new Map()
    };
    
    this.cache = new NodeCache({ stdTTL: 1, checkperiod: 0.5 });
    this.reconnectAttempts = new Map();
    
    // Initialize WebSocket connections
    this.initializeConnections();
  }

  /**
   * Get aggregated liquidity snapshot for a symbol
   */
  async getAggregatedLiquidity(symbol: string): Promise<LiquiditySnapshot> {
    const cacheKey = `liquidity-${symbol}`;
    const cached = this.cache.get<LiquiditySnapshot>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      // Aggregate order books from all exchanges
      const exchangeLiquidity = await this.getExchangeLiquidity(symbol);
      const aggregatedDepth = this.aggregateOrderBooks(exchangeLiquidity);
      
      // Calculate best bid/ask
      const { bestBid, bestAsk } = this.calculateBestPrices(exchangeLiquidity);
      
      // Calculate spread and imbalance
      const spread = bestAsk.price - bestBid.price;
      const spreadPercentage = spread / ((bestAsk.price + bestBid.price) / 2);
      const imbalance = this.calculateImbalance(aggregatedDepth);
      
      const snapshot: LiquiditySnapshot = {
        symbol,
        timestamp: Date.now(),
        exchanges: exchangeLiquidity,
        aggregatedDepth,
        bestBid,
        bestAsk,
        spread,
        spreadPercentage,
        imbalance
      };
      
      // Cache the snapshot
      this.cache.set(cacheKey, snapshot);
      
      return snapshot;
      
    } catch (error) {
      this.logger.error('Failed to aggregate liquidity', { symbol, error });
      throw new ExecutionError(
        ExecutionErrorCode.EXCHANGE_ERROR,
        'Failed to aggregate liquidity'
      );
    }
  }

  /**
   * Get real-time market data for a symbol
   */
  async getMarketData(symbol: string): Promise<MarketData> {
    const cached = this.state.marketData.get(symbol);
    if (cached && Date.now() - cached.timestamp < 1000) {
      return cached;
    }

    const exchanges: Record<string, ExchangeMarketData> = {};
    
    for (const [exchangeId, exchange] of this.state.exchanges) {
      const orderBook = this.state.orderBooks.get(symbol)?.get(exchangeId);
      if (!orderBook || !orderBook.bids.length || !orderBook.asks.length) {
        continue;
      }

      exchanges[exchangeId] = {
        bid: orderBook.bids[0].price,
        ask: orderBook.asks[0].price,
        last: this.getLastTradePrice(symbol, exchangeId),
        volume24h: this.calculate24hVolume(symbol, exchangeId),
        high24h: this.calculate24hHigh(symbol, exchangeId),
        low24h: this.calculate24hLow(symbol, exchangeId),
        vwap24h: this.calculate24hVWAP(symbol, exchangeId),
        trades24h: this.count24hTrades(symbol, exchangeId)
      };
    }

    const aggregated = this.aggregateMarketData(exchanges);
    
    const marketData: MarketData = {
      symbol,
      exchanges,
      aggregated,
      timestamp: Date.now()
    };

    this.state.marketData.set(symbol, marketData);
    return marketData;
  }

  /**
   * Subscribe to real-time updates for symbols
   */
  subscribe(symbols: string[]): void {
    for (const [exchangeId, ws] of this.state.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        this.subscribeToExchange(exchangeId, symbols);
      }
    }
  }

  /**
   * Unsubscribe from symbols
   */
  unsubscribe(symbols: string[]): void {
    for (const [exchangeId, ws] of this.state.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        this.unsubscribeFromExchange(exchangeId, symbols);
      }
    }
  }

  // Private methods

  private initializeConnections(): void {
    for (const exchange of this.state.exchanges.values()) {
      if (exchange.capabilities.includes('WEBSOCKET_FEED' as any)) {
        this.connectToExchange(exchange);
      }
    }
    
    // Start periodic refresh
    this.updateInterval = setInterval(() => {
      this.refreshStaleData();
    }, 5000);
  }

  private connectToExchange(exchange: Exchange): void {
    this.logger.info(`Connecting to ${exchange.name} WebSocket`);
    
    // Mock WebSocket URL - in production, use actual exchange URLs
    const wsUrl = `wss://stream.${exchange.id}.com/ws`;
    
    const ws = new WebSocket(wsUrl, {
      perMessageDeflate: true,
      handshakeTimeout: 10000
    });

    ws.on('open', () => {
      this.logger.info(`Connected to ${exchange.name}`);
      this.state.connections.set(exchange.id, ws);
      this.reconnectAttempts.set(exchange.id, 0);
      
      // Subscribe to default channels
      this.subscribeToExchange(exchange.id, []);
    });

    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(exchange.id, data);
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket error for ${exchange.name}`, error);
    });

    ws.on('close', () => {
      this.logger.warn(`Disconnected from ${exchange.name}`);
      this.state.connections.delete(exchange.id);
      
      // Attempt reconnection
      this.scheduleReconnect(exchange);
    });

    ws.on('ping', () => {
      ws.pong();
    });
  }

  private scheduleReconnect(exchange: Exchange): void {
    const attempts = this.reconnectAttempts.get(exchange.id) || 0;
    
    if (attempts < 5) {
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
      
      setTimeout(() => {
        this.logger.info(`Reconnecting to ${exchange.name} (attempt ${attempts + 1})`);
        this.reconnectAttempts.set(exchange.id, attempts + 1);
        this.connectToExchange(exchange);
      }, delay);
    } else {
      this.logger.error(`Max reconnection attempts reached for ${exchange.name}`);
    }
  }

  private handleMessage(exchangeId: string, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'orderbook':
          this.handleOrderBookUpdate(exchangeId, message);
          break;
        case 'trade':
          this.handleTradeUpdate(exchangeId, message);
          break;
        case 'ticker':
          this.handleTickerUpdate(exchangeId, message);
          break;
        default:
          this.logger.debug('Unknown message type', { exchangeId, type: message.type });
      }
      
      this.state.lastUpdate.set(exchangeId, Date.now());
      
    } catch (error) {
      this.logger.error('Failed to parse message', { exchangeId, error });
    }
  }

  private handleOrderBookUpdate(exchangeId: string, message: any): void {
    const { symbol, bids, asks, sequence } = message.data;
    
    let symbolBooks = this.state.orderBooks.get(symbol);
    if (!symbolBooks) {
      symbolBooks = new Map();
      this.state.orderBooks.set(symbol, symbolBooks);
    }

    const orderBook: OrderBook = {
      bids: this.parsePriceLevels(bids).slice(0, 50), // Keep top 50 levels
      asks: this.parsePriceLevels(asks).slice(0, 50),
      lastUpdate: Date.now(),
      sequenceId: sequence
    };

    symbolBooks.set(exchangeId, orderBook);
    
    // Emit update event
    this.emit('orderBookUpdate', {
      exchangeId,
      symbol,
      orderBook
    });
  }

  private handleTradeUpdate(exchangeId: string, message: any): void {
    const { symbol, price, quantity, side, timestamp, id } = message.data;
    
    const trade: Trade = {
      id: id || `${exchangeId}-${Date.now()}`,
      symbol,
      price: parseFloat(price),
      quantity: parseFloat(quantity),
      timestamp: timestamp || Date.now(),
      side: side.toLowerCase(),
      exchange: exchangeId
    };

    // Store recent trades
    const key = `${symbol}-${exchangeId}`;
    const trades = this.state.trades.get(key) || [];
    trades.unshift(trade);
    
    // Keep only recent trades (last 1000)
    if (trades.length > 1000) {
      trades.pop();
    }
    
    this.state.trades.set(key, trades);
    
    // Emit trade event
    this.emit('trade', trade);
  }

  private handleTickerUpdate(exchangeId: string, message: any): void {
    // Update market data with ticker information
    const { symbol, bid, ask, last, volume } = message.data;
    
    let marketData = this.state.marketData.get(symbol);
    if (!marketData) {
      marketData = {
        symbol,
        exchanges: {},
        aggregated: {} as any,
        timestamp: Date.now()
      };
      this.state.marketData.set(symbol, marketData);
    }

    marketData.exchanges[exchangeId] = {
      ...marketData.exchanges[exchangeId],
      bid: parseFloat(bid),
      ask: parseFloat(ask),
      last: parseFloat(last),
      volume24h: parseFloat(volume)
    };
  }

  private parsePriceLevels(levels: any[]): PriceLevel[] {
    return levels.map(level => ({
      price: parseFloat(level[0]),
      quantity: parseFloat(level[1]),
      orders: level[2] ? parseInt(level[2]) : 1
    }));
  }

  private async getExchangeLiquidity(symbol: string): Promise<ExchangeLiquidity[]> {
    const exchangeLiquidity: ExchangeLiquidity[] = [];
    
    const symbolBooks = this.state.orderBooks.get(symbol);
    if (!symbolBooks) {
      return exchangeLiquidity;
    }

    for (const [exchangeId, orderBook] of symbolBooks) {
      const exchange = this.state.exchanges.get(exchangeId);
      if (!exchange || !exchange.status.operational) {
        continue;
      }

      const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
      const lastTrade = trades[0] || this.createMockTrade(symbol, exchangeId);
      
      exchangeLiquidity.push({
        exchange: exchangeId,
        bid: orderBook.bids,
        ask: orderBook.asks,
        lastTrade,
        volume24h: this.calculate24hVolume(symbol, exchangeId),
        trades24h: this.count24hTrades(symbol, exchangeId),
        volatility: this.calculateVolatility(symbol, exchangeId)
      });
    }

    return exchangeLiquidity;
  }

  private aggregateOrderBooks(exchangeLiquidity: ExchangeLiquidity[]): OrderBookDepth {
    const aggregatedBids: Map<number, AggregatedLevel> = new Map();
    const aggregatedAsks: Map<number, AggregatedLevel> = new Map();
    
    // Aggregate bids
    for (const exchange of exchangeLiquidity) {
      for (const bid of exchange.bid) {
        const existing = aggregatedBids.get(bid.price);
        if (existing) {
          existing.quantity += bid.quantity;
          existing.exchanges.push(exchange.exchange);
          existing.orders += bid.orders || 1;
        } else {
          aggregatedBids.set(bid.price, {
            price: bid.price,
            quantity: bid.quantity,
            exchanges: [exchange.exchange],
            orders: bid.orders || 1
          });
        }
      }
    }
    
    // Aggregate asks
    for (const exchange of exchangeLiquidity) {
      for (const ask of exchange.ask) {
        const existing = aggregatedAsks.get(ask.price);
        if (existing) {
          existing.quantity += ask.quantity;
          existing.exchanges.push(exchange.exchange);
          existing.orders += ask.orders || 1;
        } else {
          aggregatedAsks.set(ask.price, {
            price: ask.price,
            quantity: ask.quantity,
            exchanges: [exchange.exchange],
            orders: ask.orders || 1
          });
        }
      }
    }
    
    // Sort and convert to arrays
    const bids = Array.from(aggregatedBids.values())
      .sort((a, b) => b.price - a.price)
      .slice(0, 100);
    
    const asks = Array.from(aggregatedAsks.values())
      .sort((a, b) => a.price - b.price)
      .slice(0, 100);
    
    // Calculate metrics
    const totalBidVolume = bids.reduce((sum, b) => sum + b.quantity, 0);
    const totalAskVolume = asks.reduce((sum, a) => sum + a.quantity, 0);
    const midPrice = bids.length && asks.length 
      ? (bids[0].price + asks[0].price) / 2 
      : 0;
    
    // Weighted mid price
    const bidWeight = bids.slice(0, 10).reduce((sum, b) => sum + b.quantity * b.price, 0);
    const askWeight = asks.slice(0, 10).reduce((sum, a) => sum + a.quantity * a.price, 0);
    const totalWeight = bids.slice(0, 10).reduce((sum, b) => sum + b.quantity, 0) +
                       asks.slice(0, 10).reduce((sum, a) => sum + a.quantity, 0);
    const weightedMidPrice = totalWeight > 0 ? (bidWeight + askWeight) / totalWeight : midPrice;
    
    return {
      bids,
      asks,
      midPrice,
      weightedMidPrice,
      totalBidVolume,
      totalAskVolume,
      depthImbalance: (totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume)
    };
  }

  private calculateBestPrices(
    exchangeLiquidity: ExchangeLiquidity[]
  ): { bestBid: PriceLevel; bestAsk: PriceLevel } {
    let bestBid: PriceLevel = { price: 0, quantity: 0 };
    let bestAsk: PriceLevel = { price: Infinity, quantity: 0 };
    
    for (const exchange of exchangeLiquidity) {
      if (exchange.bid.length > 0 && exchange.bid[0].price > bestBid.price) {
        bestBid = {
          ...exchange.bid[0],
          exchange: exchange.exchange
        };
      }
      
      if (exchange.ask.length > 0 && exchange.ask[0].price < bestAsk.price) {
        bestAsk = {
          ...exchange.ask[0],
          exchange: exchange.exchange
        };
      }
    }
    
    return { bestBid, bestAsk };
  }

  private calculateImbalance(depth: OrderBookDepth): number {
    // Calculate order book imbalance
    const bidPressure = depth.bids.slice(0, 10).reduce((sum, b) => sum + b.quantity, 0);
    const askPressure = depth.asks.slice(0, 10).reduce((sum, a) => sum + a.quantity, 0);
    
    return (bidPressure - askPressure) / (bidPressure + askPressure);
  }

  private subscribeToExchange(exchangeId: string, symbols: string[]): void {
    const ws = this.state.connections.get(exchangeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Mock subscription message - format varies by exchange
    const subscribeMsg = {
      method: 'subscribe',
      params: {
        channels: ['orderbook', 'trades', 'ticker'],
        symbols: symbols.length > 0 ? symbols : ['BTC/USDT', 'ETH/USDT']
      }
    };

    ws.send(JSON.stringify(subscribeMsg));
  }

  private unsubscribeFromExchange(exchangeId: string, symbols: string[]): void {
    const ws = this.state.connections.get(exchangeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscribeMsg = {
      method: 'unsubscribe',
      params: {
        channels: ['orderbook', 'trades', 'ticker'],
        symbols
      }
    };

    ws.send(JSON.stringify(unsubscribeMsg));
  }

  private refreshStaleData(): void {
    const staleThreshold = Date.now() - 10000; // 10 seconds
    
    for (const [exchangeId, lastUpdate] of this.state.lastUpdate) {
      if (lastUpdate < staleThreshold) {
        this.logger.warn(`Stale data detected for ${exchangeId}`);
        
        // Mark exchange as potentially problematic
        const exchange = this.state.exchanges.get(exchangeId);
        if (exchange) {
          exchange.reliability = Math.max(0, exchange.reliability - 0.01);
        }
      }
    }
  }

  private getLastTradePrice(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`);
    return trades && trades.length > 0 ? trades[0].price : 0;
  }

  private calculate24hVolume(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    return trades
      .filter(t => t.timestamp > cutoff)
      .reduce((sum, t) => sum + t.quantity * t.price, 0);
  }

  private calculate24hHigh(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    const prices = trades
      .filter(t => t.timestamp > cutoff)
      .map(t => t.price);
    
    return prices.length > 0 ? Math.max(...prices) : 0;
  }

  private calculate24hLow(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    const prices = trades
      .filter(t => t.timestamp > cutoff)
      .map(t => t.price);
    
    return prices.length > 0 ? Math.min(...prices) : 0;
  }

  private calculate24hVWAP(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    const recentTrades = trades.filter(t => t.timestamp > cutoff);
    
    if (recentTrades.length === 0) return 0;
    
    const totalValue = recentTrades.reduce((sum, t) => sum + t.quantity * t.price, 0);
    const totalVolume = recentTrades.reduce((sum, t) => sum + t.quantity, 0);
    
    return totalVolume > 0 ? totalValue / totalVolume : 0;
  }

  private count24hTrades(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    return trades.filter(t => t.timestamp > cutoff).length;
  }

  private calculateVolatility(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    
    if (trades.length < 20) return 0;
    
    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < Math.min(trades.length, 100); i++) {
      const ret = (trades[i - 1].price - trades[i].price) / trades[i].price;
      returns.push(ret);
    }
    
    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * Math.sqrt(252 * 24); // Annualized hourly volatility
  }

  private aggregateMarketData(
    exchanges: Record<string, ExchangeMarketData>
  ): MarketData['aggregated'] {
    const values = Object.values(exchanges);
    
    if (values.length === 0) {
      return {
        bestBid: { price: 0, quantity: 0, exchange: '', timestamp: Date.now() },
        bestAsk: { price: 0, quantity: 0, exchange: '', timestamp: Date.now() },
        midPrice: 0,
        weightedMidPrice: 0,
        spread: 0,
        volume24h: 0,
        vwap24h: 0,
        volatility: 0,
        liquidityScore: 0
      };
    }

    // Find best bid/ask
    let bestBid: PriceSource = { price: 0, quantity: 0, exchange: '', timestamp: Date.now() };
    let bestAsk: PriceSource = { price: Infinity, quantity: 0, exchange: '', timestamp: Date.now() };
    
    for (const [exchangeId, data] of Object.entries(exchanges)) {
      if (data.bid > bestBid.price) {
        bestBid = {
          price: data.bid,
          quantity: 0, // Would need order book data for actual quantity
          exchange: exchangeId,
          timestamp: Date.now()
        };
      }
      
      if (data.ask < bestAsk.price) {
        bestAsk = {
          price: data.ask,
          quantity: 0,
          exchange: exchangeId,
          timestamp: Date.now()
        };
      }
    }
    
    const midPrice = (bestBid.price + bestAsk.price) / 2;
    const spread = bestAsk.price - bestBid.price;
    const volume24h = values.reduce((sum, v) => sum + v.volume24h, 0);
    
    // Weighted average VWAP
    const totalValue = values.reduce((sum, v) => sum + v.vwap24h * v.volume24h, 0);
    const vwap24h = volume24h > 0 ? totalValue / volume24h : 0;
    
    return {
      bestBid,
      bestAsk,
      midPrice,
      weightedMidPrice: midPrice, // Simplified
      spread,
      volume24h,
      vwap24h,
      volatility: 0.02, // Mock value
      liquidityScore: Math.min(100, volume24h / 1000000)
    };
  }

  private createMockTrade(symbol: string, exchangeId: string): Trade {
    return {
      id: `mock-${Date.now()}`,
      symbol,
      price: 0,
      quantity: 0,
      timestamp: Date.now(),
      side: 'buy' as any,
      exchange: exchangeId
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    // Close all WebSocket connections
    for (const [exchangeId, ws] of this.state.connections) {
      ws.close();
      this.state.connections.delete(exchangeId);
    }

    // Clear cache
    this.cache.flushAll();
    
    // Remove all listeners
    this.removeAllListeners();
  }
} 