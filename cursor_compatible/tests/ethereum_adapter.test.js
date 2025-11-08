import { jest } from '@jest/globals';
import { EthereumAdapter } from '../src/execution/adapters/EthereumAdapter';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';
import * as ethers from 'ethers';

// Mock dependencies
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    }
  };
});

// Mock ethers.js
jest.mock('ethers', () => {
  // Mock transaction that succeeds
  const mockTxResponse = {
    hash: '0xmocktxhash',
    wait: jest.fn().mockResolvedValue({
      status: 1,
      hash: '0xmocktxhash',
      blockNumber: 10000000,
      gasUsed: ethers.parseUnits('100000', 'wei'),
      gasPrice: ethers.parseUnits('50', 'gwei'),
      logs: []
    })
  };
  
  // Mock wallet with sendTransaction method
  const mockWallet = {
    address: '0xmockaddress',
    sendTransaction: jest.fn().mockResolvedValue(mockTxResponse)
  };
  
  return {
    JsonRpcProvider: jest.fn().mockImplementation(() => {
      return {
        getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
        getBlockNumber: jest.fn().mockResolvedValue(10000000),
        getGasPrice: jest.fn().mockResolvedValue(ethers.parseUnits('50', 'gwei')),
        getBlock: jest.fn().mockImplementation((blockNumberOrTag) => {
          if (blockNumberOrTag === 'latest') {
            return Promise.resolve({
              number: 10000000,
              timestamp: Math.floor(Date.now() / 1000)
            });
          } else if (blockNumberOrTag === 9999900) {
            return Promise.resolve({
              number: 9999900,
              timestamp: Math.floor(Date.now() / 1000) - 1200
            });
          }
          return Promise.resolve(null);
        }),
        estimateGas: jest.fn().mockResolvedValue(ethers.parseUnits('100000', 'wei')),
        getTransactionCount: jest.fn().mockResolvedValue(10),
        getTransactionReceipt: jest.fn().mockImplementation((txHash) => {
          if (txHash === '0xmocktxhash') {
            return Promise.resolve({
              status: 1,
              hash: txHash,
              blockNumber: 10000000,
              gasUsed: ethers.parseUnits('100000', 'wei'),
              gasPrice: ethers.parseUnits('50', 'gwei'),
              logs: []
            });
          }
          return Promise.resolve(null);
        })
      };
    }),
    Wallet: jest.fn().mockImplementation(() => mockWallet),
    parseUnits: jest.fn().mockImplementation((value, unit) => {
      if (unit === 'gwei') {
        return BigInt(Number(value) * 10**9);
      }
      return BigInt(value);
    }),
    parseEther: jest.fn().mockImplementation((value) => {
      return BigInt(Number(value) * 10**18);
    }),
    formatUnits: jest.fn().mockImplementation((value, unit) => {
      if (unit === 'gwei') {
        return String(Number(value) / 10**9);
      }
      return String(value);
    }),
    TransactionRequest: jest.fn()
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

describe('EthereumAdapter', () => {
  let adapter;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create adapter with test config
    adapter = new EthereumAdapter({
      rpcUrls: ['https://mainnet.infura.io/v3/mock-api-key'],
      chainId: 1,
      networkName: 'mainnet',
      privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      defaultGasPriceSlow: 20,
      defaultGasPriceAverage: 40,
      defaultGasPriceFast: 60
    });
  });
  
  test('should initialize successfully', async () => {
    // Initialize adapter
    const initialized = await adapter.initialize();
    
    // Check result
    expect(initialized).toBe(true);
    expect(adapter.getChainId()).toBe('ethereum-1');
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'ethereum_adapter_initialized',
      expect.objectContaining({
        chainId: 'ethereum-1',
        networkName: 'mainnet'
      })
    );
  });
  
  test('should execute strategy successfully', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Configure execution params
    const market = 'ETH/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy
    const result = await adapter.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('0xmocktxhash');
    expect(result.feeCost).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeGreaterThan(0);
    
    // Verify wallet.sendTransaction was called
    const mockWallet = new ethers.Wallet();
    expect(mockWallet.sendTransaction).toHaveBeenCalled();
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'ethereum_execution_completed',
      expect.objectContaining({
        strategyId: mockGenome.id,
        market,
        chainId: 'ethereum-1',
        transactionId: '0xmocktxhash',
        success: true
      })
    );
  });
  
  test('should estimate fees correctly', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Configure execution params
    const market = 'ETH/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Estimate fees
    const feeEstimation = await adapter.estimateFees(mockGenome, market, params);
    
    // Check result
    expect(feeEstimation.estimatedFee).toBeGreaterThan(0);
    expect(feeEstimation.networkCongestion).toBeGreaterThanOrEqual(0);
    expect(feeEstimation.networkCongestion).toBeLessThanOrEqual(1);
    expect(feeEstimation.recommendedFees.slow).toBeLessThan(feeEstimation.recommendedFees.fast);
    expect(feeEstimation.estimatedTimeToConfirmation.fast).toBeLessThan(
      feeEstimation.estimatedTimeToConfirmation.slow
    );
  });
  
  test('should check transaction status', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Check status of a known transaction
    const result = await adapter.checkTransactionStatus('0xmocktxhash');
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('0xmocktxhash');
    expect(result.blockHeight).toBeGreaterThan(0);
    
    // Check status of an unknown transaction
    const unknownResult = await adapter.checkTransactionStatus('0xunknown');
    
    // Check result
    expect(unknownResult.success).toBe(false);
    expect(unknownResult.error).toContain('not found');
  });
  
  test('should get chain health status', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Get health status
    const healthStatus = await adapter.getChainHealthStatus();
    
    // Check result
    expect(healthStatus.isOperational).toBe(true);
    expect(healthStatus.currentBlockHeight).toBeGreaterThan(0);
    expect(healthStatus.latestBlockTimestamp).toBeGreaterThan(0);
    expect(healthStatus.averageBlockTimeMs).toBeGreaterThan(0);
    expect(healthStatus.networkCongestion).toBeGreaterThanOrEqual(0);
    expect(healthStatus.networkCongestion).toBeLessThanOrEqual(1);
    expect(healthStatus.rpcResponseTimeMs).toBeGreaterThan(0);
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'ethereum_health_check',
      expect.objectContaining({
        chainId: 'ethereum-1',
        blockHeight: expect.any(Number),
        rpcResponseTimeMs: expect.any(Number)
      })
    );
  });
  
  test('should validate strategy', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Validate a valid strategy
    const validResult = await adapter.validateStrategy(mockGenome);
    
    // Check result
    expect(validResult.isValid).toBe(true);
    
    // Validate an invalid strategy
    const invalidResult = await adapter.validateStrategy(null);
    
    // Check result
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors).toBeDefined();
    expect(invalidResult.errors.length).toBeGreaterThan(0);
  });
  
  test('should handle errors gracefully during execution', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Mock wallet to throw an error
    const mockWallet = new ethers.Wallet();
    mockWallet.sendTransaction.mockRejectedValueOnce(new Error('Simulated error'));
    
    // Configure execution params
    const market = 'ETH/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 30000,
      isSimulation: false
    };
    
    // Execute strategy (should fail gracefully)
    const result = await adapter.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(false);
    expect(result.error).toContain('Simulated error');
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'ethereum_execution_failed',
      expect.objectContaining({
        strategyId: mockGenome.id,
        market,
        chainId: 'ethereum-1',
        error: expect.stringContaining('Simulated error')
      })
    );
  });
}); 