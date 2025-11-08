import { RegimeClassifier } from '../memory/RegimeClassifier';

export interface PerformanceMetrics {
  pnl: number;
  sharpe: number;
  drawdown: number;
  volatility: number;
  trust: number;
  regimeAlignment: number;
  consistency: number;
  timestamp: number;
}

export interface StrategyScore {
  strategyId: string;
  metrics: PerformanceMetrics;
  weightedScore: number;
  timestamp: number;
}

export class StrategyPerformance {
  private metrics: PerformanceMetrics[];
  private readonly MAX_HISTORY = 1000; // Keep last 1000 metrics

  constructor() {
    this.metrics = [];
  }

  public addMetrics(metrics: PerformanceMetrics) {
    this.metrics.push(metrics);
    if (this.metrics.length > this.MAX_HISTORY) {
      this.metrics.shift();
    }
  }

  public calculateScore(weights: ScoringWeights): StrategyScore {
    const latest = this.metrics[this.metrics.length - 1];
    const recent = this.metrics.slice(-30); // Last 30 metrics for consistency

    const consistency = this.calculateConsistency(recent);
    const regimeAlignment = this.calculateRegimeAlignment(recent);

    const weightedScore = 
      latest.pnl * weights.pnl +
      latest.sharpe * weights.sharpe +
      (1 - latest.drawdown) * weights.drawdown +
      (1 - latest.volatility) * weights.volatility +
      latest.trust * weights.trust +
      regimeAlignment * weights.regimeAlignment +
      consistency * weights.consistency;

    return {
      strategyId: latest.strategyId,
      metrics: latest,
      weightedScore,
      timestamp: Date.now()
    };
  }

  private calculateConsistency(metrics: PerformanceMetrics[]): number {
    if (metrics.length < 2) return 0;

    const pnlChanges = metrics.slice(1).map((m, i) => m.pnl - metrics[i].pnl);
    const meanChange = pnlChanges.reduce((a, b) => a + b, 0) / pnlChanges.length;
    const variance = pnlChanges.reduce((a, b) => a + Math.pow(b - meanChange, 2), 0) / pnlChanges.length;
    
    // Lower variance = higher consistency
    return 1 / (1 + Math.sqrt(variance));
  }

  private calculateRegimeAlignment(metrics: PerformanceMetrics[]): number {
    if (metrics.length === 0) return 0;

    const regimeClassifier = RegimeClassifier.getInstance();
    const regimeScores = metrics.map(m => {
      const regime = regimeClassifier.classify(m.timestamp);
      return regime === m.regime ? 1 : 0;
    });

    return regimeScores.reduce((a, b) => a + b, 0) / regimeScores.length;
  }

  public getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  public clearMetrics() {
    this.metrics = [];
  }
} 