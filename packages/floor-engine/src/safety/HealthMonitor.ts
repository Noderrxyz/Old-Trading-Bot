import { ethers } from 'ethers';

/**
 * Health check function type
 */
export type HealthCheckFunction = () => Promise<{ passed: boolean; message?: string }>;

/**
 * Health check definition
 */
export interface HealthCheck {
  name: string;
  description: string;
  check: HealthCheckFunction;
  weight: number; // Contribution to overall score (0-100)
  critical: boolean; // If true, failure means system is unhealthy
}

/**
 * Health monitoring result
 */
export interface HealthMonitoringResult {
  healthy: boolean;
  score: number; // 0-100
  timestamp: number;
  checks: {
    name: string;
    passed: boolean;
    message?: string;
    weight: number;
    critical: boolean;
  }[];
  criticalFailures: string[];
}

/**
 * Health monitoring configuration
 */
export interface HealthMonitorConfig {
  checkInterval: number; // Interval between health checks (ms)
  minHealthScore: number; // Minimum acceptable health score
  enableAutoRemediation: boolean; // Enable automatic remediation
}

/**
 * Health Monitor for continuous system monitoring
 * 
 * Features:
 * - Continuous health checking
 * - Weighted health scoring
 * - Critical vs non-critical checks
 * - Historical health tracking
 * - Automatic remediation (optional)
 */
export class HealthMonitor {
  private checks: Map<string, HealthCheck> = new Map();
  private config: HealthMonitorConfig;
  private lastResult?: HealthMonitoringResult;
  private history: HealthMonitoringResult[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = {
      checkInterval: config?.checkInterval ?? 60000, // 1 minute
      minHealthScore: config?.minHealthScore ?? 70,
      enableAutoRemediation: config?.enableAutoRemediation ?? false,
    };
  }

  /**
   * Register a health check
   */
  registerCheck(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
  }

  /**
   * Run all health checks
   */
  async runHealthChecks(): Promise<HealthMonitoringResult> {
    const results: HealthMonitoringResult['checks'] = [];
    const criticalFailures: string[] = [];
    let totalScore = 0;
    let totalWeight = 0;

    // Run all checks
    for (const [name, check] of this.checks.entries()) {
      try {
        const result = await check.check();
        
        results.push({
          name,
          passed: result.passed,
          message: result.message,
          weight: check.weight,
          critical: check.critical,
        });

        // Calculate score contribution
        if (result.passed) {
          totalScore += check.weight;
        } else if (check.critical) {
          criticalFailures.push(name);
        }

        totalWeight += check.weight;

      } catch (error: any) {
        results.push({
          name,
          passed: false,
          message: `Check failed: ${error.message}`,
          weight: check.weight,
          critical: check.critical,
        });

        if (check.critical) {
          criticalFailures.push(name);
        }

        totalWeight += check.weight;
      }
    }

    // Calculate overall score
    const score = totalWeight > 0 ? Math.round((totalScore / totalWeight) * 100) : 0;

    // Determine if system is healthy
    const healthy = criticalFailures.length === 0 && score >= this.config.minHealthScore;

    const result: HealthMonitoringResult = {
      healthy,
      score,
      timestamp: Date.now(),
      checks: results,
      criticalFailures,
    };

    // Store result
    this.lastResult = result;
    this.history.push(result);

    // Keep only last 100 results
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    return result;
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Run initial check
    this.runHealthChecks().catch(err => {
      console.error('Health check failed:', err);
    });

    // Schedule periodic checks
    this.monitoringInterval = setInterval(() => {
      this.runHealthChecks().catch(err => {
        console.error('Health check failed:', err);
      });
    }, this.config.checkInterval);
  }

  /**
   * Stop continuous monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isRunning = false;
  }

  /**
   * Get last health check result
   */
  getLastResult(): HealthMonitoringResult | undefined {
    return this.lastResult;
  }

  /**
   * Get health history
   */
  getHistory(limit: number = 10): HealthMonitoringResult[] {
    return this.history.slice(-limit);
  }

