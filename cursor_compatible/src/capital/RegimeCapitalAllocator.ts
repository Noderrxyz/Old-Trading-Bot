import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { RegimeClassifier, MarketRegime } from '../regime/RegimeClassifier';
import { AlphaMemory } from '../memory/AlphaMemory';
import { BiasEngine } from '../evolution/BiasEngine';
import { StrategyPortfolioOptimizer } from '../optimizer/StrategyPortfolioOptimizer';

/**
 * Interface for allocation results
 */
export interface AllocationResult {
  strategyId: string;
  previousAllocation: number;
  newAllocation: number;
  regimeAlignment: number;
  confidence: number;
  timestamp: number;
}

/**
 * Configuration for the regime capital allocator
 */
export interface RegimeCapitalAllocatorConfig {
  /**
   * Total capital to allocate
   */
  totalCapital: number;
  
  /**
   * Base currency for capital allocation
   */
  baseCurrency: string;
  
  /**
   * Minimum allocation per strategy (percentage)
   */
  minAllocationPercentage: number;
  
  /**
   * Maximum allocation per strategy (percentage)
   */
  maxAllocationPercentage: number;
  
  /**
   * Maximum percentage to reallocate in a single cycle
   */
  maxReallocationPercentage: number;
  
  /**
   * Reallocation threshold to trigger capital shift (percentage)
   */
  reallocationThresholdPercentage: number;
  
  /**
   * Time interval between reallocation checks (ms)
   */
  reallocationIntervalMs: number;
  
  /**
   * Weight for regime alignment in allocation decisions
   */
  regimeAlignmentWeight: number;
  
  /**
   * Weight for portfolio optimizer recommendations
   */
  portfolioOptimizerWeight: number;
  
  /**
   * Weight for recent performance in allocation decisions
   */
  recentPerformanceWeight: number;
  
  /**
   * Weight for volatility in allocation decisions
   */
  volatilityWeight: number;
  
  /**
   * Weight for drawdown in allocation decisions
   */
  drawdownWeight: number;
  
  /**
   * Capital reserve percentage (not allocated)
   */
  reservePercentage: number;
  
  /**
   * Emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RegimeCapitalAllocatorConfig = {
  totalCapital: 100000, // $100,000 USD
  baseCurrency: 'USD',
  minAllocationPercentage: 1, // 1%
  maxAllocationPercentage: 20, // 20%
  maxReallocationPercentage: 10, // 10%
  reallocationThresholdPercentage: 5, // 5%
  reallocationIntervalMs: 3600000, // 1 hour
  regimeAlignmentWeight: 0.35,
  portfolioOptimizerWeight: 0.30,
  recentPerformanceWeight: 0.15,
  volatilityWeight: 0.10,
  drawdownWeight: 0.10,
  reservePercentage: 5, // 5%
  emitDetailedTelemetry: true
};

/**
 * Strategy historical performance record
 */
interface StrategyPerformanceRecord {
  strategyId: string;
  currentAllocation: number;
  previousAllocation: number;
  lastUpdated: number;
  regimeAlignmentScore: number;
  performance: {
    [regime in MarketRegime]?: {
      sharpeRatio: number;
      winRate: number;
      profit: number;
      sampleSize: number;
    }
  };
}

/**
 * Regime allocation profile
 */
interface RegimeAllocationProfile {
  regime: MarketRegime;
  startTimestamp: number;
  endTimestamp: number | null;
  totalAllocation: number;
  strategyCount: number;
  topStrategies: {
    strategyId: string;
    allocation: number;
    alignmentScore: number;
  }[];
}

/**
 * Strategy allocation data
 */
export interface StrategyAllocation {
  /**
   * Strategy ID
   */
  strategyId: string;
  
  /**
   * Allocated capital amount
   */
  amount: number;
  
  /**
   * Allocation percentage
   */
  percentage: number;
  
  /**
   * Score that determined allocation
   */
  allocationScore: number;
  
  /**
   * Regime alignment score
   */
  regimeScore: number;
  
