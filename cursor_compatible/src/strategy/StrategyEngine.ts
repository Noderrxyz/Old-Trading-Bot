/**
 * Strategy Engine - Phase 5: Strategy Engine Integration
 * 
 * Orchestrates multiple strategy runners with portfolio management, risk controls,
 * and consolidated performance tracking. Operates with zero real-world costs in
 * full simulation mode.
 */

import { EventEmitter } from 'events';
import { StrategyRunner, StrategyRunnerConfig, StrategyRunnerState } from './StrategyRunner';
import { AdaptiveStrategy } from './AdaptiveStrategy';
import { SimulatedPerformanceTracker, PerformanceMetrics } from '../metrics/SimulatedPerformanceTracker';
import { isPaperMode, logPaperModeCall } from '../config/PaperModeConfig';
import { logger } from '../utils/logger';

export interface StrategyEngineConfig {
  engineId: string;
  totalCapital: number;
  maxActiveStrategies: number;
  enableRiskManagement: boolean;
  portfolioRiskConfig?: {
    maxDrawdownPercent: number;
    maxConcurrentTrades: number;
    positionSizingMethod: 'equal' | 'kelly' | 'adaptive';
    correlationThreshold: number;
  };
  rebalanceConfig?: {
    enabled: boolean;
    intervalMinutes: number;
    minRebalanceThreshold: number;
  };
  performanceConfig?: {
    trackingEnabled: boolean;
    benchmarkSymbol: string;
    reportingIntervalMinutes: number;
  };
}

export interface StrategyAllocation {
  strategyId: string;
  allocation: number; // Percentage of total capital (0-1)
  maxAllocation: number;
  minAllocation: number;
  riskWeight: number;
  isActive: boolean;
}

export interface PortfolioMetrics {
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  activeStrategies: number;
  totalTrades: number;
  averageCorrelation: number;
  riskAdjustedReturn: number;
  startTime: number;
  lastUpdate: number;
}

