import path from 'path';
import { 
  CsvDataSource, 
  MovingAverageCrossoverStrategy, 
  runBacktest, 
  Timeframe 
} from '../index';

/**
 * Simple example demonstrating how to use the backtesting engine
 */
async function runSimpleBacktest() {
  try {
    console.log('Starting simple backtest example...');
    
    // Set up the data source
    const dataDir = path.join(__dirname, '../../../data');
    
    const csvDataSource = new CsvDataSource({
      dataDir,
      barSubDir: 'bars',
      tickSubDir: 'ticks',
      orderBookSubDir: 'orderbooks'
    });
    
    // Create the strategy
    const strategy = new MovingAverageCrossoverStrategy();
    
    // Configure the simulation
    const config = {
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-12-31'),
      initialCapital: 10000,
      symbols: ['BTC/USD'],
      timeframes: [Timeframe.ONE_DAY],
      commission: 0.001, // 0.1%
      slippage: 0.001, // 0.1%
      dataDelay: 0,
      executionDelay: 0
    };
    
    // Set strategy parameters
    const strategyParams = new Map<string, any>();
    strategyParams.set('fastPeriod', 10);
    strategyParams.set('slowPeriod', 30);
    strategyParams.set('quantity', 0.1);
    
    // Run the backtest
    console.log('Running backtest...');
    const results = await runBacktest(
      config,
      strategy,
      [csvDataSource],
      {
        metricsOptions: {
          riskFreeRate: 0.0,
          tradingDaysPerYear: 365, // Crypto trades every day
          confidenceLevel: 0.95
        }
      }
    );
    
    // Print results
    console.log('Backtest completed!');
    console.log('=== Performance Metrics ===');
    console.log(`Total Return: ${(results.metrics.totalReturn * 100).toFixed(2)}%`);
    console.log(`Annualized Return: ${(results.metrics.annualizedReturn * 100).toFixed(2)}%`);
    console.log(`Max Drawdown: ${(results.metrics.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
    console.log(`Sortino Ratio: ${results.metrics.sortinoRatio.toFixed(2)}`);
    console.log(`Winning Trades: ${results.metrics.winningTrades} (${(results.metrics.winRate * 100).toFixed(2)}%)`);
    console.log(`Losing Trades: ${results.metrics.losingTrades}`);
    console.log(`Profit Factor: ${results.metrics.profitFactor.toFixed(2)}`);
    console.log(`Total P&L: $${results.metrics.totalPnl.toFixed(2)}`);
    console.log(`Total Commissions: $${results.metrics.totalCommissions.toFixed(2)}`);
    
    // Log summary of trades
    console.log('=== Trade Summary ===');
    console.log(`Total Trades: ${results.metrics.totalTrades}`);
    console.log(`Average Trade: $${results.metrics.averageTrade.toFixed(2)}`);
    console.log(`Largest Win: $${results.metrics.largestWin.toFixed(2)}`);
    console.log(`Largest Loss: $${results.metrics.largestLoss.toFixed(2)}`);
    console.log(`Average Win: $${results.metrics.avgWin.toFixed(2)}`);
    console.log(`Average Loss: $${results.metrics.avgLoss.toFixed(2)}`);
    
  } catch (error) {
    console.error('Error running backtest:', error);
  }
}

/**
 * Run the example if this file is executed directly
 */
if (require.main === module) {
  runSimpleBacktest().catch(console.error);
}

export { runSimpleBacktest }; 