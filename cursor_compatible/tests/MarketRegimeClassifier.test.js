import { jest } from '@jest/globals';
import { MarketRegimeClassifier } from '../src/regime/MarketRegimeClassifier';
import { MarketRegime, RegimeTransitionState } from '../src/regime/MarketRegimeTypes';

// Mock the TelemetryBus
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    }
  };
});

// Mock the logger
jest.mock('../src/utils/logger', () => {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
  };
});

describe('MarketRegimeClassifier', () => {
  let classifier;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Get classifier instance
    classifier = MarketRegimeClassifier.getInstance({
      minimumConfidence: 0.5,
      emitDetailedTelemetry: false
    });
    
    // Reset history to ensure tests are independent
    classifier.resetAllHistory();
  });
  
  test('should correctly classify bullish trend regime', () => {
    const features = {
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
    
    const result = classifier.classifyRegime('BTC/USD', features);
    
    expect(result.primaryRegime).toBe(MarketRegime.BullishTrend);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.transitionState).toBe(RegimeTransitionState.Developing);
    expect(result.timestamp).toBeDefined();
    expect(result.features).toEqual(features);
  });
  
  test('should correctly classify bearish trend regime', () => {
    const features = {
      price: 40000,
      returns1d: -0.03,
      returns5d: -0.12,
      returns20d: -0.25,
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
    
    const result = classifier.classifyRegime('BTC/USD', features);
    
    expect(result.primaryRegime).toBe(MarketRegime.BearishTrend);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.transitionState).toBe(RegimeTransitionState.Developing);
  });
  
  test('should correctly classify high volatility regime', () => {
    const features = {
      price: 45000,
      returns1d: 0.08,
      returns5d: -0.05,
      returns20d: 0.02,
      volatility1d: 0.06,
      volatility5d: 0.08,
      volatility20d: 0.07,
      volumeRatio1d: 2.0,
      volumeRatio5d: 1.8,
      rsi14: 60,
      atr14: 5.0,
      bbWidth: 1.5,
      macdHistogram: 0.1,
      advanceDeclineRatio: 1.0,
      marketCap: 950000000,
      vix: 35
    };
    
    const result = classifier.classifyRegime('BTC/USD', features);
    
    expect(result.primaryRegime).toBe(MarketRegime.HighVolatility);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
  
  test('should correctly classify rangebound regime', () => {
    const features = {
      price: 45000,
      returns1d: 0.01,
      returns5d: -0.01,
      returns20d: 0.005,
      volatility1d: 0.01,
      volatility5d: 0.015,
      volatility20d: 0.02,
      volumeRatio1d: 0.8,
      volumeRatio5d: 0.9,
      rsi14: 50,
      atr14: 1.5,
      bbWidth: 0.4,
      macdHistogram: 0.05,
      advanceDeclineRatio: 1.0,
      marketCap: 950000000
    };
    
    const result = classifier.classifyRegime('BTC/USD', features);
    
    expect([MarketRegime.Rangebound, MarketRegime.LowVolatility, MarketRegime.RangeboundLowVol])
      .toContain(result.primaryRegime);
  });
  
  test('should track regime transitions', () => {
    // First classification (bullish)
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
    
    classifier.classifyRegime('BTC/USD', bullishFeatures);
    
    // Second classification (bearish) - this should trigger a regime change
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
      macdHistogram: -0.6,
      advanceDeclineRatio: 0.5,
      marketCap: 800000000
    };
    
    // Simulate multiple classifications to confirm the transition
    for (let i = 0; i < 5; i++) {
      classifier.classifyRegime('BTC/USD', bearishFeatures);
    }
    
    // Get history
    const history = classifier.getRegimeHistory('BTC/USD');
    
    expect(history).toBeDefined();
    expect(history.classifications.length).toBeGreaterThan(0);
    expect(history.classifications[0].primaryRegime).toBe(MarketRegime.BearishTrend);
    expect(classifier.hasRegimeChanged('BTC/USD')).toBe(true);
  });
  
  test('should handle error conditions gracefully', () => {
    // Missing required features
    const incompleteFeatures = {
      price: 45000,
      // Missing most fields
      returns1d: 0.01
    };
    
    const result = classifier.classifyRegime('BTC/USD', incompleteFeatures);
    
    // Should default to unknown with low confidence
    expect(result.primaryRegime).toBe(MarketRegime.Unknown);
    expect(result.confidence).toBeLessThan(0.5);
    
    // Functions should not throw with invalid inputs
    expect(() => classifier.getCurrentRegime('INVALID')).not.toThrow();
    expect(() => classifier.getCurrentPrimaryRegime('INVALID')).not.toThrow();
    expect(() => classifier.hasRegimeChanged('INVALID')).not.toThrow();
  });
  
  test('should return correct primary regime', () => {
    const features = {
      price: 45000,
      returns1d: 0.01,
      returns5d: -0.01,
      returns20d: 0.005,
      volatility1d: 0.01,
      volatility5d: 0.015,
      volatility20d: 0.02,
      volumeRatio1d: 0.8,
      volumeRatio5d: 0.9,
      rsi14: 50,
      atr14: 1.5,
      bbWidth: 0.4,
      macdHistogram: 0.05,
      advanceDeclineRatio: 1.0,
      marketCap: 950000000
    };
    
    classifier.classifyRegime('ETH/USD', features);
    
    const primaryRegime = classifier.getCurrentPrimaryRegime('ETH/USD');
    const currentRegime = classifier.getCurrentRegime('ETH/USD');
    
    expect(primaryRegime).toBeDefined();
    expect(primaryRegime).toBe(currentRegime.primaryRegime);
  });
  
  test('should return tracked symbols', () => {
    // Classify for multiple symbols
    const features = {
      price: 45000,
      returns1d: 0.01,
      returns5d: -0.01,
      returns20d: 0.005,
      volatility1d: 0.01,
      volatility5d: 0.015,
      volatility20d: 0.02,
      volumeRatio1d: 0.8,
      volumeRatio5d: 0.9,
      rsi14: 50,
      atr14: 1.5,
      bbWidth: 0.4,
      macdHistogram: 0.05,
      advanceDeclineRatio: 1.0,
      marketCap: 950000000
    };
    
    classifier.classifyRegime('BTC/USD', features);
    classifier.classifyRegime('ETH/USD', features);
    classifier.classifyRegime('SOL/USD', features);
    
    const symbols = classifier.getTrackedSymbols();
    
    expect(symbols).toHaveLength(3);
    expect(symbols).toContain('BTC/USD');
    expect(symbols).toContain('ETH/USD');
    expect(symbols).toContain('SOL/USD');
  });
}); 