import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { MutationEngine } from './MutationEngine';
import { StrategyGenome } from './StrategyGenome';
import { AlphaMemory } from '../memory/AlphaMemory';
import { BiasEngine } from './BiasEngine';
import { RegimeClassifier, MarketRegime } from '../regime/RegimeClassifier';

/**
 * Configuration for the strategy mutation engine
 */
export interface StrategyMutationEngineConfig {
  /**
   * Interval between mutation cycles in milliseconds
   */
  mutationIntervalMs: number;
  
  /**
   * Maximum number of strategies to keep in the pool
   */
  maxStrategiesInPool: number;
  
  /**
   * Number of offspring strategies to create per cycle
   */
  offspringPerCycle: number;
  
  /**
   * Minimum performance threshold for strategies to remain in pool
   */
  minPerformanceThreshold: number;
  
  /**
   * Emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
  
  /**
   * Maximum generations to keep in lineage tracking
   */
  maxLineageGenerations: number;
  
  /**
   * Enable bias-based selection
   */
  enableBiasedSelection: boolean;
  
  /**
   * Percentage of strategies to consider as parents (top performers)
   */
  parentSelectionPercentage: number;
  
  /**
   * Maximum iterations without improvement before forced mutation
   */
  maxIterationsWithoutImprovement: number;
  
  /**
   * Base mutation probability 
   */
  baseMutationProbability: number;
  
  /**
   * Probability of crossover vs mutation
   */
  crossoverProbability: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: StrategyMutationEngineConfig = {
  mutationIntervalMs: 3600000, // 1 hour
  maxStrategiesInPool: 100,
  offspringPerCycle: 10,
  minPerformanceThreshold: -0.5, // Sharpe ratio
  emitDetailedTelemetry: true,
  maxLineageGenerations: 10,
  enableBiasedSelection: true,
  parentSelectionPercentage: 0.2, // Top 20%
  maxIterationsWithoutImprovement: 5,
  baseMutationProbability: 0.3,
  crossoverProbability: 0.7
};

/**
 * Metadata for a generation of strategies
 */
export interface GenerationMetadata {
  /**
   * Generation number
   */
  generationNumber: number;
  
  /**
   * Timestamp when the generation was created
   */
  timestamp: number;
  
  /**
   * Current market regime
   */
  marketRegime: MarketRegime;
  
  /**
   * Average fitness across all strategies
   */
  averageFitness: number;
  
  /**
   * Best fitness in the generation
   */
  bestFitness: number;
  
  /**
   * ID of the best strategy
   */
  bestStrategyId: string;
  
  /**
   * Number of strategies in this generation
   */
  populationSize: number;
  
  /**
   * Metrics about the diversity of strategies
   */
  diversityMetrics: {
    parameterDiversity: number;
    fitnessDiversity: number;
    ancestryDiversity: number;
  };
}

/**
 * Event data for a mutation
 */
export interface MutationEvent {
  /**
   * Parent strategy IDs
   */
  parentIds: string[];
  
  /**
   * Offspring strategy ID
   */
  offspringId: string;
  
  /**
   * Type of mutation
   */
  mutationType: string;
  
  /**
   * Parameters that were mutated
   */
  mutatedParameters: string[];
  
  /**
   * Mutation magnitude
   */
  mutationMagnitude: number;
  
  /**
   * Generation number
   */
  generationNumber: number;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Performance metrics for a strategy
 */
export interface StrategyPerformanceMetrics {
  sharpeRatio: number;
  pnlStability: number;
  maxDrawdown: number;
  winRate: number;
  [key: string]: number;
}

/**
 * Engine that orchestrates evolutionary cycles
 * for trading strategies, applying mutations and
 * tracking performance
 */
export class StrategyMutationEngine {
  private static instance: StrategyMutationEngine | null = null;
  private config: StrategyMutationEngineConfig;
  private mutationEngine: MutationEngine;
  private telemetry: TelemetryBus;
  private alphaMemory: AlphaMemory;
  private biasEngine: BiasEngine;
  private regimeClassifier: RegimeClassifier;
  
