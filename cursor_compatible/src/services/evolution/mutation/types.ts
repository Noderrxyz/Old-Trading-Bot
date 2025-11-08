/**
 * Strategy Mutation DSL Types
 * 
 * Type definitions for the strategy mutation domain-specific language (DSL).
 */

import { TradingStrategy } from './strategy-model.js';

/**
 * Result of a mutation operation
 */
export interface MutationResult {
  success: boolean;
  strategy: TradingStrategy;
  error?: string;
}

/**
 * Function type for mutation operators
 */
export type MutationOperator = (strategy: TradingStrategy) => MutationResult;

/**
 * Mutation rates for different aspects of a trading strategy
 */
export interface MutationRates {
  indicators: number;
  entryConditions: number;
  exitConditions: number;
  riskParameters: number;
  timeSettings: number;
  signalSettings?: number;
}

/**
 * Direction of mutation
 */
export enum MutationDirection {
  INCREASE = 'increase',
  DECREASE = 'decrease',
  RANDOM = 'random'
}

/**
 * Strategy for applying mutations
 */
export enum MutationStrategy {
  RANDOM = 'random',
  TARGETED = 'targeted',
  ADAPTIVE = 'adaptive'
}

/**
 * Type of mutation operation
 */
export enum MutationOperationType {
  ADD = 'add',
  REMOVE = 'remove',
  MODIFY = 'modify',
  TOGGLE = 'toggle'
}

/**
 * Generator options for mutations
 */
export interface MutationGeneratorOptions {
  strategyId?: string;
  targetParam?: string;
  direction?: MutationDirection;
  intensity?: number;
}

/**
 * Mutation operation specification
 */
export interface MutationOperation {
  type: MutationOperationType;
  target: string;
  params?: Record<string, any>;
}

/**
 * Detailed mutation specification
 */
export interface MutationSpec {
  id: string;
  strategyId: string;
  operations: MutationOperation[];
  timestamp: string;
}

/**
 * Configuration for the mutation engine
 */
export interface MutationConfig {
  keyPrefix: string;
  populationSize: number;
  eliteCount: number;
  maxGenerations: number;
  fitnessWeights: {
    returns: number;
    sharpeRatio: number;
    drawdown: number;
    winRate: number;
    profitFactor: number;
  };
  mutationRates: MutationRates;
  crossoverRate: number;
  selectionPressure: number;
  fitnessThreshold?: number;
  convergenceThreshold?: number;
  mutationStrategy?: MutationStrategy;
  tournamentSize?: number;
  crossoverProbability?: number;
}

/**
 * Stats for a single generation's fitness
 */
export interface FitnessStats {
  generation: number;
  average: number;
  best: number;
  worst: number;
  standardDeviation: number;
  diversity: number;
  timestamp: string;
}

/**
 * Historical fitness data point
 */
export interface FitnessHistoryPoint {
  generation: number;
  avgFitness: number;
  bestFitness: number;
  diversity: number;
}

/**
 * Statistics for the evolution process
 */
export interface EvolutionStats {
  currentGeneration: number;
  elapsedTimeMs: number;
  bestStrategyId: string;
  bestFitness: number;
  fitnessHistory: FitnessHistoryPoint[];
  hasConverged: boolean;
  generationsSinceImprovement: number;
}

/**
 * Result of an evolution run
 */
export interface EvolutionResult {
  runId: string;
  bestStrategy: TradingStrategy;
  stats: EvolutionStats;
  allStrategies: TradingStrategy[];
  completed: boolean;
  error?: string;
}

/**
 * Type to represent different mutation types
 */
export enum MutationType {
  INDICATOR_PARAMETER = 'indicator_parameter',
  ADD_REMOVE_INDICATOR = 'add_remove_indicator',
  ENTRY_CONDITION = 'entry_condition',
  EXIT_CONDITION = 'exit_condition',
  RISK_PARAMETER = 'risk_parameter',
  TIME_SETTING = 'time_setting'
} 