/**
 * Example of using Market Microstructure Analysis in a trading strategy
 * 
 * This example demonstrates how to integrate the MicrostructureAnalyzer
 * into a trading strategy to detect market anomalies and improve execution.
 */

import { RedisClient } from '../infra/core/RedisClient.js';
import { MicrostructureAnalyzer } from '../infra/marketdata/MicrostructureAnalyzer.js';

// Mock TradingStrategy to demonstrate integration
class TradingStrategy {
  public bias: 'NEUTRAL' | 'LONG' | 'SHORT' = 'NEUTRAL';
  private isPaused = false;
  private pauseReason = '';
  
  constructor(
    private name: string,
    private symbol: string,
    private venue: string,
    private microstructureAnalyzer: MicrostructureAnalyzer
  ) {}
  
  /**
   * Pause execution due to detected market conditions
   */
  pauseExecution(reason: string): void {
    this.isPaused = true;
    this.pauseReason = reason;
    console.log(`[${this.name}] Strategy PAUSED: ${reason}`);
  }
  
  /**
   * Resume execution
   */
  resumeExecution(): void {
    this.isPaused = false;
    this.pauseReason = '';
    console.log(`[${this.name}] Strategy RESUMED`);
  }
  
  /**
   * Check if execution is currently paused
   */
  isExecutionPaused(): boolean {
    return this.isPaused;
  }
  
  /**
   * Get current pause reason
   */
  getPauseReason(): string {
    return this.pauseReason;
  }
  
  /**
   * Log a message with strategy context
   */
  log(message: string): void {
    console.log(`[${this.name}][${this.symbol}] ${message}`);
  }
  
  /**
   * Main strategy update loop that checks microstructure metrics
   */
  async update(): Promise<void> {
    // Get latest microstructure metrics
    const metrics = await this.microstructureAnalyzer.analyze(this.venue);
    
    if (!metrics) {
      this.log('No microstructure data available');
      return;
    }
    
    // Log the current metrics
    this.log(`Microstructure metrics: 
      Imbalance: ${metrics.topImbalance.toFixed(2)}, 
      Spoofing: ${metrics.spoofingScore.toFixed(2)}, 
      Spread Pressure: ${metrics.spreadPressure.toFixed(4)},
      Quote Volatility: ${metrics.quoteVolatility.toFixed(2)},
      Sweep Risk: ${metrics.sweepRisk.toFixed(2)}
    `);
    
    // Example 1: Detect potential market manipulation
    if (metrics.spoofingScore > 0.7 || metrics.sweepRisk > 0.9) {
      this.pauseExecution("Market manipulation detected");
      return;
    }
    
    // Example 2: Set bias based on orderbook imbalance
    if (metrics.topImbalance > 0.5) {
      this.bias = 'LONG';
      this.log('Setting bias to LONG due to strong buy imbalance');
    } else if (metrics.topImbalance < -0.5) {
      this.bias = 'SHORT';
      this.log('Setting bias to SHORT due to strong sell imbalance');
    } else {
      this.bias = 'NEUTRAL';
    }
    
    // Example 3: Adjust position size based on market volatility
    const positionSizeFactor = this.calculatePositionSizeFactor(metrics.quoteVolatility);
    this.log(`Adjusting position size factor to ${positionSizeFactor.toFixed(2)} based on volatility`);
    
    // Example 4: Detect unstable spreads and adjust execution urgency
    if (metrics.spreadPressure > 0.01) {
      this.log('Spread widening detected, delaying execution');
      // Insert execution delay logic
    } else if (metrics.spreadPressure < -0.01) {
      this.log('Spread tightening detected, accelerating execution');
      // Insert execution acceleration logic
    }
    
    // Resume execution if conditions have normalized
    if (
      this.isExecutionPaused() && 
      metrics.spoofingScore < 0.5 && 
      metrics.sweepRisk < 0.7
    ) {
      this.resumeExecution();
    }
    
    // Store metrics for historical analysis
    await this.microstructureAnalyzer.storeMetrics(this.venue, metrics);
  }
  
  /**
   * Calculate position size factor based on volatility
   * Returns a value between 0.1 (very volatile) and 1.0 (stable)
   */
  private calculatePositionSizeFactor(volatility: number): number {
    // Normalize volatility to a 0-1 scale
    const normalizedVol = Math.min(1, volatility / 0.5);
    // Inverse relationship: lower position size when more volatile
    return Math.max(0.1, 1 - normalizedVol * 0.9);
  }
}

/**
 * Main function to demonstrate usage
 */
async function main(): Promise<void> {
  // Initialize Redis client
  const redis = new RedisClient({
    host: 'localhost',
    port: 6379
  });
  
  // Create microstructure analyzer
  const analyzer = new MicrostructureAnalyzer(redis);
  
  // Create mock orderbook snapshot
  const mockOrderbook = {
    bids: [
      [50000, 2.5], // [price, size]
      [49950, 3.0],
      [49900, 5.0],
      [49850, 7.5],
      [49800, 10.0]
    ],
    asks: [
      [50050, 1.5],
      [50100, 2.0],
      [50150, 3.5],
      [50200, 5.0],
      [50250, 8.0]
    ],
    timestamp: new Date().toISOString()
  };
  
  // Store mock orderbook data
  const venue = 'binance_spot_btcusdt';
  await analyzer.storeOrderbookSnapshot(venue, JSON.stringify(mockOrderbook));
  
  // Create strategy and run an update
  const strategy = new TradingStrategy(
    'BTC_Momentum',
    'BTC/USDT',
    venue,
    analyzer
  );
  
  // Run the strategy update
  await strategy.update();
  
  // Clean up
  await redis.quit();
}

// Run the example if this file is executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error running microstructure example:', err);
    process.exit(1);
  });
}

export default TradingStrategy; 