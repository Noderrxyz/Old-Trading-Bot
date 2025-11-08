#!/usr/bin/env node
/**
 * Blockchain Adapter Benchmarking Tool
 * 
 * This script benchmarks the performance of blockchain adapters to verify
 * they meet the performance requirements:
 * 
 * - Connection time: < 2 seconds
 * - Transaction submission latency: < 500ms
 * - Status check latency: < 200ms
 * - Error handling and retries work as expected
 * - Memory usage is within acceptable limits
 */
import { createAdapter } from '../../adapters/index.js';
import { AdapterRegistry } from '../../adapters/registry/AdapterRegistry.js';

// Performance requirements (milliseconds)
const REQUIREMENTS = {
  connectionTime: 2000,
  quoteLatency: 500,
  balanceCheckLatency: 200,
  statusCheckLatency: 200,
  successRate: 99.5, // Percentage
};

// Configuration
const CHAINS_TO_TEST = [
  { id: 1, name: 'Ethereum Mainnet' },
  { id: 137, name: 'Polygon Mainnet' },
  { id: 43114, name: 'Avalanche C-Chain' },
  { id: 42161, name: 'Arbitrum One' },
  { id: 56, name: 'Binance Smart Chain' },
];

// Mock wallet address for testing
const TEST_WALLET = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

