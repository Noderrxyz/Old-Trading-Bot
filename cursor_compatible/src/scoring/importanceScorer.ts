import { ImportanceResult, RawSocialMessage } from './types.js';

/**
 * Importance Scorer
 * Evaluates the importance of social media messages based on:
 * - Author metrics (followers, reputation)
 * - Engagement metrics (likes, comments, retweets)
 * - Content uniqueness
 */
export class ImportanceScorer {
  // Thresholds for different platforms
  private readonly twitterFollowerThresholds = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];
  private readonly telegramChannelSizeThresholds = [1000, 5000, 10000, 50000, 100000, 500000];
  private readonly redditKarmaThresholds = [1000, 5000, 10000, 50000, 100000, 500000];
  
  // Recent messages cache for uniqueness calculation
  private recentMessages: Array<{content: string, timestamp: number}> = [];
  private readonly maxCacheSize = 1000;
  private readonly maxCacheAgeMs = 24 * 60 * 60 * 1000; // 24 hours
  
  constructor() {
    // Clean up old messages periodically
    setInterval(() => this.cleanCache(), 60 * 60 * 1000); // Every hour
  }
  
  /**
   * Score the importance of a social media message
   */
  public scoreImportance(message: RawSocialMessage, engagementMetrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    bookmarks?: number;
  }): ImportanceResult {
    // Calculate author weight
    const authorWeight = this.calculateAuthorWeight(message);
    
    // Calculate engagement score
    const engagement = this.calculateEngagementScore(message, engagementMetrics);
    
    // Calculate uniqueness score
    const uniqueness = this.calculateUniquenessScore(message.content);
    
    // Add message to cache for future uniqueness calculations
    this.addToCache(message.content, message.timestamp);
    
    // Calculate final score - weighted combination of factors
    const score = Math.min(Math.round(
      (authorWeight * 0.4) + 
      (engagement * 0.4) + 
      (uniqueness * 0.2)
    ), 100);
    
    return {
      score,
      factors: {
        authorWeight,
        engagement,
        uniqueness
      }
    };
  }
  
  /**
   * Calculate weight of the author based on platform and metrics
   */
  private calculateAuthorWeight(message: RawSocialMessage): number {
    let weight = 0;
    
    switch (message.source) {
      case 'twitter':
        weight = this.calculateTwitterAuthorWeight(message.author.followers);
        break;
      case 'telegram':
        weight = this.calculateTelegramAuthorWeight(message.author.channelSize);
        break;
      case 'reddit':
        weight = this.calculateRedditAuthorWeight(message.author.karma);
        break;
    }
    
    return weight;
  }
  
  /**
   * Calculate author weight for Twitter users based on follower count
   */
  private calculateTwitterAuthorWeight(followers = 0): number {
    if (followers >= 1000000) return 100; // 1M+ followers
    if (followers >= 500000) return 90;
    if (followers >= 100000) return 80;
    if (followers >= 50000) return 70;
    if (followers >= 10000) return 60;
    if (followers >= 5000) return 50;
    if (followers >= 1000) return 40;
    if (followers >= 500) return 30;
    if (followers >= 100) return 20;
    return 10;
  }
  
  /**
   * Calculate author weight for Telegram channels based on subscriber count
   */
  private calculateTelegramAuthorWeight(channelSize = 0): number {
    if (channelSize >= 500000) return 100; // 500K+ subscribers
    if (channelSize >= 100000) return 90;
    if (channelSize >= 50000) return 80;
    if (channelSize >= 10000) return 70;
    if (channelSize >= 5000) return 60;
    if (channelSize >= 1000) return 50;
    if (channelSize >= 500) return 40;
    if (channelSize >= 100) return 30;
    return 20;
  }
  
  /**
   * Calculate author weight for Reddit users based on karma
   */
  private calculateRedditAuthorWeight(karma = 0): number {
    if (karma >= 500000) return 100; // 500K+ karma
    if (karma >= 100000) return 90;
    if (karma >= 50000) return 80;
    if (karma >= 10000) return 70;
    if (karma >= 5000) return 60;
    if (karma >= 1000) return 50;
    if (karma >= 500) return 40;
    if (karma >= 100) return 30;
    return 20;
  }
  
  /**
   * Calculate engagement score based on platform-specific metrics
   */
  private calculateEngagementScore(
    message: RawSocialMessage, 
    metrics?: {likes?: number; comments?: number; shares?: number; bookmarks?: number}
  ): number {
    // Default engagement score
    let score = 50;
    
    // If no metrics provided, use defaults based on platform
    if (!metrics) {
      return score;
    }
    
    const { likes = 0, comments = 0, shares = 0, bookmarks = 0 } = metrics;
    
    // Platform-specific scoring
    switch (message.source) {
      case 'twitter':
        // Twitter: retweets worth more than likes, comments worth more than retweets
        score = Math.min(
          // Comments (10x weight), retweets (5x weight), likes (1x weight), bookmarks (2x weight)
          ((comments * 10) + (shares * 5) + likes + (bookmarks * 2)) / 5,
          100
        );
        break;
        
      case 'reddit':
        // Reddit: upvotes and comments are key metrics
        score = Math.min(
          // Comments (5x weight), upvotes (likes)
          ((comments * 5) + likes) / 3,
          100
        );
        break;
        
      case 'telegram':
        // Telegram: harder to get engagement metrics, value views/forwards
        score = Math.min(
          // Views (shares) and reactions (likes)
          (shares + (likes * 5)) / 2,
          100
        );
        break;
    }
    
    return Math.max(Math.round(score), 0);
  }
  
  /**
   * Calculate uniqueness score by comparing to recent messages
   */
  private calculateUniquenessScore(content: string): number {
    if (this.recentMessages.length === 0) {
      return 100; // First message is completely unique
    }
    
    // Calculate similarity with recent messages
    let highestSimilarity = 0;
    
    for (const msg of this.recentMessages) {
      const similarity = this.calculateSimilarity(content, msg.content);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
      }
    }
    
    // Convert similarity to uniqueness (0-100)
    return Math.max(Math.round(100 - (highestSimilarity * 100)), 0);
  }
  
  /**
   * Calculate similarity between two text strings (0-1 scale)
   * Uses Jaccard similarity on word tokens
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // Normalize and tokenize texts
    const tokens1 = new Set(this.tokenize(text1));
    const tokens2 = new Set(this.tokenize(text2));
    
    // Calculate Jaccard similarity: intersection size / union size
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }
  
  /**
   * Tokenize text into words for similarity calculation
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .split(/\s+/)            // Split on whitespace
      .filter(token => token.length > 2); // Remove very short words
  }
  
  /**
   * Add a message to the cache for uniqueness calculation
   */
  private addToCache(content: string, timestamp: number): void {
    this.recentMessages.push({ content, timestamp });
    
    // Trim cache if it gets too large
    if (this.recentMessages.length > this.maxCacheSize) {
      this.cleanCache();
    }
  }
  
  /**
   * Clean up old messages from the cache
   */
  private cleanCache(): void {
    const now = Date.now();
    this.recentMessages = this.recentMessages.filter(msg => 
      (now - msg.timestamp) < this.maxCacheAgeMs
    );
    
    // If still too large after age filtering, remove oldest
    while (this.recentMessages.length > this.maxCacheSize) {
      this.recentMessages.shift();
    }
  }
} 