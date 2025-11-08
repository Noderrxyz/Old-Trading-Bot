/**
 * Strategy Lifecycle Manager
 * 
 * Manages the full lifecycle of strategies, including:
 * - Strategy rotation when decay is detected
 * - Model retraining
 * - Feature weight adjustments
 * - Strategy disabling/enabling
 * - Fallback strategy selection
 */

import { EventEmitter } from 'events';
import { createLogger } from '../common/logger.js';
import { RedisClient } from '../common/redis.js';

import { DecayScorer, DecayFlag, DecayResult, DecayConfig } from './decay/decayScorer.js';
import { AttributionMonitor, AttributionDecayAnalysis } from './decay/attributionMonitor.js';
import { PerformanceTracker, TimeWindow } from './decay/performanceTracker.js';
import { 
  DecayEventManager, 
  DecayEventType,
  DecayEvent
} from './decay/decayEvents.js';

const logger = createLogger('LifecycleManager');

/**
 * Strategy rotation mode
 */
export enum RotationMode {
  // Automatic full replacement via model repository
  AUTO_ROTATE = 'auto_rotate',
  
  // Adjust weights but maintain the same base model
  ADJUST_WEIGHTS = 'adjust_weights',
  
  // Just log and notify operators, no automatic action
  ALERT_ONLY = 'alert_only'
}

/**
 * Rotation action to take
 */
export enum RotationAction {
  // Replace with a new version of the same strategy type
  REPLACE_WITH_SIBLING = 'replace_with_sibling',
  
  // Retrain the existing strategy with newer data
  RETRAIN = 'retrain',
  
  // Inject a fallback strategy (e.g., market-neutral)
  INJECT_FALLBACK = 'inject_fallback',
  
  // Adjust alpha input weights to favor more predictive features
  ADJUST_ALPHA_WEIGHTS = 'adjust_alpha_weights',
  
  // Disable the strategy
  DISABLE = 'disable',
  
  // No action needed
  NONE = 'none'
}

/**
 * Configuration for the lifecycle manager
 */
export interface LifecycleManagerConfig {
  // Default rotation mode
  defaultRotationMode: RotationMode;
  
  // Whether to automatically apply recommended actions
  autoApplyActions: boolean;
  
  // Whether to disable strategies with high decay
  autoDisableHighDecay: boolean;
  
  // Decay score thresholds
  highDecayThreshold: number;
  moderateDecayThreshold: number;
  lowDecayThreshold: number;
  
  // Days to wait between rotation actions
  minDaysBetweenRotations: number;
  
  // Maximum number of rotations before requiring manual intervention
  maxAutoRotations: number;
  
  // Whether to enable fallback strategies
  enableFallbacks: boolean;
  
  // Default fallback strategy template
  defaultFallbackStrategyId: string;
  
  // Strategy families (for sibling selection)
  strategyFamilies: Record<string, string[]>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: LifecycleManagerConfig = {
  defaultRotationMode: RotationMode.ALERT_ONLY,
  autoApplyActions: false,
  autoDisableHighDecay: true,
  highDecayThreshold: 0.8,
  moderateDecayThreshold: 0.6,
  lowDecayThreshold: 0.4,
  minDaysBetweenRotations: 7,
  maxAutoRotations: 3,
  enableFallbacks: true,
  defaultFallbackStrategyId: 'market_neutral_base',
  strategyFamilies: {}
};

/**
 * Rotation analysis result
 */
export interface RotationAnalysis {
  strategyId: string;
  timestamp: number;
  decayScore: number;
  decayFlags: DecayFlag[];
  recommendedAction: RotationAction;
  explanation: string;
  suggestedReplacementId?: string;
  suggestedWeightAdjustments?: Record<string, number>;
  autoApplied: boolean;
}

/**
 * Manages strategy lifecycle decisions
 */
export class LifecycleManager {
  private redis: RedisClient;
  private emitter: EventEmitter;
  private config: LifecycleManagerConfig;
  
  private decayScorer: DecayScorer;
  private attributionMonitor: AttributionMonitor;
  private performanceTracker: PerformanceTracker;
  private eventManager: DecayEventManager;
  
  private rotationCounts: Map<string, number> = new Map();
  private lastRotationTimes: Map<string, number> = new Map();
  
