import { setLogLevel, LogLevel } from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { MarketRegimeState } from '../market/types/market.types.js';
import { 
  AlphaMemoryConfig, 
  DEFAULT_ALPHA_MEMORY_CONFIG,
  RegimePerformanceMetrics,
  RegimeMemoryWindow
} from './types/alpha_memory.types.js';
import { SimulationEventType, RiskMetrics } from '../simulation/types/simulation.types.js';

// Create a simple logger for this module
const logger = {
  info: (message: string, ...args: any[]) => {
    if (process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) <= LogLevel.INFO : true) {
      console.log(`[AlphaMemoryManager] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    if (process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) <= LogLevel.ERROR : true) {
      console.error(`[AlphaMemoryManager] ${message}`, ...args);
    }
  }
};

export class AlphaMemoryManager {
  private static instance: AlphaMemoryManager | null = null;
  private config: AlphaMemoryConfig;
  private memoryWindows: Map<MarketRegimeState, RegimeMemoryWindow>;
  private updateInterval: NodeJS.Timeout | null = null;
  private lastUpdate: number = 0;

  private constructor(config: Partial<AlphaMemoryConfig> = {}) {
    this.config = { ...DEFAULT_ALPHA_MEMORY_CONFIG, ...config };
    this.memoryWindows = new Map();
    this.initializeMemoryWindows();
  }

  public static getInstance(config?: Partial<AlphaMemoryConfig>): AlphaMemoryManager {
    if (!AlphaMemoryManager.instance) {
      AlphaMemoryManager.instance = new AlphaMemoryManager(config);
    }
    return AlphaMemoryManager.instance;
  }

  /**
   * Initialize memory windows for each regime
   */
  private initializeMemoryWindows(): void {
    Object.values(MarketRegimeState).forEach(regime => {
      this.memoryWindows.set(regime, {
        regime,
        topStrategies: [],
        lastUpdate: Date.now(),
        confidence: 0
      });
    });
  }

  /**
   * Start the memory manager
   */
  public start(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(
      () => this.updateMemoryWindows(),
      this.config.updateIntervalMs
    );

    logger.info('AlphaMemoryManager started');
  }

  /**
   * Stop the memory manager
   */
  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    logger.info('AlphaMemoryManager stopped');
  }

  /**
   * Update strategy performance metrics for a specific regime
   */
  public updateStrategyMetrics(
    strategyId: string,
    metrics: RegimePerformanceMetrics
  ): void {
    if (!this.config.enabled) return;

    const window = this.memoryWindows.get(metrics.regime);
    if (!window) return;

    // Find existing strategy or add new one
    const existingIndex = window.topStrategies.findIndex(
      s => s.strategyId === strategyId
    );

    if (existingIndex >= 0) {
      // Update existing strategy
      window.topStrategies[existingIndex] = {
        strategyId,
        metrics,
        weight: this.calculateStrategyWeight(metrics)
      };
    } else {
      // Add new strategy
      window.topStrategies.push({
        strategyId,
        metrics,
        weight: this.calculateStrategyWeight(metrics)
      });
    }

    // Sort strategies by weight
    window.topStrategies.sort((a, b) => b.weight - a.weight);

    // Keep only top strategies
    const windowConfig = this.config.memoryWindows[metrics.regime];
    if (window.topStrategies.length > windowConfig.windowSize) {
      window.topStrategies = window.topStrategies.slice(0, windowConfig.windowSize);
    }

    // Update window confidence
    window.confidence = this.calculateWindowConfidence(window);
    window.lastUpdate = Date.now();

    // Emit telemetry
    this.emitTelemetry(metrics.regime, window);
  }

  /**
   * Get top strategies for a specific regime
   */
  public getTopStrategies(
    regime: MarketRegimeState,
    limit: number = 10
  ): Array<{ strategyId: string; weight: number }> {
    const window = this.memoryWindows.get(regime);
    if (!window) return [];

    return window.topStrategies
      .slice(0, limit)
      .map(s => ({ strategyId: s.strategyId, weight: s.weight }));
  }

  /**
   * Get trust score boost for a strategy in a specific regime
   */
  public getTrustScoreBoost(
    strategyId: string,
    regime: MarketRegimeState
  ): number {
    const window = this.memoryWindows.get(regime);
    if (!window) return 0;

    const strategy = window.topStrategies.find(s => s.strategyId === strategyId);
    if (!strategy) return 0;

    const baseBoost = this.config.trustScoreBoost[regime];
    const weightFactor = strategy.weight;
    const confidenceFactor = window.confidence;

    return baseBoost * weightFactor * confidenceFactor;
  }

  /**
   * Update memory windows
   */
  private updateMemoryWindows(): void {
    const now = Date.now();
    if (now - this.lastUpdate < this.config.updateIntervalMs) return;

    this.memoryWindows.forEach((window, regime) => {
      // Apply decay to old memories
      const decayFactor = this.config.memoryWindows[regime].decayFactor;
      window.topStrategies = window.topStrategies
        .map(strategy => ({
          ...strategy,
          weight: strategy.weight * decayFactor
        }))
        .filter(strategy => strategy.weight > 0.01); // Remove very low weight strategies

      // Update window confidence
      window.confidence = this.calculateWindowConfidence(window);
      window.lastUpdate = now;
    });

    this.lastUpdate = now;
  }

  /**
   * Calculate strategy weight based on performance metrics
   */
  private calculateStrategyWeight(metrics: RegimePerformanceMetrics): number {
    // Normalize metrics to 0-1 range
    const normalizedRoi = Math.min(Math.max(metrics.roi / 2, 0), 1);
    const normalizedSharpe = Math.min(Math.max(metrics.sharpeRatio / 3, 0), 1);
    const normalizedWinRate = metrics.winRate;
    const normalizedDrawdown = 1 - Math.min(Math.max(metrics.maxDrawdown, 0), 1);

    // Calculate composite score
    return (
      normalizedRoi * 0.3 +
      normalizedSharpe * 0.3 +
      normalizedWinRate * 0.2 +
      normalizedDrawdown * 0.2
    );
  }

  /**
   * Calculate window confidence based on strategy weights and recency
   */
  private calculateWindowConfidence(window: RegimeMemoryWindow): number {
    if (window.topStrategies.length === 0) return 0;

    const now = Date.now();
    const recencyFactor = Math.exp(
      -(now - window.lastUpdate) / (24 * 60 * 60 * 1000)
    ); // Decay over 24 hours

    const avgWeight = window.topStrategies.reduce(
      (sum, s) => sum + s.weight,
      0
    ) / window.topStrategies.length;

    return Math.min(avgWeight * recencyFactor, 1);
  }

  /**
   * Emit telemetry for memory window updates
   */
  private emitTelemetry(regime: MarketRegimeState, window: RegimeMemoryWindow): void {
    const metrics: RiskMetrics = {
      var95: 0,  // Not applicable for memory windows
      var99: 0,  // Not applicable for memory windows
      expectedShortfall: 0,  // Not applicable for memory windows
      tailRisk: window.confidence  // Use confidence as a proxy for tail risk
    };

    ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
      type: SimulationEventType.RiskProfileUpdate,
      metrics,
      timestamp: Date.now()
    });
  }
} 