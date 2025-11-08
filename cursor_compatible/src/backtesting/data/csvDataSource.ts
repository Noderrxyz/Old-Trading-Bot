import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { parse } from 'csv-parse';
import { Bar, OrderBook, Tick, Timeframe } from '../models/types';
import { DataSource } from './dataManager';

const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const existsAsync = promisify(fs.exists);
const statAsync = promisify(fs.stat);

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
  dateFormat?: string; // Date format in CSV files (default: 'YYYY-MM-DD HH:mm:ss')
  delimiter?: string; // CSV delimiter (default: ',')
  
  // Bar data column mapping
  barColumns?: {
    timestamp: string | number;
    open: string | number;
    high: string | number;
    low: string | number;
    close: string | number;
    volume: string | number;
    [key: string]: string | number;
  };
  
  // Tick data column mapping
  tickColumns?: {
    timestamp: string | number;
    price: string | number;
    volume: string | number;
    [key: string]: string | number;
  };
  
  // Order book data column mapping
  orderBookColumns?: {
    timestamp: string | number;
    bidPrice: string | number;
    bidVolume: string | number;
    askPrice: string | number;
    askVolume: string | number;
    [key: string]: string | number;
  };
}

/**
 * Implementation of DataSource that loads data from CSV files
 */
export class CsvDataSource implements DataSource {
  private options: CsvDataSourceOptions;
  private symbolCache: string[] | null = null;
  private timeRangeCache: Map<string, { start: Date; end: Date }> = new Map();
  
  constructor(options: CsvDataSourceOptions) {
    this.options = {
      barSubDir: 'bars',
      tickSubDir: 'ticks',
      orderBookSubDir: 'orderbooks',
      dateFormat: 'YYYY-MM-DD HH:mm:ss',
      delimiter: ',',
      ...options,
      barColumns: {
        timestamp: 0,
        open: 1,
        high: 2,
        low: 3,
        close: 4,
        volume: 5,
        ...(options.barColumns || {})
      },
      tickColumns: {
        timestamp: 0,
        price: 1,
        volume: 2,
        ...(options.tickColumns || {})
      },
      orderBookColumns: {
        timestamp: 0,
        bidPrice: 1,
        bidVolume: 2,
        askPrice: 3,
        askVolume: 4,
        ...(options.orderBookColumns || {})
      }
    };
  }

  getId(): string {
    return 'csv';
  }

  getDescription(): string {
    return `CSV Data Source (${this.options.dataDir})`;
  }

  supportsBars(): boolean {
    return true;
  }

  supportsTicks(): boolean {
    return true;
  }

  supportsOrderBook(): boolean {
    return true;
  }

  /**
   * Get historical bar data from CSV files
   */
  async getBars(symbol: string, timeframe: Timeframe, start: Date, end: Date): Promise<Bar[]> {
    const filePath = this.getBarFilePath(symbol, timeframe);
    
    // Check if file exists
    if (!(await existsAsync(filePath))) {
      throw new Error(`No bar data file found for ${symbol} at ${timeframe}`);
    }
    
    // Read and parse the CSV file
    const content = await readFileAsync(filePath, 'utf8');
    const records = await this.parseCsv(content);
    
    // Map the records to Bar objects
    const bars: Bar[] = records.map(record => this.parseBarRecord(record, symbol));
    
    // Filter by date range
    return bars.filter(bar => bar.timestamp >= start && bar.timestamp <= end);
  }

  /**
   * Get historical tick data from CSV files
   */
  async getTicks(symbol: string, start: Date, end: Date): Promise<Tick[]> {
    const filePath = this.getTickFilePath(symbol);
    
    // Check if file exists
    if (!(await existsAsync(filePath))) {
      throw new Error(`No tick data file found for ${symbol}`);
    }
    
    // Read and parse the CSV file
    const content = await readFileAsync(filePath, 'utf8');
    const records = await this.parseCsv(content);
    
    // Map the records to Tick objects
    const ticks: Tick[] = records.map(record => this.parseTickRecord(record, symbol));
    
    // Filter by date range
    return ticks.filter(tick => tick.timestamp >= start && tick.timestamp <= end);
  }

