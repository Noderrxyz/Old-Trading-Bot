# Noderr Protocol Trading Bot - Benchmarking Suite

This directory contains benchmarking tools for evaluating the performance and resilience of the Noderr Protocol Trading Bot under various conditions.

## Setup

1. Install dependencies:

```bash
cd benchmarks
npm install
```

2. Ensure proper permissions for the benchmark scripts:

```bash
chmod +x run.sh
```

## Running Benchmarks

The benchmarking suite uses a unified interface through the `run.sh` script. This allows consistent execution, results collection, and comparison across different benchmark types.

### General usage:

```bash
./run.sh --test <test-name> [options]
```

### Available tests:

1. **Strategy Execution Benchmark**
   
   Tests the system's ability to execute multiple trading strategies concurrently.
   
   ```bash
   ./run.sh --test strategy-execution --strategies 100 --duration 300
   ```

2. **Cross-Chain Routing Benchmark**
   
   Measures the efficiency of cross-chain routing decisions.
   
   ```bash
   ./run.sh --test cross-chain-routing --routes 50 --conditions mixed --duration 180
   ```

3. **Chain Adapter Load Test**
   
   Measures individual chain adapter performance under load.
   
   ```bash
   ./run.sh --test adapter-load --chain ethereum --max-tps 100 --read-write-ratio 3:1
   ```

4. **Multi-Chain Concurrent Test**
   
   Measures system performance with multiple chain adapters active simultaneously.
   
   ```bash
   ./run.sh --test multi-chain --distribution balanced --cross-chain-percent 40
   ```

5. **Strategy Mutation Benchmark**
   
   Measures the performance of the strategy evolution system.
   
   ```bash
   ./run.sh --test strategy-mutation --initial-pool 50 --generations 5
   ```

6. **Chaos Test Benchmark**
   
   Measures system performance during simulated network and component failures.
   
   ```bash
   ./run.sh --test chaos --scenario network-partition,node-failure,rpc-outage
   ```

7. **Recovery Test Benchmark**
   
   Measures system recovery capabilities after component failures.
   
   ```bash
   ./run.sh --test recovery --components adapter,database,node --sequential
   ```

8. **Fallback Comparison Benchmark**
   
   Compares system performance with and without cross-chain fallback logic enabled.
   
   ```bash
   ./run.sh --test fallback-comparison --scenario congestion --transactions 1000
   ```

## Output

Benchmark results are saved to the `benchmark_results` directory with timestamps. Each result file contains:

- Benchmark configuration
- Performance metrics
- Resource utilization data
- Success/error rates

Results are saved in JSON format by default but can be changed with the `--output-format` option.

## Visualization

Benchmark results can be visualized using the built-in visualization tool:

```bash
node benchmarks/visualize.js --input benchmark_results/[result-file].json --output visualization.html
```

This generates an HTML report with interactive charts and tables.

## Comparing with Baselines

To compare new benchmark results with baseline results:

```bash
node benchmarks/compare.js --baseline benchmark_baselines/[baseline-file].json --current benchmark_results/[result-file].json
```

## Continuous Integration

These benchmarks can be integrated into CI/CD pipelines to catch performance regressions before deployment. The recommended approach is:

1. Run the quick benchmarks on every PR
2. Run the full benchmark suite nightly
3. Compare results against established baselines
4. Fail the build if performance degrades beyond thresholds 