  /**
   * Recent performance score
   */
  performanceScore: number;
  
  /**
   * Portfolio optimizer recommended weight
   */
  optimizerWeight: number;
}

/**
 * Allocation snapshot
 */
export interface AllocationSnapshot {
  /**
   * Timestamp of allocation
   */
  timestamp: number;
  
  /**
   * Total capital being allocated
   */
  totalCapital: number;
  
  /**
   * Current market regime
   */
  currentRegime: string;
  
  /**
   * Regime confidence
   */
  regimeConfidence: number;
  
  /**
   * Strategy allocations
   */
  allocations: StrategyAllocation[];
  
  /**
   * Reserve capital amount
   */
  reserveAmount: number;
  
  /**
   * Reserve capital percentage
   */
  reservePercentage: number;
}

/**
 * Class for regime-aware capital allocation
 */
export class RegimeCapitalAllocator {
  private static instance: RegimeCapitalAllocator | null = null;
  private config: RegimeCapitalAllocatorConfig;
  private telemetry: TelemetryBus;
  private alphaMemory: AlphaMemory;
  private biasEngine: BiasEngine;
  private regimeClassifier: RegimeClassifier;
  private portfolioOptimizer: StrategyPortfolioOptimizer;
  
  private currentAllocations: Map<string, number> = new Map();
  private historicalAllocations: AllocationResult[] = [];
  private reallocationTimer: NodeJS.Timeout | null = null;
  private regimeProfiles: RegimeAllocationProfile[] = [];
  private strategyPerformance: Map<string, StrategyPerformanceRecord> = new Map();
  private lastRegime: MarketRegime | null = null;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private latestAllocation: AllocationSnapshot | null = null;
  private lastReallocationTime: number = 0;
  private regimeChangeListeners: ((regime: MarketRegime) => void)[] = [];
  private currentRegime: MarketRegime | null = null;
  
