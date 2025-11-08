/**
 * Social Signals Module
 * 
 * This module provides functionality for unifying social media signals (Twitter, Telegram, Reddit)
 * and injecting them into trading strategy models for real-time influence on trading decisions.
 */

// Export types
export * from './types.js';

// Export main components
export { FeatureUnifier } from './featureUnifier.js';
export { RedisPublisher } from './redisPublisher.js';
export { 
  SocialModelAdapter,
  type SocialAwareStrategyModel,
  type StrategyModelConfig,
  type SignalInjectionResult
} from './socialModelAdapter.js';
export { ModelDebugger } from './modelDebugger.js';

// Type for Redis client
type RedisClient = any;

// Convenience function to set up the social signals pipeline
export async function setupSocialSignalsPipeline(config: {
  redisUrl: string;
  redisClient?: RedisClient; // Allow passing in an existing Redis client
  ttlSeconds?: number;
  updateIntervalMs?: number;
  lookbackWindowMinutes?: number;
  sourceWeights?: {
    twitter: number;
    telegram: number;
    reddit: number;
  };
  metricsLogger?: (metric: string, value: any) => void;
}) {
  // Import dependencies dynamically to avoid circular references
  const { FeatureUnifier } = await import('./featureUnifier.js');
  const { RedisPublisher } = await import('./redisPublisher.js');
  const { SocialModelAdapter } = await import('./socialModelAdapter.js');
  const { ModelDebugger } = await import('./modelDebugger.js');
  
  // Use provided Redis client or create a new one
  let redisClient: RedisClient;
  let needToCloseRedis = false;
  
  if (config.redisClient) {
    redisClient = config.redisClient;
    console.log('Using provided Redis client for social signals pipeline');
  } else {
    try {
      // This is a simplified approach - in a real implementation, 
      // the Redis client should be passed in from the application
      console.log('No Redis client provided, this is a placeholder for demonstration purposes');
      redisClient = {
        // Mock Redis client with minimal functionality
        get: async (key: string) => null,
        set: async (key: string, value: string) => 'OK',
        xadd: async (...args: any[]) => '1-0',
        xrevrange: async (...args: any[]) => [],
        publish: async (channel: string, message: string) => 0,
        hset: async (key: string, field: string, value: string) => 1,
        expire: async (key: string, seconds: number) => 1,
        del: async (...keys: string[]) => keys.length,
        keys: async (pattern: string) => [],
        zcard: async (key: string) => 0,
      };
      needToCloseRedis = false;
    } catch (error) {
      console.error('Error creating Redis client:', error);
      throw new Error('Failed to create Redis client for social signals pipeline');
    }
  }
  
  // Set up default configuration values
  const ttlSeconds = config.ttlSeconds || 3600; // 1 hour
  const updateIntervalMs = config.updateIntervalMs || 60000; // 1 minute
  const lookbackWindowMinutes = config.lookbackWindowMinutes || 60; // 1 hour
  const sourceWeights = config.sourceWeights || {
    twitter: 0.4,
    telegram: 0.3,
    reddit: 0.3
  };
  
  // Initialize FeatureUnifier
  const featureUnifier = new FeatureUnifier({
    lookbackWindowMinutes,
    updateIntervalMs,
    redisConfig: {
      url: config.redisUrl,
      ttlSeconds
    },
    sourceWeights,
    riskFlagThresholds: {
      fomo: 0.3,
      fud: 0.3,
      manipulation: 0.2
    }
  }, redisClient, config.metricsLogger);
  
  // Initialize RedisPublisher
  const redisPublisher = new RedisPublisher({
    url: config.redisUrl,
    ttlSeconds,
    maxStreamLength: 1000
  }, redisClient, config.metricsLogger);
  
  // Initialize ModelAdapter
  const modelAdapter = new SocialModelAdapter({
    defaultSocialInfluenceWeight: 0.3,
    updateIntervalMs,
    signalValidityPeriodMs: ttlSeconds * 1000
  }, token => featureUnifier.getLatestSignal(token), config.metricsLogger);
  
  // Initialize ModelDebugger
  const modelDebugger = new ModelDebugger();
  
  // Start components
  featureUnifier.start();
  modelAdapter.start();
  
  console.log('Social signals pipeline initialized and running');
  
  return {
    featureUnifier,
    redisPublisher,
    modelAdapter,
    modelDebugger,
    redisClient,
    shutdown: async () => {
      // Stop components
      featureUnifier.stop();
      modelAdapter.stop();
      
      // Close Redis connection if we created it
      if (needToCloseRedis && redisClient && typeof redisClient.quit === 'function') {
        await redisClient.quit();
      }
      
      console.log('Social signals pipeline shut down');
    }
  };
}

// Example usage wrapper for quick integration into strategies
export class SocialFeatureService {
  private featureUnifier: any;
  private redisPublisher: any;
  private modelAdapter: any;
  private modelDebugger: any;
  private initialized = false;
  
  constructor() {}
  
  /**
   * Initialize the service
   */
  public async initialize(config: {
    redisUrl: string;
    redisClient?: RedisClient;
    tokens: string[];
    metricsLogger?: (metric: string, value: any) => void;
  }): Promise<void> {
    const pipeline = await setupSocialSignalsPipeline({
      redisUrl: config.redisUrl,
      redisClient: config.redisClient,
      metricsLogger: config.metricsLogger
    });
    
    this.featureUnifier = pipeline.featureUnifier;
    this.redisPublisher = pipeline.redisPublisher;
    this.modelAdapter = pipeline.modelAdapter;
    this.modelDebugger = pipeline.modelDebugger;
    
    // Start tracking tokens
    for (const token of config.tokens) {
      this.featureUnifier.trackToken(token);
    }
    
    this.initialized = true;
    console.log(`Social Feature Service initialized with ${config.tokens.length} tokens`);
  }
  
  /**
   * Get the latest social signal for a token
   */
  public async getLatest(token: string): Promise<any> {
    if (!this.initialized) {
      throw new Error('Social Feature Service not initialized');
    }
    
    return this.featureUnifier.getLatestSignal(token);
  }
  
  /**
   * Process signals from Twitter
   */
  public async processTwitterSignals(signals: any[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('Social Feature Service not initialized');
    }
    
    await this.featureUnifier.processTwitterSignals(signals);
  }
  
  /**
   * Process signals from Telegram
   */
  public async processTelegramSignals(signals: any[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('Social Feature Service not initialized');
    }
    
    await this.featureUnifier.processTelegramSignals(signals);
  }
  
  /**
   * Process signals from Reddit
   */
  public async processRedditSignals(signals: any[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('Social Feature Service not initialized');
    }
    
    await this.featureUnifier.processRedditSignals(signals);
  }
  
  /**
   * Register a strategy model for signal injection
   */
  public registerStrategyModel(model: any, config?: any): void {
    if (!this.initialized) {
      throw new Error('Social Feature Service not initialized');
    }
    
    this.modelAdapter.registerModel(model, config);
  }
  
  /**
   * Generate a performance report for a strategy
   */
  public generatePerformanceReport(strategyId: string, hours: number = 24): string {
    if (!this.initialized) {
      throw new Error('Social Feature Service not initialized');
    }
    
    return this.modelDebugger.generatePerformanceReport(strategyId, hours);
  }
} 