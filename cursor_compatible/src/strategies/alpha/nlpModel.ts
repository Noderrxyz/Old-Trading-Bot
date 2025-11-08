/**
 * NLP Model Handler
 * 
 * Loads and runs the NLP model for predicting alpha signals
 * based on features extracted from news headlines.
 */

import { AssetFeatureSet, TimeBin } from '../../altdata/features';
import { createLogger } from '../../common/logger';

const logger = createLogger('NLPModel');

/**
 * Model types supported for NLP inference
 */
export enum NLPModelType {
  LINEAR = 'linear',
  GRADIENT_BOOST = 'gradient_boost', 
  NEURAL_NET = 'neural_net',
  ENSEMBLE = 'ensemble'
}

/**
 * Output from the NLP model prediction
 */
export interface NLPAlpha {
  asset: string;
  timestamp: string;
  signal: number;        // -1.0 to 1.0 value indicating direction and strength
  confidence: number;    // 0.0 to 1.0 confidence in the prediction
  contributingFeatures: Array<{
    feature: string;
    weight: number;
  }>;
}

/**
 * Configuration for the NLP model
 */
export interface NLPModelConfig {
  type: NLPModelType;
  asset: string;
  version: string;
  weights?: Record<string, number>;  // For simple linear models
  featureImportance?: Record<string, number>; // Feature importance/weights
  modelPath?: string;    // Path to more complex models (saved ML models)
  minConfidence: number; // Minimum confidence to generate a signal
  lookbackWindow: number; // Minutes to look back for features
}

/**
 * Default models configuration by asset
 */
const DEFAULT_MODELS: Record<string, NLPModelConfig> = {
  'BTC': {
    type: NLPModelType.LINEAR,
    asset: 'BTC',
    version: '1.0.0',
    weights: {
      'headline_count': 0.2,
      'avg_sentiment': 0.5,
      'max_impact': 0.4,
      'sentiment_volatility': -0.1,
      'source_diversity': 0.2,
      'avg_confidence': 0.3,
      'Regulatory_count': -0.4,
      'Hack_count': -0.6,
      'Market_count': 0.1,
      'Adoption_count': 0.4,
      'Partnership_count': 0.3
    },
    minConfidence: 0.6,
    lookbackWindow: 60 // 1 hour in minutes
  },
  'ETH': {
    type: NLPModelType.LINEAR,
    asset: 'ETH',
    version: '1.0.0',
    weights: {
      'headline_count': 0.15,
      'avg_sentiment': 0.45,
      'max_impact': 0.35,
      'sentiment_volatility': -0.1,
      'source_diversity': 0.25,
      'avg_confidence': 0.3,
      'Regulatory_count': -0.3,
      'Hack_count': -0.5,
      'Technology_count': 0.4,
      'Adoption_count': 0.35,
      'Partnership_count': 0.25
    },
    minConfidence: 0.6,
    lookbackWindow: 60 // 1 hour in minutes
  }
};

// Cache models for faster repeat access
const modelCache = new Map<string, NLPModelConfig>();

/**
 * Load the NLP model for a specific asset
 * In a real-world scenario, this would load model weights from a file/database
 */
export async function loadNLPModel(
  asset: string,
  modelVersion?: string
): Promise<NLPModelConfig> {
  const cacheKey = `${asset}-${modelVersion || 'default'}`;
  
  // Check cache first
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey)!;
  }
  
  // In a production system, we'd load the actual ML model here
  // For now, we'll use the default configuration
  let modelConfig: NLPModelConfig;
  
  if (DEFAULT_MODELS[asset]) {
    modelConfig = { ...DEFAULT_MODELS[asset] };
    
    if (modelVersion) {
      modelConfig.version = modelVersion;
    }
  } else {
    // Fallback to BTC model if specific asset model not available
    logger.warn(`No NLP model found for ${asset}, using BTC model as fallback`);
    modelConfig = { 
      ...DEFAULT_MODELS['BTC'],
      asset
    };
  }
  
  // Cache the model for future use
  modelCache.set(cacheKey, modelConfig);
  logger.info(`Loaded NLP model for ${asset} (version ${modelConfig.version})`);
  
  return modelConfig;
}

