/**
 * Strategy Execution Benchmark
 * 
 * This benchmark tests the system's ability to execute multiple trading strategies
 * concurrently while measuring throughput, latency, and resource utilization.
 */

const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('strategies', {
    type: 'number',
    description: 'Number of concurrent strategies to test',
    default: 10
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
  .option('strategy-types', {
    type: 'string',
    description: 'Comma-separated list of strategy types to test',
    default: 'trend-following,mean-reversion,volatility-based'
  })
  .option('interval', {
    type: 'number',
    description: 'Metrics collection interval in seconds',
    default: 10
  })
  .help()
  .argv;

// Log benchmark configuration
console.log('Starting Strategy Execution Benchmark');
console.log(`Strategies: ${argv.strategies}`);
console.log(`Duration: ${argv.duration} seconds`);
console.log(`Strategy Types: ${argv.strategyTypes}`);
console.log(`Metrics Interval: ${argv.interval} seconds`);

/**
 * Strategy types with their characteristics
 */
const strategyTypes = {
  'trend-following': {
    signalFrequency: 0.05, // 5% chance of generating signal per strategy per second
    executionComplexity: 1.2, // Relative complexity factor
    avgTransactionSize: 1.0 // Relative transaction size
  },
  'mean-reversion': {
    signalFrequency: 0.08, // 8% chance of generating signal per strategy per second
    executionComplexity: 1.0, // Relative complexity factor
    avgTransactionSize: 0.7 // Relative transaction size
  },
  'volatility-based': {
    signalFrequency: 0.03, // 3% chance of generating signal per strategy per second
    executionComplexity: 1.5, // Relative complexity factor
    avgTransactionSize: 1.2 // Relative transaction size
  }
};

/**
 * Mock resource utilization state
 */
const resourceState = {
  cpuPercent: 0,
  memoryPercent: 0,
  networkMbps: 0,
  diskIoMbps: 0
};

/**
 * Mock execution metrics
 */
const metrics = {
  transactionsTotal: 0,
  transactionsPerSecond: 0,
  signalsGenerated: 0,
  executionSuccessCount: 0,
  executionFailureCount: 0,
  averageLatencyMs: 0,
  p50LatencyMs: 0,
  p95LatencyMs: 0,
  p99LatencyMs: 0,
  latencies: []
};

/**
 * Generate test strategies
 */
function generateTestStrategies(count, strategyTypesList) {
  const strategies = [];
  const types = strategyTypesList.split(',');
  
  for (let i = 0; i < count; i++) {
    // Select a strategy type, distribute evenly
    const typeIndex = i % types.length;
    const type = types[typeIndex];
    
    strategies.push({
      id: `strategy-${i}`,
      type: type,
      config: strategyTypes[type],
      active: true,
      lastSignalTime: 0
    });
  }
  
  return strategies;
}

/**
 * Run a single benchmark tick
 */
function runBenchmarkTick(strategies, timeElapsedMs, tickDurationMs) {
  const signalsThisTick = [];
  const startTime = Date.now();
  
  // Generate signals based on strategy signal frequency
  strategies.forEach(strategy => {
    if (!strategy.active) return;
    
    const signalProbabilityThisTick = strategy.config.signalFrequency * (tickDurationMs / 1000);
    
    if (Math.random() < signalProbabilityThisTick) {
      signalsThisTick.push({
        strategyId: strategy.id,
        type: strategy.type,
        complexity: strategy.config.executionComplexity,
        size: strategy.config.avgTransactionSize,
        timestamp: startTime
      });
      
      strategy.lastSignalTime = startTime;
      metrics.signalsGenerated++;
    }
  });
  
  // Process signals and measure latency
  const executionPromises = signalsThisTick.map(signal => {
    return executeStrategySignal(signal)
      .then(result => {
        metrics.executionSuccessCount++;
        
        // Record latency
        const latencyMs = result.latencyMs;
        metrics.latencies.push(latencyMs);
        metrics.transactionsTotal++;
        
        return result;
      })
      .catch(error => {
        metrics.executionFailureCount++;
        console.error(`Execution error for strategy ${signal.strategyId}: ${error.message}`);
        return null;
      });
  });
  
  // Calculate current TPS
  const secondsElapsed = tickDurationMs / 1000;
  metrics.transactionsPerSecond = signalsThisTick.length / secondsElapsed;
  
  // Update resource utilization (simulated)
  updateResourceUtilization(signalsThisTick.length, secondsElapsed);
  
  return Promise.all(executionPromises);
}

/**
 * Execute a strategy signal (simulated)
 */
async function executeStrategySignal(signal) {
  // Simulate execution time based on complexity and system load
  const baseExecutionTimeMs = 50; // Base 50ms execution time
  const complexityFactor = signal.complexity;
  const loadFactor = 1 + (resourceState.cpuPercent / 100); // Higher CPU = longer execution
  
  // Calculate execution time with some randomness
  const executionTimeMs = baseExecutionTimeMs * complexityFactor * loadFactor * (0.8 + (Math.random() * 0.4));
  
  // Simulate network latency
  const networkLatencyMs = 10 + (Math.random() * 30) * (1 + resourceState.networkMbps / 200);
  
  // Total latency
  const totalLatencyMs = executionTimeMs + networkLatencyMs;
  
  // Simulate execution
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 99% success rate
      if (Math.random() < 0.99) {
        resolve({
          strategyId: signal.strategyId,
          success: true,
          latencyMs: totalLatencyMs,
          executionTimeMs: executionTimeMs,
          networkLatencyMs: networkLatencyMs,
          timestamp: Date.now()
        });
      } else {
        reject(new Error('Execution failed (simulated failure)'));
      }
    }, totalLatencyMs);
  });
}