  private strategyPool: Map<string, StrategyGenome> = new Map();
  private currentGeneration: number = 0;
  private generationHistory: GenerationMetadata[] = [];
  private mutationTimer: NodeJS.Timeout | null = null;
  private iterationsSinceImprovement: number = 0;
  private lastBestFitness: number = -Infinity;
  private isRunning: boolean = false;
  
  /**
   * Private constructor for singleton
   */
  private constructor(
    config: Partial<StrategyMutationEngineConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mutationEngine = MutationEngine.getInstance();
    this.alphaMemory = AlphaMemory.getInstance();
    this.biasEngine = BiasEngine.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.telemetry = TelemetryBus.getInstance();
    
    logger.info('Strategy Mutation Engine initialized', { config: this.config });
    
    this.telemetry.emit('mutation_engine.initialized', {
      config: this.config,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(config: Partial<StrategyMutationEngineConfig> = {}): StrategyMutationEngine {
    if (!StrategyMutationEngine.instance) {
      StrategyMutationEngine.instance = new StrategyMutationEngine(config);
    }
    return StrategyMutationEngine.instance;
  }
  
  /**
   * Get configuration
   */
  public getConfig(): StrategyMutationEngineConfig {
    return this.config;
  }

  /**
   * Start mutation cycles
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('StrategyMutationEngine is already running');
      return;
    }
    
    this.isRunning = true;
    
    // Execute first cycle immediately
    this.executeMutationCycle();
    
    // Schedule regular cycles
    this.mutationTimer = setInterval(
      () => this.executeMutationCycle(),
      this.config.mutationIntervalMs
    );
    
    logger.info(`StrategyMutationEngine started with interval ${this.config.mutationIntervalMs}ms`);
  }
  
  /**
   * Stop mutation cycles
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('StrategyMutationEngine is not running');
      return;
    }
    
    if (this.mutationTimer) {
      clearInterval(this.mutationTimer);
      this.mutationTimer = null;
    }
    
    this.isRunning = false;
    logger.info('StrategyMutationEngine stopped');
  }
  
  /**
   * Load initial strategies
   * @param strategies Array of strategy genomes
   */
  public loadInitialStrategies(strategies: StrategyGenome[]): void {
    for (const strategy of strategies) {
      this.strategyPool.set(strategy.id, strategy);
    }
    
    logger.info('Loaded initial strategies', {
      count: strategies.length
    });
    
    this.recordMetric('initial_strategies_loaded', {
      count: strategies.length,
      strategyIds: strategies.map(s => s.id)
    });
    
    // Record first generation metadata
    this.recordGenerationMetadata();
  }
  
  /**
   * Execute a single mutation cycle
   */
  public executeMutationCycle(): void {
    try {
      const startTime = Date.now();
      const currentRegime = this.regimeClassifier.getCurrentRegime("DEFAULT");
      
      logger.info('Starting mutation cycle', {
        generation: this.currentGeneration + 1,
        currentRegime: currentRegime.primaryRegime
      });
      
      // Prune underperforming strategies
      this.pruneStrategyPool();
      
      // Calculate adaptive mutation rate
      const adaptiveMutationRate = this.calculateAdaptiveMutationRate();
      
      // Get current strategies in pool
      const strategies = Array.from(this.strategyPool.values());
      
      // Select parents for new offspring
      const offspringCount = Math.min(
        this.config.offspringPerCycle,
        this.config.maxStrategiesInPool - strategies.length
      );
      
      const offspring: StrategyGenome[] = [];
      const offspringIds: string[] = [];
      
      for (let i = 0; i < offspringCount; i++) {
        // Select parent strategies
        const selectedParents = this.selectParentStrategies(2);
        if (selectedParents.length < 1) {
          logger.warn('Insufficient parents available for mutation');
          break;
        }
        
        // Determine if we should do crossover or mutation
        const shouldCrossover = selectedParents.length >= 2 && 
                              Math.random() < this.config.crossoverProbability;
        
        let newStrategy: StrategyGenome;
        let mutationType = '';
        let mutatedParameters: string[] = [];
        let mutationMagnitude = 0;
        
        if (shouldCrossover) {
          // Use mutation engine for crossover
          const parentA = selectedParents[0];
          const parentB = selectedParents[1];
          
          newStrategy = this.mutationEngine.crossOver(parentA, parentB);
          mutationType = 'crossover';
          mutatedParameters = ['crossover']; // Placeholder
        } else {
          // Use mutation engine for mutation
          const parent = selectedParents[0];
          
          newStrategy = this.mutationEngine.mutate(parent, adaptiveMutationRate);
          mutationType = 'point_mutation';
          mutatedParameters = ['mutation']; // Placeholder
          mutationMagnitude = adaptiveMutationRate;
        }
        
        // Update metadata for the new strategy
        if (newStrategy.metadata) {
          newStrategy.metadata.parentIds = selectedParents.map(p => p.id);
          newStrategy.metadata.generation = this.currentGeneration;
          newStrategy.metadata.birthTimestamp = Date.now();
        }
        
        // Add to offspring list
        offspring.push(newStrategy);
        offspringIds.push(newStrategy.id);
        
        // Add to strategy pool
        this.strategyPool.set(newStrategy.id, newStrategy);
        
        // Emit event
        this.telemetry.emit('mutation_engine.strategy_created', {
          parentIds: selectedParents.map(p => p.id),
          offspringId: newStrategy.id,
          mutationType,
          mutatedParameters,
          mutationMagnitude,
          generationNumber: this.currentGeneration,
          timestamp: Date.now()
        });
      }
      
      // Increment generation counter
      this.currentGeneration++;
      
      // Record metadata about this generation
      this.recordGenerationMetadata();
      
      // Check if we've improved
      const currentBestFitness = this.calculateBestFitness();
      if (currentBestFitness > this.lastBestFitness) {
        this.lastBestFitness = currentBestFitness;
        this.iterationsSinceImprovement = 0;
      } else {
        this.iterationsSinceImprovement++;
      }
      
      // Log results
      const elapsedTime = Date.now() - startTime;
      logger.info('Mutation cycle completed', {
        generation: this.currentGeneration,
        offspringCount: offspring.length,
        poolSize: this.strategyPool.size,
        bestFitness: this.lastBestFitness,
        iterationsSinceImprovement: this.iterationsSinceImprovement,
        elapsedMs: elapsedTime
      });
      
      // Emit telemetry
      this.telemetry.emit('mutation_engine.cycle_completed', {
        generation: this.currentGeneration,
        offspringCount: offspring.length,
        offspringIds,
        poolSize: this.strategyPool.size,
        bestFitness: this.lastBestFitness,
        iterationsSinceImprovement: this.iterationsSinceImprovement,
        elapsedMs: elapsedTime,
        timestamp: Date.now()
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in mutation cycle: ${errorMessage}`, error);
      
      this.telemetry.emit('mutation_engine.cycle_error', {
        message: errorMessage,
        generation: this.currentGeneration,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Get all strategies in the pool
   * @returns Array of strategy genomes
   */
  public getAllStrategies(): StrategyGenome[] {
    return Array.from(this.strategyPool.values());
  }
  
  /**
   * Get top performing strategies
   * @param count Number of strategies to return
   * @returns Top performing strategies
   */
  public getTopStrategies(count: number = 10): StrategyGenome[] {
    const strategies = this.getAllStrategies();
    
    // Sort by fitness score (descending)
    strategies.sort((a, b) => {
      const scoreA = this.calculateFitnessScore(a);
      const scoreB = this.calculateFitnessScore(b);
      return scoreB - scoreA;
    });
    
    return strategies.slice(0, Math.min(count, strategies.length));
  }
  
  /**
   * Get generation history
   * @param limit Number of generations to return (most recent first)
   * @returns Generation metadata
   */
  public getGenerationHistory(limit: number = 10): GenerationMetadata[] {
    return this.generationHistory
      .slice()
      .sort((a, b) => b.generationNumber - a.generationNumber)
      .slice(0, limit);
  }
  
  /**
   * Prune strategy pool to remove underperforming strategies
   */
  private pruneStrategyPool(): void {
    // Don't prune if we're under the maximum
    if (this.strategyPool.size <= this.config.maxStrategiesInPool) {
      return;
    }
    
    const strategies = this.getAllStrategies();
    
    // Calculate fitness scores
    const strategyScores = strategies.map(strategy => ({
      strategy,
      fitness: this.calculateFitnessScore(strategy)
    }));
    
    // Sort by fitness score (descending)
    strategyScores.sort((a, b) => b.fitness - a.fitness);
    
    // Identify strategies to prune
    const keepCount = Math.floor(this.config.maxStrategiesInPool * 0.8); // Keep 80% of max
    const strategiesToPrune = strategyScores
      .slice(keepCount)
      .filter(item => item.fitness < this.config.minPerformanceThreshold)
      .map(item => item.strategy);
    
    // Remove strategies
    for (const strategy of strategiesToPrune) {
      this.strategyPool.delete(strategy.id);
    }
    
    if (strategiesToPrune.length > 0) {
      logger.info('Pruned underperforming strategies', {
        count: strategiesToPrune.length,
        remainingCount: this.strategyPool.size
      });
      
      this.recordMetric('strategies_pruned', {
        count: strategiesToPrune.length,
        prunedIds: strategiesToPrune.map(s => s.id),
        minFitness: Math.min(...strategiesToPrune.map(s => this.calculateFitnessScore(s))),
        generation: this.currentGeneration
      });
    }
  }
  
  /**
   * Select parent strategies for the next generation
   */
  private selectParentStrategies(count: number): StrategyGenome[] {
    const strategies = Array.from(this.strategyPool.values());
    
    // Need at least one strategy
    if (strategies.length === 0) {
      return [];
    }
    
    // If not enough strategies, return all available
    if (strategies.length <= count) {
      return [...strategies];
    }
    
    // Use bias-based selection if enabled
    if (this.config.enableBiasedSelection) {
      return this.selectParentsBiased(strategies, count);
    } else {
      return this.selectParentsByFitness(strategies, count);
    }
  }
  
  /**
   * Select parents based on regime bias
   */
  private selectParentsBiased(strategies: StrategyGenome[], count: number): StrategyGenome[] {
    const currentRegime = this.regimeClassifier.getCurrentRegime("DEFAULT");
    
    // Calculate bias-adjusted fitness scores
    const strategyScores = strategies.map(strategy => {
      const fitness = this.calculateFitnessScore(strategy);
      const regimeBias = this.biasEngine.calculateBiasScore(strategy, currentRegime.primaryRegime);
      const adjustedFitness = fitness * (1 + regimeBias);
      
      return {
        strategy,
        score: adjustedFitness
      };
    });
    
    // Sort by adjusted fitness (descending)
    strategyScores.sort((a, b) => b.score - a.score);
    
    // Calculate total fitness
    const totalFitness = strategyScores.reduce((sum, item) => sum + item.score, 0);
    
    // Convert to selection probabilities
    const cumulativeProbabilities: number[] = [];
    let cumulativeProb = 0;
    
    for (const item of strategyScores) {
      const probability = totalFitness > 0 ? item.score / totalFitness : 1 / strategyScores.length;
      cumulativeProb += probability;
      cumulativeProbabilities.push(cumulativeProb);
    }
    
    // Select parents using roulette wheel
    const selectedIndices = new Set<number>();
    const selectedParents: StrategyGenome[] = [];
    
    while (selectedParents.length < count && selectedIndices.size < strategies.length) {
      const r = Math.random();
      let selectedIndex = 0;
      
      for (let i = 0; i < cumulativeProbabilities.length; i++) {
        if (r <= cumulativeProbabilities[i]) {
          selectedIndex = i;
          break;
        }
      }
      
      if (!selectedIndices.has(selectedIndex)) {
        selectedIndices.add(selectedIndex);
        selectedParents.push(strategyScores[selectedIndex].strategy);
      }
    }
    
    return selectedParents;
  }
  
  /**
   * Select parents based on raw fitness
   * @param strategies Available strategies
   * @param count Number of parents to select
   * @returns Selected parent strategies
   */
  private selectParentsByFitness(strategies: StrategyGenome[], count: number): StrategyGenome[] {
    // Calculate fitness scores
    const strategyScores = strategies.map(strategy => ({
      strategy,
      fitness: this.calculateFitnessScore(strategy)
    }));
    
    // Sort by fitness score (descending)
    strategyScores.sort((a, b) => b.fitness - a.fitness);
    
    // Return top strategies
    return strategyScores
      .slice(0, count)
      .map(item => item.strategy);
  }
  
  /**
   * Calculate fitness score for a strategy
   * @param strategy Strategy genome
   * @returns Fitness score
   */
  private calculateFitnessScore(strategy: StrategyGenome): number {
    // Get performance metrics from memory
    const metrics = this.alphaMemory.getStrategyPerformance(strategy.id);
    
    if (!metrics) {
      return 0;
    }
    
    // Base fitness calculation
    let fitness = 0;
    fitness += metrics.sharpeRatio * 0.3;
    fitness += metrics.pnlStability * 0.2;
    fitness += (1 - metrics.maxDrawdown) * 0.2;
    fitness += metrics.winRate * 0.3;
    
    // Add bonus for cross-chain capabilities if UniversalX is enabled
    if (strategy.parameters?.useUniversalX === true) {
      // Check if the strategy has successfully executed cross-chain trades
      const crossChainMetrics = this.alphaMemory.getCrossChainPerformance?.(strategy.id);
      if (crossChainMetrics) {
        // Bonus for successful cross-chain execution
        fitness += crossChainMetrics.successRate * 0.1;
        
        // Bonus for low latency cross-chain trades
        if (crossChainMetrics.avgLatency < 30000) { // Less than 30 seconds
          fitness += 0.05;
        }
        
        // Bonus for cost efficiency
        if (crossChainMetrics.avgFeeSavings > 0) {
          fitness += Math.min(crossChainMetrics.avgFeeSavings * 0.1, 0.1);
        }
      }
    }
    
    return fitness;
  }
  
  /**
   * Calculate the best fitness in the pool
   * @returns Best fitness score
   */
  private calculateBestFitness(): number {
    const strategies = this.getAllStrategies();
    if (strategies.length === 0) {
      return -Infinity;
    }
    
    let bestFitness = -Infinity;
    for (const strategy of strategies) {
      const fitness = this.calculateFitnessScore(strategy);
      if (fitness > bestFitness) {
        bestFitness = fitness;
      }
    }
    
    return bestFitness;
  }
  
  /**
   * Calculate adaptive mutation rate based on iterations without improvement
   * @returns Adjusted mutation rate
   */
  private calculateAdaptiveMutationRate(): number {
    // Increase mutation rate if we're stuck
    if (this.iterationsSinceImprovement >= this.config.maxIterationsWithoutImprovement) {
      const factor = 1 + (this.iterationsSinceImprovement / this.config.maxIterationsWithoutImprovement);
      return Math.min(0.9, this.config.baseMutationProbability * factor);
    }
    
    return this.config.baseMutationProbability;
  }
  
  /**
   * Record current generation metadata
   */
  private recordGenerationMetadata(): void {
    const strategies = this.getAllStrategies();
    if (strategies.length === 0) {
      return;
    }
    
    // Calculate fitness scores
    const fitnessScores = strategies.map(s => this.calculateFitnessScore(s));
    const avgFitness = fitnessScores.reduce((sum, f) => sum + f, 0) / fitnessScores.length;
    const bestFitness = Math.max(...fitnessScores);
    const bestIndex = fitnessScores.indexOf(bestFitness);
    const bestStrategyId = strategies[bestIndex].id;
    
    // Calculate diversity metrics
    const diversityMetrics = this.calculateDiversityMetrics(strategies);
    
    // Create generation metadata
    const metadata: GenerationMetadata = {
      generationNumber: this.currentGeneration,
      timestamp: Date.now(),
      marketRegime: this.regimeClassifier.getCurrentRegime("DEFAULT").primaryRegime,
      averageFitness: avgFitness,
      bestFitness,
      bestStrategyId,
      populationSize: strategies.length,
      diversityMetrics
    };
    
    // Add to history (limit size)
    this.generationHistory.push(metadata);
    if (this.generationHistory.length > this.config.maxLineageGenerations) {
      this.generationHistory.shift();
    }
    
    // Record telemetry
    this.recordEvent('generation_completed', metadata);
  }
  
  /**
   * Calculate diversity metrics for the strategy pool
   */
  private calculateDiversityMetrics(strategies: StrategyGenome[]): any {
    if (strategies.length <= 1) {
      return {
        parameterDiversity: 0,
        fitnessDiversity: 0,
        ancestryDiversity: 0
      };
    }
    
    // Calculate fitness diversity using standard deviation
    const fitnessScores = strategies.map(s => this.calculateFitnessScore(s));
    const fitnessDiversity = this.calculateStandardDeviation(fitnessScores);
    
    // Calculate parameter diversity
    let totalParameterDistance = 0;
    let comparisonCount = 0;
    
    for (let i = 0; i < strategies.length; i++) {
      const params1 = Object.entries(strategies[i].parameters || {});
      
      for (let j = i + 1; j < strategies.length; j++) {
        const params2 = Object.entries(strategies[j].parameters || {});
        
        const distance = this.calculateParameterDistance(params1, params2);
        totalParameterDistance += distance;
        comparisonCount++;
      }
    }
    
    const parameterDiversity = comparisonCount > 0 ? 
                              totalParameterDistance / comparisonCount : 0;
    
    // Calculate ancestry diversity (unique ancestors)
    const uniqueAncestors = new Set<string>();
    
    for (const strategy of strategies) {
      if (strategy.metadata && strategy.metadata.parentIds) {
        for (const parentId of strategy.metadata.parentIds) {
          uniqueAncestors.add(parentId);
        }
      }
    }
    
    const ancestryDiversity = strategies.length > 0 ? 
                            uniqueAncestors.size / strategies.length : 0;
    
    return {
      parameterDiversity,
      fitnessDiversity,
      ancestryDiversity
    };
  }
  
  /**
   * Calculate distance between two parameter sets
   * @param params1 First parameter set
   * @param params2 Second parameter set
   * @returns Distance score
   */
  private calculateParameterDistance(
    params1: [string, any][],
    params2: [string, any][]
  ): number {
    // Create maps for easier lookup
    const map1 = new Map(params1);
    const map2 = new Map(params2);
    
    // Get all unique keys
    const allKeys = new Set([...map1.keys(), ...map2.keys()]);
    
    let totalDistance = 0;
    let paramCount = 0;
    
    for (const key of allKeys) {
      const val1 = map1.get(key);
      const val2 = map2.get(key);
      
      // Skip if either value is missing
      if (val1 === undefined || val2 === undefined) {
        continue;
      }
      
      // Handle different parameter types
      if (typeof val1 === 'number' && typeof val2 === 'number') {
        // Normalize numbers to 0-1 range (assuming reasonable bounds)
        const normalizedDiff = Math.abs(val1 - val2) / Math.max(1, Math.abs(val1) + Math.abs(val2));
        totalDistance += normalizedDiff;
        paramCount++;
      } else if (typeof val1 === 'boolean' && typeof val2 === 'boolean') {
        // Distance is 0 if equal, 1 if different
        totalDistance += val1 !== val2 ? 1 : 0;
        paramCount++;
      } else if (typeof val1 === 'string' && typeof val2 === 'string') {
        // Distance is 0 if equal, 1 if different
        totalDistance += val1 !== val2 ? 1 : 0;
        paramCount++;
      }
    }
    
    return paramCount > 0 ? totalDistance / paramCount : 0;
  }
  
  /**
   * Calculate standard deviation of a numeric array
   * @param values Array of numbers
   * @returns Standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length <= 1) {
      return 0;
    }
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Record telemetry metric
   * @param name Metric name
   * @param data Metric data
   */
  private recordMetric(name: string, data: any): void {
    this.telemetry.recordMetric(`mutation_engine.${name}`, data);
  }
  
  /**
   * Record telemetry event
   * @param name Event name
   * @param data Event data
   */
  private recordEvent(name: string, data: any): void {
    this.telemetry.recordEvent(`mutation_engine.${name}`, data);
  }
  
  /**
   * Record telemetry error
   * @param name Error name
   * @param error Error object
   * @param data Additional data
   */
  private recordError(name: string, error: Error, data: any = {}): void {
    this.telemetry.recordError(`mutation_engine.${name}`, error, {
      ...data,
      message: error.message,
      stack: error.stack
    });
  }
  
  /**
   * Update performance metrics for a strategy
   * @param strategyId Strategy ID
   * @param metrics Performance metrics
   */
  public updateStrategyMetrics(strategyId: string, metrics: Partial<StrategyPerformanceMetrics>): void {
    // Find the strategy in the pool
    const strategy = this.strategyPool.get(strategyId);
    
    if (!strategy) {
      logger.warn(`Cannot update metrics for unknown strategy: ${strategyId}`);
      return;
    }
    
    // Update the strategy metrics
    strategy.metrics = {
      ...strategy.metrics,
      ...metrics,
      lastUpdated: Date.now()
    };
    
    // Update the strategy in the pool
    this.strategyPool.set(strategyId, strategy);
    
    logger.debug(`Updated metrics for strategy ${strategyId}`, metrics);
    
    // Record telemetry
    this.recordEvent('strategy_metrics_updated', {
      strategyId,
      metrics,
      timestamp: Date.now()
    });
  }

  /**
   * Evolve strategies with cross-chain operations awareness
   * @param strategies Array of strategies to evolve
   * @param regimeClassification Current regime classification
   * @returns Array of evolved strategies
   */
  public async evolveStrategiesWithCrossChain(
    strategies: StrategyGenome[],
    regimeClassification: any
  ): Promise<StrategyGenome[]> {
    const evolvedStrategies: StrategyGenome[] = [];
    
    // Identify cross-chain opportunities based on regime
    const crossChainOpportunities = this.identifyCrossChainOpportunities(regimeClassification);
    
    for (const strategy of strategies) {
      // Check if strategy should be evolved for cross-chain
      if (this.shouldEvolveCrossChain(strategy, crossChainOpportunities)) {
        const crossChainGenome = this.createCrossChainGenome(
          strategy,
          crossChainOpportunities.targetChains
        );
        evolvedStrategies.push(crossChainGenome);
      } else {
        // Regular evolution
        const mutated = this.mutationEngine.mutate(strategy);
        evolvedStrategies.push(mutated);
      }
    }
    
    // Add evolved strategies to pool
    for (const strategy of evolvedStrategies) {
      this.strategyPool.set(strategy.id, strategy);
    }
    
    // Emit telemetry
    this.telemetry.emit('mutation_engine.cross_chain_evolution', {
      originalCount: strategies.length,
      evolvedCount: evolvedStrategies.length,
      crossChainCount: evolvedStrategies.filter(s => s.metadata?.crossChainEnabled).length,
      timestamp: Date.now()
    });
    
    return evolvedStrategies;
  }

  /**
   * Create a cross-chain genome from a parent genome
   * @param parentGenome Parent strategy genome
   * @param targetChains Target chains for cross-chain operations
   * @returns Cross-chain enabled genome
   */
  private createCrossChainGenome(
    parentGenome: StrategyGenome,
    targetChains: string[]
  ): StrategyGenome {
    // Clone the parent genome
    const crossChainGenome = {
      ...parentGenome,
      id: `${parentGenome.id}_xchain_${Date.now()}`,
      metadata: {
        ...parentGenome.metadata,
        crossChainEnabled: true,
        targetChains,
        crossChainStrategy: {
          type: 'arbitrage',
          minPriceDeviation: 0.005, // 0.5%
          maxSlippage: 0.01, // 1%
          preferredBridges: ['1inch', 'universalx'],
          gasOptimization: true
        }
      }
    };
    
    // Add cross-chain specific parameters
    if (!crossChainGenome.parameters) {
      crossChainGenome.parameters = {};
    }
    
    crossChainGenome.parameters['crossChain'] = {
      enabled: true,
      targetChains,
      bridgeTimeout: 300000, // 5 minutes
      minLiquidityThreshold: 100000, // $100k
      maxGasPrice: 100, // gwei
      routingStrategy: 'optimal_path'
    };
    
    return crossChainGenome;
  }

  /**
   * Identify cross-chain opportunities based on market regime
   */
  private identifyCrossChainOpportunities(regimeClassification: any): {
    shouldEnableCrossChain: boolean;
    targetChains: string[];
    opportunityScore: number;
  } {
    // Simple heuristics for cross-chain opportunities
    const regime = regimeClassification?.primaryRegime || 'UNKNOWN';
    
    switch (regime) {
      case 'VOLATILE':
        // High volatility favors cross-chain arbitrage
        return {
          shouldEnableCrossChain: true,
          targetChains: ['ethereum', 'polygon', 'arbitrum'],
          opportunityScore: 0.8
        };
        
      case 'TRENDING':
        // Trending markets may have price discrepancies
        return {
          shouldEnableCrossChain: true,
          targetChains: ['ethereum', 'binance-smart-chain', 'avalanche'],
          opportunityScore: 0.6
        };
        
      case 'STABLE':
        // Stable markets have less opportunity
        return {
          shouldEnableCrossChain: false,
          targetChains: [],
          opportunityScore: 0.2
        };
        
      default:
        return {
          shouldEnableCrossChain: false,
          targetChains: [],
          opportunityScore: 0.3
        };
    }
  }

  /**
   * Determine if a strategy should be evolved for cross-chain
   */
  private shouldEvolveCrossChain(
    strategy: StrategyGenome,
    opportunities: { shouldEnableCrossChain: boolean; opportunityScore: number }
  ): boolean {
    // Don't evolve if opportunities are low
    if (!opportunities.shouldEnableCrossChain || opportunities.opportunityScore < 0.5) {
      return false;
    }
    
    // Check if strategy is already cross-chain enabled
    if (strategy.metadata?.crossChainEnabled) {
      return false;
    }
    
    // Check strategy performance - only evolve well-performing strategies
    const fitnessScore = this.calculateFitnessScore(strategy);
    if (fitnessScore < 0.6) {
      return false;
    }
    
    // Random chance based on opportunity score
    return Math.random() < opportunities.opportunityScore;
  }
} 