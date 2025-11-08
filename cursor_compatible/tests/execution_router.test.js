import { jest } from '@jest/globals';
import { CrossChainExecutionRouter } from '../src/execution/CrossChainExecutionRouter';
import { ExecutionSecurityLayer } from '../src/execution/ExecutionSecurityLayer';
import { CrossChainStrategyRegistry } from '../src/execution/CrossChainStrategyRegistry';
import { EthereumAdapter } from '../src/execution/adapters/EthereumAdapter';
import { SolanaAdapter } from '../src/execution/adapters/SolanaAdapter';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';
import { RegimeClassifier } from '../src/regime/RegimeClassifier';

// Mock dependencies
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn(),
        on: jest.fn()
      })
    }
  };
});

jest.mock('../src/regime/RegimeClassifier', () => {
  return {
    RegimeClassifier: {
      getInstance: jest.fn().mockReturnValue({
        getCurrentRegime: jest.fn().mockReturnValue({
          primaryRegime: 'BullishTrend',
          confidence: 0.85,
          timestamp: Date.now()
        })
      })
    }
  };
});

jest.mock('../src/execution/CrossChainStrategyRegistry', () => {
  return {
    CrossChainStrategyRegistry: {
      getInstance: jest.fn().mockReturnValue({
        getDeployedStrategies: jest.fn().mockResolvedValue([
          {
            strategyId: 'test-strategy',
            chainId: 'ethereum-1',
            deploymentAddress: '0x1234',
            isActive: true
          }
        ]),
        recordExecution: jest.fn().mockResolvedValue(true)
      })
    }
  };
});

jest.mock('../src/execution/ExecutionSecurityLayer', () => {
  return {
    ExecutionSecurityLayer: {
      getInstance: jest.fn().mockReturnValue({
        authorizeExecution: jest.fn().mockResolvedValue({
          isAuthorized: true,
          authToken: 'mock-auth-token',
          expirationTimestamp: Date.now() + 300000,
          riskScore: 0.2
        })
      })
    }
  };
});

// Mock adapters
jest.mock('../src/execution/adapters/EthereumAdapter', () => {
  return {
    EthereumAdapter: jest.fn().mockImplementation(() => {
      return {
        getChainId: jest.fn().mockReturnValue('ethereum-1'),
        initialize: jest.fn().mockResolvedValue(true),
        executeStrategy: jest.fn().mockResolvedValue({
          success: true,
          transactionId: '0xmocktx',
          timestamp: Date.now(),
          executionTimeMs: 1500,
          feeCost: 0.005,
          blockHeight: 1000000
        }),
        estimateFees: jest.fn().mockResolvedValue({
          estimatedFee: 0.005,
          networkCongestion: 0.3,
          recommendedFees: {
            slow: 0.003,
            average: 0.005,
            fast: 0.008
          },
          estimatedTimeToConfirmation: {
            slow: 60000,
            average: 30000,
            fast: 15000
          }
        }),
        getChainHealthStatus: jest.fn().mockResolvedValue({
          isOperational: true,
          currentBlockHeight: 1000000,
          latestBlockTimestamp: Date.now(),
          averageBlockTimeMs: 12000,
          networkCongestion: 0.3,
          currentTps: 20,
          rpcResponseTimeMs: 150,
          isConfigured: true
        }),
        validateStrategy: jest.fn().mockResolvedValue({
          isValid: true
        })
      };
    })
  };
});

jest.mock('../src/execution/adapters/SolanaAdapter', () => {
  return {
    SolanaAdapter: jest.fn().mockImplementation(() => {
      return {
        getChainId: jest.fn().mockReturnValue('solana-mainnet-beta'),
        initialize: jest.fn().mockResolvedValue(true),
        executeStrategy: jest.fn().mockResolvedValue({
          success: true,
          transactionId: 'solmocktx',
          timestamp: Date.now(),
          executionTimeMs: 800,
          feeCost: 0.0001,
          blockHeight: 150000000
        }),
        estimateFees: jest.fn().mockResolvedValue({
          estimatedFee: 0.0001,
          networkCongestion: 0.2,
          recommendedFees: {
            slow: 0.00005,
            average: 0.0001,
            fast: 0.0002
          },
          estimatedTimeToConfirmation: {
            slow: 2000,
            average: 1000,
            fast: 500
          }
        }),
        getChainHealthStatus: jest.fn().mockResolvedValue({
          isOperational: true,
          currentBlockHeight: 150000000,
          latestBlockTimestamp: Date.now(),
          averageBlockTimeMs: 400,
          networkCongestion: 0.2,
          currentTps: 2000,
          rpcResponseTimeMs: 80,
          isConfigured: true
        }),
        validateStrategy: jest.fn().mockResolvedValue({
          isValid: true
        })
      };
    })
  };
});

