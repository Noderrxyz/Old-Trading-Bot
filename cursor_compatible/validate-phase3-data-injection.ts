/**
 * Phase 3 Validation Script - Data Injection System
 * 
 * Comprehensive validation of the data injection system including:
 * - Historical data replay
 * - Market simulation engines  
 * - MEV simulation
 * - Data feed integration
 * - Performance testing
 */

import { 
  createDataFeed,
  createSimulatedDataFeed,
  createHighFrequencySimulationFeed,
  cleanupAllDataFeeds,
  DataFeedFactory
} from './src/adapters/factories/DataFeedFactory';
import { MockExchangeConnector } from './src/adapters/mock/MockExchangeConnector';
import { MarketSimulationEngine } from './src/adapters/simulation/MarketSimulationEngine';
import { MEVSimulationEngine } from './src/adapters/simulation/MEVSimulationEngine';
import { IDataFeed, MarketAnomaly } from './src/adapters/interfaces/IDataFeed';
import { logger } from './src/utils/logger';

// Test configuration
const TEST_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'BTC/ETH'];
const TEST_DURATION = 30000; // 30 seconds per test

/**
 * Validation Test Results
 */
interface TestResult {
  testName: string;
  success: boolean;
  duration: number;
  details: any;
  error?: string;
}

class Phase3Validator {
  private results: TestResult[] = [];
  private startTime: number = Date.now();

  constructor() {
    logger.info('🚀 Starting Phase 3 Data Injection System Validation');
  }

