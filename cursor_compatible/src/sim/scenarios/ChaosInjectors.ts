import { logger } from '../../utils/logger.js';
import { TelemetryBus } from '../../telemetry/TelemetryBus.js';
import { MarketTick } from '../ReplayEngine.js';

/**
 * Chaos event type
 */
export type ChaosEventType = 
  | 'gas_spike'
  | 'oracle_delay'
  | 'dex_halt'
  | 'flash_dump'
  | 'network_congestion'
  | 'liquidity_drain';

/**
 * Chaos event
 */
export interface ChaosEvent {
  type: ChaosEventType;
  timestamp: number;
  duration: number;
  severity: number;
  data?: any;
}

/**
 * Chaos injector configuration
 */
export interface ChaosInjectorConfig {
  enabled: boolean;
  maxEventsPerRun: number;
  minTimeBetweenEvents: number;
  eventProbabilities: Record<ChaosEventType, number>;
}

/**
 * Default chaos injector configuration
 */
export const DEFAULT_CHAOS_CONFIG: ChaosInjectorConfig = {
  enabled: true,
  maxEventsPerRun: 5,
  minTimeBetweenEvents: 300000, // 5 minutes
  eventProbabilities: {
    gas_spike: 0.3,
    oracle_delay: 0.2,
    dex_halt: 0.1,
    flash_dump: 0.1,
    network_congestion: 0.2,
    liquidity_drain: 0.1
  }
};

/**
 * Chaos Injector
 */
export class ChaosInjector {
  private static instance: ChaosInjector | null = null;
  private config: ChaosInjectorConfig;
  private telemetryBus: TelemetryBus;
  private activeEvents: Map<string, ChaosEvent>;
  private lastEventTime: number;

