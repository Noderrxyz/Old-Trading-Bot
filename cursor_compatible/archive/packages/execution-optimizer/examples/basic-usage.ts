/**
 * Execution Optimizer - Basic Usage Examples
 * Demonstrates various features of the world-class execution engine
 */

import {
  ExecutionOptimizerService,
  createDefaultConfig,
  createOrder,
  OrderSide,
  OrderType,
  AlgorithmType,
  MarketCondition,
  ExecutionUrgency
} from '../src';
import winston from 'winston';

// Create logger with custom formatting
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
      }`;
    })
  ),
  transports: [new winston.transports.Console()]
});

async function main() {
  console.log('🚀 Execution Optimizer Demo\n');

  // 1. Initialize service with configuration
  const config = createDefaultConfig();
  
  // Customize configuration
  config.routing.mevProtection = true;
  config.execution.objectives.primary = 'cost'; // Optimize for cost
  
  const optimizer = new ExecutionOptimizerService(config, logger);

  // 2. Set up event listeners
  setupEventListeners(optimizer);

  // 3. Start the service
  await optimizer.start();
  console.log('✅ Service started\n');

  // 4. Execute various order types
  await executionExamples(optimizer);

  // 5. Show analytics
  await showAnalytics(optimizer);

  // 6. Stop the service
  await optimizer.stop();
  console.log('\n✅ Service stopped');
}

/**
 * Set up event listeners for monitoring
 */
function setupEventListeners(optimizer: ExecutionOptimizerService) {
  optimizer.on('executionStarted', (event) => {
    console.log(`\n📋 Order ${event.orderId} execution started`);
    if (event.algorithm) {
      console.log(`   Using ${event.algorithm} algorithm`);
    }
  });

  optimizer.on('executionComplete', (result) => {
    console.log(`\n✅ Order ${result.orderId} completed:`);
    console.log(`   Average Price: $${result.averagePrice.toFixed(2)}`);
    console.log(`   Total Quantity: ${result.totalQuantity}`);
    console.log(`   Slippage: ${(result.slippage * 100).toFixed(3)}%`);
    console.log(`   Total Fees: $${result.totalFees.toFixed(2)}`);
    console.log(`   Execution Time: ${result.executionTime}ms`);
  });

  optimizer.on('sliceExecuted', (event) => {
    console.log(`   TWAP Progress: ${(event.progress * 100).toFixed(1)}%`);
  });

  optimizer.on('mevProtectionApplied', (event) => {
    console.log(`\n🛡️  MEV Protection Applied:`);
    console.log(`   Strategy: ${event.strategy}`);
    console.log(`   Saved: $${event.savedAmount?.toFixed(2) || 'N/A'}`);
  });
}

/**
 * Execute various order examples
 */
async function executionExamples(optimizer: ExecutionOptimizerService) {
  // Example 1: Simple Market Order
  console.log('\n=== Example 1: Simple Market Order ===');
  
  const marketOrder = createOrder({
    symbol: 'BTC/USDT',
    side: 'buy',
    quantity: 0.1,
    type: 'market'
  });

  try {
    const result1 = await optimizer.executeOrder(marketOrder);
    displayResult('Market Order', result1);
  } catch (error) {
    console.error('Market order failed:', error);
  }

  await delay(2000);

  // Example 2: Large Order with TWAP
  console.log('\n=== Example 2: Large Order with TWAP Algorithm ===');
  
  const twapOrder = createOrder({
    symbol: 'ETH/USDT',
    side: 'buy',
    quantity: 50,
    type: 'market',
    metadata: {
      algorithm: AlgorithmType.TWAP,
      duration: 30000,    // 30 seconds for demo (normally would be hours)
      slices: 5,          // Split into 5 slices
      urgency: ExecutionUrgency.MEDIUM
    }
  });

  try {
    const result2 = await optimizer.executeOrder(twapOrder);
    displayResult('TWAP Order', result2);
  } catch (error) {
    console.error('TWAP order failed:', error);
  }

  await delay(2000);

  // Example 3: Limit Order with MEV Protection
  console.log('\n=== Example 3: Limit Order with MEV Protection ===');
  
  const limitOrder = createOrder({
    symbol: 'UNI/USDT',
    side: 'sell',
    quantity: 100,
    type: 'limit',
    price: 25.50,
    metadata: {
      mevProtection: true,
      slippageTolerance: 0.003,  // 0.3% slippage
      preferredExchanges: ['binance', 'coinbase']
    }
  });

  try {
    const result3 = await optimizer.executeOrder(limitOrder);
    displayResult('Limit Order with MEV Protection', result3);
  } catch (error) {
    console.error('Limit order failed:', error);
  }

  await delay(2000);

  // Example 4: Smart Routed Order
  console.log('\n=== Example 4: Smart Routed Multi-Exchange Order ===');
  
  const smartOrder = createOrder({
    symbol: 'BTC/USDT',
    side: 'sell',
    quantity: 2,
    type: 'market',
    metadata: {
      urgency: ExecutionUrgency.HIGH,
      venueAnalysis: true,
      darkPoolAccess: false
    }
  });

  try {
    const result4 = await optimizer.executeOrder(smartOrder);
    displayResult('Smart Routed Order', result4);
    
    // Show routing breakdown
    console.log('\n   Routing Breakdown:');
    result4.routes.forEach(route => {
      console.log(`   - ${route.exchange}: ${route.quantity} @ $${route.averagePrice.toFixed(2)}`);
    });
  } catch (error) {
    console.error('Smart order failed:', error);
  }

  // Example 5: Update market condition and execute
  console.log('\n=== Example 5: Volatile Market Condition ===');
  
  optimizer.updateMarketCondition(MarketCondition.VOLATILE);
  
  const volatileOrder = createOrder({
    symbol: 'SOL/USDT',
    side: 'buy',
    quantity: 20,
    type: 'market',
    metadata: {
      maxSlippage: 0.01  // Allow 1% slippage in volatile conditions
    }
  });

  try {
    const result5 = await optimizer.executeOrder(volatileOrder);
    displayResult('Volatile Market Order', result5);
  } catch (error) {
    console.error('Volatile order failed:', error);
  }
}

/**
 * Display execution result
 */
function displayResult(orderType: string, result: any) {
  console.log(`\n   ${orderType} Result:`);
  console.log(`   - Status: ${result.status}`);
  console.log(`   - Fill Rate: ${(result.performance.fillRate * 100).toFixed(1)}%`);
  console.log(`   - Slippage: ${result.performance.slippageBps.toFixed(1)} bps`);
  console.log(`   - Total Cost: $${result.performance.totalCost.toFixed(2)}`);
}

/**
 * Show analytics dashboard
 */
async function showAnalytics(optimizer: ExecutionOptimizerService) {
  console.log('\n=== Execution Analytics Dashboard ===\n');
  
  const analytics = optimizer.getAnalytics();
  
  console.log('📊 Overall Performance:');
  console.log(`   Total Orders: ${analytics.totalOrders}`);
  console.log(`   Total Volume: $${analytics.totalVolume.toFixed(2)}`);
  console.log(`   Average Slippage: ${(analytics.averageSlippage * 100).toFixed(3)}%`);
  console.log(`   Average Execution Time: ${analytics.averageExecutionTime.toFixed(0)}ms`);
  console.log(`   Fill Rate: ${(analytics.fillRate * 100).toFixed(1)}%`);
  console.log(`   Failure Rate: ${(analytics.failureRate * 100).toFixed(1)}%`);
  
  console.log('\n💰 Cost Analysis:');
  console.log(`   Total Fees: $${analytics.costAnalysis.totalFees.toFixed(2)}`);
  console.log(`   Total Slippage Cost: $${analytics.costAnalysis.totalSlippage.toFixed(2)}`);
  console.log(`   Average Cost (bps): ${analytics.costAnalysis.averageCostBps.toFixed(1)}`);
  console.log(`   Saved from Optimization: $${analytics.costAnalysis.savedFromOptimization.toFixed(2)}`);
  
  console.log('\n🛡️  MEV Protection Stats:');
  console.log(`   Attacks Detected: ${analytics.mevStats.attacksDetected}`);
  console.log(`   Attacks Prevented: ${analytics.mevStats.attacksPrevented}`);
  console.log(`   Estimated Savings: $${analytics.mevStats.estimatedSavings.toFixed(2)}`);
  
  // Show algorithm performance if available
  if (Object.keys(analytics.algorithmPerformance).length > 0) {
    console.log('\n🤖 Algorithm Performance:');
    for (const [algo, perf] of Object.entries(analytics.algorithmPerformance)) {
      console.log(`   ${algo}:`);
      console.log(`   - Orders: ${perf.ordersExecuted}`);
      console.log(`   - Success Rate: ${(perf.successRate * 100).toFixed(1)}%`);
    }
  }
}

/**
 * Utility function to add delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
main().catch(console.error);

// Export for testing
export { main, setupEventListeners, executionExamples }; 