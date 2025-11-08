/**
 * Strategy Mutation Engine
 * 
 * Responsible for generating, validating, and applying mutations to trading strategies.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { 
  MutationDirection,
  MutationGeneratorOptions, 
  MutationOperation, 
  MutationOperationType, 
  MutationResult,
  MutationSpec,
  MutationConfig, 
  MutationOperator, 
  EvolutionStats,
  FitnessStats
} from './types.js';
import { MutationType } from '../types.js';
import { 
  TradingStrategy, 
  cloneStrategy, 
  createDefaultStrategy 
} from './strategy-model.js';
import { RedisService } from '../../../services/redis/RedisService.js';
import { randomUUID } from 'crypto';
import { Logger } from '../../../utils/logger.js';

/**
 * Default mutation configuration
 */
const DEFAULT_MUTATION_CONFIG: MutationConfig = {
  keyPrefix: 'mutation:',
  populationSize: 20,
  eliteCount: 2,
  mutationRates: {
    indicators: 0.3,
    entryConditions: 0.4,
    exitConditions: 0.35,
    riskParameters: 0.25,
    timeSettings: 0.15
  },
  crossoverRate: 0.7,
  selectionPressure: 1.5,
  maxGenerations: 30,
  fitnessWeights: {
    returns: 1.0,
    sharpeRatio: 1.5,
    drawdown: -1.0,
    winRate: 0.8,
    profitFactor: 1.0
  }
};

/**
 * Strategy Mutation Engine
 */
export class MutationEngine {
  private static instance: MutationEngine | null = null;
  private config: MutationConfig;
  private logger: Logger;
  private mutationOperators: Map<string, MutationOperator>;
  private redisService: RedisService;
  private isRunning: boolean = false;
  private generationInterval: NodeJS.Timeout | null = null;
  private population: TradingStrategy[] = [];
  private stats: EvolutionStats;

  /**
   * Get singleton instance
   */
  public static getInstance(): MutationEngine {
    if (!MutationEngine.instance) {
      MutationEngine.instance = new MutationEngine();
    }
    return MutationEngine.instance;
  }

  constructor(
    redisService: RedisService,
    config?: Partial<MutationConfig>
  ) {
    this.redisService = redisService;
    this.config = { ...DEFAULT_MUTATION_CONFIG, ...config };
    this.logger = new Logger('MutationEngine');
    this.mutationOperators = this.initializeMutationOperators();
    this.stats = this.initializeStats();
  }

  /**
   * Initialize the set of mutation operators used for evolution
   */
  private initializeMutationOperators(): Map<string, MutationOperator> {
    const operators = new Map<string, MutationOperator>();
    
    // Add mutation operators
    operators.set('indicatorParameterMutation', this.mutateIndicatorParameters.bind(this));
    operators.set('addRemoveIndicator', this.mutateAddRemoveIndicator.bind(this));
    operators.set('entryConditionMutation', this.mutateEntryConditions.bind(this));
    operators.set('exitConditionMutation', this.mutateExitConditions.bind(this));
    operators.set('riskParameterMutation', this.mutateRiskParameters.bind(this));
    operators.set('timeFrameMutation', this.mutateTimeSettings.bind(this));
    
    return operators;
  }

