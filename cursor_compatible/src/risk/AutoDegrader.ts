import { logger } from '../utils/logger';

interface PerformanceMetrics {
  pnl: number;
  sharpe: number;
  drawdown: number;
  volatility: number;
  trust: number;
  regimeAlignment: number;
  consistency: number;
}

export class AutoDegrader {
  private static instance: AutoDegrader;
  private degradedAgents: Set<string>;
  private readonly STABILITY_THRESHOLDS = {
    minSharpe: 0.5,
    maxDrawdown: 0.2,
    maxVolatility: 0.3,
    minTrust: 0.3,
    minRegimeAlignment: 0.6,
    minConsistency: 0.5
  };

  private constructor() {
    this.degradedAgents = new Set();
  }

  public static getInstance(): AutoDegrader {
    if (!AutoDegrader.instance) {
      AutoDegrader.instance = new AutoDegrader();
    }
    return AutoDegrader.instance;
  }

  public checkStability(performance: PerformanceMetrics[]): boolean {
    if (performance.length === 0) return false;

    const averages = this.calculateAverages(performance);
    
    return (
      averages.sharpe >= this.STABILITY_THRESHOLDS.minSharpe &&
      averages.drawdown <= this.STABILITY_THRESHOLDS.maxDrawdown &&
      averages.volatility <= this.STABILITY_THRESHOLDS.maxVolatility &&
      averages.trust >= this.STABILITY_THRESHOLDS.minTrust &&
      averages.regimeAlignment >= this.STABILITY_THRESHOLDS.minRegimeAlignment &&
      averages.consistency >= this.STABILITY_THRESHOLDS.minConsistency
    );
  }

  private calculateAverages(performance: PerformanceMetrics[]): PerformanceMetrics {
    const sum = performance.reduce((acc, curr) => ({
      pnl: acc.pnl + curr.pnl,
      sharpe: acc.sharpe + curr.sharpe,
      drawdown: acc.drawdown + curr.drawdown,
      volatility: acc.volatility + curr.volatility,
      trust: acc.trust + curr.trust,
      regimeAlignment: acc.regimeAlignment + curr.regimeAlignment,
      consistency: acc.consistency + curr.consistency
    }), {
      pnl: 0,
      sharpe: 0,
      drawdown: 0,
      volatility: 0,
      trust: 0,
      regimeAlignment: 0,
      consistency: 0
    });

    const count = performance.length;
    return {
      pnl: sum.pnl / count,
      sharpe: sum.sharpe / count,
      drawdown: sum.drawdown / count,
      volatility: sum.volatility / count,
      trust: sum.trust / count,
      regimeAlignment: sum.regimeAlignment / count,
      consistency: sum.consistency / count
    };
  }

  public degradeAgent(agentId: string) {
    this.degradedAgents.add(agentId);
    logger.info(`Agent ${agentId} has been degraded`);
  }

  public isDegraded(agentId: string): boolean {
    return this.degradedAgents.has(agentId);
  }

  public clearDegradedAgents() {
    this.degradedAgents.clear();
  }
} 