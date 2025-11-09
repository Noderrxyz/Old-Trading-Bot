/**
 * Mock Exchange Connector
 * 
 * Simulates exchange operations for paper trading mode.
 * Provides realistic behavior including slippage, latency, and order book simulation.
 * Enhanced with Phase 3 data feed integration for realistic market data.
 */

import { 
  IExchangeConnector, 
  OrderRequest, 
  OrderResponse, 
  OrderBook, 
  Quote, 
  TradeHistory, 
  ExchangeStatus, 
  BalanceInfo 
} from '../interfaces/IExchangeConnector';
import { IDataFeed, PriceTick, OrderBookSnapshot } from '../interfaces/IDataFeed';
import { DataFeedFactory } from '../factories/DataFeedFactory';
import { logPaperModeCall, getSimulationConfig } from '../../config/PaperModeConfig';
import { logger } from '../../utils/logger';

interface SimulatedOrderBook {
  symbol: string;
  bids: Array<{ price: number; quantity: number; orders: number }>;
  asks: Array<{ price: number; quantity: number; orders: number }>;
  lastUpdate: number;
  sequenceId: number;
}

interface SimulatedBalance {
  asset: string;
  available: number;
  locked: number;
}

interface PendingOrder {
  order: OrderResponse;
  createdAt: number;
  fillProgress: number;
  remainingAmount: number;
}

export interface MockExchangeConfig {
  enableDataFeed?: boolean;
  dataFeedType?: 'auto' | 'historical' | 'simulated' | 'hybrid';
  historicalDataPath?: string;
  replaySpeed?: number;
  enableRealisticSlippage?: boolean;
  enableMEVSimulation?: boolean;
}

export class MockExchangeConnector implements IExchangeConnector {
  private exchangeId: string;
  private exchangeName: string;
  private connected: boolean = false;
  private sequenceCounter: number = 1000000;
  private orderIdCounter: number = 1;
  private config: MockExchangeConfig;
  
  // Simulated state
  private orderBooks: Map<string, SimulatedOrderBook> = new Map();
  private balances: Map<string, SimulatedBalance> = new Map();
  private orders: Map<string, OrderResponse> = new Map();
  private pendingOrders: Map<string, PendingOrder> = new Map();
  private tradeHistory: TradeHistory[] = [];
  private subscriptions: Map<string, any> = new Map();
  
  // Phase 3: Data feed integration
  private dataFeed?: IDataFeed;
  private dataFeedFactory?: DataFeedFactory;
  private currentPrices: Map<string, number> = new Map();
  private priceUpdateSubscriptions: Map<string, boolean> = new Map();
  
  // Simulation timers
  private orderBookUpdateTimer?: NodeJS.Timeout;
  private orderProcessingTimer?: NodeJS.Timeout;
  
  // Base prices for major pairs (fallback when no data feed)
  private basePrices: Map<string, number> = new Map([
    ['BTC/USDT', 45000],
    ['ETH/USDT', 3000],
    ['BTC/ETH', 15],
    ['USDC/USDT', 1.0001],
    ['MATIC/USDT', 0.85],
    ['AVAX/USDT', 25],
    ['SOL/USDT', 65],
    ['ADA/USDT', 0.45],
    ['DOT/USDT', 6.5],
    ['LINK/USDT', 14.5]
  ]);

  constructor(
    exchangeId: string = 'mock_exchange', 
    exchangeName: string = 'Mock Exchange',
    config?: MockExchangeConfig
  ) {
    this.exchangeId = exchangeId;
    this.exchangeName = exchangeName;
    this.config = {
      enableDataFeed: true,
      dataFeedType: 'auto',
      replaySpeed: 1,
      enableRealisticSlippage: true,
      enableMEVSimulation: true,
      ...config
    };
    
    this.initializeBalances();
    this.initializeOrderBooks();
    
    logger.info('[MOCK_EXCHANGE] Mock exchange connector initialized', {
      exchangeId,
      config: this.config
    });
  }

  getExchangeId(): string {
    return this.exchangeId;
  }

  getExchangeName(): string {
    return this.exchangeName;
  }

