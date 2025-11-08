/**
 * Types for latency benchmarking and gas optimization
 */

/**
 * Transaction benchmark result
 */
export interface TransactionBenchmark {
  // Transaction hash
  txHash: string;
  
  // Venue/DEX identifier
  venue: string;
  
  // Chain identifier
  chain: string;
  
  // Timestamps
  timestamps: {
    sent: number;
    confirmed: number;
  };
  
  // Gas metrics
  gas: {
    supplied: number;
    used: number;
    price: number;
  };
  
  // Success status
  success: boolean;
  
  // Error message if failed
  error?: string;
}

/**
 * Venue performance metrics
 */
export interface VenuePerformance {
  // Total transactions
  totalTransactions: number;
  
  // Successful transactions
  successfulTransactions: number;
  
  // Average confirmation latency in seconds
  avgLatencySec: number;
  
  // Average gas efficiency (used/supplied)
  avgGasEfficiency: number;
  
  // Last update timestamp
  lastUpdate: number;
}

/**
 * Gas optimization configuration
 */
export interface GasOptimizerConfig {
  // Target confirmation time in seconds
  latencyTargetSec: number;
  
  // Target success rate (0-1)
  confirmationSuccessRateTarget: number;
  
  // Maximum gas multiplier
  maxGasMultiplier: number;
  
  // Minimum gas multiplier
  minGasMultiplier: number;
  
  // Sample size for optimization
  benchmarkSampleSize: number;
  
  // Whether to enable logging
  enableLogging: boolean;
}

/**
 * Default gas optimizer configuration
 */
export const DEFAULT_GAS_OPTIMIZER_CONFIG: GasOptimizerConfig = {
  latencyTargetSec: 20,
  confirmationSuccessRateTarget: 0.98,
  maxGasMultiplier: 1.5,
  minGasMultiplier: 0.8,
  benchmarkSampleSize: 500,
  enableLogging: true
};

/**
 * Recommended gas parameters
 */
export interface GasParameters {
  // Gas limit
  gasLimit: number;
  
  // Gas price in wei
  gasPrice: number;
  
  // Maximum fee per gas in wei
  maxFeePerGas: number;
  
  // Priority fee per gas in wei
  maxPriorityFeePerGas: number;
  
  // Confidence score (0-1)
  confidence: number;
} 