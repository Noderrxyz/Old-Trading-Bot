import { Bar, OrderBook, Tick, Timeframe } from '../models/types';

/**
 * Interface for data sources that can provide historical market data
 */
export interface DataSource {
  // Identification
  getId(): string;
  getDescription(): string;
  
  // Capability checks
  supportsBars(): boolean;
  supportsTicks(): boolean;
  supportsOrderBook(): boolean;
  
  // Data retrieval methods
  getBars(symbol: string, timeframe: Timeframe, start: Date, end: Date): Promise<Bar[]>;
  getTicks(symbol: string, start: Date, end: Date): Promise<Tick[]>;
  getOrderBooks(symbol: string, start: Date, end: Date): Promise<OrderBook[]>;
  
  // Metadata
  getAvailableSymbols(): Promise<string[]>;
  getTimeRange(symbol: string): Promise<{ start: Date; end: Date }>;
}

/**
 * Options for the DataManager
 */
export interface DataManagerOptions {
  cacheEnabled?: boolean;
  cacheSize?: number; // Number of data points to cache per symbol/timeframe
  normalizeData?: boolean; // Standardize data formats from different sources
  autoConnect?: boolean; // Connect to data sources on initialization
}

/**
 * Manages loading, preprocessing, and streaming historical market data
 */
export class DataManager {
  private dataSources: Map<string, DataSource> = new Map();
  private options: DataManagerOptions;
  private barCache: Map<string, Bar[]> = new Map(); // Key: "symbol:timeframe"
  private tickCache: Map<string, Tick[]> = new Map(); // Key: "symbol"
  private orderBookCache: Map<string, OrderBook[]> = new Map(); // Key: "symbol"

  constructor(options: DataManagerOptions = {}) {
    this.options = {
      cacheEnabled: true,
      cacheSize: 10000,
      normalizeData: true,
      autoConnect: true,
      ...options
    };
  }

  /**
   * Register a data source with the manager
   */
  registerDataSource(dataSource: DataSource): void {
    this.dataSources.set(dataSource.getId(), dataSource);
  }

  /**
   * Remove a data source from the manager
   */
  removeDataSource(sourceId: string): boolean {
    return this.dataSources.delete(sourceId);
  }

  /**
   * Get a registered data source by ID
   */
  getDataSource(sourceId: string): DataSource | undefined {
    return this.dataSources.get(sourceId);
  }

  /**
   * Get all registered data sources
   */
  getAllDataSources(): DataSource[] {
    return Array.from(this.dataSources.values());
  }

  /**
   * Get bar data for a specific symbol and timeframe
   */
  async getBars(
    symbol: string,
    timeframe: Timeframe,
    start: Date,
    end: Date,
    sourceId?: string
  ): Promise<Bar[]> {
    // Check cache first if enabled
    const cacheKey = `${symbol}:${timeframe}`;
    if (this.options.cacheEnabled && this.barCache.has(cacheKey)) {
      const cachedBars = this.barCache.get(cacheKey)!;
      const filteredBars = cachedBars.filter(
        bar => bar.timestamp >= start && bar.timestamp <= end
      );
      
      // If we have all the data in cache, return it
      if (filteredBars.length > 0 && 
          filteredBars[0].timestamp <= start && 
          filteredBars[filteredBars.length - 1].timestamp >= end) {
        return filteredBars;
      }
    }

    // If specific source requested, use only that source
    if (sourceId && this.dataSources.has(sourceId)) {
      const source = this.dataSources.get(sourceId)!;
      if (!source.supportsBars()) {
        throw new Error(`Data source ${sourceId} does not support bar data`);
      }
      
      const bars = await source.getBars(symbol, timeframe, start, end);
      
      // Cache the result if enabled
      if (this.options.cacheEnabled) {
        this.barCache.set(cacheKey, this.limitCacheSize([...bars]));
      }
      
      return bars;
    }

    // Otherwise try all sources that support bars
    const sources = Array.from(this.dataSources.values());
    for (const source of sources) {
      if (source.supportsBars()) {
        try {
          const bars = await source.getBars(symbol, timeframe, start, end);
          
          // Cache the result if enabled
          if (this.options.cacheEnabled) {
            this.barCache.set(cacheKey, this.limitCacheSize([...bars]));
          }
          
          return bars;
        } catch (error) {
          console.warn(`Failed to get bars from source ${source.getId()}: ${error}`);
          // Continue to next source
        }
      }
    }

    throw new Error(`No data source could provide bars for ${symbol} at ${timeframe}`);
  }

