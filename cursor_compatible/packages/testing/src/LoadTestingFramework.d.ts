import { EventEmitter } from 'events';
import * as winston from 'winston';
export interface LoadTestConfig {
    name: string;
    duration: number;
    rampUpTime: number;
    targetRPS: number;
    scenarios: TestScenario[];
    thresholds: PerformanceThresholds;
    dataGenerator: DataGenerator;
}
export interface TestScenario {
    name: string;
    weight: number;
    steps: TestStep[];
    thinkTime: number;
}
export interface TestStep {
    action: 'placeOrder' | 'cancelOrder' | 'getPositions' | 'getMarketData' | 'custom';
    params: Record<string, any>;
    validation?: (response: any) => boolean;
}
export interface PerformanceThresholds {
    maxLatencyP95: number;
    maxLatencyP99: number;
    minThroughput: number;
    maxErrorRate: number;
    maxCpuUsage: number;
    maxMemoryUsage: number;
}
export interface DataGenerator {
    generateOrder(): any;
    generateSymbol(): string;
    generatePrice(symbol: string): number;
    generateQuantity(): number;
}
export interface LoadTestResult {
    config: LoadTestConfig;
    startTime: Date;
    endTime: Date;
    duration: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    metrics: PerformanceMetrics;
    violations: ThresholdViolation[];
    summary: TestSummary;
}
export interface PerformanceMetrics {
    throughput: ThroughputMetrics;
    latency: LatencyMetrics;
    errors: ErrorMetrics;
    resources: ResourceMetrics;
    custom: Map<string, number>;
}
export interface ThroughputMetrics {
    avgRPS: number;
    peakRPS: number;
    totalRequests: number;
    requestsPerScenario: Map<string, number>;
}
export interface LatencyMetrics {
    min: number;
    max: number;
    mean: number;
    median: number;
    p90: number;
    p95: number;
    p99: number;
    histogram: number[];
}
export interface ErrorMetrics {
    totalErrors: number;
    errorRate: number;
    errorsByType: Map<string, number>;
    errorsByScenario: Map<string, number>;
}
export interface ResourceMetrics {
    avgCpuUsage: number;
    peakCpuUsage: number;
    avgMemoryUsage: number;
    peakMemoryUsage: number;
    networkIO: {
        bytesIn: number;
        bytesOut: number;
    };
}
export interface ThresholdViolation {
    metric: string;
    threshold: number;
    actual: number;
    timestamp: Date;
    severity: 'warning' | 'critical';
}
export interface TestSummary {
    passed: boolean;
    score: number;
    recommendations: string[];
    bottlenecks: string[];
}
export declare class LoadTestingFramework extends EventEmitter {
    private logger;
    private config;
    private virtualUsers;
    private metrics;
    private isRunning;
    private startTime;
    private stopRequested;
    constructor(logger: winston.Logger);
    runTest(config: LoadTestConfig, target: any): Promise<LoadTestResult>;
    stop(): void;
    private rampUp;
    private runTestDuration;
    private rampDown;
    private startResourceMonitoring;
    private stopResourceMonitoring;
    private checkThresholds;
    private generateResult;
    private generateSummary;
    private calculateScore;
}
//# sourceMappingURL=LoadTestingFramework.d.ts.map