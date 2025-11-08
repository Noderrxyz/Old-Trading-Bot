/**
 * ReadinessValidator - Comprehensive production readiness validation
 * 
 * Performs full system validation to ensure all components are
 * properly configured and ready for production deployment.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';
import { StartupCheck } from './checks/startup-check';
import { MessageBusCheck } from './checks/message-bus-check';
import { SimulationLoop } from './checks/simulation-loop';
import { LogTest } from './checks/log-test';
import { DashboardCheck } from './checks/dashboard-check';
import {
  CheckType,
  ValidationResult,
  ValidationDetail,
  ModuleStatus,
  CheckOptions
} from './types';

const exec = promisify(child_process.exec);

interface ReadinessConfig {
  environment: 'development' | 'staging' | 'production';
  modules: string[];
  checks: {
    startup: boolean;
    messageBus: boolean;
    simulation: boolean;
    logging: boolean;
    dashboard: boolean;
    performance: boolean;
    security: boolean;
    connectivity: boolean;
  };
  thresholds: {
    startupTime: number; // seconds
    messageLatency: number; // milliseconds
    simulationDuration: number; // minutes
    minSharpeRatio: number;
    maxErrorRate: number; // percentage
    minUptime: number; // percentage
  };
  options?: CheckOptions;
}

interface ReadinessReport {
  timestamp: Date;
  environment: string;
  overallStatus: 'ready' | 'not-ready' | 'degraded';
  checks: ValidationResult[];
  systemInfo: SystemInfo;
  moduleStatus: ModuleStatus[];
  recommendations: string[];
}

interface SystemInfo {
  hostname: string;
  platform: string;
  cpus: number;
  memory: number;
  nodeVersion: string;
  npmVersion: string;
  dockerVersion?: string;
  kubernetesVersion?: string;
}

export class ReadinessValidator extends EventEmitter {
  private logger: Logger;
  private config: ReadinessConfig;
  private results: ValidationResult[] = [];
  
  constructor(logger: Logger, config: ReadinessConfig) {
    super();
    this.logger = logger;
    this.config = config;
  }
  
  /**
   * Run full readiness validation
   */
  async validate(): Promise<ReadinessReport> {
    this.logger.info('Starting readiness validation', {
      environment: this.config.environment,
      checks: Object.entries(this.config.checks)
        .filter(([_, enabled]) => enabled)
        .map(([name]) => name)
    });
    
    // Clear previous results
    this.results = [];
    
    // Gather system information
    const systemInfo = await this.gatherSystemInfo();
    
    // Run enabled checks
    if (this.config.checks.startup) {
      await this.runCheck(CheckType.STARTUP);
    }
    
    if (this.config.checks.messageBus) {
      await this.runCheck(CheckType.MESSAGE_BUS);
    }
    
    if (this.config.checks.logging) {
      await this.runCheck(CheckType.LOGS);
    }
    
    if (this.config.checks.dashboard) {
      await this.runCheck(CheckType.DASHBOARD);
    }
    
    if (this.config.checks.performance) {
      await this.runPerformanceCheck();
    }
    
    if (this.config.checks.security) {
      await this.runSecurityCheck();
    }
    
    if (this.config.checks.connectivity) {
      await this.runConnectivityCheck();
    }
    
    if (this.config.checks.simulation) {
      await this.runCheck(CheckType.SIMULATION);
    }
    
    // Get module status
    const moduleStatus = await this.getModuleStatus();
    
    // Generate report
    const report = this.generateReport(systemInfo, moduleStatus);
    
    this.logger.info('Readiness validation completed', {
      status: report.overallStatus,
      passed: report.checks.filter(c => c.success).length,
      failed: report.checks.filter(c => !c.success).length
    });
    
    this.emit('validation:completed', report);
    
    return report;
  }
  
  /**
   * Run a specific check
   */
  private async runCheck(type: CheckType): Promise<ValidationResult> {
    this.logger.info(`Running ${type} check`);
    this.emit('check:started', { type });
    
    let check: any;
    
    try {
      switch (type) {
        case CheckType.STARTUP:
          check = new StartupCheck();
          break;
        case CheckType.MESSAGE_BUS:
          check = new MessageBusCheck();
          break;
        case CheckType.SIMULATION:
          check = new SimulationLoop(this.config.thresholds.simulationDuration);
          break;
        case CheckType.LOGS:
          check = new LogTest();
          break;
        case CheckType.DASHBOARD:
          check = new DashboardCheck();
          break;
        default:
          throw new Error(`Unknown check type: ${type}`);
      }
      
      const result = await check.run();
      this.results.push(result);
      
      this.emit('check:completed', { type, result });
      
      return result;
      
    } catch (error) {
      const result: ValidationResult = {
        success: false,
        checkType: type,
        timestamp: Date.now(),
        details: [{
          success: false,
          message: `Check failed: ${error instanceof Error ? error.message : String(error)}`
        }],
        error: error instanceof Error ? error : new Error(String(error))
      };
      
      this.results.push(result);
      this.emit('check:failed', { type, error });
      
      return result;
    }
  }
  
  /**
   * Run performance validation
   */
  private async runPerformanceCheck(): Promise<ValidationResult> {
    this.logger.info('Running performance check');
    
    const details: ValidationDetail[] = [];
    const metrics: Record<string, number> = {};
    
    try {
      // Check CPU usage
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      metrics.cpuUsage = cpuPercent;
      
      details.push({
        success: cpuPercent < 80,
        message: `CPU usage: ${cpuPercent.toFixed(2)}%`,
        metadata: { cpuUsage: cpuPercent }
      });
      
      // Check memory usage
      const memUsage = process.memoryUsage();
      const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      metrics.memoryUsage = memPercent;
      
      details.push({
        success: memPercent < 90,
        message: `Memory usage: ${memPercent.toFixed(2)}%`,
        metadata: { memoryUsage: memPercent }
      });
      
      // Check event loop lag
      const lagStart = Date.now();
      setImmediate(() => {
        const lag = Date.now() - lagStart;
        metrics.eventLoopLag = lag;
        
        details.push({
          success: lag < 100,
          message: `Event loop lag: ${lag}ms`,
          metadata: { eventLoopLag: lag }
        });
      });
      
      // Test file I/O performance
      const ioStart = Date.now();
      const testFile = path.join(os.tmpdir(), 'noderr-perf-test.tmp');
      await fs.writeFile(testFile, Buffer.alloc(1024 * 1024)); // 1MB
      await fs.readFile(testFile);
      await fs.unlink(testFile);
      const ioTime = Date.now() - ioStart;
      metrics.ioLatency = ioTime;
      
      details.push({
        success: ioTime < 500,
        message: `I/O latency: ${ioTime}ms`,
        metadata: { ioLatency: ioTime }
      });
      
      const result: ValidationResult = {
        success: details.every(d => d.success),
        checkType: CheckType.STARTUP, // Using STARTUP as placeholder
        timestamp: Date.now(),
        details,
        metrics
      };
      
      this.results.push(result);
      return result;
      
    } catch (error) {
      return {
        success: false,
        checkType: CheckType.STARTUP,
        timestamp: Date.now(),
        details: [{
          success: false,
          message: `Performance check error: ${error}`
        }],
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
  
  /**
   * Run security validation
   */
  private async runSecurityCheck(): Promise<ValidationResult> {
    this.logger.info('Running security check');
    
    const details: ValidationDetail[] = [];
    
    try {
      // Check environment variables
      const sensitiveVars = ['API_KEY', 'SECRET_KEY', 'DATABASE_URL', 'JWT_SECRET'];
      const exposedVars = sensitiveVars.filter(v => process.env[v] && process.env[v]!.length < 20);
      
      details.push({
        success: exposedVars.length === 0,
        message: exposedVars.length === 0 ? 
          'Environment variables properly secured' : 
          `Weak secrets detected: ${exposedVars.join(', ')}`,
        metadata: { exposedVars }
      });
      
      // Check file permissions
      const configFiles = [
        'config/production.json',
        '.env',
        'secrets.yaml'
      ];
      
      for (const file of configFiles) {
        try {
          const stats = await fs.stat(file);
          const mode = (stats.mode & parseInt('777', 8)).toString(8);
          
          details.push({
            success: mode === '600' || mode === '400',
            message: `${file} permissions: ${mode}`,
            metadata: { file, mode }
          });
        } catch (error) {
          // File doesn't exist, which is fine
        }
      }
      
      // Check SSL/TLS configuration
      details.push({
        success: process.env.NODE_ENV === 'production' && process.env.HTTPS_ENABLED === 'true',
        message: process.env.HTTPS_ENABLED === 'true' ? 
          'HTTPS enabled' : 
          'HTTPS not enabled',
        metadata: { httpsEnabled: process.env.HTTPS_ENABLED }
      });
      
      // Check dependency vulnerabilities
      try {
        const { stdout } = await exec('npm audit --json');
        const audit = JSON.parse(stdout);
        const critical = audit.metadata.vulnerabilities.critical || 0;
        const high = audit.metadata.vulnerabilities.high || 0;
        
        details.push({
          success: critical === 0 && high === 0,
          message: `Vulnerabilities: ${critical} critical, ${high} high`,
          metadata: { vulnerabilities: audit.metadata.vulnerabilities }
        });
      } catch (error) {
        details.push({
          success: false,
          message: 'Failed to run security audit',
          metadata: { error: String(error) }
        });
      }
      
      const result: ValidationResult = {
        success: details.every(d => d.success),
        checkType: CheckType.STARTUP,
        timestamp: Date.now(),
        details
      };
      
      this.results.push(result);
      return result;
      
    } catch (error) {
      return {
        success: false,
        checkType: CheckType.STARTUP,
        timestamp: Date.now(),
        details: [{
          success: false,
          message: `Security check error: ${error}`
        }],
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
  
  /**
   * Run connectivity validation
   */
  private async runConnectivityCheck(): Promise<ValidationResult> {
    this.logger.info('Running connectivity check');
    
    const details: ValidationDetail[] = [];
    const endpoints = [
      { name: 'Redis', url: process.env.REDIS_URL || 'redis://localhost:6379' },
      { name: 'Prometheus', url: process.env.PROMETHEUS_URL || 'http://localhost:9090' },
      { name: 'Grafana', url: process.env.GRAFANA_URL || 'http://localhost:3000' },
      { name: 'Loki', url: process.env.LOKI_URL || 'http://localhost:3100' }
    ];
    
    for (const endpoint of endpoints) {
      try {
        const start = Date.now();
        const response = await fetch(endpoint.url + '/health', {
          signal: AbortSignal.timeout(5000)
        });
        const latency = Date.now() - start;
        
        details.push({
          success: response.ok && latency < 1000,
          message: `${endpoint.name}: ${response.ok ? 'Connected' : 'Failed'} (${latency}ms)`,
          metadata: { endpoint: endpoint.name, status: response.status, latency }
        });
      } catch (error) {
        details.push({
          success: false,
          message: `${endpoint.name}: Connection failed`,
          metadata: { endpoint: endpoint.name, error: String(error) }
        });
      }
    }
    
    const result: ValidationResult = {
      success: details.filter(d => d.success).length >= endpoints.length * 0.8, // 80% must pass
      checkType: CheckType.STARTUP,
      timestamp: Date.now(),
      details
    };
    
    this.results.push(result);
    return result;
  }
  
  /**
   * Get module status
   */
  private async getModuleStatus(): Promise<ModuleStatus[]> {
    const modules: ModuleStatus[] = [];
    
    for (const moduleName of this.config.modules) {
      try {
        const response = await fetch(`http://localhost:3000/health/${moduleName}`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const health = await response.json() as {
            status?: string;
            version?: string;
            uptime?: number;
            metrics?: {
              cpu: number;
              memory: number;
              latency: number;
              errors: number;
            };
          };
          const moduleStatus: ModuleStatus = {
            name: moduleName,
            status: (health.status as 'healthy' | 'degraded' | 'unhealthy') || 'unknown',
            version: health.version || 'unknown',
            uptime: health.uptime || 0,
            lastHealthCheck: Date.now()
          };
          
          if (health.metrics) {
            moduleStatus.metrics = health.metrics;
          }
          
          modules.push(moduleStatus);
        } else {
          modules.push({
            name: moduleName,
            status: 'unhealthy',
            version: 'unknown',
            uptime: 0,
            lastHealthCheck: Date.now()
          });
        }
      } catch (error) {
        modules.push({
          name: moduleName,
          status: 'unknown',
          version: 'unknown',
          uptime: 0,
          lastHealthCheck: Date.now()
        });
      }
    }
    
    return modules;
  }
  
  /**
   * Gather system information
   */
  private async gatherSystemInfo(): Promise<SystemInfo> {
    const info: SystemInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      cpus: os.cpus().length,
      memory: os.totalmem(),
      nodeVersion: process.version,
      npmVersion: 'unknown'
    };
    
    // Get npm version
    try {
      const { stdout } = await exec('npm --version');
      info.npmVersion = stdout.trim();
    } catch (error) {
      // Ignore
    }
    
    // Get Docker version
    try {
      const { stdout } = await exec('docker --version');
      info.dockerVersion = stdout.trim();
    } catch (error) {
      // Docker not installed
    }
    
    // Get Kubernetes version
    try {
      const { stdout } = await exec('kubectl version --client --short');
      info.kubernetesVersion = stdout.trim();
    } catch (error) {
      // Kubernetes not installed
    }
    
    return info;
  }
  
  /**
   * Generate readiness report
   */
  private generateReport(systemInfo: SystemInfo, moduleStatus: ModuleStatus[]): ReadinessReport {
    const failedChecks = this.results.filter(r => !r.success);
    const degradedModules = moduleStatus.filter(m => m.status === 'degraded');
    const unhealthyModules = moduleStatus.filter(m => m.status === 'unhealthy');
    
    let overallStatus: 'ready' | 'not-ready' | 'degraded' = 'ready';
    
    if (failedChecks.length > 0 || unhealthyModules.length > 0) {
      overallStatus = 'not-ready';
    } else if (degradedModules.length > 0) {
      overallStatus = 'degraded';
    }
    
    const recommendations: string[] = [];
    
    // Generate recommendations based on failures
    for (const check of failedChecks) {
      switch (check.checkType) {
        case CheckType.STARTUP:
          recommendations.push('Ensure all modules are properly configured and can start');
          break;
        case CheckType.MESSAGE_BUS:
          recommendations.push('Check message bus configuration and network connectivity');
          break;
        case CheckType.LOGS:
          recommendations.push('Verify logging infrastructure is accessible');
          break;
        case CheckType.DASHBOARD:
          recommendations.push('Ensure Grafana and Prometheus are running');
          break;
        case CheckType.SIMULATION:
          recommendations.push('Review trading engine configuration and market data access');
          break;
      }
    }
    
    // Add module-specific recommendations
    for (const module of unhealthyModules) {
      recommendations.push(`Fix health issues in ${module.name} module`);
    }
    
    // Performance recommendations
    const perfCheck = this.results.find(r => r.metrics?.cpuUsage);
    if (perfCheck?.metrics?.cpuUsage && typeof perfCheck.metrics.cpuUsage === 'number' && perfCheck.metrics.cpuUsage > 70) {
      recommendations.push('Consider scaling up CPU resources');
    }
    
    if (perfCheck?.metrics?.memoryUsage && typeof perfCheck.metrics.memoryUsage === 'number' && perfCheck.metrics.memoryUsage > 80) {
      recommendations.push('Consider increasing memory allocation');
    }
    
    return {
      timestamp: new Date(),
      environment: this.config.environment,
      overallStatus,
      checks: this.results,
      systemInfo,
      moduleStatus,
      recommendations: [...new Set(recommendations)] // Remove duplicates
    };
  }
  
  /**
   * Generate HTML report
   */
  async generateHTMLReport(report: ReadinessReport): Promise<string> {
    const statusColor = {
      'ready': '#4CAF50',
      'degraded': '#FF9800',
      'not-ready': '#F44336'
    };
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Noderr Protocol - Readiness Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
    }
    .status {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      color: white;
      font-weight: bold;
      background: ${statusColor[report.overallStatus]};
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .info-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #2196F3;
    }
    .info-card h3 {
      margin: 0 0 10px 0;
      color: #555;
    }
    .check-item {
      padding: 15px;
      margin: 10px 0;
      border-radius: 8px;
      background: #f8f9fa;
      border-left: 4px solid;
    }
    .check-success {
      border-color: #4CAF50;
    }
    .check-failed {
      border-color: #F44336;
    }
    .details {
      margin-top: 10px;
      padding-left: 20px;
    }
    .recommendation {
      padding: 10px 15px;
      margin: 5px 0;
      background: #FFF3E0;
      border-radius: 4px;
      border-left: 3px solid #FF9800;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #f8f9fa;
      font-weight: 600;
    }
    .metric {
      font-family: monospace;
      background: #e3f2fd;
      padding: 2px 6px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Noderr Protocol - Readiness Report</h1>
    <p>Generated: ${report.timestamp.toISOString()}</p>
    <p>Environment: <strong>${report.environment}</strong></p>
    <p>Status: <span class="status">${report.overallStatus.toUpperCase()}</span></p>
    
    <div class="info-grid">
      <div class="info-card">
        <h3>System Information</h3>
        <p>Hostname: ${report.systemInfo.hostname}</p>
        <p>Platform: ${report.systemInfo.platform}</p>
        <p>CPUs: ${report.systemInfo.cpus}</p>
        <p>Memory: ${(report.systemInfo.memory / 1024 / 1024 / 1024).toFixed(2)} GB</p>
        <p>Node: ${report.systemInfo.nodeVersion}</p>
      </div>
      
      <div class="info-card">
        <h3>Check Summary</h3>
        <p>Total: ${report.checks.length}</p>
        <p>Passed: ${report.checks.filter(c => c.success).length}</p>
        <p>Failed: ${report.checks.filter(c => !c.success).length}</p>
      </div>
      
      <div class="info-card">
        <h3>Module Health</h3>
        <p>Healthy: ${report.moduleStatus.filter(m => m.status === 'healthy').length}</p>
        <p>Degraded: ${report.moduleStatus.filter(m => m.status === 'degraded').length}</p>
        <p>Unhealthy: ${report.moduleStatus.filter(m => m.status === 'unhealthy').length}</p>
      </div>
    </div>
    
    <h2>Validation Results</h2>
    ${report.checks.map(check => `
      <div class="check-item ${check.success ? 'check-success' : 'check-failed'}">
        <h3>${check.checkType} ${check.success ? '✓' : '✗'}</h3>
        <div class="details">
          ${check.details.map(d => `
            <p>${d.success ? '✓' : '✗'} ${d.message}</p>
          `).join('')}
          ${check.metrics ? `
            <p>Metrics: ${Object.entries(check.metrics).map(([k, v]) => 
              `<span class="metric">${k}: ${v}</span>`
            ).join(' ')}</p>
          ` : ''}
        </div>
      </div>
    `).join('')}
    
    <h2>Module Status</h2>
    <table>
      <thead>
        <tr>
          <th>Module</th>
          <th>Status</th>
          <th>Version</th>
          <th>Uptime</th>
          <th>CPU</th>
          <th>Memory</th>
        </tr>
      </thead>
      <tbody>
        ${report.moduleStatus.map(module => `
          <tr>
            <td>${module.name}</td>
            <td>${module.status}</td>
            <td>${module.version}</td>
            <td>${(module.uptime / 1000 / 60).toFixed(0)} min</td>
            <td>${module.metrics?.cpu ? module.metrics.cpu.toFixed(1) + '%' : '-'}</td>
            <td>${module.metrics?.memory ? module.metrics.memory.toFixed(1) + '%' : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    ${report.recommendations.length > 0 ? `
      <h2>Recommendations</h2>
      ${report.recommendations.map(rec => `
        <div class="recommendation">${rec}</div>
      `).join('')}
    ` : ''}
  </div>
</body>
</html>
    `;
    
    return html;
  }
  
  /**
   * Save report to file
   */
  async saveReport(report: ReadinessReport, format: 'json' | 'html' = 'json'): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `readiness-report-${timestamp}.${format}`;
    const filepath = path.join(process.cwd(), 'reports', filename);
    
    // Ensure reports directory exists
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    
    if (format === 'json') {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    } else {
      const html = await this.generateHTMLReport(report);
      await fs.writeFile(filepath, html);
    }
    
    this.logger.info(`Report saved to ${filepath}`);
    return filepath;
  }
} 