  /**
   * Get health trend (improving, stable, declining)
   */
  getHealthTrend(): 'improving' | 'stable' | 'declining' | 'unknown' {
    if (this.history.length < 3) {
      return 'unknown';
    }

    const recent = this.history.slice(-3);
    const scores = recent.map(r => r.score);

    const trend = scores[2] - scores[0];

    if (trend > 5) return 'improving';
    if (trend < -5) return 'declining';
    return 'stable';
  }

  /**
   * Get average health score
   */
  getAverageScore(periods: number = 10): number {
    if (this.history.length === 0) {
      return 0;
    }

    const recent = this.history.slice(-periods);
    const sum = recent.reduce((acc, r) => acc + r.score, 0);
    return Math.round(sum / recent.length);
  }

  /**
   * Check if system is healthy
   */
  isHealthy(): boolean {
    return this.lastResult?.healthy ?? false;
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checksRegistered: this.checks.size,
      lastCheckTime: this.lastResult?.timestamp,
      currentScore: this.lastResult?.score,
      healthy: this.lastResult?.healthy,
      trend: this.getHealthTrend(),
    };
  }

  /**
   * Get configuration
   */
  getConfig(): HealthMonitorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HealthMonitorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}

/**
 * Create standard health checks for Floor Engine
 */
export function createStandardHealthChecks(
  provider: ethers.Provider,
  adapters: any[]
): HealthCheck[] {
  return [
    {
      name: 'rpc_connectivity',
      description: 'Check RPC provider connectivity',
      weight: 15,
      critical: true,
      check: async () => {
        try {
          await provider.getBlockNumber();
          return { passed: true };
        } catch (error: any) {
          return { passed: false, message: `RPC error: ${error.message}` };
        }
      },
    },
    {
      name: 'adapter_health',
      description: 'Check all adapter health',
      weight: 25,
      critical: true,
      check: async () => {
        try {
          const results = await Promise.all(
            adapters.map(adapter => adapter.healthCheck())
          );
          const unhealthy = results.filter(r => !r.healthy);
          
          if (unhealthy.length > 0) {
            return {
              passed: false,
              message: `${unhealthy.length} adapters unhealthy`,
            };
          }
          
          return { passed: true };
        } catch (error: any) {
          return { passed: false, message: `Health check failed: ${error.message}` };
        }
      },
    },
    {
      name: 'gas_price',
      description: 'Check gas price is reasonable',
      weight: 10,
      critical: false,
      check: async () => {
        try {
          const feeData = await provider.getFeeData();
          const maxGasPrice = ethers.parseUnits('200', 'gwei');
          
          if (feeData.maxFeePerGas && feeData.maxFeePerGas > maxGasPrice) {
            return {
              passed: false,
              message: `Gas price too high: ${ethers.formatUnits(feeData.maxFeePerGas, 'gwei')} gwei`,
            };
          }
          
          return { passed: true };
        } catch (error: any) {
          return { passed: false, message: `Gas check failed: ${error.message}` };
        }
      },
    },
    {
      name: 'network_status',
      description: 'Check network is not congested',
      weight: 10,
      critical: false,
      check: async () => {
        try {
          const block = await provider.getBlock('latest');
          if (!block) {
            return { passed: false, message: 'Could not fetch latest block' };
          }
          
          // Check if block is recent (within 1 minute)
          const now = Math.floor(Date.now() / 1000);
          const blockAge = now - block.timestamp;
          
          if (blockAge > 60) {
            return {
              passed: false,
              message: `Block is ${blockAge}s old`,
            };
          }
          
          return { passed: true };
        } catch (error: any) {
          return { passed: false, message: `Network check failed: ${error.message}` };
        }
      },
    },
    {
      name: 'memory_usage',
      description: 'Check memory usage is acceptable',
      weight: 5,
      critical: false,
      check: async () => {
        const usage = process.memoryUsage();
        const heapUsedMB = usage.heapUsed / 1024 / 1024;
        const maxHeapMB = 500; // 500MB threshold
        
        if (heapUsedMB > maxHeapMB) {
          return {
            passed: false,
            message: `High memory usage: ${heapUsedMB.toFixed(0)}MB`,
          };
        }
        
        return { passed: true };
      },
    },
  ];
}
