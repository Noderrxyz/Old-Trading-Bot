/**
 * Position interface for unrealized PnL monitoring
 */
export interface Position {
  /** Position ID */
  id: string;
  
  /** Asset symbol */
  symbol: string;
  
  /** Current unrealized PnL */
  unrealizedPnl: number;
  
  /** Position size */
  size: number;
  
  /** Position side (long/short) */
  side: 'long' | 'short';
  
  /** Entry price */
  entryPrice: number;
  
  /** Current price */
  currentPrice: number;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Spike collapse exit event
 */
export interface SpikeCollapseExitEvent {
  /** Position ID */
  positionId: string;
  
  /** Asset symbol */
  symbol: string;
  
  /** Spike drop percentage */
  spikeDropPct: number;
  
  /** Peak PnL */
  peakPnl: number;
  
  /** Current PnL */
  currentPnl: number;
  
  /** Action taken */
  actionTaken: string;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * PnL protector configuration
 */
export interface UnrealizedPnLProtectorConfig {
  /** Whether protector is enabled */
  enabled: boolean;
  
  /** Spike drop percentage threshold */
  spikeDropPct: number;
  
  /** Spike window in seconds */
  spikeWindowSec: number;
  
  /** Check interval in seconds */
  checkIntervalSec: number;
  
  /** Exit action type */
  exitAction: 'market_sell' | 'market_buy';
  
  /** Alert webhook URL */
  alertWebhook?: string;
}

/**
 * Default PnL protector configuration
 */
export const DEFAULT_UNREALIZED_PNL_PROTECTOR_CONFIG: UnrealizedPnLProtectorConfig = {
  enabled: true,
  spikeDropPct: 30,
  spikeWindowSec: 5,
  checkIntervalSec: 5,
  exitAction: 'market_sell'
}; 