  /**
   * Get historical order book data from CSV files
   */
  async getOrderBooks(symbol: string, start: Date, end: Date): Promise<OrderBook[]> {
    const filePath = this.getOrderBookFilePath(symbol);
    
    // Check if file exists
    if (!(await existsAsync(filePath))) {
      throw new Error(`No order book data file found for ${symbol}`);
    }
    
    // Read and parse the CSV file
    const content = await readFileAsync(filePath, 'utf8');
    const records = await this.parseCsv(content);
    
    // Group records by timestamp to create complete order books
    const booksByTimestamp = new Map<string, any[]>();
    
    for (const record of records) {
      const timestamp = this.getFieldFromRecord(record, this.options.orderBookColumns!.timestamp);
      if (!booksByTimestamp.has(timestamp)) {
        booksByTimestamp.set(timestamp, []);
      }
      booksByTimestamp.get(timestamp)!.push(record);
    }
    
    // Convert grouped records to OrderBook objects
    const orderBooks: OrderBook[] = [];
    
    for (const [timestamp, records] of booksByTimestamp.entries()) {
      const orderBook = this.createOrderBookFromRecords(records, symbol, new Date(timestamp));
      orderBooks.push(orderBook);
    }
    
    // Filter by date range
    return orderBooks.filter(book => book.timestamp >= start && book.timestamp <= end);
  }

  /**
   * Get list of available symbols
   */
  async getAvailableSymbols(): Promise<string[]> {
    // Return cached result if available
    if (this.symbolCache !== null) {
      return this.symbolCache;
    }
    
    const barDir = path.join(this.options.dataDir, this.options.barSubDir!);
    
    // Check if bar directory exists
    if (!(await existsAsync(barDir))) {
      this.symbolCache = [];
      return [];
    }
    
    // Get all files in bar directory
    const files = await readdirAsync(barDir);
    
    // Extract symbols from filenames
    const symbols = new Set<string>();
    
    for (const file of files) {
      if (file.endsWith('.csv')) {
        // Extract symbol from filename (assuming format: SYMBOL_TIMEFRAME.csv)
        const parts = file.split('_');
        if (parts.length >= 1) {
          symbols.add(parts[0]);
        }
      }
    }
    
    this.symbolCache = Array.from(symbols);
    return this.symbolCache;
  }

  /**
   * Get time range for a symbol
   */
  async getTimeRange(symbol: string): Promise<{ start: Date; end: Date }> {
    // Return cached result if available
    if (this.timeRangeCache.has(symbol)) {
      return this.timeRangeCache.get(symbol)!;
    }
    
    // Try to get time range from bar data first
    try {
      // Find any available timeframe file for this symbol
      const barDir = path.join(this.options.dataDir, this.options.barSubDir!);
      const files = await readdirAsync(barDir);
      
      for (const file of files) {
        if (file.startsWith(`${symbol}_`) && file.endsWith('.csv')) {
          const filePath = path.join(barDir, file);
          const content = await readFileAsync(filePath, 'utf8');
          const records = await this.parseCsv(content);
          
          if (records.length === 0) {
            continue;
          }
          
          // Get first and last timestamps
          const firstTimestamp = this.getFieldFromRecord(records[0], this.options.barColumns!.timestamp);
          const lastTimestamp = this.getFieldFromRecord(records[records.length - 1], this.options.barColumns!.timestamp);
          
          const result = {
            start: new Date(firstTimestamp),
            end: new Date(lastTimestamp)
          };
          
          this.timeRangeCache.set(symbol, result);
          return result;
        }
      }
    } catch (error) {
      console.warn(`Failed to get time range from bar data for ${symbol}: ${error}`);
    }
    
    // Fallback to tick data if bar data not available
    try {
      const tickFilePath = this.getTickFilePath(symbol);
      
      if (await existsAsync(tickFilePath)) {
        const content = await readFileAsync(tickFilePath, 'utf8');
        const records = await this.parseCsv(content);
        
        if (records.length === 0) {
          throw new Error(`No tick data for ${symbol}`);
        }
        
        // Get first and last timestamps
        const firstTimestamp = this.getFieldFromRecord(records[0], this.options.tickColumns!.timestamp);
        const lastTimestamp = this.getFieldFromRecord(records[records.length - 1], this.options.tickColumns!.timestamp);
        
        const result = {
          start: new Date(firstTimestamp),
          end: new Date(lastTimestamp)
        };
        
        this.timeRangeCache.set(symbol, result);
        return result;
      }
    } catch (error) {
      console.warn(`Failed to get time range from tick data for ${symbol}: ${error}`);
    }
    
    throw new Error(`No data available to determine time range for ${symbol}`);
  }

