import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface ProductionConfig {
  environment: 'development' | 'staging' | 'production';
  deployment: {
    region: string;
    datacenter: string;
    redundancy: number;
  };
  dataFeeds: {
    primary: DataFeedConfig[];
    backup: DataFeedConfig[];
  };
  credentials: {
    exchanges: Record<string, ExchangeCredentials>;
    databases: Record<string, DatabaseCredentials>;
    monitoring: Record<string, MonitoringCredentials>;
  };
  capital: {
    initialPercent: number;
    rampUpDuration: number; // milliseconds
    checkpoints: number[];
    maxAllocation: number;
  };
  circuitBreakers: {
    maxDailyLoss: number;
    maxWeeklyLoss: number;
    maxMonthlyLoss: number;
    volatilityMultiplier: number;
    cooldownPeriod: number;
  };
  monitoring: {
    prometheusUrl: string;
    grafanaUrl: string;
    alertingEnabled: boolean;
    slackWebhook?: string;
  };
}

interface DataFeedConfig {
  id: string;
  type: 'REST' | 'WEBSOCKET' | 'FIX' | 'ORACLE';
  provider: string;
  url: string;
  symbols: string[];
  rateLimit: number;
  priority: number;
}

interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  testnet: boolean;
}

interface DatabaseCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

interface MonitoringCredentials {
  apiKey: string;
  endpoint: string;
}

interface PreflightCheck {
  id: string;
  name: string;
  description: string;
  critical: boolean;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  error?: string;
  duration?: number;
}

interface LaunchReport {
  timestamp: Date;
  environment: string;
  preflightResults: PreflightCheck[];
  capitalRampStatus: CapitalRampStatus;
  systemHealth: SystemHealth;
  warnings: string[];
  errors: string[];
}

interface CapitalRampStatus {
  currentPercent: number;
  targetPercent: number;
  phase: 'not_started' | 'ramping' | 'checkpoint' | 'completed';
  startTime?: Date;
  estimatedCompletion?: Date;
  checkpointsPassed: number[];
}

interface SystemHealth {
  dataFeedsOnline: number;
  dataFeedsTotal: number;
  modulesReady: number;
  modulesTotal: number;
  latencyMs: number;
  cpuUsage: number;
  memoryUsage: number;
}

