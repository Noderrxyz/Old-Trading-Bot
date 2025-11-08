/**
 * Feature Unifier for Social Signals
 * 
 * Collects and merges social signals from Twitter, Telegram, and Reddit
 * into a unified schema for model injection.
 */

import { createLogger } from '../common/logger.js';
import { FeatureUnifierConfig, RiskFlagType, UnifiedSocialSignal } from './types.js';
import { ScoredSocialSignal } from '../scoring/types.js';

const logger = createLogger('FeatureUnifier');

/**
 * Unifies social signals from various sources into a standardized format
 * for strategy model injection.
 */
export class FeatureUnifier {
  private config: FeatureUnifierConfig;
  private redisClient: any; // Redis client
  private activeTokens: Set<string> = new Set();
  private signalCache: Map<string, UnifiedSocialSignal> = new Map();
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private metricsLogger?: (metric: string, value: any) => void;

  constructor(config: FeatureUnifierConfig, redisClient: any, metricsLogger?: (metric: string, value: any) => void) {
    this.config = config;
    this.redisClient = redisClient;
    this.metricsLogger = metricsLogger;
    
    logger.info('Feature Unifier initialized');
  }

  /**
   * Start the periodic update of unified signals
   */
  public start(): void {
    if (this.updateInterval) {
      logger.warn('Feature Unifier already running');
      return;
    }

    logger.info(`Starting feature unifier with update interval of ${this.config.updateIntervalMs}ms`);
    
    this.updateInterval = setInterval(() => {
      this.updateAllTokens();
    }, this.config.updateIntervalMs);
  }

  /**
   * Stop the periodic update of unified signals
   */
  public stop(): void {
    if (!this.updateInterval) {
      logger.warn('Feature Unifier was not running');
      return;
    }

    clearInterval(this.updateInterval);
    this.updateInterval = null;
    logger.info('Stopped feature unifier');
  }

  /**
   * Register a token for tracking
   */
  public trackToken(token: string): void {
    this.activeTokens.add(token.toUpperCase());
    logger.info(`Now tracking token: ${token}`);
    
    // Trigger an immediate update for this token
    this.updateUnifiedSignal(token);
  }

  /**
   * Stop tracking a token
   */
  public untrackToken(token: string): void {
    this.activeTokens.delete(token.toUpperCase());
    this.signalCache.delete(token.toUpperCase());
    logger.info(`Stopped tracking token: ${token}`);
  }

