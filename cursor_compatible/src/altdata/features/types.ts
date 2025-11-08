/**
 * Core types for the feature store integration
 */

import { HeadlineCategory } from '../types';

/**
 * Time bins for aggregating features
 */
export enum TimeBin {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1d'
}

/**
 * Feature set for a specific asset and time bin
 */
export interface AssetFeatureSet {
  asset: string;                  // Asset symbol (e.g., "BTC", "ETH")
  timestamp: string;              // ISO timestamp for the feature bin
  headline_count: number;         // Number of headlines in the time window
  avg_sentiment: number;          // Average sentiment (0 to 1)
  max_impact: number;             // Maximum impact score (0 to 1)
  min_impact: number;             // Minimum impact score (0 to 1)
  sentiment_volatility: number;   // Standard deviation of sentiment
  source_diversity: number;       // Number of unique sources
  avg_confidence: number;         // Average confidence in headline scores
  category_counts: Record<HeadlineCategory, number>; // Count by category
  entity_counts: Record<string, number>;             // Count of entity mentions
  asset_mentions: Record<string, number>;            // Related asset mentions
}

/**
 * Configuration for feature extraction and storage
 */
export interface FeatureStoreConfig {
  timeBins: TimeBin[];                  // Time windows to aggregate features for
  featuresTimeToLive: Record<TimeBin, number>; // TTL in seconds for each time bin (Redis)
  normalizeValues: boolean;             // Whether to normalize values to 0-1 range
  encodeCategories: boolean;            // Whether to one-hot encode categorical features
  targetAssets: string[];               // Assets to generate features for
  minHeadlineCount: number;             // Minimum headline count to generate features
  maxBinAge: number;                    // Maximum age for historical bins (in hours)
}

/**
 * Feature store connection details
 */
export interface FeatureStoreConnections {
  redisUrl: string;                     // Redis connection for online feature store
  postgresUrl?: string;                 // Optional Postgres connection for offline store
}

/**
 * Window config for retrieving time-series features
 */
export interface FeatureWindowConfig {
  asset: string;
  startTime: Date | string;
  endTime: Date | string;
  timeBin: TimeBin;
}

/**
 * Redis keys for feature store
 */
export enum FeatureStoreKeys {
  FEATURE_KEY_PREFIX = 'features:',     // Prefix for all feature keys
  ASSET_LIST_KEY = 'features:assets',   // List of all assets with features
  TIME_BIN_INDEX = 'features:timebin:', // Index of time bins by asset
}

/**
 * Database table names for the offline feature store
 */
export enum FeatureStoreTables {
  FEATURES = 'ml_features',             // Main feature table
  ASSET_METADATA = 'ml_assets',         // Asset metadata
} 