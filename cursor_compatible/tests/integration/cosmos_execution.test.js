import { jest } from '@jest/globals';
import { CosmosAdapter } from '../../src/execution/adapters/CosmosAdapter';
import { CrossChainExecutionRouter } from '../../src/execution/CrossChainExecutionRouter';
import { CrossChainStrategyRegistry } from '../../src/execution/CrossChainStrategyRegistry';
import { ExecutionSecurityLayer } from '../../src/execution/ExecutionSecurityLayer';

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

// Mock logger
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

// Mock RegimeClassifier
jest.mock('../../src/regime/RegimeClassifier', () => {
  return {
    RegimeClassifier: {
      getInstance: jest.fn().mockReturnValue({
        getCurrentRegime: jest.fn().mockReturnValue({
          primaryRegime: 'BullishTrend',
          confidence: 0.85
        })
      })
    }
  };
});

// Mock CrossChainStrategyRegistry
jest.mock('../../src/execution/CrossChainStrategyRegistry', () => {
  const original = jest.requireActual('../../src/execution/CrossChainStrategyRegistry');
  return {
    ...original,
    CrossChainStrategyRegistry: {
      getInstance: jest.fn().mockReturnValue({
        isStrategyDeployedOnChain: jest.fn().mockReturnValue(true),
        registerStrategyDeployment: jest.fn(),
        getDeployedStrategies: jest.fn().mockReturnValue(['test-strategy-1'])
      })
    }
  };
});

// Mock ExecutionSecurityLayer
jest.mock('../../src/execution/ExecutionSecurityLayer', () => {
  const original = jest.requireActual('../../src/execution/ExecutionSecurityLayer');
  return {
    ...original,
    ExecutionSecurityLayer: {
      getInstance: jest.fn().mockReturnValue({
        authorizeExecution: jest.fn().mockResolvedValue(true),
        validateExecutionParams: jest.fn().mockResolvedValue({ isValid: true })
      })
    }
  };
});

// Mock strategy genome
const mockGenome = {
  id: 'cosmos-strategy-test',
  parameters: {
    timePeriod: 14,
    threshold: 0.5
  },
  metrics: {
    sharpeRatio: 1.2,
    drawdown: 0.1,
    winRate: 0.65
  },
  metadata: {
    createdAt: Date.now(),
    generation: 1,
    parentIds: []
  }
};

describe('Cosmos Execution Integration Tests', () => {
  let cosmosAdapter;
  let executionRouter;
  
  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create and initialize Cosmos adapter
    cosmosAdapter = new CosmosAdapter({
      rpcUrls: ['https://rpc-test.cosmos.network'],
      networkName: 'cosmoshub-testnet',
      chainId: 'cosmoshub-testnet-4',
      defaultFees: {
        slow: '0.01uatom',
        average: '0.02uatom',
        fast: '0.04uatom'
      },
      emitDetailedTelemetry: true
    });
    
    await cosmosAdapter.initialize();
    
    // Create execution router
    executionRouter = CrossChainExecutionRouter.getInstance({
      defaultChainId: 'cosmos-cosmoshub-testnet-4',
      preferDeployedStrategies: true,
      enableAutoRetry: false
    });
    
    // Register adapter with router
    executionRouter.registerAdapter(cosmosAdapter);
  });
  
  test('should execute cosmos transaction through the router', async () => {
    // Configure execution params
    const market = 'ATOM/USD';
    const params = {
      amount: 1.5,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute through the router
    const result = await executionRouter.executeStrategy(
      mockGenome,
      market,
      params
    );
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();
    expect(result.transactionId.length).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeGreaterThan(0);
    
    // Verify chain selection worked correctly
    expect(result.chainId).toBe('cosmos-cosmoshub-testnet-4');
  });
  
  test('should handle transaction failures gracefully', async () => {
    // Mock the execute method to simulate a failure
    cosmosAdapter.executeStrategyInternal = jest.fn().mockRejectedValue(
      new Error('Simulation failed: insufficient funds')
    );
    
    // Configure execution params
    const market = 'ATOM/USD';
    const params = {
      amount: 100, // Large amount to trigger failure
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute through the router
    const result = await executionRouter.executeStrategy(
      mockGenome,
      market,
      params
    );
    
    // Check result
    expect(result.success).toBe(false);
    expect(result.error).toContain('insufficient funds');
  });
  
  test('should process IBC parameters when enabled', async () => {
    // Create new adapter with IBC enabled
    const ibcAdapter = new CosmosAdapter({
      rpcUrls: ['https://rpc-test.cosmos.network'],
      networkName: 'cosmoshub-testnet',
      chainId: 'cosmoshub-testnet-4',
      useIBC: true,
      ibcInfo: {
        osmosis: {
          sourceChannel: 'channel-test-1',
          destChannel: 'channel-test-2',
          timeout: 600000
        }
      }
    });
    
    await ibcAdapter.initialize();
    
    // Configure execution params with IBC specific data
    const market = 'ATOM/OSMO';
    const params = {
      amount: 1.0,
      slippageTolerance: 1.5,
      timeoutMs: 60000,
      isSimulation: false,
      chainSpecific: {
        ibcRecipient: 'osmo1recipient',
        ibcDestination: 'osmosis',
        ibcDenom: 'uatom'
      }
    };
    
    // Execute strategy
    const result = await ibcAdapter.executeStrategy(
      mockGenome,
      market,
      params
    );
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();
  });
  
  test('should retrieve and validate chain health', async () => {
    // Get chain health status
    const healthStatus = await cosmosAdapter.getChainHealthStatus();
    
    // Validate health data
    expect(healthStatus.isOperational).toBe(true);
    expect(healthStatus.currentBlockHeight).toBeGreaterThan(0);
    expect(healthStatus.networkCongestion).toBeGreaterThanOrEqual(0);
    expect(healthStatus.networkCongestion).toBeLessThanOrEqual(1);
    expect(healthStatus.rpcResponseTimeMs).toBeGreaterThanOrEqual(0);
    
    // Validate cosmos-specific data
    expect(healthStatus.chainSpecific).toBeDefined();
  });
  
  test('should estimate fees based on network congestion', async () => {
    // Configure varying network congestion
    const congestionScenarios = [
      { congestion: 0.1, tps: 5 },   // Low congestion
      { congestion: 0.5, tps: 15 },  // Medium congestion
      { congestion: 0.9, tps: 25 }   // High congestion
    ];
    
    // Test each scenario
    for (const scenario of congestionScenarios) {
      // Mock network congestion
      cosmosAdapter.getNetworkCongestion = jest.fn().mockResolvedValue(scenario);
      
      // Estimate fees
      const feeEstimation = await cosmosAdapter.estimateFees(
        mockGenome,
        'ATOM/USD',
        { amount: 1.0, slippageTolerance: 1.0, timeoutMs: 30000 }
      );
      
      // Higher congestion should result in higher fees
      expect(feeEstimation.networkCongestion).toBe(scenario.congestion);
      
      // Recommended fees should be properly ordered
      expect(feeEstimation.recommendedFees.slow)
        .toBeLessThan(feeEstimation.recommendedFees.average);
      expect(feeEstimation.recommendedFees.average)
        .toBeLessThan(feeEstimation.recommendedFees.fast);
      
      // Confirmation times should be ordered inversely to fees
      expect(feeEstimation.estimatedTimeToConfirmation.fast)
        .toBeLessThan(feeEstimation.estimatedTimeToConfirmation.average);
      expect(feeEstimation.estimatedTimeToConfirmation.average)
        .toBeLessThan(feeEstimation.estimatedTimeToConfirmation.slow);
    }
  });
}); 