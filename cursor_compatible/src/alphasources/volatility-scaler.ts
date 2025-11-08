/**
 * Volatility-Aware Signal Scaler
 * 
 * Dynamically scales the strength of fused signals (confidence and size)
 * based on real-time market volatility.
 */

import { FusedAlphaFrame } from './fusion-engine.js';
import { createLogger } from '../common/logger.js';

/**
 * Configuration for the Volatility Scaler
 */
export interface VolatilityScalerConfig {
  /** Whether volatility scaling is enabled */
  enabled: boolean;
  
  /** Maximum volatility value (e.g., 0.10 = 10%) */
  maxVolatility: number;
  
  /** Minimum position size after scaling */
  minSize: number;
  
  /** Maximum position size after scaling */
  maxSize: number;
  
  /** Scaling curve parameter (1 = linear, >1 = more aggressive at higher volatilities) */
  scalingExponent: number;
  
  /** Whether to also scale confidence */
  scaleConfidence: boolean;
  
  /** Log detailed calculations */
  logDetailedCalculations: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: VolatilityScalerConfig = {
  enabled: true,
  maxVolatility: 0.10, // 10%
  minSize: 0.05,
  maxSize: 1.0,
  scalingExponent: 1.2, // Slightly more aggressive at higher volatilities
  scaleConfidence: false,
  logDetailedCalculations: false
};

/**
 * Volatility Scaler for adjusting signal size based on market conditions
 */
export class VolatilityScaler {
  private readonly logger;
  private readonly config: VolatilityScalerConfig;
  
  /**
   * Create a new Volatility Scaler
   * @param config Scaler configuration
   */
  constructor(config: Partial<VolatilityScalerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('VolatilityScaler');
    
    this.logger.info('Volatility Scaler initialized');
  }
  
  /**
   * Scale a fused alpha signal based on market volatility
   * @param alpha Fused alpha signal
   * @param volatility Market volatility (e.g., 0.02 = 2%)
   * @returns Scaled alpha signal
   */
  public scaleSignal(alpha: FusedAlphaFrame, volatility: number): FusedAlphaFrame {
    if (!this.config.enabled) {
      return alpha;
    }
    
    // Clamp volatility to be at least a small positive value to avoid division issues
    const clampedVolatility = Math.max(0.0001, volatility);
    
    // Calculate volatility factor (0-1 range)
    // Higher volatility = higher factor = more scaling down
    const volatilityFactor = Math.min(1.0, Math.pow(
      clampedVolatility / this.config.maxVolatility,
      this.config.scalingExponent
    ));
    
    // Scale size based on volatility
    const originalSize = alpha.size;
    const scaledSize = this.config.maxSize * (1 - volatilityFactor);
    
    // Clamp size to min/max
    const clampedSize = Math.max(
      this.config.minSize,
      Math.min(this.config.maxSize, scaledSize)
    );
    
    // Create scaled alpha signal
    const scaledAlpha: FusedAlphaFrame = {
      ...alpha,
      size: clampedSize
    };
    
    // Optionally scale confidence as well
    if (this.config.scaleConfidence) {
      // Scale confidence by the same factor as size
      const confidenceScaleFactor = clampedSize / originalSize;
      scaledAlpha.confidence = alpha.confidence * confidenceScaleFactor;
    }
    
    // Log detailed calculations if enabled
    if (this.config.logDetailedCalculations) {
      this.logger.debug(`Volatility scaling for ${alpha.symbol}:
        Volatility: ${volatility.toFixed(4)} (${(volatility * 100).toFixed(2)}%)
        Volatility Factor: ${volatilityFactor.toFixed(4)}
        Original Size: ${originalSize.toFixed(4)}
        Scaled Size: ${clampedSize.toFixed(4)}
        Confidence: ${alpha.confidence.toFixed(4)} → ${scaledAlpha.confidence.toFixed(4)}`);
    }
    
    return scaledAlpha;
  }
  
  /**
   * Scale multiple fused alpha signals
   * @param alphas Array of fused alpha signals
   * @param volatilityMap Map of symbol to volatility
   * @returns Scaled alpha signals
   */
  public scaleSignals(
    alphas: FusedAlphaFrame[],
    volatilityMap: Map<string, number>
  ): FusedAlphaFrame[] {
    if (!this.config.enabled) {
      return alphas;
    }
    
    return alphas.map(alpha => {
      // Get volatility for this symbol
      const volatility = volatilityMap.get(alpha.symbol) || 0;
      
      // Scale signal
      return this.scaleSignal(alpha, volatility);
    });
  }
  
  /**
   * Calculate the scaled size for a given volatility
   * @param originalSize Original position size
   * @param volatility Market volatility
   * @returns Scaled position size
   */
  public calculateScaledSize(originalSize: number, volatility: number): number {
    if (!this.config.enabled) {
      return originalSize;
    }
    
    // Calculate volatility factor
    const volatilityFactor = Math.min(1.0, Math.pow(
      volatility / this.config.maxVolatility,
      this.config.scalingExponent
    ));
    
    // Scale and clamp size
    const scaledSize = originalSize * (1 - volatilityFactor);
    return Math.max(this.config.minSize, Math.min(this.config.maxSize, scaledSize));
  }
} 