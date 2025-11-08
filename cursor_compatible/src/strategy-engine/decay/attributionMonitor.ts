/**
 * Attribution Monitor
 * 
 * Tracks feature weight decay in strategy signals to detect when certain
 * components of a strategy are becoming less predictive over time.
 */

import { createLogger } from '../../common/logger.js';
import { RedisClient } from '../../common/redis.js';

const logger = createLogger('AttributionMonitor');

/**
 * Feature attribution for a strategy
 */
export interface FeatureAttribution {
  // Feature name (e.g., 'price', 'volume', 'sentiment', 'on-chain')
  feature: string;
  
  // Weight or contribution of this feature (0-1)
  weight: number;
  
  // Effectiveness score (how well it's performing) (0-1)
  effectiveness: number;
  
  // Stability score (how consistent it is) (0-1)
  stability: number;
}

/**
 * Attribution snapshot at a point in time
 */
export interface AttributionSnapshot {
  // Strategy ID
  strategyId: string;
  
  // Timestamp when this snapshot was taken
  timestamp: number;
  
  // Overall signal contribution score (0-1)
  signalContribution: number;
  
  // Feature attributions
  features: FeatureAttribution[];
  
  // Average feature effectiveness
  avgEffectiveness: number;
  
  // Average feature stability
  avgStability: number;
  
  // Correlation between predicted and actual outcomes
  predictionCorrelation: number;
}

/**
 * Attribution monitor configuration
 */
export interface AttributionMonitorConfig {
  // Redis key TTL in seconds
  attributionTtlSeconds: number;
  
  // Number of snapshots to keep in history
  maxHistorySize: number;
  
  // Minimum weight for a feature to be considered significant
  minSignificantWeight: number;
  
  // Threshold for detecting feature effectiveness decline
  effectivenessDeclineThreshold: number;
  
  // Threshold for detecting feature stability decline 
  stabilityDeclineThreshold: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AttributionMonitorConfig = {
  attributionTtlSeconds: 60 * 60 * 24 * 30, // 30 days
  maxHistorySize: 30,
  minSignificantWeight: 0.1,
  effectivenessDeclineThreshold: 0.25, // 25% decline
  stabilityDeclineThreshold: 0.3 // 30% decline
};

/**
 * Feature decay analysis result
 */
export interface FeatureDecayResult {
  feature: string;
  isDecaying: boolean;
  decayPercent: number;
  currentEffectiveness: number;
  previousEffectiveness: number;
  stabilityChange: number;
  weightTrend: 'increasing' | 'stable' | 'decreasing';
}

/**
 * Overall attribution decay analysis
 */
export interface AttributionDecayAnalysis {
  strategyId: string;
  timestamp: number;
  overallDecayDetected: boolean;
  significantFeatures: string[];
  decayingFeatures: string[];
  featureResults: FeatureDecayResult[];
  improvingFeatures: string[];
  recentPredictionCorrelation: number;
  overallEffectivenessDecline: number;
}

/**
 * Monitors feature attribution and detects decay
 */
export class AttributionMonitor {
  private redis: RedisClient;
  private config: AttributionMonitorConfig;
  
