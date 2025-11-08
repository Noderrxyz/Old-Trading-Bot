/**
 * CryptoHistoricalDataSource for fetching and caching historical market data
 * from cryptocurrency exchanges using the ccxt library
 */
import { DataSource } from './dataManager';
import { Bar, OrderBook, Tick, Timeframe } from '../models/types';
import * as ccxt from 'ccxt'; // Import as namespace instead of default import
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

interface CryptoHistoricalDataSourceConfig {
  // Base directory for storing cached data
  cacheDir: string;
  
  // Exchange to use (default: binance)
  exchange?: string;
  
  // API key for exchange (optional)
  apiKey?: string;
  
  // API secret for exchange (optional)
  apiSecret?: string;
  
  // Whether to use cache (default: true)
  useCache?: boolean;
  
  // Time to live for cached data in milliseconds (default: 7 days)
  cacheTTL?: number;
  
  // Fetch size for OHLCV data (default: 1000)
  fetchSize?: number;
  
  // Rate limit in ms between API calls (default: 1000ms)
  rateLimit?: number;
}

/**
 * Data source for fetching historical market data from cryptocurrency exchanges
 */
export class CryptoHistoricalDataSource implements DataSource {
  private config: Required<CryptoHistoricalDataSourceConfig>;
  private exchange!: ccxt.Exchange; // Add definite assignment assertion
  private lastApiCallTime: number = 0;
  
  /**
   * Map of timeframe to milliseconds
   */
  private static TIMEFRAME_MS: { [key in Timeframe]?: number } = {
    [Timeframe.ONE_MINUTE]: 60 * 1000,
    [Timeframe.FIVE_MINUTES]: 5 * 60 * 1000,
    [Timeframe.FIFTEEN_MINUTES]: 15 * 60 * 1000,
    [Timeframe.THIRTY_MINUTES]: 30 * 60 * 1000,
    [Timeframe.ONE_HOUR]: 60 * 60 * 1000,
    [Timeframe.FOUR_HOURS]: 4 * 60 * 60 * 1000,
    [Timeframe.ONE_DAY]: 24 * 60 * 60 * 1000,
    [Timeframe.ONE_WEEK]: 7 * 24 * 60 * 60 * 1000,
    [Timeframe.ONE_MONTH]: 30 * 24 * 60 * 60 * 1000
  };
  
  /**
   * Map of timeframe to ccxt timeframe string
   */
  private static TIMEFRAME_CCXT: { [key in Timeframe]?: string } = {
    [Timeframe.ONE_MINUTE]: '1m',
    [Timeframe.FIVE_MINUTES]: '5m',
    [Timeframe.FIFTEEN_MINUTES]: '15m',
    [Timeframe.THIRTY_MINUTES]: '30m',
    [Timeframe.ONE_HOUR]: '1h',
    [Timeframe.FOUR_HOURS]: '4h',
    [Timeframe.ONE_DAY]: '1d',
    [Timeframe.ONE_WEEK]: '1w',
    [Timeframe.ONE_MONTH]: '1M'
  };
  
  constructor(config: CryptoHistoricalDataSourceConfig) {
    // Set default configuration
    this.config = {
      cacheDir: config.cacheDir,
      exchange: config.exchange ?? 'binance',
      apiKey: config.apiKey ?? '',
      apiSecret: config.apiSecret ?? '',
      useCache: config.useCache ?? true,
      cacheTTL: config.cacheTTL ?? 7 * 24 * 60 * 60 * 1000, // 7 days
      fetchSize: config.fetchSize ?? 1000,
      rateLimit: config.rateLimit ?? 1000
    };
    
    // Create cache directory if it doesn't exist
    if (this.config.useCache) {
      this.ensureCacheDir();
    }
    
    // Initialize exchange
    this.initializeExchange();
  }
  
  /**
   * Get the data source ID
   */
  getId(): string {
    return `crypto_${this.config.exchange}`;
  }
  
