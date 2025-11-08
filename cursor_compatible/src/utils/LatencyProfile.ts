/**
 * Latency Profile - Realistic API Response Time Simulation
 * 
 * Simulates realistic latency patterns for different exchange endpoints
 * with network conditions, geographic factors, and load-based delays.
 */

export interface LatencyConfig {
  baseLatency: number;        // Base latency in milliseconds
  variability: number;        // Standard deviation for normal distribution
  percentile95: number;       // 95th percentile latency cap
  jitter: number;            // Random jitter percentage (0-1)
}

export interface EndpointLatencies {
  orders: LatencyConfig;
  market_data: LatencyConfig;
  account: LatencyConfig;
  websocket: LatencyConfig;
  system_status: LatencyConfig;
}

export interface NetworkCondition {
  name: string;
  multiplier: number;        // Latency multiplier
  packetLoss: number;        // Packet loss probability (0-1)
  description: string;
}

export interface LatencyResult {
  latency: number;           // Actual latency to simulate
  endpoint: string;
  networkCondition: string;
  timestamp: number;
}

export class LatencyProfile {
  private endpointLatencies: EndpointLatencies;
  private currentCondition: NetworkCondition;
  private enabled: boolean;
  private latencyHistory: LatencyResult[] = [];
  private maxHistorySize: number = 1000;

  // Predefined network conditions
  private networkConditions: Map<string, NetworkCondition> = new Map([
    ['optimal', {
      name: 'optimal',
      multiplier: 1.0,
      packetLoss: 0.001,
      description: 'Optimal network conditions'
    }],
    ['good', {
      name: 'good',
      multiplier: 1.2,
      packetLoss: 0.005,
      description: 'Good network conditions'
    }],
    ['fair', {
      name: 'fair',
      multiplier: 1.5,
      packetLoss: 0.01,
      description: 'Fair network conditions'
    }],
    ['poor', {
      name: 'poor',
      multiplier: 2.0,
      packetLoss: 0.02,
      description: 'Poor network conditions'
    }],
    ['degraded', {
      name: 'degraded',
      multiplier: 3.0,
      packetLoss: 0.05,
      description: 'Degraded network conditions'
    }]
  ]);

  constructor(
    endpointLatencies?: Partial<EndpointLatencies>,
    enabled: boolean = true,
    initialCondition: string = 'good'
  ) {
    this.enabled = enabled;
    this.endpointLatencies = {
      orders: {
        baseLatency: 150,       // 150ms average for order placement
        variability: 50,        // ±50ms standard deviation
        percentile95: 500,      // 95% under 500ms
        jitter: 0.1            // 10% jitter
      },
      market_data: {
        baseLatency: 80,        // 80ms average for market data
        variability: 30,
        percentile95: 200,
        jitter: 0.15
      },
      account: {
        baseLatency: 120,       // 120ms average for account info
        variability: 40,
        percentile95: 300,
        jitter: 0.1
      },
      websocket: {
        baseLatency: 25,        // 25ms average for websocket
        variability: 10,
        percentile95: 100,
        jitter: 0.2
      },
      system_status: {
        baseLatency: 200,       // 200ms average for system status
        variability: 100,
        percentile95: 800,
        jitter: 0.25
      },
      ...endpointLatencies
    };
    
    this.currentCondition = this.networkConditions.get(initialCondition) || 
                           this.networkConditions.get('good')!;
  }

  /**
   * Calculate latency for a specific endpoint
   */
  getLatency(endpoint: string): LatencyResult {
    if (!this.enabled) {
      return {
        latency: 0,
        endpoint,
        networkCondition: 'disabled',
        timestamp: Date.now()
      };
    }

    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    const config = this.endpointLatencies[normalizedEndpoint];
    
    // Check for packet loss simulation
    if (Math.random() < this.currentCondition.packetLoss) {
      // Simulate timeout/retry latency
      const timeoutLatency = config.baseLatency * 5 + Math.random() * 1000;
      return this.createResult(timeoutLatency, endpoint);
    }

    // Calculate base latency with normal distribution
    const baseLatency = this.generateNormalDistribution(
      config.baseLatency,
      config.variability
    );

    // Apply network condition multiplier
    let adjustedLatency = baseLatency * this.currentCondition.multiplier;

    // Add jitter
    const jitterAmount = adjustedLatency * config.jitter * (Math.random() * 2 - 1);
    adjustedLatency += jitterAmount;

    // Ensure latency doesn't exceed 95th percentile cap
    adjustedLatency = Math.min(adjustedLatency, config.percentile95);

    // Ensure minimum latency
    adjustedLatency = Math.max(adjustedLatency, 5);

    const result = this.createResult(adjustedLatency, endpoint);
    this.recordLatency(result);
    
    return result;
  }

