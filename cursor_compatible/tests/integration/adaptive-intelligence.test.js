import { jest } from '@jest/globals';
import { StrategyMutationEngine } from '../../src/evolution/StrategyMutationEngine';
import { RegimeCapitalAllocator } from '../../src/capital/RegimeCapitalAllocator';
import { StrategyPortfolioOptimizer } from '../../src/optimizer/StrategyPortfolioOptimizer';
import { StrategyGenome } from '../../src/evolution/StrategyGenome';
import { RegimeClassifier, MarketRegime } from '../../src/regime/RegimeClassifier';
import { TelemetryBus } from '../../src/telemetry/TelemetryBus';
import { AlphaMemory } from '../../src/memory/AlphaMemory';
import { BiasEngine } from '../../src/evolution/BiasEngine';

// Mock dependencies
jest.mock('../../src/evolution/StrategyGenome');
jest.mock('../../src/regime/RegimeClassifier');
jest.mock('../../src/telemetry/TelemetryBus');
jest.mock('../../src/memory/AlphaMemory');
jest.mock('../../src/evolution/BiasEngine');

/**
 * Integration tests for the adaptive intelligence components:
 * - StrategyMutationEngine
 * - StrategyPortfolioOptimizer
 * - RegimeCapitalAllocator
 * 
 * These tests verify that the three components can work together
 * in an end-to-end adaptive intelligence workflow:
 * 1. Generate new strategies via mutation/evolution
 * 2. Optimize the portfolio of strategies
 * 3. Allocate capital based on regime and optimization
 */
