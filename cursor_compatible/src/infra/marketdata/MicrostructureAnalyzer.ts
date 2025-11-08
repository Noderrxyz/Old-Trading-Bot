/**
 * Market Microstructure Analysis Module
 * 
 * This module provides tools for analyzing real-time market microstructure data
 * to extract insights about order flow, liquidity, and market manipulation.
 */

import { RedisClient } from '../core/RedisClient.js';
import { createLogger } from '../../common/logger.js';

type OrderBookSide = [number, number][]; // [price, size]

/**
 * Metrics describing market microstructure 
 */
export interface MicrostructureMetrics {
  /** Timestamp when metrics were calculated */
  timestamp: number;
  
  /** Market symbol or venue identifier */
  venue: string;
  
  /** Raw spread in basis points */
  spreadBps: number;
  
  /** Spread pressure (normalized -1 to 1, where negative means narrowing) */
  spreadPressure: number;
  
  /** Top of book imbalance (-1 to 1, where positive is buy pressure) */
  topImbalance: number;
  
  /** Depth imbalance across multiple levels (-1 to 1) */
  depthImbalance: number;
  
  /** Overall liquidity score (0-1) */
  liquidityScore: number;
  
  /** Risk of sweep in immediate future (0-1) */
  sweepRisk: number;
  
  /** Quote volatility in recent time window (0-1) */
  quoteVolatility: number;
  
  /** Estimated size required to move price by 10 bps (in quote currency) */
  depthFor10BpsMove: number;
  
  /** Identified market regime */
  marketRegime: 'trending' | 'mean_reverting' | 'volatile' | 'ranging' | 'unknown';
}

/**
 * Analyzer for market microstructure patterns
 */
export class MicrostructureAnalyzer {
  private readonly logger = createLogger('MicrostructureAnalyzer');
  private readonly metricsCache: Map<string, MicrostructureMetrics> = new Map();
  private readonly updateIntervalMs: number;
  private readonly cacheTimeoutMs: number;

  /**
   * Create a new microstructure analyzer
   * @param redis Redis client for data storage and retrieval
   * @param orderBookService Service to access order book data
   * @param marketDataService Service to access market data
   * @param updateIntervalMs How often to update metrics (ms)
   * @param cacheTimeoutMs How long to cache metrics before recalculating (ms)
   */
  constructor(
    private redis: RedisClient,
    private readonly orderBookService: any, // Would be a specific interface in a real implementation
    private readonly marketDataService: any, // Would be a specific interface in a real implementation
    updateIntervalMs = 5000,
    cacheTimeoutMs = 30000
  ) {
    this.updateIntervalMs = updateIntervalMs;
    this.cacheTimeoutMs = cacheTimeoutMs;
    
    this.logger.info('MicrostructureAnalyzer initialized');
  }

  /**
   * Analyze microstructure for a specific venue/symbol
   * @param venue Venue or market to analyze (e.g., "btc_market")
   * @returns Microstructure metrics
   */
  public async analyze(venue: string): Promise<MicrostructureMetrics> {
    // Check if we have fresh cached metrics
    const cached = this.metricsCache.get(venue);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeoutMs) {
      return cached;
    }
    
