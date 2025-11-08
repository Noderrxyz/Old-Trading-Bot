// Full execution chain benchmark script
import { 
  SmartOrderRouterRust, 
  RiskCalculatorRust, 
  DynamicTradeSizerRust,
  ExecutionStrategyRouterRust,
  ExecutionAlgorithm
} from '../src/index.js';

import { OrderSide } from '../src/execution/order.js';
import { PositionDirection } from '../src/types/position.js';

// Configuration values
const ITERATIONS = 10000;
const WARMUP_ITERATIONS = 100;
const PORTFOLIO_VALUE = 100000;

// Setup components
const riskConfig = {
  maxPositionSizePct: 0.1,
  maxLeverage: 3.0,
  maxDrawdownPct: 0.2,
  minTrustScore: 0.7,
  maxExposurePerSymbol: 0.3,
  maxExposurePerVenue: 0.4,
  exemptStrategies: [],
  fastRiskMode: true,
};

const strategyConfig = {
  defaultStrategy: ExecutionAlgorithm.TWAP,
  minOrderSizeForTwap: 1000.0,
  minOrderSizeForVwap: 5000.0,
  maxExecutionTimeMs: 300000,
  symbolStrategyMap: {},
};

const trustScores = {
  'binance': 0.9,
  'coinbase': 0.8,
  'kraken': 0.7,
};

// Initialize components
console.log('Initializing components...');
const sizer = new DynamicTradeSizerRust();
const risk = new RiskCalculatorRust(riskConfig, PORTFOLIO_VALUE);
const strategyRouter = new ExecutionStrategyRouterRust(strategyConfig);
const orderRouter = SmartOrderRouterRust.withTrustScores(trustScores);

// Warmup
console.log(`Running ${WARMUP_ITERATIONS} warmup iterations...`);
for (let i = 0; i < WARMUP_ITERATIONS; i++) {
  await runFullChain('BTC-USD', 1000.0, 50000.0);
}

// Benchmark
console.log(`Running ${ITERATIONS} benchmark iterations...`);
const durations = [];
const start = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  const iterStart = performance.now();
  await runFullChain('BTC-USD', 1000.0, 50000.0);
  durations.push(performance.now() - iterStart);
}

const end = performance.now();
const totalTime = end - start;

// Calculate statistics
durations.sort((a, b) => a - b);
const min = durations[0];
const max = durations[durations.length - 1];
const median = durations[Math.floor(durations.length / 2)];
const p95 = durations[Math.floor(durations.length * 0.95)];
const p99 = durations[Math.floor(durations.length * 0.99)];
const mean = durations.reduce((a, b) => a + b, 0) / durations.length;

// Print results
console.log('Benchmark Results:');
console.log(`Total time: ${totalTime.toFixed(2)}ms for ${ITERATIONS} iterations`);
console.log(`Average time per iteration: ${mean.toFixed(3)}ms`);
console.log(`Min: ${min.toFixed(3)}ms`);
console.log(`Max: ${max.toFixed(3)}ms`);
console.log(`Median: ${median.toFixed(3)}ms`);
console.log(`95th percentile: ${p95.toFixed(3)}ms`);
console.log(`99th percentile: ${p99.toFixed(3)}ms`);
console.log(`Throughput: ${(ITERATIONS / (totalTime / 1000)).toFixed(2)} iterations/second`);

// Execute the full chain
async function runFullChain(symbol, baseSize, price) {
  try {
    // 1. Calculate position size based on volatility
    const adjustedSize = await sizer.calculatePositionSize(symbol, baseSize);
    
    // 2. Create a position for risk check
    const position = {
      symbol,
      venue: 'binance',
      size: adjustedSize / price,
      value: adjustedSize,
      leverage: 1.0,
      trustScore: 0.9,
      direction: PositionDirection.Long,
    };
    
    // 3. Perform risk validation
    const riskResult = await risk.fastRiskCheck(position);
    
    if (riskResult.passed) {
      // 4. Create an order
      const order = {
        id: `bench-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        symbol,
        side: OrderSide.Buy,
        amount: adjustedSize / price,
        price: price,
        venues: ['binance', 'coinbase'],
      };
      
      // 5. Select execution strategy
      const executionPromise = new Promise(resolve => {
        strategyRouter.execute(order, result => {
          resolve(result);
        });
      });
      
      await executionPromise;
    }
  } catch (error) {
    console.error('Error in execution chain:', error);
  }
} 