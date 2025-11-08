/**
 * Trading Strategy
 * 
 * Represents a trading strategy with its parameters and performance metrics.
 */

import { MarketDataPoint } from '../market/types/market.types.js';

/**
 * Strategy parameters
 */
export interface StrategyParameters {
  aggression: number;        // 0.0-1.0
  defense: number;           // 0.0-1.0
  riskTolerance: number;     // 0.0-1.0
  adaptability: number;      // 0.0-1.0
  volatilityTolerance: number; // 0.0-1.0
  maxPositionSize: number;   // Base currency
  maxOpenPositions: number;
  stopLossPct: number;       // 0.0-1.0
  takeProfitPct: number;     // 0.0-1.0
}

/**
 * Strategy performance metrics
 */
export interface StrategyMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  roi: number;              // Return on Investment as a decimal (e.g., 0.1 for 10%)
  lastUpdate: number;
}

/**
 * Trading Strategy class
 */
export class TradingStrategy {
  public readonly id: string;
  public parameters: StrategyParameters;
  public metrics: StrategyMetrics;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => console.debug(`[TradingStrategy] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => console.info(`[TradingStrategy] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[TradingStrategy] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`[TradingStrategy] ${msg}`, ...args)
  };

  constructor(id: string, parameters: Partial<StrategyParameters> = {}) {
    this.id = id;
    this.parameters = {
      aggression: 0.5,
      defense: 0.5,
      riskTolerance: 0.5,
      adaptability: 0.5,
      volatilityTolerance: 0.5,
      maxPositionSize: 1000,
      maxOpenPositions: 3,
      stopLossPct: 0.02,
      takeProfitPct: 0.04,
      ...parameters
    };
    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      roi: 0,
      lastUpdate: Date.now()
    };
  }

  /**
   * Update strategy metrics
   */
  public updateMetrics(newMetrics: Partial<StrategyMetrics>): void {
    this.metrics = {
      ...this.metrics,
      ...newMetrics,
      lastUpdate: Date.now()
    };
    this.logger.debug(`Updated metrics for strategy ${this.id}`);
  }

  /**
   * Evaluate market data and generate trading signals
   */
  public evaluateMarketData(data: MarketDataPoint): {
    signal: 'buy' | 'sell' | 'hold';
    confidence: number;
    positionSize: number;
  } {
    // TODO: Implement strategy-specific market evaluation logic
    return {
      signal: 'hold',
      confidence: 0,
      positionSize: 0
    };
  }

  /**
   * Clone the strategy
   */
  public clone(): TradingStrategy {
    const clone = new TradingStrategy(this.id, { ...this.parameters });
    clone.updateMetrics({ ...this.metrics });
    return clone;
  }

  /**
   * Reset strategy state
   */
  public reset(): void {
    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      roi: 0,
      lastUpdate: Date.now()
    };
    this.logger.info(`Reset strategy ${this.id}`);
  }
} 