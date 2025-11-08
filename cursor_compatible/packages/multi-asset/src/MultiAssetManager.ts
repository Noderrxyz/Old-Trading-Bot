import { EventEmitter } from 'events';
import * as winston from 'winston';

export enum AssetClass {
  CRYPTO = 'CRYPTO',
  EQUITY = 'EQUITY',
  FOREX = 'FOREX',
  COMMODITY = 'COMMODITY',
  FIXED_INCOME = 'FIXED_INCOME',
  DERIVATIVE = 'DERIVATIVE'
}

export interface AssetDefinition {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  contractSize: number;
  tickSize: number;
  minOrderSize: number;
  maxOrderSize: number;
  marginRequirement: number;
  tradingHours: TradingHours;
  metadata: Record<string, any>;
}

export interface TradingHours {
  timezone: string;
  sessions: TradingSession[];
  holidays: string[]; // ISO date strings
}

export interface TradingSession {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  open: string; // HH:MM format
  close: string; // HH:MM format
  break?: {
    start: string;
    end: string;
  };
}

export interface MarketData {
  symbol: string;
  timestamp: Date;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  vwap?: number;
  metadata?: Record<string, any>;
}

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: OrderType;
  price?: number;
  stopPrice?: number;
  timeInForce: TimeInForce;
  metadata?: Record<string, any>;
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  TRAILING_STOP = 'TRAILING_STOP',
  ICEBERG = 'ICEBERG'
}

export enum TimeInForce {
  GTC = 'GTC', // Good Till Cancelled
  IOC = 'IOC', // Immediate or Cancel
  FOK = 'FOK', // Fill or Kill
  GTD = 'GTD', // Good Till Date
  DAY = 'DAY', // Day Order
  GTX = 'GTX'  // Good Till Extended
}

export interface AssetAdapter {
  assetClass: AssetClass;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  placeOrder(order: OrderRequest): Promise<string>;
  cancelOrder(orderId: string): Promise<void>;
  getOrderStatus(orderId: string): Promise<any>;
  getPositions(): Promise<Map<string, any>>;
  getBalance(): Promise<any>;
}

export class MultiAssetManager extends EventEmitter {
  private logger: winston.Logger;
  private assets: Map<string, AssetDefinition> = new Map();
  private adapters: Map<AssetClass, AssetAdapter> = new Map();
  private marketData: Map<string, MarketData> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // symbol -> subscribers
  private unifiedOrderBook: Map<string, OrderBook> = new Map();
  
  constructor(logger: winston.Logger) {
    super();
    this.logger = logger;
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing multi-asset manager');
    
    // Load asset definitions
    await this.loadAssetDefinitions();
    
    // Initialize adapters
    await this.initializeAdapters();
    
    this.logger.info('Multi-asset manager initialized', {
      assetCount: this.assets.size,
      adapters: Array.from(this.adapters.keys())
    });
  }
  
  async registerAsset(asset: AssetDefinition): Promise<void> {
    // Validate asset definition
    this.validateAssetDefinition(asset);
    
    // Check if adapter exists for asset class
    if (!this.adapters.has(asset.assetClass)) {
      throw new Error(`No adapter registered for asset class ${asset.assetClass}`);
    }
    
    // Store asset definition
    this.assets.set(asset.symbol, asset);
    
    this.logger.info('Asset registered', {
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      exchange: asset.exchange
    });
    
    this.emit('asset-registered', asset);
  }
  
  async registerAdapter(adapter: AssetAdapter): Promise<void> {
    const assetClass = adapter.assetClass;
    
    if (this.adapters.has(assetClass)) {
      throw new Error(`Adapter already registered for ${assetClass}`);
    }
    
    // Connect adapter
    await adapter.connect();
    
    // Store adapter
    this.adapters.set(assetClass, adapter);
    
    // Set up event handlers
    this.setupAdapterHandlers(adapter);
    
    this.logger.info('Adapter registered', { assetClass });
    this.emit('adapter-registered', { assetClass });
  }
  
