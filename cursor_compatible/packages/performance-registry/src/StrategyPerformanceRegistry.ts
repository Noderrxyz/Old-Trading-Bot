/**
 * StrategyPerformanceRegistry - Central system for tracking and analyzing strategy performance
 * 
 * Features:
 * - Real-time performance tracking
 * - Risk metrics calculation
 * - Multi-strategy comparison
 * - Alert generation
 * - Prometheus/REST API export
 */

import { EventEmitter } from 'events';
import {
  PerformanceSnapshot,
  StrategyMetadata,
  StrategyType,
  StrategyStatus,
  PerformanceComparison,
  PerformanceReport,
  ReportType,
  TimeGranularity,
  PerformanceAlert,
  AlertType,
  AlertSeverity,
  RegistryConfig,
  TradeRecord,
  PositionUpdate,
  PerformanceQuery
} from './types';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface StrategyState {
  metadata: StrategyMetadata;
  currentSnapshot: PerformanceSnapshot;
  snapshots: PerformanceSnapshot[];
  trades: TradeRecord[];
  positions: Map<string, PositionUpdate>;
  alerts: PerformanceAlert[];
  lastUpdate: number;
  
  // Cumulative tracking
  cumulativePnL: number[];
  cumulativeReturns: number[];
  drawdownSeries: number[];
  highWaterMark: number;
}

interface MetricsCalculation {
  returns: number[];
  volatility: number;
  downVolatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  var95: number;
  cvar95: number;
}

export class StrategyPerformanceRegistry extends EventEmitter {
  private static instance: StrategyPerformanceRegistry;
  private logger: ReturnType<typeof createLogger>;
  private config: RegistryConfig;
  private strategies: Map<string, StrategyState>;
  private updateTimer?: NodeJS.Timeout;
  private alertCheckTimer?: NodeJS.Timeout;
  
  // Performance calculation cache
  private metricsCache: Map<string, MetricsCalculation>;
  private lastCalculation: number;
  
  private constructor(config?: Partial<RegistryConfig>) {
    super();
    this.logger = createLogger('StrategyPerformanceRegistry');
    
    this.config = {
      storage: {
        type: 'memory',
        retentionDays: 90
      },
      calculation: {
        updateInterval: 60000, // 1 minute
        riskFreeRate: 0.02, // 2% annual
        tradingDaysPerYear: 252
      },
      monitoring: {
        enableAlerts: true,
        alertThresholds: {
          maxDrawdown: 0.2, // 20%
          minSharpe: 0.5,
          maxLossStreak: 5,
          maxVolatility: 0.3 // 30% annual
        }
      },
      api: {
        enabled: true,
        port: 3001
      },
      export: {
        prometheus: {
          enabled: true,
          port: 9090,
          prefix: 'noderr_strategy_'
        },
        csv: {
          enabled: false,
          directory: './performance_reports',
          frequency: '0 0 * * *' // Daily
        }
      },
      ...config
    };
    
    this.strategies = new Map();
    this.metricsCache = new Map();
    this.lastCalculation = 0;
    
    this.startPerformanceTracking();
  }
  
  public static getInstance(config?: Partial<RegistryConfig>): StrategyPerformanceRegistry {
    if (!StrategyPerformanceRegistry.instance) {
      StrategyPerformanceRegistry.instance = new StrategyPerformanceRegistry(config);
    }
    return StrategyPerformanceRegistry.instance;
  }
  
  /**
   * Start performance tracking timers
   */
  private startPerformanceTracking(): void {
    // Performance update timer
    this.updateTimer = setInterval(() => {
      this.updateAllStrategies();
    }, this.config.calculation.updateInterval);
    
    // Alert checking timer
    if (this.config.monitoring.enableAlerts) {
      this.alertCheckTimer = setInterval(() => {
        this.checkAlerts();
      }, 30000); // Check every 30 seconds
    }
    
    this.logger.info('Performance tracking started', {
      updateInterval: this.config.calculation.updateInterval,
      alertsEnabled: this.config.monitoring.enableAlerts
    });
  }
  
