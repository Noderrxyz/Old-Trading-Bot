import { EventEmitter } from 'events';
import * as winston from 'winston';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Chaos scenario configuration
 */
export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  category: 'network' | 'resource' | 'application' | 'market' | 'infrastructure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  duration: number; // milliseconds
  probability: number; // 0-1
  actions: ChaosAction[];
  validationChecks: ValidationCheck[];
}

/**
 * Chaos action to execute
 */
export interface ChaosAction {
  type: string;
  target: string;
  parameters: Record<string, any>;
  delay?: number; // milliseconds before execution
}

/**
 * Validation check after chaos
 */
export interface ValidationCheck {
  name: string;
  type: 'latency' | 'availability' | 'consistency' | 'performance';
  threshold: number;
  critical: boolean;
}

/**
 * Chaos test result
 */
export interface ChaosTestResult {
  scenarioId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  passed: boolean;
  recoveryTime: number;
  validationResults: ValidationResult[];
  systemMetrics: SystemMetrics;
  errors: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  check: string;
  passed: boolean;
  value: number;
  threshold: number;
  message: string;
  critical?: boolean;
}

/**
 * System metrics during chaos
 */
export interface SystemMetrics {
  avgLatency: number;
  p99Latency: number;
  errorRate: number;
  throughput: number;
  cpuUsage: number;
  memoryUsage: number;
}

/**
 * Enhanced chaos testing engine
 */
export class EnhancedChaosEngine extends EventEmitter {
  private logger: winston.Logger;
  private scenarios: Map<string, ChaosScenario>;
  private activeScenarios: Set<string> = new Set();
  private metricsCollector: MetricsCollector;
  
  constructor(logger: winston.Logger) {
    super();
    
    this.logger = logger;
    this.scenarios = new Map();
    this.metricsCollector = new MetricsCollector();
    
    this.initializeScenarios();
  }
  
