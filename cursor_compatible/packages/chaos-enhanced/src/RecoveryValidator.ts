import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Recovery validation configuration
 */
export interface RecoveryValidationConfig {
  // Maximum recovery time allowed (milliseconds)
  maxRecoveryTime: number;
  // Health check interval (milliseconds)
  healthCheckInterval: number;
  // Minimum success rate for recovery
  minSuccessRate: number;
  // Number of consecutive successful checks required
  consecutiveSuccessRequired: number;
  // Enable detailed metrics
  detailedMetrics: boolean;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  latency: number;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Recovery metrics
 */
export interface RecoveryMetrics {
  startTime: Date;
  endTime?: Date;
  recoveryTimeMs?: number;
  healthChecks: HealthCheckResult[];
  successRate: number;
  failedServices: string[];
  recovered: boolean;
  phases: RecoveryPhase[];
}

/**
 * Recovery phase
 */
export interface RecoveryPhase {
  name: string;
  startTime: Date;
  endTime?: Date;
  status: 'in_progress' | 'completed' | 'failed';
  metrics?: Record<string, any>;
}

/**
 * Service health checker
 */
export interface ServiceHealthChecker {
  name: string;
  checkHealth(): Promise<HealthCheckResult>;
}

/**
 * Recovery validator for chaos testing
 */
export class RecoveryValidator extends EventEmitter {
  private config: RecoveryValidationConfig;
  private logger: winston.Logger;
  private healthCheckers: Map<string, ServiceHealthChecker> = new Map();
  private currentRecovery: RecoveryMetrics | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private consecutiveSuccesses: Map<string, number> = new Map();
  
  constructor(config: RecoveryValidationConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
  }
  
  /**
   * Register a health checker
   */
  registerHealthChecker(checker: ServiceHealthChecker): void {
    this.healthCheckers.set(checker.name, checker);
    this.consecutiveSuccesses.set(checker.name, 0);
    
    this.logger.info('Health checker registered', { service: checker.name });
  }
  
  /**
   * Start recovery validation
   */
  async startValidation(chaosEvent: string): Promise<RecoveryMetrics> {
    if (this.currentRecovery) {
      throw new Error('Recovery validation already in progress');
    }
    
    this.currentRecovery = {
      startTime: new Date(),
      healthChecks: [],
      successRate: 0,
      failedServices: [],
      recovered: false,
      phases: []
    };
    
    // Reset consecutive successes
    for (const service of this.healthCheckers.keys()) {
      this.consecutiveSuccesses.set(service, 0);
    }
    
    this.logger.info('Recovery validation started', { chaosEvent });
    this.emit('validationStarted', { chaosEvent });
    
    // Start detection phase
    this.startPhase('detection');
    
    // Perform initial health check
    await this.performHealthCheck();
    
    // Start stabilization phase
    this.completePhase('detection');
    this.startPhase('stabilization');
    
    // Start periodic health checks
    this.checkInterval = setInterval(async () => {
      await this.performHealthCheck();
      
      // Check if recovery is complete
      if (this.isRecoveryComplete()) {
        this.completeRecovery();
      }
      
      // Check if recovery timeout exceeded
      if (this.isRecoveryTimeout()) {
        this.failRecovery('Recovery timeout exceeded');
      }
    }, this.config.healthCheckInterval);
    
    // Return promise that resolves when recovery completes
    return new Promise((resolve) => {
      this.once('recoveryComplete', () => {
        resolve(this.currentRecovery!);
      });
      
      this.once('recoveryFailed', () => {
        resolve(this.currentRecovery!);
      });
    });
  }
  
  /**
   * Perform health check on all services
   */
  private async performHealthCheck(): Promise<void> {
    const checks = await Promise.all(
      Array.from(this.healthCheckers.values()).map(async (checker) => {
        const startTime = Date.now();
        
        try {
          const result = await checker.checkHealth();
          result.latency = Date.now() - startTime;
          
          // Update consecutive successes
          if (result.healthy) {
            const current = this.consecutiveSuccesses.get(checker.name) || 0;
            this.consecutiveSuccesses.set(checker.name, current + 1);
          } else {
            this.consecutiveSuccesses.set(checker.name, 0);
          }
          
          return result;
        } catch (error) {
          // Health check failed
          this.consecutiveSuccesses.set(checker.name, 0);
          
          return {
            service: checker.name,
            healthy: false,
            latency: Date.now() - startTime,
            error: (error as Error).message
          };
        }
      })
    );
    
    // Store results
    if (this.currentRecovery) {
      this.currentRecovery.healthChecks.push(...checks);
      
      // Calculate success rate
      const successCount = checks.filter(c => c.healthy).length;
      this.currentRecovery.successRate = successCount / checks.length;
      
      // Update failed services
      this.currentRecovery.failedServices = checks
        .filter(c => !c.healthy)
        .map(c => c.service);
      
      // Emit health check event
      this.emit('healthCheck', {
        checks,
        successRate: this.currentRecovery.successRate,
        failedServices: this.currentRecovery.failedServices
      });
      
      if (this.config.detailedMetrics) {
        this.logger.debug('Health check performed', {
          successRate: this.currentRecovery.successRate,
          failedServices: this.currentRecovery.failedServices
        });
      }
    }
  }
  
