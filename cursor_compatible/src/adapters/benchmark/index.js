/**
 * Blockchain Adapter Benchmarking Tool
 * 
 * This tool tests adapter performance under load and records results
 * to the metrics system for visualization in Prometheus/Grafana.
 */

import { AdapterRegistry } from '../registry/AdapterRegistry.js';
import { sleep } from '../../utils/timing.js';
import * as metrics from '../../telemetry/metrics.js';

// Configuration
const DEFAULT_CONFIG = {
  chains: [1, 137, 43114],  // Ethereum, Polygon, Avalanche
  operationsPerAdapter: 50,
  concurrentOperations: 5,
  operationsToTest: ['getBalance', 'getQuote', 'getStatus'],
  recordMetrics: true,
  delayBetweenOps: 100
};

/**
 * Run adapter benchmark tests
 * 
 * @param {Object} config Configuration options
 * @returns {Object} Benchmark results
 */
export async function runAdapterBenchmark(config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  const results = {};
  
  console.log(`Running benchmark for ${options.chains.length} chains`);
  console.log('Operations:', options.operationsToTest);
  
  // Create and initialize adapter registry
  const registry = new AdapterRegistry();
  
  // Register all chains
  for (const chainId of options.chains) {
    registry.registerChain(chainId);
    
    // Initialize per-chain results
    results[chainId] = {
      operations: {},
      successRate: 0,
      avgLatencyMs: 0
    };
    
    // Initialize operation-specific metrics
    for (const operation of options.operationsToTest) {
      results[chainId].operations[operation] = {
        count: 0,
        success: 0,
        failure: 0,
        latencyMs: []
      };
    }
  }
  
  try {
    // Initialize adapters
    await registry.initialize();
    
    // Run benchmarks for each chain
    for (const chainId of options.chains) {
      console.log(`\nBenchmarking chain ${chainId}...`);
      await benchmarkChain(
        registry, 
        chainId, 
        options.operationsToTest,
        options.operationsPerAdapter,
        options.concurrentOperations,
        options.delayBetweenOps,
        results[chainId]
      );
    }
    
    // Calculate overall statistics
    for (const chainId of options.chains) {
      const chainResults = results[chainId];
      let totalSuccess = 0;
      let totalOps = 0;
      let totalLatency = 0;
      
      for (const opName in chainResults.operations) {
        const opStats = chainResults.operations[opName];
        totalSuccess += opStats.success;
        totalOps += opStats.count;
        totalLatency += opStats.latencyMs.reduce((sum, val) => sum + val, 0);
        
        // Calculate average latency for this operation
        opStats.avgLatencyMs = opStats.latencyMs.length > 0
          ? opStats.latencyMs.reduce((sum, val) => sum + val, 0) / opStats.latencyMs.length
          : 0;
          
        // Calculate success rate for this operation
        opStats.successRate = opStats.count > 0
          ? (opStats.success / opStats.count) * 100
          : 0;
      }
      
      // Overall chain statistics
      chainResults.successRate = totalOps > 0 
        ? (totalSuccess / totalOps) * 100
        : 0;
        
      chainResults.avgLatencyMs = totalOps > 0
        ? totalLatency / totalOps
        : 0;
    }
    
    // Disconnect adapters
    await registry.shutdown();
    
    return results;
  } catch (error) {
    console.error('Benchmark failed:', error);
    
    // Try to shutdown properly
    try {
      await registry.shutdown();
    } catch (err) {
      console.error('Error during shutdown:', err);
    }
    
    throw error;
  }
}

/**
 * Benchmark a specific blockchain
 * 
 * @param {AdapterRegistry} registry The adapter registry
 * @param {number} chainId The chain ID
 * @param {string[]} operations Operations to test
 * @param {number} operationsPerAdapter Number of operations to run
 * @param {number} concurrentOperations Max concurrent operations
 * @param {number} delayMs Delay between operations (ms)
 * @param {Object} results Results object to update
 */
