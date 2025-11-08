/**
 * Strategy Registry
 * 
 * Manages the registration, retrieval, and lifecycle of trading strategies.
 */

import logger from '../utils/logger.js';
import { TradingStrategy } from '../strategy/trading_strategy.js';

/**
 * Strategy registry configuration
 */
export interface StrategyRegistryConfig {
  enabled: boolean;
  maxStrategies: number;
  cleanupIntervalMs: number;
}

/**
 * Default strategy registry configuration
 */
export const DEFAULT_STRATEGY_REGISTRY_CONFIG: StrategyRegistryConfig = {
  enabled: true,
  maxStrategies: 1000,
  cleanupIntervalMs: 3600000 // 1 hour
};

/**
 * Strategy Registry class
 */
export class StrategyRegistry {
  private static instance: StrategyRegistry | null = null;
  private config: StrategyRegistryConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[StrategyRegistry] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[StrategyRegistry] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[StrategyRegistry] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[StrategyRegistry] ${msg}`, ...args)
  };
  private strategies: Map<string, TradingStrategy>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): StrategyRegistry {
    if (!StrategyRegistry.instance) {
      StrategyRegistry.instance = new StrategyRegistry();
    }
    return StrategyRegistry.instance;
  }

  private constructor(config: Partial<StrategyRegistryConfig> = {}) {
    this.config = { ...DEFAULT_STRATEGY_REGISTRY_CONFIG, ...config };
    this.strategies = new Map();
  }

  /**
   * Start strategy registry
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Strategy registry is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Strategy registry is already running');
      return;
    }

    this.isRunning = true;
    this.cleanupInterval = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    this.logger.info('Strategy registry started');
  }

  /**
   * Stop strategy registry
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Strategy registry stopped');
  }

  /**
   * Register a new strategy
   */
  public registerStrategy(strategy: TradingStrategy): void {
    if (!this.config.enabled) return;

    // Check if we've reached the maximum number of strategies
    if (this.strategies.size >= this.config.maxStrategies) {
      this.logger.warn('Maximum number of strategies reached, removing oldest strategy');
      const oldestStrategy = this.getOldestStrategy();
      if (oldestStrategy) {
        this.unregisterStrategy(oldestStrategy.id);
      }
    }

    this.strategies.set(strategy.id, strategy);
    this.logger.info(`Registered strategy ${strategy.id}`);
  }

  /**
   * Unregister a strategy
   */
  public unregisterStrategy(strategyId: string): void {
    if (!this.config.enabled) return;

    this.strategies.delete(strategyId);
    this.logger.info(`Unregistered strategy ${strategyId}`);
  }

  /**
   * Get a strategy by ID
   */
  public getStrategy(strategyId: string): TradingStrategy | undefined {
    return this.strategies.get(strategyId);
  }

  /**
   * Get all strategies
   */
  public getAllStrategies(): Map<string, TradingStrategy> {
    return new Map(this.strategies);
  }

  /**
   * Get strategies by agent ID
   */
  public getStrategiesByAgent(agentId: string): TradingStrategy[] {
    return Array.from(this.strategies.values())
      .filter(strategy => strategy.agentId === agentId);
  }

  /**
   * Get active strategies
   */
  public getActiveStrategies(): TradingStrategy[] {
    return Array.from(this.strategies.values())
      .filter(strategy => !strategy.isQuarantined());
  }

  /**
   * Get quarantined strategies
   */
  public getQuarantinedStrategies(): TradingStrategy[] {
    return Array.from(this.strategies.values())
      .filter(strategy => strategy.isQuarantined());
  }

  /**
   * Get the oldest strategy
   */
  private getOldestStrategy(): TradingStrategy | undefined {
    let oldestStrategy: TradingStrategy | undefined;
    let oldestTimestamp = Infinity;

    for (const strategy of this.strategies.values()) {
      if (strategy.createdAt < oldestTimestamp) {
        oldestStrategy = strategy;
        oldestTimestamp = strategy.createdAt;
      }
    }

    return oldestStrategy;
  }

  /**
   * Clean up inactive strategies
   */
  private cleanup(): void {
    if (!this.config.enabled || !this.isRunning) return;

    const now = Date.now();
    const inactiveThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const [strategyId, strategy] of this.strategies.entries()) {
      if (now - strategy.lastActive > inactiveThreshold) {
        this.unregisterStrategy(strategyId);
        this.logger.info(`Removed inactive strategy ${strategyId}`);
      }
    }
  }

  /**
   * Reset strategy registry
   */
  public reset(): void {
    this.strategies.clear();
    this.logger.info('Strategy registry reset');
  }
} 