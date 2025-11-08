# Model Expansion Package - Elite 0.001% AI/ML Trading Intelligence

## Overview

The Model Expansion package implements cutting-edge AI/ML capabilities to push the Noderr Protocol into elite 0.001% performance territory. This package integrates:

- **LLM-Guided Alpha Generation**: Natural language to trading strategy conversion using Claude-3 and GPT-4
- **Reinforcement Learning**: Online learning with PPO/DQN agents for continuous strategy improvement
- **Causal AI**: Advanced causal inference to filter spurious correlations
- **Genetic Programming**: Self-evolving strategy agents through evolutionary algorithms
- **External ML Signals**: Integration with Numerai.ai for ensemble predictions

## Features

### 🧠 LLM Integration
- Generate trading strategies from natural language prompts
- Automatic feature discovery and suggestion
- Market regime analysis and interpretation
- Safety constraints and risk management

### 🤖 Reinforcement Learning
- PPO (Proximal Policy Optimization) implementation
- Risk-aware exploration and position sizing
- Online learning from live market data
- Multi-objective reward functions (Sharpe, Sortino, Calmar)

### 🧬 Evolution Engine
- Genetic programming for strategy discovery
- Multi-gene strategy representation
- Crossover, mutation, and selection operators
- Automatic complexity optimization

### 🔬 Causal Analysis
- Granger causality testing
- PC algorithm for causal discovery
- Spurious correlation filtering
- Feature stability validation

### 🌐 External Integration
- Numerai.ai tournament participation
- External ML signal aggregation
- Cross-validation with external predictions

## Installation

```bash
npm install @noderr/model-expansion
```

## Quick Start

```typescript
import { createModelExpansion } from '@noderr/model-expansion';

// Create orchestrator with all components
const orchestrator = await createModelExpansion({
  llm: {
    enabled: true,
    providers: [{
      name: 'claude-3',
      apiKey: process.env.ANTHROPIC_API_KEY
    }],
    maxTokens: 4000,
    temperature: 0.7,
    safetyConstraints: {
      maxLeverage: 3,
      maxPositionSize: 0.2,
      forbiddenAssets: []
    }
  },
  rl: {
    enabled: true,
    algorithm: 'PPO',
    learningRate: 0.0003,
    discountFactor: 0.99,
    explorationRate: 0.1,
    batchSize: 32
  },
  evolution: {
    enabled: true,
    populationSize: 100,
    mutationRate: 0.1,
    crossoverRate: 0.7,
    eliteRatio: 0.1,
    maxGenerations: 1000
  },
  causal: {
    enabled: true,
    method: 'granger',
    confidenceLevel: 0.95,
    lagOrder: 5
  },
  integration: {
    numerai: {
      enabled: true,
      apiKey: process.env.NUMERAI_API_KEY,
      modelId: 'your-model-id'
    }
  },
  validation: {
    minSharpe: 2.0,
    maxDrawdown: 0.15,
    minWinRate: 0.6,
    minSampleSize: 100,
    confidenceLevel: 0.95
  }
});

// Generate trading signals
const marketState = {
  prices: { 'BTC-USD': 50000, 'ETH-USD': 3000 },
  volumes: { 'BTC-USD': 1000000, 'ETH-USD': 500000 },
  timestamp: Date.now(),
  accountBalance: 100000,
  positions: []
};

const signals = await orchestrator.generateSignals(marketState);
```

## Component Usage

### LLM Alpha Generation

```typescript
import { LLMAlphaGenerator } from '@noderr/model-expansion';

const llmAlpha = new LLMAlphaGenerator(logger, config);
await llmAlpha.initialize();

// Generate strategy from prompt
const strategy = await llmAlpha.generateStrategy(
  "Create a momentum strategy for crypto that buys on RSI oversold conditions"
);

// Validate and deploy
const validation = await llmAlpha.validateStrategy(strategy);
if (validation.isValid) {
  await llmAlpha.deployStrategy(strategy);
}
```

### Reinforcement Learning

```typescript
import { RLLearningLoop } from '@noderr/model-expansion';

const rlLoop = new RLLearningLoop(logger, config);
await rlLoop.initialize();

// Train online with market data
const action = await rlLoop.trainOnline(marketState);

// Get performance metrics
const performance = rlLoop.getPerformance();
console.log(`Sharpe Ratio: ${performance.sharpeRatio}`);
```

### Evolution Engine

```typescript
import { EvolutionEngine, StrategyGenome } from '@noderr/model-expansion';

const evolution = new EvolutionEngine(logger, config);
await evolution.initialize();

// Evolve strategies
const bestStrategy = await evolution.evolve(historicalData, 100);

// Deploy elite strategies
const eliteStrategies = await evolution.deployElite(5);
```

