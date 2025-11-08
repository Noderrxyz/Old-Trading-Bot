import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface CanaryDeployment {
  id: string;
  strategyId: string;
  version: string;
  startTime: Date;
  endTime?: Date;
  status: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
  trafficAllocation: number; // Percentage 0-100
  metrics: CanaryMetrics;
  healthChecks: HealthCheck[];
  featureFlags: Record<string, boolean>;
  configHash: string;
}

interface CanaryMetrics {
  errorRate: number;
  latency: number;
  throughput: number;
  successRate: number;
  pnl?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  resourceUsage: {
    cpu: number;
    memory: number;
    networkIO: number;
  };
}

interface HealthCheck {
  name: string;
  endpoint: string;
  interval: number;
  timeout: number;
  lastCheck?: Date;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  consecutiveFailures: number;
}

interface TrafficRule {
  type: 'PERCENTAGE' | 'USER_SEGMENT' | 'GEOGRAPHIC' | 'RISK_BASED';
  value: any;
  condition?: string;
}

interface RollbackTrigger {
  metric: string;
  threshold: number;
  operator: '<' | '>' | '=' | '<=' | '>=';
  duration: number; // How long the condition must persist
  severity: 'WARNING' | 'CRITICAL';
}

export class CanaryLauncher extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private canaryDeployments: Map<string, CanaryDeployment>;
  private rollbackTriggers: RollbackTrigger[];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private trafficController: Map<string, TrafficRule[]>;
  private abTestResults: Map<string, ABTestResult>;
  
  constructor() {
    super();
    this.logger = createLogger('CanaryLauncher');
    this.canaryDeployments = new Map();
    this.trafficController = new Map();
    this.abTestResults = new Map();
    
    this.initializeDefaultTriggers();
  }
  
  private initializeDefaultTriggers(): void {
    this.rollbackTriggers = [
      {
        metric: 'errorRate',
        threshold: 0.05, // 5% error rate
        operator: '>',
        duration: 300000, // 5 minutes
        severity: 'CRITICAL'
      },
      {
        metric: 'latency',
        threshold: 1000, // 1 second
        operator: '>',
        duration: 180000, // 3 minutes
        severity: 'CRITICAL'
      },
      {
        metric: 'successRate',
        threshold: 0.95, // 95% success rate
        operator: '<',
        duration: 300000, // 5 minutes
        severity: 'CRITICAL'
      },
      {
        metric: 'pnl',
        threshold: -0.02, // -2% PnL
        operator: '<',
        duration: 600000, // 10 minutes
        severity: 'WARNING'
      },
      {
        metric: 'maxDrawdown',
        threshold: 0.05, // 5% drawdown
        operator: '>',
        duration: 300000, // 5 minutes
        severity: 'CRITICAL'
      }
    ];
  }
  
  public async launchCanary(params: {
    strategyId: string;
    version: string;
    initialTraffic: number;
    targetTraffic: number;
    rampDuration: number;
    healthChecks: HealthCheck[];
    featureFlags?: Record<string, boolean>;
    customTriggers?: RollbackTrigger[];
  }): Promise<string> {
    const canaryId = `canary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const deployment: CanaryDeployment = {
      id: canaryId,
      strategyId: params.strategyId,
      version: params.version,
      startTime: new Date(),
      status: 'ACTIVE',
      trafficAllocation: params.initialTraffic,
      metrics: this.initializeMetrics(),
      healthChecks: params.healthChecks,
      featureFlags: params.featureFlags || {},
      configHash: this.generateConfigHash(params)
    };
    
    this.canaryDeployments.set(canaryId, deployment);
    
    // Set up traffic rules
    this.setupTrafficRules(canaryId, params.initialTraffic);
    
    // Add custom triggers if provided
    if (params.customTriggers) {
      this.rollbackTriggers.push(...params.customTriggers);
    }
    
    // Start monitoring
    if (!this.monitoringInterval) {
      this.startMonitoring();
    }
    
    // Schedule traffic ramp-up
    this.scheduleTrafficRamp(canaryId, params.targetTraffic, params.rampDuration);
    
    this.logger.info('Canary deployment launched', {
      canaryId,
      strategyId: params.strategyId,
      version: params.version,
      initialTraffic: params.initialTraffic
    });
    
    this.emit('canary-launched', deployment);
    
    return canaryId;
  }
  
  private initializeMetrics(): CanaryMetrics {
    return {
      errorRate: 0,
      latency: 0,
      throughput: 0,
      successRate: 1,
      resourceUsage: {
        cpu: 0,
        memory: 0,
        networkIO: 0
      }
    };
  }
  
  private generateConfigHash(params: any): string {
    // Simple hash generation - in production use crypto
    return Buffer.from(JSON.stringify(params)).toString('base64').substr(0, 16);
  }
  
  private setupTrafficRules(canaryId: string, initialPercentage: number): void {
    const rules: TrafficRule[] = [
      {
        type: 'PERCENTAGE',
        value: initialPercentage
      },
      {
        type: 'RISK_BASED',
        value: 'LOW_RISK_ONLY',
        condition: 'user.riskProfile === "conservative"'
      }
    ];
    
    this.trafficController.set(canaryId, rules);
  }
  
  private scheduleTrafficRamp(canaryId: string, targetTraffic: number, duration: number): void {
    const deployment = this.canaryDeployments.get(canaryId);
    if (!deployment) return;
    
    const steps = 5; // Ramp in 5 steps
    const stepDuration = duration / steps;
    const trafficIncrement = (targetTraffic - deployment.trafficAllocation) / steps;
    
    let currentStep = 0;
    
    const rampInterval = setInterval(() => {
      currentStep++;
      
      if (currentStep > steps || deployment.status !== 'ACTIVE') {
        clearInterval(rampInterval);
        return;
      }
      
      deployment.trafficAllocation = Math.min(
        targetTraffic,
        deployment.trafficAllocation + trafficIncrement
      );
      
      this.logger.info('Traffic ramped up', {
        canaryId,
        newAllocation: deployment.trafficAllocation,
        step: currentStep
      });
      
      this.emit('traffic-adjusted', {
        canaryId,
        allocation: deployment.trafficAllocation
      });
      
      // Update traffic rules
      this.updateTrafficAllocation(canaryId, deployment.trafficAllocation);
      
    }, stepDuration);
  }
  
  private updateTrafficAllocation(canaryId: string, percentage: number): void {
    const rules = this.trafficController.get(canaryId);
    if (!rules) return;
    
    const percentageRule = rules.find(r => r.type === 'PERCENTAGE');
    if (percentageRule) {
      percentageRule.value = percentage;
    }
  }
  
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.monitorCanaries();
    }, 10000); // Check every 10 seconds
    
    this.logger.info('Canary monitoring started');
  }
  
  private async monitorCanaries(): Promise<void> {
    for (const [canaryId, deployment] of this.canaryDeployments) {
      if (deployment.status !== 'ACTIVE') continue;
      
      // Update metrics
      await this.updateMetrics(deployment);
      
      // Run health checks
      await this.runHealthChecks(deployment);
      
      // Check rollback triggers
      const shouldRollback = this.checkRollbackTriggers(deployment);
      
      if (shouldRollback) {
        await this.rollbackCanary(canaryId, 'Automated rollback due to metric threshold breach');
      }
      
      // Collect A/B test data
      this.collectABTestData(deployment);
    }
  }
  
  private async updateMetrics(deployment: CanaryDeployment): Promise<void> {
    // In production, these would come from real monitoring systems
    deployment.metrics = {
      errorRate: Math.random() * 0.1,
      latency: 50 + Math.random() * 200,
      throughput: 1000 + Math.random() * 9000,
      successRate: 0.9 + Math.random() * 0.1,
      pnl: -0.05 + Math.random() * 0.1,
      sharpeRatio: 0.5 + Math.random() * 2.5,
      maxDrawdown: Math.random() * 0.1,
      resourceUsage: {
        cpu: Math.random() * 100,
        memory: Math.random() * 100,
        networkIO: Math.random() * 1000
      }
    };
    
    this.emit('metrics-updated', {
      canaryId: deployment.id,
      metrics: deployment.metrics
    });
  }
  
  private async runHealthChecks(deployment: CanaryDeployment): Promise<void> {
    for (const check of deployment.healthChecks) {
      try {
        // Simulate health check
        const isHealthy = Math.random() > 0.05; // 95% healthy
        
        check.lastCheck = new Date();
        
        if (isHealthy) {
          check.status = 'HEALTHY';
          check.consecutiveFailures = 0;
        } else {
          check.consecutiveFailures++;
          check.status = check.consecutiveFailures > 3 ? 'UNHEALTHY' : 'DEGRADED';
        }
        
        if (check.status === 'UNHEALTHY') {
          this.logger.warn('Health check failed', {
            canaryId: deployment.id,
            checkName: check.name,
            failures: check.consecutiveFailures
          });
        }
        
      } catch (error) {
        this.logger.error('Health check error', {
          canaryId: deployment.id,
          checkName: check.name,
          error
        });
        check.status = 'UNHEALTHY';
        check.consecutiveFailures++;
      }
    }
    
    const unhealthyChecks = deployment.healthChecks.filter(c => c.status === 'UNHEALTHY');
    if (unhealthyChecks.length > 0) {
      this.emit('health-check-failed', {
        canaryId: deployment.id,
        failedChecks: unhealthyChecks
      });
    }
  }
  
  private checkRollbackTriggers(deployment: CanaryDeployment): boolean {
    const triggeredCritical: string[] = [];
    
    for (const trigger of this.rollbackTriggers) {
      const metricValue = this.getMetricValue(deployment.metrics, trigger.metric);
      if (metricValue === undefined) continue;
      
      const triggered = this.evaluateTrigger(metricValue, trigger);
      
      if (triggered && trigger.severity === 'CRITICAL') {
        triggeredCritical.push(`${trigger.metric} ${trigger.operator} ${trigger.threshold}`);
      }
    }
    
    if (triggeredCritical.length > 0) {
      this.logger.error('Critical rollback triggers activated', {
        canaryId: deployment.id,
        triggers: triggeredCritical
      });
      return true;
    }
    
    return false;
  }
  
  private getMetricValue(metrics: CanaryMetrics, metricName: string): number | undefined {
    const metricMap: Record<string, number> = {
      errorRate: metrics.errorRate,
      latency: metrics.latency,
      throughput: metrics.throughput,
      successRate: metrics.successRate,
      pnl: metrics.pnl || 0,
      sharpeRatio: metrics.sharpeRatio || 0,
      maxDrawdown: metrics.maxDrawdown || 0,
      cpu: metrics.resourceUsage.cpu,
      memory: metrics.resourceUsage.memory
    };
    
    return metricMap[metricName];
  }
  
  private evaluateTrigger(value: number, trigger: RollbackTrigger): boolean {
    switch (trigger.operator) {
      case '<': return value < trigger.threshold;
      case '>': return value > trigger.threshold;
      case '=': return value === trigger.threshold;
      case '<=': return value <= trigger.threshold;
      case '>=': return value >= trigger.threshold;
      default: return false;
    }
  }
  
  private collectABTestData(deployment: CanaryDeployment): void {
    const testId = `${deployment.strategyId}_${deployment.version}`;
    
    let testResult = this.abTestResults.get(testId);
    if (!testResult) {
      testResult = {
        testId,
        strategyId: deployment.strategyId,
        variants: {
          control: { samples: 0, metrics: {} },
          canary: { samples: 0, metrics: {} }
        },
        startTime: deployment.startTime,
        statisticalSignificance: 0
      };
      this.abTestResults.set(testId, testResult);
    }
    
    // Update canary variant metrics
    testResult.variants.canary.samples++;
    testResult.variants.canary.metrics = {
      ...deployment.metrics,
      timestamp: new Date()
    };
    
    // Calculate statistical significance
    testResult.statisticalSignificance = this.calculateSignificance(testResult);
  }
  
  private calculateSignificance(testResult: ABTestResult): number {
    // Simplified significance calculation
    const samples = testResult.variants.canary.samples;
    return Math.min(samples / 1000, 0.99); // Reaches 99% at 1000 samples
  }
  
  public async rollbackCanary(canaryId: string, reason: string): Promise<void> {
    const deployment = this.canaryDeployments.get(canaryId);
    if (!deployment || deployment.status !== 'ACTIVE') return;
    
    this.logger.warn('Rolling back canary deployment', {
      canaryId,
      reason,
      metrics: deployment.metrics
    });
    
    deployment.status = 'ROLLED_BACK';
    deployment.endTime = new Date();
    deployment.trafficAllocation = 0;
    
    // Update traffic rules to divert all traffic away
    this.updateTrafficAllocation(canaryId, 0);
    
    this.emit('canary-rolled-back', {
      deployment,
      reason
    });
  }
  
  public async promoteCanary(canaryId: string): Promise<void> {
    const deployment = this.canaryDeployments.get(canaryId);
    if (!deployment || deployment.status !== 'ACTIVE') return;
    
    deployment.status = 'COMPLETED';
    deployment.endTime = new Date();
    deployment.trafficAllocation = 100;
    
    this.logger.info('Canary promoted to production', {
      canaryId,
      duration: deployment.endTime.getTime() - deployment.startTime.getTime(),
      finalMetrics: deployment.metrics
    });
    
    this.emit('canary-promoted', deployment);
  }
  
  public getCanaryStatus(canaryId: string): CanaryDeployment | undefined {
    return this.canaryDeployments.get(canaryId);
  }
  
  public getActiveCanaries(): CanaryDeployment[] {
    return Array.from(this.canaryDeployments.values())
      .filter(d => d.status === 'ACTIVE');
  }
  
  public getABTestResults(strategyId?: string): ABTestResult[] {
    let results = Array.from(this.abTestResults.values());
    
    if (strategyId) {
      results = results.filter(r => r.strategyId === strategyId);
    }
    
    return results;
  }
  
  public updateFeatureFlag(canaryId: string, flag: string, value: boolean): void {
    const deployment = this.canaryDeployments.get(canaryId);
    if (deployment) {
      deployment.featureFlags[flag] = value;
      this.emit('feature-flag-updated', {
        canaryId,
        flag,
        value
      });
    }
  }
  
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.logger.info('Canary monitoring stopped');
    }
  }
}

interface ABTestResult {
  testId: string;
  strategyId: string;
  variants: {
    control: {
      samples: number;
      metrics: Record<string, any>;
    };
    canary: {
      samples: number;
      metrics: Record<string, any>;
    };
  };
  startTime: Date;
  statisticalSignificance: number;
} 