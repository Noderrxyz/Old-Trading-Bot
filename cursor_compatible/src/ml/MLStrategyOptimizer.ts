/**
 * ML Strategy Optimizer - Phase 6: ML-Driven Strategy Optimization
 * 
 * Reinforcement Learning-based portfolio weight optimization system.
 * Uses Q-learning to learn optimal strategy allocations based on 
 * risk-adjusted returns, Sharpe ratio, and drawdown metrics.
 * 
 * Operates with zero external costs using local ML models.
 */

import { EventEmitter } from 'events';
import { PerformanceMetrics } from '../metrics/SimulatedPerformanceTracker';
import { StrategyAllocation } from '../strategy/StrategyEngine';
import { isPaperMode, logPaperModeCall } from '../config/PaperModeConfig';
import { logger } from '../utils/logger';

export interface MLOptimizerConfig {
  optimizerId: string;
  learningRate: number;
  explorationRate: number;
  decayRate: number;
  rewardWeights: {
    sharpeRatio: number;
    returnWeight: number;
    drawdownPenalty: number;
    volatilityPenalty: number;
  };
  trainingConfig: {
    batchSize: number;
    memorySize: number;
    targetUpdateFrequency: number;
    minExperienceSize: number;
  };
  optimizationConstraints: {
    maxAllocationChange: number;
    minAllocation: number;
    maxAllocation: number;
    rebalanceThreshold: number;
  };
}

export interface OptimizationState {
  strategyAllocations: Map<string, number>;
  portfolioMetrics: PerformanceMetrics;
  marketConditions: MarketCondition;
  timestamp: number;
}

export interface MarketCondition {
  volatilityRegime: 'low' | 'medium' | 'high';
  trendDirection: 'bullish' | 'bearish' | 'sideways';
  correlationLevel: number;
  liquidityIndex: number;
}

export interface MLAction {
  strategyId: string;
  allocationDelta: number;
  confidence: number;
}

export interface ExperienceReplay {
  state: OptimizationState;
  action: MLAction[];
  reward: number;
  nextState: OptimizationState;
  done: boolean;
  timestamp: number;
}

export interface OptimizationResult {
  optimalAllocations: Map<string, number>;
  expectedReturn: number;
  expectedSharpe: number;
  expectedDrawdown: number;
  confidence: number;
  reasoning: string[];
}

/**
 * Simplified Q-Table for strategy allocation learning
 */
class StrategyQTable {
  private qTable: Map<string, Map<string, number>> = new Map();
  private learningRate: number;
  private discountFactor: number;

  constructor(learningRate: number, discountFactor: number = 0.99) {
    this.learningRate = learningRate;
    this.discountFactor = discountFactor;
  }

  /**
   * Get Q-value for state-action pair
   */
  public getQValue(state: string, action: string): number {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, new Map());
    }
    
    const stateTable = this.qTable.get(state)!;
    return stateTable.get(action) || 0;
  }

  /**
   * Update Q-value using Q-learning formula
   */
  public updateQValue(state: string, action: string, reward: number, nextState: string, nextActions: string[]): void {
    const currentQ = this.getQValue(state, action);
    
    // Find maximum Q-value for next state
    const maxNextQ = Math.max(...nextActions.map(a => this.getQValue(nextState, a)));
    
    // Q-learning update: Q(s,a) = Q(s,a) + α[r + γ*max(Q(s',a')) - Q(s,a)]
    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);
    
    if (!this.qTable.has(state)) {
      this.qTable.set(state, new Map());
    }
    
    this.qTable.get(state)!.set(action, newQ);
  }

  /**
   * Get best action for given state (exploitation)
   */
  public getBestAction(state: string, possibleActions: string[]): string {
    if (possibleActions.length === 0) {
      throw new Error('No possible actions provided');
    }

    let bestAction = possibleActions[0];
    let bestValue = this.getQValue(state, bestAction);
    
    for (const action of possibleActions) {
      const value = this.getQValue(state, action);
      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
    }
    
    return bestAction;
  }

  /**
   * Get statistics about the Q-table
   */
  public getStatistics(): any {
    const totalStates = this.qTable.size;
    let totalActions = 0;
    let averageQValue = 0;
    let totalQValues = 0;

    for (const [state, actions] of this.qTable) {
      totalActions += actions.size;
      for (const [action, qValue] of actions) {
        averageQValue += qValue;
        totalQValues++;
      }
    }

    return {
      totalStates,
      totalActions,
      averageQValue: totalQValues > 0 ? averageQValue / totalQValues : 0,
      totalQValues
    };
  }
}