  async subscribe(symbols: string[]): Promise<void> {
    // Group symbols by asset class
    const symbolsByClass = new Map<AssetClass, string[]>();
    
    for (const symbol of symbols) {
      const asset = this.assets.get(symbol);
      if (!asset) {
        this.logger.warn(`Unknown symbol: ${symbol}`);
        continue;
      }
      
      if (!symbolsByClass.has(asset.assetClass)) {
        symbolsByClass.set(asset.assetClass, []);
      }
      symbolsByClass.get(asset.assetClass)!.push(symbol);
      
      // Track subscription
      if (!this.subscriptions.has(symbol)) {
        this.subscriptions.set(symbol, new Set());
      }
      this.subscriptions.get(symbol)!.add('default');
    }
    
    // Subscribe through appropriate adapters
    for (const [assetClass, classSymbols] of symbolsByClass) {
      const adapter = this.adapters.get(assetClass);
      if (adapter) {
        await adapter.subscribe(classSymbols);
      }
    }
    
    this.logger.info('Subscribed to symbols', { count: symbols.length });
  }
  
  async unsubscribe(symbols: string[]): Promise<void> {
    // Group symbols by asset class
    const symbolsByClass = new Map<AssetClass, string[]>();
    
    for (const symbol of symbols) {
      const asset = this.assets.get(symbol);
      if (!asset) continue;
      
      if (!symbolsByClass.has(asset.assetClass)) {
        symbolsByClass.set(asset.assetClass, []);
      }
      symbolsByClass.get(asset.assetClass)!.push(symbol);
      
      // Remove subscription
      this.subscriptions.delete(symbol);
    }
    
    // Unsubscribe through appropriate adapters
    for (const [assetClass, classSymbols] of symbolsByClass) {
      const adapter = this.adapters.get(assetClass);
      if (adapter) {
        await adapter.unsubscribe(classSymbols);
      }
    }
  }
  
