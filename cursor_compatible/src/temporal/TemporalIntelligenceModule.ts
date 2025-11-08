/**
 * Temporal Intelligence Module
 * 
 * Provides a centralized access point for time-of-day based intelligence
 * and coordinates the collection and application of temporal patterns.
 */

import { FusionMemory } from '../fusion/FusionMemory.js';
import { MicrostructureAnalyzer } from '../infra/marketdata/MicrostructureAnalyzer.js';
import { TemporalMetricsStore } from '../services/metrics/TemporalMetricsStore.js';
import { TemporalMetricsCollector } from '../services/metrics/TemporalMetricsCollector.js';
import { TemporalRiskModel } from '../models/TemporalRiskModel.js';

/**
 * Configuration for the temporal intelligence module
 */
export interface TemporalIntelligenceConfig {
  // Collection interval in milliseconds
  collectionIntervalMs: number;
  
  // Maximum age of metrics to keep
  maxMetricsAgeMs: number;
  
  // Assets to track
  trackedAssets: string[];
  
  // Whether to enable time-of-day adaptations
  enableAdaptation: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TemporalIntelligenceConfig = {
  collectionIntervalMs: 60 * 60 * 1000, // 1 hour
  maxMetricsAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  trackedAssets: [],
  enableAdaptation: true
};

/**
 * Module for managing temporal intelligence across the system
 */
export class TemporalIntelligenceModule {
  private readonly metricsStore: TemporalMetricsStore;
  private readonly riskModel: TemporalRiskModel;
  private readonly metricsCollector: TemporalMetricsCollector;
  private collectionStopFunctions: Map<string, () => void> = new Map();
  
  /**
   * Create a new temporal intelligence module
   * @param fusionMemory Fusion memory system
   * @param microAnalyzer Microstructure analyzer
   * @param config Module configuration
   */
  constructor(
    private readonly fusionMemory: FusionMemory,
    private readonly microAnalyzer: MicrostructureAnalyzer,
    private readonly config: TemporalIntelligenceConfig = DEFAULT_CONFIG
  ) {
    // Initialize components
    this.metricsStore = new TemporalMetricsStore();
    this.riskModel = new TemporalRiskModel(this.metricsStore);
    this.metricsCollector = new TemporalMetricsCollector(
      fusionMemory,
      microAnalyzer,
      this.riskModel
    );
  }
  
  /**
   * Start collecting temporal metrics for configured assets
   */
  start(): void {
    // Start collection for each tracked asset
    for (const asset of this.config.trackedAssets) {
      const stopFn = this.metricsCollector.startCollection(
        asset,
        this.config.collectionIntervalMs
      );
      
      this.collectionStopFunctions.set(asset, stopFn);
      console.log(`Started temporal metrics collection for ${asset}`);
    }
    
    // Schedule regular pruning of old metrics
    setInterval(() => {
      this.pruneOldMetrics().catch(err => {
        console.error('Error pruning old metrics:', err);
      });
    }, 24 * 60 * 60 * 1000); // Daily
    
    console.log('Temporal intelligence module started');
  }
  
  /**
   * Stop collecting temporal metrics
   */
  stop(): void {
    // Stop all collection processes
    for (const [asset, stopFn] of this.collectionStopFunctions.entries()) {
      stopFn();
      console.log(`Stopped temporal metrics collection for ${asset}`);
    }
    
    this.collectionStopFunctions.clear();
    console.log('Temporal intelligence module stopped');
  }
  
  /**
   * Add a new asset to track
   * @param asset Asset identifier
   */
  addTrackedAsset(asset: string): void {
    if (this.collectionStopFunctions.has(asset)) {
      return; // Already tracking
    }
    
    const stopFn = this.metricsCollector.startCollection(
      asset,
      this.config.collectionIntervalMs
    );
    
    this.collectionStopFunctions.set(asset, stopFn);
    this.config.trackedAssets.push(asset);
    console.log(`Added ${asset} to temporal intelligence tracking`);
  }
  
  /**
   * Remove an asset from tracking
   * @param asset Asset identifier
   */
  removeTrackedAsset(asset: string): void {
    const stopFn = this.collectionStopFunctions.get(asset);
    if (stopFn) {
      stopFn();
      this.collectionStopFunctions.delete(asset);
      
      const index = this.config.trackedAssets.indexOf(asset);
      if (index !== -1) {
        this.config.trackedAssets.splice(index, 1);
      }
      
      console.log(`Removed ${asset} from temporal intelligence tracking`);
    }
  }
  
  /**
   * Get the risk model for use by other components
   * @returns Temporal risk model
   */
  getRiskModel(): TemporalRiskModel {
    return this.riskModel;
  }
  
  /**
   * Get whether time-of-day adaptations are enabled
   * @returns True if adaptations are enabled
   */
  isAdaptationEnabled(): boolean {
    return this.config.enableAdaptation;
  }
  
  /**
   * Enable time-of-day adaptations
   */
  enableAdaptation(): void {
    this.config.enableAdaptation = true;
    console.log('Time-of-day adaptations enabled');
  }
  
  /**
   * Disable time-of-day adaptations
   */
  disableAdaptation(): void {
    this.config.enableAdaptation = false;
    console.log('Time-of-day adaptations disabled');
  }
  
  /**
   * Remove metrics older than the configured maximum age
   */
  private async pruneOldMetrics(): Promise<void> {
    for (const asset of this.config.trackedAssets) {
      await this.metricsStore.pruneOldMetrics(asset, this.config.maxMetricsAgeMs);
    }
    console.log('Pruned old temporal metrics');
  }
} 