import { EventEmitter } from 'events';
import * as winston from 'winston';
export interface TestSuiteConfig {
    name: string;
    parallel: boolean;
    timeout: number;
    retries: number;
    environment: 'development' | 'staging' | 'production';
}
export interface TestCase {
    id: string;
    name: string;
    category: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    setup?: () => Promise<void>;
    execute: () => Promise<void>;
    teardown?: () => Promise<void>;
    validate: () => Promise<boolean>;
    timeout?: number;
}
export interface TestResult {
    testCase: TestCase;
    status: 'passed' | 'failed' | 'skipped' | 'error';
    duration: number;
    error?: Error;
    logs: string[];
    metrics?: Record<string, any>;
}
export interface TestReport {
    suite: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    results: TestResult[];
    coverage: CoverageReport;
    recommendations: string[];
}
export interface CoverageReport {
    overall: number;
    byCategory: Map<string, number>;
    byPriority: Map<string, number>;
    uncoveredAreas: string[];
}
export declare class IntegrationTestSuite extends EventEmitter {
    private logger;
    private config;
    private testCases;
    private systems;
    private results;
    constructor(logger: winston.Logger, config: TestSuiteConfig);
    initialize(): Promise<void>;
    private initializeSystems;
    private registerTestCases;
    private addTestCase;
    runTests(filter?: {
        categories?: string[];
        priorities?: string[];
        ids?: string[];
    }): Promise<TestReport>;
    private runTestsSequential;
    private runTestsParallel;
    private runSingleTest;
    private withTimeout;
    private generateReport;
    private calculateCoverage;
    private generateRecommendations;
    cleanup(): Promise<void>;
}
//# sourceMappingURL=IntegrationTestSuite.d.ts.map