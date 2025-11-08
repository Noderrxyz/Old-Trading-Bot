/**
 * Reducer for aggregating headlines into features
 * Groups headlines by asset and time bins to create model features
 */

import { EnrichedHeadline, HeadlineCategory } from '../types';
import { AssetFeatureSet, TimeBin } from './types';
import { calculateNormalizedEntropy } from './normalizer';
import { encodeCountsToFeatures } from './encoder';

/**
 * Convert a timestamp to the start of its time bin
 */
export function getBinTimestamp(date: Date, bin: TimeBin): Date {
  const result = new Date(date);
  
  switch (bin) {
    case TimeBin.ONE_MINUTE:
      result.setSeconds(0, 0);
      break;
    case TimeBin.FIVE_MINUTES:
      result.setMinutes(Math.floor(result.getMinutes() / 5) * 5, 0, 0);
      break;
    case TimeBin.FIFTEEN_MINUTES:
      result.setMinutes(Math.floor(result.getMinutes() / 15) * 15, 0, 0);
      break;
    case TimeBin.ONE_HOUR:
      result.setMinutes(0, 0, 0);
      break;
    case TimeBin.FOUR_HOURS:
      result.setHours(Math.floor(result.getHours() / 4) * 4, 0, 0, 0);
      break;
    case TimeBin.ONE_DAY:
      result.setHours(0, 0, 0, 0);
      break;
  }
  
  return result;
}

/**
 * Get the key for a time bin
 */
export function getTimeBinKey(date: Date | string, bin: TimeBin): string {
  const timestamp = typeof date === 'string' ? new Date(date) : date;
  const binTimestamp = getBinTimestamp(timestamp, bin);
  return binTimestamp.toISOString();
}

/**
 * Group headlines by asset and calculate statistics
 */
export function reduceHeadlinesByAsset(
  headlines: EnrichedHeadline[],
  asset: string,
  timeBin: TimeBin
): Map<string, EnrichedHeadline[]> {
  // Filter headlines that mention the target asset
  const relevantHeadlines = headlines.filter(headline => 
    headline.assetMentions.includes(asset)
  );
  
  // Group by time bin
  const headlinesByTimeBin = new Map<string, EnrichedHeadline[]>();
  
  for (const headline of relevantHeadlines) {
    const timestamp = new Date(headline.publishedAt);
    const binKey = getTimeBinKey(timestamp, timeBin);
    
    if (!headlinesByTimeBin.has(binKey)) {
      headlinesByTimeBin.set(binKey, []);
    }
    
    headlinesByTimeBin.get(binKey)?.push(headline);
  }
  
  return headlinesByTimeBin;
}

/**
 * Calculate statistics from headline groups
 */
export function calculateFeatureSet(
  headlines: EnrichedHeadline[],
  asset: string,
  timestamp: string
): AssetFeatureSet {
  // Initialize basic feature set
  const featureSet: AssetFeatureSet = {
    asset,
    timestamp,
    headline_count: headlines.length,
    avg_sentiment: 0,
    max_impact: 0,
    min_impact: 1,
    sentiment_volatility: 0,
    source_diversity: 0,
    avg_confidence: 0,
    category_counts: Object.values(HeadlineCategory).reduce((acc, category) => {
      acc[category] = 0;
      return acc;
    }, {} as Record<HeadlineCategory, number>),
    entity_counts: {},
    asset_mentions: {},
  };
  
  if (headlines.length === 0) {
    return featureSet;
  }
  
  // Calculate aggregations
  let sentimentSum = 0;
  let confidenceSum = 0;
  const sentiments: number[] = [];
  const sources = new Set<string>();
  const entities = new Map<string, number>();
  const assets = new Map<string, number>();
  
  for (const headline of headlines) {
    // Update sentiment stats
    sentimentSum += headline.sentiment;
    confidenceSum += headline.confidence;
    sentiments.push(headline.sentiment);
    
    // Track sources
    sources.add(headline.source);
    
    // Update max/min impact
    featureSet.max_impact = Math.max(featureSet.max_impact, headline.impactScore);
    featureSet.min_impact = Math.min(featureSet.min_impact, headline.impactScore);
    
    // Increment category count
    featureSet.category_counts[headline.category]++;
    
    // Increment entity counts
    for (const entity of headline.entities) {
      entities.set(entity, (entities.get(entity) || 0) + 1);
    }
    
    // Increment asset mention counts
    for (const mentionedAsset of headline.assetMentions) {
      assets.set(mentionedAsset, (assets.get(mentionedAsset) || 0) + 1);
    }
  }
  
  // Calculate averages
  featureSet.avg_sentiment = sentimentSum / headlines.length;
  featureSet.avg_confidence = confidenceSum / headlines.length;
  
  // Calculate standard deviation of sentiment (volatility)
  if (sentiments.length > 1) {
    const mean = featureSet.avg_sentiment;
    const sumSquaredDiff = sentiments.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
    featureSet.sentiment_volatility = Math.sqrt(sumSquaredDiff / sentiments.length);
  }
  
  // Calculate source diversity
  featureSet.source_diversity = sources.size;
  
  // Convert entity and asset maps to records
  featureSet.entity_counts = Object.fromEntries(entities);
  featureSet.asset_mentions = Object.fromEntries(assets);
  
  return featureSet;
}