  /**
   * Check if recovery is complete
   */
  private isRecoveryComplete(): boolean {
    if (!this.currentRecovery) return false;
    
    // Check if success rate meets threshold
    if (this.currentRecovery.successRate < this.config.minSuccessRate) {
      return false;
    }
    
    // Check if all services have consecutive successes
    for (const [service, count] of this.consecutiveSuccesses) {
      if (count < this.config.consecutiveSuccessRequired) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Check if recovery timeout exceeded
   */
  private isRecoveryTimeout(): boolean {
    if (!this.currentRecovery) return false;
    
    const elapsed = Date.now() - this.currentRecovery.startTime.getTime();
    return elapsed > this.config.maxRecoveryTime;
  }
  
  /**
   * Complete recovery successfully
   */
  private completeRecovery(): void {
    if (!this.currentRecovery) return;
    
    // Stop health checks
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    // Complete stabilization phase
    this.completePhase('stabilization');
    
    // Start verification phase
    this.startPhase('verification');
    
    // Perform final verification
    this.performFinalVerification().then(() => {
      if (!this.currentRecovery) return;
      
      this.completePhase('verification');
      
      // Update recovery metrics
      this.currentRecovery.endTime = new Date();
      this.currentRecovery.recoveryTimeMs = 
        this.currentRecovery.endTime.getTime() - this.currentRecovery.startTime.getTime();
      this.currentRecovery.recovered = true;
      
      this.logger.info('Recovery completed successfully', {
        recoveryTimeMs: this.currentRecovery.recoveryTimeMs,
        finalSuccessRate: this.currentRecovery.successRate
      });
      
      this.emit('recoveryComplete', this.currentRecovery);
      
      // Clean up
      const metrics = this.currentRecovery;
      this.currentRecovery = null;
      
      // Generate report
      this.generateRecoveryReport(metrics);
    });
  }
  
  /**
   * Fail recovery
   */
  private failRecovery(reason: string): void {
    if (!this.currentRecovery) return;
    
    // Stop health checks
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    // Update recovery metrics
    this.currentRecovery.endTime = new Date();
    this.currentRecovery.recoveryTimeMs = 
      this.currentRecovery.endTime.getTime() - this.currentRecovery.startTime.getTime();
    this.currentRecovery.recovered = false;
    
    // Mark current phase as failed
    const currentPhase = this.currentRecovery.phases.find(p => p.status === 'in_progress');
    if (currentPhase) {
      currentPhase.status = 'failed';
      currentPhase.endTime = new Date();
    }
    
    this.logger.error('Recovery failed', {
      reason,
      recoveryTimeMs: this.currentRecovery.recoveryTimeMs,
      failedServices: this.currentRecovery.failedServices
    });
    
    this.emit('recoveryFailed', {
      reason,
      metrics: this.currentRecovery
    });
    
    // Clean up
    const metrics = this.currentRecovery;
    this.currentRecovery = null;
    
    // Generate report
    this.generateRecoveryReport(metrics);
  }
  
  /**
   * Perform final verification
   */
  private async performFinalVerification(): Promise<void> {
    // Perform multiple health checks to ensure stability
    const verificationChecks = 3;
    
    for (let i = 0; i < verificationChecks; i++) {
      await this.performHealthCheck();
      
      if (this.currentRecovery && this.currentRecovery.successRate < this.config.minSuccessRate) {
        throw new Error('Final verification failed');
      }
      
      // Wait between checks
      if (i < verificationChecks - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  /**
   * Start a recovery phase
   */
  private startPhase(name: string): void {
    if (!this.currentRecovery) return;
    
    const phase: RecoveryPhase = {
      name,
      startTime: new Date(),
      status: 'in_progress'
    };
    
    this.currentRecovery.phases.push(phase);
    this.emit('phaseStarted', phase);
  }
  
  /**
   * Complete a recovery phase
   */
  private completePhase(name: string): void {
    if (!this.currentRecovery) return;
    
    const phase = this.currentRecovery.phases.find(p => p.name === name && p.status === 'in_progress');
    if (phase) {
      phase.status = 'completed';
      phase.endTime = new Date();
      this.emit('phaseCompleted', phase);
    }
  }
  
  /**
   * Generate recovery report
   */
  private generateRecoveryReport(metrics: RecoveryMetrics): void {
    const report: RecoveryReport = {
      summary: {
        recovered: metrics.recovered,
        recoveryTimeMs: metrics.recoveryTimeMs || 0,
        finalSuccessRate: metrics.successRate,
        totalHealthChecks: metrics.healthChecks.length,
        failedServices: metrics.failedServices
      },
      phases: metrics.phases.map(phase => ({
        name: phase.name,
        durationMs: phase.endTime ? 
          phase.endTime.getTime() - phase.startTime.getTime() : 0,
        status: phase.status
      })),
      serviceMetrics: this.calculateServiceMetrics(metrics),
      recommendations: this.generateRecommendations(metrics)
    };
    
    this.emit('recoveryReport', report);
    
    this.logger.info('Recovery report generated', report.summary);
  }
  
  /**
   * Calculate per-service metrics
   */
  private calculateServiceMetrics(metrics: RecoveryMetrics): ServiceRecoveryMetrics[] {
    const serviceData = new Map<string, {
      checks: number;
      failures: number;
      totalLatency: number;
      firstHealthyTime?: Date;
    }>();
    
    // Aggregate data by service
    for (const check of metrics.healthChecks) {
      let data = serviceData.get(check.service);
      if (!data) {
        data = { checks: 0, failures: 0, totalLatency: 0 };
        serviceData.set(check.service, data);
      }
      
      data.checks++;
      data.totalLatency += check.latency;
      
      if (!check.healthy) {
        data.failures++;
      } else if (!data.firstHealthyTime) {
        data.firstHealthyTime = new Date();
      }
    }
    
    // Calculate metrics
    const serviceMetrics: ServiceRecoveryMetrics[] = [];
    
    for (const [service, data] of serviceData) {
      serviceMetrics.push({
        service,
        successRate: (data.checks - data.failures) / data.checks,
        avgLatency: data.totalLatency / data.checks,
        recoveryTime: data.firstHealthyTime ? 
          data.firstHealthyTime.getTime() - metrics.startTime.getTime() : undefined,
        totalChecks: data.checks,
        failures: data.failures
      });
    }
    
    return serviceMetrics;
  }
  
  /**
   * Generate recommendations based on recovery
   */
  private generateRecommendations(metrics: RecoveryMetrics): string[] {
    const recommendations: string[] = [];
    
    // Check recovery time
    if (metrics.recoveryTimeMs && metrics.recoveryTimeMs > this.config.maxRecoveryTime * 0.8) {
      recommendations.push('Recovery time approaching limit - consider optimizing startup procedures');
    }
    
    // Check service-specific issues
    const serviceMetrics = this.calculateServiceMetrics(metrics);
    for (const service of serviceMetrics) {
      if (service.successRate < 0.9) {
        recommendations.push(`${service.service} has low success rate (${(service.successRate * 100).toFixed(1)}%) - investigate reliability issues`);
      }
      
      if (service.avgLatency > 1000) {
        recommendations.push(`${service.service} has high latency (${service.avgLatency.toFixed(0)}ms) - consider performance optimization`);
      }
    }
    
    // Check for patterns
    const failurePattern = this.detectFailurePattern(metrics);
    if (failurePattern) {
      recommendations.push(`Detected ${failurePattern} failure pattern - review dependencies and startup order`);
    }
    
    return recommendations;
  }
  
  /**
   * Detect failure patterns
   */
  private detectFailurePattern(metrics: RecoveryMetrics): string | null {
    // Simple pattern detection
    const serviceFailures = new Map<string, number[]>();
    
    metrics.healthChecks.forEach((check, index) => {
      if (!check.healthy) {
        const failures = serviceFailures.get(check.service) || [];
        failures.push(index);
        serviceFailures.set(check.service, failures);
      }
    });
    
    // Check for cascading failures
    let cascading = false;
    const failureTimes: number[] = [];
    
    for (const failures of serviceFailures.values()) {
      failureTimes.push(...failures);
    }
    
    failureTimes.sort((a, b) => a - b);
    
    // If failures are clustered, might be cascading
    if (failureTimes.length > 3) {
      const gaps = [];
      for (let i = 1; i < failureTimes.length; i++) {
        gaps.push(failureTimes[i] - failureTimes[i - 1]);
      }
      
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avgGap < 2) {
        cascading = true;
      }
    }
    
    if (cascading) {
      return 'cascading';
    }
    
    // Check for intermittent failures
    for (const failures of serviceFailures.values()) {
      if (failures.length > metrics.healthChecks.length * 0.3) {
        return 'intermittent';
      }
    }
    
    return null;
  }
  
  /**
   * Stop validation
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    if (this.currentRecovery) {
      this.failRecovery('Validation stopped');
    }
  }
}

/**
 * Recovery report
 */
export interface RecoveryReport {
  summary: {
    recovered: boolean;
    recoveryTimeMs: number;
    finalSuccessRate: number;
    totalHealthChecks: number;
    failedServices: string[];
  };
  phases: Array<{
    name: string;
    durationMs: number;
    status: string;
  }>;
  serviceMetrics: ServiceRecoveryMetrics[];
  recommendations: string[];
}

/**
 * Service recovery metrics
 */
export interface ServiceRecoveryMetrics {
  service: string;
  successRate: number;
  avgLatency: number;
  recoveryTime?: number;
  totalChecks: number;
  failures: number;
} 