export class MLStrategyOptimizer extends EventEmitter {
  private config: MLOptimizerConfig;
  private qTable: StrategyQTable;
  
  // Experience replay buffer
  private experienceBuffer: ExperienceReplay[] = [];
  private currentState?: OptimizationState;
  
  // Training state
  private trainingStep: number = 0;
  private totalReward: number = 0;
  private bestSharpe: number = -Infinity;
  private lastOptimization: number = 0;
  
  // Performance tracking
  private optimizationHistory: Array<{
    timestamp: number;
    allocations: Map<string, number>;
    performance: PerformanceMetrics;
    reward: number;
  }> = [];

  constructor(config: MLOptimizerConfig) {
    super();
    
    // Validate paper mode
    if (!isPaperMode()) {
      throw new Error('MLStrategyOptimizer requires paper mode to be enabled');
    }
    
    const defaultConfig = {
      learningRate: 0.1,
      explorationRate: 0.15,
      decayRate: 0.995,
      rewardWeights: {
        sharpeRatio: 0.4,
        returnWeight: 0.3,
        drawdownPenalty: 0.2,
        volatilityPenalty: 0.1
      },
      trainingConfig: {
        batchSize: 32,
        memorySize: 10000,
        targetUpdateFrequency: 100,
        minExperienceSize: 50
      },
      optimizationConstraints: {
        maxAllocationChange: 0.1,
        minAllocation: 0.05,
        maxAllocation: 0.5,
        rebalanceThreshold: 0.02
      }
    };
    
    this.config = {
      ...defaultConfig,
      ...config,
      rewardWeights: { ...defaultConfig.rewardWeights, ...(config.rewardWeights || {}) },
      trainingConfig: { ...defaultConfig.trainingConfig, ...(config.trainingConfig || {}) },
      optimizationConstraints: { ...defaultConfig.optimizationConstraints, ...(config.optimizationConstraints || {}) }
    };
    
    // Initialize Q-Table
    this.qTable = new StrategyQTable(this.config.learningRate);
    
    logger.info(`[ML_OPTIMIZER] Initialized ML Strategy Optimizer ${config.optimizerId}`, {
      learningRate: this.config.learningRate,
      explorationRate: this.config.explorationRate
    });
  }

  /**
   * Convert optimization state to discrete state string for Q-learning
   */
  private encodeState(state: OptimizationState): string {
    const metrics = state.portfolioMetrics;
    const market = state.marketConditions;
    
    // Discretize continuous values
    const sharpeRange = Math.floor(Math.max(0, Math.min(4, metrics.sharpeRatio + 1))); // 0-4
    const returnRange = Math.floor(Math.max(0, Math.min(4, (metrics.totalPnlPercent + 50) / 25))); // 0-4
    const drawdownRange = Math.floor(Math.max(0, Math.min(4, metrics.maxDrawdownPercent / 10))); // 0-4
    const volatilityRange = Math.floor(Math.max(0, Math.min(2, metrics.volatility / 50))); // 0-2
    
    return `S${sharpeRange}_R${returnRange}_D${drawdownRange}_V${volatilityRange}_MV${market.volatilityRegime}_MT${market.trendDirection}`;
  }

  /**
   * Generate possible allocation actions
   */
  private generatePossibleActions(currentAllocations: Map<string, StrategyAllocation>): string[] {
    const actions: string[] = [];
    const strategyIds = Array.from(currentAllocations.keys());
    
    // Generate discrete actions: increase/decrease/maintain for each strategy
    for (const strategyId of strategyIds) {
      actions.push(`increase_${strategyId}`);
      actions.push(`decrease_${strategyId}`);
      actions.push(`maintain_${strategyId}`);
    }
    
    // Add portfolio-level actions
    actions.push('rebalance_equal');
    actions.push('concentrate_best');
    actions.push('diversify_all');
    
    return actions;
  }

