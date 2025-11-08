import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { Bar, OrderBook, Tick, Timeframe } from '../models/types';
import { DataSource } from './dataManager';

/**
 * Configuration options for CSV data source
 */
export interface CsvDataSourceOptions {
  // Root directory containing CSV files
  dataDir: string;
  
  // CSV file organization options
  barSubDir?: string; // Subdirectory for bar data (default: 'bars')
  tickSubDir?: string; // Subdirectory for tick data (default: 'ticks')
  orderBookSubDir?: string; // Subdirectory for order book data (default: 'orderbooks')
  
  // CSV file format options
  barColumns?: { // Column mapping for bar data
    timestamp: string | number;
    open: string | number;
    high: string | number;
    low: string | number;
    close: string | number;
    volume: string | number;
    vwap?: string | number;
    trades?: string | number;
  };
  
  tickColumns?: { // Column mapping for tick data
    timestamp: string | number;
    price: string | number;
    volume: string | number;
    side?: string | number;
    exchange?: string | number;
  };
  
  orderBookColumns?: { // Column mapping for order book data
    timestamp: string | number;
    bids: string | number;
    asks: string | number;
    depth?: string | number;
  };
  
  // File naming format options
  fileNameFormat?: string; // Format for file names (default: '{symbol}_{timeframe}.csv')
  symbolFormat?: string; // Format for symbol in file names (default: '{base}_{quote}')
  
  // CSV parsing options
  delimiter?: string; // CSV delimiter (default: ',')
  dateFormat?: string; // Format for date parsing (default: 'YYYY-MM-DD HH:mm:ss')
  timezone?: string; // Timezone for date parsing (default: 'UTC')
}

/**
 * Implements a data source that reads from CSV files
 */
export class CsvDataSource implements DataSource {
  private options: CsvDataSourceOptions;
  private symbolCache: string[] | null = null;
  private timeRangeCache: Map<string, { start: Date; end: Date }> = new Map();
  
  constructor(options: CsvDataSourceOptions) {
    // Set default options
    this.options = {
      ...options,
      barSubDir: options.barSubDir || 'bars',
      tickSubDir: options.tickSubDir || 'ticks',
      orderBookSubDir: options.orderBookSubDir || 'orderbooks',
      barColumns: {
        timestamp: 'timestamp',
        open: 'open',
        high: 'high',
        low: 'low',
        close: 'close',
        volume: 'volume',
        vwap: 'vwap',
        trades: 'trades',
        ...options.barColumns
      },
      tickColumns: {
        timestamp: 'timestamp',
        price: 'price',
        volume: 'volume',
        side: 'side',
        exchange: 'exchange',
        ...options.tickColumns
      },
      orderBookColumns: {
        timestamp: 'timestamp',
        bids: 'bids',
        asks: 'asks',
        depth: 'depth',
        ...options.orderBookColumns
      },
      delimiter: options.delimiter || ',',
      dateFormat: options.dateFormat || 'YYYY-MM-DD HH:mm:ss',
      timezone: options.timezone || 'UTC',
      fileNameFormat: options.fileNameFormat || '{symbol}_{timeframe}.csv'
    };
  }
  
  /**
   * Get the data source ID
   */
  getId(): string {
    return 'csv_data_source';
  }
  
  /**
   * Get the data source description
   */
  getDescription(): string {
    return `CSV Data Source (${this.options.dataDir})`;
  }
  
  /**
   * Check if the data source supports bar data
   */
  supportsBars(): boolean {
    return true;
  }
  
  /**
   * Check if the data source supports tick data
   */
  supportsTicks(): boolean {
    return true;
  }
  
