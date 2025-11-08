import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

interface TrustConfig {
  decayFactor: number;
  minTrustScore: number;
  maxTrustScore: number;
  trustFilePath: string;
}

const DEFAULT_CONFIG: TrustConfig = {
  decayFactor: 0.9,
  minTrustScore: 0.1,
  maxTrustScore: 1.0,
  trustFilePath: path.join(process.cwd(), 'data', 'trust_scores.json')
};

interface VenueTrust {
  score: number;
  lastUpdated: number;
  failureCount: number;
}

export class TrustManager {
  private static instance: TrustManager;
  private config: TrustConfig;
  private trustScores: Map<string, VenueTrust>;

  private constructor(config: Partial<TrustConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trustScores = new Map();
    this.loadTrustScores();
  }

  public static getInstance(config?: Partial<TrustConfig>): TrustManager {
    if (!TrustManager.instance) {
      TrustManager.instance = new TrustManager(config);
    }
    return TrustManager.instance;
  }

  private loadTrustScores(): void {
    try {
      if (fs.existsSync(this.config.trustFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.config.trustFilePath, 'utf8'));
        this.trustScores = new Map(Object.entries(data));
      }
    } catch (error) {
      logger.error('Failed to load trust scores:', error);
    }
  }

  private saveTrustScores(): void {
    try {
      const data = Object.fromEntries(this.trustScores);
      fs.writeFileSync(this.config.trustFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save trust scores:', error);
    }
  }

  public getTrustScore(venue: string): number {
    const trust = this.trustScores.get(venue);
    return trust ? trust.score : this.config.maxTrustScore;
  }

  public decay(venue: string): void {
    const currentTrust = this.trustScores.get(venue) || {
      score: this.config.maxTrustScore,
      lastUpdated: Date.now(),
      failureCount: 0
    };

    const newScore = Math.max(
      currentTrust.score * this.config.decayFactor,
      this.config.minTrustScore
    );

    this.trustScores.set(venue, {
      score: newScore,
      lastUpdated: Date.now(),
      failureCount: currentTrust.failureCount + 1
    });

    this.saveTrustScores();
    logger.warn(`Trust score decayed for ${venue} to ${newScore}`);
  }

  public improve(venue: string): void {
    const currentTrust = this.trustScores.get(venue) || {
      score: this.config.maxTrustScore,
      lastUpdated: Date.now(),
      failureCount: 0
    };

    const newScore = Math.min(
      currentTrust.score / this.config.decayFactor,
      this.config.maxTrustScore
    );

    this.trustScores.set(venue, {
      score: newScore,
      lastUpdated: Date.now(),
      failureCount: Math.max(0, currentTrust.failureCount - 1)
    });

    this.saveTrustScores();
    logger.info(`Trust score improved for ${venue} to ${newScore}`);
  }

  public getVenueRankings(): Array<{ venue: string; score: number }> {
    return Array.from(this.trustScores.entries())
      .map(([venue, trust]) => ({ venue, score: trust.score }))
      .sort((a, b) => b.score - a.score);
  }

  public cleanup(): void {
    this.saveTrustScores();
  }
} 