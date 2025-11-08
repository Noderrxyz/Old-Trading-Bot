/**
 * Gas Optimizer
 * 
 * Analyzes transaction benchmarks and optimizes gas parameters for future transactions.
 */

import { createLogger } from '../common/logger.js';
import { GasOptimizerConfig, GasParameters } from './types/benchmark.types.js';
import { GasProfileModel } from './gas_profile_model.js';
import { TransactionBenchmark } from './types/benchmark.types.js';
import { GasProfileConfig } from './types/gas_profile.types.js';

const logger = createLogger('GasOptimizer');

/**
 * Engine for optimizing gas parameters based on historical performance
 */
export class GasOptimizer {
  private readonly profileModel: GasProfileModel;
  private readonly config: GasOptimizerConfig;

  /**
   * Create a new gas optimizer
   * @param config Gas optimizer configuration
   */
  constructor(config: GasOptimizerConfig) {
    this.config = config;
    
    // Initialize gas profile model
    const profileConfig: GasProfileConfig = {
      minSamplesRequired: 30,
      decayRatePerHour: 0.005,
      defaultGasMultiplier: config.maxGasMultiplier,
      maxSampleAgeHours: 24,
      enableLogging: config.enableLogging
    };
    
    this.profileModel = new GasProfileModel(profileConfig);
    logger.info('Gas Optimizer initialized');
  }

  /**
   * Get optimized gas parameters for a transaction
   * @param venue Venue identifier
   * @param chain Chain identifier
   * @param baseGasLimit Base gas limit
   * @param baseGasPrice Base gas price
   * @returns Optimized gas parameters
   */
  public getOptimizedGasParameters(
    venue: string,
    chain: string,
    baseGasLimit: number,
    baseGasPrice: number
  ): GasParameters {
    // Get recommendation from profile model
    const recommendation = this.profileModel.getRecommendation(
      chain,
      venue,
      baseGasLimit,
      baseGasPrice
    );
    
    if (this.config.enableLogging) {
      logger.info(`Gas recommendation for ${chain}:${venue}:`, {
        source: recommendation.source,
        confidence: recommendation.confidence,
        gasLimit: recommendation.gasLimit,
        gasPrice: recommendation.gasPrice
      });
    }
    
    return {
      gasLimit: recommendation.gasLimit,
      gasPrice: recommendation.gasPrice,
      maxFeePerGas: recommendation.maxFeePerGas,
      maxPriorityFeePerGas: recommendation.maxPriorityFeePerGas,
      confidence: recommendation.confidence
    };
  }

  /**
   * Update gas profiles with new benchmark
   * @param benchmark Transaction benchmark
   */
  public updateProfiles(benchmark: TransactionBenchmark): void {
    this.profileModel.updateProfile(benchmark);
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.profileModel.destroy();
  }
} 