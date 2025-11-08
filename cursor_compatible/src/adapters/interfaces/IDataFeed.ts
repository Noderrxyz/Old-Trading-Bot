/**
 * Data Feed Interface for Paper Mode Phase 3
 * 
 * Provides abstraction for different data sources to power realistic
 * backtesting and continuous paper trading with real-world fidelity.
 */

export interface PriceTick {
  symbol: string;
  timestamp: number;
  price: number;
  volume: number;
  side?: 'buy' | 'sell';
  source: string;
}

export interface CandlestickData {
  symbol: string;
  timestamp: number;
  timeframe: string; // '1m', '5m', '1h', '1d', etc.
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  timestamp: number;
  sequenceId: number;
  bids: Array<{ price: number; quantity: number; orders?: number }>;
  asks: Array<{ price: number; quantity: number; orders?: number }>;
  spread: number;
  midPrice: number;
}

export interface LiquidityMetrics {
  symbol: string;
  timestamp: number;
  bidLiquidity: number; // Total bid volume
  askLiquidity: number; // Total ask volume
  spreadBps: number; // Spread in basis points
  depthScore: number; // Liquidity depth score (0-100)
  volumeProfile: number; // Expected volume for time period
}

export interface MarketAnomaly {
  type: 'mev_sandwich' | 'mev_frontrun' | 'spread_spike' | 'liquidity_drain' | 'flash_crash' | 'pump_dump';
  severity: 'low' | 'medium' | 'high' | 'extreme';
  timestamp: number;
  duration: number; // milliseconds
  affectedSymbols: string[];
  parameters: Record<string, any>;
  description: string;
}

export interface DataFeedConfig {
  symbols: string[];
  startTime?: number;
  endTime?: number;
  timeframe?: string;
  replaySpeed?: number; // 1x, 10x, 100x, etc.
  enableAnomalies?: boolean;
  anomalyFrequency?: number; // per hour
  volatilityMultiplier?: number;
  liquidityMultiplier?: number;
}

export interface DataFeedStatistics {
  feedType: string;
  ticksProcessed: number;
  candlesProcessed: number;
  anomaliesGenerated: number;
  currentTimestamp: number;
  dataLatency: number;
  isRealTime: boolean;
  uptime: number;
}

/**
 * Main Data Feed Interface
 */
export interface IDataFeed {
  /**
   * Feed identification and configuration
   */
  getFeedId(): string;
  getFeedType(): 'historical' | 'simulated' | 'hybrid' | 'live_mirror';
  getConfig(): DataFeedConfig;
  getStatistics(): DataFeedStatistics;
  
  /**
   * Lifecycle management
   */
  initialize(config: DataFeedConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  isActive(): boolean;
  
  /**
   * Time control (for historical/simulated feeds)
   */
  setReplaySpeed(speed: number): void;
  jumpToTime(timestamp: number): Promise<void>;
  getCurrentTime(): number;
  getTimeRange(): { start: number; end: number };
  
  /**
   * Data retrieval
   */
  getNextTick(symbol: string): Promise<PriceTick | null>;
  getCurrentPrice(symbol: string): Promise<number>;
  getOrderBook(symbol: string): Promise<OrderBookSnapshot>;
  getLiquidityMetrics(symbol: string): Promise<LiquidityMetrics>;
  getVolumeEstimate(symbol: string, timeWindow: number): Promise<number>;
  
  /**
   * Historical data access
   */
  getCandlesticks(symbol: string, timeframe: string, limit?: number): Promise<CandlestickData[]>;
  getTickHistory(symbol: string, fromTime: number, toTime: number): Promise<PriceTick[]>;
  
  /**
   * Market simulation (for simulated feeds)
   */
  simulateNextTick(symbol: string): Promise<PriceTick>;
  simulateCandleClose(symbol: string, timeframe: string): Promise<CandlestickData>;
  generateOrderBookSnapshot(symbol: string): Promise<OrderBookSnapshot>;
  injectAnomaly(anomaly: MarketAnomaly): Promise<void>;
  
  /**
   * Event subscriptions
   */
  onTick?(callback: (tick: PriceTick) => void): void;
  onCandle?(callback: (candle: CandlestickData) => void): void;
  onOrderBookUpdate?(callback: (orderbook: OrderBookSnapshot) => void): void;
  onAnomaly?(callback: (anomaly: MarketAnomaly) => void): void;
  
  /**
   * Cleanup
   */
  cleanup(): Promise<void>;
}

/**
 * Data Feed Factory Interface
 */
export interface IDataFeedFactory {
  createHistoricalFeed(source: string, config: DataFeedConfig): Promise<IDataFeed>;
  createSimulatedFeed(config: DataFeedConfig): Promise<IDataFeed>;
  createHybridFeed(historicalSource: string, config: DataFeedConfig): Promise<IDataFeed>;
  createLiveMirrorFeed(config: DataFeedConfig): Promise<IDataFeed>;
}

/**
 * Market Simulation Engine Interface
 */
export interface IMarketSimulationEngine {
  generatePrice(currentPrice: number, volatility: number, trend: number): number;
  generateVolume(baseVolume: number, timeOfDay: number, volatility: number): number;
  generateSpread(baseSpread: number, volatility: number, liquidity: number): number;
  simulateBrownianMotion(price: number, volatility: number, dt: number): number;
  simulateVolatilityBurst(price: number, burstIntensity: number): number;
  simulateTrendFollowing(price: number, momentum: number, strength: number): number;
  simulateMeanReversion(price: number, meanPrice: number, reversionSpeed: number): number;
}

/**
 * MEV Simulation Engine Interface
 */
export interface IMEVSimulationEngine {
  simulateSandwichAttack(symbol: string, targetTrade: any): Promise<MarketAnomaly>;
  simulateFrontRunning(symbol: string, anticipatedTrade: any): Promise<MarketAnomaly>;
  simulateFlashLoan(symbol: string, loanAmount: number): Promise<MarketAnomaly>;
  simulateArbitrageOpportunity(symbol: string, exchanges: string[]): Promise<MarketAnomaly>;
  injectRandomMEVActivity(frequency: number): Promise<void>;
} 