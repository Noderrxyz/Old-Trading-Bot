import { AlphaHistoryStore } from '../memory/AlphaHistoryStore';
import { AutoDegrader } from '../risk/AutoDegrader';
import { MutationScorer } from '../mutation/MutationScorer';
import { logger } from '../utils/logger';

interface StrategyWeight {
  strategyId: string;
  weight: number;
  lastUpdated: number;
}

export class FeedbackLoopEngine {
  private static instance: FeedbackLoopEngine;
  private alphaStore: AlphaHistoryStore;
  private autoDegrader: AutoDegrader;
  private mutationScorer: MutationScorer;
  private strategyWeights: Map<string, StrategyWeight>;
  private readonly CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private lastCheckTime: number;

  private constructor() {
    this.alphaStore = AlphaHistoryStore.getInstance();
    this.autoDegrader = AutoDegrader.getInstance();
    this.mutationScorer = MutationScorer.getInstance();
    this.strategyWeights = new Map();
    this.lastCheckTime = Date.now();
  }

  public static getInstance(): FeedbackLoopEngine {
    if (!FeedbackLoopEngine.instance) {
      FeedbackLoopEngine.instance = new FeedbackLoopEngine();
    }
    return FeedbackLoopEngine.instance;
  }

  public async runDailyCheck() {
    if (Date.now() - this.lastCheckTime < this.CHECK_INTERVAL) {
      return;
    }

    try {
      logger.info('Starting daily performance check...');
      
      // Get 24h performance for all agents
      const performanceData = this.alphaStore.getAllAgents24hPerformance();
      
      // Update strategy weights based on performance
      this.updateStrategyWeights(performanceData);
      
      // Prune unstable agents
      this.pruneUnstableAgents(performanceData);
      
      // Re-clone top performers
      await this.recloneTopPerformers(performanceData);
      
      this.lastCheckTime = Date.now();
      logger.info('Daily performance check completed successfully');
    } catch (error) {
      logger.error('Error during daily performance check:', error);
    }
  }

  private updateStrategyWeights(performanceData: Map<string, any[]>) {
    for (const [agentId, performance] of performanceData.entries()) {
      const score = this.mutationScorer.getStrategyScore(agentId);
      if (score) {
        const weight = this.calculateWeight(performance, score);
        this.strategyWeights.set(agentId, {
          strategyId: agentId,
          weight,
          lastUpdated: Date.now()
        });
      }
    }
  }

  private calculateWeight(performance: any[], score: any): number {
    // Calculate weighted average of performance metrics
    const weights = {
      pnl: 0.3,
      sharpe: 0.2,
      drawdown: 0.15,
      volatility: 0.1,
      trust: 0.15,
      regimeAlignment: 0.05,
      consistency: 0.05
    };

    let totalWeight = 0;
    for (const metric of performance) {
      totalWeight += 
        metric.pnl * weights.pnl +
        metric.sharpe * weights.sharpe +
        (1 - metric.drawdown) * weights.drawdown +
        (1 - metric.volatility) * weights.volatility +
        metric.trust * weights.trust +
        metric.regimeAlignment * weights.regimeAlignment +
        metric.consistency * weights.consistency;
    }

    return totalWeight / performance.length;
  }

  private pruneUnstableAgents(performanceData: Map<string, any[]>) {
    for (const [agentId, performance] of performanceData.entries()) {
      const isStable = this.autoDegrader.checkStability(performance);
      if (!isStable) {
        this.autoDegrader.degradeAgent(agentId);
        logger.info(`Pruned unstable agent: ${agentId}`);
      }
    }
  }

  private async recloneTopPerformers(performanceData: Map<string, any[]>) {
    const topPerformers = Array.from(performanceData.entries())
      .sort(([, a], [, b]) => {
        const scoreA = this.calculateWeight(a, this.mutationScorer.getStrategyScore(a[0].agentId));
        const scoreB = this.calculateWeight(b, this.mutationScorer.getStrategyScore(b[0].agentId));
        return scoreB - scoreA;
      })
      .slice(0, 3); // Top 3 performers

    for (const [agentId] of topPerformers) {
      try {
        await this.mutationScorer.cloneStrategy(agentId);
        logger.info(`Re-cloned top performer: ${agentId}`);
      } catch (error) {
        logger.error(`Failed to re-clone top performer ${agentId}:`, error);
      }
    }
  }

  public getStrategyWeight(strategyId: string): number {
    return this.strategyWeights.get(strategyId)?.weight || 0;
  }

  public clearWeights() {
    this.strategyWeights.clear();
  }
} 