/**
 * Default Configuration
 * 
 * Sets default values for different parts of the system
 */

import { getTradingConfig } from './trading.config.js';

/**
 * Default AlphaHub configuration
 */
export const DEFAULT_ALPHA_HUB_CONFIG = {
  sources: {
    onchain: {
      enabled: true,
      refreshIntervalMs: 60000, // 1 minute
    },
    twitter: {
      enabled: true,
      refreshIntervalMs: 300000, // 5 minutes
    }
  },
  defaultRefreshIntervalMs: 60000, // 1 minute
  sourceWeights: {
    onchain: 0.7,
    twitter: 0.3
  },
  supportedAssets: [
    'BTC/USDC',
    'ETH/USDC',
    'SOL/USDC'
  ],
  timeBias: {
    enabled: true,
    bucketIntervalMinutes: 60,
    minDataPoints: 20,
    smoothing: 0.1,
    clampRange: [0.1, 1.0],
    logDetailedAdjustments: false
  }
};

/**
 * Get all default configurations
 */
export function getDefaultConfig() {
  return {
    alphahub: DEFAULT_ALPHA_HUB_CONFIG,
    trading: getTradingConfig()
  };
} 