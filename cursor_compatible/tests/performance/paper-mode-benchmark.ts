/**
 * Paper Mode Performance Benchmarking Suite
 * 
 * Comprehensive performance testing for the paper trading system
 * measuring throughput, latency, memory usage, and stability.
 */

import { performance } from 'perf_hooks';
import { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } from '@jest/globals';
import { 
  IDataFeed, 
  DataFeedConfig,
  PriceTick,
  OrderBookSnapshot
} from '../../src/adapters/interfaces/IDataFeed';
import { 
  IExchangeConnector,
  OrderRequest,
  OrderResponse
} from '../../src/adapters/interfaces/IExchangeConnector';
import { MockExchangeConnector } from '../../src/adapters/mock/MockExchangeConnector';
import { 
  createSimulatedDataFeed, 
  createHighFrequencySimulationFeed,
  cleanupAllDataFeeds 
} from '../../src/adapters/factories/DataFeedFactory';
import { isPaperMode, getSimulationConfig } from '../../src/config/PaperModeConfig';

interface BenchmarkResult {
  testName: string;
  operationsPerSecond: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  memoryUsage: number;
  duration: number;
  totalOperations: number;
}

interface PerformanceMetrics {
  startTime: number;
  endTime: number;
  operationTimes: number[];
  errors: any[];
  memoryStart: number;
  memoryEnd: number;
}

