import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AgentKillSwitch } from '../agents/AgentKillSwitch.js';
import { TrustManager } from '../evolution/TrustManager.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Anomaly scanner configuration
 */
interface AnomalyConfig {
  sigmaThreshold: number;
  windowSize: number;
  minSamples: number;
  cooldownPeriodMs: number;
  logFilePath: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AnomalyConfig = {
  sigmaThreshold: 5, // 5 standard deviations
  windowSize: 100, // Last 100 trades
  minSamples: 10, // Minimum samples needed
  cooldownPeriodMs: 3600000, // 1 hour cooldown
  logFilePath: 'logs/risk/anomalies.jsonl'
};

/**
 * Anomaly state
 */
interface AnomalyState {
  agentId: string;
  recentPnL: number[];
  mean: number;
  stdDev: number;
  lastAnomalyTime?: number;
  isInCooldown: boolean;
}

/**
 * Anomaly event
 */
interface AnomalyEvent {
  type: 'spike' | 'recovery';
  timestamp: number;
  agentId: string;
  pnl: number;
  sigma: number;
  mean: number;
  stdDev: number;
  message: string;
}

/**
 * Anomaly Scanner
 */
export class AnomalyScanner {
  private static instance: AnomalyScanner;
  private config: AnomalyConfig;
  private telemetryBus: TelemetryBus;
  private killSwitch: AgentKillSwitch;
  private trustManager: TrustManager;
  private states: Map<string, AnomalyState>;
  private logStream: fs.WriteStream;

  private constructor(config: Partial<AnomalyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.killSwitch = AgentKillSwitch.getInstance();
    this.trustManager = TrustManager.getInstance();
    this.states = new Map();
    this.setupLogging();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<AnomalyConfig>): AnomalyScanner {
    if (!AnomalyScanner.instance) {
      AnomalyScanner.instance = new AnomalyScanner(config);
    }
    return AnomalyScanner.instance;
  }

  /**
   * Setup logging
   */
  private setupLogging(): void {
    const logDir = path.dirname(this.config.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logStream = fs.createWriteStream(this.config.logFilePath, { flags: 'a' });
  }

  /**
   * Process trade
   */
  public processTrade(agentId: string, pnl: number): void {
    const state = this.getOrCreateState(agentId);

    // Skip if in cooldown
    if (state.isInCooldown) {
      if (state.lastAnomalyTime && Date.now() - state.lastAnomalyTime >= this.config.cooldownPeriodMs) {
        state.isInCooldown = false;
        state.lastAnomalyTime = undefined;
      } else {
        return;
      }
    }

    // Update PnL history
    state.recentPnL.push(pnl);
    if (state.recentPnL.length > this.config.windowSize) {
      state.recentPnL.shift();
    }

    // Skip if not enough samples
    if (state.recentPnL.length < this.config.minSamples) {
      return;
    }

    // Calculate statistics
    this.updateStatistics(state);

    // Check for anomaly
    const sigma = Math.abs((pnl - state.mean) / state.stdDev);
    if (sigma >= this.config.sigmaThreshold) {
      this.handleAnomaly(agentId, state, pnl, sigma);
    }
  }

  /**
   * Get or create state
   */
  private getOrCreateState(agentId: string): AnomalyState {
    let state = this.states.get(agentId);
    if (!state) {
      state = {
        agentId,
        recentPnL: [],
        mean: 0,
        stdDev: 0,
        isInCooldown: false
      };
      this.states.set(agentId, state);
    }
    return state;
  }

  /**
   * Update statistics
   */
  private updateStatistics(state: AnomalyState): void {
    const { recentPnL } = state;

    // Calculate mean
    state.mean = recentPnL.reduce((a, b) => a + b, 0) / recentPnL.length;

    // Calculate standard deviation
    const variance = recentPnL.reduce((a, b) => a + Math.pow(b - state.mean, 2), 0) / (recentPnL.length - 1);
    state.stdDev = Math.sqrt(variance);
  }

  /**
   * Handle anomaly
   */
  private handleAnomaly(agentId: string, state: AnomalyState, pnl: number, sigma: number): void {
    state.isInCooldown = true;
    state.lastAnomalyTime = Date.now();

    const event: AnomalyEvent = {
      type: 'spike',
      timestamp: Date.now(),
      agentId,
      pnl,
      sigma,
      mean: state.mean,
      stdDev: state.stdDev,
      message: `Anomaly detected: ${sigma.toFixed(2)}σ PnL spike (${pnl.toFixed(4)})`
    };

    this.logEvent(event);
    this.killSwitch.trigger(agentId, 'anomaly_detected', event.message);
    this.trustManager.updateTrustScore(agentId, -0.1); // Decay trust score
  }

  /**
   * Log event
   */
  private logEvent(event: AnomalyEvent): void {
    this.logStream.write(JSON.stringify(event) + '\n');
    logger.warn(`[AnomalyScanner] ${event.message}`);
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.logStream.end();
  }
} 