// Mock strategy genome
const mockGenome = {
  id: 'test-strategy',
  parameters: {
    timePeriod: 14,
    threshold: 0.5
  },
  metrics: {
    sharpeRatio: 1.2,
    drawdown: 0.1,
    winRate: 0.65
  },
  createdAt: Date.now(),
  generation: 1,
  parentIds: []
};

describe('CrossChainExecutionRouter', () => {
  let router;
  let ethereumAdapter;
  let solanaAdapter;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create adapters
    ethereumAdapter = new EthereumAdapter();
    solanaAdapter = new SolanaAdapter();
    
    // Create router
    router = CrossChainExecutionRouter.getInstance({
      defaultChainId: 'ethereum-1',
      preferDeployedStrategies: true,
      maxFeeCostMultiplier: 2.0,
      minChainHealthScore: 0.7,
      selectionWeights: {
        feeCost: 0.4,
        latency: 0.3,
        reliability: 0.2,
        regimeCompatibility: 0.1
      },
      enableAutoRetry: true,
      maxRetryAttempts: 3
    });
    
    // Register adapters
    router.registerAdapter(ethereumAdapter);
    router.registerAdapter(solanaAdapter);
  });
  
  test('should initialize with adapters', () => {
    expect(router).toBeDefined();
    expect(router.getRegisteredAdapters().size).toBe(2);
    expect(router.getRegisteredAdapters().has('ethereum-1')).toBe(true);
    expect(router.getRegisteredAdapters().has('solana-mainnet-beta')).toBe(true);
  });
  
  test('should execute strategy on most appropriate chain', async () => {
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();
    
    // Verify authorization happened
    expect(ExecutionSecurityLayer.getInstance().authorizeExecution).toHaveBeenCalledWith(
      mockGenome,
      expect.any(String),
      market,
      params
    );
    
    // Verify adapter was called
    const adapters = [ethereumAdapter, solanaAdapter];
    const executedAdapter = adapters.find(a => a.executeStrategy.mock.calls.length > 0);
    expect(executedAdapter).toBeDefined();
    expect(executedAdapter.executeStrategy).toHaveBeenCalledWith(mockGenome, market, params);
    
    // Verify execution was recorded
    expect(CrossChainStrategyRegistry.getInstance().recordExecution).toHaveBeenCalledWith(
      mockGenome.id,
      expect.any(String),
      market,
      expect.any(String),
      expect.objectContaining({
        success: true
      })
    );
  });
  
  test('should prefer deployed strategies if configured', async () => {
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should prefer ethereum since the mock strategy is deployed there)
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    
    // Verify Ethereum adapter was called (as mock is deployed there)
    expect(ethereumAdapter.executeStrategy).toHaveBeenCalledWith(mockGenome, market, params);
    expect(solanaAdapter.executeStrategy).not.toHaveBeenCalled();
    
    // Verify chain health statuses were checked
    expect(ethereumAdapter.getChainHealthStatus).toHaveBeenCalled();
    expect(solanaAdapter.getChainHealthStatus).toHaveBeenCalled();
  });
  
  test('should reject execution if no viable chains', async () => {
    // Make both adapters return poor health
    ethereumAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: false,
      currentBlockHeight: 0,
      latestBlockTimestamp: 0,
      averageBlockTimeMs: 0,
      networkCongestion: 1,
      currentTps: 0,
      rpcResponseTimeMs: 1000,
      isConfigured: false
    });
    
    solanaAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: false,
      currentBlockHeight: 0,
      latestBlockTimestamp: 0,
      averageBlockTimeMs: 0,
      networkCongestion: 1,
      currentTps: 0,
      rpcResponseTimeMs: 1000,
      isConfigured: false
    });
    
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should fail due to no viable chains)
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(false);
    expect(result.error).toContain('No suitable chain found');
    
    // Verify neither adapter was called
    expect(ethereumAdapter.executeStrategy).not.toHaveBeenCalled();
    expect(solanaAdapter.executeStrategy).not.toHaveBeenCalled();
  });
  
  test('should reject execution if security layer denies it', async () => {
    // Make security layer deny the execution
    ExecutionSecurityLayer.getInstance().authorizeExecution.mockResolvedValue({
      isAuthorized: false,
      reason: 'Security violation',
      riskScore: 0.9
    });
    
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should fail due to security denial)
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(false);
    expect(result.error).toContain('Security violation');
    
    // Verify neither adapter was called
    expect(ethereumAdapter.executeStrategy).not.toHaveBeenCalled();
    expect(solanaAdapter.executeStrategy).not.toHaveBeenCalled();
  });
  
  test('should select chain with lower fees when similar performance', async () => {
    // Make Solana much cheaper but keep everything else similar
    ethereumAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.01,
      networkCongestion: 0.3,
      recommendedFees: {
        slow: 0.008,
        average: 0.01,
        fast: 0.015
      },
      estimatedTimeToConfirmation: {
        slow: 60000,
        average: 30000,
        fast: 15000
      }
    });
    
    solanaAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.0001,
      networkCongestion: 0.3,
      recommendedFees: {
        slow: 0.00005,
        average: 0.0001,
        fast: 0.0002
      },
      estimatedTimeToConfirmation: {
        slow: 2000,
        average: 1000,
        fast: 500
      }
    });
    
    // Make both chains have similar health
    ethereumAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 1000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 12000,
      networkCongestion: 0.3,
      currentTps: 20,
      rpcResponseTimeMs: 150,
      isConfigured: true
    });
    
    solanaAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 150000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 400,
      networkCongestion: 0.3,
      currentTps: 2000,
      rpcResponseTimeMs: 150,
      isConfigured: true
    });
    
    // Make the strategy not deployed anywhere to remove that bias
    CrossChainStrategyRegistry.getInstance().getDeployedStrategies.mockResolvedValue([]);
    
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should prefer Solana due to lower fees)
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    
    // Verify Solana adapter was called due to lower fees
    expect(solanaAdapter.executeStrategy).toHaveBeenCalledWith(mockGenome, market, params);
    expect(ethereumAdapter.executeStrategy).not.toHaveBeenCalled();
  });
  
  test('should select chain with lower latency when fees are similar', async () => {
    // Make both chains have similar fees
    ethereumAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.001,
      networkCongestion: 0.3,
      recommendedFees: {
        slow: 0.0008,
        average: 0.001,
        fast: 0.0015
      },
      estimatedTimeToConfirmation: {
        slow: 60000,
        average: 30000,
        fast: 15000
      }
    });
    
    solanaAdapter.estimateFees.mockResolvedValue({
      estimatedFee: 0.001,
      networkCongestion: 0.3,
      recommendedFees: {
        slow: 0.0005,
        average: 0.001,
        fast: 0.002
      },
      estimatedTimeToConfirmation: {
        slow: 2000,
        average: 1000,
        fast: 500
      }
    });
    
    // Make both chains have similar health
    ethereumAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 1000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 12000,
      networkCongestion: 0.3,
      currentTps: 20,
      rpcResponseTimeMs: 150,
      isConfigured: true
    });
    
    solanaAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: true,
      currentBlockHeight: 150000000,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 400,
      networkCongestion: 0.3,
      currentTps: 2000,
      rpcResponseTimeMs: 150,
      isConfigured: true
    });
    
    // Make the strategy not deployed anywhere to remove that bias
    CrossChainStrategyRegistry.getInstance().getDeployedStrategies.mockResolvedValue([]);
    
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should prefer Solana due to lower latency)
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    
    // Verify Solana adapter was called due to lower latency
    expect(solanaAdapter.executeStrategy).toHaveBeenCalledWith(mockGenome, market, params);
    expect(ethereumAdapter.executeStrategy).not.toHaveBeenCalled();
  });
  
  test('should handle strategy validation failures', async () => {
    // Make Solana reject the strategy validation
    solanaAdapter.validateStrategy.mockResolvedValue({
      isValid: false,
      errors: ['Unsupported operations for Solana']
    });
    
    // Configure execution params
    const market = 'BTC/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should use Ethereum since Solana validation fails)
    const result = await router.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    
    // Verify Ethereum adapter was called since Solana rejected validation
    expect(ethereumAdapter.executeStrategy).toHaveBeenCalledWith(mockGenome, market, params);
    expect(solanaAdapter.executeStrategy).not.toHaveBeenCalled();
  });
  
  test('should unregister an adapter', () => {
    // Unregister Ethereum adapter
    router.unregisterAdapter('ethereum-1');
    
    // Check adapters
    expect(router.getRegisteredAdapters().size).toBe(1);
    expect(router.getRegisteredAdapters().has('ethereum-1')).toBe(false);
    expect(router.getRegisteredAdapters().has('solana-mainnet-beta')).toBe(true);
  });
}); 