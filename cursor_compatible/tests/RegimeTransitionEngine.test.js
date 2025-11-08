import { jest } from '@jest/globals';
import { RegimeTransitionEngine } from '../src/regime/RegimeTransitionEngine';
import { MarketRegimeClassifier } from '../src/regime/MarketRegimeClassifier';
import { MarketRegime, RegimeTransitionState } from '../src/regime/MarketRegimeTypes';

// Mock MarketRegimeClassifier
jest.mock('../src/regime/MarketRegimeClassifier', () => {
  return {
    MarketRegimeClassifier: {
      getInstance: jest.fn().mockReturnValue({
        classifyRegime: jest.fn(),
        getRegimeHistory: jest.fn(),
        getCurrentRegime: jest.fn(),
        resetAllHistory: jest.fn()
      })
    }
  };
});

// Mock TelemetryBus
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    }
  };
});

// Mock logger
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

describe('RegimeTransitionEngine', () => {
  let transitionEngine;
  let mockClassifier;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Get the mock classifier
    mockClassifier = MarketRegimeClassifier.getInstance();
    
    // Reset transitionEngine instance
    RegimeTransitionEngine.instance = null;
    
    // Get transition engine instance
    transitionEngine = RegimeTransitionEngine.getInstance({
      minimumTransitionConfidence: 0.7,
      transitionSmoothingWindow: 3,
      emitDetailedTelemetry: false
    });
    
    // Reset data
    transitionEngine.resetAll();
  });
  
  test('should process new classification', () => {
    const classification = {
      primaryRegime: MarketRegime.BullishTrend,
      secondaryRegime: MarketRegime.HighVolatility,
      confidence: 0.8,
      transitionState: RegimeTransitionState.Stable,
      scores: {
        [MarketRegime.BullishTrend]: 0.8,
        [MarketRegime.HighVolatility]: 0.6
      },
      timestamp: Date.now(),
      features: { /* mock features */ }
    };
    
    transitionEngine.processClassification(classification, 'BTC/USD');
    
    // Get smoothed regime
    const smoothedRegime = transitionEngine.getSmoothRegime('BTC/USD');
    
    expect(smoothedRegime).toBeDefined();
    expect(smoothedRegime.primaryRegime).toBe(MarketRegime.BullishTrend);
    expect(smoothedRegime.confidence).toBe(0.8);
  });
  
  test('should apply smoothing to multiple classifications', () => {
    // Process multiple classifications
    const timestamp = Date.now();
    
    const classifications = [
      {
        primaryRegime: MarketRegime.BullishTrend,
        secondaryRegime: null,
        confidence: 0.9,
        transitionState: RegimeTransitionState.Stable,
        scores: { [MarketRegime.BullishTrend]: 0.9 },
        timestamp: timestamp,
        features: {}
      },
      {
        primaryRegime: MarketRegime.BullishTrend,
        secondaryRegime: null,
        confidence: 0.85,
        transitionState: RegimeTransitionState.Stable,
        scores: { [MarketRegime.BullishTrend]: 0.85 },
        timestamp: timestamp - 1000,
        features: {}
      },
      {
        primaryRegime: MarketRegime.HighVolatility,
        secondaryRegime: MarketRegime.BullishTrend,
        confidence: 0.6,
        transitionState: RegimeTransitionState.Developing,
        scores: { 
          [MarketRegime.HighVolatility]: 0.6,
          [MarketRegime.BullishTrend]: 0.55
        },
        timestamp: timestamp - 2000,
        features: {}
      }
    ];
    
    // Process them in reverse order (oldest first)
    for (let i = classifications.length - 1; i >= 0; i--) {
      transitionEngine.processClassification(classifications[i], 'BTC/USD');
    }
    
    // Get smoothed regime
    const smoothedRegime = transitionEngine.getSmoothRegime('BTC/USD');
    
    expect(smoothedRegime).toBeDefined();
    expect(smoothedRegime.primaryRegime).toBe(MarketRegime.BullishTrend);
    // Confidence should be a weighted average
    expect(smoothedRegime.confidence).toBeGreaterThan(0.7);
    expect(smoothedRegime.transitionState).toBe(RegimeTransitionState.Stable);
  });
  
  test('should detect regime transitions', () => {
    const transitionListener = jest.fn();
    transitionEngine.onTransition(transitionListener);
    
    // Initial classification
    const initialClassification = {
      primaryRegime: MarketRegime.BullishTrend,
      secondaryRegime: null,
      confidence: 0.8,
      transitionState: RegimeTransitionState.Stable,
      scores: { [MarketRegime.BullishTrend]: 0.8 },
      timestamp: Date.now() - 5000,
      features: {}
    };
    
    transitionEngine.processClassification(initialClassification, 'ETH/USD');
    
    // New classification with different regime
    const newClassification = {
      primaryRegime: MarketRegime.BearishTrend,
      secondaryRegime: null,
      confidence: 0.85,
      transitionState: RegimeTransitionState.Transitioning,
      scores: { [MarketRegime.BearishTrend]: 0.85 },
      timestamp: Date.now(),
      features: {}
    };
    
    transitionEngine.processClassification(newClassification, 'ETH/USD');
    
    // Listener should be called with the transition
    expect(transitionListener).toHaveBeenCalled();
    const transition = transitionListener.mock.calls[0][0];
    
    expect(transition.fromRegime).toBe(MarketRegime.BullishTrend);
    expect(transition.toRegime).toBe(MarketRegime.BearishTrend);
    expect(transition.confidence).toBeGreaterThanOrEqual(0.8);
  });
  
  test('should notify classification listeners', () => {
    const classificationListener = jest.fn();
    transitionEngine.onClassification(classificationListener);
    
    const classification = {
      primaryRegime: MarketRegime.Rangebound,
      secondaryRegime: null,
      confidence: 0.75,
      transitionState: RegimeTransitionState.Stable,
      scores: { [MarketRegime.Rangebound]: 0.75 },
      timestamp: Date.now(),
      features: {}
    };
    
    transitionEngine.processClassification(classification, 'BTC/USD');
    
    expect(classificationListener).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryRegime: MarketRegime.Rangebound,
        confidence: 0.75
      }),
      'BTC/USD'
    );
  });
  
  test('should handle ambiguous regimes', () => {
    // Classification with low confidence
    const lowConfidenceClassification = {
      primaryRegime: MarketRegime.Rangebound,
      secondaryRegime: MarketRegime.LowVolatility,
      confidence: 0.4, // Below threshold
      transitionState: RegimeTransitionState.Ambiguous,
      scores: { 
        [MarketRegime.Rangebound]: 0.4,
        [MarketRegime.LowVolatility]: 0.35
      },
      timestamp: Date.now(),
      features: {}
    };
    
    transitionEngine.processClassification(lowConfidenceClassification, 'SOL/USD');
    
    // Get smoothed regime
    const smoothedRegime = transitionEngine.getSmoothRegime('SOL/USD');
    
    expect(smoothedRegime.transitionState).toBe(RegimeTransitionState.Ambiguous);
  });
  
  test('should track transition counts', () => {
    // Initial classification
    const initialClassification = {
      primaryRegime: MarketRegime.BullishTrend,
      secondaryRegime: null,
      confidence: 0.8,
      transitionState: RegimeTransitionState.Stable,
      scores: { [MarketRegime.BullishTrend]: 0.8 },
      timestamp: Date.now() - 5000,
      features: {}
    };
    
    transitionEngine.processClassification(initialClassification, 'BTC/USD');
    
    // Process multiple transitions
    const regimes = [
      MarketRegime.BearishTrend,
      MarketRegime.HighVolatility,
      MarketRegime.Rangebound,
      MarketRegime.BullishTrend
    ];
    
    for (const regime of regimes) {
      const classification = {
        primaryRegime: regime,
        secondaryRegime: null,
        confidence: 0.85,
        transitionState: RegimeTransitionState.Transitioning,
        scores: { [regime]: 0.85 },
        timestamp: Date.now(),
        features: {}
      };
      
      transitionEngine.processClassification(classification, 'BTC/USD');
    }
    
    // Check transition count (should be 4 transitions)
    expect(transitionEngine.getTransitionCount('BTC/USD')).toBe(4);
    
    // Check global transition count
    expect(transitionEngine.getTransitionCount()).toBe(4);
  });
  
  test('should handle empty data gracefully', () => {
    // Get smoothed regime for unknown symbol
    const smoothedRegime = transitionEngine.getSmoothRegime('UNKNOWN');
    
    expect(smoothedRegime).toBeDefined();
    expect(smoothedRegime.primaryRegime).toBe(MarketRegime.Unknown);
    expect(smoothedRegime.confidence).toBe(0);
    
    // Get transition count for unknown symbol
    expect(transitionEngine.getTransitionCount('UNKNOWN')).toBe(0);
    
    // Get regime stats
    const stats = transitionEngine.getRegimeStats();
    expect(stats).toBeDefined();
  });
  
  test('should remove listeners correctly', () => {
    const transitionListener = jest.fn();
    const classificationListener = jest.fn();
    
    transitionEngine.onTransition(transitionListener);
    transitionEngine.onClassification(classificationListener);
    
    // Remove listeners
    transitionEngine.removeTransitionListener(transitionListener);
    transitionEngine.removeClassificationListener(classificationListener);
    
    // Process a classification
    const classification = {
      primaryRegime: MarketRegime.BullishTrend,
      secondaryRegime: null,
      confidence: 0.8,
      transitionState: RegimeTransitionState.Stable,
      scores: { [MarketRegime.BullishTrend]: 0.8 },
      timestamp: Date.now(),
      features: {}
    };
    
    transitionEngine.processClassification(classification, 'BTC/USD');
    
    // Listeners should not be called
    expect(transitionListener).not.toHaveBeenCalled();
    expect(classificationListener).not.toHaveBeenCalled();
  });
}); 