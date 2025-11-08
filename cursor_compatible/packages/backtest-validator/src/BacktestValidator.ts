import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface BacktestScenario {
  id: string;
  name: string;
  description: string;
  period: {
    start: Date;
    end: Date;
  };
  marketCondition: 'crash' | 'bull' | 'bear' | 'volatile' | 'sideways';
  expectedEvents: string[];
  priceData?: any; // Historical price data
}

interface StrategyConfig {
  id: string;
  name: string;
  version: string;
  parameters: any;
  riskLimits: {
    maxDrawdown: number;
    maxPositionSize: number;
    stopLoss: number;
  };
}

interface BacktestResult {
  scenarioId: string;
  strategyId: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: PerformanceMetrics;
  trades: TradeRecord[];
  circuitBreakerActivations: CircuitBreakerEvent[];
  passed: boolean;
  warnings: string[];
  errors: string[];
}

interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number; // days
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  avgTradeHoldTime: number; // hours
  calmarRatio: number;
  var95: number;
  cvar95: number;
  latencyP50: number;
  latencyP99: number;
}

interface TradeRecord {
  id: string;
  timestamp: Date;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  pnl?: number;
  holdTime?: number;
  exitReason?: string;
}

interface CircuitBreakerEvent {
  timestamp: Date;
  type: 'dailyLoss' | 'volatility' | 'drawdown' | 'consecutive';
  value: number;
  threshold: number;
  duration: number;
  recovered: boolean;
}

interface ValidationReport {
  timestamp: Date;
  strategiesValidated: number;
  scenariosRun: number;
  overallPassRate: number;
  criticalFailures: string[];
  recommendations: string[];
  detailedResults: BacktestResult[];
}

