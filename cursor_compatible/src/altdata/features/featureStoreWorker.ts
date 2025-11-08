/**
 * Feature Store Worker
 * Consumes scored headlines and generates features for ML models
 */

import Redis from 'ioredis';
import { EnrichedHeadline, RedisKeys as HeadlineKeys } from '../types';
import { 
  AssetFeatureSet, 
  FeatureStoreConfig, 
  FeatureStoreConnections, 
  TimeBin 
} from './types';
import { generateFeatureSets } from './reducer';
import { FeaturePublisher } from './featurePublisher';
import { Logger } from '../../common/logger';

// Default configuration
const DEFAULT_CONFIG: FeatureStoreConfig = {
  timeBins: [
    TimeBin.ONE_MINUTE,
    TimeBin.FIVE_MINUTES,
    TimeBin.ONE_HOUR,
    TimeBin.ONE_DAY,
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

export class FeatureStoreWorker {
  private redis: Redis;
  private featurePublisher: FeaturePublisher;
  private config: FeatureStoreConfig;
  private logger: Logger;
  private running: boolean = false;
  private batchSize: number = 10;
  private pollingInterval: number = 5000; // 5 seconds
  private headlineBuffer: Map<string, EnrichedHeadline[]> = new Map();
  private lastProcessingTime: Map<TimeBin, number> = new Map();

  constructor(
    connections: FeatureStoreConnections,
    config: Partial<FeatureStoreConfig> = {},
    logger?: Logger
  ) {
    this.redis = new Redis(connections.redisUrl);
    this.logger = logger || console;
    
    // Merge with default config
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      // Merge nested objects
      featuresTimeToLive: {
        ...DEFAULT_CONFIG.featuresTimeToLive,
        ...(config.featuresTimeToLive || {}),
      },
    };
    
    // Initialize feature publisher
    this.featurePublisher = new FeaturePublisher(
      connections,
      this.config,
      this.logger
    );
  }

  /**
   * Initialize the feature store worker
   */
  public async initialize(): Promise<void> {
    await this.featurePublisher.initialize();
    
    // Initialize processing time tracking
    for (const timeBin of this.config.timeBins) {
      this.lastProcessingTime.set(timeBin, Date.now());
    }
    
    this.logger.info('Feature store worker initialized');
  }

  /**
   * Process a batch of headlines from Redis
   */
  private async processBatch(): Promise<number> {
    try {
      // Get batch of headlines from Redis
      const result = await this.redis.xrange(
        HeadlineKeys.SCORED_NEWS,
        '-', // Start from the beginning
        '+', // Up to the end
        'COUNT', this.batchSize
      );

      if (result.length === 0) {
        return 0;
      }

      // Process each headline
      let processed = 0;
      for (const [id, fields] of result) {
        // Get enriched headline data
        const headlineData = fields.find((f: any[]) => f[0] === 'data')?.[1];
        if (!headlineData) continue;

        // Parse JSON
        try {
          const headline = JSON.parse(headlineData) as EnrichedHeadline;
          
          // Buffer headline by asset
          for (const asset of headline.assetMentions) {
            if (!this.headlineBuffer.has(asset)) {
              this.headlineBuffer.set(asset, []);
            }
            this.headlineBuffer.get(asset)?.push(headline);
          }
          
          processed++;

          // Remove from input queue
          await this.redis.xdel(HeadlineKeys.SCORED_NEWS, id);
        } catch (error) {
          this.logger.error(`Error parsing headline: ${error}`);
          // Remove malformed entries to avoid blocking the queue
          await this.redis.xdel(HeadlineKeys.SCORED_NEWS, id);
        }
      }

      return processed;
    } catch (error) {
      this.logger.error(`Error processing batch: ${error}`);
      return 0;
    }
  }

  /**
   * Check if it's time to process a time bin
   */
  private shouldProcessTimeBin(timeBin: TimeBin): boolean {
    const now = Date.now();
    const lastProcessed = this.lastProcessingTime.get(timeBin) || 0;
    
    let minimumInterval: number;
    
    switch (timeBin) {
      case TimeBin.ONE_MINUTE:
        minimumInterval = 60 * 1000; // 1 minute
        break;
      case TimeBin.FIVE_MINUTES:
        minimumInterval = 5 * 60 * 1000; // 5 minutes
        break;
      case TimeBin.FIFTEEN_MINUTES:
        minimumInterval = 15 * 60 * 1000; // 15 minutes
        break;
      case TimeBin.ONE_HOUR:
        minimumInterval = 60 * 60 * 1000; // 1 hour
        break;
      case TimeBin.FOUR_HOURS:
        minimumInterval = 4 * 60 * 60 * 1000; // 4 hours
        break;
      case TimeBin.ONE_DAY:
        minimumInterval = 24 * 60 * 60 * 1000; // 1 day
        break;
      default:
        minimumInterval = 5 * 60 * 1000; // Default to 5 minutes
    }
    
    return (now - lastProcessed) >= minimumInterval;
  }

  /**
   * Generate and store features for all time bins that need updating
   */
  private async generateFeatures(): Promise<number> {
    let featuresGenerated = 0;
    
    // Process each time bin that is due for an update
    for (const timeBin of this.config.timeBins) {
      if (!this.shouldProcessTimeBin(timeBin)) {
        continue;
      }
      
      this.logger.debug(`Generating features for ${timeBin} time bin`);
      
      // Filter to only relevant assets
      const assets = this.config.targetAssets.filter(asset => 
        this.headlineBuffer.has(asset) && 
        (this.headlineBuffer.get(asset)?.length || 0) >= this.config.minHeadlineCount
      );
      
      if (assets.length === 0) {
        continue;
      }
      
      // Generate feature sets for all assets in this time bin
      const allHeadlines = Array.from(this.headlineBuffer.values()).flat();
      const featureSets = generateFeatureSets(allHeadlines, assets, timeBin);
      
      // Publish each feature set
      for (const [asset, featureSetsForAsset] of featureSets.entries()) {
        for (const featureSet of featureSetsForAsset) {
          await this.featurePublisher.publishFeatureSet(featureSet, timeBin);
          featuresGenerated++;
        }
      }
      
      // Update last processing time
      this.lastProcessingTime.set(timeBin, Date.now());
    }
    
    return featuresGenerated;
  }
  
  /**
   * Trim headline buffer to remove old headlines
   */
  private pruneHeadlineBuffer(): void {
    const now = new Date();
    const maxAgeMs = this.config.maxBinAge * 60 * 60 * 1000; // Convert hours to ms
    
    for (const [asset, headlines] of this.headlineBuffer.entries()) {
      // Filter out headlines older than max age
      const filteredHeadlines = headlines.filter(headline => {
        const headlineDate = new Date(headline.publishedAt);
        return (now.getTime() - headlineDate.getTime()) <= maxAgeMs;
      });
      
      if (filteredHeadlines.length === 0) {
        this.headlineBuffer.delete(asset);
      } else {
        this.headlineBuffer.set(asset, filteredHeadlines);
      }
    }
  }

  /**
   * Main worker loop
   */
  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Initialize the worker
    await this.initialize();

    this.running = true;
    this.logger.info('Feature store worker started');

    while (this.running) {
      // Process headlines
      const processed = await this.processBatch();
      
      if (processed > 0) {
        this.logger.info(`Processed ${processed} headlines`);
      }
      
      // Generate features if needed
      const featuresGenerated = await this.generateFeatures();
      
      if (featuresGenerated > 0) {
        this.logger.info(`Generated ${featuresGenerated} feature sets`);
      }
      
      // Periodically clean up old headlines
      this.pruneHeadlineBuffer();
      
      // Wait before polling again if no activity
      if (processed === 0 && featuresGenerated === 0) {
        await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
      }
    }
  }

  /**
   * Stop the worker
   */
  public stop(): void {
    this.running = false;
    this.logger.info('Feature store worker stopped');
  }

  /**
   * Clean up resources
   */
  public async close(): Promise<void> {
    this.stop();
    await this.redis.quit();
    await this.featurePublisher.close();
  }
} 