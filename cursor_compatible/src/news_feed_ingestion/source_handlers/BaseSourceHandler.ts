import { RawHeadline } from '../../altdata/types.js';

/**
 * Base interface for news source handlers
 * All specific source handlers must implement this interface
 */
export interface NewsSourceConfig {
  apiKey?: string;
  baseUrl?: string;
  maxArticlesPerFetch?: number;
  fetchIntervalMs?: number;
  name: string;
}

export interface FetchResult {
  headlines: RawHeadline[];
  error?: Error;
  metadata?: {
    totalFetched: number;
    fetchTime: number;
    source: string;
  };
}

export abstract class BaseSourceHandler {
  protected config: NewsSourceConfig;
  protected lastFetchTimestamp: number = 0;
  
  constructor(config: NewsSourceConfig) {
    this.config = {
      maxArticlesPerFetch: 100,
      fetchIntervalMs: 60000, // 1 minute default
      ...config
    };
  }
  
  /**
   * Fetch headlines from the news source
   * @returns Promise with fetch results
   */
  abstract fetchHeadlines(): Promise<FetchResult>;
  
  /**
   * Process raw API response into standardized RawHeadline format
   * @param response The raw API response
   */
  protected abstract processApiResponse(response: any): RawHeadline[];
  
  /**
   * Check if enough time has passed since the last fetch based on fetchIntervalMs
   */
  protected canFetch(): boolean {
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastFetchTimestamp;
    return timeSinceLastFetch >= this.config.fetchIntervalMs!;
  }
  
  /**
   * Update the last fetch timestamp
   */
  protected updateLastFetchTime(): void {
    this.lastFetchTimestamp = Date.now();
  }
  
  /**
   * Get the name of the source
   */
  public getSourceName(): string {
    return this.config.name;
  }
} 