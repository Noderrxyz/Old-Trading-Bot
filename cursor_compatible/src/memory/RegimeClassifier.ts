import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface RegimeMetrics {
  volatility: number;
  trendStrength: number;
  volumeProfile: number;
  marketDepth: number;
  correlation: number;
}

export interface RegimeClassification {
  regime: string;
  confidence: number;
  metrics: RegimeMetrics;
}

export class RegimeClassifier {
  private static instance: RegimeClassifier;
  private readonly REGIME_FILE = 'data/regime_history.jsonl';
  private readonly THRESHOLDS = {
    BULL: { volatility: 0.3, trendStrength: 0.7, volumeProfile: 0.6 },
    BEAR: { volatility: 0.3, trendStrength: 0.7, volumeProfile: 0.6 },
    RANGE: { volatility: 0.2, trendStrength: 0.3, volumeProfile: 0.4 },
    VOLATILE: { volatility: 0.5, trendStrength: 0.4, volumeProfile: 0.7 },
    STABLE: { volatility: 0.2, trendStrength: 0.3, volumeProfile: 0.4 }
  };

  private constructor() {
    this.ensureRegimeFile();
  }

  public static getInstance(): RegimeClassifier {
    if (!RegimeClassifier.instance) {
      RegimeClassifier.instance = new RegimeClassifier();
    }
    return RegimeClassifier.instance;
  }

  private ensureRegimeFile() {
    const dir = path.dirname(this.REGIME_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.REGIME_FILE)) {
      fs.writeFileSync(this.REGIME_FILE, '');
    }
  }

  public classifyRegime(metrics: RegimeMetrics): RegimeClassification {
    const scores = this.calculateRegimeScores(metrics);
    const bestRegime = this.selectBestRegime(scores);
    
    this.recordClassification({
      regime: bestRegime.regime,
      confidence: bestRegime.confidence,
      metrics
    });

    return bestRegime;
  }

  private calculateRegimeScores(metrics: RegimeMetrics): Map<string, number> {
    const scores = new Map<string, number>();
    
    // Calculate score for each regime type
    for (const [regime, thresholds] of Object.entries(this.THRESHOLDS)) {
      const volatilityScore = this.calculateMetricScore(metrics.volatility, thresholds.volatility);
      const trendScore = this.calculateMetricScore(metrics.trendStrength, thresholds.trendStrength);
      const volumeScore = this.calculateMetricScore(metrics.volumeProfile, thresholds.volumeProfile);
      
      // Weighted average of scores
      const totalScore = (volatilityScore * 0.4 + trendScore * 0.4 + volumeScore * 0.2);
      scores.set(regime, totalScore);
    }
    
    return scores;
  }

  private calculateMetricScore(value: number, threshold: number): number {
    return Math.max(0, 1 - Math.abs(value - threshold) / threshold);
  }

  private selectBestRegime(scores: Map<string, number>): RegimeClassification {
    let bestRegime = '';
    let bestScore = -1;
    
    for (const [regime, score] of scores.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestRegime = regime;
      }
    }
    
    return {
      regime: bestRegime,
      confidence: bestScore,
      metrics: this.getCurrentMetrics()
    };
  }

  private getCurrentMetrics(): RegimeMetrics {
    // In a real implementation, this would fetch current market metrics
    return {
      volatility: 0.3,
      trendStrength: 0.5,
      volumeProfile: 0.6,
      marketDepth: 0.7,
      correlation: 0.4
    };
  }

  private recordClassification(classification: RegimeClassification) {
    const timestamp = Date.now();
    const record = {
      timestamp,
      ...classification
    };
    
    fs.appendFileSync(
      this.REGIME_FILE,
      JSON.stringify(record) + '\n'
    );
  }

  public getRecentClassifications(limit: number = 100): RegimeClassification[] {
    const content = fs.readFileSync(this.REGIME_FILE, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .slice(-limit);
  }

  public clearHistory() {
    fs.writeFileSync(this.REGIME_FILE, '');
  }
} 