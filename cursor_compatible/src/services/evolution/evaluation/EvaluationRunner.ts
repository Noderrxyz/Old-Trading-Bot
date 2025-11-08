/**
 * Evaluation Runner
 * 
 * Runs evaluations for mutated trading strategies using backtest, replay, and risk assessment.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { TradingStrategy } from '../mutation/strategy-model.js';
import { EvaluationResult } from './EvaluationResult.js';
import { FitnessScorer } from './FitnessScorer.js';
import { MutationResult } from '../mutation/types.js';

// These would be imports from existing systems
// Replace with actual implementations when integrating
import { BacktestEngine } from '../../backtest/BacktestEngine.js';
import { ReplaySimulator } from '../../simulation/ReplaySimulator.js';
import { TrustScoreService } from '../../agent/TrustScoreService.js';

/**
 * Configuration options for the evaluation runner
 */
export interface EvaluationRunnerConfig {
  /** Historical data period for backtest (in days) */
  backtestPeriod: number;
  
  /** Number of replay simulations to run */
  replayCount: number;
  
  /** Minimum trust score required to pass evaluation */
  minTrustScore: number;
  
  /** Maximum allowed drawdown to pass evaluation */
  maxAllowedDrawdown: number;
  
  /** Minimum required win rate to pass evaluation */
  minWinRate: number;
  
  /** Enable detailed performance logging */
  detailedLogging: boolean;
}

/**
 * Default configuration for evaluation runner
 */
const DEFAULT_CONFIG: EvaluationRunnerConfig = {
  backtestPeriod: 30,
  replayCount: 5,
  minTrustScore: 0.6,
  maxAllowedDrawdown: 0.25,
  minWinRate: 0.45,
  detailedLogging: true
};

/**
 * Service that runs comprehensive evaluation of mutated trading strategies
 */
export class EvaluationRunner {
  private config: EvaluationRunnerConfig;
  private fitnessScorer: FitnessScorer;
  private backtestEngine: BacktestEngine;
  private replaySimulator: ReplaySimulator;
  private trustScoreService: TrustScoreService;
  