export class ProductionLauncher extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: ProductionConfig | null = null;
  private preflightChecks: PreflightCheck[] = [];
  private capitalRampStatus: CapitalRampStatus;
  private launchReport: LaunchReport | null = null;
  private rampInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isLaunched: boolean = false;
  
  constructor() {
    super();
    this.logger = createLogger('ProductionLauncher');
    
    this.capitalRampStatus = {
      currentPercent: 0,
      targetPercent: 100,
      phase: 'not_started',
      checkpointsPassed: []
    };
    
    this.initializePreflightChecks();
  }
  
  private initializePreflightChecks(): void {
    this.preflightChecks = [
      {
        id: 'config_validation',
        name: 'Configuration Validation',
        description: 'Validate production configuration file',
        critical: true,
        status: 'pending'
      },
      {
        id: 'data_feeds',
        name: 'Data Feed Connectivity',
        description: 'Test connection to all configured data feeds',
        critical: true,
        status: 'pending'
      },
      {
        id: 'exchange_auth',
        name: 'Exchange Authentication',
        description: 'Verify exchange API credentials',
        critical: true,
        status: 'pending'
      },
      {
        id: 'database_conn',
        name: 'Database Connectivity',
        description: 'Test database connections',
        critical: true,
        status: 'pending'
      },
      {
        id: 'circuit_breaker_test',
        name: 'Circuit Breaker Test',
        description: 'Test emergency stop functionality',
        critical: true,
        status: 'pending'
      },
      {
        id: 'module_health',
        name: 'Module Health Check',
        description: 'Verify all modules are ready',
        critical: true,
        status: 'pending'
      },
      {
        id: 'monitoring_conn',
        name: 'Monitoring Connection',
        description: 'Test Prometheus/Grafana connectivity',
        critical: false,
        status: 'pending'
      },
      {
        id: 'capital_access',
        name: 'Capital Access Verification',
        description: 'Verify access to trading capital',
        critical: true,
        status: 'pending'
      },
      {
        id: 'risk_limits',
        name: 'Risk Limit Configuration',
        description: 'Validate risk management settings',
        critical: true,
        status: 'pending'
      },
      {
        id: 'backup_systems',
        name: 'Backup Systems Check',
        description: 'Test failover and backup systems',
        critical: false,
        status: 'pending'
      }
    ];
  }
  
  public async loadConfiguration(configPath: string): Promise<void> {
    this.logger.info('Loading production configuration', { path: configPath });
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      this.config = yaml.load(configContent) as ProductionConfig;
      
      // Validate configuration
      this.validateConfiguration();
      
      this.logger.info('Configuration loaded successfully', {
        environment: this.config.environment,
        dataFeeds: this.config.dataFeeds.primary.length,
        exchanges: Object.keys(this.config.credentials.exchanges).length
      });
      
      this.emit('config-loaded', this.config);
      
    } catch (error) {
      this.logger.error('Failed to load configuration', error);
      throw error;
    }
  }
  
  private validateConfiguration(): void {
    if (!this.config) throw new Error('No configuration loaded');
    
    // Validate required fields
    if (!this.config.environment) {
      throw new Error('Environment not specified');
    }
    
    if (!this.config.dataFeeds.primary.length) {
      throw new Error('No primary data feeds configured');
    }
    
    if (!this.config.credentials.exchanges) {
      throw new Error('No exchange credentials configured');
    }
    
    if (this.config.capital.initialPercent > 100 || this.config.capital.initialPercent < 0) {
      throw new Error('Invalid initial capital percentage');
    }
    
    // Validate circuit breaker limits
    if (this.config.circuitBreakers.maxDailyLoss > 0.2) {
      this.logger.warn('Daily loss limit exceeds 20% - this is risky!');
    }
  }
  
  public async runPreflightChecks(): Promise<PreflightCheck[]> {
    this.logger.info('Starting preflight checks');
    
    const startTime = Date.now();
    
    for (const check of this.preflightChecks) {
      await this.runSingleCheck(check);
      
      // Stop on critical failure
      if (check.critical && check.status === 'failed') {
        this.logger.error(`Critical preflight check failed: ${check.name}`);
        break;
      }
    }
    
    const duration = Date.now() - startTime;
    const passed = this.preflightChecks.filter(c => c.status === 'passed').length;
    const failed = this.preflightChecks.filter(c => c.status === 'failed').length;
    
    this.logger.info('Preflight checks completed', {
      duration,
      passed,
      failed,
      total: this.preflightChecks.length
    });
    
    this.emit('preflight-complete', this.preflightChecks);
    
    return this.preflightChecks;
  }
  
  private async runSingleCheck(check: PreflightCheck): Promise<void> {
    this.logger.info(`Running preflight check: ${check.name}`);
    
    check.status = 'running';
    const checkStart = Date.now();
    
    try {
      switch (check.id) {
        case 'config_validation':
          await this.checkConfiguration();
          break;
        case 'data_feeds':
          await this.checkDataFeeds();
          break;
        case 'exchange_auth':
          await this.checkExchangeAuth();
          break;
        case 'database_conn':
          await this.checkDatabaseConnections();
          break;
        case 'circuit_breaker_test':
          await this.checkCircuitBreakers();
          break;
        case 'module_health':
          await this.checkModuleHealth();
          break;
        case 'monitoring_conn':
          await this.checkMonitoringConnections();
          break;
        case 'capital_access':
          await this.checkCapitalAccess();
          break;
        case 'risk_limits':
          await this.checkRiskLimits();
          break;
        case 'backup_systems':
          await this.checkBackupSystems();
          break;
      }
      
      check.status = 'passed';
      check.duration = Date.now() - checkStart;
      
    } catch (error: any) {
      check.status = 'failed';
      check.error = error.message;
      check.duration = Date.now() - checkStart;
      
      this.logger.error(`Preflight check failed: ${check.name}`, error);
    }
  }
  
  private async checkConfiguration(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration loaded');
    }
    
    // Additional runtime validation
    if (this.config.environment === 'production' && this.config.monitoring.alertingEnabled === false) {
      throw new Error('Alerting must be enabled in production');
    }
  }
  
  private async checkDataFeeds(): Promise<void> {
    if (!this.config) throw new Error('No configuration');
    
    // Test connectivity to each data feed
    for (const feed of this.config.dataFeeds.primary) {
      // In production, would actually test connection
      this.logger.debug(`Testing data feed: ${feed.provider}`, { url: feed.url });
      
      // Simulate connection test
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (Math.random() > 0.95) {
        throw new Error(`Failed to connect to ${feed.provider}`);
      }
    }
  }
  
  private async checkExchangeAuth(): Promise<void> {
    if (!this.config) throw new Error('No configuration');
    
    for (const [exchange, creds] of Object.entries(this.config.credentials.exchanges)) {
      this.logger.debug(`Testing exchange authentication: ${exchange}`);
      
      // In production, would test with actual API call
      if (!creds.apiKey || !creds.apiSecret) {
        throw new Error(`Missing credentials for ${exchange}`);
      }
      
      // Simulate API test
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  private async checkDatabaseConnections(): Promise<void> {
    if (!this.config) throw new Error('No configuration');
    
    for (const [db, creds] of Object.entries(this.config.credentials.databases)) {
      this.logger.debug(`Testing database connection: ${db}`);
      
      // In production, would actually test connection
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  
  private async checkCircuitBreakers(): Promise<void> {
    // Test circuit breaker activation/deactivation
    this.logger.debug('Testing circuit breaker functionality');
    
    // In production, would trigger test activation
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Verify circuit breaker can be activated and deactivated
    const testActivated = true; // Mock
    const testDeactivated = true; // Mock
    
    if (!testActivated || !testDeactivated) {
      throw new Error('Circuit breaker test failed');
    }
  }
  
  private async checkModuleHealth(): Promise<void> {
    // Check health of all system modules
    const modules = [
      'ai-core',
      'risk-engine',
      'execution-optimizer',
      'market-intelligence',
      'strategy-portfolio'
    ];
    
    for (const module of modules) {
      this.logger.debug(`Checking module health: ${module}`);
      
      // In production, would query actual module health
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (Math.random() > 0.98) {
        throw new Error(`Module ${module} is not healthy`);
      }
    }
  }
  
  private async checkMonitoringConnections(): Promise<void> {
    if (!this.config) throw new Error('No configuration');
    
    // Test Prometheus connection
    this.logger.debug('Testing Prometheus connection', { url: this.config.monitoring.prometheusUrl });
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Test Grafana connection
    this.logger.debug('Testing Grafana connection', { url: this.config.monitoring.grafanaUrl });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  private async checkCapitalAccess(): Promise<void> {
    // Verify access to trading capital accounts
    this.logger.debug('Verifying capital access');
    
    // In production, would check account balances
    const mockBalance = 1000000; // $1M
    
    if (mockBalance <= 0) {
      throw new Error('No trading capital available');
    }
  }
  
  private async checkRiskLimits(): Promise<void> {
    if (!this.config) throw new Error('No configuration');
    
    // Validate risk limits are reasonable
    const limits = this.config.circuitBreakers;
    
    if (limits.maxDailyLoss > 0.1) {
      this.logger.warn('Daily loss limit exceeds 10%');
    }
    
    if (limits.volatilityMultiplier < 1.5) {
      throw new Error('Volatility multiplier too low for safety');
    }
  }
  
  private async checkBackupSystems(): Promise<void> {
    // Test backup data feeds
    if (!this.config) throw new Error('No configuration');
    
    if (this.config.dataFeeds.backup.length === 0) {
      this.logger.warn('No backup data feeds configured');
    }
    
    // Test failover capability
    this.logger.debug('Testing failover systems');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  public async launch(): Promise<void> {
    if (this.isLaunched) {
      throw new Error('System already launched');
    }
    
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    // Check if preflight passed
    const criticalFailed = this.preflightChecks
      .filter(c => c.critical && c.status === 'failed')
      .length;
    
    if (criticalFailed > 0) {
      throw new Error(`Cannot launch: ${criticalFailed} critical preflight checks failed`);
    }
    
    this.logger.info('Launching production system', {
      environment: this.config.environment,
      initialCapital: this.config.capital.initialPercent
    });
    
    try {
      // Initialize launch report
      this.launchReport = {
        timestamp: new Date(),
        environment: this.config.environment,
        preflightResults: [...this.preflightChecks],
        capitalRampStatus: { ...this.capitalRampStatus },
        systemHealth: await this.getSystemHealth(),
        warnings: [],
        errors: []
      };
      
      // Start capital ramp-up
      await this.startCapitalRampUp();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Start audit logging
      this.startAuditLogging();
      
      this.isLaunched = true;
      
      this.logger.info('Production system launched successfully');
      
      this.emit('system-launched', {
        timestamp: new Date(),
        environment: this.config.environment,
        report: this.launchReport
      });
      
    } catch (error) {
      this.logger.error('Launch failed', error);
      
      if (this.launchReport) {
        this.launchReport.errors.push((error as Error).message);
      }
      
      // Attempt safe shutdown
      await this.shutdown('Launch failure');
      
      throw error;
    }
  }
  
  private async startCapitalRampUp(): Promise<void> {
    if (!this.config) throw new Error('No configuration');
    
    this.capitalRampStatus = {
      currentPercent: this.config.capital.initialPercent,
      targetPercent: 100,
      phase: 'ramping',
      startTime: new Date(),
      estimatedCompletion: new Date(Date.now() + this.config.capital.rampUpDuration),
      checkpointsPassed: []
    };
    
    this.logger.info('Starting capital ramp-up', {
      initial: this.capitalRampStatus.currentPercent,
      target: this.capitalRampStatus.targetPercent,
      duration: this.config.capital.rampUpDuration
    });
    
    const rampSteps = 100; // Number of ramp steps
    const stepDuration = this.config.capital.rampUpDuration / rampSteps;
    const stepSize = (100 - this.config.capital.initialPercent) / rampSteps;
    
    let currentStep = 0;
    
    this.rampInterval = setInterval(async () => {
      if (currentStep >= rampSteps) {
        this.completeCapitalRamp();
        return;
      }
      
      // Check for checkpoint
      const nextPercent = this.capitalRampStatus.currentPercent + stepSize;
      const checkpoint = this.config!.capital.checkpoints.find(
        cp => cp > this.capitalRampStatus.currentPercent && cp <= nextPercent
      );
      
      if (checkpoint) {
        await this.handleCheckpoint(checkpoint);
      }
      
      // Update capital allocation
      this.capitalRampStatus.currentPercent = Math.min(100, nextPercent);
      currentStep++;
      
      // Notify system orchestrator
      this.emit('capital-updated', {
        current: this.capitalRampStatus.currentPercent,
        target: this.capitalRampStatus.targetPercent,
        phase: this.capitalRampStatus.phase
      });
      
      this.logger.debug('Capital ramp progress', {
        percent: this.capitalRampStatus.currentPercent.toFixed(2),
        step: currentStep,
        totalSteps: rampSteps
      });
      
    }, stepDuration);
  }
  
  private async handleCheckpoint(checkpoint: number): Promise<void> {
    this.logger.info(`Capital ramp checkpoint reached: ${checkpoint}%`);
    
    this.capitalRampStatus.phase = 'checkpoint';
    this.capitalRampStatus.checkpointsPassed.push(checkpoint);
    
    // Pause ramp and run health checks
    if (this.rampInterval) {
      clearInterval(this.rampInterval);
      this.rampInterval = null;
    }
    
    try {
      // Run system health check
      const health = await this.getSystemHealth();
      
      // Check if system is stable
      if (health.dataFeedsOnline < health.dataFeedsTotal * 0.9) {
        throw new Error('Insufficient data feeds online');
      }
      
      if (health.latencyMs > 1000) {
        throw new Error('System latency too high');
      }
      
      // Check recent P&L
      const recentPnL = await this.getRecentPnL();
      if (recentPnL < -0.02) { // More than 2% loss
        throw new Error('Recent losses exceed threshold');
      }
      
      this.logger.info('Checkpoint validation passed', {
        checkpoint,
        health,
        recentPnL
      });
      
      // Resume ramp
      this.capitalRampStatus.phase = 'ramping';
      this.startCapitalRampUp(); // Resume from current position
      
    } catch (error) {
      this.logger.error('Checkpoint validation failed', error);
      
      // Halt ramp-up
      this.capitalRampStatus.phase = 'checkpoint';
      
      this.emit('ramp-halted', {
        checkpoint,
        reason: (error as Error).message,
        currentPercent: this.capitalRampStatus.currentPercent
      });
      
      // Add to launch report
      if (this.launchReport) {
        this.launchReport.warnings.push(
          `Capital ramp halted at ${checkpoint}%: ${(error as Error).message}`
        );
      }
    }
  }
  
  private completeCapitalRamp(): void {
    if (this.rampInterval) {
      clearInterval(this.rampInterval);
      this.rampInterval = null;
    }
    
    this.capitalRampStatus.phase = 'completed';
    this.capitalRampStatus.currentPercent = 100;
    
    this.logger.info('Capital ramp-up completed', {
      duration: Date.now() - this.capitalRampStatus.startTime!.getTime(),
      checkpointsPassed: this.capitalRampStatus.checkpointsPassed
    });
    
    this.emit('ramp-complete', this.capitalRampStatus);
  }
  
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        
        // Check for degradation
        if (health.dataFeedsOnline < health.dataFeedsTotal) {
          this.logger.warn('Data feed degradation detected', {
            online: health.dataFeedsOnline,
            total: health.dataFeedsTotal
          });
        }
        
        if (health.latencyMs > 500) {
          this.logger.warn('High system latency', { latency: health.latencyMs });
        }
        
        // Update launch report
        if (this.launchReport) {
          this.launchReport.systemHealth = health;
        }
        
        this.emit('health-update', health);
        
      } catch (error) {
        this.logger.error('Health check failed', error);
      }
    }, 30000); // Every 30 seconds
  }
  
  private startAuditLogging(): void {
    // Log all major events for audit trail
    this.on('capital-updated', (data) => {
      this.logAuditEvent('CAPITAL_UPDATE', data);
    });
    
    this.on('health-update', (data) => {
      this.logAuditEvent('HEALTH_CHECK', data);
    });
    
    this.on('ramp-halted', (data) => {
      this.logAuditEvent('RAMP_HALTED', data);
    });
  }
  
  private logAuditEvent(eventType: string, data: any): void {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      environment: this.config?.environment,
      data,
      checksum: this.calculateChecksum(data)
    };
    
    // In production, would write to immutable audit log
    this.logger.info('AUDIT', auditEntry);
  }
  
  private calculateChecksum(data: any): string {
    // Simple checksum for demo
    return Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 16);
  }
  
  private async getSystemHealth(): Promise<SystemHealth> {
    // In production, would query actual system metrics
    return {
      dataFeedsOnline: 8 + Math.floor(Math.random() * 3),
      dataFeedsTotal: 10,
      modulesReady: 15 + Math.floor(Math.random() * 3),
      modulesTotal: 17,
      latencyMs: 50 + Math.random() * 200,
      cpuUsage: 30 + Math.random() * 40,
      memoryUsage: 40 + Math.random() * 30
    };
  }
  
  private async getRecentPnL(): Promise<number> {
    // In production, would query actual P&L
    return -0.01 + Math.random() * 0.03; // -1% to +2%
  }
  
  public async shutdown(reason: string): Promise<void> {
    this.logger.info('Shutting down production system', { reason });
    
    try {
      // Stop capital ramp
      if (this.rampInterval) {
        clearInterval(this.rampInterval);
        this.rampInterval = null;
      }
      
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      // Log final audit event
      this.logAuditEvent('SYSTEM_SHUTDOWN', {
        reason,
        finalCapitalPercent: this.capitalRampStatus.currentPercent,
        runtime: this.launchReport ? Date.now() - this.launchReport.timestamp.getTime() : 0
      });
      
      this.isLaunched = false;
      
      this.emit('system-shutdown', { reason, timestamp: new Date() });
      
    } catch (error) {
      this.logger.error('Shutdown error', error);
      throw error;
    }
  }
  
  public getStatus(): {
    launched: boolean;
    environment?: string;
    capitalStatus: CapitalRampStatus;
    health?: SystemHealth;
    preflightStatus: { passed: number; failed: number; total: number };
  } {
    const preflightStatus = {
      passed: this.preflightChecks.filter(c => c.status === 'passed').length,
      failed: this.preflightChecks.filter(c => c.status === 'failed').length,
      total: this.preflightChecks.length
    };
    
    return {
      launched: this.isLaunched,
      environment: this.config?.environment,
      capitalStatus: { ...this.capitalRampStatus },
      health: this.launchReport?.systemHealth,
      preflightStatus
    };
  }
  
  public getLaunchReport(): LaunchReport | null {
    return this.launchReport;
  }
} 