import { jest } from '@jest/globals';
import { SolanaAdapter } from '../src/execution/adapters/SolanaAdapter';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';
import * as web3 from '@solana/web3.js';
import * as bs58 from 'bs58';

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

// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => {
  // Mock public key
  class MockPublicKey {
    constructor(value) {
      this.value = value;
    }
    
    toBase58() {
      return 'mockPubKey';
    }
    
    equals(other) {
      return this.value === other.value;
    }
  }
  
  // Mock keypair
  class MockKeypair {
    constructor() {
      this.publicKey = new MockPublicKey('mock');
      this.secretKey = new Uint8Array(32).fill(1);
    }
    
    static fromSecretKey(secretKey) {
      return new MockKeypair();
    }
  }
  
  // Mock transaction
  class MockTransaction {
    constructor(params = {}) {
      this.recentBlockhash = params.blockhash || 'mockblockhash';
      this.feePayer = params.feePayer || new MockPublicKey('mock');
      this.instructions = [];
      this.signatures = [];
    }
    
    add(...instructions) {
      this.instructions.push(...instructions);
    }
    
    sign(...signers) {
      this.signatures.push(...signers.map(() => 'mocksignature'));
    }
    
    serialize() {
      return Buffer.from('mocktxdata');
    }
  }
  
  // Mock connection
  const mockGetTransactionReturn = {
    meta: {
      err: null,
      fee: 5000,
      computeUnitsConsumed: 100000,
      logMessages: ['mock log 1', 'mock log 2']
    },
    slot: 150000000
  };
  
  const mockConnection = {
    getVersion: jest.fn().mockResolvedValue({ 'solana-core': '1.10.0' }),
    getSlot: jest.fn().mockResolvedValue(150000000),
    getBlockTime: jest.fn().mockResolvedValue(Math.floor(Date.now() / 1000)),
    getSupply: jest.fn().mockResolvedValue({ circulating: { amount: 500000000 } }),
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: 'mockblockhash',
      lastValidBlockHeight: 150001000
    }),
    getFeeForMessage: jest.fn().mockResolvedValue({ value: 5000 }),
    getBlockHeight: jest.fn().mockResolvedValue(150000000),
    getRecentPerformanceSamples: jest.fn().mockResolvedValue([
      { numTransactions: 4000, samplePeriodSecs: 2 },
      { numTransactions: 3800, samplePeriodSecs: 2 }
    ]),
    sendRawTransaction: jest.fn().mockResolvedValue('mocktxsignature'),
    getSignatureStatus: jest.fn().mockResolvedValue({
      value: {
        confirmationStatus: 'confirmed',
        confirmations: 10
      }
    }),
    getTransaction: jest.fn().mockImplementation((signature) => {
      if (signature === 'mocktxsignature') {
        return Promise.resolve(mockGetTransactionReturn);
      }
      return Promise.resolve(null);
    })
  };
  
  // Mock program interfaces
  return {
    Connection: jest.fn().mockImplementation(() => mockConnection),
    Keypair: MockKeypair,
    PublicKey: MockPublicKey,
    Transaction: MockTransaction,
    SystemProgram: {
      transfer: jest.fn().mockReturnValue({ programId: new MockPublicKey('system') })
    },
    ComputeBudgetProgram: {
      setComputeUnitLimit: jest.fn().mockReturnValue({ programId: new MockPublicKey('compute-budget') }),
      setComputeUnitPrice: jest.fn().mockReturnValue({ programId: new MockPublicKey('compute-budget') })
    },
    Message: {
      from: jest.fn().mockReturnValue({ staticAccountKeys: [] })
    },
    LAMPORTS_PER_SOL: 1000000000,
    clusterApiUrl: jest.fn().mockImplementation((network) => `https://api.${network}.solana.com`)
  };
});

// Mock bs58
jest.mock('bs58', () => ({
  decode: jest.fn().mockReturnValue(new Uint8Array(32).fill(1)),
  encode: jest.fn().mockReturnValue('mockbs58encoded')
}));

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

