/**
 * Trading Strategy Model
 * 
 * Defines the structure of a trading strategy for the evolution system.
 */

/**
 * Base indicator parameters
 */
export interface BaseIndicator {
  /** Whether the indicator is enabled */
  enabled: boolean;
  
  /** Weight of this indicator in signal calculations */
  weight: number;
}

/**
 * Relative Strength Index (RSI) indicator
 */
export interface RSIIndicator extends BaseIndicator {
  /** Period for RSI calculation */
  period: number;
  
  /** Overbought threshold */
  overboughtThreshold: number;
  
  /** Oversold threshold */
  oversoldThreshold: number;
}

/**
 * Moving Average Convergence Divergence (MACD) indicator
 */
export interface MACDIndicator extends BaseIndicator {
  /** Fast EMA period */
  fastPeriod: number;
  
  /** Slow EMA period */
  slowPeriod: number;
  
  /** Signal line period */
  signalPeriod: number;
}

/**
 * Bollinger Bands indicator
 */
export interface BollingerBandsIndicator extends BaseIndicator {
  /** Period for Moving Average calculation */
  period: number;
  
  /** Standard deviation multiplier */
  stdDev: number;
}

/**
 * Moving Average indicator
 */
export interface MovingAverageIndicator extends BaseIndicator {
  /** Period for Moving Average calculation */
  period: number;
  
  /** Type of Moving Average */
  type: 'simple' | 'exponential' | 'weighted' | 'hull';
}

/**
 * Accumulation/Distribution Line indicator
 */
export interface ADLIndicator extends BaseIndicator {
  /** Optional smoothing period */
  smoothingPeriod?: number;
}

/**
 * On-Balance Volume indicator
 */
export interface OBVIndicator extends BaseIndicator {
  /** Optional smoothing period */
  smoothingPeriod?: number;
}

/**
 * Strategy risk parameters
 */
export interface RiskParameters {
  /** Maximum position size as percentage of capital */
  maxPositionSize: number;
  
  /** Stop loss percentage */
  stopLoss: number;
  
  /** Take profit percentage */
  takeProfit: number;
  
  /** Maximum allowed drawdown */
  maxDrawdown: number;
  
  /** Maximum open positions */
  maxOpenPositions: number;
}

/**
 * Entry/exit conditions
 */
export interface Condition {
  /** Type of condition */
  type: string;
  
  /** Parameters for the condition */
  parameters: Record<string, any>;
  
  /** Condition operator (AND/OR) for combining with next condition */
  operator?: 'AND' | 'OR';
}

/**
 * Trading strategy signal settings
 */
export interface SignalSettings {
  /** Signal threshold for taking action */
  threshold: number;
  
  /** Minimum confidence required */
  minConfidence: number;
  
  /** Indicator combination method */
  combinationMethod: 'weighted' | 'majority' | 'sequential';
  
  /** Entry conditions */
  entryConditions: Condition[];
  
  /** Exit conditions */
  exitConditions: Condition[];
}

/**
 * Time settings for the strategy
 */
export interface TimeSettings {
  /** Trading session hours */
  tradingHours: {
    start: string;
    end: string;
  };
  
  /** Trading days */
  tradingDays: string[];
  
  /** Timeframe for analysis */
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
}

/**
 * Strategy indicators collection
 */
export interface StrategyIndicators {
  rsi?: RSIIndicator;
  macd?: MACDIndicator;
  bollingerBands?: BollingerBandsIndicator;
  movingAverage?: MovingAverageIndicator;
  adl?: ADLIndicator;
  obv?: OBVIndicator;
  [key: string]: BaseIndicator | undefined;
}

/**
 * Complete trading strategy
 */
export interface TradingStrategy {
  /** Unique identifier for this strategy version */
  id: string;
  
  /** Name of the strategy */
  name: string;
  
  /** Strategy version */
  version: string;
  
  /** Description of what the strategy does */
  description: string;
  
  /** Strategy indicators */
  indicators: StrategyIndicators;
  
  /** Risk management parameters */
  riskParameters: RiskParameters;
  
  /** Signal generation settings */
  signalSettings: SignalSettings;
  
  /** Time-related settings */
  timeSettings: TimeSettings;
  
  /** Asset classes this strategy is designed for */
  assetClasses: string[];
  
  /** Market conditions this strategy works best in */
  marketConditions: string[];
  
  /** Custom parameters */
  customParameters: Record<string, any>;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Last updated timestamp */
  updatedAt: number;
  
  /** Parent strategy ID (if evolved) */
  parentId?: string;
}

/**
 * Create a default trading strategy template
 */
export function createDefaultStrategy(id: string): TradingStrategy {
  return {
    id,
    name: 'Default Strategy',
    version: '1.0.0',
    description: 'A default trading strategy template',
    indicators: {
      rsi: {
        enabled: true,
        weight: 1.0,
        period: 14,
        overboughtThreshold: 70,
        oversoldThreshold: 30
      } as RSIIndicator,
      macd: {
        enabled: true,
        weight: 1.0,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9
      } as MACDIndicator,
      bollingerBands: {
        enabled: true,
        weight: 1.0,
        period: 20,
        stdDev: 2
      } as BollingerBandsIndicator
    },
    riskParameters: {
      maxPositionSize: 0.1,
      stopLoss: 0.02,
      takeProfit: 0.04,
      maxDrawdown: 0.15,
      maxOpenPositions: 3
    },
    signalSettings: {
      threshold: 0.6,
      minConfidence: 0.7,
      combinationMethod: 'weighted',
      entryConditions: [
        {
          type: 'rsi_oversold',
          parameters: { threshold: 30 }
        },
        {
          type: 'macd_crossover',
          parameters: { direction: 'bullish' },
          operator: 'AND'
        }
      ],
      exitConditions: [
        {
          type: 'rsi_overbought',
          parameters: { threshold: 70 }
        },
        {
          type: 'price_target',
          parameters: { target: 'take_profit' },
          operator: 'OR'
        },
        {
          type: 'stop_loss',
          parameters: { limit: 'stop_loss' },
          operator: 'OR'
        }
      ]
    },
    timeSettings: {
      tradingHours: {
        start: '09:30',
        end: '16:00'
      },
      tradingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      timeframe: '1h'
    },
    assetClasses: ['crypto', 'stocks'],
    marketConditions: ['trending', 'range_bound'],
    customParameters: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/**
 * Clone a trading strategy
 */
export function cloneStrategy(strategy: TradingStrategy, newId: string): TradingStrategy {
  return {
    ...JSON.parse(JSON.stringify(strategy)),
    id: newId,
    parentId: strategy.id,
    updatedAt: Date.now()
  };
} 