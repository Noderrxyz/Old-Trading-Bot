/**
 * Strategy Types
 * 
 * Defines interfaces and types for trading strategies.
 */

/**
 * Strategy metrics interface
 */
export interface StrategyMetrics {
  trustScore: number;           // Current trust score (0-1)
  recentPnL: number[];          // Recent profit/loss values
  lastTradeTime: number;        // Timestamp of last trade
  totalTrades: number;          // Total number of trades
  winRate: number;              // Win rate (0-1)
  averageWin: number;           // Average winning trade
  averageLoss: number;          // Average losing trade
  maxDrawdown: number;          // Maximum drawdown
  sharpeRatio: number;          // Risk-adjusted return metric
  sortinoRatio: number;         // Downside risk-adjusted return metric
  volatility: number;           // Price volatility
  alpha: number;                // Excess return over benchmark
  beta: number;                 // Market correlation
}

/**
 * Strategy parameters interface
 */
export interface StrategyParameters {
  stopLossPct: number;          // Stop loss percentage
  takeProfitPct: number;        // Take profit percentage
  positionSize: number;         // Position size in base currency
  maxOpenPositions: number;     // Maximum number of open positions
  timeframe: string;            // Trading timeframe
  indicators: {                 // Technical indicators
    rsi?: {
      period: number;
      overbought: number;
      oversold: number;
    };
    macd?: {
      fastPeriod: number;
      slowPeriod: number;
      signalPeriod: number;
    };
  };
}

/**
 * Strategy state interface
 */
export interface StrategyState {
  isActive: boolean;            // Whether strategy is active
  isPaused: boolean;            // Whether strategy is paused
  lastUpdateTime: number;       // Last update timestamp
  currentPositions: string[];   // List of current position IDs
  pendingOrders: string[];      // List of pending order IDs
} 