  /**
   * Get the latest unified signal for a token
   */
  public async getLatestSignal(token: string): Promise<UnifiedSocialSignal | null> {
    const normalizedToken = token.toUpperCase();
    
    // Check cache first
    if (this.signalCache.has(normalizedToken)) {
      return this.signalCache.get(normalizedToken) || null;
    }
    
    // If not in cache, try to get from Redis
    try {
      const key = `social_signal_buffer:${normalizedToken}`;
      const signalJson = await this.redisClient.get(key);
      
      if (signalJson) {
        const signal = JSON.parse(signalJson) as UnifiedSocialSignal;
        this.signalCache.set(normalizedToken, signal);
        return signal;
      }
    } catch (error) {
      logger.error(`Error retrieving signal for ${token} from Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return null;
  }

  /**
   * Process Twitter signals into the unified format
   */
  public async processTwitterSignals(twitterSignals: ScoredSocialSignal[]): Promise<void> {
    const tokenSignalMap = new Map<string, ScoredSocialSignal[]>();
    
    // Group signals by token
    for (const signal of twitterSignals) {
      for (const ticker of signal.tickers) {
        const normalizedTicker = ticker.toUpperCase();
        
        if (!tokenSignalMap.has(normalizedTicker)) {
          tokenSignalMap.set(normalizedTicker, []);
        }
        
        tokenSignalMap.get(normalizedTicker)!.push(signal);
      }
    }
    
    // Process each token's signals
    for (const [token, signals] of tokenSignalMap.entries()) {
      if (this.activeTokens.has(token)) {
        await this.updateTokenSignals(token, 'twitter', signals);
      }
    }
    
    if (this.metricsLogger) {
      this.metricsLogger('social_signals.twitter.processed', twitterSignals.length);
    }
  }

  /**
   * Process Telegram signals into the unified format
   */
  public async processTelegramSignals(telegramSignals: ScoredSocialSignal[]): Promise<void> {
    const tokenSignalMap = new Map<string, ScoredSocialSignal[]>();
    
    // Group signals by token
    for (const signal of telegramSignals) {
      for (const ticker of signal.tickers) {
        const normalizedTicker = ticker.toUpperCase();
        
        if (!tokenSignalMap.has(normalizedTicker)) {
          tokenSignalMap.set(normalizedTicker, []);
        }
        
        tokenSignalMap.get(normalizedTicker)!.push(signal);
      }
    }
    
    // Process each token's signals
    for (const [token, signals] of tokenSignalMap.entries()) {
      if (this.activeTokens.has(token)) {
        await this.updateTokenSignals(token, 'telegram', signals);
      }
    }
    
    if (this.metricsLogger) {
      this.metricsLogger('social_signals.telegram.processed', telegramSignals.length);
    }
  }

  /**
   * Process Reddit signals into the unified format
   */
  public async processRedditSignals(redditSignals: ScoredSocialSignal[]): Promise<void> {
    const tokenSignalMap = new Map<string, ScoredSocialSignal[]>();
    
    // Group signals by token
    for (const signal of redditSignals) {
      for (const ticker of signal.tickers) {
        const normalizedTicker = ticker.toUpperCase();
        
        if (!tokenSignalMap.has(normalizedTicker)) {
          tokenSignalMap.set(normalizedTicker, []);
        }
        
        tokenSignalMap.get(normalizedTicker)!.push(signal);
      }
    }
    
    // Process each token's signals
    for (const [token, signals] of tokenSignalMap.entries()) {
      if (this.activeTokens.has(token)) {
        await this.updateTokenSignals(token, 'reddit', signals);
      }
    }
    
    if (this.metricsLogger) {
      this.metricsLogger('social_signals.reddit.processed', redditSignals.length);
    }
  }

  /**
   * Update signals for a specific token from a specific source
   */
  private async updateTokenSignals(
    token: string, 
    source: 'twitter' | 'telegram' | 'reddit',
    signals: ScoredSocialSignal[]
  ): Promise<void> {
    if (signals.length === 0) return;
    
    const normalizedToken = token.toUpperCase();
    
    // Get current unified signal or create a new one
    let unifiedSignal = await this.getLatestSignal(normalizedToken) || this.createEmptySignal(normalizedToken);
    
    // Calculate source score (0-100)
    const sourceScore = this.calculateSourceScore(signals);
    
    // Update appropriate source score
    if (source === 'twitter') {
      unifiedSignal.sources.twitterScore = sourceScore;
      unifiedSignal.raw = unifiedSignal.raw || {};
      unifiedSignal.raw.tweetIds = signals.map(s => (s as any).id || '').filter(id => id);
    } else if (source === 'telegram') {
      unifiedSignal.sources.telegramScore = sourceScore;
      unifiedSignal.raw = unifiedSignal.raw || {};
      unifiedSignal.raw.tgMessages = signals.map(s => (s as any).id || '').filter(id => id);
    } else if (source === 'reddit') {
      unifiedSignal.sources.redditScore = sourceScore;
      unifiedSignal.raw = unifiedSignal.raw || {};
      unifiedSignal.raw.redditIds = signals.map(s => (s as any).id || '').filter(id => id);
    }
    
    // Update features
    this.updateFeatures(unifiedSignal, signals, source);
    
    // Save updated signal
    this.signalCache.set(normalizedToken, unifiedSignal);
    await this.saveSignalToRedis(unifiedSignal);
    
    logger.debug(`Updated ${source} signals for ${token}`);
  }

  /**
   * Calculate a score from 0-100 for a source based on signals
   */
  private calculateSourceScore(signals: ScoredSocialSignal[]): number {
    if (signals.length === 0) return 0;
    
    // Calculate weighted average of sentiment, relevance, and importance
    let totalWeight = 0;
    let weightedScore = 0;
    
    for (const signal of signals) {
      // Normalize sentiment from [-1,1] to [0,1]
      const normalizedSentiment = (signal.sentiment + 1) / 2;
      
      // Calculate combined score
      const score = (
        normalizedSentiment * 0.4 + 
        (signal.relevance / 100) * 0.4 + 
        (signal.importance / 100) * 0.2
      ) * 100;
      
      // Use importance as weight
      const weight = signal.importance / 100;
      totalWeight += weight;
      weightedScore += score * weight;
    }
    
    // Return weighted average or simple average if no weights
    return totalWeight > 0 
      ? Math.min(100, Math.max(0, weightedScore / totalWeight))
      : Math.min(100, Math.max(0, weightedScore / signals.length));
  }

  /**
   * Update features based on signals
   */
  private updateFeatures(
    unifiedSignal: UnifiedSocialSignal, 
    signals: ScoredSocialSignal[],
    source: 'twitter' | 'telegram' | 'reddit'
  ): void {
    if (signals.length === 0) return;
    
    // Update timestamp to most recent
    const latestTimestamp = Math.max(...signals.map(s => s.timestamp));
    unifiedSignal.timestamp = Math.max(unifiedSignal.timestamp, latestTimestamp);
    
    // Calculate new sentiment (weighted average)
    let totalSentimentWeight = 0;
    let weightedSentiment = 0;
    
    for (const signal of signals) {
      const weight = signal.importance / 100;
      totalSentimentWeight += weight;
      weightedSentiment += signal.sentiment * weight;
    }
    
    const sourceSentiment = totalSentimentWeight > 0
      ? weightedSentiment / totalSentimentWeight
      : signals.reduce((sum, s) => sum + s.sentiment, 0) / signals.length;
    
    // Update overall sentiment as weighted average of all sources
    const weights = this.config.sourceWeights;
    
    // Get existing source weights to calculate weighted average
    const sourceWeights = {
      twitter: unifiedSignal.sources.twitterScore !== undefined ? weights.twitter : 0,
      telegram: unifiedSignal.sources.telegramScore !== undefined ? weights.telegram : 0,
      reddit: unifiedSignal.sources.redditScore !== undefined ? weights.reddit : 0
    };
    
    // Update current source weight
    sourceWeights[source] = weights[source];
    
    // Calculate total weight
    const totalWeight = sourceWeights.twitter + sourceWeights.telegram + sourceWeights.reddit;
    
    if (totalWeight > 0) {
      // Save old sentiment for velocity calculations
      const oldSentiment = unifiedSignal.features.sentiment;
      
      // Get current source sentiments or use new ones
      const sentiments = {
        twitter: source === 'twitter' ? sourceSentiment : oldSentiment,
        telegram: source === 'telegram' ? sourceSentiment : oldSentiment,
        reddit: source === 'reddit' ? sourceSentiment : oldSentiment
      };
      
      // Calculate weighted sentiment
      unifiedSignal.features.sentiment = (
        sentiments.twitter * sourceWeights.twitter +
        sentiments.telegram * sourceWeights.telegram +
        sentiments.reddit * sourceWeights.reddit
      ) / totalWeight;
    }
    
    // Calculate hype (volume of messages relative to baseline)
    // For now, use a simple metric based on signal count
    const newHype = Math.min(1.0, signals.length / 20); // 20+ messages -> max hype
    unifiedSignal.features.hype = Math.max(unifiedSignal.features.hype, newHype);
    
    // Calculate velocity (rate of change)
    // This is a simple implementation; a real one would track historical values
    const now = Date.now();
    const timeWindow = 60 * 60 * 1000; // 1 hour
    const signalsInWindow = signals.filter(s => (now - s.timestamp) < timeWindow);
    const messagesPerMinute = signalsInWindow.length / (timeWindow / 60000);
    unifiedSignal.features.velocity = messagesPerMinute;
    
    // Calculate influencer weight
    let totalInfluencerScore = 0;
    let authorCount = 0;
    
    for (const signal of signals) {
      if (signal.author) {
        authorCount++;
        
        // Calculate author influence based on followers/karma/etc.
        let influence = 0;
        
        if (signal.author.followers && signal.author.followers > 0) {
          // Twitter: Scale followers to 0-1 range (log scale)
          influence = Math.min(1, Math.log10(signal.author.followers) / 6);
        } else if (signal.author.karma && signal.author.karma > 0) {
          // Reddit: Scale karma to 0-1 range (log scale)
          influence = Math.min(1, Math.log10(signal.author.karma) / 5);
        } else if (signal.author.channelSize && signal.author.channelSize > 0) {
          // Telegram: Scale channel size to 0-1 range (log scale)
          influence = Math.min(1, Math.log10(signal.author.channelSize) / 5);
        }
        
        totalInfluencerScore += influence;
      }
    }
    
    // Update influencer weight if we have author data
    if (authorCount > 0) {
      const avgInfluence = totalInfluencerScore / authorCount;
      // Smooth update to existing value
      unifiedSignal.features.influencerWeight = 
        unifiedSignal.features.influencerWeight * 0.7 + avgInfluence * 0.3;
    }
    
    // Detect risk flags
    const newFlags = this.detectRiskFlags(signals);
    unifiedSignal.features.riskFlags = [
      ...new Set([...unifiedSignal.features.riskFlags, ...newFlags])
    ];
  }

  /**
   * Detect risk flags from signals
   */
  private detectRiskFlags(signals: ScoredSocialSignal[]): RiskFlagType[] {
    const flags: RiskFlagType[] = [];
    const thresholds = this.config.riskFlagThresholds;
    
    // FOMO detection
    const fomoKeywords = ['moon', 'moonshot', 'fomo', 'skyrocket', 'explode', '100x', 'get in'];
    const fomoCount = signals.filter(s => 
      fomoKeywords.some(keyword => s.raw?.toLowerCase().includes(keyword))
    ).length;
    
    if (fomoCount / signals.length > thresholds.fomo) {
      flags.push('fomo');
    }
    
    // FUD detection
    const fudKeywords = ['crash', 'dump', 'sell off', 'collapse', 'scam', 'ponzi', 'bubble'];
    const fudCount = signals.filter(s => 
      fudKeywords.some(keyword => s.raw?.toLowerCase().includes(keyword))
    ).length;
    
    if (fudCount / signals.length > thresholds.fud) {
      flags.push('fud');
    }
    
    // Manipulation detection
    const manipulationKeywords = ['pump', 'group', 'scheme', 'coordinated', 'bot', 'fake'];
    const manipulationCount = signals.filter(s => 
      manipulationKeywords.some(keyword => s.raw?.toLowerCase().includes(keyword))
    ).length;
    
    if (manipulationCount / signals.length > thresholds.manipulation) {
      flags.push('manipulation');
    }
    
    // Pump detection
    const isPumpDetected = signals.length > 10 &&
      signals.filter(s => s.sentiment > 0.7).length / signals.length > 0.8;
    
    if (isPumpDetected) {
      flags.push('pump');
    }
    
    // Dump detection
    const isDumpDetected = signals.length > 10 && 
      signals.filter(s => s.sentiment < -0.7).length / signals.length > 0.8;
    
    if (isDumpDetected) {
      flags.push('dump');
    }
    
    return flags;
  }

  /**
   * Update signals for all tracked tokens
   */
  private async updateAllTokens(): Promise<void> {
    try {
      for (const token of this.activeTokens) {
        await this.updateUnifiedSignal(token);
      }
      
      if (this.metricsLogger) {
        this.metricsLogger('social_signals.tokens_updated', this.activeTokens.size);
      }
    } catch (error) {
      logger.error(`Error updating all tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update the unified signal for a specific token
   */
  private async updateUnifiedSignal(token: string): Promise<void> {
    try {
      // Nothing to do if we don't have a Redis client
      if (!this.redisClient) return;
      
      const normalizedToken = token.toUpperCase();
      
      // Decay hype and relevance over time to prevent stale signals
      const signal = await this.getLatestSignal(normalizedToken);
      
      if (signal) {
        // Apply decay to hype (half-life of approximately 6 hours)
        const decayFactor = Math.pow(0.5, this.config.updateIntervalMs / (6 * 60 * 60 * 1000));
        signal.features.hype *= decayFactor;
        
        // Save decayed signal
        this.signalCache.set(normalizedToken, signal);
        await this.saveSignalToRedis(signal);
      }
    } catch (error) {
      logger.error(`Error updating unified signal for ${token}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save signal to Redis
   */
  private async saveSignalToRedis(signal: UnifiedSocialSignal): Promise<void> {
    try {
      const key = `social_signal_buffer:${signal.token}`;
      const signalJson = JSON.stringify(signal);
      
      await this.redisClient.set(key, signalJson, 'EX', this.config.redisConfig.ttlSeconds);
    } catch (error) {
      logger.error(`Error saving signal to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create an empty signal object
   */
  private createEmptySignal(token: string): UnifiedSocialSignal {
    return {
      token: token.toUpperCase(),
      timestamp: Date.now(),
      sources: {},
      features: {
        sentiment: 0,
        hype: 0,
        velocity: 0,
        influencerWeight: 0,
        riskFlags: []
      }
    };
  }
} 