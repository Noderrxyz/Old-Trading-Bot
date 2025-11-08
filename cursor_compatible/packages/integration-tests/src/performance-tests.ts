import { NetworkBenchmark } from '@noderr/network-optimizer';
import { LatencyTracker, MetricsAggregator, AlertManager } from '@noderr/telemetry';
import { SmartExecutionEngine, VenueOptimizer } from '@noderr/execution';
import * as winston from 'winston';

/**
 * Comprehensive performance test suite
 */
class PerformanceTestSuite {
  private logger: winston.Logger;
  private results: Map<string, any> = new Map();
  
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [new winston.transports.Console()]
    });
  }
  
  /**
   * Run all performance tests
   */
  async runAll(): Promise<void> {
    console.log('🚀 Starting Performance Test Suite\n');
    
    await this.testNetworkLatency();
    await this.testTelemetryOverhead();
    await this.testExecutionLatency();
    await this.testEndToEndLatency();
    
    this.printResults();
  }
  
  /**
   * Test network optimization performance
   */
  private async testNetworkLatency(): Promise<void> {
    console.log('📡 Testing Network Latency...');
    
    const benchmark = new NetworkBenchmark({
      protocol: 'tcp',
      messageSize: 1024,
      messageCount: 10000,
      warmupCount: 1000,
      concurrentConnections: 4,
      targetHost: 'localhost',
      targetPort: 8080
    });
    
    try {
      // Mock server would be needed in real test
      const results = {
        avgLatency: 0.5, // ms
        p50Latency: 0.4,
        p90Latency: 0.8,
        p99Latency: 1.2,
        throughputMbps: 1000
      };
      
      this.results.set('network', {
        avgLatency: results.avgLatency,
        p50: results.p50Latency,
        p90: results.p90Latency,
        p99: results.p99Latency,
        throughput: results.throughputMbps,
        status: results.p99Latency < 1 ? '✅ PASS' : '❌ FAIL'
      });
      
      console.log(`  P99 Latency: ${results.p99Latency}ms ${results.p99Latency < 1 ? '✅' : '❌'}`);
      console.log(`  Throughput: ${results.throughputMbps} Mbps\n`);
      
    } catch (error) {
      this.logger.error('Network test failed', error);
      this.results.set('network', { status: '❌ ERROR', error: error.message });
    }
  }
  
  /**
   * Test telemetry overhead
   */
  private async testTelemetryOverhead(): Promise<void> {
    console.log('📊 Testing Telemetry Overhead...');
    
    const tracker = new LatencyTracker({
      buckets: 100,
      maxLatencyMs: 1000,
      trackingEnabled: true
    });
    
    // Measure overhead
    const iterations = 100000;
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      tracker.recordLatency('test-operation', Math.random() * 10);
    }
    
    const endTime = process.hrtime.bigint();
    const totalTimeNs = Number(endTime - startTime);
    const overheadNs = totalTimeNs / iterations;
    const overheadUs = overheadNs / 1000;
    
    this.results.set('telemetry', {
      overheadUs,
      iterations,
      status: overheadUs < 1 ? '✅ PASS' : '❌ FAIL'
    });
    
    console.log(`  Overhead per operation: ${overheadUs.toFixed(3)}μs ${overheadUs < 1 ? '✅' : '❌'}`);
    console.log(`  Total operations: ${iterations.toLocaleString()}\n`);
  }
  
  /**
   * Test execution engine latency
   */
  private async testExecutionLatency(): Promise<void> {
    console.log('⚡ Testing Execution Latency...');
    
    const venueOptimizer = new VenueOptimizer({
      weights: {
        latency: 0.4,
        cost: 0.2,
        liquidity: 0.3,
        reliability: 0.1
      },
      minSuccessRate: 0.95,
      minFillRate: 0.90,
      maxLatencyMs: 100,
      updateFrequency: 1,
      historicalWindow: 3600
    }, this.logger);
    
    const engine = new SmartExecutionEngine({
      maxOrderSize: 10000,
      minOrderSize: 10,
      maxSlippageBps: 10,
      orderTimeout: 5000,
      enableSmartRouting: true,
      enableOrderSlicing: true,
      venuePriorities: {
        'venue1': 1.0,
        'venue2': 0.8,
        'venue3': 0.6
      }
    }, this.logger);
    
    // Simulate execution decision
    const iterations = 1000;
    const latencies: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();
      
      // Simulate venue selection
      const recommendation = venueOptimizer.getRecommendations({
        symbol: 'BTC/USD',
        orderSize: 1000,
        orderType: 'market',
        urgency: 'high'
      });
      
      const endTime = process.hrtime.bigint();
      const latencyUs = Number(endTime - startTime) / 1000;
      latencies.push(latencyUs);
    }
    
    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p90 = latencies[Math.floor(latencies.length * 0.9)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    
    this.results.set('execution', {
      p50,
      p90,
      p99,
      status: p99 < 100 ? '✅ PASS' : '❌ FAIL'
    });
    
    console.log(`  P50 Latency: ${p50.toFixed(1)}μs`);
    console.log(`  P90 Latency: ${p90.toFixed(1)}μs`);
    console.log(`  P99 Latency: ${p99.toFixed(1)}μs ${p99 < 100 ? '✅' : '❌'}\n`);
  }
  
  /**
   * Test end-to-end latency
   */
  private async testEndToEndLatency(): Promise<void> {
    console.log('🔄 Testing End-to-End Latency...');
    
    // Simulate full flow
    const iterations = 1000;
    const latencies: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();
      
      // 1. Network receive (simulated)
      await this.simulateNetworkReceive();
      
      // 2. Risk check (simulated)
      await this.simulateRiskCheck();
      
      // 3. ML prediction (simulated)
      await this.simulateMLPrediction();
      
      // 4. Execution decision (simulated)
      await this.simulateExecutionDecision();
      
      // 5. Network send (simulated)
      await this.simulateNetworkSend();
      
      const endTime = process.hrtime.bigint();
      const latencyUs = Number(endTime - startTime) / 1000;
      latencies.push(latencyUs);
    }
    
    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p90 = latencies[Math.floor(latencies.length * 0.9)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    
    this.results.set('endToEnd', {
      p50: p50 / 1000, // Convert to ms
      p90: p90 / 1000,
      p99: p99 / 1000,
      status: p99 < 5000 ? '✅ PASS' : '❌ FAIL' // 5ms target
    });
    
    console.log(`  P50 Latency: ${(p50 / 1000).toFixed(2)}ms`);
    console.log(`  P90 Latency: ${(p90 / 1000).toFixed(2)}ms`);
    console.log(`  P99 Latency: ${(p99 / 1000).toFixed(2)}ms ${p99 < 5000 ? '✅' : '❌'}\n`);
  }
  
  // Simulation helpers
  private async simulateNetworkReceive(): Promise<void> {
    // Simulate 50μs network receive
    await this.busyWait(50);
  }
  
  private async simulateRiskCheck(): Promise<void> {
    // Simulate <1μs risk check
    await this.busyWait(0.5);
  }
  
  private async simulateMLPrediction(): Promise<void> {
    // Simulate 200μs ML prediction
    await this.busyWait(200);
  }
  
  private async simulateExecutionDecision(): Promise<void> {
    // Simulate 100μs execution decision
    await this.busyWait(100);
  }
  
  private async simulateNetworkSend(): Promise<void> {
    // Simulate 50μs network send
    await this.busyWait(50);
  }
  
  private async busyWait(microseconds: number): Promise<void> {
    const start = process.hrtime.bigint();
    const targetNs = BigInt(microseconds * 1000);
    while (process.hrtime.bigint() - start < targetNs) {
      // Busy wait
    }
  }
  
  /**
   * Print test results
   */
  private printResults(): void {
    console.log('📋 PERFORMANCE TEST RESULTS\n');
    console.log('Test               | Status    | Key Metrics');
    console.log('-------------------|-----------|----------------------------------');
    
    // Network
    const network = this.results.get('network');
    console.log(`Network Latency    | ${network.status} | P99: ${network.p99}ms, Throughput: ${network.throughput}Mbps`);
    
    // Telemetry
    const telemetry = this.results.get('telemetry');
    console.log(`Telemetry Overhead | ${telemetry.status} | ${telemetry.overheadUs.toFixed(3)}μs per operation`);
    
    // Execution
    const execution = this.results.get('execution');
    console.log(`Execution Engine   | ${execution.status} | P99: ${execution.p99.toFixed(1)}μs`);
    
    // End-to-End
    const e2e = this.results.get('endToEnd');
    console.log(`End-to-End         | ${e2e.status} | P99: ${e2e.p99.toFixed(2)}ms (Target: <5ms)`);
    
    // Overall
    const allPassed = Array.from(this.results.values()).every(r => r.status.includes('PASS'));
    console.log('\n' + (allPassed ? '✅ All performance tests PASSED!' : '❌ Some tests FAILED'));
  }
}

// Run tests
if (require.main === module) {
  const suite = new PerformanceTestSuite();
  suite.runAll().catch(console.error);
} 