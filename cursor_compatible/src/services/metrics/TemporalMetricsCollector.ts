/**
 * Temporal Metrics Collector
 * 
 * Service responsible for collecting and aggregating trading metrics
 * for time-of-day analysis.
 */

import { FusionMemory } from '../../fusion/FusionMemory.js';
import { FusionState } from '../../types/fusion.types.js';
import { TemporalMetrics } from '../../types/temporal.types.js';
import { MicrostructureAnalyzer } from '../../infra/marketdata/MicrostructureAnalyzer.js';
import { TemporalRiskModel } from '../../models/TemporalRiskModel.js';

/**
 * Service for collecting time-based metrics from multiple sources
 */
export class TemporalMetricsCollector {
  /**
   * Create a new temporal metrics collector
   * @param fusionMemory Fusion memory for execution feedback
   * @param microAnalyzer Microstructure analyzer for market conditions
   * @param riskModel Risk model to store collected metrics
   */
  constructor(
    private readonly fusionMemory: FusionMemory,
    private readonly microAnalyzer: MicrostructureAnalyzer,
    private readonly riskModel: TemporalRiskModel
  ) {}

  /**
   * Start periodic metrics collection for an asset
   * @param asset Asset identifier
   * @param intervalMs Collection interval in milliseconds
   * @returns Function to stop collection
   */
  startCollection(asset: string, intervalMs: number = 60 * 60 * 1000): () => void {
    // Use setInterval for periodic collection
    const intervalId = setInterval(() => {
      this.collectMetrics(asset).catch(err => {
        console.error(`Error collecting temporal metrics for ${asset}:`, err);
      });
    }, intervalMs);
    
    // Collect initial metrics immediately
    this.collectMetrics(asset).catch(err => {
      console.error(`Error collecting initial temporal metrics for ${asset}:`, err);
    });
    
    // Return function to stop collection
    return () => clearInterval(intervalId);
  }
  
  /**
   * Collect metrics for an asset at the current time
   * @param asset Asset identifier
   */
  async collectMetrics(asset: string): Promise<void> {
    const now = new Date();
    const hourBucket = now.getUTCHours();
    
    // Get fusion state for execution feedback
    const fusionState = this.fusionMemory.get(asset);
    const executionFeedback = fusionState?.executionFeedback;
    const history = fusionState?.history;
    
    // Get microstructure metrics for market conditions
    const microMetrics = await this.microAnalyzer.analyze(asset);
    
    // Calculate alpha decay based on recent execution performance
    const alphaDecay = this.calculateAlphaDecay(fusionState);
    
    // Create temporal metrics object
    const metrics: TemporalMetrics = {
      timestamp: now.toISOString(),
      hourBucket,
      spreadAvg: microMetrics?.spreadPressure || 0,
      volatility: microMetrics?.quoteVolatility || 0,
      slippage: executionFeedback?.slippage || 0,
      alphaDecay,
      winRate: history?.averageFillRate || 0
    };
    
    // Record metrics in the risk model
    await this.riskModel.recordMetrics(asset, metrics);
    
    console.log(`Recorded temporal metrics for ${asset} at hour ${hourBucket}`);
  }
  
  /**
   * Calculate alpha decay based on fusion state
   * @param fusionState Current fusion state
   * @returns Alpha decay rate
   */
  private calculateAlphaDecay(fusionState?: FusionState): number {
    if (!fusionState?.strategyIntent || !fusionState.executionFeedback) {
      return 0;
    }
    
    const intent = fusionState.strategyIntent;
    const feedback = fusionState.executionFeedback;
    
    // Calculate time since strategy intent was established
    const intentAge = (Date.now() - intent.timestamp) / (1000 * 60); // in minutes
    
    // If intent is very recent, no significant decay
    if (intentAge < 5) return 0;
    
    // Use slippage and fill rate as proxies for how well the signal held up
    const slippageImpact = feedback.slippage / 100; // normalize to 0-1 range
    const fillRateQuality = 1 - feedback.fillRate; // invert so 0 is best
    
    // Weighted formula for decay - positive means signal is decaying
    return (slippageImpact * 0.6) + (fillRateQuality * 0.4) - (intent.confidence * 0.3);
  }
} 