  /**
   * Initialize chaos scenarios
   */
  private initializeScenarios(): void {
    // Network chaos scenarios
    this.addScenario({
      id: 'network_partition',
      name: 'Network Partition',
      description: 'Simulate network partition between services',
      category: 'network',
      severity: 'high',
      duration: 60000,
      probability: 0.1,
      actions: [
        {
          type: 'iptables_drop',
          target: 'redis',
          parameters: { direction: 'both', percentage: 100 }
        }
      ],
      validationChecks: [
        {
          name: 'service_availability',
          type: 'availability',
          threshold: 0.95,
          critical: true
        },
        {
          name: 'data_consistency',
          type: 'consistency',
          threshold: 1.0,
          critical: true
        }
      ]
    });
    
    this.addScenario({
      id: 'latency_injection',
      name: 'Latency Injection',
      description: 'Add artificial latency to network calls',
      category: 'network',
      severity: 'medium',
      duration: 30000,
      probability: 0.2,
      actions: [
        {
          type: 'tc_delay',
          target: 'eth0',
          parameters: { delay: 100, jitter: 50, correlation: 25 }
        }
      ],
      validationChecks: [
        {
          name: 'p99_latency',
          type: 'latency',
          threshold: 500,
          critical: false
        }
      ]
    });
    
    // Resource chaos scenarios
    this.addScenario({
      id: 'cpu_stress',
      name: 'CPU Stress',
      description: 'Consume CPU resources to test performance under load',
      category: 'resource',
      severity: 'medium',
      duration: 45000,
      probability: 0.15,
      actions: [
        {
          type: 'stress_cpu',
          target: 'local',
          parameters: { cores: 2, load: 80 }
        }
      ],
      validationChecks: [
        {
          name: 'cpu_usage',
          type: 'performance',
          threshold: 90,
          critical: false
        },
        {
          name: 'response_time',
          type: 'latency',
          threshold: 200,
          critical: true
        }
      ]
    });
    
    this.addScenario({
      id: 'memory_leak',
      name: 'Memory Leak Simulation',
      description: 'Gradually consume memory to test OOM handling',
      category: 'resource',
      severity: 'high',
      duration: 120000,
      probability: 0.05,
      actions: [
        {
          type: 'memory_hog',
          target: 'local',
          parameters: { rate: 100, max: 2048 } // MB
        }
      ],
      validationChecks: [
        {
          name: 'memory_usage',
          type: 'performance',
          threshold: 85,
          critical: true
        }
      ]
    });
    
    // Application chaos scenarios
    this.addScenario({
      id: 'service_crash',
      name: 'Service Crash',
      description: 'Kill a critical service process',
      category: 'application',
      severity: 'critical',
      duration: 5000,
      probability: 0.05,
      actions: [
        {
          type: 'kill_process',
          target: 'noderr-core',
          parameters: { signal: 'SIGKILL' }
        }
      ],
      validationChecks: [
        {
          name: 'service_recovery',
          type: 'availability',
          threshold: 30000, // 30 seconds
          critical: true
        }
      ]
    });
    
    this.addScenario({
      id: 'data_corruption',
      name: 'Data Corruption',
      description: 'Corrupt market data to test validation',
      category: 'application',
      severity: 'high',
      duration: 10000,
      probability: 0.1,
      actions: [
        {
          type: 'corrupt_data',
          target: 'market_feed',
          parameters: { 
            fields: ['price', 'volume'],
            corruption_type: 'random',
            rate: 0.1
          }
        }
      ],
      validationChecks: [
        {
          name: 'data_validation_rate',
          type: 'consistency',
          threshold: 0.99,
          critical: true
        }
      ]
    });
    
    // Market chaos scenarios
    this.addScenario({
      id: 'flash_crash',
      name: 'Flash Crash',
      description: 'Simulate sudden market crash',
      category: 'market',
      severity: 'critical',
      duration: 60000,
      probability: 0.02,
      actions: [
        {
          type: 'market_event',
          target: 'price_feed',
          parameters: {
            event_type: 'crash',
            magnitude: -0.15, // 15% drop
            duration: 5000
          }
        }
      ],
      validationChecks: [
        {
          name: 'circuit_breaker_activation',
          type: 'availability',
          threshold: 1000, // 1 second
          critical: true
        },
        {
          name: 'position_protection',
          type: 'consistency',
          threshold: 1.0,
          critical: true
        }
      ]
    });
    
    this.addScenario({
      id: 'liquidity_crisis',
      name: 'Liquidity Crisis',
      description: 'Simulate extreme spread widening',
      category: 'market',
      severity: 'high',
      duration: 300000,
      probability: 0.05,
      actions: [
        {
          type: 'market_event',
          target: 'orderbook',
          parameters: {
            event_type: 'liquidity_drain',
            spread_multiplier: 10,
            depth_reduction: 0.9
          }
        }
      ],
      validationChecks: [
        {
          name: 'execution_quality',
          type: 'performance',
          threshold: 0.5,
          critical: false
        }
      ]
    });
  }
  
  /**
   * Add a chaos scenario
   */
  addScenario(scenario: ChaosScenario): void {
    this.scenarios.set(scenario.id, scenario);
    this.logger.info('Added chaos scenario', { 
      id: scenario.id, 
      name: scenario.name,
      severity: scenario.severity 
    });
  }
  
