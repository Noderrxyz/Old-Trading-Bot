import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Trade sizer configuration
 */
interface TradeSizerConfig {
  baseSize: number;
  maxVolatilityThreshold: number;
  volatilityWindowSize: number;
  minSizeFactor: number;
  maxSizeFactor: number;
  logFilePath: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TradeSizerConfig = {
  baseSize: 1.0,
  maxVolatilityThreshold: 0.05, // 5% volatility threshold
  volatilityWindowSize: 300, // 5 minutes in seconds
  minSizeFactor: 0.1,
  maxSizeFactor: 1.0,
  logFilePath: 'logs/risk/trade_sizing.jsonl'
};

/**
 * Trade sizer state
 */
interface TradeSizerState {
  symbol: string;
  recentReturns: number[];
  currentVolatility: number;
  lastUpdateTime: number;
}

/**
 * Dynamic Trade Sizer
 */
export class DynamicTradeSizer {
  private static instance: DynamicTradeSizer;
  private config: TradeSizerConfig;
  private telemetryBus: TelemetryBus;
  private states: Map<string, TradeSizerState>;
  private logStream: fs.WriteStream;

  private constructor(config: Partial<TradeSizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.states = new Map();
    this.setupLogging();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<TradeSizerConfig>): DynamicTradeSizer {
    if (!DynamicTradeSizer.instance) {
      DynamicTradeSizer.instance = new DynamicTradeSizer(config);
    }
    return DynamicTradeSizer.instance;
  }

  /**
   * Setup logging
   */
  private setupLogging(): void {
    const logDir = path.dirname(this.config.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logStream = fs.createWriteStream(this.config.logFilePath, { flags: 'a' });
  }

  /**
   * Calculate position size
   */
  public calculatePositionSize(symbol: string, baseSize: number): number {
    const state = this.getOrCreateState(symbol);
    const volatilityFactor = this.calculateVolatilityFactor(state.currentVolatility);
    const sizeFactor = Math.max(
      this.config.minSizeFactor,
      Math.min(this.config.maxSizeFactor, 1 - volatilityFactor)
    );

    const size = baseSize * sizeFactor;

    this.logSizing(symbol, {
      baseSize,
      sizeFactor,
      finalSize: size,
      volatility: state.currentVolatility
    });

    return size;
  }

  /**
   * Update volatility
   */
  public updateVolatility(symbol: string, price: number, timestamp: number): void {
    const state = this.getOrCreateState(symbol);

    // Calculate return
    if (state.recentReturns.length > 0) {
      const lastPrice = state.recentReturns[state.recentReturns.length - 1];
      const returns = (price - lastPrice) / lastPrice;
      state.recentReturns.push(returns);
    } else {
      state.recentReturns.push(0);
    }

    // Trim returns array
    if (state.recentReturns.length > this.config.volatilityWindowSize) {
      state.recentReturns.shift();
    }

    // Calculate volatility
    state.currentVolatility = this.calculateVolatility(state.recentReturns);
    state.lastUpdateTime = timestamp;

    this.telemetryBus.emit('volatility_update', {
      symbol,
      volatility: state.currentVolatility,
      timestamp
    });
  }

  /**
   * Get or create state
   */
  private getOrCreateState(symbol: string): TradeSizerState {
    let state = this.states.get(symbol);
    if (!state) {
      state = {
        symbol,
        recentReturns: [],
        currentVolatility: 0,
        lastUpdateTime: Date.now()
      };
      this.states.set(symbol, state);
    }
    return state;
  }

  /**
   * Calculate volatility
   */
  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Calculate volatility factor
   */
  private calculateVolatilityFactor(volatility: number): number {
    return Math.min(1, volatility / this.config.maxVolatilityThreshold);
  }

  /**
   * Log sizing
   */
  private logSizing(symbol: string, data: {
    baseSize: number;
    sizeFactor: number;
    finalSize: number;
    volatility: number;
  }): void {
    const logEntry = {
      timestamp: Date.now(),
      symbol,
      ...data
    };

    this.logStream.write(JSON.stringify(logEntry) + '\n');
    logger.info(`[DynamicTradeSizer] ${symbol}: ${data.finalSize.toFixed(4)} (vol: ${(data.volatility * 100).toFixed(2)}%)`);
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.logStream.end();
  }
} 