  /**
   * Register a new strategy
   */
  public registerStrategy(metadata: StrategyMetadata): void {
    if (this.strategies.has(metadata.strategyId)) {
      throw new Error(`Strategy ${metadata.strategyId} already registered`);
    }
    
    const initialSnapshot = this.createInitialSnapshot(metadata.strategyId);
    
    const state: StrategyState = {
      metadata,
      currentSnapshot: initialSnapshot,
      snapshots: [initialSnapshot],
      trades: [],
      positions: new Map(),
      alerts: [],
      lastUpdate: Date.now(),
      cumulativePnL: [0],
      cumulativeReturns: [0],
      drawdownSeries: [0],
      highWaterMark: metadata.allocatedCapital
    };
    
    this.strategies.set(metadata.strategyId, state);
    
    this.logger.info('Strategy registered', {
      strategyId: metadata.strategyId,
      name: metadata.name,
      type: metadata.type,
      allocatedCapital: metadata.allocatedCapital
    });
    
    this.emit('strategy-registered', metadata);
    
    // Emit initial telemetry
    this.emitPerformanceTelemetry(metadata.strategyId, initialSnapshot);
  }
  
  /**
   * Record a trade execution
   */
  public recordTrade(trade: TradeRecord): void {
    const state = this.strategies.get(trade.strategyId);
    if (!state) {
      throw new Error(`Strategy ${trade.strategyId} not found`);
    }
    
    state.trades.push(trade);
    state.lastUpdate = Date.now();
    
    // Update trade metrics immediately
    this.updateTradeMetrics(state, trade);
    
    this.logger.debug('Trade recorded', {
      strategyId: trade.strategyId,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      pnl: trade.pnl
    });
    
    this.emit('trade-recorded', trade);
    
    // Check if immediate alert needed
    if (trade.pnl && trade.pnl < 0) {
      this.checkLossStreak(state);
    }
  }
  
  /**
   * Update position status
   */
  public updatePosition(update: PositionUpdate): void {
    const state = this.strategies.get(update.strategyId);
    if (!state) {
      throw new Error(`Strategy ${update.strategyId} not found`);
    }
    
    // Update or add position
    state.positions.set(update.symbol, update);
    state.lastUpdate = Date.now();
    
    // Recalculate exposure metrics
    this.calculateExposureMetrics(state);
    
    this.emit('position-updated', update);
  }
  
  /**
   * Get performance snapshot for a strategy
   */
  public getSnapshot(strategyId: string): PerformanceSnapshot | null {
    const state = this.strategies.get(strategyId);
    return state ? state.currentSnapshot : null;
  }
  
  /**
   * Query performance data
   */
  public async queryPerformance(query: PerformanceQuery): Promise<PerformanceSnapshot[]> {
    const results: PerformanceSnapshot[] = [];
    
    const strategyIds = query.strategyIds || Array.from(this.strategies.keys());
    
    for (const strategyId of strategyIds) {
      const state = this.strategies.get(strategyId);
      if (!state) continue;
      
      // Filter snapshots by time range
      let snapshots = state.snapshots;
      if (query.startTime) {
        snapshots = snapshots.filter(s => s.timestamp >= query.startTime!);
      }
      if (query.endTime) {
        snapshots = snapshots.filter(s => s.timestamp <= query.endTime!);
      }
      
      // Add filtered snapshots
      results.push(...snapshots);
    }
    
    // Sort by specified field
    if (query.sortBy) {
      results.sort((a, b) => {
        const aVal = this.getMetricValue(a, query.sortBy!);
        const bVal = this.getMetricValue(b, query.sortBy!);
        return bVal - aVal;
      });
    }
    
    // Apply limit
    if (query.limit) {
      return results.slice(0, query.limit);
    }
    
    return results;
  }
  
