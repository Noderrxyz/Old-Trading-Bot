import { createLogger } from '../common/logger.js';
import {
  StrategyPerformance,
  StrategyConfig,
  StrategyMutation,
  AdaptiveMutationConfig,
  DEFAULT_ADAPTIVE_MUTATION_CONFIG
} from './types/adaptive_mutation.types.js';

/**
 * Adaptively mutates alpha strategies based on performance
 */
export class AdaptiveAlphaMutator {
  private readonly logger = createLogger('AdaptiveAlphaMutator');
  
  // Registered strategies
  private readonly strategies: Map<string, StrategyConfig> = new Map();
  
  // Performance history
  private readonly performanceHistory: Map<string, StrategyPerformance[]> = new Map();
  
  // Mutation history
  private readonly mutationHistory: StrategyMutation[] = [];
  
  // Evaluation timer
  private evaluationTimer?: NodeJS.Timeout;
  
  constructor(
    private readonly config: AdaptiveMutationConfig = DEFAULT_ADAPTIVE_MUTATION_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Adaptive alpha mutation is disabled');
    } else {
      this.startEvaluation();
    }
  }
  
  /**
   * Start periodic evaluation
   */
  private startEvaluation(): void {
    if (!this.config.enabled) return;
    
    // Clear any existing timer
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
    }
    
    // Start new evaluation interval
    this.evaluationTimer = setInterval(() => {
      this.autoMutateIfUnderperforming();
    }, this.config.evaluationIntervalSec * 1000);
    
    this.logger.info(
      `Started adaptive mutation with ${this.config.evaluationIntervalSec}s evaluation interval`
    );
  }
  
  /**
   * Register a new alpha strategy
   * @param strategyName Strategy name
   * @param baseConfig Base configuration
   */
  public registerAlphaStrategy(strategyName: string, baseConfig: StrategyConfig): void {
    if (!this.config.enabled) return;
    
    try {
      this.strategies.set(strategyName, baseConfig);
      this.performanceHistory.set(strategyName, []);
      
      this.logger.info(
        `Registered strategy ${strategyName} with base configuration`
      );
    } catch (error) {
      this.logger.error(`Error registering strategy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Record strategy performance
   * @param performance Performance metrics
   */
  public recordPerformance(performance: StrategyPerformance): void {
    if (!this.config.enabled) return;
    
    try {
      const history = this.performanceHistory.get(performance.strategyName);
      if (!history) {
        this.logger.warn(`No history found for strategy: ${performance.strategyName}`);
        return;
      }
      
      // Add performance record
      history.push(performance);
      
      // Trim history to retention period
      const cutoffTime = performance.timestamp - this.config.performanceHistorySec * 1000;
      while (history.length > 0 && history[0].timestamp < cutoffTime) {
        history.shift();
      }
      
      this.logger.debug(
        `Recorded performance for ${performance.strategyName}: ` +
        `PnL=${performance.pnl}, Sharpe=${performance.sharpe}`
      );
    } catch (error) {
      this.logger.error(`Error recording performance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Mutate a strategy configuration
   * @param strategyName Strategy name
   * @returns Mutated configuration
   */
  public mutateStrategy(strategyName: string): StrategyConfig {
    if (!this.config.enabled) {
      throw new Error('Adaptive mutation is disabled');
    }
    
    try {
      const originalConfig = this.strategies.get(strategyName);
      if (!originalConfig) {
        throw new Error(`Strategy not found: ${strategyName}`);
      }
      
      // Create mutated configuration
      const mutatedConfig: StrategyConfig = { ...originalConfig };
      
      // Randomly select parameters to mutate
      const params = Object.keys(originalConfig);
      const numParamsToMutate = Math.max(
        1,
        Math.floor(params.length * (Math.random() * 0.1 + 0.05)) // 5-15% of parameters
      );
      
      const paramsToMutate = params
        .sort(() => Math.random() - 0.5)
        .slice(0, numParamsToMutate);
      
      // Apply mutations
      for (const param of paramsToMutate) {
        const originalValue = originalConfig[param];
        const variation = (Math.random() * 2 - 1) * this.config.mutationStrength;
        mutatedConfig[param] = originalValue * (1 + variation);
      }
      
      // Create mutation record
      const mutation: StrategyMutation = {
        originalStrategy: strategyName,
        mutatedStrategy: `${strategyName}_mutated_${Date.now()}`,
        originalConfig,
        mutatedConfig,
        timestamp: Date.now()
      };
      
      this.mutationHistory.push(mutation);
      
      this.logger.info(
        `Mutated strategy ${strategyName}: ` +
        `changed ${paramsToMutate.length} parameters`
      );
      
      return mutatedConfig;
    } catch (error) {
      this.logger.error(`Error mutating strategy: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Check and mutate underperforming strategies
   */
  private autoMutateIfUnderperforming(): void {
    if (!this.config.enabled) return;
    
    try {
      // Check mutation rate limit
      const hourAgo = Date.now() - 3600000;
      const recentMutations = this.mutationHistory.filter(
        m => m.timestamp > hourAgo
      ).length;
      
      if (recentMutations >= this.config.maxMutationsPerHour) {
        this.logger.warn('Mutation rate limit reached');
        return;
      }
      
      // Evaluate each strategy
      for (const [strategyName, history] of this.performanceHistory.entries()) {
        if (history.length < 2) continue;
        
        // Calculate performance metrics
        const recentPerformance = history.slice(-12); // Last hour
        const avgSharpe = recentPerformance.reduce((sum, p) => sum + p.sharpe, 0) / recentPerformance.length;
        const avgPnl = recentPerformance.reduce((sum, p) => sum + p.pnl, 0) / recentPerformance.length;
        
        // Check if strategy needs mutation
        if (
          avgSharpe < this.config.sharpeMutationThreshold ||
          avgPnl < this.config.pnlMutationThreshold
        ) {
          this.logger.warn(
            `Strategy ${strategyName} underperforming: ` +
            `Sharpe=${avgSharpe}, PnL=${avgPnl}`
          );
          
          // Mutate strategy
          const mutatedConfig = this.mutateStrategy(strategyName);
          
          // Auto-activate if configured
          if (this.config.autoActivateBestMutation) {
            this.strategies.set(strategyName, mutatedConfig);
            this.logger.info(`Auto-activated mutated configuration for ${strategyName}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error in auto-mutation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get strategy configuration
   * @param strategyName Strategy name
   * @returns Strategy configuration
   */
  public getStrategyConfig(strategyName: string): StrategyConfig | undefined {
    return this.strategies.get(strategyName);
  }
  
  /**
   * Get mutation history
   * @returns Mutation history
   */
  public getMutationHistory(): StrategyMutation[] {
    return [...this.mutationHistory];
  }
  
  /**
   * Clean up resources
   */
  public destroy(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
    }
    this.strategies.clear();
    this.performanceHistory.clear();
    this.mutationHistory.length = 0;
  }
} 