### Causal Feature Selection

```typescript
import { CausalFeatureSelector } from '@noderr/model-expansion';

const causalSelector = new CausalFeatureSelector(logger, config);

// Analyze features
const features = [
  { name: 'rsi', values: [...] },
  { name: 'volume', values: [...] },
  { name: 'price_change', values: [...] }
];

const causalRelations = await causalSelector.analyzeCausality(features);
const validFeatures = causalSelector.getNonSpuriousFeatures();
```

## Performance Targets

The Model Expansion package targets elite 0.001% performance:

| Metric | Target | Description |
|--------|--------|-------------|
| Sharpe Ratio | > 3.0 | Risk-adjusted returns |
| Max Drawdown | < 10% | Maximum peak-to-trough decline |
| Win Rate | > 65% | Percentage of profitable trades |
| Profit Factor | > 2.5 | Gross profit / Gross loss |
| Calmar Ratio | > 3.0 | Annual return / Max drawdown |

## Architecture

```
model-expansion/
├── llm/                    # LLM integration components
│   ├── LLMAlphaGenerator   # Strategy generation from prompts
│   └── LLMFeatureSuggester # Feature discovery
├── rl/                     # Reinforcement learning
│   ├── RLLearningLoop      # Online learning orchestration
│   ├── PPOAgent            # PPO implementation
│   └── RewardFunctions     # Multi-objective rewards
├── evolution/              # Genetic programming
│   ├── EvolutionEngine     # Evolution orchestration
│   └── StrategyGenome      # Genetic representation
├── causal/                 # Causal inference
│   └── CausalFeatureSelector # Spurious correlation filtering
├── integration/            # External integrations
│   └── NumeraiIntegration  # Numerai.ai signals
├── validation/             # Model validation
│   └── ModelValidator      # Comprehensive validation
└── orchestration/          # Central coordination
    └── ModelOrchestrator   # Component orchestration
```

## Configuration

### Full Configuration Example

```typescript
const config = {
  llm: {
    enabled: true,
    providers: [
      {
        name: 'claude-3',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-3-opus-20240229',
        maxRetries: 3
      },
      {
        name: 'gpt-4',
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4-turbo-preview'
      }
    ],
    maxTokens: 4000,
    temperature: 0.7,
    safetyConstraints: {
      maxLeverage: 3,
      maxPositionSize: 0.2,
      forbiddenAssets: ['LUNA', 'FTT'],
      maxDrawdownLimit: 0.15
    }
  },
  rl: {
    enabled: true,
    algorithm: 'PPO',
    learningRate: 0.0003,
    discountFactor: 0.99,
    explorationRate: 0.1,
    batchSize: 32,
    memorySize: 10000,
    updateFrequency: 100
  },
  evolution: {
    enabled: true,
    populationSize: 100,
    mutationRate: 0.1,
    crossoverRate: 0.7,
    eliteRatio: 0.1,
    maxGenerations: 1000,
    targetFitness: 2.0,
    diversityBonus: 0.1
  },
  causal: {
    enabled: true,
    method: 'granger',
    confidenceLevel: 0.95,
    lagOrder: 5,
    maxConditioningSetSize: 3
  },
  integration: {
    numerai: {
      enabled: true,
      apiKey: process.env.NUMERAI_API_KEY,
      apiSecret: process.env.NUMERAI_API_SECRET,
      modelId: 'your-model-id',
      submissionEnabled: true
    }
  },
  validation: {
    minSharpe: 2.0,
    maxDrawdown: 0.15,
    minWinRate: 0.6,
    minSampleSize: 100,
    confidenceLevel: 0.95,
    backtestPeriods: 10,
    outOfSampleRatio: 0.3
  }
};
```

## Best Practices

1. **Start Conservative**: Begin with lower risk limits and gradually increase as models prove themselves
2. **Monitor Continuously**: Use the orchestrator's performance metrics to track all models
3. **Validate Thoroughly**: Always validate strategies before deployment, especially LLM-generated ones
4. **Diversify Models**: Use ensemble signals rather than relying on a single model
5. **Update Regularly**: Retrain RL agents and re-evolve strategies as market conditions change

## Troubleshooting

### Common Issues

1. **LLM Rate Limits**: Implement caching and request throttling
2. **RL Convergence**: Adjust learning rates and exploration parameters
3. **Evolution Stagnation**: Increase population diversity or mutation rates
4. **Causal False Positives**: Increase significance thresholds

### Performance Optimization

- Use GPU acceleration for RL training (if available)
- Parallelize evolution fitness evaluations
- Cache LLM responses for similar prompts
- Batch external API requests

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](../../LICENSE) for details. 