import WebSocket from 'ws';
import { MarketSnapshot, FeedConfig } from '../../types/MarketSnapshot.types.js';
import { FeedBus } from '../publishers/FeedBus.js';
import logger from '../../utils/logger.js';

interface BinanceTrade {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price
  q: string; // Quantity
  m: boolean; // Is maker
  M: boolean; // Ignore
}

export class BinanceFeed {
  private ws: WebSocket | null;
  private feedBus: FeedBus;
  private config: FeedConfig;
  private isRunning: boolean;
  private reconnectAttempts: number;
  private lastPingTime: number;

  constructor(config: FeedConfig) {
    if (!config.wsUrl) {
      throw new Error('WebSocket URL is required for Binance feed');
    }

    this.config = config;
    this.ws = null;
    this.feedBus = FeedBus.getInstance();
    this.isRunning = false;
    this.reconnectAttempts = 0;
    this.lastPingTime = Date.now();
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Binance feed is already running');
      return;
    }

    this.isRunning = true;
    await this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    try {
      const symbol = this.config.symbol.toLowerCase();
      const wsUrl = `${this.config.wsUrl}/${symbol}@aggTrade`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        logger.info(`Binance WebSocket connected for ${symbol}`);
        this.reconnectAttempts = 0;
        this.startPingInterval();
      });

      this.ws.on('message', (data: string) => {
        try {
          const trade: BinanceTrade = JSON.parse(data);
          this.handleTrade(trade);
        } catch (error) {
          logger.error('Error parsing Binance trade data:', error);
        }
      });

      this.ws.on('close', () => {
        logger.warn('Binance WebSocket closed');
        this.handleReconnect();
      });

      this.ws.on('error', (error) => {
        logger.error('Binance WebSocket error:', error);
        this.handleReconnect();
      });
    } catch (error) {
      logger.error('Error connecting to Binance WebSocket:', error);
      this.handleReconnect();
    }
  }

  private handleReconnect(): void {
    if (!this.isRunning) return;

    const maxAttempts = this.config.maxRetries || 5;
    const delay = this.config.retryDelayMs || 5000;

    if (this.reconnectAttempts < maxAttempts) {
      this.reconnectAttempts++;
      logger.info(`Attempting to reconnect to Binance (attempt ${this.reconnectAttempts}/${maxAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      logger.error('Max reconnection attempts reached for Binance feed');
      this.stop();
    }
  }

  private startPingInterval(): void {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.lastPingTime = Date.now();
      }
    }, 30000); // Ping every 30 seconds
  }

  private handleTrade(trade: BinanceTrade): void {
    try {
      const snapshot: MarketSnapshot = {
        source: 'binance',
        symbol: this.config.symbol,
        timestamp: trade.E,
        lastPrice: parseFloat(trade.p),
        lastSize: parseFloat(trade.q),
        latencyMs: Date.now() - trade.E
      };

      this.feedBus.publish(snapshot);
    } catch (error) {
      logger.error('Error handling Binance trade:', error);
    }
  }
} 