#!/usr/bin/env node
/**
 * Blockchain Adapter Benchmark Runner
 * 
 * This script runs comprehensive performance benchmarks on blockchain adapters
 * to verify they meet production performance requirements.
 */

import { runBenchmark } from './harness.js';
import { CHAINS } from '../constants.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  chainsToTest: [],
  includeStressTests: true,
  includeCrossChainTests: true,
  includeFaultInjection: true,
  concurrentOperations: 100,
  outputJson: false
};

// Process arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--chains') {
    // Format: --chains ethereum,polygon,avalanche
    const chainArg = args[++i];
    if (chainArg) {
      const chainNames = chainArg.split(',');
      options.chainsToTest = chainNames.map(name => {
        const upperName = name.toUpperCase();
        if (CHAINS[upperName]) {
          return CHAINS[upperName];
        }
        console.warn(`Unknown chain: ${name}`);
        return null;
      }).filter(Boolean);
    }
  } else if (arg === '--no-stress') {
    options.includeStressTests = false;
  } else if (arg === '--no-cross-chain') {
    options.includeCrossChainTests = false;
  } else if (arg === '--no-fault-injection') {
    options.includeFaultInjection = false;
  } else if (arg === '--concurrent') {
    const count = parseInt(args[++i], 10);
    if (!isNaN(count) && count > 0) {
      options.concurrentOperations = count;
    }
  } else if (arg === '--json') {
    options.outputJson = true;
  } else if (arg === '--help') {
    printHelp();
    process.exit(0);
  }
}

// Default to all chains if none specified
if (options.chainsToTest.length === 0) {
  options.chainsToTest = Object.values(CHAINS);
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
Blockchain Adapter Benchmark Runner

Usage:
  node run.js [options]

Options:
  --chains <chains>         Comma-separated list of chains to test (ethereum,polygon,avalanche,arbitrum,binance)
  --no-stress               Skip stress tests
  --no-cross-chain          Skip cross-chain tests
  --no-fault-injection      Skip fault injection tests
  --concurrent <count>      Number of concurrent operations (default: 100)
  --json                    Output results as JSON
  --help                    Show this help message

Examples:
  node run.js                               # Run all tests on all chains
  node run.js --chains ethereum,polygon     # Test only Ethereum and Polygon
  node run.js --no-stress --concurrent 10   # Skip stress tests and use only 10 concurrent operations
  `);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log(`Starting blockchain adapter benchmarks with ${options.chainsToTest.length} chains`);
    
    const result = await runBenchmark(options);
    
    if (options.outputJson) {
      console.log(JSON.stringify(result, null, 2));
    }
    
    // Exit with appropriate code
    process.exit(result.summary.overallStatus === 'PASS' ? 0 : 1);
  } catch (error) {
    console.error('Benchmark failed with error:', error);
    process.exit(1);
  }
}

// Run the benchmarks
main(); 