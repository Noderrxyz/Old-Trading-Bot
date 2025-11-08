import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';

/**
 * Trust manager configuration
 */
interface TrustManagerConfig {
  minTrustScore: number;
  trustDecayRate: number;
  trustUpdateIntervalMs: number;
  maxTrustScore: number;
  minTrustScoreForMutation: number;
}

/**
 * Default trust manager configuration
 */
const DEFAULT_TRUST_CONFIG: TrustManagerConfig = {
  minTrustScore: 0.1,
  trustDecayRate: 0.01,
  trustUpdateIntervalMs: 60000,
  maxTrustScore: 1.0,
  minTrustScoreForMutation: 0.4
};

/**
 * Trust score data
 */
interface TrustScore {
  score: number;
  lastUpdated: number;
  history: number[];
  maxHistorySize: number;
}

/**
 * Trust Manager
 */
export class TrustManager {
  private static instance: TrustManager;
  private config: TrustManagerConfig;
  private trustScores: Map<string, TrustScore>;
  private telemetryBus: TelemetryBus;
  private updateInterval: NodeJS.Timeout;

  private constructor(config: Partial<TrustManagerConfig> = {}) {
    this.config = { ...DEFAULT_TRUST_CONFIG, ...config };
    this.trustScores = new Map();
    this.telemetryBus = TelemetryBus.getInstance();
    this.updateInterval = setInterval(() => this.updateTrustScores(), this.config.trustUpdateIntervalMs);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<TrustManagerConfig>): TrustManager {
    if (!TrustManager.instance) {
      TrustManager.instance = new TrustManager(config);
    }
    return TrustManager.instance;
  }

  /**
   * Get trust score for agent
   */
  public getTrustScore(agentId: string): number {
    const score = this.trustScores.get(agentId);
    return score ? score.score : this.config.minTrustScore;
  }

  /**
   * Update trust score
   */
  public updateTrustScore(agentId: string, newScore: number): void {
    const currentScore = this.trustScores.get(agentId);
    const score: TrustScore = {
      score: Math.min(Math.max(newScore, this.config.minTrustScore), this.config.maxTrustScore),
      lastUpdated: Date.now(),
      history: currentScore ? [...currentScore.history, newScore] : [newScore],
      maxHistorySize: 100
    };

    // Trim history if needed
    if (score.history.length > score.maxHistorySize) {
      score.history = score.history.slice(-score.maxHistorySize);
    }

    this.trustScores.set(agentId, score);
    this.telemetryBus.emit('trust_score_updated', { agentId, score: score.score });
  }

  /**
   * Check if agent can mutate
   */
  public canMutate(agentId: string): boolean {
    return this.getTrustScore(agentId) >= this.config.minTrustScoreForMutation;
  }

  /**
   * Update trust scores with decay
   */
  private updateTrustScores(): void {
    const now = Date.now();
    for (const [agentId, score] of this.trustScores.entries()) {
      const timeSinceUpdate = now - score.lastUpdated;
      const decay = this.config.trustDecayRate * (timeSinceUpdate / this.config.trustUpdateIntervalMs);
      const newScore = Math.max(score.score - decay, this.config.minTrustScore);
      
      if (newScore !== score.score) {
        this.updateTrustScore(agentId, newScore);
      }
    }
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    clearInterval(this.updateInterval);
  }
} 