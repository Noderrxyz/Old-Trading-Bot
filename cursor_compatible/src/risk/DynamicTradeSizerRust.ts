import { NapiDynamicTradeSizer, TradeSizerConfigParams } from '@noderr/core';

/**
 * Configuration for the Rust-powered dynamic trade sizer
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
 * Rust-powered dynamic trade sizer for high-performance position sizing
 * based on volatility and risk parameters
 */
export class DynamicTradeSizerRust {
  private sizer: NapiDynamicTradeSizer;

  /**
   * Create a new DynamicTradeSizerRust instance with default configuration
   */
  constructor() {
    this.sizer = new NapiDynamicTradeSizer();
  }

  /**
   * Create a new DynamicTradeSizerRust instance with custom configuration
   * @param config Trade sizer configuration
   * @returns New DynamicTradeSizerRust instance
   */
  static withConfig(config: TradeSizerConfig): DynamicTradeSizerRust {
    const instance = new DynamicTradeSizerRust();
    
    // Convert config to format expected by Rust
    const params: TradeSizerConfigParams = {
      base_size: config.baseSize,
      max_volatility_threshold: config.maxVolatilityThreshold,
      volatility_window_size: config.volatilityWindowSize,
      min_size_factor: config.minSizeFactor,
      max_size_factor: config.maxSizeFactor,
      enable_logging: config.enableLogging,
      symbol_scale_factors: config.symbolScaleFactors,
    };
    
    instance.sizer = NapiDynamicTradeSizer.with_config(params);
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
      return await this.sizer.calculate_position_size(symbol, baseSize);
    } catch (err) {
      console.error('Error calculating position size:', err);
      return baseSize; // Fall back to base size on error
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
      return await this.sizer.update_volatility(symbol, price);
    } catch (err) {
      console.error('Error updating volatility:', err);
      return 0;
    }
  }

  /**
   * Get current volatility for a symbol
   * @param symbol Symbol to get volatility for
   * @returns Current volatility or 0 if not found
   */
  async getVolatility(symbol: string): Promise<number> {
    try {
      return await this.sizer.get_volatility(symbol);
    } catch (err) {
      console.error('Error getting volatility:', err);
      return 0;
    }
  }

  /**
   * Clear all data for a symbol
   * @param symbol Symbol to clear data for
   */
  async clearSymbolData(symbol: string): Promise<void> {
    await this.sizer.clear_symbol_data(symbol);
  }

  /**
   * Get all tracked symbols
   * @returns List of symbol names
   */
  async getTrackedSymbols(): Promise<string[]> {
    return this.sizer.get_tracked_symbols();
  }
} 