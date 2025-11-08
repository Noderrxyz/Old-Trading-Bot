/**
 * Signal Generator
 * 
 * Orchestrates the generation of trading signals by combining multiple alpha sources,
 * including NLP-derived alpha from news headlines.
 */

import { createLogger } from '../../common/logger';
import { getLatestFeatures, getFeatureWindow, TimeBin } from '../../altdata/features';
import { blendSignals, AlphaSignal, BlendedAlpha, AlphaBlendInputs } from '../alpha/blend';
import { predictNLPAlpha, loadNLPModel, NLPAlpha } from '../alpha/nlpModel';
import { getStrategyConfig, isNLPEnabledForStrategy } from './weights';

const logger = createLogger('SignalGenerator');

/**
 * Generate a UUID v4 compatible string
 * This is a simple implementation that doesn't rely on the crypto module
 */
function generateUUID(): string {
  // eslint-disable-next-line
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Types of technical alpha generators
 */
export enum TechnicalAlphaType {
  MOMENTUM = 'momentum',
  BREAKOUT = 'breakout',
  MEAN_REVERSION = 'mean_reversion',
  VOLATILITY = 'volatility'
}

/**
 * Signal with metadata for tracking and execution
 */
export interface Signal {
  id: string;
  strategyId: string;
  asset: string;
  timestamp: string;
  signal: number;
  confidence: number;
  threshold: number;
  components: {
    [key: string]: {
      signal: number;
      weight: number;
      contribution: number;
    };
  };
  metadata: {
    nlpEnabled: boolean;
    generatedAt: string;
    baseAlpha: string;
  };
}

/**
 * Mock implementation of technical alpha generation
 * In a real system, this would calculate alpha based on price data
 */
async function generateTechnicalAlpha(
  asset: string,
  alphaType: TechnicalAlphaType,
  timestamp: Date = new Date()
): Promise<AlphaSignal> {
  // In a real implementation, this would use market data
  // For now, generate a random alpha between -1 and 1
  const randomSignal = (Math.random() * 2 - 1) * 0.8; // -0.8 to 0.8
  
  return {
    asset,
    timestamp: timestamp.toISOString(),
    signal: randomSignal,
    confidence: 0.7 + Math.random() * 0.2 // 0.7 to 0.9
  };
}

/**
 * Parse the base alpha type from the strategy config
 */
function parseBaseAlphaType(baseAlpha: string): TechnicalAlphaType {
  const [type] = baseAlpha.split(':');
  
  switch (type.toLowerCase()) {
    case 'momentum':
      return TechnicalAlphaType.MOMENTUM;
    case 'breakout':
      return TechnicalAlphaType.BREAKOUT;
    case 'mean_reversion':
      return TechnicalAlphaType.MEAN_REVERSION;
    case 'volatility':
      return TechnicalAlphaType.VOLATILITY;
    default:
      // Default to momentum if unknown type
      logger.warn(`Unknown alpha type: ${type}, defaulting to momentum`);
      return TechnicalAlphaType.MOMENTUM;
  }
}

/**
 * Get the appropriate time bin for the lookback window
 */
function getTimeBinForLookback(lookbackMinutes: number): TimeBin {
  if (lookbackMinutes <= 5) return TimeBin.ONE_MINUTE;
  if (lookbackMinutes <= 15) return TimeBin.FIVE_MINUTES;
  if (lookbackMinutes <= 60) return TimeBin.FIFTEEN_MINUTES;
  if (lookbackMinutes <= 240) return TimeBin.ONE_HOUR;
  return TimeBin.FOUR_HOURS;
}

/**
 * Generate a complete signal for a strategy
 */
export async function generateSignal(
  strategyId: string,
  currentTime: Date = new Date()
): Promise<Signal | null> {
  try {
    // Get strategy configuration
    const strategyConfig = getStrategyConfig(strategyId);
    if (!strategyConfig) {
      logger.error(`Strategy not found: ${strategyId}`);
      return null;
    }
    
    const { asset, baseAlpha, nlpAlphaEnabled, nlpWeight, blendMethod, threshold, lookbackWindow } = strategyConfig;
    
    // Generate base technical alpha
    const baseAlphaType = parseBaseAlphaType(baseAlpha);
    const baseSignal = await generateTechnicalAlpha(asset, baseAlphaType, currentTime);
    
    // Initialize the blend inputs with base signal
    const blendInputs: AlphaBlendInputs = {
      baseSignal
    };
    
    // Add NLP signal if enabled for this strategy
    if (nlpAlphaEnabled) {
      try {
        // Determine the appropriate time bin
        const timeBin = getTimeBinForLookback(lookbackWindow);
        
        // Get the latest features from the feature store
        const features = await getLatestFeatures(asset, timeBin);
        
        if (features) {
          // Load NLP model for the asset
          const model = await loadNLPModel(asset);
          
          // Set the lookback window from the strategy config
          model.lookbackWindow = lookbackWindow;
          
          // Generate NLP alpha from the features
          const nlpAlpha = await predictNLPAlpha(features, model);
          
          // Add to blend inputs if valid
          if (nlpAlpha) {
            blendInputs.nlpSignal = nlpAlpha;
            logger.debug(`Added NLP signal for ${asset}: ${nlpAlpha.signal.toFixed(4)}`);
          } else {
            logger.debug(`No valid NLP signal generated for ${asset}`);
          }
        } else {
          logger.debug(`No features found for ${asset} with time bin ${timeBin}`);
        }
      } catch (error) {
        logger.error(`Error generating NLP signal for ${asset}: ${error}`);
      }
    }
    
    // Estimate current market volatility (in a real system, this would use actual data)
    const marketVolatility = 0.015; // 1.5% volatility - this would be dynamic in a real system
    
    // Blend the signals using the configured method and weights
    const blendedSignal = blendSignals(
      blendInputs,
      {
        method: blendMethod,
        weights: {
          technical: 1 - nlpWeight,
          nlp: nlpWeight
        }
      },
      { volatility: marketVolatility }
    );
    
    // Create the final signal
    const signal: Signal = {
      id: generateUUID(),
      strategyId,
      asset,
      timestamp: currentTime.toISOString(),
      signal: blendedSignal.signal,
      confidence: blendedSignal.confidence,
      threshold,
      components: blendedSignal.components,
      metadata: {
        nlpEnabled: nlpAlphaEnabled && !!blendInputs.nlpSignal,
        generatedAt: new Date().toISOString(),
        baseAlpha
      }
    };
    
    // Log the signal generation
    logger.info(
      `Generated signal for ${strategyId}: ${signal.signal.toFixed(4)} ` +
      `(confidence: ${signal.confidence.toFixed(2)})`
    );
    
    return signal;
  } catch (error) {
    logger.error(`Error generating signal for ${strategyId}: ${error}`);
    return null;
  }
}

/**
 * Store a signal in the feature store (Redis)
 * This allows for retrieval and analysis later
 */
export async function storeSignal(signal: Signal): Promise<void> {
  // In a real implementation, this would store the signal in Redis or another store
  logger.debug(`Signal stored: ${signal.id}`);
}

/**
 * Generate signals for all strategies for an asset
 */
export async function generateSignalsForAsset(
  asset: string,
  currentTime: Date = new Date()
): Promise<Signal[]> {
  // Get all strategies for the asset
  const strategyIds = Object.values(getStrategyConfig).filter(
    config => config?.asset === asset
  ).map(config => config?.strategyId) as string[];
  
  // Generate signals in parallel
  const signalPromises = strategyIds.map(id => generateSignal(id, currentTime));
  const signals = await Promise.all(signalPromises);
  
  // Filter out null signals
  return signals.filter((signal): signal is Signal => signal !== null);
}

/**
 * Check if a signal exceeds the threshold for action
 * @param signal The signal to check
 * @returns true if the signal should trigger action, false otherwise
 */
export function isSignalActionable(signal: Signal): boolean {
  // Signal strength must exceed threshold and have sufficient confidence
  const signalStrength = Math.abs(signal.signal);
  return signalStrength >= signal.threshold && signal.confidence >= 0.6;
} 