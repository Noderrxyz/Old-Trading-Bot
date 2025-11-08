import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';

interface ChaosEvent {
  type: string;
  blockNumber: number;
  severity: number;
  duration: number;
  params: Record<string, any>;
}

interface ChaosConfig {
  maxEventsPerSimulation: number;
  minBlockGap: number;
  eventProbabilities: Record<string, number>;
  alertThreshold: number;
}

const DEFAULT_CONFIG: ChaosConfig = {
  maxEventsPerSimulation: 5,
  minBlockGap: 10,
  eventProbabilities: {
    oracle_freeze: 0.1,
    gas_spike: 0.2,
    block_stall: 0.05,
    liquidity_cliff: 0.15
  },
  alertThreshold: 0.7
};

export class ChaosInjectors {
  private static instance: ChaosInjectors;
  private config: ChaosConfig;
  private telemetryBus: TelemetryBus;
  private activeEvents: Map<string, ChaosEvent>;
  private eventCount: number;

  private constructor(config: Partial<ChaosConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.activeEvents = new Map();
    this.eventCount = 0;
  }

  public static getInstance(config?: Partial<ChaosConfig>): ChaosInjectors {
    if (!ChaosInjectors.instance) {
      ChaosInjectors.instance = new ChaosInjectors(config);
    }
    return ChaosInjectors.instance;
  }

  public inject(type: string, blockNumber: number, params: Record<string, any> = {}): void {
    if (this.eventCount >= this.config.maxEventsPerSimulation) {
      logger.warn('Maximum number of chaos events reached');
      return;
    }

    // Check minimum block gap
    const lastEvent = Array.from(this.activeEvents.values())
      .reduce((latest, event) => Math.max(latest, event.blockNumber), 0);
    
    if (blockNumber - lastEvent < this.config.minBlockGap) {
      logger.warn('Block gap too small for new chaos event');
      return;
    }

    const event: ChaosEvent = {
      type,
      blockNumber,
      severity: this.calculateSeverity(type),
      duration: this.calculateDuration(type),
      params
    };

    this.activeEvents.set(`${type}_${blockNumber}`, event);
    this.eventCount++;

    this.telemetryBus.emit('chaos_event', {
      type: 'chaos_injection',
      timestamp: Date.now(),
      data: event
    });

    this.handleEvent(event);
  }

  private calculateSeverity(type: string): number {
    switch (type) {
      case 'oracle_freeze':
        return 0.9;
      case 'gas_spike':
        return 0.7;
      case 'block_stall':
        return 0.8;
      case 'liquidity_cliff':
        return 0.6;
      default:
        return 0.5;
    }
  }

  private calculateDuration(type: string): number {
    switch (type) {
      case 'oracle_freeze':
        return 1000 * 60 * 5; // 5 minutes
      case 'gas_spike':
        return 1000 * 60 * 2; // 2 minutes
      case 'block_stall':
        return 1000 * 30; // 30 seconds
      case 'liquidity_cliff':
        return 1000 * 60 * 10; // 10 minutes
      default:
        return 1000 * 60; // 1 minute
    }
  }

  private handleEvent(event: ChaosEvent): void {
    switch (event.type) {
      case 'oracle_freeze':
        this.handleOracleFreeze(event);
        break;
      case 'gas_spike':
        this.handleGasSpike(event);
        break;
      case 'block_stall':
        this.handleBlockStall(event);
        break;
      case 'liquidity_cliff':
        this.handleLiquidityCliff(event);
        break;
    }

    // Schedule event cleanup
    setTimeout(() => {
      this.cleanupEvent(event);
    }, event.duration);
  }

  private handleOracleFreeze(event: ChaosEvent): void {
    logger.warn(`Oracle freeze injected at block ${event.blockNumber}`);
    this.telemetryBus.emit('trust_decay', {
      type: 'oracle_freeze',
      timestamp: Date.now(),
      data: { blockNumber: event.blockNumber }
    });
  }

  private handleGasSpike(event: ChaosEvent): void {
    const gasPrice = event.params.gasPrice || 800;
    logger.warn(`Gas spike to ${gasPrice} Gwei injected at block ${event.blockNumber}`);
    
    this.telemetryBus.emit('agent_cooldown', {
      type: 'gas_spike',
      timestamp: Date.now(),
      data: { blockNumber: event.blockNumber, gasPrice }
    });
  }

  private handleBlockStall(event: ChaosEvent): void {
    logger.warn(`Block production stall injected at block ${event.blockNumber}`);
    
    this.telemetryBus.emit('fallback_recovery', {
      type: 'block_stall',
      timestamp: Date.now(),
      data: { blockNumber: event.blockNumber }
    });
  }

  private handleLiquidityCliff(event: ChaosEvent): void {
    const pair = event.params.pair || 'ETH/USD';
    logger.warn(`Liquidity cliff for ${pair} injected at block ${event.blockNumber}`);
    
    this.telemetryBus.emit('trust_decay', {
      type: 'liquidity_cliff',
      timestamp: Date.now(),
      data: { blockNumber: event.blockNumber, pair }
    });
  }

  private cleanupEvent(event: ChaosEvent): void {
    this.activeEvents.delete(`${event.type}_${event.blockNumber}`);
    
    this.telemetryBus.emit('chaos_event', {
      type: 'chaos_cleanup',
      timestamp: Date.now(),
      data: { ...event, status: 'cleaned' }
    });
  }

  public isEventActive(type: string, blockNumber: number): boolean {
    return this.activeEvents.has(`${type}_${blockNumber}`);
  }

  public getActiveEvents(): ChaosEvent[] {
    return Array.from(this.activeEvents.values());
  }

  public reset(): void {
    this.activeEvents.clear();
    this.eventCount = 0;
  }
} 