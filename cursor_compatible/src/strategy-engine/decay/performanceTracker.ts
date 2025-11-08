/**
 * Performance Tracker
 * 
 * Tracks key performance metrics for strategies over time:
 * - Win rate
 * - Sharpe ratio
 * - Drawdown
 * - Alpha/beta against market
 * - Trade frequency
 */

import { createLogger } from '../../common/logger.js';
import { RedisClient } from '../../common/redis.js';

const logger = createLogger('PerformanceTracker');

/**
 * Time period for tracking metrics
 */
export enum TimeWindow {
  DAY_1 = '1d',
  DAY_3 = '3d',
  DAY_7 = '7d',
  DAY_14 = '14d',
  DAY_30 = '30d',
  DAY_90 = '90d'
}

/**
 * Trading performance metrics
 */
export interface PerformanceMetrics {
  strategyId: string;
  timestamp: number;
  
  // Win rate (percentage of successful trades)
  winRate: number;
  
  // Total number of trades in this period
  tradeCount: number;
  
  // Returns
  totalReturn: number;
  annualizedReturn: number;
  
  // Risk-adjusted metrics
  sharpeRatio: number;
  sortino: number;
  
  // Drawdown metrics
  maxDrawdown: number;
  currentDrawdown: number;
  
  // Alpha (excess return relative to benchmark)
  alpha: number;
  
  // Beta (sensitivity to market movements)
  beta: number;
  
  // Reference benchmarks
  btcCorrelation: number;
  ethCorrelation: number;
  
  // Trade frequency (trades per day)
  dailyTradeFrequency: number;
  
  // Average confidence of signals
  avgSignalConfidence: number;
  
  // Average execution quality (realized vs. expected)
  executionQuality: number;
}

/**
 * Metadata about trades for win rate calculation
 */
export interface TradeResult {
  strategyId: string;
  tradeId: string;
  timestamp: number;
  isWin: boolean;
  returnPct: number;
  confidence: number;
  executionQuality: number;
}

/**
 * Configuration for performance tracking
 */
export interface PerformanceTrackerConfig {
  // Time windows to track metrics for (in days)
  timeWindows: number[];
  
  // Maximum history items to keep per strategy
  maxHistoryItems: number;
  
  // Redis key TTL in seconds
  metricsTtlSeconds: number;
  
  // Minimum number of trades required for reliable metrics
  minTradesForReliability: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PerformanceTrackerConfig = {
  timeWindows: [1, 3, 7, 14, 30, 90],
  maxHistoryItems: 1000,
  metricsTtlSeconds: 60 * 60 * 24 * 90, // 90 days
  minTradesForReliability: 5
};

/**
 * Historical performance snapshot by time window
 */
export interface PerformanceSnapshot {
  strategyId: string;
  timestamp: number;
  metrics: {
    [key in TimeWindow]?: PerformanceMetrics;
  };
}

/**
 * Tracks strategy performance metrics
 */
export class PerformanceTracker {
  private redis: RedisClient;
  private config: PerformanceTrackerConfig;
  