  /**
   * Get the data source description
   */
  getDescription(): string {
    return `Cryptocurrency Historical Data Source (${this.config.exchange})`;
  }
  
  /**
   * Check if the data source supports bars
   */
  supportsBars(): boolean {
    return true;
  }
  
  /**
   * Check if the data source supports ticks
   */
  supportsTicks(): boolean {
    return false; // Most exchanges don't provide historical tick data
  }
  
  /**
   * Check if the data source supports order book
   */
  supportsOrderBook(): boolean {
    return true;
  }
  
  /**
   * Get historical bars for a symbol and timeframe
   */
  async getBars(
    symbol: string, 
    timeframe: Timeframe, 
    start: Date, 
    end: Date
  ): Promise<Bar[]> {
    // Convert symbol to exchange format
    const exchangeSymbol = this.formatSymbol(symbol);
    
    // Convert timeframe to ccxt format
    const ccxtTimeframe = CryptoHistoricalDataSource.TIMEFRAME_CCXT[timeframe];
    if (!ccxtTimeframe) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }
    
    // Check if data is in cache
    if (this.config.useCache) {
      const cachedData = this.getFromCache('bars', symbol, timeframe, start, end);
      if (cachedData) {
        return cachedData;
      }
    }
    
    // Fetch from exchange
    const bars: Bar[] = [];
    let currentStart = start.getTime();
    const endTime = end.getTime();
    
    while (currentStart < endTime) {
      // Respect rate limits
      await this.respectRateLimit();
      
      try {
        // Fetch OHLCV data
        const ohlcvData = await this.exchange.fetchOHLCV(
          exchangeSymbol,
          ccxtTimeframe,
          currentStart,
          this.config.fetchSize
        );
        
        if (ohlcvData.length === 0) {
          break;
        }
        
        // Convert to Bar objects
        for (const [timestamp, open, high, low, close, volume] of ohlcvData) {
          if (timestamp >= endTime) {
            break;
          }
          
          bars.push({
            symbol,
            timestamp: new Date(timestamp),
            open: open as number,
            high: high as number,
            low: low as number,
            close: close as number,
            volume: volume as number
          });
        }
        
        // Update start time for next batch
        if (ohlcvData.length > 0) {
          currentStart = ohlcvData[ohlcvData.length - 1][0] as number + 1;
        } else {
          break;
        }
        
        // If we got less than the fetch size, we've reached the end
        if (ohlcvData.length < this.config.fetchSize) {
          break;
        }
      } catch (error) {
        console.error(`Error fetching OHLCV data for ${symbol} (${timeframe}):`, error);
        throw error;
      }
    }
    
    // Cache the data
    if (this.config.useCache) {
      this.saveToCache('bars', symbol, timeframe, start, end, bars);
    }
    