  /**
   * Create a new EvaluationRunner instance
   * 
   * @param backtestEngine - Engine for running historical backtests
   * @param replaySimulator - Simulator for running strategy replays
   * @param trustScoreService - Service for checking agent trust scores
   * @param fitnessScorer - Scorer for calculating fitness from metrics
   * @param config - Configuration options
   */
  constructor(
    backtestEngine: BacktestEngine,
    replaySimulator: ReplaySimulator,
    trustScoreService: TrustScoreService,
    fitnessScorer: FitnessScorer,
    config: Partial<EvaluationRunnerConfig> = {}
  ) {
    this.backtestEngine = backtestEngine;
    this.replaySimulator = replaySimulator;
    this.trustScoreService = trustScoreService;
    this.fitnessScorer = fitnessScorer;
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`EvaluationRunner initialized with config: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Run a complete evaluation for a mutated strategy
   * 
   * @param mutationResult - Result of a mutation operation
   * @param generationId - ID of the current generation
   * @returns Complete evaluation result
   */
  public async evaluateStrategy(
    mutationResult: MutationResult,
    generationId: string
  ): Promise<EvaluationResult> {
    const { strategy, strategyId, parentStrategyId, mutationType } = mutationResult;
    const startTime = Date.now();
    
    logger.info(`Starting evaluation of strategy ${strategyId} (agent: ${strategy.agentId})`);
    
    try {
      // 1. Run historical backtest
      logger.info(`Running backtest for strategy ${strategyId}`);
      const backtestResults = await this.runBacktest(strategy);
      
      // 2. Run simulated replay
      logger.info(`Running replay simulations for strategy ${strategyId}`);
      const replayResults = await this.runReplaySimulations(strategy);
      
      // 3. Run risk checks
      logger.info(`Performing risk assessment for strategy ${strategyId}`);
      const riskResults = await this.performRiskAssessment(strategy);
      
      // 4. Combine metrics into evaluation result
      const evaluationResult: Omit<EvaluationResult, 'fitnessScore' | 'passed'> = {
        agentId: strategy.agentId,
        strategyId,
        sharpe: backtestResults.sharpe,
        maxDrawdown: backtestResults.maxDrawdown,
        winRate: backtestResults.winRate,
        volatilityResilience: replayResults.volatilityResilience,
        regretIndex: riskResults.regretIndex,
        timestamp: Date.now(),
        generationId,
        mutationType,
        rawMetrics: {
          ...backtestResults.metrics,
          ...replayResults.metrics,
          ...riskResults.metrics
        }
      };
      
      // 5. Calculate fitness score
      const result = this.fitnessScorer.calculateFitness(evaluationResult);
      
      const duration = (Date.now() - startTime) / 1000;
      logger.info(`Evaluation of strategy ${strategyId} completed in ${duration}s with score: ${result.fitnessScore}`);
      
      return result;
    } catch (error) {
      logger.error(`Error evaluating strategy ${strategyId}: ${error.message}`, error);
      
      // Return a failed evaluation result
      return {
        agentId: strategy.agentId,
        strategyId,
        sharpe: -1,
        maxDrawdown: 1,
        winRate: 0,
        volatilityResilience: 0,
        regretIndex: 1,
        fitnessScore: 0,
        passed: false,
        timestamp: Date.now(),
        generationId,
        mutationType,
        notes: `Evaluation failed: ${error.message}`
      };
    }
  }
  
  /**
   * Run historical backtest for a strategy
   * 
   * @param strategy - Trading strategy to backtest
   * @returns Backtest metrics
   */
  private async runBacktest(strategy: TradingStrategy): Promise<{
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    metrics: Record<string, number>;
  }> {
    try {
      // Run backtest using the BacktestEngine
      const backtestResult = await this.backtestEngine.runBacktest({
        strategy,
        period: this.config.backtestPeriod,
        detailed: this.config.detailedLogging
      });
      
      if (this.config.detailedLogging) {
        logger.info(`Backtest metrics for ${strategy.id}: ${JSON.stringify(backtestResult.metrics)}`);
      }
      
      return {
        sharpe: backtestResult.sharpeRatio,
        maxDrawdown: backtestResult.maxDrawdown,
        winRate: backtestResult.winRate,
        metrics: backtestResult.metrics
      };
    } catch (error) {
      logger.error(`Backtest failed for strategy ${strategy.id}: ${error.message}`);
      throw new Error(`Backtest failed: ${error.message}`);
    }
  }
  
  /**
   * Run multiple replay simulations for a strategy
   * 
   * @param strategy - Trading strategy to simulate
   * @returns Replay simulation metrics
   */
  private async runReplaySimulations(strategy: TradingStrategy): Promise<{
    volatilityResilience: number;
    metrics: Record<string, number>;
  }> {
    try {
      // Run multiple replay simulations
      const replayPromises = Array.from({ length: this.config.replayCount }).map(() => 
        this.replaySimulator.runSimulation({
          strategy,
          randomSeed: uuidv4(),
          simulationLength: 24 * 60 * 60 * 1000 // 24 hours in ms
        })
      );
      
      const replayResults = await Promise.all(replayPromises);
      
      // Calculate aggregate metrics from all replays
      const volatilityScores = replayResults.map(result => result.volatilityScore);
      const volatilityResilience = volatilityScores.reduce((sum, score) => sum + score, 0) / volatilityScores.length;
      
      // Collect all metrics
      const metrics: Record<string, number> = {};
      replayResults.forEach((result, index) => {
        Object.entries(result.metrics).forEach(([key, value]) => {
          const metricKey = `replay${index + 1}_${key}`;
          metrics[metricKey] = value;
        });
      });
      
      // Add aggregate metrics
      metrics.avgVolatilityScore = volatilityResilience;
      metrics.replayCount = this.config.replayCount;
      
      if (this.config.detailedLogging) {
        logger.info(`Replay metrics for ${strategy.id}: volatilityResilience=${volatilityResilience}`);
      }
      
      return {
        volatilityResilience,
        metrics
      };
    } catch (error) {
      logger.error(`Replay simulation failed for strategy ${strategy.id}: ${error.message}`);
      throw new Error(`Replay simulation failed: ${error.message}`);
    }
  }
  
  /**
   * Perform risk assessment for a strategy
   * 
   * @param strategy - Trading strategy to assess
   * @returns Risk assessment metrics
   */
  private async performRiskAssessment(strategy: TradingStrategy): Promise<{
    regretIndex: number;
    metrics: Record<string, number>;
  }> {
    try {
      // Get agent trust score
      const trustScore = await this.trustScoreService.getAgentTrustScore(strategy.agentId);
      
      // Calculate regret index based on risk parameters and trust score
      // Higher values indicate more risky strategies
      const positionSizeRisk = strategy.riskParameters.maxPositionSize * 2; // 0-2 range
      const drawdownRisk = strategy.riskParameters.maxDrawdown * 4; // 0-4 range
      const stopLossRisk = (1 - strategy.riskParameters.stopLoss * 10) * 0.5; // 0-0.5 range
      
      // Raw risk score: higher is more risky
      const rawRiskScore = (positionSizeRisk + drawdownRisk + stopLossRisk) / 6.5; // Normalize to 0-1
      
      // Risk tolerance decreases as trust score decreases
      const trustFactor = Math.min(1, Math.max(0.5, trustScore));
      
      // Regret index: higher means more regrettable (risky) decisions
      // Lower trust means higher regret for the same risk
      const regretIndex = rawRiskScore * (2 - trustFactor);
      
      // Collect metrics
      const metrics = {
        trustScore,
        positionSizeRisk,
        drawdownRisk,
        stopLossRisk,
        rawRiskScore,
        trustFactor,
        regretIndex
      };
      
      if (this.config.detailedLogging) {
        logger.info(`Risk assessment for ${strategy.id}: regretIndex=${regretIndex}, trustScore=${trustScore}`);
      }
      
      return {
        regretIndex: Math.min(1, regretIndex), // Cap at 1
        metrics
      };
    } catch (error) {
      logger.error(`Risk assessment failed for strategy ${strategy.id}: ${error.message}`);
      throw new Error(`Risk assessment failed: ${error.message}`);
    }
  }
  
  /**
   * Update the evaluation runner configuration
   * 
   * @param config - New configuration options
   */
  public updateConfig(config: Partial<EvaluationRunnerConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    logger.info(`EvaluationRunner configuration updated: ${JSON.stringify(this.config)}`);
  }
} 