  /**
   * Simulate latency delay (returns a Promise that resolves after the latency)
   */
  async simulateDelay(endpoint: string): Promise<LatencyResult> {
    const result = this.getLatency(endpoint);
    
    if (result.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, result.latency));
    }
    
    return result;
  }

  /**
   * Change network conditions
   */
  setNetworkCondition(conditionName: string): boolean {
    const condition = this.networkConditions.get(conditionName);
    if (condition) {
      this.currentCondition = condition;
      return true;
    }
    return false;
  }

  /**
   * Get current network condition
   */
  getCurrentCondition(): NetworkCondition {
    return { ...this.currentCondition };
  }

  /**
   * Get available network conditions
   */
  getAvailableConditions(): NetworkCondition[] {
    return Array.from(this.networkConditions.values());
  }

  /**
   * Add custom network condition
   */
  addNetworkCondition(condition: NetworkCondition): void {
    this.networkConditions.set(condition.name, condition);
  }

  /**
   * Update latency configuration for specific endpoint
   */
  updateEndpointConfig(endpoint: keyof EndpointLatencies, config: Partial<LatencyConfig>): void {
    this.endpointLatencies[endpoint] = {
      ...this.endpointLatencies[endpoint],
      ...config
    };
  }

  /**
   * Enable or disable latency simulation
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get latency statistics
   */
  getStatistics(): {
    averageLatency: number;
    medianLatency: number;
    p95Latency: number;
    totalRequests: number;
    conditionBreakdown: Record<string, number>;
  } {
    if (this.latencyHistory.length === 0) {
      return {
        averageLatency: 0,
        medianLatency: 0,
        p95Latency: 0,
        totalRequests: 0,
        conditionBreakdown: {}
      };
    }

    const latencies = this.latencyHistory.map(h => h.latency).sort((a, b) => a - b);
    const average = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    const median = latencies[Math.floor(latencies.length / 2)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    const conditionBreakdown: Record<string, number> = {};
    this.latencyHistory.forEach(h => {
      conditionBreakdown[h.networkCondition] = (conditionBreakdown[h.networkCondition] || 0) + 1;
    });

    return {
      averageLatency: Number(average.toFixed(2)),
      medianLatency: median,
      p95Latency: p95,
      totalRequests: this.latencyHistory.length,
      conditionBreakdown
    };
  }

  /**
   * Clear latency history
   */
  clearHistory(): void {
    this.latencyHistory = [];
  }

  /**
   * Get recent latency history
   */
  getRecentHistory(limit: number = 100): LatencyResult[] {
    return this.latencyHistory.slice(-limit);
  }

  /**
   * Normalize endpoint name to category
   */
  private normalizeEndpoint(endpoint: string): keyof EndpointLatencies {
    const lower = endpoint.toLowerCase();
    
    if (lower.includes('order') || lower.includes('trade')) {
      return 'orders';
    } else if (lower.includes('account') || lower.includes('balance') || lower.includes('position')) {
      return 'account';
    } else if (lower.includes('ws') || lower.includes('websocket') || lower.includes('stream')) {
      return 'websocket';
    } else if (lower.includes('status') || lower.includes('ping') || lower.includes('health')) {
      return 'system_status';
    } else {
      return 'market_data';
    }
  }

  /**
   * Generate normal distribution value
   */
  private generateNormalDistribution(mean: number, stdDev: number): number {
    // Box-Muller transformation for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /**
   * Create latency result object
   */
  private createResult(latency: number, endpoint: string): LatencyResult {
    return {
      latency: Math.round(latency),
      endpoint,
      networkCondition: this.currentCondition.name,
      timestamp: Date.now()
    };
  }

  /**
   * Record latency for statistics
   */
  private recordLatency(result: LatencyResult): void {
    this.latencyHistory.push(result);
    
    // Keep history size manageable
    if (this.latencyHistory.length > this.maxHistorySize) {
      this.latencyHistory = this.latencyHistory.slice(-this.maxHistorySize);
    }
  }
} 