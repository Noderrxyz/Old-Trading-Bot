import { StrategyEngineRust, RiskGrade, ExecutionHorizon } from '../execution/StrategyEngineRust';
import { MomentumStrategy } from '../strategy/MomentumStrategy';
import { RegimeClassifier } from '../regime/RegimeClassifier';
import { AlphaMemory } from '../memory/AlphaMemory';
import { Signal } from '../types/strategy';
import { logger } from '../utils/logger';

/**
 * Demo application showcasing the StrategyEngine integrated with AdaptiveStrategy
 */
class StrategyEngineDemo {
  private strategyEngine: StrategyEngineRust;
  private momentumStrategy: MomentumStrategy;
  private regimeClassifier: RegimeClassifier;
  private memory: AlphaMemory;
  
  /**
   * Constructor
   */
  constructor() {
    // Initialize dependencies
    this.strategyEngine = StrategyEngineRust.getInstance();
    this.regimeClassifier = new RegimeClassifier();
    this.memory = new AlphaMemory();
    
    // Configure strategy engine
    this.strategyEngine.updateConfig({
      dryrunMode: true, // Use dry run mode for demo
      applyRiskChecks: true,
      minTrustScore: 0.6,
      confidenceBasedSizing: true
    });
    
    // Initialize strategy
    this.momentumStrategy = new MomentumStrategy(
      'momentum-1',
      'BTC/USD',
      this.regimeClassifier,
      this.memory
    );
    
    logger.info('StrategyEngineDemo initialized');
  }
  
  /**
   * Run the demo with different market scenarios
   */
  public async run(): Promise<void> {
    logger.info('Starting Strategy Engine Demo');
    
    // Configure demo parameters
    const demoParams = {
      runDuration: 60, // seconds
      signalInterval: 10, // seconds
      simulateExecutionErrors: true
    };
    
    logger.info(`Demo will run for ${demoParams.runDuration} seconds with signal generation every ${demoParams.signalInterval} seconds`);
    
    // Simulate different market regimes
    await this.simulateRegime('bull_trend', 2);
    await this.simulateRegime('bear_trend', 2);
    await this.simulateRegime('choppy', 2);
    
    logger.info('Strategy Engine Demo completed');
  }
  
