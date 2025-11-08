/**
 * Fallback Comparison Benchmark
 * 
 * This benchmark compares the performance of the Noderr Protocol Trading Bot
 * with and without cross-chain fallback functionality under various scenarios.
 */

const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('scenario', {
    type: 'string',
    description: 'Test scenario to run (normal, congestion, outage, multi-chain)',
    default: 'normal'
  })
  .option('duration', {
    type: 'number',
    description: 'Test duration in seconds',
    default: 300
  })
  .option('output', {
    type: 'string',
    description: 'Output file path',
    default: 'results.json'
  })
  .option('transactions', {
    type: 'number',
    description: 'Number of transactions to simulate',
    default: 1000
  })
  .help()
  .argv;

// Log benchmark configuration
console.log('Starting Fallback Comparison Benchmark');
console.log(`Scenario: ${argv.scenario}`);
console.log(`Duration: ${argv.duration} seconds`);
console.log(`Transactions: ${argv.transactions}`);

/**
 * Scenario configurations
 */
const scenarios = {
  normal: {
    name: 'Normal Operation',
    description: 'All chains functioning normally',
    primaryChainSuccessRate: 0.995,
    primaryChainLatencyMs: {
      min: 300,
      max: 500
    },
    fallbackChainSuccessRate: 0.993,
    fallbackChainLatencyMs: {
      min: 350,
      max: 550
    },
    primaryChainAvailable: true,
    congestionLevel: 'none', // none, light, moderate, severe
    networkPartition: false
  },
  congestion: {
    name: 'Primary Chain Congestion',
    description: 'Primary chain experiencing high gas prices and congestion',
    primaryChainSuccessRate: 0.88,
    primaryChainLatencyMs: {
      min: 1200,
      max: 2500
    },
    fallbackChainSuccessRate: 0.99,
    fallbackChainLatencyMs: {
      min: 400,
      max: 800
    },
    primaryChainAvailable: true,
    congestionLevel: 'severe',
    networkPartition: false
  },
  outage: {
    name: 'Primary Chain Outage',
    description: 'Primary chain RPC endpoints complete failure',
    primaryChainSuccessRate: 0.15,
    primaryChainLatencyMs: {
      min: 4000,
      max: 8000
    },
    fallbackChainSuccessRate: 0.97,
    fallbackChainLatencyMs: {
      min: 450,
      max: 900
    },
    primaryChainAvailable: false,
    congestionLevel: 'none',
    networkPartition: true
  },
  multichain: {
    name: 'Multi-Chain Degradation',
    description: 'Multiple chains experiencing issues simultaneously',
    primaryChainSuccessRate: 0.76,
    primaryChainLatencyMs: {
      min: 1500,
      max: 4000
    },
    fallbackChainSuccessRate: 0.90,
    fallbackChainLatencyMs: {
      min: 700,
      max: 1500
    },
    primaryChainAvailable: true,
    congestionLevel: 'moderate',
    networkPartition: false
  }
};

/**
 * Chain configurations
 */
const chains = {
  ethereum: {
    name: 'Ethereum',
    baseLatencyMs: 400,
    baseSuccessRate: 0.995,
    congestionImpact: {
      light: { latencyMultiplier: 1.5, successRateMultiplier: 0.98 },
      moderate: { latencyMultiplier: 2.5, successRateMultiplier: 0.9 },
      severe: { latencyMultiplier: 5.0, successRateMultiplier: 0.7 }
    }
  },
  polygon: {
    name: 'Polygon',
    baseLatencyMs: 200,
    baseSuccessRate: 0.99,
    congestionImpact: {
      light: { latencyMultiplier: 1.3, successRateMultiplier: 0.99 },
      moderate: { latencyMultiplier: 2.0, successRateMultiplier: 0.95 },
      severe: { latencyMultiplier: 3.0, successRateMultiplier: 0.85 }
    }
  },
  solana: {
    name: 'Solana',
    baseLatencyMs: 150,
    baseSuccessRate: 0.992,
    congestionImpact: {
      light: { latencyMultiplier: 1.2, successRateMultiplier: 0.99 },
      moderate: { latencyMultiplier: 1.8, successRateMultiplier: 0.94 },
      severe: { latencyMultiplier: 2.5, successRateMultiplier: 0.88 }
    }
  },
  cosmos: {
    name: 'Cosmos',
    baseLatencyMs: 350,
    baseSuccessRate: 0.997,
    congestionImpact: {
      light: { latencyMultiplier: 1.3, successRateMultiplier: 0.99 },
      moderate: { latencyMultiplier: 1.7, successRateMultiplier: 0.96 },
      severe: { latencyMultiplier: 2.2, successRateMultiplier: 0.9 }
    }
  }
};