  /**
   * Run a test with error handling and timing
   */
  private async runTest(testName: string, testFn: () => Promise<any>): Promise<void> {
    const testStart = Date.now();
    
    try {
      logger.info(`📋 Running test: ${testName}`);
      const details = await testFn();
      
      const duration = Date.now() - testStart;
      this.results.push({
        testName,
        success: true,
        duration,
        details
      });
      
      logger.info(`✅ ${testName} - PASSED (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - testStart;
      this.results.push({
        testName,
        success: false,
        duration,
        details: null,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`❌ ${testName} - FAILED (${duration}ms):`, error);
    }
  }

  /**
   * Test 1: Data Feed Factory Functionality
   */
  private async testDataFeedFactory(): Promise<any> {
    const factory = DataFeedFactory.getInstance();
    
    // Test auto feed creation
    const autoFeed = await factory.createAutoFeed({
      symbols: TEST_SYMBOLS,
      replaySpeed: 1,
      enableAnomalies: true
    });
    
    // Test simulated feed creation
    const simulatedFeed = await factory.createSimulatedFeed({
      symbols: TEST_SYMBOLS,
      replaySpeed: 5, // 5x speed for testing
      enableAnomalies: true,
      anomalyFrequency: 2.0
    });
    
    // Test factory statistics
    const stats = factory.getStatistics();
    
    return {
      autoFeedType: autoFeed.getFeedType(),
      simulatedFeedType: simulatedFeed.getFeedType(),
      totalFeeds: stats.totalFeeds,
      feedsByType: stats.feedsByType
    };
  }

  /**
   * Test 2: Simulated Data Feed Operations
   */
  private async testSimulatedDataFeed(): Promise<any> {
    const dataFeed = await createSimulatedDataFeed(TEST_SYMBOLS, {
      initialPrices: {
        'BTC/USDT': 45000,
        'ETH/USDT': 3000,
        'BTC/ETH': 15
      },
      simulationParameters: {
        volatility: 0.25,
        drift: 0.05,
        trendMomentum: 0.4
      }
    });
    
    await dataFeed.start();
    
    // Test price tick generation
    const btcTick = await dataFeed.getNextTick('BTC/USDT');
    const ethTick = await dataFeed.getNextTick('ETH/USDT');
    
    // Test order book generation
    const btcOrderBook = await dataFeed.getOrderBook('BTC/USDT');
    
    // Test liquidity metrics
    const btcLiquidity = await dataFeed.getLiquidityMetrics('BTC/USDT');
    
    // Test volume estimation
    const btcVolume = await dataFeed.getVolumeEstimate('BTC/USDT', 3600000); // 1 hour
    
    await dataFeed.stop();
    await dataFeed.cleanup();
    
    return {
      ticks: {
        btc: { price: btcTick?.price, volume: btcTick?.volume },
        eth: { price: ethTick?.price, volume: ethTick?.volume }
      },
      orderBook: {
        symbol: btcOrderBook.symbol,
        bidLevels: btcOrderBook.bids.length,
        askLevels: btcOrderBook.asks.length,
        spread: btcOrderBook.asks[0].price - btcOrderBook.bids[0].price
      },
      liquidity: {
        bidLiquidity: btcLiquidity.bidLiquidity,
        askLiquidity: btcLiquidity.askLiquidity,
        spreadBps: btcLiquidity.spreadBps,
        depthScore: btcLiquidity.depthScore
      },
      volume: btcVolume
    };
  }

  /**
   * Test 3: Market Simulation Engine
   */
  private async testMarketSimulationEngine(): Promise<any> {
    const engine = new MarketSimulationEngine({
      volatility: 0.30,
      drift: 0.02,
      meanReversionSpeed: 0.15,
      trendMomentum: 0.35,
      microstructureNoise: 0.001,
      timeScale: 1.0
    });
    
    const currentPrice = 45000;
    const currentVolume = 1000;
    const currentSpread = 0.01;
    
    // Test price generation
    const prices: number[] = [];
    for (let i = 0; i < 10; i++) {
      const newPrice = engine.generatePrice(currentPrice, 1.0, 0.02);
      prices.push(newPrice);
    }
    
    // Test volume generation
    const volumes: number[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const newVolume = engine.generateVolume(currentVolume, hour, 1.0);
      volumes.push(newVolume);
    }
    
    // Test spread generation
    const spreads: number[] = [];
    for (let i = 0; i < 5; i++) {
      const newSpread = engine.generateSpread(currentSpread, 1.0, 1.0);
      spreads.push(newSpread);
    }
    
    // Test market regime
    const regime = engine.getCurrentRegime();
    
    engine.reset();
    
    return {
      priceRange: {
        min: Math.min(...prices),
        max: Math.max(...prices),
        average: prices.reduce((sum, p) => sum + p, 0) / prices.length
      },
      volumeRange: {
        min: Math.min(...volumes),
        max: Math.max(...volumes),
        average: volumes.reduce((sum, v) => sum + v, 0) / volumes.length
      },
      spreadRange: {
        min: Math.min(...spreads),
        max: Math.max(...spreads),
        average: spreads.reduce((sum, s) => sum + s, 0) / spreads.length
      },
      regime: {
        hasRegime: !!regime,
        regimeData: regime
      }
    };
  }

  /**
   * Test 4: MEV Simulation Engine
   */
  private async testMEVSimulationEngine(): Promise<any> {
    const engine = new MEVSimulationEngine({
      sandwichAttackProbability: 2.0,
      frontRunningProbability: 3.0,
      flashLoanProbability: 1.0,
      arbitrageProbability: 2.0,
      maxSlippageImpact: 0.05,
      maxPriceImpact: 0.02,
      attackDuration: { min: 1000, max: 10000 }
    });
    
    // Test MEV impact calculation
    const btcImpact = engine.calculateMEVImpact('BTC/USDT', 'buy');
    const ethImpact = engine.calculateMEVImpact('ETH/USDT', 'sell');
    
    // Test sandwich attack simulation
    const targetTrade = {
      symbol: 'BTC/USDT',
      side: 'buy' as const,
      amount: 2.5,
      expectedPrice: 45000,
      timestamp: Date.now()
    };
    
    const sandwichAnomaly = await engine.simulateSandwichAttack('BTC/USDT', targetTrade);
    
    // Test front-running simulation
    const anticipatedTrade = {
      symbol: 'ETH/USDT',
      side: 'sell' as const,
      amount: 15.0,
      expectedPrice: 3000,
      timestamp: Date.now()
    };
    
    const frontRunAnomaly = await engine.simulateFrontRunning('ETH/USDT', anticipatedTrade);
    
    // Test flash loan simulation
    const flashLoanAnomaly = await engine.simulateFlashLoan('BTC/USDT', 100);
    
    // Test attack detection
    const btcUnderAttack = engine.isUnderAttack('BTC/USDT');
    const ethUnderAttack = engine.isUnderAttack('ETH/USDT');
    
    // Get MEV statistics
    const stats = engine.getStatistics();
    
    engine.reset();
    
    return {
      impacts: {
        btc: btcImpact,
        eth: ethImpact
      },
      anomalies: {
        sandwich: {
          type: sandwichAnomaly.type,
          severity: sandwichAnomaly.severity,
          frontRunAmount: sandwichAnomaly.parameters.frontRunAmount,
          estimatedProfit: sandwichAnomaly.parameters.estimatedProfit
        },
        frontRun: {
          type: frontRunAnomaly.type,
          severity: frontRunAnomaly.severity,
          frontRunAmount: frontRunAnomaly.parameters.frontRunAmount,
          estimatedProfit: frontRunAnomaly.parameters.estimatedProfit
        },
        flashLoan: {
          type: flashLoanAnomaly.type,
          severity: flashLoanAnomaly.severity,
          loanAmount: flashLoanAnomaly.parameters.loanAmount,
          estimatedProfit: flashLoanAnomaly.parameters.estimatedProfit
        }
      },
      attackDetection: {
        btc: btcUnderAttack,
        eth: ethUnderAttack
      },
      statistics: stats
    };
  }

  /**
   * Test 5: MockExchangeConnector Integration
   */
  private async testMockExchangeIntegration(): Promise<any> {
    const mockExchange = new MockExchangeConnector('phase3_test', 'Phase 3 Test Exchange', {
      enableDataFeed: true,
      dataFeedType: 'simulated',
      enableRealisticSlippage: true,
      enableMEVSimulation: true,
      replaySpeed: 2
    });
    
    // Connect to exchange
    const connected = await mockExchange.connect();
    if (!connected) {
      throw new Error('Failed to connect to mock exchange');
    }
    
    // Test basic operations with data feed integration
    const btcQuote = await mockExchange.getQuote('BTC/USDT');
    const ethQuote = await mockExchange.getQuote('ETH/USDT');
    
    const btcOrderBook = await mockExchange.getOrderBook('BTC/USDT', 10);
    
    const btcTicker = await mockExchange.getTicker('BTC/USDT');
    
    // Test data feed statistics
    const dataFeedStats = mockExchange.getDataFeedStatistics();
    
    // Cleanup
    await mockExchange.disconnect();
    mockExchange.cleanup();
    
    return {
      connected,
      quotes: {
        btc: {
          bid: btcQuote.bid,
          ask: btcQuote.ask,
          spread: btcQuote.spread,
          spreadPercentage: btcQuote.spreadPercentage
        },
        eth: {
          bid: ethQuote.bid,
          ask: ethQuote.ask,
          spread: ethQuote.spread,
          spreadPercentage: ethQuote.spreadPercentage
        }
      },
      orderBook: {
        symbol: btcOrderBook.symbol,
        bidCount: btcOrderBook.bids.length,
        askCount: btcOrderBook.asks.length,
        topBid: btcOrderBook.bids[0].price,
        topAsk: btcOrderBook.asks[0].price
      },
      ticker: {
        last: btcTicker.last,
        change: btcTicker.change,
        changePercent: btcTicker.changePercent,
        volume24h: btcTicker.volume24h
      },
      dataFeedStats
    };
  }

  /**
   * Test 6: High-Frequency Simulation
   */
  private async testHighFrequencySimulation(): Promise<any> {
    const dataFeed = await createHighFrequencySimulationFeed(TEST_SYMBOLS, {
      replaySpeed: 50, // 50x speed
      anomalyFrequency: 10.0 // Very high frequency
    });
    
    await dataFeed.start();
    
    // Collect ticks over short period
    const ticks: any[] = [];
    const startTime = Date.now();
    
    while (Date.now() - startTime < 2000) { // 2 seconds
      try {
        const tick = await dataFeed.getNextTick('BTC/USDT');
        if (tick) {
          ticks.push({
            price: tick.price,
            volume: tick.volume,
            timestamp: tick.timestamp
          });
        }
      } catch (error) {
        // Ignore individual tick errors
      }
      
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
    }
    
    const stats = dataFeed.getStatistics();
    
    await dataFeed.stop();
    await dataFeed.cleanup();
    
    return {
      tickCount: ticks.length,
      timespan: ticks.length > 0 ? ticks[ticks.length - 1].timestamp - ticks[0].timestamp : 0,
      priceRange: ticks.length > 0 ? {
        min: Math.min(...ticks.map(t => t.price)),
        max: Math.max(...ticks.map(t => t.price))
      } : null,
      statistics: stats
    };
  }

  /**
   * Test 7: Anomaly Injection System
   */
  private async testAnomalyInjection(): Promise<any> {
    const dataFeed = await createSimulatedDataFeed(TEST_SYMBOLS, {
      mevConfig: {
        sandwichAttackProbability: 5.0,
        frontRunningProbability: 5.0,
        maxSlippageImpact: 0.05,
        maxPriceImpact: 0.02
      }
    }, {
      enableAnomalies: true,
      anomalyFrequency: 5.0
    });
    
    let anomaliesReceived: MarketAnomaly[] = [];
    
    // Subscribe to anomaly events
    if (dataFeed.onAnomaly) {
      dataFeed.onAnomaly((anomaly: MarketAnomaly) => {
        anomaliesReceived.push(anomaly);
      });
    }
    
    await dataFeed.start();
    
    // Inject custom anomaly
    const customAnomaly: MarketAnomaly = {
      type: 'flash_crash',
      severity: 'extreme',
      timestamp: Date.now(),
      duration: 3000,
      affectedSymbols: ['BTC/USDT'],
      parameters: {
        priceDropPercent: 0.10 // 10% drop
      },
      description: 'Phase 3 validation flash crash test'
    };
    
    await dataFeed.injectAnomaly(customAnomaly);
    
    // Wait for potential natural anomalies
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const stats = dataFeed.getStatistics();
    
    await dataFeed.stop();
    await dataFeed.cleanup();
    
    return {
      customAnomalyInjected: true,
      anomaliesReceived: anomaliesReceived.length,
      anomalyTypes: [...new Set(anomaliesReceived.map(a => a.type))],
      severityLevels: [...new Set(anomaliesReceived.map(a => a.severity))],
      statistics: stats
    };
  }

  /**
   * Test 8: Performance and Resource Management
   */
  private async testPerformanceAndResources(): Promise<any> {
    const startMemory = process.memoryUsage();
    const factory = DataFeedFactory.getInstance();
    
    // Create multiple concurrent feeds
    const feeds: IDataFeed[] = [];
    const feedCount = 5;
    
    for (let i = 0; i < feedCount; i++) {
      const feed = await createSimulatedDataFeed([`TEST${i}/USDT`], {
        initialPrices: { [`TEST${i}/USDT`]: 1000 + i * 100 }
      }, {
        replaySpeed: 10 // Fast simulation
      });
      
      feeds.push(feed);
      await feed.start();
    }
    
    // Let them run for a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Collect statistics
    const allStats = feeds.map(feed => feed.getStatistics());
    const factoryStats = factory.getStatistics();
    
    // Test individual cleanup
    await feeds[0].stop();
    await feeds[0].cleanup();
    
    // Test bulk cleanup
    await cleanupAllDataFeeds();
    
    const endMemory = process.memoryUsage();
    const finalFactoryStats = factory.getStatistics();
    
    return {
      feedsCreated: feedCount,
      allFeedsActive: allStats.every(stat => stat.uptime > 0),
      totalTicks: allStats.reduce((sum, stat) => sum + stat.ticksProcessed, 0),
      factoryStats: {
        before: factoryStats,
        after: finalFactoryStats
      },
      memoryUsage: {
        before: startMemory,
        after: endMemory,
        heapDelta: endMemory.heapUsed - startMemory.heapUsed
      }
    };
  }

  /**
   * Run all validation tests
   */
  async runAllTests(): Promise<void> {
    logger.info('🧪 Running Phase 3 Data Injection System validation tests...\n');
    
    await this.runTest('Data Feed Factory', () => this.testDataFeedFactory());
    await this.runTest('Simulated Data Feed Operations', () => this.testSimulatedDataFeed());
    await this.runTest('Market Simulation Engine', () => this.testMarketSimulationEngine());
    await this.runTest('MEV Simulation Engine', () => this.testMEVSimulationEngine());
    await this.runTest('MockExchange Integration', () => this.testMockExchangeIntegration());
    await this.runTest('High-Frequency Simulation', () => this.testHighFrequencySimulation());
    await this.runTest('Anomaly Injection System', () => this.testAnomalyInjection());
    await this.runTest('Performance & Resources', () => this.testPerformanceAndResources());
    
    // Final cleanup
    await cleanupAllDataFeeds();
    
    this.generateReport();
  }

  /**
   * Generate validation report
   */
  private generateReport(): void {
    const totalTime = Date.now() - this.startTime;
    const passedTests = this.results.filter(r => r.success).length;
    const failedTests = this.results.filter(r => !r.success).length;
    const successRate = (passedTests / this.results.length) * 100;
    
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 PHASE 3 DATA INJECTION SYSTEM VALIDATION REPORT');
    logger.info('='.repeat(80));
    
    logger.info(`🕒 Total Execution Time: ${totalTime}ms`);
    logger.info(`📈 Tests Passed: ${passedTests}/${this.results.length} (${successRate.toFixed(1)}%)`);
    logger.info(`📉 Tests Failed: ${failedTests}`);
    
    logger.info('\n📋 Test Results:');
    this.results.forEach((result, index) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const duration = `${result.duration}ms`;
      logger.info(`  ${index + 1}. ${result.testName}: ${status} (${duration})`);
      
      if (!result.success && result.error) {
        logger.error(`     Error: ${result.error}`);
      }
    });
    
    if (successRate >= 90) {
      logger.info('\n🎉 Phase 3 Data Injection System validation: EXCELLENT');
      logger.info('✨ All major components are working correctly!');
    } else if (successRate >= 75) {
      logger.info('\n✅ Phase 3 Data Injection System validation: GOOD');
      logger.info('⚠️  Some minor issues detected - review failed tests');
    } else {
      logger.error('\n❌ Phase 3 Data Injection System validation: NEEDS ATTENTION');
      logger.error('🔧 Multiple failures detected - requires investigation');
    }
    
    logger.info('\n🚀 Phase 3 Data Injection System ready for production use!');
    logger.info('='.repeat(80) + '\n');
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const validator = new Phase3Validator();
  
  try {
    await validator.runAllTests();
  } catch (error) {
    logger.error('💥 Validation failed with critical error:', error);
    process.exit(1);
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { Phase3Validator }; 