  async placeOrder(order: OrderRequest): Promise<string> {
    // Get asset definition
    const asset = this.assets.get(order.symbol);
    if (!asset) {
      throw new Error(`Unknown symbol: ${order.symbol}`);
    }
    
    // Validate order
    this.validateOrder(order, asset);
    
    // Normalize order for asset class
    const normalizedOrder = this.normalizeOrder(order, asset);
    
    // Get appropriate adapter
    const adapter = this.adapters.get(asset.assetClass);
    if (!adapter) {
      throw new Error(`No adapter for asset class ${asset.assetClass}`);
    }
    
    // Check trading hours
    if (!this.isMarketOpen(asset)) {
      throw new Error(`Market closed for ${order.symbol}`);
    }
    
    // Place order through adapter
    const orderId = await adapter.placeOrder(normalizedOrder);
    
    this.logger.info('Order placed', {
      orderId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      orderType: order.orderType
    });
    
    this.emit('order-placed', {
      orderId,
      order: normalizedOrder,
      asset
    });
    
    return orderId;
  }
  
  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }
    
    const adapter = this.adapters.get(asset.assetClass);
    if (!adapter) {
      throw new Error(`No adapter for asset class ${asset.assetClass}`);
    }
    
    await adapter.cancelOrder(orderId);
    
    this.logger.info('Order cancelled', { orderId, symbol });
    this.emit('order-cancelled', { orderId, symbol });
  }
  
  getMarketData(symbol: string): MarketData | undefined {
    return this.marketData.get(symbol);
  }
  
  getAssetDefinition(symbol: string): AssetDefinition | undefined {
    return this.assets.get(symbol);
  }
  
  isMarketOpen(asset: AssetDefinition): boolean {
    const now = new Date();
    const timezone = asset.tradingHours.timezone;
    
    // Convert to asset's timezone
    const localTime = this.convertToTimezone(now, timezone);
    const dayOfWeek = localTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() as TradingSession['day'];
    const currentTime = localTime.toTimeString().slice(0, 5); // HH:MM
    
    // Check if holiday
    const dateStr = localTime.toISOString().split('T')[0];
    if (asset.tradingHours.holidays.includes(dateStr)) {
      return false;
    }
    
    // Find today's session
    const session = asset.tradingHours.sessions.find(s => s.day === dayOfWeek);
    if (!session) {
      return false;
    }
    
    // Check if within trading hours
    if (currentTime >= session.open && currentTime <= session.close) {
      // Check if in break period
      if (session.break) {
        if (currentTime >= session.break.start && currentTime <= session.break.end) {
          return false;
        }
      }
      return true;
    }
    
    return false;
  }
  
  async getUnifiedPositions(): Promise<Map<string, UnifiedPosition>> {
    const unifiedPositions = new Map<string, UnifiedPosition>();
    
    // Collect positions from all adapters
    for (const [assetClass, adapter] of this.adapters) {
      try {
        const positions = await adapter.getPositions();
        
        for (const [symbol, position] of positions) {
          const asset = this.assets.get(symbol);
          if (!asset) continue;
          
          const unifiedPos: UnifiedPosition = {
            symbol,
            assetClass,
            quantity: position.quantity || 0,
            averagePrice: position.avgPrice || 0,
            currentPrice: this.marketData.get(symbol)?.last || 0,
            unrealizedPnl: 0,
            realizedPnl: position.realizedPnl || 0,
            value: 0,
            marginUsed: 0
          };
          
          // Calculate unrealized PnL and value
          if (unifiedPos.currentPrice > 0) {
            unifiedPos.unrealizedPnl = (unifiedPos.currentPrice - unifiedPos.averagePrice) * 
                                       unifiedPos.quantity * asset.contractSize;
            unifiedPos.value = unifiedPos.currentPrice * unifiedPos.quantity * asset.contractSize;
          }
          
          // Calculate margin used
          unifiedPos.marginUsed = unifiedPos.value * asset.marginRequirement;
          
          unifiedPositions.set(symbol, unifiedPos);
        }
      } catch (error) {
        this.logger.error(`Failed to get positions for ${assetClass}`, error);
      }
    }
    
    return unifiedPositions;
  }
  
  async getUnifiedBalance(): Promise<UnifiedBalance> {
    const balance: UnifiedBalance = {
      totalEquity: 0,
      totalCash: 0,
      totalMarginUsed: 0,
      totalUnrealizedPnl: 0,
      byAssetClass: new Map(),
      byCurrency: new Map()
    };
    
    // Collect balances from all adapters
    for (const [assetClass, adapter] of this.adapters) {
      try {
        const adapterBalance = await adapter.getBalance();
        
        // Aggregate by asset class
        balance.byAssetClass.set(assetClass, {
          equity: adapterBalance.equity || 0,
          cash: adapterBalance.cash || 0,
          marginUsed: adapterBalance.marginUsed || 0,
          unrealizedPnl: adapterBalance.unrealizedPnl || 0
        });
        
        // Aggregate totals
        balance.totalEquity += adapterBalance.equity || 0;
        balance.totalCash += adapterBalance.cash || 0;
        balance.totalMarginUsed += adapterBalance.marginUsed || 0;
        balance.totalUnrealizedPnl += adapterBalance.unrealizedPnl || 0;
        
        // Aggregate by currency
        if (adapterBalance.currencies) {
          for (const [currency, amount] of Object.entries(adapterBalance.currencies)) {
            const current = balance.byCurrency.get(currency) || 0;
            balance.byCurrency.set(currency, current + (amount as number));
          }
        }
      } catch (error) {
        this.logger.error(`Failed to get balance for ${assetClass}`, error);
      }
    }
    
    return balance;
  }
  
  private validateAssetDefinition(asset: AssetDefinition): void {
    if (!asset.symbol || !asset.name || !asset.assetClass || !asset.exchange) {
      throw new Error('Invalid asset definition: missing required fields');
    }
    
    if (asset.tickSize <= 0 || asset.minOrderSize <= 0) {
      throw new Error('Invalid asset definition: tick size and min order size must be positive');
    }
    
    if (asset.marginRequirement < 0 || asset.marginRequirement > 1) {
      throw new Error('Invalid asset definition: margin requirement must be between 0 and 1');
    }
  }
  
  private validateOrder(order: OrderRequest, asset: AssetDefinition): void {
    // Check quantity
    if (order.quantity < asset.minOrderSize) {
      throw new Error(`Order quantity below minimum: ${asset.minOrderSize}`);
    }
    
    if (order.quantity > asset.maxOrderSize) {
      throw new Error(`Order quantity above maximum: ${asset.maxOrderSize}`);
    }
    
    // Check price tick size for limit orders
    if (order.orderType === OrderType.LIMIT && order.price) {
      const priceTicks = order.price / asset.tickSize;
      if (Math.abs(priceTicks - Math.round(priceTicks)) > 0.0001) {
        throw new Error(`Price must be multiple of tick size: ${asset.tickSize}`);
      }
    }
  }
  
  private normalizeOrder(order: OrderRequest, asset: AssetDefinition): OrderRequest {
    const normalized = { ...order };
    
    // Round quantity to contract size
    if (asset.contractSize !== 1) {
      normalized.quantity = Math.round(order.quantity / asset.contractSize) * asset.contractSize;
    }
    
    // Round price to tick size
    if (normalized.price) {
      normalized.price = Math.round(normalized.price / asset.tickSize) * asset.tickSize;
    }
    
    // Add asset-specific metadata
    normalized.metadata = {
      ...normalized.metadata,
      assetClass: asset.assetClass,
      exchange: asset.exchange,
      contractSize: asset.contractSize
    };
    
    return normalized;
  }
  
  private setupAdapterHandlers(adapter: AssetAdapter): void {
    // In production, adapters would emit events that we handle here
    // For now, simulate market data updates
    setInterval(() => {
      this.simulateMarketData(adapter.assetClass);
    }, 1000);
  }
  
  private simulateMarketData(assetClass: AssetClass): void {
    // Get all assets for this class
    const assets = Array.from(this.assets.values())
      .filter(a => a.assetClass === assetClass);
    
    for (const asset of assets) {
      // Check if subscribed
      if (!this.subscriptions.has(asset.symbol)) continue;
      
      // Generate random market data
      const lastPrice = this.marketData.get(asset.symbol)?.last || 100;
      const change = (Math.random() - 0.5) * 0.002; // ±0.1% change
      
      const marketData: MarketData = {
        symbol: asset.symbol,
        timestamp: new Date(),
        bid: lastPrice * (1 + change - 0.0001),
        ask: lastPrice * (1 + change + 0.0001),
        last: lastPrice * (1 + change),
        volume: Math.random() * 10000,
        metadata: {
          assetClass
        }
      };
      
      this.marketData.set(asset.symbol, marketData);
      this.emit('market-data', marketData);
    }
  }
  
  private async loadAssetDefinitions(): Promise<void> {
    // In production, load from database or configuration
    // For demo, create sample assets
    
    const sampleAssets: AssetDefinition[] = [
      {
        symbol: 'BTCUSD',
        name: 'Bitcoin/USD',
        assetClass: AssetClass.CRYPTO,
        exchange: 'BINANCE',
        baseCurrency: 'BTC',
        quoteCurrency: 'USD',
        contractSize: 1,
        tickSize: 0.01,
        minOrderSize: 0.001,
        maxOrderSize: 1000,
        marginRequirement: 0.2,
        tradingHours: {
          timezone: 'UTC',
          sessions: this.get247Sessions(),
          holidays: []
        },
        metadata: {}
      },
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: AssetClass.EQUITY,
        exchange: 'NASDAQ',
        quoteCurrency: 'USD',
        contractSize: 1,
        tickSize: 0.01,
        minOrderSize: 1,
        maxOrderSize: 10000,
        marginRequirement: 0.25,
        tradingHours: {
          timezone: 'America/New_York',
          sessions: this.getUSEquitySession(),
          holidays: this.getUSHolidays()
        },
        metadata: {}
      },
      {
        symbol: 'EURUSD',
        name: 'Euro/US Dollar',
        assetClass: AssetClass.FOREX,
        exchange: 'INTERBANK',
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        contractSize: 100000,
        tickSize: 0.00001,
        minOrderSize: 0.01,
        maxOrderSize: 100,
        marginRequirement: 0.02,
        tradingHours: {
          timezone: 'UTC',
          sessions: this.getForexSessions(),
          holidays: []
        },
        metadata: {}
      }
    ];
    
    for (const asset of sampleAssets) {
      this.assets.set(asset.symbol, asset);
    }
  }
  
  private async initializeAdapters(): Promise<void> {
    // In production, initialize real adapters
    // For demo, create mock adapters
    
    const cryptoAdapter = new MockAssetAdapter(AssetClass.CRYPTO);
    const equityAdapter = new MockAssetAdapter(AssetClass.EQUITY);
    const forexAdapter = new MockAssetAdapter(AssetClass.FOREX);
    
    await this.registerAdapter(cryptoAdapter);
    await this.registerAdapter(equityAdapter);
    await this.registerAdapter(forexAdapter);
  }
  
  private convertToTimezone(date: Date, timezone: string): Date {
    // Simplified timezone conversion
    // In production, use proper timezone library
    return date;
  }
  
  private get247Sessions(): TradingSession[] {
    const days: TradingSession['day'][] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    return days.map(day => ({
      day,
      open: '00:00',
      close: '23:59'
    }));
  }
  
  private getUSEquitySession(): TradingSession[] {
    return [
      { day: 'monday', open: '09:30', close: '16:00' },
      { day: 'tuesday', open: '09:30', close: '16:00' },
      { day: 'wednesday', open: '09:30', close: '16:00' },
      { day: 'thursday', open: '09:30', close: '16:00' },
      { day: 'friday', open: '09:30', close: '16:00' }
    ];
  }
  
  private getForexSessions(): TradingSession[] {
    // Forex trades Sunday evening to Friday evening
    return [
      { day: 'sunday', open: '17:00', close: '23:59' },
      { day: 'monday', open: '00:00', close: '23:59' },
      { day: 'tuesday', open: '00:00', close: '23:59' },
      { day: 'wednesday', open: '00:00', close: '23:59' },
      { day: 'thursday', open: '00:00', close: '23:59' },
      { day: 'friday', open: '00:00', close: '17:00' }
    ];
  }
  
  private getUSHolidays(): string[] {
    // Sample US market holidays
    return [
      '2024-01-01', // New Year's Day
      '2024-01-15', // MLK Day
      '2024-02-19', // Presidents Day
      '2024-03-29', // Good Friday
      '2024-05-27', // Memorial Day
      '2024-07-04', // Independence Day
      '2024-09-02', // Labor Day
      '2024-11-28', // Thanksgiving
      '2024-12-25'  // Christmas
    ];
  }
}

