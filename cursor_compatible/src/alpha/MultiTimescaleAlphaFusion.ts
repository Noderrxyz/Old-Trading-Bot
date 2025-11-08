import { AlphaFrame } from '../alphasources/types.js';
import { 
  Timescale, 
  MultiTimescaleConfig, 
  MultiTimescaleAlphaFrame, 
  TimescalePerformance,
  DEFAULT_MULTI_TIMESCALE_CONFIG 
} from './types/multi_timescale.types.js';
import { createLogger } from '../common/logger.js';

/**
 * Engine for fusing alpha signals across multiple timescales
 */
export class MultiTimescaleAlphaFusion {
  private readonly logger = createLogger('MultiTimescaleAlphaFusion');
  
  // Signal history by timescale and symbol
  private readonly signalHistory: Map<string, Map<Timescale, AlphaFrame[]>> = new Map();
  
  // Performance metrics by timescale and symbol
  private readonly performanceMetrics: Map<string, Map<Timescale, TimescalePerformance>> = new Map();
  
  constructor(
    private readonly config: MultiTimescaleConfig = DEFAULT_MULTI_TIMESCALE_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Multi-timescale fusion is disabled');
    }
  }
  
  /**
   * Add a new alpha frame for a specific timescale
   * @param timescale Timescale category
   * @param frame Alpha frame to add
   */
  public addTimescaleFrame(timescale: Timescale, frame: AlphaFrame): void {
    if (!this.config.enabled) return;
    
    try {
      // Get or create symbol history
      let symbolHistory = this.signalHistory.get(frame.symbol);
      if (!symbolHistory) {
        symbolHistory = new Map();
        this.signalHistory.set(frame.symbol, symbolHistory);
      }
      
      // Get or create timescale history
      let timescaleHistory = symbolHistory.get(timescale);
      if (!timescaleHistory) {
        timescaleHistory = [];
        symbolHistory.set(timescale, timescaleHistory);
      }
      
      // Add frame to history
      timescaleHistory.push(frame);
      
      // Trim history to window size
      if (timescaleHistory.length > this.config.recentPerformanceWindow) {
        timescaleHistory.shift();
      }
      
      // Update performance metrics
      this.updatePerformanceMetrics(frame.symbol, timescale);
      
      this.logger.debug(`Added ${timescale} frame for ${frame.symbol}`);
    } catch (error) {
      this.logger.error(`Error adding timescale frame: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Fuse signals across timescales for a symbol
   * @param symbol Asset symbol to fuse
   * @returns Fused alpha frame
   */
  public fuse(symbol: string): MultiTimescaleAlphaFrame | null {
    if (!this.config.enabled) return null;
    
    try {
      const symbolHistory = this.signalHistory.get(symbol);
      if (!symbolHistory) {
        this.logger.debug(`No history found for ${symbol}`);
        return null;
      }
      
      // Check if we have enough signals
      const hasEnoughSignals = Array.from(symbolHistory.entries()).every(
        ([_, history]) => history.length >= this.config.minSignalsPerTimescale
      );
      
      if (!hasEnoughSignals) {
        this.logger.debug(`Insufficient signals for ${symbol}`);
        return null;
      }
      
      // Calculate weights based on performance and volatility
      const weights = this.calculateWeights(symbol);
      
      // Calculate fused score
      const fusedScore = this.calculateFusedScore(symbol, weights);
      
      // Get performance metrics
      const performance = this.performanceMetrics.get(symbol) || new Map();
      
      // Create fused frame
      const frame: MultiTimescaleAlphaFrame = {
        symbol,
        fusedScore,
        contributions: Object.fromEntries(
          Object.values(Timescale).map(ts => [ts, weights[ts]])
        ) as Record<Timescale, number>,
        performance: Object.fromEntries(performance.entries()) as Record<Timescale, TimescalePerformance>,
        timestamp: Date.now(),
        metadata: {
          volatilityRegime: this.determineVolatilityRegime(symbol),
          trendStrength: this.calculateTrendStrength(symbol),
          signalCount: Array.from(symbolHistory.values())
            .reduce((sum, history) => sum + history.length, 0)
        }
      };
      
      return frame;
    } catch (error) {
      this.logger.error(`Error fusing signals: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Update performance metrics for a timescale
   * @param symbol Asset symbol
   * @param timescale Timescale to update
   */
  private updatePerformanceMetrics(symbol: string, timescale: Timescale): void {
    const symbolHistory = this.signalHistory.get(symbol);
    if (!symbolHistory) return;
    
    const history = symbolHistory.get(timescale);
    if (!history || history.length < 2) return;
    
    // Calculate returns
    const returns = history.slice(1).map((frame, i) => 
      frame.score - history[i].score
    );
    
    // Calculate metrics
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    const winRate = returns.filter(r => r > 0).length / returns.length;
    
    // Get or create performance map
    let performanceMap = this.performanceMetrics.get(symbol);
    if (!performanceMap) {
      performanceMap = new Map();
      this.performanceMetrics.set(symbol, performanceMap);
    }
    
    // Update metrics
    performanceMap.set(timescale, {
      sharpeRatio,
      winRate,
      avgReturn,
      signalCount: history.length
    });
  }
  
  /**
   * Calculate weights for each timescale
   * @param symbol Asset symbol
   * @returns Weights by timescale
   */
  private calculateWeights(symbol: string): Record<Timescale, number> {
    const performance = this.performanceMetrics.get(symbol);
    if (!performance) {
      return {
        [Timescale.SHORT_TERM]: 0.33,
        [Timescale.MID_TERM]: 0.33,
        [Timescale.LONG_TERM]: 0.34
      };
    }
    
    // Get volatility regime
    const regime = this.determineVolatilityRegime(symbol);
    
    // Calculate base weights from performance
    const baseWeights = Object.values(Timescale).reduce((weights, timescale) => {
      const metrics = performance.get(timescale);
      if (!metrics) {
        weights[timescale] = 0;
        return weights;
      }
      
      // Combine sharpe ratio and win rate
      const performanceScore = (metrics.sharpeRatio + metrics.winRate) / 2;
      weights[timescale] = Math.max(0, performanceScore);
      return weights;
    }, {} as Record<Timescale, number>);
    
    // Normalize base weights
    const totalWeight = Object.values(baseWeights).reduce((sum, w) => sum + w, 0);
    if (totalWeight > 0) {
      Object.keys(baseWeights).forEach(ts => {
        baseWeights[ts as Timescale] /= totalWeight;
      });
    }
    
    // Apply volatility regime adjustments
    if (regime === 'HIGH') {
      baseWeights[Timescale.SHORT_TERM] *= this.config.volatilityWeighting.shortTermBias;
      baseWeights[Timescale.LONG_TERM] *= (1 - this.config.volatilityWeighting.shortTermBias);
    } else if (regime === 'LOW') {
      baseWeights[Timescale.SHORT_TERM] *= (1 - this.config.volatilityWeighting.longTermBias);
      baseWeights[Timescale.LONG_TERM] *= this.config.volatilityWeighting.longTermBias;
    }
    
    // Renormalize after adjustments
    const adjustedTotal = Object.values(baseWeights).reduce((sum, w) => sum + w, 0);
    if (adjustedTotal > 0) {
      Object.keys(baseWeights).forEach(ts => {
        baseWeights[ts as Timescale] /= adjustedTotal;
      });
    }
    
    return baseWeights;
  }
  
  /**
   * Calculate fused score from weighted signals
   * @param symbol Asset symbol
   * @param weights Timescale weights
   * @returns Fused score
   */
  private calculateFusedScore(symbol: string, weights: Record<Timescale, number>): number {
    const symbolHistory = this.signalHistory.get(symbol);
    if (!symbolHistory) return 0;
    
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const [timescale, history] of symbolHistory.entries()) {
      if (history.length === 0) continue;
      
      // Use most recent signal
      const latestSignal = history[history.length - 1];
      const weight = weights[timescale];
      
      totalScore += latestSignal.score * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }
  
  /**
   * Determine current volatility regime
   * @param symbol Asset symbol
   * @returns Volatility regime
   */
  private determineVolatilityRegime(symbol: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    const performance = this.performanceMetrics.get(symbol);
    if (!performance) return 'MEDIUM';
    
    // Calculate average volatility across timescales
    let totalVolatility = 0;
    let count = 0;
    
    for (const metrics of performance.values()) {
      if (metrics.signalCount > 0) {
        totalVolatility += metrics.sharpeRatio;
        count++;
      }
    }
    
    const avgVolatility = count > 0 ? totalVolatility / count : 0;
    
    if (avgVolatility > this.config.volatilityWeighting.highVolatilityThreshold) {
      return 'HIGH';
    } else if (avgVolatility < this.config.volatilityWeighting.lowVolatilityThreshold) {
      return 'LOW';
    }
    
    return 'MEDIUM';
  }
  
  /**
   * Calculate trend strength
   * @param symbol Asset symbol
   * @returns Trend strength (0-1)
   */
  private calculateTrendStrength(symbol: string): number {
    const symbolHistory = this.signalHistory.get(symbol);
    if (!symbolHistory) return 0;
    
    // Calculate trend strength from short-term signals
    const shortTermHistory = symbolHistory.get(Timescale.SHORT_TERM);
    if (!shortTermHistory || shortTermHistory.length < 2) return 0;
    
    // Calculate average directional movement
    let totalMovement = 0;
    let totalAbsMovement = 0;
    
    for (let i = 1; i < shortTermHistory.length; i++) {
      const movement = shortTermHistory[i].score - shortTermHistory[i-1].score;
      totalMovement += movement;
      totalAbsMovement += Math.abs(movement);
    }
    
    // Trend strength is the ratio of net movement to total movement
    return totalAbsMovement > 0 ? Math.abs(totalMovement) / totalAbsMovement : 0;
  }
} 