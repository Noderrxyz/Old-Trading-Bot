/**
 * Replay Engine
 * 
 * Reconstructs and replays historical market periods tick-by-tick from archive data.
 * Enables testing of strategies against real market conditions and events.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';
import { SimulationEngine } from './simulation_engine.js';

/**
 * Replay engine configuration
 */
export interface ReplayEngineConfig {
  enabled: boolean;
  source: string;
  playbackMode: 'real_time' | 'accelerated' | 'step';
  injectFaults: boolean;
  startTime?: number;
  endTime?: number;
  checkIntervalMs: number;
}

/**
 * Default replay engine configuration
 */
export const DEFAULT_REPLAY_ENGINE_CONFIG: ReplayEngineConfig = {
  enabled: true,
  source: '',
  playbackMode: 'real_time',
  injectFaults: false,
  checkIntervalMs: 1000
};

/**
 * Market data point
 */
export interface MarketDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  liquidity: number;
  volatility: number;
  orderBook?: {
    bids: [number, number][];
    asks: [number, number][];
  };
  trades?: {
    price: number;
    size: number;
    side: 'buy' | 'sell';
  }[];
}

/**
 * Replay Engine class
 */
export class ReplayEngine {
  private static instance: ReplayEngine | null = null;
  private config: ReplayEngineConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[ReplayEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[ReplayEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[ReplayEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[ReplayEngine] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private simulationEngine: SimulationEngine;
  private marketData: MarketDataPoint[];
  private currentIndex: number;
  private startTime: number;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): ReplayEngine {
    if (!ReplayEngine.instance) {
      ReplayEngine.instance = new ReplayEngine();
    }
    return ReplayEngine.instance;
  }

  constructor(config: Partial<ReplayEngineConfig> = {}) {
    this.config = { ...DEFAULT_REPLAY_ENGINE_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.simulationEngine = SimulationEngine.getInstance();
    this.marketData = [];
    this.currentIndex = 0;
    this.startTime = 0;
  }

  /**
   * Load market data from source
   */
  public async loadMarketData(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      // TODO: Implement actual data loading from source
      // This is a placeholder for demonstration
      this.marketData = [];
      this.currentIndex = 0;

      this.logger.info(`Loaded market data from ${this.config.source}`);
    } catch (error) {
      this.logger.error(`Failed to load market data: ${error}`);
      throw error;
    }
  }

  /**
   * Start replay
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Replay engine is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Replay engine is already running');
      return;
    }

    if (this.marketData.length === 0) {
      this.logger.error('No market data loaded for replay');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.checkInterval = setInterval(() => this.updateReplay(), this.config.checkIntervalMs);
    this.logger.info('Replay engine started');
  }

  /**
   * Stop replay
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Replay engine stopped');
  }

  /**
   * Update replay state
   */
  private updateReplay(): void {
    if (!this.config.enabled || !this.isRunning) return;

    const elapsedTime = Date.now() - this.startTime;
    const targetIndex = this.calculateTargetIndex(elapsedTime);

    if (targetIndex >= this.marketData.length) {
      this.logger.info('Replay completed - all data processed');
      this.stop();
      return;
    }

    // Update current index and emit data
    this.currentIndex = targetIndex;
    this.emitMarketData();
  }

  /**
   * Calculate target index based on playback mode
   */
  private calculateTargetIndex(elapsedTime: number): number {
    const dataPoint = this.marketData[this.currentIndex];
    const nextDataPoint = this.marketData[this.currentIndex + 1];

    if (!nextDataPoint) return this.currentIndex;

    const timeDiff = nextDataPoint.timestamp - dataPoint.timestamp;
    let targetIndex = this.currentIndex;

    switch (this.config.playbackMode) {
      case 'real_time':
        targetIndex = Math.floor(elapsedTime / timeDiff);
        break;
      case 'accelerated':
        targetIndex = Math.floor(elapsedTime * 5 / timeDiff); // 5x speed
        break;
      case 'step':
        targetIndex = this.currentIndex + 1;
        break;
    }

    return Math.min(targetIndex, this.marketData.length - 1);
  }

  /**
   * Emit current market data
   */
  private emitMarketData(): void {
    const data = this.marketData[this.currentIndex];
    if (!data) return;

    // Convert to simulation format
    const simulationData = {
      timestamp: data.timestamp,
      price: data.price,
      volume: data.volume,
      liquidity: data.liquidity,
      volatility: data.volatility
    };

    // Update simulation engine
    this.simulationEngine.loadMarketData([simulationData]);

    // Emit telemetry event
    this.telemetryEngine.emitSimulationEvent({
      type: 'MARKET_DATA_REPLAY',
      data: {
        ...data,
        index: this.currentIndex,
        total: this.marketData.length
      },
      timestamp: Date.now()
    });

    this.logger.debug(
      `Replayed market data: Time=${new Date(data.timestamp).toISOString()}, ` +
      `Price=${data.price}, Volume=${data.volume}`
    );
  }

  /**
   * Get current replay state
   */
  public getReplayState(): {
    currentIndex: number;
    totalDataPoints: number;
    elapsedTime: number;
    currentData?: MarketDataPoint;
  } {
    return {
      currentIndex: this.currentIndex,
      totalDataPoints: this.marketData.length,
      elapsedTime: Date.now() - this.startTime,
      currentData: this.marketData[this.currentIndex]
    };
  }

  /**
   * Reset replay engine
   */
  public reset(): void {
    this.marketData = [];
    this.currentIndex = 0;
    this.startTime = 0;
    this.logger.info('Replay engine reset');
  }
} 