/**
 * Integration tests for Model Expansion package
 */

import { createModelExpansion, ModelOrchestrator } from '../src';
import { MarketState } from '../src/types';

describe('Model Expansion Integration Tests', () => {
  let orchestrator: ModelOrchestrator;
  
  const mockMarketState: MarketState = {
    prices: {
      'BTC-USD': 50000,
      'ETH-USD': 3000,
      'BNB-USD': 400,
      'SOL-USD': 100
    },
    volumes: {
      'BTC-USD': 1000000000,
      'ETH-USD': 500000000,
      'BNB-USD': 100000000,
      'SOL-USD': 50000000
    },
    timestamp: Date.now(),
    accountBalance: 100000,
    positions: []
  };
  
  const testConfig = {
    llm: {
      enabled: true,
      providers: [{
        name: 'claude-3',
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229'
      }],
      maxTokens: 4000,
      temperature: 0.7,
      safetyConstraints: {
        maxLeverage: 3,
        maxPositionSize: 0.2,
        forbiddenAssets: []
      }
    },
    rl: {
      enabled: true,
      algorithm: 'PPO' as const,
      learningRate: 0.0003,
      discountFactor: 0.99,
      explorationRate: 0.1,
      batchSize: 32
    },
    evolution: {
      enabled: true,
      populationSize: 10, // Small for testing
      mutationRate: 0.1,
      crossoverRate: 0.7,
      eliteRatio: 0.2,
      maxGenerations: 5
    },
    causal: {
      enabled: true,
      method: 'granger' as const,
      confidenceLevel: 0.95,
      lagOrder: 3
    },
    integration: {
      numerai: {
        enabled: false, // Disabled for testing
        apiKey: 'test-key',
        modelId: 'test-model'
      }
    },
    validation: {
      autoAudit: true,
      auditFrequency: 3600,
      performanceThresholds: {
        minSharpe: 1.5,
        maxDrawdown: 0.2,
        minWinRate: 0.55
      }
    }
  };
  
  beforeAll(async () => {
    // Mock external API calls
    jest.spyOn(global, 'fetch').mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                code: 'function checkEntry() { return true; }',
                explanation: 'Test strategy'
              })
            }
          }]
        })
      } as Response)
    );
  });
  
  afterAll(() => {
    jest.restoreAllMocks();
  });
  
  describe('Orchestrator Creation', () => {
    it('should create orchestrator with all components', async () => {
      orchestrator = await createModelExpansion(testConfig);
      
      expect(orchestrator).toBeDefined();
      expect(orchestrator.getPerformanceMetrics).toBeDefined();
    });
    
    it('should initialize with correct components', async () => {
      const metrics = orchestrator.getPerformanceMetrics();
      
      expect(metrics.activeModels).toBeGreaterThan(0);
      expect(metrics.ensembleWeights).toBeDefined();
      expect(metrics.ensembleWeights.llm).toBeGreaterThan(0);
      expect(metrics.ensembleWeights.rl).toBeGreaterThan(0);
      expect(metrics.ensembleWeights.evolution).toBeGreaterThan(0);
    });
  });
  
  describe('Signal Generation', () => {
    it('should generate ensemble signals', async () => {
      const signals = await orchestrator.generateSignals(mockMarketState);
      
      expect(Array.isArray(signals)).toBe(true);
      // May or may not have signals depending on model decisions
    });
    
    it('should handle market state updates', async () => {
      const updatedState = {
        ...mockMarketState,
        prices: {
          ...mockMarketState.prices,
          'BTC-USD': 51000 // Price increase
        }
      };
      
      const signals = await orchestrator.generateSignals(updatedState);
      
      expect(Array.isArray(signals)).toBe(true);
    });
  });
  
  describe('Component Integration', () => {
    it('should coordinate multiple AI models', async () => {
      // Generate signals multiple times to test consistency
      const results = [];
      
      for (let i = 0; i < 3; i++) {
        const signals = await orchestrator.generateSignals(mockMarketState);
        results.push(signals);
      }
      
      expect(results.length).toBe(3);
      // Each result should be an array
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
      });
    });
  });
  
  describe('Performance Tracking', () => {
    it('should track model performance', async () => {
      const initialMetrics = orchestrator.getPerformanceMetrics();
      
      // Generate some signals to update performance
      await orchestrator.generateSignals(mockMarketState);
      
      // Wait for performance update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updatedMetrics = orchestrator.getPerformanceMetrics();
      
      expect(updatedMetrics.lastUpdate).toBeGreaterThanOrEqual(initialMetrics.lastUpdate);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle component failures gracefully', async () => {
      // Mock a failure
      jest.spyOn(global, 'fetch').mockImplementationOnce(() => 
        Promise.reject(new Error('API Error'))
      );
      
      // Should not throw, but return empty or fallback signals
      const signals = await orchestrator.generateSignals(mockMarketState);
      
      expect(Array.isArray(signals)).toBe(true);
    });
  });
  
  describe('Cleanup', () => {
    it('should stop orchestrator cleanly', async () => {
      await expect(orchestrator.stop()).resolves.not.toThrow();
    });
  });
});