/**
 * Generate feature sets for all assets and time bins
 */
export function generateFeatureSets(
  headlines: EnrichedHeadline[],
  assets: string[],
  timeBin: TimeBin
): Map<string, AssetFeatureSet[]> {
  const featureSetsByAsset = new Map<string, AssetFeatureSet[]>();
  
  for (const asset of assets) {
    const headlinesByTimeBin = reduceHeadlinesByAsset(headlines, asset, timeBin);
    const featureSets: AssetFeatureSet[] = [];
    
    for (const [binKey, binHeadlines] of headlinesByTimeBin.entries()) {
      const featureSet = calculateFeatureSet(binHeadlines, asset, binKey);
      featureSets.push(featureSet);
    }
    
    featureSetsByAsset.set(asset, featureSets);
  }
  
  return featureSetsByAsset;
}

/**
 * Flatten a feature set for storage as a single record
 * Useful for serializing to JSON or storing in a database
 */
export function flattenFeatureSet(featureSet: AssetFeatureSet): Record<string, number | string> {
  const flatFeatures: Record<string, number | string> = {
    asset: featureSet.asset,
    timestamp: featureSet.timestamp,
    headline_count: featureSet.headline_count,
    avg_sentiment: featureSet.avg_sentiment,
    max_impact: featureSet.max_impact,
    min_impact: featureSet.min_impact,
    sentiment_volatility: featureSet.sentiment_volatility,
    source_diversity: featureSet.source_diversity,
    avg_confidence: featureSet.avg_confidence,
    source_entropy: calculateNormalizedEntropy(featureSet.entity_counts)
  };
  
  // Add category counts
  Object.entries(featureSet.category_counts).forEach(([category, count]) => {
    flatFeatures[`${category.toLowerCase()}_count`] = count;
  });
  
  // Calculate and add category proportions
  const totalCategories = Object.values(featureSet.category_counts).reduce((sum, count) => sum + count, 0);
  Object.entries(featureSet.category_counts).forEach(([category, count]) => {
    flatFeatures[`${category.toLowerCase()}_proportion`] = totalCategories > 0 ? count / totalCategories : 0;
  });
  
  // Add top entities (limit to most frequent to avoid explosion of features)
  const topEntities = Object.entries(featureSet.entity_counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
    
  topEntities.forEach(([entity, count]) => {
    flatFeatures[`entity_${entity.toLowerCase()}`] = count;
  });
  
  // Add related asset mentions
  Object.entries(featureSet.asset_mentions)
    .filter(([mentionedAsset]) => mentionedAsset !== featureSet.asset) // Exclude self-mentions
    .forEach(([mentionedAsset, count]) => {
      flatFeatures[`mentioned_${mentionedAsset.toLowerCase()}`] = count;
    });
    
  return flatFeatures;
} 