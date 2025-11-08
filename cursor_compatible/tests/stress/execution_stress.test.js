/**
 * Stress test for the execution infrastructure
 * Simulates high transaction volume and random failures
 */

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

// Mock regime classifier
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

// Mock strategy registry
jest.mock('../../src/execution/CrossChainStrategyRegistry', () => {
  return {
    CrossChainStrategyRegistry: {
      getInstance: jest.fn().mockReturnValue({
        isStrategyDeployedOnChain: jest.fn().mockReturnValue(true),
        registerStrategyDeployment: jest.fn(),
        getDeployedStrategies: jest.fn().mockReturnValue(['stress-test-strategy'])
      })
    }
  };
});

// Mock security layer
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

// Mock chain adapters
jest.mock('../../src/execution/adapters/EthereumAdapter');
jest.mock('../../src/execution/adapters/SolanaAdapter');
jest.mock('../../src/execution/adapters/CosmosAdapter');

// Create sample strategy
const createStressTestStrategy = (id) => ({
  id: `stress-test-strategy-${id}`,
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
});

// Helper to introduce random failures
const withRandomFailure = (fn, failureRate, errorMsg) => {
  return async (...args) => {
    if (Math.random() < failureRate) {
      throw new Error(errorMsg);
    }
    return fn(...args);
  };
};

