import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import { logger } from '../utils/logger.js';
import { StrategyGenome, StrategyInstance, StrategyLoaderConfig } from '../types/strategy.types.js';
import strategySchema from '../schemas/StrategyGenome.schema.json' assert { type: 'json' };

export class StrategyLoader {
  private static instance: StrategyLoader;
  private config: StrategyLoaderConfig;
  private validator: Ajv;
  private strategies: Map<string, StrategyInstance>;

  private constructor(config: StrategyLoaderConfig) {
    this.config = config;
    this.validator = new Ajv();
    this.strategies = new Map();
    this.validator.addSchema(strategySchema, 'StrategyGenome');
  }

  public static getInstance(config?: StrategyLoaderConfig): StrategyLoader {
    if (!StrategyLoader.instance) {
      StrategyLoader.instance = new StrategyLoader(config || {
        strategyDir: 'strategies',
        validateSchema: true
      });
    }
    return StrategyLoader.instance;
  }

  public async loadStrategy(strategyId: string): Promise<StrategyInstance> {
    try {
      const strategyPath = path.join(this.config.strategyDir, `${strategyId}.json`);
      const strategyData = JSON.parse(fs.readFileSync(strategyPath, 'utf-8'));

      if (this.config.validateSchema) {
        const valid = this.validator.validate('StrategyGenome', strategyData);
        if (!valid) {
          throw new Error(`Invalid strategy genome: ${this.validator.errorsText()}`);
        }
      }

      const genome = strategyData as StrategyGenome;
      const strategy = await this.createStrategyInstance(genome);
      this.strategies.set(strategyId, strategy);
      return strategy;
    } catch (error) {
      logger.error(`Failed to load strategy ${strategyId}:`, error);
      throw error;
    }
  }

  public getStrategy(strategyId: string): StrategyInstance | undefined {
    return this.strategies.get(strategyId);
  }

  public getAllStrategies(): StrategyInstance[] {
    return Array.from(this.strategies.values());
  }

  private async createStrategyInstance(genome: StrategyGenome): Promise<StrategyInstance> {
    // Import the strategy module dynamically
    const strategyModule = await import(`../strategies/${genome.strategyId}.js`);
    const strategyClass = strategyModule.default;

    return {
      genome,
      execute: async (marketData: any) => {
        const instance = new strategyClass(genome.params);
        return instance.execute(marketData);
      }
    };
  }

  public async loadAllStrategies(): Promise<void> {
    try {
      const files = fs.readdirSync(this.config.strategyDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const strategyId = path.basename(file, '.json');
          await this.loadStrategy(strategyId);
        }
      }
    } catch (error) {
      logger.error('Failed to load strategies:', error);
      throw error;
    }
  }
} 