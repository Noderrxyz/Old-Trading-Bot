/**
 * Strategy Memory Vault
 * 
 * Maintains a historical archive of top performing strategies and their configurations
 * to prevent forgetting past profitable ideas and enable directed mutation.
 */

import logger from '../utils/logger.js';
import { TradingStrategy } from './types.js';
import { RedisService } from '../services/redis/RedisService.js';

/**
 * Configuration for strategy memory vault
 */
export interface StrategyMemoryVaultConfig {
  enabled: boolean;
  topNStrategiesSaved: number;
  memoryBiasStrength: number;
  redisKeyPrefix: string;
  maxHistoryDays: number;
}

/**
 * Default configuration for strategy memory vault
 */
export const DEFAULT_STRATEGY_MEMORY_VAULT_CONFIG: StrategyMemoryVaultConfig = {
  enabled: true,
  topNStrategiesSaved: 100,
  memoryBiasStrength: 0.3,
  redisKeyPrefix: 'strategy:memory:',
  maxHistoryDays: 365
};

/**
 * Strategy memory vault for maintaining historical archive
 */
export class StrategyMemoryVault {
  private readonly config: StrategyMemoryVaultConfig;
  private readonly redisService: RedisService;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[StrategyMemoryVault] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[StrategyMemoryVault] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[StrategyMemoryVault] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[StrategyMemoryVault] ${msg}`, ...args)
  };

  constructor(
    redisService: RedisService,
    config: Partial<StrategyMemoryVaultConfig> = {}
  ) {
    this.config = { ...DEFAULT_STRATEGY_MEMORY_VAULT_CONFIG, ...config };
    this.redisService = redisService;

    if (!this.config.enabled) {
      this.logger.warn('Strategy memory vault is disabled');
    }
  }

  /**
   * Get Redis key for a strategy
   */
  private getStrategyKey(strategyId: string): string {
    return `${this.config.redisKeyPrefix}${strategyId}`;
  }

  /**
   * Get Redis key for top strategies list
   */
  private getTopStrategiesKey(): string {
    return `${this.config.redisKeyPrefix}top`;
  }

  /**
   * Store a strategy in the vault
   */
  public async storeStrategy(strategy: TradingStrategy): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const key = this.getStrategyKey(strategy.id);
      await this.redisService.set(key, JSON.stringify(strategy));
      this.logger.debug(`Stored strategy ${strategy.id} in memory vault`);
    } catch (error) {
      this.logger.error(`Failed to store strategy ${strategy.id}`, error);
    }
  }

  /**
   * Update top strategies list
   */
  public async updateTopStrategies(strategies: TradingStrategy[]): Promise<void> {
    if (!this.config.enabled) return;

    try {
      // Sort strategies by score
      const sortedStrategies = [...strategies].sort((a, b) => 
        (b.fitness?.overallScore || 0) - (a.fitness?.overallScore || 0)
      );

      // Take top N strategies
      const topStrategies = sortedStrategies.slice(0, this.config.topNStrategiesSaved);

      // Store in Redis
      const key = this.getTopStrategiesKey();
      await this.redisService.set(key, JSON.stringify(topStrategies));
      
      this.logger.info(`Updated top ${topStrategies.length} strategies in memory vault`);
    } catch (error) {
      this.logger.error('Failed to update top strategies', error);
    }
  }

  /**
   * Get top strategies from the vault
   */
  public async getTopStrategies(): Promise<TradingStrategy[]> {
    if (!this.config.enabled) return [];

    try {
      const key = this.getTopStrategiesKey();
      const data = await this.redisService.get(key);
      
      if (!data) {
        this.logger.debug('No top strategies found in memory vault');
        return [];
      }

      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Failed to get top strategies', error);
      return [];
    }
  }

  /**
   * Get a strategy from the vault
   */
  public async getStrategy(strategyId: string): Promise<TradingStrategy | null> {
    if (!this.config.enabled) return null;

    try {
      const key = this.getStrategyKey(strategyId);
      const data = await this.redisService.get(key);
      
      if (!data) {
        this.logger.debug(`Strategy ${strategyId} not found in memory vault`);
        return null;
      }

      return JSON.parse(data);
    } catch (error) {
      this.logger.error(`Failed to get strategy ${strategyId}`, error);
      return null;
    }
  }

  /**
   * Get memory bias for mutation
   * @returns Array of strategies to bias mutation towards
   */
  public async getMemoryBias(): Promise<TradingStrategy[]> {
    if (!this.config.enabled || this.config.memoryBiasStrength <= 0) {
      return [];
    }

    try {
      const topStrategies = await this.getTopStrategies();
      
      // Apply memory bias strength
      const biasCount = Math.floor(topStrategies.length * this.config.memoryBiasStrength);
      return topStrategies.slice(0, biasCount);
    } catch (error) {
      this.logger.error('Failed to get memory bias', error);
      return [];
    }
  }

  /**
   * Clean up old strategies from the vault
   */
  public async cleanup(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const now = Date.now();
      const cutoffTime = now - (this.config.maxHistoryDays * 24 * 60 * 60 * 1000);
      
      const topStrategies = await this.getTopStrategies();
      const validStrategies = topStrategies.filter(strategy => 
        new Date(strategy.createdAt).getTime() > cutoffTime
      );

      if (validStrategies.length < topStrategies.length) {
        await this.updateTopStrategies(validStrategies);
        this.logger.info(`Cleaned up ${topStrategies.length - validStrategies.length} old strategies`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup memory vault', error);
    }
  }
} 