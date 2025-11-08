import Redis from 'ioredis';
import { RawHeadline, EnrichedHeadline, RedisKeys, ScoringConfig } from '../types';
import { enrichHeadline } from '../scoring/enrichHeadline';
import { Logger } from '../../common/logger';

// Default configuration
const DEFAULT_CONFIG: ScoringConfig = {
  minConfidence: 0.6,
  minImpactScore: 0.3,
  sourceTrustRatings: {
    'CoinDesk': 0.9,
    'CoinTelegraph': 0.85,
    'Bloomberg': 0.95,
    'Reuters': 0.95,
  },
  assetWeights: {
    'BTC': 1.0,
    'ETH': 0.95,
    'SOL': 0.85,
  },
  categoryWeights: {
    'Regulatory': 1.0,
    'Market': 0.9,
    'Hack': 0.95,
    'Adoption': 0.85,
    'Technology': 0.8,
    'Partnership': 0.75,
    'Other': 0.5,
  }
};

// Store processed headline IDs to avoid duplicates (in-memory cache)
const processedHeadlineIds = new Set<string>();
const MAX_CACHE_SIZE = 10000; // Limit cache size

export class HeadlineScorerWorker {
  private redis: Redis;
  private logger: Logger;
  private config: ScoringConfig;
  private running: boolean = false;
  private batchSize: number = 10;
  private pollingInterval: number = 5000; // 5 seconds

  constructor(redisUrl: string, config: ScoringConfig = DEFAULT_CONFIG, logger?: Logger) {
    this.redis = new Redis(redisUrl);
    this.config = config;
    this.logger = logger || console;
  }

  /**
   * Process a single headline through the enrichment pipeline
   */
  private async processHeadline(headline: RawHeadline): Promise<EnrichedHeadline | null> {
    try {
      // Skip if already processed
      if (headline.id && processedHeadlineIds.has(headline.id)) {
        this.logger.debug(`Skipping duplicate headline: ${headline.id}`);
        return null;
      }

      // Enrich headline
      const enriched = enrichHeadline(headline, this.config);
      
      // Cache the ID to avoid reprocessing
      if (enriched && enriched.id) {
        // Manage cache size
        if (processedHeadlineIds.size >= MAX_CACHE_SIZE) {
          // Remove oldest entries (approximately 10% of cache)
          const toRemove = Math.floor(MAX_CACHE_SIZE * 0.1);
          const idsToRemove = Array.from(processedHeadlineIds).slice(0, toRemove);
          idsToRemove.forEach(id => processedHeadlineIds.delete(id));
        }
        
        processedHeadlineIds.add(enriched.id);
      }

      return enriched;
    } catch (error) {
      this.logger.error(`Error processing headline: ${error}`, headline);
      return null;
    }
  }

  /**
   * Store an enriched headline in Redis
   */
  private async storeEnrichedHeadline(headline: EnrichedHeadline): Promise<void> {
    try {
      // Store in Redis stream
      await this.redis.xadd(
        RedisKeys.SCORED_NEWS,
        '*', // Auto-generate ID
        'data', JSON.stringify(headline)
      );
      
      this.logger.debug(`Stored enriched headline: ${headline.id}`);
    } catch (error) {
      this.logger.error(`Error storing enriched headline: ${error}`, headline);
    }
  }

  /**
   * Process a batch of headlines from Redis
   */
  private async processBatch(): Promise<number> {
    try {
      // Get batch of headlines from Redis
      const result = await this.redis.xrange(
        RedisKeys.INCOMING_NEWS,
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
        // Get raw headline data
        const headlineData = fields.find(f => f[0] === 'data')?.[1];
        if (!headlineData) continue;

        // Parse JSON
        try {
          const headline = JSON.parse(headlineData) as RawHeadline;
          const enriched = await this.processHeadline(headline);

          if (enriched) {
            await this.storeEnrichedHeadline(enriched);
            processed++;
          }

          // Remove from input queue
          await this.redis.xdel(RedisKeys.INCOMING_NEWS, id);
        } catch (error) {
          this.logger.error(`Error parsing headline: ${error}`);
          // Remove malformed entries to avoid blocking the queue
          await this.redis.xdel(RedisKeys.INCOMING_NEWS, id);
        }
      }

      return processed;
    } catch (error) {
      this.logger.error(`Error processing batch: ${error}`);
      return 0;
    }
  }

  /**
   * Main worker loop
   */
  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.logger.info('Headline scoring worker started');

    while (this.running) {
      const processed = await this.processBatch();
      
      if (processed > 0) {
        this.logger.info(`Processed ${processed} headlines`);
      } else {
        // Wait before polling again if no headlines were processed
        await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
      }
    }
  }

  /**
   * Stop the worker
   */
  public stop(): void {
    this.running = false;
    this.logger.info('Headline scoring worker stopped');
  }

  /**
   * Clean up resources
   */
  public async close(): Promise<void> {
    this.stop();
    await this.redis.quit();
  }
} 