describe('Individual Component Tests', () => {
  describe('LLM Alpha Generator', () => {
    it('should validate generated strategies', async () => {
      const { LLMAlphaGenerator } = await import('../src/llm/LLMAlphaGenerator');
      const { createLogger } = await import('winston');
      
      const logger = createLogger({ silent: true });
      const generator = new LLMAlphaGenerator(logger, {
        providers: [{
          name: 'claude-3',
          apiKey: 'test-key'
        }],
        maxTokens: 4000,
        temperature: 0.7,
        safetyConstraints: {
          maxLeverage: 3,
          maxPositionSize: 0.2,
          forbiddenAssets: []
        }
      });
      
      await generator.initialize();
      
      const strategy = await generator.generateStrategy('Create a simple momentum strategy');
      
      expect(strategy).toBeDefined();
      expect(strategy.id).toBeDefined();
      expect(strategy.confidence).toBeGreaterThan(0);
    });
  });
  
  describe('Evolution Engine', () => {
    it('should evolve strategy population', async () => {
      const { EvolutionEngine, StrategyGenome } = await import('../src');
      const { createLogger } = await import('winston');
      
      const logger = createLogger({ silent: true });
      const engine = new EvolutionEngine(logger, {
        populationSize: 10,
        mutationRate: 0.1,
        crossoverRate: 0.7,
        eliteRatio: 0.2,
        maxGenerations: 3
      });
      
      await engine.initialize();
      
      // Mock historical data
      const historicalData = Array(100).fill(null).map((_, i) => ({
        price: 50000 + Math.random() * 1000,
        volume: 1000000 + Math.random() * 100000,
        timestamp: Date.now() - i * 3600000
      }));
      
      const bestGenome = await engine.evolve(historicalData, 3);
      
      expect(bestGenome).toBeDefined();
      expect(bestGenome.genes.length).toBeGreaterThan(0);
      expect(bestGenome.generation).toBeGreaterThan(0);
    });
  });
  
  describe('RL Learning Loop', () => {
    it('should select actions based on market state', async () => {
      const { RLLearningLoop } = await import('../src');
      const { createLogger } = await import('winston');
      
      const logger = createLogger({ silent: true });
      const rlLoop = new RLLearningLoop(logger, {
        algorithm: 'PPO',
        learningRate: 0.0003,
        discountFactor: 0.99,
        explorationRate: 0.1,
        batchSize: 32,
        memorySize: 1000,
        updateFrequency: 10,
        targetUpdateFrequency: 100,
        maxEpisodeLength: 100
      });
      
      await rlLoop.initialize();
      
      const action = await rlLoop.trainOnline(mockMarketState);
      
      expect(action).toBeDefined();
      expect(action.type).toMatch(/buy|sell|hold|close/);
      expect(action.confidence).toBeGreaterThanOrEqual(0);
      expect(action.confidence).toBeLessThanOrEqual(1);
    });
  });
}); 