/**
 * Update simulated resource utilization
 */
function updateResourceUtilization(transactionCount, secondsElapsed) {
  // CPU utilization simulation - base + transaction load
  const baseCpu = 15; // 15% base CPU usage
  const transactionCpuImpact = 0.5; // Each transaction per second adds 0.5% CPU
  const desiredCpu = Math.min(95, baseCpu + (transactionCount / secondsElapsed) * transactionCpuImpact);
  
  // Smooth CPU changes (CPU changes aren't instantaneous)
  resourceState.cpuPercent = resourceState.cpuPercent * 0.7 + desiredCpu * 0.3;
  
  // Memory grows slightly over time to simulate some leakage
  resourceState.memoryPercent = Math.min(90, resourceState.memoryPercent + 0.01 + (transactionCount * 0.001));
  
  // Network based on transaction count and size
  const avgTransactionNetworkMb = 0.02; // 20KB per transaction
  resourceState.networkMbps = (transactionCount / secondsElapsed) * avgTransactionNetworkMb * 8; // Convert to Mbps
  
  // Disk I/O based on transaction count
  const avgTransactionDiskIoMb = 0.005; // 5KB disk write per transaction
  resourceState.diskIoMbps = (transactionCount / secondsElapsed) * avgTransactionDiskIoMb * 8; // Convert to Mbps
}

/**
 * Calculate latency percentiles
 */
function calculateLatencyPercentiles() {
  if (metrics.latencies.length === 0) return;
  
  // Sort latencies for percentile calculation
  const sortedLatencies = [...metrics.latencies].sort((a, b) => a - b);
  
  // Calculate average
  const sum = sortedLatencies.reduce((a, b) => a + b, 0);
  metrics.averageLatencyMs = sum / sortedLatencies.length;
  
  // Calculate percentiles
  const p50Index = Math.floor(sortedLatencies.length * 0.5);
  const p95Index = Math.floor(sortedLatencies.length * 0.95);
  const p99Index = Math.floor(sortedLatencies.length * 0.99);
  
  metrics.p50LatencyMs = sortedLatencies[p50Index];
  metrics.p95LatencyMs = sortedLatencies[p95Index];
  metrics.p99LatencyMs = sortedLatencies[p99Index];
}

/**
 * Format results for output
 */
