import { logger } from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Monte Carlo simulation configuration
 */
export interface MonteCarloConfig {
  basePrice: number;
  steps: number;
  stdDev: number;
  noiseType: 'gaussian' | 't-distribution';
  runs: number;
  degreesOfFreedom?: number; // For t-distribution
  outputDir: string;
}

/**
 * Default Monte Carlo configuration
 */
export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  basePrice: 1000,
  steps: 500,
  stdDev: 0.015,
  noiseType: 'gaussian',
  runs: 1000,
  outputDir: 'data/simulations/montecarlo'
};

/**
 * Price path
 */
export interface PricePath {
  prices: number[];
  timestamps: number[];
}

/**
 * Simulation metrics
 */
export interface SimulationMetrics {
  finalPnL: number;
  maxDrawdown: number;
  sharpeRatio: number;
  timeToRecovery: number;
  volatility: number;
  winRate: number;
}

/**
 * Simulation result
 */
export interface SimulationResult {
  strategyId: string;
  pathId: number;
  metrics: SimulationMetrics;
  pricePath: PricePath;
  timestamp: number;
}

/**
 * Monte Carlo Simulator
 */
export class MonteCarloSimulator {
  private static instance: MonteCarloSimulator | null = null;
  private config: MonteCarloConfig;
  private telemetryBus: TelemetryBus;

  private constructor(config: Partial<MonteCarloConfig> = {}) {
    this.config = { ...DEFAULT_MONTE_CARLO_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.ensureOutputDir();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<MonteCarloConfig>): MonteCarloSimulator {
    if (!MonteCarloSimulator.instance) {
      MonteCarloSimulator.instance = new MonteCarloSimulator(config);
    }
    return MonteCarloSimulator.instance;
  }

  /**
   * Generate synthetic price paths
   */
  public generatePaths(): PricePath[] {
    const paths: PricePath[] = [];
    const startTime = Date.now();

    for (let i = 0; i < this.config.runs; i++) {
      const path = this.generateSinglePath();
      paths.push(path);

      // Emit progress
      if (i % 100 === 0) {
        const progress = (i / this.config.runs) * 100;
        this.telemetryBus.emit('monte_carlo_progress', {
          progress,
          completedPaths: i,
          totalPaths: this.config.runs
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Generated ${this.config.runs} price paths in ${duration}ms`);

    return paths;
  }

  /**
   * Generate a single price path
   */
  private generateSinglePath(): PricePath {
    const prices: number[] = [this.config.basePrice];
    const timestamps: number[] = [Date.now()];
    let currentPrice = this.config.basePrice;

    for (let i = 1; i < this.config.steps; i++) {
      const noise = this.generateNoise();
      const priceChange = currentPrice * noise;
      currentPrice += priceChange;
      
      prices.push(currentPrice);
      timestamps.push(timestamps[i - 1] + 1000); // 1 second intervals
    }

    return { prices, timestamps };
  }

  /**
   * Generate noise based on configured type
   */
  private generateNoise(): number {
    if (this.config.noiseType === 'gaussian') {
      return this.generateGaussianNoise();
    } else {
      return this.generateTDistributionNoise();
    }
  }

  /**
   * Generate Gaussian noise
   */
  private generateGaussianNoise(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * this.config.stdDev;
  }

  /**
   * Generate t-distribution noise
   */
  private generateTDistributionNoise(): number {
    const df = this.config.degreesOfFreedom || 3;
    const u = Math.random();
    const v = Math.random();
    
    const t = Math.sqrt(df / (2 * v)) * Math.cos(2 * Math.PI * u);
    return t * this.config.stdDev;
  }

  /**
   * Simulate strategy on a price path
   */
  public simulateStrategyOnPath(
    strategyId: string,
    pathId: number,
    pricePath: PricePath
  ): SimulationResult {
    // TODO: Implement actual strategy simulation
    // This is a placeholder that returns sample metrics
    const metrics: SimulationMetrics = {
      finalPnL: Math.random() * 1000 - 500,
      maxDrawdown: Math.random() * 0.2,
      sharpeRatio: Math.random() * 2,
      timeToRecovery: Math.random() * 1000,
      volatility: Math.random() * 0.1,
      winRate: Math.random()
    };

    const result: SimulationResult = {
      strategyId,
      pathId,
      metrics,
      pricePath,
      timestamp: Date.now()
    };

    this.saveResult(result);
    this.telemetryBus.emit('simulation_result', result);

    return result;
  }

  /**
   * Save simulation result
   */
  private saveResult(result: SimulationResult): void {
    const filename = path.join(
      this.config.outputDir,
      `${result.strategyId}_${result.pathId}.json`
    );

    try {
      fs.writeFileSync(filename, JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error(`Error saving simulation result: ${error}`);
    }
  }

  /**
   * Ensure output directory exists
   */
  private ensureOutputDir(): void {
    try {
      if (!fs.existsSync(this.config.outputDir)) {
        fs.mkdirSync(this.config.outputDir, { recursive: true });
      }
    } catch (error) {
      logger.error(`Error creating output directory: ${error}`);
    }
  }

  /**
   * Run full Monte Carlo simulation
   */
  public async runSimulation(strategyId: string): Promise<SimulationResult[]> {
    const paths = this.generatePaths();
    const results: SimulationResult[] = [];

    for (let i = 0; i < paths.length; i++) {
      const result = this.simulateStrategyOnPath(strategyId, i, paths[i]);
      results.push(result);
    }

    return results;
  }
} 