describe('Adaptive Intelligence Integration', () => {
  let mutationEngine;
  let portfolioOptimizer;
  let capitalAllocator;
  let mockClassifier;
  let mockTelemetry;
  let mockAlphaMemory;
  let mockBiasEngine;
  
  // Sample strategies
  const sampleGenomes = [
    { 
      id: 'strategy-1', 
      metrics: { 
        profitFactor: 2.1, 
        sharpeRatio: 1.5, 
        maxDrawdown: 0.12, 
        volatility: 0.05 
      },
      isValid: () => true
    },
    { 
      id: 'strategy-2', 
      metrics: { 
        profitFactor: 1.8, 
        sharpeRatio: 1.3, 
        maxDrawdown: 0.10, 
        volatility: 0.07 
      },
      isValid: () => true
    },
    { 
      id: 'strategy-3', 
      metrics: { 
        profitFactor: 1.5, 
        sharpeRatio: 1.1, 
        maxDrawdown: 0.15, 
        volatility: 0.09 
      },
      isValid: () => true
    }
  ];
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Mock implementations
    StrategyGenome.mockImplementation((id) => {
      const found = sampleGenomes.find(s => s.id === id);
      if (found) return { ...found };
      
      return { 
        id: id || 'new-strategy',
        metrics: { 
          profitFactor: 1.0, 
          sharpeRatio: 1.0, 
          maxDrawdown: 0.10, 
          volatility: 0.08 
        },
        metadata: {
          parentIds: [],
          generation: 0,
          birthTimestamp: Date.now()
        },
        parameters: {},
        isValid: () => true
      };
    });
    
    // Mock RegimeClassifier
    mockClassifier = {
      getCurrentRegime: jest.fn().mockReturnValue({
        primaryRegime: 'BullishTrend',
        secondaryRegime: null,
        confidence: 0.85,
        timestamp: Date.now()
      })
    };
    RegimeClassifier.getInstance.mockReturnValue(mockClassifier);
    
    // Mock TelemetryBus
    mockTelemetry = {
      emit: jest.fn()
    };
    TelemetryBus.getInstance.mockReturnValue(mockTelemetry);
    
    // Mock AlphaMemory
    mockAlphaMemory = {
      getRecords: jest.fn().mockResolvedValue(
        sampleGenomes.map(genome => ({ genome }))
      ),
      getStrategyPerformance: jest.fn().mockImplementation((strategyId) => {
        return {
          returns: [0.02, 0.01, -0.01, 0.03],
          sharpeRatio: 1.2,
          winRate: 0.6,
          maxDrawdown: 0.1,
          volatility: 0.08,
          regimePerformance: {
            BullishTrend: {
              returns: [0.02, 0.03],
              sharpeRatio: 1.5
            },
            BearishTrend: {
              returns: [-0.01, 0.01],
              sharpeRatio: 0.8
            }
          }
        };
      })
    };
    AlphaMemory.getInstance.mockReturnValue(mockAlphaMemory);
    
    // Mock BiasEngine
    mockBiasEngine = {
      calculateBiasScore: jest.fn().mockImplementation((strategy, regime) => {
        // Higher bias for strategy-1 in bullish, strategy-3 in bearish
        if (regime === 'BullishTrend') {
          if (strategy.id === 'strategy-1') return 0.9;
          if (strategy.id === 'strategy-2') return 0.7;
          if (strategy.id === 'strategy-3') return 0.5;
        } else if (regime === 'BearishTrend') {
          if (strategy.id === 'strategy-1') return 0.4;
          if (strategy.id === 'strategy-2') return 0.6;
          if (strategy.id === 'strategy-3') return 0.8;
        }
        return 0.5;
      })
    };
    BiasEngine.getInstance.mockReturnValue(mockBiasEngine);
    
    // Initialize components
    mutationEngine = StrategyMutationEngine.getInstance({
      mutationIntervalMs: 1000,
      offspringPerCycle: 2,
      emitDetailedTelemetry: true
    });
    
    portfolioOptimizer = StrategyPortfolioOptimizer.getInstance({
      optimizationIntervalMs: 1000,
      emitDetailedTelemetry: true
    });
    
    capitalAllocator = RegimeCapitalAllocator.getInstance({
      totalCapital: 100000,
      reallocationIntervalMs: 1000,
      emitDetailedTelemetry: true
    });
  });
  
  afterEach(() => {
    // Stop all components
    mutationEngine.stop();
    portfolioOptimizer.stop();
    capitalAllocator.stop();
  });
  
  test('full adaptive feedback loop integration', async () => {
    // Start the components
    mutationEngine.start();
    portfolioOptimizer.start();
    capitalAllocator.start();
    
    // Manually trigger a mutation cycle
    await mutationEngine.executeMutationCycle();
    
    // Verify telemetry was emitted
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.stringContaining('mutation_engine'),
      expect.any(Object)
    );
    
    // Manually trigger optimization
    await portfolioOptimizer.runOptimization();
    
    // Verify telemetry was emitted
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.stringContaining('optimizer'),
      expect.any(Object)
    );
    
    // Manually trigger allocation
    capitalAllocator.reallocate();
    
    // Verify telemetry was emitted
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.stringContaining('allocator'),
      expect.any(Object)
    );
    
    // Verify the latest allocation exists
    const allocation = capitalAllocator.getLatestAllocation();
    expect(allocation).toBeDefined();
    expect(allocation.allocations.length).toBeGreaterThan(0);
    
    // Simulate regime change
    mockClassifier.getCurrentRegime.mockReturnValue({
      primaryRegime: 'BearishTrend',
      secondaryRegime: null,
      confidence: 0.75,
      timestamp: Date.now()
    });
    
    // Re-run optimization and allocation with new regime
    await portfolioOptimizer.runOptimization();
    capitalAllocator.reallocate();
    
    // Get new allocation after regime change
    const newAllocation = capitalAllocator.getLatestAllocation();
    
    // Verify regime was updated in allocation
    expect(newAllocation.currentRegime).toBe('BearishTrend');
    
    // Verify allocations changed due to regime shift
    // In bear market, strategy-3 should have higher allocation than in bull market
    const strategy1Allocation = allocation.allocations.find(a => a.strategyId === 'strategy-1');
    const strategy3Allocation = allocation.allocations.find(a => a.strategyId === 'strategy-3');
    
    const newStrategy1Allocation = newAllocation.allocations.find(a => a.strategyId === 'strategy-1');
    const newStrategy3Allocation = newAllocation.allocations.find(a => a.strategyId === 'strategy-3');
    
    // Strategy1 should have higher allocation in bull market
    expect(strategy1Allocation.percentage).toBeGreaterThan(newStrategy1Allocation.percentage);
    
    // Strategy3 should have higher allocation in bear market
    expect(strategy3Allocation.percentage).toBeLessThan(newStrategy3Allocation.percentage);
  });
}); 