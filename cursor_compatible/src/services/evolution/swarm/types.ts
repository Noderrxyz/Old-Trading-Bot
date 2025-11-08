/**
 * Swarm Evolution Types
 * 
 * Type definitions for agent evolution and swarm intelligence.
 */

/**
 * Represents a measurable trait or characteristic of an agent
 */
export interface AgentTrait {
  /** Category of the trait (e.g., performance, behavior, risk) */
  category: string;
  
  /** Name of the trait */
  name: string;
  
  /** Value of the trait */
  value: number | string | boolean;
  
  /** Optional confidence score (0-1) */
  confidence?: number;
  
  /** Timestamp when this trait was recorded */
  timestamp?: number;
}

/**
 * Trait categories for agent classification
 */
export enum TraitCategory {
  /** Performance-related traits */
  PERFORMANCE = 'performance',
  
  /** Behavioral traits */
  BEHAVIOR = 'behavior',
  
  /** Risk management traits */
  RISK = 'risk',
  
  /** Time related preferences */
  TIMEFRAME = 'timeframe',
  
  /** Asset preferences */
  ASSET = 'asset',
  
  /** Market condition preferences */
  MARKET = 'market',
  
  /** Social and collaborative traits */
  SOCIAL = 'social'
}

/**
 * Agent trait definitions for common traits
 */
export const COMMON_TRAITS = {
  /** Win rate percentage */
  WIN_RATE: { category: TraitCategory.PERFORMANCE, name: 'winRate' },
  
  /** Return on investment */
  ROI: { category: TraitCategory.PERFORMANCE, name: 'roi' },
  
  /** Sharpe ratio */
  SHARPE: { category: TraitCategory.PERFORMANCE, name: 'sharpe' },
  
  /** Trade frequency (trades per day) */
  TRADE_FREQUENCY: { category: TraitCategory.BEHAVIOR, name: 'tradeFrequency' },
  
  /** Average holding time (in minutes) */
  HOLD_TIME: { category: TraitCategory.BEHAVIOR, name: 'holdTime' },
  
  /** Maximum drawdown percentage */
  MAX_DRAWDOWN: { category: TraitCategory.RISK, name: 'maxDrawdown' },
  
  /** Price volatility preference */
  VOLATILITY: { category: TraitCategory.RISK, name: 'volatility' },
  
  /** Preferred timeframe */
  TIMEFRAME_PREFERENCE: { category: TraitCategory.TIMEFRAME, name: 'preference' }
}; 