  private constructor(config: Partial<ChaosInjectorConfig> = {}) {
    this.config = { ...DEFAULT_CHAOS_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.activeEvents = new Map();
    this.lastEventTime = 0;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ChaosInjectorConfig>): ChaosInjector {
    if (!ChaosInjector.instance) {
      ChaosInjector.instance = new ChaosInjector(config);
    }
    return ChaosInjector.instance;
  }

  /**
   * Inject chaos into market tick
   */
  public injectChaos(tick: MarketTick): MarketTick {
    if (!this.config.enabled) return tick;

    const now = Date.now();
    const modifiedTick = { ...tick };

    // Check if we should trigger a new event
    if (this.shouldTriggerNewEvent(now)) {
      const event = this.generateRandomEvent(now);
      if (event) {
        this.activateEvent(event);
      }
    }

    // Apply active events
    for (const event of this.activeEvents.values()) {
      modifiedTick = this.applyEvent(modifiedTick, event);
    }

    // Cleanup expired events
    this.cleanupExpiredEvents(now);

    return modifiedTick;
  }

  /**
   * Check if we should trigger a new event
   */
  private shouldTriggerNewEvent(now: number): boolean {
    if (this.activeEvents.size >= this.config.maxEventsPerRun) return false;
    if (now - this.lastEventTime < this.config.minTimeBetweenEvents) return false;

    const totalProbability = Object.values(this.config.eventProbabilities).reduce(
      (sum, prob) => sum + prob,
      0
    );

    return Math.random() < totalProbability;
  }

  /**
   * Generate random event
   */
  private generateRandomEvent(now: number): ChaosEvent | null {
    const eventTypes = Object.keys(this.config.eventProbabilities) as ChaosEventType[];
    const totalProbability = Object.values(this.config.eventProbabilities).reduce(
      (sum, prob) => sum + prob,
      0
    );

    let random = Math.random() * totalProbability;
    for (const type of eventTypes) {
      random -= this.config.eventProbabilities[type];
      if (random <= 0) {
        return this.createEvent(type, now);
      }
    }

    return null;
  }

  /**
   * Create event of specific type
   */
  private createEvent(type: ChaosEventType, now: number): ChaosEvent {
    const baseEvent: ChaosEvent = {
      type,
      timestamp: now,
      duration: this.getEventDuration(type),
      severity: Math.random()
    };

    switch (type) {
      case 'gas_spike':
        return {
          ...baseEvent,
          data: { multiplier: 1 + Math.random() * 4 } // 1x to 5x gas price
        };
      case 'oracle_delay':
        return {
          ...baseEvent,
          data: { delaySeconds: Math.floor(Math.random() * 30) } // 0-30 seconds
        };
      case 'dex_halt':
        return {
          ...baseEvent,
          data: { reason: 'maintenance' }
        };
      case 'flash_dump':
        return {
          ...baseEvent,
          data: { priceDrop: Math.random() * 0.5 } // 0-50% price drop
        };
      case 'network_congestion':
        return {
          ...baseEvent,
          data: { latencyMs: Math.floor(Math.random() * 5000) } // 0-5 seconds
        };
      case 'liquidity_drain':
        return {
          ...baseEvent,
          data: { liquidityReduction: Math.random() * 0.8 } // 0-80% reduction
        };
      default:
        return baseEvent;
    }
  }

  /**
   * Get event duration based on type
   */
  private getEventDuration(type: ChaosEventType): number {
    switch (type) {
      case 'gas_spike':
        return 300000; // 5 minutes
      case 'oracle_delay':
        return 60000; // 1 minute
      case 'dex_halt':
        return 1800000; // 30 minutes
      case 'flash_dump':
        return 30000; // 30 seconds
      case 'network_congestion':
        return 900000; // 15 minutes
      case 'liquidity_drain':
        return 3600000; // 1 hour
      default:
        return 300000; // 5 minutes default
    }
  }

  /**
   * Activate event
   */
  private activateEvent(event: ChaosEvent): void {
    const eventId = `${event.type}_${event.timestamp}`;
    this.activeEvents.set(eventId, event);
    this.lastEventTime = event.timestamp;

    this.telemetryBus.emit('chaos_event_started', event);
    logger.warn(`Chaos event started: ${event.type}`);
  }

  /**
   * Apply event to market tick
   */
  private applyEvent(tick: MarketTick, event: ChaosEvent): MarketTick {
    const modifiedTick = { ...tick };

    switch (event.type) {
      case 'gas_spike':
        // Gas price affects execution cost, not directly visible in tick
        break;
      case 'oracle_delay':
        // Oracle delay affects price updates, not directly visible in tick
        break;
      case 'dex_halt':
        // DEX halt affects orderbook updates
        if (modifiedTick.orderbook) {
          modifiedTick.orderbook.bids = [];
          modifiedTick.orderbook.asks = [];
        }
        break;
      case 'flash_dump':
        // Flash dump affects price
        const priceDrop = event.data.priceDrop;
        modifiedTick.price *= (1 - priceDrop);
        modifiedTick.bid *= (1 - priceDrop);
        modifiedTick.ask *= (1 - priceDrop);
        break;
      case 'network_congestion':
        // Network congestion affects latency, not directly visible in tick
        break;
      case 'liquidity_drain':
        // Liquidity drain affects orderbook depth
        if (modifiedTick.orderbook) {
          const reduction = event.data.liquidityReduction;
          modifiedTick.orderbook.bids = modifiedTick.orderbook.bids.map(
            ([price, size]) => [price, size * (1 - reduction)]
          );
          modifiedTick.orderbook.asks = modifiedTick.orderbook.asks.map(
            ([price, size]) => [price, size * (1 - reduction)]
          );
        }
        break;
    }

    return modifiedTick;
  }

  /**
   * Cleanup expired events
   */
  private cleanupExpiredEvents(now: number): void {
    for (const [eventId, event] of this.activeEvents.entries()) {
      if (now >= event.timestamp + event.duration) {
        this.activeEvents.delete(eventId);
        this.telemetryBus.emit('chaos_event_ended', event);
        logger.info(`Chaos event ended: ${event.type}`);
      }
    }
  }

  /**
   * Get active events
   */
  public getActiveEvents(): ChaosEvent[] {
    return Array.from(this.activeEvents.values());
  }

  /**
   * Reset chaos injector
   */
  public reset(): void {
    this.activeEvents.clear();
    this.lastEventTime = 0;
  }
} 