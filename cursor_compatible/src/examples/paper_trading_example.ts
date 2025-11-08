import { RegimeClassifier, MarketFeatures } from '../regime/RegimeClassifier';
import { AlphaMemory } from '../memory/AlphaMemory';
import { MomentumStrategy } from '../strategy/MomentumStrategy';
import { Signal } from '../strategy/AdaptiveStrategy';
import { PaperTradingAdapter } from '../execution/adapters/PaperTradingAdapter';
import { SlippageModel } from '../execution/interfaces/PaperTradingTypes';
import { logger } from '../utils/logger';
import { createConsoleDashboard, PaperTradingDashboard } from '../dashboard/PaperTradingDashboard';

/**
 * Example application demonstrating paper trading with AdaptiveStrategy
 */
class PaperTradingExample {
  private strategy: MomentumStrategy;
  private regimeClassifier: RegimeClassifier;
  private alphaMemory: AlphaMemory;
  private paperTrading: PaperTradingAdapter;
  private dashboard: PaperTradingDashboard;
  private symbol: string;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  
  constructor(symbol: string = 'BTC/USD', initialBalance: number = 10000) {
    this.symbol = symbol;
    
    // Initialize components
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.alphaMemory = AlphaMemory.getInstance();
    
    // Initialize paper trading with custom config
    this.paperTrading = PaperTradingAdapter.getInstance({
      initialBalance,
      defaultSlippageModel: SlippageModel.SizeDependent,
      verboseLogging: true,
      defaultLatencyMs: 350
    });
    
    // Create the strategy
    this.strategy = new MomentumStrategy(
      `momentum-${Date.now()}`,
      this.symbol
    );
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Create and start the dashboard
    this.dashboard = createConsoleDashboard(this.paperTrading);
    this.dashboard.start(1000); // Update every second
    
    logger.info(`PaperTradingExample initialized for ${symbol} with $${initialBalance} initial balance`);
  }
  
  /**
   * Set up event listeners for paper trading events
   */
  private setupEventListeners(): void {
    // Listen for position updates
    this.paperTrading.on('position_update', (event) => {
      const { position, updateType } = event;
      logger.info(`Position ${updateType}: ${position.symbol} ${position.direction} ${position.size} @ ${position.entryPrice}`);
      
      if (position.unrealizedPnl) {
        logger.info(`Unrealized P&L: $${position.unrealizedPnl.toFixed(2)} (${position.unrealizedPnlPct?.toFixed(2)}%)`);
      }
    });
    
    // Listen for order execution
    this.paperTrading.on('order_executed', (order) => {
      logger.info(`Order executed: ${order.symbol} ${order.side} ${order.filledAmount} @ ${order.avgFillPrice}`);
      logger.info(`Commission paid: $${order.commission.toFixed(2)}, Slippage: ${order.slippage.toFixed(2)}%`);
    });
  }
  
  /**
   * Process new market data
   * @param features The current market features
   */
  public async processMarketData(features: MarketFeatures): Promise<Signal | null> {
    // Step 1: Update price in the paper trading adapter
    this.paperTrading.updatePrice(this.symbol, features.price);
    
    // Step 2: Classify current market regime
    const classification = this.regimeClassifier.classifyRegime(this.symbol, features);
    logger.info(`Current market regime: ${classification.primaryRegime} (confidence: ${classification.confidence.toFixed(2)})`);
    
    // Step 3: Generate trading signal with the classified regime
    const signal = await this.strategy.generateSignal(features);
    
    if (signal) {
      logger.info(`Generated ${signal.direction.toUpperCase()} signal with strength ${signal.strength?.toFixed(2) || 'N/A'}`);
      
      // Step 4: Execute the signal through paper trading
      const executionReport = await this.paperTrading.executeSignal(signal);
      
      if (executionReport.order) {
        logger.info(`Signal executed: ${executionReport.order.status}`);
        
        if (executionReport.pnl !== 0) {
          logger.info(`Realized P&L: $${executionReport.pnl.toFixed(2)}`);
        }
      } else {
        logger.warn(`Signal execution failed: ${executionReport.messages.join(', ')}`);
      }
    } else {
      logger.info('No signal generated');
    }
    
    return signal;
  }
  
  /**
   * Display current portfolio status
   */
  private displayPortfolioStatus(): void {
    // Dashboard handles this now
    console.log(this.dashboard.generateReport());
  }
  
