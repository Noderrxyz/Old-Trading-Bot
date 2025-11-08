import { jest } from '@jest/globals';
import { StrategyPortfolioOptimizer } from '../src/strategy/StrategyPortfolioOptimizer';
import { RegimeClassifier } from '../src/regime/RegimeClassifier';
import { AlphaMemory } from '../src/memory/AlphaMemory';
import { RegimeCapitalAllocator } from '../src/capital/RegimeCapitalAllocator';
import { logger } from '../src/utils/logger';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';

// Mock dependencies
jest.mock('../src/regime/RegimeClassifier');
jest.mock('../src/memory/AlphaMemory');
jest.mock('../src/capital/RegimeCapitalAllocator');
jest.mock('../src/utils/logger');
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    }
  };
});

// Helper to create mock strategies with correlations
const createMockStrategy = (id, metrics = {}, correlations = {}) => ({
  id,
  parameters: { param1: 0.5, param2: 10 },
  metrics: {
    sharpeRatio: 1.2,
    drawdown: 0.1,
    winRate: 0.65,
    ...metrics
  },
  generation: 1,
  createdAt: Date.now(),
  parentIds: [],
  capitalAllocation: 0.1,
  correlations
});

describe('StrategyPortfolioOptimizer', () => {
  // Test setup
  let optimizer;
  let mockAlphaMemory;
  let mockRegimeClassifier;
  let mockCapitalAllocator;
  let mockStrategies;
  let telemetryBus;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock strategies with correlations
    mockStrategies = [
      createMockStrategy('strategy-1', 
        { sharpeRatio: 1.5, volatility: 0.12 }, 
        { 'strategy-2': 0.7, 'strategy-3': 0.1, 'strategy-4': -0.3, 'strategy-5': 0.2 }
      ),
      createMockStrategy('strategy-2', 
        { sharpeRatio: 1.3, volatility: 0.15 }, 
        { 'strategy-1': 0.7, 'strategy-3': 0.6, 'strategy-4': 0.4, 'strategy-5': 0.5 }
      ),
      createMockStrategy('strategy-3', 
        { sharpeRatio: 1.7, volatility: 0.18 }, 
        { 'strategy-1': 0.1, 'strategy-2': 0.6, 'strategy-4': 0.2, 'strategy-5': 0.3 }
      ),
      createMockStrategy('strategy-4', 
        { sharpeRatio: 1.2, volatility: 0.08 }, 
        { 'strategy-1': -0.3, 'strategy-2': 0.4, 'strategy-3': 0.2, 'strategy-5': -0.1 }
      ),
      createMockStrategy('strategy-5', 
        { sharpeRatio: 1.4, volatility: 0.10 }, 
        { 'strategy-1': 0.2, 'strategy-2': 0.5, 'strategy-3': 0.3, 'strategy-4': -0.1 }
      ),
    ];
    
    // Setup mocks
    mockAlphaMemory = {
      getStrategies: jest.fn().mockResolvedValue(mockStrategies),
      getStrategyById: jest.fn().mockImplementation((id) => 
        Promise.resolve(mockStrategies.find(s => s.id === id))),
      saveStrategy: jest.fn().mockImplementation((strategy) => 
        Promise.resolve({ ...strategy })),
      updateStrategyCorrelations: jest.fn().mockResolvedValue(true),
      getCorrelationMatrix: jest.fn().mockResolvedValue({
        'strategy-1': { 'strategy-2': 0.7, 'strategy-3': 0.1, 'strategy-4': -0.3, 'strategy-5': 0.2 },
        'strategy-2': { 'strategy-1': 0.7, 'strategy-3': 0.6, 'strategy-4': 0.4, 'strategy-5': 0.5 },
        'strategy-3': { 'strategy-1': 0.1, 'strategy-2': 0.6, 'strategy-4': 0.2, 'strategy-5': 0.3 },
        'strategy-4': { 'strategy-1': -0.3, 'strategy-2': 0.4, 'strategy-3': 0.2, 'strategy-5': -0.1 },
        'strategy-5': { 'strategy-1': 0.2, 'strategy-2': 0.5, 'strategy-3': 0.3, 'strategy-4': -0.1 }
      })
    };
    
    mockRegimeClassifier = {
      getCurrentRegime: jest.fn().mockResolvedValue({
        regime: 'BullishTrend',
        confidence: 0.85,
        timestamp: Date.now()
      })
    };
    
    mockCapitalAllocator = {
      updateAllocation: jest.fn().mockResolvedValue(true),
      getCurrentAllocationDetails: jest.fn().mockReturnValue({
        strategies: mockStrategies.map(s => ({ id: s.id, allocation: s.capitalAllocation })),
        reserveCapital: 0.1,
        timestamp: Date.now()
      })
    };
    
    // Mock constructor implementations
    RegimeClassifier.mockImplementation(() => mockRegimeClassifier);
    AlphaMemory.mockImplementation(() => mockAlphaMemory);
    RegimeCapitalAllocator.mockImplementation(() => mockCapitalAllocator);
    
    // Setup telemetry
    telemetryBus = TelemetryBus.getInstance();
    
    // Create optimizer instance
    optimizer = new StrategyPortfolioOptimizer({
      optimizationIntervalMs: 1000,
      maxPortfolioVolatility: 0.2,
      targetSharpeRatio: 1.5,
      correlationThreshold: 0.7,
      volatilityWeight: 0.4,
      maxActivatedStrategies: 4
    });
  });
  
  afterEach(() => {
    // Clean up any intervals
    optimizer.stopOptimization();
    jest.useRealTimers();
  });
  
  test('should initialize with default config values', () => {
    const defaultOptimizer = new StrategyPortfolioOptimizer();
    expect(defaultOptimizer.config).toBeDefined();
    expect(defaultOptimizer.config.optimizationIntervalMs).toBeGreaterThan(0);
    expect(defaultOptimizer.config.maxPortfolioVolatility).toBeGreaterThan(0);
    expect(defaultOptimizer.config.correlationThreshold).toBeGreaterThan(0);
  });
  
  test('should override default config with provided values', () => {
    const customConfig = {
      optimizationIntervalMs: 2000,
      maxPortfolioVolatility: 0.25,
      targetSharpeRatio: 2.0,
      correlationThreshold: 0.8
    };
    
    const customOptimizer = new StrategyPortfolioOptimizer(customConfig);
    
    expect(customOptimizer.config.optimizationIntervalMs).toBe(customConfig.optimizationIntervalMs);
    expect(customOptimizer.config.maxPortfolioVolatility).toBe(customConfig.maxPortfolioVolatility);
    expect(customOptimizer.config.targetSharpeRatio).toBe(customConfig.targetSharpeRatio);
    expect(customOptimizer.config.correlationThreshold).toBe(customConfig.correlationThreshold);
  });
  
  test('should load strategies', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Verify strategies were loaded
    expect(mockAlphaMemory.getStrategies).toHaveBeenCalled();
    expect(optimizer.strategies.length).toBe(mockStrategies.length);
    
    // Verify telemetry was emitted
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'portfolio_optimizer_initialized', 
      expect.objectContaining({
        strategyCount: mockStrategies.length
      })
    );
  });
  
  test('should start and stop optimization cycle', async () => {
    jest.useFakeTimers();
    
    // Spy on optimize
    const optimizeSpy = jest.spyOn(optimizer, 'optimize');
    
    // Start optimization
    await optimizer.startOptimization();
    
    // Verify optimization started
    expect(optimizer.optimizationIntervalId).toBeDefined();
    
    // Advance timer to trigger optimization
    jest.advanceTimersByTime(optimizer.config.optimizationIntervalMs);
    
    // Verify optimize was called
    expect(optimizeSpy).toHaveBeenCalled();
    
    // Stop optimization
    optimizer.stopOptimization();
    
    // Verify optimization stopped
    expect(optimizer.optimizationIntervalId).toBeUndefined();
    
    // Reset spy
    optimizeSpy.mockRestore();
  });
  
  test('should calculate strategy correlations', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Verify correlations were fetched
    expect(mockAlphaMemory.getCorrelationMatrix).toHaveBeenCalled();
    
    // Get correlation matrix
    const correlationMatrix = optimizer.correlationMatrix;
    
    // Verify correlation matrix
    expect(correlationMatrix).toBeDefined();
    expect(Object.keys(correlationMatrix).length).toBe(mockStrategies.length);
    
    // Verify telemetry was emitted
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'strategy_correlations_updated',
      expect.objectContaining({
        strategyCount: mockStrategies.length,
        highlyCorrelatedPairs: expect.any(Number)
      })
    );
  });
  
  test('should optimize portfolio and adjust allocations', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Perform optimization
    await optimizer.optimize();
    
    // Verify capital allocator was called
    expect(mockCapitalAllocator.updateAllocation).toHaveBeenCalled();
    
    // Verify telemetry was emitted
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'portfolio_optimization_completed',
      expect.objectContaining({
        optimizedStrategies: expect.any(Number),
        projectedSharpeRatio: expect.any(Number),
        portfolioVolatility: expect.any(Number)
      })
    );
  });
  
  test('should identify highly correlated strategies', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Set up a correlation matrix with highly correlated pairs
    const correlationMatrix = {
      'strategy-1': { 'strategy-2': 0.9, 'strategy-3': 0.3, 'strategy-4': 0.2, 'strategy-5': 0.1 },
      'strategy-2': { 'strategy-1': 0.9, 'strategy-3': 0.4, 'strategy-4': 0.3, 'strategy-5': 0.2 },
      'strategy-3': { 'strategy-1': 0.3, 'strategy-2': 0.4, 'strategy-4': 0.8, 'strategy-5': 0.3 },
      'strategy-4': { 'strategy-1': 0.2, 'strategy-2': 0.3, 'strategy-3': 0.8, 'strategy-5': 0.4 },
      'strategy-5': { 'strategy-1': 0.1, 'strategy-2': 0.2, 'strategy-3': 0.3, 'strategy-4': 0.4 }
    };
    
    // Mock the correlation matrix
    mockAlphaMemory.getCorrelationMatrix.mockResolvedValue(correlationMatrix);
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Find highly correlated pairs
    const highlyCorrelatedPairs = optimizer.findHighlyCorrelatedPairs();
    
    // Verify pairs were found
    expect(highlyCorrelatedPairs.length).toBe(2); // Should find strategy-1<->strategy-2 and strategy-3<->strategy-4
    
    // Verify the pairs are correct
    expect(highlyCorrelatedPairs).toContainEqual(
      expect.objectContaining({
        strategy1Id: 'strategy-1',
        strategy2Id: 'strategy-2',
        correlation: 0.9
      })
    );
    
    expect(highlyCorrelatedPairs).toContainEqual(
      expect.objectContaining({
        strategy1Id: 'strategy-3',
        strategy2Id: 'strategy-4',
        correlation: 0.8
      })
    );
  });
  
  test('should calculate expected portfolio metrics', async () => {
    // Load strategies with allocations
    await optimizer.loadStrategies();
    
    // Give strategies specific allocations for testing
    optimizer.strategies = optimizer.strategies.map((s, i) => ({
      ...s,
      capitalAllocation: (i + 1) / 15 // Allocations sum to 1
    }));
    
    // Calculate portfolio metrics
    const metrics = optimizer.calculatePortfolioMetrics();
    
    // Verify metrics were calculated
    expect(metrics).toBeDefined();
    expect(metrics.expectedSharpe).toBeGreaterThan(0);
    expect(metrics.portfolioVolatility).toBeGreaterThan(0);
    expect(metrics.diversificationScore).toBeGreaterThan(0);
    
    // Verify values are reasonable
    expect(metrics.expectedSharpe).toBeLessThan(3); // Realistic values
    expect(metrics.portfolioVolatility).toBeLessThan(1);
    expect(metrics.diversificationScore).toBeLessThanOrEqual(1);
  });
  
  test('should reduce allocation for highly correlated strategies', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Set up a correlation matrix with highly correlated pairs
    const correlationMatrix = {
      'strategy-1': { 'strategy-2': 0.9, 'strategy-3': 0.3, 'strategy-4': 0.2, 'strategy-5': 0.1 },
      'strategy-2': { 'strategy-1': 0.9, 'strategy-3': 0.4, 'strategy-4': 0.3, 'strategy-5': 0.2 },
      'strategy-3': { 'strategy-1': 0.3, 'strategy-2': 0.4, 'strategy-4': 0.3, 'strategy-5': 0.3 },
      'strategy-4': { 'strategy-1': 0.2, 'strategy-2': 0.3, 'strategy-3': 0.3, 'strategy-5': 0.4 },
      'strategy-5': { 'strategy-1': 0.1, 'strategy-2': 0.2, 'strategy-3': 0.3, 'strategy-4': 0.4 }
    };
    
    // Mock the correlation matrix
    mockAlphaMemory.getCorrelationMatrix.mockResolvedValue(correlationMatrix);
    
    // Give strategies equal allocations for testing
    optimizer.strategies = optimizer.strategies.map(s => ({
      ...s,
      capitalAllocation: 0.2 // 20% each
    }));
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Perform optimization
    await optimizer.optimize();
    
    // Get allocation updates
    const lastAllocationUpdate = optimizer.allocationUpdates[optimizer.allocationUpdates.length - 1];
    
    // Verify allocations were adjusted
    expect(lastAllocationUpdate).toBeDefined();
    
    // Find highly correlated strategy allocations
    const strategy1Allocation = lastAllocationUpdate.allocations.find(a => a.id === 'strategy-1').allocation;
    const strategy2Allocation = lastAllocationUpdate.allocations.find(a => a.id === 'strategy-2').allocation;
    
    // Find non-correlated strategy allocation 
    const strategy5Allocation = lastAllocationUpdate.allocations.find(a => a.id === 'strategy-5').allocation;
    
    // Verify that at least one of the highly correlated strategies got reduced allocation
    expect(Math.min(strategy1Allocation, strategy2Allocation)).toBeLessThan(0.2);
    
    // Verify that non-correlated strategy maintained or increased allocation
    expect(strategy5Allocation).toBeGreaterThanOrEqual(0.2);
  });
  
  test('should respect maximum portfolio volatility constraint', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Set strategies with high volatility
    optimizer.strategies = optimizer.strategies.map(s => ({
      ...s,
      metrics: {
        ...s.metrics,
        volatility: 0.3 // High volatility
      },
      capitalAllocation: 0.2 // Equal allocation
    }));
    
    // Reduce max volatility in config
    optimizer.config.maxPortfolioVolatility = 0.15;
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Perform optimization
    await optimizer.optimize();
    
    // Calculate resulting portfolio metrics
    const metrics = optimizer.calculatePortfolioMetrics();
    
    // Verify portfolio volatility is below maximum
    expect(metrics.portfolioVolatility).toBeLessThanOrEqual(optimizer.config.maxPortfolioVolatility);
  });
  
  test('should prefer strategies with higher Sharpe ratios', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Set strategies with varying Sharpe ratios
    optimizer.strategies = [
      { ...optimizer.strategies[0], metrics: { ...optimizer.strategies[0].metrics, sharpeRatio: 2.5 }, capitalAllocation: 0.2 },
      { ...optimizer.strategies[1], metrics: { ...optimizer.strategies[1].metrics, sharpeRatio: 1.5 }, capitalAllocation: 0.2 },
      { ...optimizer.strategies[2], metrics: { ...optimizer.strategies[2].metrics, sharpeRatio: 1.0 }, capitalAllocation: 0.2 },
      { ...optimizer.strategies[3], metrics: { ...optimizer.strategies[3].metrics, sharpeRatio: 0.8 }, capitalAllocation: 0.2 },
      { ...optimizer.strategies[4], metrics: { ...optimizer.strategies[4].metrics, sharpeRatio: 0.6 }, capitalAllocation: 0.2 }
    ];
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Perform optimization
    await optimizer.optimize();
    
    // Get allocation updates
    const lastAllocationUpdate = optimizer.allocationUpdates[optimizer.allocationUpdates.length - 1];
    
    // Get allocations sorted by strategy Sharpe ratio
    const allocations = optimizer.strategies.map(s => {
      const updatedAllocation = lastAllocationUpdate.allocations.find(a => a.id === s.id).allocation;
      return {
        id: s.id,
        sharpeRatio: s.metrics.sharpeRatio,
        allocation: updatedAllocation
      };
    }).sort((a, b) => b.sharpeRatio - a.sharpeRatio);
    
    // Verify higher Sharpe ratio strategies get higher allocations
    expect(allocations[0].allocation).toBeGreaterThan(allocations[allocations.length - 1].allocation);
  });
  
  test('should limit the number of active strategies', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Set max activated strategies
    optimizer.config.maxActivatedStrategies = 2;
    
    // Calculate correlations
    await optimizer.calculateCorrelations();
    
    // Perform optimization
    await optimizer.optimize();
    
    // Get allocation updates
    const lastAllocationUpdate = optimizer.allocationUpdates[optimizer.allocationUpdates.length - 1];
    
    // Count strategies with non-zero allocation
    const activeStrategies = lastAllocationUpdate.allocations.filter(a => a.allocation > 0);
    
    // Verify number of active strategies is limited
    expect(activeStrategies.length).toBeLessThanOrEqual(optimizer.config.maxActivatedStrategies);
  });
  
  test('should handle errors gracefully during optimization', async () => {
    // Load strategies
    await optimizer.loadStrategies();
    
    // Mock calculateCorrelations to throw error
    jest.spyOn(optimizer, 'calculateCorrelations').mockRejectedValueOnce(new Error('Correlation calculation failed'));
    
    // Perform optimization (should not throw)
    await optimizer.optimize();
    
    // Verify error was logged
    expect(logger.error).toHaveBeenCalled();
    
    // Verify telemetry was emitted for error
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'portfolio_optimization_error',
      expect.objectContaining({
        error: expect.stringContaining('Correlation calculation failed')
      })
    );
  });
}); 