# Noderr Backtesting & Simulation Engine

A powerful and flexible backtesting engine for developing, testing, and optimizing trading strategies.

## Features

- **High-performance** simulation engine capable of processing millions of price ticks per second
- **Multiple data sources** support (CSV, API, databases)
- **Realistic market simulation** with support for:
  - Slippage modeling
  - Commission modeling
  - Liquidity constraints
  - Market impact
  - Multi-asset correlation
- **Advanced order types** (market, limit, stop, stop-limit, trailing stop)
- **Comprehensive performance metrics** for strategy evaluation
- **Parameter optimization** capabilities
- **Walk-forward analysis** for testing strategy robustness
- **Event-driven architecture** for high-fidelity simulation

## Getting Started

### Installation

The backtesting engine is part of the Noderr trading platform. To use it, first ensure you have the Noderr package installed:

```bash
npm install noderr
```

### Basic Usage

Here's a simple example demonstrating how to use the backtesting engine:

```typescript
import { 
  CsvDataSource, 
  MovingAverageCrossoverStrategy, 
  runBacktest, 
  Timeframe 
} from 'noderr/backtesting';
import path from 'path';

async function runSimpleBacktest() {
  // Set up data source
  const dataDir = path.join(__dirname, 'data');
  const csvDataSource = new CsvDataSource({ dataDir });
  
  // Create strategy
  const strategy = new MovingAverageCrossoverStrategy();
  
  // Configure simulation
  const config = {
    startDate: new Date('2020-01-01'),
    endDate: new Date('2020-12-31'),
    initialCapital: 10000,
    symbols: ['BTC/USD'],
    timeframes: [Timeframe.ONE_DAY],
    commission: 0.001, // 0.1%
    slippage: 0.001    // 0.1%
  };
  
  // Run backtest
  const results = await runBacktest(config, strategy, [csvDataSource]);
  
  // Print results
  console.log(`Total Return: ${(results.metrics.totalReturn * 100).toFixed(2)}%`);
  console.log(`Max Drawdown: ${(results.metrics.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
}

runSimpleBacktest();
```

## Creating Your Own Strategy

To create your own strategy, extend the `BaseStrategy` class and implement the required methods:

```typescript
import { Bar, BaseStrategy, BacktestContext, StrategyConfig, OrderType, OrderSide } from 'noderr/backtesting';

export class MyCustomStrategy extends BaseStrategy {
  private parameter1: number;
  
  constructor() {
    // Define strategy configuration
    const config: StrategyConfig = {
      id: 'my_strategy',
      name: 'My Custom Strategy',
      version: '1.0.0',
      parameters: {
        parameter1: {
          value: 10,
          type: 'number',
          range: [1, 100],
          step: 1,
          description: 'My parameter'
        }
      },
      symbols: ['BTC/USD'],
      dataRequirements: {
        timeframes: [Timeframe.ONE_DAY]
      }
    };
    
    super(config);
    this.parameter1 = config.parameters.parameter1.value;
  }
  
  initialize(context: BacktestContext): void {
    // Get parameters from context
    const params = context.getParameters();
    if (params.has('parameter1')) {
      this.parameter1 = params.get('parameter1');
    }
    
    context.log(`Initialized with parameter1=${this.parameter1}`);
  }
  
  onBar(bar: Bar, context: BacktestContext): void {
    // Your strategy logic here
    const { symbol, close } = bar;
    
    // Example: Buy when price is above parameter1
    if (close > this.parameter1) {
      context.placeOrder({
        symbol,
        type: OrderType.MARKET,
        side: OrderSide.BUY,
        quantity: 1
      });
    }
  }
}
```

## Data Sources

The backtesting engine supports multiple data sources. Here's how to use them:

### CSV Data Source

```typescript
import { CsvDataSource } from 'noderr/backtesting';

const csvDataSource = new CsvDataSource({
  dataDir: '/path/to/data',
  barSubDir: 'bars',            // Subdirectory for OHLCV data
  tickSubDir: 'ticks',          // Subdirectory for tick data
  orderBookSubDir: 'orderbooks', // Subdirectory for order book data
  
  // Column mapping for CSV files
  barColumns: {
    timestamp: 'date',   // Column name or index
    open: 'open',
    high: 'high',
    low: 'low',
    close: 'close',
    volume: 'volume'
  }
});
```

### Custom Data Source

You can create your own data source by implementing the `DataSource` interface:

```typescript
import { DataSource, Bar, Tick, OrderBook, Timeframe } from 'noderr/backtesting';

export class MyDataSource implements DataSource {
  getId(): string {
    return 'my_data_source';
  }
  
  getDescription(): string {
    return 'My Custom Data Source';
  }
  
  supportsBars(): boolean {
    return true;
  }
  
  supportsTicks(): boolean {
    return false;
  }
  
  supportsOrderBook(): boolean {
    return false;
  }
  
  async getBars(symbol: string, timeframe: Timeframe, start: Date, end: Date): Promise<Bar[]> {
    // Implement your logic to fetch bar data
    return [];
  }
  
  async getTicks(symbol: string, start: Date, end: Date): Promise<Tick[]> {
    throw new Error('Ticks not supported');
  }
  
  async getOrderBooks(symbol: string, start: Date, end: Date): Promise<OrderBook[]> {
    throw new Error('Order books not supported');
  }
  
  async getAvailableSymbols(): Promise<string[]> {
    return ['BTC/USD', 'ETH/USD'];
  }
  
  async getTimeRange(symbol: string): Promise<{ start: Date; end: Date }> {
    return {
      start: new Date('2020-01-01'),
      end: new Date('2020-12-31')
    };
  }
}
```

## Performance Metrics

The backtesting engine calculates comprehensive performance metrics:

- **Return Metrics**: Total return, annualized return, daily returns
- **Risk Metrics**: Volatility, downside deviation, max drawdown, VaR, CVaR
- **Risk-Adjusted Metrics**: Sharpe ratio, Sortino ratio, Calmar ratio
- **Trade Metrics**: Win rate, profit factor, average trade, etc.
- **Exposure Metrics**: Average exposure, time in market
- **Drawdown Profile**: Detailed drawdown analysis

To access these metrics:

```typescript
const results = await runBacktest(config, strategy, dataSources);

// Print key metrics
console.log(`Total Return: ${(results.metrics.totalReturn * 100).toFixed(2)}%`);
console.log(`Annualized Return: ${(results.metrics.annualizedReturn * 100).toFixed(2)}%`);
console.log(`Max Drawdown: ${(results.metrics.maxDrawdown * 100).toFixed(2)}%`);
console.log(`Sharpe Ratio: ${results.metrics.sharpeRatio.toFixed(2)}`);
```

## Advanced Features

### Parameter Optimization

```typescript
import { runParameterOptimization } from 'noderr/backtesting';

// Define parameter space
const parameterSpace = {
  fastPeriod: [5, 10, 15, 20],
  slowPeriod: [20, 30, 40, 50]
};

// Run optimization
const optimizationResults = await runParameterOptimization({
  config,
  strategy,
  dataSources,
  parameterSpace,
  targetMetric: 'sharpeRatio',
  maximizeMetric: true
});

console.log('Best parameters:', optimizationResults.bestParameters);
console.log('Best Sharpe ratio:', optimizationResults.bestMetricValue);
```

### Walk-Forward Analysis

```typescript
import { runWalkForwardAnalysis } from 'noderr/backtesting';

const walkForwardResults = await runWalkForwardAnalysis({
  config,
  strategy,
  dataSources,
  parameterSpace,
  inSamplePeriod: 90, // days
  outOfSamplePeriod: 30, // days
  targetMetric: 'sharpeRatio',
  maximizeMetric: true
});

console.log('Walk-forward results:', walkForwardResults);
```

## API Reference

For a complete API reference, please see the [API documentation](docs/api.md).

## License

This software is licensed under the [MIT License](LICENSE). 