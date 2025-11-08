/**
 * Advanced usage example for Noderr Trading System
 * Demonstrates backtesting, ML model deployment, and custom strategies
 */

import { 
  createSystem, 
  BacktestingFramework,
  ModelVersioningSystem,
  IntegrationTestSuite
} from '../packages/core/src';

// Custom trading strategy
class MomentumStrategy {
  name = 'Momentum Strategy';
  private positions = new Map<string, number>();
  private lookbackPeriod = 20;
  private threshold = 0.02;
  
  onTick(data: any, portfolio: any): any {
    // Simple momentum strategy
    const symbol = data.symbol;
    const currentPrice = data.close;
    
    // Calculate momentum (simplified)
    const momentum = (currentPrice - data.open) / data.open;
    
    // Generate signals
    if (momentum > this.threshold && !this.positions.has(symbol)) {
      // Buy signal
      return {
        action: 'BUY',
        symbol,
        quantity: 0.1,
        orderType: 'MARKET'
      };
    } else if (momentum < -this.threshold && this.positions.has(symbol)) {
      // Sell signal
      return {
        action: 'SELL',
        symbol,
        quantity: this.positions.get(symbol),
        orderType: 'MARKET'
      };
    }
    
    return null;
  }
}

async function runBacktest() {
  console.log('Running backtest...');
  
  const logger = console as any; // Simple logger
  const backtester = new BacktestingFramework(logger);
  
  const config = {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-02-01'),
    initialCapital: 100000,
    symbols: ['BTCUSD', 'ETHUSD'],
    dataSource: 'simulated' as const,
    slippageModel: {
      type: 'linear' as const,
      baseSlippage: 5, // 5 basis points
      impactCoefficient: 0.1
    },
    feeModel: {
      maker: 0.001,
      taker: 0.002,
      fixed: 0
    },
    executionDelay: 100,
    tickInterval: 1000
  };
  
  const strategy = new MomentumStrategy();
  const result = await backtester.runBacktest(config, strategy);
  
  console.log('Backtest Results:');
  console.log(`Total Return: ${(result.performance.totalReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${result.performance.sharpeRatio.toFixed(2)}`);
  console.log(`Max Drawdown: ${(result.performance.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Win Rate: ${(result.performance.winRate * 100).toFixed(2)}%`);
  console.log(`Total Trades: ${result.performance.totalTrades}`);
  
  return result;
}

async function deployMLModel(system: any) {
  console.log('Deploying ML model...');
  
  const modelVersioning = system.getComponent('modelVersioning');
  
  // Register a new model (in production, this would be a real model file)
  const modelMetadata = await modelVersioning.registerModel(
    './mock-model.bin', // This would be the actual model file
    {
      name: 'Price Prediction Model',
      version: '1.0.0',
      type: 'tensorflow',
      framework: 'TensorFlow 2.0',
      architecture: {
        layers: [
          { type: 'dense', units: 128 },
          { type: 'dropout', rate: 0.2 },
          { type: 'dense', units: 64 },
          { type: 'dense', units: 1 }
        ]
      },
      hyperparameters: {
        learningRate: 0.001,
        batchSize: 32,
        epochs: 100
      },
      trainingMetrics: {
        loss: 0.023,
        accuracy: 0.94,
        epochs: 100,
        trainingTime: 3600,
        convergenceEpoch: 85,
        learningRate: 0.001,
        batchSize: 32
      },
      validationMetrics: {
        testLoss: 0.028,
        testAccuracy: 0.92,
        precision: 0.91,
        recall: 0.93,
        f1Score: 0.92,
        auc: 0.95,
        sharpeRatio: 1.8,
        maxDrawdown: 0.12,
        customMetrics: {}
      },
      trainedBy: 'data-science-team',
      datasetVersion: 'v2024.01',
      tags: ['production-ready', 'high-frequency']
    }
  );
  
  console.log(`Model registered: ${modelMetadata.id}`);
  
  // Deploy the model
  const deployment = await modelVersioning.deployModel(
    modelMetadata.id,
    'production',
    {
      cpu: 4,
      memory: 8192,
      gpu: 1,
      replicas: 3
    }
  );
  
  console.log(`Model deployed: ${deployment.deploymentId}`);
  
  return deployment;
}

async function runIntegrationTests(system: any) {
  console.log('Running integration tests...');
  
  const logger = console as any;
  const testSuite = new IntegrationTestSuite(logger, {
    name: 'Production Integration Tests',
    parallel: false,
    timeout: 30000,
    retries: 2,
    environment: 'staging'
  });
  
  await testSuite.initialize();
  
  // Run critical tests only
  const report = await testSuite.runTests({
    priorities: ['critical', 'high']
  });
  
  console.log('Test Results:');
  console.log(`Total Tests: ${report.totalTests}`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Coverage: ${report.coverage.overall.toFixed(1)}%`);
  
  if (report.failed > 0) {
    console.error('Some tests failed:');
    report.results
      .filter(r => r.status === 'failed')
      .forEach(r => {
        console.error(`- ${r.testCase.name}: ${r.error?.message}`);
      });
  }
  
  await testSuite.cleanup();
  
  return report;
}

async function main() {
  try {
    // 1. Run backtest first
    const backtestResult = await runBacktest();
    
    // 2. Create and initialize system
    const system = await createSystem({
      name: 'Advanced Trading System',
      environment: 'production',
      logLevel: 'info'
    });
    
    // 3. Deploy ML model
    await deployMLModel(system);
    
    // 4. Set up custom risk parameters
    const riskLimits = system.getComponent('riskLimits');
    riskLimits.updateMarketConditions({
      volatility: 0.02,
      volume: 5000000,
      spread: 0.0002,
      correlation: 0.6,
      regime: 'normal'
    });
    
    // 5. Configure compliance for multiple jurisdictions
    const compliance = system.getComponent('compliance');
    // In production, you would configure specific compliance rules
    
    // 6. Set up multi-asset trading
    const multiAsset = system.getComponent('multiAsset');
    await multiAsset.subscribe([
      'BTCUSD',  // Crypto
      'AAPL',    // Equity
      'EURUSD',  // Forex
      'GLD'      // Commodity
    ]);
    
    // 7. Monitor system health
    system.on('health-check', (health) => {
      const unhealthy = health.components.filter((c: any) => c.health !== 'healthy');
      if (unhealthy.length > 0) {
        console.warn('Unhealthy components:', unhealthy);
      }
    });
    
    // 8. Set up emergency procedures
    system.on('alert', async (alert) => {
      if (alert.severity === 'critical') {
        console.error(`CRITICAL ALERT: ${alert.message}`);
        
        // In production, you might:
        // - Send notifications
        // - Reduce positions
        // - Pause trading
        
        if (alert.message.includes('position drift')) {
          await system.executeCommand('pause-trading', { 
            reason: 'Critical position drift detected' 
          });
        }
      }
    });
    
    // 9. Run integration tests
    const testReport = await runIntegrationTests(system);
    
    if (testReport.passed === testReport.totalTests) {
      console.log('All integration tests passed! System is healthy.');
    }
    
    // 10. Run for demonstration
    console.log('System running... Press Ctrl+C to stop');
    
    // Keep running until interrupted
    process.on('SIGINT', async () => {
      console.log('\nShutting down gracefully...');
      await system.shutdown();
      process.exit(0);
    });
    
    // Keep the process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the advanced example
main().catch(console.error); 