import { logger } from '../utils/logger.js';
import { Order } from './types/execution.types.js';

/**
 * Gas estimation configuration
 */
export interface GasEstimatorConfig {
  cacheDurationMs: number;
  maxCacheSize: number;
  defaultGasLimit: number;
  gasPriceMultiplier: number;
}

/**
 * Default gas estimator configuration
 */
export const DEFAULT_GAS_ESTIMATOR_CONFIG: GasEstimatorConfig = {
  cacheDurationMs: 300000, // 5 minutes
  maxCacheSize: 1000,
  defaultGasLimit: 21000,
  gasPriceMultiplier: 1.2
};

/**
 * Cached gas estimate
 */
interface CachedGasEstimate {
  gasLimit: number;
  timestamp: number;
}

/**
 * Gas Estimator
 */
export class GasEstimator {
  private static instance: GasEstimator | null = null;
  private config: GasEstimatorConfig;
  private gasPriceCache: Map<string, { price: number; timestamp: number }>;
  private gasLimitCache: Map<string, CachedGasEstimate>;

  private constructor(config: Partial<GasEstimatorConfig> = {}) {
    this.config = { ...DEFAULT_GAS_ESTIMATOR_CONFIG, ...config };
    this.gasPriceCache = new Map();
    this.gasLimitCache = new Map();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<GasEstimatorConfig>): GasEstimator {
    if (!GasEstimator.instance) {
      GasEstimator.instance = new GasEstimator(config);
    }
    return GasEstimator.instance;
  }

  /**
   * Estimate gas limit for an order
   */
  public async estimateGas(order: Order): Promise<number> {
    const cacheKey = this.getCacheKey(order);
    const cachedEstimate = this.gasLimitCache.get(cacheKey);

    if (cachedEstimate && this.isCacheValid(cachedEstimate.timestamp)) {
      return cachedEstimate.gasLimit;
    }

    // Calculate gas limit based on order type and size
    let gasLimit = this.config.defaultGasLimit;

    if (order.type === 'limit') {
      gasLimit *= 1.5; // Limit orders require more gas
    } else if (order.type === 'stop' || order.type === 'stop_limit') {
      gasLimit *= 2; // Stop orders require even more gas
    }

    // Adjust for order size
    gasLimit *= Math.max(1, Math.log10(order.amount));

    // Cache the estimate
    this.cacheGasEstimate(cacheKey, gasLimit);

    return gasLimit;
  }

  /**
   * Get current gas price
   */
  public async getCurrentGasPrice(): Promise<number> {
    const cacheKey = 'current_gas_price';
    const cachedPrice = this.gasPriceCache.get(cacheKey);

    if (cachedPrice && this.isCacheValid(cachedPrice.timestamp)) {
      return cachedPrice.price;
    }

    // TODO: Implement actual gas price fetching from network
    // This is a placeholder that should be replaced with real gas price data
    const gasPrice = 20; // Example gas price in gwei

    // Cache the price
    this.gasPriceCache.set(cacheKey, {
      price: gasPrice,
      timestamp: Date.now()
    });

    return gasPrice;
  }

  /**
   * Get cache key for an order
   */
  private getCacheKey(order: Order): string {
    return `${order.venue}_${order.symbol}_${order.type}_${order.amount}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.config.cacheDurationMs;
  }

  /**
   * Cache a gas estimate
   */
  private cacheGasEstimate(key: string, gasLimit: number): void {
    // Remove oldest entries if cache is full
    if (this.gasLimitCache.size >= this.config.maxCacheSize) {
      const oldestKey = Array.from(this.gasLimitCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.gasLimitCache.delete(oldestKey);
    }

    this.gasLimitCache.set(key, {
      gasLimit,
      timestamp: Date.now()
    });
  }
} 