describe('Paper Mode Performance Benchmarking Suite', () => {
  let dataFeed: IDataFeed;
  let mockExchange: MockExchangeConnector;
  const results: BenchmarkResult[] = [];

  beforeAll(async () => {
    // Ensure we're in paper mode
    expect(isPaperMode()).toBe(true);
    console.log('🚀 Starting Paper Mode Performance Benchmarks');
    console.log('======================================================');
  });

  afterAll(async () => {
    await cleanupAllDataFeeds();
    
    // Generate performance report
    generatePerformanceReport(results);
    console.log('✅ Performance Benchmarking Complete');
  });

  beforeEach(async () => {
    await cleanupAllDataFeeds();
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  });

  afterEach(async () => {
    if (dataFeed) {
      await dataFeed.stop();
      await dataFeed.cleanup();
    }
    
    if (mockExchange) {
      await mockExchange.disconnect();
      mockExchange.cleanup();
    }
  });

  describe('📊 Data Feed Performance Tests', () => {
    test('should benchmark simulated data feed throughput', async () => {
      console.log('📈 Benchmarking data feed throughput...');
      
      const metrics = startMetrics();
      const testSymbols = ['BTC/USDT', 'ETH/USDT', 'BTC/ETH', 'USDC/USDT', 'MATIC/USDT'];
      
      dataFeed = await createSimulatedDataFeed(testSymbols, {
        simulationParameters: {
          volatility: 0.20,
          timeScale: 10 // 10x acceleration
        }
      }, {
        replaySpeed: 50 // 50x speed for performance testing
      });

      await dataFeed.start();

      // Collect ticks for throughput measurement
      const ticksReceived: PriceTick[] = [];
      if (dataFeed.onTick) {
        dataFeed.onTick((tick: PriceTick) => {
          ticksReceived.push(tick);
        });
      }

      // Run for fixed duration
      const testDuration = 3000; // 3 seconds
      await new Promise(resolve => setTimeout(resolve, testDuration));

      const result = endMetrics(metrics, 'Data Feed Throughput', ticksReceived.length);
      results.push(result);

      expect(result.operationsPerSecond).toBeGreaterThan(100); // Target: >100 ticks/sec
      console.log(`✅ Data Feed: ${result.operationsPerSecond.toFixed(1)} ticks/sec`);
    }, 15000);

    test('should benchmark order book generation performance', async () => {
      console.log('📊 Benchmarking order book generation...');
      
      const metrics = startMetrics();
      
      dataFeed = await createSimulatedDataFeed(['BTC/USDT'], {
        liquidity: {
          baseSpread: 0.001,
          depthMultiplier: 2.0,
          timeOfDayEffects: false
        }
      });

      await dataFeed.start();

      const operations = 1000;
      const operationTimes: number[] = [];

      for (let i = 0; i < operations; i++) {
        const startTime = performance.now();
        
        try {
          await dataFeed.getOrderBook('BTC/USDT');
          const endTime = performance.now();
          operationTimes.push(endTime - startTime);
        } catch (error) {
          metrics.errors.push(error);
        }
      }

      metrics.operationTimes = operationTimes;
      const result = endMetrics(metrics, 'Order Book Generation', operations);
      results.push(result);

      expect(result.operationsPerSecond).toBeGreaterThan(500); // Target: >500 order books/sec
      expect(result.averageLatency).toBeLessThan(10); // Target: <10ms average
      console.log(`✅ Order Books: ${result.operationsPerSecond.toFixed(1)} ops/sec, ${result.averageLatency.toFixed(2)}ms avg`);
    }, 20000);

    test('should benchmark high-frequency data feed performance', async () => {
      console.log('⚡ Benchmarking high-frequency data feed...');
      
      const metrics = startMetrics();
      
      dataFeed = await createHighFrequencySimulationFeed(['BTC/USDT', 'ETH/USDT'], {
        replaySpeed: 100, // 100x speed
        anomalyFrequency: 20.0 // High anomaly frequency
      });

      await dataFeed.start();

      const ticksReceived: PriceTick[] = [];
      const anomaliesReceived: any[] = [];
      
      if (dataFeed.onTick) {
        dataFeed.onTick((tick: PriceTick) => {
          ticksReceived.push(tick);
        });
      }

      if (dataFeed.onAnomaly) {
        dataFeed.onAnomaly((anomaly: any) => {
          anomaliesReceived.push(anomaly);
        });
      }

      // Run high-frequency test
      await new Promise(resolve => setTimeout(resolve, 2000));

      const totalEvents = ticksReceived.length + anomaliesReceived.length;
      const result = endMetrics(metrics, 'High-Frequency Feed', totalEvents);
      results.push(result);

      expect(result.operationsPerSecond).toBeGreaterThan(1000); // Target: >1000 events/sec
      console.log(`✅ High-Frequency: ${result.operationsPerSecond.toFixed(1)} events/sec (${ticksReceived.length} ticks, ${anomaliesReceived.length} anomalies)`);
    }, 15000);
  });

  describe('💱 Exchange Connector Performance Tests', () => {
    test('should benchmark quote request performance', async () => {
      console.log('💱 Benchmarking quote requests...');
      
      const metrics = startMetrics();
      
      mockExchange = new MockExchangeConnector('quote_benchmark', 'Quote Benchmark Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        replaySpeed: 10
      });

      await mockExchange.connect();

      const operations = 2000;
      const symbols = ['BTC/USDT', 'ETH/USDT', 'BTC/ETH'];
      const operationTimes: number[] = [];

      for (let i = 0; i < operations; i++) {
        const symbol = symbols[i % symbols.length];
        const startTime = performance.now();
        
        try {
          await mockExchange.getQuote(symbol);
          const endTime = performance.now();
          operationTimes.push(endTime - startTime);
        } catch (error) {
          metrics.errors.push(error);
        }
      }

      metrics.operationTimes = operationTimes;
      const result = endMetrics(metrics, 'Quote Requests', operations);
      results.push(result);

      expect(result.operationsPerSecond).toBeGreaterThan(1000); // Target: >1000 quotes/sec
      expect(result.averageLatency).toBeLessThan(5); // Target: <5ms average
      console.log(`✅ Quotes: ${result.operationsPerSecond.toFixed(1)} ops/sec, ${result.averageLatency.toFixed(2)}ms avg`);
    }, 25000);

    test('should benchmark order submission performance', async () => {
      console.log('📝 Benchmarking order submissions...');
      
      const metrics = startMetrics();
      
      mockExchange = new MockExchangeConnector('order_benchmark', 'Order Benchmark Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated'
      });

      await mockExchange.connect();

      const operations = 1000;
      const operationTimes: number[] = [];

      for (let i = 0; i < operations; i++) {
        const order: OrderRequest = {
          symbol: 'BTC/USDT',
          side: i % 2 === 0 ? 'buy' : 'sell',
          type: 'market',
          amount: 0.001 + Math.random() * 0.009,
          clientOrderId: `bench-${i}`
        };

        const startTime = performance.now();
        
        try {
          await mockExchange.submitOrder(order);
          const endTime = performance.now();
          operationTimes.push(endTime - startTime);
        } catch (error) {
          metrics.errors.push(error);
        }
      }

      metrics.operationTimes = operationTimes;
      const result = endMetrics(metrics, 'Order Submissions', operations);
      results.push(result);

      expect(result.operationsPerSecond).toBeGreaterThan(500); // Target: >500 orders/sec
      expect(result.averageLatency).toBeLessThan(10); // Target: <10ms average
      console.log(`✅ Orders: ${result.operationsPerSecond.toFixed(1)} ops/sec, ${result.averageLatency.toFixed(2)}ms avg`);
    }, 30000);

    test('should benchmark concurrent operations', async () => {
      console.log('⚡ Benchmarking concurrent operations...');
      
      const metrics = startMetrics();
      
      mockExchange = new MockExchangeConnector('concurrent_benchmark', 'Concurrent Benchmark Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        replaySpeed: 5
      });

      await mockExchange.connect();

      const concurrencyLevels = [10, 25, 50, 100];
      const symbols = ['BTC/USDT', 'ETH/USDT', 'BTC/ETH', 'USDC/USDT'];
      
      for (const concurrency of concurrencyLevels) {
        console.log(`  Testing concurrency level: ${concurrency}`);
        
        const startTime = performance.now();
        const operations: Promise<any>[] = [];
        
        for (let i = 0; i < concurrency; i++) {
          const symbol = symbols[i % symbols.length];
          
          // Mix of operations
          if (i % 3 === 0) {
            operations.push(mockExchange.getQuote(symbol));
          } else if (i % 3 === 1) {
            operations.push(mockExchange.getOrderBook(symbol, 5));
          } else {
            const order: OrderRequest = {
              symbol,
              side: i % 2 === 0 ? 'buy' : 'sell',
              type: 'market',
              amount: 0.01,
              clientOrderId: `concurrent-${concurrency}-${i}`
            };
            operations.push(mockExchange.submitOrder(order));
          }
        }

        try {
          await Promise.all(operations);
          const endTime = performance.now();
          const duration = endTime - startTime;
          const opsPerSec = (concurrency / duration) * 1000;
          
          console.log(`    ${concurrency} ops in ${duration.toFixed(1)}ms = ${opsPerSec.toFixed(1)} ops/sec`);
        } catch (error) {
          metrics.errors.push(error);
          console.log(`    Error at concurrency ${concurrency}: ${error}`);
        }
      }

      const result = endMetrics(metrics, 'Concurrent Operations', concurrencyLevels.reduce((a, b) => a + b));
      results.push(result);

      console.log(`✅ Concurrent operations completed`);
    }, 40000);
  });

  describe('🔄 Stress Testing', () => {
    test('should handle sustained high-load operations', async () => {
      console.log('💪 Running sustained load test...');
      
      const metrics = startMetrics();
      
      // Create high-performance system
      dataFeed = await createHighFrequencySimulationFeed(['BTC/USDT', 'ETH/USDT'], {
        replaySpeed: 50
      });

      mockExchange = new MockExchangeConnector('stress_test', 'Stress Test Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        replaySpeed: 50
      });

      await Promise.all([dataFeed.start(), mockExchange.connect()]);

      const testDuration = 10000; // 10 seconds
      const batchSize = 100;
      let totalOperations = 0;
      const startTime = performance.now();

      while (performance.now() - startTime < testDuration) {
        const batchPromises: Promise<any>[] = [];
        
        for (let i = 0; i < batchSize; i++) {
          if (i % 4 === 0) {
            batchPromises.push(mockExchange.getQuote('BTC/USDT'));
          } else if (i % 4 === 1) {
            batchPromises.push(mockExchange.getOrderBook('ETH/USDT', 5));
          } else if (i % 4 === 2) {
            batchPromises.push(dataFeed.getCurrentPrice('BTC/USDT'));
          } else {
            const order: OrderRequest = {
              symbol: 'BTC/USDT',
              side: i % 2 === 0 ? 'buy' : 'sell',
              type: 'market',
              amount: 0.001,
              clientOrderId: `stress-${totalOperations + i}`
            };
            batchPromises.push(mockExchange.submitOrder(order));
          }
        }

        try {
          await Promise.all(batchPromises);
          totalOperations += batchSize;
        } catch (error) {
          metrics.errors.push(error);
        }

        // Brief pause to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const result = endMetrics(metrics, 'Sustained Load Test', totalOperations);
      results.push(result);

      expect(result.operationsPerSecond).toBeGreaterThan(200); // Target: >200 ops/sec sustained
      expect(result.errorRate).toBeLessThan(0.05); // Target: <5% error rate
      console.log(`✅ Sustained Load: ${result.operationsPerSecond.toFixed(1)} ops/sec over ${testDuration/1000}s (${result.errorRate.toFixed(2)}% errors)`);
    }, 45000);

    test('should handle memory usage efficiently', async () => {
      console.log('🧠 Testing memory efficiency...');
      
      const initialMemory = process.memoryUsage();
      
      // Create memory-intensive scenario
      dataFeed = await createSimulatedDataFeed(['BTC/USDT', 'ETH/USDT', 'BTC/ETH', 'USDC/USDT', 'MATIC/USDT'], {
        simulationParameters: {
          volatility: 0.30
        }
      }, {
        replaySpeed: 100,
        anomalyFrequency: 10.0
      });

      mockExchange = new MockExchangeConnector('memory_test', 'Memory Test Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        replaySpeed: 100
      });

      await Promise.all([dataFeed.start(), mockExchange.connect()]);

      // Generate significant activity
      const operations = 5000;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < operations; i++) {
        if (i % 2 === 0) {
          promises.push(mockExchange.getQuote('BTC/USDT'));
        } else {
          const order: OrderRequest = {
            symbol: 'BTC/USDT',
            side: i % 2 === 0 ? 'buy' : 'sell',
            type: 'market',
            amount: 0.001,
            clientOrderId: `memory-test-${i}`
          };
          promises.push(mockExchange.submitOrder(order));
        }
      }

      await Promise.all(promises);

      // Let system run for a bit to accumulate data
      await new Promise(resolve => setTimeout(resolve, 5000));

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreaseeMB = memoryIncrease / (1024 * 1024);

      console.log(`📊 Memory Usage:`);
      console.log(`   Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(1)} MB`);
      console.log(`   Final: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(1)} MB`);
      console.log(`   Increase: ${memoryIncreaseeMB.toFixed(1)} MB for ${operations} operations`);

      expect(memoryIncreaseeMB).toBeLessThan(100); // Target: <100MB increase for 5000 operations
      console.log(`✅ Memory efficient: ${memoryIncreaseeMB.toFixed(1)} MB increase`);
    }, 30000);
  });

  describe('📈 End-to-End Performance', () => {
    test('should demonstrate production-grade throughput', async () => {
      console.log('🏆 Production throughput test...');
      
      const metrics = startMetrics();
      
      // Production-like configuration
      dataFeed = await createSimulatedDataFeed(
        ['BTC/USDT', 'ETH/USDT', 'BTC/ETH', 'USDC/USDT', 'MATIC/USDT', 'AVAX/USDT', 'SOL/USDT'], 
        {
          simulationParameters: {
            volatility: 0.25,
            timeScale: 5
          },
          mevConfig: {
            sandwichAttackProbability: 1.0,
            frontRunningProbability: 1.5
          }
        }, 
        {
          replaySpeed: 25,
          anomalyFrequency: 3.0
        }
      );

      mockExchange = new MockExchangeConnector('production_throughput', 'Production Throughput Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        replaySpeed: 25,
        enableRealisticSlippage: true,
        enableMEVSimulation: true
      });

      await Promise.all([dataFeed.start(), mockExchange.connect()]);

      // Production-like workload
      const testDuration = 15000; // 15 seconds
      let totalOperations = 0;
      const operationTimes: number[] = [];
      const startTime = performance.now();

      // Simulate realistic trading patterns
      const tradingPatterns = [
        { type: 'market_making', frequency: 0.4 },
        { type: 'trend_following', frequency: 0.3 },
        { type: 'arbitrage', frequency: 0.2 },
        { type: 'news_trading', frequency: 0.1 }
      ];

      while (performance.now() - startTime < testDuration) {
        const pattern = tradingPatterns[Math.floor(Math.random() * tradingPatterns.length)];
        const batchSize = pattern.type === 'market_making' ? 20 : 
                         pattern.type === 'arbitrage' ? 10 : 5;
        
        const batchPromises: Promise<any>[] = [];
        
        for (let i = 0; i < batchSize; i++) {
          const opStartTime = performance.now();
          const symbol = ['BTC/USDT', 'ETH/USDT', 'BTC/ETH'][i % 3];
          
          let operation: Promise<any>;
          
          if (i % 5 === 0) {
            // Quote requests (most frequent)
            operation = mockExchange.getQuote(symbol);
          } else if (i % 5 === 1) {
            // Order book requests
            operation = mockExchange.getOrderBook(symbol, 10);
          } else if (i % 5 === 2) {
            // Balance checks
            operation = mockExchange.getBalances();
          } else {
            // Order submissions
            const order: OrderRequest = {
              symbol,
              side: i % 2 === 0 ? 'buy' : 'sell',
              type: Math.random() > 0.8 ? 'limit' : 'market',
              amount: 0.001 + Math.random() * 0.01,
              price: Math.random() > 0.8 ? undefined : 45000 + Math.random() * 1000,
              clientOrderId: `prod-${totalOperations + i}`
            };
            operation = mockExchange.submitOrder(order);
          }

          batchPromises.push(
            operation.then(() => {
              const opEndTime = performance.now();
              operationTimes.push(opEndTime - opStartTime);
            }).catch(error => {
              metrics.errors.push(error);
            })
          );
        }

        await Promise.all(batchPromises);
        totalOperations += batchSize;

        // Realistic trading pause
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      }

      metrics.operationTimes = operationTimes;
      const result = endMetrics(metrics, 'Production Throughput', totalOperations);
      results.push(result);

      // Production requirements
      expect(result.operationsPerSecond).toBeGreaterThan(100); // Target: >100 TPS
      expect(result.averageLatency).toBeLessThan(20); // Target: <20ms average
      expect(result.p95Latency).toBeLessThan(50); // Target: <50ms P95
      expect(result.errorRate).toBeLessThan(0.01); // Target: <1% error rate

      console.log(`🏆 Production Results:`);
      console.log(`   Throughput: ${result.operationsPerSecond.toFixed(1)} TPS`);
      console.log(`   Avg Latency: ${result.averageLatency.toFixed(2)}ms`);
      console.log(`   P95 Latency: ${result.p95Latency.toFixed(2)}ms`);
      console.log(`   Error Rate: ${(result.errorRate * 100).toFixed(2)}%`);
      console.log(`   Target Met: ${result.operationsPerSecond >= 100 && result.errorRate < 0.01 ? '✅' : '⚠️'}`);
    }, 60000);
  });

  // Helper functions
  function startMetrics(): PerformanceMetrics {
    return {
      startTime: performance.now(),
      endTime: 0,
      operationTimes: [],
      errors: [],
      memoryStart: process.memoryUsage().heapUsed,
      memoryEnd: 0
    };
  }

  function endMetrics(metrics: PerformanceMetrics, testName: string, totalOps: number): BenchmarkResult {
    metrics.endTime = performance.now();
    metrics.memoryEnd = process.memoryUsage().heapUsed;
    
    const duration = metrics.endTime - metrics.startTime;
    const operationsPerSecond = (totalOps / duration) * 1000;
    const errorRate = metrics.errors.length / totalOps;
    const memoryUsage = (metrics.memoryEnd - metrics.memoryStart) / (1024 * 1024);
    
    let averageLatency = 0;
    let p95Latency = 0;
    let p99Latency = 0;
    
    if (metrics.operationTimes.length > 0) {
      averageLatency = metrics.operationTimes.reduce((sum, time) => sum + time, 0) / metrics.operationTimes.length;
      
      const sortedTimes = metrics.operationTimes.sort((a, b) => a - b);
      p95Latency = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
      p99Latency = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
    }
    
    return {
      testName,
      operationsPerSecond,
      averageLatency,
      p95Latency,
      p99Latency,
      errorRate,
      memoryUsage,
      duration,
      totalOperations: totalOps
    };
  }

  function generatePerformanceReport(results: BenchmarkResult[]): void {
    console.log('\n🏆 PAPER MODE PERFORMANCE BENCHMARK REPORT');
    console.log('='.repeat(80));
    
    console.log('\n📊 SUMMARY TABLE');
    console.log('-'.repeat(80));
    console.log('Test Name'.padEnd(25) + 
                'TPS'.padEnd(12) + 
                'Avg Lat'.padEnd(12) + 
                'P95 Lat'.padEnd(12) + 
                'Error %'.padEnd(10) + 
                'Memory MB'.padEnd(10));
    console.log('-'.repeat(80));
    
    results.forEach(result => {
      console.log(
        result.testName.padEnd(25) + 
        result.operationsPerSecond.toFixed(1).padEnd(12) + 
        result.averageLatency.toFixed(2).padEnd(12) + 
        result.p95Latency.toFixed(2).padEnd(12) + 
        (result.errorRate * 100).toFixed(2).padEnd(10) + 
        result.memoryUsage.toFixed(1).padEnd(10)
      );
    });
    
    console.log('\n🎯 PERFORMANCE TARGETS');
    console.log('-'.repeat(40));
    
    const productionResult = results.find(r => r.testName === 'Production Throughput');
    if (productionResult) {
      console.log(`✅ Throughput Target: ${productionResult.operationsPerSecond >= 100 ? 'PASSED' : 'FAILED'} (${productionResult.operationsPerSecond.toFixed(1)} TPS ≥ 100 TPS)`);
      console.log(`✅ Latency Target: ${productionResult.averageLatency <= 20 ? 'PASSED' : 'FAILED'} (${productionResult.averageLatency.toFixed(2)}ms ≤ 20ms)`);
      console.log(`✅ Reliability Target: ${productionResult.errorRate <= 0.01 ? 'PASSED' : 'FAILED'} (${(productionResult.errorRate * 100).toFixed(2)}% ≤ 1%)`);
    }
    
    const avgThroughput = results.reduce((sum, r) => sum + r.operationsPerSecond, 0) / results.length;
    const avgLatency = results.reduce((sum, r) => sum + r.averageLatency, 0) / results.length;
    const avgErrorRate = results.reduce((sum, r) => sum + r.errorRate, 0) / results.length;
    
    console.log(`\n📈 OVERALL AVERAGES`);
    console.log(`   Average Throughput: ${avgThroughput.toFixed(1)} TPS`);
    console.log(`   Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`   Average Error Rate: ${(avgErrorRate * 100).toFixed(2)}%`);
    
    console.log('\n🚀 CONCLUSION');
    console.log('-'.repeat(40));
    
    const allTargetsMet = results.every(r => 
      r.operationsPerSecond >= 50 && // Minimum acceptable
      r.errorRate <= 0.05 // Maximum 5% error rate
    );
    
    if (allTargetsMet) {
      console.log('✅ ALL PERFORMANCE TARGETS MET - PRODUCTION READY');
    } else {
      console.log('⚠️  SOME PERFORMANCE TARGETS NOT MET - REVIEW REQUIRED');
    }
    
    console.log('='.repeat(80));
  }
}); 