/**
 * Run benchmark with fallback enabled
 */
async function runWithFallback(scenario, transactionCount) {
  console.log(`Running benchmark with fallback enabled (${scenario.name})...`);
  
  const results = {
    successfulTransactions: 0,
    failedTransactions: 0,
    totalLatencyMs: 0,
    executionTimes: [],
    primaryChainUsed: 0,
    fallbackChainUsed: 0,
    errors: {
      timeout: 0,
      rpcError: 0,
      networkError: 0,
      other: 0
    }
  };
  
  // Simulate each transaction
  for (let i = 0; i < transactionCount; i++) {
    const startTime = Date.now();
    
    try {
      // Try primary chain first
      const primaryResult = await tryPrimaryChain(scenario);
      
      // If primary chain successful
      if (primaryResult.success) {
        results.successfulTransactions++;
        results.primaryChainUsed++;
        results.totalLatencyMs += primaryResult.latencyMs;
        results.executionTimes.push(primaryResult.latencyMs);
      } 
      // If primary chain failed, try fallback chain
      else {
        trackError(results, primaryResult.error);
        
        // Try fallback chain
        const fallbackResult = await tryFallbackChain(scenario);
        
        if (fallbackResult.success) {
          results.successfulTransactions++;
          results.fallbackChainUsed++;
          results.totalLatencyMs += fallbackResult.latencyMs;
          results.executionTimes.push(fallbackResult.latencyMs);
        } else {
          results.failedTransactions++;
          trackError(results, fallbackResult.error);
        }
      }
    } catch (error) {
      results.failedTransactions++;
      console.error(`Error in transaction ${i}: ${error.message}`);
    }
    
    // Show progress
    if ((i + 1) % 100 === 0 || i === transactionCount - 1) {
      const progress = Math.round(((i + 1) / transactionCount) * 100);
      console.log(`Progress: ${progress}% (${i + 1}/${transactionCount})`);
    }
  }
  
  // Calculate success rate
  results.successRate = results.successfulTransactions / transactionCount * 100;
  
  // Calculate average execution time
  results.avgExecutionTimeMs = results.totalLatencyMs / results.successfulTransactions;
  
  // Calculate percentiles
  if (results.executionTimes.length > 0) {
    results.executionTimes.sort((a, b) => a - b);
    const p50Index = Math.floor(results.executionTimes.length * 0.5);
    const p95Index = Math.floor(results.executionTimes.length * 0.95);
    const p99Index = Math.floor(results.executionTimes.length * 0.99);
    
    results.p50LatencyMs = results.executionTimes[p50Index];
    results.p95LatencyMs = results.executionTimes[p95Index];
    results.p99LatencyMs = results.executionTimes[p99Index];
  }
  
  return results;
}

/**
 * Run benchmark without fallback
 */
async function runWithoutFallback(scenario, transactionCount) {
  console.log(`Running benchmark without fallback (${scenario.name})...`);
  
  const results = {
    successfulTransactions: 0,
    failedTransactions: 0,
    totalLatencyMs: 0,
    executionTimes: [],
    primaryChainUsed: 0,
    errors: {
      timeout: 0,
      rpcError: 0,
      networkError: 0,
      other: 0
    }
  };
  
  // Simulate each transaction
  for (let i = 0; i < transactionCount; i++) {
    const startTime = Date.now();
    
    try {
      // Only try primary chain
      const primaryResult = await tryPrimaryChain(scenario);
      
      // If primary chain successful
      if (primaryResult.success) {
        results.successfulTransactions++;
        results.primaryChainUsed++;
        results.totalLatencyMs += primaryResult.latencyMs;
        results.executionTimes.push(primaryResult.latencyMs);
      } else {
        results.failedTransactions++;
        trackError(results, primaryResult.error);
      }
    } catch (error) {
      results.failedTransactions++;
      console.error(`Error in transaction ${i}: ${error.message}`);
    }
    
    // Show progress
    if ((i + 1) % 100 === 0 || i === transactionCount - 1) {
      const progress = Math.round(((i + 1) / transactionCount) * 100);
      console.log(`Progress: ${progress}% (${i + 1}/${transactionCount})`);
    }
  }
  
  // Calculate success rate
  results.successRate = results.successfulTransactions / transactionCount * 100;
  
  // Calculate average execution time
  results.avgExecutionTimeMs = results.totalLatencyMs / results.successfulTransactions || 0;
  
  // Calculate percentiles
  if (results.executionTimes.length > 0) {
    results.executionTimes.sort((a, b) => a - b);
    const p50Index = Math.floor(results.executionTimes.length * 0.5);
    const p95Index = Math.floor(results.executionTimes.length * 0.95);
    const p99Index = Math.floor(results.executionTimes.length * 0.99);
    
    results.p50LatencyMs = results.executionTimes[p50Index];
    results.p95LatencyMs = results.executionTimes[p95Index];
    results.p99LatencyMs = results.executionTimes[p99Index];
  }
  
  return results;
}