  /**
   * Private constructor
   */
  private constructor(
    config: Partial<RegimeCapitalAllocatorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetry = TelemetryBus.getInstance();
    this.alphaMemory = AlphaMemory.getInstance();
    this.biasEngine = BiasEngine.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.portfolioOptimizer = StrategyPortfolioOptimizer.getInstance();
    
    logger.info('Regime Capital Allocator initialized', { config: this.config });
    
    this.telemetry.emit('allocator_initialized', {
      config: this.config,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<RegimeCapitalAllocatorConfig> = {}): RegimeCapitalAllocator {
    if (!RegimeCapitalAllocator.instance) {
      RegimeCapitalAllocator.instance = new RegimeCapitalAllocator(config);
    }
    return RegimeCapitalAllocator.instance;
  }
  
  /**
   * Get config
   */
  public getConfig(): RegimeCapitalAllocatorConfig {
    return this.config;
  }
  
  /**
   * Start automatic reallocation cycles
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('RegimeCapitalAllocator is already running');
      return;
    }
    
    // Run initial allocation
    this.reallocate();
    
    // Set up interval for periodic reallocation
    this.intervalId = setInterval(() => this.reallocate(), this.config.reallocationIntervalMs);
    
    this.isRunning = true;
    logger.info(`RegimeCapitalAllocator started with interval ${this.config.reallocationIntervalMs}ms`);
  }
  
  /**
   * Stop automatic reallocation cycles
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('RegimeCapitalAllocator is not running');
      return;
    }
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    logger.info('RegimeCapitalAllocator stopped');
  }
  
  /**
   * Get the latest allocation
   */
  public getLatestAllocation(): AllocationSnapshot | null {
    return this.latestAllocation;
  }
  
  /**
   * Reallocate capital based on current regime and performance
   */
  public reallocate(): AllocationSnapshot {
    const startTime = Date.now();
    
    try {
      // Emit start telemetry
      this.telemetry.emit('allocator:reallocation:started', {
        timestamp: startTime,
        configParams: this.config
      });
      
      // Get current regime
      const currentRegime = this.regimeClassifier.getCurrentRegime("DEFAULT");
      
      // Get portfolio optimizer recommendation
      const optimizerResult = this.portfolioOptimizer.getLatestOptimizationResult();
      
      // Get strategies and their allocations
      const strategies = this.getStrategiesToAllocate();
      
      if (strategies.length === 0) {
        logger.warn('No strategies available for allocation');
        
        // Create empty allocation snapshot
        const emptyAllocation: AllocationSnapshot = {
          timestamp: Date.now(),
          totalCapital: this.config.totalCapital,
          currentRegime: currentRegime.primaryRegime,
          regimeConfidence: currentRegime.confidence,
          allocations: [],
          reserveAmount: this.config.totalCapital,
          reservePercentage: 100
        };
        
        this.latestAllocation = emptyAllocation;
        
        // Emit telemetry
        this.telemetry.emit('allocator:reallocation:completed', {
          timestamp: Date.now(),
          durationMs: Date.now() - startTime,
          strategiesCount: 0,
          regime: currentRegime.primaryRegime,
          allocation: emptyAllocation
        });
        
        return emptyAllocation;
      }
      
      // Calculate allocation scores
      const scores = this.calculateAllocationScores(
        strategies, 
        currentRegime, 
        optimizerResult
      );
      
      // Normalize scores to get allocation percentages
      const totalScore = scores.reduce((sum, score) => sum + score, 0);
      const rawPercentages = scores.map(score => totalScore > 0 ? (score / totalScore) * 100 : 0);
      
      // Apply min/max constraints
      const constrainedPercentages = this.applyAllocationConstraints(rawPercentages);
      
      // Apply reserve percentage
      const reservePercentage = this.config.reservePercentage;
      const reserveAmount = this.config.totalCapital * (reservePercentage / 100);
      const allocatableCapital = this.config.totalCapital - reserveAmount;
      
      // Build allocation result
      const allocations: StrategyAllocation[] = strategies.map((strategy, index) => {
        const amount = (constrainedPercentages[index] / 100) * allocatableCapital;
        const percentage = constrainedPercentages[index] * (1 - reservePercentage / 100);
        const optimizerWeight = optimizerResult?.weights.find(
          w => w.strategyId === strategy.id
        )?.weight || 0;
        
        return {
          strategyId: strategy.id,
          amount,
          percentage,
          allocationScore: scores[index],
          regimeScore: this.biasEngine.calculateBiasScore(strategy, currentRegime.primaryRegime),
          performanceScore: strategy.metrics.profitFactor || 0,
          optimizerWeight
        };
      });
      
      // Create allocation snapshot
      const allocationSnapshot: AllocationSnapshot = {
        timestamp: Date.now(),
        totalCapital: this.config.totalCapital,
        currentRegime: currentRegime.primaryRegime,
        regimeConfidence: currentRegime.confidence,
        allocations,
        reserveAmount,
        reservePercentage
      };
      
      // If we have previous allocation, apply reallocation constraints
      if (this.latestAllocation) {
        this.applyReallocationConstraints(allocationSnapshot, this.latestAllocation);
      }
      
      // Store as latest allocation
      this.latestAllocation = allocationSnapshot;
      this.lastReallocationTime = Date.now();
      
      // Emit telemetry
      const elapsedTimeMs = Date.now() - startTime;
      this.telemetry.emit('allocator:reallocation:completed', {
        timestamp: Date.now(),
        durationMs: elapsedTimeMs,
        strategiesCount: strategies.length,
        regime: currentRegime.primaryRegime,
        allocation: allocationSnapshot
      });
      
      // Log metrics
      this.telemetry.emit('allocator.reallocation_time_ms', elapsedTimeMs);
      this.telemetry.emit('allocator.strategy_count', strategies.length);
      this.telemetry.emit('allocator.reserve_percentage', reservePercentage);
      
      return allocationSnapshot;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in capital reallocation: ${errorMessage}`, error);
      
      // Emit error telemetry
      this.telemetry.emit('allocator:reallocation:error', {
        message: errorMessage,
        timestamp: Date.now(),
        elapsedTimeMs: Date.now() - startTime
      });
      
      // Return previous allocation if available
      if (this.latestAllocation) {
        return this.latestAllocation;
      }
      
      // Create empty allocation snapshot
      const currentRegime = this.regimeClassifier.getCurrentRegime("DEFAULT");
      const failedAllocation: AllocationSnapshot = {
        timestamp: Date.now(),
        totalCapital: this.config.totalCapital,
        currentRegime: currentRegime.primaryRegime,
        regimeConfidence: currentRegime.confidence,
        allocations: [],
        reserveAmount: this.config.totalCapital,
        reservePercentage: 100
      };
      
      this.latestAllocation = failedAllocation;
      return failedAllocation;
    }
  }
  
  /**
   * Get strategies that should receive capital allocation
   */
  private getStrategiesToAllocate(): StrategyGenome[] {
    // In a real implementation, this would fetch strategies from a repository
    // For this example, we'll use the optimizer's strategies
    const optimizerResult = this.portfolioOptimizer.getLatestOptimizationResult();
    
    if (!optimizerResult || optimizerResult.weights.length === 0) {
      logger.warn('No optimizer result available for capital allocation');
      return [];
    }
    
    // TODO: Fetch actual strategy genomes by IDs
    // For now, we'll create placeholder strategy objects
    return optimizerResult.weights.map(weight => {
      return new StrategyGenome(weight.strategyId);
    });
  }
  
  /**
   * Calculate allocation scores based on multiple factors
   */
  private calculateAllocationScores(
    strategies: StrategyGenome[],
    currentRegime: { primaryRegime: string, confidence: number },
    optimizerResult: any
  ): number[] {
    return strategies.map(strategy => {
      // Get regime bias score
      const regimeScore = this.biasEngine.calculateBiasScore(strategy, currentRegime.primaryRegime);
      
      // Get recent performance score
      const performanceScore = strategy.metrics.profitFactor || 0;
      
      // Get volatility and drawdown scores
      // Lower values are better, so we invert them
      const volatilityScore = 1 - (strategy.metrics.volatility || 0);
      const drawdownScore = 1 - (strategy.metrics.maxDrawdown || 0);
      
      // Get optimizer recommendation weight
      const optimizerWeight = optimizerResult?.weights.find(
        w => w.strategyId === strategy.id
      )?.weight || 0;
      
      // Calculate combined score
      const score = 
        regimeScore * this.config.regimeAlignmentWeight +
        performanceScore * this.config.recentPerformanceWeight +
        volatilityScore * this.config.volatilityWeight +
        drawdownScore * this.config.drawdownWeight +
        optimizerWeight * this.config.portfolioOptimizerWeight;
      
      // Ensure score is positive
      return Math.max(0.001, score);
    });
  }
  
  /**
   * Apply min/max allocation constraints
   */
  private applyAllocationConstraints(percentages: number[]): number[] {
    const result = [...percentages];
    const n = result.length;
    
    // Apply minimum constraint
    let remainingPercentage = 100;
    let totalMinimumAllocated = 0;
    
    for (let i = 0; i < n; i++) {
      if (result[i] < this.config.minAllocationPercentage) {
        result[i] = this.config.minAllocationPercentage;
      }
      
      totalMinimumAllocated += result[i];
    }
    
    // If we've allocated too much, scale back proportionally
    if (totalMinimumAllocated > 100) {
      const scaleFactor = 100 / totalMinimumAllocated;
      for (let i = 0; i < n; i++) {
        result[i] *= scaleFactor;
      }
    }
    
    // Apply maximum constraint
    let excessAllocation = 0;
    
    for (let i = 0; i < n; i++) {
      if (result[i] > this.config.maxAllocationPercentage) {
        excessAllocation += result[i] - this.config.maxAllocationPercentage;
        result[i] = this.config.maxAllocationPercentage;
      }
    }
    
    // Redistribute excess proportionally to strategies below max
    if (excessAllocation > 0) {
      const strategiesBelowMax = result.filter(p => p < this.config.maxAllocationPercentage);
      const totalBelowMax = strategiesBelowMax.reduce((sum, p) => sum + p, 0);
      
      if (totalBelowMax > 0) {
        for (let i = 0; i < n; i++) {
          if (result[i] < this.config.maxAllocationPercentage) {
            const proportion = result[i] / totalBelowMax;
            result[i] += excessAllocation * proportion;
            
            // Ensure we don't exceed max
            result[i] = Math.min(result[i], this.config.maxAllocationPercentage);
          }
        }
      }
    }
    
    // Ensure allocations sum to 100%
    const totalAllocation = result.reduce((sum, p) => sum + p, 0);
    
    if (Math.abs(totalAllocation - 100) > 0.01) {
      // Scale to 100%
      const scaleFactor = 100 / totalAllocation;
      for (let i = 0; i < n; i++) {
        result[i] *= scaleFactor;
      }
    }
    
    return result;
  }
  
  /**
   * Apply reallocation constraints based on previous allocation
   */
  private applyReallocationConstraints(
    newAllocation: AllocationSnapshot,
    previousAllocation: AllocationSnapshot
  ): void {
    // Map previous allocations for quick lookup
    const previousMap = new Map<string, StrategyAllocation>();
    for (const allocation of previousAllocation.allocations) {
      previousMap.set(allocation.strategyId, allocation);
    }
    
    // Check each new allocation against previous
    for (const allocation of newAllocation.allocations) {
      const previous = previousMap.get(allocation.strategyId);
      
      if (previous) {
        const percentageDiff = Math.abs(allocation.percentage - previous.percentage);
        
        // If change exceeds threshold but is within max reallocation
        if (percentageDiff > this.config.reallocationThresholdPercentage) {
          // Limit change to max reallocation
          if (percentageDiff > this.config.maxReallocationPercentage) {
            const direction = allocation.percentage > previous.percentage ? 1 : -1;
            const newPercentage = previous.percentage + (direction * this.config.maxReallocationPercentage);
            
            // Update amount as well
            const newAmount = newPercentage * this.config.totalCapital / 100;
            
            // Log the constraint application
            logger.info(`Limiting reallocation for strategy ${allocation.strategyId}: ` +
                       `${previous.percentage.toFixed(2)}% to ${newPercentage.toFixed(2)}% ` +
                       `(wanted: ${allocation.percentage.toFixed(2)}%)`);
            
            // Update the allocation
            allocation.percentage = newPercentage;
            allocation.amount = newAmount;
          }
        }
      }
    }
    
    // Re-normalize after applying constraints
    this.normalizeAllocations(newAllocation);
  }
  
  /**
   * Normalize allocations to ensure they sum correctly
   */
  private normalizeAllocations(allocation: AllocationSnapshot): void {
    const totalPercentage = allocation.allocations.reduce(
      (sum, alloc) => sum + alloc.percentage, 
      0
    );
    
    // If significantly different from expected, normalize
    if (Math.abs(totalPercentage - (100 - allocation.reservePercentage)) > 0.1) {
      const targetTotal = 100 - allocation.reservePercentage;
      const normalizationFactor = targetTotal / totalPercentage;
      
      // Adjust all allocations
      for (const alloc of allocation.allocations) {
        alloc.percentage *= normalizationFactor;
        alloc.amount = (alloc.percentage / 100) * allocation.totalCapital;
      }
      
      logger.debug(`Normalized allocations from ${totalPercentage.toFixed(2)}% to ${targetTotal.toFixed(2)}%`);
    }
  }
  
  /**
   * Handle regime change
   */
  private handleRegimeChange(newRegime: MarketRegime): void {
    this.currentRegime = newRegime;
    
    // Notify any listeners
    for (const listener of this.regimeChangeListeners) {
      listener(newRegime);
    }
    
    // Trigger a reallocation after regime change
    this.reallocate();
  }

  /**
   * Register for regime change notifications
   */
  public onRegimeChange(listener: (regime: MarketRegime) => void): void {
    this.regimeChangeListeners.push(listener);
  }
} 