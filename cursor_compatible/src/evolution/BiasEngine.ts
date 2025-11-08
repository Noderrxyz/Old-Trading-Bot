import { MutationScorer } from '../mutation/MutationScorer';
import { RegimeClassifier } from '../memory/RegimeClassifier';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as Plotly from 'plotly.js-dist';

interface BiasWeights {
  sharpe: number;
  stability: number;
  regimeAlignment: number;
  trust: number;
}

interface BiasDistribution {
  strategyId: string;
  bias: number;
  metrics: {
    sharpe: number;
    stability: number;
    regimeAlignment: number;
    trust: number;
  };
}

export class BiasEngine {
  private static instance: BiasEngine;
  private mutationScorer: MutationScorer;
  private regimeClassifier: RegimeClassifier;
  private biasWeights: BiasWeights;
  private biasHistory: BiasDistribution[];
  private readonly MAX_HISTORY = 1000;
  private readonly PLOT_FILE = 'evolution_bias_plot.png';

  private constructor() {
    this.mutationScorer = MutationScorer.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.biasHistory = [];
    this.biasWeights = {
      sharpe: 0.4,
      stability: 0.3,
      regimeAlignment: 0.2,
      trust: 0.1
    };
  }

  public static getInstance(): BiasEngine {
    if (!BiasEngine.instance) {
      BiasEngine.instance = new BiasEngine();
    }
    return BiasEngine.instance;
  }

  public calculateBias(strategyId: string): number {
    const score = this.mutationScorer.getStrategyScore(strategyId);
    if (!score) return 0;

    const metrics = score.metrics;
    const currentRegime = this.regimeClassifier.classify(Date.now());

    const bias = 
      metrics.sharpe * this.biasWeights.sharpe +
      (1 - metrics.volatility) * this.biasWeights.stability +
      (metrics.regimeAlignment === currentRegime ? 1 : 0) * this.biasWeights.regimeAlignment +
      metrics.trust * this.biasWeights.trust;

    this.recordBias(strategyId, bias, {
      sharpe: metrics.sharpe,
      stability: 1 - metrics.volatility,
      regimeAlignment: metrics.regimeAlignment === currentRegime ? 1 : 0,
      trust: metrics.trust
    });

    return bias;
  }

  private recordBias(strategyId: string, bias: number, metrics: BiasDistribution['metrics']) {
    this.biasHistory.push({
      strategyId,
      bias,
      metrics
    });

    if (this.biasHistory.length > this.MAX_HISTORY) {
      this.biasHistory.shift();
    }

    this.plotBiasDistribution();
  }

  private plotBiasDistribution() {
    const data = [
      {
        x: this.biasHistory.map(d => d.strategyId),
        y: this.biasHistory.map(d => d.bias),
        type: 'scatter',
        mode: 'markers',
        name: 'Bias Score'
      }
    ];

    const layout = {
      title: 'Mutation Bias Distribution',
      xaxis: { title: 'Strategy ID' },
      yaxis: { title: 'Bias Score' }
    };

    const config = {
      responsive: true,
      toImageButtonOptions: {
        format: 'png',
        filename: 'evolution_bias_plot',
        height: 500,
        width: 1000,
        scale: 2
      }
    };

    Plotly.newPlot('bias-plot', data, layout, config)
      .then(() => {
        return Plotly.toImage('bias-plot', config.toImageButtonOptions);
      })
      .then((dataUrl) => {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(process.cwd(), this.PLOT_FILE), base64Data, 'base64');
      })
      .catch(error => {
        logger.error('Failed to generate bias plot:', error);
      });
  }

  public getTopStrategiesByBias(limit: number = 10): BiasDistribution[] {
    return [...this.biasHistory]
      .sort((a, b) => b.bias - a.bias)
      .slice(0, limit);
  }

  public getRegimeSpecificStrategies(regime: string, limit: number = 5): BiasDistribution[] {
    return this.biasHistory
      .filter(d => d.metrics.regimeAlignment === 1)
      .sort((a, b) => b.bias - a.bias)
      .slice(0, limit);
  }

  public clearHistory() {
    this.biasHistory = [];
  }
} 