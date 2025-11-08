import { EventEmitter } from 'events';
interface CanaryDeployment {
    id: string;
    strategyId: string;
    version: string;
    startTime: Date;
    endTime?: Date;
    status: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
    trafficAllocation: number;
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
interface RollbackTrigger {
    metric: string;
    threshold: number;
    operator: '<' | '>' | '=' | '<=' | '>=';
    duration: number;
    severity: 'WARNING' | 'CRITICAL';
}
export declare class CanaryLauncher extends EventEmitter {
    private logger;
    private canaryDeployments;
    private rollbackTriggers;
    private monitoringInterval;
    private trafficController;
    private abTestResults;
    constructor();
    private initializeDefaultTriggers;
    launchCanary(params: {
        strategyId: string;
        version: string;
        initialTraffic: number;
        targetTraffic: number;
        rampDuration: number;
        healthChecks: HealthCheck[];
        featureFlags?: Record<string, boolean>;
        customTriggers?: RollbackTrigger[];
    }): Promise<string>;
    private initializeMetrics;
    private generateConfigHash;
    private setupTrafficRules;
    private scheduleTrafficRamp;
    private updateTrafficAllocation;
    private startMonitoring;
    private monitorCanaries;
    private updateMetrics;
    private runHealthChecks;
    private checkRollbackTriggers;
    private getMetricValue;
    private evaluateTrigger;
    private collectABTestData;
    private calculateSignificance;
    rollbackCanary(canaryId: string, reason: string): Promise<void>;
    promoteCanary(canaryId: string): Promise<void>;
    getCanaryStatus(canaryId: string): CanaryDeployment | undefined;
    getActiveCanaries(): CanaryDeployment[];
    getABTestResults(strategyId?: string): ABTestResult[];
    updateFeatureFlag(canaryId: string, flag: string, value: boolean): void;
    stopMonitoring(): void;
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
export {};
//# sourceMappingURL=CanaryLauncher.d.ts.map