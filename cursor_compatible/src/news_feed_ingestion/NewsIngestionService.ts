import { RawHeadline } from '../altdata/types.js';
import { BaseSourceHandler, FetchResult } from './source_handlers/BaseSourceHandler.js';
import { createLogger } from '../common/logger.js';

const logger = createLogger('NewsIngestionService');

interface NewsIngestionConfig {
  autoStartPolling?: boolean;
  pollingIntervalMs?: number;
  maxConcurrentFetches?: number;
}

type HeadlineCallback = (headlines: RawHeadline[]) => Promise<void>;

export class NewsIngestionService {
  private sourceHandlers: BaseSourceHandler[] = [];
  private pollingInterval: number | null = null;
  private config: NewsIngestionConfig;
  private headlineCallbacks: HeadlineCallback[] = [];
  private isPolling = false;

  constructor(config: NewsIngestionConfig = {}) {
    this.config = {
      autoStartPolling: true,
      pollingIntervalMs: 5 * 60 * 1000, // 5 minutes default
      maxConcurrentFetches: 3,
      ...config
    };

    if (this.config.autoStartPolling) {
      this.startPolling();
    }
  }

  /**
   * Add a news source handler to the service
   */
  public addSourceHandler(handler: BaseSourceHandler): void {
    this.sourceHandlers.push(handler);
    logger.info(`Added source handler: ${handler.getSourceName()}`);
  }

  /**
   * Register a callback to be called when new headlines are fetched
   */
  public onNewHeadlines(callback: HeadlineCallback): void {
    this.headlineCallbacks.push(callback);
  }

  /**
   * Start polling for news from all registered sources
   */
  public startPolling(): void {
    if (this.pollingInterval) {
      logger.warn('News polling already started');
      return;
    }

    logger.info(`Starting news polling with interval of ${this.config.pollingIntervalMs}ms`);
    
    // Fetch immediately on start
    this.fetchFromAllSources();
    
    // Then set up interval
    this.pollingInterval = setInterval(() => {
      this.fetchFromAllSources();
    }, this.config.pollingIntervalMs) as unknown as number;
  }

  /**
   * Stop polling for news
   */
  public stopPolling(): void {
    if (!this.pollingInterval) {
      logger.warn('News polling was not running');
      return;
    }

    clearInterval(this.pollingInterval);
    this.pollingInterval = null;
    logger.info('Stopped news polling');
  }

  /**
   * Fetch news from all sources
   */
  private async fetchFromAllSources(): Promise<void> {
    if (this.isPolling) {
      logger.warn('Already fetching from sources, skipping this cycle');
      return;
    }

    this.isPolling = true;
    
    try {
      logger.info(`Fetching news from ${this.sourceHandlers.length} sources`);
      
      // Fetch in batches to respect maxConcurrentFetches
      for (let i = 0; i < this.sourceHandlers.length; i += this.config.maxConcurrentFetches!) {
        const batch = this.sourceHandlers.slice(i, i + this.config.maxConcurrentFetches!);
        
        const fetchResults = await Promise.all(
          batch.map(handler => this.fetchFromSource(handler))
        );
        
        // Process results
        for (const result of fetchResults) {
          if (result.headlines.length > 0) {
            await this.processNewHeadlines(result.headlines);
          }
        }
      }
      
      logger.info('Completed fetching cycle from all sources');
    } catch (error) {
      logger.error(`Error during fetch cycle: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Fetch news from a single source
   */
  private async fetchFromSource(handler: BaseSourceHandler): Promise<FetchResult> {
    try {
      logger.info(`Fetching from ${handler.getSourceName()}`);
      const result = await handler.fetchHeadlines();
      
      if (result.error) {
        logger.error(`Error fetching from ${handler.getSourceName()}: ${result.error.message}`);
      } else {
        logger.info(`Fetched ${result.headlines.length} headlines from ${handler.getSourceName()}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Unexpected error fetching from ${handler.getSourceName()}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        headlines: [],
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          totalFetched: 0,
          fetchTime: 0,
          source: handler.getSourceName()
        }
      };
    }
  }

  /**
   * Process new headlines and notify callbacks
   */
  private async processNewHeadlines(headlines: RawHeadline[]): Promise<void> {
    if (headlines.length === 0) return;
    
    try {
      // Call all registered callbacks with the new headlines
      await Promise.all(
        this.headlineCallbacks.map(callback => callback(headlines))
      );
    } catch (error) {
      logger.error(`Error processing headlines: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 