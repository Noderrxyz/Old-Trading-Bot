import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AlphaMemoryEngine } from '../memory/AlphaMemoryEngine.js';
import { RegimeClassifier } from '../memory/models/RegimeClassifier.js';

interface DecayMetrics {
  pnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  strategyLag: number;
  regimeMatch: number;
}

interface DecayConfig {
  decayRate: number;
  minTrust: number;
  maxDrawdown: number;
  volatilityThreshold: number;
  lagThreshold: number;
  regimeMismatchThreshold: number;
  telemetryEnabled: boolean;
}

const DEFAULT_CONFIG: DecayConfig = {
  decayRate: 0.1,
  minTrust: 0.3,
  maxDrawdown: 0.2,
  volatilityThreshold: 0.3,
  lagThreshold: 1000,
  regimeMismatchThreshold: 0.5,
  telemetryEnabled: true
};

export class AlphaDecayWatcher {
  private static instance: AlphaDecayWatcher;
  private config: DecayConfig;
  private telemetryBus: TelemetryBus;
  private memoryEngine: AlphaMemoryEngine;
  private regimeClassifier: RegimeClassifier;
  private agentMetrics: Map<string, DecayMetrics>;
  private agentTrust: Map<string, number>;

  private constructor(config: Partial<DecayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.memoryEngine = AlphaMemoryEngine.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.agentMetrics = new Map();
    this.agentTrust = new Map();
  }

  public static getInstance(config?: Partial<DecayConfig>): AlphaDecayWatcher {
    if (!AlphaDecayWatcher.instance) {
      AlphaDecayWatcher.instance = new AlphaDecayWatcher(config);
    }
    return AlphaDecayWatcher.instance;
  }

  public observe(agentId: string, metrics: DecayMetrics): void {
    this.agentMetrics.set(agentId, metrics);
    this.updateTrust(agentId);
    this.checkDecay(agentId);
  }

  private updateTrust(agentId: string): void {
    const metrics = this.agentMetrics.get(agentId);
    if (!metrics) return;

    const currentTrust = this.agentTrust.get(agentId) ?? 1.0;
    let decayFactor = 0;

    // Check for sustained underperformance
    if (metrics.pnl < 0) {
      decayFactor += this.config.decayRate;
    }

    // Check for regime mismatch
    const regimeMatch = this.regimeClassifier.getRegimeMatch(metrics.regimeMatch);
    if (regimeMatch < this.config.regimeMismatchThreshold) {
      decayFactor += this.config.decayRate;
    }

    // Check for high volatility and strategy lag
    if (metrics.volatility > this.config.volatilityThreshold && 
        metrics.strategyLag > this.config.lagThreshold) {
      decayFactor += this.config.decayRate;
    }

    const newTrust = Math.max(0, currentTrust - decayFactor);
    this.agentTrust.set(agentId, newTrust);

    this.emitTelemetry('trust_updated', {
      agentId,
      trust: newTrust,
      decayFactor,
      metrics
    });
  }

  private checkDecay(agentId: string): void {
    const trust = this.agentTrust.get(agentId);
    const metrics = this.agentMetrics.get(agentId);
    if (!trust || !metrics) return;

    if (trust < this.config.minTrust) {
      this.emitTelemetry('capital_throttle', { agentId, trust });
    }

    if (metrics.maxDrawdown > this.config.maxDrawdown) {
      this.emitTelemetry('mutation_fallback', { agentId, drawdown: metrics.maxDrawdown });
    }

    if (trust < this.config.minTrust * 0.5) {
      this.emitTelemetry('kill_flag', { agentId, trust });
    }
  }

  public getTrust(agentId: string): number {
    return this.agentTrust.get(agentId) ?? 1.0;
  }

  public getMetrics(agentId: string): DecayMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  private emitTelemetry(event: string, data: any): void {
    if (this.config.telemetryEnabled) {
      this.telemetryBus.emit('alpha_decay', {
        type: event,
        timestamp: Date.now(),
        data
      });
    }
  }

  public cleanup(): void {
    this.agentMetrics.clear();
    this.agentTrust.clear();
  }
} 