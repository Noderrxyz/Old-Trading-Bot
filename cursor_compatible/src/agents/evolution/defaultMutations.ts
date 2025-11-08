import { MutationConfig } from './mutationRegistry.js';

/**
 * Default mutations for the evolution system
 * 
 * These mutations serve as a starting point for the system and can be registered
 * with the mutation registry during initialization.
 */

/**
 * Risk adjustment mutations
 */
export const RISK_ADJUSTMENT_MUTATIONS: Omit<MutationConfig, 'mutationId'>[] = [
  {
    name: 'Increase Risk Profile',
    description: 'Increases the risk tolerance of the agent by 10%, allowing for more aggressive trading',
    mutationFunction: 'adjustRisk',
    parameters: {
      adjustmentPct: 10
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.4,
      maxAnomalies: 1,
      minTrustScore: 0.6
    },
    cooldownDays: 5,
    tags: ['risk', 'aggressive'],
    enabled: true
  },
  {
    name: 'Decrease Risk Profile',
    description: 'Decreases the risk tolerance of the agent by 10%, favoring more conservative trading',
    mutationFunction: 'adjustRisk',
    parameters: {
      adjustmentPct: -10
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.3,
      maxAnomalies: 3
    },
    cooldownDays: 5,
    tags: ['risk', 'conservative'],
    enabled: true
  }
];

/**
 * Model switching mutations
 */
export const MODEL_SWITCHING_MUTATIONS: Omit<MutationConfig, 'mutationId'>[] = [
  {
    name: 'Upgrade to LSTMv2.2',
    description: 'Switches to the new LSTM v2.2 model with improved time-series forecasting',
    mutationFunction: 'switchModel',
    parameters: {
      targetModel: 'lstm-v2.2',
      previousModel: 'lstm-v2.1'
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.5,
      maxAnomalies: 1
    },
    cooldownDays: 7,
    tags: ['model', 'upgrade', 'lstm'],
    enabled: true
  },
  {
    name: 'Switch to Transformer Model',
    description: 'Switches from LSTM to Transformer-based model for better pattern recognition',
    mutationFunction: 'switchModel',
    parameters: {
      targetModel: 'transformer-v1.0',
      architecture: 'attention-based'
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.6,
      maxAnomalies: 0,
      minTrustScore: 0.7
    },
    cooldownDays: 14,
    tags: ['model', 'transformer', 'experimental'],
    enabled: true
  }
];

/**
 * Signal pathway mutations
 */
export const SIGNAL_PATHWAY_MUTATIONS: Omit<MutationConfig, 'mutationId'>[] = [
  {
    name: 'Disable Social Signals',
    description: 'Disables the social sentiment pathway to focus on technical indicators',
    mutationFunction: 'disableAlphaPathway',
    parameters: {
      pathway: 'social'
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.3,
      maxAnomalies: 2
    },
    cooldownDays: 3,
    tags: ['pathway', 'social', 'disable'],
    enabled: true
  },
  {
    name: 'Disable Fundamental Signals',
    description: 'Disables fundamental analysis pathway to focus on technical and sentiment signals',
    mutationFunction: 'disableAlphaPathway',
    parameters: {
      pathway: 'fundamental'
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.3,
      maxAnomalies: 2
    },
    cooldownDays: 3,
    tags: ['pathway', 'fundamental', 'disable'],
    enabled: true
  }
];

/**
 * Sentinel mutations
 */
export const SENTINEL_MUTATIONS: Omit<MutationConfig, 'mutationId'>[] = [
  {
    name: 'Enable Anomaly Filter v3',
    description: 'Enables the new anomaly filter that uses statistical methods to detect outliers',
    mutationFunction: 'enableSentinel',
    parameters: {
      sentinel: 'anomalyFilterV3'
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.4,
      maxAnomalies: 3
    },
    cooldownDays: 5,
    tags: ['sentinel', 'anomaly', 'filter'],
    enabled: true
  },
  {
    name: 'Enable Volatility Guard',
    description: 'Enables a sentinel that reduces position sizes during high volatility',
    mutationFunction: 'enableSentinel',
    parameters: {
      sentinel: 'volatilityGuard',
      threshold: 0.15
    },
    version: '1.0.0',
    conditions: {
      minFitness: 0.3,
      maxAnomalies: 2
    },
    cooldownDays: 5,
    tags: ['sentinel', 'volatility', 'risk'],
    enabled: true
  }
];

/**
 * All default mutations
 */
export const DEFAULT_MUTATIONS: Omit<MutationConfig, 'mutationId'>[] = [
  ...RISK_ADJUSTMENT_MUTATIONS,
  ...MODEL_SWITCHING_MUTATIONS,
  ...SIGNAL_PATHWAY_MUTATIONS,
  ...SENTINEL_MUTATIONS
];

/**
 * Function to load default mutations into the registry
 * @param registry Mutation registry instance
 */
export async function loadDefaultMutations(registry: any): Promise<void> {
  for (const mutation of DEFAULT_MUTATIONS) {
    await registry.registerMutation(mutation);
  }
} 