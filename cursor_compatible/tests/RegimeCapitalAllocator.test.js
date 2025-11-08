import { jest } from '@jest/globals';
import { RegimeCapitalAllocator } from '../src/capital/RegimeCapitalAllocator';
import { RegimeClassifier } from '../src/regime/RegimeClassifier';
import { AlphaMemory } from '../src/memory/AlphaMemory';
import { logger } from '../src/utils/logger';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';

// Mock dependencies
jest.mock('../src/regime/RegimeClassifier');
jest.mock('../src/memory/AlphaMemory');
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

// Helper to create mock strategies with regime performance
const createMockStrategy = (id, regimePerformance = {}) => ({
  id,
  parameters: { param1: 0.5, param2: 10 },
  metrics: {
    sharpeRatio: 1.2,
    drawdown: 0.1,
    winRate: 0.65,
    regimePerformance: {
      BullishTrend: { sharpeRatio: 1.8, drawdown: 0.05, winRate: 0.75, ...regimePerformance.BullishTrend },
      BearishTrend: { sharpeRatio: 0.9, drawdown: 0.15, winRate: 0.55, ...regimePerformance.BearishTrend },
      Rangebound: { sharpeRatio: 1.1, drawdown: 0.08, winRate: 0.62, ...regimePerformance.Rangebound },
      VolatilityExpansion: { sharpeRatio: 1.3, drawdown: 0.12, winRate: 0.68, ...regimePerformance.VolatilityExpansion }
    }
  },
  generation: 1,
  createdAt: Date.now(),
  parentIds: [],
  capitalAllocation: 0
});

