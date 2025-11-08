/**
 * Social Model Adapter
 * 
 * Injects social signals into trading strategy models, allowing
 * strategies to incorporate social sentiment and other metrics into their decisions.
 */

import { createLogger } from '../common/logger.js';
import { ModelAdapterConfig, UnifiedSocialSignal } from './types.js';

const logger = createLogger('SocialModelAdapter');

/**
 * Configuration for a specific strategy model
 */
export interface StrategyModelConfig {
  // Unique ID of the strategy
  strategyId: string;
  // Asset/token this strategy trades
  token: string;
  // Weight of social influence (0-1)
  socialInfluenceWeight: number;
  // Maximum bias adjustment from social signals (-1 to 1)
  maxSocialBiasAdjustment: number;
  // How to handle risk flags
  riskFlagHandling: {
    // Whether to reduce position size on risk flags
    reduceSize: boolean;
    // Whether to increase required confidence on risk flags
    increaseConfidenceThreshold: boolean;
    // Max risk discount factor (0-1)
    maxRiskDiscount: number;
  };
}

/**
 * Signal injection result
 */
export interface SignalInjectionResult {
  strategyId: string;
  token: string;
  timestamp: number;
  appliedBiasAdjustment: number;
  appliedRiskAdjustment: number | null;
  signalConfidence: number;
  activeRiskFlags: string[];
}

/**
 * Strategy model interface that can receive social signals
 */
export interface SocialAwareStrategyModel {
  // The strategy's unique ID
  getStrategyId(): string;
  // The asset/token this strategy trades
  getToken(): string;
  // Adjust bias based on social signals
  adjustRiskBias(biasAdjustment: number): void;
  // Modify risk parameters based on flags
  adjustRiskParameters(
    riskDiscount: number, 
    confidenceMultiplier: number
  ): void;
  // Get current social influence configuration
  getSocialInfluenceConfig(): {
    enabled: boolean;
    weight: number;
    maxBiasAdjustment: number;
  };
}

/**
 * Service that adapts unified social signals for injection into trading strategy models
 */
export class SocialModelAdapter {
  private config: ModelAdapterConfig;
  private registeredModels: Map<string, SocialAwareStrategyModel> = new Map();
  private modelConfigs: Map<string, StrategyModelConfig> = new Map();
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private getLatestSignal: (token: string) => Promise<UnifiedSocialSignal | null>;
  private metricsLogger?: (metric: string, value: any) => void;
  private lastInjectionResults: Map<string, SignalInjectionResult> = new Map();

  constructor(
    config: ModelAdapterConfig,
    signalGetter: (token: string) => Promise<UnifiedSocialSignal | null>,
    metricsLogger?: (metric: string, value: any) => void
  ) {
    this.config = config;
    this.getLatestSignal = signalGetter;
    this.metricsLogger = metricsLogger;
    
    logger.info('Social Model Adapter initialized');
  }

  /**
   * Register a strategy model for signal injection
   */
  public registerModel(
    model: SocialAwareStrategyModel,
    config?: Partial<StrategyModelConfig>
  ): void {
    const strategyId = model.getStrategyId();
    const token = model.getToken().toUpperCase();
    
    // Get social influence configuration from the model
    const modelSocialConfig = model.getSocialInfluenceConfig();
    
    // If social influence is disabled, don't register
    if (!modelSocialConfig.enabled) {
      logger.info(`Model ${strategyId} has social influence disabled, not registering`);
      return;
    }
    
    // Create config with defaults
    const modelConfig: StrategyModelConfig = {
      strategyId,
      token,
      socialInfluenceWeight: config?.socialInfluenceWeight ?? 
        modelSocialConfig.weight ?? 
        this.config.defaultSocialInfluenceWeight,
      maxSocialBiasAdjustment: config?.maxSocialBiasAdjustment ?? 
        modelSocialConfig.maxBiasAdjustment ?? 
        0.1, // Default max bias adjustment of 10%
      riskFlagHandling: config?.riskFlagHandling ?? {
        reduceSize: true,
        increaseConfidenceThreshold: true,
        maxRiskDiscount: 0.5
      }
    };
    
    // Store model and config
    this.registeredModels.set(strategyId, model);
    this.modelConfigs.set(strategyId, modelConfig);
    
    logger.info(`Registered model ${strategyId} for token ${token} with social influence weight ${modelConfig.socialInfluenceWeight}`);
  }

  /**
   * Unregister a strategy model
   */
  public unregisterModel(strategyId: string): void {
    this.registeredModels.delete(strategyId);
    this.modelConfigs.delete(strategyId);
    this.lastInjectionResults.delete(strategyId);
    
    logger.info(`Unregistered model ${strategyId}`);
  }

  /**
   * Start periodic signal injection
   */
  public start(): void {
    if (this.updateInterval) {
      logger.warn('Social Model Adapter already running');
      return;
    }

    logger.info(`Starting social model adapter with update interval of ${this.config.updateIntervalMs}ms`);
    
    this.updateInterval = setInterval(() => {
      this.injectSignalsToAllModels();
    }, this.config.updateIntervalMs);
  }

  /**
   * Stop periodic signal injection
   */
  public stop(): void {
    if (!this.updateInterval) {
      logger.warn('Social Model Adapter was not running');
      return;
    }

    clearInterval(this.updateInterval);
    this.updateInterval = null;
    logger.info('Stopped social model adapter');
  }