  /**
   * Create a new lifecycle manager
   */
  constructor(
    redis: RedisClient,
    emitter: EventEmitter,
    decayScorer: DecayScorer,
    attributionMonitor: AttributionMonitor,
    performanceTracker: PerformanceTracker,
    eventManager: DecayEventManager,
    config: Partial<LifecycleManagerConfig> = {}
  ) {
    this.redis = redis;
    this.emitter = emitter;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.decayScorer = decayScorer;
    this.attributionMonitor = attributionMonitor;
    this.performanceTracker = performanceTracker;
    this.eventManager = eventManager;
    
    // Register event listeners
    this.registerEventListeners();
    
    logger.info('Strategy lifecycle manager initialized');
  }
  
  /**
   * Register event listeners
   */
  private registerEventListeners(): void {
    // Listen for threshold crossed events
    this.emitter.on(DecayEventType.DECAY_THRESHOLD_CROSSED, (event: DecayEvent) => {
      this.handleDecayThresholdCrossed(event);
    });
    
    // Listen for strategy rotated events to update counts
    this.emitter.on(DecayEventType.STRATEGY_ROTATED, (event: DecayEvent) => {
      const rotatedEvent = event as any; // Type assertion to access oldStrategyId
      if (rotatedEvent.oldStrategyId) {
        this.incrementRotationCount(rotatedEvent.oldStrategyId);
        this.updateLastRotationTime(rotatedEvent.oldStrategyId);
      }
    });
  }
  
  /**
   * Handle decay threshold crossed event
   * @param event The event
   */
  private async handleDecayThresholdCrossed(event: DecayEvent): Promise<void> {
    if (this.config.autoApplyActions) {
      logger.info(`Auto-handling decay threshold crossed for ${event.strategyId}`);
      
      const analysis = await this.analyzeRotationNeeds(event.strategyId);
      
      if (analysis && analysis.recommendedAction !== RotationAction.NONE) {
        await this.applyRotationAction(analysis);
      }
    }
  }
  
  /**
   * Check for strategy decay and return recommendations
   * @param strategyId Strategy ID
   * @returns Rotation analysis
   */
  public async analyzeRotationNeeds(strategyId: string): Promise<RotationAnalysis | null> {
    try {
      // Get current decay score
      const decayResult = await this.decayScorer.getDecayScore(strategyId);
      
      if (!decayResult) {
        logger.debug(`No decay score available for ${strategyId}`);
        return null;
      }
      
      // Check attribution decay
      const attributionAnalysis = await this.attributionMonitor.analyzeFeatureDecay(strategyId);
      
      // Determine action based on decay score
      const action = this.determineRotationAction(decayResult, attributionAnalysis);
      
      // Determine if we can auto-apply this action
      const canAutoApply = this.canAutoApplyAction(strategyId, action);
      
      // Generate explanation
      const explanation = this.generateExplanation(
        decayResult,
        attributionAnalysis,
        action
      );
      
      // Determine suggested replacement strategy
      const suggestedReplacement = action === RotationAction.REPLACE_WITH_SIBLING || 
                                   action === RotationAction.INJECT_FALLBACK
        ? this.suggestReplacementStrategy(strategyId, action)
        : undefined;
      
      // Determine suggested weight adjustments
      const suggestedWeights = action === RotationAction.ADJUST_ALPHA_WEIGHTS && attributionAnalysis
        ? this.calculateAdjustedWeights(attributionAnalysis)
        : undefined;
      
      return {
        strategyId,
        timestamp: Date.now(),
        decayScore: decayResult.decayScore,
        decayFlags: decayResult.flags,
        recommendedAction: action,
        explanation,
        suggestedReplacementId: suggestedReplacement,
        suggestedWeightAdjustments: suggestedWeights,
        autoApplied: canAutoApply && this.config.autoApplyActions
      };
    } catch (error) {
      logger.error(`Failed to analyze rotation needs: ${error}`);
      return null;
    }
  }
  
