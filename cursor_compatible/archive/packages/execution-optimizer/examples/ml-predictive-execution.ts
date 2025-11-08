/**
 * ML Predictive Execution Example
 * Demonstrates machine learning-based execution strategy prediction
 */

import {
  ExecutionOptimizerService,
  PredictiveExecutionEngine,
  createDefaultConfig,
  createOrder,
  MarketCondition,
  OrderSide,
  OrderType,
  ExecutionUrgency
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
  console.log('🤖 ML Predictive Execution Demo\n');
  console.log('Using machine learning to optimize execution strategies...\n');

  // Initialize services
  const config = createDefaultConfig();
  
  // Enable ML prediction
  config.enableMLPrediction = true;
  
  const optimizer = new ExecutionOptimizerService(config, logger);
  const predictiveEngine = new PredictiveExecutionEngine(logger);

  // Set up ML monitoring
  setupMLMonitoring(predictiveEngine);

  // Start service
  await optimizer.start();

  console.log('📊 Model Performance:');
  const modelPerf = predictiveEngine.getPerformance();
  console.log(`   Accuracy: ${(modelPerf.accuracy * 100).toFixed(1)}%`);
  console.log(`   Precision: ${(modelPerf.precision * 100).toFixed(1)}%`);
  console.log(`   MSE: ${modelPerf.mse.toFixed(4)}\n`);

  // Example 1: Volatile market prediction
  console.log('=== Example 1: Volatile Market Conditions ===');
  
  optimizer.updateMarketCondition(MarketCondition.VOLATILE);
  
  const volatileOrder = createOrder({
    symbol: 'BTC/USDT',
    side: 'buy',
    quantity: 25, // Large order
    type: 'market',
    metadata: {
      urgency: ExecutionUrgency.LOW // Not urgent, let ML optimize
    }
  });

  const volatilePrediction = await predictiveEngine.predictExecution(
    volatileOrder,
    MarketCondition.VOLATILE
  );

  console.log('ML Prediction for Volatile Market:');
  console.log(`   Recommended Algorithm: ${volatilePrediction.recommendedAlgorithm}`);
  console.log(`   Confidence: ${(volatilePrediction.algorithmConfidence * 100).toFixed(1)}%`);
  console.log(`   Predicted Slippage: ${(volatilePrediction.predictedSlippage * 10000).toFixed(1)} bps`);
  console.log(`   Predicted Impact: ${(volatilePrediction.predictedImpact * 10000).toFixed(1)} bps`);
  console.log(`   Execution Risk: ${(volatilePrediction.executionRisk * 100).toFixed(1)}%`);
  console.log(`   Optimal Parameters:`, volatilePrediction.optimalParameters);
  
  if (volatilePrediction.optimalStartTime > Date.now()) {
    const delayMins = Math.round((volatilePrediction.optimalStartTime - Date.now()) / 60000);
    console.log(`   ⏰ Recommended to wait ${delayMins} minutes for better execution`);
  }

  // Execute with ML recommendations
  console.log('\nExecuting with ML recommendations...');
  const volatileResult = await optimizer.executeOrder(volatileOrder);
  displayExecutionResult(volatileResult);

  // Update ML model with actual results
  predictiveEngine.updateModel(volatileResult);

  await delay(2000);

  // Example 2: Large order in thin liquidity
  console.log('\n=== Example 2: Large Order in Thin Liquidity ===');
  
  const largeOrder = createOrder({
    symbol: 'SOL/USDT',
    side: 'sell',
    quantity: 5000, // Very large order
    type: 'market',
    metadata: {
      urgency: ExecutionUrgency.MEDIUM
    }
  });

  const largePrediction = await predictiveEngine.predictExecution(
    largeOrder,
    MarketCondition.NORMAL
  );

  console.log('ML Prediction for Large Order:');
  console.log(`   Recommended Algorithm: ${largePrediction.recommendedAlgorithm}`);
  console.log(`   Confidence: ${(largePrediction.algorithmConfidence * 100).toFixed(1)}%`);
  console.log(`   Predicted Slippage: ${(largePrediction.predictedSlippage * 10000).toFixed(1)} bps`);
  console.log(`   Execution Duration: ${(largePrediction.executionDuration / 60000).toFixed(1)} minutes`);
  console.log(`   Adverse Selection Risk: ${(largePrediction.adverseSelectionRisk * 100).toFixed(1)}%`);
  
  const largeResult = await optimizer.executeOrder(largeOrder);
  displayExecutionResult(largeResult);
  
  predictiveEngine.updateModel(largeResult);

  await delay(2000);

  // Example 3: Urgent execution
  console.log('\n=== Example 3: Urgent Execution ===');
  
  const urgentOrder = createOrder({
    symbol: 'ETH/USDT',
    side: 'buy',
    quantity: 50,
    type: 'market',
    metadata: {
      urgency: ExecutionUrgency.CRITICAL,
      slippageTolerance: 0.01 // Allow 1% slippage for speed
    }
  });

  const urgentPrediction = await predictiveEngine.predictExecution(
    urgentOrder,
    MarketCondition.NORMAL
  );

  console.log('ML Prediction for Urgent Order:');
  console.log(`   Recommended Algorithm: ${urgentPrediction.recommendedAlgorithm}`);
  console.log(`   Confidence Interval: [${(urgentPrediction.confidenceInterval[0] * 10000).toFixed(1)}, ${(urgentPrediction.confidenceInterval[1] * 10000).toFixed(1)}] bps`);
  console.log(`   Immediate execution recommended\n`);

  const urgentResult = await optimizer.executeOrder(urgentOrder);
  displayExecutionResult(urgentResult);
  
  predictiveEngine.updateModel(urgentResult);

  await delay(2000);

  // Example 4: Stealth execution
  console.log('\n=== Example 4: Stealth Execution ===');
  
  const stealthOrder = createOrder({
    symbol: 'BTC/USDT',
    side: 'buy',
    quantity: 10,
    type: 'limit',
    price: 49500,
    metadata: {
      urgency: ExecutionUrgency.LOW,
      preferredExchanges: ['binance', 'coinbase'],
      darkPool: true
    }
  });

  const stealthPrediction = await predictiveEngine.predictExecution(
    stealthOrder,
    MarketCondition.NORMAL
  );

  console.log('ML Prediction for Stealth Order:');
  console.log(`   Recommended Algorithm: ${stealthPrediction.recommendedAlgorithm}`);
  console.log(`   Optimal Parameters:`, stealthPrediction.optimalParameters);
  console.log(`   Detection Risk Minimized\n`);

  const stealthResult = await optimizer.executeOrder(stealthOrder);
  displayExecutionResult(stealthResult);
  
  predictiveEngine.updateModel(stealthResult);

  // Show ML learning progress
  console.log('\n📈 ML Model Learning Progress:');
  const updatedPerf = predictiveEngine.getPerformance();
  console.log(`   Accuracy: ${(modelPerf.accuracy * 100).toFixed(1)}% → ${(updatedPerf.accuracy * 100).toFixed(1)}%`);
  console.log(`   MSE: ${modelPerf.mse.toFixed(4)} → ${updatedPerf.mse.toFixed(4)}`);
  console.log(`   Model improved through continuous learning\n`);

  // Show prediction insights
  await showPredictionInsights(optimizer, predictiveEngine);

  // Stop services
  await optimizer.stop();
  predictiveEngine.destroy();
  
  console.log('\n✅ ML Predictive Execution Demo completed');
}

