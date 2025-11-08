# Blockchain Adapter Benchmarking Tools

This directory contains comprehensive benchmarking tools for the Noderr Protocol blockchain adapters, designed to validate performance, reliability, and scalability of the adapter implementations.

## Overview

The benchmarking tools measure:

1. **Performance**
   - Connection time
   - Operation latency (balance check, quotes, etc.)
   - Memory usage

2. **Reliability**
   - Success rates under load
   - Failure handling
   - Recovery from errors

3. **Scalability**
   - Concurrent operation throughput
   - Cross-chain operation performance

## Usage

### Basic Benchmark

Run a basic benchmark across all chains:

```bash
npm run benchmark:adapters
```

### Chain-Specific Benchmark

Benchmark only specific chains:

```bash
npm run benchmark:adapters -- --chains ethereum,polygon
```

### Performance-Only Benchmark

Skip stress tests for a faster run:

```bash
npm run benchmark:adapters -- --no-stress --no-fault-injection
```

### Customizing Concurrency

Set the number of concurrent operations:

```bash
npm run benchmark:adapters -- --concurrent 50
```

### Output Options

Generate JSON output for integration with CI/CD:

```bash
npm run benchmark:adapters -- --json > benchmark-results.json
```

## Performance Requirements

Blockchain adapters are required to meet specific performance targets:

| Metric | Requirement | Description |
|--------|-------------|-------------|
| Connection Time | < 2000 ms | Time to establish connection |
| Quote Latency | < 500 ms | Time to get asset price quote |
| Balance Check Latency | < 200 ms | Time to check wallet balance |
| Status Check Latency | < 200 ms | Time to check chain status |
| Success Rate | > 99.5% | Percentage of successful operations |
| Memory Leaks | < 5 MB | Memory growth over test duration |

## Benchmark Components

### BenchmarkHarness

The `BenchmarkHarness` class in `harness.js` provides the core benchmarking functionality:

- Individual chain testing
- Cross-chain operation benchmarking
- Concurrent operation stress testing
- Fault tolerance verification

### BenchmarkResult

The `BenchmarkResult` class tracks performance metrics and evaluates requirements for each chain:

- Connection time
- Operation latency
- Memory usage
- Error rates and types
- Circuit breaker trips

### Test Assets

Each chain has predefined test assets (native currency and tokens) in the `ASSETS` constant, allowing consistent testing across different blockchains.

## Telemetry Integration

The benchmark tools integrate with the application's telemetry system, recording:

- Benchmark status
- Average performance metrics
- Chain-specific results
- Detailed events

## CI/CD Integration

This benchmarking system is designed to be integrated with CI/CD pipelines:

1. Add a workflow step to run benchmarks on PRs
2. Compare results against performance baselines
3. Use JSON output to track metrics over time
4. Alert on performance regressions

## Example Implementation

```javascript
import { BenchmarkHarness } from './harness.js';

async function runBenchmark() {
  // Create benchmark harness
  const harness = new BenchmarkHarness({
    chainsToTest: [
      { id: 1, name: 'Ethereum Mainnet' },
      { id: 137, name: 'Polygon Mainnet' }
    ],
    includeStressTests: true,
    includeCrossChainTests: true,
    concurrentOperations: 50
  });
  
  // Run benchmarks
  const results = await harness.runAll();
  
  // Process results
  if (results.summary.overallStatus === 'PASS') {
    console.log('All benchmarks passed!');
  } else {
    console.error(`${results.summary.totalFailed} chains failed benchmarks`);
  }
}
```

## Extending the Benchmarks

To add new benchmark types:

1. Add a new method to the `BenchmarkHarness` class
2. Update the `runAll()` method to include your new benchmark
3. Add metrics collection for the new benchmark type
4. Update the summary generation to include the new metrics 