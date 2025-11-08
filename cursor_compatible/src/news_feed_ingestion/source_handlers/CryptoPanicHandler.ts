import axios from 'axios';
import { RawHeadline } from '../../altdata/types.js';
import { BaseSourceHandler, FetchResult, NewsSourceConfig } from './BaseSourceHandler.js';
import { createLogger } from '../../common/logger.js';

// Create a logger instance
const logger = createLogger('CryptoPanicHandler');

interface CryptoPanicConfig extends NewsSourceConfig {
  apiKey: string;
  currencies?: string[];
  filter?: 'rising' | 'hot' | 'bullish' | 'bearish' | 'important' | 'saved';
  regions?: string[];
}

interface CryptoPanicResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: {
    id: number;
    title: string;
    published_at: string;
    url: string;
    source: {
      title: string;
      domain: string;
    };
    currencies: Array<{
      code: string;
      title: string;
      slug: string;
    }>;
    votes: {
      negative: number;
      positive: number;
      important: number;
      liked: number;
      disliked: number;
      lol: number;
      toxic: number;
      saved: number;
      comments: number;
    };
  }[];
}

export class CryptoPanicHandler extends BaseSourceHandler {
  protected cryptoPanicConfig: CryptoPanicConfig;
  private baseUrl = 'https://cryptopanic.com/api/v1/posts/';

  constructor(config: CryptoPanicConfig) {
    super({
      ...config,
      name: 'CryptoPanic',
      baseUrl: 'https://cryptopanic.com/api/v1/posts/'
    });
    this.cryptoPanicConfig = config;
  }

  /**
   * Fetch headlines from CryptoPanic
   */
  public async fetchHeadlines(): Promise<FetchResult> {
    if (!this.canFetch()) {
      return {
        headlines: [],
        metadata: {
          totalFetched: 0,
          fetchTime: 0,
          source: this.getSourceName()
        },
        error: new Error('Rate limit exceeded, try again later')
      };
    }

    const startTime = Date.now();
    
    try {
      const params: Record<string, string> = {
        auth_token: this.cryptoPanicConfig.apiKey,
        public: 'true',
        kind: 'news'
      };
      
      if (this.cryptoPanicConfig.currencies?.length) {
        params.currencies = this.cryptoPanicConfig.currencies.join(',');
      }
      
      if (this.cryptoPanicConfig.filter) {
        params.filter = this.cryptoPanicConfig.filter;
      }
      
      if (this.cryptoPanicConfig.regions?.length) {
        params.regions = this.cryptoPanicConfig.regions.join(',');
      }
      
      const response = await axios.get<CryptoPanicResponse>(this.baseUrl, {
        params,
        timeout: 10000
      });
      
      this.updateLastFetchTime();
      
      const headlines = this.processApiResponse(response.data);
      
      return {
        headlines,
        metadata: {
          totalFetched: headlines.length,
          fetchTime: Date.now() - startTime,
          source: this.getSourceName()
        }
      };
    } catch (error) {
      logger.error(`Error fetching headlines from CryptoPanic: ${error instanceof Error ? error.message : String(error)}`);
      return {
        headlines: [],
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          totalFetched: 0,
          fetchTime: Date.now() - startTime,
          source: this.getSourceName()
        }
      };
    }
  }

  /**
   * Process the CryptoPanic API response into standardized RawHeadline format
   */
  protected processApiResponse(response: CryptoPanicResponse): RawHeadline[] {
    if (!response.results || !Array.isArray(response.results)) {
      return [];
    }

    return response.results.map(item => {
      // Generate a unique ID for the headline
      const id = `cryptopanic-${item.id}`;
      
      return {
        id,
        title: item.title,
        source: item.source.title,
        url: item.url,
        publishedAt: item.published_at,
        // Add asset mentions from currencies array if available
        assetMentions: item.currencies?.map(c => c.code) || []
      } as RawHeadline;
    });
  }
} 