  async connect(): Promise<boolean> {
    logPaperModeCall('MockExchangeConnector', 'connect', { exchangeId: this.exchangeId });
    
    const config = getSimulationConfig();
    
    // Simulate connection latency
    const connectionLatency = config.networkLatency.min + 
      Math.random() * (config.networkLatency.max - config.networkLatency.min);
    await this.sleep(connectionLatency);
    
    // Simulate occasional connection failures
    if (Math.random() < config.failureRate * 0.1) { // Lower failure rate for connections
      logger.warn(`[PAPER_MODE] Simulated connection failure for ${this.exchangeId}`);
      return false;
    }
    
    this.connected = true;
    
    // Phase 3: Initialize data feed if enabled
    await this.initializeDataFeed();
    
    this.startSimulation();
    
    logger.info(`[PAPER_MODE] Connected to ${this.exchangeName}`, {
      exchangeId: this.exchangeId,
      latency: connectionLatency,
      dataFeedEnabled: !!this.dataFeed
    });
    
    return true;
  }

  async disconnect(): Promise<void> {
    logPaperModeCall('MockExchangeConnector', 'disconnect', { exchangeId: this.exchangeId });
    
    this.connected = false;
    this.stopSimulation();
    
    // Cleanup data feed
    if (this.dataFeed) {
      await this.dataFeed.stop();
      await this.dataFeed.cleanup();
      this.dataFeed = undefined;
    }
    
    logger.info(`[PAPER_MODE] Disconnected from ${this.exchangeName}`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getOrderBook(symbol: string, depth: number = 50): Promise<OrderBook> {
    logPaperModeCall('MockExchangeConnector', 'getOrderBook', { symbol, depth });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    // Phase 3: Try to get order book from data feed first
    if (this.dataFeed && this.config.enableDataFeed) {
      try {
        const feedOrderBook = await this.dataFeed.getOrderBook(symbol);
        
        // Convert from data feed format to exchange format
        return {
          symbol,
          bids: feedOrderBook.bids.slice(0, depth),
          asks: feedOrderBook.asks.slice(0, depth),
          timestamp: feedOrderBook.timestamp,
          sequenceId: feedOrderBook.sequenceId
        };
      } catch (error) {
        logger.warn('[MOCK_EXCHANGE] Failed to get order book from data feed, using fallback', {
          symbol,
          error: error instanceof Error ? error.message : error
        });
      }
    }
    
    // Fallback to original order book generation
    let orderBook = this.orderBooks.get(symbol);
    if (!orderBook) {
      orderBook = this.generateOrderBook(symbol);
      this.orderBooks.set(symbol, orderBook);
    }
    
    // Add some price movement since last update
    this.updateOrderBookPrices(orderBook);
    
    return {
      symbol,
      bids: orderBook.bids.slice(0, depth),
      asks: orderBook.asks.slice(0, depth),
      timestamp: Date.now(),
      sequenceId: orderBook.sequenceId
    };
  }

  async getQuote(symbol: string): Promise<Quote> {
    logPaperModeCall('MockExchangeConnector', 'getQuote', { symbol });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    // Phase 3: Try to get current price from data feed
    if (this.dataFeed && this.config.enableDataFeed) {
      try {
        const currentPrice = await this.dataFeed.getCurrentPrice(symbol);
        if (currentPrice > 0) {
          // Get liquidity metrics for realistic spread
          const liquidityMetrics = await this.dataFeed.getLiquidityMetrics(symbol);
          const spread = (liquidityMetrics.spreadBps / 10000) * currentPrice;
          
          const bid = currentPrice - spread / 2;
          const ask = currentPrice + spread / 2;
          const spreadPercentage = spread / currentPrice;
          
          return {
            symbol,
            bid,
            ask,
            spread,
            spreadPercentage,
            timestamp: Date.now(),
            exchange: this.exchangeId
          };
        }
      } catch (error) {
        logger.warn('[MOCK_EXCHANGE] Failed to get quote from data feed, using fallback', {
          symbol,
          error: error instanceof Error ? error.message : error
        });
      }
    }
    
    // Fallback to order book-based quote
    const orderBook = await this.getOrderBook(symbol, 1);
    
    if (orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      throw new Error(`No liquidity available for ${symbol}`);
    }
    
    const bid = orderBook.bids[0].price;
    const ask = orderBook.asks[0].price;
    const spread = ask - bid;
    const spreadPercentage = spread / ((bid + ask) / 2);
    
    return {
      symbol,
      bid,
      ask,
      spread,
      spreadPercentage,
      timestamp: Date.now(),
      exchange: this.exchangeId
    };
  }

  async getTicker(symbol: string): Promise<any> {
    logPaperModeCall('MockExchangeConnector', 'getTicker', { symbol });
    
    const quote = await this.getQuote(symbol);
    const orderBook = await this.getOrderBook(symbol, 10);
    
    // Phase 3: Get volume from data feed if available
    let volume24h = 1000000 + Math.random() * 9000000; // Fallback volume
    if (this.dataFeed && this.config.enableDataFeed) {
      try {
        volume24h = await this.dataFeed.getVolumeEstimate(symbol, 24 * 60 * 60 * 1000);
      } catch (error) {
        // Use fallback volume
      }
    }
    
    // Calculate volume and price changes
    const basePrice = this.basePrices.get(symbol) || quote.bid;
    const priceChange = quote.bid - basePrice;
    const priceChangePercent = (priceChange / basePrice) * 100;
    
    return {
      symbol,
      last: quote.bid,
      bid: quote.bid,
      ask: quote.ask,
      change: priceChange,
      changePercent: priceChangePercent,
      high24h: basePrice * (1 + Math.random() * 0.1),
      low24h: basePrice * (1 - Math.random() * 0.1),
      volume24h: volume24h,
      timestamp: Date.now()
    };
  }

  async getMarketStatus(): Promise<ExchangeStatus> {
    logPaperModeCall('MockExchangeConnector', 'getMarketStatus');
    
    await this.simulateLatency();
    
    return {
      operational: this.connected,
      maintenance: false,
      latency: 50 + Math.random() * 100,
      lastUpdate: Date.now(),
      supportedSymbols: Array.from(this.basePrices.keys()),
      tradingEnabled: this.connected
    };
  }

  async getSupportedSymbols(): Promise<string[]> {
    logPaperModeCall('MockExchangeConnector', 'getSupportedSymbols');
    return Array.from(this.basePrices.keys());
  }

  async submitOrder(order: OrderRequest): Promise<OrderResponse> {
    logPaperModeCall('MockExchangeConnector', 'submitOrder', order);
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const config = getSimulationConfig();
    
    // Simulate order rejection
    if (Math.random() < config.failureRate * 0.2) { // Lower rejection rate
      const rejectionReasons = [
        'Insufficient balance',
        'Invalid price',
        'Market closed',
        'Symbol not supported',
        'Order size too small'
      ];
      const reason = rejectionReasons[Math.floor(Math.random() * rejectionReasons.length)];
      
      return {
        orderId: `rejected-${this.orderIdCounter++}`,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        amount: order.amount,
        price: order.price,
        status: 'rejected',
        executedAmount: 0,
        remainingAmount: order.amount,
        fees: 0,
        timestamp: Date.now(),
        transactionId: `rejected-tx-${Date.now()}`
      };
    }
    
    const orderId = `${this.exchangeId}-${this.orderIdCounter++}`;
    const orderResponse: OrderResponse = {
      orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      amount: order.amount,
      price: order.price,
      status: order.type === 'market' ? 'pending' : 'open',
      executedAmount: 0,
      remainingAmount: order.amount,
      fees: 0,
      timestamp: Date.now(),
      transactionId: `tx-${Date.now()}-${orderId}`
    };
    
    this.orders.set(orderId, orderResponse);
    
    // For market orders, simulate immediate execution
    if (order.type === 'market') {
      this.simulateOrderExecution(orderResponse);
    } else {
      // For limit orders, add to pending orders for gradual execution
      this.pendingOrders.set(orderId, {
        order: orderResponse,
        createdAt: Date.now(),
        fillProgress: 0,
        remainingAmount: order.amount
      });
    }
    
    return orderResponse;
  }

  async cancelOrder(orderId: string, symbol?: string): Promise<boolean> {
    logPaperModeCall('MockExchangeConnector', 'cancelOrder', { orderId, symbol });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const order = this.orders.get(orderId);
    if (!order) {
      return false;
    }
    
    if (order.status === 'filled' || order.status === 'cancelled') {
      return false;
    }
    
    order.status = 'cancelled';
    this.orders.set(orderId, order);
    this.pendingOrders.delete(orderId);
    
    logger.info(`[PAPER_MODE] Order cancelled: ${orderId}`);
    return true;
  }

  async getOrderStatus(orderId: string, symbol?: string): Promise<OrderResponse> {
    logPaperModeCall('MockExchangeConnector', 'getOrderStatus', { orderId, symbol });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    return { ...order };
  }

  async getOpenOrders(symbol?: string): Promise<OrderResponse[]> {
    logPaperModeCall('MockExchangeConnector', 'getOpenOrders', { symbol });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const openOrders = Array.from(this.orders.values()).filter(order => {
      const isOpen = order.status === 'open' || order.status === 'partial';
      const matchesSymbol = !symbol || order.symbol === symbol;
      return isOpen && matchesSymbol;
    });
    
    return openOrders.map(order => ({ ...order }));
  }

  async getOrderHistory(symbol?: string, limit: number = 100): Promise<OrderResponse[]> {
    logPaperModeCall('MockExchangeConnector', 'getOrderHistory', { symbol, limit });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const allOrders = Array.from(this.orders.values())
      .filter(order => !symbol || order.symbol === symbol)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    
    return allOrders.map(order => ({ ...order }));
  }

  async getBalances(): Promise<BalanceInfo[]> {
    logPaperModeCall('MockExchangeConnector', 'getBalances');
    
    this.ensureConnected();
    await this.simulateLatency();
    
    return Array.from(this.balances.values()).map(balance => ({
      asset: balance.asset,
      available: balance.available,
      locked: balance.locked,
      total: balance.available + balance.locked
    }));
  }

  async getBalance(asset: string): Promise<BalanceInfo> {
    logPaperModeCall('MockExchangeConnector', 'getBalance', { asset });
    
    const balance = this.balances.get(asset);
    if (!balance) {
      return {
        asset,
        available: 0,
        locked: 0,
        total: 0
      };
    }
    
    return {
      asset: balance.asset,
      available: balance.available,
      locked: balance.locked,
      total: balance.available + balance.locked
    };
  }

  async getTradeHistory(symbol?: string, limit: number = 100): Promise<TradeHistory[]> {
    logPaperModeCall('MockExchangeConnector', 'getTradeHistory', { symbol, limit });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    return this.tradeHistory
      .filter(trade => !symbol || trade.symbol === symbol)
      .slice(0, limit)
      .map(trade => ({ ...trade }));
  }

  async getTradingFees(symbol?: string): Promise<{ maker: number; taker: number }> {
    logPaperModeCall('MockExchangeConnector', 'getTradingFees', { symbol });
    
    // Simulate different fee structures
    const feeStructures = [
      { maker: 0.001, taker: 0.001 }, // 0.1%
      { maker: 0.0005, taker: 0.001 }, // Maker rebate
      { maker: 0.002, taker: 0.002 }  // Higher fee exchange
    ];
    
    return feeStructures[Math.floor(Math.random() * feeStructures.length)];
  }

  // Private helper methods

  private initializeBalances(): void {
    // Initialize with mock balances for testing
    const testBalances = [
      { asset: 'USDT', available: 100000, locked: 0 },
      { asset: 'BTC', available: 1.5, locked: 0 },
      { asset: 'ETH', available: 10, locked: 0 },
      { asset: 'USDC', available: 50000, locked: 0 },
      { asset: 'MATIC', available: 10000, locked: 0 }
    ];
    
    for (const balance of testBalances) {
      this.balances.set(balance.asset, balance);
    }
  }

  private initializeOrderBooks(): void {
    for (const [symbol] of this.basePrices) {
      const orderBook = this.generateOrderBook(symbol);
      this.orderBooks.set(symbol, orderBook);
    }
  }

  private generateOrderBook(symbol: string): SimulatedOrderBook {
    const basePrice = this.basePrices.get(symbol) || 100;
    const config = getSimulationConfig();
    
    // Add price volatility
    const currentPrice = basePrice * (1 + (Math.random() - 0.5) * config.priceVolatility);
    
    const bids: Array<{ price: number; quantity: number; orders: number }> = [];
    const asks: Array<{ price: number; quantity: number; orders: number }> = [];
    
    // Generate realistic order book depth
    for (let i = 0; i < 20; i++) {
      const bidPriceOffset = (i + 1) * 0.001; // 0.1% steps
      const askPriceOffset = (i + 1) * 0.001;
      
      bids.push({
        price: currentPrice * (1 - bidPriceOffset),
        quantity: (Math.random() * 10 + 1) * (1 + i * 0.1), // Increasing quantity at deeper levels
        orders: Math.floor(Math.random() * 5) + 1
      });
      
      asks.push({
        price: currentPrice * (1 + askPriceOffset),
        quantity: (Math.random() * 10 + 1) * (1 + i * 0.1),
        orders: Math.floor(Math.random() * 5) + 1
      });
    }
    
    return {
      symbol,
      bids: bids.sort((a, b) => b.price - a.price), // Highest bid first
      asks: asks.sort((a, b) => a.price - b.price), // Lowest ask first
      lastUpdate: Date.now(),
      sequenceId: this.sequenceCounter++
    };
  }

  private updateOrderBookPrices(orderBook: SimulatedOrderBook): void {
    const config = getSimulationConfig();
    const volatility = config.priceVolatility * 0.1; // Smaller movements for order book updates
    
    const priceChange = (Math.random() - 0.5) * volatility;
    
    // Update all bid prices
    for (const bid of orderBook.bids) {
      bid.price *= (1 + priceChange);
    }
    
    // Update all ask prices
    for (const ask of orderBook.asks) {
      ask.price *= (1 + priceChange);
    }
    
    orderBook.lastUpdate = Date.now();
    orderBook.sequenceId = this.sequenceCounter++;
  }

  private async simulateOrderExecution(order: OrderResponse): Promise<void> {
    const config = getSimulationConfig();
    
    // Simulate execution latency
    const executionLatency = config.executionLatency.min + 
      Math.random() * (config.executionLatency.max - config.executionLatency.min);
    
    setTimeout(async () => {
      try {
        const quote = await this.getQuote(order.symbol);
        const executionPrice = order.side === 'buy' ? quote.ask : quote.bid;
        
        // Apply slippage
        let finalPrice = executionPrice;
        if (config.slippageEnabled) {
          const slippage = Math.random() * 0.002; // Up to 0.2% slippage
          const slippageDirection = order.side === 'buy' ? 1 : -1;
          finalPrice = executionPrice * (1 + slippageDirection * slippage);
        }
        
        // Simulate partial fills
        let executedAmount = order.amount;
        if (Math.random() < 0.1) { // 10% chance of partial fill
          executedAmount = order.amount * (0.7 + Math.random() * 0.3); // 70-100% fill
        }
        
        // Calculate fees
        const fees = await this.getTradingFees(order.symbol);
        const feeAmount = executedAmount * finalPrice * (order.side === 'buy' ? fees.taker : fees.maker);
        
        // Update order
        order.status = executedAmount === order.amount ? 'filled' : 'partial';
        order.executedAmount = executedAmount;
        order.executedPrice = finalPrice;
        order.remainingAmount = order.amount - executedAmount;
        order.fees = feeAmount;
        
        this.orders.set(order.orderId, order);
        
        // Add to trade history
        this.tradeHistory.unshift({
          id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          symbol: order.symbol,
          side: order.side,
          amount: executedAmount,
          price: finalPrice,
          fee: feeAmount,
          timestamp: Date.now(),
          orderId: order.orderId
        });
        
        // Update balances
        this.updateBalancesAfterTrade(order, executedAmount, finalPrice, feeAmount);
        
        logger.info(`[PAPER_MODE] Order executed: ${order.orderId}`, {
          symbol: order.symbol,
          side: order.side,
          executedAmount,
          executedPrice: finalPrice,
          status: order.status
        });
        
      } catch (error) {
        logger.error(`[PAPER_MODE] Order execution failed: ${order.orderId}`, error);
        order.status = 'rejected';
        this.orders.set(order.orderId, order);
      }
    }, executionLatency);
  }

  private updateBalancesAfterTrade(order: OrderResponse, amount: number, price: number, fee: number): void {
    const [baseAsset, quoteAsset] = order.symbol.split('/');
    
    if (order.side === 'buy') {
      // Buying base asset with quote asset
      const quoteBalance = this.balances.get(quoteAsset);
      const baseBalance = this.balances.get(baseAsset);
      
      if (quoteBalance) {
        quoteBalance.available -= (amount * price + fee);
      }
      
      if (baseBalance) {
        baseBalance.available += amount;
      } else {
        this.balances.set(baseAsset, { asset: baseAsset, available: amount, locked: 0 });
      }
    } else {
      // Selling base asset for quote asset
      const baseBalance = this.balances.get(baseAsset);
      const quoteBalance = this.balances.get(quoteAsset);
      
      if (baseBalance) {
        baseBalance.available -= amount;
      }
      
      if (quoteBalance) {
        quoteBalance.available += (amount * price - fee);
      } else {
        this.balances.set(quoteAsset, { asset: quoteAsset, available: amount * price - fee, locked: 0 });
      }
    }
  }

  private startSimulation(): void {
    // Update order books periodically
    this.orderBookUpdateTimer = setInterval(() => {
      for (const [symbol, orderBook] of this.orderBooks) {
        this.updateOrderBookPrices(orderBook);
      }
    }, 1000 + Math.random() * 2000); // Every 1-3 seconds
    
    // Process pending orders
    this.orderProcessingTimer = setInterval(() => {
      this.processPendingOrders();
    }, 5000); // Every 5 seconds
  }

  private stopSimulation(): void {
    if (this.orderBookUpdateTimer) {
      clearInterval(this.orderBookUpdateTimer);
      this.orderBookUpdateTimer = undefined;
    }
    
    if (this.orderProcessingTimer) {
      clearInterval(this.orderProcessingTimer);
      this.orderProcessingTimer = undefined;
    }
  }

  private processPendingOrders(): void {
    const now = Date.now();
    
    for (const [orderId, pendingOrder] of this.pendingOrders) {
      // Simulate gradual order filling for limit orders
      if (Math.random() < 0.3) { // 30% chance per processing cycle
        const fillAmount = pendingOrder.remainingAmount * (0.1 + Math.random() * 0.4); // 10-50% fill
        
        pendingOrder.order.executedAmount += fillAmount;
        pendingOrder.remainingAmount -= fillAmount;
        pendingOrder.fillProgress = pendingOrder.order.executedAmount / pendingOrder.order.amount;
        
        if (pendingOrder.remainingAmount <= 0.001) { // Essentially filled
          pendingOrder.order.status = 'filled';
          pendingOrder.order.remainingAmount = 0;
          this.pendingOrders.delete(orderId);
        } else {
          pendingOrder.order.status = 'partial';
          pendingOrder.order.remainingAmount = pendingOrder.remainingAmount;
        }
        
        this.orders.set(orderId, pendingOrder.order);
      }
    }
  }

  private async simulateLatency(): Promise<void> {
    const config = getSimulationConfig();
    const latency = config.networkLatency.min + 
      Math.random() * (config.networkLatency.max - config.networkLatency.min);
    await this.sleep(latency);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`Exchange ${this.exchangeId} is not connected`);
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.stopSimulation();
    this.orders.clear();
    this.pendingOrders.clear();
    this.orderBooks.clear();
    this.balances.clear();
    this.tradeHistory.length = 0;
    this.subscriptions.clear();
    this.connected = false;
    
    logger.info(`[PAPER_MODE] MockExchangeConnector cleaned up: ${this.exchangeId}`);
  }

  /**
   * Phase 3: Initialize data feed if enabled
   */
  private async initializeDataFeed(): Promise<void> {
    if (!this.config.enableDataFeed) {
      logger.info('[MOCK_EXCHANGE] Data feed disabled by configuration');
      return;
    }

    try {
      this.dataFeedFactory = DataFeedFactory.getInstance({
        preferredFeedType: this.config.dataFeedType || 'auto',
        historicalDataPath: this.config.historicalDataPath,
        fallbackToSimulated: true
      });

      // Get all symbols that we support
      const symbols = Array.from(this.basePrices.keys());
      
      const feedConfig = {
        symbols,
        replaySpeed: this.config.replaySpeed || 1,
        enableAnomalies: this.config.enableMEVSimulation,
        anomalyFrequency: 1.0,
        volatilityMultiplier: 1.0,
        liquidityMultiplier: 1.0
      };

      // Create data feed based on configuration
      switch (this.config.dataFeedType) {
        case 'historical':
          if (this.config.historicalDataPath) {
            this.dataFeed = await this.dataFeedFactory.createHistoricalFeed(
              this.config.historicalDataPath,
              feedConfig
            );
          } else {
            throw new Error('Historical data path required for historical feed type');
          }
          break;
        
        case 'simulated':
          this.dataFeed = await this.dataFeedFactory.createSimulatedFeed(feedConfig);
          break;
        
        case 'hybrid':
          this.dataFeed = await this.dataFeedFactory.createHybridFeed(
            this.config.historicalDataPath || 'data/historical',
            feedConfig
          );
          break;
        
        default:
          // Auto-detect
          this.dataFeed = await this.dataFeedFactory.createAutoFeed(feedConfig);
          break;
      }

      // Set up price update subscriptions
      if (this.dataFeed.onTick) {
        this.dataFeed.onTick((tick: PriceTick) => {
          this.currentPrices.set(tick.symbol, tick.price);
          this.updateOrderBookFromTick(tick);
        });
      }

      if (this.dataFeed.onOrderBookUpdate) {
        this.dataFeed.onOrderBookUpdate((orderBook: OrderBookSnapshot) => {
          this.updateOrderBookFromSnapshot(orderBook);
        });
      }

      // Start the data feed
      await this.dataFeed.start();

      logger.info('[MOCK_EXCHANGE] Data feed initialized successfully', {
        feedType: this.dataFeed.getFeedType(),
        feedId: this.dataFeed.getFeedId(),
        symbols: symbols.length
      });

    } catch (error) {
      logger.error('[MOCK_EXCHANGE] Failed to initialize data feed', {
        error: error instanceof Error ? error.message : error,
        config: this.config
      });
      
      // Continue without data feed
      this.dataFeed = undefined;
    }
  }

  /**
   * Update order book from price tick
   */
  private updateOrderBookFromTick(tick: PriceTick): void {
    const symbol = tick.symbol;
    let orderBook = this.orderBooks.get(symbol);
    
    if (!orderBook) {
      orderBook = this.generateOrderBook(symbol);
      this.orderBooks.set(symbol, orderBook);
    }

    // Update order book around the new price
    const price = tick.price;
    const spread = price * 0.001; // 0.1% spread
    
    // Clear and regenerate order book around new price
    orderBook.bids = [];
    orderBook.asks = [];
    
    // Generate 20 levels on each side
    for (let i = 0; i < 20; i++) {
      const level = i + 1;
      const bidPrice = price - spread * level;
      const askPrice = price + spread * level;
      
      orderBook.bids.push({
        price: bidPrice,
        quantity: 1 + Math.random() * 9, // 1-10 units
        orders: Math.floor(Math.random() * 5) + 1
      });
      
      orderBook.asks.push({
        price: askPrice,
        quantity: 1 + Math.random() * 9, // 1-10 units
        orders: Math.floor(Math.random() * 5) + 1
      });
    }
    
    orderBook.lastUpdate = tick.timestamp;
    orderBook.sequenceId++;
  }

  /**
   * Update order book from data feed snapshot
   */
  private updateOrderBookFromSnapshot(snapshot: OrderBookSnapshot): void {
    const symbol = snapshot.symbol;
    
    const orderBook: SimulatedOrderBook = {
      symbol,
      bids: snapshot.bids.map(bid => ({
        price: bid.price,
        quantity: bid.quantity,
        orders: bid.orders || 1
      })),
      asks: snapshot.asks.map(ask => ({
        price: ask.price,
        quantity: ask.quantity,
        orders: ask.orders || 1
      })),
      lastUpdate: snapshot.timestamp,
      sequenceId: snapshot.sequenceId
    };
    
    this.orderBooks.set(symbol, orderBook);
  }

  /**
   * Enhanced order execution with data feed integration
   */
  private async simulateOrderExecutionWithDataFeed(order: OrderResponse): Promise<void> {
    const symbol = order.symbol;
    
    // Check if we have real-time price from data feed
    let currentPrice = this.currentPrices.get(symbol);
    if (!currentPrice && this.dataFeed) {
      try {
        currentPrice = await this.dataFeed.getCurrentPrice(symbol);
      } catch (error) {
        // Fall back to base price
        currentPrice = this.basePrices.get(symbol) || 1000;
      }
    }
    
    if (!currentPrice) {
      currentPrice = this.basePrices.get(symbol) || 1000;
    }

    // Get realistic slippage from data feed
    let slippageMultiplier = 1.0;
    if (this.dataFeed && this.config.enableRealisticSlippage) {
      try {
        const liquidityMetrics = await this.dataFeed.getLiquidityMetrics(symbol);
        // Higher spread means more slippage
        slippageMultiplier = 1 + (liquidityMetrics.spreadBps / 10000) * 2;
      } catch (error) {
        // Use default slippage
        slippageMultiplier = 1 + Math.random() * 0.002; // 0-0.2%
      }
    }

    // Calculate execution price with slippage
    let executionPrice: number;
    if (order.side === 'buy') {
      executionPrice = currentPrice * slippageMultiplier;
    } else {
      executionPrice = currentPrice / slippageMultiplier;
    }

    // Apply order-specific logic
    if (order.type === 'market') {
      // Market orders execute immediately at current price (with slippage)
      await this.executeOrder(order, order.amount, executionPrice);
    } else if (order.type === 'limit' && order.price) {
      // Limit orders execute if price condition is met
      let shouldExecute = false;
      
      if (order.side === 'buy' && executionPrice <= order.price) {
        shouldExecute = true;
        executionPrice = Math.min(order.price, executionPrice);
      } else if (order.side === 'sell' && executionPrice >= order.price) {
        shouldExecute = true;
        executionPrice = Math.max(order.price, executionPrice);
      }
      
      if (shouldExecute) {
        await this.executeOrder(order, order.amount, executionPrice);
      }
    }
  }

  /**
   * Execute order with calculated price and amount
   */
  private async executeOrder(order: OrderResponse, amount: number, price: number): Promise<void> {
    // Calculate fees
    const fees = await this.getTradingFees(order.symbol);
    const feeAmount = amount * price * (order.side === 'buy' ? fees.taker : fees.maker);
    
    // Update order status
    order.status = 'filled';
    order.executedAmount = amount;
    order.executedPrice = price;
    order.remainingAmount = 0;
    order.fees = feeAmount;
    
    this.orders.set(order.orderId, order);
    
    // Add to trade history
    this.tradeHistory.unshift({
      id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: order.symbol,
      side: order.side,
      amount: amount,
      price: price,
      fee: feeAmount,
      timestamp: Date.now(),
      orderId: order.orderId
    });
    
    // Update balances
    this.updateBalancesAfterTrade(order, amount, price, feeAmount);
    
    logger.info(`[PAPER_MODE] Order executed: ${order.orderId}`, {
      symbol: order.symbol,
      side: order.side,
      executedAmount: amount,
      executedPrice: price,
      status: order.status
    });
  }

  /**
   * Get data feed statistics
   */
  getDataFeedStatistics(): any {
    if (!this.dataFeed) {
      return { dataFeedEnabled: false };
    }
    
    return {
      dataFeedEnabled: true,
      feedType: this.dataFeed.getFeedType(),
      feedId: this.dataFeed.getFeedId(),
      statistics: this.dataFeed.getStatistics(),
      currentPrices: Object.fromEntries(this.currentPrices)
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<MockExchangeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[MOCK_EXCHANGE] Configuration updated', this.config);
  }
} 