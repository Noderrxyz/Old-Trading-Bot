import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyMutationEngine } from '../evolution/StrategyMutationEngine';
import { StrategyPortfolioOptimizer } from '../optimizer/StrategyPortfolioOptimizer';
import { RegimeCapitalAllocator } from '../capital/RegimeCapitalAllocator';
import { RegimeClassifier, MarketRegime } from '../regime/RegimeClassifier';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { AlphaMemory } from '../memory/AlphaMemory';

/**
 * Configuration for the Adaptive Intelligence System
 */
export interface AdaptiveIntelligenceSystemConfig {
  /**
   * Initial capital to allocate
   */
  initialCapital: number;
  
  /**
   * Enable mutation engine
   */
  enableMutation: boolean;
  
  /**
   * Enable portfolio optimization
   */
  enableOptimization: boolean;
  
  /**
   * Enable capital allocation
   */
  enableAllocation: boolean;
  
  /**
   * Mutation cycle interval in milliseconds
   */
  mutationIntervalMs: number;
  
  /**
   * Optimization cycle interval in milliseconds
   */
  optimizationIntervalMs: number;
  
  /**
   * Allocation cycle interval in milliseconds
   */
  allocationIntervalMs: number;
  
  /**
   * Enable detailed telemetry
   */
  emitDetailedTelemetry: boolean;
  
  /**
   * Maximum parallel strategies to maintain
   */
  maxStrategiesInPool: number;
  
  /**
   * Minimum strategies required to run the system
   */
  minStrategiesRequired: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AdaptiveIntelligenceSystemConfig = {
  initialCapital: 100000,
  enableMutation: true,
  enableOptimization: true,
  enableAllocation: true,
  mutationIntervalMs: 3600000, // 1 hour
  optimizationIntervalMs: 3600000, // 1 hour
  allocationIntervalMs: 3600000, // 1 hour
  emitDetailedTelemetry: true,
  maxStrategiesInPool: 50,
  minStrategiesRequired: 3
};

/**
 * System status information
 */
export interface SystemStatusInfo {
  isRunning: boolean;
  components: {
    mutation: boolean;
    optimization: boolean;
    allocation: boolean;
  };
  stats: {
    strategiesCount: number;
    currentRegime: string;
    regimeConfidence: number;
    totalCapitalAllocated: number;
    reserveAmount: number;
    topStrategies: {
      id: string;
      allocation: number;
      regimeScore: number;
    }[];
  };
  lastUpdate: number;
}

/**
 * Integration class that manages the Adaptive Intelligence System
 * as a complete feedback loop
 */
export class AdaptiveIntelligenceSystem {
  private static instance: AdaptiveIntelligenceSystem | null = null;
  private config: AdaptiveIntelligenceSystemConfig;
  private mutationEngine: StrategyMutationEngine;
  private portfolioOptimizer: StrategyPortfolioOptimizer;
  private capitalAllocator: RegimeCapitalAllocator;
  private regimeClassifier: RegimeClassifier;
  private telemetry: TelemetryBus;
  private alphaMemory: AlphaMemory;
  
  private isRunning: boolean = false;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private regimeChangeHandler: ((regime: MarketRegime) => void) | null = null;
  
