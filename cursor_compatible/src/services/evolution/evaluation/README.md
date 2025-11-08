# Mutation Evaluation Engine

The Mutation Evaluation Engine is a comprehensive system for evaluating, scoring, and managing evolved trading agent strategies.

## Architecture Overview

The system consists of several key components:

1. **EvaluationRunner**: Runs evaluations on mutated strategies using backtesting, replay simulation, and risk assessment.
2. **FitnessScorer**: Calculates fitness scores based on performance metrics like Sharpe ratio, drawdown, win rate, etc.
3. **EvaluationQueue**: Manages a queue of evaluations with configurable concurrency limits.
4. **PromotionManager**: Handles promotion of successful strategies and re-mutation of failed ones.
5. **AuditLogger**: Creates detailed audit logs of evaluations for traceability.
6. **Metrics**: Prometheus metrics for monitoring system performance.

## Database Integration

The system stores evaluation results in a Postgres database table called `evolution_scores`. The table tracks:

- Strategy and agent IDs
- Generation information
- Performance metrics (Sharpe, drawdown, win rate, etc.)
- Pass/fail status
- Timestamps and metadata

## WebSocket Dashboard Integration

Real-time updates are broadcast to frontend dashboards via Redis pub/sub on these channels:

- `EVOLUTION_SCORE_UPDATE`: Broadcasts evaluation results
- `EVOLUTION_PROMOTION_INTENT`: Broadcasts promotion intents
- `EVOLUTION_REMUTATION_INTENT`: Broadcasts re-mutation intents

## Getting Started

### Initialization

```typescript
import { initEvaluationSystem } from './services/evolution/evaluation';
import { RedisService } from './services/redis/RedisService';
import { BacktestEngine } from './services/backtest/BacktestEngine';
import { ReplaySimulator } from './services/simulation/ReplaySimulator';
import { TrustScoreService } from './services/agent/TrustScoreService';

// Create required dependencies
const redisService = new RedisService(/* config */);
const postgresClient = /* Initialize your Postgres client */;
const backtestEngine = new BacktestEngine(/* config */);
const replaySimulator = new ReplaySimulator(/* config */);
const trustScoreService = new TrustScoreService(/* config */);

// Initialize the evaluation system
const {
  fitnessScorer,
  evaluationRunner,
  evaluationQueue,
  promotionManager,
  auditLogger
} = initEvaluationSystem(
  redisService,
  postgresClient,
  backtestEngine,
  replaySimulator,
  trustScoreService,
  {
    // Optional configuration overrides
    fitnessScorer: {
      minFitnessThreshold: 0.7
    },
    evaluationRunner: {
      backtestPeriod: 60 // 60 days
    }
  }
);
```

### Evaluating a Strategy

```typescript
// Enqueue a strategy for evaluation
const evaluationRequest = await evaluationQueue.enqueue(
  mutationResult, // Result from mutation operation
  'generation-123', // Generation ID
  2 // Priority (higher = more important)
);

// The queue processes evaluations automatically in the background
```

### Fitness Score Formula

The fitness score is calculated using the following formula:

```
fitnessScore = (sharpe * 0.4) + (1 - maxDrawdown) * 0.2 + (winRate * 0.2) + (volatilityResilience * 0.1) - (regretIndex * 0.1)
```

Each metric is normalized to ensure consistent scoring.

## Monitoring

### Logs

Standard logs are written using the system logger.

Detailed audit logs are stored in `logs/evolution/` with rotation support.

### Metrics

Prometheus metrics are available for monitoring:

- `evolution_evaluations_total`: Count of evaluations by status
- `evolution_evaluation_duration_seconds`: Duration of evaluations
- `evolution_fitness_score`: Fitness scores of strategies
- `evolution_evaluation_queue_size`: Size of the evaluation queue
- `evolution_active_evaluations`: Number of currently running evaluations
- `evolution_promotions_total`: Count of strategy promotions
- `evolution_remutations_total`: Count of strategy re-mutations

## Configuration

All components have sensible defaults but are fully configurable.

See the interface definitions for complete configuration options:

- `FitnessScorerConfig`
- `EvaluationRunnerConfig`
- `EvaluationQueueConfig`
- `PromotionManagerConfig`
- `AuditLoggerConfig` 