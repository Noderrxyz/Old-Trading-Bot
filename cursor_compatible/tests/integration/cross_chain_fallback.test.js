import { jest } from '@jest/globals';
import { CrossChainExecutionRouter } from '../../src/execution/CrossChainExecutionRouter';
import { EthereumAdapter } from '../../src/execution/adapters/EthereumAdapter';
import { SolanaAdapter } from '../../src/execution/adapters/SolanaAdapter';
import { CosmosAdapter } from '../../src/execution/adapters/CosmosAdapter';

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
  return {
    CrossChainStrategyRegistry: {
      getInstance: jest.fn().mockReturnValue({
        isStrategyDeployedOnChain: jest.fn().mockImplementation((chainId, strategyId) => {
          // Return true for all chains to simulate strategy available everywhere
          return true;
        }),
        registerStrategyDeployment: jest.fn(),
        getDeployedStrategies: jest.fn().mockReturnValue([
          'test-strategy-1',
          'cross-chain-strategy'
        ])
      })
    }
  };
});

// Mock ExecutionSecurityLayer
jest.mock('../../src/execution/ExecutionSecurityLayer', () => {
  return {
    ExecutionSecurityLayer: {
      getInstance: jest.fn().mockReturnValue({
        authorizeExecution: jest.fn().mockResolvedValue(true),
        validateExecutionParams: jest.fn().mockResolvedValue({ isValid: true })
      })
    }
  };
});

// Mock adapters
jest.mock('../../src/execution/adapters/EthereumAdapter');
jest.mock('../../src/execution/adapters/SolanaAdapter');
jest.mock('../../src/execution/adapters/CosmosAdapter');