  /**
   * Private constructor for singleton
   */
  private constructor(config: Partial<AdaptiveIntelligenceSystemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Get component instances
    this.mutationEngine = StrategyMutationEngine.getInstance({
      mutationIntervalMs: this.config.mutationIntervalMs,
      maxStrategiesInPool: this.config.maxStrategiesInPool,
      emitDetailedTelemetry: this.config.emitDetailedTelemetry
    });
    
    this.portfolioOptimizer = StrategyPortfolioOptimizer.getInstance({
      optimizationIntervalMs: this.config.optimizationIntervalMs,
      minStrategies: this.config.minStrategiesRequired,
      maxStrategiesInPortfolio: this.config.maxStrategiesInPool,
      emitDetailedTelemetry: this.config.emitDetailedTelemetry
    });
    
    this.capitalAllocator = RegimeCapitalAllocator.getInstance({
      totalCapital: this.config.initialCapital,
      reallocationIntervalMs: this.config.allocationIntervalMs,
      emitDetailedTelemetry: this.config.emitDetailedTelemetry
    });
    
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.telemetry = TelemetryBus.getInstance();
    this.alphaMemory = AlphaMemory.getInstance();
    
    // Set up regime change handler
    this.setupRegimeChangeHandler();
    
    logger.info('Adaptive Intelligence System initialized', {
      config: this.config
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<AdaptiveIntelligenceSystemConfig> = {}): AdaptiveIntelligenceSystem {
    if (!AdaptiveIntelligenceSystem.instance) {
      AdaptiveIntelligenceSystem.instance = new AdaptiveIntelligenceSystem(config);
    }
    return AdaptiveIntelligenceSystem.instance;
  }
  
  /**
   * Start the adaptive intelligence system
   */
  public async start(): Promise<boolean> {
    if (this.isRunning) {
      logger.warn('Adaptive Intelligence System is already running');
      return true;
    }
    
    try {
      // Check if we have enough initial strategies
      const strategies = await this.getActiveStrategies();
      
      if (strategies.length < this.config.minStrategiesRequired) {
        logger.error(`Not enough active strategies to start the system. Required: ${this.config.minStrategiesRequired}, Found: ${strategies.length}`);
        
        this.telemetry.emit('adaptive_system.start_failed', {
          reason: 'insufficient_strategies',
          required: this.config.minStrategiesRequired,
          available: strategies.length,
          timestamp: Date.now()
        });
        
        return false;
      }
      
      // Start components in sequence
      if (this.config.enableMutation) {
        this.mutationEngine.start();
        logger.info('Strategy Mutation Engine started');
      }
      
      if (this.config.enableOptimization) {
        this.portfolioOptimizer.start();
        logger.info('Strategy Portfolio Optimizer started');
      }
      
      if (this.config.enableAllocation) {
        this.capitalAllocator.start();
        logger.info('Regime Capital Allocator started');
      }
      
      // Start status check interval
      this.statusCheckInterval = setInterval(() => this.checkSystemStatus(), 60000);
      
      this.isRunning = true;
      
      // Emit telemetry
      this.telemetry.emit('adaptive_system.started', {
        components: {
          mutation: this.config.enableMutation,
          optimization: this.config.enableOptimization,
          allocation: this.config.enableAllocation
        },
        strategiesCount: strategies.length,
        timestamp: Date.now()
      });
      
      logger.info('Adaptive Intelligence System started successfully');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error starting Adaptive Intelligence System: ${errorMessage}`, error);
      
      this.telemetry.emit('adaptive_system.start_failed', {
        reason: 'error',
        message: errorMessage,
        timestamp: Date.now()
      });
      
      return false;
    }
  }
  
  /**
   * Stop the adaptive intelligence system
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Adaptive Intelligence System is not running');
      return;
    }
    
    // Stop components in reverse sequence
    if (this.config.enableAllocation) {
      this.capitalAllocator.stop();
      logger.info('Regime Capital Allocator stopped');
    }
    
    if (this.config.enableOptimization) {
      this.portfolioOptimizer.stop();
      logger.info('Strategy Portfolio Optimizer stopped');
    }
    
    if (this.config.enableMutation) {
      this.mutationEngine.stop();
      logger.info('Strategy Mutation Engine stopped');
    }
    
    // Stop status check interval
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
    
    this.isRunning = false;
    
    // Emit telemetry
    this.telemetry.emit('adaptive_system.stopped', {
      timestamp: Date.now()
    });
    
    logger.info('Adaptive Intelligence System stopped');
  }
  
  /**
   * Get system status information
   */
  public getSystemStatus(): SystemStatusInfo {
    // Get latest allocation
    const allocation = this.capitalAllocator.getLatestAllocation();
    
    // Get current regime
    const currentRegime = this.regimeClassifier.getCurrentRegime("DEFAULT");
    
    // Create status info
    const statusInfo: SystemStatusInfo = {
      isRunning: this.isRunning,
      components: {
        mutation: this.config.enableMutation,
        optimization: this.config.enableOptimization,
        allocation: this.config.enableAllocation
      },
      stats: {
        strategiesCount: 0,
        currentRegime: currentRegime.primaryRegime,
        regimeConfidence: currentRegime.confidence,
        totalCapitalAllocated: 0,
        reserveAmount: 0,
        topStrategies: []
      },
      lastUpdate: Date.now()
    };
    
    // Add allocation stats if available
    if (allocation) {
      statusInfo.stats.totalCapitalAllocated = allocation.totalCapital - allocation.reserveAmount;
      statusInfo.stats.reserveAmount = allocation.reserveAmount;
      statusInfo.stats.strategiesCount = allocation.allocations.length;
      
      // Get top strategies
      const topStrategies = [...allocation.allocations]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(a => ({
          id: a.strategyId,
          allocation: a.amount,
          regimeScore: a.regimeScore
        }));
      
      statusInfo.stats.topStrategies = topStrategies;
    }
    
    return statusInfo;
  }
  
  /**
   * Run a forced mutation cycle
   */
  public async runMutationCycle(): Promise<void> {
    if (!this.config.enableMutation) {
      logger.warn('Mutation engine is disabled');
      return;
    }
    
    logger.info('Running forced mutation cycle');
    await this.mutationEngine.executeMutationCycle();
  }
  
  /**
   * Run a forced optimization cycle
   */
  public async runOptimizationCycle(): Promise<void> {
    if (!this.config.enableOptimization) {
      logger.warn('Optimization engine is disabled');
      return;
    }
    
    logger.info('Running forced optimization cycle');
    await this.portfolioOptimizer.runOptimization();
  }
  
  /**
   * Run a forced allocation cycle
   */
  public runAllocationCycle(): void {
    if (!this.config.enableAllocation) {
      logger.warn('Allocation engine is disabled');
      return;
    }
    
    logger.info('Running forced allocation cycle');
    this.capitalAllocator.reallocate();
  }
  
  /**
   * Get active strategies
   */
  private async getActiveStrategies(): Promise<StrategyGenome[]> {
    try {
      const records = await this.alphaMemory.getRecords({
        onlyActive: true,
        sortBy: 'performance',
        sortDirection: 'desc'
      });
      
      return records.map(record => record.genome);
    } catch (error) {
      logger.error('Error fetching active strategies', error);
      return [];
    }
  }
  
  /**
   * Set up regime change handler
   */
  private setupRegimeChangeHandler(): void {
    // Create handler function
    this.regimeChangeHandler = (newRegime: MarketRegime) => {
      logger.info(`Market regime changed to ${newRegime}`);
      
      this.telemetry.emit('adaptive_system.regime_changed', {
        regime: newRegime,
        timestamp: Date.now()
      });
      
      // Run optimization and allocation cycles when regime changes
      if (this.isRunning) {
        if (this.config.enableOptimization) {
          this.portfolioOptimizer.runOptimization();
        }
        
        if (this.config.enableAllocation) {
          this.capitalAllocator.reallocate();
        }
      }
    };
    
    // Register handler with capital allocator
    this.capitalAllocator.onRegimeChange(this.regimeChangeHandler);
  }
  
  /**
   * Check system status periodically
   */
  private checkSystemStatus(): void {
    try {
      const status = this.getSystemStatus();
      
      // Log basic status info
      logger.debug('Adaptive Intelligence System status', {
        isRunning: status.isRunning,
        strategiesCount: status.stats.strategiesCount,
        currentRegime: status.stats.currentRegime,
        totalCapitalAllocated: status.stats.totalCapitalAllocated
      });
      
      // Record metrics
      this.telemetry.emit('adaptive_system.status', status);
    } catch (error) {
      logger.error('Error checking system status', error);
    }
  }
}

export default AdaptiveIntelligenceSystem; 