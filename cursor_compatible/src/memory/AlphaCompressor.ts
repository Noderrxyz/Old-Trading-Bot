import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as Plotly from 'plotly.js-dist';
import * as PCA from 'ml-pca';
import * as TSNE from 'tsne-js';

interface StrategyMetrics {
  strategyId: string;
  regime: string;
  duration: number;
  pnl: number;
  sharpe: number;
  drawdown: number;
  volatility: number;
  trust: number;
  regimeAlignment: number;
  consistency: number;
}

interface MemoryStats {
  totalStrategies: number;
  uniqueRegimes: number;
  averageDuration: number;
  compressionRatio: number;
  lastCompression: number;
}

export class AlphaCompressor {
  private static instance: AlphaCompressor;
  private readonly MEMORY_FILE = 'data/alpha_memory.jsonl';
  private readonly CLUSTER_PLOT = 'alpha_clusters.png';
  private readonly STATS_FILE = 'memory_usage_stats.json';
  private readonly COMPRESSION_THRESHOLD = 0.8; // Similarity threshold for compression

  private constructor() {
    this.ensureMemoryFile();
  }

  public static getInstance(): AlphaCompressor {
    if (!AlphaCompressor.instance) {
      AlphaCompressor.instance = new AlphaCompressor();
    }
    return AlphaCompressor.instance;
  }

