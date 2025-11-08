# Noderr Trading Bot - Backtesting Module

This document provides instructions on how to use the backtesting module of the Noderr Trading Bot. The backtesting system allows you to test trading strategies against historical market data before deploying them to live markets.

## Prerequisites

- Node.js 16+ and npm
- TypeScript 4.9+
- Access to internet (for fetching historical crypto data)

## Installation

1. Clone the repository and install dependencies:
```bash
git clone https://github.com/yourusername/noderr-trading-bot.git
cd noderr-trading-bot
npm install
```

2. Build the project:
```bash
npm run build
```

## Running a Backtest

We've provided a ready-to-use example that backtests a simple trading strategy against Bitcoin price data:

```bash
npm run backtest
```

This command runs the script at `src/backtesting/examples/run_crypto_backtest.ts`, which demonstrates how to:

1. Set up a data source for cryptocurrency data
2. Create a simple trading strategy
3. Configure and run a backtest
4. Analyze and report the results

## Creating Your Own Strategy

To create your own trading strategy, you can extend the `BaseStrategy` class. Here's a simple template:

```typescript
import { BaseStrategy, Bar, BacktestContext, Timeframe } from './src/backtesting';
import { OrderSide, OrderType } from './src/backtesting/models/types';

class MyCustomStrategy extends BaseStrategy {
  constructor() {
    super({
      id: 'my_strategy',
      name: 'My Custom Strategy',
      version: '1.0.0',
      parameters: {
        // Define strategy parameters here
        myParameter: {
          value: 10,
          type: 'number',
          range: [1, 100],
          step: 1,
          description: 'My custom parameter'
        }
      },
      symbols: ['BTC/USD'], // Symbols to trade
      dataRequirements: {
        timeframes: [Timeframe.ONE_DAY] // Timeframes needed
      }
    });
  }

  initialize(context: BacktestContext): void {
    // Initialize strategy with the context
    // Access parameters, set up state, etc.
    context.log('Strategy initialized');
  }

  async onBar(bar: Bar, context: BacktestContext): Promise<void> {
    const { symbol, close } = bar;
    
    // Your strategy logic here
    // Example: Simple condition to buy
    if (someCondition) {
      // Calculate position size
      const cash = context.getCash();
      const positionSize = cash * 0.1; // Use 10% of available capital
      const quantity = positionSize / close;
      
      // Place a buy order
      context.placeOrder({
        symbol,
        type: OrderType.MARKET,
        side: OrderSide.BUY,
        quantity
      });
    }
    
    // Example: Simple condition to sell
    if (otherCondition) {
      const position = context.getPosition(symbol);
      if (position && position.quantity > 0) {
        // Place a sell order for the entire position
        context.placeOrder({
          symbol,
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          quantity: position.quantity
        });
      }
    }
  }
}
```

## Data Sources

The backtesting engine supports multiple data sources:

### Cryptocurrency Exchange Data Source

We've implemented a `CryptoHistoricalDataSource` which uses the CCXT library to fetch historical market data from cryptocurrency exchanges:

```typescript
import { CryptoHistoricalDataSource } from './src/backtesting';

const cryptoDataSource = new CryptoHistoricalDataSource({
  cacheDir: './data/crypto', // Directory for caching data
  exchange: 'binance',       // Exchange to use (default: binance)
  useCache: true,            // Whether to use caching
  apiKey: 'your-api-key',    // Optional API key (for private data)
  apiSecret: 'your-secret'   // Optional API secret
});
```

### CSV Data Source

For local data files, you can use the `CsvDataSource`:

```typescript
import { CsvDataSource } from './src/backtesting';

const csvDataSource = new CsvDataSource({
  dataDir: './data/csv',
  barSubDir: 'bars',          // Subdirectory for OHLCV data
  tickSubDir: 'ticks',        // Subdirectory for tick data
  orderBookSubDir: 'orderbooks' // Subdirectory for order book data
});
```

## Running a Custom Backtest

Here's a complete example of how to run a backtest with a custom strategy:

```typescript
import {
  runBacktest,
  Timeframe,
  CryptoHistoricalDataSource
} from './src/backtesting';
import { MyCustomStrategy } from './my-custom-strategy';

async function runMyBacktest() {
  // Create data source
  const dataSource = new CryptoHistoricalDataSource({
    cacheDir: './data/crypto',
    exchange: 'binance',
    useCache: true
  });
  
  // Create strategy
  const strategy = new MyCustomStrategy();
  
  // Define time range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 1); // 1 year of data
  
  // Run backtest
  const results = await runBacktest({
    startDate,
    endDate,
    initialCapital: 10000, // $10,000 starting capital
    symbols: ['BTC/USD'],
    timeframes: [Timeframe.ONE_DAY],
    commission: 0.001, // 0.1% commission
    slippage: 0.001    // 0.1% slippage
  }, strategy, [dataSource]);
  
  // Print results
  console.log(`Total Return: ${(results.metrics.totalReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`Max Drawdown: ${(results.metrics.maxDrawdown * 100).toFixed(2)}%`);
}

runMyBacktest().catch(console.error);
```

## Performance Metrics

The backtesting engine calculates comprehensive performance metrics for your strategy:

- **Return Metrics**: Total return, annualized return, daily returns
- **Risk Metrics**: Volatility, drawdown, Value-at-Risk (VaR)
- **Risk-Adjusted Metrics**: Sharpe ratio, Sortino ratio, Calmar ratio
- **Trade Metrics**: Number of trades, win rate, profit factor
- **Exposure Metrics**: Time in market, average exposure

## Visualization

The backtesting system generates a CSV file with the equity curve, which you can use to visualize your strategy's performance in Excel, Google Sheets, or any other charting tool.

## Advanced Features

### Parameter Optimization

You can optimize strategy parameters by running multiple backtests with different parameter values:

```typescript
// Example parameter space to explore
const parameterSpace = {
  lookbackPeriod: [10, 15, 20, 25, 30],
  entryThreshold: [0.03, 0.05, 0.07, 0.1]
};

// Run backtests for each parameter combination
for (const lookbackPeriod of parameterSpace.lookbackPeriod) {
  for (const entryThreshold of parameterSpace.entryThreshold) {
    const strategy = new MyCustomStrategy();
    strategy.setParameters({
      lookbackPeriod,
      entryThreshold
    });
    
    const results = await runBacktest(config, strategy, dataSources);
    console.log(`Parameters: lookback=${lookbackPeriod}, threshold=${entryThreshold}`);
    console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
  }
}
```

## Local Development

For local development and testing:

1. Set up a local data directory:
```bash
mkdir -p data/crypto
```

2. Make changes to the strategies or data sources

3. Run the backtest:
```bash
npm run build
npm run backtest
```

## Troubleshooting

- **Data Source Errors**: Check your internet connection or API credentials if you're having trouble fetching data
- **Memory Issues**: For very large backtests, you may need to increase Node.js memory limit:
  ```bash
  node --max-old-space-size=8192 dist/backtesting/examples/run_crypto_backtest.js
  ```
- **Performance**: For faster backtests, use cached data when possible by setting `useCache: true`

## Next Steps

After backtesting, you might want to:

1. Optimize your strategy parameters
2. Run paper trading simulations on live market data
3. Deploy your strategy to a production environment

## License

This software is licensed under the MIT License. 