/**
 * Simulate trying primary chain
 */
async function tryPrimaryChain(scenario) {
  return new Promise(resolve => {
    // Check if primary chain is available
    if (!scenario.primaryChainAvailable) {
      setTimeout(() => {
        resolve({
          success: false,
          error: 'timeout',
          latencyMs: 0
        });
      }, 50); // Quick failure
      return;
    }
    
    // Calculate latency
    const latencyMs = getRandomInt(
      scenario.primaryChainLatencyMs.min, 
      scenario.primaryChainLatencyMs.max
    );
    
    // Simulate transaction
    setTimeout(() => {
      // Check if transaction successful based on success rate
      const success = Math.random() < scenario.primaryChainSuccessRate;
      
      if (success) {
        resolve({
          success: true,
          latencyMs: latencyMs
        });
      } else {
        // Determine error type
        const error = determineErrorType(scenario);
        
        resolve({
          success: false,
          error,
          latencyMs: latencyMs
        });
      }
    }, latencyMs);
  });
}

/**
 * Simulate trying fallback chain
 */
async function tryFallbackChain(scenario) {
  return new Promise(resolve => {
    // Calculate latency (including some overhead for switching chains)
    const switchingOverheadMs = 100;
    const latencyMs = getRandomInt(
      scenario.fallbackChainLatencyMs.min, 
      scenario.fallbackChainLatencyMs.max
    ) + switchingOverheadMs;
    
    // Simulate transaction
    setTimeout(() => {
      // Check if transaction successful based on success rate
      const success = Math.random() < scenario.fallbackChainSuccessRate;
      
      if (success) {
        resolve({
          success: true,
          latencyMs: latencyMs
        });
      } else {
        // Determine error type
        const error = determineErrorType(scenario);
        
        resolve({
          success: false,
          error,
          latencyMs: latencyMs
        });
      }
    }, latencyMs);
  });
}

/**
 * Determine the type of error based on scenario
 */
function determineErrorType(scenario) {
  if (scenario.networkPartition) {
    return Math.random() < 0.7 ? 'timeout' : 'networkError';
  }
  
  if (scenario.congestionLevel === 'severe') {
    return Math.random() < 0.5 ? 'timeout' : 'rpcError';
  }
  
  // Default error distribution
  const rand = Math.random();
  if (rand < 0.4) return 'timeout';
  if (rand < 0.7) return 'rpcError';
  if (rand < 0.9) return 'networkError';
  return 'other';
}

/**
 * Track error in results
 */
function trackError(results, error) {
  if (results.errors[error] !== undefined) {
    results.errors[error]++;
  } else {
    results.errors.other++;
  }
}

/**
 * Get random integer in range (inclusive)
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate performance improvement
 */
function calculateImprovement(withFallback, withoutFallback) {
  // Success rate improvement (percentage points)
  const successRateImprovement = withFallback.successRate - withoutFallback.successRate;
  
  // Execution time improvement (percentage)
  let executionTimeImprovement = 0;
  
  if (withoutFallback.avgExecutionTimeMs > 0 && withFallback.avgExecutionTimeMs > 0) {
    executionTimeImprovement = 
      (withoutFallback.avgExecutionTimeMs - withFallback.avgExecutionTimeMs) / 
      withoutFallback.avgExecutionTimeMs * 100;
  } else if (withoutFallback.avgExecutionTimeMs === 0 && withFallback.avgExecutionTimeMs > 0) {
    executionTimeImprovement = 100; // Infinite improvement, capped at 100%
  }
  
  return {
    successRate: successRateImprovement.toFixed(1) + '%',
    executionTime: executionTimeImprovement.toFixed(1) + '%',
    absoluteSuccessRate: successRateImprovement.toFixed(1),
    absoluteExecutionTime: executionTimeImprovement.toFixed(1)
  };
}

