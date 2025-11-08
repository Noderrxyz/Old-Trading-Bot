import { StrategyGenome } from '../evolution/StrategyGenome';
import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { AlphaMemory } from '../memory/AlphaMemory';
import { RegimeClassifier, MarketRegime } from '../regime/RegimeClassifier';
import { BiasEngine } from '../evolution/BiasEngine';

/**
 * Configuration for strategy portfolio optimizer
 */
export interface StrategyPortfolioOptimizerConfig {
  /**
   * Minimum number of strategies to maintain in the portfolio
   */
  minStrategies: number;
  
  /**
   * Maximum number of strategies to maintain in the portfolio
   */
  maxStrategies: number;
  
  /**
   * Weight for historical performance
   */
  historicalPerformanceWeight: number;
  
  /**
   * Weight for regime alignment
   */
  regimeAlignmentWeight: number;
  
  /**
   * Weight for volatility of returns
   */
  volatilityWeight: number;
  
  /**
   * Weight for correlation among strategies
   */
  correlationWeight: number;
  
  /**
   * Weight for drawdown resilience
   */
  drawdownResilienceWeight: number;
  
  /**
   * Minimum correlation threshold to consider strategies as similar
   */
  similarityThreshold: number;
  
  /**
   * Optimization interval in ms
   */
  optimizationIntervalMs: number;
  
  /**
   * Lookback window for optimization calculations 
   */
  lookbackDays: number;
  
  /**
   * Emit detailed metrics for optimizer operations
   */
  emitDetailedTelemetry: boolean;
  
  /**
   * Target Sharpe ratio for the portfolio
   */
  targetSharpeRatio: number;
  
  /**
   * Min correlation threshold for diversification
   */
  diversificationThreshold: number;
  
  /**
   * Max acceptable portfolio volatility
   */
  maxPortfolioVolatility: number;
  
  /**
   * Max acceptable drawdown
   */
  maxDrawdown: number;
  
  /**
   * Risk-free rate for calculations
   */
  riskFreeRate: number;
  
  /**
   * Max strategies in optimized portfolio
   */
  maxStrategiesInPortfolio: number;
}

/**
 * Default configuration for strategy portfolio optimizer
 */
const DEFAULT_CONFIG: StrategyPortfolioOptimizerConfig = {
  minStrategies: 3,
  maxStrategies: 12,
  historicalPerformanceWeight: 0.3,
  regimeAlignmentWeight: 0.25,
  volatilityWeight: 0.15,
  correlationWeight: 0.15,
  drawdownResilienceWeight: 0.15,
  similarityThreshold: 0.7,
  optimizationIntervalMs: 86400000, // 24 hours
  lookbackDays: 30,
  emitDetailedTelemetry: true,
  targetSharpeRatio: 2.0,
  diversificationThreshold: 0.7,
  maxPortfolioVolatility: 0.15,
  maxDrawdown: 0.1,
  riskFreeRate: 0.02,
  maxStrategiesInPortfolio: 10
};

/**
 * Strategy weights in portfolio
 */
export interface StrategyWeight {
  strategyId: string;
  weight: number;
}

/**
 * Results of portfolio optimization
 */
export interface OptimizationResult {
  /**
   * Weights for each strategy in the portfolio
   */
  weights: StrategyWeight[];
  
  /**
   * Expected portfolio metrics
   */
  expectedMetrics: {
    /**
     * Expected return
     */
    expectedReturn: number;
    
    /**
     * Expected volatility
     */
    expectedVolatility: number;
    
    /**
     * Expected maximum drawdown
     */
    expectedMaxDrawdown: number;
    
    /**
     * Expected Sharpe ratio
     */
    expectedSharpeRatio: number;
  };
  
  /**
   * Timestamp of optimization
   */
  timestamp: number;
  
  /**
   * Current market regime
   */
  currentRegime: string;
}

/**
 * Strategy metrics for optimization
 */
export interface StrategyMetrics {
  strategyId: string;
  returns: number[];
  sharpeRatio: number;
  meanReturn: number;
  volatility: number;
  maxDrawdown: number;
  winRate: number;
  regimePerformance: {
    [regime in MarketRegime]?: {
      returns: number[];
      sharpeRatio: number;
      meanReturn: number;
      volatility: number;
    }
  };
}

/**
 * Strategy portfolio optimizer using modern portfolio theory
 * and machine learning enhancements for regime-aware optimization
 */
