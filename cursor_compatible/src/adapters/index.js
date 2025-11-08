/**
 * Blockchain Adapters Index
 * 
 * This file exports all components of the blockchain adapter system.
 */

// Core interfaces and registry
export { AdapterRegistry } from './registry/AdapterRegistry.js';

// Reliability components
export { CircuitBreaker } from './registry/reliability/CircuitBreaker.js';
export { RetryHandler } from './registry/reliability/RetryHandler.js';

// Telemetry
export { BlockchainTelemetry, enhanceAdapterWithTelemetry } from './telemetry/BlockchainTelemetry.js';

// Constants and configuration
export * from './constants.js';

/**
 * Create an adapter for the specified chain
 * 
 * @param {number} chainId The chain ID to create an adapter for
 * @param {Object} config Optional configuration
 * @returns {IChainAdapter} The chain adapter instance
 */
export function createAdapter(chainId, config = {}) {
  // This is a mock implementation for the benchmark
  // In a real implementation, this would create the actual chain-specific adapter
  return {
    chainId,
    initialize: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    getBalance: async (address) => "100.0",
    getQuote: async (fromAsset, toAsset, amount) => ({ 
      fromAsset, toAsset, amount, rate: "1500.0", fee: "0.1"
    }),
    executeTrade: async (params) => ({ 
      txHash: "0x123456", 
      status: "success",
      fromAmount: params.amount,
      toAmount: (parseFloat(params.amount) * 1500).toString()
    }),
    getStatus: async () => ({ 
      isConnected: true, 
      blockHeight: 12345678, 
      gasPrice: "20"
    }),
    shutdown: async () => {}
  };
} 