export enum StrategyEngineState {
  IDLE = 'idle',
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export class StrategyEngine extends EventEmitter {
  private config: StrategyEngineConfig;
  private state: StrategyEngineState = StrategyEngineState.IDLE;
  
  // Strategy management
  private strategyRunners: Map<string, StrategyRunner> = new Map();
  private strategyAllocations: Map<string, StrategyAllocation> = new Map();
  
  // Performance tracking
  private portfolioTracker?: SimulatedPerformanceTracker;
  private strategyPerformance: Map<string, PerformanceMetrics> = new Map();
  
  // Portfolio management
  private totalCapital: number;
  private availableCapital: number;
  private allocatedCapital: number = 0;
  
  // Risk management
  private correlationMatrix: Map<string, Map<string, number>> = new Map();
  private lastRiskCheck: number = 0;
  private riskCheckIntervalMs: number = 60000; // 1 minute
  
  // Timers and intervals
  private rebalanceInterval?: NodeJS.Timeout;
  private performanceInterval?: NodeJS.Timeout;
  private riskMonitorInterval?: NodeJS.Timeout;
  
  // Statistics
  private startTime?: number;
  private lastUpdate?: number;
  private totalStrategiesStarted: number = 0;
  private totalRebalances: number = 0;

  constructor(config: StrategyEngineConfig) {
    super();
    
    // Validate paper mode
    if (!isPaperMode()) {
      throw new Error('StrategyEngine requires paper mode to be enabled');
    }
    
    this.config = {
      ...config,
      maxActiveStrategies: config.maxActiveStrategies || 10,
      enableRiskManagement: config.enableRiskManagement !== false,
      portfolioRiskConfig: {
        maxDrawdownPercent: 20,
        maxConcurrentTrades: 50,
        positionSizingMethod: 'adaptive',
        correlationThreshold: 0.7,
        ...config.portfolioRiskConfig
      },
      rebalanceConfig: {
        enabled: true,
        intervalMinutes: 60,
        minRebalanceThreshold: 0.05,
        ...config.rebalanceConfig
      },
      performanceConfig: {
        trackingEnabled: true,
        benchmarkSymbol: 'BTC/USDT',
        reportingIntervalMinutes: 15,
        ...config.performanceConfig
      }
    };
    
    this.totalCapital = config.totalCapital;
    this.availableCapital = config.totalCapital;
    
    // Initialize portfolio tracker
    if (this.config.performanceConfig?.trackingEnabled) {
      this.portfolioTracker = new SimulatedPerformanceTracker({
        initialCapital: this.totalCapital,
        trackingId: `portfolio-${config.engineId}`,
        benchmarkSymbol: this.config.performanceConfig.benchmarkSymbol
      });
    }
    
    // Set up event handlers
    this.setupEventHandlers();
    
    logger.info(`[STRATEGY_ENGINE] Initialized engine ${config.engineId}`, {
      totalCapital: this.totalCapital,
      maxActiveStrategies: this.config.maxActiveStrategies,
      paperMode: isPaperMode()
    });
  }

  /**
   * Add a strategy to the engine
   */
  public async addStrategy(
    strategy: AdaptiveStrategy,
    allocation: Partial<StrategyAllocation>,
    runnerConfig?: Partial<StrategyRunnerConfig>
  ): Promise<string> {
    logPaperModeCall('StrategyEngine', 'addStrategy', { 
      strategyId: strategy.getId(),
      allocation: allocation.allocation 
    });
    
    const strategyId = strategy.getId();
    
    if (this.strategyRunners.has(strategyId)) {
      throw new Error(`Strategy ${strategyId} already exists in engine`);
    }
    
    if (this.strategyRunners.size >= this.config.maxActiveStrategies) {
      throw new Error(`Maximum number of strategies (${this.config.maxActiveStrategies}) reached`);
    }
    
    // Create strategy allocation
    const strategyAllocation: StrategyAllocation = {
      strategyId,
      allocation: allocation.allocation || 0.1, // Default 10%
      maxAllocation: allocation.maxAllocation || 0.25, // Max 25%
      minAllocation: allocation.minAllocation || 0.05, // Min 5%
      riskWeight: allocation.riskWeight || 1.0,
      isActive: allocation.isActive !== false
    };
    
    // Calculate allocated capital
    const allocatedCapital = this.totalCapital * strategyAllocation.allocation;
    
    if (allocatedCapital > this.availableCapital) {
      throw new Error(`Insufficient capital: need ${allocatedCapital}, available ${this.availableCapital}`);
    }
    
    // Create strategy runner configuration
    const finalRunnerConfig: StrategyRunnerConfig = {
      strategyId,
      symbols: [strategy.getSymbol()],
      initialCapital: allocatedCapital,
      maxConcurrentOrders: 10,
      enablePerformanceTracking: true,
      enableMEVSimulation: true,
      ...runnerConfig
    };
    
    // Create strategy runner
    const runner = new StrategyRunner(strategy, finalRunnerConfig);
    
    // Set up runner event handlers
    this.setupRunnerEventHandlers(runner, strategyId);
    
    // Store strategy and allocation
    this.strategyRunners.set(strategyId, runner);
    this.strategyAllocations.set(strategyId, strategyAllocation);
    
    // Update capital allocation
    this.allocatedCapital += allocatedCapital;
    this.availableCapital -= allocatedCapital;
    
    this.emit('strategyAdded', { strategyId, allocation: strategyAllocation });
    
    logger.info(`[STRATEGY_ENGINE] Added strategy ${strategyId}`, {
      allocation: strategyAllocation.allocation,
      allocatedCapital,
      availableCapital: this.availableCapital
    });
    
    return strategyId;
  }

  /**
   * Remove a strategy from the engine
   */
  public async removeStrategy(strategyId: string): Promise<void> {
    logPaperModeCall('StrategyEngine', 'removeStrategy', { strategyId });
    
    const runner = this.strategyRunners.get(strategyId);
    const allocation = this.strategyAllocations.get(strategyId);
    
    if (!runner || !allocation) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    
    // Stop the runner if it's active
    if (runner.isActive()) {
      await runner.stop();
    }
    
    // Cleanup runner
    await runner.cleanup();
    
    // Calculate freed capital
    const freedCapital = this.totalCapital * allocation.allocation;
    
    // Update capital allocation
    this.allocatedCapital -= freedCapital;
    this.availableCapital += freedCapital;
    
    // Remove from maps
    this.strategyRunners.delete(strategyId);
    this.strategyAllocations.delete(strategyId);
    this.strategyPerformance.delete(strategyId);
    this.correlationMatrix.delete(strategyId);
    
    this.emit('strategyRemoved', { strategyId, freedCapital });
    
    logger.info(`[STRATEGY_ENGINE] Removed strategy ${strategyId}`, {
      freedCapital,
      availableCapital: this.availableCapital
    });
  }

  /**
   * Start the strategy engine
   */
  public async start(): Promise<void> {
    logPaperModeCall('StrategyEngine', 'start', { engineId: this.config.engineId });
    
    if (this.state !== StrategyEngineState.IDLE && this.state !== StrategyEngineState.STOPPED) {
      throw new Error(`Cannot start strategy engine in state: ${this.state}`);
    }
    
    this.setState(StrategyEngineState.STARTING);
    
    try {
      // Start all active strategies
      await this.startAllStrategies();
      
      // Start monitoring intervals
      this.startMonitoringIntervals();
      
      this.startTime = Date.now();
      this.setState(StrategyEngineState.RUNNING);
      
      this.emit('started', { engineId: this.config.engineId });
      
      logger.info(`[STRATEGY_ENGINE] Started engine ${this.config.engineId}`);
      
    } catch (error) {
      this.setState(StrategyEngineState.ERROR);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the strategy engine
   */
  public async stop(): Promise<void> {
    logPaperModeCall('StrategyEngine', 'stop', { engineId: this.config.engineId });
    
    this.setState(StrategyEngineState.STOPPING);
    
    try {
      // Stop monitoring intervals
      this.stopMonitoringIntervals();
      
      // Stop all strategies
      await this.stopAllStrategies();
      
      this.setState(StrategyEngineState.STOPPED);
      
      this.emit('stopped', { 
        engineId: this.config.engineId,
        runtime: this.startTime ? Date.now() - this.startTime : 0
      });
      
      logger.info(`[STRATEGY_ENGINE] Stopped engine ${this.config.engineId}`);
      
    } catch (error) {
      this.setState(StrategyEngineState.ERROR);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Pause the strategy engine
   */
  public async pause(): Promise<void> {
    logPaperModeCall('StrategyEngine', 'pause', { engineId: this.config.engineId });
    
    if (this.state !== StrategyEngineState.RUNNING) {
      throw new Error(`Cannot pause strategy engine in state: ${this.state}`);
    }
    
    this.setState(StrategyEngineState.PAUSED);
    
    // Pause all running strategies
    const pausePromises: Promise<void>[] = [];
    for (const runner of this.strategyRunners.values()) {
      if (runner.getState() === StrategyRunnerState.RUNNING) {
        pausePromises.push(runner.pause());
      }
    }
    
    await Promise.all(pausePromises);
    
    this.emit('paused', { engineId: this.config.engineId });
    logger.info(`[STRATEGY_ENGINE] Paused engine ${this.config.engineId}`);
  }

  /**
   * Resume the strategy engine
   */
  public async resume(): Promise<void> {
    logPaperModeCall('StrategyEngine', 'resume', { engineId: this.config.engineId });
    
    if (this.state !== StrategyEngineState.PAUSED) {
      throw new Error(`Cannot resume strategy engine in state: ${this.state}`);
    }
    
    this.setState(StrategyEngineState.RUNNING);
    
    // Resume all paused strategies
    const resumePromises: Promise<void>[] = [];
    for (const runner of this.strategyRunners.values()) {
      if (runner.getState() === StrategyRunnerState.PAUSED) {
        resumePromises.push(runner.resume());
      }
    }
    
    await Promise.all(resumePromises);
    
    this.emit('resumed', { engineId: this.config.engineId });
    logger.info(`[STRATEGY_ENGINE] Resumed engine ${this.config.engineId}`);
  }

  /**
   * Rebalance portfolio allocations
   */
  public async rebalancePortfolio(): Promise<void> {
    logPaperModeCall('StrategyEngine', 'rebalancePortfolio', { engineId: this.config.engineId });
    
    if (this.state !== StrategyEngineState.RUNNING) {
      logger.warn(`[STRATEGY_ENGINE] Cannot rebalance in state: ${this.state}`);
      return;
    }
    
    try {
      // Update performance metrics for all strategies
      this.updateAllPerformanceMetrics();
      
      // Calculate new allocations based on performance
      const newAllocations = this.calculateOptimalAllocations();
      
      // Apply rebalancing if needed
      const rebalanceNeeded = this.checkRebalanceThreshold(newAllocations);
      
      if (rebalanceNeeded) {
        await this.applyNewAllocations(newAllocations);
        this.totalRebalances++;
        
        this.emit('portfolioRebalanced', { 
          newAllocations,
          rebalanceCount: this.totalRebalances 
        });
        
        logger.info(`[STRATEGY_ENGINE] Portfolio rebalanced`, {
          rebalanceCount: this.totalRebalances,
          allocations: newAllocations
        });
      }
      
    } catch (error) {
      logger.error(`[STRATEGY_ENGINE] Error during rebalancing:`, error);
      this.emit('rebalanceError', error);
    }
  }

  /**
   * Get portfolio metrics
   */
  public getPortfolioMetrics(): PortfolioMetrics {
    this.updateAllPerformanceMetrics();
    
    let totalValue = 0;
    let totalPnl = 0;
    let totalTrades = 0;
    let activeStrategies = 0;
    let winningTrades = 0;
    let correlationSum = 0;
    let correlationCount = 0;
    
    // Aggregate metrics from all strategies
    for (const [strategyId, runner] of this.strategyRunners) {
      const stats = runner.getStatistics();
      const performance = runner.getPerformanceMetrics();
      
      if (performance) {
        totalValue += performance.totalValue;
        totalPnl += performance.totalPnl;
        totalTrades += performance.totalTrades;
        winningTrades += performance.winningTrades;
      }
      
      if (runner.isActive()) {
        activeStrategies++;
      }
    }
    
    // Calculate correlations
    const strategies = Array.from(this.strategyRunners.keys());
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const correlation = this.getStrategyCorrelation(strategies[i], strategies[j]);
        correlationSum += Math.abs(correlation);
        correlationCount++;
      }
    }
    
    const totalPnlPercent = this.totalCapital > 0 ? (totalPnl / this.totalCapital) * 100 : 0;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const averageCorrelation = correlationCount > 0 ? correlationSum / correlationCount : 0;
    
    // Get portfolio-level metrics
    const portfolioMetrics = this.portfolioTracker?.getMetrics();
    
    return {
      totalValue,
      totalPnl,
      totalPnlPercent,
      sharpeRatio: portfolioMetrics?.sharpeRatio || 0,
      maxDrawdown: portfolioMetrics?.maxDrawdown || 0,
      winRate,
      activeStrategies,
      totalTrades,
      averageCorrelation,
      riskAdjustedReturn: portfolioMetrics?.sortinoRatio || 0,
      startTime: this.startTime || Date.now(),
      lastUpdate: Date.now()
    };
  }

  /**
   * Get strategy statistics
   */
  public getStrategyStatistics(): Map<string, any> {
    const stats = new Map();
    
    for (const [strategyId, runner] of this.strategyRunners) {
      stats.set(strategyId, {
        ...runner.getStatistics(),
        allocation: this.strategyAllocations.get(strategyId),
        performance: runner.getPerformanceMetrics()
      });
    }
    
    return stats;
  }

  /**
   * Get engine state
   */
  public getState(): StrategyEngineState {
    return this.state;
  }

  /**
   * Check if engine is active
   */
  public isActive(): boolean {
    return this.state === StrategyEngineState.RUNNING;
  }

  // Private methods

  private setState(newState: StrategyEngineState): void {
    const oldState = this.state;
    this.state = newState;
    
    this.emit('stateChanged', {
      engineId: this.config.engineId,
      oldState,
      newState
    });
  }

  private setupEventHandlers(): void {
    this.on('error', (error) => {
      logger.error(`[STRATEGY_ENGINE] Error in engine ${this.config.engineId}:`, error);
    });
  }

  private setupRunnerEventHandlers(runner: StrategyRunner, strategyId: string): void {
    runner.on('error', (error) => {
      logger.error(`[STRATEGY_ENGINE] Error in strategy ${strategyId}:`, error);
      this.emit('strategyError', { strategyId, error });
    });
    
    runner.on('signalExecuted', (data) => {
      this.emit('strategySignalExecuted', { strategyId, ...data });
    });
    
    runner.on('orderFilled', (data) => {
      this.emit('strategyOrderFilled', { strategyId, ...data });
      
      // Update portfolio tracker
      if (this.portfolioTracker && data.orderStatus.executedPrice && data.orderStatus.executedAmount) {
        this.portfolioTracker.recordTrade({
          symbol: data.signal.symbol,
          side: data.signal.direction,
          amount: data.orderStatus.executedAmount,
          price: data.orderStatus.executedPrice,
          fees: data.orderStatus.fees || 0,
          timestamp: Date.now()
        });
      }
    });
  }

  private async startAllStrategies(): Promise<void> {
    const startPromises: Promise<void>[] = [];
    
    for (const [strategyId, runner] of this.strategyRunners) {
      const allocation = this.strategyAllocations.get(strategyId);
      if (allocation?.isActive) {
        startPromises.push(runner.start());
        this.totalStrategiesStarted++;
      }
    }
    
    await Promise.all(startPromises);
  }

  private async stopAllStrategies(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    
    for (const runner of this.strategyRunners.values()) {
      if (runner.isActive()) {
        stopPromises.push(runner.stop());
      }
    }
    
    await Promise.all(stopPromises);
  }

  private startMonitoringIntervals(): void {
    // Rebalancing interval
    if (this.config.rebalanceConfig?.enabled) {
      const intervalMs = this.config.rebalanceConfig.intervalMinutes * 60 * 1000;
      this.rebalanceInterval = setInterval(() => {
        this.rebalancePortfolio().catch(error => {
          logger.error(`[STRATEGY_ENGINE] Rebalance error:`, error);
        });
      }, intervalMs);
    }
    
    // Performance reporting interval
    if (this.config.performanceConfig?.trackingEnabled) {
      const intervalMs = this.config.performanceConfig.reportingIntervalMinutes * 60 * 1000;
      this.performanceInterval = setInterval(() => {
        const metrics = this.getPortfolioMetrics();
        this.emit('performanceUpdate', metrics);
      }, intervalMs);
    }
    
    // Risk monitoring interval
    if (this.config.enableRiskManagement) {
      this.riskMonitorInterval = setInterval(() => {
        this.performRiskCheck().catch(error => {
          logger.error(`[STRATEGY_ENGINE] Risk check error:`, error);
        });
      }, this.riskCheckIntervalMs);
    }
  }

  private stopMonitoringIntervals(): void {
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = undefined;
    }
    
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
      this.performanceInterval = undefined;
    }
    
    if (this.riskMonitorInterval) {
      clearInterval(this.riskMonitorInterval);
      this.riskMonitorInterval = undefined;
    }
  }

  private updateAllPerformanceMetrics(): void {
    for (const [strategyId, runner] of this.strategyRunners) {
      const metrics = runner.getPerformanceMetrics();
      if (metrics) {
        this.strategyPerformance.set(strategyId, metrics);
      }
    }
    
    this.lastUpdate = Date.now();
  }

  private calculateOptimalAllocations(): Map<string, number> {
    const newAllocations = new Map<string, number>();
    
    // Simple performance-based reallocation
    let totalPerformanceScore = 0;
    const performanceScores = new Map<string, number>();
    
    for (const [strategyId, metrics] of this.strategyPerformance) {
      // Calculate performance score (Sharpe ratio * return with drawdown penalty)
      const returnScore = Math.max(0, metrics.totalPnlPercent);
      const sharpeScore = Math.max(0, metrics.sharpeRatio);
      const drawdownPenalty = Math.max(0, 1 - (metrics.maxDrawdownPercent / 100));
      
      const score = (returnScore * 0.4 + sharpeScore * 0.4 + drawdownPenalty * 0.2);
      performanceScores.set(strategyId, score);
      totalPerformanceScore += score;
    }
    
    // Allocate based on performance scores
    if (totalPerformanceScore > 0) {
      for (const [strategyId, score] of performanceScores) {
        const allocation = this.strategyAllocations.get(strategyId);
        if (allocation) {
          const newAllocation = Math.min(
            allocation.maxAllocation,
            Math.max(allocation.minAllocation, score / totalPerformanceScore)
          );
          newAllocations.set(strategyId, newAllocation);
        }
      }
    } else {
      // Equal allocation if no performance data
      const equalAllocation = 1 / this.strategyRunners.size;
      for (const strategyId of this.strategyRunners.keys()) {
        newAllocations.set(strategyId, equalAllocation);
      }
    }
    
    return newAllocations;
  }

  private checkRebalanceThreshold(newAllocations: Map<string, number>): boolean {
    const threshold = this.config.rebalanceConfig?.minRebalanceThreshold || 0.05;
    
    for (const [strategyId, newAllocation] of newAllocations) {
      const currentAllocation = this.strategyAllocations.get(strategyId)?.allocation || 0;
      const difference = Math.abs(newAllocation - currentAllocation);
      
      if (difference > threshold) {
        return true;
      }
    }
    
    return false;
  }

  private async applyNewAllocations(newAllocations: Map<string, number>): Promise<void> {
    // For now, just update the allocation records
    // In a full implementation, this would involve stopping/starting strategies
    // with new capital allocations
    
    for (const [strategyId, newAllocation] of newAllocations) {
      const allocation = this.strategyAllocations.get(strategyId);
      if (allocation) {
        allocation.allocation = newAllocation;
      }
    }
  }

  private async performRiskCheck(): Promise<void> {
    const now = Date.now();
    
    if ((now - this.lastRiskCheck) < this.riskCheckIntervalMs) {
      return;
    }
    
    this.lastRiskCheck = now;
    
    // Check portfolio drawdown
    const portfolioMetrics = this.getPortfolioMetrics();
    const maxDrawdownThreshold = this.config.portfolioRiskConfig?.maxDrawdownPercent || 20;
    
    if (portfolioMetrics.maxDrawdown > maxDrawdownThreshold) {
      logger.warn(`[STRATEGY_ENGINE] Portfolio drawdown ${portfolioMetrics.maxDrawdown}% exceeds threshold ${maxDrawdownThreshold}%`);
      this.emit('riskAlert', {
        type: 'drawdown',
        value: portfolioMetrics.maxDrawdown,
        threshold: maxDrawdownThreshold
      });
    }
    
    // Check correlation limits
    const correlationThreshold = this.config.portfolioRiskConfig?.correlationThreshold || 0.7;
    if (portfolioMetrics.averageCorrelation > correlationThreshold) {
      logger.warn(`[STRATEGY_ENGINE] Average correlation ${portfolioMetrics.averageCorrelation} exceeds threshold ${correlationThreshold}`);
      this.emit('riskAlert', {
        type: 'correlation',
        value: portfolioMetrics.averageCorrelation,
        threshold: correlationThreshold
      });
    }
  }

  private getStrategyCorrelation(strategyId1: string, strategyId2: string): number {
    // Simplified correlation calculation
    // In a full implementation, this would calculate returns correlation
    const corr1 = this.correlationMatrix.get(strategyId1);
    if (corr1?.has(strategyId2)) {
      return corr1.get(strategyId2) || 0;
    }
    
    // Default to low correlation if not calculated
    return 0.1;
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    if (this.state === StrategyEngineState.RUNNING || this.state === StrategyEngineState.PAUSED) {
      await this.stop();
    }
    
    // Cleanup all strategy runners
    const cleanupPromises: Promise<void>[] = [];
    for (const runner of this.strategyRunners.values()) {
      cleanupPromises.push(runner.cleanup());
    }
    
    await Promise.all(cleanupPromises);
    
    this.removeAllListeners();
    
    logger.info(`[STRATEGY_ENGINE] Cleaned up engine ${this.config.engineId}`);
  }
} 