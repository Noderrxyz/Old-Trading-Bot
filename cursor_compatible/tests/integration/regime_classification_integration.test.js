import { jest } from '@jest/globals';
import { MarketRegimeClassifier } from '../../src/regime/MarketRegimeClassifier';
import { RegimeTransitionEngine } from '../../src/regime/RegimeTransitionEngine';
import { RegimeClassificationIntegration } from '../../src/integration/RegimeClassificationIntegration';
import { MarketRegime, RegimeTransitionState } from '../../src/regime/MarketRegimeTypes';

// Mock dependencies
jest.mock('../../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    }
  };
});

jest.mock('../../src/utils/logger', () => {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
  };
});

jest.mock('../../src/capital/RegimeCapitalAllocator', () => {
  return {
    RegimeCapitalAllocator: {
      getInstance: jest.fn().mockReturnValue({
        reallocate: jest.fn(),
        onRegimeChange: jest.fn()
      })
    }
  };
});

jest.mock('../../src/optimizer/StrategyPortfolioOptimizer', () => {
  return {
    StrategyPortfolioOptimizer: {
      getInstance: jest.fn().mockReturnValue({
        runOptimization: jest.fn()
      })
    }
  };
});

jest.mock('../../src/integration/AdaptiveIntelligenceSystem', () => {
  return {
    AdaptiveIntelligenceSystem: {
      getInstance: jest.fn().mockReturnValue({
        runAllocationCycle: jest.fn(),
        runOptimizationCycle: jest.fn()
      })
    }
  };
});

describe('Regime Classification Integration Test', () => {
  let classificationIntegration;
  let capitalAllocator;
  let portfolioOptimizer;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Clear existing instances
    RegimeClassificationIntegration.instance = null;
    MarketRegimeClassifier.instance = null;
    RegimeTransitionEngine.instance = null;
    
    // Get mocked components
    capitalAllocator = require('../../src/capital/RegimeCapitalAllocator').RegimeCapitalAllocator.getInstance();
    portfolioOptimizer = require('../../src/optimizer/StrategyPortfolioOptimizer').StrategyPortfolioOptimizer.getInstance();
    
    // Create integration with test config
    classificationIntegration = RegimeClassificationIntegration.getInstance({
      defaultMarketSymbol: 'BTC/USD',
      additionalMarketSymbols: ['ETH/USD'],
      classificationIntervalMs: 1000, // 1 second for testing
      forceReallocationOnRegimeChange: true,
      forceOptimizationOnRegimeChange: true,
      emitDetailedTelemetry: false
    });
  });
  
  test('should classify markets on cycle run', () => {
    // Spy on classifyMarket
    const classifySpy = jest.spyOn(classificationIntegration, 'classifyMarket');
    
    // Run a classification cycle
    classificationIntegration.runClassificationCycle();
    
    // Should classify both markets
    expect(classifySpy).toHaveBeenCalledWith('BTC/USD');
    expect(classifySpy).toHaveBeenCalledWith('ETH/USD');
    expect(classifySpy).toHaveBeenCalledTimes(2);
  });
  
  test('should start and stop classification cycles', () => {
    // Mock setInterval and clearInterval
    jest.useFakeTimers();
    
    // Spy on classifyMarket
    const classifySpy = jest.spyOn(classificationIntegration, 'classifyMarket');
    
    // Start the integration
    classificationIntegration.start();
    
    // Should run immediate classification
    expect(classifySpy).toHaveBeenCalled();
    
    // Reset the spy count
    classifySpy.mockClear();
    
    // Advance timer
    jest.advanceTimersByTime(1000);
    
    // Should run another cycle
    expect(classifySpy).toHaveBeenCalled();
    
    // Stop the integration
    classificationIntegration.stop();
    
    // Reset the spy count
    classifySpy.mockClear();
    
    // Advance timer again
    jest.advanceTimersByTime(1000);
    
    // Should not run another cycle
    expect(classifySpy).not.toHaveBeenCalled();
    
    // Clean up
    jest.useRealTimers();
  });
  
  test('should trigger actions on regime transitions', () => {
    // Get the transition listener
    const transitionListener = jest.fn();
    
    // Manually get the transition engine and register our listener
    const transitionEngine = RegimeTransitionEngine.getInstance();
    transitionEngine.onTransition(transitionListener);
    
    // Simulate different regime classifications
    const bullishFeatures = {
      price: 50000,
      returns1d: 0.05,
      returns5d: 0.15,
      returns20d: 0.30,
      volatility1d: 0.02,
      volatility5d: 0.03,
      volatility20d: 0.04,
      volumeRatio1d: 1.2,
      volumeRatio5d: 1.1,
      rsi14: 75,
      atr14: 2.5,
      bbWidth: 0.8,
      macdHistogram: 0.5,
      advanceDeclineRatio: 1.5,
      marketCap: 1000000000
    };
    
    const bearishFeatures = {
      price: 40000,
      returns1d: -0.05,
      returns5d: -0.15,
      returns20d: -0.30,
      volatility1d: 0.03,
      volatility5d: 0.04,
      volatility20d: 0.05,
      volumeRatio1d: 1.3,
      volumeRatio5d: 1.2,
      rsi14: 25,
      atr14: 3.0,
      bbWidth: 0.9,
      macdHistogram: -0.4,
      advanceDeclineRatio: 0.6,
      marketCap: 900000000
    };
    
    // Mock getMarketFeatures to return our test data
    classificationIntegration.getMarketFeatures = jest.fn()
      .mockReturnValueOnce(bullishFeatures)
      .mockReturnValueOnce(bullishFeatures)
      .mockReturnValueOnce(bearishFeatures)
      .mockReturnValueOnce(bearishFeatures);
    
    // Run classification cycles
    classificationIntegration.runClassificationCycle();
    
    // This should now have a baseline bullish regime
    const currentRegime = classificationIntegration.getCurrentRegime();
    expect(currentRegime.primaryRegime).toBe(MarketRegime.BullishTrend);
    
    // Run another cycle with bearish features
    classificationIntegration.runClassificationCycle();
    
    // Should have triggered a transition
    expect(transitionListener).toHaveBeenCalled();
    
    // Should have triggered reallocation and optimization
    expect(capitalAllocator.reallocate).toHaveBeenCalled();
    expect(portfolioOptimizer.runOptimization).toHaveBeenCalled();
  });
  
  test('should handle errors gracefully', () => {
    // Mock a failure in classifyMarket
    const error = new Error('Test error');
    jest.spyOn(classificationIntegration, 'getMarketFeatures').mockImplementation(() => {
      throw error;
    });
    
    // Should not throw even though there's an error
    expect(() => classificationIntegration.runClassificationCycle()).not.toThrow();
    
    // Should still be able to get current regime (defaults to unknown)
    const currentRegime = classificationIntegration.getCurrentRegime();
    expect(currentRegime.primaryRegime).toBe(MarketRegime.Unknown);
  });
}); 