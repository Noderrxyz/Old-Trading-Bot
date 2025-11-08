/**
 * Simulation Engine
 * 
 * Simulates trading sessions using recorded market data and injects various market faults
 * to test system resilience under extreme conditions.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/ExecutionTelemetryEngine.js';

/**
 * Simulation engine configuration
 */
export interface SimulationEngineConfig {
  enabled: boolean;
  playbackSpeed: number;
  faultInjection: {
    oracleLagSeconds: number[];
    txLatencySpikeChance: number;
    dexDowntimeProbability: number;
  };
  maxSimulationTimeMs: number;
  checkIntervalMs: number;
}

/**
 * Default simulation engine configuration
 */
export const DEFAULT_SIMULATION_ENGINE_CONFIG: SimulationEngineConfig = {
  enabled: true,
  playbackSpeed: 1.0,
  faultInjection: {
    oracleLagSeconds: [5, 15],
    txLatencySpikeChance: 0.02,
    dexDowntimeProbability: 0.01
  },
  maxSimulationTimeMs: 3600000, // 1 hour
  checkIntervalMs: 1000
};

/**
 * Market data for simulation
 */
export interface MarketData {
  timestamp: number;
  price: number;
  volume: number;
  liquidity: number;
  volatility: number;
}

/**
 * Fault injection state
 */
interface FaultState {
  oracleLag: number;
  txLatency: number;
  dexAvailable: boolean;
}

/**
 * Simulation Engine class
 */
export class SimulationEngine {
  private static instance: SimulationEngine | null = null;
  private config: SimulationEngineConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[SimulationEngine] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[SimulationEngine] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[SimulationEngine] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[SimulationEngine] ${msg}`, ...args)
  };
  private telemetryEngine: ExecutionTelemetryEngine;
  private marketData: MarketData[];
  private currentIndex: number;
  private startTime: number;
  private faultState: FaultState;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): SimulationEngine {
    if (!SimulationEngine.instance) {
      SimulationEngine.instance = new SimulationEngine();
    }
    return SimulationEngine.instance;
  }

  constructor(config: Partial<SimulationEngineConfig> = {}) {
    this.config = { ...DEFAULT_SIMULATION_ENGINE_CONFIG, ...config };
    this.telemetryEngine = ExecutionTelemetryEngine.getInstance();
    this.marketData = [];
    this.currentIndex = 0;
    this.startTime = 0;
    this.faultState = {
      oracleLag: 0,
      txLatency: 0,
      dexAvailable: true
    };
  }

  /**
   * Load market data for simulation
   */
  public loadMarketData(data: MarketData[]): void {
    if (!this.config.enabled) return;

    this.marketData = data;
    this.currentIndex = 0;
    this.logger.info(`Loaded ${data.length} market data points for simulation`);
  }

  /**
   * Start simulation
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Simulation engine is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Simulation engine is already running');
      return;
    }

    if (this.marketData.length === 0) {
      this.logger.error('No market data loaded for simulation');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.checkInterval = setInterval(() => this.updateSimulation(), this.config.checkIntervalMs);
    this.logger.info('Simulation engine started');
  }

  /**
   * Stop simulation
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Simulation engine stopped');
  }

  /**
   * Update simulation state
   */
  private updateSimulation(): void {
    if (!this.config.enabled || !this.isRunning) return;

    // Check if simulation time limit reached
    const elapsedTime = Date.now() - this.startTime;
    if (elapsedTime >= this.config.maxSimulationTimeMs) {
      this.logger.info('Simulation time limit reached');
      this.stop();
      return;
    }

    // Calculate current market data index based on playback speed
    const simulatedTime = elapsedTime * this.config.playbackSpeed;
    const targetIndex = Math.floor(simulatedTime / 1000); // Assuming 1-second intervals

    if (targetIndex >= this.marketData.length) {
      this.logger.info('Simulation completed - all market data processed');
      this.stop();
      return;
    }

    // Update current index and inject faults
    this.currentIndex = targetIndex;
    this.injectFaults();

    // Emit market data with injected faults
    const currentData = this.marketData[this.currentIndex];
    this.emitMarketData(currentData);
  }

  /**
   * Inject market faults
   */
  private injectFaults(): void {
    // Inject oracle lag
    if (Math.random() < this.config.faultInjection.txLatencySpikeChance) {
      const [minLag, maxLag] = this.config.faultInjection.oracleLagSeconds;
      this.faultState.oracleLag = Math.floor(Math.random() * (maxLag - minLag + 1)) + minLag;
      this.logger.warn(`Injected oracle lag: ${this.faultState.oracleLag} seconds`);
    }

    // Inject transaction latency spike
    if (Math.random() < this.config.faultInjection.txLatencySpikeChance) {
      this.faultState.txLatency = Math.floor(Math.random() * 5000) + 1000; // 1-6 seconds
      this.logger.warn(`Injected transaction latency spike: ${this.faultState.txLatency}ms`);
    }

    // Inject DEX downtime
    if (Math.random() < this.config.faultInjection.dexDowntimeProbability) {
      this.faultState.dexAvailable = false;
      this.logger.warn('Injected DEX downtime');
      
      // Schedule DEX recovery
      setTimeout(() => {
        this.faultState.dexAvailable = true;
        this.logger.info('DEX recovered from downtime');
      }, Math.floor(Math.random() * 30000) + 10000); // 10-40 seconds
    }
  }

  /**
   * Emit market data with injected faults
   */
  private emitMarketData(data: MarketData): void {
    const faultedData = {
      ...data,
      oracleLag: this.faultState.oracleLag,
      txLatency: this.faultState.txLatency,
      dexAvailable: this.faultState.dexAvailable
    };

    this.telemetryEngine.emitSimulationEvent({
      type: 'MARKET_DATA',
      data: faultedData,
      timestamp: Date.now()
    });

    this.logger.debug(
      `Emitted market data: Price=${data.price}, ` +
      `OracleLag=${this.faultState.oracleLag}s, ` +
      `TxLatency=${this.faultState.txLatency}ms, ` +
      `DEX=${this.faultState.dexAvailable ? 'UP' : 'DOWN'}`
    );
  }

  /**
   * Get current simulation state
   */
  public getSimulationState(): {
    currentIndex: number;
    totalDataPoints: number;
    elapsedTime: number;
    faultState: FaultState;
  } {
    return {
      currentIndex: this.currentIndex,
      totalDataPoints: this.marketData.length,
      elapsedTime: Date.now() - this.startTime,
      faultState: { ...this.faultState }
    };
  }

  /**
   * Reset simulation state
   */
  public reset(): void {
    this.marketData = [];
    this.currentIndex = 0;
    this.startTime = 0;
    this.faultState = {
      oracleLag: 0,
      txLatency: 0,
      dexAvailable: true
    };
    this.logger.info('Simulation state reset');
  }
} 