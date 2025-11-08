#!/bin/bash

# Benchmark Runner for Noderr Protocol Trading Bot
# Usage: ./run.sh --test <test-name> [options]

# Parse command line arguments
TEST_NAME=""
DURATION=300  # Default 5 minutes
OUTPUT_FORMAT="json"
STRATEGIES=10
ROUTES=10
CHAIN="ethereum"
MAX_TPS=50
READ_WRITE_RATIO="1:1"
DISTRIBUTION="balanced"
CROSS_CHAIN_PERCENT=20
INITIAL_POOL=25
GENERATIONS=3
MARKET_DATA="sample"
COMPONENTS="adapter"
SEQUENTIAL=false
SCENARIO="node-failure"
CONDITIONS="mixed"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --test)
      TEST_NAME="$2"
      shift 2
      ;;
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --output-format)
      OUTPUT_FORMAT="$2"
      shift 2
      ;;
    --strategies)
      STRATEGIES="$2"
      shift 2
      ;;
    --routes)
      ROUTES="$2"
      shift 2
      ;;
    --chain)
      CHAIN="$2"
      shift 2
      ;;
    --max-tps)
      MAX_TPS="$2"
      shift 2
      ;;
    --read-write-ratio)
      READ_WRITE_RATIO="$2"
      shift 2
      ;;
    --distribution)
      DISTRIBUTION="$2"
      shift 2
      ;;
    --cross-chain-percent)
      CROSS_CHAIN_PERCENT="$2"
      shift 2
      ;;
    --initial-pool)
      INITIAL_POOL="$2"
      shift 2
      ;;
    --generations)
      GENERATIONS="$2"
      shift 2
      ;;
    --market-data)
      MARKET_DATA="$2"
      shift 2
      ;;
    --components)
      COMPONENTS="$2"
      shift 2
      ;;
    --sequential)
      SEQUENTIAL=true
      shift
      ;;
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --conditions)
      CONDITIONS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate required arguments
if [ -z "$TEST_NAME" ]; then
  echo "Error: Test name is required (--test)"
  exit 1
fi

# Prepare output directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="benchmark_results/${TEST_NAME}_${TIMESTAMP}"
mkdir -p "$OUTPUT_DIR"

# Log benchmark configuration
echo "Starting benchmark: $TEST_NAME" | tee "$OUTPUT_DIR/benchmark.log"
echo "Configuration:" | tee -a "$OUTPUT_DIR/benchmark.log"
echo "- Duration: $DURATION seconds" | tee -a "$OUTPUT_DIR/benchmark.log"
echo "- Output format: $OUTPUT_FORMAT" | tee -a "$OUTPUT_DIR/benchmark.log"

# Run the appropriate benchmark
case $TEST_NAME in
  strategy-execution)
    echo "- Strategies: $STRATEGIES" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/strategy-execution.js --strategies $STRATEGIES --duration $DURATION --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  cross-chain-routing)
    echo "- Routes: $ROUTES" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Conditions: $CONDITIONS" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/cross-chain-routing.js --routes $ROUTES --conditions $CONDITIONS --duration $DURATION --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  adapter-load)
    echo "- Chain: $CHAIN" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Max TPS: $MAX_TPS" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Read/Write Ratio: $READ_WRITE_RATIO" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/adapter-load.js --chain $CHAIN --max-tps $MAX_TPS --read-write-ratio $READ_WRITE_RATIO --duration $DURATION --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  multi-chain)
    echo "- Distribution: $DISTRIBUTION" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Cross-chain percentage: $CROSS_CHAIN_PERCENT%" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/multi-chain.js --distribution $DISTRIBUTION --cross-chain-percent $CROSS_CHAIN_PERCENT --duration $DURATION --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  strategy-mutation)
    echo "- Initial pool: $INITIAL_POOL strategies" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Generations: $GENERATIONS" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Market data: $MARKET_DATA" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/strategy-mutation.js --initial-pool $INITIAL_POOL --generations $GENERATIONS --market-data $MARKET_DATA --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  chaos)
    echo "- Scenario: $SCENARIO" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/chaos-test.js --scenario $SCENARIO --duration $DURATION --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  recovery)
    echo "- Components: $COMPONENTS" | tee -a "$OUTPUT_DIR/benchmark.log"
    echo "- Sequential: $SEQUENTIAL" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/recovery-test.js --components $COMPONENTS --sequential $SEQUENTIAL --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  fallback-comparison)
    echo "- Scenario: $SCENARIO" | tee -a "$OUTPUT_DIR/benchmark.log"
    node benchmarks/fallback-comparison.js --scenario $SCENARIO --duration $DURATION --output "$OUTPUT_DIR/results.$OUTPUT_FORMAT"
    ;;
  *)
    echo "Error: Unknown test name: $TEST_NAME"
    exit 1
    ;;
esac

# Check if benchmark completed successfully
if [ $? -eq 0 ]; then
  echo "Benchmark completed successfully. Results saved to: $OUTPUT_DIR/results.$OUTPUT_FORMAT"
  
  # Generate visualization if requested
  if [ "$OUTPUT_FORMAT" = "json" ]; then
    node benchmarks/visualize.js --input "$OUTPUT_DIR/results.json" --output "$OUTPUT_DIR/visualization.html"
    echo "Visualization generated: $OUTPUT_DIR/visualization.html"
  fi
  
  # Compare with baseline if available
  if [ -f "benchmark_baselines/${TEST_NAME}_baseline.$OUTPUT_FORMAT" ]; then
    node benchmarks/compare.js --baseline "benchmark_baselines/${TEST_NAME}_baseline.$OUTPUT_FORMAT" --current "$OUTPUT_DIR/results.$OUTPUT_FORMAT" --output "$OUTPUT_DIR/comparison.$OUTPUT_FORMAT"
    echo "Comparison with baseline generated: $OUTPUT_DIR/comparison.$OUTPUT_FORMAT"
  fi
else
  echo "Benchmark failed. Check logs for details."
  exit 1
fi 