  /**
   * Start the mutation engine
   * @param intervalMs Interval between generations in milliseconds
   */
  public start(intervalMs: number = 3600000): void {
    if (this.isRunning) {
      this.logger.warn('Mutation engine is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting mutation engine');
    
    // Run initial generation
    this.runGeneration()
      .then(() => {
        this.logger.info('Initial generation completed');
        // Set up interval for subsequent generations
        this.generationInterval = setInterval(() => {
          this.runGeneration().catch(err => {
            this.logger.error('Error running generation', err);
          });
        }, intervalMs);
      })
      .catch(err => {
        this.logger.error('Error running initial generation', err);
        this.isRunning = false;
      });
  }

  /**
   * Stop the mutation engine
   */
  public stop(): void {
    if (!this.isRunning) {
      this.logger.warn('Mutation engine is not running');
      return;
    }

    if (this.generationInterval) {
      clearInterval(this.generationInterval);
      this.generationInterval = null;
    }
    
    this.isRunning = false;
    this.logger.info('Mutation engine stopped');
  }

  /**
   * Run a single generation of the evolutionary process
   */
  public async runGeneration(): Promise<void> {
    try {
      this.logger.info('Running new generation');
      
      // 1. Get current population from Redis
      const population = await this.getPopulation();
      
      // 2. Evaluate fitness if not already evaluated
      const populationWithFitness = await this.evaluateFitness(population);
      
      // 3. Select parents for reproduction
      const parents = this.selectParents(populationWithFitness);
      
      // 4. Create new population through crossover and mutation
      const offspring = this.createOffspring(parents);
      
      // 5. Select survivors (elitism + offspring)
      const nextGeneration = this.selectSurvivors(populationWithFitness, offspring);
      
      // 6. Store new population in Redis
      await this.storePopulation(nextGeneration);
      
      this.logger.info('Generation completed successfully');
    } catch (error) {
      this.logger.error('Error running generation', error);
      throw error;
    }
  }

  /**
   * Get the current population from Redis
   */
  private async getPopulation(): Promise<TradingStrategy[]> {
    try {
      const populationKey = `${this.config.keyPrefix}population`;
      const populationExists = await this.redisService.exists(populationKey);
      
      if (!populationExists) {
        // Initialize with random population if none exists
        return this.initializeRandomPopulation();
      }
      
      const populationData = await this.redisService.get(populationKey);
      return JSON.parse(populationData || '[]');
    } catch (error) {
      this.logger.error('Failed to get population from Redis', error);
      throw error;
    }
  }

  /**
   * Initialize a random population of strategies
   */
  private initializeRandomPopulation(): TradingStrategy[] {
    this.logger.info(`Initializing random population of size ${this.config.populationSize}`);
    const population: TradingStrategy[] = [];
    
    for (let i = 0; i < this.config.populationSize; i++) {
      population.push(this.createRandomStrategy());
    }
    
    return population;
  }

  /**
   * Create a random trading strategy
   */
  private createRandomStrategy(): TradingStrategy {
    // This would create a random strategy with random parameters
    // Simplified implementation for now
    return {
      id: randomUUID(),
      name: `Strategy-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      description: 'Randomly generated strategy',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentId: null,
      indicators: {
        rsi: {
          enabled: Math.random() > 0.5,
          period: Math.floor(Math.random() * 14) + 7,
          overbought: 70 + Math.floor(Math.random() * 10),
          oversold: 30 - Math.floor(Math.random() * 10)
        },
        macd: {
          enabled: Math.random() > 0.5,
          fastPeriod: Math.floor(Math.random() * 12) + 8,
          slowPeriod: Math.floor(Math.random() * 16) + 16,
          signalPeriod: Math.floor(Math.random() * 6) + 6
        }
      },
      entryConditions: {
        logicOperator: Math.random() > 0.5 ? 'AND' : 'OR',
        conditions: [
          {
            indicator: 'rsi',
            comparison: 'BELOW',
            value: 30 - Math.floor(Math.random() * 10)
          }
        ]
      },
      exitConditions: {
        logicOperator: 'OR',
        conditions: [
          {
            indicator: 'rsi',
            comparison: 'ABOVE',
            value: 70 + Math.floor(Math.random() * 10)
          },
          {
            indicator: 'price',
            comparison: 'ABOVE',
            value: 0,
            referenceIndicator: 'ATR',
            referenceMultiplier: 2 + Math.random() * 2
          }
        ]
      },
      riskParameters: {
        positionSizePercent: 0.01 + Math.random() * 0.09,
        stopLossPercent: 0.02 + Math.random() * 0.08,
        takeProfitPercent: 0.03 + Math.random() * 0.12,
        maxOpenPositions: Math.floor(Math.random() * 5) + 1
      },
      timeSettings: {
        timeframe: ['1h', '4h', '1d'][Math.floor(Math.random() * 3)]
      },
      fitness: {
        returns: 0,
        sharpeRatio: 0,
        drawdown: 0,
        winRate: 0,
        profitFactor: 0,
        evaluatedAt: null,
        overallScore: 0
      }
    };
  }

  /**
   * Evaluate fitness for strategies that haven't been evaluated yet
   */
  private async evaluateFitness(population: TradingStrategy[]): Promise<TradingStrategy[]> {
    // In a real implementation, this would backtest strategies or get results from a fitness service
    // For now, we'll just simulate random fitness scores for strategies without evaluations
    return population.map(strategy => {
      if (!strategy.fitness.evaluatedAt) {
        strategy.fitness = {
          returns: Math.random() * 0.5,
          sharpeRatio: Math.random() * 3,
          drawdown: Math.random() * 0.3,
          winRate: 0.4 + Math.random() * 0.4,
          profitFactor: 0.8 + Math.random() * 1.2,
          evaluatedAt: new Date().toISOString(),
          overallScore: 0
        };
        
        // Calculate overall score based on fitness weights
        strategy.fitness.overallScore = this.calculateOverallFitness(strategy.fitness);
      }
      return strategy;
    });
  }

  /**
   * Calculate overall fitness score based on weighted components
   */
  private calculateOverallFitness(fitness: any): number {
    const { returns, sharpeRatio, drawdown, winRate, profitFactor } = fitness;
    const weights = this.config.fitnessWeights;
    
    return returns * weights.returns +
           sharpeRatio * weights.sharpeRatio +
           drawdown * weights.drawdown +
           winRate * weights.winRate +
           profitFactor * weights.profitFactor;
  }

  /**
   * Select parents for reproduction using tournament selection
   */
  private selectParents(population: TradingStrategy[]): TradingStrategy[] {
    const sortedPopulation = [...population].sort((a, b) => 
      b.fitness.overallScore - a.fitness.overallScore);
    
    const parents: TradingStrategy[] = [];
    
    // Add elite strategies directly
    for (let i = 0; i < this.config.eliteCount; i++) {
      if (i < sortedPopulation.length) {
        parents.push(sortedPopulation[i]);
      }
    }
    
    // Tournament selection for remaining parents
    while (parents.length < this.config.populationSize / 2) {
      const tournamentSize = Math.min(3, population.length);
      const tournament: TradingStrategy[] = [];
      
      for (let i = 0; i < tournamentSize; i++) {
        const randomIdx = Math.floor(Math.random() * population.length);
        tournament.push(population[randomIdx]);
      }
      
      tournament.sort((a, b) => b.fitness.overallScore - a.fitness.overallScore);
      parents.push(tournament[0]);
    }
    
    return parents;
  }

  /**
   * Create offspring through crossover and mutation
   */
  private createOffspring(parents: TradingStrategy[]): TradingStrategy[] {
    const offspring: TradingStrategy[] = [];
    
    while (offspring.length < this.config.populationSize - this.config.eliteCount) {
      // Select two random parents
      const parent1Idx = Math.floor(Math.random() * parents.length);
      let parent2Idx = Math.floor(Math.random() * parents.length);
      
      // Ensure different parents
      while (parent2Idx === parent1Idx && parents.length > 1) {
        parent2Idx = Math.floor(Math.random() * parents.length);
      }
      
      const parent1 = parents[parent1Idx];
      const parent2 = parents[parent2Idx];
      
      // Perform crossover with probability crossoverRate
      let child: TradingStrategy;
      
      if (Math.random() < this.config.crossoverRate) {
        child = this.crossover(parent1, parent2);
      } else {
        // If no crossover, clone one of the parents
        child = this.cloneStrategy(Math.random() > 0.5 ? parent1 : parent2);
      }
      
      // Apply mutations
      const mutatedChild = this.mutateStrategy(child);
      offspring.push(mutatedChild);
    }
    
    return offspring;
  }

  /**
   * Perform crossover between two parent strategies
   */
  private crossover(parent1: TradingStrategy, parent2: TradingStrategy): TradingStrategy {
    const child = this.cloneStrategy(parent1);
    child.id = randomUUID();
    child.name = `Cross-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    child.description = `Crossover of ${parent1.id} and ${parent2.id}`;
    child.version = 1;
    child.createdAt = new Date().toISOString();
    child.updatedAt = new Date().toISOString();
    child.parentId = [parent1.id, parent2.id];
    
    // Randomly select components from either parent
    if (Math.random() > 0.5) {
      child.indicators = JSON.parse(JSON.stringify(parent2.indicators));
    }
    
    if (Math.random() > 0.5) {
      child.entryConditions = JSON.parse(JSON.stringify(parent2.entryConditions));
    }
    
    if (Math.random() > 0.5) {
      child.exitConditions = JSON.parse(JSON.stringify(parent2.exitConditions));
    }
    
    if (Math.random() > 0.5) {
      child.riskParameters = JSON.parse(JSON.stringify(parent2.riskParameters));
    }
    
    if (Math.random() > 0.5) {
      child.timeSettings = JSON.parse(JSON.stringify(parent2.timeSettings));
    }
    
    // Reset fitness values
    child.fitness = {
      returns: 0,
      sharpeRatio: 0,
      drawdown: 0,
      winRate: 0,
      profitFactor: 0,
      evaluatedAt: null,
      overallScore: 0
    };
    
    return child;
  }

  /**
   * Apply mutations to a strategy based on mutation rates
   */
  private mutateStrategy(strategy: TradingStrategy): MutationResult {
    try {
      // Create a deep copy of the strategy to avoid modifying the original
      const clonedStrategy: TradingStrategy = JSON.parse(JSON.stringify(strategy));
      
      // Apply random mutations based on mutation rates
      if (Math.random() < this.config.mutationRates.indicators) {
        const result = this.mutateIndicatorParameters(clonedStrategy);
        if (!result.success) {
          this.logger.debug(`Indicator mutation failed: ${result.error}`);
        }
      }
      
      if (Math.random() < this.config.mutationRates.entryConditions) {
        const result = this.mutateEntryConditions(clonedStrategy);
        if (!result.success) {
          this.logger.debug(`Entry condition mutation failed: ${result.error}`);
        }
      }
      
      if (Math.random() < this.config.mutationRates.exitConditions) {
        const result = this.mutateExitConditions(clonedStrategy);
        if (!result.success) {
          this.logger.debug(`Exit condition mutation failed: ${result.error}`);
        }
      }
      
      if (Math.random() < this.config.mutationRates.riskParameters) {
        const result = this.mutateRiskParameters(clonedStrategy);
        if (!result.success) {
          this.logger.debug(`Risk parameter mutation failed: ${result.error}`);
        }
      }
      
      if (Math.random() < this.config.mutationRates.timeSettings) {
        const result = this.mutateTimeSettings(clonedStrategy);
        if (!result.success) {
          this.logger.debug(`Time settings mutation failed: ${result.error}`);
        }
      }
      
      // Update strategy metadata
      clonedStrategy.id = `strategy-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      clonedStrategy.version = (strategy.version || 0) + 1;
      clonedStrategy.updatedAt = new Date().toISOString();
      
      return {
        success: true,
        strategy: clonedStrategy
      };
    } catch (error) {
      return {
        success: false,
        strategy,
        error: error instanceof Error ? error.message : 'Unknown error during mutation'
      };
    }
  }

  /**
   * Clone a strategy object
   */
  private cloneStrategy(strategy: TradingStrategy): TradingStrategy {
    return JSON.parse(JSON.stringify(strategy));
  }

  /**
   * Mutation operator: Mutate indicator parameters
   */
  private mutateIndicatorParameters(strategy: TradingStrategy): MutationResult {
    // Implementation for mutating indicator parameters
    const indicators = strategy.indicators;
    
    // Example: mutate RSI parameters
    if (indicators.rsi && indicators.rsi.enabled) {
      if (Math.random() < 0.5) {
        indicators.rsi.period = Math.max(2, Math.min(50, indicators.rsi.period + Math.floor(Math.random() * 5) - 2));
      }
      if (Math.random() < 0.3) {
        indicators.rsi.overbought = Math.max(60, Math.min(90, indicators.rsi.overbought + Math.floor(Math.random() * 7) - 3));
      }
      if (Math.random() < 0.3) {
        indicators.rsi.oversold = Math.max(10, Math.min(40, indicators.rsi.oversold + Math.floor(Math.random() * 7) - 3));
      }
    }
    
    // Example: mutate MACD parameters
    if (indicators.macd && indicators.macd.enabled) {
      if (Math.random() < 0.4) {
        indicators.macd.fastPeriod = Math.max(3, Math.min(30, indicators.macd.fastPeriod + Math.floor(Math.random() * 5) - 2));
      }
      if (Math.random() < 0.4) {
        indicators.macd.slowPeriod = Math.max(indicators.macd.fastPeriod + 1, Math.min(50, indicators.macd.slowPeriod + Math.floor(Math.random() * 7) - 3));
      }
      if (Math.random() < 0.3) {
        indicators.macd.signalPeriod = Math.max(2, Math.min(20, indicators.macd.signalPeriod + Math.floor(Math.random() * 3) - 1));
      }
    }
    
    return { success: true, strategy };
  }

  /**
   * Mutation operator: Add or remove indicators
   */
  private mutateAddRemoveIndicator(strategy: TradingStrategy): MutationResult {
    // Implementation for adding or removing indicators
    const indicators = strategy.indicators;
    
    // Example: toggle RSI
    if (Math.random() < 0.3 && indicators.rsi) {
      indicators.rsi.enabled = !indicators.rsi.enabled;
    }
    
    // Example: toggle MACD
    if (Math.random() < 0.3 && indicators.macd) {
      indicators.macd.enabled = !indicators.macd.enabled;
    }
    
    return { success: true, strategy };
  }

  /**
   * Mutation operator: Mutate entry conditions
   */
  private mutateEntryConditions(strategy: TradingStrategy): MutationResult {
    // Implementation for mutating entry conditions
    if (strategy.entryConditions.conditions.length > 0) {
      const randomConditionIndex = Math.floor(Math.random() * strategy.entryConditions.conditions.length);
      const condition = strategy.entryConditions.conditions[randomConditionIndex];
      
      // Mutate the selected condition
      if (Math.random() < 0.4) {
        // Mutate comparison value
        if (condition.value !== undefined) {
          condition.value = condition.value + (Math.random() * 10) - 5;
        }
      }
      
      if (Math.random() < 0.3) {
        // Mutate comparison operator
        const operators = ['ABOVE', 'BELOW', 'EQUAL', 'CROSS_ABOVE', 'CROSS_BELOW'];
        const currentIndex = operators.indexOf(condition.comparison);
        const newIndex = Math.floor(Math.random() * operators.length);
        condition.comparison = operators[newIndex !== currentIndex ? newIndex : (newIndex + 1) % operators.length];
      }
    }
    
    // Occasionally change logic operator
    if (Math.random() < 0.2) {
      strategy.entryConditions.logicOperator = strategy.entryConditions.logicOperator === 'AND' ? 'OR' : 'AND';
    }
    
    return { success: true, strategy };
  }

  /**
   * Mutation operator: Mutate exit conditions
   */
  private mutateExitConditions(strategy: TradingStrategy): MutationResult {
    // Implementation similar to entry conditions
    if (strategy.exitConditions.conditions.length > 0) {
      const randomConditionIndex = Math.floor(Math.random() * strategy.exitConditions.conditions.length);
      const condition = strategy.exitConditions.conditions[randomConditionIndex];
      
      // Mutate the selected condition
      if (Math.random() < 0.4 && condition.value !== undefined) {
        // Mutate comparison value
        condition.value = condition.value + (Math.random() * 10) - 5;
      }
      
      if (Math.random() < 0.3 && condition.referenceMultiplier !== undefined) {
        // Mutate reference multiplier for stop loss/take profit
        condition.referenceMultiplier = Math.max(0.5, Math.min(5, condition.referenceMultiplier + (Math.random() - 0.5)));
      }
    }
    
    return { success: true, strategy };
  }

  /**
   * Mutation operator: Mutate risk parameters
   */
  private mutateRiskParameters(strategy: TradingStrategy): MutationResult {
    const risk = strategy.riskParameters;
    
    // Mutate position size
    if (Math.random() < 0.4) {
      risk.positionSizePercent = Math.max(0.01, Math.min(0.2, risk.positionSizePercent + (Math.random() * 0.04) - 0.02));
    }
    
    // Mutate stop loss
    if (Math.random() < 0.4) {
      risk.stopLossPercent = Math.max(0.01, Math.min(0.15, risk.stopLossPercent + (Math.random() * 0.03) - 0.015));
    }
    
    // Mutate take profit
    if (Math.random() < 0.4) {
      risk.takeProfitPercent = Math.max(0.01, Math.min(0.3, risk.takeProfitPercent + (Math.random() * 0.05) - 0.025));
    }
    
    // Mutate max open positions
    if (Math.random() < 0.3) {
      risk.maxOpenPositions = Math.max(1, Math.min(10, risk.maxOpenPositions + Math.floor(Math.random() * 3) - 1));
    }
    
    return { success: true, strategy };
  }

  /**
   * Mutation operator: Mutate timeframe settings
   */
  private mutateTimeSettings(strategy: TradingStrategy): MutationResult {
    if (Math.random() < 0.3) {
      const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      const currentIndex = timeframes.indexOf(strategy.timeSettings.timeframe);
      
      if (currentIndex !== -1) {
        // Shift up or down by 1-2 positions in the timeframe array
        const shift = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
        const newIndex = Math.max(0, Math.min(timeframes.length - 1, currentIndex + shift));
        strategy.timeSettings.timeframe = timeframes[newIndex];
      }
    }
    
    return { success: true, strategy };
  }

  /**
   * Select survivors for the next generation (elitism + offspring)
   */
  private selectSurvivors(
    currentPopulation: TradingStrategy[],
    offspring: TradingStrategy[]
  ): TradingStrategy[] {
    const sortedPopulation = [...currentPopulation].sort((a, b) => 
      b.fitness.overallScore - a.fitness.overallScore);
    
    const nextGeneration: TradingStrategy[] = [];
    
    // Add elite individuals
    for (let i = 0; i < this.config.eliteCount; i++) {
      if (i < sortedPopulation.length) {
        nextGeneration.push(sortedPopulation[i]);
      }
    }
    
    // Add offspring
    for (let i = 0; i < offspring.length && nextGeneration.length < this.config.populationSize; i++) {
      nextGeneration.push(offspring[i]);
    }
    
    return nextGeneration;
  }

  /**
   * Store population in Redis
   */
  private async storePopulation(population: TradingStrategy[]): Promise<void> {
    try {
      const populationKey = `${this.config.keyPrefix}population`;
      await this.redisService.set(populationKey, JSON.stringify(population));
      
      // Also store best strategy separately
      const sortedPopulation = [...population].sort((a, b) => 
        b.fitness.overallScore - a.fitness.overallScore);
      
      if (sortedPopulation.length > 0) {
        const bestStrategy = sortedPopulation[0];
        await this.redisService.set(`${this.config.keyPrefix}best`, JSON.stringify(bestStrategy));
      }
    } catch (error) {
      this.logger.error('Failed to store population in Redis', error);
      throw error;
    }
  }

  /**
   * Get the best strategy from the current population
   */
  public async getBestStrategy(): Promise<TradingStrategy | null> {
    try {
      const bestStrategyKey = `${this.config.keyPrefix}best`;
      const bestStrategyData = await this.redisService.get(bestStrategyKey);
      
      if (bestStrategyData) {
        return JSON.parse(bestStrategyData);
      }
      
      // If no best strategy is stored, get the population and find the best
      const population = await this.getPopulation();
      if (population.length === 0) {
        return null;
      }
      
      const populationWithFitness = await this.evaluateFitness(population);
      const sortedPopulation = [...populationWithFitness].sort((a, b) => 
        b.fitness.overallScore - a.fitness.overallScore);
      
      return sortedPopulation[0];
    } catch (error) {
      this.logger.error('Failed to get best strategy', error);
      throw error;
    }
  }

  /**
   * Manually seed the mutation engine with custom strategies
   */
  public async seedStrategies(strategies: TradingStrategy[]): Promise<void> {
    try {
      const currentPopulation = await this.getPopulation();
      
      // Add new strategies to current population
      const combinedPopulation = [...currentPopulation, ...strategies];
      
      // If combined population exceeds populationSize, keep only the best strategies
      if (combinedPopulation.length > this.config.populationSize) {
        const populationWithFitness = await this.evaluateFitness(combinedPopulation);
        const sortedPopulation = [...populationWithFitness].sort((a, b) => 
          b.fitness.overallScore - a.fitness.overallScore);
        
        // Keep only populationSize strategies
        const trimmedPopulation = sortedPopulation.slice(0, this.config.populationSize);
        await this.storePopulation(trimmedPopulation);
      } else {
        // Store combined population
        await this.storePopulation(combinedPopulation);
      }
      
      this.logger.info(`Seeded ${strategies.length} strategies into population`);
    } catch (error) {
      this.logger.error('Failed to seed strategies', error);
      throw error;
    }
  }

  private initializeStats(): EvolutionStats {
    return {
      currentGeneration: 0,
      elapsedTimeMs: 0,
      bestStrategyId: '',
      bestFitness: 0,
      fitnessHistory: [],
      hasConverged: false,
      generationsSinceImprovement: 0
    };
  }

  /**
   * Get current evolution statistics
   */
  public getEvolutionStats(): EvolutionStats {
    return this.stats;
  }

  /**
   * Save the current population to Redis
   */
  public async savePopulation(runId: string): Promise<void> {
    try {
      const key = `${this.config.keyPrefix}:population:${runId}`;
      await this.redisService.set(key, JSON.stringify(this.population));
      
      // Save stats separately
      const statsKey = `${this.config.keyPrefix}:stats:${runId}`;
      await this.redisService.set(statsKey, JSON.stringify(this.stats));
      
      this.logger.info(`Saved population and stats for run ${runId}`);
    } catch (error) {
      this.logger.error('Failed to save population', error);
      throw error;
    }
  }

  /**
   * Load a population from Redis
   */
  public async loadPopulation(runId: string): Promise<boolean> {
    try {
      const key = `${this.config.keyPrefix}:population:${runId}`;
      const populationData = await this.redisService.get(key);
      
      if (!populationData) {
        this.logger.warn(`No population found for run ${runId}`);
        return false;
      }
      
      this.population = JSON.parse(populationData);
      
      // Load stats separately
      const statsKey = `${this.config.keyPrefix}:stats:${runId}`;
      const statsData = await this.redisService.get(statsKey);
      
      if (statsData) {
        this.stats = JSON.parse(statsData);
      } else {
        this.logger.warn(`No stats found for run ${runId}, using defaults`);
        this.stats = this.initializeStats();
      }
      
      this.logger.info(`Loaded population and stats for run ${runId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to load population', error);
      return false;
    }
  }
} 