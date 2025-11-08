/**
 * Feature publisher for storing features in Redis and Postgres
 * Handles both real-time (online) and historical (offline) feature storage
 */

import Redis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { 
  AssetFeatureSet, 
  FeatureStoreConfig, 
  FeatureStoreConnections,
  FeatureStoreKeys,
  FeatureStoreTables,
  TimeBin
} from './types';
import { flattenFeatureSet } from './reducer';
import { Logger } from '../../common/logger';

export class FeaturePublisher {
  private redis: Redis;
  private postgres: Pool | null = null;
  private config: FeatureStoreConfig;
  private logger: Logger;
  private initialized = false;

  constructor(
    connections: FeatureStoreConnections,
    config: FeatureStoreConfig,
    logger: Logger
  ) {
    this.redis = new Redis(connections.redisUrl);
    
    if (connections.postgresUrl) {
      this.postgres = new Pool({
        connectionString: connections.postgresUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
    }
    
    this.config = config;
    this.logger = logger;
  }

  /**
   * Initialize the feature stores
   * Creates necessary database schema and Redis structures
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Initialize PostgreSQL schema if available
      if (this.postgres) {
        const client = await this.postgres.connect();
        try {
          await this.initPostgresSchema(client);
        } finally {
          client.release();
        }
      }
      
      // Track the list of assets in Redis
      const assetList = this.config.targetAssets.join(',');
      await this.redis.set(FeatureStoreKeys.ASSET_LIST_KEY, assetList);
      
      this.initialized = true;
      this.logger.info('Feature store initialized successfully');
    } catch (error) {
      this.logger.error(`Error initializing feature store: ${error}`);
      throw error;
    }
  }

  /**
   * Initialize the PostgreSQL schema for feature storage
   */
  private async initPostgresSchema(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${FeatureStoreTables.FEATURES} (
        asset VARCHAR(10) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        time_bin VARCHAR(5) NOT NULL,
        headline_count INTEGER NOT NULL,
        avg_sentiment FLOAT NOT NULL,
        max_impact FLOAT NOT NULL,
        min_impact FLOAT NOT NULL,
        sentiment_volatility FLOAT NOT NULL,
        source_diversity INTEGER NOT NULL,
        avg_confidence FLOAT NOT NULL,
        source_entropy FLOAT NOT NULL,
        feature_json JSONB NOT NULL,
        PRIMARY KEY (asset, timestamp, time_bin)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS features_asset_timestamp_idx 
      ON ${FeatureStoreTables.FEATURES} (asset, timestamp)
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${FeatureStoreTables.ASSET_METADATA} (
        asset VARCHAR(10) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL,
        importance FLOAT NOT NULL,
        last_updated TIMESTAMP NOT NULL
      )
    `);
    
    this.logger.info('PostgreSQL schema initialized');
  }

  /**
   * Store a feature set in Redis
   */
  private async storeFeatureInRedis(
    featureSet: AssetFeatureSet,
    timeBin: TimeBin
  ): Promise<void> {
    const { asset, timestamp } = featureSet;
    
    // Convert timestamp to compact format for key
    const keyTimestamp = timestamp.replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
    const key = `${FeatureStoreKeys.FEATURE_KEY_PREFIX}${asset}:${keyTimestamp}:${timeBin}`;
    
    // Store flattened feature set as hash
    const flatFeatures = flattenFeatureSet(featureSet);
    
    // Convert to Redis hash format
    const hashEntries: string[] = [];
    for (const [field, value] of Object.entries(flatFeatures)) {
      hashEntries.push(field, String(value));
    }
    
    // Store in Redis with TTL
    await this.redis.hmset(key, ...hashEntries);
    
    // Set expiration based on time bin size
    const ttl = this.config.featuresTimeToLive[timeBin];
    if (ttl) {
      await this.redis.expire(key, ttl);
    }
    
    // Add to time-sorted index for the asset
    const indexKey = `${FeatureStoreKeys.TIME_BIN_INDEX}${asset}:${timeBin}`;
    // Store timestamp as score for sorted set
    const score = new Date(timestamp).getTime();
    await this.redis.zadd(indexKey, score, keyTimestamp);
    
    // Trim index to a reasonable size
    const KEEP_LAST_N = 1000;
    await this.redis.zremrangebyrank(indexKey, 0, -(KEEP_LAST_N + 1));
  }

  /**
   * Store a feature set in PostgreSQL
   */
  private async storeFeatureInPostgres(
    featureSet: AssetFeatureSet,
    timeBin: TimeBin
  ): Promise<void> {
    if (!this.postgres) return;
    
    try {
      const flatFeatures = flattenFeatureSet(featureSet);
      const { asset, timestamp } = featureSet;
      
      const client = await this.postgres.connect();
      try {
        await client.query(`
          INSERT INTO ${FeatureStoreTables.FEATURES} (
            asset, timestamp, time_bin, headline_count, avg_sentiment,
            max_impact, min_impact, sentiment_volatility, source_diversity,
            avg_confidence, source_entropy, feature_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (asset, timestamp, time_bin)
          DO UPDATE SET
            headline_count = $4,
            avg_sentiment = $5,
            max_impact = $6,
            min_impact = $7,
            sentiment_volatility = $8,
            source_diversity = $9,
            avg_confidence = $10,
            source_entropy = $11,
            feature_json = $12
        `, [
          asset,
          timestamp,
          timeBin,
          featureSet.headline_count,
          featureSet.avg_sentiment,
          featureSet.max_impact,
          featureSet.min_impact,
          featureSet.sentiment_volatility,
          featureSet.source_diversity,
          featureSet.avg_confidence,
          flatFeatures.source_entropy,
          JSON.stringify(flatFeatures)
        ]);
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error(`Error storing features in PostgreSQL: ${error}`);
      throw error;
    }
  }

  /**
   * Publish a feature set to all feature stores
   */
  public async publishFeatureSet(
    featureSet: AssetFeatureSet,
    timeBin: TimeBin
  ): Promise<void> {
    try {
      // Make sure the feature store is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Skip if headline count is below threshold
      if (featureSet.headline_count < this.config.minHeadlineCount) {
        return;
      }
      
      // Store in Redis (online store)
      await this.storeFeatureInRedis(featureSet, timeBin);
      
      // Store in PostgreSQL (offline store) if available
      if (this.postgres) {
        await this.storeFeatureInPostgres(featureSet, timeBin);
      }
      
      this.logger.debug(
        `Published feature set for ${featureSet.asset} at ${featureSet.timestamp} (${timeBin})`
      );
    } catch (error) {
      this.logger.error(`Error publishing feature set: ${error}`);
      throw error;
    }
  }

  /**
   * Get the latest feature set for an asset from Redis
   */
  public async getLatestFeatureSet(
    asset: string,
    timeBin: TimeBin
  ): Promise<AssetFeatureSet | null> {
    try {
      // Get the latest timestamp from the sorted index
      const indexKey = `${FeatureStoreKeys.TIME_BIN_INDEX}${asset}:${timeBin}`;
      const latestTimestamps = await this.redis.zrevrange(indexKey, 0, 0);
      
      if (!latestTimestamps.length) {
        return null;
      }
      
      const keyTimestamp = latestTimestamps[0];
      const key = `${FeatureStoreKeys.FEATURE_KEY_PREFIX}${asset}:${keyTimestamp}:${timeBin}`;
      
      // Get all hash fields
      const featureData = await this.redis.hgetall(key);
      
      if (!Object.keys(featureData).length) {
        return null;
      }
      
      // Convert string values to appropriate types
      return this.parseFeatureSet(featureData);
    } catch (error) {
      this.logger.error(`Error retrieving latest feature set: ${error}`);
      return null;
    }
  }

  /**
   * Get a time window of features for an asset
   */
  public async getFeatureWindow(
    asset: string,
    startTime: Date | string,
    endTime: Date | string,
    timeBin: TimeBin
  ): Promise<AssetFeatureSet[]> {
    // Convert dates to timestamps
    const startTimestamp = typeof startTime === 'string' 
      ? new Date(startTime).getTime() 
      : startTime.getTime();
      
    const endTimestamp = typeof endTime === 'string'
      ? new Date(endTime).getTime()
      : endTime.getTime();
    
    try {
      if (this.postgres) {
        // Use PostgreSQL for historical data
        const client = await this.postgres.connect();
        try {
          const result = await client.query(`
            SELECT feature_json
            FROM ${FeatureStoreTables.FEATURES}
            WHERE asset = $1 AND time_bin = $2
              AND timestamp >= $3 AND timestamp <= $4
            ORDER BY timestamp ASC
          `, [asset, timeBin, new Date(startTimestamp), new Date(endTimestamp)]);
          
          return result.rows.map((row: { feature_json: string }) => JSON.parse(row.feature_json));
        } finally {
          client.release();
        }
      } else {
        // Fallback to Redis
        const indexKey = `${FeatureStoreKeys.TIME_BIN_INDEX}${asset}:${timeBin}`;
        
        // Get all timestamps in range
        const timestamps = await this.redis.zrangebyscore(
          indexKey, 
          startTimestamp, 
          endTimestamp
        );
        
        const features: AssetFeatureSet[] = [];
        
        // Fetch each feature set
        for (const keyTimestamp of timestamps) {
          const key = `${FeatureStoreKeys.FEATURE_KEY_PREFIX}${asset}:${keyTimestamp}:${timeBin}`;
          const featureData = await this.redis.hgetall(key);
          
          if (Object.keys(featureData).length) {
            features.push(this.parseFeatureSet(featureData));
          }
        }
        
        return features;
      }
    } catch (error) {
      this.logger.error(`Error retrieving feature window: ${error}`);
      return [];
    }
  }

  /**
   * Parse a feature set from Redis hash data
   */
  private parseFeatureSet(data: Record<string, string>): AssetFeatureSet {
    // Extract entity and asset mentions
    const entityCounts: Record<string, number> = {};
    const assetMentions: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    
    // Parse all fields
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('entity_')) {
        const entity = key.replace('entity_', '');
        entityCounts[entity] = Number(value);
      } else if (key.startsWith('mentioned_')) {
        const asset = key.replace('mentioned_', '').toUpperCase();
        assetMentions[asset] = Number(value);
      } else if (key.endsWith('_count') && !['headline_count', 'source_count'].includes(key)) {
        const category = key.replace('_count', '');
        categoryCounts[category.toUpperCase()] = Number(value);
      }
    }
    
    // Construct feature set with basic fields
    return {
      asset: data.asset,
      timestamp: data.timestamp,
      headline_count: Number(data.headline_count),
      avg_sentiment: Number(data.avg_sentiment),
      max_impact: Number(data.max_impact),
      min_impact: Number(data.min_impact),
      sentiment_volatility: Number(data.sentiment_volatility),
      source_diversity: Number(data.source_diversity),
      avg_confidence: Number(data.avg_confidence),
      category_counts: categoryCounts as Record<any, number>,
      entity_counts: entityCounts,
      asset_mentions: assetMentions
    };
  }

  /**
   * Close all connections
   */
  public async close(): Promise<void> {
    await this.redis.quit();
    if (this.postgres) {
      await this.postgres.end();
    }
  }
} 