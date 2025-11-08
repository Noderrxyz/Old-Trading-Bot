/**
 * Gas Profile Model
 * 
 * Maintains and learns optimal gas profiles per chain and venue.
 */

import { createLogger } from '../common/logger.js';
import { GasProfileConfig, GasProfileMetrics, ChainGasProfile, GasProfileRecommendation } from './types/gas_profile.types.js';
import { TransactionBenchmark } from './types/benchmark.types.js';

const logger = createLogger('GasProfileModel');

/**
 * Model for learning and maintaining gas profiles
 */
export class GasProfileModel {
  private readonly profiles: Map<string, ChainGasProfile>;
  private readonly config: GasProfileConfig;
  private decayTimer: NodeJS.Timeout | null = null;

  /**
   * Create a new gas profile model
   * @param config Gas profile configuration
   */
  constructor(config: GasProfileConfig) {
    this.profiles = new Map();
    this.config = config;
    this.startDecayTimer();
    logger.info('Gas Profile Model initialized');
  }

  /**
   * Update profile with new transaction benchmark
   * @param benchmark Transaction benchmark
   */
  public updateProfile(benchmark: TransactionBenchmark): void {
    const { chain, venue } = benchmark;
    
    // Get or create chain profile
    let chainProfile = this.profiles.get(chain);
    if (!chainProfile) {
      chainProfile = this.createChainProfile();
      this.profiles.set(chain, chainProfile);
    }
    
    // Get or create venue profile
    let venueProfile = chainProfile.venues.get(venue);
    if (!venueProfile) {
      venueProfile = this.createVenueProfile();
      chainProfile.venues.set(venue, venueProfile);
    }
    
    // Update metrics
    this.updateVenueMetrics(venueProfile, benchmark);
    
    if (this.config.enableLogging) {
      logger.info(`Updated gas profile for ${chain}:${venue}:`, {
        sampleCount: venueProfile.sampleCount,
        confidence: venueProfile.confidence
      });
    }
  }

  /**
   * Get gas profile recommendation
   * @param chain Chain identifier
   * @param venue Venue identifier
   * @param baseGasLimit Base gas limit
   * @param baseGasPrice Base gas price
   * @returns Gas profile recommendation
   */
  public getRecommendation(
    chain: string,
    venue: string,
    baseGasLimit: number,
    baseGasPrice: number
  ): GasProfileRecommendation {
    const chainProfile = this.profiles.get(chain);
    if (!chainProfile) {
      return this.getFallbackRecommendation(baseGasLimit, baseGasPrice);
    }
    
    const venueProfile = chainProfile.venues.get(venue);
    if (!venueProfile || venueProfile.sampleCount < this.config.minSamplesRequired) {
      return this.getDefaultRecommendation(chainProfile, baseGasLimit, baseGasPrice);
    }
    
    // Calculate recommended parameters based on profile
    const gasLimit = Math.round(baseGasLimit * venueProfile.avgGasEfficiency);
    const gasPrice = Math.round(venueProfile.avgGasPrice);
    const maxFeePerGas = Math.round(gasPrice * 1.2); // 20% buffer
    const maxPriorityFeePerGas = Math.round(gasPrice * 0.1); // 10% of base fee
    
    return {
      gasLimit,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      confidence: venueProfile.confidence,
      source: 'profile',
      metrics: venueProfile
    };
  }

  /**
   * Start periodic decay timer
   */
  private startDecayTimer(): void {
    // Run decay every hour
    this.decayTimer = setInterval(() => {
      this.applyDecay();
    }, 3600000);
  }

  /**
   * Apply decay to all profiles
   */
  private applyDecay(): void {
    for (const [chain, chainProfile] of this.profiles) {
      for (const [venue, venueProfile] of chainProfile.venues) {
        // Apply exponential decay
        const hoursSinceUpdate = (Date.now() - venueProfile.lastUpdate) / 3600000;
        const decayFactor = Math.pow(1 - this.config.decayRatePerHour, hoursSinceUpdate);
        
        venueProfile.avgGasPrice *= decayFactor;
        venueProfile.avgGasEfficiency *= decayFactor;
        venueProfile.avgConfirmationTime *= decayFactor;
        venueProfile.successRate *= decayFactor;
        venueProfile.confidence *= decayFactor;
        
        // Remove old profiles
        if (hoursSinceUpdate > this.config.maxSampleAgeHours) {
          chainProfile.venues.delete(venue);
        }
      }
      
      // Remove empty chain profiles
      if (chainProfile.venues.size === 0) {
        this.profiles.delete(chain);
      }
    }
  }