async function benchmarkChain(
  registry, 
  chainId, 
  operations,
  operationsPerAdapter,
  concurrentOperations,
  delayMs,
  results
) {
  // Split operations across operation types
  const opsPerType = Math.ceil(operationsPerAdapter / operations.length);
  
  // Run each operation type
  for (const operation of operations) {
    console.log(`Running operation: ${operation}`);
    
    // Run operations in batches
    const batches = Math.ceil(opsPerType / concurrentOperations);
    
    for (let batch = 0; batch < batches; batch++) {
      const batchSize = Math.min(concurrentOperations, opsPerType - (batch * concurrentOperations));
      const promises = [];
      
      for (let i = 0; i < batchSize; i++) {
        promises.push(runOperation(registry, chainId, operation, results));
        
        // Small delay between starting operations
        if (i < batchSize - 1) {
          await sleep(10);
        }
      }
      
      // Wait for batch to complete
      await Promise.all(promises);
      
      // Delay between batches
      if (batch < batches - 1) {
        await sleep(delayMs);
      }
    }
  }
}

/**
 * Run a single operation and record metrics
 * 
 * @param {AdapterRegistry} registry The adapter registry
 * @param {number} chainId The chain ID
 * @param {string} operation Operation name
 * @param {Object} results Results object to update
 */
async function runOperation(registry, chainId, operation, results) {
  const startTime = Date.now();
  let success = false;
  
  try {
    // Track this operation
    results.operations[operation].count++;
    
    // Execute the appropriate operation based on type
    switch (operation) {
      case 'getBalance':
        await registry.getBalance(chainId, '0x0000000000000000000000000000000000000000');
        break;
        
      case 'getQuote':
        const fromAsset = { chainId, symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' };
        const toAsset = { chainId, symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' };
        await registry.getQuote(fromAsset, toAsset, '1.0');
        break;
        
      case 'getStatus':
        const adapter = registry.getAdapter(chainId);
        await adapter.getStatus();
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    // Record success
    success = true;
    results.operations[operation].success++;
  } catch (error) {
    // Record failure
    results.operations[operation].failure++;
    console.error(`Error in ${operation} for chain ${chainId}:`, error.message);
  }
  
  // Record latency
  const latencyMs = Date.now() - startTime;
  results.operations[operation].latencyMs.push(latencyMs);
  
  // Record metrics directly
  metrics.recordBlockchainOperation(
    chainId,
    operation, 
    true, // isMainnet
    startTime,
    success
  );
}

/**
 * Print benchmark results to console
 * 
 * @param {Object} results Benchmark results
 */
export function printBenchmarkResults(results) {
  console.log('\n===== BENCHMARK RESULTS =====\n');
  
  for (const chainId in results) {
    const chainResults = results[chainId];
    
    console.log(`Chain ID: ${chainId}`);
    console.log(`Success Rate: ${chainResults.successRate.toFixed(2)}%`);
    console.log(`Avg Latency: ${chainResults.avgLatencyMs.toFixed(2)}ms`);
    console.log('\nOperation  | Success | Avg Latency');
    console.log('-----------+---------+------------');
    
    for (const opName in chainResults.operations) {
      const opStats = chainResults.operations[opName];
      console.log(
        `${opName.padEnd(10)} | ${opStats.successRate.toFixed(2).padStart(6)}% | ${opStats.avgLatencyMs.toFixed(2).padStart(6)}ms`
      );
    }
    
    console.log('\n');
  }
}

/**
 * Main entry point when run directly
 */
async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    const chains = args.length > 0
      ? args.map(arg => parseInt(arg, 10))
      : DEFAULT_CONFIG.chains;
      
    // Run benchmark
    const results = await runAdapterBenchmark({
      chains
    });
    
    // Print results
    printBenchmarkResults(results);
    
    // Normally we'd wait for Prometheus to scrape the metrics, but for a benchmark
    // we might want to just write results to logs
    const metricsOutput = await metrics.getMetricsAsString();
    if (process.env.DEBUG_METRICS) {
      console.log('\n===== METRICS OUTPUT =====\n');
      console.log(metricsOutput);
    }
    
    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === import.meta.url) {
  main().catch(console.error);
} 