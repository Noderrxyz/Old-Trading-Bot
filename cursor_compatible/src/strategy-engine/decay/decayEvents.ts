/**
 * Decay Events Module
 * 
 * Defines events and event management for strategy decay detection system.
 * These events trigger appropriate responses, like strategy rotation and retraining.
 */

import { EventEmitter } from 'events';
import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { DecayFlag } from './decayScorer.js';

const logger = createLogger('DecayEvents');

/**
 * Event types related to strategy decay
 */
export enum DecayEventType {
  // Strategy decay score increased
  DECAY_SCORE_INCREASED = 'decay_score_increased',
  
  // Strategy decay score crossed threshold
  DECAY_THRESHOLD_CROSSED = 'decay_threshold_crossed',
  
  // Strategy was auto-disabled due to high decay
  STRATEGY_DISABLED = 'strategy_disabled',
  
  // Strategy was rotated to a new version
  STRATEGY_ROTATED = 'strategy_rotated',
  
  // Strategy weights were adjusted
  WEIGHTS_ADJUSTED = 'weights_adjusted',
  
  // Strategy retraining was triggered
  RETRAINING_TRIGGERED = 'retraining_triggered',
  
  // Input feature balance was adjusted
  FEATURE_BALANCE_ADJUSTED = 'feature_balance_adjusted',
  
  // Generic decay alert (for manual review)
  DECAY_ALERT = 'decay_alert'
}

/**
 * Base decay event interface
 */
export interface DecayEventBase {
  type: DecayEventType;
  strategyId: string;
  timestamp: number;
  decayScore: number;
  decayFlags: DecayFlag[];
}

/**
 * Event for decay score increase
 */
export interface DecayScoreIncreasedEvent extends DecayEventBase {
  type: DecayEventType.DECAY_SCORE_INCREASED;
  previousScore: number;
  increaseFactor: number;
}

/**
 * Event for decay threshold being crossed
 */
export interface DecayThresholdCrossedEvent extends DecayEventBase {
  type: DecayEventType.DECAY_THRESHOLD_CROSSED;
  threshold: 'low' | 'moderate' | 'high';
  thresholdValue: number;
}

/**
 * Event for strategy being disabled
 */
export interface StrategyDisabledEvent extends DecayEventBase {
  type: DecayEventType.STRATEGY_DISABLED;
  disabledBy: 'auto' | 'manual';
  reason: string;
}

/**
 * Event for strategy being rotated
 */
export interface StrategyRotatedEvent extends DecayEventBase {
  type: DecayEventType.STRATEGY_ROTATED;
  oldStrategyId: string;
  newStrategyId: string;
  rotationReason: string;
}

/**
 * Event for weights being adjusted
 */
export interface WeightsAdjustedEvent extends DecayEventBase {
  type: DecayEventType.WEIGHTS_ADJUSTED;
  oldWeights: Record<string, number>;
  newWeights: Record<string, number>;
  adjustmentReason: string;
}

/**
 * Event for retraining being triggered
 */
export interface RetrainingTriggeredEvent extends DecayEventBase {
  type: DecayEventType.RETRAINING_TRIGGERED;
  trainingConfig: Record<string, any>;
  targetTrainingData: string;
  retrainingReason: string;
}

/**
 * Event for feature balance being adjusted
 */
export interface FeatureBalanceAdjustedEvent extends DecayEventBase {
  type: DecayEventType.FEATURE_BALANCE_ADJUSTED;
  oldBalance: Record<string, number>;
  newBalance: Record<string, number>;
  adjustmentReason: string;
}

/**
 * Event for generic decay alert
 */
export interface DecayAlertEvent extends DecayEventBase {
  type: DecayEventType.DECAY_ALERT;
  alertLevel: 'info' | 'warning' | 'critical';
  message: string;
  suggestedAction?: string;
}

/**
 * Union type of all decay events
 */
export type DecayEvent =
  | DecayScoreIncreasedEvent
  | DecayThresholdCrossedEvent
  | StrategyDisabledEvent
  | StrategyRotatedEvent
  | WeightsAdjustedEvent
  | RetrainingTriggeredEvent
  | FeatureBalanceAdjustedEvent
  | DecayAlertEvent;

/**
 * Configuration for the decay events manager
 */
export interface DecayEventsConfig {
  // Whether to publish events to Redis
  publishToRedis: boolean;
  
  // Whether to emit WebSocket events
  publishToWebSocket: boolean;
  
