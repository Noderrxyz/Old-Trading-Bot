/**
 * Failure Simulator - Infrastructure Failure Modeling
 * 
 * Simulates realistic infrastructure failures including API errors,
 * network timeouts, rate limiting, and exchange-specific issues.
 */

export interface FailureConfig {
  probability: number;        // Base failure probability (0-1)
  types: FailureType[];      // Types of failures to simulate
  recoveryTime: number;      // Time to recover in milliseconds
  escalation: boolean;       // Whether failures can escalate
}

export interface FailureType {
  name: string;
  probability: number;       // Relative probability within failures
  duration: number;          // How long this failure type lasts
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;      // Whether this failure can auto-recover
  errorCode?: number;        // HTTP error code to simulate
  errorMessage: string;      // Error message to return
}

export interface FailureResult {
  shouldFail: boolean;
  failureType?: FailureType;
  errorCode?: number;
  errorMessage?: string;
  retryAfter?: number;       // Seconds to wait before retry
  timestamp: number;
}

export interface FailureStatistics {
  totalRequests: number;
  totalFailures: number;
  failureRate: number;
  failuresByType: Record<string, number>;
  averageRecoveryTime: number;
  currentlyFailing: boolean;
}

export class FailureSimulator {
  private config: FailureConfig;
  private enabled: boolean;
  private currentFailures: Map<string, { type: FailureType; startTime: number }> = new Map();
  private failureHistory: Array<{ type: string; timestamp: number; duration: number }> = [];
  private statistics: FailureStatistics;
  private maxHistorySize: number = 1000;

  // Predefined failure types for exchanges
  private defaultFailureTypes: FailureType[] = [
    {
      name: 'rate_limit',
      probability: 0.4,
      duration: 5000,
      severity: 'medium',
      recoverable: true,
      errorCode: 429,
      errorMessage: 'Rate limit exceeded'
    },
    {
      name: 'network_timeout',
      probability: 0.3,
      duration: 2000,
      severity: 'low',
      recoverable: true,
      errorCode: 408,
      errorMessage: 'Request timeout'
    },
    {
      name: 'server_error',
      probability: 0.15,
      duration: 10000,
      severity: 'high',
      recoverable: true,
      errorCode: 500,
      errorMessage: 'Internal server error'
    },
    {
      name: 'maintenance',
      probability: 0.1,
      duration: 30000,
      severity: 'critical',
      recoverable: true,
      errorCode: 503,
      errorMessage: 'Service temporarily unavailable'
    },
    {
      name: 'invalid_request',
      probability: 0.05,
      duration: 0,
      severity: 'low',
      recoverable: false,
      errorCode: 400,
      errorMessage: 'Invalid request parameters'
    }
  ];

  constructor(
    config?: Partial<FailureConfig>,
    enabled: boolean = true
  ) {
    this.enabled = enabled;
    this.config = {
      probability: 0.02,        // 2% base failure rate
      types: this.defaultFailureTypes,
      recoveryTime: 5000,       // 5 second recovery time
      escalation: true,
      ...config
    };

    this.statistics = {
      totalRequests: 0,
      totalFailures: 0,
      failureRate: 0,
      failuresByType: {},
      averageRecoveryTime: 0,
      currentlyFailing: false
    };

    // Start recovery monitoring
    this.startRecoveryMonitoring();
  }

  /**
   * Check if operation should fail
   */
  shouldFail(endpoint: string = 'default'): FailureResult {
    this.statistics.totalRequests++;

    if (!this.enabled) {
      return {
        shouldFail: false,
        timestamp: Date.now()
      };
    }

    // Check if currently in a failure state
    const existingFailure = this.currentFailures.get(endpoint);
    if (existingFailure) {
      this.statistics.totalFailures++;
      this.updateFailureRate();

      return {
        shouldFail: true,
        failureType: existingFailure.type,
        errorCode: existingFailure.type.errorCode,
        errorMessage: existingFailure.type.errorMessage,
        retryAfter: this.calculateRetryAfter(existingFailure.type),
        timestamp: Date.now()
      };
    }

    // Determine if new failure should occur
    if (Math.random() < this.config.probability) {
      const failureType = this.selectFailureType();
      
      if (failureType.duration > 0) {
        this.currentFailures.set(endpoint, {
          type: failureType,
          startTime: Date.now()
        });
      }

      this.recordFailure(failureType);
      this.statistics.totalFailures++;
      this.updateFailureRate();

      return {
        shouldFail: true,
        failureType,
        errorCode: failureType.errorCode,
        errorMessage: failureType.errorMessage,
        retryAfter: this.calculateRetryAfter(failureType),
        timestamp: Date.now()
      };
    }

    return {
      shouldFail: false,
      timestamp: Date.now()
    };
  }

  /**
   * Simulate specific failure type
   */
  simulateFailure(failureTypeName: string, endpoint: string = 'default'): FailureResult {
    if (!this.enabled) {
      return {
        shouldFail: false,
        timestamp: Date.now()
      };
    }

    const failureType = this.config.types.find(t => t.name === failureTypeName);
    if (!failureType) {
      throw new Error(`Unknown failure type: ${failureTypeName}`);
    }

    if (failureType.duration > 0) {
      this.currentFailures.set(endpoint, {
        type: failureType,
        startTime: Date.now()
      });
    }

    this.recordFailure(failureType);
    this.statistics.totalFailures++;
    this.updateFailureRate();

    return {
      shouldFail: true,
      failureType,
      errorCode: failureType.errorCode,
      errorMessage: failureType.errorMessage,
      retryAfter: this.calculateRetryAfter(failureType),
      timestamp: Date.now()
    };
  }

