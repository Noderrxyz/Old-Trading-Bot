import { jest } from '@jest/globals';
import { StrategyMutationEngine } from '../src/evolution/StrategyMutationEngine';
import { RegimeCapitalAllocator } from '../src/capital/RegimeCapitalAllocator';
import { StrategyPortfolioOptimizer } from '../src/strategy/StrategyPortfolioOptimizer';
import { StrategyGenome } from '../src/evolution/StrategyGenome';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';
import { RegimeClassifier, MarketRegimeType } from '../src/regime/RegimeClassifier';
import { AlphaMemory } from '../src/memory/AlphaMemory';

// Mock dependencies
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn(),
        on: jest.fn(),
        off: jest.fn()
      })
    }
  };
});

jest.mock('../src/regime/RegimeClassifier', () => {
  return {
    MarketRegimeType: {
      UNKNOWN: 'UNKNOWN',
      BULLISH_TREND: 'BULLISH_TREND',
      BEARISH_TREND: 'BEARISH_TREND',
      SIDEWAYS: 'SIDEWAYS',
      HIGH_VOLATILITY: 'HIGH_VOLATILITY',
      LOW_VOLATILITY: 'LOW_VOLATILITY',
      MEAN_REVERTING: 'MEAN_REVERTING',
      MOMENTUM: 'MOMENTUM'
    },
    RegimeClassifier: {
      getInstance: jest.fn().mockReturnValue({
        getCurrentRegime: jest.fn().mockReturnValue({ 
          regime: 'BULLISH_TREND', 
          confidence: 0.85,
          timestamp: Date.now()
        }),
        onRegimeChange: jest.fn().mockImplementation(callback => {
          // Store the callback for testing
          RegimeClassifier._onRegimeChangeCallback = callback;
        })
      })
    }
  };
});

jest.mock('../src/memory/AlphaMemory', () => {
  return {
    AlphaMemory: {
      getInstance: jest.fn().mockReturnValue({
        getStrategyPerformanceHistory: jest.fn().mockResolvedValue([
          { timestamp: Date.now() - 86400000 * 10, returnPct: 0.02 },
          { timestamp: Date.now() - 86400000 * 9, returnPct: -0.01 },
          { timestamp: Date.now() - 86400000 * 8, returnPct: 0.03 },
          { timestamp: Date.now() - 86400000 * 7, returnPct: 0.01 },
          { timestamp: Date.now() - 86400000 * 6, returnPct: 0.02 },
          { timestamp: Date.now() - 86400000 * 5, returnPct: -0.02 },
          { timestamp: Date.now() - 86400000 * 4, returnPct: 0.04 },
          { timestamp: Date.now() - 86400000 * 3, returnPct: 0.01 },
          { timestamp: Date.now() - 86400000 * 2, returnPct: 0.02 },
          { timestamp: Date.now() - 86400000 * 1, returnPct: 0.03 }
        ]),
        getStrategyMetrics: jest.fn().mockResolvedValue({
          sharpe: 1.5,
          volatility: 0.12,
          drawdown: 0.08,
          winRate: 0.7
        }),
        recordStrategyMetric: jest.fn(),
        recordRegimePerformance: jest.fn()
      })
    }
  };
});

// Mock MutationEngine, BiasEngine
jest.mock('../src/evolution/MutationEngine', () => {
  return {
    MutationEngine: {
      getInstance: jest.fn().mockReturnValue({
        mutateStrategy: jest.fn().mockImplementation((genome) => {
          return {
            ...genome,
            id: `${genome.id}-mutated`,
            parameters: { ...genome.parameters }
          };
        }),
        crossoverStrategies: jest.fn().mockImplementation((genomeA, genomeB) => {
          return {
            id: `${genomeA.id}-${genomeB.id}-crossover`,
            parameters: { ...genomeA.parameters, ...genomeB.parameters },
            metrics: { ...genomeA.metrics }
          };
        })
      })
    }
  };
});

jest.mock('../src/evolution/BiasEngine', () => {
  return {
    BiasEngine: {
      getInstance: jest.fn().mockReturnValue({
        getBiasForStrategy: jest.fn().mockReturnValue(0.7),
        updateBias: jest.fn(),
        getBiasedSelectionProbability: jest.fn().mockReturnValue(0.8)
      })
    }
  };
});

