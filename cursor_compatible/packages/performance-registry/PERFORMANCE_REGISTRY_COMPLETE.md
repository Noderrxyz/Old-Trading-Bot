# 📊 StrategyPerformanceRegistry Implementation

## ✅ Mid-Range Refactor #3 Complete: Evolution Engine Foundation

### Overview

The StrategyPerformanceRegistry is a central system for tracking, analyzing, and comparing strategy performance in real-time. It provides comprehensive metrics calculation, risk analysis, alerting, and reporting capabilities.

### Key Features

#### 1. **Comprehensive Performance Tracking**

Real-time tracking of all critical metrics:

```typescript
interface PerformanceSnapshot {
  // Core performance
  pnl: {
    realized: number;
    unrealized: number;
    total: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
  
  // Risk metrics
  risk: {
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdown: number;
    var95: number;
    volatility: number;
  };
  
  // Trading performance
  trading: {
    winRate: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
  };
}
```

#### 2. **Advanced Risk Metrics**

- **Sharpe Ratio**: Risk-adjusted returns
- **Sortino Ratio**: Downside risk focus
- **Calmar Ratio**: Return vs max drawdown
- **VaR/CVaR**: Value at Risk calculations
- **Volatility**: Annualized with downside tracking
- **Drawdown**: Real-time and historical max

#### 3. **Multi-Strategy Comparison**

Compare strategies head-to-head:

```typescript
const comparison = registry.compareStrategies(
  'momentum-strategy-1',
  'mean-reversion-2'
);

console.log(`PnL Difference: ${comparison.metrics.pnlDiff}`);
console.log(`Sharpe Difference: ${comparison.metrics.sharpeDiff}`);
console.log(`Correlation: ${comparison.metrics.correlation}`);
console.log(`Relative Strength: ${comparison.metrics.relativeStrength}`);
```

#### 4. **Intelligent Alert System**

Automatic alerts for critical events:
- `DRAWDOWN_BREACH`: Exceeds max drawdown threshold
- `SHARPE_DECLINE`: Performance degradation
- `LOSS_STREAK`: Consecutive losing trades
- `VOLATILITY_SPIKE`: Risk increase
- `RISK_LIMIT_BREACH`: Position limits exceeded

#### 5. **Performance Reports**

Generate comprehensive reports:

```typescript
const report = registry.generateReport(
  'strategy-id',
  ReportType.MONTHLY
);

// Report includes:
// - Summary metrics
// - Time series data
// - PnL attribution
// - Risk analysis
```

### Architecture

```
Strategies → TradeRecords/PositionUpdates → PerformanceRegistry
                                                    ↓
                                            PerformanceSnapshots
                                                    ↓
                                        Metrics/Alerts/Reports
```

### Usage Example

```typescript
// Initialize registry
const registry = StrategyPerformanceRegistry.getInstance({
  calculation: {
    updateInterval: 60000, // 1 minute
    riskFreeRate: 0.02,   // 2% annual
    tradingDaysPerYear: 252
  },
  monitoring: {
    enableAlerts: true,
    alertThresholds: {
      maxDrawdown: 0.2,    // 20%
      minSharpe: 0.5,
      maxLossStreak: 5,
      maxVolatility: 0.3   // 30% annual
    }
  }
});

// Register strategy
registry.registerStrategy({
  strategyId: 'momentum-1',
  name: 'Momentum Alpha',
  type: StrategyType.MOMENTUM,
  allocatedCapital: 1000000,
  riskLimit: 2000000,
  targetSharpe: 1.5,
  targetReturn: 0.15,
  status: StrategyStatus.LIVE_TRADING,
  startedAt: Date.now()
});

// Record trades
registry.recordTrade({
  id: 'trade-123',
  strategyId: 'momentum-1',
  symbol: 'BTC-USD',
  side: 'BUY',
  quantity: 1.5,
  price: 50000,
  fees: 75,
  slippage: 0.001,
  pnl: 2500,
  timestamp: Date.now()
});

// Update positions
registry.updatePosition({
  strategyId: 'momentum-1',
  symbol: 'BTC-USD',
  quantity: 1.5,
  avgPrice: 50000,
  currentPrice: 51000,
  unrealizedPnl: 1500,
  realizedPnl: 0,
  timestamp: Date.now()
});

// Query performance
const snapshots = await registry.queryPerformance({
  strategyIds: ['momentum-1'],
  startTime: Date.now() - 86400000, // Last 24h
  metrics: ['pnl.total', 'risk.sharpeRatio'],
  sortBy: 'pnl.total',
  limit: 100
});

// Listen for alerts
registry.on('performance-alert', (alert) => {
  console.log(`ALERT: ${alert.type} - ${alert.message}`);
  console.log(`Strategy: ${alert.strategyId}`);
  console.log(`Metric: ${alert.metric} = ${alert.currentValue}`);
  console.log(`Threshold: ${alert.threshold}`);
});
```

### Telemetry Events

Comprehensive telemetry for monitoring:
- `telemetry:performance` - Performance snapshots
- `telemetry:alert` - Alert occurrences
- `strategy-registered` - New strategy added
- `trade-recorded` - Trade execution tracked
- `position-updated` - Position changes
- `report-generated` - Report creation

### Performance Calculations

#### Sharpe Ratio
```
Sharpe = (Annual Return - Risk Free Rate) / Annual Volatility
```

#### Sortino Ratio
```
Sortino = (Annual Return - Risk Free Rate) / Downside Volatility
```

#### Profit Factor
```
Profit Factor = Total Wins / Total Losses
```

#### Win Rate
```
Win Rate = Winning Trades / Total Trades
```

### Alert Thresholds

Default thresholds (configurable):
- **Max Drawdown**: 20%
- **Min Sharpe**: 0.5
- **Max Loss Streak**: 5 trades
- **Max Volatility**: 30% annualized

### Data Retention

- **In-Memory**: 90 days default
- **Snapshots**: 1000 max per strategy
- **Cleanup**: Automatic based on retention policy

### Integration Points

The registry integrates with:
- **AlphaOrchestrator**: Record strategy signal performance
- **UnifiedCapitalManager**: Track capital allocation efficiency
- **ExecutionOptimizer**: Monitor execution quality
- **AI Core**: Feed performance data for evolution

### Export Options

1. **Prometheus Metrics**
   ```
   noderr_strategy_pnl_total{strategy="momentum-1"} 25000
   noderr_strategy_sharpe_ratio{strategy="momentum-1"} 1.45
   noderr_strategy_win_rate{strategy="momentum-1"} 0.65
   ```

2. **REST API** (when enabled)
   ```
   GET /api/strategies/{id}/performance
   GET /api/strategies/{id}/report?type=monthly
   POST /api/strategies/compare
   ```

3. **CSV Export** (when enabled)
   - Daily performance snapshots
   - Configurable via cron expression

### Benefits

1. **Complete Visibility**: Every aspect of strategy performance tracked
2. **Early Warning System**: Alerts before problems become critical
3. **Data-Driven Decisions**: Compare and optimize strategies
4. **Evolution Ready**: Performance data feeds AI optimization
5. **Audit Trail**: Complete history for compliance

### Result

The StrategyPerformanceRegistry provides the **foundation for strategy evolution** by tracking every metric needed to understand, compare, and optimize trading strategies. This data becomes the fuel for the AI Core's evolution engine, enabling automatic strategy improvement over time. 