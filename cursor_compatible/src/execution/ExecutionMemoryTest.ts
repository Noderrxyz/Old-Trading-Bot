/**
 * ExecutionMemory Test
 * 
 * Simple test to demonstrate execution memory functionality by
 * simulating executions and analyzing the results.
 */

import { ExecutionMemory, getExecutionMemory } from './ExecutionMemory.js';
import { OrderIntent, ExecutedOrder } from '../types/execution.types.js';
import { createTrustVisualizer } from './TrustVisualizer.js';
import path from 'path';

// Configure success/failure rates for different venues
const venueSuccessRates: Record<string, number> = {
  'uniswap_v3': 0.95,
  'sushiswap': 0.85,
  'balancer': 0.9,
  'curve': 0.92,
  'dodo': 0.8
};

// Configure slippage for different venues
const venueSlippage: Record<string, number> = {
  'uniswap_v3': 30,
  'sushiswap': 50,
  'balancer': 40,
  'curve': 25,
  'dodo': 60
};

// Configure latency for different venues
const venueLatency: Record<string, number> = {
  'uniswap_v3': 200,
  'sushiswap': 350,
  'balancer': 250,
  'curve': 180,
  'dodo': 400
};

// Supported token pairs for simulation
const tokenPairs = [
  'ETH/USDC',
  'WBTC/USDC',
  'ETH/DAI',
  'LINK/ETH',
  'UNI/ETH'
];

/**
 * Create a mock order intent
 * @param pair Token pair
 * @param side Buy or sell side
 * @returns Mock order
 */
function createMockOrder(pair: string, side: 'buy' | 'sell'): OrderIntent {
  return {
    asset: pair,
    side,
    quantity: Math.random() * 10 + 1,
    type: 'market',
    urgency: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low',
    maxSlippageBps: 100,
    tags: ['test', `mode:${Math.random() > 0.5 ? 'NORMAL' : 'SAFETY'}`]
  };
}

/**
 * Create a mock execution result
 * @param order Order intent
 * @param venue Venue ID
 * @param success Whether execution succeeded
 * @returns Mock execution result
 */
function createMockExecution(
  order: OrderIntent,
  venue: string,
  success: boolean
): ExecutedOrder {
  const orderId = `${venue}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const basePrice = Math.random() * 1000 + 100;
  
  // Apply randomized slippage based on venue
  const slippageBps = venueSlippage[venue] * (0.5 + Math.random()); 
  
  // Executed price with slippage
  const priceDirection = order.side === 'buy' ? 1 : -1;
  const executedPrice = basePrice * (1 + (priceDirection * slippageBps / 10000));
  
  // Latency with some randomization
  const latencyMs = venueLatency[venue] * (0.7 + Math.random() * 0.6);
  
  return {
    intent: order,
    venue,
    orderId,
    executedPrice,
    executedQuantity: success ? order.quantity : 0,
    timestamp: Date.now(),
    status: success ? 'filled' : 'failed',
    latencyMs,
    slippageBps,
    failureReason: success ? undefined : getRandomFailureReason(),
    metadata: {
      executionStyle: Math.random() > 0.5 ? 'Adaptive' : 'Passive',
      route: {
        path: order.asset.split('/'),
        pool: `${venue}_${order.asset.replace('/', '_')}`
      }
    }
  };
}

/**
 * Generate a random failure reason
 * @returns Failure reason string
 */
function getRandomFailureReason(): string {
  const reasons = [
    'Insufficient liquidity',
    'Price slippage too high',
    'Transaction reverted: out of gas',
    'Execution timeout',
    'Transaction reverted: function call failed'
  ];
  
  return reasons[Math.floor(Math.random() * reasons.length)];
}

/**
 * Run execution memory test
 */
async function runExecutionMemoryTest() {
  console.log('Starting ExecutionMemory test...');
  
  // Get execution memory instance
  const executionMemory = getExecutionMemory({
    trustScoreStorePath: './test_trust_store.json',
    executionLogPath: './test_execution_results.jsonl'
  });
  
  const executionCount = 100;
  const executedOrders: ExecutedOrder[] = [];
  
  console.log(`Simulating ${executionCount} executions...`);
  
  // Simulate executions
  for (let i = 0; i < executionCount; i++) {
    // Pick a random token pair and venue
    const pair = tokenPairs[Math.floor(Math.random() * tokenPairs.length)];
    const venue = Object.keys(venueSuccessRates)[Math.floor(Math.random() * Object.keys(venueSuccessRates).length)];
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    
    // Create mock order
    const order = createMockOrder(pair, side);
    
    // Determine if execution succeeds based on venue success rate
    const success = Math.random() < venueSuccessRates[venue];
    
    // Create mock execution result
    const result = createMockExecution(order, venue, success);
    
    // Record in execution memory
    executionMemory.recordExecution(order, result);
    executedOrders.push(result);
    
    // Simulate time passing between executions
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  console.log('Executions completed.');
  
  // Get performance metrics
  const metrics = executionMemory.getPerformanceMetrics();
  
  // Define venue metric type
  interface VenueMetric {
    successCount: number;
    failureCount: number;
    avgSlippageBps: number;
    avgLatencyMs: number;
    trustScore: number;
  }
  
  // Define token pair metric type
  interface TokenPairMetric {
    successCount: number;
    failureCount: number;
    avgSlippageBps: number;
    bestVenue: string;
    bestVenueScore: number;
  }
  
  console.log('\nVenue Performance:');
  Object.entries(metrics.venueMetrics as Record<string, VenueMetric>).forEach(([venue, data]) => {
    const successRate = data.successCount / (data.successCount + data.failureCount);
    console.log(`- ${venue}: Trust ${data.trustScore.toFixed(2)}, Success ${(successRate * 100).toFixed(1)}%, Slippage ${data.avgSlippageBps.toFixed(1)} bps`);
  });
  
  console.log('\nToken Pair Performance:');
  Object.entries(metrics.tokenPairMetrics as Record<string, TokenPairMetric>).forEach(([pair, data]) => {
    console.log(`- ${pair}: Best venue ${data.bestVenue} (Score: ${data.bestVenueScore.toFixed(2)})`);
  });
  
  // Generate route recommendations
  console.log('\nRoute Recommendations:');
  tokenPairs.forEach(pair => {
    const routes = executionMemory.getRoutesForTokenPair(pair);
    console.log(`\n${pair} routes:`);
    
    // Convert to array and sort by trust score
    const sortedRoutes = Array.from(routes.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([venue, score]) => `${venue} (${score.toFixed(2)})`);
    
    console.log(sortedRoutes.join(', '));
  });
  
  // Generate visualization
  console.log('\nGenerating visualizations...');
  const visualizer = createTrustVisualizer();
  await visualizer.generateVisualization({
    outputDir: './execution_reports',
    topCount: 3,
    minExecutionCount: 5,
    timeRangeMs: 0
  });
  
  console.log('\nTest completed.');
  console.log('Execution reports available in ./execution_reports/');
  
  // Persist data
  executionMemory.persistNow();
  executionMemory.dispose();
}

// Run the test
runExecutionMemoryTest().catch(console.error); 