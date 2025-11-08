import { RedisService } from '../redis/RedisService';
import { EventEmitter } from '../../utils/EventEmitter';
import { TradingStrategy } from '../evolution/mutation/strategy-model';
import { 
  STRATEGY_SINGULARITY_THRESHOLDS, 
  ANOMALY_SCORE_WEIGHTS,
  MONITORING_TIME_WINDOWS,
  ALERT_CONFIG
} from '../../config/strategy_safety.config';
import { logger } from '../../utils/logger';

/**
 * Interface for strategy performance metrics
 */
export interface StrategyPerformanceMetrics {
  strategyId: string;
  annualizedReturns: number;
  maxDrawdown: number;
  sharpeRatio: number;
  dailyVolatility: number;
  winRate: number;
  averageTradeProfit: number;
  totalTradeCount: number;
  positionSizePercent: number;
  turnoverRate: number;
  orderFrequency: number; // orders per day
  assetConcentration: number; // 0-1, higher means more concentrated
  marketCorrelation: number; // -1 to 1
  recentPerformanceChange: number; // percent change
}

/**
 * Interface for anomaly detection results
 */
export interface StrategyAnomalyData {
  timestamp: number;
  strategyId: string;
  agentId: string;
  anomalyScore: number;
  anomalyReasons: string[];
  anomalyFactors: Record<string, number>;
  alertLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metrics: StrategyPerformanceMetrics;
}

/**
 * Configuration for the StrategyAnomalyDetector
 */
export interface StrategyAnomalyDetectorConfig {
  // How often to scan strategies for anomalies (milliseconds)
  scanInterval: number;
  
  // How long to keep anomaly history (days)
  historyRetentionDays: number;
  
  // Redis key prefixes
  anomalyKeyPrefix: string;
  metricsKeyPrefix: string;
  
  // Whether to emit events on anomaly detection
  emitEvents: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: StrategyAnomalyDetectorConfig = {
  scanInterval: 15 * 60 * 1000, // 15 minutes
  historyRetentionDays: 90,
  anomalyKeyPrefix: 'strategy:anomaly:',
  metricsKeyPrefix: 'strategy:metrics:',
  emitEvents: true,
};

/**
 * Detects anomalies in trading strategies' behavior and performance
 */
export class StrategyAnomalyDetector {
  private redis: RedisService;
  private eventEmitter: EventEmitter;
  private config: StrategyAnomalyDetectorConfig;
  private scanIntervalId: NodeJS.Timeout | null = null;

  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    config: Partial<StrategyAnomalyDetectorConfig> = {}
  ) {
    this.redis = redis;
    this.eventEmitter = eventEmitter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the anomaly detection scan at regular intervals
   */
  public startScanning(): void {
    if (this.scanIntervalId) return;
    
    this.scanIntervalId = setInterval(async () => {
      try {
        await this.scanAllStrategies();
      } catch (error) {
        logger.error('Error during strategy anomaly scan:', error);
      }
    }, this.config.scanInterval);
    
    logger.info(`Strategy anomaly detection scanning started. Interval: ${this.config.scanInterval}ms`);
  }

  /**
   * Stop the anomaly detection scans
   */
  public stopScanning(): void {
    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
      logger.info('Strategy anomaly detection scanning stopped');
    }
  }

  /**
   * Scan all active strategies for anomalies
   */
  public async scanAllStrategies(): Promise<StrategyAnomalyData[]> {
    // Get all strategy metrics keys
    const metricKeys = await this.redis.keys(`${this.config.metricsKeyPrefix}*`);
    
    if (!metricKeys.length) {
      logger.debug('No strategy metrics found for anomaly scanning');
      return [];
    }
    
    // Process each strategy
    const promises = metricKeys.map(async (key) => {
      const strategyId = key.replace(this.config.metricsKeyPrefix, '');
      return this.scanStrategy(strategyId);
    });
    
    const results = await Promise.all(promises);
    const anomalies = results.filter(Boolean) as StrategyAnomalyData[];
    
    logger.info(`Completed scan of ${metricKeys.length} strategies. Found ${anomalies.length} anomalies.`);
    return anomalies;
  }