// Mock adapter for demo
class MockAssetAdapter implements AssetAdapter {
  assetClass: AssetClass;
  private connected: boolean = false;
  
  constructor(assetClass: AssetClass) {
    this.assetClass = assetClass;
  }
  
  async connect(): Promise<void> {
    this.connected = true;
  }
  
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  
  async subscribe(symbols: string[]): Promise<void> {
    // Mock subscription
  }
  
  async unsubscribe(symbols: string[]): Promise<void> {
    // Mock unsubscription
  }
  
  async placeOrder(order: OrderRequest): Promise<string> {
    return `${this.assetClass}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  async cancelOrder(orderId: string): Promise<void> {
    // Mock cancellation
  }
  
  async getOrderStatus(orderId: string): Promise<any> {
    return { status: 'FILLED' };
  }
  
  async getPositions(): Promise<Map<string, any>> {
    return new Map();
  }
  
  async getBalance(): Promise<any> {
    return {
      equity: 100000,
      cash: 50000,
      marginUsed: 20000,
      unrealizedPnl: 5000
    };
  }
}

// Additional interfaces
interface OrderBook {
  symbol: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  lastUpdate: Date;
}

interface PriceLevel {
  price: number;
  quantity: number;
  orders: number;
}

interface UnifiedPosition {
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  value: number;
  marginUsed: number;
}

interface UnifiedBalance {
  totalEquity: number;
  totalCash: number;
  totalMarginUsed: number;
  totalUnrealizedPnl: number;
  byAssetClass: Map<AssetClass, AssetClassBalance>;
  byCurrency: Map<string, number>;
}

interface AssetClassBalance {
  equity: number;
  cash: number;
  marginUsed: number;
  unrealizedPnl: number;
} 