  private ensureMemoryFile() {
    const dir = path.dirname(this.MEMORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.MEMORY_FILE)) {
      fs.writeFileSync(this.MEMORY_FILE, '');
    }
  }

  public async compressMemory() {
    try {
      logger.info('Starting memory compression...');
      
      // Read all strategies
      const strategies = this.readStrategies();
      
      // Group by regime
      const regimeGroups = this.groupByRegime(strategies);
      
      // Compress each regime group
      const compressedStrategies: StrategyMetrics[] = [];
      for (const [regime, group] of regimeGroups.entries()) {
        const compressed = await this.compressRegimeGroup(group);
        compressedStrategies.push(...compressed);
      }
      
      // Save compressed strategies
      this.saveStrategies(compressedStrategies);
      
      // Generate clusters visualization
      await this.generateClusters(compressedStrategies);
      
      // Update memory stats
      this.updateMemoryStats(strategies.length, compressedStrategies.length);
      
      logger.info('Memory compression completed successfully');
    } catch (error) {
      logger.error('Error during memory compression:', error);
    }
  }

  private readStrategies(): StrategyMetrics[] {
    const content = fs.readFileSync(this.MEMORY_FILE, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as StrategyMetrics);
  }

  private groupByRegime(strategies: StrategyMetrics[]): Map<string, StrategyMetrics[]> {
    const groups = new Map<string, StrategyMetrics[]>();
    for (const strategy of strategies) {
      const group = groups.get(strategy.regime) || [];
      group.push(strategy);
      groups.set(strategy.regime, group);
    }
    return groups;
  }

  private async compressRegimeGroup(strategies: StrategyMetrics[]): Promise<StrategyMetrics[]> {
    if (strategies.length <= 1) return strategies;

    // Convert strategies to feature vectors
    const features = strategies.map(s => [
      s.pnl,
      s.sharpe,
      s.drawdown,
      s.volatility,
      s.trust,
      s.regimeAlignment,
      s.consistency
    ]);

    // Apply PCA for dimensionality reduction
    const pca = new PCA(features);
    const reducedFeatures = pca.predict(features, { nComponents: 3 });

    // Apply t-SNE for clustering
    const tsne = new TSNE({
      dim: 2,
      perplexity: 30,
      earlyExaggeration: 4.0,
      learningRate: 100.0,
      nIter: 1000,
      metric: 'euclidean'
    });

    const tsneFeatures = tsne.init({
      data: reducedFeatures,
      type: 'dense'
    });

    // Group similar strategies
    const groups = this.groupSimilarStrategies(strategies, tsneFeatures);
    
    // Select best strategy from each group
    return this.selectBestStrategies(groups);
  }

  private groupSimilarStrategies(
    strategies: StrategyMetrics[],
    features: number[][]
  ): StrategyMetrics[][] {
    const groups: StrategyMetrics[][] = [];
    const visited = new Set<number>();

    for (let i = 0; i < strategies.length; i++) {
      if (visited.has(i)) continue;

      const group = [strategies[i]];
      visited.add(i);

      for (let j = i + 1; j < strategies.length; j++) {
        if (visited.has(j)) continue;

        const distance = this.calculateDistance(features[i], features[j]);
        if (distance < this.COMPRESSION_THRESHOLD) {
          group.push(strategies[j]);
          visited.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  private calculateDistance(a: number[], b: number[]): number {
    return Math.sqrt(
      a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0)
    );
  }

  private selectBestStrategies(groups: StrategyMetrics[][]): StrategyMetrics[] {
    return groups.map(group => {
      return group.reduce((best, current) => {
        const bestScore = this.calculateStrategyScore(best);
        const currentScore = this.calculateStrategyScore(current);
        return currentScore > bestScore ? current : best;
      });
    });
  }

  private calculateStrategyScore(strategy: StrategyMetrics): number {
    const weights = {
      pnl: 0.3,
      sharpe: 0.2,
      drawdown: 0.15,
      volatility: 0.1,
      trust: 0.15,
      regimeAlignment: 0.05,
      consistency: 0.05
    };

    return (
      strategy.pnl * weights.pnl +
      strategy.sharpe * weights.sharpe +
      (1 - strategy.drawdown) * weights.drawdown +
      (1 - strategy.volatility) * weights.volatility +
      strategy.trust * weights.trust +
      strategy.regimeAlignment * weights.regimeAlignment +
      strategy.consistency * weights.consistency
    );
  }

  private saveStrategies(strategies: StrategyMetrics[]) {
    const content = strategies
      .map(strategy => JSON.stringify(strategy))
      .join('\n');
    fs.writeFileSync(this.MEMORY_FILE, content);
  }

  private async generateClusters(strategies: StrategyMetrics[]) {
    const features = strategies.map(s => [
      s.pnl,
      s.sharpe,
      s.drawdown,
      s.volatility,
      s.trust,
      s.regimeAlignment,
      s.consistency
    ]);

    const pca = new PCA(features);
    const reducedFeatures = pca.predict(features, { nComponents: 2 });

    const data = [{
      x: reducedFeatures.map(f => f[0]),
      y: reducedFeatures.map(f => f[1]),
      mode: 'markers',
      type: 'scatter',
      text: strategies.map(s => s.strategyId),
      marker: {
        size: 12,
        color: strategies.map(s => this.getRegimeColor(s.regime))
      }
    }];

    const layout = {
      title: 'Strategy Clusters by Regime',
      xaxis: { title: 'PCA Component 1' },
      yaxis: { title: 'PCA Component 2' }
    };

    const config = {
      responsive: true,
      toImageButtonOptions: {
        format: 'png',
        filename: 'alpha_clusters',
        height: 500,
        width: 1000,
        scale: 2
      }
    };

    Plotly.newPlot('cluster-plot', data, layout, config)
      .then(() => {
        return Plotly.toImage('cluster-plot', config.toImageButtonOptions);
      })
      .then((dataUrl) => {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(this.CLUSTER_PLOT, base64Data, 'base64');
      })
      .catch(error => {
        logger.error('Failed to generate cluster plot:', error);
      });
  }

  private getRegimeColor(regime: string): string {
    const colors = {
      'bull': '#2ecc71',
      'bear': '#e74c3c',
      'range': '#f1c40f',
      'volatile': '#9b59b6',
      'stable': '#3498db'
    };
    return colors[regime] || '#95a5a6';
  }

  private updateMemoryStats(originalCount: number, compressedCount: number) {
    const stats: MemoryStats = {
      totalStrategies: compressedCount,
      uniqueRegimes: new Set(this.readStrategies().map(s => s.regime)).size,
      averageDuration: this.calculateAverageDuration(),
      compressionRatio: originalCount / compressedCount,
      lastCompression: Date.now()
    };

    fs.writeFileSync(
      this.STATS_FILE,
      JSON.stringify(stats, null, 2)
    );
  }

  private calculateAverageDuration(): number {
    const strategies = this.readStrategies();
    if (strategies.length === 0) return 0;
    
    const totalDuration = strategies.reduce(
      (sum, s) => sum + s.duration,
      0
    );
    
    return totalDuration / strategies.length;
  }
} 