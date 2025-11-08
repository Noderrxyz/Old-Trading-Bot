import { createLogger } from '../common/logger.js';
import { 
  TargetFrame,
  FeatureQualityMetrics,
  QualityReport,
  FeatureMonitoringConfig,
  DEFAULT_FEATURE_MONITORING_CONFIG
} from './types/feature_quality.types.js';
import { ExpandedFeatureFrame } from './types/feature.types.js';

/**
 * Monitors the quality and predictive power of features over time
 */
export class FeatureQualityMonitor {
  private readonly logger = createLogger('FeatureQualityMonitor');
  
  // Feature history by symbol
  private readonly featureHistory: Map<string, ExpandedFeatureFrame[]> = new Map();
  
  // Target returns history by symbol
  private readonly targetHistory: Map<string, TargetFrame[]> = new Map();
  
  // Feature quality metrics by symbol
  private readonly qualityMetrics: Map<string, Record<string, FeatureQualityMetrics>> = new Map();
  
  constructor(
    private readonly config: FeatureMonitoringConfig = DEFAULT_FEATURE_MONITORING_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Feature quality monitoring is disabled');
    }
  }
  
  /**
   * Update feature and target data
   * @param featureFrame Feature frame
   * @param targetFrame Target returns frame
   */
  public update(featureFrame: ExpandedFeatureFrame, targetFrame: TargetFrame): void {
    if (!this.config.enabled) return;
    
    try {
      // Update feature history
      let featureHistory = this.featureHistory.get(featureFrame.symbol);
      if (!featureHistory) {
        featureHistory = [];
        this.featureHistory.set(featureFrame.symbol, featureHistory);
      }
      
      featureHistory.push(featureFrame);
      if (featureHistory.length > this.config.windowSize) {
        featureHistory.shift();
      }
      
      // Update target history
      let targetHistory = this.targetHistory.get(targetFrame.symbol);
      if (!targetHistory) {
        targetHistory = [];
        this.targetHistory.set(targetFrame.symbol, targetHistory);
      }
      
      targetHistory.push(targetFrame);
      if (targetHistory.length > this.config.windowSize) {
        targetHistory.shift();
      }
      
      this.logger.debug(`Updated feature and target data for ${featureFrame.symbol}`);
    } catch (error) {
      this.logger.error(`Error updating feature quality data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Evaluate feature quality
   * @param symbol Asset symbol
   * @returns Quality report
   */
  public evaluateQuality(symbol: string): QualityReport | null {
    if (!this.config.enabled) return null;
    
    try {
      const featureHistory = this.featureHistory.get(symbol);
      const targetHistory = this.targetHistory.get(symbol);
      
      if (!featureHistory || !targetHistory || 
          featureHistory.length < this.config.minSamples || 
          targetHistory.length < this.config.minSamples) {
        this.logger.debug(`Insufficient data for quality evaluation of ${symbol}`);
        return null;
      }
      
      const featureScores: Record<string, FeatureQualityMetrics> = {};
      const flaggedFeatures: string[] = [];
      
      // Get feature names from the latest frame
      const featureNames = Object.keys(featureHistory[featureHistory.length - 1].features);
      
      for (const featureName of featureNames) {
        const metrics = this.computeFeatureMetrics(featureHistory, targetHistory, featureName);
        featureScores[featureName] = metrics;
        
        // Check if feature should be flagged
        if (this.shouldFlagFeature(metrics)) {
          flaggedFeatures.push(featureName);
        }
      }
      
      // Update quality metrics
      this.qualityMetrics.set(symbol, featureScores);
      
      return {
        symbol,
        timestamp: Date.now(),
        featureScores,
        flaggedFeatures
      };
    } catch (error) {
      this.logger.error(`Error evaluating feature quality: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Mark features for removal based on quality thresholds
   * @param symbol Asset symbol
   * @param threshold Quality threshold
   * @returns List of features to remove
   */
  public markFeaturesForRemoval(symbol: string, threshold: number = 0.05): string[] {
    if (!this.config.enabled) return [];
    
    try {
      const metrics = this.qualityMetrics.get(symbol);
      if (!metrics) return [];
      
      return Object.entries(metrics)
        .filter(([_, m]) => 
          Math.abs(m.ic) < threshold || 
          Math.abs(m.correlation) < threshold || 
          m.drift > this.config.driftThreshold
        )
        .map(([name]) => name);
    } catch (error) {
      this.logger.error(`Error marking features for removal: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Compute feature quality metrics
   */
  private computeFeatureMetrics(
    featureHistory: ExpandedFeatureFrame[],
    targetHistory: TargetFrame[],
    featureName: string
  ): FeatureQualityMetrics {
    // Extract feature values and target returns
    const featureValues = featureHistory.map(f => f.features[featureName as keyof typeof f.features]);
    const targetReturns = targetHistory.map(t => t.returns.m15); // Using 15-min returns
    
    // Compute metrics
    const ic = this.computeInformationCoefficient(featureValues, targetReturns);
    const correlation = this.computeCorrelation(featureValues, targetReturns);
    const drift = this.computeFeatureDrift(featureValues);
    
    return {
      ic,
      correlation,
      drift,
      lastUpdate: Date.now()
    };
  }
  
  /**
   * Compute information coefficient (rank correlation)
   */
  private computeInformationCoefficient(featureValues: number[], targetReturns: number[]): number {
    if (featureValues.length !== targetReturns.length || featureValues.length < 2) {
      return 0;
    }
    
    // Rank the values
    const featureRanks = this.rankValues(featureValues);
    const targetRanks = this.rankValues(targetReturns);
    
    // Compute Spearman correlation
    return this.computeCorrelation(featureRanks, targetRanks);
  }
  
  /**
   * Compute Pearson correlation
   */
  private computeCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) {
      return 0;
    }
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
    const sumY2 = y.reduce((sum, val) => sum + val * val, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator !== 0 ? numerator / denominator : 0;
  }
  
  /**
   * Compute feature drift
   */
  private computeFeatureDrift(values: number[]): number {
    if (values.length < 2) return 0;
    
    // Split into historical and recent windows
    const splitPoint = Math.floor(values.length / 2);
    const historical = values.slice(0, splitPoint);
    const recent = values.slice(splitPoint);
    
    // Compute means and standard deviations
    const histMean = historical.reduce((sum, v) => sum + v, 0) / historical.length;
    const histStd = this.computeStandardDeviation(historical);
    const recentMean = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    
    // Compute drift as percentage of historical standard deviation
    return histStd !== 0 ? Math.abs(recentMean - histMean) / histStd * 100 : 0;
  }
  
  /**
   * Rank values
   */
  private rankValues(values: number[]): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    return values.map(v => sorted.indexOf(v) + 1);
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
  
  /**
   * Check if feature should be flagged
   */
  private shouldFlagFeature(metrics: FeatureQualityMetrics): boolean {
    return (
      Math.abs(metrics.ic) < this.config.icThreshold ||
      Math.abs(metrics.correlation) < this.config.correlationThreshold ||
      metrics.drift > this.config.driftThreshold
    );
  }
} 