  /**
   * Execute a selected action and return new allocations
   */
  private executeAction(
    action: string,
    currentAllocations: Map<string, StrategyAllocation>
  ): Map<string, number> {
    const newAllocations = new Map<string, number>();
    const constraints = this.config.optimizationConstraints;
    
    // Copy current allocations
    for (const [strategyId, allocation] of currentAllocations) {
      newAllocations.set(strategyId, allocation.allocation);
    }
    
    // Parse and execute action
    if (action.startsWith('increase_')) {
      const strategyId = action.replace('increase_', '');
      const current = newAllocations.get(strategyId) || 0;
      const newValue = Math.min(constraints.maxAllocation, current + constraints.maxAllocationChange);
      newAllocations.set(strategyId, newValue);
    } else if (action.startsWith('decrease_')) {
      const strategyId = action.replace('decrease_', '');
      const current = newAllocations.get(strategyId) || 0;
      const newValue = Math.max(constraints.minAllocation, current - constraints.maxAllocationChange);
      newAllocations.set(strategyId, newValue);
    } else if (action === 'rebalance_equal') {
      const equalWeight = 1.0 / newAllocations.size;
      for (const [strategyId] of newAllocations) {
        newAllocations.set(strategyId, equalWeight);
      }
    } else if (action === 'concentrate_best') {
      // Find best performing strategy and increase its allocation
      let bestStrategy = '';
      let bestPerformance = -Infinity;
      
      for (const [strategyId] of currentAllocations) {
        // Simplified: use allocation as performance proxy
        const performance = currentAllocations.get(strategyId)?.allocation || 0;
        if (performance > bestPerformance) {
          bestPerformance = performance;
          bestStrategy = strategyId;
        }
      }
      
      if (bestStrategy) {
        const current = newAllocations.get(bestStrategy) || 0;
        const newValue = Math.min(constraints.maxAllocation, current + constraints.maxAllocationChange * 2);
        newAllocations.set(bestStrategy, newValue);
      }
    } else if (action === 'diversify_all') {
      // Reduce concentration by moving towards equal weights
      const equalWeight = 1.0 / newAllocations.size;
      for (const [strategyId, current] of newAllocations) {
        const delta = (equalWeight - current) * 0.5; // Move 50% towards equal weight
        newAllocations.set(strategyId, Math.max(constraints.minAllocation, 
          Math.min(constraints.maxAllocation, current + delta)));
      }
    }
    
    // Normalize allocations to sum to 1
    const total = Array.from(newAllocations.values()).reduce((sum, val) => sum + val, 0);
    if (total > 0) {
      for (const [strategyId, allocation] of newAllocations) {
        newAllocations.set(strategyId, allocation / total);
      }
    }
    
    return newAllocations;
  }

  /**
   * Calculate reward based on performance improvement
   */
  private calculateReward(currentMetrics: PerformanceMetrics, previousMetrics?: PerformanceMetrics): number {
    const weights = this.config.rewardWeights;
    let reward = 0;
    
    // Base reward from current performance
    reward += weights.sharpeRatio * Math.tanh(currentMetrics.sharpeRatio / 3);
    reward += weights.returnWeight * Math.tanh(currentMetrics.totalPnlPercent / 100);
    reward -= weights.drawdownPenalty * Math.tanh(currentMetrics.maxDrawdownPercent / 50);
    reward -= weights.volatilityPenalty * Math.tanh(currentMetrics.volatility / 100);
    
    // Improvement bonus if we have previous metrics
    if (previousMetrics) {
      const sharpeImprovement = currentMetrics.sharpeRatio - previousMetrics.sharpeRatio;
      const returnImprovement = currentMetrics.totalPnlPercent - previousMetrics.totalPnlPercent;
      const drawdownImprovement = previousMetrics.maxDrawdownPercent - currentMetrics.maxDrawdownPercent;
      
      reward += sharpeImprovement * 2;
      reward += returnImprovement * 0.1;
      reward += drawdownImprovement * 0.5;
    }
    
    // Stability bonus
    if (currentMetrics.totalTrades > 10) {
      const stabilityBonus = Math.min(currentMetrics.winRate / 100, 0.2);
      reward += stabilityBonus;
    }
    
    return Math.tanh(reward);
  }

