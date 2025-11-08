import { TelemetryBus } from '../telemetry/TelemetryBus';
import { logger } from '../utils/logger';

export class TrustDecayEngine {
  private static instance: TrustDecayEngine;
  private decayThreshold = 0.4;
  private decayingAgents: Set<string> = new Set();

  private constructor() {
    this.setupTelemetry();
  }

  public static getInstance(): TrustDecayEngine {
    if (!TrustDecayEngine.instance) {
      TrustDecayEngine.instance = new TrustDecayEngine();
    }
    return TrustDecayEngine.instance;
  }

  private setupTelemetry() {
    const telemetryBus = TelemetryBus.getInstance();
    telemetryBus.on('agent_metrics', (event: any) => {
      if (event.trust < this.decayThreshold) {
        this.decayingAgents.add(event.id);
        logger.warn(`Agent ${event.id} trust score below threshold: ${event.trust}`);
      } else {
        this.decayingAgents.delete(event.id);
      }
    });
  }

  public async getDecayingAgents(): Promise<string[]> {
    return Array.from(this.decayingAgents);
  }

  public isDecaying(agentId: string): boolean {
    return this.decayingAgents.has(agentId);
  }

  public setDecayThreshold(threshold: number) {
    this.decayThreshold = threshold;
  }
} 