export class StrategyPortfolioOptimizer {
  private static instance: StrategyPortfolioOptimizer | null = null;
  private config: StrategyPortfolioOptimizerConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private lastOptimizationResult: OptimizationResult | null = null;
  private alphaMemory: AlphaMemory;
  private regimeClassifier: RegimeClassifier;
  private biasEngine: BiasEngine;
  private telemetryBus: TelemetryBus;
  private isRunning: boolean = false;
  private strategyMetrics: Map<string, StrategyMetrics> = new Map();
  private correlationMatrix: Map<string, Map<string, number>> = new Map();
  private currentRegime: MarketRegime | null = null;

  /**
   * Private constructor for singleton
   */
  private constructor(config: Partial<StrategyPortfolioOptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.alphaMemory = AlphaMemory.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.biasEngine = BiasEngine.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    
    logger.info('StrategyPortfolioOptimizer initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<StrategyPortfolioOptimizerConfig> = {}): StrategyPortfolioOptimizer {
    if (!StrategyPortfolioOptimizer.instance) {
      StrategyPortfolioOptimizer.instance = new StrategyPortfolioOptimizer(config);
    }
    
    return StrategyPortfolioOptimizer.instance;
  }
  
  /**
   * Start the optimizer
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('StrategyPortfolioOptimizer is already running');
      return;
    }
    
    this.isRunning = true;
    
    // Run initial optimization
    this.runOptimization();
    
    // Schedule regular optimizations
    this.intervalId = setInterval(() => this.runOptimization(), this.config.optimizationIntervalMs);
    
    logger.info(`StrategyPortfolioOptimizer started with interval ${this.config.optimizationIntervalMs}ms`);
  }
  
  /**
   * Stop the optimizer
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('StrategyPortfolioOptimizer is not running');
      return;
    }
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    logger.info('StrategyPortfolioOptimizer stopped');
  }
  
  /**
   * Get latest optimization result
   */
  public getLatestOptimizationResult(): OptimizationResult | null {
    return this.lastOptimizationResult;
  }
  
  /**
   * Run optimization cycle
   */
  public async runOptimization(): Promise<OptimizationResult> {
    const startTime = Date.now();
    
    try {
      // Emit start telemetry
      this.telemetryBus.emit('optimizer:optimization:started', {
        timestamp: startTime,
        configParams: this.config
      });
      
      // Get active strategies from memory
      const strategies = await this.getActiveStrategies();
      
      if (strategies.length === 0) {
        logger.warn('No active strategies found for optimization');
        
        this.telemetryBus.emit('optimizer:optimization:failed', {
          reason: 'no_active_strategies',
          timestamp: Date.now()
        });
        
        // Return empty result
        const emptyResult: OptimizationResult = {
          weights: [],
          expectedMetrics: {
            expectedReturn: 0,
            expectedVolatility: 0,
            expectedMaxDrawdown: 0,
            expectedSharpeRatio: 0
          },
          timestamp: Date.now(),
          currentRegime: this.regimeClassifier.getCurrentRegime("DEFAULT").primaryRegime
        };
        
        this.lastOptimizationResult = emptyResult;
        return emptyResult;
      }
      
      // Get historical returns and metrics for selected strategies
      const historicalData = await this.getHistoricalData(strategies);
      
      // Get current regime
      const currentRegime = this.regimeClassifier.getCurrentRegime("DEFAULT");
      
      // Generate correlation matrix
      const correlationMatrix = this.generateCorrelationMatrix(historicalData);
      
      // Calculate expected returns for each strategy
      const expectedReturns = this.calculateExpectedReturns(
        strategies, 
        historicalData, 
        currentRegime.primaryRegime
      );
      
      // Calculate risk metrics
      const riskMetrics = this.calculateRiskMetrics(strategies, historicalData);
      
      // Generate strategy weights
      const weights = this.optimizeWeights(
        strategies, 
        expectedReturns, 
        correlationMatrix, 
        riskMetrics,
        {
          type: currentRegime.primaryRegime,
          confidence: currentRegime.confidence
        }
      );
      
      // Calculate portfolio metrics
      const portfolioMetrics = this.calculatePortfolioMetrics(weights, expectedReturns, correlationMatrix, riskMetrics);
      
      // Emit success telemetry
      const optimizationResult: OptimizationResult = {
        weights: strategies.map((strategy, index) => ({
          strategyId: strategy.id,
          weight: weights[index]
        })),
        expectedMetrics: {
          expectedReturn: portfolioMetrics.expectedReturn,
          expectedVolatility: portfolioMetrics.expectedVolatility,
          expectedMaxDrawdown: portfolioMetrics.expectedMaxDrawdown,
          expectedSharpeRatio: portfolioMetrics.expectedSharpeRatio
        },
        timestamp: Date.now(),
        currentRegime: currentRegime.primaryRegime
      };
      
      // Emit telemetry
      const elapsedTimeMs = Date.now() - startTime;
      this.telemetryBus.emit('optimizer:optimization:completed', {
        timestamp: Date.now(),
        durationMs: elapsedTimeMs,
        strategiesCount: strategies.length,
        regime: currentRegime.primaryRegime,
        result: optimizationResult
      });
      
      // Log metrics
      this.telemetryBus.emit('optimizer.optimization_time_ms', elapsedTimeMs);
      this.telemetryBus.emit('optimizer.strategy_count', strategies.length);
      this.telemetryBus.emit('optimizer.expected_return', portfolioMetrics.expectedReturn);
      this.telemetryBus.emit('optimizer.expected_volatility', portfolioMetrics.expectedVolatility);
      this.telemetryBus.emit('optimizer.expected_sharpe', portfolioMetrics.expectedSharpeRatio);
      
      // Store result
      this.lastOptimizationResult = optimizationResult;
      
      return optimizationResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in portfolio optimization: ${errorMessage}`, error);
      
      // Emit error telemetry
      this.telemetryBus.emit('optimizer:optimization:error', {
        message: errorMessage,
        timestamp: Date.now(),
        elapsedTimeMs: Date.now() - startTime
      });
      
      // Return previous result if available
      if (this.lastOptimizationResult) {
        return this.lastOptimizationResult;
      }
      
      // Create empty result
      const failedResult: OptimizationResult = {
        weights: [],
        expectedMetrics: {
          expectedReturn: 0,
          expectedVolatility: 0,
          expectedMaxDrawdown: 0,
          expectedSharpeRatio: 0
        },
        timestamp: Date.now(),
        currentRegime: this.regimeClassifier.getCurrentRegime("DEFAULT").primaryRegime
      };
      
      this.lastOptimizationResult = failedResult;
      return failedResult;
    }
  }

  /**
   * Get active strategies from memory
   */
  private async getActiveStrategies(): Promise<StrategyGenome[]> {
    try {
      // Get strategies from alpha memory
      const records = await this.alphaMemory.getRecords({
        limit: 100,
        includeMuted: false,
        onlyActive: true,
        sortBy: 'performance',
        sortDirection: 'desc'
      });
      
      // Map to strategy genomes
      const strategies = records.map(record => record.genome);
      
      // Apply filters
      const filteredStrategies = strategies.filter(strategy => {
        // Ensure strategy is valid
        return strategy.isValid();
      });
      
      // Limit to max strategies
      const limitedStrategies = filteredStrategies.slice(0, this.config.maxStrategies);
      
      // Ensure minimum strategies
      if (limitedStrategies.length < this.config.minStrategies) {
        logger.warn(`Only ${limitedStrategies.length} strategies available for optimization, minimum is ${this.config.minStrategies}`);
      }
      
      return limitedStrategies;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error fetching active strategies: ${errorMessage}`, error);
      this.telemetryBus.emitError('optimizer:get_strategies:error', {
        message: errorMessage,
        timestamp: Date.now()
      });
      return [];
    }
  }
  
