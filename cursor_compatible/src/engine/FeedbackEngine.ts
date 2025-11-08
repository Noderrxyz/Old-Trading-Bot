import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AlphaMemoryManager, MarketRegime, StrategyPattern } from '../memory/AlphaMemoryManager.js';
import { ExecutionRouter } from '../execution/ExecutionRouter.js';
import { MutationEngine } from '../evolution/MutationEngine.js';
import { TrustManager } from '../trust/TrustManager.js';

/**
 * Feedback configuration
 */
interface FeedbackConfig {
  updateIntervalMs: number;
  minPatternAgeMs: number;
  maxPatternsPerUpdate: number;
  pnlWeight: number;
  trustWeight: number;
  consistencyWeight: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: FeedbackConfig = {
  updateIntervalMs: 300000, // 5 minutes
  minPatternAgeMs: 3600000, // 1 hour
  maxPatternsPerUpdate: 10,
  pnlWeight: 0.4,
  trustWeight: 0.3,
  consistencyWeight: 0.3
};

/**
 * Feedback Engine
 */
export class FeedbackEngine {
  private static instance: FeedbackEngine;
  private config: FeedbackConfig;
  private telemetryBus: TelemetryBus;
  private alphaMemory: AlphaMemoryManager;
  private executionRouter: ExecutionRouter;
  private mutationEngine: MutationEngine;
  private trustManager: TrustManager;
  private updateInterval: NodeJS.Timeout;

  private constructor(config: Partial<FeedbackConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.alphaMemory = AlphaMemoryManager.getInstance();
    this.executionRouter = ExecutionRouter.getInstance();
    this.mutationEngine = MutationEngine.getInstance();
    this.trustManager = TrustManager.getInstance();

    this.updateInterval = setInterval(
      () => this.updateFeedback(),
      this.config.updateIntervalMs
    );
  }

  public static getInstance(config?: Partial<FeedbackConfig>): FeedbackEngine {
    if (!FeedbackEngine.instance) {
      FeedbackEngine.instance = new FeedbackEngine(config);
    }
    return FeedbackEngine.instance;
  }

  /**
   * Update feedback loop
   */
  private async updateFeedback(): Promise<void> {
    try {
      const now = Date.now();
      const agents = this.trustManager.getActiveAgents();

      for (const agentId of agents) {
        const patterns = await this.getRecentPatterns(agentId);
        if (patterns.length === 0) continue;

        // Inject into execution router
        this.injectIntoExecutionRouter(agentId, patterns);

        // Inject into mutation engine
        this.injectIntoMutationEngine(agentId, patterns);

        // Update trust scores
        this.updateTrustScores(agentId, patterns);
      }

      this.telemetryBus.emit('feedback_loop_updated', {
        timestamp: now,
        agentCount: agents.length
      });
    } catch (error) {
      logger.error('Error in feedback loop update:', error);
      this.telemetryBus.emit('feedback_loop_error', { error });
    }
  }

  /**
   * Get recent patterns
   */
  private async getRecentPatterns(agentId: string): Promise<StrategyPattern[]> {
    const now = Date.now();
    const patterns = this.alphaMemory.getPatterns(agentId, 'bull'); // Get patterns for current regime

    return patterns
      .filter(pattern => now - pattern.timestamp >= this.config.minPatternAgeMs)
      .slice(0, this.config.maxPatternsPerUpdate);
  }

  /**
   * Inject patterns into execution router
   */
  private injectIntoExecutionRouter(agentId: string, patterns: StrategyPattern[]): void {
    const routePreferences = patterns.map(pattern => ({
      venue: pattern.metadata.venue,
      boost: this.calculateBoost(pattern)
    }));

    this.executionRouter.updateRoutePreferences(agentId, routePreferences);
  }

  /**
   * Inject patterns into mutation engine
   */
  private injectIntoMutationEngine(agentId: string, patterns: StrategyPattern[]): void {
    const strategyBiases = patterns.map(pattern => ({
      strategy: pattern.strategy,
      bias: this.calculateBoost(pattern)
    }));

    this.mutationEngine.updateStrategyBiases(agentId, strategyBiases);
  }

  /**
   * Update trust scores
   */
  private updateTrustScores(agentId: string, patterns: StrategyPattern[]): void {
    const averageScore = patterns.reduce((sum, pattern) => {
      return sum + this.calculateBoost(pattern);
    }, 0) / patterns.length;

    this.trustManager.updateTrustScore(agentId, averageScore);
  }

  /**
   * Calculate boost value
   */
  private calculateBoost(pattern: StrategyPattern): number {
    return (
      pattern.pnl * this.config.pnlWeight +
      pattern.trustScore * this.config.trustWeight +
      pattern.consistency * this.config.consistencyWeight
    );
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    clearInterval(this.updateInterval);
  }
} 