    // Get fresh metrics
    try {
      const metrics = await this.calculateMetrics(venue);
      this.metricsCache.set(venue, metrics);
      return metrics;
    } catch (error) {
      this.logger.error(`Error calculating microstructure metrics for ${venue}: ${error instanceof Error ? error.message : String(error)}`);
      
      // If we have stale metrics, return those rather than failing
      if (cached) {
        this.logger.warn(`Returning stale metrics for ${venue}`);
        return cached;
      }
      
      // Otherwise return default metrics
      return this.createDefaultMetrics(venue);
    }
  }

  /**
   * Calculate microstructure metrics for a venue
   * @param venue Venue to analyze
   * @returns Calculated metrics
   */
  private async calculateMetrics(venue: string): Promise<MicrostructureMetrics> {
    // This would contain real order book analysis in a production system
    // For this example, we're using mock implementation
    
    // Parse venue to get base symbol (e.g., "btc_market" -> "btc")
    const baseSymbol = venue.split('_')[0] || 'unknown';
    
    // Create random but plausible metrics for demonstration
    const spreadBps = this.getRandomMetric(1, 15, baseSymbol);
    const topImbalance = this.getRandomMetric(-0.5, 0.5, baseSymbol);
    const depthImbalance = this.getRandomMetric(-0.3, 0.3, baseSymbol);
    const liquidityScore = this.getRandomMetric(0.3, 0.9, baseSymbol);
    const sweepRisk = this.getRandomMetric(0.1, 0.5, baseSymbol);
    const quoteVolatility = this.getRandomMetric(0.1, 0.4, baseSymbol);
    
    // Derived metric: estimated depth required to move price
    const depthFor10BpsMove = liquidityScore * 1000000 * this.getAssetLiquidityFactor(baseSymbol);
    
    // Spread pressure (negative = narrowing, positive = widening)
    const spreadPressure = this.getRandomMetric(-0.2, 0.2, baseSymbol);
    
    // Determine market regime based on metrics
    let marketRegime: 'trending' | 'mean_reverting' | 'volatile' | 'ranging' | 'unknown';
    
    if (quoteVolatility > 0.3) {
      marketRegime = 'volatile';
    } else if (Math.abs(topImbalance) > 0.4 && Math.abs(depthImbalance) > 0.25) {
      marketRegime = 'trending';
    } else if (Math.abs(spreadPressure) < 0.1 && quoteVolatility < 0.2) {
      marketRegime = 'ranging';
    } else if (Math.abs(topImbalance) < 0.2 && liquidityScore > 0.5) {
      marketRegime = 'mean_reverting';
    } else {
      marketRegime = 'unknown';
    }
    
    return {
      timestamp: Date.now(),
      venue,
      spreadBps,
      spreadPressure,
      topImbalance,
      depthImbalance,
      liquidityScore,
      sweepRisk,
      quoteVolatility,
      depthFor10BpsMove,
      marketRegime
    };
  }

  /**
   * Create default metrics for a venue when real data can't be obtained
   * @param venue Venue to create defaults for
   * @returns Default metrics
   */
  private createDefaultMetrics(venue: string): MicrostructureMetrics {
    return {
      timestamp: Date.now(),
      venue,
      spreadBps: 10,
      spreadPressure: 0,
      topImbalance: 0,
      depthImbalance: 0,
      liquidityScore: 0.5,
      sweepRisk: 0.3,
      quoteVolatility: 0.2,
      depthFor10BpsMove: 100000,
      marketRegime: 'unknown'
    };
  }

  /**
   * Get a random metric value that's consistent for a given symbol
   * @param min Minimum value
   * @param max Maximum value
   * @param symbol Symbol to seed the random value
   * @returns Random but consistent value
   */
  private getRandomMetric(min: number, max: number, symbol: string): number {
    // Use the first character of the symbol as a seed value (0-25)
    const seed = (symbol.charCodeAt(0) % 26) / 26;
    
    // Generate a random value with some consistency based on the seed
    return min + (max - min) * (0.5 * seed + 0.5 * Math.random());
  }

  /**
   * Get liquidity factor for an asset (higher for major assets)
   * @param symbol Asset symbol
   * @returns Liquidity factor
   */
  private getAssetLiquidityFactor(symbol: string): number {
    const lower = symbol.toLowerCase();
    
    if (lower === 'btc') return 5.0;
    if (lower === 'eth') return 3.0;
    if (['usdt', 'usdc', 'busd', 'dai'].includes(lower)) return 4.0;
    if (['sol', 'bnb', 'ada', 'xrp'].includes(lower)) return 2.0;
    
    return 1.0;
  }

  /**
   * Store current orderbook snapshot for historical analysis
   * @param venue Exchange venue
   * @param snapshot Order book snapshot (serialized JSON)
   */
  async storeOrderbookSnapshot(venue: string, snapshot: string): Promise<void> {
    const spoofKey = `ob:spoofing:${venue}`;
    
    // Store in spoofing detection list (limited to last 20 snapshots)
    await this.redis.lpush(spoofKey, snapshot);
    await this.redis.ltrim(spoofKey, 0, 19);
    
    // Store in main orderbook hash
    await this.redis.hset(`orderbook:${venue}`, 'snapshot', snapshot);
    await this.redis.hset(`orderbook:${venue}`, 'timestamp', Date.now().toString());
  }

  /**
   * Detect potential spoofing activity by looking for sudden vanishing orders
   * @param venue Exchange venue
   * @returns Spoofing probability score (0-1)
   */
  private async detectSpoofing(venue: string): Promise<number> {
    // Read historical top 3 book layers from Redis
    const spoofKey = `ob:spoofing:${venue}`;
    const past = await this.redis.lrange(spoofKey, 0, 5);
    
    if (past.length < 2) return 0;
    
    const vanishes = past.filter((entry: string, i: number, arr: string[]) => {
      if (i >= arr.length - 1) return false;
      
      const parsed = JSON.parse(entry);
      const next = JSON.parse(arr[i + 1]);
      
      // Look for sudden vanishing orders (>5 units difference)
      return (
        parsed.bids && next.bids &&
        parsed.bids[0] && next.bids[0] &&
        Math.abs(parsed.bids[0][1] - next.bids[0][1]) > 5
      );
    });
    
    return Math.min(vanishes.length / Math.max(1, past.length - 1), 1);
  }

  /**
   * Track changes in the bid-ask spread over time
   * @param venue Exchange venue
   * @param currentSpread Current spread value
   * @returns Spread pressure (change in spread, positive means widening)
   */
  private async trackSpreadPressure(venue: string, currentSpread: number): Promise<number> {
    const key = `ob:spread:${venue}`;
    const pastSpread = await this.redis.get(key);
    
    // Store current spread with 60s expiry
    await this.redis.set(key, currentSpread.toString(), 'EX', 60);
    
    if (!pastSpread) return 0;
    
    // Calculate change in spread (positive = widening, negative = tightening)
    return currentSpread - parseFloat(pastSpread);
  }

  /**
   * Measure volatility of quote sizes to detect unstable markets
   * @param venue Exchange venue
   * @param bidSize Current top bid size
   * @param askSize Current top ask size
   * @returns Quote volatility score
   */
  private async measureQuoteVolatility(venue: string, bidSize: number, askSize: number): Promise<number> {
    const key = `ob:volatility:${venue}`;
    
    // Add current sizes to history
    await this.redis.lpush(key, JSON.stringify([bidSize, askSize]));
    await this.redis.ltrim(key, 0, 20);

    // Get historical sizes
    const history = await this.redis.lrange(key, 0, 20);
    if (history.length < 3) return 0;
    
    // Calculate standard deviation of sizes
    const sizes = history.map((e: string) => JSON.parse(e)).flat();
    const avg = sizes.reduce((a: number, b: number) => a + b, 0) / sizes.length;
    const std = Math.sqrt(sizes.reduce((s: number, v: number) => s + Math.pow(v - avg, 2), 0) / sizes.length);
    
    // Normalize by average to get coefficient of variation
    return std / (avg + 1e-6);
  }

  /**
   * Calculate risk of a market sweep based on order book depth
   * @param bids Bid side of the order book
   * @param asks Ask side of the order book
   * @returns Sweep risk score (0-1)
   */
  private calculateSweepRisk(bids: OrderBookSide, asks: OrderBookSide): number {
    // Use top 3 levels to assess depth
    const bidDepth = bids.slice(0, 3).reduce((sum, [, size]) => sum + size, 0);
    const askDepth = asks.slice(0, 3).reduce((sum, [, size]) => sum + size, 0);
    
    // Minimum depth on either side
    const minDepth = Math.min(bidDepth, askDepth);
    
    // Historical average depth (hardcoded for now, could be dynamic)
    const avgDepth = 20;
    
    // Calculate sweep risk (1 = high risk, 0 = low risk)
    if (minDepth < 5) return 1;
    if (minDepth < avgDepth * 0.3) return 0.8;
    if (minDepth < avgDepth * 0.5) return 0.5;
    if (minDepth < avgDepth * 0.7) return 0.3;
    
    return 0;
  }

  /**
   * Get historical microstructure metrics for a venue
   * @param venue Exchange venue
   * @param limit Number of historical records to retrieve
   * @returns Array of historical metrics
   */
  async getHistoricalMetrics(venue: string, limit: number = 100): Promise<MicrostructureMetrics[]> {
    const key = `metrics:microstructure:${venue}`;
    const data = await this.redis.lrange(key, 0, limit - 1);
    return data.map((item: string) => JSON.parse(item));
  }

  /**
   * Store calculated metrics for historical analysis
   * @param venue Exchange venue
   * @param metrics Microstructure metrics
   */
  async storeMetrics(venue: string, metrics: MicrostructureMetrics): Promise<void> {
    const key = `metrics:microstructure:${venue}`;
    await this.redis.lpush(key, JSON.stringify(metrics));
    await this.redis.ltrim(key, 0, 999); // Keep last 1000 metrics
  }
} 