/**
 * Feature Store Integration
 * 
 * This module provides the entry point for the feature store integration.
 * It transforms NLP-scored headlines into structured, queryable features for machine learning models.
 */

import { FeatureStoreWorker } from './featureStoreWorker';
import { FeaturePublisher } from './featurePublisher';
import { 
  AssetFeatureSet, 
  FeatureStoreConfig, 
  FeatureStoreConnections, 
  FeatureWindowConfig, 
  TimeBin 
} from './types';
import { 
  alignFeatureWithMarketData, 
  createTimeAlignedDataset, 
  flattenAlignedData,
  AlignedDataPoint,
  MarketDataPoint,
  TimeAlignmentOptions
} from './timeAligner';
import { createLogger } from '../../common/logger';

// Re-export types and components for external use
export { 
  FeatureStoreWorker,
  FeaturePublisher,
  AssetFeatureSet,
  FeatureStoreConfig,
  FeatureStoreConnections,
  FeatureWindowConfig,
  TimeBin,
  // Time alignment utilities
  alignFeatureWithMarketData,
  createTimeAlignedDataset,
  flattenAlignedData,
  AlignedDataPoint,
  MarketDataPoint,
  TimeAlignmentOptions
};

// Default configuration for the feature store
const DEFAULT_CONFIG: FeatureStoreConfig = {
  timeBins: [
    TimeBin.ONE_MINUTE,
    TimeBin.FIVE_MINUTES,
    TimeBin.FIFTEEN_MINUTES,
    TimeBin.ONE_HOUR,
    TimeBin.FOUR_HOURS, 
    TimeBin.ONE_DAY
  ],
  featuresTimeToLive: {
    [TimeBin.ONE_MINUTE]: 60 * 60 * 6,       // 6 hours
    [TimeBin.FIVE_MINUTES]: 60 * 60 * 24,    // 1 day
    [TimeBin.FIFTEEN_MINUTES]: 60 * 60 * 24 * 3, // 3 days
    [TimeBin.ONE_HOUR]: 60 * 60 * 24 * 7,    // 7 days
    [TimeBin.FOUR_HOURS]: 60 * 60 * 24 * 14, // 14 days
    [TimeBin.ONE_DAY]: 60 * 60 * 24 * 30,    // 30 days
  },
  normalizeValues: true,
  encodeCategories: true,
  targetAssets: ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'AVAX', 'DOT', 'LINK', 'MATIC', 'DOGE'],
  minHeadlineCount: 2,
  maxBinAge: 24 * 7, // 7 days in hours
};

// Feature store instance
let featureStoreWorker: FeatureStoreWorker | null = null;
let featurePublisher: FeaturePublisher | null = null;

/**
 * Initialize the feature store system
 * @param connections Connection details for Redis and Postgres
 * @param config Optional configuration overrides
 * @returns The initialized FeatureStoreWorker instance
 */
export async function initializeFeatureStore(
  connections: FeatureStoreConnections,
  config: Partial<FeatureStoreConfig> = {}
): Promise<FeatureStoreWorker> {
  const logger = createLogger('FeatureStore');
  logger.info('Initializing feature store');

  // Create configuration by merging defaults with provided config
  const mergedConfig: FeatureStoreConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    // Deep merge for nested objects
    featuresTimeToLive: {
      ...DEFAULT_CONFIG.featuresTimeToLive,
      ...(config.featuresTimeToLive || {}),
    },
  };

  // Initialize the feature publisher for direct feature access
  featurePublisher = new FeaturePublisher(connections, mergedConfig, logger);
  await featurePublisher.initialize();

  // Initialize the worker that processes headlines and generates features
  featureStoreWorker = new FeatureStoreWorker(connections, mergedConfig, logger);
  await featureStoreWorker.initialize();

  logger.info('Feature store initialized successfully');
  return featureStoreWorker;
}

/**
 * Start the feature store worker
 * @returns A promise that resolves when the worker has started
 */
export async function startFeatureStore(): Promise<void> {
  if (!featureStoreWorker) {
    throw new Error('Feature store has not been initialized. Call initializeFeatureStore first.');
  }

  await featureStoreWorker.start();
}

/**
 * Stop the feature store worker
 */
export function stopFeatureStore(): void {
  if (featureStoreWorker) {
    featureStoreWorker.stop();
  }
}

/**
 * Get the latest feature set for an asset
 * @param asset The asset symbol
 * @param timeBin The time bin to retrieve
 * @returns The latest feature set or null if not found
 */
export async function getLatestFeatures(
  asset: string, 
  timeBin: TimeBin
): Promise<AssetFeatureSet | null> {
  if (!featurePublisher) {
    throw new Error('Feature store has not been initialized. Call initializeFeatureStore first.');
  }

  return featurePublisher.getLatestFeatureSet(asset, timeBin);
}

/**
 * Get a window of features for an asset
 * @param config The window configuration (asset, time range, bin size)
 * @returns An array of feature sets within the time window
 */
export async function getFeatureWindow(
  config: FeatureWindowConfig
): Promise<AssetFeatureSet[]> {
  if (!featurePublisher) {
    throw new Error('Feature store has not been initialized. Call initializeFeatureStore first.');
  }

  return featurePublisher.getFeatureWindow(
    config.asset,
    config.startTime,
    config.endTime,
    config.timeBin
  );
}

/**
 * Get aligned features with market data for an asset
 * @param asset The asset symbol
 * @param startTime Start time for data window
 * @param endTime End time for data window
 * @param timeBin Time bin to use for alignment
 * @param marketData Market data to align with
 * @param options Alignment options
 * @returns Array of aligned data points
 */
export async function getAlignedFeatures(
  asset: string,
  startTime: Date | string,
  endTime: Date | string,
  timeBin: TimeBin,
  marketData: MarketDataPoint[],
  options: TimeAlignmentOptions = {}
): Promise<AlignedDataPoint[]> {
  if (!featurePublisher) {
    throw new Error('Feature store has not been initialized. Call initializeFeatureStore first.');
  }

  const features = await featurePublisher.getFeatureWindow(
    asset,
    startTime,
    endTime,
    timeBin
  );

  return alignFeatureWithMarketData(features, marketData, timeBin, options);
}

/**
 * Close the feature store connections
 */
export async function closeFeatureStore(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  if (featureStoreWorker) {
    closePromises.push(featureStoreWorker.close());
    featureStoreWorker = null;
  }

  if (featurePublisher) {
    closePromises.push(featurePublisher.close());
    featurePublisher = null;
  }

  await Promise.all(closePromises);
} 