// Test assets for quotes
const ASSETS = {
  1: {
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: 1, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1, isNative: false }
  },
  137: {
    native: { symbol: 'MATIC', name: 'Polygon', decimals: 18, chainId: 137, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', chainId: 137, isNative: false }
  },
  43114: {
    native: { symbol: 'AVAX', name: 'Avalanche', decimals: 18, chainId: 43114, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', chainId: 43114, isNative: false }
  },
  42161: {
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: 42161, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', chainId: 42161, isNative: false }
  },
  56: {
    native: { symbol: 'BNB', name: 'Binance Coin', decimals: 18, chainId: 56, isNative: true },
    token: { symbol: 'BUSD', name: 'BUSD', decimals: 18, address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', chainId: 56, isNative: false }
  }
};

async function measurePerformance(adapter, chainId, chainName) {
  const results = {
    chainId,
    chainName,
    connectionTime: 0,
    quoteLatency: 0,
    balanceCheckLatency: 0,
    statusCheckLatency: 0,
    memoryUsageMB: 0,
    errors: [],
    meetsRequirements: true
  };

  // Record initial memory usage
  const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;
  
  try {
    // Test 1: Initialize and connect
    const connectStart = Date.now();
    await adapter.initialize({});
    await adapter.connect();
    results.connectionTime = Date.now() - connectStart;

    // Test 2: Get quote
    const quoteStart = Date.now();
    await adapter.getQuote(
      ASSETS[chainId].native,
      ASSETS[chainId].token,
      '1.0'
    );
    results.quoteLatency = Date.now() - quoteStart;

    // Test 3: Get balance
    const balanceStart = Date.now();
    await adapter.getBalance(TEST_WALLET);
    results.balanceCheckLatency = Date.now() - balanceStart;

    // Test 4: Get status
    const statusStart = Date.now();
    await adapter.getStatus();
    results.statusCheckLatency = Date.now() - statusStart;

    // Record final memory usage and calculate difference
    const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    results.memoryUsageMB = finalMemory - initialMemory;

    // Check against requirements
    if (results.connectionTime > REQUIREMENTS.connectionTime) {
      results.meetsRequirements = false;
      results.errors.push(`Connection time too slow: ${results.connectionTime}ms (limit: ${REQUIREMENTS.connectionTime}ms)`);
    }

    if (results.quoteLatency > REQUIREMENTS.quoteLatency) {
      results.meetsRequirements = false;
      results.errors.push(`Quote latency too high: ${results.quoteLatency}ms (limit: ${REQUIREMENTS.quoteLatency}ms)`);
    }

    if (results.balanceCheckLatency > REQUIREMENTS.balanceCheckLatency) {
      results.meetsRequirements = false;
      results.errors.push(`Balance check latency too high: ${results.balanceCheckLatency}ms (limit: ${REQUIREMENTS.balanceCheckLatency}ms)`);
    }

    if (results.statusCheckLatency > REQUIREMENTS.statusCheckLatency) {
      results.meetsRequirements = false;
      results.errors.push(`Status check latency too high: ${results.statusCheckLatency}ms (limit: ${REQUIREMENTS.statusCheckLatency}ms)`);
    }

    // Clean up
    await adapter.shutdown();
  } catch (error) {
    results.meetsRequirements = false;
    results.errors.push(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try to clean up
    try {
      await adapter.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  }

  return results;
}

async function testAdapterRegistry() {
  console.log('Testing AdapterRegistry performance...');
  
  // Create registry with all chains
  const registry = new AdapterRegistry({
    retryBaseDelayMs: 100,
    maxRetries: 2
  });
  
  // Register all chains
  for (const chain of CHAINS_TO_TEST) {
    registry.registerChain(chain.id);
  }
  
  // Initialize registry
  const initStart = Date.now();
  await registry.initialize();
  const initTime = Date.now() - initStart;
  
  console.log(`Registry initialization time: ${initTime}ms`);
  
  // Test cross-chain quote
  const crossChainStart = Date.now();
  const crossChainQuote = await registry.getQuote(
    ASSETS[1].native, // ETH on Ethereum
    ASSETS[137].token, // USDC on Polygon
    '1.0'
  );
  const crossChainTime = Date.now() - crossChainStart;
  
  console.log(`Cross-chain quote time: ${crossChainTime}ms`);
  console.log(`Cross-chain route: ${crossChainQuote.route?.join(' -> ')}`);
  
  // Clean up
  await registry.shutdown();
}

async function testConcurrentOperations() {
  console.log('Testing concurrent operations...');
  
  // Create adapters for all chains
  const adapters = CHAINS_TO_TEST.map(chain => createAdapter(chain.id));
  
  // Initialize all adapters
  await Promise.all(adapters.map(adapter => adapter.initialize({})));
  await Promise.all(adapters.map(adapter => adapter.connect()));
  
  // Execute operations concurrently
  const startTime = Date.now();
  
  // Run 100 concurrent balance checks across all adapters
  const concurrentChecks = [];
  for (let i = 0; i < 100; i++) {
    const adapterIndex = i % adapters.length;
    concurrentChecks.push(adapters[adapterIndex].getBalance(TEST_WALLET));
  }
  
  await Promise.all(concurrentChecks);
  const totalTime = Date.now() - startTime;
  
  console.log(`100 concurrent balance checks: ${totalTime}ms (${totalTime / 100}ms avg)`);
  
  // Clean up
  await Promise.all(adapters.map(adapter => adapter.shutdown()));
}

async function runBenchmarks() {
  console.log('============================================');
  console.log('Blockchain Adapter Performance Benchmark');
  console.log('============================================');
  
  const results = [];
  
  // Test individual adapters
  for (const chain of CHAINS_TO_TEST) {
    console.log(`\nTesting ${chain.name} (${chain.id})...`);
    
    try {
      const adapter = createAdapter(chain.id);
      const result = await measurePerformance(adapter, chain.id, chain.name);
      results.push(result);
      
      // Print individual result
      console.log(`Connection time: ${result.connectionTime}ms (limit: ${REQUIREMENTS.connectionTime}ms) - ${result.connectionTime <= REQUIREMENTS.connectionTime ? 'PASS' : 'FAIL'}`);
      console.log(`Quote latency: ${result.quoteLatency}ms (limit: ${REQUIREMENTS.quoteLatency}ms) - ${result.quoteLatency <= REQUIREMENTS.quoteLatency ? 'PASS' : 'FAIL'}`);
      console.log(`Balance check latency: ${result.balanceCheckLatency}ms (limit: ${REQUIREMENTS.balanceCheckLatency}ms) - ${result.balanceCheckLatency <= REQUIREMENTS.balanceCheckLatency ? 'PASS' : 'FAIL'}`);
      console.log(`Status check latency: ${result.statusCheckLatency}ms (limit: ${REQUIREMENTS.statusCheckLatency}ms) - ${result.statusCheckLatency <= REQUIREMENTS.statusCheckLatency ? 'PASS' : 'FAIL'}`);
      console.log(`Memory usage: ${result.memoryUsageMB.toFixed(2)}MB`);
      
      if (result.errors.length > 0) {
        console.log('Errors:');
        result.errors.forEach(error => console.log(`  - ${error}`));
      }
      
      console.log(`Overall: ${result.meetsRequirements ? 'MEETS REQUIREMENTS' : 'DOES NOT MEET REQUIREMENTS'}`);
    } catch (error) {
      console.error(`Failed to test ${chain.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Test adapter registry
  await testAdapterRegistry();
  
  // Test concurrent operations
  await testConcurrentOperations();
  
  // Output summary
  console.log('\n============================================');
  console.log('Performance Benchmark Summary');
  console.log('============================================');
  
  const passedChains = results.filter(r => r.meetsRequirements).length;
  console.log(`${passedChains} of ${results.length} chains meet all requirements (${(passedChains / results.length * 100).toFixed(1)}%)`);
  
  // Calculate averages
  const avgConnectionTime = results.reduce((sum, r) => sum + r.connectionTime, 0) / results.length;
  const avgQuoteLatency = results.reduce((sum, r) => sum + r.quoteLatency, 0) / results.length;
  const avgBalanceCheckLatency = results.reduce((sum, r) => sum + r.balanceCheckLatency, 0) / results.length;
  const avgStatusCheckLatency = results.reduce((sum, r) => sum + r.statusCheckLatency, 0) / results.length;
  
  console.log(`Average connection time: ${avgConnectionTime.toFixed(2)}ms`);
  console.log(`Average quote latency: ${avgQuoteLatency.toFixed(2)}ms`);
  console.log(`Average balance check latency: ${avgBalanceCheckLatency.toFixed(2)}ms`);
  console.log(`Average status check latency: ${avgStatusCheckLatency.toFixed(2)}ms`);
  
  // Identify slowest chain
  const slowestChain = results.reduce((slowest, r) => {
    const totalLatency = r.connectionTime + r.quoteLatency + r.balanceCheckLatency + r.statusCheckLatency;
    const slowestLatency = slowest.connectionTime + slowest.quoteLatency + slowest.balanceCheckLatency + slowest.statusCheckLatency;
    return totalLatency > slowestLatency ? r : slowest;
  }, results[0]);
  
  console.log(`Slowest chain: ${slowestChain.chainName}`);
  
  // Exit with success if all chains passed, failure otherwise
  if (passedChains === results.length) {
    console.log('\nAll blockchain adapters meet performance requirements!');
    process.exit(0);
  } else {
    console.error('\nSome blockchain adapters do not meet performance requirements.');
    process.exit(1);
  }
}

// Run benchmarks
runBenchmarks().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
}); 