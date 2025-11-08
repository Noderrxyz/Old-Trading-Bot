/**
 * Strategy Safety Configuration
 * 
 * Thresholds and settings for strategy singularity detection and containment.
 */

/**
 * Configuration for strategy safety monitoring and anomaly detection
 */

/**
 * Thresholds for detecting strategy singularity/anomalies
 */
export const STRATEGY_SINGULARITY_THRESHOLDS = {
  // Performance thresholds
  abnormalPerformanceThreshold: 2.0, // 200% annualized return trigger
  minimumSharpeRatio: 1.0, // Minimum acceptable Sharpe ratio
  maxDrawdownThreshold: 0.25, // 25% maximum drawdown
  volatilityThreshold: 0.04, // 4% daily volatility threshold
  
  // Trading behavior thresholds
  maxOrdersPerDay: 100, // Maximum acceptable orders per day
  maxTurnoverRate: 3.0, // Maximum portfolio turnover per day
  maxAssetConcentration: 0.5, // Maximum concentration in single asset (50%)
  maxPositionSizePercent: 0.3, // Maximum position size (30% of NAV)
  maxPerformanceChangePercent: 0.25, // Maximum rapid performance change (25%)
  
  // Market correlation thresholds
  minMarketCorrelation: -0.8, // Minimum market correlation
  maxMarketCorrelation: 0.95, // Maximum market correlation
};

/**
 * Weights for different anomaly factors when calculating the overall anomaly score
 */
export const ANOMALY_SCORE_WEIGHTS = {
  abnormalPerformance: 1.0,
  lowSharpe: 0.8,
  highDrawdown: 1.2,
  excessiveVolatility: 1.0,
  highConcentration: 0.9,
  highTurnover: 1.0,
  highOrderFrequency: 0.8,
  largePositionSize: 1.1,
  rapidPerformanceChange: 1.3,
};

/**
 * Time windows for monitoring different metrics
 */
export const MONITORING_TIME_WINDOWS = {
  // Short-term monitoring (1 day)
  shortTerm: {
    milliseconds: 24 * 60 * 60 * 1000,
    label: '1 day'
  },
  
  // Medium-term monitoring (1 week)
  mediumTerm: {
    milliseconds: 7 * 24 * 60 * 60 * 1000,
    label: '1 week'
  },
  
  // Long-term monitoring (1 month)
  longTerm: {
    milliseconds: 30 * 24 * 60 * 60 * 1000,
    label: '1 month'
  }
};

/**
 * Configuration for alerts and notifications
 */
export const ALERT_CONFIG = {
  // Thresholds for different risk levels
  riskLevelThresholds: {
    LOW: 0.3,
    MEDIUM: 0.5,
    HIGH: 0.7,
    CRITICAL: 0.85
  },
  
  // Notification settings for different risk levels
  notifications: {
    LOW: {
      notifyAdmins: false,
      logOnly: true,
      throttleMinutes: 360, // 6 hours
    },
    MEDIUM: {
      notifyAdmins: true,
      logOnly: false,
      throttleMinutes: 120, // 2 hours
    },
    HIGH: {
      notifyAdmins: true,
      logOnly: false,
      throttleMinutes: 30, // 30 minutes
    },
    CRITICAL: {
      notifyAdmins: true,
      logOnly: false,
      throttleMinutes: 0, // No throttling
    }
  }
};

/**
 * Configuration for strategy sandboxing
 */
export const SANDBOX_CONFIG = {
  // Containment levels and their restrictions
  containmentLevels: {
    LOW: {
      durationHours: 24,
      positionSizeFactor: 0.5, // 50% of normal size
      orderFrequencyFactor: 0.7, // 70% of normal frequency
      requiresApproval: false
    },
    MEDIUM: {
      durationHours: 72,
      positionSizeFactor: 0.25, // 25% of normal size
      orderFrequencyFactor: 0.4, // 40% of normal frequency
      requiresApproval: false
    },
    HIGH: {
      durationHours: 168, // 1 week
      positionSizeFactor: 0.1, // 10% of normal size
      orderFrequencyFactor: 0.2, // 20% of normal frequency
      requiresApproval: true
    },
    CRITICAL: {
      durationHours: 336, // 2 weeks
      positionSizeFactor: 0, // No new positions
      orderFrequencyFactor: 0, // No new orders
      requiresApproval: true
    }
  },
  
  // Thresholds for auto-release
  autoReleaseThresholds: {
    minStrategyAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    minSuccessfulTrades: 25,
    minRecentSharpe: 1.2,
    maxRecentDrawdown: 0.15, // 15%
  }
};

// Safety limits for strategy containment actions
export const SAFETY_LIMITS = {
  maxPositionSizePercentOfNAV: 0.05, // Maximum position size as percentage of NAV
  maxLeverageMultiple: 3, // Maximum leverage allowed
  minLiquidityRatio: 0.2, // Minimum ratio of position to market liquidity
  maxPortfolioConcentration: 0.25, // Maximum concentration in a single strategy
};

// Containment measures by severity level
export const CONTAINMENT_MEASURES = {
  level1: {
    description: 'Limit order size and frequency',
    actions: ['REDUCE_ORDER_SIZE', 'REDUCE_FREQUENCY'],
    reductionFactor: 0.5,
  },
  level2: {
    description: 'Prevent increasing positions',
    actions: ['PREVENT_POSITION_INCREASE', 'REDUCE_ORDER_SIZE', 'REDUCE_FREQUENCY'],
    reductionFactor: 0.75,
  },
  level3: {
    description: 'Begin position unwinding',
    actions: ['UNWIND_POSITIONS', 'PREVENT_NEW_ORDERS'],
    unwindingSpeed: 'gradual',
  },
  level4: {
    description: 'Emergency shutdown',
    actions: ['HALT_STRATEGY', 'EMERGENCY_LIQUIDATE'],
    unwindingSpeed: 'immediate',
  }
}; 