describe('Execution Infrastructure Stress Tests', () => {
  let executionRouter;
  let ethereumAdapter;
  let solanaAdapter;
  let cosmosAdapter;
  
  // Configuration
  const TRANSACTION_COUNT = 50;         // Total transactions to execute
  const ETHEREUM_FAILURE_RATE = 0.20;   // 20% failure rate
  const SOLANA_FAILURE_RATE = 0.15;     // 15% failure rate
  const COSMOS_FAILURE_RATE = 0.10;     // 10% failure rate
  const NETWORK_CONGESTION_VARIANCE = 0.3;  // Up to 30% variance in congestion
  const FEE_VARIANCE = 0.5;             // Up to 50% variance in fees
  
  // Results tracking
  let results = {
    success: 0,
    failure: 0,
    byChain: {
      ethereum: 0,
      solana: 0,
      cosmos: 0
    },
    errors: {},
    averageExecutionTime: 0
  };
  
  beforeEach(async () => {
    // Clear mocks and reset results
    jest.clearAllMocks();
    results = {
      success: 0,
      failure: 0,
      byChain: {
        ethereum: 0,
        solana: 0,
        cosmos: 0
      },
      errors: {},
      averageExecutionTime: 0
    };
    
    // Create mock adapters
    ethereumAdapter = new EthereumAdapter();
    solanaAdapter = new SolanaAdapter();
    cosmosAdapter = new CosmosAdapter();
    
    // Setup chain identifiers
    ethereumAdapter.getChainId.mockReturnValue('ethereum-1');
    solanaAdapter.getChainId.mockReturnValue('solana-mainnet');
    cosmosAdapter.getChainId.mockReturnValue('cosmos-hub');
    
    // Initialize adapters
    ethereumAdapter.initialize.mockResolvedValue(true);
    solanaAdapter.initialize.mockResolvedValue(true);
    cosmosAdapter.initialize.mockResolvedValue(true);
    
    // Setup chain health status with random congestion
    const setupChainHealth = (adapter, baseLatency, baseTps) => {
      adapter.getChainHealthStatus.mockImplementation(() => {
        const congestion = Math.random() * NETWORK_CONGESTION_VARIANCE + 0.2;
        return {
          isOperational: true,
          currentBlockHeight: 1000000 + Math.floor(Math.random() * 10000),
          latestBlockTimestamp: Date.now() - Math.floor(Math.random() * 10000),
          averageBlockTimeMs: baseLatency + Math.floor(Math.random() * 1000),
          networkCongestion: congestion,
          currentTps: baseTps * (1 - congestion),
          rpcResponseTimeMs: 100 + Math.floor(Math.random() * 400),
          isConfigured: true
        };
      });
    };
    
    setupChainHealth(ethereumAdapter, 15000, 20);
    setupChainHealth(solanaAdapter, 500, 3000);
    setupChainHealth(cosmosAdapter, 6500, 25);
    
    // Setup fee estimations with random variance
    const setupFeeEstimation = (adapter, baseFee, baseTime) => {
      adapter.estimateFees.mockImplementation(() => {
        const variance = (Math.random() * 2 - 1) * FEE_VARIANCE;
        const fee = baseFee * (1 + variance);
        return {
          estimatedFee: fee,
          networkCongestion: Math.random() * 0.7 + 0.1,
          recommendedFees: {
            slow: fee * 0.5,
            average: fee,
            fast: fee * 2
          },
          estimatedTimeToConfirmation: {
            slow: baseTime * 2,
            average: baseTime,
            fast: baseTime * 0.5
          }
        };
      });
    };
    
    setupFeeEstimation(ethereumAdapter, 0.01, 15000);
    setupFeeEstimation(solanaAdapter, 0.00001, 500);
    setupFeeEstimation(cosmosAdapter, 0.001, 6500);
    
    // Setup execution results with random failures
    const setupExecutionStrategy = (adapter, chainId, baseTime, failureRate, errorMsg) => {
      const baseExecution = jest.fn().mockImplementation(() => {
        const executionTime = baseTime + Math.floor(Math.random() * (baseTime * 0.5));
        return {
          success: true,
          transactionId: `${chainId}-tx-${Date.now()}`,
          chainId: chainId,
          feeCost: Math.random() * 0.02,
          executionTimeMs: executionTime,
          timestamp: Date.now()
        };
      });
      
      adapter.executeStrategy.mockImplementation(
        withRandomFailure(baseExecution, failureRate, errorMsg)
      );
    };
    
    setupExecutionStrategy(
      ethereumAdapter, 
      'ethereum-1', 
      10000, 
      ETHEREUM_FAILURE_RATE, 
      'Ethereum execution failed: network congestion'
    );
    
    setupExecutionStrategy(
      solanaAdapter, 
      'solana-mainnet', 
      2000, 
      SOLANA_FAILURE_RATE, 
      'Solana execution failed: timeout waiting for confirmation'
    );
    
    setupExecutionStrategy(
      cosmosAdapter, 
      'cosmos-hub', 
      5000, 
      COSMOS_FAILURE_RATE, 
      'Cosmos execution failed: insufficient funds'
    );
    
    // Create execution router with auto-retry
    executionRouter = CrossChainExecutionRouter.getInstance({
      defaultChainId: 'ethereum-1',
      preferDeployedStrategies: true,
      enableAutoRetry: true,
      maxRetryAttempts: 3,
      selectionWeights: {
        feeCost: 0.3,
        latency: 0.3,
        reliability: 0.3,
        regimeCompatibility: 0.1
      }
    });
    
    // Register adapters
    executionRouter.registerAdapter(ethereumAdapter);
    executionRouter.registerAdapter(solanaAdapter);
    executionRouter.registerAdapter(cosmosAdapter);
  });
  
  // Helper function to run many transactions
  const runStressTest = async (count) => {
    const executions = [];
    let totalExecutionTime = 0;
    
    for (let i = 0; i < count; i++) {
      const strategy = createStressTestStrategy(i);
      const market = `BTC/USD-${i % 5}`; // Various markets
      const params = {
        amount: 0.1 + Math.random() * 0.9, // Between 0.1 and 1 BTC
        slippageTolerance: 0.5 + Math.random() * 1.5, // Between 0.5% and 2%
        timeoutMs: 20000 + Math.random() * 40000, // Between 20s and 60s
        isSimulation: false
      };
      
      // Execute transaction
      const result = await executionRouter.executeStrategy(strategy, market, params);
      
      // Track results
      if (result.success) {
        results.success++;
        totalExecutionTime += result.executionTimeMs;
        
        // Track by chain
        if (result.chainId.includes('ethereum')) {
          results.byChain.ethereum++;
        } else if (result.chainId.includes('solana')) {
          results.byChain.solana++;
        } else if (result.chainId.includes('cosmos')) {
          results.byChain.cosmos++;
        }
      } else {
        results.failure++;
        
        // Track error types
        const errorType = result.error || 'unknown';
        results.errors[errorType] = (results.errors[errorType] || 0) + 1;
      }
      
      executions.push(result);
    }
    
    // Calculate average execution time
    if (results.success > 0) {
      results.averageExecutionTime = totalExecutionTime / results.success;
    }
    
    return executions;
  };
  
  test('should handle high transaction volume with random failures', async () => {
    // Run stress test
    await runStressTest(TRANSACTION_COUNT);
    
    // Success rate should be reasonable despite failures
    const successRate = results.success / TRANSACTION_COUNT;
    expect(successRate).toBeGreaterThan(0.7); // At least 70% success
    
    // Log results
    console.log(`Stress Test Results:
      Success Rate: ${successRate * 100}%
      Success: ${results.success}
      Failures: ${results.failure}
      Chain Distribution:
        Ethereum: ${results.byChain.ethereum}
        Solana: ${results.byChain.solana}
        Cosmos: ${results.byChain.cosmos}
      Average Execution Time: ${results.averageExecutionTime}ms
      Error Types: ${JSON.stringify(results.errors)}
    `);
    
    // Should have used all chains
    expect(results.byChain.ethereum).toBeGreaterThan(0);
    expect(results.byChain.solana).toBeGreaterThan(0);
    expect(results.byChain.cosmos).toBeGreaterThan(0);
    
    // Total should add up
    expect(results.success + results.failure).toBe(TRANSACTION_COUNT);
  }, 30000); // Increase timeout to 30 seconds for this test
  
  test('should handle burst transactions with concurrency', async () => {
    // Execute 10 transactions concurrently
    const CONCURRENT_COUNT = 10;
    const promises = [];
    
    for (let i = 0; i < CONCURRENT_COUNT; i++) {
      const strategy = createStressTestStrategy(`burst-${i}`);
      const market = `BTC/USD`;
      const params = {
        amount: 0.5,
        slippageTolerance: 1.0,
        timeoutMs: 30000,
        isSimulation: false
      };
      
      promises.push(executionRouter.executeStrategy(strategy, market, params));
    }
    
    // Wait for all transactions to complete
    const results = await Promise.all(promises);
    
    // Calculate success rate
    const successCount = results.filter(r => r.success).length;
    const successRate = successCount / CONCURRENT_COUNT;
    
    // Log results
    console.log(`Burst Test Results:
      Success Rate: ${successRate * 100}%
      Success: ${successCount}
      Failures: ${CONCURRENT_COUNT - successCount}
    `);
    
    // Even with concurrent burst, success rate should be reasonable
    expect(successRate).toBeGreaterThan(0.5); // At least 50% success
  }, 30000); // Increase timeout to 30 seconds
  
  test('should maintain performance when one chain is down', async () => {
    // Make Ethereum completely unavailable
    ethereumAdapter.getChainHealthStatus.mockResolvedValue({
      isOperational: false,
      currentBlockHeight: 0,
      latestBlockTimestamp: 0,
      averageBlockTimeMs: 0,
      networkCongestion: 1,
      currentTps: 0,
      rpcResponseTimeMs: 5000,
      isConfigured: true,
      error: 'Network unreachable'
    });
    
    ethereumAdapter.executeStrategy.mockRejectedValue(
      new Error('Ethereum RPC endpoint unavailable')
    );
    
    // Run a smaller stress test
    await runStressTest(20);
    
    // Despite Ethereum being down, success rate should still be good
    const successRate = results.success / 20;
    expect(successRate).toBeGreaterThan(0.7); // At least 70% success
    
    // Ethereum should not have been used
    expect(results.byChain.ethereum).toBe(0);
    
    // Other chains should have been used
    expect(results.byChain.solana + results.byChain.cosmos).toBe(results.success);
    
    // Log results
    console.log(`Ethereum Outage Test Results:
      Success Rate: ${successRate * 100}%
      Success: ${results.success}
      Failures: ${results.failure}
      Chain Distribution:
        Solana: ${results.byChain.solana}
        Cosmos: ${results.byChain.cosmos}
    `);
  }, 15000); // 15 second timeout
}); 