// Helper to create mock strategy genomes
const createMockGenome = (id, metrics = {}) => {
  return {
    id,
    parameters: {
      timePeriod: 14,
      threshold: 0.5,
      stopLoss: 0.1
    },
    metrics: {
      sharpeRatio: metrics.sharpeRatio || 1.2,
      volatility: metrics.volatility || 0.15,
      drawdown: metrics.drawdown || 0.1,
      winRate: metrics.winRate || 0.65,
      ...metrics
    },
    createdAt: Date.now(),
    generation: 1,
    parentIds: [],
    clone: function() {
      return { ...this };
    }
  };
};

describe('Adaptive Intelligence Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('StrategyMutationEngine', () => {
    let engine;
    let mockGenomes;
    
    beforeEach(() => {
      mockGenomes = [
        createMockGenome('strategy-1', { sharpeRatio: 1.5, winRate: 0.7 }),
        createMockGenome('strategy-2', { sharpeRatio: 0.8, winRate: 0.6 }),
        createMockGenome('strategy-3', { sharpeRatio: 1.2, winRate: 0.65 })
      ];
      
      engine = StrategyMutationEngine.getInstance({
        mutationIntervalMs: 1000,
        maxStrategiesInPool: 10,
        offspringPerCycle: 2
      });
    });
    
    test('should initialize with default config', () => {
      expect(engine).toBeDefined();
    });
    
    test('should load initial strategies', () => {
      engine.loadInitialStrategies(mockGenomes);
      
      // Get the strategy pool through the method if available or test internal state
      const strategyIds = engine.getStrategyPool().map(s => s.id);
      
      expect(strategyIds).toContain('strategy-1');
      expect(strategyIds).toContain('strategy-2');
      expect(strategyIds).toContain('strategy-3');
    });
    
    test('should execute mutation cycle', async () => {
      engine.loadInitialStrategies(mockGenomes);
      const result = await engine.executeMutationCycle();
      
      expect(result.parentStrategies.length).toBeGreaterThan(0);
      expect(result.offspring.length).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
      
      // Check if telemetry was emitted
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'mutation_cycle_completed',
        expect.any(Object)
      );
    });
    
    test('should select parent strategies based on performance', () => {
      engine.loadInitialStrategies(mockGenomes);
      const parents = engine.selectParentStrategies(2);
      
      expect(parents.length).toBe(2);
      // Higher Sharpe ratio strategies should be preferred
      expect(parents.some(p => p.id === 'strategy-1')).toBeTruthy();
    });
    
    test('should prune poorly performing strategies', () => {
      // Add a mix of good and bad strategies
      const mixedGenomes = [
        ...mockGenomes,
        createMockGenome('poor-strategy-1', { sharpeRatio: -0.5, winRate: 0.3 }),
        createMockGenome('poor-strategy-2', { sharpeRatio: 0.1, winRate: 0.4 })
      ];
      
      engine.loadInitialStrategies(mixedGenomes);
      const prunedIds = engine.pruneStrategyPool();
      
      expect(prunedIds.length).toBeGreaterThan(0);
      expect(prunedIds).toContain('poor-strategy-1');
    });
  });

  describe('RegimeCapitalAllocator', () => {
    let allocator;
    let mockGenomes;
    
    beforeEach(() => {
      mockGenomes = [
        createMockGenome('strategy-1', { sharpeRatio: 1.5, winRate: 0.7 }),
        createMockGenome('strategy-2', { sharpeRatio: 0.8, winRate: 0.6 }),
        createMockGenome('strategy-3', { sharpeRatio: 1.2, winRate: 0.65 })
      ];
      
      allocator = RegimeCapitalAllocator.getInstance({
        reallocationIntervalMs: 1000,
        maxAllocationPerStrategy: 0.5
      });
    });
    
    test('should initialize with default config', () => {
      expect(allocator).toBeDefined();
    });
    
    test('should register strategies with allocations', () => {
      allocator.registerStrategy(mockGenomes[0], 0.3);
      allocator.registerStrategy(mockGenomes[1], 0.2);
      
      expect(allocator.getAllocation('strategy-1')).toBe(0.3);
      expect(allocator.getAllocation('strategy-2')).toBe(0.2);
      expect(allocator.getTotalAllocation()).toBe(0.5);
    });
    
    test('should update strategy regime performance', () => {
      allocator.registerStrategy(mockGenomes[0], 0.3);
      
      allocator.updateStrategyRegimePerformance(
        'strategy-1',
        MarketRegimeType.BULLISH_TREND,
        1.8,
        0.75,
        0.12,
        20
      );
      
      expect(allocator.getRegimeAlignmentScore('strategy-1')).toBeGreaterThan(0);
      
      // Force reallocation to apply the new performance data
      const results = allocator.forceReallocation();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].strategyId).toBe('strategy-1');
    });
    
    test('should handle regime changes', () => {
      allocator.registerStrategy(mockGenomes[0], 0.3);
      allocator.registerStrategy(mockGenomes[1], 0.2);
      
      // Simulate regime change
      const callback = RegimeClassifier._onRegimeChangeCallback;
      if (callback) {
        callback(MarketRegimeType.BEARISH_TREND);
      }
      
      // Check if telemetry was emitted for regime change
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'capital_allocation_regime_change',
        expect.any(Object)
      );
      
      // Check if allocations were updated due to regime change
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'capital_allocation_rebalanced',
        expect.any(Object)
      );
    });
    
    test('should unregister strategies', () => {
      allocator.registerStrategy(mockGenomes[0], 0.3);
      allocator.registerStrategy(mockGenomes[1], 0.2);
      
      allocator.unregisterStrategy('strategy-1');
      
      expect(allocator.getAllocation('strategy-1')).toBe(0);
      expect(allocator.getTotalAllocation()).toBe(0.2);
    });
  });

  describe('StrategyPortfolioOptimizer', () => {
    let optimizer;
    let mockGenomes;
    
    beforeEach(() => {
      mockGenomes = [
        createMockGenome('strategy-1', { sharpeRatio: 1.5, winRate: 0.7 }),
        createMockGenome('strategy-2', { sharpeRatio: 0.8, winRate: 0.6 }),
        createMockGenome('strategy-3', { sharpeRatio: 1.2, winRate: 0.65 }),
        createMockGenome('strategy-4', { sharpeRatio: 1.0, winRate: 0.62 })
      ];
      
      optimizer = StrategyPortfolioOptimizer.getInstance({
        optimizationIntervalMs: 1000,
        minStrategiesInPortfolio: 2,
        maxStrategiesInPortfolio: 10
      });
    });
    
    test('should initialize with default config', () => {
      expect(optimizer).toBeDefined();
    });
    
    test('should register strategies for optimization', () => {
      for (const genome of mockGenomes) {
        optimizer.registerStrategy(genome);
      }
      
      // Force optimization
      return optimizer.forceOptimize().then(result => {
        expect(result).toBeDefined();
        expect(result.weights.size).toBeGreaterThan(0);
        expect(result.sharpeRatio).toBeGreaterThan(0);
        
        // Check if telemetry was emitted
        expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
          'portfolio_optimization_completed',
          expect.any(Object)
        );
      });
    });
    
    test('should unregister strategies', () => {
      for (const genome of mockGenomes) {
        optimizer.registerStrategy(genome);
      }
      
      optimizer.unregisterStrategy('strategy-1');
      
      // Check if strategy was removed
      const statsAfterRemoval = optimizer.getStrategyStats('strategy-1');
      expect(statsAfterRemoval).toBeNull();
      
      // Check if telemetry was emitted
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'strategy_unregistered_from_optimization',
        expect.any(Object)
      );
    });
    
    test('should handle regime changes', () => {
      for (const genome of mockGenomes) {
        optimizer.registerStrategy(genome);
      }
      
      // Simulate regime change
      const callback = RegimeClassifier._onRegimeChangeCallback;
      if (callback) {
        callback(MarketRegimeType.BEARISH_TREND);
      }
      
      // Check if telemetry was emitted for regime change
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'portfolio_optimizer_regime_change',
        expect.any(Object)
      );
    });
    
    test('should apply optimized weights to capital allocator', async () => {
      // Create a mock for RegimeCapitalAllocator
      const mockRegisterStrategy = jest.fn();
      const mockForceReallocation = jest.fn();
      
      jest.spyOn(RegimeCapitalAllocator, 'getInstance').mockReturnValue({
        registerStrategy: mockRegisterStrategy,
        forceReallocation: mockForceReallocation
      });
      
      for (const genome of mockGenomes) {
        optimizer.registerStrategy(genome);
      }
      
      await optimizer.forceOptimize();
      optimizer.applyToCapitalAllocator();
      
      // Should call registerStrategy for each strategy with weights
      expect(mockRegisterStrategy).toHaveBeenCalled();
      
      // Should force reallocation after applying weights
      expect(mockForceReallocation).toHaveBeenCalled();
      
      // Check if telemetry was emitted
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'portfolio_weights_applied',
        expect.any(Object)
      );
    });
  });

  describe('Integration of Adaptive Intelligence Components', () => {
    let mutationEngine;
    let capitalAllocator;
    let portfolioOptimizer;
    let mockGenomes;
    
    beforeEach(() => {
      mockGenomes = [
        createMockGenome('strategy-1', { sharpeRatio: 1.5, winRate: 0.7 }),
        createMockGenome('strategy-2', { sharpeRatio: 0.8, winRate: 0.6 }),
        createMockGenome('strategy-3', { sharpeRatio: 1.2, winRate: 0.65 }),
        createMockGenome('strategy-4', { sharpeRatio: 1.0, winRate: 0.62 })
      ];
      
      mutationEngine = StrategyMutationEngine.getInstance({
        mutationIntervalMs: 1000,
        maxStrategiesInPool: 10,
        offspringPerCycle: 2
      });
      
      capitalAllocator = RegimeCapitalAllocator.getInstance({
        reallocationIntervalMs: 1000,
        maxAllocationPerStrategy: 0.5
      });
      
      portfolioOptimizer = StrategyPortfolioOptimizer.getInstance({
        optimizationIntervalMs: 1000,
        minStrategiesInPortfolio: 2,
        maxStrategiesInPortfolio: 10
      });
    });
    
    test('end-to-end adaptive intelligence workflow', async () => {
      // 1. Load initial strategies into mutation engine
      mutationEngine.loadInitialStrategies(mockGenomes);
      
      // 2. Run a mutation cycle to generate new strategies
      const mutationResult = await mutationEngine.executeMutationCycle();
      expect(mutationResult.offspring.length).toBeGreaterThan(0);
      
      // 3. Register all strategies (original + offspring) with portfolio optimizer
      for (const genome of mockGenomes.concat(mutationResult.offspring)) {
        portfolioOptimizer.registerStrategy(genome);
      }
      
      // 4. Run portfolio optimization
      const optimizationResult = await portfolioOptimizer.forceOptimize();
      expect(optimizationResult.weights.size).toBeGreaterThan(0);
      
      // 5. Apply optimized weights to capital allocator
      portfolioOptimizer.applyToCapitalAllocator();
      
      // 6. Verify telemetry events were emitted for the full workflow
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'mutation_cycle_completed',
        expect.any(Object)
      );
      
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'portfolio_optimization_completed',
        expect.any(Object)
      );
      
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'portfolio_weights_applied',
        expect.any(Object)
      );
      
      expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
        'capital_allocation_rebalanced',
        expect.any(Object)
      );
    });
    
    test('should propagate regime changes through all components', () => {
      // Register strategies with all components
      for (const genome of mockGenomes) {
        mutationEngine.loadInitialStrategies([genome]);
        portfolioOptimizer.registerStrategy(genome);
        capitalAllocator.registerStrategy(genome, 0.25);
      }
      
      // Capture current emit calls before regime change
      const initialEmitCalls = TelemetryBus.getInstance().emit.mock.calls.length;
      
      // Simulate a regime change
      const callback = RegimeClassifier._onRegimeChangeCallback;
      if (callback) {
        callback(MarketRegimeType.HIGH_VOLATILITY);
      }
      
      // Verify all components received the regime change
      const newEmitCalls = TelemetryBus.getInstance().emit.mock.calls.length - initialEmitCalls;
      
      // Should have at least two regime change related events
      expect(newEmitCalls).toBeGreaterThanOrEqual(2);
      
      // Check for specific regime change events
      const emitCalls = TelemetryBus.getInstance().emit.mock.calls;
      
      const hasRegimeChangeEvents = emitCalls.some(call => 
        call[0] === 'capital_allocation_regime_change' || 
        call[0] === 'portfolio_optimizer_regime_change'
      );
      
      expect(hasRegimeChangeEvents).toBeTruthy();
    });
  });
}); 