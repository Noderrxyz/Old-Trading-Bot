/**
 * Integration test for adaptive modules
 * 
 * This test verifies that the three main adaptive modules can work together:
 * 1. StrategyMutationEngine
 * 2. RegimeCapitalAllocator 
 * 3. StrategyPortfolioOptimizer
 */

import { StrategyMutationEngine } from '../src/evolution/StrategyMutationEngine.js';
import { RegimeCapitalAllocator } from '../src/capital/RegimeCapitalAllocator.js';
import { StrategyPortfolioOptimizer } from '../src/strategy/StrategyPortfolioOptimizer.js';
import { TelemetryBus } from '../src/telemetry/TelemetryBus.js';

// Mock data
const mockStrategies = [
  {
    id: 'strategy-1',
    parameters: { param1: 0.5, param2: 10 },
    metrics: { sharpeRatio: 1.2, drawdown: 0.1, winRate: 0.65 }
  },
  {
    id: 'strategy-2',
    parameters: { param1: 0.7, param2: 8 },
    metrics: { sharpeRatio: 1.4, drawdown: 0.12, winRate: 0.62 }
  },
  {
    id: 'strategy-3',
    parameters: { param1: 0.3, param2: 12 },
    metrics: { sharpeRatio: 0.9, drawdown: 0.15, winRate: 0.58 }
  }
];

describe('Adaptive Module Integration', () => {
  let telemetryEvents = [];
  let mutationEngine;
  let capitalAllocator;
  let portfolioOptimizer;
  
  beforeEach(() => {
    // Capture telemetry events
    telemetryEvents = [];
    const mockTelemetryBus = {
      emit: (event, data) => {
        telemetryEvents.push({ event, data });
        console.log(`Telemetry event: ${event}`);
      },
      getInstance: () => mockTelemetryBus
    };
    
    // Replace the TelemetryBus.getInstance with our mock
    TelemetryBus.getInstance = jest.fn().mockImplementation(() => mockTelemetryBus);
    
    // Initialize modules with test configurations
    mutationEngine = StrategyMutationEngine.getInstance({
      mutationIntervalMs: 100, // Fast for testing
      maxStrategiesInPool: 10,
      offspringPerCycle: 2
    });
    
    capitalAllocator = RegimeCapitalAllocator.getInstance({
      reallocationIntervalMs: 100, // Fast for testing
      maxTotalAllocation: 0.8
    });
    
    portfolioOptimizer = StrategyPortfolioOptimizer.getInstance({
      optimizationIntervalMs: 100, // Fast for testing
      riskBudget: 0.1
    });
  });
  
  test('Modules should initialize and emit telemetry', async () => {
    // Check initialization telemetry
    const initEvents = telemetryEvents.filter(
      e => e.event.includes('initialized') || e.event.includes('started')
    );
    
    expect(initEvents.length).toBeGreaterThan(0);
  });
  
  test('Modules should handle error conditions gracefully', async () => {
    // Simulate error conditions and check error handling
    try {
      // Execute operations that might fail
      await mutationEngine.executeMutationCycle();
      capitalAllocator.forceReallocation();
      await portfolioOptimizer.optimize();
      
      // Look for error-related telemetry
      const errorEvents = telemetryEvents.filter(
        e => e.event.includes('error') || e.event.includes('failed')
      );
      
      // We expect some error handling due to missing dependencies
      expect(errorEvents.length).toBeGreaterThan(0);
    } catch (error) {
      // This should not happen - our error handling should prevent uncaught exceptions
      fail('Uncaught exception: ' + error.message);
    }
  });
  
  test('Modules should form a coherent feedback loop', async () => {
    // Mock the feedback loop integration
    
    // 1. Mutation engine generates new strategies
    await mutationEngine.executeMutationCycle();
    
    // 2. Capital allocator assigns capital
    const allocations = capitalAllocator.forceReallocation();
    
    // 3. Portfolio optimizer balances the portfolio
    const optimization = await portfolioOptimizer.optimize();
    
    // Check for telemetry events indicating the full cycle
    const cycleEvents = telemetryEvents.filter(
      e => e.event.includes('cycle') || e.event.includes('allocation') || e.event.includes('optimization')
    );
    
    expect(cycleEvents.length).toBeGreaterThan(0);
  });
}); 