  /**
   * Update venue metrics with new benchmark
   * @param profile Venue profile
   * @param benchmark Transaction benchmark
   */
  private updateVenueMetrics(profile: GasProfileMetrics, benchmark: TransactionBenchmark): void {
    const { gas, timestamps, success } = benchmark;
    const latencySec = (timestamps.confirmed - timestamps.sent) / 1000;
    const gasEfficiency = gas.used / gas.supplied;
    
    // Update rolling averages
    profile.sampleCount++;
    profile.avgGasPrice = (profile.avgGasPrice * (profile.sampleCount - 1) + gas.price) / profile.sampleCount;
    profile.avgGasEfficiency = (profile.avgGasEfficiency * (profile.sampleCount - 1) + gasEfficiency) / profile.sampleCount;
    profile.avgConfirmationTime = (profile.avgConfirmationTime * (profile.sampleCount - 1) + latencySec) / profile.sampleCount;
    profile.successRate = (profile.successRate * (profile.sampleCount - 1) + (success ? 1 : 0)) / profile.sampleCount;
    
    // Update confidence based on sample count
    profile.confidence = Math.min(1, profile.sampleCount / this.config.minSamplesRequired);
    profile.lastUpdate = Date.now();
  }

  /**
   * Create new chain profile
   * @returns New chain profile
   */
  private createChainProfile(): ChainGasProfile {
    return {
      venues: new Map(),
      defaults: {
        gasLimit: 0,
        gasPrice: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0
      }
    };
  }

  /**
   * Create new venue profile
   * @returns New venue profile
   */
  private createVenueProfile(): GasProfileMetrics {
    return {
      sampleCount: 0,
      avgGasPrice: 0,
      avgGasEfficiency: 1,
      avgConfirmationTime: 0,
      successRate: 1,
      lastUpdate: Date.now(),
      confidence: 0
    };
  }

  /**
   * Get fallback recommendation
   * @param baseGasLimit Base gas limit
   * @param baseGasPrice Base gas price
   * @returns Fallback recommendation
   */
  private getFallbackRecommendation(
    baseGasLimit: number,
    baseGasPrice: number
  ): GasProfileRecommendation {
    const gasLimit = Math.round(baseGasLimit * this.config.defaultGasMultiplier);
    const gasPrice = Math.round(baseGasPrice * this.config.defaultGasMultiplier);
    const maxFeePerGas = Math.round(gasPrice * 1.2);
    const maxPriorityFeePerGas = Math.round(gasPrice * 0.1);
    
    return {
      gasLimit,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      confidence: 0.5,
      source: 'fallback'
    };
  }

  /**
   * Get default recommendation
   * @param chainProfile Chain profile
   * @param baseGasLimit Base gas limit
   * @param baseGasPrice Base gas price
   * @returns Default recommendation
   */
  private getDefaultRecommendation(
    chainProfile: ChainGasProfile,
    baseGasLimit: number,
    baseGasPrice: number
  ): GasProfileRecommendation {
    const { defaults } = chainProfile;
    const gasLimit = defaults.gasLimit || Math.round(baseGasLimit * this.config.defaultGasMultiplier);
    const gasPrice = defaults.gasPrice || Math.round(baseGasPrice * this.config.defaultGasMultiplier);
    const maxFeePerGas = defaults.maxFeePerGas || Math.round(gasPrice * 1.2);
    const maxPriorityFeePerGas = defaults.maxPriorityFeePerGas || Math.round(gasPrice * 0.1);
    
    return {
      gasLimit,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      confidence: 0.7,
      source: 'default'
    };
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }
} 