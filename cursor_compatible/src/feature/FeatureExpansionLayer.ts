import { createLogger } from '../common/logger.js';
import { 
  MarketFrame, 
  ExpandedFeatureFrame, 
  FeatureExpansionConfig,
  DEFAULT_FEATURE_EXPANSION_CONFIG 
} from './types/feature.types.js';

/**
 * Engine for expanding raw market data into rich features
 */
export class FeatureExpansionLayer {
  private readonly logger = createLogger('FeatureExpansionLayer');
  
  // Market data history by symbol
  private readonly marketHistory: Map<string, MarketFrame[]> = new Map();
  
  // Feature computation history by symbol
  private readonly featureHistory: Map<string, ExpandedFeatureFrame[]> = new Map();
  
  constructor(
    private readonly config: FeatureExpansionConfig = DEFAULT_FEATURE_EXPANSION_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Feature expansion is disabled');
    }
  }
  
  /**
   * Add raw market data
   * @param marketData Market data frame
   */
  public addRawMarketData(marketData: MarketFrame): void {
    if (!this.config.enabled) return;
    
    try {
      // Get or create symbol history
      let symbolHistory = this.marketHistory.get(marketData.symbol);
      if (!symbolHistory) {
        symbolHistory = [];
        this.marketHistory.set(marketData.symbol, symbolHistory);
      }
      
      // Add market data to history
      symbolHistory.push(marketData);
      
      // Trim history to window size
      if (symbolHistory.length > this.config.rollingWindow) {
        symbolHistory.shift();
      }
      
      this.logger.debug(`Added market data for ${marketData.symbol}`);
    } catch (error) {
      this.logger.error(`Error adding market data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Compute expanded features
   * @param symbol Asset symbol
   * @returns Expanded feature frame
   */
  public computeExpandedFeatures(symbol: string): ExpandedFeatureFrame | null {
    if (!this.config.enabled) return null;
    
    try {
      const marketHistory = this.marketHistory.get(symbol);
      if (!marketHistory || marketHistory.length < this.config.parameters.minSamples) {
        this.logger.debug(`Insufficient market data for ${symbol}`);
        return null;
      }
      
      const startTime = Date.now();
      
      // Compute features
      const features = {
        vwapDeviation: this.computeVWAPDeviation(marketHistory),
        avgTradeSize: this.computeAverageTradeSize(marketHistory),
        spreadVolatility: this.computeSpreadVolatility(marketHistory),
        volumeSpikeRatio: this.computeVolumeSpikeRatio(marketHistory),
        orderbookImbalance: this.computeOrderbookImbalance(marketHistory),
        rollingSkewness: this.computeRollingSkewness(marketHistory),
        rollingKurtosis: this.computeRollingKurtosis(marketHistory),
        microstructureVolatility: this.computeMicrostructureVolatility(marketHistory),
        tradeFlowImbalance: this.computeTradeFlowImbalance(marketHistory),
        hiddenLiquiditySignature: this.computeHiddenLiquiditySignature(marketHistory)
      };
      
      // Create feature frame
      const frame: ExpandedFeatureFrame = {
        symbol,
        timestamp: Date.now(),
        features,
        metadata: {
          sampleCount: marketHistory.length,
          windowSize: this.config.rollingWindow,
          computationTime: Date.now() - startTime
        }
      };
      
      // Update feature history
      let featureHistory = this.featureHistory.get(symbol);
      if (!featureHistory) {
        featureHistory = [];
        this.featureHistory.set(symbol, featureHistory);
      }
      
      featureHistory.push(frame);
      if (featureHistory.length > this.config.rollingWindow) {
        featureHistory.shift();
      }
      
      return frame;
    } catch (error) {
      this.logger.error(`Error computing features: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Compute VWAP deviation
   */
  private computeVWAPDeviation(history: MarketFrame[]): number {
    const window = Math.min(history.length, this.config.parameters.vwapWindow);
    const recentHistory = history.slice(-window);
    
    let totalVolume = 0;
    let totalPriceVolume = 0;
    
    for (const frame of recentHistory) {
      const volume = frame.volume.total;
      const price = frame.price.close;
      
      totalVolume += volume;
      totalPriceVolume += price * volume;
    }
    
    const vwap = totalVolume > 0 ? totalPriceVolume / totalVolume : 0;
    const currentPrice = history[history.length - 1].price.close;
    
    return vwap > 0 ? (currentPrice - vwap) / vwap : 0;
  }
  
  /**
   * Compute average trade size
   */
  private computeAverageTradeSize(history: MarketFrame[]): number {
    const recentHistory = history.slice(-this.config.parameters.tradeFlowWindow);
    let totalSize = 0;
    let tradeCount = 0;
    
    for (const frame of recentHistory) {
      for (const trade of frame.trades) {
        totalSize += trade.size;
        tradeCount++;
      }
    }
    
    return tradeCount > 0 ? totalSize / tradeCount : 0;
  }
  
  /**
   * Compute spread volatility
   */
  private computeSpreadVolatility(history: MarketFrame[]): number {
    const spreads = history.map(frame => {
      const bestBid = frame.orderbook.bids[0]?.[0] || 0;
      const bestAsk = frame.orderbook.asks[0]?.[0] || 0;
      return bestAsk - bestBid;
    });
    
    return this.computeStandardDeviation(spreads);
  }
  
  /**
   * Compute volume spike ratio
   */
  private computeVolumeSpikeRatio(history: MarketFrame[]): number {
    const volumes = history.map(frame => frame.volume.total);
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    
    return avgVolume > 0 ? currentVolume / avgVolume : 0;
  }
  
  /**
   * Compute order book imbalance
   */
  private computeOrderbookImbalance(history: MarketFrame[]): number {
    const frame = history[history.length - 1];
    const levels = this.config.parameters.orderbookLevels;
    
    const bidVolume = frame.orderbook.bids
      .slice(0, levels)
      .reduce((sum, [_, size]) => sum + size, 0);
      
    const askVolume = frame.orderbook.asks
      .slice(0, levels)
      .reduce((sum, [_, size]) => sum + size, 0);
      
    const totalVolume = bidVolume + askVolume;
    return totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;
  }
  
  /**
   * Compute rolling skewness
   */
  private computeRollingSkewness(history: MarketFrame[]): number {
    const returns = this.computeReturns(history);
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = this.computeStandardDeviation(returns);
    
    if (stdDev === 0) return 0;
    
    const skewness = returns.reduce((sum, r) => {
      const deviation = r - mean;
      return sum + Math.pow(deviation / stdDev, 3);
    }, 0) / returns.length;
    
    return skewness;
  }
  
  /**
   * Compute rolling kurtosis
   */
  private computeRollingKurtosis(history: MarketFrame[]): number {
    const returns = this.computeReturns(history);
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = this.computeStandardDeviation(returns);
    
    if (stdDev === 0) return 0;
    
    const kurtosis = returns.reduce((sum, r) => {
      const deviation = r - mean;
      return sum + Math.pow(deviation / stdDev, 4);
    }, 0) / returns.length;
    
    return kurtosis - 3; // Excess kurtosis
  }
  
  /**
   * Compute microstructure volatility
   */
  private computeMicrostructureVolatility(history: MarketFrame[]): number {
    const recentHistory = history.slice(-this.config.parameters.tradeFlowWindow);
    const priceChanges = [];
    
    for (let i = 1; i < recentHistory.length; i++) {
      const prevPrice = recentHistory[i-1].price.close;
      const currPrice = recentHistory[i].price.close;
      priceChanges.push(Math.abs(currPrice - prevPrice) / prevPrice);
    }
    
    return this.computeStandardDeviation(priceChanges);
  }
  
  /**
   * Compute trade flow imbalance
   */
  private computeTradeFlowImbalance(history: MarketFrame[]): number {
    const recentHistory = history.slice(-this.config.parameters.tradeFlowWindow);
    let buyVolume = 0;
    let sellVolume = 0;
    
    for (const frame of recentHistory) {
      for (const trade of frame.trades) {
        if (trade.side === 'buy') {
          buyVolume += trade.size;
        } else {
          sellVolume += trade.size;
        }
      }
    }
    
    const totalVolume = buyVolume + sellVolume;
    return totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;
  }
  
  /**
   * Compute hidden liquidity signature
   */
  private computeHiddenLiquiditySignature(history: MarketFrame[]): number {
    const recentHistory = history.slice(-this.config.parameters.tradeFlowWindow);
    let largeTrades = 0;
    let totalTrades = 0;
    
    for (const frame of recentHistory) {
      for (const trade of frame.trades) {
        totalTrades++;
        if (trade.size > this.computeAverageTradeSize(history) * 2) {
          largeTrades++;
        }
      }
    }
    
    return totalTrades > 0 ? largeTrades / totalTrades : 0;
  }
  
  /**
   * Compute returns
   */
  private computeReturns(history: MarketFrame[]): number[] {
    const returns = [];
    for (let i = 1; i < history.length; i++) {
      const prevPrice = history[i-1].price.close;
      const currPrice = history[i].price.close;
      returns.push((currPrice - prevPrice) / prevPrice);
    }
    return returns;
  }
  
  /**
   * Compute standard deviation
   */
  private computeStandardDeviation(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
} 