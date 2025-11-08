/**
 * Types for social signal unification and strategy model injection
 */

/**
 * Unified schema for social signals from different platforms
 */
export interface UnifiedSocialSignal {
  token: string;
  timestamp: number;
  sources: {
    twitterScore?: number;     // 0–100
    telegramScore?: number;
    redditScore?: number;
  };
  features: {
    sentiment: number;         // -1.0 to 1.0
    hype: number;              // 0–1 based on volume
    velocity: number;          // messages/min trend
    influencerWeight: number;  // 0–1 (based on author weight)
    riskFlags: string[];       // e.g. ['fomo', 'fud', 'manipulation']
  };
  raw?: {
    tweetIds?: string[];
    tgMessages?: string[];
    redditIds?: string[];
  };
}

/**
 * Configuration for the social feature unifier
 */
export interface FeatureUnifierConfig {
  // How many minutes to look back for social signals
  lookbackWindowMinutes: number;
  // How frequently (in ms) to update unified signals
  updateIntervalMs: number;
  // Redis connection config
  redisConfig: {
    url: string;
    ttlSeconds: number;
  };
  // Source-specific weights for the final unified score
  sourceWeights: {
    twitter: number;
    telegram: number;
    reddit: number;
  };
  // Thresholds for risk flag detection
  riskFlagThresholds: {
    fomo: number;      // Threshold for detecting FOMO
    fud: number;       // Threshold for detecting FUD
    manipulation: number; // Threshold for detecting manipulation attempts
  };
}

/**
 * Configuration for the model adapter
 */
export interface ModelAdapterConfig {
  // Default social influence weight if not specified by strategy
  defaultSocialInfluenceWeight: number;
  // How frequently (in ms) to update model inputs
  updateIntervalMs: number;
  // Maximum time (in ms) social signals are considered valid
  signalValidityPeriodMs: number;
}

/**
 * Configuration for the Redis publisher
 */
export interface RedisPublisherConfig {
  url: string;
  // How long signals should persist in Redis
  ttlSeconds: number;
  // Maximum number of signals to keep in stream per token
  maxStreamLength: number;
}

/**
 * Redis keys used by the social-signals module
 */
export enum SocialSignalRedisKeys {
  // Latest signal for a token
  SIGNAL_BUFFER = 'social_signal_buffer:',
  // Stream of signals for a token
  SIGNAL_STREAM = 'social_stream:',
  // Metrics for signal ingestion
  SIGNAL_METRICS = 'social_signal_metrics',
}

/**
 * Types of risk flags that can be detected in social signals
 */
export type RiskFlagType = 'fomo' | 'fud' | 'manipulation' | 'scam' | 'pump' | 'dump';

/**
 * Social signal update event for real-time processing
 */
export interface SocialSignalUpdateEvent {
  token: string;
  timestamp: number;
  signal: UnifiedSocialSignal;
  previousSignal?: UnifiedSocialSignal;
  // Computed metrics about the change
  changes?: {
    sentimentDelta: number;
    hypeDelta: number;
    velocityDelta: number;
    newRiskFlags: string[];
  };
} 