    return bars;
  }
  
  /**
   * Get historical ticks (not supported by most exchanges)
   */
  async getTicks(
    symbol: string, 
    start: Date, 
    end: Date
  ): Promise<Tick[]> {
    throw new Error('Historical tick data not supported by most exchanges');
  }
  
  /**
   * Get historical order books
   */
  async getOrderBooks(
    symbol: string, 
    start: Date, 
    end: Date
  ): Promise<OrderBook[]> {
    // Check if data is in cache
    if (this.config.useCache) {
      const cachedData = this.getFromCache('orderbooks', symbol, null, start, end);
      if (cachedData) {
        return cachedData;
      }
    }
    
    // Unfortunately, most exchanges don't provide historical order book data
    // For backtesting, we'll return a limited set of snapshots based on bar data
    
    // Get daily bars to use as snapshots
    const bars = await this.getBars(symbol, Timeframe.ONE_DAY, start, end);
    
    // Create order book snapshots at daily intervals
    const orderBooks: OrderBook[] = [];
    
    for (const bar of bars) {
      // Respect rate limits
      await this.respectRateLimit();
      
      try {
        // Get current order book (only works for recent dates, not historical)
        // For historical backtesting, this is a limitation
        if (this.isRecentDate(bar.timestamp)) {
          const exchangeSymbol = this.formatSymbol(symbol);
          const orderBookData = await this.exchange.fetchOrderBook(exchangeSymbol);
          
          // Convert to OrderBook object
          orderBooks.push({
            symbol,
            timestamp: bar.timestamp,
            bids: orderBookData.bids.map(([price, volume]: [number, number]) => ({ price, volume })),
            asks: orderBookData.asks.map(([price, volume]: [number, number]) => ({ price, volume }))
          });
        } else {
          // For historical dates, create a synthetic order book based on the bar
          const spread = bar.high - bar.low;
          const spreadPercentage = spread / bar.close;
          const syntheticSpread = bar.close * Math.min(spreadPercentage, 0.002); // Cap at 0.2%
          
          orderBooks.push({
            symbol,
            timestamp: bar.timestamp,
            bids: [
              { price: bar.close * 0.999, volume: bar.volume * 0.5 },
              { price: bar.close * 0.998, volume: bar.volume * 0.8 },
              { price: bar.close * 0.997, volume: bar.volume * 1.0 }
            ],
            asks: [
              { price: bar.close * 1.001, volume: bar.volume * 0.5 },
              { price: bar.close * 1.002, volume: bar.volume * 0.8 },
              { price: bar.close * 1.003, volume: bar.volume * 1.0 }
            ]
          });
        }
      } catch (error) {
        console.warn(`Error fetching order book for ${symbol}:`, error);
        // Continue with synthetic data
        const syntheticSpread = bar.close * 0.002; // 0.2%
        
        orderBooks.push({
          symbol,
          timestamp: bar.timestamp,
          bids: [
            { price: bar.close * 0.999, volume: bar.volume * 0.5 },
            { price: bar.close * 0.998, volume: bar.volume * 0.8 },
            { price: bar.close * 0.997, volume: bar.volume * 1.0 }
          ],
          asks: [
            { price: bar.close * 1.001, volume: bar.volume * 0.5 },
            { price: bar.close * 1.002, volume: bar.volume * 0.8 },
            { price: bar.close * 1.003, volume: bar.volume * 1.0 }
          ]
        });
      }
    }
    
    // Cache the data
    if (this.config.useCache) {
      this.saveToCache('orderbooks', symbol, null, start, end, orderBooks);
    }
    
    return orderBooks;
  }
  
  /**
   * Get available symbols from the exchange
   */
  async getAvailableSymbols(): Promise<string[]> {
    await this.respectRateLimit();
    
    try {
      const markets = await this.exchange.fetchMarkets();
      return markets.map((market: ccxt.Market) => this.normalizeSymbol(market.symbol));
    } catch (error) {
      console.error('Error fetching available symbols:', error);
      throw error;
    }
  }
  
  /**
   * Get the time range for available data
   */
  async getTimeRange(symbol: string): Promise<{ start: Date; end: Date }> {
    // Most exchanges limit historical data, so we'll return a conservative range
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 2); // Most exchanges have ~2 years of data
    
    return { start, end };
  }
  
  /**
   * Initialize the exchange connection
   */
  private initializeExchange(): void {
    // Get the exchange class
    const exchangeId = this.config.exchange;
    
    // Check if exchange is supported by ccxt
    if (!(exchangeId in ccxt)) {
      throw new Error(`Unsupported exchange: ${exchangeId}`);
    }
    
    try {
      // Create exchange instance dynamically
      const exchangeClass = ccxt[exchangeId as keyof typeof ccxt];
      
      // Ensure exchangeClass is a constructor
      if (typeof exchangeClass === 'function') {
        this.exchange = new (exchangeClass as any)({
          apiKey: this.config.apiKey,
          secret: this.config.apiSecret,
          enableRateLimit: true
        });
      } else {
        throw new Error(`Exchange ${exchangeId} is not a valid constructor`);
      }
    } catch (error) {
      console.error(`Failed to initialize exchange ${exchangeId}:`, error);
      throw new Error(`Could not initialize exchange ${exchangeId}: ${error}`);
    }
  }
  
  /**
   * Format symbol from 'BTC/USD' to exchange format (e.g., 'BTCUSD')
   */
  private formatSymbol(symbol: string): string {
    // Different exchanges use different formats
    if (this.config.exchange === 'binance') {
      // Binance uses BTCUSDT not BTCUSD
      return symbol.replace('/', '') + (symbol.endsWith('/USD') ? 'T' : '');
    }
    return symbol;
  }
  
  /**
   * Normalize exchange symbol to our format ('BTCUSD' to 'BTC/USD')
   */
  private normalizeSymbol(symbol: string): string {
    // Most ccxt symbols are already in 'BTC/USD' format
    // If dealing with Binance format, convert back
    if (this.config.exchange === 'binance' && symbol.endsWith('USDT')) {
      return symbol.replace('USDT', '/USD');
    }
    return symbol;
  }
  
  /**
   * Check if a date is recent (within the last 7 days)
   */
  private isRecentDate(date: Date): boolean {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date >= sevenDaysAgo;
  }
  
  /**
   * Ensure the cache directory exists
   */
  private ensureCacheDir(): void {
    const dirs = [
      this.config.cacheDir,
      path.join(this.config.cacheDir, 'bars'),
      path.join(this.config.cacheDir, 'ticks'),
      path.join(this.config.cacheDir, 'orderbooks')
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * Get data from cache
   */
  private getFromCache(
    type: 'bars' | 'ticks' | 'orderbooks',
    symbol: string,
    timeframe: Timeframe | null,
    start: Date,
    end: Date
  ): any[] | null {
    const cacheKey = this.getCacheKey(type, symbol, timeframe, start, end);
    const cacheFile = path.join(this.config.cacheDir, type, `${cacheKey}.json`);
    
    if (fs.existsSync(cacheFile)) {
      // Check if cache is expired
      const stats = fs.statSync(cacheFile);
      const cacheAge = Date.now() - stats.mtimeMs;
      
      if (cacheAge < this.config.cacheTTL) {
        try {
          const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          
          // Convert string timestamps back to Date objects
          if (type === 'bars') {
            return cachedData.map((bar: any) => ({
              ...bar,
              timestamp: new Date(bar.timestamp)
            }));
          } else if (type === 'ticks') {
            return cachedData.map((tick: any) => ({
              ...tick,
              timestamp: new Date(tick.timestamp)
            }));
          } else if (type === 'orderbooks') {
            return cachedData.map((ob: any) => ({
              ...ob,
              timestamp: new Date(ob.timestamp)
            }));
          }
          
          return cachedData;
        } catch (error) {
          console.warn(`Error reading cache file ${cacheFile}:`, error);
          return null;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Save data to cache
   */
  private saveToCache(
    type: 'bars' | 'ticks' | 'orderbooks',
    symbol: string,
    timeframe: Timeframe | null,
    start: Date,
    end: Date,
    data: any[]
  ): void {
    const cacheKey = this.getCacheKey(type, symbol, timeframe, start, end);
    const cacheFile = path.join(this.config.cacheDir, type, `${cacheKey}.json`);
    
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
    } catch (error) {
      console.warn(`Error writing cache file ${cacheFile}:`, error);
    }
  }
  
  /**
   * Generate a cache key for the given parameters
   */
  private getCacheKey(
    type: string,
    symbol: string,
    timeframe: Timeframe | null,
    start: Date,
    end: Date
  ): string {
    const params = [
      this.config.exchange,
      symbol.replace('/', '_'),
      timeframe,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10)
    ].filter(Boolean).join('_');
    
    return createHash('md5').update(params).digest('hex');
  }
  
  /**
   * Respect rate limits
   */
  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastApiCallTime;
    
    if (elapsed < this.config.rateLimit) {
      await new Promise(resolve => setTimeout(resolve, this.config.rateLimit - elapsed));
    }
    
    this.lastApiCallTime = Date.now();
  }
} 