  /**
   * Scan a single strategy for anomalies
   */
  public async scanStrategy(strategyId: string, agentId?: string): Promise<StrategyAnomalyData | null> {
    // Get strategy metrics
    const metrics = await this.getStrategyMetrics(strategyId);
    if (!metrics) {
      logger.warn(`No metrics found for strategy ${strategyId}`);
      return null;
    }
    
    // Get agent ID if not provided
    if (!agentId) {
      agentId = await this.getAgentIdForStrategy(strategyId);
      if (!agentId) {
        logger.warn(`No agent ID found for strategy ${strategyId}`);
        return null;
      }
    }
    
    // Calculate anomaly score and factors
    const { anomalyScore, anomalyFactors, reasons } = this.calculateAnomalyScore(metrics);
    
    // Determine alert level
    const alertLevel = this.determineAlertLevel(anomalyScore);
    
    // Create anomaly data
    const anomalyData: StrategyAnomalyData = {
      timestamp: Date.now(),
      strategyId,
      agentId,
      anomalyScore,
      anomalyReasons: reasons,
      anomalyFactors,
      alertLevel,
      metrics,
    };
    
    // Store anomaly data if score is above threshold
    if (anomalyScore > ALERT_CONFIG.riskLevelThresholds.LOW) {
      await this.storeAnomalyData(strategyId, anomalyData);
      
      // Emit event
      if (this.config.emitEvents) {
        this.eventEmitter.emit('strategy:anomaly_detected', anomalyData);
      }
      
      // Log anomaly
      logger.warn(`Strategy anomaly detected: ${strategyId}, Score: ${anomalyScore.toFixed(2)}, Level: ${alertLevel}`);
      return anomalyData;
    }
    
    return null;
  }

  /**
   * Get strategy metrics from storage
   */
  private async getStrategyMetrics(strategyId: string): Promise<StrategyPerformanceMetrics | null> {
    const json = await this.redis.get(`${this.config.metricsKeyPrefix}${strategyId}`);
    if (!json) return null;
    return JSON.parse(json) as StrategyPerformanceMetrics;
  }

  /**
   * Store strategy performance metrics
   */
  public async storeStrategyMetrics(strategyId: string, metrics: StrategyPerformanceMetrics): Promise<void> {
    const key = `${this.config.metricsKeyPrefix}${strategyId}`;
    await this.redis.set(key, JSON.stringify(metrics));
    await this.redis.expire(key, this.config.historyRetentionDays * 24 * 60 * 60);
  }

  /**
   * Store anomaly data in Redis
   */
  private async storeAnomalyData(strategyId: string, anomalyData: StrategyAnomalyData): Promise<void> {
    const key = `${this.config.anomalyKeyPrefix}${strategyId}:${anomalyData.timestamp}`;
    await this.redis.set(key, JSON.stringify(anomalyData));
    await this.redis.expire(key, this.config.historyRetentionDays * 24 * 60 * 60);
  }

  /**
   * Get recent anomaly data for a strategy
   */
  public async getRecentAnomalies(strategyId: string, limit: number = 10): Promise<StrategyAnomalyData[]> {
    const keys = await this.redis.keys(`${this.config.anomalyKeyPrefix}${strategyId}:*`);
    
    // Sort keys by timestamp (descending)
    keys.sort((a, b) => {
      const timestampA = parseInt(a.split(':').pop() || '0');
      const timestampB = parseInt(b.split(':').pop() || '0');
      return timestampB - timestampA;
    });
    
    // Get most recent anomalies
    const limitedKeys = keys.slice(0, limit);
    if (!limitedKeys.length) return [];
    
    const results = await Promise.all(limitedKeys.map(key => this.redis.get(key)));
    return results
      .filter(Boolean)
      .map(json => JSON.parse(json as string) as StrategyAnomalyData);
  }

