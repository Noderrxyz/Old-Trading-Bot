/**
 * Position direction enum (long or short)
 */
export enum PositionDirection {
  Long = 'long',
  Short = 'short'
}

/**
 * Position data object
 */
export interface Position {
  id: string;
  symbol: string;
  venue: string;
  size: number;
  value: number;
  direction: PositionDirection;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  timestamp: Date;
} 