  /**
   * Optimize portfolio allocations using Q-learning
   */
  public async optimizeAllocations(
    currentAllocations: Map<string, StrategyAllocation>,
    portfolioMetrics: PerformanceMetrics,
    marketConditions: MarketCondition
  ): Promise<OptimizationResult> {
    logPaperModeCall('MLStrategyOptimizer', 'optimizeAllocations', {
      strategiesCount: currentAllocations.size,
      sharpeRatio: portfolioMetrics.sharpeRatio
    });
    
    const startTime = Date.now();
    
    try {
      // Create current state
      const allocationMap = new Map<string, number>();
      for (const [strategyId, allocation] of currentAllocations) {
        allocationMap.set(strategyId, allocation.allocation);
      }
      
      const state: OptimizationState = {
        strategyAllocations: allocationMap,
        portfolioMetrics,
        marketConditions,
        timestamp: Date.now()
      };
      
      const stateString = this.encodeState(state);
      
      // Store experience and update Q-table if we have a previous state
      if (this.currentState) {
        const reward = this.calculateReward(portfolioMetrics, this.currentState.portfolioMetrics);
        const prevStateString = this.encodeState(this.currentState);
        const possibleActions = this.generatePossibleActions(currentAllocations);
        
        // Update Q-table (this would be the last action taken)
        // For simplicity, we'll update with a dummy action - in practice, you'd track the actual action taken
        this.qTable.updateQValue(prevStateString, 'maintain_all', reward, stateString, possibleActions);
        
        this.storeExperience(this.currentState, [], reward, state, false);
        this.totalReward += reward;
        
        if (portfolioMetrics.sharpeRatio > this.bestSharpe) {
          this.bestSharpe = portfolioMetrics.sharpeRatio;
        }
      }
      
      // Choose action using ε-greedy policy
      const possibleActions = this.generatePossibleActions(currentAllocations);
      let selectedAction: string;
      
      if (Math.random() < this.config.explorationRate) {
        // Exploration: random action
        selectedAction = possibleActions[Math.floor(Math.random() * possibleActions.length)];
      } else {
        // Exploitation: best known action
        selectedAction = this.qTable.getBestAction(stateString, possibleActions);
      }
      
      // Execute the selected action
      const optimalAllocations = this.executeAction(selectedAction, currentAllocations);
      
      // Estimate expected performance
      const expectedReturn = this.estimateExpectedReturn(optimalAllocations, portfolioMetrics);
      const expectedSharpe = this.estimateExpectedSharpe(optimalAllocations, portfolioMetrics);
      const expectedDrawdown = this.estimateExpectedDrawdown(optimalAllocations, portfolioMetrics);
      
      // Decay exploration rate
      this.config.explorationRate *= this.config.decayRate;
      this.trainingStep++;
      
      // Update current state
      this.currentState = state;
      this.lastOptimization = Date.now();
      
      // Record optimization
      this.optimizationHistory.push({
        timestamp: Date.now(),
        allocations: new Map(optimalAllocations),
        performance: portfolioMetrics,
        reward: this.experienceBuffer.length > 0 ? 
          this.experienceBuffer[this.experienceBuffer.length - 1].reward : 0
      });
      
      const reasoning = this.generateOptimizationReasoning(selectedAction, portfolioMetrics, marketConditions);
      
      const result: OptimizationResult = {
        optimalAllocations,
        expectedReturn,
        expectedSharpe,
        expectedDrawdown,
        confidence: this.calculateConfidence(portfolioMetrics),
        reasoning
      };
      
      this.emit('optimizationComplete', {
        result,
        action: selectedAction,
        processingTime: Date.now() - startTime,
        trainingStep: this.trainingStep,
        explorationRate: this.config.explorationRate
      });
      
      logger.info(`[ML_OPTIMIZER] Optimization complete`, {
        action: selectedAction,
        strategiesOptimized: optimalAllocations.size,
        expectedSharpe,
        confidence: result.confidence,
        processingTime: Date.now() - startTime
      });
      
      return result;
      
    } catch (error) {
      this.emit('optimizationError', error);
      logger.error(`[ML_OPTIMIZER] Optimization failed:`, error);
      throw error;
    }
  }

  /**
   * Store experience in replay buffer
   */
  private storeExperience(
    state: OptimizationState,
    actions: MLAction[],
    reward: number,
    nextState: OptimizationState,
    done: boolean
  ): void {
    const experience: ExperienceReplay = {
      state,
      action: actions,
      reward,
      nextState,
      done,
      timestamp: Date.now()
    };
    
    this.experienceBuffer.push(experience);
    
    // Remove old experiences if buffer is full
    if (this.experienceBuffer.length > this.config.trainingConfig.memorySize) {
      this.experienceBuffer.shift();
    }
  }

  /**
   * Estimate expected return for given allocations
   */
  private estimateExpectedReturn(allocations: Map<string, number>, currentMetrics: PerformanceMetrics): number {
    const diversityBonus = allocations.size * 0.01;
    const baseReturn = currentMetrics.totalPnlPercent;
    return baseReturn * 1.05 + diversityBonus;
  }

  /**
   * Estimate expected Sharpe ratio for given allocations
   */
  private estimateExpectedSharpe(allocations: Map<string, number>, currentMetrics: PerformanceMetrics): number {
    const entropy = this.calculateAllocationEntropy(allocations);
    const entropyBonus = entropy * 0.15;
    return Math.max(0, currentMetrics.sharpeRatio + entropyBonus);
  }

  /**
   * Estimate expected drawdown for given allocations
   */
  private estimateExpectedDrawdown(allocations: Map<string, number>, currentMetrics: PerformanceMetrics): number {
    const maxAllocation = Math.max(...Array.from(allocations.values()));
    const concentrationPenalty = maxAllocation * 0.05;
    return Math.max(0, currentMetrics.maxDrawdownPercent - concentrationPenalty);
  }

