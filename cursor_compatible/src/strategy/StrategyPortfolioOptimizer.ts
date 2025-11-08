import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { RegimeClassifier, MarketRegimeType } from '../regime/RegimeClassifier';
import { RegimeCapitalAllocator } from '../capital/RegimeCapitalAllocator';
import { AlphaMemory } from '../memory/AlphaMemory';

/**
 * Optimization result
 */
export interface OptimizationResult {
  /**
   * Map of strategy IDs to weights (0-1)
   */
  weights: Map<string, number>;
  
  /**
   * Portfolio expected return
   */
  expectedReturn: number;
  
  /**
   * Portfolio volatility
   */
  volatility: number;
  
  /**
   * Portfolio Sharpe ratio
   */
  sharpeRatio: number;
  
  /**
   * Portfolio max drawdown
   */
  maxDrawdown: number;
  
  /**
   * Diversification score (0-1)
   */
  diversificationScore: number;
  
  /**
   * Regime alignment score (0-1)
   */
  regimeAlignmentScore: number;
  
  /**
   * Timestamp of optimization
   */
  timestamp: number;
}

/**
 * Configuration for strategy portfolio optimizer
 */
export interface StrategyPortfolioOptimizerConfig {
  /**
   * Optimization interval in milliseconds
   */
  optimizationIntervalMs: number;
  
  /**
   * Historical data window length in days
   */
  dataWindowDays: number;
  
  /**
   * Maximum number of strategies in the portfolio
   */
  maxStrategiesInPortfolio: number;
  
  /**
   * Minimum number of strategies in the portfolio
   */
  minStrategiesInPortfolio: number;
  
  /**
   * Risk-free rate for Sharpe ratio calculation
   */
  riskFreeRate: number;
  
  /**
   * Target volatility for the portfolio (annualized)
   */
  targetVolatility: number;
  
  /**
   * Whether to reoptimize on regime change
   */
  reoptimizeOnRegimeChange: boolean;
  
  /**
   * Weight for return optimization (0-1)
   */
  returnWeight: number;
  
  /**
   * Weight for risk optimization (0-1)
   */
  riskWeight: number;
  
  /**
   * Weight for regime alignment (0-1)
   */
  regimeAlignmentWeight: number;
  
  /**
   * Weight for diversification (0-1)
   */
  diversificationWeight: number;
  
  /**
   * Emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: StrategyPortfolioOptimizerConfig = {
  optimizationIntervalMs: 24 * 60 * 60 * 1000, // Daily
  dataWindowDays: 30,
  maxStrategiesInPortfolio: 20,
  minStrategiesInPortfolio: 3,
  riskFreeRate: 0.02, // 2%
  targetVolatility: 0.15, // 15%
  reoptimizeOnRegimeChange: true,
  returnWeight: 0.4,
  riskWeight: 0.3,
  regimeAlignmentWeight: 0.2,
  diversificationWeight: 0.1,
  emitDetailedTelemetry: true
};

/**
 * Strategy stats
 */
interface StrategyStats {
  strategyId: string;
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  regimeAlignment: number;
  correlations: Map<string, number>;
}

/**
 * StrategyPortfolioOptimizer
 * 
 * Optimizes the portfolio of strategies to achieve optimal risk-adjusted returns.
 */
export class StrategyPortfolioOptimizer {
  private static instance: StrategyPortfolioOptimizer | null = null;
  private config: StrategyPortfolioOptimizerConfig;
  private telemetryBus: TelemetryBus;
  private regimeClassifier: RegimeClassifier;
  private capitalAllocator: RegimeCapitalAllocator;
  private alphaMemory: AlphaMemory;
  private optimizationTimer: NodeJS.Timeout | null = null;
  private lastResult: OptimizationResult | null = null;
  private strategyStats: Map<string, StrategyStats> = new Map();
  private currentRegime: MarketRegimeType = MarketRegimeType.UNKNOWN;
  
  /**
   * Private constructor
   */
  private constructor(config: Partial<StrategyPortfolioOptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.capitalAllocator = RegimeCapitalAllocator.getInstance();
    this.alphaMemory = AlphaMemory.getInstance();
    
    // Set current regime
    this.currentRegime = this.regimeClassifier.getCurrentRegime().regime;
    
    // Subscribe to regime changes
    this.regimeClassifier.onRegimeChange((newRegime) => {
      this.handleRegimeChange(newRegime);
    });
    
    // Start optimization timer
    this.startOptimizationTimer();
    
    logger.info(`StrategyPortfolioOptimizer initialized with regime: ${this.currentRegime}`);
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<StrategyPortfolioOptimizerConfig>): StrategyPortfolioOptimizer {
    if (!StrategyPortfolioOptimizer.instance) {
      StrategyPortfolioOptimizer.instance = new StrategyPortfolioOptimizer(config);
    } else if (config) {
      StrategyPortfolioOptimizer.instance.updateConfig(config);
    }
    return StrategyPortfolioOptimizer.instance;
  }
  