  /**
   * Force recovery from all failures
   */
  recover(endpoint?: string): void {
    if (endpoint) {
      this.currentFailures.delete(endpoint);
    } else {
      this.currentFailures.clear();
    }
    
    this.statistics.currentlyFailing = this.currentFailures.size > 0;
  }

  /**
   * Update failure configuration
   */
  updateConfig(config: Partial<FailureConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
  }

  /**
   * Add custom failure type
   */
  addFailureType(failureType: FailureType): void {
    this.config.types.push(failureType);
  }

  /**
   * Get current failure statistics
   */
  getStatistics(): FailureStatistics {
    return { ...this.statistics };
  }

  /**
   * Get active failures
   */
  getActiveFailures(): Record<string, { type: string; duration: number }> {
    const active: Record<string, { type: string; duration: number }> = {};
    const now = Date.now();
    
    for (const [endpoint, failure] of this.currentFailures) {
      active[endpoint] = {
        type: failure.type.name,
        duration: now - failure.startTime
      };
    }
    
    return active;
  }

  /**
   * Enable or disable failure simulation
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.currentFailures.clear();
      this.statistics.currentlyFailing = false;
    }
  }

  /**
   * Clear failure history and statistics
   */
  clearHistory(): void {
    this.failureHistory = [];
    this.statistics = {
      totalRequests: 0,
      totalFailures: 0,
      failureRate: 0,
      failuresByType: {},
      averageRecoveryTime: 0,
      currentlyFailing: this.currentFailures.size > 0
    };
  }

  /**
   * Get failure history
   */
  getFailureHistory(limit: number = 100): Array<{ type: string; timestamp: number; duration: number }> {
    return this.failureHistory.slice(-limit);
  }

  /**
   * Escalate failure severity (for testing)
   */
  escalateFailures(): void {
    if (!this.config.escalation) return;

    // Increase failure probability
    this.config.probability = Math.min(this.config.probability * 1.5, 0.5);
    
    // Extend duration of current failures
    for (const failure of this.currentFailures.values()) {
      if (failure.type.severity !== 'critical') {
        failure.type.duration *= 2;
      }
    }
  }

  /**
   * Select failure type based on probability distribution
   */
  private selectFailureType(): FailureType {
    const totalProbability = this.config.types.reduce((sum, type) => sum + type.probability, 0);
    let random = Math.random() * totalProbability;
    
    for (const type of this.config.types) {
      random -= type.probability;
      if (random <= 0) {
        return type;
      }
    }
    
    // Fallback to first type
    return this.config.types[0];
  }

  /**
   * Calculate retry delay based on failure type
   */
  private calculateRetryAfter(failureType: FailureType): number {
    switch (failureType.severity) {
      case 'low':
        return 1 + Math.random() * 2;     // 1-3 seconds
      case 'medium':
        return 5 + Math.random() * 10;    // 5-15 seconds
      case 'high':
        return 30 + Math.random() * 30;   // 30-60 seconds
      case 'critical':
        return 120 + Math.random() * 180; // 2-5 minutes
      default:
        return 5;
    }
  }

  /**
   * Record failure for statistics
   */
  private recordFailure(failureType: FailureType): void {
    this.failureHistory.push({
      type: failureType.name,
      timestamp: Date.now(),
      duration: failureType.duration
    });

    // Keep history size manageable
    if (this.failureHistory.length > this.maxHistorySize) {
      this.failureHistory = this.failureHistory.slice(-this.maxHistorySize);
    }

    // Update failure type statistics
    this.statistics.failuresByType[failureType.name] = 
      (this.statistics.failuresByType[failureType.name] || 0) + 1;
    
    this.statistics.currentlyFailing = true;
  }

  /**
   * Update overall failure rate
   */
  private updateFailureRate(): void {
    if (this.statistics.totalRequests > 0) {
      this.statistics.failureRate = this.statistics.totalFailures / this.statistics.totalRequests;
    }
  }

  /**
   * Start monitoring for failure recovery
   */
  private startRecoveryMonitoring(): void {
    setInterval(() => {
      const now = Date.now();
      const recoveredEndpoints: string[] = [];
      
      for (const [endpoint, failure] of this.currentFailures) {
        const elapsedTime = now - failure.startTime;
        
        if (failure.type.recoverable && elapsedTime >= failure.type.duration) {
          recoveredEndpoints.push(endpoint);
          
          // Update recovery time statistics
          const totalRecoveryTime = this.failureHistory.reduce((sum, f) => sum + f.duration, 0);
          this.statistics.averageRecoveryTime = totalRecoveryTime / this.failureHistory.length;
        }
      }
      
      // Remove recovered failures
      recoveredEndpoints.forEach(endpoint => {
        this.currentFailures.delete(endpoint);
      });
      
      this.statistics.currentlyFailing = this.currentFailures.size > 0;
    }, 1000); // Check every second
  }
} 