/**
 * Format results
 */
function formatResults(scenario, withFallbackResults, withoutFallbackResults, improvement) {
  return {
    test: "fallback-comparison",
    timestamp: new Date().toISOString(),
    scenario: {
      name: scenario.name,
      description: scenario.description,
      config: scenario
    },
    withFallback: {
      successRate: withFallbackResults.successRate.toFixed(1) + '%',
      avgExecutionTimeMs: Math.round(withFallbackResults.avgExecutionTimeMs),
      p50LatencyMs: Math.round(withFallbackResults.p50LatencyMs),
      p95LatencyMs: Math.round(withFallbackResults.p95LatencyMs),
      p99LatencyMs: Math.round(withFallbackResults.p99LatencyMs),
      primaryChainUsed: withFallbackResults.primaryChainUsed,
      fallbackChainUsed: withFallbackResults.fallbackChainUsed,
      errors: withFallbackResults.errors
    },
    withoutFallback: {
      successRate: withoutFallbackResults.successRate.toFixed(1) + '%',
      avgExecutionTimeMs: Math.round(withoutFallbackResults.avgExecutionTimeMs) || 'N/A',
      p50LatencyMs: Math.round(withoutFallbackResults.p50LatencyMs) || 'N/A',
      p95LatencyMs: Math.round(withoutFallbackResults.p95LatencyMs) || 'N/A',
      p99LatencyMs: Math.round(withoutFallbackResults.p99LatencyMs) || 'N/A',
      primaryChainUsed: withoutFallbackResults.primaryChainUsed,
      errors: withoutFallbackResults.errors
    },
    improvement: improvement
  };
}

/**
 * Save results to file
 */
function saveResults(results, outputPath) {
  const dir = path.dirname(outputPath);
  
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write results to file
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Results saved to ${outputPath}`);
}

/**
 * Run the benchmark
 */
async function runBenchmark() {
  // Get scenario configuration
  const scenario = scenarios[argv.scenario];
  
  if (!scenario) {
    console.error(`Error: Unknown scenario "${argv.scenario}"`);
    console.error(`Available scenarios: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }
  
  console.log(`Benchmark scenario: ${scenario.name}`);
  console.log(scenario.description);
  
  // Run with fallback enabled
  const withFallbackResults = await runWithFallback(scenario, argv.transactions);
  
  // Run without fallback
  const withoutFallbackResults = await runWithoutFallback(scenario, argv.transactions);
  
  // Calculate improvement
  const improvement = calculateImprovement(withFallbackResults, withoutFallbackResults);
  
  // Format and save results
  const results = formatResults(scenario, withFallbackResults, withoutFallbackResults, improvement);
  saveResults(results, argv.output);
  
  // Print summary
  console.log('\nBenchmark Results:');
  console.log('=================');
  console.log(`Scenario: ${scenario.name}`);
  console.log('\nWith Fallback:');
  console.log(`- Success Rate: ${withFallbackResults.successRate.toFixed(1)}%`);
  console.log(`- Avg Execution Time: ${Math.round(withFallbackResults.avgExecutionTimeMs)}ms`);
  console.log(`- Primary Chain Used: ${withFallbackResults.primaryChainUsed} transactions`);
  console.log(`- Fallback Chain Used: ${withFallbackResults.fallbackChainUsed} transactions`);
  
  console.log('\nWithout Fallback:');
  console.log(`- Success Rate: ${withoutFallbackResults.successRate.toFixed(1)}%`);
  
  if (withoutFallbackResults.avgExecutionTimeMs) {
    console.log(`- Avg Execution Time: ${Math.round(withoutFallbackResults.avgExecutionTimeMs)}ms`);
  } else {
    console.log(`- Avg Execution Time: N/A (all transactions failed)`);
  }
  
  console.log('\nImprovement:');
  console.log(`- Success Rate: ${improvement.successRate} (absolute)`);
  console.log(`- Execution Time: ${improvement.executionTime}`);
}

// Run the benchmark
runBenchmark().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
}); 