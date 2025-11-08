import { 
  ScoredSocialSignal, 
  RawSocialMessage, 
  ScoringWeights,
  RedisKeys
} from './types.js';
import { SentimentAnalyzer } from './sentimentAnalyzer.js';
import { RelevanceScorer } from './relevanceScorer.js';
import { ImportanceScorer } from './importanceScorer.js';

/**
 * Social Scoring Pipeline
 * Processes social media messages through sentiment, relevance, and importance scoring
 * Aggregates results into ScoredSocialSignal objects for downstream use
 */
export class SocialScoringPipeline {
  private sentimentAnalyzer: SentimentAnalyzer;
  private relevanceScorer: RelevanceScorer;
  private importanceScorer: ImportanceScorer;
  private scoringWeights: ScoringWeights;
  private redisClient: any; // Redis client
  private useLLMSummarization: boolean;
  private apiKey?: string;
  
  constructor(config: {
    redisClient?: any;
    scoringWeights?: ScoringWeights;
    useLLMSummarization?: boolean;
    apiKey?: string;
  } = {}) {
    this.sentimentAnalyzer = new SentimentAnalyzer({
      model: 'finbert',
      apiKey: config.apiKey
    });
    
    this.relevanceScorer = new RelevanceScorer();
    this.importanceScorer = new ImportanceScorer();
    
    // Default weights
    this.scoringWeights = config.scoringWeights || {
      sentiment: 0.3,
      relevance: 0.4,
      importance: 0.3
    };
    
    this.redisClient = config.redisClient;
    this.useLLMSummarization = config.useLLMSummarization || false;
    this.apiKey = config.apiKey;
  }
  
  /**
   * Process a social media message through the scoring pipeline
   */
  public async processMessage(message: RawSocialMessage): Promise<ScoredSocialSignal> {
    try {
      // Step 1: Process through each scoring module in parallel
      const [
        sentimentResult,
        relevanceResult,
        importanceResult
      ] = await Promise.all([
        this.sentimentAnalyzer.analyzeSentiment(message.content),
        Promise.resolve(this.relevanceScorer.scoreRelevance(message.content)),
        Promise.resolve(this.importanceScorer.scoreImportance(message))
      ]);
      
      // Step 2: Create summarized version if enabled
      let summary = message.content;
      if (this.useLLMSummarization && message.content.length > 100) {
        summary = await this.generateSummary(message.content);
      }
      
      // Step 3: Calculate combined score based on weights
      const combinedScore = (
        Math.abs(sentimentResult.score) * this.scoringWeights.sentiment +
        (relevanceResult.score / 100) * this.scoringWeights.relevance +
        (importanceResult.score / 100) * this.scoringWeights.importance
      ).toFixed(2);
      
      // Step 4: Construct the scored signal
      const scoredSignal: ScoredSocialSignal = {
        source: message.source,
        sentiment: sentimentResult.score,
        relevance: relevanceResult.score,
        importance: importanceResult.score,
        summary: summary.length > 280 ? summary.substring(0, 277) + '...' : summary,
        tickers: relevanceResult.tickers,
        tags: relevanceResult.tags,
        timestamp: message.timestamp,
        raw: message.content,
        author: {
          name: message.author.name,
          followers: message.author.followers,
          karma: message.author.karma,
          channelSize: message.author.channelSize
        }
      };
      
      // Step 5: Store in Redis if client provided
      if (this.redisClient) {
        await this.storeSignalInRedis(scoredSignal);
      }
      
      return scoredSignal;
    } catch (error) {
      console.error('Error processing message through social scoring pipeline:', error);
      throw error;
    }
  }
  
  /**
   * Store scored signal in Redis
   * - Global scored signals set
   * - Per-ticker sorted sets for quick access
   */
  private async storeSignalInRedis(signal: ScoredSocialSignal): Promise<void> {
    if (!this.redisClient) return;
    
    try {
      // JSON stringify the signal
      const signalJson = JSON.stringify(signal);
      
      // Calculate score for sorting (combine sentiment, relevance, importance)
      // For sortable score, map sentiment from [-1,1] to [0,1] range
      const sentimentScore = (signal.sentiment + 1) / 2;
      const sortScore = (
        sentimentScore * this.scoringWeights.sentiment +
        (signal.relevance / 100) * this.scoringWeights.relevance +
        (signal.importance / 100) * this.scoringWeights.importance
      ) * 100;
      
      // Store in global scored signals set
      await this.redisClient.zadd(
        RedisKeys.SCORED_SOCIAL,
        sortScore,
        signalJson
      );
      
      // Store in per-ticker sorted sets
      for (const ticker of signal.tickers) {
        await this.redisClient.zadd(
          `${RedisKeys.TICKER_SIGNALS}${ticker}`,
          sortScore,
          signalJson
        );
      }
      
      // Set expiration for cleanup (24 hours)
      const EXPIRE_SECONDS = 24 * 60 * 60;
      await this.redisClient.expire(RedisKeys.SCORED_SOCIAL, EXPIRE_SECONDS);
      for (const ticker of signal.tickers) {
        await this.redisClient.expire(`${RedisKeys.TICKER_SIGNALS}${ticker}`, EXPIRE_SECONDS);
      }
    } catch (error) {
      console.error('Error storing signal in Redis:', error);
    }
  }
  
  /**
   * Get top scored signals for a specific ticker
   */
  public async getTopSignalsForTicker(ticker: string, limit: number = 10): Promise<ScoredSocialSignal[]> {
    if (!this.redisClient) {
      throw new Error('Redis client not configured');
    }
    
    try {
      // Get top signals from the ticker's sorted set, sorted by score in descending order
      const results = await this.redisClient.zrevrange(
        `${RedisKeys.TICKER_SIGNALS}${ticker}`,
        0,
        limit - 1,
        'WITHSCORES'
      );
      
      // Results come back as [item1, score1, item2, score2, ...]
      const signals: ScoredSocialSignal[] = [];
      for (let i = 0; i < results.length; i += 2) {
        try {
          const signal = JSON.parse(results[i]);
          signals.push(signal);
        } catch (e) {
          console.error('Error parsing signal JSON:', e);
        }
      }
      
      return signals;
    } catch (error) {
      console.error(`Error fetching top signals for ticker ${ticker}:`, error);
      return [];
    }
  }
  
  /**
   * Generate a summary of content using LLM
   */
  private async generateSummary(content: string): Promise<string> {
    // In a real implementation, this would call an LLM API
    // This is a placeholder implementation
    // TODO: Implement actual LLM summarization
    
    // Mock implementation - take first 100 chars and add "..."
    return content.length > 100 
      ? content.substring(0, 100) + '...'
      : content;
  }
  
  /**
   * Update the scoring weights
   */
  public updateScoringWeights(weights: Partial<ScoringWeights>): void {
    this.scoringWeights = {
      ...this.scoringWeights,
      ...weights
    };
    
    // Normalize weights to ensure they sum to 1
    const sum = this.scoringWeights.sentiment + 
                this.scoringWeights.relevance + 
                this.scoringWeights.importance;
    
    if (sum !== 1) {
      this.scoringWeights.sentiment /= sum;
      this.scoringWeights.relevance /= sum;
      this.scoringWeights.importance /= sum;
    }
  }
  
  /**
   * Batch process multiple messages
   */
  public async batchProcessMessages(messages: RawSocialMessage[]): Promise<ScoredSocialSignal[]> {
    return Promise.all(messages.map(msg => this.processMessage(msg)));
  }
} 