  /**
   * Manually trigger signal injection for all models
   */
  public async injectSignalsToAllModels(): Promise<void> {
    try {
      const strategyIds = Array.from(this.registeredModels.keys());
      const results = await Promise.all(
        strategyIds.map(id => this.injectSignalToModel(id))
      );
      
      const successfulInjections = results.filter(Boolean).length;
      
      if (this.metricsLogger) {
        this.metricsLogger('social_signals.injections', successfulInjections);
      }
      
      logger.debug(`Injected signals to ${successfulInjections}/${strategyIds.length} models`);
    } catch (error) {
      logger.error(`Error injecting signals to models: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Inject signal to a specific model
   */
  public async injectSignalToModel(strategyId: string): Promise<SignalInjectionResult | null> {
    try {
      const model = this.registeredModels.get(strategyId);
      const config = this.modelConfigs.get(strategyId);
      
      if (!model || !config) {
        logger.warn(`Model ${strategyId} not found for signal injection`);
        return null;
      }
      
      const token = config.token;
      const signal = await this.getLatestSignal(token);
      
      if (!signal) {
        logger.debug(`No signal available for ${token}, skipping injection to ${strategyId}`);
        return null;
      }
      
      // Check signal freshness
      const signalAge = Date.now() - signal.timestamp;
      if (signalAge > this.config.signalValidityPeriodMs) {
        logger.debug(`Signal for ${token} is too old (${signalAge}ms), skipping injection to ${strategyId}`);
        return null;
      }
      
      // Calculate bias adjustment from sentiment
      // Map sentiment from [-1,1] to bias adjustment [-max, max]
      const rawBiasAdjustment = signal.features.sentiment * config.maxSocialBiasAdjustment;
      
      // Apply social influence weight
      const weightedBiasAdjustment = rawBiasAdjustment * config.socialInfluenceWeight;
      
      // Apply bias adjustment to model
      model.adjustRiskBias(weightedBiasAdjustment);
      
      // Handle risk flags if present
      let riskAdjustment: number | null = null;
      
      if (signal.features.riskFlags.length > 0 && config.riskFlagHandling.reduceSize) {
        // Calculate risk discount based on number and type of flags
        const flagCount = signal.features.riskFlags.length;
        const maxDiscount = config.riskFlagHandling.maxRiskDiscount;
        
        // More flags = more risk discount, up to max
        riskAdjustment = Math.min(maxDiscount, flagCount * 0.1);
        
        // Increase required confidence if configured
        const confidenceMultiplier = config.riskFlagHandling.increaseConfidenceThreshold
          ? 1 + riskAdjustment // Up to 1.5x confidence required
          : 1.0;
        
        // Apply risk adjustments to model
        model.adjustRiskParameters(1 - riskAdjustment, confidenceMultiplier);
        
        logger.info(`Applied risk adjustments to ${strategyId} due to flags: ${signal.features.riskFlags.join(', ')}`);
      }
      
      // Calculate signal confidence for metrics
      // Higher confidence if more sources contribute and influencer weight is high
      const sourceCount = Object.keys(signal.sources).length;
      const signalConfidence = Math.min(
        1.0,
        (sourceCount / 3) * 0.5 + signal.features.influencerWeight * 0.5
      );
      
      // Record result
      const result: SignalInjectionResult = {
        strategyId,
        token,
        timestamp: Date.now(),
        appliedBiasAdjustment: weightedBiasAdjustment,
        appliedRiskAdjustment: riskAdjustment,
        signalConfidence,
        activeRiskFlags: signal.features.riskFlags
      };
      
      this.lastInjectionResults.set(strategyId, result);
      
      if (this.metricsLogger) {
        this.metricsLogger(`social_signals.bias_adjustment.${token}`, weightedBiasAdjustment);
        if (riskAdjustment !== null) {
          this.metricsLogger(`social_signals.risk_adjustment.${token}`, riskAdjustment);
        }
      }
      
      logger.debug(`Injected signal to ${strategyId} with bias adjustment ${weightedBiasAdjustment.toFixed(4)}`);
      return result;
    } catch (error) {
      logger.error(`Error injecting signal to model ${strategyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get last injection result for a strategy
   */
  public getLastInjectionResult(strategyId: string): SignalInjectionResult | null {
    return this.lastInjectionResults.get(strategyId) || null;
  }

  /**
   * Get all registered models
   */
  public getRegisteredModels(): string[] {
    return Array.from(this.registeredModels.keys());
  }

  /**
   * Update configuration for a registered model
   */
  public updateModelConfig(
    strategyId: string,
    configUpdate: Partial<StrategyModelConfig>
  ): boolean {
    const existingConfig = this.modelConfigs.get(strategyId);
    
    if (!existingConfig) {
      logger.warn(`Cannot update config for model ${strategyId}: model not registered`);
      return false;
    }
    
    const updatedConfig = {
      ...existingConfig,
      ...configUpdate,
      // Ensure nested objects are merged properly
      riskFlagHandling: {
        ...existingConfig.riskFlagHandling,
        ...(configUpdate.riskFlagHandling || {})
      }
    };
    
    this.modelConfigs.set(strategyId, updatedConfig);
    logger.info(`Updated config for model ${strategyId}`);
    return true;
  }
} 