  /**
   * Create a new performance tracker
   */
  constructor(redis: RedisClient, config: Partial<PerformanceTrackerConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Record a trade result
   * @param trade Trade result
   */
  public async recordTradeResult(trade: TradeResult): Promise<void> {
    try {
      const key = `strategy_trades:${trade.strategyId}`;
      
      // Store trade in Redis list
      await this.redis.lpush(key, JSON.stringify({
        id: trade.tradeId,
        timestamp: trade.timestamp,
        win: trade.isWin ? 1 : 0,
        return: trade.returnPct.toFixed(4),
        confidence: trade.confidence.toFixed(4),
        quality: trade.executionQuality.toFixed(4)
      }));
      
      // Trim list to max history
      await this.redis.ltrim(key, 0, this.config.maxHistoryItems - 1);
      
      // Set expiry
      await this.redis.expire(key, this.config.metricsTtlSeconds);
      
      logger.debug(`Recorded trade result for ${trade.strategyId}: win=${trade.isWin}, return=${trade.returnPct.toFixed(2)}%`);
    } catch (error) {
      logger.error(`Failed to record trade result: ${error}`);
      throw error;
    }
  }
  
  /**
   * Track complete performance metrics
   * @param metrics Performance metrics
   * @param timeWindow Time window for these metrics
   */
  public async trackPerformanceMetrics(
    metrics: PerformanceMetrics,
    timeWindow: TimeWindow
  ): Promise<void> {
    try {
      const key = `strategy_performance:${metrics.strategyId}:${timeWindow}`;
      
      // Store as hash
      await this.redis.hset(key, {
        timestamp: metrics.timestamp,
        winRate: metrics.winRate.toFixed(4),
        tradeCount: metrics.tradeCount,
        totalReturn: metrics.totalReturn.toFixed(4),
        annualizedReturn: metrics.annualizedReturn.toFixed(4),
        sharpeRatio: metrics.sharpeRatio.toFixed(4),
        sortino: metrics.sortino.toFixed(4),
        maxDrawdown: metrics.maxDrawdown.toFixed(4),
        currentDrawdown: metrics.currentDrawdown.toFixed(4),
        alpha: metrics.alpha.toFixed(4),
        beta: metrics.beta.toFixed(4),
        btcCorrelation: metrics.btcCorrelation.toFixed(4),
        ethCorrelation: metrics.ethCorrelation.toFixed(4),
        dailyTradeFrequency: metrics.dailyTradeFrequency.toFixed(2),
        avgSignalConfidence: metrics.avgSignalConfidence.toFixed(4),
        executionQuality: metrics.executionQuality.toFixed(4)
      });
      
      // Store to time series history
      const historyKey = `strategy_performance_history:${metrics.strategyId}:${timeWindow}`;
      await this.redis.zadd(historyKey, metrics.timestamp, JSON.stringify(metrics));
      
      // Trim series to reasonable size (keep 100 points max)
      const count = await this.redis.zcard(historyKey);
      if (count > 100) {
        await this.redis.zremrangebyrank(historyKey, 0, count - 101);
      }
      
      // Set expiry
      await this.redis.expire(key, this.config.metricsTtlSeconds);
      await this.redis.expire(historyKey, this.config.metricsTtlSeconds);
      
      logger.debug(`Tracked ${timeWindow} performance for ${metrics.strategyId}: winRate=${metrics.winRate.toFixed(2)}, sharpe=${metrics.sharpeRatio.toFixed(2)}`);
    } catch (error) {
      logger.error(`Failed to track performance metrics: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the latest performance metrics for a strategy
   * @param strategyId Strategy ID
   * @param timeWindow Time window for metrics
   * @returns Latest performance metrics or null if not found
   */
  public async getPerformanceMetrics(
    strategyId: string,
    timeWindow: TimeWindow
  ): Promise<PerformanceMetrics | null> {
    try {
      const key = `strategy_performance:${strategyId}:${timeWindow}`;
      const data = await this.redis.hgetall(key);
      
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      
      return {
        strategyId,
        timestamp: parseInt(data.timestamp, 10),
        winRate: parseFloat(data.winRate),
        tradeCount: parseInt(data.tradeCount, 10),
        totalReturn: parseFloat(data.totalReturn),
        annualizedReturn: parseFloat(data.annualizedReturn),
        sharpeRatio: parseFloat(data.sharpeRatio),
        sortino: parseFloat(data.sortino),
        maxDrawdown: parseFloat(data.maxDrawdown),
        currentDrawdown: parseFloat(data.currentDrawdown),
        alpha: parseFloat(data.alpha),
        beta: parseFloat(data.beta),
        btcCorrelation: parseFloat(data.btcCorrelation),
        ethCorrelation: parseFloat(data.ethCorrelation),
        dailyTradeFrequency: parseFloat(data.dailyTradeFrequency),
        avgSignalConfidence: parseFloat(data.avgSignalConfidence),
        executionQuality: parseFloat(data.executionQuality)
      };
    } catch (error) {
      logger.error(`Failed to get performance metrics: ${error}`);
      return null;
    }
  }
  
  /**
   * Get a snapshot of performance across all time windows
   * @param strategyId Strategy ID 
   * @returns Performance snapshot with metrics for each time window
   */
  public async getPerformanceSnapshot(strategyId: string): Promise<PerformanceSnapshot> {
    const metrics: PerformanceSnapshot['metrics'] = {};
    const timestamp = Date.now();
    
    for (const days of this.config.timeWindows) {
      const timeWindow = this.daysToTimeWindow(days);
      const result = await this.getPerformanceMetrics(strategyId, timeWindow);
      
      if (result) {
        metrics[timeWindow] = result;
      }
    }
    
    return {
      strategyId,
      timestamp,
      metrics
    };
  }
  
  /**
   * Get historical performance metrics
   * @param strategyId Strategy ID
   * @param timeWindow Time window
   * @param limit Maximum number of items to return
   * @returns Array of performance metrics in chronological order (oldest first)
   */
  public async getPerformanceHistory(
    strategyId: string,
    timeWindow: TimeWindow,
    limit: number = 30
  ): Promise<PerformanceMetrics[]> {
    try {
      const historyKey = `strategy_performance_history:${strategyId}:${timeWindow}`;
      
      // Get data sorted by timestamp (ascending)
      const data = await this.redis.zrange(historyKey, 0, limit - 1);
      
      if (!data || data.length === 0) {
        return [];
      }
      
      // Parse JSON data
      return data.map(item => JSON.parse(item));
    } catch (error) {
      logger.error(`Failed to get performance history: ${error}`);
      return [];
    }
  }
  
  /**
   * Calculate performance metrics from trade history
   * @param strategyId Strategy ID
   * @param days Number of days to calculate metrics for
   * @returns Calculated performance metrics or null if insufficient data
   */
  public async calculateMetricsFromTrades(
    strategyId: string,
    days: number
  ): Promise<PerformanceMetrics | null> {
    try {
      const trades = await this.getRecentTrades(strategyId);
      
      if (!trades || trades.length === 0) {
        logger.debug(`No trades found for strategy ${strategyId}`);
        return null;
      }
      
      // Filter trades by time window
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      const filteredTrades = trades.filter(trade => trade.timestamp >= cutoffTime);
      
      if (filteredTrades.length < this.config.minTradesForReliability) {
        logger.debug(`Insufficient trades for reliable metrics: ${filteredTrades.length} trades in ${days} days`);
        return null;
      }
      
      // Calculate win rate
      const wins = filteredTrades.filter(trade => trade.isWin).length;
      const winRate = (wins / filteredTrades.length) * 100;
      
      // Calculate returns
      const returns = filteredTrades.map(trade => trade.returnPct);
      const totalReturn = returns.reduce((sum, ret) => sum + ret, 0);
      
      // Annualize return
      const annualFactor = 365 / days;
      const annualizedReturn = ((1 + totalReturn / 100) ** annualFactor - 1) * 100;
      
      // Calculate Sharpe ratio (simplified)
      const avgReturn = totalReturn / filteredTrades.length;
      const stdDev = this.calculateStandardDeviation(returns);
      const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 / days) : 0;
      
      // Calculate Sortino ratio (only considering negative returns)
      const negativeReturns = returns.filter(r => r < 0);
      const downstdDev = this.calculateStandardDeviation(negativeReturns);
      const sortino = downstdDev > 0 ? (avgReturn / downstdDev) * Math.sqrt(365 / days) : 0;
      
      // Calculate drawdown (simplified)
      let maxDrawdown = 0;
      let runningTotal = 100; // Start with 100 units
      let peakValue = 100;
      
      // Sort trades by timestamp
      const sortedTrades = [...filteredTrades].sort((a, b) => a.timestamp - b.timestamp);
      
      for (const trade of sortedTrades) {
        // Update portfolio value
        runningTotal *= (1 + trade.returnPct / 100);
        
        // Update peak value
        if (runningTotal > peakValue) {
          peakValue = runningTotal;
        }
        
        // Calculate current drawdown
        const currentDrawdown = ((peakValue - runningTotal) / peakValue) * 100;
        
        // Update max drawdown if needed
        if (currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
        }
      }
      
      // Calculate current drawdown
      const currentDrawdown = ((peakValue - runningTotal) / peakValue) * 100;
      
      // Calculate daily trade frequency
      const dailyTradeFrequency = filteredTrades.length / days;
      
      // Calculate average signal confidence
      const avgSignalConfidence = filteredTrades.reduce(
        (sum, trade) => sum + trade.confidence,
        0
      ) / filteredTrades.length;
      
      // Calculate average execution quality
      const avgExecutionQuality = filteredTrades.reduce(
        (sum, trade) => sum + trade.executionQuality,
        0
      ) / filteredTrades.length;
      
      // For alpha and beta, we would need market returns data
      // Using placeholder values for now
      const alpha = 0;
      const beta = 1.0;
      const btcCorrelation = 0;
      const ethCorrelation = 0;
      
      return {
        strategyId,
        timestamp: Date.now(),
        winRate,
        tradeCount: filteredTrades.length,
        totalReturn,
        annualizedReturn,
        sharpeRatio,
        sortino,
        maxDrawdown,
        currentDrawdown,
        alpha,
        beta,
        btcCorrelation,
        ethCorrelation,
        dailyTradeFrequency,
        avgSignalConfidence,
        executionQuality: avgExecutionQuality
      };
    } catch (error) {
      logger.error(`Failed to calculate metrics from trades: ${error}`);
      return null;
    }
  }
  
  /**
   * Get recent trades for a strategy
   * @param strategyId Strategy ID
   * @returns Array of trade results
   */
  private async getRecentTrades(strategyId: string): Promise<TradeResult[]> {
    try {
      const key = `strategy_trades:${strategyId}`;
      const data = await this.redis.lrange(key, 0, this.config.maxHistoryItems - 1);
      
      if (!data || data.length === 0) {
        return [];
      }
      
      return data.map(item => {
        const trade = JSON.parse(item);
        return {
          strategyId,
          tradeId: trade.id,
          timestamp: trade.timestamp,
          isWin: trade.win === 1,
          returnPct: parseFloat(trade.return),
          confidence: parseFloat(trade.confidence),
          executionQuality: parseFloat(trade.quality)
        };
      });
    } catch (error) {
      logger.error(`Failed to get recent trades: ${error}`);
      return [];
    }
  }
  
  /**
   * Calculate standard deviation of a set of values
   * @param values Array of numeric values
   * @returns Standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDifferences.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Convert days to a TimeWindow enum value
   * @param days Number of days
   * @returns Corresponding TimeWindow value
   */
  private daysToTimeWindow(days: number): TimeWindow {
    switch (days) {
      case 1: return TimeWindow.DAY_1;
      case 3: return TimeWindow.DAY_3;
      case 7: return TimeWindow.DAY_7;
      case 14: return TimeWindow.DAY_14;
      case 30: return TimeWindow.DAY_30;
      case 90: return TimeWindow.DAY_90;
      default: 
        // Default to closest window
        if (days < 1) return TimeWindow.DAY_1;
        if (days < 3) return TimeWindow.DAY_1;
        if (days < 7) return TimeWindow.DAY_3;
        if (days < 14) return TimeWindow.DAY_7;
        if (days < 30) return TimeWindow.DAY_14;
        if (days < 90) return TimeWindow.DAY_30;
        return TimeWindow.DAY_90;
    }
  }
  
  /**
   * Update configuration
   * @param newConfig New configuration settings
   */
  public updateConfig(newConfig: Partial<PerformanceTrackerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`Performance tracker config updated: ${JSON.stringify(newConfig)}`);
  }
} 