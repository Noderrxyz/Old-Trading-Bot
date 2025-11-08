/**
 * Types for gas profile learning and optimization
 */

/**
 * Gas profile metrics for a specific chain and venue
 */
export interface GasProfileMetrics {
  // Number of samples in this profile
  sampleCount: number;
  
  // Average gas price used (wei)
  avgGasPrice: number;
  
  // Average gas efficiency (used/limit)
  avgGasEfficiency: number;
  
  // Average confirmation time (seconds)
  avgConfirmationTime: number;
  
  // Success rate (0-1)
  successRate: number;
  
  // Last update timestamp
  lastUpdate: number;
  
  // Weighted score (0-1)
  confidence: number;
}

/**
 * Gas profile for a specific chain
 */
export interface ChainGasProfile {
  // Venue-specific profiles
  venues: Map<string, GasProfileMetrics>;
  
  // Chain-specific default gas parameters
  defaults: {
    gasLimit: number;
    gasPrice: number;
    maxFeePerGas: number;
    maxPriorityFeePerGas: number;
  };
}

/**
 * Gas profile learning configuration
 */
export interface GasProfileConfig {
  // Minimum samples required for confident recommendations
  minSamplesRequired: number;
  
  // Decay rate per hour (0-1)
  decayRatePerHour: number;
  
  // Default gas multiplier when no data
  defaultGasMultiplier: number;
  
  // Maximum age of samples in hours
  maxSampleAgeHours: number;
  
  // Whether to enable logging
  enableLogging: boolean;
}

/**
 * Default gas profile configuration
 */
export const DEFAULT_GAS_PROFILE_CONFIG: GasProfileConfig = {
  minSamplesRequired: 30,
  decayRatePerHour: 0.005,
  defaultGasMultiplier: 1.2,
  maxSampleAgeHours: 24,
  enableLogging: true
};

/**
 * Gas profile recommendation
 */
export interface GasProfileRecommendation {
  // Recommended gas parameters
  gasLimit: number;
  gasPrice: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
  
  // Confidence in recommendation (0-1)
  confidence: number;
  
  // Source of recommendation
  source: 'profile' | 'default' | 'fallback';
  
  // Profile metrics if available
  metrics?: GasProfileMetrics;
} 