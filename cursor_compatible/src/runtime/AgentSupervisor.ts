import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { LaunchManager } from '../orchestration/LaunchManager.js';
import { AlphaDecayWatcher } from '../feedback/AlphaDecayWatcher.js';
import fs from 'fs/promises';
import path from 'path';

interface SupervisorConfig {
  criticalDrawdown: number;
  maxReverts: number;
  unresponsiveTimeout: number;
  quarantineLogPath: string;
  telemetryEnabled: boolean;
}

const DEFAULT_CONFIG: SupervisorConfig = {
  criticalDrawdown: 0.3,
  maxReverts: 3,
  unresponsiveTimeout: 30000,
  quarantineLogPath: 'logs/quarantine_log.jsonl',
  telemetryEnabled: true
};

interface AgentState {
  id: string;
  status: 'active' | 'quarantined' | 'terminated';
  revertCount: number;
  lastHeartbeat: number;
  finalState?: any;
}

export class AgentSupervisor {
  private static instance: AgentSupervisor;
  private config: SupervisorConfig;
  private telemetryBus: TelemetryBus;
  private launchManager: LaunchManager;
  private decayWatcher: AlphaDecayWatcher;
  private agentStates: Map<string, AgentState>;

  private constructor(config: Partial<SupervisorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.launchManager = LaunchManager.getInstance();
    this.decayWatcher = AlphaDecayWatcher.getInstance();
    this.agentStates = new Map();
  }

  public static getInstance(config?: Partial<SupervisorConfig>): AgentSupervisor {
    if (!AgentSupervisor.instance) {
      AgentSupervisor.instance = new AgentSupervisor(config);
    }
    return AgentSupervisor.instance;
  }

  public async monitorAgent(agentId: string): Promise<void> {
    const state: AgentState = {
      id: agentId,
      status: 'active',
      revertCount: 0,
      lastHeartbeat: Date.now()
    };
    this.agentStates.set(agentId, state);

    // Start monitoring loop
    setInterval(() => this.checkAgent(agentId), 5000);
  }

  private async checkAgent(agentId: string): Promise<void> {
    const state = this.agentStates.get(agentId);
    if (!state || state.status !== 'active') return;

    const metrics = this.decayWatcher.getMetrics(agentId);
    if (!metrics) return;

    // Check for critical drawdown
    if (metrics.maxDrawdown > this.config.criticalDrawdown) {
      await this.quarantine(agentId, 'critical_drawdown', metrics);
      return;
    }

    // Check for unresponsive behavior
    if (Date.now() - state.lastHeartbeat > this.config.unresponsiveTimeout) {
      await this.quarantine(agentId, 'unresponsive', metrics);
      return;
    }

    // Update heartbeat
    state.lastHeartbeat = Date.now();
  }

  public async quarantine(agentId: string, reason: string, metrics?: any): Promise<void> {
    const state = this.agentStates.get(agentId);
    if (!state || state.status !== 'active') return;

    state.status = 'quarantined';
    state.finalState = metrics;

    // Log quarantine event
    await this.logQuarantine(agentId, reason, metrics);

    // Detach from strategy pool
    this.emitTelemetry('agent_quarantined', {
      agentId,
      reason,
      metrics
    });

    // Stop the agent
    await this.launchManager.stopAgent(agentId);
  }

  private async logQuarantine(agentId: string, reason: string, metrics?: any): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      reason,
      metrics,
      finalState: this.agentStates.get(agentId)?.finalState
    };

    try {
      await fs.mkdir(path.dirname(this.config.quarantineLogPath), { recursive: true });
      await fs.appendFile(
        this.config.quarantineLogPath,
        JSON.stringify(logEntry) + '\n'
      );
    } catch (error) {
      logger.error(`Failed to log quarantine event: ${error}`);
    }
  }

  public getAgentState(agentId: string): AgentState | undefined {
    return this.agentStates.get(agentId);
  }

  private emitTelemetry(event: string, data: any): void {
    if (this.config.telemetryEnabled) {
      this.telemetryBus.emit('agent_supervisor', {
        type: event,
        timestamp: Date.now(),
        data
      });
    }
  }

  public cleanup(): void {
    this.agentStates.clear();
  }
} 