  /**
   * Calculate anomaly score based on strategy metrics
   */
  private calculateAnomalyScore(metrics: StrategyPerformanceMetrics): {
    anomalyScore: number;
    anomalyFactors: Record<string, number>;
    reasons: string[];
  } {
    const factors: Record<string, number> = {};
    const reasons: string[] = [];
    
    // Check for abnormal returns
    factors.abnormalPerformance = this.normalizeAnomaly(
      Math.abs(metrics.annualizedReturns),
      STRATEGY_SINGULARITY_THRESHOLDS.abnormalPerformanceThreshold
    );
    
    if (factors.abnormalPerformance > 0.7) {
      reasons.push(`Abnormally ${metrics.annualizedReturns > 0 ? 'high' : 'low'} returns`);
    }
    
    // Check for low Sharpe ratio
    factors.lowSharpe = this.normalizeAnomaly(
      1 / Math.max(0.1, metrics.sharpeRatio),
      1 / STRATEGY_SINGULARITY_THRESHOLDS.minimumSharpeRatio
    );
    
    if (factors.lowSharpe > 0.7) {
      reasons.push(`Low risk-adjusted returns (Sharpe: ${metrics.sharpeRatio.toFixed(2)})`);
    }
    
    // Check for high drawdown
    factors.highDrawdown = this.normalizeAnomaly(
      metrics.maxDrawdown,
      STRATEGY_SINGULARITY_THRESHOLDS.maxDrawdownThreshold
    );
    
    if (factors.highDrawdown > 0.7) {
      reasons.push(`High drawdown: ${(metrics.maxDrawdown * 100).toFixed(1)}%`);
    }
    
    // Check for excessive volatility
    factors.excessiveVolatility = this.normalizeAnomaly(
      metrics.dailyVolatility,
      STRATEGY_SINGULARITY_THRESHOLDS.volatilityThreshold
    );
    
    if (factors.excessiveVolatility > 0.7) {
      reasons.push(`Excessive volatility: ${(metrics.dailyVolatility * 100).toFixed(1)}% daily`);
    }
    
    // Check for high position concentration
    factors.highConcentration = this.normalizeAnomaly(
      metrics.assetConcentration,
      STRATEGY_SINGULARITY_THRESHOLDS.maxAssetConcentration
    );
    
    if (factors.highConcentration > 0.7) {
      reasons.push(`High asset concentration: ${(metrics.assetConcentration * 100).toFixed(1)}%`);
    }
    
    // Check for high turnover
    factors.highTurnover = this.normalizeAnomaly(
      metrics.turnoverRate,
      STRATEGY_SINGULARITY_THRESHOLDS.maxTurnoverRate
    );
    
    if (factors.highTurnover > 0.7) {
      reasons.push(`High portfolio turnover: ${metrics.turnoverRate.toFixed(1)}x daily`);
    }
    
    // Check for high order frequency
    factors.highOrderFrequency = this.normalizeAnomaly(
      metrics.orderFrequency,
      STRATEGY_SINGULARITY_THRESHOLDS.maxOrdersPerDay
    );
    
    if (factors.highOrderFrequency > 0.7) {
      reasons.push(`High order frequency: ${metrics.orderFrequency.toFixed(1)} orders/day`);
    }
    
    // Check for large position size
    factors.largePositionSize = this.normalizeAnomaly(
      metrics.positionSizePercent,
      STRATEGY_SINGULARITY_THRESHOLDS.maxPositionSizePercent
    );
    
    if (factors.largePositionSize > 0.7) {
      reasons.push(`Large position size: ${(metrics.positionSizePercent * 100).toFixed(1)}% of NAV`);
    }
    
    // Check for recent performance change
    factors.rapidPerformanceChange = this.normalizeAnomaly(
      Math.abs(metrics.recentPerformanceChange),
      STRATEGY_SINGULARITY_THRESHOLDS.maxPerformanceChangePercent
    );
    
    if (factors.rapidPerformanceChange > 0.7) {
      reasons.push(`Rapid performance change: ${(metrics.recentPerformanceChange * 100).toFixed(1)}%`);
    }
    
    // Calculate weighted anomaly score
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const [factor, value] of Object.entries(factors)) {
      const weight = ANOMALY_SCORE_WEIGHTS[factor as keyof typeof ANOMALY_SCORE_WEIGHTS] || 1;
      weightedSum += value * weight;
      totalWeight += weight;
    }
    
    const anomalyScore = weightedSum / totalWeight;
    
    return {
      anomalyScore,
      anomalyFactors: factors,
      reasons,
    };
  }

  /**
   * Normalize an anomaly factor to a 0-1 scale
   */
  private normalizeAnomaly(value: number, threshold: number): number {
    if (value <= threshold / 2) return 0;
    if (value >= threshold * 1.5) return 1;
    
    // Linear interpolation between threshold/2 and threshold*1.5
    return (value - threshold / 2) / threshold;
  }

  /**
   * Determine alert level based on anomaly score
   */
  private determineAlertLevel(anomalyScore: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (anomalyScore >= ALERT_CONFIG.riskLevelThresholds.CRITICAL) return 'CRITICAL';
    if (anomalyScore >= ALERT_CONFIG.riskLevelThresholds.HIGH) return 'HIGH';
    if (anomalyScore >= ALERT_CONFIG.riskLevelThresholds.MEDIUM) return 'MEDIUM';
    if (anomalyScore >= ALERT_CONFIG.riskLevelThresholds.LOW) return 'LOW';
    return 'LOW';
  }

  /**
   * Get the agent ID for a strategy
   */
  private async getAgentIdForStrategy(strategyId: string): Promise<string | null> {
    const agentId = await this.redis.get(`strategy:agent:${strategyId}`);
    return agentId;
  }
} 