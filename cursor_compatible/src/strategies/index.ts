/**
 * Strategy Engine with NLP Integration
 * 
 * Core strategy engine that combines technical analysis with NLP-derived
 * insights from news headlines to generate enhanced trading signals.
 */

// Export signal generation components
export { 
  generateSignal, 
  generateSignalsForAsset,
  isSignalActionable,
  Signal,
  TechnicalAlphaType
} from './engine/signalGenerator';

// Export strategy configuration components
export {
  getStrategyConfig,
  getAllStrategies,
  getStrategiesForAsset,
  isNLPEnabledForStrategy,
  StrategyConfig,
  DEFAULT_STRATEGIES,
  EXPERIMENTAL_STRATEGIES
} from './engine/weights';

// Export alpha blending components
export {
  blendSignals,
  BlendMethod,
  AlphaSignal,
  BlendedAlpha,
  TechnicalAlpha,
  ChainAlpha,
  BlendConfig
} from './alpha/blend';

// Export NLP model components
export {
  predictNLPAlpha,
  loadNLPModel,
  NLPAlpha,
  NLPModelType,
  NLPModelConfig
} from './alpha/nlpModel';

/**
 * Initialize all strategies with NLP integration
 * This registers models and prepares for signal generation
 */
export async function initializeStrategies(): Promise<void> {
  const { createLogger } = await import('../common/logger.js');
  const logger = createLogger('StrategyInit');
  
  logger.info('Initializing strategy engine with NLP integration');
  
  // In a real implementation, this would load models, initialize connections, etc.
  // For now, we just log that it's ready
  
  logger.info('Strategy engine initialized successfully');
}

/**
 * Run a signal generation cycle for all active strategies
 * This is typically called on a fixed interval (e.g., every minute)
 */
export async function runSignalGenerationCycle(): Promise<void> {
  const { createLogger } = await import('../common/logger.js');
  const { getAllStrategies } = await import('./engine/weights.js');
  const { generateSignal, isSignalActionable, storeSignal } = await import('./engine/signalGenerator.js');
  
  const logger = createLogger('SignalCycle');
  
  logger.info('Running signal generation cycle');
  
  // Get all active strategies
  const strategies = getAllStrategies();
  
  // Current time used for all signals in this cycle
  const currentTime = new Date();
  
  // Generate signals for all strategies
  const signalPromises = strategies.map(async (strategy: { strategyId: string }) => {
    const signal = await generateSignal(strategy.strategyId, currentTime);
    
    if (signal) {
      // Store all signals for historical analysis
      await storeSignal(signal);
      
      // Log actionable signals
      if (isSignalActionable(signal)) {
        logger.info(
          `ACTIONABLE SIGNAL: ${strategy.strategyId} ${signal.asset} ${signal.signal > 0 ? 'BUY' : 'SELL'} ` +
          `(strength: ${Math.abs(signal.signal).toFixed(3)}, confidence: ${signal.confidence.toFixed(2)})`
        );
      }
      
      return signal;
    }
    return null;
  });
  
  // Wait for all signal generations to complete
  const signals = await Promise.all(signalPromises);
  const validSignals = signals.filter(s => s !== null);
  
  logger.info(`Signal generation cycle complete: ${validSignals.length} signals generated`);
} 