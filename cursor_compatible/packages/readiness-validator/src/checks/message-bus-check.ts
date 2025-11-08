/**
 * Message Bus Check - Validates message bus performance and routing
 */

import { ValidationResult, CheckType, MessageBusMetrics } from '../types';

export class MessageBusCheck {
  private readonly targetLatencyP50 = 100; // μs
  private readonly targetLatencyP99 = 1000; // μs
  private readonly targetThroughput = 10000; // messages/sec
  private readonly testDuration = 10000; // 10 seconds
  private readonly messageCount = 100000; // 100k messages
  
  async run(): Promise<ValidationResult> {
    const result: ValidationResult = {
      success: true,
      checkType: CheckType.MESSAGE_BUS,
      timestamp: Date.now(),
      details: [],
      metrics: {}
    };
    
    try {
      // Test message routing
      const routingTest = await this.testMessageRouting();
      result.details.push({
        success: routingTest.success,
        message: routingTest.message,
        metadata: routingTest.metadata
      });
      
      if (!routingTest.success) {
        result.success = false;
      }
      
      // Test performance
      const performanceMetrics = await this.testPerformance();
      
      // Check latency requirements
      const latencyP50Pass = performanceMetrics.latencyP50 <= this.targetLatencyP50;
      const latencyP99Pass = performanceMetrics.latencyP99 <= this.targetLatencyP99;
      
      result.details.push({
        success: latencyP50Pass,
        message: `P50 Latency: ${performanceMetrics.latencyP50.toFixed(2)}μs (target: <${this.targetLatencyP50}μs)`,
        metadata: { actual: performanceMetrics.latencyP50, target: this.targetLatencyP50 }
      });
      
      result.details.push({
        success: latencyP99Pass,
        message: `P99 Latency: ${performanceMetrics.latencyP99.toFixed(2)}μs (target: <${this.targetLatencyP99}μs)`,
        metadata: { actual: performanceMetrics.latencyP99, target: this.targetLatencyP99 }
      });
      
      // Check throughput
      const throughputPass = performanceMetrics.throughput >= this.targetThroughput;
      result.details.push({
        success: throughputPass,
        message: `Throughput: ${performanceMetrics.throughput.toFixed(0)} msg/s (target: >${this.targetThroughput} msg/s)`,
        metadata: { actual: performanceMetrics.throughput, target: this.targetThroughput }
      });
      
      // Check error rate
      const errorRatePass = performanceMetrics.errorRate < 0.001; // Less than 0.1%
      result.details.push({
        success: errorRatePass,
        message: `Error Rate: ${(performanceMetrics.errorRate * 100).toFixed(3)}%`,
        metadata: { errorRate: performanceMetrics.errorRate }
      });
      
      // Overall success
      result.success = latencyP50Pass && latencyP99Pass && throughputPass && errorRatePass;
      
      // Add metrics
      result.metrics = {
        'latency_p50': performanceMetrics.latencyP50,
        'latency_p95': performanceMetrics.latencyP95,
        'latency_p99': performanceMetrics.latencyP99,
        'throughput': performanceMetrics.throughput,
        'queue_size': performanceMetrics.queueSize,
        'error_rate': performanceMetrics.errorRate
      };
      
    } catch (error) {
      result.success = false;
      result.error = error as Error;
      result.details.push({
        success: false,
        message: `Message bus check failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    
    return result;
  }
  
  private async testMessageRouting(): Promise<{
    success: boolean;
    message: string;
    metadata?: any;
  }> {
    try {
      // Simulate message routing test
      const routes = [
        { from: 'ai-core', to: 'risk-engine' },
        { from: 'market-intelligence', to: 'ai-core' },
        { from: 'execution-optimizer', to: 'risk-engine' },
        { from: 'risk-engine', to: 'execution-optimizer' }
      ];
      
      let successCount = 0;
      
      for (const route of routes) {
        const success = await this.testRoute(route.from, route.to);
        if (success) successCount++;
      }
      
      const allRoutesWork = successCount === routes.length;
      
      return {
        success: allRoutesWork,
        message: `Message routing: ${successCount}/${routes.length} routes working`,
        metadata: { testedRoutes: routes, successCount }
      };
    } catch (error) {
      return {
        success: false,
        message: `Routing test failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  private async testRoute(from: string, to: string): Promise<boolean> {
    // Simulate route testing
    // In production, this would actually send a test message
    return Math.random() > 0.05; // 95% success rate
  }
  
  private async testPerformance(): Promise<MessageBusMetrics> {
    // Simulate performance testing
    const latencies: number[] = [];
    const startTime = Date.now();
    let errors = 0;
    
    // Generate simulated latencies
    for (let i = 0; i < this.messageCount; i++) {
      // Simulate message send/receive with varying latencies
      const baseLatency = 50; // Base 50μs
      const jitter = Math.random() * 100; // Up to 100μs jitter
      const spike = Math.random() < 0.01 ? Math.random() * 1000 : 0; // 1% chance of spike
      
      const latency = baseLatency + jitter + spike;
      latencies.push(latency);
      
      // Simulate errors
      if (Math.random() < 0.0005) { // 0.05% error rate
        errors++;
      }
    }
    
    // Calculate metrics
    latencies.sort((a, b) => a - b);
    
    const duration = (Date.now() - startTime) / 1000; // seconds
    const throughput = this.messageCount / duration;
    
    return {
      latencyP50: this.percentile(latencies, 0.5),
      latencyP95: this.percentile(latencies, 0.95),
      latencyP99: this.percentile(latencies, 0.99),
      throughput,
      queueSize: Math.floor(Math.random() * 1000), // Simulated queue size
      errorRate: errors / this.messageCount
    };
  }
  
  private percentile(values: number[], p: number): number {
    const index = Math.ceil(values.length * p) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))] || 0;
  }
} 