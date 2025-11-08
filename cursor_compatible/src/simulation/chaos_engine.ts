/**
 * Chaos Engine
 * 
 * Injects chaotic conditions during simulations to test system resilience.
 */

import { setLogLevel, LogLevel } from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { 
  ChaosEngineConfig,
  DEFAULT_CHAOS_CONFIG,
  ChaosEvent,
  ChaosEventType,
  ChaosScenario,
  ChaosReport,
  ChaosTelemetryEvent,
  ChaosMetrics
} from './types/chaos.types.js';
import { SimulationEventType } from './types/simulation.types.js';

// Create a simple logger for this module
const logger = {
  info: (message: string, ...args: any[]) => {
    if (process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) <= LogLevel.INFO : true) {
      console.log(`[ChaosEngine] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    if (process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) <= LogLevel.ERROR : true) {
      console.error(`[ChaosEngine] ${message}`, ...args);
    }
  }
};

export class ChaosEngine {
  private static instance: ChaosEngine | null = null;
  private config: ChaosEngineConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private activeEvents: Map<string, ChaosEvent> = new Map();
  private currentScenario: ChaosScenario | null = null;
  private startTime: number = 0;
  private systemReactions: ChaosReport['systemReactions'] = [];
  private metrics: ChaosMetrics = {
    agentDeathRate: 0,
    capitalRetention: 1,
    trustScoreErosion: 0,
    recoverySpeed: 0,
    routeFlappingCount: 0
  };

  private constructor(config: Partial<ChaosEngineConfig> = {}) {
    this.config = { ...DEFAULT_CHAOS_CONFIG, ...config };
  }

  public static getInstance(config?: Partial<ChaosEngineConfig>): ChaosEngine {
    if (!ChaosEngine.instance) {
      ChaosEngine.instance = new ChaosEngine(config);
    }
    return ChaosEngine.instance;
  }

  /**
   * Start the chaos engine
   */
  public start(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(
      () => this.checkAndInjectEvents(),
      this.config.checkIntervalMs
    );

    logger.info('ChaosEngine started');
  }

  /**
   * Stop the chaos engine
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.activeEvents.clear();
    this.currentScenario = null;
    logger.info('ChaosEngine stopped');
  }

  /**
   * Load and start a chaos scenario
   */
  public async startScenario(scenario: ChaosScenario): Promise<void> {
    this.currentScenario = scenario;
    this.startTime = Date.now();
    this.systemReactions = [];
    this.metrics = {
      agentDeathRate: 0,
      capitalRetention: 1,
      trustScoreErosion: 0,
      recoverySpeed: 0,
      routeFlappingCount: 0
    };

    logger.info(`Starting chaos scenario: ${scenario.name}`);
  }

  /**
   * Check and inject chaos events
   */
  private async checkAndInjectEvents(): Promise<void> {
    if (!this.currentScenario) return;

    const now = Date.now();
    const elapsed = now - this.startTime;

    // Check if scenario duration has been exceeded
    if (elapsed > this.currentScenario.durationMs) {
      await this.endScenario();
      return;
    }

    // Check for events to inject
    for (const event of this.currentScenario.events) {
      if (this.shouldInjectEvent(event, now)) {
        await this.injectEvent(event);
      }
    }

    // Clean up expired events
    this.cleanupExpiredEvents(now);
  }

  /**
   * Determine if an event should be injected
   */
  private shouldInjectEvent(event: ChaosEvent, now: number): boolean {
    // Check if event is already active
    if (this.activeEvents.has(this.getEventKey(event))) {
      return false;
    }

    // Check if max concurrent events limit is reached
    if (this.activeEvents.size >= this.config.maxConcurrentEvents) {
      return false;
    }

    // Check probability
    if (Math.random() > event.probability) {
      return false;
    }

    // Check if event should start based on timestamp
    return now >= event.timestamp;
  }

  /**
   * Inject a chaos event
   */
  private async injectEvent(event: ChaosEvent): Promise<void> {
    const eventKey = this.getEventKey(event);
    this.activeEvents.set(eventKey, event);

    try {
      // Inject the event based on its type
      switch (event.type) {
        case ChaosEventType.GasSpike:
          await this.injectGasSpike(event);
          break;
        case ChaosEventType.OracleDelay:
          await this.injectOracleDelay(event);
          break;
        case ChaosEventType.MarketCrash:
          await this.injectMarketCrash(event);
          break;
        case ChaosEventType.ChainCongestion:
          await this.injectChainCongestion(event);
          break;
        case ChaosEventType.TradeRejection:
          await this.injectTradeRejection(event);
          break;
        case ChaosEventType.LatencySpike:
          await this.injectLatencySpike(event);
          break;
        case ChaosEventType.SlippageBurst:
          await this.injectSlippageBurst(event);
          break;
        case ChaosEventType.DEXDowntime:
          await this.injectDEXDowntime(event);
          break;
      }

      // Record system reaction
      this.recordSystemReaction(event, 'injected', 'success');

      // Emit telemetry
      if (this.config.telemetryEnabled) {
        this.emitTelemetry(event);
      }

      logger.info(`Injected chaos event: ${event.type} (${event.severity})`);
    } catch (error) {
      logger.error(`Error injecting chaos event: ${event.type}`, error);
      this.recordSystemReaction(event, 'injected', 'failed');
    }
  }

  /**
   * Clean up expired events
   */
  private cleanupExpiredEvents(now: number): void {
    for (const [key, event] of this.activeEvents.entries()) {
      if (now >= event.timestamp + event.duration) {
        this.activeEvents.delete(key);
        this.recordSystemReaction(event, 'expired', 'completed');
      }
    }
  }

  /**
   * End the current scenario and generate report
   */
  private async endScenario(): Promise<void> {
    if (!this.currentScenario) return;

    const report: ChaosReport = {
      scenarioName: this.currentScenario.name,
      startTime: this.startTime,
      endTime: Date.now(),
      metrics: this.metrics,
      events: Array.from(this.activeEvents.values()),
      systemReactions: this.systemReactions
    };

    // Emit final telemetry
    if (this.config.telemetryEnabled) {
      this.emitFinalTelemetry(report);
    }

    // Reset state
    this.currentScenario = null;
    this.activeEvents.clear();
    this.systemReactions = [];

    logger.info(`Completed chaos scenario: ${this.currentScenario.name}`);
  }

  /**
   * Record system reaction to an event
   */
  private recordSystemReaction(
    event: ChaosEvent,
    reaction: string,
    outcome: string
  ): void {
    this.systemReactions.push({
      timestamp: Date.now(),
      event,
      reaction,
      outcome
    });
  }

  /**
   * Emit telemetry for an event
   */
  private emitTelemetry(event: ChaosEvent): void {
    const telemetryEvent: ChaosTelemetryEvent = {
      type: event.type,
      severity: event.severity,
      timestamp: Date.now(),
      metrics: {
        capitalDrawdown: this.metrics.capitalRetention,
        trustScore: 1 - this.metrics.trustScoreErosion,
        alphaRetention: 1 - this.metrics.agentDeathRate,
        routeChanges: this.metrics.routeFlappingCount
      }
    };

    ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
      type: SimulationEventType.ChaosEvent,
      metrics: telemetryEvent.metrics,
      timestamp: telemetryEvent.timestamp
    });
  }

  /**
   * Emit final telemetry for the scenario
   */
  private emitFinalTelemetry(report: ChaosReport): void {
    ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
      type: SimulationEventType.ChaosReport,
      metrics: report.metrics,
      timestamp: report.endTime
    });
  }

  /**
   * Generate a unique key for an event
   */
  private getEventKey(event: ChaosEvent): string {
    return `${event.type}_${event.timestamp}`;
  }

  /**
   * Event injection methods (to be implemented by integration)
   */
  private async injectGasSpike(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with ExecutionRouter
  }

  private async injectOracleDelay(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with OracleService
  }

  private async injectMarketCrash(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with MarketDataService
  }

  private async injectChainCongestion(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with ChainService
  }

  private async injectTradeRejection(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with ExecutionRouter
  }

  private async injectLatencySpike(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with NetworkService
  }

  private async injectSlippageBurst(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with ExecutionRouter
  }

  private async injectDEXDowntime(event: ChaosEvent): Promise<void> {
    // TODO: Implement integration with DEXService
  }
} 