/**
 * Global trend signal and consensus system types
 */

export interface TrendSignal {
  agentId: string;
  asset: string;
  timeframe: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: number; // 0 to 1
  timestamp: number;
} 