function formatResults(totalDurationMs) {
  calculateLatencyPercentiles();
  
  // Calculate success rate
  const totalExecutions = metrics.executionSuccessCount + metrics.executionFailureCount;
  const successRate = totalExecutions > 0 
    ? (metrics.executionSuccessCount / totalExecutions) * 100 
    : 0;
  
  // Clear raw latency data to save space
  delete metrics.latencies;
  
  return {
    test: "strategy-execution",
    timestamp: new Date().toISOString(),
    configuration: {
      strategies: argv.strategies,
      duration: argv.duration,
      strategyTypes: argv.strategyTypes.split(',')
    },
    results: {
      transactionsTotal: metrics.transactionsTotal,
      transactionsPerSecond: metrics.transactionsTotal / (totalDurationMs / 1000),
      averageLatencyMs: Math.round(metrics.averageLatencyMs),
      p50LatencyMs: Math.round(metrics.p50LatencyMs),
      p95LatencyMs: Math.round(metrics.p95LatencyMs),
      p99LatencyMs: Math.round(metrics.p99LatencyMs),
      executionSuccessRate: successRate.toFixed(2),
      resourceUtilization: {
        cpuPercent: Math.round(resourceState.cpuPercent * 10) / 10,
        memoryPercent: Math.round(resourceState.memoryPercent * 10) / 10,
        networkMbps: Math.round(resourceState.networkMbps * 10) / 10,
        diskIoMbps: Math.round(resourceState.diskIoMbps * 10) / 10
      }
    }
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
  console.log('Initializing benchmark...');
  
  // Generate test strategies
  const strategies = generateTestStrategies(argv.strategies, argv.strategyTypes);
  console.log(`Generated ${strategies.length} test strategies`);
  
  // Benchmark timing
  const tickIntervalMs = 1000; // 1 second ticks
  const metricsIntervalMs = argv.interval * 1000;
  const totalDurationMs = argv.duration * 1000;
  let elapsedMs = 0;
  let lastMetricsOutputMs = 0;
  
  console.log('Starting benchmark execution...');
  console.log(`Running for ${argv.duration} seconds...`);
  
  // Run benchmark in ticks until duration is reached
  while (elapsedMs < totalDurationMs) {
    const tickStart = Date.now();
    
    // Run a single tick
    await runBenchmarkTick(strategies, elapsedMs, tickIntervalMs);
    
    // Output metrics at intervals
    if (elapsedMs - lastMetricsOutputMs >= metricsIntervalMs) {
      calculateLatencyPercentiles();
      console.log(`[${Math.round(elapsedMs / 1000)}s] TPS: ${metrics.transactionsPerSecond.toFixed(1)}, ` +
                 `Latency: ${Math.round(metrics.averageLatencyMs)}ms, ` +
                 `CPU: ${Math.round(resourceState.cpuPercent)}%, ` +
                 `Success: ${((metrics.executionSuccessCount / (metrics.executionSuccessCount + metrics.executionFailureCount)) * 100).toFixed(1)}%`);
      lastMetricsOutputMs = elapsedMs;
    }
    
    // Calculate elapsed time
    const tickDuration = Date.now() - tickStart;
    elapsedMs += tickDuration;
    
    // Sleep if tick executed faster than tickInterval
    if (tickDuration < tickIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, tickIntervalMs - tickDuration));
      elapsedMs += (tickIntervalMs - tickDuration);
    }
  }
  
  console.log('Benchmark completed.');
  
  // Format and save results
  const results = formatResults(totalDurationMs);
  saveResults(results, argv.output);
  
  console.log('Summary:');
  console.log(`- Total transactions: ${results.results.transactionsTotal}`);
  console.log(`- Avg TPS: ${results.results.transactionsPerSecond.toFixed(1)}`);
  console.log(`- Avg latency: ${results.results.averageLatencyMs}ms`);
  console.log(`- P95 latency: ${results.results.p95LatencyMs}ms`);
  console.log(`- Success rate: ${results.results.executionSuccessRate}%`);
}

// Run the benchmark
runBenchmark().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
}); 