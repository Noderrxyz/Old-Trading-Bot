// Market Intelligence Types - Institutional Grade
// Comprehensive type definitions for market analysis and intelligence gathering

export interface OrderflowData {
  timestamp: number;
  exchange: string;
  pair: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  aggressor: 'maker' | 'taker';
  isWhale: boolean;
  orderType: 'market' | 'limit' | 'stop';
  metadata?: {
    orderId?: string;
    userId?: string;
    region?: string;
  };
}

export interface WhaleMovement {
  timestamp: number;
  walletAddress: string;
  asset: string;
  amount: number;
  direction: 'in' | 'out';
  source: string;
  destination: string;
  txHash: string;
  usdValue: number;
  impactScore: number; // 0-100
  confidence: number; // 0-1
}

export interface ExchangeFlow {
  exchange: string;
  asset: string;
  period: string;
  netFlow: number;
  inflow: number;
  outflow: number;
  flowRatio: number;
  volumeWeightedAvgPrice: number;
  largeTransactions: number;
  whaleTransactions: number;
}

export interface OrderbookImbalance {
  exchange: string;
  pair: string;
  timestamp: number;
  bidDepth: number;
  askDepth: number;
  imbalanceRatio: number;
  bidWallSize: number;
  askWallSize: number;
  microstructureScore: number;
  liquidityScore: number;
}

export interface SentimentData {
  source: 'twitter' | 'reddit' | 'telegram' | 'discord' | 'news' | 'analyst';
  timestamp: number;
  content: string;
  asset?: string;
  sentimentScore: number; // -1 to 1
  confidence: number; // 0 to 1
  reach: number; // audience size
  engagement: number; // likes, retweets, etc
  influence: number; // weighted by source credibility
  topics: string[];
  entities: string[];
}

export interface SentimentAggregate {
  asset: string;
  timestamp: number;
  overallSentiment: number;
  socialSentiment: number;
  newsSentiment: number;
  analystSentiment: number;
  volumeWeightedSentiment: number;
  sentimentMomentum: number;
  controversyScore: number;
  sources: number;
  dataPoints: number;
}

export interface OnChainMetric {
  protocol: string;
  chain: string;
  metric: string;
  value: number;
  timestamp: number;
  change24h: number;
  change7d: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  percentile: number; // historical percentile
}

export interface DeFiMetrics {
  totalValueLocked: number;
  totalValueLockedChange24h: number;
  lendingRates: {
    [asset: string]: {
      supplyRate: number;
      borrowRate: number;
      utilization: number;
    };
  };
  liquidations24h: number;
  uniqueUsers24h: number;
  transactions24h: number;
  bridgeVolume24h: number;
  dexVolume24h: number;
}

export interface LiquidationData {
  protocol: string;
  chain: string;
  timestamp: number;
  liquidator: string;
  borrower: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: number;
  debtAmount: number;
  liquidationPrice: number;
  txHash: string;
  profitUSD: number;
}

export interface MacroData {
  indicator: string;
  value: number;
  timestamp: number;
  previousValue: number;
  forecast: number;
  actual: number;
  impact: 'high' | 'medium' | 'low';
  currency?: string;
  source: string;
}

export interface CorrelationMatrix {
  assets: string[];
  timeframe: string;
  correlations: number[][];
  timestamp: number;
  significance: number[][];
  rollingWindow: number;
}

export interface MarketRegime {
  regime: 'bull' | 'bear' | 'neutral' | 'volatile';
  confidence: number;
  timestamp: number;
  indicators: {
    trend: number;
    volatility: number;
    momentum: number;
    breadth: number;
    sentiment: number;
  };
  duration: number;
  strength: number;
}

export interface EventRisk {
  event: string;
  timestamp: number;
  impact: 'high' | 'medium' | 'low';
  probability: number;
  affectedAssets: string[];
  expectedVolatility: number;
  historicalImpact?: {
    avgMove: number;
    maxMove: number;
    duration: number;
  };
}

export interface IntelAlert {
  id: string;
  timestamp: number;
  type: 'whale' | 'sentiment' | 'onchain' | 'macro' | 'anomaly' | 'regime';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedAssets: string[];
  metrics: Record<string, any>;
  actionRequired: boolean;
  suggestedActions?: string[];
}

export interface MarketIntelConfig {
  orderflowAnalysis: {
    enabled: boolean;
    exchanges: string[];
    whaleThreshold: number;
    updateInterval: number;
  };
  sentimentAnalysis: {
    enabled: boolean;
    sources: string[];
    languages: string[];
    mlModelVersion: string;
    updateInterval: number;
  };
  onchainMetrics: {
    enabled: boolean;
    chains: string[];
    protocols: string[];
    metrics: string[];
    updateInterval: number;
  };
  macroData: {
    enabled: boolean;
    indicators: string[];
    regions: string[];
    updateInterval: number;
  };
  alerts: {
    enabled: boolean;
    channels: string[];
    thresholds: Record<string, number>;
  };
}

export interface IntelReport {
  timestamp: number;
  marketRegime: MarketRegime;
  keyFindings: string[];
  riskEvents: EventRisk[];
  opportunities: {
    asset: string;
    type: string;
    confidence: number;
    reasoning: string;
    expectedReturn: number;
    risk: number;
  }[];
  correlations: CorrelationMatrix;
  alerts: IntelAlert[];
  summary: string;
}

export interface DataSource {
  name: string;
  type: 'websocket' | 'rest' | 'graphql' | 'grpc';
  endpoint: string;
  credentials?: {
    apiKey?: string;
    secret?: string;
    token?: string;
  };
  rateLimit?: {
    requests: number;
    period: number;
  };
  status: 'active' | 'inactive' | 'error';
  lastUpdate: number;
  reliability: number; // 0-1
}

export interface DataQuality {
  source: string;
  metric: string;
  completeness: number; // 0-1
  accuracy: number; // 0-1
  timeliness: number; // 0-1
  consistency: number; // 0-1
  overallScore: number; // 0-1
  issues: string[];
  lastCheck: number;
}

export enum IntelErrorCode {
  DATA_SOURCE_ERROR = 'DATA_SOURCE_ERROR',
  ANALYSIS_ERROR = 'ANALYSIS_ERROR',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  MODEL_ERROR = 'MODEL_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_CONFIG = 'INVALID_CONFIG'
}

export class IntelError extends Error {
  constructor(
    public code: IntelErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'IntelError';
  }
} 