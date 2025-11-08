import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

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

export class CIValidator extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private validationRules: Map<string, ValidationRule>;
  private validationHistory: ValidationReport[];
  private ruleExecutionOrder: string[];
  
  constructor() {
    super();
    this.logger = createLogger('CIValidator');
    this.validationRules = new Map();
    this.validationHistory = [];
    this.ruleExecutionOrder = [];
    
    this.initializeValidationRules();
  }
  
  private initializeValidationRules(): void {
    // Code Quality Rules
    this.registerRule({
      id: 'code_coverage',
      name: 'Code Coverage Check',
      category: 'CODE_QUALITY',
      severity: 'ERROR',
      enabled: true,
      check: async (context) => ({
        ruleId: 'code_coverage',
        passed: context.codeMetrics.testCoverage >= 0.80,
        severity: 'ERROR',
        message: `Test coverage is ${(context.codeMetrics.testCoverage * 100).toFixed(1)}%`,
        details: { coverage: context.codeMetrics.testCoverage },
        fixSuggestion: 'Add unit tests to achieve at least 80% coverage'
      })
    });
    
    this.registerRule({
      id: 'complexity_check',
      name: 'Cyclomatic Complexity',
      category: 'CODE_QUALITY',
      severity: 'WARNING',
      enabled: true,
      check: async (context) => ({
        ruleId: 'complexity_check',
        passed: context.codeMetrics.cyclomaticComplexity <= 10,
        severity: 'WARNING',
        message: `Cyclomatic complexity is ${context.codeMetrics.cyclomaticComplexity}`,
        details: { complexity: context.codeMetrics.cyclomaticComplexity },
        fixSuggestion: 'Refactor complex functions to reduce cyclomatic complexity below 10'
      })
    });
    
    this.registerRule({
      id: 'code_duplication',
      name: 'Code Duplication Check',
      category: 'CODE_QUALITY',
      severity: 'WARNING',
      enabled: true,
      check: async (context) => ({
        ruleId: 'code_duplication',
        passed: context.codeMetrics.duplicateCodeRatio <= 0.05,
        severity: 'WARNING',
        message: `Code duplication is ${(context.codeMetrics.duplicateCodeRatio * 100).toFixed(1)}%`,
        details: { duplication: context.codeMetrics.duplicateCodeRatio },
        fixSuggestion: 'Extract common code into reusable functions'
      })
    });
    
    // Performance Rules
    this.registerRule({
      id: 'execution_time',
      name: 'Execution Time Check',
      category: 'PERFORMANCE',
      severity: 'ERROR',
      enabled: true,
      check: async (context) => ({
        ruleId: 'execution_time',
        passed: context.performanceMetrics.executionTime <= 100,
        severity: 'ERROR',
        message: `Average execution time is ${context.performanceMetrics.executionTime}ms`,
        details: { executionTime: context.performanceMetrics.executionTime },
        fixSuggestion: 'Optimize algorithms and use caching to reduce execution time'
      })
    });
    
    this.registerRule({
      id: 'memory_usage',
      name: 'Memory Usage Check',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      enabled: true,
      check: async (context) => ({
        ruleId: 'memory_usage',
        passed: context.performanceMetrics.memoryUsage <= 512,
        severity: 'WARNING',
        message: `Memory usage is ${context.performanceMetrics.memoryUsage}MB`,
        details: { memoryUsage: context.performanceMetrics.memoryUsage },
        fixSuggestion: 'Review data structures and implement memory-efficient algorithms'
      })
    });
    
    // Security Rules
    this.registerRule({
      id: 'no_hardcoded_secrets',
      name: 'Hardcoded Secrets Check',
      category: 'SECURITY',
      severity: 'ERROR',
      enabled: true,
      check: async (context) => {
        // Simulate security scan
        const hasSecrets = Math.random() > 0.9;
        return {
          ruleId: 'no_hardcoded_secrets',
          passed: !hasSecrets,
          severity: 'ERROR',
          message: hasSecrets ? 'Potential hardcoded secrets detected' : 'No hardcoded secrets found',
          fixSuggestion: 'Use environment variables or secure key management'
        };
      }
    });
    
    this.registerRule({
      id: 'dependency_vulnerabilities',
      name: 'Dependency Vulnerability Scan',
      category: 'SECURITY',
      severity: 'ERROR',
      enabled: true,
      check: async (context) => {
        // Simulate vulnerability scan
        const vulnerabilities = Math.floor(Math.random() * 3);
        return {
          ruleId: 'dependency_vulnerabilities',
          passed: vulnerabilities === 0,
          severity: 'ERROR',
          message: `Found ${vulnerabilities} vulnerable dependencies`,
          details: { vulnerabilities },
          fixSuggestion: 'Update vulnerable dependencies to patched versions'
        };
      }
    });
    
    // Dependency Rules
    this.registerRule({
      id: 'dependency_licenses',
      name: 'License Compatibility Check',
      category: 'DEPENDENCIES',
      severity: 'WARNING',
      enabled: true,
      check: async (context) => {
        const incompatibleLicenses = context.dependencies.filter(dep => 
          dep.includes('GPL') || dep.includes('AGPL')
        ).length;
        
        return {
          ruleId: 'dependency_licenses',
          passed: incompatibleLicenses === 0,
          severity: 'WARNING',
          message: `Found ${incompatibleLicenses} dependencies with restrictive licenses`,
          details: { incompatibleLicenses },
          fixSuggestion: 'Review and replace dependencies with restrictive licenses'
        };
      }
    });
    
    // Documentation Rules
    this.registerRule({
      id: 'api_documentation',
      name: 'API Documentation Check',
      category: 'DOCUMENTATION',
      severity: 'INFO',
      enabled: true,
      check: async (context) => {
        // Simulate doc coverage check
        const docCoverage = 0.7 + Math.random() * 0.3;
        return {
          ruleId: 'api_documentation',
          passed: docCoverage >= 0.80,
          severity: 'INFO',
          message: `API documentation coverage is ${(docCoverage * 100).toFixed(1)}%`,
          details: { docCoverage },
          fixSuggestion: 'Add JSDoc comments to all public methods'
        };
      }
    });
    
    // Set execution order
    this.ruleExecutionOrder = [
      'no_hardcoded_secrets',
      'dependency_vulnerabilities',
      'code_coverage',
      'execution_time',
      'complexity_check',
      'memory_usage',
      'code_duplication',
      'dependency_licenses',
      'api_documentation'
    ];
  }
  
  private registerRule(rule: ValidationRule): void {
    this.validationRules.set(rule.id, rule);
    this.logger.debug(`Registered validation rule: ${rule.name}`);
  }
  
  public async validateStrategy(context: ValidationContext): Promise<ValidationReport> {
    this.logger.info('Starting CI validation', {
      strategyId: context.strategyId,
      environment: context.environment
    });
    
    const results: ValidationResult[] = [];
    const startTime = Date.now();
    
    // Execute rules in order
    for (const ruleId of this.ruleExecutionOrder) {
      const rule = this.validationRules.get(ruleId);
      if (!rule || !rule.enabled) continue;
      
      try {
        this.logger.debug(`Executing rule: ${rule.name}`);
        const result = await rule.check(context);
        results.push(result);
        
        // Emit progress
        this.emit('rule-executed', {
          ruleId,
          result,
          progress: results.length / this.ruleExecutionOrder.length
        });
        
        // Stop on critical error
        if (!result.passed && result.severity === 'ERROR' && context.environment === 'PRODUCTION') {
          this.logger.error('Critical validation error, stopping validation', {
            ruleId,
            message: result.message
          });
          break;
        }
        
      } catch (error) {
        this.logger.error(`Error executing rule ${ruleId}:`, error);
        results.push({
          ruleId,
          passed: false,
          severity: 'ERROR',
          message: `Rule execution failed: ${(error as Error).message}`
        });
      }
    }
    
    const report = this.generateReport(context.strategyId, results);
    this.validationHistory.push(report);
    
    const duration = Date.now() - startTime;
    this.logger.info('CI validation completed', {
      strategyId: context.strategyId,
      status: report.overallStatus,
      duration,
      metrics: report.metrics
    });
    
    this.emit('validation-completed', report);
    
    return report;
  }
  
  private generateReport(strategyId: string, results: ValidationResult[]): ValidationReport {
    const metrics = {
      totalRules: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      warnings: results.filter(r => r.severity === 'WARNING').length,
      errors: results.filter(r => r.severity === 'ERROR' && !r.passed).length
    };
    
    let overallStatus: 'PASSED' | 'FAILED' | 'WARNING' = 'PASSED';
    if (metrics.errors > 0) {
      overallStatus = 'FAILED';
    } else if (metrics.warnings > 0) {
      overallStatus = 'WARNING';
    }
    
    const recommendations = this.generateRecommendations(results);
    
    return {
      strategyId,
      timestamp: new Date(),
      overallStatus,
      results,
      metrics,
      recommendations
    };
  }
  
  private generateRecommendations(results: ValidationResult[]): string[] {
    const recommendations: string[] = [];
    
    const failedResults = results.filter(r => !r.passed);
    
    // Group by category
    const categoryFailures = new Map<string, number>();
    for (const result of failedResults) {
      const rule = this.validationRules.get(result.ruleId);
      if (rule) {
        categoryFailures.set(rule.category, (categoryFailures.get(rule.category) || 0) + 1);
      }
    }
    
    // Generate category-specific recommendations
    if (categoryFailures.get('CODE_QUALITY')! > 2) {
      recommendations.push('Consider a comprehensive code refactoring to improve quality metrics');
    }
    
    if (categoryFailures.get('PERFORMANCE')! > 0) {
      recommendations.push('Run performance profiling to identify bottlenecks');
    }
    
    if (categoryFailures.get('SECURITY')! > 0) {
      recommendations.push('Conduct a security audit before production deployment');
    }
    
    // Add fix suggestions from failed rules
    for (const result of failedResults) {
      if (result.fixSuggestion && !recommendations.includes(result.fixSuggestion)) {
        recommendations.push(result.fixSuggestion);
      }
    }
    
    return recommendations.slice(0, 5); // Top 5 recommendations
  }
  
  public async quickValidate(context: ValidationContext): Promise<boolean> {
    // Quick validation for pre-commit hooks
    const criticalRules = ['no_hardcoded_secrets', 'code_coverage', 'execution_time'];
    
    for (const ruleId of criticalRules) {
      const rule = this.validationRules.get(ruleId);
      if (!rule || !rule.enabled) continue;
      
      const result = await rule.check(context);
      if (!result.passed && result.severity === 'ERROR') {
        return false;
      }
    }
    
    return true;
  }
  
  public enableRule(ruleId: string): void {
    const rule = this.validationRules.get(ruleId);
    if (rule) {
      rule.enabled = true;
      this.logger.info(`Enabled validation rule: ${ruleId}`);
    }
  }
  
  public disableRule(ruleId: string): void {
    const rule = this.validationRules.get(ruleId);
    if (rule) {
      rule.enabled = false;
      this.logger.info(`Disabled validation rule: ${ruleId}`);
    }
  }
  
  public addCustomRule(rule: ValidationRule): void {
    this.registerRule(rule);
    this.ruleExecutionOrder.push(rule.id);
    this.logger.info(`Added custom validation rule: ${rule.name}`);
  }
  
  public getValidationHistory(strategyId?: string, limit: number = 100): ValidationReport[] {
    let history = this.validationHistory;
    
    if (strategyId) {
      history = history.filter(report => report.strategyId === strategyId);
    }
    
    return history.slice(-limit);
  }
  
  public getRuleStatistics(): Map<string, { total: number; passed: number; failed: number }> {
    const stats = new Map();
    
    for (const report of this.validationHistory) {
      for (const result of report.results) {
        const stat = stats.get(result.ruleId) || { total: 0, passed: 0, failed: 0 };
        stat.total++;
        if (result.passed) {
          stat.passed++;
        } else {
          stat.failed++;
        }
        stats.set(result.ruleId, stat);
      }
    }
    
    return stats;
  }
  
  public generateMockContext(strategyId: string): ValidationContext {
    return {
      strategyId,
      strategyPath: `/strategies/${strategyId}`,
      strategyType: 'AI',
      codeMetrics: {
        linesOfCode: 500 + Math.floor(Math.random() * 2000),
        cyclomaticComplexity: 5 + Math.floor(Math.random() * 20),
        testCoverage: 0.6 + Math.random() * 0.4,
        duplicateCodeRatio: Math.random() * 0.1,
        maintainabilityIndex: 50 + Math.random() * 50,
        technicalDebt: Math.random() * 100
      },
      performanceMetrics: {
        executionTime: 10 + Math.random() * 200,
        memoryUsage: 100 + Math.random() * 500,
        cpuUsage: Math.random() * 100,
        latency: 1 + Math.random() * 50,
        throughput: 1000 + Math.random() * 9000
      },
      dependencies: [
        '@tensorflow/tfjs',
        'mathjs',
        'lodash',
        'axios',
        'winston'
      ],
      environment: 'DEVELOPMENT'
    };
  }
} 