/**
 * Linear model prediction based on feature weights
 */
function predictLinear(
  features: AssetFeatureSet,
  model: NLPModelConfig
): NLPAlpha {
  const weights = model.weights || {};
  let signalValue = 0;
  let signalConfidence = 0;
  const contributions: Array<{feature: string; weight: number}> = [];
  
  // Calculate the weighted sum of features
  for (const [feature, weight] of Object.entries(weights)) {
    let featureValue: number | undefined;
    
    // Handle special cases for nested objects like category_counts
    if (feature.includes('_count') && feature.split('_')[0] in features.category_counts) {
      const category = feature.split('_')[0];
      featureValue = features.category_counts[category as keyof typeof features.category_counts];
    } else {
      // Handle direct feature access
      featureValue = (features as any)[feature];
    }
    
    // Skip if feature not found
    if (featureValue === undefined) continue;
    
    const contribution = featureValue * weight;
    signalValue += contribution;
    
    // Track feature contributions
    contributions.push({
      feature, 
      weight: contribution
    });
  }
  
  // Normalize signal to [-1, 1] range using sigmoid and centering
  const normalizedSignal = Math.tanh(signalValue);
  
  // Calculate confidence based on feature coverage and signal strength
  const featuresCovered = contributions.length / Object.keys(weights).length;
  const signalStrength = Math.abs(normalizedSignal);
  signalConfidence = featuresCovered * signalStrength;
  
  // Sort contributions by absolute impact
  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  
  return {
    asset: features.asset,
    timestamp: features.timestamp,
    signal: normalizedSignal,
    confidence: signalConfidence,
    contributingFeatures: contributions.slice(0, 5) // Only return top 5 contributors
  };
}

/**
 * Generate an alpha signal using the loaded NLP model and feature set
 */
export async function predictNLPAlpha(
  features: AssetFeatureSet,
  modelConfig?: NLPModelConfig
): Promise<NLPAlpha | null> {
  try {
    // Load model if not provided
    const model = modelConfig || await loadNLPModel(features.asset);
    
    // Skip prediction if not enough headlines
    if (features.headline_count < 2) {
      logger.debug(`Insufficient headlines for ${features.asset}, skipping NLP prediction`);
      return null;
    }
    
    let prediction: NLPAlpha;
    
    // Different prediction models based on type
    switch (model.type) {
      case NLPModelType.LINEAR:
        prediction = predictLinear(features, model);
        break;
        
      case NLPModelType.GRADIENT_BOOST:
      case NLPModelType.NEURAL_NET:
      case NLPModelType.ENSEMBLE:
        // More complex models would be implemented here
        // For now, fallback to linear model
        prediction = predictLinear(features, model);
        break;
        
      default:
        prediction = predictLinear(features, model);
    }
    
    // Only return prediction if confidence meets threshold
    if (prediction.confidence < model.minConfidence) {
      logger.debug(
        `Low confidence NLP prediction for ${features.asset}: ${prediction.confidence.toFixed(2)}`
      );
      return null;
    }
    
    return prediction;
  } catch (error) {
    logger.error(`Error in NLP prediction for ${features.asset}: ${error}`);
    return null;
  }
}

/**
 * Get NLP alpha for a window of time
 * @param featureSets Array of feature sets for historical window
 * @param modelConfig Model configuration
 * @returns Array of NLP alpha predictions
 */
export async function predictNLPAlphaWindow(
  featureSets: AssetFeatureSet[],
  modelConfig?: NLPModelConfig
): Promise<NLPAlpha[]> {
  if (featureSets.length === 0) return [];
  
  // Load model if not provided
  const model = modelConfig || await loadNLPModel(featureSets[0].asset);
  
  // Process each feature set
  const predictions: NLPAlpha[] = [];
  
  for (const features of featureSets) {
    const prediction = await predictNLPAlpha(features, model);
    if (prediction) {
      predictions.push(prediction);
    }
  }
  
  return predictions;
} 