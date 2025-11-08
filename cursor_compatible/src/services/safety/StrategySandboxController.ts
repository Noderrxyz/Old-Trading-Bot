import { RedisService } from '../redis/RedisService';
import { EventEmitter } from '../../utils/EventEmitter';
import { StrategyAnomalyData } from './StrategyAnomalyDetector';
import { CONTAINMENT_MEASURES, SAFETY_LIMITS } from '../../config/strategy_safety.config';
import { TradingStrategy } from '../evolution/mutation/strategy-model';
import { logger } from '../../utils/logger';

/**
 * Interface for a strategy's sandbox state
 */
export interface StrategySandboxState {
  strategyId: string;
  agentId: string;
  containmentLevel: number; // 0=normal, 1-4=containment levels
  sandboxStart: number; // timestamp
  sandboxExpiry: number | null; // timestamp or null for indefinite
  anomalyScore: number;
  anomalyReasons: string[];
  appliedRestrictions: string[];
  monitoringData: {
    ordersSinceContainment: number;
    positionSizeLimitPct: number;
    orderFrequencyFactor: number;
    unwinding: boolean;
    unwoundPositions: string[];
  };
}

/**
 * Configuration for the StrategySandboxController
 */
export interface StrategySandboxControllerConfig {
  sandboxDuration: {
    level1: number; // milliseconds
    level2: number;
    level3: number;
    level4: number;
  };
  automaticReleaseThreshold: number; // anomaly score below this can be auto-released
  keyPrefix: string;
  ttlDays: number;
  emitEvents: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: StrategySandboxControllerConfig = {
  sandboxDuration: {
    level1: 6 * 60 * 60 * 1000, // 6 hours
    level2: 24 * 60 * 60 * 1000, // 24 hours
    level3: 72 * 60 * 60 * 1000, // 3 days
    level4: 0, // indefinite (requires manual intervention)
  },
  automaticReleaseThreshold: 0.4, // can auto-release if score falls below 0.4
  keyPrefix: 'strategy:sandbox:',
  ttlDays: 90,
  emitEvents: true,
};

/**
 * Manages the sandboxing and containment of potentially anomalous strategies
 */
export class StrategySandboxController {
  private redis: RedisService;
  private eventEmitter: EventEmitter;
  private config: StrategySandboxControllerConfig;

  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    config: Partial<StrategySandboxControllerConfig> = {}
  ) {
    this.redis = redis;
    this.eventEmitter = eventEmitter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Apply containment to a strategy based on anomaly detection
   */
  public async containStrategy(strategyId: string, agentId: string, anomalyData: StrategyAnomalyData): Promise<StrategySandboxState> {
    const containmentLevel = this.determineContainmentLevel(anomalyData.anomalyScore);
    
    const now = Date.now();
    let expiryTime: number | null = null;
    
    // Set expiry time based on containment level
    if (containmentLevel < 4) {
      const durationKey = `level${containmentLevel}` as keyof typeof this.config.sandboxDuration;
      expiryTime = now + this.config.sandboxDuration[durationKey];
    }
    
    // Get applied restrictions based on containment level
    const restrictionLevel = `level${containmentLevel}` as keyof typeof CONTAINMENT_MEASURES;
    const restrictions = CONTAINMENT_MEASURES[restrictionLevel].actions;
    
    // Create sandbox state
    const sandboxState: StrategySandboxState = {
      strategyId,
      agentId,
      containmentLevel,
      sandboxStart: now,
      sandboxExpiry: expiryTime,
      anomalyScore: anomalyData.anomalyScore,
      anomalyReasons: anomalyData.anomalyReasons,
      appliedRestrictions: restrictions,
      monitoringData: {
        ordersSinceContainment: 0,
        positionSizeLimitPct: this.calculatePositionSizeLimit(containmentLevel),
        orderFrequencyFactor: this.calculateOrderFrequencyFactor(containmentLevel),
        unwinding: containmentLevel >= 3,
        unwoundPositions: [],
      },
    };
    
    // Save to Redis
    await this.saveStrategySandboxState(strategyId, sandboxState);
    
    // Emit event
    if (this.config.emitEvents) {
      this.eventEmitter.emit('strategy:contained', {
        timestamp: now,
        strategyId,
        agentId,
        containmentLevel,
        anomalyScore: anomalyData.anomalyScore,
        reasons: anomalyData.anomalyReasons,
        expiryTime,
      });
    }
    
    logger.info(`Strategy ${strategyId} contained at level ${containmentLevel} due to anomaly score ${anomalyData.anomalyScore}`);
    return sandboxState;
  }
  
  /**
   * Release a strategy from containment
   */
  public async releaseStrategy(strategyId: string, userId: string | null = null): Promise<boolean> {
    const state = await this.getStrategySandboxState(strategyId);
    
    if (!state) {
      logger.warn(`Attempted to release strategy ${strategyId} that is not contained`);
      return false;
    }
    
    // Delete from Redis
    await this.redis.del(`${this.config.keyPrefix}${strategyId}`);
    
    // Emit event
    if (this.config.emitEvents) {
      this.eventEmitter.emit('strategy:released', {
        timestamp: Date.now(),
        strategyId,
        agentId: state.agentId,
        previousContainmentLevel: state.containmentLevel,
        releasedBy: userId || 'system',
        totalContainmentDuration: Date.now() - state.sandboxStart,
      });
    }
    
    logger.info(`Strategy ${strategyId} released from containment level ${state.containmentLevel}`);
    return true;
  }
  
  /**
   * Check if a strategy is currently sandboxed or contained
   */
  public async isStrategyContained(strategyId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.config.keyPrefix}${strategyId}`);
    return exists === 1;
  }
  
  /**
   * Get the current sandbox state for a strategy
   */
  public async getStrategySandboxState(strategyId: string): Promise<StrategySandboxState | null> {
    const json = await this.redis.get(`${this.config.keyPrefix}${strategyId}`);
    if (!json) return null;
    return JSON.parse(json) as StrategySandboxState;
  }
  
  /**
   * Get all currently contained strategies
   */
  public async getAllContainedStrategies(): Promise<StrategySandboxState[]> {
    const keys = await this.redis.keys(`${this.config.keyPrefix}*`);
    if (!keys.length) return [];
    
    const results = await Promise.all(keys.map(key => this.redis.get(key)));
    return results
      .filter(Boolean)
      .map(json => JSON.parse(json as string) as StrategySandboxState);
  }
  
  /**
   * Update monitoring data for a contained strategy
   */
  public async updateMonitoringData(
    strategyId: string, 
    updates: Partial<StrategySandboxState['monitoringData']>
  ): Promise<boolean> {
    const state = await this.getStrategySandboxState(strategyId);
    if (!state) return false;
    
    state.monitoringData = {
      ...state.monitoringData,
      ...updates,
    };
    
    await this.saveStrategySandboxState(strategyId, state);
    return true;
  }
  
  /**
   * Check if a strategy's order is allowed based on containment restrictions
   */
  public async canPlaceOrder(
    strategyId: string, 
    orderSize: number, 
    assetSymbol: string,
    currentPositions: Record<string, number>,
    nav: number
  ): Promise<{allowed: boolean; reason?: string}> {
    const state = await this.getStrategySandboxState(strategyId);
    
    // If not contained, orders are allowed
    if (!state) return { allowed: true };
    
    // Check if strategy is completely halted
    if (state.appliedRestrictions.includes('HALT_STRATEGY')) {
      return { 
        allowed: false, 
        reason: 'Strategy is currently halted due to safety concerns'
      };
    }
    
    // Check if new orders are prevented
    if (state.appliedRestrictions.includes('PREVENT_NEW_ORDERS')) {
      return { 
        allowed: false, 
        reason: 'New orders are not allowed while strategy is in containment'
      };
    }
    
    // Check position increase restriction
    if (state.appliedRestrictions.includes('PREVENT_POSITION_INCREASE')) {
      const currentPosition = currentPositions[assetSymbol] || 0;
      // If order would increase position, block it
      if ((currentPosition > 0 && orderSize > 0) || (currentPosition < 0 && orderSize < 0)) {
        return {
          allowed: false,
          reason: 'Increasing position size is not allowed while strategy is in containment'
        };
      }
    }
    
    // Check position size limits
    const maxPositionSize = nav * state.monitoringData.positionSizeLimitPct;
    if (Math.abs(orderSize) > maxPositionSize) {
      return {
        allowed: false,
        reason: `Order size exceeds the maximum allowed size (${state.monitoringData.positionSizeLimitPct * 100}% of NAV)`
      };
    }
    
    // If got here, order is allowed
    return { allowed: true };
  }
  
  /**
   * Check if a strategy is due for automatic release
   */
  public async checkAndAutoReleaseExpiredContainment(): Promise<string[]> {
    const contained = await this.getAllContainedStrategies();
    const now = Date.now();
    const released: string[] = [];
    
    for (const state of contained) {
      // Skip level 4 containment or indefinite containment
      if (state.containmentLevel === 4 || state.sandboxExpiry === null) {
        continue;
      }
      
      // Check if containment period has expired
      if (state.sandboxExpiry && state.sandboxExpiry < now) {
        await this.releaseStrategy(state.strategyId);
        released.push(state.strategyId);
      }
    }
    
    return released;
  }
  
  /**
   * Helper method to save strategy sandbox state to Redis
   */
  private async saveStrategySandboxState(strategyId: string, state: StrategySandboxState): Promise<void> {
    const key = `${this.config.keyPrefix}${strategyId}`;
    await this.redis.set(key, JSON.stringify(state));
    await this.redis.expire(key, this.config.ttlDays * 24 * 60 * 60);
  }
  
  /**
   * Determine containment level based on anomaly score
   */
  private determineContainmentLevel(anomalyScore: number): number {
    if (anomalyScore >= 0.9) return 4;
    if (anomalyScore >= 0.8) return 3;
    if (anomalyScore >= 0.7) return 2;
    return 1;
  }
  
  /**
   * Calculate position size limit based on containment level
   */
  private calculatePositionSizeLimit(level: number): number {
    const baseLimitPct = SAFETY_LIMITS.maxPositionSizePercentOfNAV;
    switch (level) {
      case 1: return baseLimitPct * 0.8;
      case 2: return baseLimitPct * 0.5;
      case 3: return baseLimitPct * 0.3;
      case 4: return baseLimitPct * 0.1;
      default: return baseLimitPct;
    }
  }
  
  /**
   * Calculate order frequency factor based on containment level
   */
  private calculateOrderFrequencyFactor(level: number): number {
    switch (level) {
      case 1: return 0.7;
      case 2: return 0.5;
      case 3: return 0.3;
      case 4: return 0.1;
      default: return 1.0;
    }
  }
} 