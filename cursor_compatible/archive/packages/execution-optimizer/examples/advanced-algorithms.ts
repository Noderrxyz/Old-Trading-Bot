/**
 * Execution Optimizer - Advanced Algorithm Examples
 * Demonstrates sophisticated execution algorithms for institutional trading
 */

import {
  ExecutionOptimizerService,
  createDefaultConfig,
  createOrder,
  OrderSide,
  OrderType,
  AlgorithmType,
  ExecutionUrgency,
  MarketCondition
} from '../src';
import winston from 'winston';

// Create logger
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
  console.log('🚀 Advanced Execution Algorithms Demo\n');

  // Initialize service
  const config = createDefaultConfig();
  
  // Enable all algorithms
  config.algorithms = [
    {
      type: AlgorithmType.TWAP,
      enabled: true,
      parameters: {},
      constraints: {
        maxSlippage: 0.005,
        maxMarketImpact: 0.002,
        maxFees: 0.001,
        minFillRate: 0.95,
        maxExecutionTime: 3600000,
        maxOrderCount: 100,
        allowPartialFill: true,
        requireMEVProtection: true
      },
      objectives: {
        primary: 'price',
        weights: {
          price: 0.4,
          speed: 0.2,
          marketImpact: 0.3,
          fees: 0.1,
          certainty: 0
        }
      },
      monitoring: {
        realTimeTracking: true,
        alertThresholds: {
          slippage: 0.01,
          fillRate: 0.9,
          marketImpact: 0.005,
          deviation: 0.02
        },
        reportingInterval: 10000,
        performanceMetrics: ['slippage', 'fillRate', 'vwap']
      }
    },
    {
      type: AlgorithmType.VWAP,
      enabled: true,
      parameters: {},
      constraints: {
        maxSlippage: 0.003,
        maxMarketImpact: 0.001,
        maxFees: 0.001,
        minFillRate: 0.98,
        maxExecutionTime: 7200000,
        maxOrderCount: 200,
        allowPartialFill: true,
        requireMEVProtection: false
      },
      objectives: {
        primary: 'price',
        weights: {
          price: 0.5,
          speed: 0.1,
          marketImpact: 0.3,
          fees: 0.1,
          certainty: 0
        }
      },
      monitoring: {
        realTimeTracking: true,
        alertThresholds: {
          slippage: 0.005,
          fillRate: 0.95,
          marketImpact: 0.002,
          deviation: 0.01
        },
        reportingInterval: 5000,
        performanceMetrics: ['trackingError', 'participation', 'volumeProfile']
      }
    },
    {
      type: AlgorithmType.POV,
      enabled: true,
      parameters: {},
      constraints: {
        maxSlippage: 0.005,
        maxMarketImpact: 0.003,
        maxFees: 0.001,
        minFillRate: 0.9,
        maxExecutionTime: 28800000, // 8 hours
        maxOrderCount: 1000,
        allowPartialFill: true,
        requireMEVProtection: false
      },
      objectives: {
        primary: 'size',
        weights: {
          price: 0.2,
          speed: 0.1,
          marketImpact: 0.2,
          fees: 0.1,
          certainty: 0.4
        }
      },
      monitoring: {
        realTimeTracking: true,
        alertThresholds: {
          slippage: 0.01,
          fillRate: 0.8,
          marketImpact: 0.005,
          deviation: 0.05
        },
        reportingInterval: 10000,
        performanceMetrics: ['participation', 'volumeExecuted', 'impact']
      }
    },
    {
      type: AlgorithmType.ICEBERG,
      enabled: true,
      parameters: {},
      constraints: {
        maxSlippage: 0.002,
        maxMarketImpact: 0.001,
        maxFees: 0.0005,
        minFillRate: 0.99,
        maxExecutionTime: 86400000, // 24 hours
        maxOrderCount: 500,
        allowPartialFill: true,
        requireMEVProtection: false
      },
      objectives: {
        primary: 'stealth',
        weights: {
          price: 0.3,
          speed: 0.1,
          marketImpact: 0.4,
          fees: 0.2,
          certainty: 0
        }
      },
      monitoring: {
        realTimeTracking: true,
        alertThresholds: {
          slippage: 0.003,
          fillRate: 0.95,
          marketImpact: 0.002,
          deviation: 0.01
        },
        reportingInterval: 30000,
        performanceMetrics: ['detectionRisk', 'clipSize', 'hiddenRatio']
      }
    }
  ];
  
  const optimizer = new ExecutionOptimizerService(config, logger);

  // Set up monitoring
  setupAdvancedMonitoring(optimizer);

  // Start service
  await optimizer.start();

  // Run algorithm examples
  await runAlgorithmExamples(optimizer);

  // Show performance comparison
  await showPerformanceComparison(optimizer);

  // Stop service
  await optimizer.stop();
  console.log('\n✅ Demo completed');
}

