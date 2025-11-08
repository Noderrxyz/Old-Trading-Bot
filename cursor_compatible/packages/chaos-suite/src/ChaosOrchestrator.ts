import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  category: 'module' | 'data' | 'network' | 'market' | 'resource';
  severity: 'low' | 'medium' | 'high' | 'critical';
  duration: number; // milliseconds
  probability: number; // 0-1 for random execution
  targetModules?: string[];
  actions: ChaosAction[];
}

interface ChaosAction {
  type: string;
  target: string;
  parameters: any;
  delay?: number;
}

interface ChaosResult {
  scenarioId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  systemState: SystemState;
  recoveryMetrics: RecoveryMetrics;
  passed: boolean;
  errors: string[];
  logs: ChaosLog[];
}

interface SystemState {
  modulesAffected: string[];
  servicesDown: string[];
  dataIntegrity: 'intact' | 'corrupted' | 'recovered';
  performanceImpact: number; // percentage
  availabilityImpact: number; // percentage
}

interface RecoveryMetrics {
  detectionTime: number; // ms to detect issue
  recoveryTime: number; // ms to recover
  dataLoss: boolean;
  automaticRecovery: boolean;
  manualIntervention: boolean;
  rollbackPerformed: boolean;
}

interface ChaosLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  module?: string;
  data?: any;
}

interface ChaosReport {
  timestamp: Date;
  scenariosRun: number;
  passed: number;
  failed: number;
  avgRecoveryTime: number;
  criticalFailures: string[];
  recommendations: string[];
  detailedResults: ChaosResult[];
}

