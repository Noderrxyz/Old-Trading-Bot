/**
 * Alpha Source Types
 * 
 * Common type definitions for alpha sources and signals
 */

/**
 * Configuration for an alpha source
 */
export interface AlphaSourceConfig {
  /** Whether the source is enabled */
  enabled: boolean;
  
  /** Refresh interval in milliseconds */
  refreshIntervalMs?: number;
  
  /** API credentials if needed */
  credentials?: Record<string, string>;
  
  /** Source-specific configuration */
  [key: string]: any;
}

/**
 * Twitter alpha source configuration
 */
export interface TwitterAlphaConfig extends AlphaSourceConfig {
  /** Twitter API credentials */
  credentials: {
    apiKey: string;
    apiSecret: string;
    bearerToken: string;
  };
  /** Twitter-specific settings */
  settings: {
    /** Max number of tweets to fetch per symbol */
    maxTweetsPerSymbol: number;
    /** Min tweet volume for generating signals */
    minTweetVolume: number;
    /** Weight for verified accounts (1.0 = no extra weight) */
    verifiedWeight: number;
    /** Weight for follower count influence */
    followerWeight: number;
    /** Keywords to track for bullish sentiment */
    bullishKeywords: string[];
    /** Keywords to track for bearish sentiment */
    bearishKeywords: string[];
  };
}

/**
 * Onchain alpha source configuration
 */
export interface OnchainAlphaConfig extends AlphaSourceConfig {
  /** Onchain-specific settings */
  settings: {
    /** RPC endpoints for different chains */
    rpcEndpoints: Record<string, string>;
    /** Metrics to track */
    metrics: Array<'liquidity' | 'volume' | 'velocity' | 'netflow' | 'concentration'>;
    /** Liquidity threshold for signal generation (USD) */
    minLiquidityThresholdUsd: number;
    /** Volume change threshold for signal generation (%) */
    volumeChangeThresholdPct: number;
  };
}

/**
 * Time bias adjustment configuration for AlphaHub
 */
export interface TimeBiasAdjustmentConfig {
  /** Whether time-of-day bias adjustment is enabled */
  enabled: boolean;
  
  /** Duration of each time bucket in minutes */
  bucketIntervalMinutes: number;
  
  /** Minimum number of data points needed before applying bias */
  minDataPoints: number;
  
  /** Smoothing factor for moving average calculations (0-1) */
  smoothing: number;
  
  /** Confidence adjustment clamp range [min, max] */
  clampRange: [number, number];
  
  /** Whether to log detailed adjustments */
  logDetailedAdjustments: boolean;
}

/**
 * Configuration for AlphaHub
 */
export interface AlphaHubConfig {
  /** List of supported asset symbols */
  supportedAssets: string[];
  /** Default refresh interval in milliseconds */
  defaultRefreshIntervalMs: number;
  /** Weight to apply to each source (0-1) */
  sourceWeights: Record<string, number>;
  /** Alpha source configurations */
  sources: {
    twitter?: TwitterAlphaConfig;
    onchain?: OnchainAlphaConfig;
    [key: string]: AlphaSourceConfig | undefined;
  };
  /** Time-of-day bias adjustment configuration */
  timeBias?: Partial<TimeBiasAdjustmentConfig>;
}

/**
 * Alpha frame representing a signal at a specific point in time
 */
export interface AlphaFrame {
  /** Source that generated this frame */
  source: string;
  /** Asset symbol (e.g., "BTC/USDC") */
  symbol: string;
  /** Alpha score (0-1) where 0 is bearish, 1 is bullish */
  score: number;
  /** Confidence in the signal (0-1) */
  confidence: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Time to live in milliseconds */
  ttl?: number;
  /** Optional additional metrics */
  metrics?: Record<string, number>;
  /** Optional raw data that contributed to the signal */
  rawData?: any;
  /** Detailed information about the signal */
  details?: Record<string, any>;
}

/**
 * Interface for an alpha source
 */
export interface AlphaSource {
  /** Initialize the alpha source */
  initialize(): Promise<void>;
  /** Get alpha signals from this source */
  getAlpha(): Promise<AlphaFrame[]>;
  /** Get the name of this alpha source */
  getName(): string;
  /** Check if this source is enabled */
  isEnabled(): boolean;
}

/**
 * Alpha source error
 */
export class AlphaSourceError extends Error {
  constructor(source: string, message: string, public readonly cause?: Error) {
    super(`[${source}] ${message}${cause ? `: ${cause.message}` : ''}`);
    this.name = 'AlphaSourceError';
  }
} 