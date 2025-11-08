import { TelemetryBus } from '../telemetry/TelemetryBus';
import { logger } from '../utils/logger';
import { PostMortemTracker } from '../healing/PostMortemTracker';
import { AutoDegrader } from '../alpha/AutoDegrader';
import * as fs from 'fs';
import * as path from 'path';

interface AgentMetrics {
  pnl: number;
  entropy: number;
  trust: number;
  timestamp: number;
}

export class PostLaunchSentinel {
  private static instance: PostLaunchSentinel;
  private telemetryBus: TelemetryBus;
  private postMortemTracker: PostMortemTracker;
  private autoDegrader: AutoDegrader;
  private agentMetrics: Map<string, AgentMetrics[]>;
  private readonly MAX_METRICS_HISTORY = 60; // 1 minute of data at 1s intervals
  private readonly PNL_DIVERGENCE_THRESHOLD = -0.05; // -5% PnL divergence
  private readonly ENTROPY_THRESHOLD = 0.8; // High entropy threshold
  private readonly TRUST_THRESHOLD = 0.3; // Low trust threshold

  private constructor() {
    this.telemetryBus = TelemetryBus.getInstance();
    this.postMortemTracker = PostMortemTracker.getInstance();
    this.autoDegrader = AutoDegrader.getInstance();
    this.agentMetrics = new Map();
    this.setupTelemetry();
  }

  public static getInstance(): PostLaunchSentinel {
    if (!PostLaunchSentinel.instance) {
      PostLaunchSentinel.instance = new PostLaunchSentinel();
    }
    return PostLaunchSentinel.instance;
  }

  private setupTelemetry() {
    this.telemetryBus.on('agent_metrics', (data: any) => {
      const { agentId, metrics } = data;
      this.updateAgentMetrics(agentId, metrics);
      this.checkAgentHealth(agentId);
    });

    this.telemetryBus.on('agent_error', (data: any) => {
      const { agentId, error } = data;
      this.handleAgentError(agentId, error);
    });
  }

  private updateAgentMetrics(agentId: string, metrics: AgentMetrics) {
    if (!this.agentMetrics.has(agentId)) {
      this.agentMetrics.set(agentId, []);
    }

    const history = this.agentMetrics.get(agentId)!;
    history.push(metrics);

    // Keep only the last MAX_METRICS_HISTORY entries
    if (history.length > this.MAX_METRICS_HISTORY) {
      history.shift();
    }
  }

  private checkAgentHealth(agentId: string) {
    const history = this.agentMetrics.get(agentId);
    if (!history || history.length < 2) return;

    const latest = history[history.length - 1];
    const previous = history[history.length - 2];

    // Check PnL divergence
    if (latest.pnl - previous.pnl < this.PNL_DIVERGENCE_THRESHOLD) {
      this.handlePnLDivergence(agentId, latest.pnl - previous.pnl);
    }

    // Check entropy spike
    if (latest.entropy > this.ENTROPY_THRESHOLD) {
      this.handleEntropySpike(agentId, latest.entropy);
    }

    // Check trust decay
    if (latest.trust < this.TRUST_THRESHOLD) {
      this.handleTrustDecay(agentId, latest.trust);
    }
  }

  private handlePnLDivergence(agentId: string, divergence: number) {
    logger.warn(`Agent ${agentId} PnL divergence detected: ${divergence}`);
    this.postMortemTracker.logEvent(agentId, 'pnl_divergence', { divergence });
    this.autoDegrader.degradeAgent(agentId, 'pnl_divergence');
  }

  private handleEntropySpike(agentId: string, entropy: number) {
    logger.warn(`Agent ${agentId} entropy spike detected: ${entropy}`);
    this.postMortemTracker.logEvent(agentId, 'entropy_spike', { entropy });
    this.autoDegrader.degradeAgent(agentId, 'entropy_spike');
  }

  private handleTrustDecay(agentId: string, trust: number) {
    logger.warn(`Agent ${agentId} trust decay detected: ${trust}`);
    this.postMortemTracker.logEvent(agentId, 'trust_decay', { trust });
    this.autoDegrader.degradeAgent(agentId, 'trust_decay');
  }

  private handleAgentError(agentId: string, error: any) {
    logger.error(`Agent ${agentId} error:`, error);
    this.postMortemTracker.logEvent(agentId, 'error', { error });
    this.autoDegrader.degradeAgent(agentId, 'error');
  }

  public getAgentMetrics(agentId: string): AgentMetrics[] {
    return this.agentMetrics.get(agentId) || [];
  }

  public clearAgentMetrics(agentId: string) {
    this.agentMetrics.delete(agentId);
  }
} 