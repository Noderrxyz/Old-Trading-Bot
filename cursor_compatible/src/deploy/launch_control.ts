import logger from '../utils/logger.js';
import { AgentRegistry } from '../core/agent_registry.js';
import { 
  LaunchControlConfig, 
  AutoScaleConfig, 
  LaunchPolicy, 
  LaunchEvent, 
  AgentStatus, 
  AgentConfig, 
  AgentHealthMetrics, 
  LiveAgent,
  DEFAULT_LAUNCH_CONTROL_CONFIG,
  DEFAULT_AUTO_SCALE_CONFIG
} from './types/launch_control.types.js';

export class LaunchControl {
  private config: LaunchControlConfig;
  private autoScaleConfig: AutoScaleConfig;
  private policies: Map<string, LaunchPolicy>;
  private eventListeners: Set<(event: LaunchEvent) => void>;
  private agentRegistry: AgentRegistry;
  private logger: typeof logger;

  constructor(
    config: Partial<LaunchControlConfig> = {},
    autoScaleConfig: Partial<AutoScaleConfig> = {}
  ) {
    this.config = { ...DEFAULT_LAUNCH_CONTROL_CONFIG, ...config };
    this.autoScaleConfig = { ...DEFAULT_AUTO_SCALE_CONFIG, ...autoScaleConfig };
    this.policies = new Map();
    this.eventListeners = new Set();
    this.agentRegistry = AgentRegistry.getInstance();
    this.logger = logger;
  }

  public configure(config: Partial<LaunchControlConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Launch control configuration updated', { config: this.config });
  }

  public configureAutoScaling(config: Partial<AutoScaleConfig>): void {
    this.autoScaleConfig = { ...this.autoScaleConfig, ...config };
    this.logger.info('Auto-scaling configuration updated', { config: this.autoScaleConfig });
  }

  public addPolicy(policy: LaunchPolicy): void {
    this.policies.set(policy.id, policy);
    this.logger.info('Launch policy added', { policyId: policy.id });
  }

  public removePolicy(policyId: string): void {
    this.policies.delete(policyId);
    this.logger.info('Launch policy removed', { policyId });
  }

  public async launchAgent(config: AgentConfig): Promise<LiveAgent> {
    const agent = await this.createAgent(config);
    await this.agentRegistry.registerAgent(agent);
    
    this.emitEvent({
      type: 'DEPLOY',
      timestamp: Date.now(),
      agentId: agent.id,
      details: { config }
    });

    return agent;
  }

  public async scaleAgents(metrics: AgentHealthMetrics[]): Promise<void> {
    const avgPerformance = metrics.reduce((sum, m) => sum + m.performanceScore, 0) / metrics.length;
    const currentAgents = this.agentRegistry.getActiveAgents().length;

    if (avgPerformance > this.autoScaleConfig.scaleUpThreshold && 
        currentAgents < this.autoScaleConfig.maxAgents) {
      await this.scaleUp();
    } else if (avgPerformance < this.autoScaleConfig.scaleDownThreshold && 
               currentAgents > this.autoScaleConfig.minAgents) {
      await this.scaleDown();
    }
  }

  private async scaleUp(): Promise<void> {
    const newAgent = await this.createAgent({
      strategy: 'default',
      walletAddress: '0x0000000000000000000000000000000000000000',
      maxGasPrice: 100,
      targetRegions: ['us-east', 'eu-west'],
      minTrustScore: 0.5,
      warmupDurationMs: 5000,
      cooldownDurationMs: 5000,
      maxConcurrentTrades: this.config.maxConcurrentTrades,
      riskLimit: this.config.riskLimit,
      trustScoreThreshold: this.config.trustScoreThreshold
    });

    await this.agentRegistry.registerAgent(newAgent);
    this.emitEvent({
      type: 'SCALE',
      timestamp: Date.now(),
      agentId: newAgent.id,
      details: { action: 'scale_up' }
    });
  }

  private async scaleDown(): Promise<void> {
    const agents = this.agentRegistry.getActiveAgents();
    if (agents.length > 0) {
      const agentToTerminate = agents[0];
      await this.agentRegistry.updateAgentStatus(agentToTerminate.id, AgentStatus.Terminated);
      
      this.emitEvent({
        type: 'SCALE',
        timestamp: Date.now(),
        agentId: agentToTerminate.id,
        details: { action: 'scale_down' }
      });
    }
  }

  private async createAgent(config: AgentConfig): Promise<LiveAgent> {
    return {
      id: `agent-${Date.now()}`,
      status: AgentStatus.Pending,
      config,
      health: {
        lastHeartbeat: Date.now(),
        errorRate: 0,
        latencyMs: 0,
        performanceScore: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        trustScore: 0
      },
      lastUpdate: Date.now(),
      startTime: Date.now(),
      activeVenues: [],
      metrics: {
        tradesExecuted: 0,
        capitalDeployed: 0,
        pnl: 0,
        slippage: 0
      }
    };
  }

  public addEventListener(listener: (event: LaunchEvent) => void): void {
    this.eventListeners.add(listener);
  }

  public removeEventListener(listener: (event: LaunchEvent) => void): void {
    this.eventListeners.delete(listener);
  }

  private emitEvent(event: LaunchEvent): void {
    this.eventListeners.forEach(listener => listener(event));
  }
} 