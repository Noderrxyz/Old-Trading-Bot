import { createLogger } from '../common/logger.js';
import {
  LivePosition,
  VolatilityMetric,
  EnforcementAction,
  PositionExposureConfig,
  DEFAULT_POSITION_EXPOSURE_CONFIG
} from './types/position_exposure.types.js';

/**
 * Governs position exposure based on account equity and market conditions
 */
export class PositionExposureGovernor {
  private readonly logger = createLogger('PositionExposureGovernor');
  
  // Current volatility metrics by symbol
  private readonly volatilityMetrics: Map<string, VolatilityMetric> = new Map();
  
  constructor(
    private readonly config: PositionExposureConfig = DEFAULT_POSITION_EXPOSURE_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Position exposure governance is disabled');
    }
  }
  
  /**
   * Monitor live position
   * @param position Live position
   */
  public monitorPosition(position: LivePosition): void {
    if (!this.config.enabled) return;
    
    try {
      // Calculate position value as percentage of equity
      const positionPctEquity = (position.value / this.config.accountEquity) * 100;
      
      // Get volatility metrics
      const volMetrics = this.volatilityMetrics.get(position.symbol);
      
      // Check if position violates limits
      const action = this.enforceLimits(position, positionPctEquity, volMetrics);
      
      if (!action.allowed) {
        this.logger.warn(
          `Position limit violation for ${position.symbol}: ${action.reason}. ` +
          `Current size: ${position.size}, Suggested size: ${action.suggestedSize}`
        );
      }
    } catch (error) {
      this.logger.error(`Error monitoring position: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Enforce position limits
   * @param position Live position
   * @param positionPctEquity Position value as percentage of equity
   * @param volMetrics Volatility metrics
   * @returns Enforcement action
   */
  public enforceLimits(
    position: LivePosition,
    positionPctEquity: number,
    volMetrics?: VolatilityMetric
  ): EnforcementAction {
    if (!this.config.enabled) {
      return {
        allowed: true,
        suggestedSize: position.size,
        reason: 'Exposure governance disabled'
      };
    }
    
    try {
      // Calculate maximum allowed position size
      let maxPctEquity = this.config.maxPositionPctEquity;
      
      // Apply volatility scaling if enabled
      if (this.config.volatilityScalingEnabled && volMetrics) {
        if (volMetrics.volRatio > this.config.volScaleThreshold) {
          // Reduce position size based on volatility ratio
          const reductionFactor = this.config.volScaleThreshold / volMetrics.volRatio;
          maxPctEquity *= reductionFactor;
          
          // Ensure minimum position size
          maxPctEquity = Math.max(maxPctEquity, this.config.minPositionPctEquity);
        }
      }
      
      // Check if position exceeds limits
      if (positionPctEquity > maxPctEquity) {
        const suggestedValue = (maxPctEquity / 100) * this.config.accountEquity;
        const suggestedSize = suggestedValue / position.currentPrice;
        
        return {
          allowed: false,
          suggestedSize,
          reason: `Position size (${positionPctEquity.toFixed(2)}% equity) exceeds maximum allowed (${maxPctEquity.toFixed(2)}% equity)`
        };
      }
      
      return {
        allowed: true,
        suggestedSize: position.size,
        reason: 'Position within limits'
      };
    } catch (error) {
      this.logger.error(`Error enforcing limits: ${error instanceof Error ? error.message : String(error)}`);
      return {
        allowed: false,
        suggestedSize: 0,
        reason: 'Error enforcing limits'
      };
    }
  }
  
  /**
   * Update volatility metrics and adjust risk limits
   * @param metric Volatility metric
   */
  public dynamicAdjustment(metric: VolatilityMetric): void {
    if (!this.config.enabled) return;
    
    try {
      // Update volatility metrics
      this.volatilityMetrics.set(metric.symbol, metric);
      
      this.logger.debug(
        `Updated volatility metrics for ${metric.symbol}: ` +
        `Realized Vol: ${metric.realizedVol.toFixed(4)}, ` +
        `Ratio: ${metric.volRatio.toFixed(2)}`
      );
    } catch (error) {
      this.logger.error(`Error updating volatility metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Update account equity
   * @param equity New account equity
   */
  public updateAccountEquity(equity: number): void {
    this.config.accountEquity = equity;
    this.logger.debug(`Updated account equity to ${equity}`);
  }
} 