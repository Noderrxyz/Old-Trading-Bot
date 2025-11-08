/**
 * Scenario Manager
 * 
 * Defines and manages market scenarios for stress testing and simulation.
 * Handles loading scenarios from configuration and coordinating their execution.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';
import { SimulationEngine } from './simulation_engine.js';

/**
 * Market scenario configuration
 */
export interface MarketScenario {
  name: string;
  description: string;
  event: {
    type: 'flash_crash' | 'volatility_expansion' | 'illiquidity_cascade' | 'pump_and_dump';
    priceDropPct?: number;
    timeWindowSeconds?: number;
    bidDepthDropPct?: number;
    durationSeconds?: number;
    volatilityMultiplier?: number;
    volumeSpikePct?: number;
  };
  preconditions?: {
    minLiquidity?: number;
    maxVolatility?: number;
    requiredAssets?: string[];
  };
}

/**
 * Scenario manager configuration
 */
export interface ScenarioManagerConfig {
  enabled: boolean;
  scenarios: MarketScenario[];
  checkIntervalMs: number;
}

/**
 * Default scenario manager configuration
 */
export const DEFAULT_SCENARIO_MANAGER_CONFIG: ScenarioManagerConfig = {
  enabled: true,
  scenarios: [],
  checkIntervalMs: 1000
};

/**
 * Scenario execution state
 */
interface ScenarioState {
  scenario: MarketScenario;
  startTime: number;
  isActive: boolean;
  progress: number;
}

/**
 * Scenario Manager class
 */
