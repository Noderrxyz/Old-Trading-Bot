import { RawSocialMessage, ScoredSocialSignal, ScoringWeights } from './types';
import { SentimentAnalyzer } from './sentimentAnalyzer';
import { RelevanceScorer } from './relevanceScorer';
import { ImportanceScorer } from './importanceScorer';
import { LLMSummarizer } from './llmSummarizer';
import { SocialScoringPipeline } from './socialScoringPipeline.js';
import { SocialRedisClient } from './redisClient';
import { RedisKeys } from './types.js';

/**
 * Social Scoring Service
 * High-level service for processing and retrieving social media signals
 */
export class SocialScoringService {
  private pipeline: SocialScoringPipeline;
  private redisClient: any;
  private metricsLogger?: (metric: string, value: any) => void;
  
  constructor(config: {
    redisClient: any;
    useLLMSummarization?: boolean;
    apiKey?: string;
    initialWeights?: ScoringWeights;
    metricsLogger?: (metric: string, value: any) => void;
  }) {
    this.redisClient = config.redisClient;
    this.metricsLogger = config.metricsLogger;
    
    // Create pipeline
    this.pipeline = new SocialScoringPipeline({
      redisClient: this.redisClient,
      scoringWeights: config.initialWeights,
      useLLMSummarization: config.useLLMSummarization,
      apiKey: config.apiKey
    });
    
    console.log('Social Scoring Service initialized');
  }
  
  /**
   * Process a single social media message
   */
  public async processMessage(message: RawSocialMessage): Promise<ScoredSocialSignal> {
    const startTime = Date.now();
    
    try {
      const result = await this.pipeline.processMessage(message);
      
      // Log metrics if enabled
      if (this.metricsLogger) {
        const processingTime = Date.now() - startTime;
        this.metricsLogger('social_scoring.process_time', processingTime);
        this.metricsLogger('social_scoring.sentiment', result.sentiment);
        this.metricsLogger('social_scoring.relevance', result.relevance);
        this.metricsLogger('social_scoring.importance', result.importance);
        
        if (result.tickers.length > 0) {
          this.metricsLogger('social_scoring.tickers_found', result.tickers.length);
          result.tickers.forEach(ticker => {
            this.metricsLogger(`social_scoring.ticker.${ticker}`, 1);
          });
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error processing social message:', error);
      if (this.metricsLogger) {
        this.metricsLogger('social_scoring.errors', 1);
      }
      throw error;
    }
  }
  
  /**
   * Process multiple messages in batch
   */
  public async processMessages(messages: RawSocialMessage[]): Promise<ScoredSocialSignal[]> {
    const startTime = Date.now();
    
    try {
      const results = await this.pipeline.batchProcessMessages(messages);
      
      // Log metrics if enabled
      if (this.metricsLogger) {
        const processingTime = Date.now() - startTime;
        this.metricsLogger('social_scoring.batch_process_time', processingTime);
        this.metricsLogger('social_scoring.batch_size', messages.length);
        this.metricsLogger('social_scoring.batch_avg_time', processingTime / messages.length);
      }
      
      return results;
    } catch (error) {
      console.error('Error processing batch of social messages:', error);
      if (this.metricsLogger) {
        this.metricsLogger('social_scoring.batch_errors', 1);
      }
      throw error;
    }
  }
  
  /**
   * Get top signals for a specific ticker
   */
  public async getTopSignalsForTicker(ticker: string, limit: number = 10): Promise<ScoredSocialSignal[]> {
    try {
      return await this.pipeline.getTopSignalsForTicker(ticker, limit);
    } catch (error) {
      console.error(`Error getting top signals for ticker ${ticker}:`, error);
      return [];
    }
  }
  
  /**
   * Get tickers with the most signals in the last time period
   */
  public async getHottestTickers(limit: number = 10): Promise<Array<{ticker: string, count: number}>> {
    if (!this.redisClient) {
      throw new Error('Redis client not configured');
    }
    
    try {
      // This is a simplified implementation and would need more complex Redis queries in production
      // Ideally, you'd use Redis Streams or TimeSeries for this
      
      // For now, just scan through all ticker keys and count entries
      const tickerCounts: Map<string, number> = new Map();
      
      // Get all ticker keys
      const tickerKeysPattern = `${RedisKeys.TICKER_SIGNALS}*`;
      const scanResult = await this.redisClient.keys(tickerKeysPattern);
      
      // Count entries in each ticker's sorted set
      for (const key of scanResult) {
        const ticker = key.replace(RedisKeys.TICKER_SIGNALS, '');
        const count = await this.redisClient.zcard(key);
        tickerCounts.set(ticker, count);
      }
      
      // Sort by count
      const sortedTickers = Array.from(tickerCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([ticker, count]) => ({ ticker, count }));
      
      return sortedTickers;
    } catch (error) {
      console.error('Error getting hottest tickers:', error);
      return [];
    }
  }
  
  /**
   * Update scoring weights 
   */
  public updateScoringWeights(weights: Partial<ScoringWeights>): void {
    this.pipeline.updateScoringWeights(weights);
    
    if (this.metricsLogger) {
      this.metricsLogger('social_scoring.weights_updated', JSON.stringify(weights));
    }
  }
  
  /**
   * Clear all stored signals (mostly for testing/admin purposes)
   */
  public async clearAllSignals(): Promise<void> {
    if (!this.redisClient) {
      throw new Error('Redis client not configured');
    }
    
    try {
      // Delete the global sorted set
      await this.redisClient.del(RedisKeys.SCORED_SOCIAL);
      
      // Find and delete all ticker-specific sets
      const tickerKeysPattern = `${RedisKeys.TICKER_SIGNALS}*`;
      const keys = await this.redisClient.keys(tickerKeysPattern);
      
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
      
      console.log(`Cleared all social signals (${keys.length + 1} keys)`);
    } catch (error) {
      console.error('Error clearing social signals:', error);
      throw error;
    }
  }
  
  /**
   * Get signal stats for monitoring
   */
  public async getStats(): Promise<{
    totalSignals: number;
    tickerCount: number;
    topTickers: Array<{ticker: string, count: number}>;
  }> {
    if (!this.redisClient) {
      throw new Error('Redis client not configured');
    }
    
    try {
      // Get count of all signals
      const totalSignals = await this.redisClient.zcard(RedisKeys.SCORED_SOCIAL);
      
      // Get all ticker keys
      const tickerKeysPattern = `${RedisKeys.TICKER_SIGNALS}*`;
      const tickerKeys = await this.redisClient.keys(tickerKeysPattern);
      
      // Get top 5 tickers by signal count
      const topTickers = await this.getHottestTickers(5);
      
      return {
        totalSignals,
        tickerCount: tickerKeys.length,
        topTickers
      };
    } catch (error) {
      console.error('Error getting signal stats:', error);
      return {
        totalSignals: 0,
        tickerCount: 0,
        topTickers: []
      };
    }
  }
} 