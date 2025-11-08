import { EventEmitter } from 'events';
interface ValidationRule {
    id: string;
    name: string;
    category: 'CODE_QUALITY' | 'PERFORMANCE' | 'SECURITY' | 'DEPENDENCIES' | 'DOCUMENTATION';
    severity: 'ERROR' | 'WARNING' | 'INFO';
    enabled: boolean;
    check: (context: ValidationContext) => Promise<ValidationResult>;
}
interface ValidationContext {
    strategyId: string;
    strategyPath: string;
    strategyType: string;
    codeMetrics: CodeMetrics;
    performanceMetrics: PerformanceMetrics;
    dependencies: string[];
    environment: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
}
interface CodeMetrics {
    linesOfCode: number;
    cyclomaticComplexity: number;
    testCoverage: number;
    duplicateCodeRatio: number;
    maintainabilityIndex: number;
    technicalDebt: number;
}
interface PerformanceMetrics {
    executionTime: number;
    memoryUsage: number;
    cpuUsage: number;
    latency: number;
    throughput: number;
}
interface ValidationResult {
    ruleId: string;
    passed: boolean;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    message: string;
    details?: Record<string, any>;
    fixSuggestion?: string;
}
interface ValidationReport {
    strategyId: string;
    timestamp: Date;
    overallStatus: 'PASSED' | 'FAILED' | 'WARNING';
    results: ValidationResult[];
    metrics: {
        totalRules: number;
        passed: number;
        failed: number;
        warnings: number;
        errors: number;
    };
    recommendations: string[];
}
export declare class CIValidator extends EventEmitter {
    private logger;
    private validationRules;
    private validationHistory;
    private ruleExecutionOrder;
    constructor();
    private initializeValidationRules;
    private registerRule;
    validateStrategy(context: ValidationContext): Promise<ValidationReport>;
    private generateReport;
    private generateRecommendations;
    quickValidate(context: ValidationContext): Promise<boolean>;
    enableRule(ruleId: string): void;
    disableRule(ruleId: string): void;
    addCustomRule(rule: ValidationRule): void;
    getValidationHistory(strategyId?: string, limit?: number): ValidationReport[];
    getRuleStatistics(): Map<string, {
        total: number;
        passed: number;
        failed: number;
    }>;
    generateMockContext(strategyId: string): ValidationContext;
}
export {};
//# sourceMappingURL=CIValidator.d.ts.map