  /**
   * Parse a CSV string to records
   */
  private async parseCsv(content: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      parse(content, {
        delimiter: this.options.delimiter,
        columns: true,
        skip_empty_lines: true,
        trim: true
      }, (err: Error | undefined, records: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(records);
        }
      });
    });
  }

  /**
   * Parse a record into a Bar object
   */
  private parseBarRecord(record: any, symbol: string): Bar {
    const timestamp = this.getFieldFromRecord(record, this.options.barColumns!.timestamp);
    const open = parseFloat(this.getFieldFromRecord(record, this.options.barColumns!.open));
    const high = parseFloat(this.getFieldFromRecord(record, this.options.barColumns!.high));
    const low = parseFloat(this.getFieldFromRecord(record, this.options.barColumns!.low));
    const close = parseFloat(this.getFieldFromRecord(record, this.options.barColumns!.close));
    const volume = parseFloat(this.getFieldFromRecord(record, this.options.barColumns!.volume));
    
    return {
      symbol,
      timestamp: new Date(timestamp),
      open,
      high,
      low,
      close,
      volume
    };
  }

  /**
   * Parse a record into a Tick object
   */
  private parseTickRecord(record: any, symbol: string): Tick {
    const timestamp = this.getFieldFromRecord(record, this.options.tickColumns!.timestamp);
    const price = parseFloat(this.getFieldFromRecord(record, this.options.tickColumns!.price));
    const volume = parseFloat(this.getFieldFromRecord(record, this.options.tickColumns!.volume));
    
    const tick: Tick = {
      symbol,
      timestamp: new Date(timestamp),
      price,
      volume
    };
    
    // Add optional fields if present in the record
    if ('side' in record) {
      tick.side = record.side as 'buy' | 'sell';
    }
    
    if ('exchange' in record) {
      tick.exchange = record.exchange;
    }
    
    return tick;
  }

  /**
   * Create an OrderBook object from a group of records
   */
  private createOrderBookFromRecords(records: any[], symbol: string, timestamp: Date): OrderBook {
    const bids: { price: number; volume: number }[] = [];
    const asks: { price: number; volume: number }[] = [];
    
    for (const record of records) {
      const bidPrice = parseFloat(this.getFieldFromRecord(record, this.options.orderBookColumns!.bidPrice));
      const bidVolume = parseFloat(this.getFieldFromRecord(record, this.options.orderBookColumns!.bidVolume));
      const askPrice = parseFloat(this.getFieldFromRecord(record, this.options.orderBookColumns!.askPrice));
      const askVolume = parseFloat(this.getFieldFromRecord(record, this.options.orderBookColumns!.askVolume));
      
      if (!isNaN(bidPrice) && !isNaN(bidVolume)) {
        bids.push({ price: bidPrice, volume: bidVolume });
      }
      
      if (!isNaN(askPrice) && !isNaN(askVolume)) {
        asks.push({ price: askPrice, volume: askVolume });
      }
    }
    
    // Sort bids in descending order (highest first)
    bids.sort((a, b) => b.price - a.price);
    
    // Sort asks in ascending order (lowest first)
    asks.sort((a, b) => a.price - b.price);
    
    return {
      symbol,
      timestamp,
      bids,
      asks
    };
  }

  /**
   * Get the value of a field from a record
   */
  private getFieldFromRecord(record: any, field: string | number): any {
    if (typeof field === 'number') {
      return Object.values(record)[field];
    }
    return record[field];
  }

  /**
   * Get the file path for bar data
   */
  private getBarFilePath(symbol: string, timeframe: Timeframe): string {
    return path.join(
      this.options.dataDir,
      this.options.barSubDir!,
      `${symbol}_${timeframe}.csv`
    );
  }

  /**
   * Get the file path for tick data
   */
  private getTickFilePath(symbol: string): string {
    return path.join(
      this.options.dataDir,
      this.options.tickSubDir!,
      `${symbol}_ticks.csv`
    );
  }

  /**
   * Get the file path for order book data
   */
  private getOrderBookFilePath(symbol: string): string {
    return path.join(
      this.options.dataDir,
      this.options.orderBookSubDir!,
      `${symbol}_orderbook.csv`
    );
  }
} 