  /**
   * Run a simple demo with sample data
   */
  public async runDemo(): Promise<void> {
    logger.info('Running Paper Trading Demo');
    
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
      price: 45000, // Price drop
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
      price: 48000, // Price recovery
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
    logger.info('\n--- Bullish Market Scenario ---');
    await this.processMarketData(bullishFeatures);
    
    // Wait for 1 second
    await this.sleep(1000);
    
    // Process bearish market data
    logger.info('\n--- Bearish Market Scenario ---');
    await this.processMarketData(bearishFeatures);
    
    // Wait for 1 second
    await this.sleep(1000);
    
    // Process rangebound market data
    logger.info('\n--- Rangebound Market Scenario ---');
    await this.processMarketData(rangeBoundFeatures);
    
    // Display final status
    this.displayPortfolioStatus();
    
    logger.info('\nDemo completed');
  }
  
  /**
   * Start continuous market simulation
   * @param intervalMs Time between updates in milliseconds
   */
  public startContinuousSimulation(intervalMs: number = 5000): void {
    if (this.isRunning) {
      logger.warn('Simulation is already running');
      return;
    }
    
    this.isRunning = true;
    logger.info(`Starting continuous simulation with ${intervalMs}ms interval`);
    
    // Initial price
    let currentPrice = 50000;
    
    // Update function
    const update = async () => {
      try {
        if (!this.isRunning) return;
        
        // Generate random price movement (-2% to +2%)
        const priceChange = (Math.random() - 0.5) * 0.04;
        currentPrice = currentPrice * (1 + priceChange);
        
        // Create market features with the new price
        const features: MarketFeatures = {
          price: currentPrice,
          returns1d: priceChange,
          returns5d: priceChange * 2, // Simplified
          returns20d: priceChange * 3, // Simplified
          volatility1d: Math.abs(priceChange) * 10,
          volatility5d: Math.abs(priceChange) * 8,
          volatility20d: Math.abs(priceChange) * 6,
          volumeRatio1d: 1 + Math.random(),
          volumeRatio5d: 1 + Math.random(),
          rsi14: 50 + priceChange * 300, // Simplified RSI calculation
          atr14: currentPrice * 0.02,
          bbWidth: 0.03 + Math.random() * 0.02,
          macdHistogram: priceChange * 0.1,
          advanceDeclineRatio: 1 + priceChange * 5,
          marketCap: currentPrice * 20000000 // Simplified
        };
        
        // Process the market data
        await this.processMarketData(features);
      } catch (error) {
        logger.error('Error in simulation update:', error);
      }
    };
    
    // Start the interval
    this.updateInterval = setInterval(update, intervalMs);
    
    // Run the first update immediately
    update();
  }
  
  /**
   * Stop continuous simulation
   */
  public stopContinuousSimulation(): void {
    if (!this.isRunning) {
      logger.warn('Simulation is not running');
      return;
    }
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.isRunning = false;
    logger.info('Continuous simulation stopped');
    
    // Show final performance report
    this.displayPortfolioStatus();
  }
  
  /**
   * Reset the paper trading simulation
   */
  public reset(): void {
    // Stop simulation if running
    if (this.isRunning) {
      this.stopContinuousSimulation();
    }
    
    // Reset paper trading and dashboard
    this.paperTrading.reset();
    this.dashboard.reset();
    
    logger.info('Paper trading simulation reset');
  }
  
  /**
   * Sleep for a given amount of time
   * @param ms Milliseconds to sleep
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Clean up resources before exit
   */
  public cleanup(): void {
    // Stop simulation
    if (this.isRunning) {
      this.stopContinuousSimulation();
    }
    
    // Stop dashboard
    this.dashboard.stop();
    
    logger.info('Resources cleaned up');
  }
}

// If this file is run directly, run the demo
if (require.main === module) {
  const example = new PaperTradingExample();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    example.cleanup();
    process.exit(0);
  });
  
  example.runDemo()
    .then(() => {
      // After running the basic demo, start continuous simulation
      example.startContinuousSimulation(3000); // Update every 3 seconds
      
      console.log('\nPress Ctrl+C to exit the simulation');
      
      // Run for 1 minute then stop if not terminated manually
      setTimeout(() => {
        example.cleanup();
        process.exit(0);
      }, 60000);
    })
    .catch(error => {
      console.error('Error running demo:', error);
      example.cleanup();
      process.exit(1);
    });
}

export { PaperTradingExample }; 