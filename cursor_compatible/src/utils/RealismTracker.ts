/**
 * Realism Tracker - Simulation Validation and Metrics
 * 
 * Monitors and validates the realism of paper trading simulation
 * by tracking key metrics and identifying unrealistic patterns.
 */

export interface RealismMetrics {
  // Performance metrics
  averageLatency: number;
  latencyVariance: number;
  successRate: number;
  failureRate: number;
  
  // Trading metrics
  fillRate: number;
  partialFillRate: number;
  slippageAverage: number;
  slippageVariance: number;
  
  // Rate limiting metrics
  rateLimitHits: number;
  throttlingEvents: number;
  
  // Network metrics
  networkJitter: number;
  packetLossRate: number;
  
  // Time-based metrics
  timeBasedAnomalies: number;
  performanceDrift: number;
}

export interface RealismAlert {
  type: 'warning' | 'critical';
  category: 'latency' | 'performance' | 'trading' | 'network' | 'behavior';
  message: string;
  metric: string;
  value: number;
  expected: number;
  deviation: number;
  timestamp: number;
  severity: number; // 1-10 scale
}

export interface RealismThresholds {
  latency: {
    maxAverage: number;
    maxVariance: number;
    maxP95: number;
  };
  performance: {
    minSuccessRate: number;
    maxFailureRate: number;
    maxDrift: number;
  };
  trading: {
    minFillRate: number;
    maxSlippage: number;
    expectedPartialFills: number;
  };
  network: {
    maxJitter: number;
    maxPacketLoss: number;
    maxRateLimitHits: number;
  };
}

export interface ReasonableRange {
  min: number;
  max: number;
  expected: number;
  tolerance: number; // Percentage deviation allowed
}

export class RealismTracker {
  private metrics: RealismMetrics;
  private thresholds: RealismThresholds;
  private alerts: RealismAlert[] = [];
  private enabled: boolean;
  private monitoringInterval?: NodeJS.Timeout;
  private maxAlertsHistory: number = 500;
  
  // Historical data for trend analysis
  private metricsHistory: Array<{ timestamp: number; metrics: RealismMetrics }> = [];
  private maxHistorySize: number = 1000;
  
  // Expected ranges for realistic behavior
  private realismRanges: Record<string, ReasonableRange> = {
    averageLatency: { min: 50, max: 500, expected: 150, tolerance: 0.3 },
    successRate: { min: 0.95, max: 1.0, expected: 0.98, tolerance: 0.05 },
    fillRate: { min: 0.85, max: 0.99, expected: 0.95, tolerance: 0.1 },
    slippageAverage: { min: 0.001, max: 0.01, expected: 0.003, tolerance: 0.5 },
    failureRate: { min: 0.01, max: 0.1, expected: 0.02, tolerance: 0.5 }
  };

