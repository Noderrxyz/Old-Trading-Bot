import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AlphaMemoryEngine } from '../memory/AlphaMemoryEngine.js';
import { RegimeRecallEngine } from '../memory/RegimeRecallEngine.js';
import { BiasedMutationEngine } from '../memory/BiasedMutationEngine.js';
import { AlphaDecayWatcher } from '../feedback/AlphaDecayWatcher.js';
import { AlphaQuery, AlphaSnapshot } from '../types/AlphaSnapshot.js';

interface MutationConfig {
  cycleInterval: number;
  topPerformersCount: number;
  bottomPerformersCount: number;
  minTrustForMutation: number;
  telemetryEnabled: boolean;
}

const DEFAULT_CONFIG: MutationConfig = {
  cycleInterval: 300000, // 5 minutes
  topPerformersCount: 3,
  bottomPerformersCount: 2,
  minTrustForMutation: 0.5,
  telemetryEnabled: true
};

export class AutoMutationLoop {
  private static instance: AutoMutationLoop;
  private config: MutationConfig;
  private telemetryBus: TelemetryBus;
  private memoryEngine: AlphaMemoryEngine;
  private regimeEngine: RegimeRecallEngine;
  private mutationEngine: BiasedMutationEngine;
  private decayWatcher: AlphaDecayWatcher;
  private cycleInterval: NodeJS.Timeout | null;

  private constructor(config: Partial<MutationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.memoryEngine = AlphaMemoryEngine.getInstance();
    this.regimeEngine = RegimeRecallEngine.getInstance();
    this.mutationEngine = BiasedMutationEngine.getInstance();
    this.decayWatcher = AlphaDecayWatcher.getInstance();
    this.cycleInterval = null;
  }

  public static getInstance(config?: Partial<MutationConfig>): AutoMutationLoop {
    if (!AutoMutationLoop.instance) {
      AutoMutationLoop.instance = new AutoMutationLoop(config);
    }
    return AutoMutationLoop.instance;
  }

  public async start(): Promise<void> {
    if (this.cycleInterval) return;

    logger.info('Starting auto-mutation loop');
    this.cycleInterval = setInterval(() => this.runCycle(), this.config.cycleInterval);
    await this.runCycle(); // Run initial cycle
  }

  public stop(): void {
    if (this.cycleInterval) {
      clearInterval(this.cycleInterval);
      this.cycleInterval = null;
    }
  }

  private async runCycle(): Promise<void> {
    try {
      // Get current regime
      const currentStrategy = await this.regimeEngine.recallStrategy();
      if (!currentStrategy) return;
      
      // Get all active agents
      const agents = await this.memoryEngine.querySnapshots({
        regime: currentStrategy.regime
      } as AlphaQuery);

      // Sort agents by performance
      const sortedAgents = agents.sort((a, b) => {
        const trustA = this.decayWatcher.getTrust(a.id);
        const trustB = this.decayWatcher.getTrust(b.id);
        return trustB - trustA;
      });

      // Clone and mutate top performers
      const topPerformers = sortedAgents.slice(0, this.config.topPerformersCount);
      for (const agent of topPerformers) {
        if (this.decayWatcher.getTrust(agent.id) >= this.config.minTrustForMutation) {
          await this.mutateAgent(agent.id, 'top_performer');
        }
      }

      // Retire worst performers
      const bottomPerformers = sortedAgents.slice(-this.config.bottomPerformersCount);
      for (const agent of bottomPerformers) {
        await this.retireAgent(agent.id);
      }

      // Rewire capital based on regime
      await this.rewireCapital(currentStrategy.regime);

      this.emitTelemetry('cycle_completed', {
        topPerformers: topPerformers.map(a => a.id),
        bottomPerformers: bottomPerformers.map(a => a.id),
        regime: currentStrategy.regime
      });
    } catch (error) {
      logger.error('Auto-mutation cycle failed:', error);
      this.emitTelemetry('cycle_failed', { error: String(error) });
    }
  }

  private async mutateAgent(agentId: string, reason: string): Promise<void> {
    try {
      const agents = await this.memoryEngine.querySnapshots({
        id: agentId
      } as AlphaQuery);
      if (!agents.length) return;

      const agent = agents[0];
      const currentStrategy = await this.regimeEngine.recallStrategy();
      if (!currentStrategy) return;

      const mutatedStrategy = await this.mutationEngine.mutateStrategy(
        agent,
        agent.metrics,
        currentStrategy.regime
      );
      
      if (!mutatedStrategy) return;

      const newSnapshot: AlphaSnapshot = {
        ...agent,
        id: `${agent.id}_mut_${Date.now()}`,
        strategy: mutatedStrategy.strategy,
        parentId: agent.id,
        lineage: [...agent.lineage, agent.id]
      };

      await this.memoryEngine.saveSnapshot(newSnapshot);

      this.emitTelemetry('agent_mutated', {
        agentId,
        reason,
        parentId: agent.id
      });
    } catch (error) {
      logger.error(`Failed to mutate agent ${agentId}:`, error);
    }
  }

  private async retireAgent(agentId: string): Promise<void> {
    try {
      const agents = await this.memoryEngine.querySnapshots({
        id: agentId
      } as AlphaQuery);
      if (!agents.length) return;

      const agent = agents[0];
      const retiredSnapshot: AlphaSnapshot = {
        ...agent,
        id: `${agent.id}_ret_${Date.now()}`,
        tags: [...agent.tags, 'retired']
      };

      await this.memoryEngine.saveSnapshot(retiredSnapshot);
      this.emitTelemetry('agent_retired', { agentId });
    } catch (error) {
      logger.error(`Failed to retire agent ${agentId}:`, error);
    }
  }

  private async rewireCapital(regime: string): Promise<void> {
    try {
      const agents = await this.memoryEngine.querySnapshots({
        regime
      } as AlphaQuery);

      for (const agent of agents) {
        const trust = this.decayWatcher.getTrust(agent.id);
        const currentStrategy = await this.regimeEngine.recallStrategy();
        if (!currentStrategy) continue;

        const confidence = currentStrategy.metrics.trust;
        
        // Adjust capital allocation based on trust and confidence
        const allocation = trust * confidence;
        const updatedSnapshot: AlphaSnapshot = {
          ...agent,
          id: `${agent.id}_cap_${Date.now()}`,
          metrics: {
            ...agent.metrics,
            trust: allocation
          }
        };

        await this.memoryEngine.saveSnapshot(updatedSnapshot);
      }
    } catch (error) {
      logger.error('Failed to rewire capital:', error);
    }
  }

  private emitTelemetry(event: string, data: any): void {
    if (this.config.telemetryEnabled) {
      this.telemetryBus.emit('auto_mutation', {
        type: event,
        timestamp: Date.now(),
        data
      });
    }
  }

  public cleanup(): void {
    this.stop();
  }
} 