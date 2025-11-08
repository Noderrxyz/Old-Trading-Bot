/**
 * Time Aligner for Feature Store
 * 
 * Provides utilities to align feature data with other time-series data (price, volume, etc.)
 * for creating properly joined datasets for machine learning models.
 */

import { AssetFeatureSet, TimeBin } from './types';
import { getBinTimestamp } from './reducer';

/**
 * Market data point with timestamp
 */
export interface MarketDataPoint {
  timestamp: string | Date;
  [key: string]: any; // Additional market data fields (price, volume, etc.)
}

/**
 * Aligned data point with features and market data
 */
export interface AlignedDataPoint {
  timestamp: string;
  asset: string;
  features: Omit<AssetFeatureSet, 'asset' | 'timestamp'>;
  market: Omit<MarketDataPoint, 'timestamp'>;
}

/**
 * Options for time alignment
 */
export interface TimeAlignmentOptions {
  maxTimeGap?: number; // Maximum allowed time difference in milliseconds
  interpolate?: boolean; // Whether to interpolate missing values
  defaultValues?: Partial<AssetFeatureSet>; // Default values for missing features
}

/**
 * Normalize all timestamps to a consistent format
 */
function normalizeTimestamp(timestamp: string | Date): Date {
  return typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
}

/**
 * Align feature data with market data based on timestamps
 * @param features Array of feature sets
 * @param marketData Array of market data points
 * @param timeBin The time bin to use for alignment
 * @param options Alignment options
 * @returns Array of aligned data points
 */
export function alignFeatureWithMarketData(
  features: AssetFeatureSet[],
  marketData: MarketDataPoint[],
  timeBin: TimeBin,
  options: TimeAlignmentOptions = {}
): AlignedDataPoint[] {
  if (features.length === 0 || marketData.length === 0) {
    return [];
  }

  const {
    maxTimeGap = 60000, // Default to 1 minute
    interpolate = false,
    defaultValues = {}
  } = options;

  // Get asset from features (assuming all features are for the same asset)
  const asset = features[0].asset;

  // Create maps for easier lookup by timestamp
  const featureMap = new Map<string, AssetFeatureSet>();
  for (const feature of features) {
    const timestamp = normalizeTimestamp(feature.timestamp);
    const binTimestamp = getBinTimestamp(timestamp, timeBin);
    featureMap.set(binTimestamp.toISOString(), feature);
  }

  const marketDataMap = new Map<string, MarketDataPoint>();
  for (const dataPoint of marketData) {
    const timestamp = normalizeTimestamp(dataPoint.timestamp);
    const binTimestamp = getBinTimestamp(timestamp, timeBin);
    marketDataMap.set(binTimestamp.toISOString(), dataPoint);
  }

  // Find common timestamps or nearest matches within the allowed gap
  const alignedData: AlignedDataPoint[] = [];
  
  // Use the market data timestamps as the base for alignment
  for (const [marketTimestamp, marketPoint] of marketDataMap.entries()) {
    // Try to find an exact match first
    let featurePoint = featureMap.get(marketTimestamp);
    
    // If no exact match and interpolation is enabled, find the nearest feature
    if (!featurePoint && interpolate) {
      const marketTime = normalizeTimestamp(marketTimestamp).getTime();
      
      // Find nearest feature timestamp
      let nearestFeature: AssetFeatureSet | null = null;
      let minDiff = Infinity;
      
      for (const [featureTimestamp, feature] of featureMap.entries()) {
        const featureTime = normalizeTimestamp(featureTimestamp).getTime();
        const timeDiff = Math.abs(marketTime - featureTime);
        
        if (timeDiff < minDiff && timeDiff <= maxTimeGap) {
          minDiff = timeDiff;
          nearestFeature = feature;
        }
      }
      
      featurePoint = nearestFeature || undefined;
    }
    
    // If we have a feature match (exact or within the time gap)
    if (featurePoint) {
      const { asset: _, timestamp: __, ...featureFields } = featurePoint;
      const { timestamp: ___, ...marketFields } = marketPoint;
      
      alignedData.push({
        timestamp: marketTimestamp,
        asset,
        features: featureFields,
        market: marketFields
      });
    }
  }

  return alignedData;
}

/**
 * Create a time-aligned dataset for model training or inference
 * @param features Feature sets for multiple assets
 * @param marketData Market data for multiple assets
 * @param timeBin Time bin to align on
 * @param options Alignment options
 * @returns Map of assets to their aligned data points
 */
export function createTimeAlignedDataset(
  features: AssetFeatureSet[],
  marketData: MarketDataPoint[],
  timeBin: TimeBin,
  options: TimeAlignmentOptions = {}
): Map<string, AlignedDataPoint[]> {
  // Group features by asset
  const featuresByAsset = new Map<string, AssetFeatureSet[]>();
  for (const feature of features) {
    if (!featuresByAsset.has(feature.asset)) {
      featuresByAsset.set(feature.asset, []);
    }
    featuresByAsset.get(feature.asset)?.push(feature);
  }
  
  // Group market data by asset
  const marketDataByAsset = new Map<string, MarketDataPoint[]>();
  for (const dataPoint of marketData) {
    // Assuming market data has an 'asset' property
    const asset = (dataPoint as any).asset;
    if (!asset) continue;
    
    if (!marketDataByAsset.has(asset)) {
      marketDataByAsset.set(asset, []);
    }
    marketDataByAsset.get(asset)?.push(dataPoint);
  }
  
  // Align data for each asset
  const alignedDataByAsset = new Map<string, AlignedDataPoint[]>();
  
  for (const [asset, assetFeatures] of featuresByAsset.entries()) {
    const assetMarketData = marketDataByAsset.get(asset) || [];
    
    if (assetMarketData.length > 0) {
      const alignedData = alignFeatureWithMarketData(
        assetFeatures,
        assetMarketData,
        timeBin,
        options
      );
      
      if (alignedData.length > 0) {
        alignedDataByAsset.set(asset, alignedData);
      }
    }
  }
  
  return alignedDataByAsset;
}

/**
 * Convert aligned data to a flat format suitable for ML models
 * @param alignedData Array of aligned data points
 * @returns Array of flat objects with all features as properties
 */
export function flattenAlignedData(
  alignedData: AlignedDataPoint[]
): Record<string, any>[] {
  return alignedData.map(dataPoint => {
    const { timestamp, asset, features, market } = dataPoint;
    
    return {
      timestamp,
      asset,
      // Flatten features with feature_ prefix
      ...Object.entries(features).reduce((acc, [key, value]) => {
        acc[`feature_${key}`] = value;
        return acc;
      }, {} as Record<string, any>),
      // Flatten market data with market_ prefix
      ...Object.entries(market).reduce((acc, [key, value]) => {
        acc[`market_${key}`] = value;
        return acc;
      }, {} as Record<string, any>)
    };
  });
} 