/**
 * Set up ML monitoring
 */
function setupMLMonitoring(engine: PredictiveExecutionEngine) {
  engine.on('predictionComplete', (event) => {
    console.log(`\n🎯 ML Prediction: ${event.prediction.recommendedAlgorithm} with ${(event.prediction.algorithmConfidence * 100).toFixed(0)}% confidence`);
  });

  engine.on('modelsRetrained', (performance) => {
    console.log('\n🔄 ML Models Retrained');
    console.log(`   New Accuracy: ${(performance.accuracy * 100).toFixed(1)}%`);
  });
}

/**
 * Display execution result
 */
function displayExecutionResult(result: any) {
  console.log(`   Execution Result: ${result.status}`);
  console.log(`   Average Price: $${result.averagePrice.toFixed(2)}`);
  console.log(`   Actual Slippage: ${result.performance.slippageBps.toFixed(1)} bps`);
  console.log(`   Fill Rate: ${(result.performance.fillRate * 100).toFixed(1)}%`);
  console.log(`   Execution Time: ${(result.executionTime / 1000).toFixed(1)}s`);
}

/**
 * Show ML prediction insights
 */
async function showPredictionInsights(
  optimizer: ExecutionOptimizerService,
  engine: PredictiveExecutionEngine
) {
  console.log('\n=== ML Prediction Insights ===\n');
  
  // Test different scenarios
  const scenarios = [
    {
      name: 'Small Retail Order',
      order: createOrder({
        symbol: 'BTC/USDT',
        side: 'buy',
        quantity: 0.1,
        type: 'market'
      }),
      condition: MarketCondition.NORMAL
    },
    {
      name: 'Institutional Block Trade',
      order: createOrder({
        symbol: 'ETH/USDT',
        side: 'sell',
        quantity: 1000,
        type: 'market'
      }),
      condition: MarketCondition.CALM
    },
    {
      name: 'High Frequency Trade',
      order: createOrder({
        symbol: 'SOL/USDT',
        side: 'buy',
        quantity: 10,
        type: 'market',
        metadata: { urgency: ExecutionUrgency.CRITICAL }
      }),
      condition: MarketCondition.VOLATILE
    }
  ];

  console.log('📊 Algorithm Recommendations by Scenario:\n');
  
  for (const scenario of scenarios) {
    const prediction = await engine.predictExecution(
      scenario.order,
      scenario.condition
    );
    
    console.log(`${scenario.name}:`);
    console.log(`   Market: ${scenario.condition}`);
    console.log(`   Size: ${scenario.order.quantity} ${scenario.order.symbol.split('/')[0]}`);
    console.log(`   → Algorithm: ${prediction.recommendedAlgorithm}`);
    console.log(`   → Impact: ${(prediction.predictedImpact * 10000).toFixed(1)} bps`);
    console.log(`   → Risk: ${(prediction.executionRisk * 100).toFixed(0)}%\n`);
  }

  console.log('💡 Key ML Insights:');
  console.log('   • Large orders → TWAP/VWAP to minimize impact');
  console.log('   • Volatile markets → POV for adaptive execution');
  console.log('   • Stealth required → Iceberg with variance');
  console.log('   • Urgent orders → Direct routing with MEV protection');
  console.log('   • Model continuously learns from each execution');
}

/**
 * Utility delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
main().catch(console.error); 