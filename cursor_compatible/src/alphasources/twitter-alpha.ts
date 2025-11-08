/**
 * Twitter Alpha Source
 * 
 * Scrapes Twitter for mentions of crypto tokens to identify
 * trending assets and sentiment signals.
 */

import { BaseAlphaSource } from './base-alpha-source.js';
import { AlphaFrame, AlphaSourceConfig } from './types.js';

/**
 * Twitter-specific configuration
 */
export interface TwitterAlphaConfig extends AlphaSourceConfig {
  credentials: {
    apiKey: string;
    apiSecret: string;
    bearerToken: string;
  };
  settings: {
    // Max number of tweets to fetch per symbol
    maxTweetsPerSymbol: number;
    
    // Min tweet volume for generating signals
    minTweetVolume: number;
    
    // Weight for verified accounts (1.0 = no extra weight)
    verifiedWeight: number;
    
    // Weight for follower count influence
    followerWeight: number;
    
    // Keywords to track for bullish sentiment
    bullishKeywords: string[];
    
    // Keywords to track for bearish sentiment
    bearishKeywords: string[];
  };
}

/**
 * Tweet data structure
 */
interface TweetData {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  authorFollowers: number;
  authorVerified: boolean;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  sentiment: number; // -1 to 1
}

/**
 * Alpha source for Twitter signals
 */
export class TwitterAlphaSource extends BaseAlphaSource {
  private readonly supportedAssets: string[];
  private mockTweetCache: Record<string, TweetData[]> = {};
  
  /**
   * Create a new Twitter alpha source
   * @param config Source configuration
   * @param supportedAssets Supported asset pairs
   */
  constructor(
    config: TwitterAlphaConfig,
    supportedAssets: string[]
  ) {
    super('twitter', config);
    this.supportedAssets = supportedAssets;
  }
  
  /**
   * Get typed configuration
   */
  protected get twitterConfig(): TwitterAlphaConfig {
    return this.config as TwitterAlphaConfig;
  }
  