  /**
   * Compare two strategies
   */
  public compareStrategies(
    baseStrategyId: string,
    compareStrategyId: string,
    startTime?: number,
    endTime?: number
  ): PerformanceComparison | null {
    const baseState = this.strategies.get(baseStrategyId);
    const compareState = this.strategies.get(compareStrategyId);
    
    if (!baseState || !compareState) {
      return null;
    }
    
    const period = {
      start: startTime || Math.min(baseState.metadata.startedAt, compareState.metadata.startedAt),
      end: endTime || Date.now()
    };
    
    // Calculate comparison metrics
    const baseMetrics = this.getStrategyMetrics(baseState, period);
    const compareMetrics = this.getStrategyMetrics(compareState, period);
    
    const comparison: PerformanceComparison = {
      baseStrategyId,
      compareStrategyId,
      period,
      metrics: {
        pnlDiff: baseMetrics.totalPnL - compareMetrics.totalPnL,
        sharpeDiff: baseMetrics.sharpeRatio - compareMetrics.sharpeRatio,
        winRateDiff: baseMetrics.winRate - compareMetrics.winRate,
        volatilityDiff: baseMetrics.volatility - compareMetrics.volatility,
        drawdownDiff: baseMetrics.maxDrawdown - compareMetrics.maxDrawdown,
        
        outperformanceDays: this.countOutperformanceDays(baseState, compareState, period),
        underperformanceDays: this.countUnderperformanceDays(baseState, compareState, period),
        correlation: this.calculateCorrelation(baseState, compareState, period),
        beta: this.calculateBeta(baseState, compareState, period),
        alpha: this.calculateAlpha(baseState, compareState, period),
        
        relativeStrength: baseMetrics.totalReturn / (compareMetrics.totalReturn || 1),
        informationRatio: this.calculateInformationRatio(baseState, compareState, period)
      }
    };
    
    return comparison;
  }
  
  /**
   * Generate performance report
   */
  public generateReport(
    strategyId: string,
    reportType: ReportType,
    customPeriod?: { start: number; end: number }
  ): PerformanceReport | null {
    const state = this.strategies.get(strategyId);
    if (!state) return null;
    
    const period = customPeriod || this.getReportPeriod(reportType);
    const granularity = this.getReportGranularity(reportType);
    
    // Filter snapshots for period
    const periodSnapshots = state.snapshots.filter(
      s => s.timestamp >= period.start && s.timestamp <= period.end
    );
    
    if (periodSnapshots.length === 0) return null;
    
    // Calculate summary metrics
    const firstSnapshot = periodSnapshots[0];
    const lastSnapshot = periodSnapshots[periodSnapshots.length - 1];
    const totalReturn = (lastSnapshot.pnl.total - firstSnapshot.pnl.total) / state.metadata.allocatedCapital;
    const annualizedReturn = this.annualizeReturn(totalReturn, period);
    
    // Build time series
    const timeSeries = this.buildTimeSeries(periodSnapshots, granularity);
    
    // Calculate attribution
    const attribution = this.calculateAttribution(state, period);
    
    // Risk analysis
    const riskAnalysis = this.performRiskAnalysis(state, periodSnapshots);
    
    const report: PerformanceReport = {
      strategyId,
      reportType,
      period: {
        ...period,
        granularity
      },
      summary: {
        totalReturn,
        annualizedReturn,
        sharpeRatio: lastSnapshot.risk.sharpeRatio,
        maxDrawdown: Math.max(...periodSnapshots.map(s => s.risk.maxDrawdown)),
        winRate: lastSnapshot.trading.winRate,
        profitFactor: lastSnapshot.trading.profitFactor,
        totalTrades: lastSnapshot.trading.totalTrades
      },
      timeSeries,
      attribution,
      riskAnalysis
    };
    
    this.emit('report-generated', {
      strategyId,
      reportType,
      timestamp: Date.now()
    });
    
    return report;
  }
  
  /**
   * Update all strategy metrics
   */
  private updateAllStrategies(): void {
    const now = Date.now();
    
    for (const [strategyId, state] of this.strategies) {
      if (state.metadata.status !== StrategyStatus.ACTIVE &&
          state.metadata.status !== StrategyStatus.LIVE_TRADING) {
        continue;
      }
      
      try {
        this.updateStrategyMetrics(state);
        
        // Create new snapshot
        const snapshot = this.createSnapshot(state);
        state.currentSnapshot = snapshot;
        state.snapshots.push(snapshot);
        
        // Cleanup old snapshots
        this.cleanupSnapshots(state);
        
        // Emit updates
        this.emitPerformanceTelemetry(strategyId, snapshot);
        
      } catch (error) {
        this.logger.error(`Failed to update strategy ${strategyId}`, error);
        this.createAlert(state, AlertType.PERFORMANCE_TARGET_MISS, AlertSeverity.ERROR,
          'performance_update', 0, 0, 'Failed to update performance metrics');
      }
    }
    
    this.lastCalculation = now;
  }
  
