/**
 * Reliability and Monitoring Integration Test
 * 
 * This test validates that the AdapterRegistry properly implements:
 * - Circuit breaker pattern
 * - Exponential backoff retry
 * - Self-healing capabilities
 * - Metrics collection
 */

import { AdapterRegistry } from '../AdapterRegistry.js';
import { blockchainAdapterMetrics, updateCircuitBreakerState, recordBlockchainOperation } from '../../../telemetry/Telemetry.js';

describe('AdapterRegistry Reliability and Monitoring', () => {
  let registry;
  
  beforeEach(() => {
    // Create a registry with test settings
    registry = new AdapterRegistry({
      retryBaseDelayMs: 50,
      retryMaxDelayMs: 200,
      maxRetries: 3,
      circuitBreakerThreshold: 2,
      circuitBreakerResetTimeoutMs: 300,
      metricsEnabled: true
    });
    
    // Register Ethereum, Polygon, and Avalanche adapters
    registry.registerChain(1);   // Ethereum
    registry.registerChain(137); // Polygon
    registry.registerChain(43114); // Avalanche
  });
  
  afterEach(async () => {
    await registry.shutdown();
  });

  test('Circuit breaker opens after threshold failures', async () => {
    // Initialize the registry
    await registry.initialize();
    
    // Mock getBalance to always throw an error for Ethereum
    const ethAdapter = registry.getAdapter(1);
    const originalGetBalance = ethAdapter.getBalance;
    ethAdapter.getBalance = jest.fn().mockRejectedValue(new Error('RPC error'));
    
    // Force circuit breaker to open by making multiple failed calls
    for (let i = 0; i < 3; i++) {
      try {
        await registry.getBalance(1, '0x123');
      } catch (err) {
        // Expected error
      }
    }
    
    // Check circuit breaker state
    const status = await registry.getStatus();
    expect(status.adapters[1].circuitOpen).toBe(true);
    expect(status.health).toBe('degraded');
    
    // Restore original getBalance
    ethAdapter.getBalance = originalGetBalance;
  });

  test('Retry mechanism retries failed operations', async () => {
    await registry.initialize();
    
    // Mock getBalance to fail once then succeed
    const ethAdapter = registry.getAdapter(1);
    const originalGetBalance = ethAdapter.getBalance;
    
    let attempts = 0;
    ethAdapter.getBalance = jest.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Temporary failure');
      }
      return '100.0';
    });
    
    // Execute operation - should fail once then succeed
    const result = await registry.getBalance(1, '0x123');
    
    // Verify it was retried and eventually succeeded
    expect(result).toBe('100.0');
    expect(attempts).toBe(2);
    
    // Restore original getBalance
    ethAdapter.getBalance = originalGetBalance;
  });

  test('Metrics are collected for operations', async () => {
    await registry.initialize();
    
    // Mock the metrics recording function
    const mockCircuitBreakerUpdate = jest.spyOn(updateCircuitBreakerState);
    const mockOperationRecord = jest.spyOn(recordBlockchainOperation);
    
    // Execute operations
    await registry.getBalance(1, '0x123');
    await registry.getQuote(
      { chainId: 1, symbol: 'ETH', decimals: 18, isNative: true },
      { chainId: 1, symbol: 'USDC', decimals: 6, address: '0x123' },
      '1.0'
    );
    
    // Check metrics were collected
    const metrics = registry.getMetrics();
    expect(metrics[1]).toBeDefined();
    expect(metrics[1].averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(metrics[1].successRate).toBe(100);
    expect(metrics[1].callVolume).toBeGreaterThanOrEqual(2);
    
    // Optional check that telemetry functions were called
    // Only if these are properly injected in the AdapterRegistry
    expect(mockCircuitBreakerUpdate).toHaveBeenCalled();
    expect(mockOperationRecord).toHaveBeenCalled();
  });

  test('Health check reconnects disconnected adapters', async () => {
    await registry.initialize();
    
    // Disconnect an adapter
    const ethAdapter = registry.getAdapter(1);
    await ethAdapter.disconnect();
    
    // Mock the connect method to track calls
    const connectSpy = jest.spyOn(ethAdapter, 'connect');
    
    // Manually trigger health check
    await registry.runHealthCheck();
    
    // Check that connect was called
    expect(connectSpy).toHaveBeenCalled();
  });

  test('Cross-chain operations are correctly identified', async () => {
    await registry.initialize();
    
    // Cross-chain quote
    const quote = await registry.getQuote(
      { chainId: 1, symbol: 'ETH', decimals: 18, isNative: true },
      { chainId: 137, symbol: 'MATIC', decimals: 18, isNative: true },
      '1.0'
    );
    
    // Verify cross-chain flag
    expect(quote.crossChain).toBe(true);
    expect(quote.route).toBeDefined();
    expect(quote.route.length).toBeGreaterThan(1);
  });
}); 