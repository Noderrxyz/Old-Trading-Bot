/**
 * Alpha Blending Logic
 * 
 * Combines different alpha signals into a final strategy signal, 
 * including NLP-derived alpha from news headlines.
 */

import { createLogger } from '../../common/logger';
import { NLPAlpha } from './nlpModel';

const logger = createLogger('AlphaBlend');

/**
 * Types of alpha blending methods
 */
export enum BlendMethod {
  SIMPLE_WEIGHT = 'simple_weight',
  ADAPTIVE = 'adaptive_weight',
  ENSEMBLE_VOTE = 'ensemble_vote',
  META_MODEL = 'meta_model'
}

/**
 * Base alpha signal interface
 */
export interface AlphaSignal {
  asset: string;
  timestamp: string;
  signal: number;  // -1.0 to 1.0 value
  confidence: number; // 0.0 to 1.0 confidence
}

/**
 * Technical alpha from price/volume analysis
 */
export interface TechnicalAlpha extends AlphaSignal {
  type: 'technical';
  indicators: Record<string, number>;
}

/**
 * On-chain alpha from blockchain data
 */
export interface ChainAlpha extends AlphaSignal {
  type: 'chain';
  metrics: Record<string, number>;
}

/**
 * Configuration for alpha blending
 */
export interface BlendConfig {
  method: BlendMethod;
  weights: {
    technical?: number;
    nlp?: number;
    chain?: number;
    // Additional alpha sources
    [key: string]: number | undefined;
  };
  adaptiveConfig?: {
    volatilityThreshold: number;
    maxNlpWeight: number;
    minNlpWeight: number;
  };
}

/**
 * Alpha signals to be blended
 */
export interface AlphaBlendInputs {
  baseSignal: AlphaSignal;
  nlpSignal?: NLPAlpha;
  chainSignal?: ChainAlpha;
  // Additional signals
  [key: string]: AlphaSignal | undefined;
}

/**
 * Output from alpha blending
 */
export interface BlendedAlpha extends AlphaSignal {
  components: {
    [key: string]: {
      signal: number;
      weight: number;
      contribution: number;
    };
  };
}

/**
 * Default blend configuration
 */
const DEFAULT_BLEND_CONFIG: BlendConfig = {
  method: BlendMethod.SIMPLE_WEIGHT,
  weights: {
    technical: 0.7,
    nlp: 0.3,
    chain: 0.0
  }
};

/**
 * Simple weighted average of alpha signals
 */
function simpleWeightBlend(
  inputs: AlphaBlendInputs,
  config: BlendConfig
): BlendedAlpha {
  const weights = config.weights;
  const components: BlendedAlpha['components'] = {};
  
  let totalWeight = 0;
  let weightedSignal = 0;
  let maxConfidence = 0;
  
  // Process base signal (required)
  const baseWeight = weights.technical || 0.7;
  totalWeight += baseWeight;
  weightedSignal += inputs.baseSignal.signal * baseWeight;
  maxConfidence = Math.max(maxConfidence, inputs.baseSignal.confidence);
  
  components['technical'] = {
    signal: inputs.baseSignal.signal,
    weight: baseWeight,
    contribution: inputs.baseSignal.signal * baseWeight
  };
  
  // Process NLP signal if available
  if (inputs.nlpSignal && weights.nlp) {
    totalWeight += weights.nlp;
    weightedSignal += inputs.nlpSignal.signal * weights.nlp;
    maxConfidence = Math.max(maxConfidence, inputs.nlpSignal.confidence);
    
    components['nlp'] = {
      signal: inputs.nlpSignal.signal,
      weight: weights.nlp,
      contribution: inputs.nlpSignal.signal * weights.nlp
    };
  }
  
  // Process chain signal if available
  if (inputs.chainSignal && weights.chain) {
    totalWeight += weights.chain;
    weightedSignal += inputs.chainSignal.signal * weights.chain;
    maxConfidence = Math.max(maxConfidence, inputs.chainSignal.confidence);
    
    components['chain'] = {
      signal: inputs.chainSignal.signal,
      weight: weights.chain,
      contribution: inputs.chainSignal.signal * weights.chain
    };
  }
  
  // Process any additional signals
  for (const [key, signal] of Object.entries(inputs)) {
    if (['baseSignal', 'nlpSignal', 'chainSignal'].includes(key) || !signal) {
      continue;
    }
    
    const weight = weights[key] || 0;
    if (weight > 0) {
      totalWeight += weight;
      weightedSignal += signal.signal * weight;
      maxConfidence = Math.max(maxConfidence, signal.confidence);
      
      components[key] = {
        signal: signal.signal,
        weight,
        contribution: signal.signal * weight
      };
    }
  }
  
  // Normalize the final signal
  const finalSignal = totalWeight > 0 ? weightedSignal / totalWeight : 0;
  
  // Calculate blended confidence - uses max confidence but could use weighted average
  const confidence = maxConfidence * 0.8 + 0.2; // Add a base confidence
  
  return {
    asset: inputs.baseSignal.asset,
    timestamp: inputs.baseSignal.timestamp,
    signal: finalSignal,
    confidence: Math.min(1.0, confidence), // Cap at 1.0
    components
  };
}

/**
 * Adaptive blending based on market conditions
 * Adjusts NLP weight based on volatility or other regime indicators
 */
