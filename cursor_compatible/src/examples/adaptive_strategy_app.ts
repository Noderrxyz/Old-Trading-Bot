import { MarketFeatures, RegimeClassifier, MarketRegime } from '../regime/RegimeClassifier';
import { AlphaMemory } from '../memory/AlphaMemory';
import { MomentumStrategy } from '../strategy/MomentumStrategy';
import { Signal } from '../strategy/AdaptiveStrategy';
import { logger } from '../utils/logger';

/**
 * Example application demonstrating adaptive strategy execution
 * with RegimeClassifier, AlphaMemory, and MomentumStrategy
 */
class AdaptiveStrategyApp {
  private strategy: MomentumStrategy;
  private regimeClassifier: RegimeClassifier;
  private alphaMemory: AlphaMemory;
  private symbol: string;
  
  constructor(symbol: string = 'BTC/USD') {
    this.symbol = symbol;
    
    // Get singleton instances
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.alphaMemory = AlphaMemory.getInstance();
    
    // Create the strategy with the symbol
    this.strategy = new MomentumStrategy(
      `momentum-${Date.now()}`,
      this.symbol
    );
    
    logger.info(`Initialized Adaptive Strategy App for ${symbol}`);
  }
  
  /**
   * Process new market data
   * @param features The current market features
   */
  public async processMarketData(features: MarketFeatures): Promise<Signal | null> {
    // Step 1: Classify current market regime
    const classification = this.regimeClassifier.classifyRegime(this.symbol, features);
    console.log(`Current market regime: ${classification.primaryRegime} (confidence: ${classification.confidence.toFixed(2)})`);
    
    if (classification.secondaryRegime) {
      console.log(`Secondary regime: ${classification.secondaryRegime}`);
    }
    
    // Get top 3 regimes for additional insights
    const top3Regimes = Object.entries(classification.scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([regime, score]) => `${regime}: ${score.toFixed(2)}`);
    
    console.log(`Top regime scores: ${top3Regimes.join(', ')}`);
    
    // Step 2: Generate trading signal with the classified regime
    const signal = await this.strategy.generateSignal(features);
    
    if (signal) {
      console.log(`Generated ${signal.direction.toUpperCase()} signal with strength ${signal.strength?.toFixed(2) || 'N/A'}`);
      console.log(`Signal confidence: ${signal.confidence?.toFixed(2) || 'N/A'} (regime confidence: ${signal.regimeConfidence.toFixed(2)})`);
      console.log(`Regime type: ${signal.regimeType}`);
      console.log(`Signal metadata:`, signal.metadata);
    } else {
      console.log('No signal generated');
    }
    
    return signal;
  }
  
  /**
   * Demonstrate regime transitions and parameter adaptation
   * @param features1 First market regime features
   * @param features2 Second market regime features  
   */
  public async demonstrateRegimeTransition(features1: MarketFeatures, features2: MarketFeatures): Promise<void> {
    console.log('\n=== DEMONSTRATING REGIME TRANSITIONS ===');
    
    // Process first set of features
    console.log('\n[First Market Regime]');
    const classification1 = this.regimeClassifier.classifyRegime(this.symbol, features1);
    console.log(`Classified as: ${classification1.primaryRegime}`);
    
    // Get initial parameters
    const initialParameters = this.strategy['currentParameters'];
    console.log('Initial Parameters:', JSON.stringify(initialParameters, null, 2));
    
    // Process signal
    const signal1 = await this.strategy.generateSignal(features1);
    if (signal1) {
      console.log(`Generated ${signal1.direction} signal`);
    }
    
    // Force a different regime by processing new features
    console.log('\n[Second Market Regime]');
    const classification2 = this.regimeClassifier.classifyRegime(this.symbol, features2);
    console.log(`Classified as: ${classification2.primaryRegime}`);
    
    // Get adapted parameters
    const adaptedParameters = this.strategy['currentParameters'];
    console.log('Adapted Parameters:', JSON.stringify(adaptedParameters, null, 2));
    
    // Process signal with new regime
    const signal2 = await this.strategy.generateSignal(features2);
    if (signal2) {
      console.log(`Generated ${signal2.direction} signal`);
    }
    
    // Show parameter differences
    console.log('\n[Parameter Adaptation Summary]');
    const paramDiffs = this.compareParameters(initialParameters, adaptedParameters);
    console.log('Parameter changes:', paramDiffs);
  }
  
