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
  // To be expanded as needed
  cacheEnabled?: boolean;
  cacheSizeLimit?: number;
}

/**
 * Manages all data access for the backtesting engine
 * Provides a unified interface to multiple data sources
 */
export class DataManager {
  private dataSources: Map<string, DataSource> = new Map();
  private cache: Map<string, any> = new Map();
  private options: DataManagerOptions;
  
  constructor(options: DataManagerOptions = {}) {
    this.options = {
      cacheEnabled: true,
      cacheSizeLimit: 100000, // Default cache size limit
      ...options
    };
  }
  
  /**
   * Register a data source with the data manager
   */
  registerDataSource(dataSource: DataSource): void {
    const id = dataSource.getId();
    
    if (this.dataSources.has(id)) {
      throw new Error(`Data source with ID ${id} is already registered`);
    }
    
    this.dataSources.set(id, dataSource);
  }
  
  /**
   * Remove a data source from the data manager
   */
  removeDataSource(id: string): boolean {
    return this.dataSources.delete(id);
  }
  
  /**
   * Get a registered data source by ID
   */
  getDataSource(id: string): DataSource | undefined {
    return this.dataSources.get(id);
  }
  
  /**
   * Get all registered data sources
   */
  getAllDataSources(): DataSource[] {
    return Array.from(this.dataSources.values());
  }
  
  /**
   * Find a data source that supports the given symbol and data type
   */
  private findDataSourceForSymbol(
    symbol: string,
    dataType: 'bars' | 'ticks' | 'orderbooks'
  ): DataSource | null {
    for (const dataSource of this.dataSources.values()) {
      // Check if the data source supports the data type
      if (
        (dataType === 'bars' && dataSource.supportsBars()) ||
        (dataType === 'ticks' && dataSource.supportsTicks()) ||
        (dataType === 'orderbooks' && dataSource.supportsOrderBook())
      ) {
        // Check if it supports the symbol (async operation, but we're doing it synchronously for now)
        try {
          return dataSource;
        } catch (error) {
          // Ignore errors and try the next data source
        }
      }
    }
    
    return null;
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
    const cacheKey = `bars_${symbol}_${timeframe}_${start.getTime()}_${end.getTime()}`;
    
    // Check cache first
    if (this.options.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Find a data source that supports bars for this symbol
    const dataSource = this.findDataSourceForSymbol(symbol, 'bars');
    
    if (!dataSource) {
      throw new Error(`No data source found for bars data for symbol ${symbol}`);
    }
    
    // Get the bars from the data source
    const bars = await dataSource.getBars(symbol, timeframe, start, end);
    
    // Cache the result
    if (this.options.cacheEnabled) {
      this.cache.set(cacheKey, bars);
      this.pruneCache();
    }
    
    return bars;
  }
  
  /**
   * Get tick data for a symbol
   */
  async getTicks(
    symbol: string,
    start: Date,
    end: Date
  ): Promise<Tick[]> {
    const cacheKey = `ticks_${symbol}_${start.getTime()}_${end.getTime()}`;
    
    // Check cache first
    if (this.options.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Find a data source that supports ticks for this symbol
    const dataSource = this.findDataSourceForSymbol(symbol, 'ticks');
    
    if (!dataSource) {
      throw new Error(`No data source found for tick data for symbol ${symbol}`);
    }
    
    // Get the ticks from the data source
    const ticks = await dataSource.getTicks(symbol, start, end);
    
    // Cache the result
    if (this.options.cacheEnabled) {
      this.cache.set(cacheKey, ticks);
      this.pruneCache();
    }
    
    return ticks;
  }
  
  /**
   * Get order book data for a symbol
   */
  async getOrderBooks(
    symbol: string,
    start: Date,
    end: Date
  ): Promise<OrderBook[]> {
    const cacheKey = `orderbooks_${symbol}_${start.getTime()}_${end.getTime()}`;
    
    // Check cache first
    if (this.options.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Find a data source that supports order books for this symbol
    const dataSource = this.findDataSourceForSymbol(symbol, 'orderbooks');
    
    if (!dataSource) {
      throw new Error(`No data source found for order book data for symbol ${symbol}`);
    }
    
    // Get the order books from the data source
    const orderBooks = await dataSource.getOrderBooks(symbol, start, end);
    
    // Cache the result
    if (this.options.cacheEnabled) {
      this.cache.set(cacheKey, orderBooks);
      this.pruneCache();
    }
    
    return orderBooks;
  }
  
  /**
   * Get available symbols across all data sources
   */
  async getAvailableSymbols(): Promise<string[]> {
    const symbols = new Set<string>();
    
    for (const dataSource of this.dataSources.values()) {
      try {
        const dataSourceSymbols = await dataSource.getAvailableSymbols();
        
        for (const symbol of dataSourceSymbols) {
          symbols.add(symbol);
        }
      } catch (error) {
        // Ignore errors and continue with the next data source
        console.error(`Error getting symbols from data source: ${error}`);
      }
    }
    
    return Array.from(symbols);
  }
  
  /**
   * Get time range for a symbol across all data sources
   */
  async getTimeRange(symbol: string): Promise<{ start: Date; end: Date } | null> {
    let earliestStart: Date | null = null;
    let latestEnd: Date | null = null;
    
    for (const dataSource of this.dataSources.values()) {
      try {
        const timeRange = await dataSource.getTimeRange(symbol);
        
        if (!earliestStart || timeRange.start < earliestStart) {
          earliestStart = timeRange.start;
        }
        
        if (!latestEnd || timeRange.end > latestEnd) {
          latestEnd = timeRange.end;
        }
      } catch (error) {
        // Ignore errors and continue with the next data source
        console.error(`Error getting time range from data source: ${error}`);
      }
    }
    
    if (earliestStart && latestEnd) {
      return { start: earliestStart, end: latestEnd };
    }
    
    return null;
  }
  
  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Prune the cache if it exceeds the size limit
   */
  private pruneCache(): void {
    if (!this.options.cacheEnabled || !this.options.cacheSizeLimit) {
      return;
    }
    
    if (this.cache.size <= this.options.cacheSizeLimit) {
      return;
    }
    
    // Simple LRU approximation: remove the oldest entries first
    const entriesToRemove = this.cache.size - this.options.cacheSizeLimit;
    const keys = Array.from(this.cache.keys()).slice(0, entriesToRemove);
    
    for (const key of keys) {
      this.cache.delete(key);
    }
  }
} 