/**
 * Base Model for Onchain Signals
 * 
 * Defines the core interfaces and abstract classes for onchain signal models
 */

import { ChainAlpha } from '../../strategies/alpha/blend.js';

/**
 * Configuration options for onchain signal models
 */
export interface OnchainModelConfig {
  // Base configuration options
  name: string;
  version: string;
  
  // Model-specific parameters
  parameters: Record<string, any>;
  
  // Thresholds for signal generation
  minConfidenceThreshold: number;
  signalThreshold: number;
  
  // Feature weights for different metrics
  featureWeights?: Record<string, number>;
}

/**
 * Input data for onchain signal models
 */
export interface OnchainModelInput {
  // Asset identifier (token/coin symbol)
  asset: string;
  
  // Timestamp of the data
  timestamp: string;
  
  // Raw blockchain metrics
  metrics: Record<string, number>;
  
  // Optional context data
  context?: Record<string, any>;
}

/**
 * Output from onchain signal models
 */
export interface OnchainModelOutput extends ChainAlpha {
  // Model metadata
  modelName: string;
  modelVersion: string;
  
  // Prediction details
  predictionTimestamp: string;
  processedMetrics: string[];
  
  // Alert flags if any anomalies detected
  alerts?: {
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }[];
}

/**
 * Abstract base class for all onchain signal models
 */
export abstract class BaseOnchainModel {
  protected config: OnchainModelConfig;
  
  constructor(config: OnchainModelConfig) {
    this.config = {
      ...config,
      // Default parameters if not provided
      minConfidenceThreshold: config.minConfidenceThreshold || 0.6,
      signalThreshold: config.signalThreshold || 0.2
    };
  }
  
  /**
   * Process input data and generate signals
   * @param input The onchain data input
   * @returns A signal output or null if confidence is too low
   */
  abstract processInput(input: OnchainModelInput): Promise<OnchainModelOutput | null>;
  
  /**
   * Validate the input data before processing
   * @param input The input data to validate
   * @returns true if valid, false otherwise
   */
  protected validateInput(input: OnchainModelInput): boolean {
    // Basic validation
    if (!input.asset || !input.timestamp || !input.metrics) {
      return false;
    }
    
    // Check if required metrics are available (to be implemented by subclasses)
    return true;
  }
  
  /**
   * Create a base output structure
   * @param input The input data
   * @param signal The calculated signal value (-1.0 to 1.0)
   * @param confidence The confidence level (0.0 to 1.0)
   * @returns A structured output object
   */
  protected createOutput(
    input: OnchainModelInput, 
    signal: number, 
    confidence: number,
    processedMetrics: string[]
  ): OnchainModelOutput {
    return {
      asset: input.asset,
      timestamp: input.timestamp,
      signal: signal,
      confidence: confidence,
      type: 'chain',
      metrics: input.metrics,
      modelName: this.config.name,
      modelVersion: this.config.version,
      predictionTimestamp: new Date().toISOString(),
      processedMetrics
    };
  }
  
  /**
   * Get the model configuration
   * @returns The current model configuration
   */
  getConfig(): OnchainModelConfig {
    return this.config;
  }
  
  /**
   * Update the model configuration
   * @param newConfig Updated configuration values
   */
  updateConfig(newConfig: Partial<OnchainModelConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      parameters: {
        ...this.config.parameters,
        ...(newConfig.parameters || {})
      }
    };
  }
} 