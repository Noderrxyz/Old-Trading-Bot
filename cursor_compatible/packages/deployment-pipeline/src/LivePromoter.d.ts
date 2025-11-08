import { EventEmitter } from 'events';
interface ProductionEnvironment {
    name: 'BLUE' | 'GREEN';
    status: 'ACTIVE' | 'STANDBY' | 'DEPLOYING' | 'DRAINING';
    version: string;
    deploymentTime?: Date;
    instances: Instance[];
    loadBalancerWeight: number;
    healthStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
}
interface Instance {
    id: string;
    host: string;
    port: number;
    status: 'RUNNING' | 'STARTING' | 'STOPPING' | 'STOPPED';
    healthCheck: {
        endpoint: string;
        lastCheck?: Date;
        consecutiveSuccesses: number;
        consecutiveFailures: number;
        isHealthy: boolean;
    };
    metrics: {
        cpu: number;
        memory: number;
        connections: number;
        requestsPerSecond: number;
    };
}
interface PromotionRequest {
    strategyId: string;
    version: string;
    sourceEnvironment: 'CANARY' | 'STAGING';
    validationReport: ValidationReport;
    approvals: Array<{
        approver: string;
        timestamp: Date;
        comments?: string;
    }>;
}
interface ValidationReport {
    performanceBaseline: {
        latencyP50: number;
        latencyP99: number;
        errorRate: number;
        throughput: number;
    };
    resourceRequirements: {
        cpu: number;
        memory: number;
        storage: number;
    };
    dependencies: Array<{
        name: string;
        version: string;
        verified: boolean;
    }>;
    securityScan: {
        passed: boolean;
        vulnerabilities: number;
        lastScan: Date;
    };
}
export declare class LivePromoter extends EventEmitter {
    private logger;
    private environments;
    private activeEnvironment;
    private promotionHistory;
    private loadBalancerConfig;
    private healthCheckInterval;
    constructor();
    private initializeEnvironments;
    private createInstances;
    promoteToProduction(request: PromotionRequest): Promise<string>;
    private validatePromotionRequest;
    private prepareEnvironment;
    private deployToEnvironment;
    private waitForHealthyInstances;
    private verifyDeployment;
    private runSmokeTests;
    private checkPerformance;
    private executeBlueGreenSwitch;
    private updateLoadBalancer;
    private monitorTransition;
    private drainConnections;
    private startHealthMonitoring;
    private performHealthChecks;
    private recordPromotion;
    getEnvironmentStatus(): Map<string, ProductionEnvironment>;
    getActiveEnvironment(): ProductionEnvironment;
    getPromotionHistory(limit?: number): PromotionRecord[];
    rollbackProduction(targetVersion: string): Promise<void>;
    stopHealthMonitoring(): void;
}
interface PromotionRecord {
    id: string;
    timestamp: Date;
    strategyId: string;
    version: string;
    sourceEnvironment: string;
    targetEnvironment: string;
    status: 'COMPLETED' | 'FAILED';
    duration: number;
}
export {};
//# sourceMappingURL=LivePromoter.d.ts.map