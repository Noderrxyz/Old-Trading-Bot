import { logger } from '../../utils/logger.js';

/**
 * Drawdown configuration
 */
export interface DrawdownConfig {
  maxDrawdownPct: number;
  rollingWindowSize: number;
  alertThresholdPct: number;
  cooldownPeriodMs: number;
  minTradesForDrawdown: number;
}

/**
 * Default drawdown configuration
 */
export const DEFAULT_DRAWDOWN_CONFIG: DrawdownConfig = {
  maxDrawdownPct: 0.1, // 10% max drawdown
  rollingWindowSize: 100, // Last 100 trades
  alertThresholdPct: 0.08, // Alert at 8% drawdown
  cooldownPeriodMs: 3600000, // 1 hour cooldown
  minTradesForDrawdown: 10 // Minimum trades needed for drawdown calculation
};

/**
 * Trade data point
 */
export interface TradeDataPoint {
  timestamp: number;
  pnl: number;
  equity: number;
  tradeId: string;
}

/**
 * Drawdown window
 */
export interface DrawdownWindow {
  startTime: number;
  endTime: number;
  peakEquity: number;
  currentEquity: number;
  trades: TradeDataPoint[];
}

/**
 * Drawdown event type
 */
export enum DrawdownEventType {
  ALERT = 'alert',
  BREACH = 'breach',
  RECOVERY = 'recovery',
  COOLDOWN = 'cooldown'
}

/**
 * Drawdown event
 */
export interface DrawdownEvent {
  type: DrawdownEventType;
  timestamp: number;
  agentId: string;
  drawdownPct: number;
  peakEquity: number;
  currentEquity: number;
  message: string;
}

/**
 * Drawdown state
 */
export interface DrawdownState {
  agentId: string;
  isActive: boolean;
  cooldownEndTime?: number;
  currentDrawdownPct: number;
  peakEquity: number;
  currentEquity: number;
  lastEvent?: DrawdownEvent;
  tradeHistory: TradeDataPoint[];
} 