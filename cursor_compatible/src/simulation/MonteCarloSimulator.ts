import { RandomWalk } from './models/random_walk.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

interface SimulationResult {
  simulationId: number;
  sharpeRatio: number;
  maxDrawdown: number;
  duration: string;
  strategy: string;
  pnlDistribution: number[];
  survivalRate: number;
}

interface MonteCarloConfig {
  numSimulations: number;
  pathLength: number;
  strategies: string[];
  outputDir: string;
  noiseLevel: number;
  entropyModulation: number;
  timeWindow: number;
}

const DEFAULT_CONFIG: MonteCarloConfig = {
  numSimulations: 1000,
  pathLength: 1000,
  strategies: ['TWAP-StableLP', 'Arbitrage', 'MarketMaking'],
  outputDir: path.join(process.cwd(), 'simulation_results'),
  noiseLevel: 0.1,
  entropyModulation: 0.5,
  timeWindow: 30 // days
};

export class MonteCarloSimulator {
  private static instance: MonteCarloSimulator;
  private config: MonteCarloConfig;
  private randomWalk: RandomWalk;
  private results: SimulationResult[];

  private constructor(config: Partial<MonteCarloConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.randomWalk = new RandomWalk();
    this.results = [];
    this.setupOutputDirectory();
  }

  public static getInstance(config?: Partial<MonteCarloConfig>): MonteCarloSimulator {
    if (!MonteCarloSimulator.instance) {
      MonteCarloSimulator.instance = new MonteCarloSimulator(config);
    }
    return MonteCarloSimulator.instance;
  }

  private setupOutputDirectory(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  public async runSimulations(): Promise<void> {
    logger.info('Starting Monte Carlo simulations...');
    
    for (let i = 0; i < this.config.numSimulations; i++) {
      for (const strategy of this.config.strategies) {
        const result = await this.runSimulation(i, strategy);
        this.results.push(result);
        this.saveResult(result);
      }
    }

    this.generateSummaryReport();
    logger.info('Monte Carlo simulations completed');
  }

  private async runSimulation(simulationId: number, strategy: string): Promise<SimulationResult> {
    // Generate price path with injected noise and entropy
    const pricePath = this.generatePricePath();
    
    // Simulate strategy performance
    const { pnl, maxDrawdown } = this.simulateStrategy(pricePath, strategy);
    
    // Calculate metrics
    const sharpeRatio = this.calculateSharpeRatio(pnl);
    const survivalRate = this.calculateSurvivalRate(pnl);
    
    return {
      simulationId,
      sharpeRatio,
      maxDrawdown,
      duration: `${this.config.timeWindow}d`,
      strategy,
      pnlDistribution: pnl,
      survivalRate
    };
  }

  private generatePricePath(): number[] {
    // Inject noise and modulate entropy
    this.randomWalk.injectVolatilitySpike(
      this.config.noiseLevel,
      this.config.pathLength * this.config.entropyModulation
    );
    
    return this.randomWalk.generatePath(this.config.pathLength);
  }

  private simulateStrategy(pricePath: number[], strategy: string): { pnl: number[], maxDrawdown: number } {
    const pnl: number[] = [0];
    let maxDrawdown = 0;
    let peak = 0;
    let currentPnl = 0;

    for (let i = 1; i < pricePath.length; i++) {
      // Simulate strategy-specific PnL
      const priceChange = (pricePath[i] - pricePath[i - 1]) / pricePath[i - 1];
      const strategyReturn = this.calculateStrategyReturn(priceChange, strategy);
      
      currentPnl += strategyReturn;
      pnl.push(currentPnl);
      
      // Update max drawdown
      if (currentPnl > peak) {
        peak = currentPnl;
      }
      const drawdown = (currentPnl - peak) / peak;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }

    return { pnl, maxDrawdown };
  }

  private calculateStrategyReturn(priceChange: number, strategy: string): number {
    // Strategy-specific return calculations
    switch (strategy) {
      case 'TWAP-StableLP':
        return priceChange * 0.8; // Conservative returns
      case 'Arbitrage':
        return Math.abs(priceChange) * 1.2; // Higher returns for larger moves
      case 'MarketMaking':
        return Math.abs(priceChange) * 0.5; // Lower returns but more consistent
      default:
        return 0;
    }
  }

  private calculateSharpeRatio(pnl: number[]): number {
    const returns = pnl.slice(1).map((p, i) => p - pnl[i]);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length
    );
    return meanReturn / stdDev;
  }

  private calculateSurvivalRate(pnl: number[]): number {
    const minPnl = Math.min(...pnl);
    return minPnl > -0.5 ? 1 : 0; // Strategy survives if drawdown < 50%
  }

  private saveResult(result: SimulationResult): void {
    const filePath = path.join(
      this.config.outputDir,
      `simulation_${result.simulationId}_${result.strategy}.json`
    );
    
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  }

  private generateSummaryReport(): void {
    const summary = {
      timestamp: new Date().toISOString(),
      totalSimulations: this.results.length,
      averageSharpe: this.calculateAverageMetric('sharpeRatio'),
      averageDrawdown: this.calculateAverageMetric('maxDrawdown'),
      survivalRates: this.calculateStrategySurvivalRates()
    };

    const summaryPath = path.join(this.config.outputDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  }

  private calculateAverageMetric(metric: keyof SimulationResult): number {
    const values = this.results.map(r => r[metric] as number);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculateStrategySurvivalRates(): Record<string, number> {
    const rates: Record<string, number> = {};
    
    for (const strategy of this.config.strategies) {
      const strategyResults = this.results.filter(r => r.strategy === strategy);
      const survivalCount = strategyResults.filter(r => r.survivalRate === 1).length;
      rates[strategy] = survivalCount / strategyResults.length;
    }
    
    return rates;
  }

  public cleanup(): void {
    this.results = [];
  }
} 