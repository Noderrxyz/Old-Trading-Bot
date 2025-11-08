import logger from '../utils/logger.js';
import { TelemetryBus, TelemetryEvent } from '../telemetry/TelemetryBus.js';
import { LaunchManager } from './LaunchManager.js';

interface ScalingConfig {
  minAgents: number;
  maxAgents: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownPeriod: number;
  metricsWindow: number;
  telemetryEnabled: boolean;
}

const DEFAULT_CONFIG: ScalingConfig = {
  minAgents: 1,
  maxAgents: 10,
  scaleUpThreshold: 0.8,
  scaleDownThreshold: 0.2,
  cooldownPeriod: 300000, // 5 minutes
  metricsWindow: 60000, // 1 minute
  telemetryEnabled: true
};

export class AutoScaler {
  private static instance: AutoScaler;
  private config: ScalingConfig;
  private launchManager: LaunchManager;
  private telemetryBus: TelemetryBus;
  private metrics: Map<string, number[]>;
  private lastScaleTime: number;
  private activeAgents: Set<string>;

  private constructor(config: Partial<ScalingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.launchManager = LaunchManager.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    this.metrics = new Map();
    this.lastScaleTime = Date.now();
    this.activeAgents = new Set();
  }

  public static getInstance(config?: Partial<ScalingConfig>): AutoScaler {
    if (!AutoScaler.instance) {
      AutoScaler.instance = new AutoScaler(config);
    }
    return AutoScaler.instance;
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing AutoScaler');
    this.telemetryBus.on('agent_launched', (event: TelemetryEvent) => {
      const data = event.data as { agentId: string };
      this.handleAgentLaunched(data);
    });
    this.telemetryBus.on('agent_stopped', (event: TelemetryEvent) => {
      const data = event.data as { agentId: string };
      this.handleAgentStopped(data);
    });
    this.telemetryBus.on('agent_failed', (event: TelemetryEvent) => {
      const data = event.data as { agentId: string };
      this.handleAgentFailed(data);
    });
    await this.ensureMinAgents();
  }

  private async ensureMinAgents(): Promise<void> {
    const currentCount = this.activeAgents.size;
    if (currentCount < this.config.minAgents) {
      const needed = this.config.minAgents - currentCount;
      logger.info(`Scaling up to minimum agents: ${needed} needed`);
      await this.scaleUp(needed);
    }
  }

  public updateMetrics(metricName: string, value: number): void {
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }
    const values = this.metrics.get(metricName)!;
    values.push(value);

    // Keep only the last metricsWindow worth of data
    const maxValues = Math.floor(this.config.metricsWindow / 1000);
    if (values.length > maxValues) {
      values.splice(0, values.length - maxValues);
    }

    this.checkScaling();
  }

  private checkScaling(): void {
    const now = Date.now();
    if (now - this.lastScaleTime < this.config.cooldownPeriod) {
      return;
    }

    const currentCount = this.activeAgents.size;
    const avgLoad = this.calculateAverageLoad();

    if (avgLoad > this.config.scaleUpThreshold && currentCount < this.config.maxAgents) {
      this.scaleUp(1);
    } else if (avgLoad < this.config.scaleDownThreshold && currentCount > this.config.minAgents) {
      this.scaleDown(1);
    }
  }

  private calculateAverageLoad(): number {
    let totalLoad = 0;
    let count = 0;

    for (const [metricName, values] of this.metrics) {
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        totalLoad += avg;
        count++;
      }
    }

    return count > 0 ? totalLoad / count : 0;
  }

  private async scaleUp(count: number): Promise<void> {
    logger.info(`Scaling up by ${count} agents`);
    this.lastScaleTime = Date.now();

    for (let i = 0; i < count; i++) {
      try {
        const agentId = await this.launchManager.launch({
          strategyId: 'default',
          capital: 1000,
          market: 'ETH/USD',
          trustThrottle: true,
          maxRetries: 3,
          retryDelay: 5000,
          telemetryEnabled: true
        });
        this.activeAgents.add(agentId);
      } catch (error) {
        logger.error(`Failed to scale up agent: ${error}`);
      }
    }

    this.emitTelemetry('scale_up', { count });
  }

  private async scaleDown(count: number): Promise<void> {
    logger.info(`Scaling down by ${count} agents`);
    this.lastScaleTime = Date.now();

    const agentsToStop = Array.from(this.activeAgents).slice(0, count);
    for (const agentId of agentsToStop) {
      try {
        await this.launchManager.stopAgent(agentId);
        this.activeAgents.delete(agentId);
      } catch (error) {
        logger.error(`Failed to scale down agent: ${error}`);
      }
    }

    this.emitTelemetry('scale_down', { count });
  }

  private handleAgentLaunched(data: { agentId: string }): void {
    this.activeAgents.add(data.agentId);
  }

  private handleAgentStopped(data: { agentId: string }): void {
    this.activeAgents.delete(data.agentId);
  }

  private handleAgentFailed(data: { agentId: string }): void {
    this.activeAgents.delete(data.agentId);
    this.ensureMinAgents();
  }

  private emitTelemetry(event: string, data: Record<string, unknown>): void {
    if (this.config.telemetryEnabled) {
      this.telemetryBus.emit(event, {
        ...data,
        timestamp: Date.now(),
        activeAgents: this.activeAgents.size
      });
    }
  }

  public getActiveAgents(): string[] {
    return Array.from(this.activeAgents);
  }

  public getMetrics(): Map<string, number[]> {
    return new Map(this.metrics);
  }

  public async cleanup(): Promise<void> {
    this.metrics.clear();
    this.activeAgents.clear();
    this.telemetryBus.off('agent_launched', (event: TelemetryEvent) => {
      const data = event.data as { agentId: string };
      this.handleAgentLaunched(data);
    });
    this.telemetryBus.off('agent_stopped', (event: TelemetryEvent) => {
      const data = event.data as { agentId: string };
      this.handleAgentStopped(data);
    });
    this.telemetryBus.off('agent_failed', (event: TelemetryEvent) => {
      const data = event.data as { agentId: string };
      this.handleAgentFailed(data);
    });
  }
} 