/**
 * Set up advanced monitoring for algorithms
 */
function setupAdvancedMonitoring(optimizer: ExecutionOptimizerService) {
  // Monitor algorithm-specific events
  optimizer.on('sliceExecuted', (event) => {
    if (event.metrics) {
      const progress = (event.progress || 0) * 100;
      console.log(`\n📊 Algorithm Progress: ${progress.toFixed(1)}%`);
      
      // Show algorithm-specific metrics
      if (event.metrics.actualVWAP) {
        console.log(`   VWAP Tracking: Target ${event.metrics.targetVWAP}, Actual ${event.metrics.actualVWAP}`);
        console.log(`   Tracking Error: ${(event.metrics.trackingError * 10000).toFixed(1)} bps`);
      }
      
      if (event.metrics.actualParticipation !== undefined) {
        console.log(`   POV Participation: ${(event.metrics.actualParticipation * 100).toFixed(2)}%`);
        console.log(`   Market Volume: ${event.metrics.marketVolumeTracked}`);
      }
    }
  });

  optimizer.on('detectionRiskAlert', (event) => {
    console.log(`\n⚠️  Iceberg Detection Risk: ${(event.risk * 100).toFixed(1)}%`);
    console.log(`   Clips Executed: ${event.clipsExecuted}`);
  });

  optimizer.on('clipFill', (event) => {
    console.log(`   Iceberg Clip Filled: ${event.fill.quantity} @ ${event.fill.price}`);
  });
}

/**
 * Run examples of each algorithm
 */
async function runAlgorithmExamples(optimizer: ExecutionOptimizerService) {
  // Example 1: TWAP for large order
  console.log('\n=== Example 1: TWAP Algorithm ===');
  console.log('Splitting large order across time to minimize market impact');
  
  const twapOrder = createOrder({
    symbol: 'BTC/USDT',
    side: 'buy',
    quantity: 10, // 10 BTC
    type: 'market',
    metadata: {
      algorithm: AlgorithmType.TWAP,
      duration: 60000, // Execute over 1 minute (normally hours)
      slices: 6, // 6 slices
      urgency: ExecutionUrgency.LOW
    }
  });

  try {
    const twapResult = await optimizer.executeOrder(twapOrder);
    displayAlgorithmResult('TWAP', twapResult);
  } catch (error) {
    console.error('TWAP execution failed:', error);
  }

  await delay(3000);

  // Example 2: VWAP for institutional order
  console.log('\n=== Example 2: VWAP Algorithm ===');
  console.log('Following volume patterns to achieve market VWAP');
  
  const vwapOrder = createOrder({
    symbol: 'ETH/USDT',
    side: 'sell',
    quantity: 100, // 100 ETH
    type: 'market',
    metadata: {
      algorithm: AlgorithmType.VWAP,
      duration: 90000, // 1.5 minutes (normally full trading day)
      targetPercentage: 10, // Target 10% of volume
      adaptiveMode: true,
      urgency: ExecutionUrgency.MEDIUM
    }
  });

  try {
    const vwapResult = await optimizer.executeOrder(vwapOrder);
    displayAlgorithmResult('VWAP', vwapResult);
  } catch (error) {
    console.error('VWAP execution failed:', error);
  }

  await delay(3000);

  // Example 3: POV for passive execution
  console.log('\n=== Example 3: POV (Percentage of Volume) Algorithm ===');
  console.log('Participating at fixed percentage of market volume');
  
  const povOrder = createOrder({
    symbol: 'SOL/USDT',
    side: 'buy',
    quantity: 1000, // 1000 SOL
    type: 'market',
    metadata: {
      algorithm: AlgorithmType.POV,
      targetPercentage: 20, // 20% of market volume
      maxPercentage: 30, // Max 30% in thin markets
      adaptiveMode: true,
      urgency: ExecutionUrgency.LOW
    }
  });

  try {
    const povResult = await optimizer.executeOrder(povOrder);
    displayAlgorithmResult('POV', povResult);
  } catch (error) {
    console.error('POV execution failed:', error);
  }

  await delay(3000);

  // Example 4: Iceberg for hidden liquidity
  console.log('\n=== Example 4: Iceberg Algorithm ===');
  console.log('Hiding order size by showing only small portions');
  
  const icebergOrder = createOrder({
    symbol: 'BTC/USDT',
    side: 'buy',
    quantity: 5, // 5 BTC total
    type: 'limit',
    price: 50000,
    metadata: {
      algorithm: AlgorithmType.ICEBERG,
      visibleQuantity: 0.1, // Show only 0.1 BTC at a time
      variance: 0.2, // 20% variance in clip sizes
      urgency: ExecutionUrgency.LOW
    }
  });

  try {
    const icebergResult = await optimizer.executeOrder(icebergOrder);
    displayAlgorithmResult('Iceberg', icebergResult);
  } catch (error) {
    console.error('Iceberg execution failed:', error);
  }

  await delay(3000);

  // Example 5: Complex multi-algorithm scenario
  console.log('\n=== Example 5: Market Condition Adaptation ===');
  console.log('Adapting algorithm based on market conditions');
  
  // Simulate volatile market
  optimizer.updateMarketCondition(MarketCondition.VOLATILE);
  
  const adaptiveOrder = createOrder({
    symbol: 'ETH/USDT',
    side: 'sell',
    quantity: 50,
    type: 'market',
    metadata: {
      // Algorithm will be selected based on market condition
      slippageTolerance: 0.01, // Allow 1% slippage in volatile market
      urgency: ExecutionUrgency.HIGH
    }
  });

  try {
    const adaptiveResult = await optimizer.executeOrder(adaptiveOrder);
    displayAlgorithmResult('Adaptive', adaptiveResult);
  } catch (error) {
    console.error('Adaptive execution failed:', error);
  }
}