  /**
   * Create performance snapshot
   */
  private createSnapshot(state: StrategyState): PerformanceSnapshot {
    const now = Date.now();
    const metrics = this.calculateMetrics(state);
    
    // Calculate period PnL
    const dayAgo = now - 86400000;
    const weekAgo = now - 604800000;
    const monthAgo = now - 2592000000;
    
    const dailyPnL = this.calculatePeriodPnL(state, dayAgo, now);
    const weeklyPnL = this.calculatePeriodPnL(state, weekAgo, now);
    const monthlyPnL = this.calculatePeriodPnL(state, monthAgo, now);
    
    return {
      strategyId: state.metadata.strategyId,
      timestamp: now,
      period: {
        start: state.metadata.startedAt,
        end: now,
        duration: now - state.metadata.startedAt
      },
      pnl: {
        realized: this.calculateRealizedPnL(state),
        unrealized: this.calculateUnrealizedPnL(state),
        total: this.calculateTotalPnL(state),
        daily: dailyPnL,
        weekly: weeklyPnL,
        monthly: monthlyPnL
      },
      risk: {
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        maxDrawdown: metrics.maxDrawdown,
        currentDrawdown: metrics.currentDrawdown,
        var95: metrics.var95,
        cvar95: metrics.cvar95,
        volatility: metrics.volatility,
        downVolatility: metrics.downVolatility
      },
      trading: this.calculateTradingMetrics(state),
      execution: this.calculateExecutionMetrics(state),
      positions: this.calculatePositionMetrics(state),
      exposure: this.calculateExposureMetrics(state)
    };
  }
  
  /**
   * Calculate risk metrics
   */
  private calculateMetrics(state: StrategyState): MetricsCalculation {
    const returns = this.calculateReturns(state);
    
    if (returns.length < 2) {
      return {
        returns,
        volatility: 0,
        downVolatility: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        maxDrawdown: 0,
        currentDrawdown: 0,
        var95: 0,
        cvar95: 0
      };
    }
    
    // Volatility
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - meanReturn, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
    const dailyVol = Math.sqrt(variance);
    const annualVol = dailyVol * Math.sqrt(this.config.calculation.tradingDaysPerYear);
    
    // Downside volatility
    const negativeReturns = returns.filter(r => r < 0);
    const downVariance = negativeReturns.length > 0
      ? negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length
      : 0;
    const downVol = Math.sqrt(downVariance) * Math.sqrt(this.config.calculation.tradingDaysPerYear);
    
    // Sharpe ratio
    const annualizedReturn = meanReturn * this.config.calculation.tradingDaysPerYear;
    const excessReturn = annualizedReturn - this.config.calculation.riskFreeRate;
    const sharpeRatio = annualVol > 0 ? excessReturn / annualVol : 0;
    
    // Sortino ratio
    const sortinoRatio = downVol > 0 ? excessReturn / downVol : 0;
    
    // Drawdown
    const { maxDrawdown, currentDrawdown } = this.calculateDrawdown(state);
    
    // Calmar ratio
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
    
    // VaR and CVaR
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95Index = Math.floor(sortedReturns.length * 0.05);
    const var95 = sortedReturns[var95Index] || 0;
    const cvar95 = sortedReturns.slice(0, var95Index).reduce((a, b) => a + b, 0) / (var95Index || 1);
    
    return {
      returns,
      volatility: annualVol,
      downVolatility: downVol,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdown,
      currentDrawdown,
      var95: Math.abs(var95) * Math.sqrt(this.config.calculation.tradingDaysPerYear),
      cvar95: Math.abs(cvar95) * Math.sqrt(this.config.calculation.tradingDaysPerYear)
    };
  }
  