  /**
   * Initialize the source
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    // Validate Twitter API credentials
    const { apiKey, apiSecret, bearerToken } = this.twitterConfig.credentials;
    if (!apiKey || !apiSecret || !bearerToken) {
      throw new Error('Missing Twitter API credentials');
    }
    
    // Initialize Twitter client
    // In a real implementation, this would set up the Twitter API client
    this.logger.info('Twitter API client initialized');
    
    // Pre-seed mock data
    this.initializeMockData();
  }
  
  /**
   * Fetch Twitter alpha signals
   * @returns Array of alpha frames
   */
  protected async fetchAlpha(): Promise<AlphaFrame[]> {
    const frames: AlphaFrame[] = [];
    const now = Math.floor(Date.now() / 1000);
    
    // Process each supported asset
    for (const symbol of this.supportedAssets) {
      try {
        // Extract token from symbol (e.g., "ETH" from "ETH/USDC")
        const token = symbol.split('/')[0];
        
        // In a real implementation, this would fetch from Twitter API
        const tweets = await this.fetchTweets(token);
        
        // Skip if tweet volume is too low
        if (tweets.length < this.twitterConfig.settings.minTweetVolume) {
          this.logger.debug(`Skipping ${token} - insufficient tweet volume (${tweets.length})`);
          continue;
        }
        
        // Calculate metrics
        const metrics = this.calculateMetrics(tweets);
        
        // Calculate signal score
        const score = this.calculateSignalScore(metrics);
        
        frames.push({
          source: this.name,
          symbol,
          timestamp: now,
          score,
          details: {
            tweetCount: tweets.length,
            ...metrics,
            trendingHashtags: this.extractTopHashtags(tweets),
            sampleTweetIds: tweets.slice(0, 5).map(t => t.id)
          }
        });
      } catch (error) {
        this.logger.error(`Error processing Twitter data for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return frames;
  }
  
  /**
   * Mock function to fetch tweets for a token
   * In a real implementation, this would call the Twitter API
   * @param token Token symbol
   * @returns Array of tweet data
   */
  private async fetchTweets(token: string): Promise<TweetData[]> {
    // In a real implementation, this would call the Twitter API
    // For mock purposes, return cached mock data
    return this.mockTweetCache[token] || [];
  }
  
  /**
   * Calculate metrics from tweet data
   * @param tweets Array of tweet data
   * @returns Calculated metrics
   */
  private calculateMetrics(tweets: TweetData[]): Record<string, any> {
    // Skip empty tweet sets
    if (tweets.length === 0) {
      return {
        averageSentiment: 0,
        volumeChange24h: 0,
        engagement: 0,
        viralityScore: 0
      };
    }
    
    // Calculate average sentiment
    const avgSentiment = tweets.reduce((sum, tweet) => sum + tweet.sentiment, 0) / tweets.length;
    
    // Calculate engagement (likes + retweets + replies)
    const totalEngagement = tweets.reduce((sum, tweet) => 
      sum + tweet.likeCount + tweet.retweetCount + tweet.replyCount, 0);
    
    // Calculate virality (engagement per tweet)
    const virality = totalEngagement / tweets.length;
    
    // Mock 24h volume change
    const volumeChange24h = (tweets.length - (tweets.length * 0.7 + Math.random() * 0.6)) / (tweets.length * 0.7);
    
    return {
      averageSentiment: avgSentiment,
      volumeChange24h,
      engagement: totalEngagement,
      viralityScore: virality,
      verifiedTweetsPercent: tweets.filter(t => t.authorVerified).length / tweets.length
    };
  }
  
  /**
   * Calculate signal score from metrics
   * @param metrics Tweet metrics
   * @returns Signal score (0-1)
   */
  private calculateSignalScore(metrics: Record<string, any>): number {
    // Extract metrics
    const { averageSentiment, volumeChange24h, viralityScore, verifiedTweetsPercent } = metrics;
    
    // Base score on sentiment (-1 to 1 converted to 0 to 1)
    let score = (averageSentiment + 1) / 2;
    
    // Adjust based on volume change (growing volume increases confidence)
    if (volumeChange24h > 0.1) {
      score += 0.1 * Math.min(1, volumeChange24h);
    }
    
    // Adjust based on virality
    score += 0.05 * Math.min(1, viralityScore / 100);
    
    // Adjust based on verified tweet percentage
    score += 0.05 * verifiedTweetsPercent;
    
    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Extract top hashtags from tweets
   * @param tweets Array of tweet data
   * @returns Top hashtags
   */
  private extractTopHashtags(tweets: TweetData[]): string[] {
    const hashtagCounts: Record<string, number> = {};
    
    // Extract hashtags from all tweets
    for (const tweet of tweets) {
      const matches = tweet.text.match(/#\w+/g) || [];
      for (const hashtag of matches) {
        hashtagCounts[hashtag] = (hashtagCounts[hashtag] || 0) + 1;
      }
    }
    
    // Sort hashtags by count
    return Object.entries(hashtagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hashtag]) => hashtag);
  }
  
  /**
   * Initialize mock tweet data
   */
  private initializeMockData(): void {
    // Create mock data for supported tokens
    for (const symbol of this.supportedAssets) {
      const token = symbol.split('/')[0];
      this.mockTweetCache[token] = this.generateMockTweets(token);
    }
  }
  
  /**
   * Generate mock tweets for a token
   * @param token Token symbol
   * @returns Array of mock tweet data
   */
  private generateMockTweets(token: string): TweetData[] {
    const tweets: TweetData[] = [];
    
    // Seed based on token name for consistency
    const seed = [...token].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rand = (min: number, max: number, seedOffset = 0) => {
      const x = Math.sin(seed + seedOffset) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };
    
    // Number of tweets based on token popularity
    const popularityFactor = token === 'BTC' ? 1.0 :
                             token === 'ETH' ? 0.8 :
                             token === 'SOL' ? 0.6 :
                             token === 'DOGE' ? 0.9 : 0.4;
    
    const tweetCount = Math.floor(rand(20, 100) * popularityFactor);
    
    // Generate mock tweets
    for (let i = 0; i < tweetCount; i++) {
      const bullish = rand(0, 1, i) > 0.4; // 60% bullish sentiment
      const sentiment = bullish ? rand(0.1, 1, i) : rand(-1, -0.1, i);
      
      tweets.push({
        id: `tweet_${token}_${i}_${Date.now()}`,
        text: this.generateMockTweetText(token, bullish),
        createdAt: new Date(Date.now() - Math.floor(rand(0, 86400000, i))).toISOString(),
        authorId: `user_${Math.floor(rand(1000, 9999, i))}`,
        authorFollowers: Math.floor(rand(100, 100000, i)),
        authorVerified: rand(0, 1, i) > 0.8, // 20% verified
        likeCount: Math.floor(rand(0, 500, i)),
        retweetCount: Math.floor(rand(0, 100, i)),
        replyCount: Math.floor(rand(0, 50, i)),
        sentiment
      });
    }
    
    return tweets;
  }
  
  /**
   * Generate mock tweet text
   * @param token Token symbol
   * @param bullish Whether the tweet is bullish
   * @returns Mock tweet text
   */
  private generateMockTweetText(token: string, bullish: boolean): string {
    const bullishTemplates = [
      `$${token} looking strong today! Target: $X`,
      `Just bought more $${token}, this is going to moon! 🚀🚀`,
      `$${token} breakout imminent, watch this space 👀`,
      `Accumulating $${token} at these levels is a no-brainer`,
      `$${token} fundamentals are stronger than ever #HODL`,
      `Whales are accumulating $${token}, something big is coming!`
    ];
    
    const bearishTemplates = [
      `$${token} looking weak, might go lower`,
      `Just sold my $${token}, too much uncertainty`,
      `$${token} chart looking bearish, be careful out there`,
      `$${token} volume dropping, not a good sign`,
      `$${token} breaking support levels, watch out below`,
      `Whales dumping $${token}, exit while you can`
    ];
    
    const templates = bullish ? bullishTemplates : bearishTemplates;
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    // Replace $X with a random price
    return template.replace('$X', `$${Math.floor(Math.random() * 100000)}`);
  }
  
  /**
   * Check if source requires credentials
   * @returns True if credentials required
   */
  protected requiresCredentials(): boolean {
    return true;
  }
} 