/**
 * Display algorithm-specific results
 */
function displayAlgorithmResult(algorithm: string, result: any) {
  console.log(`\n   ${algorithm} Execution Result:`);
  console.log(`   - Status: ${result.status}`);
  console.log(`   - Average Price: $${result.averagePrice.toFixed(2)}`);
  console.log(`   - Total Quantity: ${result.totalQuantity}`);
  console.log(`   - Execution Time: ${(result.executionTime / 1000).toFixed(1)}s`);
  console.log(`   - Fill Rate: ${(result.performance.fillRate * 100).toFixed(1)}%`);
  console.log(`   - Slippage: ${result.performance.slippageBps.toFixed(1)} bps`);
  
  // Algorithm-specific metrics
  if (result.performance.vwapDeviation !== undefined && result.performance.vwapDeviation !== 0) {
    console.log(`   - VWAP Deviation: $${Math.abs(result.performance.vwapDeviation).toFixed(2)}`);
  }
  
  if (result.performance.benchmarkDeviation > 0) {
    console.log(`   - Benchmark Deviation: ${(result.performance.benchmarkDeviation * 100).toFixed(2)}%`);
  }
  
  console.log(`   - Total Cost: $${result.performance.totalCost.toFixed(2)}`);
}

/**
 * Show performance comparison between algorithms
 */
async function showPerformanceComparison(optimizer: ExecutionOptimizerService) {
  console.log('\n=== Algorithm Performance Comparison ===\n');
  
  const analytics = optimizer.getAnalytics();
  
  console.log('📊 Algorithm Performance:');
  console.log('┌─────────────┬──────────┬─────────────┬────────────┬──────────────┐');
  console.log('│ Algorithm   │ Orders   │ Success Rate│ Avg Slippage│ Avg Time     │');
  console.log('├─────────────┼──────────┼─────────────┼────────────┼──────────────┤');
  
  const algorithms = ['TWAP', 'VWAP', 'POV', 'ICEBERG'];
  for (const algo of algorithms) {
    const perf = analytics.algorithmPerformance[algo];
    if (perf) {
      const successRate = (perf.successRate * 100).toFixed(1) + '%';
      const avgSlippage = '5.2 bps'; // Mock data
      const avgTime = '45.3s'; // Mock data
      
      console.log(`│ ${algo.padEnd(11)} │ ${perf.ordersExecuted.toString().padEnd(8)} │ ${successRate.padEnd(11)} │ ${avgSlippage.padEnd(10)} │ ${avgTime.padEnd(12)} │`);
    }
  }
  
  console.log('└─────────────┴──────────┴─────────────┴────────────┴──────────────┘');
  
  console.log('\n💡 Algorithm Recommendations:');
  console.log('   • TWAP: Best for minimizing market impact over time');
  console.log('   • VWAP: Ideal for achieving market-average prices');
  console.log('   • POV: Perfect for passive execution without timing risk');
  console.log('   • Iceberg: Optimal for hiding large order sizes');
  
  console.log('\n🎯 Selection Guidelines:');
  console.log('   • Urgency HIGH → POV or Smart Routing');
  console.log('   • Urgency LOW → TWAP or Iceberg');
  console.log('   • Large Orders → TWAP or VWAP');
  console.log('   • Stealth Required → Iceberg');
  console.log('   • Benchmark Tracking → VWAP');
}

/**
 * Utility function to add delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
main().catch(console.error); 