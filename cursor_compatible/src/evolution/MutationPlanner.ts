import { BiasEngine } from './BiasEngine';
import { RegimeClassifier } from '../memory/RegimeClassifier';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface MutationPlan {
  parentId: string;
  bias: number;
  regime: string;
  timestamp: number;
}

interface MutationConfig {
  minBias: number;
  maxMutations: number;
  regimeMatchThreshold: number;
}

export class MutationPlanner {
  private static instance: MutationPlanner;
  private biasEngine: BiasEngine;
  private regimeClassifier: RegimeClassifier;
  private mutationPlans: MutationPlan[];
  private config: MutationConfig;
  private readonly PLANS_FILE = 'data/mutation_plans.jsonl';

  private constructor() {
    this.biasEngine = BiasEngine.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.mutationPlans = [];
    this.config = {
      minBias: 0.6,
      maxMutations: 5,
      regimeMatchThreshold: 0.8
    };
    this.ensurePlansFile();
  }

  public static getInstance(): MutationPlanner {
    if (!MutationPlanner.instance) {
      MutationPlanner.instance = new MutationPlanner();
    }
    return MutationPlanner.instance;
  }

  private ensurePlansFile() {
    const dir = path.dirname(this.PLANS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.PLANS_FILE)) {
      fs.writeFileSync(this.PLANS_FILE, '');
    }
  }

  public planMutations(): MutationPlan[] {
    const currentRegime = this.regimeClassifier.classify(Date.now());
    const topStrategies = this.biasEngine.getTopStrategiesByBias(this.config.maxMutations);

    const plans: MutationPlan[] = topStrategies
      .filter(strategy => {
        const bias = this.biasEngine.calculateBias(strategy.strategyId);
        return bias >= this.config.minBias && 
               strategy.metrics.regimeAlignment >= this.config.regimeMatchThreshold;
      })
      .map(strategy => ({
        parentId: strategy.strategyId,
        bias: this.biasEngine.calculateBias(strategy.strategyId),
        regime: currentRegime,
        timestamp: Date.now()
      }));

    this.savePlans(plans);
    return plans;
  }

  private savePlans(plans: MutationPlan[]) {
    try {
      plans.forEach(plan => {
        fs.appendFileSync(this.PLANS_FILE, JSON.stringify(plan) + '\n');
      });
    } catch (error) {
      logger.error('Failed to save mutation plans:', error);
    }
  }

  public getRecentPlans(limit: number = 10): MutationPlan[] {
    try {
      const content = fs.readFileSync(this.PLANS_FILE, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as MutationPlan)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    } catch (error) {
      logger.error('Failed to read mutation plans:', error);
      return [];
    }
  }

  public getRegimeSpecificPlans(regime: string, limit: number = 5): MutationPlan[] {
    return this.getRecentPlans()
      .filter(plan => plan.regime === regime)
      .slice(0, limit);
  }

  public clearPlans() {
    try {
      fs.writeFileSync(this.PLANS_FILE, '');
      this.mutationPlans = [];
    } catch (error) {
      logger.error('Failed to clear mutation plans:', error);
    }
  }

  public updateConfig(config: Partial<MutationConfig>) {
    this.config = { ...this.config, ...config };
  }
} 