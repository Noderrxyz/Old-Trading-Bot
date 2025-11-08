import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { TrustManager } from '../trust/TrustManager.js';
import { StrategyGenome } from './StrategyGenome.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mutation configuration
 */
interface MutationConfig {
  minTrustScore: number;
  mutationRate: number;
  crossoverRate: number;
  maxOffspringPerGeneration: number;
  lineageLogPath: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MutationConfig = {
  minTrustScore: 0.4,
  mutationRate: 0.1,
  crossoverRate: 0.7,
  maxOffspringPerGeneration: 5,
  lineageLogPath: 'logs/lineage_log.jsonl'
};

/**
 * Lineage log entry
 */
interface LineageLogEntry {
  parentA: string;
  parentB?: string;
  mutationType: 'crossover' | 'mutation';
  timestamp: number;
  offspring: string;
  trustScores: {
    parentA: number;
    parentB?: number;
    offspring: number;
  };
  fitnessScores: {
    parentA: number;
    parentB?: number;
    offspring: number;
  };
}

/**
 * Mutation Engine
 */
export class MutationEngine {
  private static instance: MutationEngine;
  private config: MutationConfig;
  private telemetryBus: TelemetryBus;
  private trustManager: TrustManager;
  private lineageLogStream: fs.WriteStream;

  private constructor(config: Partial<MutationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.trustManager = TrustManager.getInstance();
    this.setupLineageLog();
  }

  public static getInstance(config?: Partial<MutationConfig>): MutationEngine {
    if (!MutationEngine.instance) {
      MutationEngine.instance = new MutationEngine(config);
    }
    return MutationEngine.instance;
  }

  /**
   * Setup lineage log
   */
  private setupLineageLog(): void {
    const logDir = path.dirname(this.config.lineageLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.lineageLogStream = fs.createWriteStream(this.config.lineageLogPath, { flags: 'a' });
  }

  /**
   * Apply mutation to strategy genome
   */
  public async mutate(agentId: string, genome: StrategyGenome): Promise<StrategyGenome | null> {
    // Check trust score
    const trustScore = this.trustManager.getScore(agentId);
    if (trustScore < this.config.minTrustScore) {
      logger.warn(`Mutation blocked for low-trust agent: ${agentId} (score: ${trustScore})`);
      return null;
    }

    // Calculate fitness score
    const fitnessScore = this.calculateFitnessScore(genome);

    // Apply mutation
    const mutatedGenome = genome.clone();
    const mutationType = Math.random() < this.config.crossoverRate ? 'crossover' : 'mutation';

    if (mutationType === 'crossover') {
      // Find suitable parent for crossover
      const parentB = await this.findCrossoverParent(genome);
      if (parentB) {
        this.applyCrossover(mutatedGenome, parentB);
      } else {
        // Fallback to mutation if no suitable parent found
        this.applyMutation(mutatedGenome);
      }
    } else {
      this.applyMutation(mutatedGenome);
    }

    // Log lineage
    this.logLineage({
      parentA: genome.id,
      parentB: mutationType === 'crossover' ? genome.id : undefined,
      mutationType,
      timestamp: Date.now(),
      offspring: mutatedGenome.id,
      trustScores: {
        parentA: trustScore,
        parentB: mutationType === 'crossover' ? this.trustManager.getScore(agentId) : undefined,
        offspring: trustScore // Initial trust score for offspring
      },
      fitnessScores: {
        parentA: fitnessScore,
        parentB: mutationType === 'crossover' ? this.calculateFitnessScore(genome) : undefined,
        offspring: this.calculateFitnessScore(mutatedGenome)
      }
    });

    return mutatedGenome;
  }

  /**
   * Calculate fitness score
   */
  private calculateFitnessScore(genome: StrategyGenome): number {
    // Combine PnL stability and Sharpe ratio
    const pnlStability = genome.metrics.pnlStability || 0;
    const sharpeRatio = genome.metrics.sharpeRatio || 0;
    return (pnlStability * 0.6) + (sharpeRatio * 0.4);
  }

  /**
   * Find suitable parent for crossover
   */
  private async findCrossoverParent(genome: StrategyGenome): Promise<StrategyGenome | null> {
    // TODO: Implement strategy pool and selection logic
    return null;
  }

  /**
   * Apply crossover
   */
  private applyCrossover(genome: StrategyGenome, parent: StrategyGenome): void {
    // TODO: Implement crossover logic
  }

  /**
   * Apply mutation
   */
  private applyMutation(genome: StrategyGenome): void {
    // TODO: Implement mutation logic
  }

  /**
   * Log lineage
   */
  private logLineage(entry: LineageLogEntry): void {
    this.lineageLogStream.write(JSON.stringify(entry) + '\n');
    this.telemetryBus.emit('mutation_lineage', entry);
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.lineageLogStream.end();
  }
} 