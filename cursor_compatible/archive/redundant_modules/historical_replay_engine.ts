/**
 * Historical Replay Engine
 * 
 * Replays actual market data tick-by-tick, including trades,
 * liquidity changes, and order book updates.
 */

import { logger } from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';
import { MarketMetrics } from '../market/types/market.types.js';

/**
 * Configuration for historical replay
 */
export interface HistoricalReplayConfig {
  enabled: boolean;
  source: string;  // Path to historical data
  startTime: number;  // Unix timestamp
  endTime: number;  // Unix timestamp
  playbackSpeed: number;  // 1.0 = real-time, 2.0 = 2x speed, etc.
  injectFaults: boolean;  // Whether to inject simulated faults
  faultProbability: number;  // Probability of fault per time step
  checkIntervalMs: number;  // How often to check for new data
}

const DEFAULT_CONFIG: HistoricalReplayConfig = {
  enabled: true,
  source: './data/historical',
  startTime: 0,
  endTime: Date.now(),
  playbackSpeed: 1.0,
  injectFaults: false,
  faultProbability: 0.01,
  checkIntervalMs: 1000
};

/**
 * Market data point
 */
interface MarketDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  liquidity: number;
  volatility: number;
  orderBook?: {
    bids: [number, number][];  // [price, size]
    asks: [number, number][];
  };
  trades?: {
    price: number;
    size: number;
    side: 'buy' | 'sell';
  }[];
  gasPrice?: number;
}

/**
 * Historical Replay Engine
 */
export class HistoricalReplayEngine {
  private static instance: HistoricalReplayEngine | null = null;
  private config: HistoricalReplayConfig;
  private telemetryEngine: ExecutionTelemetryEngine;
  private dataPoints: Map<string, MarketDataPoint[]>;
  private currentIndex: Map<string, number>;
  private startTime: Map<string, number>;
  private updateInterval: NodeJS.Timeout | null;
  private isRunning: boolean;

  /**
   * Get singleton instance
   */
  public static getInstance(): HistoricalReplayEngine {
    if (!HistoricalReplayEngine.instance) {
      HistoricalReplayEngine.instance = new HistoricalReplayEngine();
    }
    return HistoricalReplayEngine.instance;
  }

  constructor(config: Partial<HistoricalReplayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.dataPoints = new Map();
    this.currentIndex = new Map();
    this.startTime = new Map();
    this.updateInterval = null;
    this.isRunning = false;
  }

  /**
   * Load historical data for a symbol
   */
  public async loadData(symbol: string): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Historical replay is disabled');
    }

    try {
      // TODO: Load data from source
      // For now, using placeholder data
      const data: MarketDataPoint[] = [];
      this.dataPoints.set(symbol, data);
      this.currentIndex.set(symbol, 0);
      this.startTime.set(symbol, Date.now());

      logger.info(`Loaded historical data for ${symbol}`);
    } catch (error) {
      logger.error(`Failed to load historical data for ${symbol}: ${error}`);
      throw error;
    }
  }

  /**
   * Start replaying historical data
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Historical replay engine already running');
      return;
    }

    this.updateInterval = setInterval(() => {
      this.updateReplay();
    }, this.config.checkIntervalMs);

    this.isRunning = true;
    logger.info('Started historical replay engine');
  }

  /**
   * Stop replaying historical data
   */
  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    logger.info('Stopped historical replay engine');
  }

  /**
   * Update replay state
   */
  private updateReplay(): void {
    if (!this.config.enabled) return;

    const now = Date.now();
    for (const [symbol, data] of this.dataPoints.entries()) {
      const startTime = this.startTime.get(symbol) || 0;
      const currentIndex = this.currentIndex.get(symbol) || 0;
      const elapsedTime = (now - startTime) * this.config.playbackSpeed;

      // Find the next data point to emit
      let nextIndex = currentIndex;
      while (nextIndex < data.length && 
             data[nextIndex].timestamp - data[0].timestamp <= elapsedTime) {
        nextIndex++;
      }

      if (nextIndex > currentIndex) {
        // Emit new data points
        for (let i = currentIndex; i < nextIndex; i++) {
          const point = data[i];
          let marketData = this.createMarketData(point);

          // Inject faults if enabled
          if (this.config.injectFaults && Math.random() < this.config.faultProbability) {
            marketData = this.injectFault(marketData);
          }

          // Emit telemetry
          this.telemetryEngine.emitSimulationEvent({
            type: 'MARKET_DATA_REPLAY',
            symbol,
            data: marketData,
            timestamp: point.timestamp
          });
        }

        this.currentIndex.set(symbol, nextIndex);
      }

      // Check if replay is complete
      if (nextIndex >= data.length) {
        logger.info(`Historical replay complete for ${symbol}`);
        this.dataPoints.delete(symbol);
        this.currentIndex.delete(symbol);
        this.startTime.delete(symbol);
      }
    }
  }

  /**
   * Create market data from data point
   */
  private createMarketData(point: MarketDataPoint): MarketMetrics {
    return {
      price: point.price,
      volume: point.volume,
      volatility: point.volatility,
      liquidity: point.liquidity,
      trend: 0,  // To be calculated
      momentum: 0,  // To be calculated
      regimeState: 'Unknown',  // To be determined
      regimeConfidence: 0  // To be calculated
    };
  }

  /**
   * Inject simulated fault into market data
   */
  private injectFault(data: MarketMetrics): MarketMetrics {
    const faultType = Math.floor(Math.random() * 4);
    const severity = 0.1 + Math.random() * 0.9;  // 10% to 100% severity

    switch (faultType) {
      case 0:  // Price spike
        data.price *= (1 + severity);
        break;
      case 1:  // Volume anomaly
        data.volume *= (1 + severity);
        break;
      case 2:  // Liquidity drop
        data.liquidity *= (1 - severity);
        break;
      case 3:  // Volatility spike
        data.volatility *= (1 + severity);
        break;
    }

    return data;
  }

  /**
   * Reset replay state for a symbol
   */
  public reset(symbol: string): void {
    this.currentIndex.set(symbol, 0);
    this.startTime.set(symbol, Date.now());
    logger.info(`Reset historical replay for ${symbol}`);
  }
} 