  /**
   * Check for alerts
   */
  private checkAlerts(): void {
    for (const [strategyId, state] of this.strategies) {
      const snapshot = state.currentSnapshot;
      const thresholds = this.config.monitoring.alertThresholds;
      
      // Drawdown check
      if (snapshot.risk.currentDrawdown > thresholds.maxDrawdown) {
        this.createAlert(state, AlertType.DRAWDOWN_BREACH, AlertSeverity.CRITICAL,
          'currentDrawdown', snapshot.risk.currentDrawdown, thresholds.maxDrawdown,
          `Drawdown ${(snapshot.risk.currentDrawdown * 100).toFixed(1)}% exceeds limit`);
      }
      
      // Sharpe ratio check
      if (snapshot.risk.sharpeRatio < thresholds.minSharpe && snapshot.trading.totalTrades > 20) {
        this.createAlert(state, AlertType.SHARPE_DECLINE, AlertSeverity.WARNING,
          'sharpeRatio', snapshot.risk.sharpeRatio, thresholds.minSharpe,
          `Sharpe ratio ${snapshot.risk.sharpeRatio.toFixed(2)} below minimum`);
      }
      
      // Volatility check
      if (snapshot.risk.volatility > thresholds.maxVolatility) {
        this.createAlert(state, AlertType.VOLATILITY_SPIKE, AlertSeverity.WARNING,
          'volatility', snapshot.risk.volatility, thresholds.maxVolatility,
          `Volatility ${(snapshot.risk.volatility * 100).toFixed(1)}% exceeds limit`);
      }
      
      // Risk limit check
      if (Math.abs(snapshot.exposure.netExposure) > state.metadata.riskLimit) {
        this.createAlert(state, AlertType.RISK_LIMIT_BREACH, AlertSeverity.ERROR,
          'netExposure', snapshot.exposure.netExposure, state.metadata.riskLimit,
          `Net exposure ${snapshot.exposure.netExposure.toFixed(0)} exceeds risk limit`);
      }
    }
  }
  
  /**
   * Create and emit alert
   */
  private createAlert(
    state: StrategyState,
    type: AlertType,
    severity: AlertSeverity,
    metric: string,
    currentValue: number,
    threshold: number,
    message: string
  ): void {
    // Check if similar alert was recently created
    const recentAlert = state.alerts.find(a => 
      a.type === type && 
      a.metric === metric &&
      Date.now() - a.timestamp < 300000 // 5 minutes
    );
    
    if (recentAlert) return;
    
    const alert: PerformanceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      strategyId: state.metadata.strategyId,
      timestamp: Date.now(),
      type,
      severity,
      metric,
      currentValue,
      threshold,
      message,
      metadata: {
        strategyName: state.metadata.name,
        strategyType: state.metadata.type
      }
    };
    
    state.alerts.push(alert);
    
    this.logger.warn('Performance alert created', {
      strategyId: state.metadata.strategyId,
      type,
      severity,
      message
    });
    
    this.emit('performance-alert', alert);
    
