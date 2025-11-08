import { jest } from '@jest/globals';
import { RegimeCapitalAllocator } from '../../src/capital/RegimeCapitalAllocator';
import { RegimeClassifier } from '../../src/regime/RegimeClassifier';
import { StrategyGenome } from '../../src/evolution/StrategyGenome';
import { AlphaMemory } from '../../src/memory/AlphaMemory';
import { BiasEngine } from '../../src/evolution/BiasEngine';
import { TelemetryBus } from '../../src/telemetry/TelemetryBus';
import { StrategyPortfolioOptimizer } from '../../src/strategy/StrategyPortfolioOptimizer';

// Mock dependencies
jest.mock('../../src/regime/RegimeClassifier');
jest.mock('../../src/memory/AlphaMemory');
jest.mock('../../src/evolution/BiasEngine');
jest.mock('../../src/telemetry/TelemetryBus');
jest.mock('../../src/strategy/StrategyPortfolioOptimizer');
jest.mock('../../src/evolution/StrategyGenome');

describe('RegimeCapitalAllocator', () => {
  let allocator;
  let mockRegimeClassifier;
  let mockAlphaMemory;
  let mockBiasEngine;
  let mockTelemetryBus;
  let mockOptimizer;
  
  // Sample strategies for testing
  const sampleStrategies = [
    {
      id: 'strategy-1',
      metrics: {
        profitFactor: 1.5,
        sharpeRatio: 1.2,
        maxDrawdown: 0.15,
        volatility: 0.08
      },
      isValid: () => true
    },
    {
      id: 'strategy-2',
      metrics: {
        profitFactor: 1.8,
        sharpeRatio: 1.4,
        maxDrawdown: 0.12,
        volatility: 0.07
      },
      isValid: () => true
    },
    {
      id: 'strategy-3',
      metrics: {
        profitFactor: 1.3,
        sharpeRatio: 1.0,
        maxDrawdown: 0.18,
        volatility: 0.09
      },
      isValid: () => true
    }
  ];
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup StrategyGenome mock constructor
    StrategyGenome.mockImplementation((id) => {
      const strategy = sampleStrategies.find(s => s.id === id);
      if (strategy) return strategy;
      
      return {
        id: id || 'new-strategy',
        metrics: {
          profitFactor: 1.0,
          sharpeRatio: 1.0,
          maxDrawdown: 0.1,
          volatility: 0.1
        },
        isValid: () => true
      };
    });
    
    // Setup mock implementations
    mockRegimeClassifier = {
      getCurrentRegime: jest.fn().mockReturnValue({
        type: 'BullishTrend',
        confidence: 0.85
      }),
      onRegimeChange: jest.fn()
    };
    
    mockAlphaMemory = {
      getRecords: jest.fn().mockResolvedValue(
        sampleStrategies.map(strategy => ({ genome: strategy }))
      )
    };
    
    mockBiasEngine = {
      calculateBiasScore: jest.fn().mockImplementation((strategy, regime) => {
        // Return different scores based on strategy ID for testing
        if (strategy.id === 'strategy-1') return 0.7;
        if (strategy.id === 'strategy-2') return 0.9;
        if (strategy.id === 'strategy-3') return 0.5;
        return 0.6;
      })
    };
    
    mockOptimizer = {
      getLatestOptimizationResult: jest.fn().mockReturnValue({
        weights: [
          { strategyId: 'strategy-1', weight: 0.3 },
          { strategyId: 'strategy-2', weight: 0.5 },
          { strategyId: 'strategy-3', weight: 0.2 }
        ],
        expectedMetrics: {
          expectedReturn: 0.12,
          expectedVolatility: 0.08,
          expectedMaxDrawdown: 0.15,
          expectedSharpeRatio: 1.5
        },
        timestamp: Date.now(),
        currentRegime: 'BullishTrend'
      })
    };
    
    mockTelemetryBus = {
      emitEvent: jest.fn(),
      emitError: jest.fn(),
      recordMetric: jest.fn(),
      emit: jest.fn()
    };
    
    // Setup singleton mocks
    RegimeClassifier.getInstance.mockReturnValue(mockRegimeClassifier);
    AlphaMemory.getInstance.mockReturnValue(mockAlphaMemory);
    BiasEngine.getInstance.mockReturnValue(mockBiasEngine);
    StrategyPortfolioOptimizer.getInstance.mockReturnValue(mockOptimizer);
    TelemetryBus.getInstance.mockReturnValue(mockTelemetryBus);
    
    // Create allocator with test config
    allocator = RegimeCapitalAllocator.getInstance({
      totalCapital: 100000,
      baseCurrency: 'USD',
      minAllocationPercentage: 5,
      maxAllocationPercentage: 40,
      reallocationIntervalMs: 3600000,
      emitDetailedTelemetry: true
    });
  });
  
  afterEach(() => {
    if (allocator.isRunning) {
      allocator.stop();
    }
  });
  
  test('should create a singleton instance', () => {
    const anotherInstance = RegimeCapitalAllocator.getInstance();
    expect(anotherInstance).toBe(allocator);
  });
  
  test('should initialize with correct configuration', () => {
    expect(allocator.getConfig().totalCapital).toBe(100000);
    expect(allocator.getConfig().baseCurrency).toBe('USD');
    expect(allocator.getConfig().minAllocationPercentage).toBe(5);
  });
  
  test('should start and stop allocation cycles', async () => {
    // Mock reallocate
    allocator.reallocate = jest.fn().mockReturnValue({
      timestamp: Date.now(),
      totalCapital: 100000,
      currentRegime: 'BullishTrend',
      regimeConfidence: 0.85,
      allocations: [],
      reserveAmount: 5000,
      reservePercentage: 5
    });
    
    // Start allocator
    allocator.start();
    expect(allocator.isRunning).toBe(true);
    
    // Stop allocator
    allocator.stop();
    expect(allocator.isRunning).toBe(false);
  });
  
  test('should perform capital reallocation', () => {
    // Execute reallocation
    const result = allocator.reallocate();
    
    // Verify structure
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('totalCapital');
    expect(result).toHaveProperty('currentRegime');
    expect(result).toHaveProperty('regimeConfidence');
    expect(result).toHaveProperty('allocations');
    expect(result).toHaveProperty('reserveAmount');
    expect(result).toHaveProperty('reservePercentage');
    
    // Should have allocations
    expect(result.allocations.length).toBeGreaterThan(0);
    
    // Check telemetry
    expect(mockTelemetryBus.emitEvent).toHaveBeenCalledWith(
      'allocator:reallocation:completed',
      expect.any(Object)
    );
  });
  
  test('should calculate allocation based on multiple factors', () => {
    // Execute reallocation
    const result = allocator.reallocate();
    
    // Find allocation for strategy-2 (highest bias score)
    const strategy2Allocation = result.allocations.find(a => a.strategyId === 'strategy-2');
    
    // Find allocation for strategy-3 (lowest bias score)
    const strategy3Allocation = result.allocations.find(a => a.strategyId === 'strategy-3');
    
    // Strategy 2 should have higher allocation than strategy 3
    expect(strategy2Allocation.percentage).toBeGreaterThan(strategy3Allocation.percentage);
    
    // Verify bias engine was consulted
    expect(mockBiasEngine.calculateBiasScore).toHaveBeenCalled();
    
    // Verify optimizer was consulted
    expect(mockOptimizer.getLatestOptimizationResult).toHaveBeenCalled();
  });
  
  test('should respect min/max allocation constraints', () => {
    // Execute reallocation
    const result = allocator.reallocate();
    
    // Check all allocations are within constraints
    for (const allocation of result.allocations) {
      expect(allocation.percentage).toBeGreaterThanOrEqual(allocator.getConfig().minAllocationPercentage);
      expect(allocation.percentage).toBeLessThanOrEqual(allocator.getConfig().maxAllocationPercentage);
    }
  });
  
  test('should adjust allocations when regime changes', () => {
    // Get initial allocation in bullish regime
    const initialResult = allocator.reallocate();
    
    // Record initial allocations
    const initialStrategy1 = initialResult.allocations.find(a => a.strategyId === 'strategy-1');
    const initialStrategy2 = initialResult.allocations.find(a => a.strategyId === 'strategy-2');
    
    // Change regime to bearish
    mockRegimeClassifier.getCurrentRegime.mockReturnValue({
      type: 'BearishTrend',
      confidence: 0.80
    });
    
    // Also change bias scores to reflect regime change
    mockBiasEngine.calculateBiasScore.mockImplementation((strategy, regime) => {
      // In bearish regime, different strategies perform better
      if (strategy.id === 'strategy-1') return 0.9; // This one now performs better in bear market
      if (strategy.id === 'strategy-2') return 0.5; // This one performs worse in bear market
      if (strategy.id === 'strategy-3') return 0.7;
      return 0.6;
    });
    
    // Update optimizer result for the new regime
    mockOptimizer.getLatestOptimizationResult.mockReturnValue({
      weights: [
        { strategyId: 'strategy-1', weight: 0.5 },
        { strategyId: 'strategy-2', weight: 0.2 },
        { strategyId: 'strategy-3', weight: 0.3 }
      ],
      expectedMetrics: {
        expectedReturn: 0.08,
        expectedVolatility: 0.1,
        expectedMaxDrawdown: 0.2,
        expectedSharpeRatio: 0.8
      },
      timestamp: Date.now(),
      currentRegime: 'BearishTrend'
    });
    
    // Get new allocation in bearish regime
    const newResult = allocator.reallocate();
    
    // Find new allocations
    const newStrategy1 = newResult.allocations.find(a => a.strategyId === 'strategy-1');
    const newStrategy2 = newResult.allocations.find(a => a.strategyId === 'strategy-2');
    
    // Allocations should have changed based on regime
    // Strategy 1 should get more allocation in bearish regime
    expect(newStrategy1.percentage).toBeGreaterThan(initialStrategy1.percentage);
    
    // Strategy 2 should get less allocation in bearish regime
    expect(newStrategy2.percentage).toBeLessThan(initialStrategy2.percentage);
    
    // Verify regime is captured in result
    expect(newResult.currentRegime).toBe('BearishTrend');
  });
  
  test('should handle error conditions gracefully', () => {
    // Make optimizer return null
    mockOptimizer.getLatestOptimizationResult.mockReturnValue(null);
    
    // Should still complete allocation without crashing
    const result = allocator.reallocate();
    
    // Should still have basic structure
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('totalCapital');
    
    // May not have allocations due to missing optimizer data
    expect(result.allocations.length).toBe(0);
    
    // Should emit error telemetry
    expect(mockTelemetryBus.emitError).toHaveBeenCalled();
  });
  
  test('should get the latest allocation', () => {
    // First perform allocation
    allocator.reallocate();
    
    // Now get the latest allocation
    const latest = allocator.getLatestAllocation();
    
    // Should have allocation data
    expect(latest).toBeTruthy();
    expect(latest).toHaveProperty('allocations');
    expect(latest).toHaveProperty('timestamp');
    expect(latest.timestamp).toBeLessThanOrEqual(Date.now());
  });
}); 