  constructor(
    thresholds?: Partial<RealismThresholds>,
    enabled: boolean = true
  ) {
    this.enabled = enabled;
    this.thresholds = {
      latency: {
        maxAverage: 1000,    // 1 second max average
        maxVariance: 500,    // 500ms variance limit
        maxP95: 2000        // 2 seconds 95th percentile
      },
      performance: {
        minSuccessRate: 0.9,  // 90% minimum success rate
        maxFailureRate: 0.1,  // 10% maximum failure rate
        maxDrift: 0.15       // 15% performance drift
      },
      trading: {
        minFillRate: 0.8,     // 80% minimum fill rate
        maxSlippage: 0.02,    // 2% maximum slippage
        expectedPartialFills: 0.1  // 10% partial fills expected
      },
      network: {
        maxJitter: 0.3,       // 30% jitter tolerance
        maxPacketLoss: 0.05,  // 5% packet loss max
        maxRateLimitHits: 0.02 // 2% rate limit hits max
      },
      ...thresholds
    };

    this.metrics = this.initializeMetrics();
    
    if (this.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Update metrics from various simulation components
   */
  updateMetrics(component: string, data: Record<string, number>): void {
    if (!this.enabled) return;

    // Update relevant metrics based on component
    switch (component) {
      case 'latency':
        this.updateLatencyMetrics(data);
        break;
      case 'trading':
        this.updateTradingMetrics(data);
        break;
      case 'network':
        this.updateNetworkMetrics(data);
        break;
      case 'performance':
        this.updatePerformanceMetrics(data);
        break;
    }

    this.validateRealism();
    this.recordMetricsSnapshot();
  }

  /**
   * Report trading execution results
   */
  reportExecution(result: {
    success: boolean;
    latency: number;
    filled: boolean;
    partialFill: boolean;
    slippage: number;
    rateLimited: boolean;
  }): void {
    if (!this.enabled) return;

    // Update success/failure rates
    if (result.success) {
      this.updateSuccessRate(true);
    } else {
      this.updateSuccessRate(false);
    }

    // Update latency metrics
    this.updateMetrics('latency', { 
      latency: result.latency 
    });

    // Update trading metrics
    this.updateMetrics('trading', {
      filled: result.filled ? 1 : 0,
      partialFill: result.partialFill ? 1 : 0,
      slippage: result.slippage
    });

    // Update network metrics
    if (result.rateLimited) {
      this.updateMetrics('network', { rateLimitHit: 1 });
    }
  }

  /**
   * Get current realism score (0-100)
   */
  getRealismScore(): number {
    if (!this.enabled) return 100;

    const scores: number[] = [];
    
    // Score each category
    scores.push(this.scoreLatencyRealism());
    scores.push(this.scorePerformanceRealism());
    scores.push(this.scoreTradingRealism());
    scores.push(this.scoreNetworkRealism());
    
    // Calculate weighted average
    const weights = [0.25, 0.25, 0.3, 0.2]; // Trading gets higher weight
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < scores.length; i++) {
      weightedSum += scores[i] * weights[i];
      totalWeight += weights[i];
    }
    
    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Get active alerts
   */
  getAlerts(severity?: number): RealismAlert[] {
    if (severity !== undefined) {
      return this.alerts.filter(alert => alert.severity >= severity);
    }
    return [...this.alerts];
  }

  /**
   * Get metrics summary
   */
  getMetrics(): RealismMetrics {
    return { ...this.metrics };
  }

  /**
   * Get detailed realism report
   */
  getRealismReport(): {
    score: number;
    metrics: RealismMetrics;
    alerts: RealismAlert[];
    trends: Record<string, 'improving' | 'stable' | 'degrading'>;
    recommendations: string[];
  } {
    const score = this.getRealismScore();
    const trends = this.analyzeTrends();
    const recommendations = this.generateRecommendations();
    
    return {
      score,
      metrics: this.getMetrics(),
      alerts: this.getAlerts(),
      trends,
      recommendations
    };
  }

  /**
   * Clear all alerts and reset metrics
   */
  reset(): void {
    this.alerts = [];
    this.metricsHistory = [];
    this.metrics = this.initializeMetrics();
  }

  /**
   * Enable or disable realism tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    
    if (enabled && !this.monitoringInterval) {
      this.startMonitoring();
    } else if (!enabled && this.monitoringInterval) {
      this.stopMonitoring();
    }
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): RealismMetrics {
    return {
      averageLatency: 0,
      latencyVariance: 0,
      successRate: 1,
      failureRate: 0,
      fillRate: 1,
      partialFillRate: 0,
      slippageAverage: 0,
      slippageVariance: 0,
      rateLimitHits: 0,
      throttlingEvents: 0,
      networkJitter: 0,
      packetLossRate: 0,
      timeBasedAnomalies: 0,
      performanceDrift: 0
    };
  }

  /**
   * Update latency-related metrics
   */
  private updateLatencyMetrics(data: Record<string, number>): void {
    if (data.latency !== undefined) {
      // Update rolling average
      this.metrics.averageLatency = this.updateRollingAverage(
        this.metrics.averageLatency, data.latency, 100
      );
      
      // Calculate variance
      const variance = Math.pow(data.latency - this.metrics.averageLatency, 2);
      this.metrics.latencyVariance = this.updateRollingAverage(
        this.metrics.latencyVariance, variance, 100
      );
    }

    if (data.jitter !== undefined) {
      this.metrics.networkJitter = this.updateRollingAverage(
        this.metrics.networkJitter, data.jitter, 50
      );
    }
  }

  /**
   * Update trading-related metrics
   */
  private updateTradingMetrics(data: Record<string, number>): void {
    if (data.filled !== undefined) {
      this.metrics.fillRate = this.updateRollingAverage(
        this.metrics.fillRate, data.filled, 50
      );
    }

    if (data.partialFill !== undefined) {
      this.metrics.partialFillRate = this.updateRollingAverage(
        this.metrics.partialFillRate, data.partialFill, 50
      );
    }

    if (data.slippage !== undefined) {
      this.metrics.slippageAverage = this.updateRollingAverage(
        this.metrics.slippageAverage, data.slippage, 50
      );
      
      const slippageVariance = Math.pow(data.slippage - this.metrics.slippageAverage, 2);
      this.metrics.slippageVariance = this.updateRollingAverage(
        this.metrics.slippageVariance, slippageVariance, 50
      );
    }
  }

  /**
   * Update network-related metrics
   */
  private updateNetworkMetrics(data: Record<string, number>): void {
    if (data.rateLimitHit !== undefined) {
      this.metrics.rateLimitHits = this.updateRollingAverage(
        this.metrics.rateLimitHits, data.rateLimitHit, 100
      );
    }

    if (data.packetLoss !== undefined) {
      this.metrics.packetLossRate = this.updateRollingAverage(
        this.metrics.packetLossRate, data.packetLoss, 100
      );
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(data: Record<string, number>): void {
    if (data.success !== undefined) {
      this.updateSuccessRate(data.success === 1);
    }
  }

  /**
   * Update success/failure rates
   */
  private updateSuccessRate(success: boolean): void {
    const successValue = success ? 1 : 0;
    this.metrics.successRate = this.updateRollingAverage(
      this.metrics.successRate, successValue, 100
    );
    this.metrics.failureRate = 1 - this.metrics.successRate;
  }

  /**
   * Update rolling average
   */
  private updateRollingAverage(current: number, newValue: number, windowSize: number): number {
    const alpha = 1 / windowSize;
    return (1 - alpha) * current + alpha * newValue;
  }

  /**
   * Validate realism and generate alerts
   */
  private validateRealism(): void {
    this.checkLatencyRealism();
    this.checkPerformanceRealism();
    this.checkTradingRealism();
    this.checkNetworkRealism();
    this.checkBehavioralRealism();
  }

  /**
   * Check latency realism
   */
  private checkLatencyRealism(): void {
    if (this.metrics.averageLatency > this.thresholds.latency.maxAverage) {
      this.addAlert({
        type: 'warning',
        category: 'latency',
        message: 'Average latency too high for realistic simulation',
        metric: 'averageLatency',
        value: this.metrics.averageLatency,
        expected: this.realismRanges.averageLatency.expected,
        deviation: this.calculateDeviation(this.metrics.averageLatency, this.realismRanges.averageLatency),
        severity: 6
      });
    }

    if (this.metrics.latencyVariance > this.thresholds.latency.maxVariance) {
      this.addAlert({
        type: 'warning',
        category: 'latency',
        message: 'Latency variance indicates unrealistic network behavior',
        metric: 'latencyVariance',
        value: this.metrics.latencyVariance,
        expected: this.thresholds.latency.maxVariance,
        deviation: (this.metrics.latencyVariance - this.thresholds.latency.maxVariance) / this.thresholds.latency.maxVariance,
        severity: 5
      });
    }
  }

  /**
   * Check performance realism
   */
  private checkPerformanceRealism(): void {
    if (this.metrics.successRate < this.thresholds.performance.minSuccessRate) {
      this.addAlert({
        type: 'critical',
        category: 'performance',
        message: 'Success rate too low - simulation may be too pessimistic',
        metric: 'successRate',
        value: this.metrics.successRate,
        expected: this.realismRanges.successRate.expected,
        deviation: this.calculateDeviation(this.metrics.successRate, this.realismRanges.successRate),
        severity: 8
      });
    }

    if (this.metrics.successRate > 0.995) {
      this.addAlert({
        type: 'warning',
        category: 'performance',
        message: 'Success rate too high - simulation may be too optimistic',
        metric: 'successRate',
        value: this.metrics.successRate,
        expected: this.realismRanges.successRate.expected,
        deviation: this.calculateDeviation(this.metrics.successRate, this.realismRanges.successRate),
        severity: 7
      });
    }
  }

  /**
   * Check trading realism
   */
  private checkTradingRealism(): void {
    if (this.metrics.fillRate > 0.99) {
      this.addAlert({
        type: 'warning',
        category: 'trading',
        message: 'Fill rate too high - unrealistic execution',
        metric: 'fillRate',
        value: this.metrics.fillRate,
        expected: this.realismRanges.fillRate.expected,
        deviation: this.calculateDeviation(this.metrics.fillRate, this.realismRanges.fillRate),
        severity: 6
      });
    }

    if (this.metrics.slippageAverage < 0.0005) {
      this.addAlert({
        type: 'warning',
        category: 'trading',
        message: 'Slippage too low - unrealistic market impact',
        metric: 'slippageAverage',
        value: this.metrics.slippageAverage,
        expected: this.realismRanges.slippageAverage.expected,
        deviation: this.calculateDeviation(this.metrics.slippageAverage, this.realismRanges.slippageAverage),
        severity: 5
      });
    }
  }

  /**
   * Check network realism
   */
  private checkNetworkRealism(): void {
    if (this.metrics.rateLimitHits > this.thresholds.network.maxRateLimitHits) {
      this.addAlert({
        type: 'warning',
        category: 'network',
        message: 'Rate limiting too aggressive',
        metric: 'rateLimitHits',
        value: this.metrics.rateLimitHits,
        expected: this.thresholds.network.maxRateLimitHits,
        deviation: (this.metrics.rateLimitHits - this.thresholds.network.maxRateLimitHits) / this.thresholds.network.maxRateLimitHits,
        severity: 4
      });
    }
  }

  /**
   * Check behavioral realism
   */
  private checkBehavioralRealism(): void {
    // Check for suspiciously perfect patterns
    if (this.metrics.latencyVariance < 5 && this.metrics.averageLatency > 0) {
      this.addAlert({
        type: 'warning',
        category: 'behavior',
        message: 'Latency too consistent - lacks realistic variance',
        metric: 'latencyVariance',
        value: this.metrics.latencyVariance,
        expected: 25,
        deviation: (25 - this.metrics.latencyVariance) / 25,
        severity: 3
      });
    }
  }

  /**
   * Score individual realism categories
   */
  private scoreLatencyRealism(): number {
    const latencyScore = this.scoreMetricAgainstRange('averageLatency', this.metrics.averageLatency);
    const varianceScore = Math.max(0, 100 - (this.metrics.latencyVariance / 10));
    return (latencyScore + varianceScore) / 2;
  }

  private scorePerformanceRealism(): number {
    const successScore = this.scoreMetricAgainstRange('successRate', this.metrics.successRate);
    const failureScore = this.scoreMetricAgainstRange('failureRate', this.metrics.failureRate);
    return (successScore + failureScore) / 2;
  }

  private scoreTradingRealism(): number {
    const fillScore = this.scoreMetricAgainstRange('fillRate', this.metrics.fillRate);
    const slippageScore = this.scoreMetricAgainstRange('slippageAverage', this.metrics.slippageAverage);
    return (fillScore + slippageScore) / 2;
  }

  private scoreNetworkRealism(): number {
    const rateLimitScore = Math.max(0, 100 - (this.metrics.rateLimitHits * 500));
    const jitterScore = Math.max(0, 100 - (this.metrics.networkJitter * 200));
    return (rateLimitScore + jitterScore) / 2;
  }

  /**
   * Score metric against reasonable range
   */
  private scoreMetricAgainstRange(metricName: string, value: number): number {
    const range = this.realismRanges[metricName];
    if (!range) return 50; // Default neutral score
    
    if (value >= range.min && value <= range.max) {
      // Within range - score based on distance from expected
      const deviation = Math.abs(value - range.expected) / (range.expected * range.tolerance);
      return Math.max(0, 100 - (deviation * 50));
    } else {
      // Outside range - penalty based on how far outside
      const outsideRatio = value < range.min ? 
        (range.min - value) / range.min : 
        (value - range.max) / range.max;
      return Math.max(0, 50 - (outsideRatio * 50));
    }
  }

  /**
   * Calculate deviation from expected range
   */
  private calculateDeviation(value: number, range: ReasonableRange): number {
    if (value >= range.min && value <= range.max) {
      return Math.abs(value - range.expected) / range.expected;
    } else {
      return value < range.min ? 
        (range.min - value) / range.expected :
        (value - range.max) / range.expected;
    }
  }

  /**
   * Add alert with deduplication
   */
  private addAlert(alert: Omit<RealismAlert, 'timestamp'>): void {
    const timestamp = Date.now();
    const fullAlert: RealismAlert = { ...alert, timestamp };
    
    // Check for recent duplicate
    const recentDuplicate = this.alerts.find(a => 
      a.metric === alert.metric && 
      a.category === alert.category &&
      timestamp - a.timestamp < 30000 // 30 seconds
    );
    
    if (!recentDuplicate) {
      this.alerts.push(fullAlert);
      
      // Keep alerts history manageable
      if (this.alerts.length > this.maxAlertsHistory) {
        this.alerts = this.alerts.slice(-this.maxAlertsHistory);
      }
    }
  }

  /**
   * Record metrics snapshot for trend analysis
   */
  private recordMetricsSnapshot(): void {
    this.metricsHistory.push({
      timestamp: Date.now(),
      metrics: { ...this.metrics }
    });
    
    // Keep history size manageable
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Analyze trends in metrics
   */
  private analyzeTrends(): Record<string, 'improving' | 'stable' | 'degrading'> {
    const trends: Record<string, 'improving' | 'stable' | 'degrading'> = {};
    
    if (this.metricsHistory.length < 10) {
      return trends; // Not enough data
    }
    
    const recent = this.metricsHistory.slice(-10);
    const older = this.metricsHistory.slice(-20, -10);
    
    if (older.length === 0) return trends;
    
    // Analyze key metrics
    const keyMetrics = ['averageLatency', 'successRate', 'fillRate', 'slippageAverage'];
    
    for (const metric of keyMetrics) {
      const recentAvg = recent.reduce((sum, h) => sum + (h.metrics as any)[metric], 0) / recent.length;
      const olderAvg = older.reduce((sum, h) => sum + (h.metrics as any)[metric], 0) / older.length;
      
      const change = (recentAvg - olderAvg) / olderAvg;
      
      if (Math.abs(change) < 0.05) {
        trends[metric] = 'stable';
      } else if (
        (metric === 'successRate' || metric === 'fillRate') && change > 0 ||
        (metric === 'averageLatency' || metric === 'slippageAverage') && change < 0
      ) {
        trends[metric] = 'improving';
      } else {
        trends[metric] = 'degrading';
      }
    }
    
    return trends;
  }

  /**
   * Generate improvement recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const score = this.getRealismScore();
    
    if (score < 70) {
      recommendations.push('Overall realism score is low - review simulation parameters');
    }
    
    if (this.metrics.averageLatency > 300) {
      recommendations.push('Consider reducing latency simulation for more realistic response times');
    }
    
    if (this.metrics.successRate > 0.995) {
      recommendations.push('Increase failure simulation to match real-world conditions');
    }
    
    if (this.metrics.fillRate > 0.98) {
      recommendations.push('Add more partial fill scenarios for realistic execution');
    }
    
    if (this.metrics.slippageAverage < 0.001) {
      recommendations.push('Increase slippage simulation for realistic market impact');
    }
    
    if (this.alerts.length > 10) {
      recommendations.push('Too many alerts - consider adjusting realism thresholds');
    }
    
    return recommendations;
  }

  /**
   * Start monitoring interval
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.validateRealism();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop monitoring interval
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }
} 