    // Emit telemetry
    this.emit('telemetry:alert', {
      strategyId: state.metadata.strategyId,
      alertType: type,
      severity,
      metric,
      value: currentValue,
      threshold,
      timestamp: Date.now()
    });
  }
  
  /**
   * Emit performance telemetry
   */
  private emitPerformanceTelemetry(strategyId: string, snapshot: PerformanceSnapshot): void {
    this.emit('telemetry:performance', {
      strategyId,
      timestamp: snapshot.timestamp,
      pnl: snapshot.pnl.total,
      sharpeRatio: snapshot.risk.sharpeRatio,
      winRate: snapshot.trading.winRate,
      volatility: snapshot.risk.volatility,
      drawdown: snapshot.risk.currentDrawdown,
      exposure: snapshot.exposure.netExposure,
      trades: snapshot.trading.totalTrades
    });
  }
  
  // Helper methods
  
  private createInitialSnapshot(strategyId: string): PerformanceSnapshot {
    return {
      strategyId,
      timestamp: Date.now(),
      period: { start: Date.now(), end: Date.now(), duration: 0 },
      pnl: { realized: 0, unrealized: 0, total: 0, daily: 0, weekly: 0, monthly: 0 },
      risk: {
        sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
        maxDrawdown: 0, currentDrawdown: 0,
        var95: 0, cvar95: 0, volatility: 0, downVolatility: 0
      },
      trading: {
        totalTrades: 0, winningTrades: 0, losingTrades: 0,
        winRate: 0, avgWin: 0, avgLoss: 0,
        profitFactor: 0, expectancy: 0, avgHoldTime: 0, turnover: 0
      },
      execution: {
        avgSlippage: 0, totalFees: 0, avgFillRate: 0,
        rejectedOrders: 0, cancelledOrders: 0
      },
      positions: {
        current: 0, avgSize: 0, maxSize: 0,
        totalVolume: 0, avgLeverage: 0, maxLeverage: 0
      },
      exposure: {
        longExposure: 0, shortExposure: 0, netExposure: 0,
        grossExposure: 0, beta: 0, correlation: 0
      }
    };
  }
  
  private calculateReturns(state: StrategyState): number[] {
    if (state.cumulativePnL.length < 2) return [];
    
    const returns: number[] = [];
    const capital = state.metadata.allocatedCapital;
    
    for (let i = 1; i < state.cumulativePnL.length; i++) {
      const dailyPnL = state.cumulativePnL[i] - state.cumulativePnL[i - 1];
      const dailyReturn = dailyPnL / capital;
      returns.push(dailyReturn);
    }
    
    return returns;
  }
  
  private calculateDrawdown(state: StrategyState): { maxDrawdown: number; currentDrawdown: number } {
    const equity = state.cumulativePnL.map(pnl => state.metadata.allocatedCapital + pnl);
    let maxDrawdown = 0;
    let peak = equity[0];
    let currentDrawdown = 0;
    
    for (const value of equity) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    // Current drawdown
    const currentEquity = equity[equity.length - 1];
    currentDrawdown = (state.highWaterMark - currentEquity) / state.highWaterMark;
    
    return { maxDrawdown, currentDrawdown: Math.max(0, currentDrawdown) };
  }
  
  private updateTradeMetrics(state: StrategyState, trade: TradeRecord): void {
    // This would be called to update metrics immediately after a trade
    // Implementation depends on specific requirements
  }
  
  private calculateExposureMetrics(state: StrategyState): {
    longExposure: number;
    shortExposure: number;
    netExposure: number;
    grossExposure: number;
    beta: number;
    correlation: number;
  } {
    let longExposure = 0;
    let shortExposure = 0;
    
    for (const position of state.positions.values()) {
      const value = position.quantity * position.currentPrice;
      if (position.quantity > 0) {
        longExposure += value;
      } else {
        shortExposure += Math.abs(value);
      }
    }
    
    return {
      longExposure,
      shortExposure,
      netExposure: longExposure - shortExposure,
      grossExposure: longExposure + shortExposure,
      beta: 0, // Would calculate against market
      correlation: 0 // Would calculate against benchmark
    };
  }
  
  private calculateTradingMetrics(state: StrategyState): PerformanceSnapshot['trading'] {
    const trades = state.trades;
    const winningTrades = trades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = trades.filter(t => (t.pnl || 0) < 0);
    
    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
    
    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;
    const expectancy = trades.length > 0 ? (totalWins - totalLosses) / trades.length : 0;
    
    // Calculate turnover
    const totalVolume = trades.reduce((sum, t) => sum + t.quantity * t.price, 0);
    const turnover = totalVolume / state.metadata.allocatedCapital;
    
    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      avgHoldTime: 0, // Would need position open/close times
      turnover
    };
  }
  
  private calculateExecutionMetrics(state: StrategyState): PerformanceSnapshot['execution'] {
    const trades = state.trades;
    
    const totalSlippage = trades.reduce((sum, t) => sum + (t.slippage || 0), 0);
    const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
    
    return {
      avgSlippage: trades.length > 0 ? totalSlippage / trades.length : 0,
      totalFees,
      avgFillRate: 0.95, // Would need order data
      rejectedOrders: 0, // Would need order data
      cancelledOrders: 0 // Would need order data
    };
  }
  
  private calculatePositionMetrics(state: StrategyState): PerformanceSnapshot['positions'] {
    const positions = Array.from(state.positions.values());
    const sizes = positions.map(p => Math.abs(p.quantity * p.currentPrice));
    
    return {
      current: positions.length,
      avgSize: sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
      maxSize: sizes.length > 0 ? Math.max(...sizes) : 0,
      totalVolume: state.trades.reduce((sum, t) => sum + t.quantity * t.price, 0),
      avgLeverage: 1, // Would calculate based on margin usage
      maxLeverage: 1 // Would track historically
    };
  }
  
  private calculatePeriodPnL(state: StrategyState, startTime: number, endTime: number): number {
    const periodTrades = state.trades.filter(
      t => t.timestamp >= startTime && t.timestamp <= endTime
    );
    return periodTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  }
  
  private calculateRealizedPnL(state: StrategyState): number {
    return state.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  }
  
  private calculateUnrealizedPnL(state: StrategyState): number {
    let unrealized = 0;
    for (const position of state.positions.values()) {
      unrealized += position.unrealizedPnl;
    }
    return unrealized;
  }
  
  private calculateTotalPnL(state: StrategyState): number {
    return this.calculateRealizedPnL(state) + this.calculateUnrealizedPnL(state);
  }
  
  private checkLossStreak(state: StrategyState): void {
    // Check recent trades for consecutive losses
    const recentTrades = state.trades.slice(-10);
    let lossStreak = 0;
    
    for (let i = recentTrades.length - 1; i >= 0; i--) {
      if ((recentTrades[i].pnl || 0) < 0) {
        lossStreak++;
      } else {
        break;
      }
    }
    
    if (lossStreak >= this.config.monitoring.alertThresholds.maxLossStreak) {
      this.createAlert(state, AlertType.LOSS_STREAK, AlertSeverity.WARNING,
        'lossStreak', lossStreak, this.config.monitoring.alertThresholds.maxLossStreak,
        `Loss streak of ${lossStreak} trades`);
    }
  }
  
  private cleanupSnapshots(state: StrategyState): void {
    const cutoff = Date.now() - (this.config.storage.retentionDays * 86400000);
    state.snapshots = state.snapshots.filter(s => s.timestamp > cutoff);
    
    // Keep at least 100 snapshots
    if (state.snapshots.length > 1000) {
      state.snapshots = state.snapshots.slice(-1000);
    }
  }
  
  private updateStrategyMetrics(state: StrategyState): void {
    // Update cumulative PnL
    const totalPnL = this.calculateTotalPnL(state);
    state.cumulativePnL.push(totalPnL);
    
    // Update high water mark
    const currentEquity = state.metadata.allocatedCapital + totalPnL;
    if (currentEquity > state.highWaterMark) {
      state.highWaterMark = currentEquity;
    }
    
    // Update drawdown series
    const drawdown = (state.highWaterMark - currentEquity) / state.highWaterMark;
    state.drawdownSeries.push(drawdown);
  }
  
  private getMetricValue(snapshot: PerformanceSnapshot, metric: string): number {
    const path = metric.split('.');
    let value: any = snapshot;
    
    for (const key of path) {
      value = value[key];
      if (value === undefined) return 0;
    }
    
    return typeof value === 'number' ? value : 0;
  }
  
  private getStrategyMetrics(state: StrategyState, period: { start: number; end: number }) {
    const periodSnapshots = state.snapshots.filter(
      s => s.timestamp >= period.start && s.timestamp <= period.end
    );
    
    if (periodSnapshots.length === 0) {
      return {
        totalPnL: 0,
        totalReturn: 0,
        sharpeRatio: 0,
        winRate: 0,
        volatility: 0,
        maxDrawdown: 0
      };
    }
    
    const lastSnapshot = periodSnapshots[periodSnapshots.length - 1];
    const firstSnapshot = periodSnapshots[0];
    
    return {
      totalPnL: lastSnapshot.pnl.total - firstSnapshot.pnl.total,
      totalReturn: (lastSnapshot.pnl.total - firstSnapshot.pnl.total) / state.metadata.allocatedCapital,
      sharpeRatio: lastSnapshot.risk.sharpeRatio,
      winRate: lastSnapshot.trading.winRate,
      volatility: lastSnapshot.risk.volatility,
      maxDrawdown: Math.max(...periodSnapshots.map(s => s.risk.maxDrawdown))
    };
  }
  
  private countOutperformanceDays(base: StrategyState, compare: StrategyState, period: any): number {
    // Implementation would count days where base outperformed compare
    return 0;
  }
  
  private countUnderperformanceDays(base: StrategyState, compare: StrategyState, period: any): number {
    // Implementation would count days where base underperformed compare
    return 0;
  }
  
  private calculateCorrelation(base: StrategyState, compare: StrategyState, period: any): number {
    // Implementation would calculate correlation between returns
    return 0;
  }
  
  private calculateBeta(base: StrategyState, compare: StrategyState, period: any): number {
    // Implementation would calculate beta of base vs compare
    return 0;
  }
  
  private calculateAlpha(base: StrategyState, compare: StrategyState, period: any): number {
    // Implementation would calculate alpha of base vs compare
    return 0;
  }
  
  private calculateInformationRatio(base: StrategyState, compare: StrategyState, period: any): number {
    // Implementation would calculate information ratio
    return 0;
  }
  
  private getReportPeriod(reportType: ReportType): { start: number; end: number } {
    const now = Date.now();
    const start = {
      [ReportType.DAILY]: now - 86400000,
      [ReportType.WEEKLY]: now - 604800000,
      [ReportType.MONTHLY]: now - 2592000000,
      [ReportType.QUARTERLY]: now - 7776000000,
      [ReportType.ANNUAL]: now - 31536000000,
      [ReportType.CUSTOM]: now - 86400000
    }[reportType];
    
    return { start, end: now };
  }
  
  private getReportGranularity(reportType: ReportType): TimeGranularity {
    return {
      [ReportType.DAILY]: TimeGranularity.HOUR,
      [ReportType.WEEKLY]: TimeGranularity.DAY,
      [ReportType.MONTHLY]: TimeGranularity.DAY,
      [ReportType.QUARTERLY]: TimeGranularity.WEEK,
      [ReportType.ANNUAL]: TimeGranularity.MONTH,
      [ReportType.CUSTOM]: TimeGranularity.DAY
    }[reportType];
  }
  
  private annualizeReturn(totalReturn: number, period: { start: number; end: number }): number {
    const days = (period.end - period.start) / 86400000;
    const years = days / this.config.calculation.tradingDaysPerYear;
    return years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  }
  
  private buildTimeSeries(snapshots: PerformanceSnapshot[], granularity: TimeGranularity): any {
    // Implementation would aggregate snapshots by granularity
    return {
      timestamps: snapshots.map(s => s.timestamp),
      pnl: snapshots.map(s => s.pnl.total),
      drawdown: snapshots.map(s => s.risk.currentDrawdown),
      exposure: snapshots.map(s => s.exposure.netExposure),
      volatility: snapshots.map(s => s.risk.volatility)
    };
  }
  
  private calculateAttribution(state: StrategyState, period: { start: number; end: number }): any {
    // Implementation would calculate PnL attribution
    return {
      byAsset: {},
      byStrategy: { [state.metadata.strategyId]: 1.0 },
      byTimeOfDay: {},
      byDayOfWeek: {}
    };
  }
  
  private performRiskAnalysis(state: StrategyState, snapshots: PerformanceSnapshot[]): any {
    // Implementation would perform risk analysis
    return {
      varBreaches: 0,
      stressTestResults: {},
      correlationMatrix: [[]],
      factorExposures: {}
    };
  }
  
  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    if (this.alertCheckTimer) {
      clearInterval(this.alertCheckTimer);
    }
    
    this.logger.info('StrategyPerformanceRegistry destroyed');
  }
} 