describe('RegimeCapitalAllocator', () => {
  // Test setup
  let allocator;
  let mockAlphaMemory;
  let mockRegimeClassifier;
  let mockStrategies;
  let telemetryBus;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock strategies with regime-specific performance
    mockStrategies = [
      // Good in bullish trends
      createMockStrategy('strategy-1', {
        BullishTrend: { sharpeRatio: 2.0, drawdown: 0.03, winRate: 0.8 }
      }),
      // Good in bearish trends
      createMockStrategy('strategy-2', {
        BearishTrend: { sharpeRatio: 1.8, drawdown: 0.09, winRate: 0.7 }
      }),
      // Good in rangebound markets
      createMockStrategy('strategy-3', {
        Rangebound: { sharpeRatio: 1.9, drawdown: 0.04, winRate: 0.75 }
      }),
      // Good in volatility expansion
      createMockStrategy('strategy-4', {
        VolatilityExpansion: { sharpeRatio: 2.1, drawdown: 0.08, winRate: 0.78 }
      }),
      // Balanced across regimes
      createMockStrategy('strategy-5', {
        BullishTrend: { sharpeRatio: 1.6, drawdown: 0.06, winRate: 0.7 },
        BearishTrend: { sharpeRatio: 1.5, drawdown: 0.08, winRate: 0.68 },
        Rangebound: { sharpeRatio: 1.7, drawdown: 0.05, winRate: 0.72 },
        VolatilityExpansion: { sharpeRatio: 1.6, drawdown: 0.07, winRate: 0.71 }
      }),
    ];
    
    // Setup mocks
    mockAlphaMemory = {
      getStrategies: jest.fn().mockResolvedValue(mockStrategies),
      getStrategyById: jest.fn().mockImplementation((id) => 
        Promise.resolve(mockStrategies.find(s => s.id === id))),
      saveStrategy: jest.fn().mockImplementation((strategy) => 
        Promise.resolve({ ...strategy })),
      updateStrategyAllocation: jest.fn().mockImplementation((id, allocation) => 
        Promise.resolve({ id, capitalAllocation: allocation }))
    };
    
    mockRegimeClassifier = {
      getCurrentRegime: jest.fn().mockResolvedValue({
        regime: 'BullishTrend',
        confidence: 0.85,
        features: {
          trendStrength: 0.75,
          volatility: 0.2,
          momentum: 0.8
        },
        timestamp: Date.now()
      }),
      getRegimeHistory: jest.fn().mockResolvedValue([
        { regime: 'BullishTrend', confidence: 0.82, timestamp: Date.now() - 3600000 },
        { regime: 'BullishTrend', confidence: 0.85, timestamp: Date.now() }
      ]),
      getRegimeProbabilities: jest.fn().mockResolvedValue({
        BullishTrend: 0.65,
        BearishTrend: 0.15,
        Rangebound: 0.12,
        VolatilityExpansion: 0.08
      })
    };
    
    // Mock constructor implementations
    RegimeClassifier.mockImplementation(() => mockRegimeClassifier);
    AlphaMemory.mockImplementation(() => mockAlphaMemory);
    
    // Setup telemetry
    telemetryBus = TelemetryBus.getInstance();
    
    // Create allocator instance
    allocator = new RegimeCapitalAllocator({
      rebalancingIntervalMs: 1000,
      regimeBias: 0.7,
      minStrategiesPerRegime: 2,
      reserveCapitalPercentage: 0.1,
      defaultAllocation: 0.05
    });
  });
  
  afterEach(() => {
    // Clean up any intervals
    allocator.stopRebalancing();
    jest.useRealTimers();
  });
  
  test('should initialize with default config values', () => {
    const defaultAllocator = new RegimeCapitalAllocator();
    expect(defaultAllocator.config).toBeDefined();
    expect(defaultAllocator.config.rebalancingIntervalMs).toBeGreaterThan(0);
    expect(defaultAllocator.config.regimeBias).toBeGreaterThan(0);
    expect(defaultAllocator.config.minStrategiesPerRegime).toBeGreaterThan(0);
  });
  
  test('should override default config with provided values', () => {
    const customConfig = {
      rebalancingIntervalMs: 2000,
      regimeBias: 0.8,
      minStrategiesPerRegime: 3,
      reserveCapitalPercentage: 0.15
    };
    
    const customAllocator = new RegimeCapitalAllocator(customConfig);
    
    expect(customAllocator.config.rebalancingIntervalMs).toBe(customConfig.rebalancingIntervalMs);
    expect(customAllocator.config.regimeBias).toBe(customConfig.regimeBias);
    expect(customAllocator.config.minStrategiesPerRegime).toBe(customConfig.minStrategiesPerRegime);
    expect(customAllocator.config.reserveCapitalPercentage).toBe(customConfig.reserveCapitalPercentage);
  });
  
  test('should load strategies and classify by regime', async () => {
    // Load strategies
    await allocator.loadStrategies();
    
    // Verify strategies were loaded
    expect(mockAlphaMemory.getStrategies).toHaveBeenCalled();
    expect(allocator.strategies.length).toBe(mockStrategies.length);
    
    // Verify telemetry was emitted
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'regime_capital_allocator_initialized', 
      expect.objectContaining({
        strategyCount: mockStrategies.length
      })
    );
    
    // Classify by regime
    const regimeStrategies = await allocator.classifyStrategiesByRegime();
    
    // Verify classification
    expect(regimeStrategies).toBeDefined();
    expect(Object.keys(regimeStrategies)).toContain('BullishTrend');
    expect(Object.keys(regimeStrategies)).toContain('BearishTrend');
    expect(Object.keys(regimeStrategies)).toContain('Rangebound');
    expect(Object.keys(regimeStrategies)).toContain('VolatilityExpansion');
    
    // Verify classification was correct
    expect(regimeStrategies.BullishTrend).toContainEqual(
      expect.objectContaining({ id: 'strategy-1' })
    );
    expect(regimeStrategies.BearishTrend).toContainEqual(
      expect.objectContaining({ id: 'strategy-2' })
    );
  });
  
  test('should start and stop rebalancing cycle', async () => {
    jest.useFakeTimers();
    
    // Spy on rebalance
    const rebalanceSpy = jest.spyOn(allocator, 'rebalance');
    
    // Start rebalancing
    await allocator.startRebalancing();
    
    // Verify rebalancing started
    expect(allocator.rebalancingIntervalId).toBeDefined();
    
    // Advance timer to trigger rebalance
    jest.advanceTimersByTime(allocator.config.rebalancingIntervalMs);
    
    // Verify rebalance was called
    expect(rebalanceSpy).toHaveBeenCalled();
    
    // Stop rebalancing
    allocator.stopRebalancing();
    
    // Verify rebalancing stopped
    expect(allocator.rebalancingIntervalId).toBeUndefined();
    
    // Reset spy
    rebalanceSpy.mockRestore();
  });
  
  test('should rebalance capital based on current regime', async () => {
    // Load strategies
    await allocator.loadStrategies();
    
    // Mock current regime
    mockRegimeClassifier.getCurrentRegime.mockResolvedValue({
      regime: 'BullishTrend',
      confidence: 0.85,
      features: {
        trendStrength: 0.75,
        volatility: 0.2,
        momentum: 0.8
      },
      timestamp: Date.now()
    });
    
    // Perform rebalance
    await allocator.rebalance();
    
    // Verify regime was checked
    expect(mockRegimeClassifier.getCurrentRegime).toHaveBeenCalled();
    expect(mockRegimeClassifier.getRegimeProbabilities).toHaveBeenCalled();
    
    // Verify allocations were updated
    expect(mockAlphaMemory.updateStrategyAllocation).toHaveBeenCalled();
    
    // Verify telemetry was emitted
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'capital_allocation_rebalanced',
      expect.objectContaining({
        regime: 'BullishTrend',
        allocationUpdates: expect.any(Number),
        reserveCapital: expect.any(Number)
      })
    );
    
    // Get allocation details
    const allocationDetails = allocator.getCurrentAllocationDetails();
    
    // Verify total allocation doesn't exceed 100%
    const totalAllocation = allocationDetails.strategies.reduce(
      (sum, s) => sum + s.allocation, 
      allocationDetails.reserveCapital
    );
    expect(totalAllocation).toBeCloseTo(1.0, 5);
    
    // Verify strategies good at current regime have higher allocation
    const bullishStrategy = allocationDetails.strategies.find(s => s.id === 'strategy-1');
    const bearishStrategy = allocationDetails.strategies.find(s => s.id === 'strategy-2');
    expect(bullishStrategy.allocation).toBeGreaterThan(bearishStrategy.allocation);
  });
  
  test('should handle regime transitions with proper reallocation', async () => {
    // Load strategies
    await allocator.loadStrategies();
    
    // First rebalance with bullish regime
    mockRegimeClassifier.getCurrentRegime.mockResolvedValue({
      regime: 'BullishTrend',
      confidence: 0.85,
      timestamp: Date.now()
    });
    
    await allocator.rebalance();
    
    // Record allocations after first rebalance
    const firstAllocationDetails = allocator.getCurrentAllocationDetails();
    const bullishAllocations = firstAllocationDetails.strategies.map(s => ({ 
      id: s.id, 
      allocation: s.allocation 
    }));
    
    // Change regime to bearish
    mockRegimeClassifier.getCurrentRegime.mockResolvedValue({
      regime: 'BearishTrend',
      confidence: 0.80,
      timestamp: Date.now() + 1000
    });
    
    // Second rebalance with bearish regime
    await allocator.rebalance();
    
    // Record allocations after second rebalance
    const secondAllocationDetails = allocator.getCurrentAllocationDetails();
    const bearishAllocations = secondAllocationDetails.strategies.map(s => ({ 
      id: s.id, 
      allocation: s.allocation 
    }));
    
    // Verify allocations changed after regime transition
    // Bearish strategy should have higher allocation now
    const bullishStrategy = bullishAllocations.find(s => s.id === 'strategy-1');
    const bearishStrategy = bearishAllocations.find(s => s.id === 'strategy-2');
    
    const bullishStrategyNewAllocation = bearishAllocations.find(s => s.id === 'strategy-1');
    const bearishStrategyNewAllocation = bearishAllocations.find(s => s.id === 'strategy-2');
    
    // Verify that bearish strategy gained allocation
    expect(bearishStrategyNewAllocation.allocation).toBeGreaterThan(bearishStrategy.allocation);
    
    // Verify that bullish strategy lost allocation
    expect(bullishStrategyNewAllocation.allocation).toBeLessThan(bullishStrategy.allocation);
    
    // Verify telemetry was emitted for regime change
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'regime_transition_detected',
      expect.objectContaining({
        fromRegime: 'BullishTrend',
        toRegime: 'BearishTrend',
        confidence: 0.80
      })
    );
  });
  
  test('should allocate reserve capital in volatile regimes', async () => {
    // Load strategies
    await allocator.loadStrategies();
    
    // Set volatile regime
    mockRegimeClassifier.getCurrentRegime.mockResolvedValue({
      regime: 'VolatilityExpansion',
      confidence: 0.75,
      timestamp: Date.now()
    });
    
    // Perform rebalance
    await allocator.rebalance();
    
    // Get allocation details
    const allocationDetails = allocator.getCurrentAllocationDetails();
    
    // Verify reserve capital is higher in volatile regimes
    expect(allocationDetails.reserveCapital).toBeGreaterThan(allocator.config.reserveCapitalPercentage);
    
    // Verify volatility-oriented strategies have higher allocation
    const volatilityStrategy = allocationDetails.strategies.find(s => s.id === 'strategy-4');
    const bullishStrategy = allocationDetails.strategies.find(s => s.id === 'strategy-1');
    expect(volatilityStrategy.allocation).toBeGreaterThan(bullishStrategy.allocation);
  });
  
  test('should handle low confidence regimes with balanced allocation', async () => {
    // Load strategies
    await allocator.loadStrategies();
    
    // Set low confidence regime
    mockRegimeClassifier.getCurrentRegime.mockResolvedValue({
      regime: 'BullishTrend',
      confidence: 0.3, // Low confidence
      timestamp: Date.now()
    });
    
    // Set balanced regime probabilities
    mockRegimeClassifier.getRegimeProbabilities.mockResolvedValue({
      BullishTrend: 0.3,
      BearishTrend: 0.25,
      Rangebound: 0.25,
      VolatilityExpansion: 0.2
    });
    
    // Perform rebalance
    await allocator.rebalance();
    
    // Get allocation details
    const allocationDetails = allocator.getCurrentAllocationDetails();
    
    // Verify reserve capital is higher with low confidence
    expect(allocationDetails.reserveCapital).toBeGreaterThan(allocator.config.reserveCapitalPercentage);
    
    // Verify allocations are more balanced
    const allocations = allocationDetails.strategies.map(s => s.allocation);
    const maxAllocation = Math.max(...allocations);
    const minAllocation = Math.min(...allocations);
    const allocationDelta = maxAllocation - minAllocation;
    
    // Delta should be smaller, indicating more balanced allocation
    expect(allocationDelta).toBeLessThan(0.2);
    
    // Verify balanced strategy gets higher allocation
    const balancedStrategy = allocationDetails.strategies.find(s => s.id === 'strategy-5');
    expect(balancedStrategy.allocation).toBeGreaterThan(allocator.config.defaultAllocation);
  });
  
  test('should handle errors gracefully during rebalance', async () => {
    // Load strategies
    await allocator.loadStrategies();
    
    // Mock getCurrentRegime to throw error
    mockRegimeClassifier.getCurrentRegime.mockRejectedValueOnce(new Error('Regime classification failed'));
    
    // Perform rebalance (should not throw)
    await allocator.rebalance();
    
    // Verify error was logged
    expect(logger.error).toHaveBeenCalled();
    
    // Verify telemetry was emitted for error
    expect(telemetryBus.emit).toHaveBeenCalledWith(
      'capital_allocation_error',
      expect.objectContaining({
        error: expect.stringContaining('Regime classification failed')
      })
    );
    
    // Verify allocations remained unchanged (default allocations maintained)
    const allocationDetails = allocator.getCurrentAllocationDetails();
    allocationDetails.strategies.forEach(strategy => {
      expect(strategy.allocation).toBe(allocator.config.defaultAllocation);
    });
  });
}); 