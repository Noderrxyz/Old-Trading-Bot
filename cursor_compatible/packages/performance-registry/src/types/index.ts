/**
 * StrategyPerformanceRegistry Types - Central performance tracking system
 */

export interface PerformanceSnapshot {
  strategyId: string;
  timestamp: number;
  period: {
    start: number;
    end: number;
    duration: number;
  };
  
  // Core performance metrics
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
    currentDrawdown: number;
    var95: number; // Value at Risk 95%
    cvar95: number; // Conditional VaR
    volatility: number;
    downVolatility: number;
  };
  
  // Trading metrics
  trading: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    expectancy: number;
    avgHoldTime: number;
    turnover: number;
  };
  
  // Execution quality
  execution: {
    avgSlippage: number;
    totalFees: number;
    avgFillRate: number;
    rejectedOrders: number;
    cancelledOrders: number;
  };
  
  // Position metrics
  positions: {
    current: number;
    avgSize: number;
    maxSize: number;
    totalVolume: number;
    avgLeverage: number;
    maxLeverage: number;
  };
  
  // Market exposure
  exposure: {
    longExposure: number;
    shortExposure: number;
    netExposure: number;
    grossExposure: number;
    beta: number;
    correlation: number;
  };
}

export interface StrategyMetadata {
  strategyId: string;
  name: string;
  version: string;
  type: StrategyType;
  parameters: Record<string, any>;
  startedAt: number;
  status: StrategyStatus;
  allocatedCapital: number;
  maxCapital: number;
  riskLimit: number;
  targetSharpe: number;
  targetReturn: number;
  description?: string;
  tags?: string[];
}

export enum StrategyType {
  MOMENTUM = 'MOMENTUM',
  MEAN_REVERSION = 'MEAN_REVERSION',
  ARBITRAGE = 'ARBITRAGE',
  MARKET_MAKING = 'MARKET_MAKING',
  TREND_FOLLOWING = 'TREND_FOLLOWING',
  VOLATILITY = 'VOLATILITY',
  STATISTICAL_ARB = 'STATISTICAL_ARB',
  ML_BASED = 'ML_BASED',
  HYBRID = 'HYBRID'
}

export enum StrategyStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
  BACKTESTING = 'BACKTESTING',
  PAPER_TRADING = 'PAPER_TRADING',
  LIVE_TRADING = 'LIVE_TRADING',
  DECOMMISSIONED = 'DECOMMISSIONED'
}

export interface PerformanceComparison {
  baseStrategyId: string;
  compareStrategyId: string;
  period: {
    start: number;
    end: number;
  };
  
  metrics: {
    pnlDiff: number;
    sharpeDiff: number;
    winRateDiff: number;
    volatilityDiff: number;
    drawdownDiff: number;
    
    outperformanceDays: number;
    underperformanceDays: number;
    correlation: number;
    beta: number;
    alpha: number;
    
    relativeStrength: number;
    informationRatio: number;
  };
}

export interface PerformanceReport {
  strategyId: string;
  reportType: ReportType;
  period: {
    start: number;
    end: number;
    granularity: TimeGranularity;
  };
  
  summary: {
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    totalTrades: number;
  };
  
  timeSeries: {
    timestamps: number[];
    pnl: number[];
    drawdown: number[];
    exposure: number[];
    volatility: number[];
  };
  
  attribution: {
    byAsset: Record<string, number>;
    byStrategy: Record<string, number>;
    byTimeOfDay: Record<string, number>;
    byDayOfWeek: Record<string, number>;
  };
  
  riskAnalysis: {
    varBreaches: number;
    stressTestResults: Record<string, number>;
    correlationMatrix: number[][];
    factorExposures: Record<string, number>;
  };
}

export enum ReportType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUAL = 'ANNUAL',
  CUSTOM = 'CUSTOM'
}

export enum TimeGranularity {
  MINUTE = 'MINUTE',
  HOUR = 'HOUR',
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH'
}

export interface PerformanceAlert {
  id: string;
  strategyId: string;
  timestamp: number;
  type: AlertType;
  severity: AlertSeverity;
  metric: string;
  currentValue: number;
  threshold: number;
  message: string;
  metadata?: Record<string, any>;
}

export enum AlertType {
  DRAWDOWN_BREACH = 'DRAWDOWN_BREACH',
  SHARPE_DECLINE = 'SHARPE_DECLINE',
  LOSS_STREAK = 'LOSS_STREAK',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE',
  CORRELATION_BREAK = 'CORRELATION_BREAK',
  EXECUTION_DEGRADATION = 'EXECUTION_DEGRADATION',
  RISK_LIMIT_BREACH = 'RISK_LIMIT_BREACH',
  PERFORMANCE_TARGET_MISS = 'PERFORMANCE_TARGET_MISS'
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL'
}

export interface RegistryConfig {
  // Data persistence
  storage: {
    type: 'memory' | 'redis' | 'postgres' | 'mongodb';
    connectionString?: string;
    retentionDays: number;
  };
  
  // Performance calculation
  calculation: {
    updateInterval: number; // milliseconds
    riskFreeRate: number;
    benchmarkIndex?: string;
    tradingDaysPerYear: number;
  };
  
  // Alerts and monitoring
  monitoring: {
    enableAlerts: boolean;
    alertThresholds: {
      maxDrawdown: number;
      minSharpe: number;
      maxLossStreak: number;
      maxVolatility: number;
    };
    webhookUrl?: string;
  };
  
  // API configuration
  api: {
    enabled: boolean;
    port: number;
    auth?: {
      type: 'basic' | 'jwt' | 'apikey';
      credentials: any;
    };
  };
  
  // Export configuration
  export: {
    prometheus: {
      enabled: boolean;
      port: number;
      prefix: string;
    };
    csv: {
      enabled: boolean;
      directory: string;
      frequency: string; // cron expression
    };
  };
}

export interface TradeRecord {
  id: string;
  strategyId: string;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fees: number;
  slippage: number;
  pnl?: number;
  metadata?: Record<string, any>;
}

export interface PositionUpdate {
  strategyId: string;
  timestamp: number;
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface PerformanceQuery {
  strategyIds?: string[];
  startTime?: number;
  endTime?: number;
  metrics?: string[];
  granularity?: TimeGranularity;
  includeTimeSeries?: boolean;
  includeAttribution?: boolean;
  compareToIndex?: string;
  sortBy?: string;
  limit?: number;
} 