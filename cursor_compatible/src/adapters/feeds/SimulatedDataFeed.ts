/**
 * Simulated Data Feed
 * 
 * Generates synthetic market data using advanced mathematical models
 * and market regime simulation for testing strategies under various conditions.
 */

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
import { MarketSimulationEngine, SimulationParameters } from '../simulation/MarketSimulationEngine';
import { MEVSimulationEngine, MEVAttackConfig } from '../simulation/MEVSimulationEngine';
import { logger } from '../../utils/logger';

export interface SimulatedMarketConfig {
  initialPrices: Record<string, number>;
  simulationParameters: Partial<SimulationParameters>;
  mevConfig: Partial<MEVAttackConfig>;
  marketRegimes: {
    enableRegimeChanges: boolean;
    regimeChangeFrequency: number; // hours
  };
  liquidity: {
    baseSpread: number; // 0.001 = 0.1%
    depthMultiplier: number; // Liquidity depth multiplier
    timeOfDayEffects: boolean;
  };
}

export class SimulatedDataFeed implements IDataFeed {
  private feedId: string;
  private config: DataFeedConfig;
  private marketConfig: SimulatedMarketConfig;
  private statistics: DataFeedStatistics;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  
  // Current market state
  private currentPrices: Map<string, number> = new Map();
  private currentVolumes: Map<string, number> = new Map();
  private currentSpreads: Map<string, number> = new Map();
  private priceHistory: Map<string, PriceTick[]> = new Map();
  private candleHistory: Map<string, CandlestickData[]> = new Map();
  
  // Simulation engines
  private marketEngine: MarketSimulationEngine;
  private mevEngine: MEVSimulationEngine;
  
  // Time management
  private currentTime: number;
  private startTime: number;
  private tickInterval: number = 1000; // 1 second base interval
  private replaySpeed: number = 1;
  
  // Event callbacks
  private tickCallbacks: Array<(tick: PriceTick) => void> = [];
  private candleCallbacks: Array<(candle: CandlestickData) => void> = [];
  private orderBookCallbacks: Array<(orderbook: OrderBookSnapshot) => void> = [];
  private anomalyCallbacks: Array<(anomaly: MarketAnomaly) => void> = [];
  
  // Simulation control
  private simulationTimer?: NodeJS.Timeout;
  private candleTimer?: NodeJS.Timeout;
  private anomalyTimer?: NodeJS.Timeout;

  constructor(
    feedId: string = 'simulated_feed',
    marketConfig?: Partial<SimulatedMarketConfig>
  ) {
    this.feedId = feedId;
    this.currentTime = Date.now();
    this.startTime = this.currentTime;
    
    this.config = {
      symbols: ['BTC/USDT', 'ETH/USDT', 'BTC/ETH'],
      replaySpeed: 1,
      enableAnomalies: true,
      anomalyFrequency: 1.0, // 1 per hour
      volatilityMultiplier: 1.0,
      liquidityMultiplier: 1.0
    };
    
    this.marketConfig = {
      initialPrices: {
        'BTC/USDT': 45000,
        'ETH/USDT': 3000,
        'BTC/ETH': 15,
        'USDC/USDT': 1.0001,
        'MATIC/USDT': 0.85
      },
      simulationParameters: {
        volatility: 0.20,
        drift: 0.0,
        meanReversionSpeed: 0.1,
        trendMomentum: 0.3
      },
      mevConfig: {
        sandwichAttackProbability: 0.5,
        frontRunningProbability: 0.8,
        maxSlippageImpact: 0.03,
        maxPriceImpact: 0.01
      },
      marketRegimes: {
        enableRegimeChanges: true,
        regimeChangeFrequency: 2 // Every 2 hours
      },
      liquidity: {
        baseSpread: 0.001, // 0.1%
        depthMultiplier: 1.0,
        timeOfDayEffects: true
      },
      ...marketConfig
    };
    
    this.statistics = {
      feedType: 'simulated',
      ticksProcessed: 0,
      candlesProcessed: 0,
      anomaliesGenerated: 0,
      currentTimestamp: this.currentTime,
      dataLatency: 0,
      isRealTime: true,
      uptime: 0
    };
    
    this.marketEngine = new MarketSimulationEngine(
      this.marketConfig.simulationParameters,
      Date.now()
    );
    
    this.mevEngine = new MEVSimulationEngine(
      this.marketConfig.mevConfig,
      Date.now()
    );
    
    logger.info('[SIMULATED_FEED] Simulated data feed initialized', { 
      feedId,
      symbols: this.config.symbols.length
    });
  }

