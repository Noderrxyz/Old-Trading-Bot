/**
 * Simple script to run a cryptocurrency backtest
 * 
 * This demonstrates how to use the backtesting engine with real market data
 * from cryptocurrency exchanges.
 */

import path from 'path';
import fs from 'fs';
import { 
  BacktestContext,
  CryptoHistoricalDataSource, 
  Timeframe, 
  BaseStrategy,
  Bar
} from '../index';
import { OrderSide, OrderType } from '../models/types';

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', '..', '..', 'data', 'crypto');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Simple Bitcoin Strategy
 * 
 * - Buy when price increases by 5% from recent low
 * - Sell when price drops by 5% from recent high
 */
class SimpleBitcoinStrategy extends BaseStrategy {
  private recentLow: Record<string, number> = {};
  private recentHigh: Record<string, number> = {};
  private lookbackPeriod = 14; // days
  private entryThreshold = 0.05; // 5%
  private exitThreshold = 0.05; // 5%
  private positionSize = 0.25; // 25% of account
  
  constructor() {
    super({
      id: 'simple_btc_strategy',
      name: 'Simple Bitcoin Strategy',
      version: '1.0.0',
      parameters: {
        lookbackPeriod: {
          value: 14,
          type: 'number',
          range: [5, 30],
          step: 1,
          description: 'Lookback period for finding recent high/low'
        },
        entryThreshold: {
          value: 0.05,
          type: 'number',
          range: [0.01, 0.20],
          step: 0.01,
          description: 'Entry threshold (percentage from low)'
        },
        exitThreshold: {
          value: 0.05,
          type: 'number', 
          range: [0.01, 0.20],
          step: 0.01,
          description: 'Exit threshold (percentage from high)'
        },
        positionSize: {
          value: 0.25,
          type: 'number',
          range: [0.1, 1.0],
          step: 0.05,
          description: 'Position size as fraction of account'
        }
      },
      symbols: ['BTC/USD'],
      dataRequirements: {
        timeframes: [Timeframe.ONE_DAY]
      }
    });
  }
  
  initialize(context: BacktestContext): void {
    const params = context.getParameters();
    
    if (params.has('lookbackPeriod')) {
      this.lookbackPeriod = params.get('lookbackPeriod');
    }
    
    if (params.has('entryThreshold')) {
      this.entryThreshold = params.get('entryThreshold');
    }
    
    if (params.has('exitThreshold')) {
      this.exitThreshold = params.get('exitThreshold');
    }
    
    if (params.has('positionSize')) {
      this.positionSize = params.get('positionSize');
    }
    
    context.log(`Initialized with lookbackPeriod=${this.lookbackPeriod}, entryThreshold=${this.entryThreshold}, exitThreshold=${this.exitThreshold}, positionSize=${this.positionSize}`);
  }
  
  async onBar(bar: Bar, context: BacktestContext): Promise<void> {
    const { symbol, close } = bar;
    
    // Get the last N bars for analysis
    const historicalBars = await context.getHistoricalBars(symbol, Timeframe.ONE_DAY, this.lookbackPeriod);
    
    // Need enough history for analysis
    if (historicalBars.length < this.lookbackPeriod) {
      return;
    }
    
    // Find recent low and high
    let low = Infinity;
    let high = -Infinity;
    
    for (const histBar of historicalBars) {
      if (histBar.low < low) {
        low = histBar.low;
      }
      
      if (histBar.high > high) {
        high = histBar.high;
      }
    }
    
    // Store for this symbol
    this.recentLow[symbol] = low;
    this.recentHigh[symbol] = high;
    
    // Check for entry signal
    const buySignal = close > low * (1 + this.entryThreshold);
    
    // Check for exit signal
    const sellSignal = close < high * (1 - this.exitThreshold);
    
    // Get current position
    const position = context.getPosition(symbol);
    
    // No position and we have a buy signal
    if (!position && buySignal) {
      // Calculate position size
      const cash = context.getCash();
      const positionValue = cash * this.positionSize;
      const quantity = positionValue / close;
      
      context.log(`BUY SIGNAL: Price ${close} is ${(close/low-1)*100}% above recent low ${low}`);
      
      // Place buy order
      context.placeOrder({
        symbol,
        type: OrderType.MARKET,
        side: OrderSide.BUY,
        quantity
      });
    }
    // Have a position and we have a sell signal
    else if (position && position.quantity > 0 && sellSignal) {
      context.log(`SELL SIGNAL: Price ${close} is ${(1-close/high)*100}% below recent high ${high}`);
      
      // Place sell order for entire position
      context.placeOrder({
        symbol,
        type: OrderType.MARKET,
        side: OrderSide.SELL,
        quantity: position.quantity
      });
    }
  }
}

/**
 * Run the backtest
 */
async function runBacktest() {
  try {
    console.log('Setting up cryptocurrency data source...');
    
    // Create data source
    const cryptoDataSource = new CryptoHistoricalDataSource({
      cacheDir: dataDir,
      exchange: 'binance',
      useCache: true
    });
    
    // Create strategy
    const strategy = new SimpleBitcoinStrategy();
    
    // Define time range - past year
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1);
    
    console.log(`Running backtest from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Import the runBacktest function
    const { runBacktest } = require('../index');
    
    // Run the backtest
    const results = await runBacktest({
      startDate,
      endDate,
      initialCapital: 10000, // $10,000
      symbols: ['BTC/USD'],
      timeframes: [Timeframe.ONE_DAY],
      commission: 0.001, // 0.1%
      slippage: 0.001 // 0.1%
    }, strategy, [cryptoDataSource]);
    
    // Print results
    console.log('\n--- BACKTEST RESULTS ---');
    console.log(`Total Return: ${(results.metrics.totalReturn * 100).toFixed(2)}%`);
    console.log(`Annualized Return: ${(results.metrics.annualizedReturn * 100).toFixed(2)}%`);
    console.log(`Max Drawdown: ${(results.metrics.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
    console.log(`Win Rate: ${(results.metrics.winRate * 100).toFixed(2)}%`);
    console.log(`Total Trades: ${results.metrics.totalTrades}`);
    
    // Save equity curve to CSV for charting
    const equityCurveFile = path.join(dataDir, 'equity_curve.csv');
    const csv = ['date,equity'];
    
    results.equityCurve.forEach((point: { timestamp: Date; equity: number }) => {
      csv.push(`${point.timestamp.toISOString()},${point.equity}`);
    });
    
    fs.writeFileSync(equityCurveFile, csv.join('\n'));
    console.log(`Equity curve saved to ${equityCurveFile}`);
    
    return results;
  } catch (error) {
    console.error('Error running backtest:', error);
    throw error;
  }
}

// Run the backtest if this file is executed directly
if (require.main === module) {
  console.log('Starting Bitcoin backtest...');
  runBacktest()
    .then(() => console.log('Backtest completed successfully'))
    .catch(error => console.error('Backtest failed:', error));
}

export { runBacktest, SimpleBitcoinStrategy }; 