function adaptiveBlend(
  inputs: AlphaBlendInputs,
  config: BlendConfig,
  marketState: { volatility: number }
): BlendedAlpha {
  const adaptiveConfig = config.adaptiveConfig || {
    volatilityThreshold: 0.02, // 2% volatility threshold
    maxNlpWeight: 0.5,
    minNlpWeight: 0.1
  };
  
  // Clone the config to avoid modifying the original
  const adjustedConfig = { ...config };
  
  // Adjust NLP weight based on volatility
  if (inputs.nlpSignal && adjustedConfig.weights.nlp !== undefined) {
    const isHighVolatility = marketState.volatility >= adaptiveConfig.volatilityThreshold;
    
    // In high volatility regimes, increase NLP weight as news matters more
    if (isHighVolatility) {
      adjustedConfig.weights.nlp = adaptiveConfig.maxNlpWeight;
      
      // Correspondingly decrease technical weight to maintain balance
      if (adjustedConfig.weights.technical) {
        adjustedConfig.weights.technical = 
          Math.max(0, 1 - (adjustedConfig.weights.nlp + (adjustedConfig.weights.chain || 0)));
      }
    } else {
      // In low vol periods, reduce NLP influence
      adjustedConfig.weights.nlp = adaptiveConfig.minNlpWeight;
    }
    
    logger.debug(
      `Adjusted NLP weight to ${adjustedConfig.weights.nlp.toFixed(2)} ` +
      `(volatility: ${marketState.volatility.toFixed(4)})`
    );
  }
  
  // Use the simple blend with adjusted weights
  return simpleWeightBlend(inputs, adjustedConfig);
}

/**
 * Ensemble voting blends multiple signals using a voting approach
 */
function ensembleVoteBlend(
  inputs: AlphaBlendInputs,
  config: BlendConfig
): BlendedAlpha {
  // Get direction votes from each signal
  const votes: Record<string, number> = {};
  const weights: Record<string, number> = {};
  const components: BlendedAlpha['components'] = {};
  
  // Base signal (required)
  const baseSignalDirection = Math.sign(inputs.baseSignal.signal);
  votes['technical'] = baseSignalDirection * inputs.baseSignal.confidence;
  weights['technical'] = config.weights.technical || 0.7;
  
  components['technical'] = {
    signal: inputs.baseSignal.signal,
    weight: weights['technical'],
    contribution: votes['technical'] * weights['technical']
  };
  
  // NLP signal if available
  if (inputs.nlpSignal && config.weights.nlp) {
    const nlpDirection = Math.sign(inputs.nlpSignal.signal);
    votes['nlp'] = nlpDirection * inputs.nlpSignal.confidence;
    weights['nlp'] = config.weights.nlp;
    
    components['nlp'] = {
      signal: inputs.nlpSignal.signal,
      weight: weights['nlp'],
      contribution: votes['nlp'] * weights['nlp']
    };
  }
  
  // Chain signal if available
  if (inputs.chainSignal && config.weights.chain) {
    const chainDirection = Math.sign(inputs.chainSignal.signal);
    votes['chain'] = chainDirection * inputs.chainSignal.confidence;
    weights['chain'] = config.weights.chain;
    
    components['chain'] = {
      signal: inputs.chainSignal.signal,
      weight: weights['chain'],
      contribution: votes['chain'] * weights['chain']
    };
  }
  
  // Calculate weighted vote sum to determine final direction and strength
  let weightedVoteSum = 0;
  let totalWeight = 0;
  
  for (const [key, vote] of Object.entries(votes)) {
    const weight = weights[key] || 0;
    weightedVoteSum += vote * weight;
    totalWeight += weight;
  }
  
  // Normalize to [-1, 1] range
  const finalSignal = totalWeight > 0 
    ? Math.max(-1, Math.min(1, weightedVoteSum / totalWeight))
    : 0;
    
  // Confidence is higher when votes are more aligned
  const voteValues = Object.values(votes);
  const allAgree = voteValues.every(v => Math.sign(v) === Math.sign(voteValues[0]));
  const confidence = allAgree ? 0.8 : 0.5;
  
  return {
    asset: inputs.baseSignal.asset,
    timestamp: inputs.baseSignal.timestamp,
    signal: finalSignal,
    confidence,
    components
  };
}

/**
 * Blend alpha signals using the specified method
 */
export function blendSignals(
  inputs: AlphaBlendInputs,
  config: Partial<BlendConfig> = {},
  marketState: { volatility: number } = { volatility: 0.01 }
): BlendedAlpha {
  // Merge with default config
  const fullConfig: BlendConfig = {
    ...DEFAULT_BLEND_CONFIG,
    ...config,
    weights: {
      ...DEFAULT_BLEND_CONFIG.weights,
      ...(config.weights || {})
    }
  };
  
  // Apply different blending methods
  switch (fullConfig.method) {
    case BlendMethod.ADAPTIVE:
      return adaptiveBlend(inputs, fullConfig, marketState);
      
    case BlendMethod.ENSEMBLE_VOTE:
      return ensembleVoteBlend(inputs, fullConfig);
      
    case BlendMethod.META_MODEL:
      // More advanced meta-model would go here
      // For now, fallback to simple weight blending
      return simpleWeightBlend(inputs, fullConfig);
      
    case BlendMethod.SIMPLE_WEIGHT:
    default:
      return simpleWeightBlend(inputs, fullConfig);
  }
} 