  /**
   * Check if the data source supports order book data
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
    const filePath = this.getBarFilePath(symbol, timeframe);
    
    // Check if the file exists
    if (!this.fileExists(filePath)) {
      return [];
    }
    
    // Read and parse the CSV file
    const records = await this.readCsvFile(filePath);
    
    // Map CSV records to bars
    const bars: Bar[] = [];
    
    for (const record of records) {
      const timestamp = this.parseDate(record[this.options.barColumns!.timestamp as string]);
      
      // Skip records outside the date range
      if (timestamp < start || timestamp > end) {
        continue;
      }
      
      const bar: Bar = {
        symbol,
        timestamp,
        open: this.parseNumber(record[this.options.barColumns!.open as string]),
        high: this.parseNumber(record[this.options.barColumns!.high as string]),
        low: this.parseNumber(record[this.options.barColumns!.low as string]),
        close: this.parseNumber(record[this.options.barColumns!.close as string]),
        volume: this.parseNumber(record[this.options.barColumns!.volume as string]),
      };
      
      // Add optional fields if they exist
      if (this.options.barColumns!.vwap && record[this.options.barColumns!.vwap as string]) {
        bar.vwap = this.parseNumber(record[this.options.barColumns!.vwap as string]);
      }
      
      if (this.options.barColumns!.trades && record[this.options.barColumns!.trades as string]) {
        bar.trades = this.parseNumber(record[this.options.barColumns!.trades as string]);
      }
      
      bars.push(bar);
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
    const filePath = this.getTickFilePath(symbol);
    
    // Check if the file exists
    if (!this.fileExists(filePath)) {
      return [];
    }
    
    // Read and parse the CSV file
    const records = await this.readCsvFile(filePath);
    
    // Map CSV records to ticks
    const ticks: Tick[] = [];
    
    for (const record of records) {
      const timestamp = this.parseDate(record[this.options.tickColumns!.timestamp as string]);
      
      // Skip records outside the date range
      if (timestamp < start || timestamp > end) {
        continue;
      }
      
      const tick: Tick = {
        symbol,
        timestamp,
        price: this.parseNumber(record[this.options.tickColumns!.price as string]),
        volume: this.parseNumber(record[this.options.tickColumns!.volume as string]),
      };
      
      // Add optional fields if they exist
      if (this.options.tickColumns!.side && record[this.options.tickColumns!.side as string]) {
        tick.side = record[this.options.tickColumns!.side as string] as 'buy' | 'sell';
      }
      
      if (this.options.tickColumns!.exchange && record[this.options.tickColumns!.exchange as string]) {
        tick.exchange = record[this.options.tickColumns!.exchange as string];
      }
      
      ticks.push(tick);
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
    const filePath = this.getOrderBookFilePath(symbol);
    
    // Check if the file exists
    if (!this.fileExists(filePath)) {
      return [];
    }
    
    // Read and parse the CSV file
    const records = await this.readCsvFile(filePath);
    
    // Map CSV records to order books
    const orderBooks: OrderBook[] = [];
    
    for (const record of records) {
      const timestamp = this.parseDate(record[this.options.orderBookColumns!.timestamp as string]);
      
      // Skip records outside the date range
      if (timestamp < start || timestamp > end) {
        continue;
      }
      
      // Parse bids and asks (assuming they're stored as JSON strings)
      const bids = JSON.parse(record[this.options.orderBookColumns!.bids as string]);
      const asks = JSON.parse(record[this.options.orderBookColumns!.asks as string]);
      
      const orderBook: OrderBook = {
        symbol,
        timestamp,
        bids,
        asks,
      };
      
      // Add optional fields if they exist
      if (this.options.orderBookColumns!.depth && record[this.options.orderBookColumns!.depth as string]) {
        orderBook.depth = this.parseNumber(record[this.options.orderBookColumns!.depth as string]);
      }
      
      orderBooks.push(orderBook);
    }
    
    return orderBooks;
  }
  
  /**
   * Get all available symbols
   */
  async getAvailableSymbols(): Promise<string[]> {
    // Return cached symbols if available
    if (this.symbolCache) {
      return this.symbolCache;
    }
    
    const symbols = new Set<string>();
    
    // Get symbols from bar data
    try {
      const barFiles = this.listFilesInDirectory(path.join(this.options.dataDir, this.options.barSubDir!));
      
      for (const file of barFiles) {
        const symbol = this.extractSymbolFromFileName(file);
        
        if (symbol) {
          symbols.add(symbol);
        }
      }
    } catch (error) {
      // Ignore errors and continue
    }
    
    // Get symbols from tick data
    try {
      const tickFiles = this.listFilesInDirectory(path.join(this.options.dataDir, this.options.tickSubDir!));
      
      for (const file of tickFiles) {
        const symbol = this.extractSymbolFromFileName(file);
        
        if (symbol) {
          symbols.add(symbol);
        }
      }
    } catch (error) {
      // Ignore errors and continue
    }
    
    // Get symbols from order book data
    try {
      const orderBookFiles = this.listFilesInDirectory(path.join(this.options.dataDir, this.options.orderBookSubDir!));
      
      for (const file of orderBookFiles) {
        const symbol = this.extractSymbolFromFileName(file);
        
        if (symbol) {
          symbols.add(symbol);
        }
      }
    } catch (error) {
      // Ignore errors and continue
    }
    
    // Cache the symbols
    this.symbolCache = Array.from(symbols);
    
    return this.symbolCache;
  }
  
