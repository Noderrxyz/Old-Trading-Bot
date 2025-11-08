import { jest } from '@jest/globals';
import { StrategyPortfolioOptimizer } from '../../src/strategy/StrategyPortfolioOptimizer';
import { StrategyGenome } from '../../src/evolution/StrategyGenome';
import { RegimeClassifier } from '../../src/regime/RegimeClassifier';
import { AlphaMemory } from '../../src/memory/AlphaMemory';
import { BiasEngine } from '../../src/evolution/BiasEngine';
import { TelemetryBus } from '../../src/telemetry/TelemetryBus';
import { RegimeCapitalAllocator } from '../../src/capital/RegimeCapitalAllocator';

// Mock dependencies
jest.mock('../../src/regime/RegimeClassifier');
jest.mock('../../src/memory/AlphaMemory');
jest.mock('../../src/evolution/BiasEngine');
jest.mock('../../src/telemetry/TelemetryBus');
jest.mock('../../src/capital/RegimeCapitalAllocator');
jest.mock('../../src/evolution/StrategyGenome');

describe('StrategyPortfolioOptimizer', () => {
  let optimizer;
  let mockRegimeClassifier;
  let mockAlphaMemory;
  let mockBiasEngine;
  let mockTelemetryBus;
  let mockCapitalAllocator;
  
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
  
  // Sample performance data
  const samplePerformanceData = {
    'strategy-1': [
      { timestamp: Date.now() - 86400000 * 10, return: 0.02 },
      { timestamp: Date.now() - 86400000 * 9, return: -0.01 },
      { timestamp: Date.now() - 86400000 * 8, return: 0.03 },
      { timestamp: Date.now() - 86400000 * 7, return: 0.01 }
    ],
    'strategy-2': [
      { timestamp: Date.now() - 86400000 * 10, return: 0.03 },
      { timestamp: Date.now() - 86400000 * 9, return: 0.02 },
      { timestamp: Date.now() - 86400000 * 8, return: -0.01 },
      { timestamp: Date.now() - 86400000 * 7, return: 0.02 }
    ],
    'strategy-3': [
      { timestamp: Date.now() - 86400000 * 10, return: 0.01 },
      { timestamp: Date.now() - 86400000 * 9, return: 0.01 },
      { timestamp: Date.now() - 86400000 * 8, return: 0.02 },
      { timestamp: Date.now() - 86400000 * 7, return: -0.02 }
    ]
  };
  
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
        regime: 'BullishTrend',
        confidence: 0.85
      }),
      onRegimeChange: jest.fn()
    };
    
    mockAlphaMemory = {
      getRecords: jest.fn().mockResolvedValue(
        sampleStrategies.map(strategy => ({ genome: strategy }))
      ),
      getStrategyPerformance: jest.fn().mockImplementation((strategyId) => {
        return Promise.resolve(samplePerformanceData[strategyId] || []);
      })
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
    
    mockCapitalAllocator = {
      reallocate: jest.fn()
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
    RegimeCapitalAllocator.getInstance.mockReturnValue(mockCapitalAllocator);
    TelemetryBus.getInstance.mockReturnValue(mockTelemetryBus);
    
    // Create optimizer with test config
    optimizer = StrategyPortfolioOptimizer.getInstance({
      optimizationIntervalMs: 3600000,
      dataWindowDays: 30,
      minStrategiesInPortfolio: 2,
      maxStrategiesInPortfolio: 10,
      emitDetailedTelemetry: true
    });
  });
  
  afterEach(() => {
    if (optimizer.isRunning) {
      optimizer.stop();
    }
  });
  
  test('should create a singleton instance', () => {
    const anotherInstance = StrategyPortfolioOptimizer.getInstance();
    expect(anotherInstance).toBe(optimizer);
  });
  
  test('should start and stop optimization cycles', () => {
    // Mock optimize
    optimizer.optimize = jest.fn().mockResolvedValue({
      weights: new Map(),
      expectedReturn: 0.1,
      volatility: 0.08,
      sharpeRatio: 1.2,
      maxDrawdown: 0.15,
      diversificationScore: 0.8,
      regimeAlignmentScore: 0.7,
      timestamp: Date.now()
    });
    
    // Start optimizer
    optimizer.start();
    expect(optimizer.isRunning).toBeTruthy();
    
    // Stop optimizer
    optimizer.stop();
    expect(optimizer.isRunning).toBeFalsy();
  });
  
  test('should perform portfolio optimization', async () => {
    // Execute optimization
    const result = await optimizer.optimize();
    
    // Verify structure
    expect(result).toHaveProperty('weights');
    expect(result).toHaveProperty('expectedReturn');
    expect(result).toHaveProperty('volatility');
    expect(result).toHaveProperty('sharpeRatio');
    expect(result).toHaveProperty('maxDrawdown');
    expect(result).toHaveProperty('timestamp');
    
    // Check telemetry
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith(
      'strategy_portfolio_optimized',
      expect.any(Object)
    );
  });
  
  test('should register strategies for optimization', () => {
    // Create a strategy to register
    const strategy = new StrategyGenome('test-strategy');
    
    // Register it
    optimizer.registerStrategy(strategy);
    
    // Check telemetry
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith(
      'strategy_registered_for_optimization',
      expect.objectContaining({
        strategyId: 'test-strategy'
      })
    );
  });
  
  test('should calculate correlations between strategies', async () => {
    // Execute optimization which calculates correlations
    await optimizer.optimize();
    
    // Get stats for strategy-1
    const stats = optimizer.getStrategyStats('strategy-1');
    
    // Should have correlation data
    expect(stats).toBeTruthy();
    expect(stats.correlations).toBeTruthy();
    expect(stats.correlations.size).toBeGreaterThan(0);
  });
  
  test('should calculate optimal weights based on multiple factors', async () => {
    // Execute optimization
    const result = await optimizer.optimize();
    
    // Get weights
    const weights = result.weights;
    
    // Should have weights for each strategy
    expect(weights.size).toBeGreaterThanOrEqual(2);
    
    // Strategy 2 should have highest weight due to best metrics and bias
    const strategy2Weight = weights.get('strategy-2') || 0;
    const strategy3Weight = weights.get('strategy-3') || 0;
    
    expect(strategy2Weight).toBeGreaterThan(strategy3Weight);
  });
  
  test('should handle regime changes', async () => {
    // Get initial result in bullish regime
    const initialResult = await optimizer.optimize();
    
    // Now simulate regime change
    const handleRegimeChange = mockRegimeClassifier.onRegimeChange.mock.calls[0][0];
    
    // Update mock regime classifier to return bearish regime
    mockRegimeClassifier.getCurrentRegime.mockReturnValue({
      regime: 'BearishTrend',
      confidence: 0.8
    });
    
    // Also change bias scores for bearish regime
    mockBiasEngine.calculateBiasScore.mockImplementation((strategy, regime) => {
      if (regime === 'BearishTrend') {
        if (strategy.id === 'strategy-1') return 0.9; // This one performs better in bear markets
        if (strategy.id === 'strategy-2') return 0.5; // This one performs worse in bear markets
        if (strategy.id === 'strategy-3') return 0.7;
      }
      return 0.6;
    });
    
    // Manually call handler with new regime
    handleRegimeChange('BearishTrend');
    
    // Now get new optimization
    const newResult = await optimizer.optimize();
    
    // Different regime should result in different weights
    expect(newResult.weights).not.toEqual(initialResult.weights);
    
    // Check that regime is captured in result
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith(
      'strategy_portfolio_optimized',
      expect.objectContaining({
        regime: 'BearishTrend'
      })
    );
  });
  
  test('should apply to capital allocator', async () => {
    // First optimize
    await optimizer.optimize();
    
    // Now apply to allocator
    optimizer.applyToCapitalAllocator();
    
    // Verify capital allocator was called
    expect(mockCapitalAllocator.reallocate).toHaveBeenCalled();
  });
  
  test('should handle errors during optimization', async () => {
    // Make alphaMemory throw an error
    mockAlphaMemory.getRecords.mockRejectedValue(new Error('Test error'));
    
    // Execute optimization
    const result = await optimizer.optimize();
    
    // Should return simplified result but not crash
    expect(result).toBeTruthy();
    expect(result.weights.size).toBe(0);
    
    // Should emit error telemetry
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith(
      'strategy_portfolio_optimization_error',
      expect.objectContaining({
        error: expect.stringContaining('Test error')
      })
    );
  });
  
  test('should respect min/max strategy constraints', async () => {
    // Set very low max strategies
    optimizer.updateConfig({
      maxStrategiesInPortfolio: 2
    });
    
    // Execute optimization
    const result = await optimizer.optimize();
    
    // Should respect max strategy constraint
    expect(result.weights.size).toBeLessThanOrEqual(2);
    
    // Set high min strategies but make one strategy invalid
    optimizer.updateConfig({
      minStrategiesInPortfolio: 3,
      maxStrategiesInPortfolio: 10
    });
    
    // Make one strategy invalid
    const invalidStrategy = { 
      ...sampleStrategies[2],
      isValid: () => false
    };
    
    // Update mock to return invalid strategy
    mockAlphaMemory.getRecords.mockResolvedValue([
      { genome: sampleStrategies[0] },
      { genome: sampleStrategies[1] },
      { genome: invalidStrategy }
    ]);
    
    // Execute optimization again
    const newResult = await optimizer.optimize();
    
    // Should only include valid strategies
    const validStrategies = sampleStrategies.filter(s => s.isValid());
    expect(newResult.weights.size).toBeLessThanOrEqual(validStrategies.length);
  });
}); 