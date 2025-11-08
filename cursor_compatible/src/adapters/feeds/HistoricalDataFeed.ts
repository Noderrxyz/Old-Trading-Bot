/**
 * Historical Data Feed
 * 
 * Replays historical market data from various sources (JSON, CSV, APIs)
 * with full time control capabilities for backtesting and analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  IDataFeed, 
  DataFeedConfig, 
  DataFeedStatistics,
  PriceTick, 
  CandlestickData, 
  OrderBookSnapshot,
  LiquidityMetrics,
  MarketAnomaly
} from '../interfaces/IDataFeed';
import { MarketSimulationEngine } from '../simulation/MarketSimulationEngine';
import { MEVSimulationEngine } from '../simulation/MEVSimulationEngine';
import { logger } from '../../utils/logger';

export interface HistoricalDataSource {
  type: 'json' | 'csv' | 'api';
  path: string;
  format: 'candlesticks' | 'ticks' | 'orderbooks';
  timeFormat: 'timestamp' | 'iso' | 'unix';
  compression?: 'gzip' | 'none';
}

export interface HistoricalCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
  symbol: string;
}

export class HistoricalDataFeed implements IDataFeed {
  private feedId: string;
  private config: DataFeedConfig;
  private statistics: DataFeedStatistics;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  
  // Data storage
  private historicalData: Map<string, HistoricalCandle[]> = new Map();
  private currentPositions: Map<string, number> = new Map(); // Current position in data
  private replaySpeed: number = 1;
  private currentTime: number = 0;
  private timeRange: { start: number; end: number } = { start: 0, end: 0 };
  
  // Simulation engines
  private marketEngine: MarketSimulationEngine;
  private mevEngine: MEVSimulationEngine;
  
  // Event callbacks
  private tickCallbacks: Array<(tick: PriceTick) => void> = [];
  private candleCallbacks: Array<(candle: CandlestickData) => void> = [];
  private orderBookCallbacks: Array<(orderbook: OrderBookSnapshot) => void> = [];
  private anomalyCallbacks: Array<(anomaly: MarketAnomaly) => void> = [];
  
  // Replay control
  private replayTimer?: NodeJS.Timeout;
  private lastTickTime: number = 0;

  constructor(feedId: string = 'historical_feed') {
    this.feedId = feedId;
    this.config = {
      symbols: [],
      replaySpeed: 1,
      enableAnomalies: true,
      anomalyFrequency: 0.5,
      volatilityMultiplier: 1.0,
      liquidityMultiplier: 1.0
    };
    
    this.statistics = {
      feedType: 'historical',
      ticksProcessed: 0,
      candlesProcessed: 0,
      anomaliesGenerated: 0,
      currentTimestamp: 0,
      dataLatency: 0,
      isRealTime: false,
      uptime: 0
    };
    
    this.marketEngine = new MarketSimulationEngine();
    this.mevEngine = new MEVSimulationEngine();
    
    logger.info('[HISTORICAL_FEED] Historical data feed initialized', { feedId });
  }

  getFeedId(): string {
    return this.feedId;
  }

  getFeedType(): 'historical' | 'simulated' | 'hybrid' | 'live_mirror' {
    return 'historical';
  }

  getConfig(): DataFeedConfig {
    return { ...this.config };
  }

  getStatistics(): DataFeedStatistics {
    return { ...this.statistics };
  }

  async initialize(config: DataFeedConfig): Promise<void> {
    this.config = { ...this.config, ...config };
    this.replaySpeed = config.replaySpeed || 1;
    
    logger.info('[HISTORICAL_FEED] Initializing with config', this.config);
    
    // Load historical data for each symbol
    for (const symbol of this.config.symbols) {
      await this.loadHistoricalData(symbol);
    }
    
    // Calculate time range
    this.calculateTimeRange();
    
    logger.info('[HISTORICAL_FEED] Initialization complete', {
      symbols: this.config.symbols.length,
      timeRange: this.timeRange,
      totalCandles: Array.from(this.historicalData.values()).reduce((sum, data) => sum + data.length, 0)
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[HISTORICAL_FEED] Already running');
      return;
    }
    
    this.isRunning = true;
    this.isPaused = false;
    this.lastTickTime = Date.now();
    this.statistics.uptime = Date.now();
    
    this.startReplay();
    
    logger.info('[HISTORICAL_FEED] Started replay', {
      replaySpeed: this.replaySpeed,
      currentTime: this.currentTime
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.isPaused = false;
    
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = undefined;
    }
    
    logger.info('[HISTORICAL_FEED] Stopped');
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = undefined;
    }
    
    logger.info('[HISTORICAL_FEED] Paused at', { currentTime: this.currentTime });
  }

  async resume(): Promise<void> {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.startReplay();
      logger.info('[HISTORICAL_FEED] Resumed');
    }
  }

  async reset(): Promise<void> {
    await this.stop();
    
    // Reset positions and time
    this.currentPositions.clear();
    this.currentTime = this.timeRange.start;
    this.statistics.ticksProcessed = 0;
    this.statistics.candlesProcessed = 0;
    this.statistics.anomaliesGenerated = 0;
    
    // Reset simulation engines
    this.marketEngine.reset();
    this.mevEngine.reset();
    
    logger.info('[HISTORICAL_FEED] Reset to start');
  }

  isActive(): boolean {
    return this.isRunning && !this.isPaused;
  }

  setReplaySpeed(speed: number): void {
    this.replaySpeed = Math.max(0.1, Math.min(speed, 1000)); // Limit between 0.1x and 1000x
    logger.info('[HISTORICAL_FEED] Replay speed changed', { newSpeed: this.replaySpeed });
  }

  async jumpToTime(timestamp: number): Promise<void> {
    if (timestamp < this.timeRange.start || timestamp > this.timeRange.end) {
      throw new Error(`Timestamp ${timestamp} is outside data range [${this.timeRange.start}, ${this.timeRange.end}]`);
    }
    
    this.currentTime = timestamp;
    
    // Update positions for all symbols
    for (const symbol of this.config.symbols) {
      const data = this.historicalData.get(symbol);
      if (data) {
        const position = this.findPositionForTimestamp(data, timestamp);
        this.currentPositions.set(symbol, position);
      }
    }
    
    logger.info('[HISTORICAL_FEED] Jumped to time', { timestamp, currentTime: this.currentTime });
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getTimeRange(): { start: number; end: number } {
    return { ...this.timeRange };
  }

  async getNextTick(symbol: string): Promise<PriceTick | null> {
    const data = this.historicalData.get(symbol);
    if (!data) return null;
    
    const position = this.currentPositions.get(symbol) || 0;
    if (position >= data.length) return null;
    
    const candle = data[position];
    this.currentPositions.set(symbol, position + 1);
    
    // Generate tick from candle data
    const tick: PriceTick = {
      symbol,
      timestamp: candle.timestamp,
      price: candle.close,
      volume: candle.volume,
      source: 'historical'
    };
    
    this.statistics.ticksProcessed++;
    return tick;
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const data = this.historicalData.get(symbol);
    if (!data) throw new Error(`No data for symbol ${symbol}`);
    
    const position = this.currentPositions.get(symbol) || 0;
    if (position === 0) return data[0]?.close || 0;
    
    const currentCandle = data[Math.min(position - 1, data.length - 1)];
    return currentCandle?.close || 0;
  }

  async getOrderBook(symbol: string): Promise<OrderBookSnapshot> {
    const currentPrice = await this.getCurrentPrice(symbol);
    
    // Generate realistic order book from current price
    const bids: Array<{ price: number; quantity: number; orders: number }> = [];
    const asks: Array<{ price: number; quantity: number; orders: number }> = [];
    
    for (let i = 0; i < 20; i++) {
      const bidPrice = currentPrice * (1 - (i + 1) * 0.001);
      const askPrice = currentPrice * (1 + (i + 1) * 0.001);
      
      bids.push({
        price: bidPrice,
        quantity: Math.random() * 10 + 1,
        orders: Math.floor(Math.random() * 5) + 1
      });
      
      asks.push({
        price: askPrice,
        quantity: Math.random() * 10 + 1,
        orders: Math.floor(Math.random() * 5) + 1
      });
    }
    
    const spread = asks[0].price - bids[0].price;
    const midPrice = (bids[0].price + asks[0].price) / 2;
    
    return {
      symbol,
      timestamp: this.currentTime,
      sequenceId: this.statistics.ticksProcessed,
      bids,
      asks,
      spread,
      midPrice
    };
  }

  async getLiquidityMetrics(symbol: string): Promise<LiquidityMetrics> {
    const orderBook = await this.getOrderBook(symbol);
    
    const bidLiquidity = orderBook.bids.reduce((sum, bid) => sum + bid.quantity, 0);
    const askLiquidity = orderBook.asks.reduce((sum, ask) => sum + ask.quantity, 0);
    const spreadBps = (orderBook.spread / orderBook.midPrice) * 10000;
    
    return {
      symbol,
      timestamp: this.currentTime,
      bidLiquidity,
      askLiquidity,
      spreadBps,
      depthScore: Math.min(100, (bidLiquidity + askLiquidity) / 20), // Normalized to 0-100
      volumeProfile: await this.getVolumeEstimate(symbol, 3600000) // 1 hour
    };
  }

  async getVolumeEstimate(symbol: string, timeWindow: number): Promise<number> {
    const data = this.historicalData.get(symbol);
    if (!data) return 0;
    
    const windowStart = this.currentTime - timeWindow;
    const relevantCandles = data.filter(candle => 
      candle.timestamp >= windowStart && candle.timestamp <= this.currentTime
    );
    
    return relevantCandles.reduce((sum, candle) => sum + candle.volume, 0);
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number = 100): Promise<CandlestickData[]> {
    const data = this.historicalData.get(symbol);
    if (!data) return [];
    
    const position = this.currentPositions.get(symbol) || 0;
    const startIndex = Math.max(0, position - limit);
    const relevantData = data.slice(startIndex, position);
    
    return relevantData.map(candle => ({
      symbol,
      timestamp: candle.timestamp,
      timeframe,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      trades: candle.trades
    }));
  }

  async getTickHistory(symbol: string, fromTime: number, toTime: number): Promise<PriceTick[]> {
    const data = this.historicalData.get(symbol);
    if (!data) return [];
    
    const relevantCandles = data.filter(candle =>
      candle.timestamp >= fromTime && candle.timestamp <= toTime
    );
    
    return relevantCandles.map(candle => ({
      symbol,
      timestamp: candle.timestamp,
      price: candle.close,
      volume: candle.volume,
      source: 'historical'
    }));
  }

  async simulateNextTick(symbol: string): Promise<PriceTick> {
    // This is historical feed, but we can add simulation on top
    const baseTick = await this.getNextTick(symbol);
    if (!baseTick) throw new Error(`No more data for ${symbol}`);
    
    // Apply market simulation if enabled
    const simulatedPrice = this.marketEngine.generatePrice(
      baseTick.price,
      this.config.volatilityMultiplier || 1.0,
      0 // No trend for historical data
    );
    
    return {
      ...baseTick,
      price: simulatedPrice,
      source: 'historical_simulated'
    };
  }

  async simulateCandleClose(symbol: string, timeframe: string): Promise<CandlestickData> {
    const candles = await this.getCandlesticks(symbol, timeframe, 1);
    return candles[0] || {
      symbol,
      timestamp: this.currentTime,
      timeframe,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      volume: 0
    };
  }

  async generateOrderBookSnapshot(symbol: string): Promise<OrderBookSnapshot> {
    return this.getOrderBook(symbol);
  }

  async injectAnomaly(anomaly: MarketAnomaly): Promise<void> {
    this.statistics.anomaliesGenerated++;
    
    // Notify subscribers
    for (const callback of this.anomalyCallbacks) {
      callback(anomaly);
    }
    
    logger.warn('[HISTORICAL_FEED] Anomaly injected', {
      type: anomaly.type,
      severity: anomaly.severity,
      affectedSymbols: anomaly.affectedSymbols
    });
  }

  // Event subscription methods
  onTick(callback: (tick: PriceTick) => void): void {
    this.tickCallbacks.push(callback);
  }

  onCandle(callback: (candle: CandlestickData) => void): void {
    this.candleCallbacks.push(callback);
  }

  onOrderBookUpdate(callback: (orderbook: OrderBookSnapshot) => void): void {
    this.orderBookCallbacks.push(callback);
  }

  onAnomaly(callback: (anomaly: MarketAnomaly) => void): void {
    this.anomalyCallbacks.push(callback);
  }

  async cleanup(): Promise<void> {
    await this.stop();
    
    this.historicalData.clear();
    this.currentPositions.clear();
    this.tickCallbacks.length = 0;
    this.candleCallbacks.length = 0;
    this.orderBookCallbacks.length = 0;
    this.anomalyCallbacks.length = 0;
    
    logger.info('[HISTORICAL_FEED] Cleanup complete');
  }

  // Private methods

  private async loadHistoricalData(symbol: string): Promise<void> {
    try {
      // Try to load from multiple sources
      const possiblePaths = [
        `data/historical/${symbol.replace('/', '_')}.json`,
        `data/${symbol.replace('/', '_')}_candles.json`,
        `./historical_data/${symbol.replace('/', '_')}.json`
      ];
      
      let data: HistoricalCandle[] = [];
      let dataLoaded = false;
      
      for (const dataPath of possiblePaths) {
        if (fs.existsSync(dataPath)) {
          const rawData = fs.readFileSync(dataPath, 'utf8');
          const jsonData = JSON.parse(rawData);
          
          // Handle different data formats
          if (Array.isArray(jsonData)) {
            data = this.normalizeHistoricalData(jsonData, symbol);
          } else if (jsonData.data && Array.isArray(jsonData.data)) {
            data = this.normalizeHistoricalData(jsonData.data, symbol);
          }
          
          dataLoaded = true;
          logger.info('[HISTORICAL_FEED] Loaded historical data', {
            symbol,
            path: dataPath,
            candles: data.length
          });
          break;
        }
      }
      
      if (!dataLoaded) {
        // Generate synthetic historical data if no file found
        data = this.generateSyntheticHistoricalData(symbol);
        logger.warn('[HISTORICAL_FEED] No historical data file found, using synthetic data', {
          symbol,
          candles: data.length
        });
      }
      
      // Sort by timestamp
      data.sort((a, b) => a.timestamp - b.timestamp);
      
      this.historicalData.set(symbol, data);
      this.currentPositions.set(symbol, 0);
      
    } catch (error) {
      logger.error('[HISTORICAL_FEED] Error loading historical data', {
        symbol,
        error: error instanceof Error ? error.message : error
      });
      
      // Fallback to synthetic data
      const syntheticData = this.generateSyntheticHistoricalData(symbol);
      this.historicalData.set(symbol, syntheticData);
      this.currentPositions.set(symbol, 0);
    }
  }

  private normalizeHistoricalData(rawData: any[], symbol: string): HistoricalCandle[] {
    return rawData.map(item => {
      // Handle different data formats
      if (Array.isArray(item)) {
        // OHLCV array format [timestamp, open, high, low, close, volume]
        return {
          timestamp: typeof item[0] === 'string' ? new Date(item[0]).getTime() : item[0],
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5] || 0),
          symbol
        };
      } else {
        // Object format
        return {
          timestamp: typeof item.timestamp === 'string' ? new Date(item.timestamp).getTime() : item.timestamp,
          open: parseFloat(item.open || item.o),
          high: parseFloat(item.high || item.h),
          low: parseFloat(item.low || item.l),
          close: parseFloat(item.close || item.c),
          volume: parseFloat(item.volume || item.v || 0),
          trades: item.trades || item.count,
          symbol
        };
      }
    });
  }

  private generateSyntheticHistoricalData(symbol: string): HistoricalCandle[] {
    const data: HistoricalCandle[] = [];
    const now = Date.now();
    const startTime = now - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    const interval = 60 * 1000; // 1 minute candles
    
    // Base prices for different symbols
    const basePrices: Record<string, number> = {
      'BTC/USDT': 45000,
      'ETH/USDT': 3000,
      'BTC/ETH': 15,
      'USDC/USDT': 1.0001,
      'MATIC/USDT': 0.85
    };
    
    let currentPrice = basePrices[symbol] || 1000 + Math.random() * 49000;
    
    for (let timestamp = startTime; timestamp <= now; timestamp += interval) {
      // Simple random walk
      const change = (Math.random() - 0.5) * 0.002; // ±0.2% max change
      const open = currentPrice;
      const close = currentPrice * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.001);
      const low = Math.min(open, close) * (1 - Math.random() * 0.001);
      const volume = 100 + Math.random() * 900;
      
      data.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
        symbol
      });
      
      currentPrice = close;
    }
    
    return data;
  }

  private calculateTimeRange(): void {
    let minTime = Infinity;
    let maxTime = 0;
    
    for (const data of this.historicalData.values()) {
      if (data.length > 0) {
        minTime = Math.min(minTime, data[0].timestamp);
        maxTime = Math.max(maxTime, data[data.length - 1].timestamp);
      }
    }
    
    this.timeRange = {
      start: minTime === Infinity ? Date.now() - 86400000 : minTime,
      end: maxTime || Date.now()
    };
    
    this.currentTime = this.timeRange.start;
  }

  private findPositionForTimestamp(data: HistoricalCandle[], timestamp: number): number {
    // Binary search for position
    let left = 0;
    let right = data.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (data[mid].timestamp <= timestamp) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    return left;
  }

  private startReplay(): void {
    if (!this.isRunning || this.isPaused) return;
    
    const processNextTick = async () => {
      if (!this.isRunning || this.isPaused) return;
      
      try {
        // Process ticks for all symbols
        for (const symbol of this.config.symbols) {
          const tick = await this.getNextTick(symbol);
          if (tick) {
            this.currentTime = tick.timestamp;
            this.statistics.currentTimestamp = tick.timestamp;
            
            // Notify subscribers
            for (const callback of this.tickCallbacks) {
              callback(tick);
            }
            
            // Check for MEV anomalies
            if (this.config.enableAnomalies) {
              await this.mevEngine.injectRandomMEVActivity(this.config.anomalyFrequency || 0.5);
            }
          }
        }
        
        // Schedule next tick based on replay speed
        const baseInterval = 100; // 100ms base interval
        const actualInterval = baseInterval / this.replaySpeed;
        
        this.replayTimer = setTimeout(processNextTick, actualInterval);
        
      } catch (error) {
        logger.error('[HISTORICAL_FEED] Error in replay loop', error);
        await this.stop();
      }
    };
    
    processNextTick();
  }
} 