  /**
   * Apply a rotation action
   * @param analysis Rotation analysis
   * @returns True if action was applied, false otherwise
   */
  public async applyRotationAction(analysis: RotationAnalysis): Promise<boolean> {
    try {
      const { strategyId, decayScore, decayFlags, recommendedAction } = analysis;
      
      // Check if we can apply the action
      if (!this.canAutoApplyAction(strategyId, recommendedAction)) {
        logger.info(`Cannot auto-apply ${recommendedAction} for ${strategyId} due to constraints`);
        
        // Emit an alert instead
        await this.eventManager.emitDecayAlert(
          strategyId,
          decayScore,
          decayFlags,
          'warning',
          `Cannot auto-apply recommended action: ${recommendedAction}`,
          'Manual operator intervention required'
        );
        
        return false;
      }
      
      // Apply the action
      switch (recommendedAction) {
        case RotationAction.REPLACE_WITH_SIBLING:
          if (analysis.suggestedReplacementId) {
            await this.replaceStrategy(
              strategyId,
              analysis.suggestedReplacementId,
              decayScore,
              decayFlags
            );
          }
          break;
          
        case RotationAction.RETRAIN:
          await this.retrainStrategy(
            strategyId,
            decayScore,
            decayFlags
          );
          break;
          
        case RotationAction.INJECT_FALLBACK:
          if (analysis.suggestedReplacementId) {
            await this.injectFallback(
              strategyId,
              analysis.suggestedReplacementId,
              decayScore,
              decayFlags
            );
          }
          break;
          
        case RotationAction.ADJUST_ALPHA_WEIGHTS:
          if (analysis.suggestedWeightAdjustments) {
            await this.adjustAlphaWeights(
              strategyId,
              analysis.suggestedWeightAdjustments,
              decayScore,
              decayFlags
            );
          }
          break;
          
        case RotationAction.DISABLE:
          await this.disableStrategy(
            strategyId,
            decayScore,
            decayFlags
          );
          break;
          
        default:
          logger.info(`No action taken for ${strategyId}`);
          return false;
      }
      
      // Update rotation tracking
      if (recommendedAction === RotationAction.REPLACE_WITH_SIBLING ||
          recommendedAction === RotationAction.INJECT_FALLBACK) {
        this.incrementRotationCount(strategyId);
        this.updateLastRotationTime(strategyId);
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to apply rotation action: ${error}`);
      return false;
    }
  }
  
  /**
   * Determine appropriate rotation action
   * @param decayResult Decay result
   * @param attributionAnalysis Attribution analysis
   * @returns Recommended action
   */
  private determineRotationAction(
    decayResult: DecayResult,
    attributionAnalysis: AttributionDecayAnalysis | null
  ): RotationAction {
    // If decay score is very high, disable the strategy
    if (decayResult.decayScore >= this.config.highDecayThreshold && this.config.autoDisableHighDecay) {
      return RotationAction.DISABLE;
    }
    
    // If decay score is high, replace the strategy
    if (decayResult.decayScore >= this.config.highDecayThreshold) {
      return RotationAction.REPLACE_WITH_SIBLING;
    }
    
    // If decay score is moderate, check for more specific actions
    if (decayResult.decayScore >= this.config.moderateDecayThreshold) {
      // If we have attribution decay in specific features, adjust weights
      if (attributionAnalysis && attributionAnalysis.decayingFeatures.length > 0) {
        return RotationAction.ADJUST_ALPHA_WEIGHTS;
      }
      
      // Otherwise, retrain the strategy
      return RotationAction.RETRAIN;
    }
    
    // If decay score is low but above threshold, adjust weights if needed
    if (decayResult.decayScore >= this.config.lowDecayThreshold) {
      if (attributionAnalysis && attributionAnalysis.decayingFeatures.length > 0) {
        return RotationAction.ADJUST_ALPHA_WEIGHTS;
      }
    }
    
    // No action needed
    return RotationAction.NONE;
  }
  
  /**
   * Check if we can automatically apply an action
   * @param strategyId Strategy ID
   * @param action Action to check
   * @returns True if action can be automatically applied
   */
  private canAutoApplyAction(strategyId: string, action: RotationAction): boolean {
    // If auto-apply is disabled, we can't auto-apply any action
    if (!this.config.autoApplyActions) {
      return false;
    }
    
    // Check specific constraints for each action
    switch (action) {
      case RotationAction.REPLACE_WITH_SIBLING:
      case RotationAction.INJECT_FALLBACK:
        // Check rotation count limit
        const rotationCount = this.rotationCounts.get(strategyId) || 0;
        if (rotationCount >= this.config.maxAutoRotations) {
          return false;
        }
        
        // Check minimum days between rotations
        const lastRotation = this.lastRotationTimes.get(strategyId) || 0;
        const daysSinceLastRotation = (Date.now() - lastRotation) / (1000 * 60 * 60 * 24);
        if (daysSinceLastRotation < this.config.minDaysBetweenRotations) {
          return false;
        }
        
        // For siblings, check if we have family members defined
        if (action === RotationAction.REPLACE_WITH_SIBLING) {
          const family = this.getStrategyFamily(strategyId);
          if (!family || family.length <= 1) {
            return false;
          }
        }
        
        // For fallbacks, check if fallbacks are enabled
        if (action === RotationAction.INJECT_FALLBACK && !this.config.enableFallbacks) {
          return false;
        }
        
        return true;
        
      case RotationAction.RETRAIN:
      case RotationAction.ADJUST_ALPHA_WEIGHTS:
        // These actions are less disruptive, so fewer constraints
        return true;
        
      case RotationAction.DISABLE:
        // Only allow auto-disable if explicitly configured
        return this.config.autoDisableHighDecay;
        
      case RotationAction.NONE:
        // No action, so always "yes" we can do nothing
        return true;
        
      default:
        return false;
    }
  }
  
  /**
   * Generate an explanation for the rotation analysis
   * @param decayResult Decay result
   * @param attributionAnalysis Attribution analysis
   * @param action Recommended action
   * @returns Explanation text
   */
  private generateExplanation(
    decayResult: DecayResult,
    attributionAnalysis: AttributionDecayAnalysis | null,
    action: RotationAction
  ): string {
    const flagsText = decayResult.flags.join(', ');
    
    switch (action) {
      case RotationAction.REPLACE_WITH_SIBLING:
        return `High decay score (${decayResult.decayScore.toFixed(2)}) with flags: ${flagsText}. Recommend replacing with sibling strategy.`;
        
      case RotationAction.RETRAIN:
        return `Moderate decay score (${decayResult.decayScore.toFixed(2)}) with flags: ${flagsText}. Recommend retraining with fresh data.`;
        
      case RotationAction.INJECT_FALLBACK:
        return `High decay score (${decayResult.decayScore.toFixed(2)}) with flags: ${flagsText}. No suitable sibling found. Recommend injecting fallback strategy.`;
        
      case RotationAction.ADJUST_ALPHA_WEIGHTS:
        const decayingFeatures = attributionAnalysis?.decayingFeatures.join(', ') || 'unknown';
        return `Feature decay detected in: ${decayingFeatures}. Recommend adjusting feature weights.`;
        
      case RotationAction.DISABLE:
        return `Critical decay score (${decayResult.decayScore.toFixed(2)}) with flags: ${flagsText}. Recommend disabling strategy.`;
        
      case RotationAction.NONE:
        return `Low decay score (${decayResult.decayScore.toFixed(2)}). No action needed.`;
        
      default:
        return `Unknown action recommendation for decay score ${decayResult.decayScore.toFixed(2)}.`;
    }
  }
  
  /**
   * Calculate adjusted weights based on attribution analysis
   * @param analysis Attribution analysis
   * @returns Adjusted weights
   */
  private calculateAdjustedWeights(
    analysis: AttributionDecayAnalysis
  ): Record<string, number> {
    // Start with existing weights
    const weights: Record<string, number> = {};
    
    // Collect all feature results
    const featureResults = analysis.featureResults;
    
    // Calculate base weight as 1 / number of features
    const baseWeight = 1 / Math.max(1, featureResults.length);
    
    // Assign initial weights
    for (const feature of featureResults) {
      // Decaying features get reduced weight
      if (feature.isDecaying) {
        weights[feature.feature] = baseWeight * 0.5;
      } 
      // Improving features get increased weight
      else if (analysis.improvingFeatures.includes(feature.feature)) {
        weights[feature.feature] = baseWeight * 1.5;
      }
      // Others get normal weight
      else {
        weights[feature.feature] = baseWeight;
      }
    }
    
    // Normalize weights to sum to 1
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    
    for (const [feature, weight] of Object.entries(weights)) {
      weights[feature] = weight / totalWeight;
    }
    
    return weights;
  }
  
  /**
   * Suggest a replacement strategy
   * @param strategyId Strategy ID
   * @param action Action type
   * @returns Suggested replacement strategy ID
   */
  private suggestReplacementStrategy(
    strategyId: string,
    action: RotationAction
  ): string | undefined {
    if (action === RotationAction.REPLACE_WITH_SIBLING) {
      // Look up siblings in the same family
      const family = this.getStrategyFamily(strategyId);
      
      if (family && family.length > 1) {
        // Find the next version or the newest version if at the end
        const currentIndex = family.indexOf(strategyId);
        
        if (currentIndex >= 0 && currentIndex < family.length - 1) {
          // Return the next version
          return family[currentIndex + 1];
        } else {
          // Return the newest version
          return family[family.length - 1];
        }
      }
    }
    
    if (action === RotationAction.INJECT_FALLBACK) {
      // Use the default fallback
      return this.config.defaultFallbackStrategyId;
    }
    
    return undefined;
  }
  
  /**
   * Replace a strategy with a sibling
   * @param oldStrategyId Old strategy ID
   * @param newStrategyId New strategy ID
   * @param decayScore Decay score
   * @param decayFlags Decay flags
   */
  private async replaceStrategy(
    oldStrategyId: string,
    newStrategyId: string,
    decayScore: number,
    decayFlags: DecayFlag[]
  ): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Disable the old strategy
      // 2. Enable the new strategy
      // 3. Copy over relevant state/configuration
      
      // For now, we just emit the event
      await this.eventManager.emitStrategyRotated(
        oldStrategyId,
        newStrategyId,
        decayScore,
        decayFlags,
        'Replacing with sibling strategy due to high decay'
      );
      
      logger.info(`Rotated strategy ${oldStrategyId} to ${newStrategyId}`);
    } catch (error) {
      logger.error(`Failed to replace strategy: ${error}`);
      throw error;
    }
  }
  
  /**
   * Retrain a strategy
   * @param strategyId Strategy ID
   * @param decayScore Decay score
   * @param decayFlags Decay flags
   */
  private async retrainStrategy(
    strategyId: string,
    decayScore: number,
    decayFlags: DecayFlag[]
  ): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Collect training data
      // 2. Set up a training job
      // 3. Update the strategy with new weights
      
      // For now, we just emit the event
      await this.eventManager.emitRetrainingTriggered(
        strategyId,
        decayScore,
        decayFlags,
        { retrain_type: 'full', use_latest_data: true },
        'latest_market_data',
        'Retraining due to moderate decay'
      );
      
      logger.info(`Triggered retraining for strategy ${strategyId}`);
    } catch (error) {
      logger.error(`Failed to retrain strategy: ${error}`);
      throw error;
    }
  }
  
  /**
   * Inject a fallback strategy
   * @param oldStrategyId Old strategy ID
   * @param fallbackStrategyId Fallback strategy ID
   * @param decayScore Decay score
   * @param decayFlags Decay flags
   */
  private async injectFallback(
    oldStrategyId: string,
    fallbackStrategyId: string,
    decayScore: number,
    decayFlags: DecayFlag[]
  ): Promise<void> {
    try {
      // Similar to strategy replacement, but with a fallback
      
      // Emit the event
      await this.eventManager.emitStrategyRotated(
        oldStrategyId,
        fallbackStrategyId,
        decayScore,
        decayFlags,
        'Injecting fallback strategy due to high decay with no suitable sibling'
      );
      
      logger.info(`Injected fallback strategy ${fallbackStrategyId} for ${oldStrategyId}`);
    } catch (error) {
      logger.error(`Failed to inject fallback strategy: ${error}`);
      throw error;
    }
  }
  
  /**
   * Adjust alpha weights
   * @param strategyId Strategy ID
   * @param newWeights New weights
   * @param decayScore Decay score
   * @param decayFlags Decay flags
   */
  private async adjustAlphaWeights(
    strategyId: string,
    newWeights: Record<string, number>,
    decayScore: number,
    decayFlags: DecayFlag[]
  ): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Get the current weights
      // 2. Update the weights in the strategy config
      
      // Mock old weights for now
      const oldWeights: Record<string, number> = {};
      for (const [feature, weight] of Object.entries(newWeights)) {
        oldWeights[feature] = weight > 0.5 ? weight - 0.2 : weight + 0.2;
      }
      
      // Emit the event
      await this.eventManager.emitWeightsAdjusted(
        strategyId,
        decayScore,
        decayFlags,
        oldWeights,
        newWeights,
        'Adjusting weights due to feature decay'
      );
      
      logger.info(`Adjusted weights for strategy ${strategyId}`);
    } catch (error) {
      logger.error(`Failed to adjust weights: ${error}`);
      throw error;
    }
  }
  
  /**
   * Disable a strategy
   * @param strategyId Strategy ID
   * @param decayScore Decay score
   * @param decayFlags Decay flags
   */
  private async disableStrategy(
    strategyId: string,
    decayScore: number,
    decayFlags: DecayFlag[]
  ): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Update the strategy status to disabled
      // 2. Stop any ongoing executions
      
      // Emit the event
      await this.eventManager.emitStrategyDisabled(
        strategyId,
        decayScore,
        decayFlags,
        'auto',
        'Disabling strategy due to critical decay'
      );
      
      logger.info(`Disabled strategy ${strategyId} due to high decay`);
    } catch (error) {
      logger.error(`Failed to disable strategy: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the strategy family (sibling strategies)
   * @param strategyId Strategy ID
   * @returns Array of sibling strategy IDs
   */
  private getStrategyFamily(strategyId: string): string[] | null {
    // First check if we have an exact family match
    for (const [family, strategies] of Object.entries(this.config.strategyFamilies)) {
      if (strategies.includes(strategyId)) {
        return strategies;
      }
    }
    
    // If no exact match, try a prefix match
    const prefix = this.getStrategyPrefix(strategyId);
    if (prefix) {
      const matchingStrategies: string[] = [];
      
      // Collect all strategies with the same prefix
      for (const family of Object.values(this.config.strategyFamilies)) {
        for (const strategy of family) {
          if (strategy.startsWith(prefix)) {
            matchingStrategies.push(strategy);
          }
        }
      }
      
      if (matchingStrategies.length > 0) {
        return matchingStrategies;
      }
    }
    
    return null;
  }
  
  /**
   * Get the strategy prefix (for family matching)
   * @param strategyId Strategy ID
   * @returns Strategy prefix
   */
  private getStrategyPrefix(strategyId: string): string | null {
    // Extract prefix like "trend_following" from "trend_following_v2"
    const match = strategyId.match(/^(.+?)(?:_v\d+|$)/);
    return match ? match[1] : null;
  }
  
  /**
   * Increment rotation count for a strategy
   * @param strategyId Strategy ID
   */
  private incrementRotationCount(strategyId: string): void {
    const count = this.rotationCounts.get(strategyId) || 0;
    this.rotationCounts.set(strategyId, count + 1);
  }
  
  /**
   * Update last rotation time for a strategy
   * @param strategyId Strategy ID
   * @param timestamp Optional timestamp (default: now)
   */
  private updateLastRotationTime(strategyId: string, timestamp = Date.now()): void {
    this.lastRotationTimes.set(strategyId, timestamp);
  }
  
  /**
   * Update configuration
   * @param newConfig New configuration settings
   */
  public updateConfig(newConfig: Partial<LifecycleManagerConfig>): void {
    this.config = { 
      ...this.config, 
      ...newConfig,
      strategyFamilies: {
        ...this.config.strategyFamilies,
        ...(newConfig.strategyFamilies || {})
      }
    };
    
    logger.info(`Lifecycle manager config updated: ${JSON.stringify(newConfig)}`);
  }
  
  /**
   * Register a strategy family
   * @param familyName Family name
   * @param strategies Array of sibling strategies
   */
  public registerStrategyFamily(familyName: string, strategies: string[]): void {
    this.config.strategyFamilies[familyName] = strategies;
    logger.info(`Registered strategy family ${familyName} with ${strategies.length} strategies`);
  }
} 