  /**
   * Get tick data for a specific symbol
   */
  async getTicks(
    symbol: string,
    start: Date,
    end: Date,
    sourceId?: string
  ): Promise<Tick[]> {
    // Check cache first if enabled
    if (this.options.cacheEnabled && this.tickCache.has(symbol)) {
      const cachedTicks = this.tickCache.get(symbol)!;
      const filteredTicks = cachedTicks.filter(
        tick => tick.timestamp >= start && tick.timestamp <= end
      );
      
      // If we have all the data in cache, return it
      if (filteredTicks.length > 0 && 
          filteredTicks[0].timestamp <= start && 
          filteredTicks[filteredTicks.length - 1].timestamp >= end) {
        return filteredTicks;
      }
    }

    // If specific source requested, use only that source
    if (sourceId && this.dataSources.has(sourceId)) {
      const source = this.dataSources.get(sourceId)!;
      if (!source.supportsTicks()) {
        throw new Error(`Data source ${sourceId} does not support tick data`);
      }
      
      const ticks = await source.getTicks(symbol, start, end);
      
      // Cache the result if enabled
      if (this.options.cacheEnabled) {
        this.tickCache.set(symbol, this.limitCacheSize([...ticks]));
      }
      
      return ticks;
    }

    // Otherwise try all sources that support ticks
    const sources = Array.from(this.dataSources.values());
    for (const source of sources) {
      if (source.supportsTicks()) {
        try {
          const ticks = await source.getTicks(symbol, start, end);
          
          // Cache the result if enabled
          if (this.options.cacheEnabled) {
            this.tickCache.set(symbol, this.limitCacheSize([...ticks]));
          }
          
          return ticks;
        } catch (error) {
          console.warn(`Failed to get ticks from source ${source.getId()}: ${error}`);
          // Continue to next source
        }
      }
    }

    throw new Error(`No data source could provide ticks for ${symbol}`);
  }

  /**
   * Get order book data for a specific symbol
   */
  async getOrderBooks(
    symbol: string,
    start: Date,
    end: Date,
    sourceId?: string
  ): Promise<OrderBook[]> {
    // Check cache first if enabled
    if (this.options.cacheEnabled && this.orderBookCache.has(symbol)) {
      const cachedBooks = this.orderBookCache.get(symbol)!;
      const filteredBooks = cachedBooks.filter(
        book => book.timestamp >= start && book.timestamp <= end
      );
      
      // If we have all the data in cache, return it
      if (filteredBooks.length > 0 && 
          filteredBooks[0].timestamp <= start && 
          filteredBooks[filteredBooks.length - 1].timestamp >= end) {
        return filteredBooks;
      }
    }

    // If specific source requested, use only that source
    if (sourceId && this.dataSources.has(sourceId)) {
      const source = this.dataSources.get(sourceId)!;
      if (!source.supportsOrderBook()) {
        throw new Error(`Data source ${sourceId} does not support order book data`);
      }
      
      const books = await source.getOrderBooks(symbol, start, end);
      
      // Cache the result if enabled
      if (this.options.cacheEnabled) {
        this.orderBookCache.set(symbol, this.limitCacheSize([...books]));
      }
      
      return books;
    }

    // Otherwise try all sources that support order books
    const sources = Array.from(this.dataSources.values());
    for (const source of sources) {
      if (source.supportsOrderBook()) {
        try {
          const books = await source.getOrderBooks(symbol, start, end);
          
          // Cache the result if enabled
          if (this.options.cacheEnabled) {
            this.orderBookCache.set(symbol, this.limitCacheSize([...books]));
          }
          
          return books;
        } catch (error) {
          console.warn(`Failed to get order books from source ${source.getId()}: ${error}`);
          // Continue to next source
        }
      }
    }

    throw new Error(`No data source could provide order books for ${symbol}`);
  }

  /**
   * Get available symbols across all data sources
   */
  async getAvailableSymbols(): Promise<string[]> {
    const symbolsSet = new Set<string>();
    
    const sources = Array.from(this.dataSources.values());
    for (const source of sources) {
      try {
        const symbols = await source.getAvailableSymbols();
        symbols.forEach(symbol => symbolsSet.add(symbol));
      } catch (error) {
        console.warn(`Failed to get symbols from source ${source.getId()}: ${error}`);
      }
    }
    
    return Array.from(symbolsSet);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.barCache.clear();
    this.tickCache.clear();
    this.orderBookCache.clear();
  }

  /**
   * Limit the cache size to the configured maximum
   */
  private limitCacheSize<T>(data: T[]): T[] {
    if (data.length <= this.options.cacheSize!) {
      return data;
    }
    
    // Keep the most recent data points
    return data.slice(data.length - this.options.cacheSize!);
  }
} 