  /**
   * Get historical data for strategies
   */
  private async getHistoricalData(strategies: StrategyGenome[]): Promise<Record<string, any[]>> {
    const lookbackMs = this.config.lookbackDays * 86400000; // Convert days to ms
    const startTime = Date.now() - lookbackMs;
    
    // Historical returns for each strategy
    const historicalData: Record<string, any[]> = {};
    
    for (const strategy of strategies) {
      try {
        // Get historical performance from alpha memory
        const performance = await this.alphaMemory.getStrategyPerformance(
          strategy.id,
          startTime,
          Date.now()
        );
        
        if (performance && performance.length > 0) {
          historicalData[strategy.id] = performance;
        } else {
          logger.warn(`No historical data available for strategy ${strategy.id}`);
          // Use empty array for strategies without data
          historicalData[strategy.id] = [];
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error fetching historical data for strategy ${strategy.id}: ${errorMessage}`, error);
        // Use empty array for strategies with errors
        historicalData[strategy.id] = [];
      }
    }
    
    return historicalData;
  }
  
  /**
   * Generate correlation matrix for strategies based on returns
   */
  private generateCorrelationMatrix(historicalData: Record<string, any[]>): number[][] {
    const strategyIds = Object.keys(historicalData);
    const n = strategyIds.length;
    
    // Initialize matrix with zeros
    const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    
    // Extract returns for each strategy
    const returns: Record<string, number[]> = {};
    
    for (const strategyId of strategyIds) {
      const data = historicalData[strategyId];
      returns[strategyId] = data.map(item => item.return || 0);
    }
    
    // Calculate correlation coefficients
    for (let i = 0; i < n; i++) {
      const strategyA = strategyIds[i];
      const returnsA = returns[strategyA];
      
      // Diagonal elements (correlation with self) is 1
      matrix[i][i] = 1;
      
      for (let j = i + 1; j < n; j++) {
        const strategyB = strategyIds[j];
        const returnsB = returns[strategyB];
        
        // Calculate correlation coefficient
        const correlation = this.calculateCorrelation(returnsA, returnsB);
        
        // Store in matrix (correlation is symmetric)
        matrix[i][j] = correlation;
        matrix[j][i] = correlation;
      }
    }
    
    return matrix;
  }
  
  /**
   * Calculate correlation coefficient between two series
   */
  private calculateCorrelation(seriesA: number[], seriesB: number[]): number {
    // If either series is empty, return 0
    if (seriesA.length === 0 || seriesB.length === 0) {
      return 0;
    }
    
    // Use the smaller length
    const length = Math.min(seriesA.length, seriesB.length);
    
    // If less than 3 data points, correlation is not meaningful
    if (length < 3) {
      return 0;
    }
    
    // Calculate means
    const meanA = seriesA.slice(0, length).reduce((sum, val) => sum + val, 0) / length;
    const meanB = seriesB.slice(0, length).reduce((sum, val) => sum + val, 0) / length;
    
    // Calculate correlation coefficient
    let numerator = 0;
    let denominatorA = 0;
    let denominatorB = 0;
    
    for (let i = 0; i < length; i++) {
      const diffA = seriesA[i] - meanA;
      const diffB = seriesB[i] - meanB;
      
      numerator += diffA * diffB;
      denominatorA += diffA * diffA;
      denominatorB += diffB * diffB;
    }
    
    // Avoid division by zero
    if (denominatorA === 0 || denominatorB === 0) {
      return 0;
    }
    
    const correlation = numerator / (Math.sqrt(denominatorA) * Math.sqrt(denominatorB));
    
    // Ensure correlation is in [-1, 1]
    return Math.max(-1, Math.min(1, correlation));
  }
  
  /**
   * Calculate expected returns for strategies
   */
  private calculateExpectedReturns(
    strategies: StrategyGenome[],
    historicalData: Record<string, any[]>,
    currentRegime: string
  ): number[] {
    return strategies.map(strategy => {
      // Get historical returns
      const data = historicalData[strategy.id] || [];
      
      // If no historical data, use a baseline expected return
      if (data.length === 0) {
        return 0.01; // 1% baseline expected return
      }
      
      // Calculate historical average return
      const historicalReturns = data.map(item => item.return || 0);
      const averageReturn = historicalReturns.reduce((sum, val) => sum + val, 0) / historicalReturns.length;
      
      // Get bias score for this strategy in the current regime
      const biasScore = this.biasEngine.calculateBiasScore(strategy, currentRegime);
      
      // Calculate regime-adjusted expected return
      // Combine historical performance with regime bias score
      const regimeAdjustedReturn = (
        averageReturn * this.config.historicalPerformanceWeight +
        biasScore * this.config.regimeAlignmentWeight
      ) / (this.config.historicalPerformanceWeight + this.config.regimeAlignmentWeight);
      
      return regimeAdjustedReturn;
    });
  }
  
  /**
   * Calculate risk metrics for strategies
   */
  private calculateRiskMetrics(
    strategies: StrategyGenome[],
    historicalData: Record<string, any[]>
  ): { volatility: number[], drawdown: number[] } {
    const volatility: number[] = [];
    const drawdown: number[] = [];
    
    for (const strategy of strategies) {
      const data = historicalData[strategy.id] || [];
      
      // If no historical data, use default values
      if (data.length < 2) {
        volatility.push(0.05); // 5% default volatility
        drawdown.push(0.1); // 10% default max drawdown
        continue;
      }
      
      // Calculate volatility (standard deviation of returns)
      const returns = data.map(item => item.return || 0);
      const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
      const squaredDiffs = returns.map(val => Math.pow(val - mean, 2));
      const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length;
      const stdDev = Math.sqrt(variance);
      
      // Calculate maximum drawdown
      let peak = -Infinity;
      let maxDrawdown = 0;
      
      // Assuming data is sorted by time, calculate cumulative returns
      let cumulativeReturn = 1;
      
      for (const item of data) {
        cumulativeReturn *= (1 + (item.return || 0));
        
        if (cumulativeReturn > peak) {
          peak = cumulativeReturn;
        }
        
        const currentDrawdown = (peak - cumulativeReturn) / peak;
        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
      }
      
      volatility.push(stdDev);
      drawdown.push(maxDrawdown);
    }
    
    return { volatility, drawdown };
  }
  
  /**
   * Optimize portfolio weights using modern portfolio theory
   * with adjustments for regime, volatility, and drawdown
   */
  private optimizeWeights(
    strategies: StrategyGenome[],
    expectedReturns: number[],
    correlationMatrix: number[][],
    riskMetrics: { volatility: number[], drawdown: number[] },
    currentRegime: { type: string, confidence: number }
  ): number[] {
    const n = strategies.length;
    
    // No strategies, return empty array
    if (n === 0) {
      return [];
    }
    
    // Single strategy, return all weight to that strategy
    if (n === 1) {
      return [1];
    }
    
    // Initialize weights as equal allocation
    let weights = Array(n).fill(1 / n);
    
    // Create a combined risk score for each strategy
    const riskScores = strategies.map((strategy, i) => {
      const volatilityScore = riskMetrics.volatility[i];
      const drawdownScore = riskMetrics.drawdown[i];
      
      // Combine volatility and drawdown scores
      return (
        volatilityScore * this.config.volatilityWeight +
        drawdownScore * this.config.drawdownResilienceWeight
      ) / (this.config.volatilityWeight + this.config.drawdownResilienceWeight);
    });
    
    // Create a correlation penalty for similar strategies
    const correlationPenalties = Array(n).fill(0);
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && correlationMatrix[i][j] > this.config.similarityThreshold) {
          correlationPenalties[i] += correlationMatrix[i][j];
        }
      }
    }
    
    // Normalize correlation penalties
    const maxPenalty = Math.max(...correlationPenalties);
    const normalizedPenalties = correlationPenalties.map(
      penalty => maxPenalty > 0 ? penalty / maxPenalty : 0
    );
    
    // Calculate risk-adjusted scores
    const scores = strategies.map((strategy, i) => {
      // If expected return is negative, heavily penalize
      if (expectedReturns[i] <= 0) {
        return 0.001; // Small positive value to avoid division by zero
      }
      
      // Calculate risk-adjusted score
      // Higher expected return and lower risk/correlation results in higher score
      return expectedReturns[i] / (
        1 + 
        riskScores[i] * (this.config.volatilityWeight + this.config.drawdownResilienceWeight) +
        normalizedPenalties[i] * this.config.correlationWeight
      );
    });
    
    // Normalize scores to sum to 1
    const totalScore = scores.reduce((sum, score) => sum + score, 0);
    weights = scores.map(score => totalScore > 0 ? score / totalScore : 1 / n);
    
    // Apply minimum weight threshold
    const minWeight = 0.01; // 1% minimum weight
    
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] < minWeight) {
        weights[i] = 0; // Set very small weights to zero
      }
    }
    
    // Renormalize
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    weights = weights.map(weight => weightSum > 0 ? weight / weightSum : 0);
    
    return weights;
  }
  
  /**
   * Calculate portfolio metrics based on weights and expected returns
   */
  private calculatePortfolioMetrics(
    weights: number[],
    expectedReturns: number[],
    correlationMatrix: number[][],
    riskMetrics: { volatility: number[], drawdown: number[] }
  ): {
    expectedReturn: number;
    expectedVolatility: number;
    expectedMaxDrawdown: number;
    expectedSharpeRatio: number;
  } {
    const n = weights.length;
    
    // Calculate expected portfolio return
    const expectedReturn = weights.reduce(
      (sum, weight, i) => sum + weight * expectedReturns[i],
      0
    );
    
    // Calculate expected portfolio volatility using correlation matrix
    let portfolioVariance = 0;
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        portfolioVariance += weights[i] * weights[j] * 
                          correlationMatrix[i][j] * 
                          riskMetrics.volatility[i] * 
                          riskMetrics.volatility[j];
      }
    }
    
    const expectedVolatility = Math.sqrt(portfolioVariance);
    
    // Calculate expected max drawdown (weighted average)
    const expectedMaxDrawdown = weights.reduce(
      (sum, weight, i) => sum + weight * riskMetrics.drawdown[i],
      0
    );
    
    // Calculate expected Sharpe ratio (using 0 as risk-free rate for simplicity)
    const riskFreeRate = 0;
    const expectedSharpeRatio = expectedVolatility > 0 ? 
                              (expectedReturn - riskFreeRate) / expectedVolatility : 
                              0;
    
    return {
      expectedReturn,
      expectedVolatility,
      expectedMaxDrawdown,
      expectedSharpeRatio
    };
  }

  /**
   * Update metrics for a strategy
   * @param strategy Strategy genome
   * @param returns Recent returns array
   * @param currentRegime Current market regime
   */
  public updateStrategyMetrics(
    strategy: StrategyGenome,
    returns: number[],
    currentRegime: MarketRegime
  ): void {
    this.currentRegime = currentRegime;
    
    const strategyId = strategy.id;
    const metrics = this.calculateMetrics(returns, strategy);
    
    this.strategyMetrics.set(strategyId, metrics);
    this.updateCorrelationMatrix();
    
    if (this.config.emitDetailedTelemetry) {
      this.telemetryBus.emit('strategy_metrics_updated', {
        strategyId,
        metrics: {
          sharpeRatio: metrics.sharpeRatio,
          meanReturn: metrics.meanReturn,
          volatility: metrics.volatility,
          maxDrawdown: metrics.maxDrawdown,
          regimePerformance: metrics.regimePerformance[currentRegime]
        }
      });
    }
  }
  
  /**
   * Get recommended weights for strategies
   * @returns Map of strategy IDs to weights
   */
  public getRecommendedWeights(): Map<string, number> {
    if (!this.lastOptimizationResult) {
      this.runOptimization();
    }
    
    return this.lastOptimizationResult?.weights.reduce((map, weight) => {
      map.set(weight.strategyId, weight.weight);
      return map;
    }, new Map<string, number>());
  }
  
  /**
   * Calculate metrics for a strategy
   * @param returns Returns array
   * @param strategy Strategy genome
   * @returns Strategy metrics
   */
  private calculateMetrics(returns: number[], strategy: StrategyGenome): StrategyMetrics {
    const meanReturn = this.calculateMean(returns);
    const volatility = this.calculateVolatility(returns);
    const sharpeRatio = this.calculateSharpeRatio(meanReturn, volatility);
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    const winRate = this.calculateWinRate(returns);
    
    const regimePerformance: any = {};
    Object.values(MarketRegime).forEach(regime => {
      const regimeReturns = strategy.getRegimePerformance(regime)?.returns || [];
      if (regimeReturns.length > 0) {
        const regimeMeanReturn = this.calculateMean(regimeReturns);
        const regimeVolatility = this.calculateVolatility(regimeReturns);
        const regimeSharpeRatio = this.calculateSharpeRatio(regimeMeanReturn, regimeVolatility);
        
        regimePerformance[regime] = {
          returns: regimeReturns,
          sharpeRatio: regimeSharpeRatio,
          meanReturn: regimeMeanReturn,
          volatility: regimeVolatility
        };
      }
    });
    
    return {
      strategyId: strategy.id,
      returns,
      sharpeRatio,
      meanReturn,
      volatility,
      maxDrawdown,
      winRate,
      regimePerformance
    };
  }
  
  /**
   * Update correlation matrix
   */
  private updateCorrelationMatrix(): void {
    const strategies = Array.from(this.strategyMetrics.keys());
    
    for (let i = 0; i < strategies.length; i++) {
      const strategy1 = strategies[i];
      if (!this.correlationMatrix.has(strategy1)) {
        this.correlationMatrix.set(strategy1, new Map());
      }
      
      for (let j = i; j < strategies.length; j++) {
        const strategy2 = strategies[j];
        
        if (strategy1 === strategy2) {
          this.correlationMatrix.get(strategy1)!.set(strategy2, 1.0);
          continue;
        }
        
        const returns1 = this.strategyMetrics.get(strategy1)!.returns;
        const returns2 = this.strategyMetrics.get(strategy2)!.returns;
        
        const correlation = this.calculateCorrelation(returns1, returns2);
        
        this.correlationMatrix.get(strategy1)!.set(strategy2, correlation);
        
        if (!this.correlationMatrix.has(strategy2)) {
          this.correlationMatrix.set(strategy2, new Map());
        }
        this.correlationMatrix.get(strategy2)!.set(strategy1, correlation);
      }
    }
  }
  
  /**
   * Optimize portfolio using Mean-Variance Optimization
   * @returns Optimization result
   */
  private optimizePortfolio(): OptimizationResult {
    const strategies = Array.from(this.strategyMetrics.keys());
    const n = strategies.length;
    
    // Use efficient frontier to find optimal weights
    const weights = this.calculateEfficientFrontierWeights(strategies);
    
    // Calculate expected portfolio metrics
    const expectedReturn = this.calculatePortfolioReturn(weights);
    const expectedVolatility = this.calculatePortfolioVolatility(weights);
    const expectedSharpeRatio = this.calculateSharpeRatio(expectedReturn, expectedVolatility);
    const diversificationScore = this.calculateDiversificationScore(weights);
    
    // Calculate regime alignment
    const regimeAlignment: {[regime in MarketRegime]?: number} = {};
    Object.values(MarketRegime).forEach(regime => {
      regimeAlignment[regime] = this.calculateRegimeAlignment(weights, regime);
    });
    
    return {
      weights: strategies.map((strategy, index) => ({
        strategyId: strategy.id,
        weight: weights[index]
      })),
      expectedMetrics: {
        expectedReturn,
        expectedVolatility,
        expectedMaxDrawdown: this.calculateMaxDrawdown(Array.from(weights.values())),
        expectedSharpeRatio
      },
      timestamp: Date.now(),
      currentRegime: this.currentRegime?.type || ''
    };
  }
  
  /**
   * Calculate efficient frontier weights
   * @param strategies Strategy IDs
   * @returns Map of strategy IDs to weights
   */
  private calculateEfficientFrontierWeights(strategies: string[]): Map<string, number> {
    const weights = new Map<string, number>();
    
    // Select only strategies that perform well in the current regime
    const eligibleStrategies = strategies.filter(stratId => {
      const metrics = this.strategyMetrics.get(stratId)!;
      if (!this.currentRegime) return true;
      
      const regimePerf = metrics.regimePerformance[this.currentRegime];
      return regimePerf && regimePerf.sharpeRatio > 0;
    });
    
    // Sort by Sharpe ratio
    eligibleStrategies.sort((a, b) => {
      const sharpeA = this.strategyMetrics.get(a)!.sharpeRatio;
      const sharpeB = this.strategyMetrics.get(b)!.sharpeRatio;
      return sharpeB - sharpeA;
    });
    
    // Take top N strategies
    const topStrategies = eligibleStrategies.slice(0, this.config.maxStrategiesInPortfolio);
    
    // Allocate based on relative Sharpe ratios and diversification
    const totalWeight = topStrategies.reduce((sum, stratId) => {
      const sharpe = Math.max(0, this.strategyMetrics.get(stratId)!.sharpeRatio);
      const diversification = this.calculateStrategyDiversificationScore(stratId, topStrategies);
      return sum + sharpe * (1 + diversification);
    }, 0);
    
    if (totalWeight <= 0) {
      // Equal weight if no positive Sharpe ratios
      const equalWeight = 1 / topStrategies.length;
      topStrategies.forEach(stratId => {
        weights.set(stratId, equalWeight);
      });
    } else {
      topStrategies.forEach(stratId => {
        const sharpe = Math.max(0, this.strategyMetrics.get(stratId)!.sharpeRatio);
        const diversification = this.calculateStrategyDiversificationScore(stratId, topStrategies);
        const weight = (sharpe * (1 + diversification)) / totalWeight;
        weights.set(stratId, weight);
      });
    }
    
    // Set zero weights for non-included strategies
    strategies.forEach(stratId => {
      if (!weights.has(stratId)) {
        weights.set(stratId, 0);
      }
    });
    
    return weights;
  }
  
  /**
   * Calculate diversification score for a strategy
   * @param strategyId Strategy ID
   * @param otherStrategies Other strategies to compare against
   * @returns Diversification score (0-1)
   */
  private calculateStrategyDiversificationScore(
    strategyId: string, 
    otherStrategies: string[]
  ): number {
    if (otherStrategies.length <= 1) return 0;
    
    let totalCorrelation = 0;
    let count = 0;
    
    otherStrategies.forEach(otherId => {
      if (otherId === strategyId) return;
      
      const correlation = this.correlationMatrix.get(strategyId)?.get(otherId) || 0;
      totalCorrelation += Math.abs(correlation);
      count++;
    });
    
    const avgCorrelation = count > 0 ? totalCorrelation / count : 0;
    // Lower correlation = higher diversification benefit
    return 1 - avgCorrelation;
  }
  
  /**
   * Calculate portfolio return
   * @param weights Strategy weights
   * @returns Expected portfolio return
   */
  private calculatePortfolioReturn(weights: Map<string, number>): number {
    let expectedReturn = 0;
    
    for (const [stratId, weight] of weights.entries()) {
      const metrics = this.strategyMetrics.get(stratId);
      if (metrics && weight > 0) {
        expectedReturn += metrics.meanReturn * weight;
      }
    }
    
    return expectedReturn;
  }
  
  /**
   * Calculate portfolio volatility
   * @param weights Strategy weights
   * @returns Expected portfolio volatility
   */
  private calculatePortfolioVolatility(weights: Map<string, number>): number {
    let variance = 0;
    const strategies = Array.from(weights.keys());
    
    for (let i = 0; i < strategies.length; i++) {
      const strat1 = strategies[i];
      const weight1 = weights.get(strat1) || 0;
      
      if (weight1 === 0) continue;
      
      const metrics1 = this.strategyMetrics.get(strat1);
      if (!metrics1) continue;
      
      // Add individual variance contribution
      variance += Math.pow(weight1, 2) * Math.pow(metrics1.volatility, 2);
      
      // Add covariance terms
      for (let j = i + 1; j < strategies.length; j++) {
        const strat2 = strategies[j];
        const weight2 = weights.get(strat2) || 0;
        
        if (weight2 === 0) continue;
        
        const metrics2 = this.strategyMetrics.get(strat2);
        if (!metrics2) continue;
        
        const correlation = this.correlationMatrix.get(strat1)?.get(strat2) || 0;
        const covariance = correlation * metrics1.volatility * metrics2.volatility;
        
        variance += 2 * weight1 * weight2 * covariance;
      }
    }
    
    return Math.sqrt(variance);
  }
  
  /**
   * Calculate overall diversification score
   * @param weights Strategy weights
   * @returns Diversification score (0-1)
   */
  private calculateDiversificationScore(weights: Map<string, number>): number {
    const strategies = Array.from(weights.entries())
      .filter(([_, weight]) => weight > 0)
      .map(([stratId]) => stratId);
    
    if (strategies.length <= 1) return 0;
    
    let totalPairwiseScore = 0;
    let pairCount = 0;
    
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const strat1 = strategies[i];
        const strat2 = strategies[j];
        
        const correlation = this.correlationMatrix.get(strat1)?.get(strat2) || 0;
        const diversificationScore = 1 - Math.abs(correlation);
        
        totalPairwiseScore += diversificationScore;
        pairCount++;
      }
    }
    
    return pairCount > 0 ? totalPairwiseScore / pairCount : 0;
  }
  
  /**
   * Calculate regime alignment
   * @param weights Strategy weights
   * @param regime Market regime
   * @returns Alignment score (0-1)
   */
  private calculateRegimeAlignment(
    weights: Map<string, number>, 
    regime: MarketRegime
  ): number {
    let totalAlignment = 0;
    let totalWeight = 0;
    
    for (const [stratId, weight] of weights.entries()) {
      if (weight <= 0) continue;
      
      const metrics = this.strategyMetrics.get(stratId);
      if (!metrics) continue;
      
      const regimePerf = metrics.regimePerformance[regime];
      if (!regimePerf) continue;
      
      // Normalize Sharpe ratio to 0-1 scale
      const sharpeScore = Math.max(0, Math.min(1, regimePerf.sharpeRatio / 3));
      
      totalAlignment += sharpeScore * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? totalAlignment / totalWeight : 0;
  }
  
  // Helper math functions
  
  /**
   * Calculate mean of array
   * @param values Array of values
   * @returns Mean value
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  /**
   * Calculate volatility (standard deviation)
   * @param values Array of values
   * @returns Volatility
   */
  private calculateVolatility(values: number[]): number {
    if (values.length <= 1) return 0;
    
    const mean = this.calculateMean(values);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (values.length - 1);
    
    return Math.sqrt(variance);
  }
  
  /**
   * Calculate Sharpe ratio
   * @param meanReturn Mean return
   * @param volatility Volatility
   * @returns Sharpe ratio
   */
  private calculateSharpeRatio(meanReturn: number, volatility: number): number {
    if (volatility === 0) return 0;
    return (meanReturn - this.config.riskFreeRate) / volatility;
  }
  
  /**
   * Calculate maximum drawdown
   * @param returns Array of returns
   * @returns Maximum drawdown (0-1)
   */
  private calculateMaxDrawdown(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    let cumulative = 1;
    let peak = 1;
    let maxDrawdown = 0;
    
    for (const ret of returns) {
      cumulative *= (1 + ret);
      
      if (cumulative > peak) {
        peak = cumulative;
      }
      
      const drawdown = (peak - cumulative) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }
  
  /**
   * Calculate win rate
   * @param returns Array of returns
   * @returns Win rate (0-1)
   */
  private calculateWinRate(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const wins = returns.filter(ret => ret > 0).length;
    return wins / returns.length;
  }
} 