/**
 * Example of a complete backtesting setup using the Crypto Historical Data Source
 * This file demonstrates how to:
 * 1. Set up a cryptocurrency data source
 * 2. Configure a simple moving average crossover strategy
 * 3. Run a backtest and analyze the results
 */
import path from 'path';
import { 
  CryptoHistoricalDataSource,
  runBacktest, 
  Timeframe,
  MovingAverageCrossoverStrategy,
  Bar
} from '../index';
import fs from 'fs';
import { OrderSide, OrderType } from '../models/types';
import { BacktestContext } from '../models/context';

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', '..', '..', 'data', 'crypto');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Simple Moving Average Crossover Strategy
 * - Buy when fast MA crosses above slow MA
 * - Sell when fast MA crosses below slow MA
 */
class BTCUSDMovingAverageCrossoverStrategy extends MovingAverageCrossoverStrategy {
  // Additional properties for risk management
  private stopLossPercentage: number;
  private takeProfitPercentage: number;
  
  constructor() {
    super({
      id: 'ma_crossover_btcusd',
      name: 'Moving Average Crossover BTC/USD',
      symbols: ['BTC/USD'],
      fastPeriod: 10,
      slowPeriod: 30,
      // Additional parameters
      stopLossPercentage: 5, // 5% stop loss
      takeProfitPercentage: 15, // 15% take profit
      positionSizing: 0.25 // Use 25% of available capital per trade
    });
    
    // Store values for easier access
    this.stopLossPercentage = 5;
    this.takeProfitPercentage = 15;
  }

  // Override onBar to add stop loss and take profit logic
  async onBar(bar: Bar, context: BacktestContext): Promise<void> {
    // First, call the parent class implementation for the MA crossover logic
    await super.onBar(bar, context);
    
    // Then add our custom risk management
    const position = context.getPosition(bar.symbol);
    
    if (position && position.quantity > 0) {
      const entryPrice = position.averageEntryPrice;
      const currentPrice = bar.close;
      
      // Check stop loss
      if (currentPrice < entryPrice * (1 - this.stopLossPercentage / 100)) {
        context.log(`Stop loss triggered at ${currentPrice} (Entry: ${entryPrice})`);
        context.placeOrder({
          symbol: bar.symbol,
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          quantity: position.quantity
        });
      }
      
      // Check take profit
      if (currentPrice > entryPrice * (1 + this.takeProfitPercentage / 100)) {
        context.log(`Take profit triggered at ${currentPrice} (Entry: ${entryPrice})`);
        context.placeOrder({
          symbol: bar.symbol,
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          quantity: position.quantity
        });
      }
    }
  }
}

/**
 * Main function to run the backtest
 */
async function runBTCUSDBacktest() {
  try {
    console.log('Setting up cryptocurrency data source...');
    
    // Create data source
    const cryptoDataSource = new CryptoHistoricalDataSource({
      cacheDir: dataDir,
      exchange: 'binance',
      useCache: true
    });
    
    // Define backtest timeframe
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1); // 1 year of data
    
    // Create strategy
    const strategy = new BTCUSDMovingAverageCrossoverStrategy();
    
    console.log(`Running backtest from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Configure backtest
    const backtestConfig = {
      startDate,
      endDate,
      initialCapital: 10000, // $10,000 starting capital
      symbols: ['BTC/USD'],
      timeframes: [Timeframe.ONE_DAY],
      commission: 0.001, // 0.1% commission (typical for crypto exchanges)
      slippage: 0.001 // 0.1% slippage
    };
    
    // Run backtest
    const results = await runBacktest(backtestConfig, strategy, [cryptoDataSource]);
    
    // Print results
    console.log('\n--- BACKTEST RESULTS ---');
    console.log(`Total Return: ${(results.metrics.totalReturn * 100).toFixed(2)}%`);
    console.log(`Annualized Return: ${(results.metrics.annualizedReturn * 100).toFixed(2)}%`);
    console.log(`Max Drawdown: ${(results.metrics.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
    console.log(`Win Rate: ${(results.metrics.winRate * 100).toFixed(2)}%`);
    console.log(`Total Trades: ${results.metrics.totalTrades}`);
    console.log(`Profit Factor: ${results.metrics.profitFactor.toFixed(2)}`);
    
    // Generate equity curve CSV for charting
    const equityCurveFile = path.join(dataDir, 'equity_curve.csv');
    const equityCurveData = ['date,equity'];
    
    results.equityCurve.forEach(point => {
      equityCurveData.push(`${point.timestamp.toISOString()},${point.equity.toFixed(2)}`);
    });
    
    fs.writeFileSync(equityCurveFile, equityCurveData.join('\n'));
    console.log(`\nEquity curve saved to ${equityCurveFile}`);
    
    // Print the last few trades
    console.log('\n--- LAST 5 TRADES ---');
    const lastTrades = results.fills.slice(-5);
    lastTrades.forEach(fill => {
      console.log(
        `${fill.timestamp.toISOString()} | ${fill.side.toUpperCase()} | ${fill.quantity} BTC at $${fill.price.toFixed(2)} | Total: $${(fill.quantity * fill.price).toFixed(2)}`
      );
    });
    
    return results;
  } catch (error) {
    console.error('Error running backtest:', error);
    throw error;
  }
}

// Run the backtest if this file is executed directly
if (require.main === module) {
  console.log('Starting BTC/USD Moving Average Crossover Backtest...');
  runBTCUSDBacktest()
    .then(() => console.log('Backtest completed successfully.'))
    .catch(error => console.error('Backtest failed:', error));
}

// Export for use in other modules
export { runBTCUSDBacktest, BTCUSDMovingAverageCrossoverStrategy }; 