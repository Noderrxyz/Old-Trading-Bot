export type MarketRegime = 'bull' | 'bear' | 'chop';

export interface AlphaMetrics {
  roi: number;
  sharpeRatio: number;
  maxDrawdown: number;
  trust: number;
  volatility: number;
  winRate: number;
  avgTradeDuration: number;
  pnlHistory: number[];
}

export interface AlphaSnapshot {
  id: string;
  name: string;
  market: string;
  regime: 'bull' | 'bear' | 'chop';
  status: 'live' | 'paused' | 'error';
  metrics: AlphaMetrics;
  timestamp: number;
  strategy: string;
  tags: string[];
  parentId?: string;
  lineage: string[];
}

export interface AlphaQuery {
  regime?: MarketRegime;
  minSharpeRatio?: number;
  minTrust?: number;
  maxDrawdown?: number;
  minWinRate?: number;
}

export interface RegimeMetrics {
  priceSlope: number;
  realizedVolatility: number;
  tvlDelta: number;
  volumeDelta: number;
  confidence: number;
  timestamp: string;
}

export interface TrustMomentum {
  current: number;
  trend: number;
  acceleration: number;
  consistency: number;
} 