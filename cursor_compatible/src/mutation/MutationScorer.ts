import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { StrategyPerformance, PerformanceMetrics, StrategyScore } from '../models/StrategyPerformance';
import { TelemetryBus } from '../telemetry/TelemetryBus';

interface ScoringWeights {
  pnl: number;
  sharpe: number;
  drawdown: number;
  volatility: number;
  trust: number;
  regimeAlignment: number;
  consistency: number;
}

interface ScoringConfig {
  weights: ScoringWeights;
  thresholds: {
    minTrust: number;
    maxDrawdown: number;
    maxVolatility: number;
    minRegimeAlignment: number;
    minConsistency: number;
  };
  penalties: {
    volatilitySpike: number;
    trustDrop: number;
    regimeMismatch: number;
    inconsistency: number;
  };
}

export class MutationScorer {
  private static instance: MutationScorer;
  private config: ScoringConfig;
  private strategyPerformances: Map<string, StrategyPerformance>;
  private scoresFile: string;
  private telemetryBus: TelemetryBus;

  private constructor() {
    this.config = this.loadConfig();
    this.strategyPerformances = new Map();
    this.scoresFile = path.join(process.cwd(), 'data', 'strategy_scores.jsonl');
    this.telemetryBus = TelemetryBus.getInstance();
    this.setupTelemetry();
    this.ensureScoresFile();
  }

  public static getInstance(): MutationScorer {
    if (!MutationScorer.instance) {
      MutationScorer.instance = new MutationScorer();
    }
    return MutationScorer.instance;
  }

  private loadConfig(): ScoringConfig {
    try {
      const configPath = path.join(process.cwd(), 'config', 'scoring_weights.yaml');
      const content = fs.readFileSync(configPath, 'utf-8');
      return yaml.load(content) as ScoringConfig;
    } catch (error) {
      logger.error('Failed to load scoring config:', error);
      throw error;
    }
  }

  private ensureScoresFile() {
    const dir = path.dirname(this.scoresFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.scoresFile)) {
      fs.writeFileSync(this.scoresFile, '');
    }
  }

  private setupTelemetry() {
    this.telemetryBus.on('strategy_metrics', (data: any) => {
      const { strategyId, metrics } = data;
      this.updateStrategyMetrics(strategyId, metrics);
    });
  }

  public updateStrategyMetrics(strategyId: string, metrics: PerformanceMetrics) {
    if (!this.strategyPerformances.has(strategyId)) {
      this.strategyPerformances.set(strategyId, new StrategyPerformance());
    }

    const performance = this.strategyPerformances.get(strategyId)!;
    performance.addMetrics(metrics);

    // Calculate and save score
    const score = performance.calculateScore(this.config.weights);
    this.saveScore(score);
  }

  private saveScore(score: StrategyScore) {
    try {
      fs.appendFileSync(this.scoresFile, JSON.stringify(score) + '\n');
      this.telemetryBus.emit('strategy_score', score);
    } catch (error) {
      logger.error('Failed to save strategy score:', error);
    }
  }

  public getStrategyScore(strategyId: string): StrategyScore | null {
    const performance = this.strategyPerformances.get(strategyId);
    if (!performance) return null;

    return performance.calculateScore(this.config.weights);
  }

  public getTopStrategies(limit: number = 10): StrategyScore[] {
    try {
      const content = fs.readFileSync(this.scoresFile, 'utf-8');
      const scores = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as StrategyScore)
        .sort((a, b) => b.weightedScore - a.weightedScore);

      return scores.slice(0, limit);
    } catch (error) {
      logger.error('Failed to get top strategies:', error);
      return [];
    }
  }

  public clearScores() {
    try {
      fs.writeFileSync(this.scoresFile, '');
      this.strategyPerformances.clear();
    } catch (error) {
      logger.error('Failed to clear scores:', error);
    }
  }
} 