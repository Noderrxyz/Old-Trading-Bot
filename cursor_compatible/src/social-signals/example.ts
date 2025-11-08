/**
 * Example usage of the Social Signals Module
 * 
 * This example demonstrates how to use the social signals module to unify
 * social media signals from different platforms and inject them into trading models.
 */

import { 
  SocialFeatureService,
  FeatureUnifier,
  RedisPublisher,
  SocialModelAdapter,
  SocialAwareStrategyModel,
  UnifiedSocialSignal,
  ModelDebugger
} from './index.js';
import { ScoredSocialSignal } from '../scoring/types.js';

/**
 * Example implementation of a strategy model that can receive social signals
 */
class ExampleStrategy implements SocialAwareStrategyModel {
  private strategyId: string;
  private token: string;
  private socialConfig = {
    enabled: true,
    weight: 0.3,
    maxBiasAdjustment: 0.15
  };
  private currentBias = 0;
  private riskDiscount = 1.0;
  private confidenceMultiplier = 1.0;

  constructor(strategyId: string, token: string) {
    this.strategyId = strategyId;
    this.token = token;
    console.log(`Created example strategy ${strategyId} for token ${token}`);
  }

  getStrategyId(): string {
    return this.strategyId;
  }

  getToken(): string {
    return this.token;
  }

  adjustRiskBias(biasAdjustment: number): void {
    const oldBias = this.currentBias;
    this.currentBias += biasAdjustment;
    
    // Keep bias within reasonable bounds
    this.currentBias = Math.max(-0.5, Math.min(0.5, this.currentBias));
    
    console.log(`[${this.strategyId}] Adjusted risk bias from ${oldBias.toFixed(4)} to ${this.currentBias.toFixed(4)} (adjustment: ${biasAdjustment.toFixed(4)})`);
  }

  adjustRiskParameters(riskDiscount: number, confidenceMultiplier: number): void {
    this.riskDiscount = riskDiscount;
    this.confidenceMultiplier = confidenceMultiplier;
    
    console.log(`[${this.strategyId}] Adjusted risk parameters: discount=${riskDiscount.toFixed(2)}, confidenceMultiplier=${confidenceMultiplier.toFixed(2)}`);
  }

  getSocialInfluenceConfig(): { enabled: boolean; weight: number; maxBiasAdjustment: number; } {
    return this.socialConfig;
  }

  // Example method to execute a trade based on all signals
  executeTrade(): void {
    // Apply social bias to base signal
    const baseSignal = 0.2; // Some base trading signal from technical analysis
    const adjustedSignal = baseSignal + this.currentBias;
    
    // Apply risk discount to position size
    const baseSize = 1.0;
    const adjustedSize = baseSize * this.riskDiscount;
    
    // Apply confidence threshold
    const baseConfidence = 0.65;
    const requiredConfidence = baseConfidence * this.confidenceMultiplier;
    const currentConfidence = 0.7;
    const confidenceCheck = currentConfidence >= requiredConfidence;
    
    console.log(`[${this.strategyId}] Trade execution:`);
    console.log(`  - Base signal: ${baseSignal.toFixed(4)}`);
    console.log(`  - Social bias: ${this.currentBias.toFixed(4)}`);
    console.log(`  - Adjusted signal: ${adjustedSignal.toFixed(4)}`);
    console.log(`  - Position size: ${adjustedSize.toFixed(2)} (discount: ${this.riskDiscount.toFixed(2)})`);
    console.log(`  - Confidence: ${currentConfidence.toFixed(2)} vs required ${requiredConfidence.toFixed(2)} - ${confidenceCheck ? 'PASS' : 'FAIL'}`);
    
    if (adjustedSignal > 0.1 && confidenceCheck) {
      console.log(`  → BUY ${this.token} with size ${adjustedSize.toFixed(2)}`);
    } else if (adjustedSignal < -0.1 && confidenceCheck) {
      console.log(`  → SELL ${this.token} with size ${adjustedSize.toFixed(2)}`);
    } else {
      console.log(`  → HOLD ${this.token} (no action)`);
    }
  }
}

/**
 * Create mock social signal data for testing
 */
function createMockTwitterSignals(token: string, count: number): ScoredSocialSignal[] {
  const signals: ScoredSocialSignal[] = [];
  
  for (let i = 0; i < count; i++) {
    signals.push({
      source: 'twitter',
      sentiment: Math.random() * 2 - 1, // -1 to 1
      relevance: Math.random() * 100,   // 0 to 100
      importance: Math.random() * 100,  // 0 to 100
      summary: `Mock Twitter signal ${i} about ${token}`,
      tickers: [token],
      tags: ['example', 'test'],
      timestamp: Date.now() - Math.random() * 3600000, // Within the last hour
      raw: `This is a mock tweet about $${token} for testing purposes.`,
      author: {
        name: `twitter_user_${i}`,
        followers: Math.floor(Math.random() * 50000)
      }
    });
  }
  
  return signals;
}

/**
 * Run the social signals integration example
 */
async function runExample() {
  console.log('Starting Social Signals Integration Example\n');
  
  // Create example strategies
  const btcStrategy = new ExampleStrategy('btc_momentum_1', 'BTC');
  const ethStrategy = new ExampleStrategy('eth_momentum_1', 'ETH');
  
  // Create a mock Redis client (in a real app, use a real Redis client)
  const mockRedisClient = {
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
  
  // Set up the social feature service
  const socialService = new SocialFeatureService();
  await socialService.initialize({
    redisUrl: 'redis://localhost:6379',
    redisClient: mockRedisClient,
    tokens: ['BTC', 'ETH'],
    metricsLogger: (metric, value) => console.log(`METRIC: ${metric} = ${value}`)
  });
  
  // Register the strategies with the social service
  socialService.registerStrategyModel(btcStrategy, {
    socialInfluenceWeight: 0.4, // Override default weight
    riskFlagHandling: {
      reduceSize: true,
      increaseConfidenceThreshold: true,
      maxRiskDiscount: 0.5
    }
  });
  
  socialService.registerStrategyModel(ethStrategy);
  
  console.log('\nProcessing mock Twitter signals for BTC...');
  // Process mock Twitter signals for BTC
  const btcTwitterSignals = createMockTwitterSignals('BTC', 5);
  await socialService.processTwitterSignals(btcTwitterSignals);
  
  console.log('\nProcessing mock Twitter signals for ETH...');
  // Process mock Twitter signals for ETH
  const ethTwitterSignals = createMockTwitterSignals('ETH', 5);
  await socialService.processTwitterSignals(ethTwitterSignals);
  
  // Wait a moment for signals to be processed
  console.log('\nWaiting a moment for signals to be processed...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Get the latest signals
  console.log('\nLatest BTC signal:');
  const btcSignal = await socialService.getLatest('BTC');
  console.log(JSON.stringify(btcSignal, null, 2));
  
  console.log('\nLatest ETH signal:');
  const ethSignal = await socialService.getLatest('ETH');
  console.log(JSON.stringify(ethSignal, null, 2));
  
  // Execute trades to demonstrate social signal influence
  console.log('\nExecuting trades with social signal influence:');
  btcStrategy.executeTrade();
  ethStrategy.executeTrade();
}

// Run the example
runExample()
  .then(() => console.log('\nExample completed successfully'))
  .catch(error => console.error('Error running example:', error)); 