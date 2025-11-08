/**
 * Blockchain Adapter Benchmark Harness
 * 
 * This module provides a framework for testing blockchain adapter performance
 * in a consistent, reproducible way. It integrates with the project's
 * metrics system and follows production-grade benchmarking practices.
 */

import { createAdapter } from '../index.js';
import { AdapterRegistry } from '../registry/AdapterRegistry.js';
import { telemetry } from '../../telemetry/Telemetry.js';

// Chain configurations for benchmarking
const CHAINS = {
  ETHEREUM: { id: 1, name: 'Ethereum Mainnet' },
  POLYGON: { id: 137, name: 'Polygon Mainnet' },
  AVALANCHE: { id: 43114, name: 'Avalanche C-Chain' },
  ARBITRUM: { id: 42161, name: 'Arbitrum One' },
  BINANCE: { id: 56, name: 'Binance Smart Chain' }
};

// Performance requirements (milliseconds)
const REQUIREMENTS = {
  connectionTime: 2000,
  quoteLatency: 500,
  balanceCheckLatency: 200,
  statusCheckLatency: 200,
  successRate: 99.5, // Percentage
  memoryLeakThreshold: 5 // MB
};

// Test assets for quotes by chain
const ASSETS = {
  1: { // Ethereum
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: 1, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1, isNative: false }
  },
  137: { // Polygon
    native: { symbol: 'MATIC', name: 'Polygon', decimals: 18, chainId: 137, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', chainId: 137, isNative: false }
  },
  43114: { // Avalanche
    native: { symbol: 'AVAX', name: 'Avalanche', decimals: 18, chainId: 43114, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', chainId: 43114, isNative: false }
  },
  42161: { // Arbitrum
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: 42161, isNative: true },
    token: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', chainId: 42161, isNative: false }
  },
  56: { // Binance
    native: { symbol: 'BNB', name: 'Binance Coin', decimals: 18, chainId: 56, isNative: true },
    token: { symbol: 'BUSD', name: 'BUSD', decimals: 18, address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', chainId: 56, isNative: false }
  }
};

// Standard wallet address for testing
const TEST_WALLET = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

/**
 * Result structure for a benchmark test
 */
export class BenchmarkResult {
  constructor(chainId, chainName) {
    this.chainId = chainId;
    this.chainName = chainName;
    this.metrics = {
      connectionTime: 0,
      quoteLatency: 0,
      balanceCheckLatency: 0,
      statusCheckLatency: 0,
      memoryUsageMB: 0,
      errorCount: 0,
      failureRate: 0,
      errorTypes: {},
      circuitBreakerTrips: 0,
      retryCount: 0,
      concurrentOpLatency: 0
    };
    this.errors = [];
    this.meetsRequirements = true;
    this.testsPassed = 0;
    this.testsTotal = 0;
  }

  /**
   * Check if the benchmark meets all requirements
   */
  evaluateRequirements() {
    this.testsTotal = 4; // Basic tests count
    
    // Reset requirements check
    this.meetsRequirements = true;
    
    // Connection time check
    if (this.metrics.connectionTime > REQUIREMENTS.connectionTime) {
      this.meetsRequirements = false;
      this.errors.push(`Connection time too slow: ${this.metrics.connectionTime}ms (limit: ${REQUIREMENTS.connectionTime}ms)`);
    } else {
      this.testsPassed++;
    }
    
    // Quote latency check
    if (this.metrics.quoteLatency > REQUIREMENTS.quoteLatency) {
      this.meetsRequirements = false;
      this.errors.push(`Quote latency too high: ${this.metrics.quoteLatency}ms (limit: ${REQUIREMENTS.quoteLatency}ms)`);
    } else {
      this.testsPassed++;
    }
    
    // Balance check latency
    if (this.metrics.balanceCheckLatency > REQUIREMENTS.balanceCheckLatency) {
      this.meetsRequirements = false;
      this.errors.push(`Balance check latency too high: ${this.metrics.balanceCheckLatency}ms (limit: ${REQUIREMENTS.balanceCheckLatency}ms)`);
    } else {
      this.testsPassed++;
    }
    
    // Status check latency
    if (this.metrics.statusCheckLatency > REQUIREMENTS.statusCheckLatency) {
      this.meetsRequirements = false;
      this.errors.push(`Status check latency too high: ${this.metrics.statusCheckLatency}ms (limit: ${REQUIREMENTS.statusCheckLatency}ms)`);
    } else {
      this.testsPassed++;
    }
    
    // Memory leak check
    if (this.metrics.memoryUsageMB > REQUIREMENTS.memoryLeakThreshold) {
      this.meetsRequirements = false;
      this.errors.push(`Potential memory leak detected: ${this.metrics.memoryUsageMB.toFixed(2)}MB used (threshold: ${REQUIREMENTS.memoryLeakThreshold}MB)`);
    }
    
    // Failure rate check
    if (this.metrics.failureRate > (100 - REQUIREMENTS.successRate)) {
      this.meetsRequirements = false;
      this.errors.push(`Failure rate too high: ${this.metrics.failureRate.toFixed(2)}% (max: ${(100 - REQUIREMENTS.successRate).toFixed(2)}%)`);
    }
    
    return this.meetsRequirements;
  }
  
  /**
   * Get formatted summary of benchmark results
   */
  getSummary() {
    const passStatus = this.meetsRequirements ? '✅ PASS' : '❌ FAIL';
    const passPct = this.testsTotal > 0 ? ((this.testsPassed / this.testsTotal) * 100).toFixed(0) : 0;
    
    return {
      chain: `${this.chainName} (${this.chainId})`,
      status: passStatus,
      passRate: `${passPct}% (${this.testsPassed}/${this.testsTotal})`,
      connectionTime: `${this.metrics.connectionTime}ms`,
      quoteLatency: `${this.metrics.quoteLatency}ms`,
      balanceLatency: `${this.metrics.balanceCheckLatency}ms`,
      statusLatency: `${this.metrics.statusCheckLatency}ms`,
      memoryUsage: `${this.metrics.memoryUsageMB.toFixed(2)}MB`,
      errors: this.errors
    };
  }
}

/**
 * The Benchmark Harness class
 */
export class BenchmarkHarness {
  constructor(options = {}) {
    this.options = {
      chainsToTest: Object.values(CHAINS),
      includeStressTests: true,
      includeCrossChainTests: true,
      includeFaultInjection: true,
      concurrentOperations: 100,
      ...options
    };
    
    this.results = [];
    this.summary = {
      totalPassed: 0,
      totalFailed: 0,
      averages: {
        connectionTime: 0,
        quoteLatency: 0,
        balanceCheckLatency: 0,
        statusCheckLatency: 0,
        memoryUsage: 0
      }
    };
  }
  
  /**
   * Run all benchmarks
   */
  async runAll() {
    console.log('='.repeat(60));
    console.log('Blockchain Adapter Performance Benchmark');
    console.log('='.repeat(60));
    
    // Test individual adapters
    for (const chain of this.options.chainsToTest) {
      await this.benchmarkChain(chain);
    }
    
    // Cross-chain tests
    if (this.options.includeCrossChainTests && this.options.chainsToTest.length >= 2) {
      await this.benchmarkCrossChain();
    }
    
    // Stress test with concurrent operations
    if (this.options.includeStressTests) {
      await this.benchmarkConcurrentOperations();
    }
    
    // Fault injection tests if enabled
    if (this.options.includeFaultInjection) {
      await this.benchmarkFaultTolerance();
    }
    
    // Generate summary
    this.generateSummary();
    this.printSummary();
    
    return {
      results: this.results,
      summary: this.summary
    };
  }
  
  /**
   * Benchmark a specific blockchain
   */
  async benchmarkChain(chain) {
    console.log(`\nTesting ${chain.name} (${chain.id})...`);
    
    const result = new BenchmarkResult(chain.id, chain.name);
    
    try {
      // Create adapter instance
      const adapter = createAdapter(chain.id);
      
      // Record memory before tests
      const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      
      // Test 1: Initialize and connect
      const connectStart = Date.now();
      await adapter.initialize({});
      await adapter.connect();
      result.metrics.connectionTime = Date.now() - connectStart;
      
      // Test 2: Get quote
      const quoteStart = Date.now();
      await adapter.getQuote(
        ASSETS[chain.id].native,
        ASSETS[chain.id].token,
        '1.0'
      );
      result.metrics.quoteLatency = Date.now() - quoteStart;
      
      // Test 3: Get balance
      const balanceStart = Date.now();
      await adapter.getBalance(TEST_WALLET);
      result.metrics.balanceCheckLatency = Date.now() - balanceStart;
      
      // Test 4: Get status
      const statusStart = Date.now();
      await adapter.getStatus();
      result.metrics.statusCheckLatency = Date.now() - statusStart;
      
      // Measure memory usage
      const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      result.metrics.memoryUsageMB = finalMemory - initialMemory;
      
      // Shutdown adapter
      await adapter.shutdown();
      
      // Evaluate requirements
      result.evaluateRequirements();
      
      // Print results
      this.printChainResult(result);
      
      // Add to results array
      this.results.push(result);
      
    } catch (error) {
      console.error(`❌ Error benchmarking ${chain.name}:`, error.message);
      result.errors.push(`Test failed: ${error.message}`);
      result.meetsRequirements = false;
      this.results.push(result);
    }
    
    return result;
  }
  
  /**
   * Benchmark cross-chain operations
   */
  async benchmarkCrossChain() {
    console.log('\nTesting Cross-Chain Operations...');
    
    try {
      // Create registry
      const registry = new AdapterRegistry({
        retryBaseDelayMs: 100,
        maxRetries: 2
      });
      
      // Register chains
      for (const chain of this.options.chainsToTest) {
        registry.registerChain(chain.id);
      }
      
      // Initialize registry
      const initStart = Date.now();
      await registry.initialize();
      const initTime = Date.now() - initStart;
      console.log(`Registry initialization time: ${initTime}ms`);
      
      // Pick two chains for cross-chain test
      const sourceChain = this.options.chainsToTest[0];
      const targetChain = this.options.chainsToTest[1];
      
      // Test cross-chain quote
      const crossChainStart = Date.now();
      const crossChainQuote = await registry.getQuote(
        ASSETS[sourceChain.id].native,
        ASSETS[targetChain.id].token,
        '1.0'
      );
      const crossChainTime = Date.now() - crossChainStart;
      
      console.log(`Cross-chain quote time: ${crossChainTime}ms`);
      console.log(`Route: ${crossChainQuote.route?.join(' -> ') || 'N/A'}`);
      
      // Shutdown
      await registry.shutdown();
      
    } catch (error) {
      console.error('❌ Error in cross-chain test:', error.message);
    }
  }
  
  /**
   * Benchmark concurrent operations
   */
  async benchmarkConcurrentOperations() {
    console.log('\nTesting Concurrent Operations...');
    
    try {
      // Create adapters for all chains
      const adapters = this.options.chainsToTest.map(chain => createAdapter(chain.id));
      
      // Initialize all adapters
      await Promise.all(adapters.map(adapter => adapter.initialize({})));
      await Promise.all(adapters.map(adapter => adapter.connect()));
      
      // Execute operations concurrently
      const startTime = Date.now();
      
      // Run concurrent balance checks across all adapters
      const concurrentChecks = [];
      for (let i = 0; i < this.options.concurrentOperations; i++) {
        const adapterIndex = i % adapters.length;
        concurrentChecks.push(adapters[adapterIndex].getBalance(TEST_WALLET));
      }
      
      await Promise.all(concurrentChecks);
      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / this.options.concurrentOperations;
      
      console.log(`${this.options.concurrentOperations} concurrent operations completed in ${totalTime}ms`);
      console.log(`Average operation time: ${avgTime.toFixed(2)}ms`);
      
      // Clean up
      await Promise.all(adapters.map(adapter => adapter.shutdown()));
      
      // Record in summary
      this.summary.concurrentOperations = {
        count: this.options.concurrentOperations,
        totalTime,
        averageTime: avgTime
      };
      
    } catch (error) {
      console.error('❌ Error in concurrent operations test:', error.message);
    }
  }
  
  /**
   * Benchmark fault tolerance with injected failures
   */
  async benchmarkFaultTolerance() {
    console.log('\nTesting Fault Tolerance...');
    
    try {
      // Create registry with reliability settings
      const registry = new AdapterRegistry({
        retryBaseDelayMs: 50,
        retryMaxDelayMs: 200,
        maxRetries: 3,
        circuitBreakerThreshold: 5,
        circuitBreakerResetTimeoutMs: 300
      });
      
      // Register one chain for fault testing
      const testChain = this.options.chainsToTest[0];
      registry.registerChain(testChain.id);
      
      // Initialize registry
      await registry.initialize();
      
      // Get adapter and test normal operation
      const adapter = registry.getAdapter(testChain.id);
      
      // Test 1: Retry mechanism
      console.log('Testing retry mechanism...');
      
      // Block adapter's RPC to simulate temporary failure
      let failCount = 0;
      const originalGetBalance = adapter.getBalance;
      adapter.getBalance = async (address) => {
        failCount++;
        if (failCount <= 2) {
          throw new Error('Simulated temporary failure');
        }
        return '100.0';
      };
      
      // Should succeed after retries
      const balanceResult = await registry.getBalance(testChain.id, TEST_WALLET);
      console.log(`Retry test: ${failCount >= 3 ? '✅ PASS' : '❌ FAIL'} (${failCount} attempts)`);
      
      // Restore adapter
      adapter.getBalance = originalGetBalance;
      
      // Test 2: Circuit breaker
      console.log('Testing circuit breaker pattern...');
      
      // Make adapter fail consistently
      adapter.getBalance = async () => {
        throw new Error('Simulated persistent failure');
      };
      
      // Try operations until circuit opens
      let circuitOpen = false;
      let attempts = 0;
      while (!circuitOpen && attempts < 10) {
        attempts++;
        try {
          await registry.getBalance(testChain.id, TEST_WALLET);
        } catch (error) {
          if (error.message.includes('Circuit breaker open')) {
            circuitOpen = true;
          }
        }
      }
      
      console.log(`Circuit breaker test: ${circuitOpen ? '✅ PASS' : '❌ FAIL'} (opened after ${attempts} failures)`);
      
      // Restore adapter and shutdown
      adapter.getBalance = originalGetBalance;
      await registry.shutdown();
      
    } catch (error) {
      console.error('❌ Error in fault tolerance test:', error.message);
    }
  }
  
  /**
   * Generate summary statistics
   */
  generateSummary() {
    // Count passed/failed tests
    this.summary.totalPassed = this.results.filter(r => r.meetsRequirements).length;
    this.summary.totalFailed = this.results.length - this.summary.totalPassed;
    
    // Calculate averages
    if (this.results.length > 0) {
      this.summary.averages.connectionTime = this.results.reduce((sum, r) => sum + r.metrics.connectionTime, 0) / this.results.length;
      this.summary.averages.quoteLatency = this.results.reduce((sum, r) => sum + r.metrics.quoteLatency, 0) / this.results.length;
      this.summary.averages.balanceCheckLatency = this.results.reduce((sum, r) => sum + r.metrics.balanceCheckLatency, 0) / this.results.length;
      this.summary.averages.statusCheckLatency = this.results.reduce((sum, r) => sum + r.metrics.statusCheckLatency, 0) / this.results.length;
      this.summary.averages.memoryUsage = this.results.reduce((sum, r) => sum + r.metrics.memoryUsageMB, 0) / this.results.length;
    }
    
    // Find slowest chain
    if (this.results.length > 0) {
      this.summary.slowestChain = this.results.reduce((slowest, r) => {
        const totalLatency = r.metrics.connectionTime + r.metrics.quoteLatency + 
                            r.metrics.balanceCheckLatency + r.metrics.statusCheckLatency;
        const slowestLatency = slowest ? 
                              slowest.metrics.connectionTime + slowest.metrics.quoteLatency + 
                              slowest.metrics.balanceCheckLatency + slowest.metrics.statusCheckLatency : 0;
        return totalLatency > slowestLatency ? r : slowest;
      }, null);
    }
    
    // Calculate overall status
    this.summary.overallStatus = this.summary.totalFailed === 0 ? 'PASS' : 'FAIL';
    this.summary.passingRate = this.results.length > 0 ? 
                             (this.summary.totalPassed / this.results.length * 100).toFixed(1) + '%' : 'N/A';
  }
  
  /**
   * Print results for a single chain
   */
  printChainResult(result) {
    const passStatus = result.meetsRequirements ? '✅ PASS' : '❌ FAIL';
    
    console.log(`Connection time: ${result.metrics.connectionTime}ms (limit: ${REQUIREMENTS.connectionTime}ms) - ${result.metrics.connectionTime <= REQUIREMENTS.connectionTime ? '✅' : '❌'}`);
    console.log(`Quote latency: ${result.metrics.quoteLatency}ms (limit: ${REQUIREMENTS.quoteLatency}ms) - ${result.metrics.quoteLatency <= REQUIREMENTS.quoteLatency ? '✅' : '❌'}`);
    console.log(`Balance check latency: ${result.metrics.balanceCheckLatency}ms (limit: ${REQUIREMENTS.balanceCheckLatency}ms) - ${result.metrics.balanceCheckLatency <= REQUIREMENTS.balanceCheckLatency ? '✅' : '❌'}`);
    console.log(`Status check latency: ${result.metrics.statusCheckLatency}ms (limit: ${REQUIREMENTS.statusCheckLatency}ms) - ${result.metrics.statusCheckLatency <= REQUIREMENTS.statusCheckLatency ? '✅' : '❌'}`);
    console.log(`Memory usage: ${result.metrics.memoryUsageMB.toFixed(2)}MB`);
    
    if (result.errors.length > 0) {
      console.log('Errors:');
      result.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    console.log(`Overall: ${passStatus}`);
  }
  
  /**
   * Print summary of all benchmark results
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('Blockchain Adapter Benchmark Summary');
    console.log('='.repeat(60));
    
    console.log(`Overall Status: ${this.summary.overallStatus === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Passing Rate: ${this.summary.passingRate} (${this.summary.totalPassed}/${this.results.length} chains)`);
    
    console.log('\nAverage Performance:');
    console.log(`Connection time: ${this.summary.averages.connectionTime.toFixed(2)}ms`);
    console.log(`Quote latency: ${this.summary.averages.quoteLatency.toFixed(2)}ms`);
    console.log(`Balance check latency: ${this.summary.averages.balanceCheckLatency.toFixed(2)}ms`);
    console.log(`Status check latency: ${this.summary.averages.statusCheckLatency.toFixed(2)}ms`);
    console.log(`Memory usage: ${this.summary.averages.memoryUsage.toFixed(2)}MB`);
    
    if (this.summary.slowestChain) {
      console.log(`\nSlowest chain: ${this.summary.slowestChain.chainName}`);
    }
    
    if (this.summary.concurrentOperations) {
      console.log(`\nConcurrent Operations (${this.summary.concurrentOperations.count}):`);
      console.log(`Total time: ${this.summary.concurrentOperations.totalTime}ms`);
      console.log(`Average time per operation: ${this.summary.concurrentOperations.averageTime.toFixed(2)}ms`);
    }
    
    console.log('\nIndividual Results:');
    for (const result of this.results) {
      const status = result.meetsRequirements ? '✅ PASS' : '❌ FAIL';
      console.log(`${result.chainName} (${result.chainId}): ${status}`);
    }
    
    const exitMessage = this.summary.overallStatus === 'PASS' 
      ? '✅ All blockchain adapters meet performance requirements!'
      : '❌ Some blockchain adapters do not meet performance requirements.';
    
    console.log(`\n${exitMessage}`);
    
    // Send telemetry data
    this.sendTelemetry();
  }
  
  /**
   * Send benchmark results to telemetry system
   */
  sendTelemetry() {
    if (!telemetry) return;
    
    try {
      // Record overall benchmark status
      telemetry.recordMetric(
        'blockchain_adapter_benchmark_status',
        this.summary.overallStatus === 'PASS' ? 1 : 0,
        { passing_rate: this.summary.passingRate }
      );
      
      // Record average metrics
      telemetry.recordMetric(
        'blockchain_adapter_benchmark_avg_connection_time',
        this.summary.averages.connectionTime,
        {}
      );
      
      telemetry.recordMetric(
        'blockchain_adapter_benchmark_avg_quote_latency',
        this.summary.averages.quoteLatency,
        {}
      );
      
      telemetry.recordMetric(
        'blockchain_adapter_benchmark_avg_balance_latency',
        this.summary.averages.balanceCheckLatency,
        {}
      );
      
      telemetry.recordMetric(
        'blockchain_adapter_benchmark_avg_status_latency',
        this.summary.averages.statusCheckLatency,
        {}
      );
      
      // Record per-chain results
      for (const result of this.results) {
        telemetry.recordMetric(
          'blockchain_adapter_benchmark_chain_status',
          result.meetsRequirements ? 1 : 0,
          {
            chain_id: result.chainId.toString(),
            chain_name: result.chainName
          }
        );
      }
      
      // Log benchmark event
      telemetry.recordEvent(
        'blockchain_adapter_benchmark_completed',
        'benchmark',
        {
          total_chains: this.results.length.toString(),
          passing_chains: this.summary.totalPassed.toString(),
          concurrent_operations: (this.options.concurrentOperations || 0).toString()
        }
      );
    } catch (error) {
      console.error('Failed to send telemetry data:', error.message);
    }
  }
}

/**
 * Run a benchmark with default settings
 */
export async function runBenchmark(options = {}) {
  const harness = new BenchmarkHarness(options);
  return harness.runAll();
} 