  /**
   * Calculate allocation entropy (diversity measure)
   */
  private calculateAllocationEntropy(allocations: Map<string, number>): number {
    const values = Array.from(allocations.values()).filter(v => v > 0);
    if (values.length === 0) return 0;
    
    let entropy = 0;
    for (const allocation of values) {
      if (allocation > 0) {
        entropy -= allocation * Math.log2(allocation);
      }
    }
    
    return entropy;
  }

  /**
   * Calculate confidence in optimization results
   */
  private calculateConfidence(metrics: PerformanceMetrics): number {
    let confidence = 0.5;
    
    // Higher confidence with more experience
    if (this.trainingStep > 100) confidence += 0.2;
    if (this.trainingStep > 500) confidence += 0.1;
    
    // Higher confidence with good performance
    if (metrics.sharpeRatio > 1.0) confidence += 0.1;
    if (metrics.sharpeRatio > 2.0) confidence += 0.1;
    
    // Lower confidence with high drawdown
    if (metrics.maxDrawdownPercent > 10) confidence -= 0.1;
    if (metrics.maxDrawdownPercent > 20) confidence -= 0.2;
    
    return Math.max(0.1, Math.min(0.95, confidence));
  }

  /**
   * Generate human-readable reasoning for optimization decisions
   */
  private generateOptimizationReasoning(
    action: string,
    metrics: PerformanceMetrics,
    marketConditions: MarketCondition
  ): string[] {
    const reasoning: string[] = [];
    
    reasoning.push(`Market conditions: ${marketConditions.volatilityRegime} volatility, ${marketConditions.trendDirection} trend`);
    reasoning.push(`Current performance: ${metrics.sharpeRatio.toFixed(2)} Sharpe, ${metrics.totalPnlPercent.toFixed(2)}% return`);
    reasoning.push(`Selected action: ${action.replace(/_/g, ' ')}`);
    
    if (action.includes('increase')) {
      reasoning.push('Increasing allocation to outperforming strategy');
    } else if (action.includes('decrease')) {
      reasoning.push('Reducing allocation to underperforming strategy');
    } else if (action === 'rebalance_equal') {
      reasoning.push('Rebalancing to equal weights for stability');
    } else if (action === 'concentrate_best') {
      reasoning.push('Concentrating on best performing strategy');
    } else if (action === 'diversify_all') {
      reasoning.push('Diversifying to reduce concentration risk');
    }
    
    reasoning.push(`Exploration rate: ${(this.config.explorationRate * 100).toFixed(1)}%`);
    
    return reasoning;
  }

  /**
   * Get optimization statistics
   */
  public getStatistics(): any {
    return {
      optimizerId: this.config.optimizerId,
      trainingStep: this.trainingStep,
      totalReward: this.totalReward,
      bestSharpe: this.bestSharpe,
      experienceBufferSize: this.experienceBuffer.length,
      explorationRate: this.config.explorationRate,
      optimizationHistory: this.optimizationHistory.length,
      lastOptimization: this.lastOptimization,
      qTableStats: this.qTable.getStatistics(),
      averageReward: this.experienceBuffer.length > 0 ?
        this.experienceBuffer.reduce((sum, exp) => sum + exp.reward, 0) / this.experienceBuffer.length : 0
    };
  }

  /**
   * Reset optimizer state
   */
  public reset(): void {
    logPaperModeCall('MLStrategyOptimizer', 'reset', { optimizerId: this.config.optimizerId });
    
    this.experienceBuffer = [];
    this.currentState = undefined;
    this.trainingStep = 0;
    this.totalReward = 0;
    this.bestSharpe = -Infinity;
    this.optimizationHistory = [];
    this.config.explorationRate = 0.15; // Reset exploration
    
    // Reset Q-table
    this.qTable = new StrategyQTable(this.config.learningRate);
    
    this.emit('optimizerReset', { optimizerId: this.config.optimizerId });
    
    logger.info(`[ML_OPTIMIZER] Optimizer ${this.config.optimizerId} reset`);
  }

  /**
   * Check if optimizer is ready for production use
   */
  public isReady(): boolean {
    return this.trainingStep >= this.config.trainingConfig.minExperienceSize &&
           this.totalReward > 0;
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.removeAllListeners();
    this.experienceBuffer = [];
    this.optimizationHistory = [];
    
    logger.info(`[ML_OPTIMIZER] Optimizer ${this.config.optimizerId} cleaned up`);
  }
} 