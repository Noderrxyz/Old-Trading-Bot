import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AlphaMemoryEngine } from '../memory/AlphaMemoryEngine.js';
import { RegimeRecallEngine } from '../memory/RegimeRecallEngine.js';
import { AlphaQuery } from '../types/AlphaSnapshot.js';

interface BlueprintConfig {
  name: string;
  description: string;
  strategyId: string;
  market: string;
  capital: number;
  trustThrottle: boolean;
  maxRetries: number;
  retryDelay: number;
  telemetryEnabled: boolean;
  scaling: {
    minAgents: number;
    maxAgents: number;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
    cooldownPeriod: number;
    metricsWindow: number;
  };
}

interface BlueprintState {
  id: string;
  config: BlueprintConfig;
  status: 'active' | 'inactive' | 'error';
  lastDeployed: number;
  activeAgents: string[];
  metrics: {
    totalDeployments: number;
    successfulDeployments: number;
    failedDeployments: number;
    averageUptime: number;
  };
}

const DEFAULT_BLUEPRINT_CONFIG: Partial<BlueprintConfig> = {
  trustThrottle: true,
  maxRetries: 3,
  retryDelay: 5000,
  telemetryEnabled: true,
  scaling: {
    minAgents: 1,
    maxAgents: 10,
    scaleUpThreshold: 0.8,
    scaleDownThreshold: 0.2,
    cooldownPeriod: 300000,
    metricsWindow: 60000
  }
};

export class BlueprintBuilder {
  private static instance: BlueprintBuilder;
  private config: Partial<BlueprintConfig>;
  private telemetryBus: TelemetryBus;
  private memoryEngine: AlphaMemoryEngine;
  private regimeEngine: RegimeRecallEngine;
  private blueprints: Map<string, BlueprintState>;

  private constructor(config: Partial<BlueprintConfig> = {}) {
    this.config = { ...DEFAULT_BLUEPRINT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.memoryEngine = AlphaMemoryEngine.getInstance();
    this.regimeEngine = RegimeRecallEngine.getInstance();
    this.blueprints = new Map();
  }

  public static getInstance(config?: Partial<BlueprintConfig>): BlueprintBuilder {
    if (!BlueprintBuilder.instance) {
      BlueprintBuilder.instance = new BlueprintBuilder(config);
    }
    return BlueprintBuilder.instance;
  }

  public async createBlueprint(config: BlueprintConfig): Promise<string> {
    const blueprintId = this.generateBlueprintId(config);
    const state: BlueprintState = {
      id: blueprintId,
      config,
      status: 'inactive',
      lastDeployed: 0,
      activeAgents: [],
      metrics: {
        totalDeployments: 0,
        successfulDeployments: 0,
        failedDeployments: 0,
        averageUptime: 0
      }
    };

    this.blueprints.set(blueprintId, state);
    this.log(blueprintId, 'Blueprint created');

    try {
      // Validate strategy exists
      const strategy = await this.memoryEngine.querySnapshots({
        strategy: config.strategyId
      } as AlphaQuery);

      if (strategy.length === 0) {
        throw new Error(`Strategy ${config.strategyId} not found`);
      }

      this.emitTelemetry('blueprint_created', {
        blueprintId,
        config: {
          name: config.name,
          strategyId: config.strategyId,
          market: config.market
        }
      });

      return blueprintId;
    } catch (error) {
      this.handleBlueprintError(blueprintId, error);
      throw error;
    }
  }

  public async updateBlueprint(blueprintId: string, config: Partial<BlueprintConfig>): Promise<void> {
    const state = this.blueprints.get(blueprintId);
    if (!state) throw new Error('Blueprint not found');

    this.log(blueprintId, 'Updating blueprint configuration');

    // Update configuration
    state.config = { ...state.config, ...config };

    // Validate strategy if changed
    if (config.strategyId && config.strategyId !== state.config.strategyId) {
      const strategy = await this.memoryEngine.querySnapshots({
        strategy: config.strategyId
      } as AlphaQuery);

      if (strategy.length === 0) {
        throw new Error(`Strategy ${config.strategyId} not found`);
      }
    }

    this.emitTelemetry('blueprint_updated', {
      blueprintId,
      config: {
        name: config.name,
        strategyId: config.strategyId,
        market: config.market
      }
    });
  }

  public async activateBlueprint(blueprintId: string): Promise<void> {
    const state = this.blueprints.get(blueprintId);
    if (!state) throw new Error('Blueprint not found');

    this.log(blueprintId, 'Activating blueprint');
    state.status = 'active';
    state.lastDeployed = Date.now();

    this.emitTelemetry('blueprint_activated', {
      blueprintId,
      timestamp: state.lastDeployed
    });
  }

  public async deactivateBlueprint(blueprintId: string): Promise<void> {
    const state = this.blueprints.get(blueprintId);
    if (!state) throw new Error('Blueprint not found');

    this.log(blueprintId, 'Deactivating blueprint');
    state.status = 'inactive';

    this.emitTelemetry('blueprint_deactivated', {
      blueprintId,
      timestamp: Date.now()
    });
  }

  public getBlueprintState(blueprintId: string): BlueprintState | undefined {
    return this.blueprints.get(blueprintId);
  }

  public getAllBlueprints(): BlueprintState[] {
    return Array.from(this.blueprints.values());
  }

  public async cleanup(): Promise<void> {
    this.blueprints.clear();
  }

  private generateBlueprintId(config: BlueprintConfig): string {
    return `${config.name}-${config.strategyId}-${config.market}-${Date.now()}`;
  }

  private handleBlueprintError(blueprintId: string, error: unknown): void {
    const state = this.blueprints.get(blueprintId);
    if (!state) return;

    state.status = 'error';
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.log(blueprintId, `Blueprint error: ${errorMessage}`);

    this.emitTelemetry('blueprint_error', {
      blueprintId,
      error: errorMessage
    });
  }

  private log(blueprintId: string, message: string, ...args: any[]): void {
    const logMessage = `[${blueprintId}] ${message}`;
    logger.info(logMessage, ...args);
  }

  private emitTelemetry(event: string, data: any): void {
    if (this.config.telemetryEnabled) {
      this.telemetryBus.emit('blueprint_builder', {
        type: event,
        timestamp: Date.now(),
        data
      });
    }
  }
} 