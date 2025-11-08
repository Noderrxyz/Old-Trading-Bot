/**
 * Volume Analysis Model
 * 
 * Analyzes transaction volume patterns on blockchains to generate trading signals.
 * Looks for anomalies in transaction volumes, large transfers, and whale activity.
 */

import { BaseOnchainModel, OnchainModelConfig, OnchainModelInput, OnchainModelOutput } from './BaseModel.js';
import { exponentialMovingAverage } from '../utils/statistics.js';

/**
 * Configuration for volume analysis model
 */
export interface VolumeAnalysisConfig extends OnchainModelConfig {
  parameters: {
    // Volume metrics
    volumeWindowSize: number;
    whaleThreshold: number;
    volumeSpikeThreshold: number;
    
    // EMA periods
    shortPeriod: number;
    longPeriod: number;
    
    // Signal generation
    minVolumeForSignal: number;
  };
}

/**
 * Default configuration values
 */
const DEFAULT_VOLUME_PARAMS = {
  volumeWindowSize: 24, // 24 data points
  whaleThreshold: 1000000, // $1M in base currency
  volumeSpikeThreshold: 2.5, // 2.5x normal volume
  shortPeriod: 12,
  longPeriod: 24,
  minVolumeForSignal: 500000 // $500k minimum volume
};

/**
 * Implements volume-based onchain signals
 */
export class VolumeAnalysisModel extends BaseOnchainModel {
  // Historical data cache for EMA calculations
  private volumeHistory: Map<string, number[]> = new Map();
  
  /**
   * Create a new volume analysis model
   */
  constructor(config: VolumeAnalysisConfig) {
    // Merge the provided parameters with default values
    const mergedParams = {
      ...DEFAULT_VOLUME_PARAMS,
      ...(config.parameters || {})
    };
    
    // Create the complete config with merged parameters
    super({
      ...config,
      parameters: mergedParams
    });
  }
  
  /**
   * Process blockchain volume data and generate signals
   */
  async processInput(input: OnchainModelInput): Promise<OnchainModelOutput | null> {
    // Validate input
    if (!this.validateInput(input)) {
      return null;
    }
    
    // Extract relevant metrics
    const { 
      transactionVolume, 
      largeTransfers, 
      averageTransactionSize,
      netExchangeFlow,
      uniqueActiveAddresses
    } = this.extractVolumeMetrics(input);
    
    // Update volume history
    this.updateVolumeHistory(input.asset, transactionVolume);
    
    // Calculate volume indicators
    const volumeIndicators = this.calculateVolumeIndicators(
      input.asset, 
      transactionVolume,
      largeTransfers,
      netExchangeFlow
    );
    
    // Generate signal based on volume indicators
    const { signal, confidence, alerts } = this.generateVolumeSignal(volumeIndicators);
    
    // If confidence is below threshold, don't generate a signal
    if (confidence < this.config.minConfidenceThreshold) {
      return null;
    }
    
    // Create and return the signal output
    return this.createOutput(
      input,
      signal,
      confidence,
      ['transactionVolume', 'largeTransfers', 'netExchangeFlow', 'averageTransactionSize', 'uniqueActiveAddresses']
    );
  }
  
  /**
   * Extract volume-related metrics from input data
   */
  private extractVolumeMetrics(input: OnchainModelInput) {
    const metrics = input.metrics;
    
    return {
      transactionVolume: metrics.transactionVolume || 0,
      largeTransfers: metrics.largeTransfers || 0,
      averageTransactionSize: metrics.averageTransactionSize || 0,
      netExchangeFlow: metrics.netExchangeFlow || 0,
      uniqueActiveAddresses: metrics.uniqueActiveAddresses || 0
    };
  }
  
  /**
   * Update volume history for a specific asset
   */
  private updateVolumeHistory(asset: string, volume: number) {
    const history = this.volumeHistory.get(asset) || [];
    
    // Add current volume to history
    history.push(volume);
    
    // Keep only the most recent data points
    const windowSize = (this.config.parameters as VolumeAnalysisConfig['parameters']).volumeWindowSize;
    if (history.length > windowSize * 2) {
      history.splice(0, history.length - windowSize * 2);
    }
    
    this.volumeHistory.set(asset, history);
  }
  