  getFeedId(): string {
    return this.feedId;
  }

  getFeedType(): 'historical' | 'simulated' | 'hybrid' | 'live_mirror' {
    return 'simulated';
  }

  getConfig(): DataFeedConfig {
    return { ...this.config };
  }

  getStatistics(): DataFeedStatistics {
    this.statistics.uptime = this.isRunning ? Date.now() - this.startTime : 0;
    return { ...this.statistics };
  }

  async initialize(config: DataFeedConfig): Promise<void> {
    this.config = { ...this.config, ...config };
    this.replaySpeed = config.replaySpeed || 1;
    
    // Initialize prices for all symbols
    for (const symbol of this.config.symbols) {
      const initialPrice = this.marketConfig.initialPrices[symbol] || 
                          (1000 + Math.random() * 49000);
      
      this.currentPrices.set(symbol, initialPrice);
      this.currentVolumes.set(symbol, 1000 + Math.random() * 9000);
      this.currentSpreads.set(symbol, initialPrice * this.marketConfig.liquidity.baseSpread);
      this.priceHistory.set(symbol, []);
      this.candleHistory.set(symbol, []);
    }
    
    // Update simulation engines with config
    this.marketEngine.updateParameters({
      volatility: (this.config.volatilityMultiplier || 1.0) * 0.20,
      ...this.marketConfig.simulationParameters
    });
    
    this.mevEngine.updateConfig(this.marketConfig.mevConfig);
    
    logger.info('[SIMULATED_FEED] Initialized with config', {
      symbols: this.config.symbols,
      replaySpeed: this.replaySpeed,
      anomaliesEnabled: this.config.enableAnomalies
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[SIMULATED_FEED] Already running');
      return;
    }
    
    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.statistics.uptime = this.startTime;
    
    this.startSimulation();
    
    logger.info('[SIMULATED_FEED] Started simulation', {
      replaySpeed: this.replaySpeed,
      tickInterval: this.tickInterval / this.replaySpeed
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.isPaused = false;
    
    if (this.simulationTimer) {
      clearTimeout(this.simulationTimer);
      this.simulationTimer = undefined;
    }
    
    if (this.candleTimer) {
      clearTimeout(this.candleTimer);
      this.candleTimer = undefined;
    }
    
    if (this.anomalyTimer) {
      clearTimeout(this.anomalyTimer);
      this.anomalyTimer = undefined;
    }
    
    logger.info('[SIMULATED_FEED] Stopped simulation');
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    
    if (this.simulationTimer) {
      clearTimeout(this.simulationTimer);
      this.simulationTimer = undefined;
    }
    
    logger.info('[SIMULATED_FEED] Paused simulation');
  }

  async resume(): Promise<void> {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.startSimulation();
      logger.info('[SIMULATED_FEED] Resumed simulation');
    }
  }

  async reset(): Promise<void> {
    await this.stop();
    
    // Reset state
    this.currentTime = Date.now();
    this.startTime = this.currentTime;
    this.statistics.ticksProcessed = 0;
    this.statistics.candlesProcessed = 0;
    this.statistics.anomaliesGenerated = 0;
    
    // Reset price history
    for (const symbol of this.config.symbols) {
      this.priceHistory.set(symbol, []);
      this.candleHistory.set(symbol, []);
    }
    
    // Reset simulation engines
    this.marketEngine.reset();
    this.mevEngine.reset();
    
    logger.info('[SIMULATED_FEED] Reset simulation');
  }

  isActive(): boolean {
    return this.isRunning && !this.isPaused;
  }

  setReplaySpeed(speed: number): void {
    this.replaySpeed = Math.max(0.1, Math.min(speed, 1000));
    logger.info('[SIMULATED_FEED] Replay speed changed', { newSpeed: this.replaySpeed });
  }

  async jumpToTime(timestamp: number): Promise<void> {
    // For simulated feed, we can only fast-forward
    if (timestamp < this.currentTime) {
      throw new Error('Cannot jump backwards in simulated feed. Use reset() and replay.');
    }
    
    this.currentTime = timestamp;
    this.statistics.currentTimestamp = timestamp;
    
    logger.info('[SIMULATED_FEED] Jumped to time', { timestamp });
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getTimeRange(): { start: number; end: number } {
    return {
      start: this.startTime,
      end: this.currentTime
    };
  }

  async getNextTick(symbol: string): Promise<PriceTick | null> {
    return this.simulateNextTick(symbol);
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    return this.currentPrices.get(symbol) || 0;
  }

  async getOrderBook(symbol: string): Promise<OrderBookSnapshot> {
    return this.generateOrderBookSnapshot(symbol);
  }

  async getLiquidityMetrics(symbol: string): Promise<LiquidityMetrics> {
    const orderBook = await this.getOrderBook(symbol);
    const currentPrice = await this.getCurrentPrice(symbol);
    
    const bidLiquidity = orderBook.bids.reduce((sum, bid) => sum + bid.quantity, 0);
    const askLiquidity = orderBook.asks.reduce((sum, ask) => sum + ask.quantity, 0);
    const spreadBps = (orderBook.spread / currentPrice) * 10000;
    
    // Apply liquidity multiplier
    const multiplier = this.config.liquidityMultiplier || 1.0;
    
    return {
      symbol,
      timestamp: this.currentTime,
      bidLiquidity: bidLiquidity * multiplier,
      askLiquidity: askLiquidity * multiplier,
      spreadBps,
      depthScore: Math.min(100, (bidLiquidity + askLiquidity) * multiplier / 20),
      volumeProfile: this.currentVolumes.get(symbol) || 0
    };
  }

  async getVolumeEstimate(symbol: string, timeWindow: number): Promise<number> {
    const history = this.priceHistory.get(symbol) || [];
    const windowStart = this.currentTime - timeWindow;
    
    const relevantTicks = history.filter(tick => tick.timestamp >= windowStart);
    return relevantTicks.reduce((sum, tick) => sum + tick.volume, 0);
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number = 100): Promise<CandlestickData[]> {
    const candles = this.candleHistory.get(symbol) || [];
    return candles.slice(-limit).map(candle => ({
      ...candle,
      timeframe
    }));
  }

  async getTickHistory(symbol: string, fromTime: number, toTime: number): Promise<PriceTick[]> {
    const history = this.priceHistory.get(symbol) || [];
    return history.filter(tick => 
      tick.timestamp >= fromTime && tick.timestamp <= toTime
    );
  }

  async simulateNextTick(symbol: string): Promise<PriceTick> {
    const currentPrice = this.currentPrices.get(symbol) || 1000;
    const currentVolume = this.currentVolumes.get(symbol) || 1000;
    
    // Check for MEV impact
    const mevImpact = this.mevEngine.calculateMEVImpact(symbol, 'buy');
    
    // Generate new price with MEV impact
    const basePrice = this.marketEngine.generatePrice(
      currentPrice,
      this.config.volatilityMultiplier || 1.0,
      0 // Trend handled by market engine
    );
    
    const finalPrice = basePrice * (1 + mevImpact.priceImpact);
    
    // Generate volume with time-of-day effects
    const hour = new Date(this.currentTime).getHours();
    const newVolume = this.marketEngine.generateVolume(
      currentVolume,
      hour,
      this.config.volatilityMultiplier || 1.0
    );
    
    // Update current state
    this.currentPrices.set(symbol, finalPrice);
    this.currentVolumes.set(symbol, newVolume);
    
    const tick: PriceTick = {
      symbol,
      timestamp: this.currentTime,
      price: finalPrice,
      volume: newVolume,
      source: 'simulated'
    };
    
    // Add to history
    const history = this.priceHistory.get(symbol) || [];
    history.push(tick);
    
    // Keep only last 10000 ticks
    if (history.length > 10000) {
      history.shift();
    }
    
    this.priceHistory.set(symbol, history);
    this.statistics.ticksProcessed++;
    
    return tick;
  }

  async simulateCandleClose(symbol: string, timeframe: string): Promise<CandlestickData> {
    const history = this.priceHistory.get(symbol) || [];
    const candleHistory = this.candleHistory.get(symbol) || [];
    
    // Get ticks for last candle period (assume 1 minute for now)
    const candlePeriod = 60000; // 1 minute
    const candleStart = this.currentTime - candlePeriod;
    const candleTicks = history.filter(tick => tick.timestamp >= candleStart);
    
    if (candleTicks.length === 0) {
      // No ticks, use current price
      const currentPrice = this.currentPrices.get(symbol) || 0;
      const candle: CandlestickData = {
        symbol,
        timestamp: this.currentTime,
        timeframe,
        open: currentPrice,
        high: currentPrice,
        low: currentPrice,
        close: currentPrice,
        volume: this.currentVolumes.get(symbol) || 0
      };
      
      candleHistory.push(candle);
      this.candleHistory.set(symbol, candleHistory);
      this.statistics.candlesProcessed++;
      
      return candle;
    }
    
    // Calculate OHLCV from ticks
    const open = candleTicks[0].price;
    const close = candleTicks[candleTicks.length - 1].price;
    const high = Math.max(...candleTicks.map(tick => tick.price));
    const low = Math.min(...candleTicks.map(tick => tick.price));
    const volume = candleTicks.reduce((sum, tick) => sum + tick.volume, 0);
    
    const candle: CandlestickData = {
      symbol,
      timestamp: this.currentTime,
      timeframe,
      open,
      high,
      low,
      close,
      volume,
      trades: candleTicks.length
    };
    
    candleHistory.push(candle);
    
    // Keep only last 1000 candles
    if (candleHistory.length > 1000) {
      candleHistory.shift();
    }
    
    this.candleHistory.set(symbol, candleHistory);
    this.statistics.candlesProcessed++;
    
    return candle;
  }

  async generateOrderBookSnapshot(symbol: string): Promise<OrderBookSnapshot> {
    const currentPrice = this.currentPrices.get(symbol) || 1000;
    const currentSpread = this.currentSpreads.get(symbol) || currentPrice * 0.001;
    
    // Check for MEV impact on spread
    const mevImpact = this.mevEngine.calculateMEVImpact(symbol, 'buy');
    const adjustedSpread = currentSpread * (1 + mevImpact.slippageIncrease);
    
    // Generate order book levels
    const bids: Array<{ price: number; quantity: number; orders: number }> = [];
    const asks: Array<{ price: number; quantity: number; orders: number }> = [];
    
    const midPrice = currentPrice;
    const bidPrice = midPrice - adjustedSpread / 2;
    const askPrice = midPrice + adjustedSpread / 2;
    
    // Generate 20 levels on each side
    for (let i = 0; i < 20; i++) {
      const priceStep = adjustedSpread * (i + 1) * 0.5; // Increasing steps
      
      const bidLevel = {
        price: bidPrice - priceStep,
        quantity: this.generateLiquidityAtLevel(i, symbol),
        orders: Math.floor(Math.random() * 5) + 1
      };
      
      const askLevel = {
        price: askPrice + priceStep,
        quantity: this.generateLiquidityAtLevel(i, symbol),
        orders: Math.floor(Math.random() * 5) + 1
      };
      
      bids.push(bidLevel);
      asks.push(askLevel);
    }
    
    // Update spread for next iteration
    const newSpread = this.marketEngine.generateSpread(
      currentSpread,
      this.config.volatilityMultiplier || 1.0,
      this.config.liquidityMultiplier || 1.0
    );
    
    this.currentSpreads.set(symbol, newSpread);
    
    return {
      symbol,
      timestamp: this.currentTime,
      sequenceId: this.statistics.ticksProcessed,
      bids,
      asks,
      spread: adjustedSpread,
      midPrice
    };
  }

  async injectAnomaly(anomaly: MarketAnomaly): Promise<void> {
    this.statistics.anomaliesGenerated++;
    
    // Notify subscribers
    for (const callback of this.anomalyCallbacks) {
      callback(anomaly);
    }
    
    logger.warn('[SIMULATED_FEED] Anomaly injected', {
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
    
    this.currentPrices.clear();
    this.currentVolumes.clear();
    this.currentSpreads.clear();
    this.priceHistory.clear();
    this.candleHistory.clear();
    
    this.tickCallbacks.length = 0;
    this.candleCallbacks.length = 0;
    this.orderBookCallbacks.length = 0;
    this.anomalyCallbacks.length = 0;
    
    logger.info('[SIMULATED_FEED] Cleanup complete');
  }

  // Private methods

  private startSimulation(): void {
    if (!this.isRunning || this.isPaused) return;
    
    const processNextTick = async () => {
      if (!this.isRunning || this.isPaused) return;
      
      try {
        this.currentTime = Date.now();
        this.statistics.currentTimestamp = this.currentTime;
        
        // Generate ticks for all symbols
        for (const symbol of this.config.symbols) {
          const tick = await this.simulateNextTick(symbol);
          
          // Notify subscribers
          for (const callback of this.tickCallbacks) {
            callback(tick);
          }
        }
        
        // Inject MEV activities
        if (this.config.enableAnomalies) {
          await this.mevEngine.injectRandomMEVActivity(this.config.anomalyFrequency || 1.0);
        }
        
        // Schedule next tick
        const actualInterval = this.tickInterval / this.replaySpeed;
        this.simulationTimer = setTimeout(processNextTick, actualInterval);
        
      } catch (error) {
        logger.error('[SIMULATED_FEED] Error in simulation loop', error);
        await this.stop();
      }
    };
    
    // Start candle generation (every minute)
    const candleInterval = () => {
      if (!this.isRunning || this.isPaused) return;
      
      this.config.symbols.forEach(async (symbol) => {
        const candle = await this.simulateCandleClose(symbol, '1m');
        
        // Notify subscribers
        for (const callback of this.candleCallbacks) {
          callback(candle);
        }
      });
      
      this.candleTimer = setTimeout(candleInterval, 60000 / this.replaySpeed);
    };
    
    processNextTick();
    candleInterval();
  }

  private generateLiquidityAtLevel(level: number, symbol: string): number {
    const baseQuantity = 1 + Math.random() * 9; // 1-10 base quantity
    const depthMultiplier = this.marketConfig.liquidity.depthMultiplier;
    const levelMultiplier = 1 + level * 0.2; // More liquidity at deeper levels
    
    return baseQuantity * depthMultiplier * levelMultiplier;
  }

  /**
   * Get market regime information
   */
  getMarketRegime(): any {
    return this.marketEngine.getCurrentRegime();
  }

  /**
   * Get MEV statistics
   */
  getMEVStatistics(): any {
    return this.mevEngine.getStatistics();
  }

  /**
   * Update simulation parameters at runtime
   */
  updateSimulationParameters(params: Partial<SimulationParameters>): void {
    this.marketEngine.updateParameters(params);
    logger.info('[SIMULATED_FEED] Simulation parameters updated', params);
  }

  /**
   * Update MEV configuration at runtime
   */
  updateMEVConfig(config: Partial<MEVAttackConfig>): void {
    this.mevEngine.updateConfig(config);
    logger.info('[SIMULATED_FEED] MEV configuration updated', config);
  }
} 