  /**
   * Compare two parameter sets and return the differences
   */
  private compareParameters(params1: any, params2: any): Record<string, {before: any, after: any}> {
    const diffs: Record<string, {before: any, after: any}> = {};
    
    // Find all keys
    const allKeys = new Set([...Object.keys(params1), ...Object.keys(params2)]);
    
    // Check for differences
    for (const key of allKeys) {
      const val1 = params1[key];
      const val2 = params2[key];
      
      if (val1 !== val2) {
        diffs[key] = { before: val1, after: val2 };
      }
    }
    
    return diffs;
  }
  
  /**
   * Run a simple demo with sample data
   */
  public async runDemo(): Promise<void> {
    console.log('Running Adaptive Strategy Demo');
    
    // Sample market features
    const bullishFeatures: MarketFeatures = {
      price: 50000,
      returns1d: 0.03,
      returns5d: 0.08,
      returns20d: 0.15,
      volatility1d: 0.02,
      volatility5d: 0.04,
      volatility20d: 0.06,
      volumeRatio1d: 1.2,
      volumeRatio5d: 1.4,
      rsi14: 68,
      atr14: 1200,
      bbWidth: 0.04,
      macdHistogram: 0.003,
      advanceDeclineRatio: 1.8,
      marketCap: 950000000000,
      vix: 18,
      usdIndex: 92.5,
      yieldCurve: 1.2
    };
    
    const bearishFeatures: MarketFeatures = {
      price: 42000,
      returns1d: -0.04,
      returns5d: -0.12,
      returns20d: -0.25,
      volatility1d: 0.04,
      volatility5d: 0.07,
      volatility20d: 0.1,
      volumeRatio1d: 1.8,
      volumeRatio5d: 1.5,
      rsi14: 32,
      atr14: 1800,
      bbWidth: 0.07,
      macdHistogram: -0.004,
      advanceDeclineRatio: 0.6,
      marketCap: 800000000000,
      vix: 28,
      usdIndex: 95.2,
      yieldCurve: 0.5
    };
    
    const rangeBoundFeatures: MarketFeatures = {
      price: 45000,
      returns1d: 0.01,
      returns5d: -0.01,
      returns20d: 0.02,
      volatility1d: 0.01,
      volatility5d: 0.02,
      volatility20d: 0.03,
      volumeRatio1d: 0.8,
      volumeRatio5d: 0.9,
      rsi14: 52,
      atr14: 800,
      bbWidth: 0.02,
      macdHistogram: 0.0005,
      advanceDeclineRatio: 1.1,
      marketCap: 850000000000,
      vix: 16,
      usdIndex: 93.2,
      yieldCurve: 0.8
    };
    
    // Process bullish market data
    console.log('\n--- Bullish Market Scenario ---');
    const bullishSignal = await this.processMarketData(bullishFeatures);
    
    // Process bearish market data
    console.log('\n--- Bearish Market Scenario ---');
    const bearishSignal = await this.processMarketData(bearishFeatures);
    
    // Process rangebound market data
    console.log('\n--- Rangebound Market Scenario ---');
    const rangeboundSignal = await this.processMarketData(rangeBoundFeatures);
    
    // Demonstrate regime transitions and parameter adaptation
    await this.demonstrateRegimeTransition(bullishFeatures, bearishFeatures);
    
    console.log('\nDemo completed');
  }
}

// If this file is run directly, run the demo
if (require.main === module) {
  const app = new AdaptiveStrategyApp();
  app.runDemo().catch(console.error);
}

export { AdaptiveStrategyApp }; 