  /**
   * Get time range for a symbol
   */
  async getTimeRange(symbol: string): Promise<{ start: Date; end: Date }> {
    // Return cached time range if available
    if (this.timeRangeCache.has(symbol)) {
      return this.timeRangeCache.get(symbol)!;
    }
    
    // Try to determine the time range from bar data first
    try {
      for (const timeframe of Object.values(Timeframe)) {
        const filePath = this.getBarFilePath(symbol, timeframe);
        
        if (this.fileExists(filePath)) {
          const records = await this.readCsvFile(filePath);
          
          if (records.length > 0) {
            const firstTimestamp = this.parseDate(records[0][this.options.barColumns!.timestamp as string]);
            const lastTimestamp = this.parseDate(records[records.length - 1][this.options.barColumns!.timestamp as string]);
            
            const timeRange = { start: firstTimestamp, end: lastTimestamp };
            this.timeRangeCache.set(symbol, timeRange);
            
            return timeRange;
          }
        }
      }
    } catch (error) {
      // Ignore errors and try other data types
    }
    
    // Try to determine the time range from tick data
    try {
      const filePath = this.getTickFilePath(symbol);
      
      if (this.fileExists(filePath)) {
        const records = await this.readCsvFile(filePath);
        
        if (records.length > 0) {
          const firstTimestamp = this.parseDate(records[0][this.options.tickColumns!.timestamp as string]);
          const lastTimestamp = this.parseDate(records[records.length - 1][this.options.tickColumns!.timestamp as string]);
          
          const timeRange = { start: firstTimestamp, end: lastTimestamp };
          this.timeRangeCache.set(symbol, timeRange);
          
          return timeRange;
        }
      }
    } catch (error) {
      // Ignore errors and try other data types
    }
    
    // Try to determine the time range from order book data
    try {
      const filePath = this.getOrderBookFilePath(symbol);
      
      if (this.fileExists(filePath)) {
        const records = await this.readCsvFile(filePath);
        
        if (records.length > 0) {
          const firstTimestamp = this.parseDate(records[0][this.options.orderBookColumns!.timestamp as string]);
          const lastTimestamp = this.parseDate(records[records.length - 1][this.options.orderBookColumns!.timestamp as string]);
          
          const timeRange = { start: firstTimestamp, end: lastTimestamp };
          this.timeRangeCache.set(symbol, timeRange);
          
          return timeRange;
        }
      }
    } catch (error) {
      // Ignore errors
    }
    
    // If we couldn't determine the time range, use a default range
    const defaultTimeRange = {
      start: new Date('2000-01-01'),
      end: new Date()
    };
    
    this.timeRangeCache.set(symbol, defaultTimeRange);
    
    return defaultTimeRange;
  }
  
  /**
   * Helper method to get the file path for bar data
   */
  private getBarFilePath(symbol: string, timeframe: Timeframe): string {
    // Replace slashes in symbol with underscores for file names
    const safeSymbol = symbol.replace('/', '_');
    
    // Construct the file name based on the format
    const fileName = `${safeSymbol}_${timeframe}.csv`;
    
    return path.join(this.options.dataDir, this.options.barSubDir!, fileName);
  }
  
  /**
   * Helper method to get the file path for tick data
   */
  private getTickFilePath(symbol: string): string {
    // Replace slashes in symbol with underscores for file names
    const safeSymbol = symbol.replace('/', '_');
    
    // Construct the file name
    const fileName = `${safeSymbol}_ticks.csv`;
    
    return path.join(this.options.dataDir, this.options.tickSubDir!, fileName);
  }
  
  /**
   * Helper method to get the file path for order book data
   */
  private getOrderBookFilePath(symbol: string): string {
    // Replace slashes in symbol with underscores for file names
    const safeSymbol = symbol.replace('/', '_');
    
    // Construct the file name
    const fileName = `${safeSymbol}_orderbook.csv`;
    
    return path.join(this.options.dataDir, this.options.orderBookSubDir!, fileName);
  }
  
  /**
   * Helper method to check if a file exists
   */
  private fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Helper method to list files in a directory
   */
  private listFilesInDirectory(dirPath: string): string[] {
    try {
      return fs.readdirSync(dirPath);
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Helper method to extract symbol from a file name
   */
  private extractSymbolFromFileName(fileName: string): string | null {
    // This is a simple implementation that assumes the file name format is {symbol}_{timeframe}.csv
    const match = fileName.match(/^([^_]+)_(.+)\.csv$/);
    
    if (match) {
      return match[1].replace('_', '/');
    }
    
    return null;
  }
  
  /**
   * Helper method to read and parse a CSV file
   */
  private async readCsvFile(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      
      fs.createReadStream(filePath)
        .pipe(parse({
          delimiter: this.options.delimiter,
          columns: true,
          skip_empty_lines: true
        }))
        .on('data', (data) => {
          results.push(data);
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }
  
  /**
   * Helper method to parse a date string
   */
  private parseDate(dateString: string): Date {
    // This is a simple implementation that assumes ISO date format
    return new Date(dateString);
  }
  
  /**
   * Helper method to parse a number
   */
  private parseNumber(value: string): number {
    return parseFloat(value);
  }
} 