  /**
   * Get the last optimization result
   */
  public getLastResult(): OptimizationResult | null {
    return this.lastResult;
  }
  
  /**
   * Get the stats for a specific strategy
   */
  public getStrategyStats(strategyId: string): StrategyStats | null {
    return this.strategyStats.get(strategyId) || null;
  }
  
  /**
   * Register a strategy with the optimizer
   */
  public registerStrategy(genome: StrategyGenome): void {
    if (this.strategyStats.has(genome.id)) {
      logger.debug(`Strategy ${genome.id} already registered with optimizer`);
      return;
    }
    
    // Initialize with default stats
    const stats: StrategyStats = {
      strategyId: genome.id,
      expectedReturn: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      regimeAlignment: 0.5,
      correlations: new Map()
    };
    
    this.strategyStats.set(genome.id, stats);
    
    // Emit telemetry
    this.telemetryBus.emit('strategy_registered_for_optimization', {
      strategyId: genome.id,
      timestamp: Date.now()
    });
    
    logger.info(`Registered strategy ${genome.id} with portfolio optimizer`);
    
    // Update the strategy stats
    this.updateStrategyStats(genome.id).catch(error => {
      logger.error(`Failed to update stats for strategy ${genome.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  
  /**
   * Unregister a strategy
   */
  public unregisterStrategy(strategyId: string): void {
    if (!this.strategyStats.has(strategyId)) {
      logger.debug(`Strategy ${strategyId} not registered with optimizer`);
      return;
    }
    
    // Remove from map
    this.strategyStats.delete(strategyId);
    
    // Emit telemetry
    this.telemetryBus.emit('strategy_unregistered_from_optimization', {
      strategyId,
      timestamp: Date.now()
    });
    
    logger.info(`Unregistered strategy ${strategyId} from portfolio optimizer`);
    
    // Re-optimize if we have a result and this strategy was part of it
    if (this.lastResult && this.lastResult.weights.has(strategyId)) {
      this.optimize().catch(error => {
        logger.error(`Failed to re-optimize after unregistering strategy: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
  
  /**
   * Force optimization now
   */
  public async forceOptimize(): Promise<OptimizationResult> {
    logger.info('Forcing portfolio optimization');
    return this.optimize();
  }
  
  /**
   * Apply optimized weights to capital allocator
   */
  public applyToCapitalAllocator(): void {
    if (!this.lastResult) {
      logger.warn('Cannot apply weights to capital allocator: No optimization result available');
      return;
    }
    
    logger.info('Applying optimized weights to capital allocator');
    
    for (const [strategyId, weight] of this.lastResult.weights.entries()) {
      // Convert weight to capital allocation
      // The capital allocator handles fractional allocations internally
      this.capitalAllocator.registerStrategy(
        { id: strategyId } as StrategyGenome, // Simplified for this example
        weight
      );
    }
    
    // Force reallocation in the capital allocator
    this.capitalAllocator.forceReallocation();
    
    this.telemetryBus.emit('portfolio_weights_applied', {
      portfolioSize: this.lastResult.weights.size,
      expectedReturn: this.lastResult.expectedReturn,
      sharpeRatio: this.lastResult.sharpeRatio,
      timestamp: Date.now()
    });
  }
  
  /**
   * Main optimization function
   */
  private async optimize(): Promise<OptimizationResult> {
    const startTime = Date.now();
    logger.info(`Starting portfolio optimization for ${this.strategyStats.size} strategies`);
    
    try {
      // 1. Update all strategy stats
      await this.updateAllStrategyStats();
      
      // 2. If we don't have enough strategies, return a simplified result
      if (this.strategyStats.size < this.config.minStrategiesInPortfolio) {
        logger.warn(`Not enough strategies for optimization: ${this.strategyStats.size} < ${this.config.minStrategiesInPortfolio}`);
        
        return this.createSimplifiedOptimizationResult();
      }
      
      // 3. Select the best strategies for the regime
      const selectedStrategies = this.selectStrategiesForPortfolio();
      
      // 4. Calculate optimal weights using mean-variance optimization
      const weights = this.calculateOptimalWeights(selectedStrategies);
      
      // 5. Calculate portfolio metrics
      const portfolioMetrics = this.calculatePortfolioMetrics(weights);
      
      // 6. Create result
      const result: OptimizationResult = {
        weights,
        expectedReturn: portfolioMetrics.expectedReturn,
        volatility: portfolioMetrics.volatility,
        sharpeRatio: portfolioMetrics.sharpeRatio,
        maxDrawdown: portfolioMetrics.maxDrawdown,
        diversificationScore: portfolioMetrics.diversificationScore,
        regimeAlignmentScore: portfolioMetrics.regimeAlignmentScore,
        timestamp: Date.now()
      };
      
      // 7. Save result
      this.lastResult = result;
      
      // 8. Emit telemetry
      this.telemetryBus.emit('portfolio_optimization_completed', {
        strategiesCount: this.strategyStats.size,
        selectedCount: selectedStrategies.length,
        expectedReturn: result.expectedReturn,
        volatility: result.volatility,
        sharpeRatio: result.sharpeRatio,
        diversificationScore: result.diversificationScore,
        regimeAlignmentScore: result.regimeAlignmentScore,
        processingTimeMs: Date.now() - startTime,
        timestamp: Date.now()
      });
      
      logger.info(`Portfolio optimization completed in ${Date.now() - startTime}ms: ${selectedStrategies.length} strategies selected, Sharpe ratio: ${result.sharpeRatio.toFixed(3)}`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error during portfolio optimization: ${errorMsg}`, error);
      
      this.telemetryBus.emit('portfolio_optimization_error', {
        error: errorMsg,
        timestamp: Date.now()
      });
      
      // Return last result if available, otherwise a default
      return this.lastResult || this.createSimplifiedOptimizationResult();
    }
  }
  
  /**
   * Update stats for all strategies
   */
  private async updateAllStrategyStats(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const strategyId of this.strategyStats.keys()) {
      promises.push(this.updateStrategyStats(strategyId));
    }
    
    await Promise.all(promises);
    
    // After updating individual stats, calculate correlations
    this.calculateCorrelations();
  }
  
  /**
   * Update stats for a single strategy
   */
  private async updateStrategyStats(strategyId: string): Promise<void> {
    try {
      const stats = this.strategyStats.get(strategyId);
      if (!stats) return;
      
      // Fetch historical performance from AlphaMemory
      const historyData = await this.alphaMemory.getStrategyPerformanceHistory(
        strategyId, 
        Date.now() - (this.config.dataWindowDays * 24 * 60 * 60 * 1000),
        Date.now()
      );
      
      if (!historyData || historyData.length === 0) {
        logger.debug(`No historical data available for strategy ${strategyId}`);
        return;
      }
      
      // Calculate metrics
      const returns = historyData.map(d => d.returnPct);
      
      // Expected return (annualized)
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      stats.expectedReturn = avgReturn * 252; // Annualize assuming daily returns
      
      // Volatility (annualized)
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      stats.volatility = Math.sqrt(variance * 252); // Annualize
      
      // Sharpe ratio
      stats.sharpeRatio = stats.volatility > 0 ? 
        (stats.expectedReturn - this.config.riskFreeRate) / stats.volatility : 0;
      
      // Max drawdown
      let peak = -Infinity;
      let maxDrawdown = 0;
      let cumulativeReturn = 1;
      
      for (const ret of returns) {
        cumulativeReturn *= (1 + ret);
        if (cumulativeReturn > peak) {
          peak = cumulativeReturn;
        }
        const drawdown = (peak - cumulativeReturn) / peak;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
      
      stats.maxDrawdown = maxDrawdown;
      
      // Regime alignment
      stats.regimeAlignment = this.capitalAllocator.getRegimeAlignmentScore(strategyId);
      
      // Update the strategy stats
      this.strategyStats.set(strategyId, stats);
      
      if (this.config.emitDetailedTelemetry) {
        this.telemetryBus.emit('strategy_stats_updated', {
          strategyId,
          expectedReturn: stats.expectedReturn,
          volatility: stats.volatility,
          sharpeRatio: stats.sharpeRatio,
          maxDrawdown: stats.maxDrawdown,
          regimeAlignment: stats.regimeAlignment,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      logger.error(`Error updating stats for strategy ${strategyId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Calculate correlations between strategies
   */
  private calculateCorrelations(): void {
    const strategyIds = Array.from(this.strategyStats.keys());
    
    // Reset all correlations
    for (const stats of this.strategyStats.values()) {
      stats.correlations = new Map<string, number>();
    }
    
    // For each pair of strategies
    for (let i = 0; i < strategyIds.length; i++) {
      const idA = strategyIds[i];
      const statsA = this.strategyStats.get(idA)!;
      
      // Self correlation is 1
      statsA.correlations.set(idA, 1);
      
      for (let j = i + 1; j < strategyIds.length; j++) {
        const idB = strategyIds[j];
        const statsB = this.strategyStats.get(idB)!;
        
        // Calculate correlation
        // In a real implementation, this would use actual return series
        // For simplicity, we'll use a generated correlation
        const correlation = Math.random() * 0.8 - 0.4; // Random between -0.4 and 0.4
        
        // Store bidirectionally
        statsA.correlations.set(idB, correlation);
        statsB.correlations.set(idA, correlation);
      }
    }
  }
  
  /**
   * Select strategies for portfolio
   */
  private selectStrategiesForPortfolio(): string[] {
    const strategyIds = Array.from(this.strategyStats.keys());
    
    // Calculate a composite score for each strategy
    const scores: { strategyId: string, score: number }[] = strategyIds.map(id => {
      const stats = this.strategyStats.get(id)!;
      
      // Normalize metrics
      const normalizedSharpe = Math.max(0, Math.min(stats.sharpeRatio / 3, 1));
      const normalizedDrawdown = 1 - Math.min(stats.maxDrawdown, 1);
      
      // Composite score (higher is better)
      const score = 
        normalizedSharpe * 0.5 +
        normalizedDrawdown * 0.2 +
        stats.regimeAlignment * 0.3;
      
      return { strategyId: id, score };
    });
    
    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    // Select top N strategies
    const selectedIds = scores
      .slice(0, this.config.maxStrategiesInPortfolio)
      .map(item => item.strategyId);
    
    logger.debug(`Selected ${selectedIds.length} strategies for portfolio optimization`);
    return selectedIds;
  }
  
  /**
   * Calculate optimal weights
   */
  private calculateOptimalWeights(strategyIds: string[]): Map<string, number> {
    const weights = new Map<string, number>();
    
    // In a real implementation, this would be a proper mean-variance optimization
    // For simplicity, we'll use a simpler heuristic based on strategy metrics
    
    // If no strategies, return empty map
    if (strategyIds.length === 0) {
      return weights;
    }
    
    // Initialize total score
    let totalScore = 0;
    const scores: { id: string, score: number }[] = [];
    
    // Calculate score for each strategy
    for (const id of strategyIds) {
      const stats = this.strategyStats.get(id)!;
      
      // Higher Sharpe is better
      const sharpeComponent = Math.max(0, stats.sharpeRatio) * this.config.returnWeight;
      
      // Lower volatility is better (if below target)
      const volatilityComponent = Math.max(0, 1 - (stats.volatility / this.config.targetVolatility)) * this.config.riskWeight;
      
      // Higher regime alignment is better
      const regimeComponent = stats.regimeAlignment * this.config.regimeAlignmentWeight;
      
      // Calculate diversification component
      let avgCorrelation = 0;
      let correlationCount = 0;
      
      for (const otherId of strategyIds) {
        if (id !== otherId) {
          const correlation = stats.correlations.get(otherId) || 0;
          avgCorrelation += Math.abs(correlation);
          correlationCount++;
        }
      }
      
      if (correlationCount > 0) {
        avgCorrelation /= correlationCount;
      }
      
      // Lower correlation is better for diversification
      const diversificationComponent = (1 - avgCorrelation) * this.config.diversificationWeight;
      
      // Total score
      const score = sharpeComponent + volatilityComponent + regimeComponent + diversificationComponent;
      
      scores.push({ id, score });
      totalScore += score;
    }
    
    // Normalize scores to weights
    if (totalScore > 0) {
      for (const { id, score } of scores) {
        weights.set(id, score / totalScore);
      }
    } else {
      // Equal weight fallback
      for (const id of strategyIds) {
        weights.set(id, 1 / strategyIds.length);
      }
    }
    
    return weights;
  }
  
  /**
   * Calculate portfolio metrics
   */
  private calculatePortfolioMetrics(weights: Map<string, number>): {
    expectedReturn: number;
    volatility: number;
    sharpeRatio: number;
    maxDrawdown: number;
    diversificationScore: number;
    regimeAlignmentScore: number;
  } {
    // If no weights, return zeros
    if (weights.size === 0) {
      return {
        expectedReturn: 0,
        volatility: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        diversificationScore: 0,
        regimeAlignmentScore: 0
      };
    }
    
    // Calculate portfolio expected return
    let expectedReturn = 0;
    let regimeAlignmentScore = 0;
    let maxDrawdown = 0;
    
    for (const [id, weight] of weights.entries()) {
      const stats = this.strategyStats.get(id);
      if (stats) {
        expectedReturn += stats.expectedReturn * weight;
        regimeAlignmentScore += stats.regimeAlignment * weight;
        maxDrawdown = Math.max(maxDrawdown, stats.maxDrawdown * weight);
      }
    }
    
    // Calculate portfolio volatility (including correlations)
    // σp² = ∑∑ wi wj σi σj ρij
    let portfolioVariance = 0;
    const strategyIds = Array.from(weights.keys());
    
    for (let i = 0; i < strategyIds.length; i++) {
      const idA = strategyIds[i];
      const weightA = weights.get(idA) || 0;
      const statsA = this.strategyStats.get(idA);
      
      if (!statsA) continue;
      
      for (let j = 0; j < strategyIds.length; j++) {
        const idB = strategyIds[j];
        const weightB = weights.get(idB) || 0;
        const statsB = this.strategyStats.get(idB);
        
        if (!statsB) continue;
        
        const correlation = i === j ? 1 : (statsA.correlations.get(idB) || 0);
        portfolioVariance += weightA * weightB * statsA.volatility * statsB.volatility * correlation;
      }
    }
    
    const volatility = Math.sqrt(Math.max(0, portfolioVariance));
    
    // Sharpe ratio
    const sharpeRatio = volatility > 0 ? 
      (expectedReturn - this.config.riskFreeRate) / volatility : 0;
    
    // Calculate diversification score
    let avgPairwiseCorrelation = 0;
    let correlationCount = 0;
    
    for (let i = 0; i < strategyIds.length; i++) {
      const idA = strategyIds[i];
      const statsA = this.strategyStats.get(idA);
      
      if (!statsA) continue;
      
      for (let j = i + 1; j < strategyIds.length; j++) {
        const idB = strategyIds[j];
        
        const correlation = Math.abs(statsA.correlations.get(idB) || 0);
        avgPairwiseCorrelation += correlation;
        correlationCount++;
      }
    }
    
    if (correlationCount > 0) {
      avgPairwiseCorrelation /= correlationCount;
    }
    
    const diversificationScore = 1 - avgPairwiseCorrelation;
    
    return {
      expectedReturn,
      volatility,
      sharpeRatio,
      maxDrawdown,
      diversificationScore,
      regimeAlignmentScore
    };
  }
  
  /**
   * Create a simplified optimization result
   */
  private createSimplifiedOptimizationResult(): OptimizationResult {
    const weights = new Map<string, number>();
    
    // Equal weight for all registered strategies
    if (this.strategyStats.size > 0) {
      const weight = 1 / this.strategyStats.size;
      
      for (const strategyId of this.strategyStats.keys()) {
        weights.set(strategyId, weight);
      }
    }
    
    return {
      weights,
      expectedReturn: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      diversificationScore: 0,
      regimeAlignmentScore: 0,
      timestamp: Date.now()
    };
  }
  
  /**
   * Start optimization timer
   */
  private startOptimizationTimer(): void {
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
    }
    
    this.optimizationTimer = setInterval(() => {
      this.optimize().catch(error => {
        logger.error(`Error during scheduled optimization: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.config.optimizationIntervalMs);
    
    logger.debug(`Portfolio optimization scheduled every ${this.config.optimizationIntervalMs / (60 * 60 * 1000)} hours`);
  }
  
  /**
   * Handle regime change
   */
  private handleRegimeChange(newRegime: MarketRegimeType): void {
    const previousRegime = this.currentRegime;
    this.currentRegime = newRegime;
    
    logger.info(`Market regime changed from ${previousRegime} to ${newRegime}`);
    
    // Emit telemetry
    this.telemetryBus.emit('portfolio_optimizer_regime_change', {
      previousRegime,
      newRegime,
      timestamp: Date.now()
    });
    
    // Reoptimize if configured to do so
    if (this.config.reoptimizeOnRegimeChange) {
      logger.info('Re-optimizing portfolio due to regime change');
      this.optimize().catch(error => {
        logger.error(`Error during regime change optimization: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
  
  /**
   * Update configuration
   */
  private updateConfig(config: Partial<StrategyPortfolioOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart the timer if interval changed
    this.startOptimizationTimer();
    
    logger.info('StrategyPortfolioOptimizer configuration updated');
  }
} 