  /**
   * Calculate volume-based indicators
   */
  private calculateVolumeIndicators(
    asset: string, 
    volume: number,
    largeTransfers: number,
    netExchangeFlow: number
  ) {
    const history = this.volumeHistory.get(asset) || [];
    const params = this.config.parameters as VolumeAnalysisConfig['parameters'];
    
    // Calculate EMAs if enough data points
    let shortEMA = 0;
    let longEMA = 0;
    
    if (history.length >= params.longPeriod) {
      shortEMA = exponentialMovingAverage(history, params.shortPeriod);
      longEMA = exponentialMovingAverage(history, params.longPeriod);
    }
    
    // Volume relative to recent average (detect spikes)
    const recentAvgVolume = history.length >= 7 
      ? history.slice(-7).reduce((sum, vol) => sum + vol, 0) / Math.min(7, history.length)
      : volume;
    
    const volumeRatio = volume / Math.max(1, recentAvgVolume);
    const isVolumeSpike = volumeRatio > params.volumeSpikeThreshold;
    
    // Net flow direction (positive = inflow, negative = outflow)
    const flowDirection = Math.sign(netExchangeFlow);
    
    // Volume trend from EMA
    const emaTrend = shortEMA > longEMA ? 1 : (shortEMA < longEMA ? -1 : 0);
    
    return {
      currentVolume: volume,
      shortEMA,
      longEMA,
      volumeRatio,
      isVolumeSpike,
      largeTransfers,
      netExchangeFlow,
      flowDirection,
      emaTrend
    };
  }
  
  /**
   * Generate a signal based on volume indicators
   */
  private generateVolumeSignal(indicators: any) {
    const params = this.config.parameters as VolumeAnalysisConfig['parameters'];
    const alerts = [];
    
    // Base confidence starts at 0.5
    let confidence = 0.5;
    
    // Start with neutral signal
    let signal = 0;
    
    // Detect volume spike with large transfers
    if (indicators.isVolumeSpike && indicators.largeTransfers > 0) {
      // Volume spike with outflows is often bearish
      if (indicators.flowDirection < 0) {
        signal -= 0.4;
        confidence += 0.15;
        alerts.push({
          type: 'VOLUME_SPIKE_OUTFLOW',
          severity: 'high',
          message: 'Volume spike with significant outflows detected'
        });
      } 
      // Volume spike with inflows is often bullish
      else if (indicators.flowDirection > 0) {
        signal += 0.4;
        confidence += 0.15;
        alerts.push({
          type: 'VOLUME_SPIKE_INFLOW',
          severity: 'high',
          message: 'Volume spike with significant inflows detected'
        });
      }
    }
    
    // EMA crossovers can confirm trends
    if (indicators.emaTrend !== 0 && indicators.currentVolume > params.minVolumeForSignal) {
      // Add to the signal in the direction of the trend
      signal += 0.2 * indicators.emaTrend;
      confidence += 0.1;
      
      if (indicators.emaTrend > 0) {
        alerts.push({
          type: 'VOLUME_EMA_BULLISH',
          severity: 'medium',
          message: 'Volume EMA indicates increasing activity'
        });
      } else {
        alerts.push({
          type: 'VOLUME_EMA_BEARISH',
          severity: 'medium',
          message: 'Volume EMA indicates decreasing activity'
        });
      }
    }
    
    // Whale activity can be a strong signal
    if (Math.abs(indicators.netExchangeFlow) > params.whaleThreshold) {
      // Strong inflows are bullish
      if (indicators.netExchangeFlow > 0) {
        signal += 0.3;
        confidence += 0.15;
        alerts.push({
          type: 'LARGE_INFLOW',
          severity: 'high',
          message: 'Large inflows to exchanges detected'
        });
      } 
      // Strong outflows can be bullish (moving to private wallets for holding)
      else {
        signal += 0.2;
        confidence += 0.1;
        alerts.push({
          type: 'LARGE_OUTFLOW',
          severity: 'medium',
          message: 'Large outflows from exchanges detected'
        });
      }
    }
    
    // Ensure signal is between -1 and 1
    signal = Math.max(-1, Math.min(1, signal));
    
    // Ensure confidence is between 0 and 1
    confidence = Math.max(0, Math.min(1, confidence));
    
    return {
      signal,
      confidence,
      alerts
    };
  }
  
  /**
   * Override validation to ensure we have required volume metrics
   */
  protected validateInput(input: OnchainModelInput): boolean {
    if (!super.validateInput(input)) {
      return false;
    }
    
    // Check for required volume metrics
    const requiredMetrics = ['transactionVolume'];
    
    for (const metric of requiredMetrics) {
      if (input.metrics[metric] === undefined) {
        return false;
      }
    }
    
    return true;
  }
} 