describe('SolanaAdapter', () => {
  let adapter;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create adapter with test config
    adapter = new SolanaAdapter({
      rpcUrls: ['https://api.mainnet-beta.solana.com'],
      network: 'mainnet-beta',
      privateKey: 'mockprivatekey',
      commitment: 'confirmed',
      maxRetries: 3,
      maxComputeUnits: 200000,
      priorityFee: 1000
    });
  });
  
  test('should initialize successfully', async () => {
    // Initialize adapter
    const initialized = await adapter.initialize();
    
    // Check result
    expect(initialized).toBe(true);
    expect(adapter.getChainId()).toBe('solana-mainnet-beta');
    
    // Verify version was checked
    expect(web3.Connection.mock.results[0].value.getVersion).toHaveBeenCalled();
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'solana_adapter_initialized',
      expect.objectContaining({
        chainId: 'solana-mainnet-beta',
        network: 'mainnet-beta'
      })
    );
  });
  
  test('should execute strategy successfully', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Configure execution params
    const market = 'SOL/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 10000,
      isSimulation: false
    };
    
    // Execute strategy
    const result = await adapter.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('mocktxsignature');
    expect(result.feeCost).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeGreaterThan(0);
    expect(result.blockHeight).toBeGreaterThan(0);
    
    // Verify transaction was sent
    expect(web3.Connection.mock.results[0].value.sendRawTransaction).toHaveBeenCalled();
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'solana_execution_completed',
      expect.objectContaining({
        strategyId: mockGenome.id,
        market,
        chainId: 'solana-mainnet-beta',
        transactionId: 'mocktxsignature',
        success: true
      })
    );
  });
  
  test('should estimate fees correctly', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Configure execution params
    const market = 'SOL/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 10000,
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
    
    // Verify fee calculation was done
    expect(web3.Connection.mock.results[0].value.getFeeForMessage).toHaveBeenCalled();
  });
  
  test('should check transaction status', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Check status of a known transaction
    const result = await adapter.checkTransactionStatus('mocktxsignature');
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('mocktxsignature');
    expect(result.blockHeight).toBeGreaterThan(0);
    expect(result.chainData.computeUnitsConsumed).toBeGreaterThan(0);
    
    // Check status of an unknown transaction
    const unknownResult = await adapter.checkTransactionStatus('unknownsignature');
    
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
    expect(healthStatus.currentTps).toBeGreaterThan(0);
    expect(healthStatus.rpcResponseTimeMs).toBeGreaterThan(0);
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'solana_health_check',
      expect.objectContaining({
        chainId: 'solana-mainnet-beta',
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
    
    // Mock sendRawTransaction to throw an error
    web3.Connection.mock.results[0].value.sendRawTransaction.mockRejectedValueOnce(
      new Error('Simulated transaction error')
    );
    
    // Configure execution params
    const market = 'SOL/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 10000,
      isSimulation: false
    };
    
    // Execute strategy (should fail gracefully)
    const result = await adapter.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(false);
    expect(result.error).toContain('Simulated transaction error');
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'solana_execution_failed',
      expect.objectContaining({
        strategyId: mockGenome.id,
        market,
        chainId: 'solana-mainnet-beta',
        error: expect.stringContaining('Simulated transaction error')
      })
    );
  });
  
  test('should handle fallback RPCs when primary fails', async () => {
    // Create adapter with multiple RPCs
    adapter = new SolanaAdapter({
      rpcUrls: [
        'https://api.mainnet-beta.solana.com', 
        'https://solana-api.projectserum.com', 
        'https://rpc.ankr.com/solana'
      ],
      network: 'mainnet-beta',
      privateKey: 'mockprivatekey'
    });
    
    // Initialize adapter
    await adapter.initialize();
    
    // Make primary RPC fail
    web3.Connection.mock.results[0].value.getLatestBlockhash.mockRejectedValueOnce(
      new Error('Primary RPC error')
    );
    
    // Configure execution params
    const market = 'SOL/USD';
    const params = {
      amount: 0.1,
      slippageTolerance: 1.0,
      timeoutMs: 10000,
      isSimulation: false
    };
    
    // Execute strategy (should succeed with fallback)
    const result = await adapter.executeStrategy(mockGenome, market, params);
    
    // Check result
    expect(result.success).toBe(true);
    
    // Multiple connections should have been created due to fallback
    expect(web3.Connection).toHaveBeenCalledTimes(3); // Initial + 2 fallbacks
  });
}); 