export class BacktestValidator extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private scenarios: BacktestScenario[];
  private results: BacktestResult[] = [];
  private isRunning: boolean = false;
  
  constructor() {
    super();
    this.logger = createLogger('BacktestValidator');
    this.scenarios = this.initializeScenarios();
  }
  
  private initializeScenarios(): BacktestScenario[] {
    return [
      {
        id: 'covid_crash_2020',
        name: '2020 COVID Crash',
        description: 'March 2020 market crash and subsequent recovery',
        period: {
          start: new Date('2020-02-01'),
          end: new Date('2020-05-01')
        },
        marketCondition: 'crash',
        expectedEvents: [
          'circuit_breaker_triggered',
          'high_volatility',
          'liquidity_crisis',
          'rapid_recovery'
        ]
      },
      {
        id: 'bull_run_2021',
        name: '2021 Bull Market',
        description: 'Crypto bull run with extreme gains',
        period: {
          start: new Date('2021-01-01'),
          end: new Date('2021-11-01')
        },
        marketCondition: 'bull',
        expectedEvents: [
          'sustained_uptrend',
          'low_volatility_periods',
          'fomo_indicators',
          'leverage_buildup'
        ]
      },
      {
        id: 'bear_market_2022',
        name: '2022 Bear Market',
        description: 'Terra/Luna collapse and FTX bankruptcy',
        period: {
          start: new Date('2022-04-01'),
          end: new Date('2022-12-01')
        },
        marketCondition: 'bear',
        expectedEvents: [
          'cascading_liquidations',
          'contagion_effects',
          'extreme_fear',
          'capitulation'
        ]
      },
      {
        id: 'high_volatility_2023',
        name: 'Recent High Volatility',
        description: 'Banking crisis and regulatory uncertainty',
        period: {
          start: new Date('2023-03-01'),
          end: new Date('2023-06-01')
        },
        marketCondition: 'volatile',
        expectedEvents: [
          'whipsaw_movements',
          'false_breakouts',
          'correlation_breakdown',
          'regime_changes'
        ]
      },
      {
        id: 'flash_crash_sim',
        name: 'Simulated Flash Crash',
        description: 'Extreme 10% drop in 5 minutes',
        period: {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-02')
        },
        marketCondition: 'crash',
        expectedEvents: [
          'immediate_circuit_breaker',
          'order_book_collapse',
          'spread_widening',
          'recovery_attempt'
        ]
      }
    ];
  }
  
  public async validateStrategy(
    strategy: StrategyConfig,
    scenarios?: string[]
  ): Promise<BacktestResult[]> {
    this.logger.info('Starting strategy validation', {
      strategy: strategy.name,
      version: strategy.version,
      scenarios: scenarios?.length || 'all'
    });
    
    const scenariosToRun = scenarios 
      ? this.scenarios.filter(s => scenarios.includes(s.id))
      : this.scenarios;
    
    const results: BacktestResult[] = [];
    
    for (const scenario of scenariosToRun) {
      try {
        const result = await this.runBacktest(strategy, scenario);
        results.push(result);
        
        this.emit('scenario-complete', {
          strategy: strategy.id,
          scenario: scenario.id,
          passed: result.passed
        });
        
      } catch (error) {
        this.logger.error(`Failed to run scenario ${scenario.id}`, error);
        
        results.push({
          scenarioId: scenario.id,
          strategyId: strategy.id,
          period: scenario.period,
          metrics: this.getEmptyMetrics(),
          trades: [],
          circuitBreakerActivations: [],
          passed: false,
          warnings: [],
          errors: [(error as Error).message]
        });
      }
    }
    
    return results;
  }
  
  private async runBacktest(
    strategy: StrategyConfig,
    scenario: BacktestScenario
  ): Promise<BacktestResult> {
    this.logger.info(`Running backtest: ${strategy.name} on ${scenario.name}`);
    
    // Load historical data
    const historicalData = await this.loadHistoricalData(scenario);
    
    // Initialize backtest engine
    const engine = this.createBacktestEngine(strategy, scenario);
    
    // Run simulation
    const trades: TradeRecord[] = [];
    const circuitBreakers: CircuitBreakerEvent[] = [];
    const warnings: string[] = [];
    
    // Simulate trading
    for (const dataPoint of historicalData) {
      try {
        // Update market state
        engine.updateMarket(dataPoint);
        
        // Check circuit breakers
        const cbEvent = this.checkCircuitBreakers(engine, strategy.riskLimits);
        if (cbEvent) {
          circuitBreakers.push(cbEvent);
          continue; // Skip trading when circuit breaker active
        }
        
        // Generate signals
        const signal = await engine.generateSignal(dataPoint);
        
        // Execute trades
        if (signal) {
          const trade = await engine.executeTrade(signal);
          if (trade) {
            trades.push(trade);
          }
        }
        
        // Update positions
        engine.updatePositions(dataPoint.price);
        
      } catch (error) {
        this.logger.error('Error during backtest step', error);
        warnings.push((error as Error).message);
      }
    }
    
    // Calculate final metrics
    const metrics = this.calculateMetrics(trades, historicalData, strategy);
    
    // Validate results
    const passed = this.validateResults(metrics, scenario, circuitBreakers);
    
    // Generate warnings
    if (metrics.maxDrawdown > 0.15) {
      warnings.push(`High drawdown detected: ${(metrics.maxDrawdown * 100).toFixed(2)}%`);
    }
    
    if (metrics.sharpeRatio < 0.5) {
      warnings.push(`Low Sharpe ratio: ${metrics.sharpeRatio.toFixed(2)}`);
    }
    
    if (circuitBreakers.length > 5) {
      warnings.push(`Excessive circuit breaker activations: ${circuitBreakers.length}`);
    }
    
    return {
      scenarioId: scenario.id,
      strategyId: strategy.id,
      period: scenario.period,
      metrics,
      trades,
      circuitBreakerActivations: circuitBreakers,
      passed,
      warnings,
      errors: []
    };
  }
  
  private async loadHistoricalData(scenario: BacktestScenario): Promise<any[]> {
    // In production, would load actual historical data
    // Mock implementation generates synthetic data based on scenario
    
    const data: any[] = [];
    const days = Math.floor((scenario.period.end.getTime() - scenario.period.start.getTime()) / 86400000);
    
    let price = 50000; // Starting BTC price
    let volatility = 0.02;
    
    // Adjust parameters based on market condition
    switch (scenario.marketCondition) {
      case 'crash':
        volatility = 0.10;
        break;
      case 'bull':
        volatility = 0.03;
        break;
      case 'bear':
        volatility = 0.05;
        break;
      case 'volatile':
        volatility = 0.08;
        break;
    }
    
    for (let i = 0; i < days * 24; i++) { // Hourly data
      const timestamp = new Date(scenario.period.start.getTime() + i * 3600000);
      
      // Generate price movement
      let change = (Math.random() - 0.5) * volatility;
      
      // Add trend based on market condition
      if (scenario.marketCondition === 'bull') {
        change += 0.001; // Positive bias
      } else if (scenario.marketCondition === 'bear') {
        change -= 0.001; // Negative bias
      } else if (scenario.marketCondition === 'crash' && i < 48) {
        change -= 0.02; // Sharp drop
      }
      
      price *= (1 + change);
      
      data.push({
        timestamp,
        price,
        volume: 1000000 + Math.random() * 9000000,
        high: price * (1 + Math.random() * 0.01),
        low: price * (1 - Math.random() * 0.01),
        open: price * (1 + (Math.random() - 0.5) * 0.005),
        volatility: this.calculateRealizedVolatility(data.slice(-24))
      });
    }
    
    return data;
  }
  
  private createBacktestEngine(strategy: StrategyConfig, scenario: BacktestScenario): any {
    // Mock backtest engine
    let position = 0;
    let cash = 1000000; // $1M starting capital
    let equity = cash;
    let maxEquity = equity;
    
    return {
      updateMarket: (data: any) => {
        // Update equity based on position
        equity = cash + position * data.price;
        maxEquity = Math.max(maxEquity, equity);
      },
      
      generateSignal: async (data: any) => {
        // Simple momentum strategy for demo
        const momentum = Math.random() - 0.5;
        
        if (momentum > 0.2 && position <= 0) {
          return { side: 'buy', size: 0.1 };
        } else if (momentum < -0.2 && position >= 0) {
          return { side: 'sell', size: 0.1 };
        }
        
        return null;
      },
      
      executeTrade: async (signal: any) => {
        const trade: TradeRecord = {
          id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          symbol: 'BTC-USD',
          side: signal.side,
          size: signal.size,
          price: 50000 + Math.random() * 1000,
          holdTime: 0
        };
        
        if (signal.side === 'buy') {
          position += signal.size;
          cash -= signal.size * trade.price;
        } else {
          position -= signal.size;
          cash += signal.size * trade.price;
        }
        
        return trade;
      },
      
      updatePositions: (currentPrice: number) => {
        // Update unrealized P&L
      },
      
      getDrawdown: () => {
        return (maxEquity - equity) / maxEquity;
      },
      
      getEquity: () => equity
    };
  }
  
  private checkCircuitBreakers(
    engine: any,
    riskLimits: StrategyConfig['riskLimits']
  ): CircuitBreakerEvent | null {
    const drawdown = engine.getDrawdown();
    
    if (drawdown > riskLimits.maxDrawdown) {
      return {
        timestamp: new Date(),
        type: 'drawdown',
        value: drawdown,
        threshold: riskLimits.maxDrawdown,
        duration: 0,
        recovered: false
      };
    }
    
    return null;
  }
  
  private calculateMetrics(
    trades: TradeRecord[],
    historicalData: any[],
    strategy: StrategyConfig
  ): PerformanceMetrics {
    // Calculate P&L for each trade
    const tradesWithPnL = this.calculateTradePnL(trades);
    
    // Basic metrics
    const totalTrades = trades.length;
    const winningTrades = tradesWithPnL.filter(t => (t.pnl || 0) > 0);
    const losingTrades = tradesWithPnL.filter(t => (t.pnl || 0) < 0);
    
    const totalPnL = tradesWithPnL.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const initialCapital = 1000000;
    const finalCapital = initialCapital + totalPnL;
    
    // Performance metrics
    const totalReturn = (finalCapital - initialCapital) / initialCapital;
    const days = historicalData.length / 24;
    const annualizedReturn = Math.pow(1 + totalReturn, 365 / days) - 1;
    
    // Risk metrics
    const returns = this.calculateDailyReturns(tradesWithPnL, historicalData);
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    
    // Trade statistics
    const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;
    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length 
      : 0;
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
      : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
    
    // Latency (mock)
    const latencies = trades.map(() => 50 + Math.random() * 150);
    latencies.sort((a, b) => a - b);
    
    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      maxDrawdownDuration: this.calculateDrawdownDuration(returns),
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      totalTrades,
      avgTradeHoldTime: 24, // Mock 24 hours average
      calmarRatio: maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0,
      var95: this.calculateVaR(returns, 0.95),
      cvar95: this.calculateCVaR(returns, 0.95),
      latencyP50: latencies[Math.floor(latencies.length * 0.5)],
      latencyP99: latencies[Math.floor(latencies.length * 0.99)]
    };
  }
  
  private calculateTradePnL(trades: TradeRecord[]): TradeRecord[] {
    // Simple P&L calculation - in production would match entry/exit trades
    let lastBuyPrice = 0;
    
    return trades.map(trade => {
      let pnl = 0;
      
      if (trade.side === 'buy') {
        lastBuyPrice = trade.price;
      } else if (trade.side === 'sell' && lastBuyPrice > 0) {
        pnl = (trade.price - lastBuyPrice) * trade.size;
      }
      
      return { ...trade, pnl };
    });
  }
  
  private calculateDailyReturns(trades: TradeRecord[], historicalData: any[]): number[] {
    // Simplified daily returns calculation
    const dailyPnL: { [key: string]: number } = {};
    
    trades.forEach(trade => {
      const dateKey = trade.timestamp.toISOString().split('T')[0];
      dailyPnL[dateKey] = (dailyPnL[dateKey] || 0) + (trade.pnl || 0);
    });
    
    const returns = Object.values(dailyPnL).map(pnl => pnl / 1000000); // As percentage of $1M
    
    return returns;
  }
  
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    
    const riskFreeRate = 0.02 / 365; // 2% annual risk-free rate
    const annualizedSharpe = stdDev > 0 ? (avgReturn - riskFreeRate) / stdDev * Math.sqrt(365) : 0;
    
    return annualizedSharpe;
  }
  
  private calculateSortinoRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const downside = returns.filter(r => r < 0);
    
    if (downside.length === 0) return 10; // Max sortino if no downside
    
    const downsideDeviation = Math.sqrt(
      downside.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downside.length
    );
    
    const riskFreeRate = 0.02 / 365;
    const annualizedSortino = downsideDeviation > 0 
      ? (avgReturn - riskFreeRate) / downsideDeviation * Math.sqrt(365) 
      : 0;
    
    return annualizedSortino;
  }
  
  private calculateMaxDrawdown(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    let peak = 1;
    let maxDD = 0;
    let equity = 1;
    
    for (const ret of returns) {
      equity *= (1 + ret);
      if (equity > peak) {
        peak = equity;
      }
      const dd = (peak - equity) / peak;
      if (dd > maxDD) {
        maxDD = dd;
      }
    }
    
    return maxDD;
  }
  
  private calculateDrawdownDuration(returns: number[]): number {
    // Calculate longest drawdown period in days
    let maxDuration = 0;
    let currentDuration = 0;
    let peak = 1;
    let equity = 1;
    
    for (const ret of returns) {
      equity *= (1 + ret);
      if (equity >= peak) {
        peak = equity;
        maxDuration = Math.max(maxDuration, currentDuration);
        currentDuration = 0;
      } else {
        currentDuration++;
      }
    }
    
    return Math.max(maxDuration, currentDuration);
  }
  
  private calculateVaR(returns: number[], confidence: number): number {
    if (returns.length === 0) return 0;
    
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    
    return Math.abs(sorted[index] || 0);
  }
  
  private calculateCVaR(returns: number[], confidence: number): number {
    if (returns.length === 0) return 0;
    
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    const tailReturns = sorted.slice(0, index + 1);
    
    if (tailReturns.length === 0) return 0;
    
    const avgTailLoss = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;
    
    return Math.abs(avgTailLoss);
  }
  
  private calculateRealizedVolatility(data: any[]): number {
    if (data.length < 2) return 0;
    
    const returns: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const ret = Math.log(data[i].price / data[i-1].price);
      returns.push(ret);
    }
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance * 365 * 24); // Annualized hourly volatility
  }
  
  private validateResults(
    metrics: PerformanceMetrics,
    scenario: BacktestScenario,
    circuitBreakers: CircuitBreakerEvent[]
  ): boolean {
    // Validation criteria
    const checks: boolean[] = [];
    
    // General criteria
    checks.push(metrics.maxDrawdown < 0.25); // Max 25% drawdown
    checks.push(metrics.sharpeRatio > 0); // Positive risk-adjusted returns
    
    // Scenario-specific criteria
    switch (scenario.marketCondition) {
      case 'crash':
        checks.push(circuitBreakers.length > 0); // Should trigger circuit breakers
        checks.push(metrics.maxDrawdown < 0.30); // Survive crash with <30% DD
        break;
        
      case 'bull':
        checks.push(metrics.totalReturn > 0); // Should be profitable in bull market
        checks.push(metrics.winRate > 0.4); // Decent win rate
        break;
        
      case 'bear':
        checks.push(metrics.maxDrawdown < 0.20); // Tighter risk control in bear
        checks.push(metrics.sortinoRatio > -1); // Limited downside
        break;
        
      case 'volatile':
        checks.push(metrics.profitFactor > 1); // Profitable despite volatility
        checks.push(metrics.latencyP99 < 200); // Fast execution crucial
        break;
    }
    
    return checks.every(check => check);
  }
  
  private getEmptyMetrics(): PerformanceMetrics {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      winRate: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      totalTrades: 0,
      avgTradeHoldTime: 0,
      calmarRatio: 0,
      var95: 0,
      cvar95: 0,
      latencyP50: 0,
      latencyP99: 0
    };
  }
  
  public async validateAllStrategies(strategies: StrategyConfig[]): Promise<ValidationReport> {
    this.logger.info('Starting comprehensive strategy validation', {
      strategies: strategies.length,
      scenarios: this.scenarios.length
    });
    
    this.isRunning = true;
    const startTime = Date.now();
    const allResults: BacktestResult[] = [];
    
    for (const strategy of strategies) {
      const results = await this.validateStrategy(strategy);
      allResults.push(...results);
      
      this.emit('strategy-complete', {
        strategy: strategy.id,
        results: results.length,
        passed: results.filter(r => r.passed).length
      });
    }
    
    this.isRunning = false;
    
    // Generate report
    const report: ValidationReport = {
      timestamp: new Date(),
      strategiesValidated: strategies.length,
      scenariosRun: this.scenarios.length,
      overallPassRate: allResults.filter(r => r.passed).length / allResults.length,
      criticalFailures: this.identifyCriticalFailures(allResults),
      recommendations: this.generateRecommendations(allResults),
      detailedResults: allResults
    };
    
    const duration = Date.now() - startTime;
    this.logger.info('Validation complete', {
      duration,
      overallPassRate: (report.overallPassRate * 100).toFixed(2) + '%',
      criticalFailures: report.criticalFailures.length
    });
    
    this.emit('validation-complete', report);
    
    return report;
  }
  
  private identifyCriticalFailures(results: BacktestResult[]): string[] {
    const failures: string[] = [];
    
    // Check for strategies that failed all scenarios
    const strategyResults: { [key: string]: BacktestResult[] } = {};
    results.forEach(r => {
      if (!strategyResults[r.strategyId]) {
        strategyResults[r.strategyId] = [];
      }
      strategyResults[r.strategyId].push(r);
    });
    
    for (const [strategyId, stratResults] of Object.entries(strategyResults)) {
      const allFailed = stratResults.every(r => !r.passed);
      if (allFailed) {
        failures.push(`Strategy ${strategyId} failed all scenarios`);
      }
      
      // Check for excessive drawdowns
      const maxDD = Math.max(...stratResults.map(r => r.metrics.maxDrawdown));
      if (maxDD > 0.40) {
        failures.push(`Strategy ${strategyId} had ${(maxDD * 100).toFixed(2)}% drawdown`);
      }
      
      // Check for no trades
      const noTrades = stratResults.some(r => r.metrics.totalTrades === 0);
      if (noTrades) {
        failures.push(`Strategy ${strategyId} generated no trades in some scenarios`);
      }
    }
    
    return failures;
  }
  
  private generateRecommendations(results: BacktestResult[]): string[] {
    const recommendations: string[] = [];
    
    // Analyze aggregate metrics
    const avgSharpe = results.reduce((sum, r) => sum + r.metrics.sharpeRatio, 0) / results.length;
    const avgDD = results.reduce((sum, r) => sum + r.metrics.maxDrawdown, 0) / results.length;
    const avgWinRate = results.reduce((sum, r) => sum + r.metrics.winRate, 0) / results.length;
    
    if (avgSharpe < 1.0) {
      recommendations.push('Consider improving risk-adjusted returns across strategies');
    }
    
    if (avgDD > 0.15) {
      recommendations.push('Implement tighter risk controls to reduce drawdowns');
    }
    
    if (avgWinRate < 0.45) {
      recommendations.push('Review signal generation logic to improve win rate');
    }
    
    // Check circuit breaker effectiveness
    const cbActivations = results.reduce((sum, r) => sum + r.circuitBreakerActivations.length, 0);
    if (cbActivations < results.length) {
      recommendations.push('Circuit breakers may be too conservative - review thresholds');
    }
    
    // Scenario-specific recommendations
    const crashResults = results.filter(r => r.scenarioId.includes('crash'));
    const crashFailures = crashResults.filter(r => !r.passed).length;
    if (crashFailures > crashResults.length * 0.5) {
      recommendations.push('Strategies need better crash protection mechanisms');
    }
    
    return recommendations;
  }
  
  public getHistoricalScenarios(): BacktestScenario[] {
    return [...this.scenarios];
  }
  
  public async addCustomScenario(scenario: BacktestScenario): Promise<void> {
    this.scenarios.push(scenario);
    this.logger.info('Added custom scenario', { id: scenario.id, name: scenario.name });
  }
} 