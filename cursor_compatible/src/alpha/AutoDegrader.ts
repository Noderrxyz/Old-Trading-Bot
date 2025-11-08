import { TelemetryBus } from '../telemetry/TelemetryBus';
import { logger } from '../utils/logger';
import { PostMortemTracker } from '../healing/PostMortemTracker';
import { LaunchManager } from '../orchestration/LaunchManager';

interface DegradedAgent {
  agentId: string;
  reason: string;
  timestamp: number;
  metrics: {
    pnl: number;
    entropy: number;
    trust: number;
  };
}

export class AutoDegrader {
  private static instance: AutoDegrader;
  private telemetryBus: TelemetryBus;
  private postMortemTracker: PostMortemTracker;
  private launchManager: LaunchManager;
  private degradedAgents: Map<string, DegradedAgent>;
  private readonly DEGRADATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly RECOVERY_THRESHOLD = 0.7; // 70% trust score for recovery
  private readonly MAX_DEGRADATIONS = 3; // Maximum number of degradations before quarantine

  private constructor() {
    this.telemetryBus = TelemetryBus.getInstance();
    this.postMortemTracker = PostMortemTracker.getInstance();
    this.launchManager = LaunchManager.getInstance();
    this.degradedAgents = new Map();
    this.setupTelemetry();
  }

  public static getInstance(): AutoDegrader {
    if (!AutoDegrader.instance) {
      AutoDegrader.instance = new AutoDegrader();
    }
    return AutoDegrader.instance;
  }

  private setupTelemetry() {
    this.telemetryBus.on('agent_metrics', (data: any) => {
      const { agentId, metrics } = data;
      if (this.degradedAgents.has(agentId)) {
        this.checkRecovery(agentId, metrics);
      }
    });
  }

  public degradeAgent(agentId: string, reason: string, metrics?: any) {
    if (this.degradedAgents.has(agentId)) {
      const agent = this.degradedAgents.get(agentId)!;
      agent.reason = reason;
      agent.timestamp = Date.now();
      if (metrics) {
        agent.metrics = metrics;
      }
    } else {
      this.degradedAgents.set(agentId, {
        agentId,
        reason,
        timestamp: Date.now(),
        metrics: metrics || { pnl: 0, entropy: 0, trust: 0 }
      });
    }

    logger.warn(`Agent ${agentId} degraded due to: ${reason}`);
    this.postMortemTracker.logEvent(agentId, 'degradation', { reason, metrics });

    // Check if agent should be quarantined
    const degradationCount = this.postMortemTracker.getAgentEvents(agentId)
      .filter(e => e.eventType === 'degradation').length;

    if (degradationCount >= this.MAX_DEGRADATIONS) {
      this.quarantineAgent(agentId);
    } else {
      this.launchManager.stopAgent(agentId);
    }
  }

  private checkRecovery(agentId: string, metrics: any) {
    const agent = this.degradedAgents.get(agentId);
    if (!agent) return;

    // Check if agent has recovered
    if (metrics.trust >= this.RECOVERY_THRESHOLD) {
      this.recoverAgent(agentId);
    }

    // Check if degradation timeout has passed
    if (Date.now() - agent.timestamp > this.DEGRADATION_TIMEOUT) {
      this.quarantineAgent(agentId);
    }
  }

  private recoverAgent(agentId: string) {
    const agent = this.degradedAgents.get(agentId);
    if (!agent) return;

    logger.info(`Agent ${agentId} recovered from ${agent.reason}`);
    this.postMortemTracker.logEvent(agentId, 'recovery', { 
      reason: agent.reason,
      metrics: agent.metrics
    });

    this.degradedAgents.delete(agentId);
    this.launchManager.startAgent(agentId);
  }

  private quarantineAgent(agentId: string) {
    logger.error(`Agent ${agentId} quarantined due to repeated degradations`);
    this.postMortemTracker.logEvent(agentId, 'quarantine', {
      reason: 'repeated_degradations',
      metrics: this.degradedAgents.get(agentId)?.metrics
    });

    this.degradedAgents.delete(agentId);
    this.launchManager.stopAgent(agentId);
  }

  public isDegraded(agentId: string): boolean {
    return this.degradedAgents.has(agentId);
  }

  public getDegradedAgents(): DegradedAgent[] {
    return Array.from(this.degradedAgents.values());
  }

  public clearDegradedAgents() {
    this.degradedAgents.clear();
  }
} 