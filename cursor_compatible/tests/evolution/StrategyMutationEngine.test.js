import { jest } from '@jest/globals';
import { StrategyMutationEngine } from '../../src/evolution/StrategyMutationEngine';
import { StrategyGenome } from '../../src/evolution/StrategyGenome';
import { AlphaMemory } from '../../src/memory/AlphaMemory';
import { BiasEngine } from '../../src/evolution/BiasEngine';
import { TelemetryBus } from '../../src/telemetry/TelemetryBus';
import { MutationEngine } from '../../src/evolution/MutationEngine';

// Mock dependencies
jest.mock('../../src/memory/AlphaMemory');
jest.mock('../../src/evolution/BiasEngine');
jest.mock('../../src/telemetry/TelemetryBus');
jest.mock('../../src/evolution/MutationEngine');
jest.mock('../../src/evolution/StrategyGenome');

describe('StrategyMutationEngine', () => {
  let engine;
  let mockAlphaMemory;
  let mockBiasEngine;
  let mockTelemetryBus;
  let mockMutationEngine;
  
  // Sample strategies for testing
  const sampleStrategies = [
    {
      id: 'strategy-1',
      generation: 1,
      parentIds: [],
      fitness: 0.75,
      metrics: {
        profitFactor: 1.5,
        sharpeRatio: 1.2,
        maxDrawdown: 0.15
      },
      parameters: { riskLevel: 'medium', timeframe: '1h' },
      isValid: () => true,
      clone: jest.fn().mockImplementation(function() { return this; }),
      mutate: jest.fn()
    },
    {
      id: 'strategy-2',
      generation: 2,
      parentIds: ['strategy-parent'],
      fitness: 0.85,
      metrics: {
        profitFactor: 1.8,
        sharpeRatio: 1.4,
        maxDrawdown: 0.12
      },
      parameters: { riskLevel: 'low', timeframe: '4h' },
      isValid: () => true,
      clone: jest.fn().mockImplementation(function() { return this; }),
      mutate: jest.fn()
    },
    {
      id: 'strategy-3',
      generation: 1,
      parentIds: [],
      fitness: 0.65,
      metrics: {
        profitFactor: 1.3,
        sharpeRatio: 1.0,
        maxDrawdown: 0.18
      },
      parameters: { riskLevel: 'high', timeframe: '15m' },
      isValid: () => true,
      clone: jest.fn().mockImplementation(function() { return this; }),
      mutate: jest.fn()
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
        generation: 0,
        parentIds: [],
        fitness: 0,
        metrics: {},
        parameters: {},
        isValid: () => true,
        clone: jest.fn().mockReturnThis(),
        mutate: jest.fn()
      };
    });
    
    // Setup mock implementations
    mockAlphaMemory = {
      getRecords: jest.fn().mockResolvedValue(
        sampleStrategies.map(strategy => ({ genome: strategy }))
      ),
      addStrategy: jest.fn().mockResolvedValue(true),
      getStrategy: jest.fn().mockImplementation((id) => {
        const strategy = sampleStrategies.find(s => s.id === id);
        return Promise.resolve(strategy || null);
      }),
      updateStrategy: jest.fn().mockResolvedValue(true)
    };
    
    mockBiasEngine = {
      calculateBiasScore: jest.fn().mockImplementation((strategy, regime) => {
        // Return different scores based on strategy ID for testing
        if (strategy.id === 'strategy-1') return 0.7;
        if (strategy.id === 'strategy-2') return 0.9;
        if (strategy.id === 'strategy-3') return 0.5;
        return 0.6;
      }),
      recordBias: jest.fn()
    };
    
    mockMutationEngine = {
      mutate: jest.fn().mockImplementation((genome) => {
        const newGenome = { ...genome };
        // Create superficial "mutation"
        newGenome.id = `${genome.id}-mutated`;
        return newGenome;
      }),
      crossover: jest.fn().mockImplementation((genomeA, genomeB) => {
        return {
          ...genomeA,
          id: `${genomeA.id}-${genomeB.id}-crossover`,
          parentIds: [genomeA.id, genomeB.id]
        };
      })
    };
    
    mockTelemetryBus = {
      emitEvent: jest.fn(),
      emitError: jest.fn(),
      recordMetric: jest.fn()
    };
    
    // Setup singleton mocks
    AlphaMemory.getInstance.mockReturnValue(mockAlphaMemory);
    BiasEngine.getInstance.mockReturnValue(mockBiasEngine);
    MutationEngine.getInstance.mockReturnValue(mockMutationEngine);
    TelemetryBus.getInstance.mockReturnValue(mockTelemetryBus);
    
    // Create engine with test config
    engine = StrategyMutationEngine.getInstance({
      mutationIntervalMs: 3600000,
      maxStrategiesInPool: 10,
      offspringPerCycle: 2,
      minPerformanceThreshold: 0.5,
      emitDetailedTelemetry: true
    });
  });
  
  afterEach(() => {
    if (engine.isRunning) {
      engine.stop();
    }
  });
  
  test('should create a singleton instance', () => {
    const anotherInstance = StrategyMutationEngine.getInstance();
    expect(anotherInstance).toBe(engine);
  });
  
  test('should initialize with correct configuration', () => {
    expect(engine.getConfig().maxStrategiesInPool).toBe(10);
    expect(engine.getConfig().offspringPerCycle).toBe(2);
    expect(engine.getConfig().emitDetailedTelemetry).toBe(true);
  });
  
  test('should start and stop mutation cycles', async () => {
    // Mock executeMutationCycle
    engine.executeMutationCycle = jest.fn().mockResolvedValue({
      offspringIds: ['new-strategy-1', 'new-strategy-2'],
      timestamp: Date.now()
    });
    
    // Start engine
    await engine.start();
    expect(engine.isRunning).toBe(true);
    
    // Stop engine
    engine.stop();
    expect(engine.isRunning).toBe(false);
  });
  
  test('should execute a full mutation cycle', async () => {
    // Setup mocks for specific behavior
    mockAlphaMemory.getRecords.mockResolvedValue(
      sampleStrategies.map(strategy => ({ genome: strategy }))
    );
    
    // Execute mutation cycle
    const result = await engine.executeMutationCycle();
    
    // Verify results
    expect(result.offspringIds.length).toBeGreaterThan(0);
    expect(mockAlphaMemory.addStrategy).toHaveBeenCalled();
    
    // Check telemetry
    expect(mockTelemetryBus.emitEvent).toHaveBeenCalledWith(
      'mutation:cycle:completed',
      expect.any(Object)
    );
  });
  
  test('should select parent strategies based on fitness and bias', async () => {
    // We need to access a private method, use any to bypass TypeScript
    const selectParents = engine.selectParentStrategies.bind(engine);
    
    // Call method with sample strategies
    const parents = await selectParents("BullishTrend", 2);
    
    // Verify selection
    expect(parents.length).toBe(2);
    
    // Should select strategy-2 (highest combined fitness/bias) and one other
    const hasStrategy2 = parents.some(p => p.id === 'strategy-2');
    expect(hasStrategy2).toBe(true);
    
    // Bias engine should be consulted
    expect(mockBiasEngine.calculateBiasScore).toHaveBeenCalled();
  });
  
  test('should prune underperforming strategies', async () => {
    // Modify one strategy to be below threshold
    const lowPerformanceStrategy = { ...sampleStrategies[2], fitness: 0.2 };
    mockAlphaMemory.getRecords.mockResolvedValue([
      { genome: sampleStrategies[0] },
      { genome: sampleStrategies[1] },
      { genome: lowPerformanceStrategy }
    ]);
    
    // Execute mutation cycle which should include pruning
    await engine.executeMutationCycle();
    
    // Verify the low-performing strategy was pruned
    expect(mockTelemetryBus.emitEvent).toHaveBeenCalledWith(
      'mutation:strategy:pruned',
      expect.objectContaining({
        strategyId: lowPerformanceStrategy.id
      })
    );
  });
  
  test('should handle errors gracefully during mutation', async () => {
    // Make alphaMemory throw an error
    mockAlphaMemory.getRecords.mockRejectedValue(new Error('Test error'));
    
    // Execute mutation cycle
    const result = await engine.executeMutationCycle();
    
    // Should return empty results but not crash
    expect(result.offspringIds).toEqual([]);
    
    // Should emit error telemetry
    expect(mockTelemetryBus.emitError).toHaveBeenCalledWith(
      'mutation:cycle:error',
      expect.objectContaining({
        message: expect.stringContaining('Test error')
      })
    );
  });
  
  test('should load initial strategies', async () => {
    // Mock the getStrategy calls
    mockAlphaMemory.getStrategy.mockImplementation((id) => {
      const strategy = sampleStrategies.find(s => s.id === id);
      return Promise.resolve(strategy);
    });
    
    // Test loading initial strategies
    const result = await engine.loadInitialStrategies(['strategy-1', 'strategy-2']);
    
    // Should return the loaded strategies
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('strategy-1');
    expect(result[1].id).toBe('strategy-2');
    
    // Check telemetry
    expect(mockTelemetryBus.emitEvent).toHaveBeenCalledWith(
      'mutation:strategy:loaded',
      expect.any(Object)
    );
  });
  
  test('should update metadata during mutation cycle', async () => {
    // Execute mutation cycle
    await engine.executeMutationCycle();
    
    // Get generation metadata
    const metadata = engine.getGenerationMetadata();
    
    // Verify metadata was updated
    expect(metadata.currentGeneration).toBeGreaterThan(0);
    expect(metadata.totalStrategiesEvaluated).toBeGreaterThan(0);
    expect(metadata.bestFitness).toBeGreaterThan(0);
  });
}); 