  /**
   * Run a specific chaos scenario
   */
  async runScenario(scenarioId: string): Promise<ChaosTestResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }
    
    if (this.activeScenarios.has(scenarioId)) {
      throw new Error(`Scenario ${scenarioId} is already running`);
    }
    
    this.activeScenarios.add(scenarioId);
    this.emit('scenarioStart', scenario);
    
    const result: ChaosTestResult = {
      scenarioId,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      passed: true,
      recoveryTime: 0,
      validationResults: [],
      systemMetrics: await this.metricsCollector.getBaseline(),
      errors: []
    };
    
    try {
      // Start metrics collection
      this.metricsCollector.startCollection();
      
      // Execute chaos actions
      await this.executeActions(scenario.actions);
      
      // Wait for scenario duration
      await this.wait(scenario.duration);
      
      // Stop chaos actions
      await this.stopActions(scenario.actions);
      
      // Measure recovery
      const recoveryStart = Date.now();
      await this.waitForRecovery(scenario);
      result.recoveryTime = Date.now() - recoveryStart;
      
      // Run validation checks
      result.validationResults = await this.runValidations(scenario.validationChecks);
      
      // Determine if test passed
      result.passed = result.validationResults.every(v => v.passed || !v.critical);
      
      // Collect final metrics
      result.systemMetrics = await this.metricsCollector.getMetrics();
      
    } catch (error) {
      this.logger.error('Chaos scenario failed', { scenarioId, error });
      result.errors.push((error as Error).message);
      result.passed = false;
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
      
      this.activeScenarios.delete(scenarioId);
      this.metricsCollector.stopCollection();
      
      this.emit('scenarioComplete', result);
    }
    
    return result;
  }
  
  /**
   * Execute chaos actions
   */
  private async executeActions(actions: ChaosAction[]): Promise<void> {
    for (const action of actions) {
      if (action.delay) {
        await this.wait(action.delay);
      }
      
      await this.executeAction(action);
    }
  }
  
  /**
   * Execute a single chaos action
   */
  private async executeAction(action: ChaosAction): Promise<void> {
    this.logger.info('Executing chaos action', action);
    
    switch (action.type) {
      case 'iptables_drop':
        await this.executeIptablesDrop(action);
        break;
      
      case 'tc_delay':
        await this.executeTcDelay(action);
        break;
      
      case 'stress_cpu':
        await this.executeStressCpu(action);
        break;
      
      case 'memory_hog':
        await this.executeMemoryHog(action);
        break;
      
      case 'kill_process':
        await this.executeKillProcess(action);
        break;
      
      case 'corrupt_data':
        await this.executeCorruptData(action);
        break;
      
      case 'market_event':
        await this.executeMarketEvent(action);
        break;
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
  
  /**
   * Network partition using iptables
   */
  private async executeIptablesDrop(action: ChaosAction): Promise<void> {
    const { target, parameters } = action;
    const { direction, percentage } = parameters;
    
    // This is a simplified example - in production, use proper network namespaces
    const cmd = `sudo iptables -A INPUT -s ${target} -m statistic --mode random --probability ${percentage/100} -j DROP`;
    
    try {
      await execAsync(cmd);
      this.logger.info('Applied iptables rule', { target, percentage });
    } catch (error) {
      this.logger.error('Failed to apply iptables rule', error);
    }
  }
  
  /**
   * Network latency using tc
   */
  private async executeTcDelay(action: ChaosAction): Promise<void> {
    const { target, parameters } = action;
    const { delay, jitter, correlation } = parameters;
    
    const cmd = `sudo tc qdisc add dev ${target} root netem delay ${delay}ms ${jitter}ms ${correlation}%`;
    
    try {
      await execAsync(cmd);
      this.logger.info('Applied network delay', { target, delay, jitter });
    } catch (error) {
      this.logger.error('Failed to apply network delay', error);
    }
  }
  
  /**
   * CPU stress test
   */
  private async executeStressCpu(action: ChaosAction): Promise<void> {
    const { parameters } = action;
    const { cores, load } = parameters;
    
    // Use stress-ng or similar tool
    const cmd = `stress-ng --cpu ${cores} --cpu-load ${load} --timeout ${30}s &`;
    
    try {
      await execAsync(cmd);
      this.logger.info('Started CPU stress', { cores, load });
    } catch (error) {
      this.logger.error('Failed to start CPU stress', error);
    }
  }
  
  /**
   * Memory consumption
   */
  private async executeMemoryHog(action: ChaosAction): Promise<void> {
    const { parameters } = action;
    const { rate, max } = parameters;
    
    // Implement memory allocation logic
    this.emit('memoryHog', { rate, max });
  }
  
  /**
   * Kill process
   */
  private async executeKillProcess(action: ChaosAction): Promise<void> {
    const { target, parameters } = action;
    const { signal } = parameters;
    
    const cmd = `pkill -${signal} ${target}`;
    
    try {
      await execAsync(cmd);
      this.logger.info('Killed process', { target, signal });
    } catch (error) {
      this.logger.error('Failed to kill process', error);
    }
  }
  
  /**
   * Corrupt data
   */
  private async executeCorruptData(action: ChaosAction): Promise<void> {
    const { target, parameters } = action;
    
    // Emit event for data corruption
    this.emit('corruptData', { target, parameters });
  }
  
  /**
   * Market event simulation
   */
  private async executeMarketEvent(action: ChaosAction): Promise<void> {
    const { target, parameters } = action;
    
    // Emit market event
    this.emit('marketEvent', { target, parameters });
  }
  
  /**
   * Stop chaos actions
   */
  private async stopActions(actions: ChaosAction[]): Promise<void> {
    for (const action of actions) {
      await this.stopAction(action);
    }
  }
  
  /**
   * Stop a single chaos action
   */
  private async stopAction(action: ChaosAction): Promise<void> {
    switch (action.type) {
      case 'iptables_drop':
        // Remove iptables rule
        const { target } = action;
        await execAsync(`sudo iptables -D INPUT -s ${target} -j DROP`);
        break;
      
      case 'tc_delay':
        // Remove tc rule
        await execAsync(`sudo tc qdisc del dev ${action.target} root netem`);
        break;
      
      case 'stress_cpu':
        // Kill stress processes
        await execAsync('pkill stress-ng');
        break;
      
      // Other cleanup as needed
    }
  }
  
  /**
   * Wait for system recovery
   */
  private async waitForRecovery(scenario: ChaosScenario): Promise<void> {
    const maxWait = 300000; // 5 minutes
    const checkInterval = 1000; // 1 second
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const healthy = await this.checkSystemHealth();
      if (healthy) {
        return;
      }
      
      await this.wait(checkInterval);
    }
    
    throw new Error('System did not recover within timeout');
  }
  
  /**
   * Check system health
   */
  private async checkSystemHealth(): Promise<boolean> {
    // Implement health checks
    return true;
  }
  
  /**
   * Run validation checks
   */
  private async runValidations(checks: ValidationCheck[]): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    
    for (const check of checks) {
      const result = await this.runValidation(check);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Run a single validation check
   */
  private async runValidation(check: ValidationCheck): Promise<ValidationResult> {
    // Implement validation logic based on check type
    const value = await this.getMetricValue(check.type, check.name);
    const passed = this.evaluateThreshold(value, check.threshold, check.type);
    
    return {
      check: check.name,
      passed,
      value,
      threshold: check.threshold,
      message: passed ? 'Check passed' : `Value ${value} exceeds threshold ${check.threshold}`,
      critical: check.critical
    } as ValidationResult;
  }
  
  /**
   * Get metric value
   */
  private async getMetricValue(type: string, name: string): Promise<number> {
    // Implement metric collection
    return 0;
  }
  
  /**
   * Evaluate threshold
   */
  private evaluateThreshold(value: number, threshold: number, type: string): boolean {
    switch (type) {
      case 'latency':
      case 'performance':
        return value <= threshold;
      case 'availability':
      case 'consistency':
        return value >= threshold;
      default:
        return true;
    }
  }
  
  /**
   * Wait for specified duration
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Run random chaos scenarios
   */
  async runRandomChaos(duration: number): Promise<void> {
    const endTime = Date.now() + duration;
    
    while (Date.now() < endTime) {
      // Select random scenario based on probability
      const scenario = this.selectRandomScenario();
      if (scenario) {
        try {
          await this.runScenario(scenario.id);
        } catch (error) {
          this.logger.error('Random chaos scenario failed', error);
        }
      }
      
      // Wait before next chaos
      await this.wait(Math.random() * 60000 + 30000); // 30s-90s
    }
  }
  
  /**
   * Select random scenario based on probability
   */
  private selectRandomScenario(): ChaosScenario | null {
    const scenarios = Array.from(this.scenarios.values());
    const random = Math.random();
    
    for (const scenario of scenarios) {
      if (random < scenario.probability) {
        return scenario;
      }
    }
    
    return null;
  }
}

/**
 * Metrics collector for chaos testing
 */
class MetricsCollector {
  private metrics: SystemMetrics[] = [];
  private collecting: boolean = false;
  
  startCollection(): void {
    this.collecting = true;
    this.metrics = [];
  }
  
  stopCollection(): void {
    this.collecting = false;
  }
  
  async getBaseline(): Promise<SystemMetrics> {
    // Implement baseline metrics collection
    return {
      avgLatency: 50,
      p99Latency: 100,
      errorRate: 0.001,
      throughput: 1000,
      cpuUsage: 20,
      memoryUsage: 40
    };
  }
  
  async getMetrics(): Promise<SystemMetrics> {
    // Implement metrics aggregation
    return {
      avgLatency: 75,
      p99Latency: 150,
      errorRate: 0.01,
      throughput: 800,
      cpuUsage: 60,
      memoryUsage: 65
    };
  }
} 