export class ChaosOrchestrator extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private scenarios: Map<string, ChaosScenario>;
  private activeScenarios: Set<string> = new Set();
  private results: ChaosResult[] = [];
  private isRunning: boolean = false;
  private systemSnapshot: any = null;
  
  constructor() {
    super();
    this.logger = createLogger('ChaosOrchestrator');
    this.scenarios = new Map();
    this.initializeScenarios();
  }
  
  private initializeScenarios(): void {
    const scenarios: ChaosScenario[] = [
      // Module Failures
      {
        id: 'kill_ai_core',
        name: 'Kill AI Core Module',
        description: 'Simulate AI Core module crash',
        category: 'module',
        severity: 'critical',
        duration: 30000,
        probability: 0.1,
        targetModules: ['ai-core'],
        actions: [
          {
            type: 'kill_process',
            target: 'ai-core',
            parameters: { force: true }
          }
        ]
      },
      {
        id: 'kill_risk_engine',
        name: 'Kill Risk Engine',
        description: 'Simulate Risk Engine failure',
        category: 'module',
        severity: 'critical',
        duration: 20000,
        probability: 0.1,
        targetModules: ['risk-engine'],
        actions: [
          {
            type: 'kill_process',
            target: 'risk-engine',
            parameters: { force: true }
          }
        ]
      },
      {
        id: 'memory_leak',
        name: 'Memory Leak Simulation',
        description: 'Simulate gradual memory leak',
        category: 'resource',
        severity: 'high',
        duration: 60000,
        probability: 0.2,
        actions: [
          {
            type: 'consume_memory',
            target: 'system',
            parameters: { rate: 100, maxMB: 2048 }
          }
        ]
      },
      
      // Data Corruption
      {
        id: 'corrupt_price_feed',
        name: 'Corrupt Price Feed',
        description: 'Inject corrupted price data',
        category: 'data',
        severity: 'high',
        duration: 10000,
        probability: 0.15,
        actions: [
          {
            type: 'corrupt_data',
            target: 'price_feed',
            parameters: { 
              corruption_type: 'spike',
              magnitude: 10, // 10x price spike
              symbols: ['BTC-USD']
            }
          }
        ]
      },
      {
        id: 'stale_data',
        name: 'Stale Data Feed',
        description: 'Simulate frozen data feed',
        category: 'data',
        severity: 'medium',
        duration: 30000,
        probability: 0.2,
        actions: [
          {
            type: 'freeze_data',
            target: 'market_data',
            parameters: { freeze_duration: 30000 }
          }
        ]
      },
      
      // Network Issues
      {
        id: 'network_partition',
        name: 'Network Partition',
        description: 'Simulate network split between services',
        category: 'network',
        severity: 'high',
        duration: 45000,
        probability: 0.1,
        actions: [
          {
            type: 'block_network',
            target: 'inter_service',
            parameters: { 
              services: ['ai-core', 'execution-engine'],
              bidirectional: true
            }
          }
        ]
      },
      {
        id: 'high_latency',
        name: 'High Network Latency',
        description: 'Inject high latency in network calls',
        category: 'network',
        severity: 'medium',
        duration: 60000,
        probability: 0.25,
        actions: [
          {
            type: 'inject_latency',
            target: 'network',
            parameters: { 
              minLatency: 500,
              maxLatency: 2000,
              jitter: true
            }
          }
        ]
      },
      {
        id: 'packet_loss',
        name: 'Network Packet Loss',
        description: 'Simulate packet loss',
        category: 'network',
        severity: 'medium',
        duration: 30000,
        probability: 0.2,
        actions: [
          {
            type: 'packet_loss',
            target: 'network',
            parameters: { lossRate: 0.1 } // 10% packet loss
          }
        ]
      },
      
      // Market Events
      {
        id: 'flash_crash',
        name: 'Flash Crash Simulation',
        description: 'Simulate sudden market crash',
        category: 'market',
        severity: 'critical',
        duration: 300000, // 5 minutes
        probability: 0.05,
        actions: [
          {
            type: 'market_event',
            target: 'price_simulator',
            parameters: {
              event_type: 'flash_crash',
              drop_percent: 15,
              recovery_time: 180000
            }
          }
        ]
      },
      {
        id: 'liquidity_crisis',
        name: 'Liquidity Crisis',
        description: 'Simulate exchange liquidity drying up',
        category: 'market',
        severity: 'high',
        duration: 120000,
        probability: 0.1,
        actions: [
          {
            type: 'reduce_liquidity',
            target: 'order_book',
            parameters: {
              reduction: 0.9, // 90% reduction
              exchanges: ['binance', 'coinbase']
            }
          }
        ]
      },
      {
        id: 'exchange_outage',
        name: 'Exchange Outage',
        description: 'Simulate major exchange going offline',
        category: 'network',
        severity: 'high',
        duration: 600000, // 10 minutes
        probability: 0.1,
        actions: [
          {
            type: 'kill_connection',
            target: 'exchange',
            parameters: { exchange: 'binance' }
          }
        ]
      },
      
      // Resource Exhaustion
      {
        id: 'cpu_spike',
        name: 'CPU Spike',
        description: 'Simulate CPU exhaustion',
        category: 'resource',
        severity: 'medium',
        duration: 30000,
        probability: 0.2,
        actions: [
          {
            type: 'consume_cpu',
            target: 'system',
            parameters: { 
              cores: 4,
              utilization: 0.95
            }
          }
        ]
      },
      {
        id: 'disk_full',
        name: 'Disk Space Exhaustion',
        description: 'Simulate disk running out of space',
        category: 'resource',
        severity: 'high',
        duration: 60000,
        probability: 0.1,
        actions: [
          {
            type: 'fill_disk',
            target: 'system',
            parameters: { 
              path: '/tmp',
              fillRate: 100 // MB/s
            }
          }
        ]
      },
      
      // Combined Scenarios
      {
        id: 'cascade_failure',
        name: 'Cascading Failure',
        description: 'Multiple failures in sequence',
        category: 'module',
        severity: 'critical',
        duration: 120000,
        probability: 0.05,
        actions: [
          {
            type: 'kill_process',
            target: 'market-intelligence',
            parameters: { force: true }
          },
          {
            type: 'inject_latency',
            target: 'network',
            parameters: { minLatency: 1000 },
            delay: 5000
          },
          {
            type: 'corrupt_data',
            target: 'state_store',
            parameters: { corruption_type: 'random' },
            delay: 10000
          }
        ]
      }
    ];
    
    scenarios.forEach(scenario => {
      this.scenarios.set(scenario.id, scenario);
    });
    
    this.logger.info('Initialized chaos scenarios', {
      total: scenarios.length,
      categories: ['module', 'data', 'network', 'market', 'resource']
    });
  }
  
  public async runScenario(scenarioId: string): Promise<ChaosResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }
    
    if (this.activeScenarios.has(scenarioId)) {
      throw new Error(`Scenario already running: ${scenarioId}`);
    }
    
    this.logger.warn('🔥 CHAOS SCENARIO STARTING', {
      scenario: scenario.name,
      severity: scenario.severity,
      duration: scenario.duration
    });
    
    this.activeScenarios.add(scenarioId);
    const result: ChaosResult = {
      scenarioId,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      systemState: {
        modulesAffected: [],
        servicesDown: [],
        dataIntegrity: 'intact',
        performanceImpact: 0,
        availabilityImpact: 0
      },
      recoveryMetrics: {
        detectionTime: 0,
        recoveryTime: 0,
        dataLoss: false,
        automaticRecovery: false,
        manualIntervention: false,
        rollbackPerformed: false
      },
      passed: false,
      errors: [],
      logs: []
    };
    
    try {
      // Take system snapshot
      this.systemSnapshot = await this.captureSystemState();
      
      // Execute chaos actions
      const executionStart = Date.now();
      await this.executeActions(scenario, result);
      
      // Monitor system during chaos
      await this.monitorChaos(scenario, result);
      
      // Wait for scenario duration
      await new Promise(resolve => setTimeout(resolve, scenario.duration));
      
      // Stop chaos actions
      await this.stopChaosActions(scenario, result);
      
      // Measure recovery
      const recoveryStart = Date.now();
      await this.measureRecovery(scenario, result);
      result.recoveryMetrics.recoveryTime = Date.now() - recoveryStart;
      
      // Validate system state
      const validation = await this.validateSystemState(result);
      result.passed = validation.passed;
      
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
      
      this.logger.info('Chaos scenario completed', {
        scenario: scenario.name,
        passed: result.passed,
        recoveryTime: result.recoveryMetrics.recoveryTime
      });
      
    } catch (error) {
      this.logger.error('Chaos scenario failed', error);
      result.errors.push((error as Error).message);
      result.passed = false;
    } finally {
      this.activeScenarios.delete(scenarioId);
      this.results.push(result);
      this.emit('scenario-complete', result);
    }
    
    return result;
  }
  
  private async executeActions(scenario: ChaosScenario, result: ChaosResult): Promise<void> {
    for (const action of scenario.actions) {
      if (action.delay) {
        await new Promise(resolve => setTimeout(resolve, action.delay));
      }
      
      try {
        await this.executeAction(action, result);
        result.logs.push({
          timestamp: new Date(),
          level: 'info',
          message: `Executed action: ${action.type} on ${action.target}`,
          data: action.parameters
        });
      } catch (error) {
        result.logs.push({
          timestamp: new Date(),
          level: 'error',
          message: `Failed to execute action: ${action.type}`,
          data: { error: (error as Error).message }
        });
      }
    }
  }
  
  private async executeAction(action: ChaosAction, result: ChaosResult): Promise<void> {
    switch (action.type) {
      case 'kill_process':
        await this.killProcess(action.target, action.parameters);
        result.systemState.servicesDown.push(action.target);
        result.systemState.modulesAffected.push(action.target);
        break;
        
      case 'corrupt_data':
        await this.corruptData(action.target, action.parameters);
        result.systemState.dataIntegrity = 'corrupted';
        break;
        
      case 'inject_latency':
        await this.injectLatency(action.target, action.parameters);
        result.systemState.performanceImpact += 30;
        break;
        
      case 'block_network':
        await this.blockNetwork(action.target, action.parameters);
        result.systemState.availabilityImpact += 50;
        break;
        
      case 'consume_memory':
        await this.consumeMemory(action.parameters);
        result.systemState.performanceImpact += 20;
        break;
        
      case 'market_event':
        await this.simulateMarketEvent(action.parameters);
        break;
        
      default:
        this.logger.warn('Unknown action type', { type: action.type });
    }
  }
  
  private async killProcess(target: string, params: any): Promise<void> {
    this.logger.warn(`Killing process: ${target}`);
    
    // In production, would actually kill the process
    // Mock implementation
    this.emit('module-killed', { module: target, force: params.force });
    
    // Simulate process death
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  private async corruptData(target: string, params: any): Promise<void> {
    this.logger.warn(`Corrupting data: ${target}`, params);
    
    // In production, would actually corrupt data
    // Mock implementation
    if (target === 'price_feed' && params.corruption_type === 'spike') {
      this.emit('data-corrupted', {
        target,
        type: params.corruption_type,
        magnitude: params.magnitude
      });
    }
  }
  
  private async injectLatency(target: string, params: any): Promise<void> {
    this.logger.warn(`Injecting latency: ${target}`, params);
    
    // In production, would use tc or iptables to inject latency
    this.emit('latency-injected', {
      target,
      minLatency: params.minLatency,
      maxLatency: params.maxLatency
    });
  }
  
  private async blockNetwork(target: string, params: any): Promise<void> {
    this.logger.warn(`Blocking network: ${target}`, params);
    
    // In production, would use iptables to block traffic
    this.emit('network-blocked', {
      target,
      services: params.services,
      bidirectional: params.bidirectional
    });
  }
  
  private async consumeMemory(params: any): Promise<void> {
    this.logger.warn('Consuming memory', params);
    
    // In production, would allocate memory
    // Mock implementation
    let allocated = 0;
    const interval = setInterval(() => {
      allocated += params.rate;
      if (allocated >= params.maxMB) {
        clearInterval(interval);
      }
    }, 1000);
  }
  
  private async simulateMarketEvent(params: any): Promise<void> {
    this.logger.warn('Simulating market event', params);
    
    this.emit('market-event', {
      type: params.event_type,
      severity: params.drop_percent,
      duration: params.recovery_time
    });
  }
  
  private async monitorChaos(scenario: ChaosScenario, result: ChaosResult): Promise<void> {
    const monitorInterval = setInterval(async () => {
      try {
        // Check system health
        const health = await this.checkSystemHealth();
        
        // Log health status
        result.logs.push({
          timestamp: new Date(),
          level: 'info',
          message: 'System health check',
          data: health
        });
        
        // Detect anomalies
        if (health.anomaliesDetected > 0) {
          result.recoveryMetrics.detectionTime = Date.now() - result.startTime.getTime();
          clearInterval(monitorInterval);
        }
        
      } catch (error) {
        result.logs.push({
          timestamp: new Date(),
          level: 'error',
          message: 'Health check failed',
          data: { error: (error as Error).message }
        });
      }
    }, 1000); // Check every second
    
    // Clean up after scenario
    setTimeout(() => clearInterval(monitorInterval), scenario.duration);
  }
  
  private async checkSystemHealth(): Promise<any> {
    // Mock health check
    return {
      modules: {
        total: 17,
        healthy: 15 + Math.floor(Math.random() * 3),
        degraded: Math.floor(Math.random() * 2),
        failed: Math.floor(Math.random() * 2)
      },
      anomaliesDetected: Math.random() > 0.7 ? 1 : 0,
      performance: {
        latency: 50 + Math.random() * 200,
        throughput: 1000 - Math.random() * 200
      }
    };
  }
  
  private async stopChaosActions(scenario: ChaosScenario, result: ChaosResult): Promise<void> {
    this.logger.info('Stopping chaos actions', { scenario: scenario.name });
    
    // Reverse chaos actions
    for (const action of scenario.actions) {
      try {
        await this.reverseAction(action, result);
      } catch (error) {
        result.logs.push({
          timestamp: new Date(),
          level: 'error',
          message: `Failed to reverse action: ${action.type}`,
          data: { error: (error as Error).message }
        });
      }
    }
  }
  
  private async reverseAction(action: ChaosAction, result: ChaosResult): Promise<void> {
    switch (action.type) {
      case 'kill_process':
        // Restart process
        this.emit('module-restart', { module: action.target });
        break;
        
      case 'block_network':
        // Unblock network
        this.emit('network-unblocked', { target: action.target });
        break;
        
      case 'inject_latency':
        // Remove latency
        this.emit('latency-removed', { target: action.target });
        break;
    }
  }
  
  private async measureRecovery(scenario: ChaosScenario, result: ChaosResult): Promise<void> {
    const maxWaitTime = 300000; // 5 minutes max
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const health = await this.checkSystemHealth();
      
      if (health.modules.failed === 0 && health.anomaliesDetected === 0) {
        result.recoveryMetrics.automaticRecovery = true;
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5s
    }
    
    // Check if manual intervention was needed
    if (Date.now() - startTime >= maxWaitTime) {
      result.recoveryMetrics.manualIntervention = true;
    }
  }
  
  private async captureSystemState(): Promise<any> {
    // Capture current system state for comparison
    return {
      timestamp: Date.now(),
      modules: await this.getModuleStates(),
      metrics: await this.getSystemMetrics(),
      configurations: await this.getConfigurations()
    };
  }
  
  private async getModuleStates(): Promise<any> {
    // Mock module states
    return {
      'ai-core': { status: 'running', version: '2.4.0' },
      'risk-engine': { status: 'running', version: '2.4.0' },
      'execution-engine': { status: 'running', version: '2.4.0' }
    };
  }
  
  private async getSystemMetrics(): Promise<any> {
    // Mock system metrics
    return {
      cpu: 35,
      memory: 4096,
      disk: 80,
      network: { in: 100, out: 150 }
    };
  }
  
  private async getConfigurations(): Promise<any> {
    // Mock configurations
    return {
      riskLimits: { maxDrawdown: 0.15, maxPosition: 0.25 },
      tradingEnabled: true
    };
  }
  
  private async validateSystemState(result: ChaosResult): Promise<{ passed: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    // Check if all services are back online
    if (result.systemState.servicesDown.length > 0) {
      const stillDown = await this.checkServicesStatus(result.systemState.servicesDown);
      if (stillDown.length > 0) {
        issues.push(`Services still down: ${stillDown.join(', ')}`);
      }
    }
    
    // Check data integrity
    if (result.systemState.dataIntegrity === 'corrupted') {
      const dataRecovered = await this.checkDataIntegrity();
      if (!dataRecovered) {
        issues.push('Data integrity not recovered');
        result.recoveryMetrics.dataLoss = true;
      } else {
        result.systemState.dataIntegrity = 'recovered';
      }
    }
    
    // Check performance recovery
    const currentPerf = await this.measurePerformance();
    if (currentPerf.degradation > 10) {
      issues.push(`Performance still degraded: ${currentPerf.degradation}%`);
    }
    
    return {
      passed: issues.length === 0,
      issues
    };
  }
  
  private async checkServicesStatus(services: string[]): Promise<string[]> {
    // Mock: randomly recover some services
    return services.filter(() => Math.random() > 0.8);
  }
  
  private async checkDataIntegrity(): Promise<boolean> {
    // Mock: 90% chance of recovery
    return Math.random() > 0.1;
  }
  
  private async measurePerformance(): Promise<{ degradation: number }> {
    // Mock: random performance degradation
    return { degradation: Math.random() * 20 };
  }
  
  public async runRandomScenarios(count: number): Promise<ChaosReport> {
    this.logger.info(`Running ${count} random chaos scenarios`);
    
    const scenarioList = Array.from(this.scenarios.values());
    const selectedScenarios: ChaosScenario[] = [];
    
    // Select random scenarios based on probability
    for (let i = 0; i < count; i++) {
      const candidates = scenarioList.filter(s => Math.random() < s.probability);
      if (candidates.length > 0) {
        const selected = candidates[Math.floor(Math.random() * candidates.length)];
        selectedScenarios.push(selected);
      }
    }
    
    // Run scenarios sequentially
    for (const scenario of selectedScenarios) {
      await this.runScenario(scenario.id);
      
      // Wait between scenarios
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30s cooldown
    }
    
    return this.generateReport();
  }
  
  public async runCriticalScenarios(): Promise<ChaosReport> {
    this.logger.warn('Running critical chaos scenarios');
    
    const criticalScenarios = Array.from(this.scenarios.values())
      .filter(s => s.severity === 'critical');
    
    for (const scenario of criticalScenarios) {
      await this.runScenario(scenario.id);
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1min cooldown
    }
    
    return this.generateReport();
  }
  
  private generateReport(): ChaosReport {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    const avgRecoveryTime = this.results.length > 0
      ? this.results.reduce((sum, r) => sum + r.recoveryMetrics.recoveryTime, 0) / this.results.length
      : 0;
    
    const criticalFailures: string[] = [];
    const recommendations: string[] = [];
    
    // Analyze results
    this.results.forEach(result => {
      if (!result.passed && this.scenarios.get(result.scenarioId)?.severity === 'critical') {
        criticalFailures.push(
          `${this.scenarios.get(result.scenarioId)?.name}: ${result.errors.join(', ')}`
        );
      }
      
      if (result.recoveryMetrics.manualIntervention) {
        recommendations.push(
          `Improve automatic recovery for: ${this.scenarios.get(result.scenarioId)?.name}`
        );
      }
      
      if (result.recoveryMetrics.dataLoss) {
        recommendations.push(
          `Implement better data protection for: ${this.scenarios.get(result.scenarioId)?.name}`
        );
      }
    });
    
    // General recommendations
    if (avgRecoveryTime > 60000) {
      recommendations.push('Average recovery time exceeds 1 minute - improve detection and recovery mechanisms');
    }
    
    const failureRate = failed / (passed + failed);
    if (failureRate > 0.2) {
      recommendations.push('High failure rate detected - system needs better resilience');
    }
    
    const report: ChaosReport = {
      timestamp: new Date(),
      scenariosRun: this.results.length,
      passed,
      failed,
      avgRecoveryTime,
      criticalFailures,
      recommendations: [...new Set(recommendations)], // Remove duplicates
      detailedResults: this.results
    };
    
    this.logger.info('Chaos report generated', {
      scenarios: report.scenariosRun,
      passRate: ((passed / (passed + failed)) * 100).toFixed(2) + '%',
      avgRecovery: (avgRecoveryTime / 1000).toFixed(2) + 's'
    });
    
    return report;
  }
  
  public getScenarios(): ChaosScenario[] {
    return Array.from(this.scenarios.values());
  }
  
  public getResults(): ChaosResult[] {
    return [...this.results];
  }
  
  public clearResults(): void {
    this.results = [];
    this.logger.info('Cleared chaos test results');
  }
} 