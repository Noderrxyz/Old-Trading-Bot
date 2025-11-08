import { jest } from '@jest/globals';
import { CosmosAdapter } from '../src/execution/adapters/CosmosAdapter';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';

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

describe('CosmosAdapter', () => {
  let adapter;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create adapter with test config
    adapter = new CosmosAdapter({
      rpcUrls: ['https://rpc-test.cosmos.network'],
      networkName: 'cosmoshub-testnet',
      chainId: 'cosmoshub-testnet-4',
      defaultFees: {
        slow: '0.01uatom',
        average: '0.02uatom',
        fast: '0.04uatom'
      }
    });
  });
  
  test('should initialize successfully', async () => {
    // Initialize adapter
    const initialized = await adapter.initialize();
    
    // Check result
    expect(initialized).toBe(true);
    expect(adapter.getChainId()).toBe('cosmos-cosmoshub-testnet-4');
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'cosmos_adapter_initialized',
      expect.objectContaining({
        chainId: 'cosmos-cosmoshub-testnet-4',
        networkName: 'cosmoshub-testnet'
      })
    );
  });
  
  test('should execute strategy successfully', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Configure execution params
    const market = 'ATOM/USD';
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
    expect(result.transactionId).toBeDefined();
    expect(result.transactionId.length).toBeGreaterThan(0);
    expect(result.feeCost).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeGreaterThan(0);
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'cosmos_execution_completed',
      expect.objectContaining({
        strategyId: mockGenome.id,
        market,
        chainId: 'cosmos-cosmoshub-testnet-4',
        success: true
      })
    );
  });
  
  test('should estimate fees correctly', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Configure execution params
    const market = 'ATOM/USD';
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
    expect(feeEstimation.chainSpecific).toBeDefined();
    expect(feeEstimation.chainSpecific.denom).toBe('uatom');
  });
  
  test('should check transaction status', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Check status of a transaction (simulated to be found)
    const result = await adapter.checkTransactionStatus('0x' + '0'.repeat(64));
    
    // Check result
    expect(result.success).toBe(true);
    expect(result.transactionId).toContain('0x');
    expect(result.blockHeight).toBeGreaterThan(0);
    
    // Check status of an unknown transaction
    const unknownResult = await adapter.checkTransactionStatus('unknown');
    
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
    expect(healthStatus.rpcResponseTimeMs).toBeGreaterThanOrEqual(0);
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'cosmos_health_check',
      expect.objectContaining({
        chainId: 'cosmos-cosmoshub-testnet-4',
        blockHeight: expect.any(Number),
        rpcResponseTimeMs: expect.any(Number)
      })
    );
  });
  
  test('should validate strategy', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Mock a valid strategy (with cosmos in ID)
    const cosmosStrategy = {
      ...mockGenome,
      id: 'cosmos-strategy'
    };
    
    // Validate a valid strategy
    const validResult = await adapter.validateStrategy(cosmosStrategy);
    
    // Check result (should be valid because we added "cosmos" to the ID)
    expect(validResult.isValid).toBe(true);
    
    // Validate an invalid strategy
    const invalidResult = await adapter.validateStrategy(null);
    
    // Check result
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors).toBeDefined();
    expect(invalidResult.errors.length).toBeGreaterThan(0);
  });
  
  test('should handle errors gracefully during initialization', async () => {
    // Create adapter that will fail (because we'll mock a failure)
    const failingAdapter = new CosmosAdapter({
      rpcUrls: ['https://bad-url.example.com']
    });
    
    // Mock getLatestBlock to throw an error
    failingAdapter.getLatestBlock = jest.fn().mockRejectedValue(new Error('Connection failed'));
    
    // Try to initialize (should fail gracefully)
    const initialized = await failingAdapter.initialize();
    
    // Check result
    expect(initialized).toBe(false);
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'cosmos_adapter_initialization_failed',
      expect.objectContaining({
        error: expect.stringContaining('Connection failed')
      })
    );
  });
  
  test('should handle errors gracefully during execution', async () => {
    // Initialize adapter
    await adapter.initialize();
    
    // Make adapter throw an error during execution
    adapter.executeStrategyInternal = jest.fn().mockRejectedValue(new Error('Execution error'));
    
    // Configure execution params
    const market = 'ATOM/USD';
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
    expect(result.error).toContain('Execution error');
    
    // Verify telemetry emitted
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'cosmos_execution_failed',
      expect.objectContaining({
        strategyId: mockGenome.id,
        market,
        chainId: 'cosmos-cosmoshub-testnet-4',
        error: expect.stringContaining('Execution error')
      })
    );
  });
}); 