  /**
   * Create a new attribution monitor
   */
  constructor(redis: RedisClient, config: Partial<AttributionMonitorConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Track a new attribution snapshot
   * @param snapshot Attribution snapshot
   */
  public async trackAttribution(snapshot: AttributionSnapshot): Promise<void> {
    try {
      const key = `strategy_attribution:${snapshot.strategyId}`;
      const historyKey = `strategy_attribution_history:${snapshot.strategyId}`;
      
      // Store current snapshot
      await this.redis.hset(key, {
        timestamp: snapshot.timestamp,
        signalContribution: snapshot.signalContribution.toFixed(4),
        features: JSON.stringify(snapshot.features),
        avgEffectiveness: snapshot.avgEffectiveness.toFixed(4),
        avgStability: snapshot.avgStability.toFixed(4),
        predictionCorrelation: snapshot.predictionCorrelation.toFixed(4)
      });
      
      // Add to history list
      await this.redis.lpush(historyKey, JSON.stringify(snapshot));
      
      // Trim history to maximum size
      await this.redis.ltrim(historyKey, 0, this.config.maxHistorySize - 1);
      
      // Set expiry
      await this.redis.expire(key, this.config.attributionTtlSeconds);
      await this.redis.expire(historyKey, this.config.attributionTtlSeconds);
      
      logger.debug(`Tracked attribution for strategy ${snapshot.strategyId}`);
    } catch (error) {
      logger.error(`Failed to track attribution: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the latest attribution snapshot for a strategy
   * @param strategyId Strategy ID
   * @returns Latest attribution snapshot or null if not found
   */
  public async getLatestAttribution(strategyId: string): Promise<AttributionSnapshot | null> {
    try {
      const key = `strategy_attribution:${snapshot.strategyId}`;
      const data = await this.redis.hgetall(key);
      
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      
      return {
        strategyId,
        timestamp: parseInt(data.timestamp, 10),
        signalContribution: parseFloat(data.signalContribution),
        features: JSON.parse(data.features),
        avgEffectiveness: parseFloat(data.avgEffectiveness),
        avgStability: parseFloat(data.avgStability),
        predictionCorrelation: parseFloat(data.predictionCorrelation)
      };
    } catch (error) {
      logger.error(`Failed to get latest attribution: ${error}`);
      return null;
    }
  }
  
  /**
   * Get attribution history for a strategy
   * @param strategyId Strategy ID
   * @param limit Maximum number of history items to return
   * @returns Array of attribution snapshots
   */
  public async getAttributionHistory(
    strategyId: string,
    limit: number = this.config.maxHistorySize
  ): Promise<AttributionSnapshot[]> {
    try {
      const historyKey = `strategy_attribution_history:${strategyId}`;
      const data = await this.redis.lrange(historyKey, 0, limit - 1);
      
      if (!data || data.length === 0) {
        return [];
      }
      
      return data.map(item => JSON.parse(item));
    } catch (error) {
      logger.error(`Failed to get attribution history: ${error}`);
      return [];
    }
  }
  
  /**
   * Analyze feature decay for a strategy
   * @param strategyId Strategy ID
   * @returns Analysis of feature decay
   */
  public async analyzeFeatureDecay(strategyId: string): Promise<AttributionDecayAnalysis | null> {
    try {
      // Get attribution history
      const history = await this.getAttributionHistory(strategyId, 10);
      
      if (history.length < 2) {
        logger.debug(`Insufficient history for strategy ${strategyId} to analyze decay`);
        return null;
      }
      
      // Most recent snapshot
      const current = history[0];
      
      // Previous snapshot for comparison (avg of older snapshots for stability)
      const previousSnapshots = history.slice(1);
      const previous = this.computeAverageSnapshot(previousSnapshots);
      
      // Analyze each significant feature
      const featureResults: FeatureDecayResult[] = [];
      const decayingFeatures: string[] = [];
      const improvingFeatures: string[] = [];
      
      // Get all unique feature names from current and previous
      const allFeatures = new Set<string>();
      current.features.forEach(f => allFeatures.add(f.feature));
      previous.features.forEach(f => allFeatures.add(f.feature));
      
      // Analyze each feature
      for (const featureName of allFeatures) {
        const currentFeature = current.features.find(f => f.feature === featureName);
        const previousFeature = previous.features.find(f => f.feature === featureName);
        
        // Skip if feature doesn't exist in both snapshots
        if (!currentFeature || !previousFeature) continue;
        
        // Skip features with insignificant weight
        if (currentFeature.weight < this.config.minSignificantWeight && 
            previousFeature.weight < this.config.minSignificantWeight) {
          continue;
        }
        
        // Calculate decay percentage
        const effectivenessChange = currentFeature.effectiveness - previousFeature.effectiveness;
        const effectivenessDecayPct = effectivenessChange < 0 
          ? (Math.abs(effectivenessChange) / Math.max(0.01, previousFeature.effectiveness)) * 100
          : 0;
        
        const stabilityChange = currentFeature.stability - previousFeature.stability;
        
        // Determine weight trend
        const weightChange = currentFeature.weight - previousFeature.weight;
        let weightTrend: 'increasing' | 'stable' | 'decreasing' = 'stable';
        if (weightChange > 0.05) weightTrend = 'increasing';
        else if (weightChange < -0.05) weightTrend = 'decreasing';
        
        // Determine if feature is decaying
        const isDecaying = effectivenessDecayPct >= this.config.effectivenessDeclineThreshold ||
                         (stabilityChange < 0 && Math.abs(stabilityChange) >= this.config.stabilityDeclineThreshold);
        
        const result: FeatureDecayResult = {
          feature: featureName,
          isDecaying,
          decayPercent: effectivenessDecayPct,
          currentEffectiveness: currentFeature.effectiveness,
          previousEffectiveness: previousFeature.effectiveness,
          stabilityChange,
          weightTrend
        };
        
        featureResults.push(result);
        
        if (isDecaying) {
          decayingFeatures.push(featureName);
        } else if (effectivenessChange > 0.1) {
          improvingFeatures.push(featureName);
        }
      }
      
      // Calculate overall effectiveness decline
      const overallEffectivenessDecline = previous.avgEffectiveness > 0
        ? (previous.avgEffectiveness - current.avgEffectiveness) / previous.avgEffectiveness
        : 0;
      
      // Determine significant features (weight >= minSignificantWeight)
      const significantFeatures = current.features
        .filter(f => f.weight >= this.config.minSignificantWeight)
        .map(f => f.feature);
      
      return {
        strategyId,
        timestamp: Date.now(),
        overallDecayDetected: decayingFeatures.length > 0 || overallEffectivenessDecline > 0.2,
        significantFeatures,
        decayingFeatures,
        featureResults,
        improvingFeatures,
        recentPredictionCorrelation: current.predictionCorrelation,
        overallEffectivenessDecline
      };
    } catch (error) {
      logger.error(`Failed to analyze feature decay: ${error}`);
      return null;
    }
  }
  
  /**
   * Compute the average snapshot from a list of snapshots
   * @param snapshots List of attribution snapshots
   * @returns Average snapshot
   */
  private computeAverageSnapshot(snapshots: AttributionSnapshot[]): AttributionSnapshot {
    if (snapshots.length === 0) {
      throw new Error('Cannot compute average from empty snapshot list');
    }
    
    if (snapshots.length === 1) {
      return snapshots[0];
    }
    
    // Collect all unique feature names
    const featureMap = new Map<string, FeatureAttribution[]>();
    let totalSignalContribution = 0;
    let totalEffectiveness = 0;
    let totalStability = 0;
    let totalCorrelation = 0;
    
    // Group by feature
    snapshots.forEach(snapshot => {
      totalSignalContribution += snapshot.signalContribution;
      totalEffectiveness += snapshot.avgEffectiveness;
      totalStability += snapshot.avgStability;
      totalCorrelation += snapshot.predictionCorrelation;
      
      snapshot.features.forEach(feature => {
        if (!featureMap.has(feature.feature)) {
          featureMap.set(feature.feature, []);
        }
        
        featureMap.get(feature.feature)!.push(feature);
      });
    });
    
    // Average each feature
    const averagedFeatures: FeatureAttribution[] = [];
    
    featureMap.forEach((featureList, featureName) => {
      const avgFeature: FeatureAttribution = {
        feature: featureName,
        weight: 0,
        effectiveness: 0,
        stability: 0
      };
      
      // Sum values
      featureList.forEach(f => {
        avgFeature.weight += f.weight;
        avgFeature.effectiveness += f.effectiveness;
        avgFeature.stability += f.stability;
      });
      
      // Compute averages
      avgFeature.weight /= featureList.length;
      avgFeature.effectiveness /= featureList.length;
      avgFeature.stability /= featureList.length;
      
      averagedFeatures.push(avgFeature);
    });
    
    return {
      strategyId: snapshots[0].strategyId,
      timestamp: Math.round(snapshots.reduce((sum, s) => sum + s.timestamp, 0) / snapshots.length),
      signalContribution: totalSignalContribution / snapshots.length,
      features: averagedFeatures,
      avgEffectiveness: totalEffectiveness / snapshots.length,
      avgStability: totalStability / snapshots.length,
      predictionCorrelation: totalCorrelation / snapshots.length
    };
  }
  
  /**
   * Update configuration
   * @param newConfig New configuration settings
   */
  public updateConfig(newConfig: Partial<AttributionMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`Attribution monitor config updated: ${JSON.stringify(newConfig)}`);
  }
} 