/**
 * Model Expansion Package - Elite 0.001% AI/ML Trading Intelligence
 * 
 * Exports all components for next-generation LLM-guided alpha strategy selection,
 * reinforcement learning, causal AI, and self-evolving strategy agents
 */

// LLM Components
export { LLMAlphaGenerator } from './llm/LLMAlphaGenerator';
export { LLMFeatureSuggester } from './llm/LLMFeatureSuggester';

// Reinforcement Learning Components
export { RLLearningLoop } from './rl/RLLearningLoop';
export { PPOAgent } from './rl/PPOAgent';
export { 
  SharpeRewardFunction,
  RiskAdjustedRewardFunction,
  ProfitFactorRewardFunction,
  InformationRatioRewardFunction,
  SortinoRewardFunction,
  createRewardFunction
} from './rl/RewardFunctions';

// Causal AI Components
export { CausalFeatureSelector } from './causal/CausalFeatureSelector';

// Evolution Components
export { EvolutionEngine } from './evolution/EvolutionEngine';
export { StrategyGenome, GENE_TEMPLATES } from './evolution/StrategyGenome';

// Integration Components
export { NumeraiIntegration } from './integration/NumeraiIntegration';

// Validation Components
export { ModelValidator } from './validation/ModelValidator';

// Orchestration Components
export { ModelOrchestrator } from './orchestration/ModelOrchestrator';

// Types
export * from './types';

// Version
export const VERSION = '1.0.0';

/**
 * Quick start function to create a fully configured model expansion system
 */
export async function createModelExpansion(config: any) {
  const { createLogger } = await import('winston');
  
  const logger = createLogger({
    level: 'info',
    format: {
      timestamp: true,
      errors: true
    }
  });
  
  const orchestrator = new ModelOrchestrator(logger, {
    llmEnabled: config.llm?.enabled ?? true,
    rlEnabled: config.rl?.enabled ?? true,
    evolutionEnabled: config.evolution?.enabled ?? true,
    causalEnabled: config.causal?.enabled ?? true,
    externalSignalsEnabled: config.integration?.numerai?.enabled ?? false,
    validationRequired: true,
    ensembleWeights: {
      llm: 0.25,
      rl: 0.25,
      evolution: 0.25,
      external: 0.25
    },
    updateFrequency: 60000, // 1 minute
    maxConcurrentModels: 10
  });
  
  await orchestrator.initialize(config);
  
  return orchestrator;
}

/**
 * Elite performance metrics target
 */
export const ELITE_TARGETS = {
  sharpeRatio: 3.0,
  maxDrawdown: 0.10,
  winRate: 0.65,
  profitFactor: 2.5,
  calmarRatio: 3.0,
  informationRatio: 1.5,
  sortinoRatio: 4.0
};

/**
 * Model expansion capabilities
 */
export const CAPABILITIES = {
  llm: {
    providers: ['claude-3', 'gpt-4', 'gemini-pro'],
    features: [
      'Natural language strategy generation',
      'Feature discovery and suggestion',
      'Market regime analysis',
      'Risk constraint interpretation'
    ]
  },
  rl: {
    algorithms: ['PPO', 'DQN', 'A3C', 'SAC'],
    features: [
      'Online learning from market data',
      'Risk-aware exploration',
      'Multi-objective optimization',
      'Adaptive position sizing'
    ]
  },
  evolution: {
    features: [
      'Genetic programming for strategies',
      'Multi-objective fitness functions',
      'Automatic feature engineering',
      'Strategy complexity optimization'
    ]
  },
  causal: {
    methods: ['granger', 'pc', 'dowhy'],
    features: [
      'Spurious correlation filtering',
      'True causal relationship discovery',
      'Feature stability analysis',
      'Confounding variable detection'
    ]
  },
  integration: {
    providers: ['numerai'],
    features: [
      'External ML signal integration',
      'Tournament participation',
      'Ensemble model aggregation',
      'Cross-validation with external data'
    ]
  }
};

/**
 * Performance benchmarks for elite 0.001% trading
 */
export const PERFORMANCE_BENCHMARKS = {
  institutional: {
    sharpeRatio: 1.5,
    maxDrawdown: 0.20,
    winRate: 0.55
  },
  elite_01_percent: {
    sharpeRatio: 2.0,
    maxDrawdown: 0.15,
    winRate: 0.60
  },
  elite_001_percent: {
    sharpeRatio: 3.0,
    maxDrawdown: 0.10,
    winRate: 0.65
  }
};

// Default export
export default {
  createModelExpansion,
  VERSION,
  ELITE_TARGETS,
  CAPABILITIES,
  PERFORMANCE_BENCHMARKS
}; 