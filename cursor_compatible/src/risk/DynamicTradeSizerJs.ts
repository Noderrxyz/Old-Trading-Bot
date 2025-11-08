import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry/types';
import { logger } from '../utils/logger';

/**
 * Configuration for the JavaScript dynamic trade sizer
 */
export interface TradeSizerConfig {
  baseSize: number;
  maxVolatilityThreshold: number;
  volatilityWindowSize: number;
  minSizeFactor: number;
  maxSizeFactor: number;
  enableLogging: boolean;
  symbolScaleFactors: Record<string, number>;
}

/**
 * Default configuration for the dynamic trade sizer
 */
const DEFAULT_CONFIG: TradeSizerConfig = {
  baseSize: 100,
  maxVolatilityThreshold: 0.05, // 5%
  volatilityWindowSize: 20,     // 20 most recent prices
  minSizeFactor: 0.25,          // Reduce to 25% of base size in high volatility
  maxSizeFactor: 2.0,           // Increase to 200% of base size in low volatility
  enableLogging: false,
  symbolScaleFactors: {}
};

/**
 * JavaScript fallback implementation of the dynamic trade sizer
 * for position sizing based on volatility and risk parameters
 */
export class DynamicTradeSizerJs {
  private config: TradeSizerConfig;
  private volatilityData: Map<string, number[]> = new Map();
  private volatilityCache: Map<string, number> = new Map();
  