// Mock strategy genome
const mockGenome = {
  id: 'cross-chain-strategy',
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

describe('Cross-Chain Fallback Tests', () => {
  let executionRouter;
  let ethereumAdapter;
  let solanaAdapter;
  let cosmosAdapter;
  
  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock adapters
    ethereumAdapter = new EthereumAdapter();
    solanaAdapter = new SolanaAdapter();
    cosmosAdapter = new CosmosAdapter();
    
    // Setup default behaviors for each adapter
    ethereumAdapter.getChainId.mockReturnValue('ethereum-1');
    solanaAdapter.getChainId.mockReturnValue('solana-mainnet');
    cosmosAdapter.getChainId.mockReturnValue('cosmos-hub');
    
    ethereumAdapter.initialize.mockResolvedValue(true);
    solanaAdapter.initialize.mockResolvedValue(true);
    cosmosAdapter.initialize.mockResolvedValue(true);
    
    // Set up default getChainHealthStatus behavior
    ethereumAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 10000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 15000,
      networkCongestion: 0.5,
      currentTps: 15,
      rpcResponseTimeMs: 200,
      isConfigured: true
    });
    
    solanaAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 150000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 550,
      networkCongestion: 0.4,
      currentTps: 2000,
      rpcResponseTimeMs: 150,
      isConfigured: true
    });
    
    cosmosAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 9000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 6500,
      networkCongestion: 0.3,
      currentTps: 20,
      rpcResponseTimeMs: 300,
      isConfigured: true
    });
    
    // Set up default estimateFees behavior
    ethereumAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.01,
      networkCongestion: 0.5,
      recommendedFees: { slow: 0.005, average: 0.01, fast: 0.02 },
      estimatedTimeToConfirmation: { slow: 45000, average: 30000, fast: 15000 }
    });
    
    solanaAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.00001,
      networkCongestion: 0.4,
      recommendedFees: { slow: 0.000005, average: 0.00001, fast: 0.00002 },
      estimatedTimeToConfirmation: { slow: 1500, average: 1000, fast: 550 }
    });
    
    cosmosAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.005,
      networkCongestion: 0.3,
      recommendedFees: { slow: 0.0025, average: 0.005, fast: 0.01 },
      estimatedTimeToConfirmation: { slow: 19500, average: 13000, fast: 6500 }
    });
    
    // Set up default executeStrategy behavior
    ethereumAdapter.executeStrategy.mockResolvedValue({
      success: true,
      transactionId: '0xetherum123',
      chainId: 'ethereum-1',
      feeCost: 0.01,
      executionTimeMs: 15000,
      timestamp: Date.now()
    });
    
    solanaAdapter.executeStrategy.mockResolvedValue({
      success: true,
      transactionId: 'solana123',
      chainId: 'solana-mainnet',
      feeCost: 0.00001,
      executionTimeMs: 5000,
      timestamp: Date.now()
    });
    
    cosmosAdapter.executeStrategy.mockResolvedValue({
      success: true,
      transactionId: 'cosmos123',
      chainId: 'cosmos-hub',
      feeCost: 0.005,
      executionTimeMs: 10000,
      timestamp: Date.now()
    });
    
    // Create execution router with auto-retry enabled
    executionRouter = CrossChainExecutionRouter.getInstance({
      defaultChainId: 'ethereum-1',
      preferDeployedStrategies: true,
      enableAutoRetry: true,
      maxRetryAttempts: 2,
      selectionWeights: {
        feeCost: 0.4,
        latency: 0.3,
        reliability: 0.2,
        regimeCompatibility: 0.1
      }
    });
    
    // Register all adapters with router
    executionRouter.registerAdapter(ethereumAdapter);
    executionRouter.registerAdapter(solanaAdapter);
    executionRouter.registerAdapter(cosmosAdapter);
  });
  
  test('should fallback to an alternative chain when the primary chain fails', async () => {
    // Configure the primary chain (Ethereum) to fail
    ethereumAdapter.executeStrategy.mockRejectedValueOnce(
      new Error('Network congestion error')
    );
    
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 1.0,
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
    
    // Check that execution was successful
    expect(result.success).toBe(true);
    
    // Check that we didn't use Ethereum (should have failed)
    expect(result.chainId).not.toBe('ethereum-1');
    
    // Verify we attempted Ethereum first
    expect(ethereumAdapter.executeStrategy).toHaveBeenCalledTimes(1);
    
    // Verify we called another adapter
    expect(solanaAdapter.executeStrategy.mock.calls.length + 
           cosmosAdapter.executeStrategy.mock.calls.length).toBe(1);
  });
  
  test('should select the chain with the lowest fees when all chains are healthy', async () => {
    // Exaggerate fee differences to ensure clear selection
    ethereumAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.1, // High
      networkCongestion: 0.5,
      recommendedFees: { slow: 0.05, average: 0.1, fast: 0.2 },
      estimatedTimeToConfirmation: { slow: 45000, average: 30000, fast: 15000 }
    });
    
    solanaAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.0001, // Very low
      networkCongestion: 0.4,
      recommendedFees: { slow: 0.00005, average: 0.0001, fast: 0.0002 },
      estimatedTimeToConfirmation: { slow: 1500, average: 1000, fast: 550 }
    });
    
    cosmosAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.01, // Medium
      networkCongestion: 0.3,
      recommendedFees: { slow: 0.005, average: 0.01, fast: 0.02 },
      estimatedTimeToConfirmation: { slow: 19500, average: 13000, fast: 6500 }
    });
    
    // Execute strategy
    const result = await executionRouter.executeStrategy(
      mockGenome,
      'BTC/USD',
      {
        amount: 1.0,
        slippageTolerance: 1.0,
        timeoutMs: 30000,
        isSimulation: false
      }
    );
    
    // Should have selected Solana due to lowest fees
    expect(result.chainId).toBe('solana-mainnet');
    expect(result.success).toBe(true);
  });
  
  test('should select the chain with lowest latency when latency weight is high', async () => {
    // Reconfigure router to prioritize latency
    executionRouter = CrossChainExecutionRouter.getInstance({
      defaultChainId: 'ethereum-1',
      preferDeployedStrategies: true,
      enableAutoRetry: true,
      selectionWeights: {
        feeCost: 0.1, // Lower weight for fees
        latency: 0.7, // Higher weight for latency
        reliability: 0.1,
        regimeCompatibility: 0.1
      }
    });
    
    // Re-register adapters
    executionRouter.registerAdapter(ethereumAdapter);
    executionRouter.registerAdapter(solanaAdapter);
    executionRouter.registerAdapter(cosmosAdapter);
    
    // Execute strategy
    const result = await executionRouter.executeStrategy(
      mockGenome,
      'BTC/USD',
      {
        amount: 1.0,
        slippageTolerance: 1.0,
        timeoutMs: 30000,
        isSimulation: false
      }
    );
    
    // Should have selected Solana due to lowest latency
    expect(result.chainId).toBe('solana-mainnet');
    expect(result.success).toBe(true);
  });
  
  test('should give up after maximum retry attempts', async () => {
    // Make all adapters fail
    ethereumAdapter.executeStrategy.mockRejectedValue(
      new Error('Ethereum failure')
    );
    
    solanaAdapter.executeStrategy.mockRejectedValue(
      new Error('Solana failure')
    );
    
    cosmosAdapter.executeStrategy.mockRejectedValue(
      new Error('Cosmos failure')
    );
    
    // Execute strategy
    const result = await executionRouter.executeStrategy(
      mockGenome,
      'BTC/USD',
      {
        amount: 1.0,
        slippageTolerance: 1.0,
        timeoutMs: 30000,
        isSimulation: false
      }
    );
    
    // Should have failed after trying all chains
    expect(result.success).toBe(false);
    expect(result.error).toContain('maximum retry attempts');
    
    // Verify we tried each chain (initial + retries, up to max retries)
    const totalCalls = 
      ethereumAdapter.executeStrategy.mock.calls.length +
      solanaAdapter.executeStrategy.mock.calls.length +
      cosmosAdapter.executeStrategy.mock.calls.length;
    
    // Should be 3 (initial + 2 retries) or less since there are only 3 adapters
    expect(totalCalls).toBeLessThanOrEqual(3);
  });
  
  test('should exclude unhealthy chains from selection', async () => {
    // Make Ethereum unhealthy
    ethereumAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: false,
      currentBlockHeight: 0,
      latestBlockTimestamp: 0,
      averageBlockTimeMs: 0,
      networkCongestion: 1,
      currentTps: 0,
      rpcResponseTimeMs: 5000,
      isConfigured: true
    });
    
    // Make Solana unhealthy
    solanaAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: false,
      currentBlockHeight: 0,
      latestBlockTimestamp: 0,
      averageBlockTimeMs: 0,
      networkCongestion: 1,
      currentTps: 0,
      rpcResponseTimeMs: 5000,
      isConfigured: true
    });
    
    // Execute strategy
    const result = await executionRouter.executeStrategy(
      mockGenome,
      'BTC/USD',
      {
        amount: 1.0,
        slippageTolerance: 1.0,
        timeoutMs: 30000,
        isSimulation: false
      }
    );
    
    // Should have selected Cosmos since others are unhealthy
    expect(result.chainId).toBe('cosmos-hub');
    expect(result.success).toBe(true);
    
    // Verify we didn't try the unhealthy chains
    expect(ethereumAdapter.executeStrategy).not.toHaveBeenCalled();
    expect(solanaAdapter.executeStrategy).not.toHaveBeenCalled();
    expect(cosmosAdapter.executeStrategy).toHaveBeenCalled();
  });
}); 