  // Redis stream key prefix
  redisStreamPrefix: string;
  
  // WebSocket event prefix
  wsEventPrefix: string;
  
  // Maximum number of events to keep in Redis stream
  maxStreamEvents: number;
  
  // Threshold increase factor to trigger DECAY_SCORE_INCREASED event
  scoreIncreaseFactor: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DecayEventsConfig = {
  publishToRedis: true,
  publishToWebSocket: true,
  redisStreamPrefix: 'strategy_decay_feed:',
  wsEventPrefix: 'strategy:',
  maxStreamEvents: 1000,
  scoreIncreaseFactor: 1.2 // 20% increase
};

/**
 * Manages decay events and their delivery to other system components
 */
export class DecayEventManager {
  private redis: RedisClient;
  private emitter: EventEmitter;
  private config: DecayEventsConfig;
  private lastScores: Map<string, number> = new Map();
  
  /**
   * Create a new decay event manager
   */
  constructor(
    redis: RedisClient, 
    emitter: EventEmitter,
    config: Partial<DecayEventsConfig> = {}
  ) {
    this.redis = redis;
    this.emitter = emitter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Emit a decay event
   * @param event The decay event to emit
   */
  public async emit(event: DecayEvent): Promise<void> {
    try {
      // Process and emit appropriate events
      await this.processEvent(event);
      
      // Log the event
      logger.info(`Emitted decay event: ${event.type} for strategy ${event.strategyId}`);
    } catch (error) {
      logger.error(`Failed to emit decay event: ${error}`);
      throw error;
    }
  }
  
  /**
   * Process a decay event
   * @param event The decay event to process
   */
  private async processEvent(event: DecayEvent): Promise<void> {
    // Local event emission
    this.emitter.emit(event.type, event);
    
    // Publish to Redis if enabled
    if (this.config.publishToRedis) {
      const streamKey = `${this.config.redisStreamPrefix}${event.strategyId}`;
      
      await this.redis.xadd(
        streamKey,
        '*',  // Auto-generate ID
        {
          type: event.type,
          data: JSON.stringify(event),
          timestamp: event.timestamp.toString()
        }
      );
      
      // Trim stream if needed
      const streamLength = await this.redis.xlen(streamKey);
      if (streamLength > this.config.maxStreamEvents) {
        // Keep the most recent events
        const toDelete = streamLength - this.config.maxStreamEvents;
        const streamEntries = await this.redis.xrange(streamKey, '-', '+', 'COUNT', toDelete);
        if (streamEntries && streamEntries.length > 0) {
          const oldestId = streamEntries[streamEntries.length - 1].id;
          await this.redis.xtrim(streamKey, 'MINID', oldestId);
        }
      }
    }
    
    // Publish to WebSocket if enabled
    if (this.config.publishToWebSocket) {
      // This would typically integrate with your WS broadcasting system
      // For now, we'll just log it
      logger.debug(`[WS] ${this.config.wsEventPrefix}${event.type} for ${event.strategyId}`);
    }
  }
  
  /**
   * Emit a DECAY_SCORE_INCREASED event if appropriate
   * @param strategyId Strategy ID
   * @param currentScore Current decay score
   * @param flags Decay flags
   */
  public async checkAndEmitScoreIncreased(
    strategyId: string,
    currentScore: number,
    flags: DecayFlag[]
  ): Promise<boolean> {
    const lastScore = this.lastScores.get(strategyId) || 0;
    
    // Only emit if score increased significantly
    if (currentScore > lastScore * this.config.scoreIncreaseFactor) {
      const event: DecayScoreIncreasedEvent = {
        type: DecayEventType.DECAY_SCORE_INCREASED,
        strategyId,
        timestamp: Date.now(),
        decayScore: currentScore,
        decayFlags: flags,
        previousScore: lastScore,
        increaseFactor: lastScore > 0 ? currentScore / lastScore : 1
      };
      
      await this.emit(event);
      this.lastScores.set(strategyId, currentScore);
      return true;
    }
    
    // Always update last score, even if we didn't emit
    this.lastScores.set(strategyId, currentScore);
    return false;
  }
  
  /**
   * Emit a DECAY_THRESHOLD_CROSSED event
   * @param strategyId Strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param threshold Which threshold was crossed
   * @param thresholdValue Numerical threshold value
   */
  public async emitThresholdCrossed(
    strategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    threshold: 'low' | 'moderate' | 'high',
    thresholdValue: number
  ): Promise<void> {
    const event: DecayThresholdCrossedEvent = {
      type: DecayEventType.DECAY_THRESHOLD_CROSSED,
      strategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      threshold,
      thresholdValue
    };
    
    await this.emit(event);
  }
  
  /**
   * Emit a STRATEGY_DISABLED event
   * @param strategyId Strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param disabledBy Who disabled the strategy
   * @param reason Reason for disabling
   */
  public async emitStrategyDisabled(
    strategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    disabledBy: 'auto' | 'manual',
    reason: string
  ): Promise<void> {
    const event: StrategyDisabledEvent = {
      type: DecayEventType.STRATEGY_DISABLED,
      strategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      disabledBy,
      reason
    };
    
    await this.emit(event);
  }
  
  /**
   * Emit a STRATEGY_ROTATED event
   * @param oldStrategyId Old strategy ID
   * @param newStrategyId New strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param reason Reason for rotation
   */
  public async emitStrategyRotated(
    oldStrategyId: string,
    newStrategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    reason: string
  ): Promise<void> {
    const event: StrategyRotatedEvent = {
      type: DecayEventType.STRATEGY_ROTATED,
      strategyId: oldStrategyId, // Using old ID for consistency
      oldStrategyId,
      newStrategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      rotationReason: reason
    };
    
    await this.emit(event);
  }
  
  /**
   * Emit a WEIGHTS_ADJUSTED event
   * @param strategyId Strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param oldWeights Previous weights
   * @param newWeights New weights
   * @param reason Reason for adjustment
   */
  public async emitWeightsAdjusted(
    strategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    oldWeights: Record<string, number>,
    newWeights: Record<string, number>,
    reason: string
  ): Promise<void> {
    const event: WeightsAdjustedEvent = {
      type: DecayEventType.WEIGHTS_ADJUSTED,
      strategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      oldWeights,
      newWeights,
      adjustmentReason: reason
    };
    
    await this.emit(event);
  }
  
  /**
   * Emit a RETRAINING_TRIGGERED event
   * @param strategyId Strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param config Training configuration
   * @param targetData Target training data
   * @param reason Reason for retraining
   */
  public async emitRetrainingTriggered(
    strategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    config: Record<string, any>,
    targetData: string,
    reason: string
  ): Promise<void> {
    const event: RetrainingTriggeredEvent = {
      type: DecayEventType.RETRAINING_TRIGGERED,
      strategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      trainingConfig: config,
      targetTrainingData: targetData,
      retrainingReason: reason
    };
    
    await this.emit(event);
  }
  
  /**
   * Emit a FEATURE_BALANCE_ADJUSTED event
   * @param strategyId Strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param oldBalance Previous feature balance
   * @param newBalance New feature balance
   * @param reason Reason for adjustment
   */
  public async emitFeatureBalanceAdjusted(
    strategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    oldBalance: Record<string, number>,
    newBalance: Record<string, number>,
    reason: string
  ): Promise<void> {
    const event: FeatureBalanceAdjustedEvent = {
      type: DecayEventType.FEATURE_BALANCE_ADJUSTED,
      strategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      oldBalance,
      newBalance,
      adjustmentReason: reason
    };
    
    await this.emit(event);
  }
  
  /**
   * Emit a DECAY_ALERT event
   * @param strategyId Strategy ID
   * @param decayScore Current decay score
   * @param flags Decay flags
   * @param level Alert level
   * @param message Alert message
   * @param suggestedAction Suggested action
   */
  public async emitDecayAlert(
    strategyId: string,
    decayScore: number,
    flags: DecayFlag[],
    level: 'info' | 'warning' | 'critical',
    message: string,
    suggestedAction?: string
  ): Promise<void> {
    const event: DecayAlertEvent = {
      type: DecayEventType.DECAY_ALERT,
      strategyId,
      timestamp: Date.now(),
      decayScore,
      decayFlags: flags,
      alertLevel: level,
      message,
      suggestedAction
    };
    
    await this.emit(event);
  }
  
  /**
   * Update configuration
   * @param newConfig New configuration settings
   */
  public updateConfig(newConfig: Partial<DecayEventsConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`Decay events config updated: ${JSON.stringify(newConfig)}`);
  }
}

export class DecayEventEmitter extends EventEmitter {
  // ... existing code ...
}

export class DecayEventHandler {
  private emitter: typeof EventEmitter;
  // ... existing code ...
} 