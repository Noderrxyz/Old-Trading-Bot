/**
 * Strategy Weights Configuration
 * 
 * Defines default weights and configurations for strategy components,
 * including NLP alpha integration.
 */

import { BlendMethod } from '../alpha/blend';

/**
 * Strategy configuration with NLP integration settings
 */
export interface StrategyConfig {
  strategyId: string;
  asset: string;
  description: string;
  baseAlpha: string;
  nlpAlphaEnabled: boolean;
  nlpWeight: number;
  blendMethod: BlendMethod;
  threshold: number;
  lookbackWindow: number; // in minutes
  adaptiveWeights?: boolean;
  experimentId?: string; // For A/B testing
}

/**
 * Default strategy configurations by ID
 */
export const DEFAULT_STRATEGIES: Record<string, StrategyConfig> = {
  'btc_news_momentum': {
    strategyId: 'btc_news_momentum',
    asset: 'BTC',
    description: 'Bitcoin Momentum with News Sentiment',
    baseAlpha: 'momentum:v2',
    nlpAlphaEnabled: true,
    nlpWeight: 0.35,
    blendMethod: BlendMethod.SIMPLE_WEIGHT,
    threshold: 0.6,
    lookbackWindow: 60 * 5, // 5 minutes
  },
  'eth_news_momentum': {
    strategyId: 'eth_news_momentum',
    asset: 'ETH',
    description: 'Ethereum Momentum with News Sentiment',
    baseAlpha: 'momentum:v2',
    nlpAlphaEnabled: true,
    nlpWeight: 0.35,
    blendMethod: BlendMethod.SIMPLE_WEIGHT,
    threshold: 0.6,
    lookbackWindow: 60 * 5, // 5 minutes
  },
  'btc_news_breakout': {
    strategyId: 'btc_news_breakout',
    asset: 'BTC',
    description: 'Bitcoin Breakout with News Confirmation',
    baseAlpha: 'breakout:v1',
    nlpAlphaEnabled: true,
    nlpWeight: 0.40,
    blendMethod: BlendMethod.ENSEMBLE_VOTE,
    threshold: 0.65,
    lookbackWindow: 60 * 10, // 10 minutes
  },
  'eth_news_breakout': {
    strategyId: 'eth_news_breakout',
    asset: 'ETH',
    description: 'Ethereum Breakout with News Confirmation',
    baseAlpha: 'breakout:v1',
    nlpAlphaEnabled: true,
    nlpWeight: 0.40,
    blendMethod: BlendMethod.ENSEMBLE_VOTE,
    threshold: 0.65,
    lookbackWindow: 60 * 10, // 10 minutes
  },
  'btc_high_vol_news': {
    strategyId: 'btc_high_vol_news',
    asset: 'BTC',
    description: 'Bitcoin High Volatility News-Driven',
    baseAlpha: 'volatility:v2',
    nlpAlphaEnabled: true,
    nlpWeight: 0.50,
    blendMethod: BlendMethod.ADAPTIVE,
    threshold: 0.70,
    lookbackWindow: 60 * 15, // 15 minutes
    adaptiveWeights: true,
  },
};

/**
 * Experimental strategies for A/B testing
 */
export const EXPERIMENTAL_STRATEGIES: Record<string, StrategyConfig> = {
  'btc_news_momentum_exp': {
    strategyId: 'btc_news_momentum_exp',
    asset: 'BTC',
    description: 'Bitcoin Momentum with Enhanced News Weight',
    baseAlpha: 'momentum:v2',
    nlpAlphaEnabled: true,
    nlpWeight: 0.45, // Higher NLP weight than default
    blendMethod: BlendMethod.SIMPLE_WEIGHT,
    threshold: 0.6,
    lookbackWindow: 60 * 5, // 5 minutes
    experimentId: 'NLP-WEIGHT-TEST-001',
  },
  'eth_adaptive_news': {
    strategyId: 'eth_adaptive_news',
    asset: 'ETH',
    description: 'Ethereum with Adaptive News Weight',
    baseAlpha: 'momentum:v2',
    nlpAlphaEnabled: true,
    nlpWeight: 0.30,
    blendMethod: BlendMethod.ADAPTIVE,
    threshold: 0.55,
    lookbackWindow: 60 * 5, // 5 minutes
    adaptiveWeights: true,
    experimentId: 'ADAPTIVE-WEIGHT-TEST-001',
  },
};

/**
 * Get strategy configuration by ID
 * @param strategyId The unique strategy identifier
 * @returns The strategy configuration or null if not found
 */
export function getStrategyConfig(strategyId: string): StrategyConfig | null {
  // Check default strategies first
  if (DEFAULT_STRATEGIES[strategyId]) {
    return { ...DEFAULT_STRATEGIES[strategyId] };
  }
  
  // Check experimental strategies
  if (EXPERIMENTAL_STRATEGIES[strategyId]) {
    return { ...EXPERIMENTAL_STRATEGIES[strategyId] };
  }
  
  return null;
}

/**
 * Get all available strategies (both default and experimental)
 */
export function getAllStrategies(): StrategyConfig[] {
  return [
    ...Object.values(DEFAULT_STRATEGIES),
    ...Object.values(EXPERIMENTAL_STRATEGIES)
  ];
}

/**
 * Get strategies for a specific asset
 * @param asset The asset symbol (e.g., "BTC", "ETH")
 * @returns Array of strategy configurations for the asset
 */
export function getStrategiesForAsset(asset: string): StrategyConfig[] {
  return getAllStrategies().filter(
    strategy => strategy.asset.toUpperCase() === asset.toUpperCase()
  );
}

/**
 * Check if NLP is enabled for a specific strategy
 * @param strategyId The strategy ID to check
 * @returns true if NLP is enabled, false otherwise
 */
export function isNLPEnabledForStrategy(strategyId: string): boolean {
  const config = getStrategyConfig(strategyId);
  return config?.nlpAlphaEnabled || false;
} 