  /**
   * Create a new DynamicTradeSizerJs instance with default configuration
   */
  constructor() {
    this.config = DEFAULT_CONFIG;
    
    telemetry.recordMetric('dynamic_trade_sizer.initialization', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Initialized JavaScript fallback DynamicTradeSizer');
  }
  
  /**
   * Create a new DynamicTradeSizerJs instance with custom configuration
   * @param config Trade sizer configuration
   * @returns New DynamicTradeSizerJs instance
   */
  static withConfig(config: TradeSizerConfig): DynamicTradeSizerJs {
    const instance = new DynamicTradeSizerJs();
    instance.config = { ...DEFAULT_CONFIG, ...config };
    
    telemetry.recordMetric('dynamic_trade_sizer.config_update', 1, {
      implementation: 'javascript'
    });
    
    if (instance.config.enableLogging) {
      logger.info(`DynamicTradeSizerJs configured with base size: ${config.baseSize}`);
    }
    
    return instance;
  }
  
  /**
   * Calculate position size based on volatility
   * @param symbol Symbol to calculate size for
   * @param baseSize Base position size
   * @returns Adjusted position size
   */
  async calculatePositionSize(symbol: string, baseSize: number): Promise<number> {
    try {
      const startTime = performance.now();
      
      // Validate inputs
      if (!symbol) {
        throw new Error('Symbol is required');
      }
      
      if (baseSize <= 0) {
        throw new Error(`Invalid base size: ${baseSize}`);
      }
      
      // Use cached volatility or default to 0
      const volatility = this.volatilityCache.get(symbol) || 0;
      
      // Apply symbol-specific scale factor if it exists
      const scaleFactor = this.config.symbolScaleFactors[symbol] || 1.0;
      
      // Adjust size based on volatility
      // Lower volatility -> larger position, higher volatility -> smaller position
      let sizeFactor: number;
      
      if (volatility <= 0) {
        // No volatility data, use default sizing
        sizeFactor = 1.0;
      } else if (volatility >= this.config.maxVolatilityThreshold) {
        // Very volatile, use minimum size
        sizeFactor = this.config.minSizeFactor;
      } else {
        // Scale linearly between min and max factors based on volatility
        const volatilityRatio = volatility / this.config.maxVolatilityThreshold;
        sizeFactor = this.config.maxSizeFactor - 
          (this.config.maxSizeFactor - this.config.minSizeFactor) * volatilityRatio;
      }
      
      // Calculate final size with symbol-specific scaling
      const finalSize = baseSize * sizeFactor * scaleFactor;
      
      const endTime = performance.now();
      const calculationTime = endTime - startTime;
      
      // Record more granular telemetry data
      telemetry.recordMetric('dynamic_trade_sizer.calculation_time', calculationTime, {
        symbol,
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.size_factor', sizeFactor, {
        symbol,
        volatility: volatility.toString(),
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.scale_factor', scaleFactor, {
        symbol,
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.base_size', baseSize, {
        symbol,
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.final_size', finalSize, {
        symbol,
        implementation: 'javascript'
      });
      
      // Record an event for significant size adjustments
      if (Math.abs(sizeFactor - 1.0) > 0.3) {
        telemetry.recordEvent(
          'significant_size_adjustment',
          'DynamicTradeSizerJs',
          {
            symbol,
            volatility: volatility.toString(),
            size_factor: sizeFactor.toString(),
            implementation: 'javascript'
          },
          {
            base_size: baseSize,
            final_size: finalSize,
            calculation_time_ms: calculationTime
          }
        );
      }
      
      if (this.config.enableLogging) {
        logger.debug(`[DynamicTradeSizerJs] Symbol: ${symbol}, Volatility: ${volatility.toFixed(4)}, Size Factor: ${sizeFactor.toFixed(2)}, Final Size: ${finalSize.toFixed(2)}`);
      }
      
      return finalSize;
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DynamicTradeSizerJs',
        `Error calculating position size: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          symbol,
          method: 'calculatePositionSize',
          base_size: baseSize.toString(),
          error_type: error.name,
          stack: error.stack || ''
        }
      );
      
      logger.error(`[DynamicTradeSizerJs] Error calculating position size: ${error.message}`, {
        symbol,
        base_size: baseSize,
        error_stack: error.stack
      });
      
      // Fall back to base size on error, but with a small reduction for safety
      return baseSize * 0.9;
    }
  }
  
  /**
   * Update volatility for a symbol based on new price data
   * @param symbol Symbol to update
   * @param price Current price
   * @returns Updated volatility
   */
  async updateVolatility(symbol: string, price: number): Promise<number> {
    try {
      const startTime = performance.now();
      
      // Validate inputs
      if (!symbol) {
        throw new Error('Symbol is required');
      }
      
      if (price <= 0) {
        throw new Error(`Invalid price: ${price}`);
      }
      
      // Get existing price data or initialize
      let prices = this.volatilityData.get(symbol);
      if (!prices) {
        prices = [];
        this.volatilityData.set(symbol, prices);
      }
      
      // Add new price
      prices.push(price);
      
      // Keep only the most recent window of prices
      if (prices.length > this.config.volatilityWindowSize) {
        prices = prices.slice(-this.config.volatilityWindowSize);
        this.volatilityData.set(symbol, prices);
      }
      
      // Need at least 2 prices to calculate volatility
      if (prices.length < 2) {
        return 0;
      }
      
      // Calculate returns (percentage changes between consecutive prices)
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        const returnPct = (prices[i] - prices[i-1]) / prices[i-1];
        returns.push(returnPct);
      }
      
      // Calculate standard deviation of returns (volatility)
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);
      
      // Cache the result
      this.volatilityCache.set(symbol, volatility);
      
      const endTime = performance.now();
      const calculationTime = endTime - startTime;
      
      // Record more detailed metrics
      telemetry.recordMetric('dynamic_trade_sizer.volatility', volatility, {
        symbol,
        window_size: prices.length.toString(),
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.volatility_calculation_time', calculationTime, {
        symbol,
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.mean_return', mean, {
        symbol,
        implementation: 'javascript'
      });
      
      telemetry.recordMetric('dynamic_trade_sizer.return_variance', variance, {
        symbol,
        implementation: 'javascript'
      });
      
      // Record an event for high volatility situations
      if (volatility > this.config.maxVolatilityThreshold * 0.8) {
        telemetry.recordEvent(
          'high_volatility_detected',
          'DynamicTradeSizerJs',
          {
            symbol,
            volatility_level: volatility > this.config.maxVolatilityThreshold ? 'extreme' : 'high',
            implementation: 'javascript'
          },
          {
            volatility: volatility,
            mean_return: mean,
            data_points: prices.length,
            threshold: this.config.maxVolatilityThreshold
          }
        );
      }
      
      if (this.config.enableLogging) {
        logger.debug(`[DynamicTradeSizerJs] Updated volatility for ${symbol}: ${volatility.toFixed(4)}`);
      }
      
      return volatility;
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DynamicTradeSizerJs',
        `Error updating volatility: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          symbol,
          method: 'updateVolatility',
          price: price.toString(),
          error_type: error.name,
          stack: error.stack || ''
        }
      );
      
      logger.error(`[DynamicTradeSizerJs] Error updating volatility: ${error.message}`, {
        symbol,
        price,
        error_stack: error.stack
      });
      
      // Return previous volatility if available, otherwise default to a moderate value
      return this.volatilityCache.get(symbol) || 0.02;
    }
  }
  
  /**
   * Get current volatility for a symbol
   * @param symbol Symbol to get volatility for
   * @returns Current volatility or 0 if not found
   */
  async getVolatility(symbol: string): Promise<number> {
    return this.volatilityCache.get(symbol) || 0;
  }
  
  /**
   * Clear all data for a symbol
   * @param symbol Symbol to clear data for
   */
  async clearSymbolData(symbol: string): Promise<void> {
    this.volatilityData.delete(symbol);
    this.volatilityCache.delete(symbol);
    
    telemetry.recordMetric('dynamic_trade_sizer.clear_data', 1, {
      symbol,
      implementation: 'javascript'
    });
    
    if (this.config.enableLogging) {
      logger.info(`[DynamicTradeSizerJs] Cleared data for ${symbol}`);
    }
  }
  
  /**
   * Get all tracked symbols
   * @returns List of symbol names
   */
  async getTrackedSymbols(): Promise<string[]> {
    return Array.from(this.volatilityData.keys());
  }
} 