  /**
   * Simulate a specific market regime and generate signals
   * @param regimeType The regime type to simulate
   * @param iterations Number of signals to generate
   */
  private async simulateRegime(regimeType: string, iterations: number): Promise<void> {
    logger.info(`Simulating ${regimeType} regime for ${iterations} iterations`);
    
    // Set the regime in classifier
    this.regimeClassifier.setCurrentRegime({
      type: regimeType,
      confidence: 0.9,
      timestamp: new Date(),
      volatility: regimeType === 'choppy' ? 0.8 : 0.4,
      trend: regimeType.startsWith('bull') ? 0.7 : (regimeType.startsWith('bear') ? -0.7 : 0.1)
    });
    
    // Update strategy parameters for this regime
    this.momentumStrategy.updateParameters(regimeType);
    
    // Generate multiple signals
    for (let i = 0; i < iterations; i++) {
      // Generate market features based on regime
      const marketFeatures = this.generateMarketFeatures(regimeType);
      
      // Generate signal
      const signal = await this.momentumStrategy.generateSignal(marketFeatures);
      
      if (signal) {
        logger.info(`Generated signal: ${JSON.stringify({
          id: signal.id,
          action: signal.action,
          direction: signal.direction,
          confidence: signal.confidence,
          strength: signal.strength,
        })}`);
        
        // Process signal through both strategy and direct engine
        await this.processSignalWithStrategy(signal);
        await this.processSignalWithEngine(signal);
      } else {
        logger.info('No signal generated for the current market condition');
      }
      
      // Pause between iterations
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  /**
   * Process a signal using the MomentumStrategy's processSignal method
   * @param signal The signal to process
   */
  private async processSignalWithStrategy(signal: Signal): Promise<void> {
    logger.info(`Processing signal ${signal.id} through MomentumStrategy`);
    
    try {
      const success = await this.momentumStrategy.processSignal(signal);
      logger.info(`Strategy execution ${success ? 'succeeded' : 'failed'}`);
    } catch (error) {
      logger.error('Error during strategy signal processing:', error);
    }
  }
  
  /**
   * Process a signal directly using the StrategyEngine
   * @param signal The signal to process
   */
  private async processSignalWithEngine(signal: Signal): Promise<void> {
    logger.info(`Processing signal ${signal.id} directly through StrategyEngine`);
    
    try {
      // First evaluate the signal
      const evaluation = await this.strategyEngine.evaluateSignal(signal);
      
      logger.info(`Signal evaluation: passed=${evaluation.passed}, trust=${evaluation.trustScore}, probability=${evaluation.executionProbability}`);
      
      if (evaluation.passed) {
        // Execute the signal
        const result = await this.strategyEngine.executeStrategy(signal);
        
        logger.info(`Execution result: status=${result.status}, time=${result.executionTimeMs}ms`);
        
        // Calculate metrics
        const metrics = this.strategyEngine.calculateSignalMetrics(signal, result);
        
        logger.info(`Signal metrics: success=${metrics.success}, slippage=${metrics.slippagePct}%, latency=${metrics.executionLatencyMs}ms`);
      } else {
        logger.warn(`Signal did not pass evaluation, violations: ${JSON.stringify(evaluation.riskViolations)}`);
      }
    } catch (error) {
      logger.error('Error during direct engine processing:', error);
    }
  }
  
  /**
   * Generate synthetic market features based on regime
   * @param regimeType The regime type to generate features for
   * @returns Market features
   */
  private generateMarketFeatures(regimeType: string): Record<string, number> {
    const baseFeatures = {
      'price': 35000 + (Math.random() * 1000 - 500),
      'volume': 100 + Math.random() * 50,
      'rsi_14': 50,
      'bb_width': 0.5 + Math.random() * 0.2,
      'macd': 0,
      'macd_signal': 0,
      'atr': 200 + Math.random() * 100,
    };
    
    // Adjust features based on regime
    if (regimeType === 'bull_trend') {
      baseFeatures.rsi_14 = 65 + Math.random() * 15;
      baseFeatures.macd = 10 + Math.random() * 5;
      baseFeatures.macd_signal = 5 + Math.random() * 5;
    } else if (regimeType === 'bear_trend') {
      baseFeatures.rsi_14 = 35 - Math.random() * 15;
      baseFeatures.macd = -10 - Math.random() * 5;
      baseFeatures.macd_signal = -5 - Math.random() * 5;
    } else if (regimeType === 'choppy') {
      baseFeatures.rsi_14 = 45 + Math.random() * 10;
      baseFeatures.bb_width = 0.8 + Math.random() * 0.4;
      baseFeatures.macd = Math.random() * 6 - 3;
      baseFeatures.macd_signal = Math.random() * 6 - 3;
      baseFeatures.atr = 300 + Math.random() * 150;
    }
    
    return baseFeatures;
  }
  
  /**
   * Create a synthetic signal for testing
   * @param action Signal action (1=enter, 2=exit)
   * @param direction Position direction (1=long, -1=short)
   * @returns A synthetic signal
   */
  private createSyntheticSignal(action: number, direction: number): Signal {
    return {
      id: `synthetic-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      strategyId: 'synthetic-strategy',
      symbol: 'BTC/USD',
      action: action,
      direction: direction,
      price: 35000 + (Math.random() * 1000 - 500),
      confidence: 0.7 + Math.random() * 0.3,
      strength: 0.6 + Math.random() * 0.4,
      timestamp: new Date(),
      expiration: new Date(Date.now() + 60000), // 1 minute expiration
      riskGrade: RiskGrade.Medium,
      executionHorizon: ExecutionHorizon.ShortTerm,
      trustVector: {
        'signal_quality': 0.8 + Math.random() * 0.2,
        'market_context': 0.7 + Math.random() * 0.3
      }
    };
  }
}

// Run the demo
if (require.main === module) {
  const demo = new StrategyEngineDemo();
  demo.run().catch(err => {
    logger.error('Demo failed:', err);
    process.exit(1);
  });
}

// Export for testing/importing
export { StrategyEngineDemo }; 