export class ScenarioManager {
  private static instance: ScenarioManager | null = null;
  private config: ScenarioManagerConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[ScenarioManager] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[ScenarioManager] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[ScenarioManager] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[ScenarioManager] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private simulationEngine: SimulationEngine;
  private activeScenarios: Map<string, ScenarioState>;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): ScenarioManager {
    if (!ScenarioManager.instance) {
      ScenarioManager.instance = new ScenarioManager();
    }
    return ScenarioManager.instance;
  }

  constructor(config: Partial<ScenarioManagerConfig> = {}) {
    this.config = { ...DEFAULT_SCENARIO_MANAGER_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.simulationEngine = SimulationEngine.getInstance();
    this.activeScenarios = new Map();
  }

  /**
   * Load scenarios from configuration
   */
  public loadScenarios(scenarios: MarketScenario[]): void {
    if (!this.config.enabled) return;

    this.config.scenarios = scenarios;
    this.logger.info(`Loaded ${scenarios.length} market scenarios`);
  }

  /**
   * Start scenario monitoring
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Scenario manager is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Scenario manager is already running');
      return;
    }

    this.isRunning = true;
    this.checkInterval = setInterval(() => this.updateScenarios(), this.config.checkIntervalMs);
    this.logger.info('Scenario manager started');
  }

  /**
   * Stop scenario monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Scenario manager stopped');
  }

  /**
   * Update active scenarios
   */
  private updateScenarios(): void {
    if (!this.config.enabled || !this.isRunning) return;

    // Check for new scenarios to activate
    for (const scenario of this.config.scenarios) {
      if (!this.activeScenarios.has(scenario.name) && this.checkPreconditions(scenario)) {
        this.activateScenario(scenario);
      }
    }

    // Update active scenarios
    for (const [name, state] of this.activeScenarios.entries()) {
      if (state.isActive) {
        this.updateScenarioState(state);
      }
    }
  }

  /**
   * Check scenario preconditions
   */
  private checkPreconditions(scenario: MarketScenario): boolean {
    if (!scenario.preconditions) return true;

    const currentState = this.simulationEngine.getSimulationState();
    const marketData = this.simulationEngine.getCurrentMarketData();

    if (scenario.preconditions.minLiquidity && 
        marketData.liquidity < scenario.preconditions.minLiquidity) {
      return false;
    }

    if (scenario.preconditions.maxVolatility && 
        marketData.volatility > scenario.preconditions.maxVolatility) {
      return false;
    }

    // TODO: Check required assets if specified

    return true;
  }

  /**
   * Activate a scenario
   */
  private activateScenario(scenario: MarketScenario): void {
    const state: ScenarioState = {
      scenario,
      startTime: Date.now(),
      isActive: true,
      progress: 0
    };

    this.activeScenarios.set(scenario.name, state);
    this.logger.info(`Activated scenario: ${scenario.name}`);

    this.telemetryEngine.emitSimulationEvent({
      type: 'SCENARIO_ACTIVATED',
      scenario: scenario.name,
      timestamp: Date.now()
    });
  }

  /**
   * Update scenario state
   */
  private updateScenarioState(state: ScenarioState): void {
    const elapsedTime = Date.now() - state.startTime;
    const event = state.scenario.event;

    switch (event.type) {
      case 'flash_crash':
        this.updateFlashCrash(state, elapsedTime);
        break;
      case 'volatility_expansion':
        this.updateVolatilityExpansion(state, elapsedTime);
        break;
      case 'illiquidity_cascade':
        this.updateIlliquidityCascade(state, elapsedTime);
        break;
      case 'pump_and_dump':
        this.updatePumpAndDump(state, elapsedTime);
        break;
    }

    // Check if scenario is complete
    if (this.isScenarioComplete(state, elapsedTime)) {
      this.completeScenario(state);
    }
  }

  /**
   * Update flash crash scenario
   */
  private updateFlashCrash(state: ScenarioState, elapsedTime: number): void {
    const event = state.scenario.event;
    if (!event.priceDropPct || !event.timeWindowSeconds) return;

    const progress = Math.min(1, elapsedTime / (event.timeWindowSeconds * 1000));
    const priceDrop = event.priceDropPct * progress;

    this.simulationEngine.adjustMarketData({
      price: -priceDrop,
      volatility: 2.0 * progress
    });

    state.progress = progress;
  }

  /**
   * Update volatility expansion scenario
   */
  private updateVolatilityExpansion(state: ScenarioState, elapsedTime: number): void {
    const event = state.scenario.event;
    if (!event.volatilityMultiplier || !event.durationSeconds) return;

    const progress = Math.min(1, elapsedTime / (event.durationSeconds * 1000));
    const volatilityMultiplier = 1 + (event.volatilityMultiplier - 1) * progress;

    this.simulationEngine.adjustMarketData({
      volatility: volatilityMultiplier
    });

    state.progress = progress;
  }

  /**
   * Update illiquidity cascade scenario
   */
  private updateIlliquidityCascade(state: ScenarioState, elapsedTime: number): void {
    const event = state.scenario.event;
    if (!event.bidDepthDropPct || !event.durationSeconds) return;

    const progress = Math.min(1, elapsedTime / (event.durationSeconds * 1000));
    const liquidityDrop = event.bidDepthDropPct * progress;

    this.simulationEngine.adjustMarketData({
      liquidity: -liquidityDrop,
      volatility: 1.5 * progress
    });

    state.progress = progress;
  }

  /**
   * Update pump and dump scenario
   */
  private updatePumpAndDump(state: ScenarioState, elapsedTime: number): void {
    const event = state.scenario.event;
    if (!event.volumeSpikePct || !event.durationSeconds) return;

    const progress = Math.min(1, elapsedTime / (event.durationSeconds * 1000));
    const volumeSpike = event.volumeSpikePct * progress;
    const pricePump = Math.sin(progress * Math.PI) * 0.2; // 20% price swing

    this.simulationEngine.adjustMarketData({
      price: pricePump,
      volume: volumeSpike,
      volatility: 1.2 * progress
    });

    state.progress = progress;
  }

  /**
   * Check if scenario is complete
   */
  private isScenarioComplete(state: ScenarioState, elapsedTime: number): boolean {
    const event = state.scenario.event;
    const duration = event.durationSeconds || event.timeWindowSeconds || 0;
    return elapsedTime >= duration * 1000;
  }

  /**
   * Complete a scenario
   */
  private completeScenario(state: ScenarioState): void {
    state.isActive = false;
    this.logger.info(`Completed scenario: ${state.scenario.name}`);

    this.telemetryEngine.emitSimulationEvent({
      type: 'SCENARIO_COMPLETED',
      scenario: state.scenario.name,
      timestamp: Date.now()
    });
  }

  /**
   * Get active scenarios
   */
  public getActiveScenarios(): ScenarioState[] {
    return Array.from(this.activeScenarios.values());
  }

  /**
   * Reset scenario manager
   */
  public reset(): void {
    this.activeScenarios.clear();
    this.logger.info('Scenario manager reset');
  }
} 