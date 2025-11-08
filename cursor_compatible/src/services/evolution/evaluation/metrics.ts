/**
 * Evaluation Metrics
 * 
 * Prometheus metrics for monitoring the strategy evaluation system.
 */

import { Registry, Counter, Gauge, Histogram } from 'prom-client';

// Create a registry for evaluation metrics
export const evaluationRegistry = new Registry();

// Evaluation counts
export const evaluationTotal = new Counter({
  name: 'evolution_evaluations_total',
  help: 'Total number of strategy evaluations performed',
  labelNames: ['status', 'generation_id'] as const,
  registers: [evaluationRegistry]
});

// Evaluation latency 
export const evaluationDuration = new Histogram({
  name: 'evolution_evaluation_duration_seconds',
  help: 'Duration of strategy evaluations in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  labelNames: ['generation_id'] as const,
  registers: [evaluationRegistry]
});

// Fitness scores
export const fitnessScoreGauge = new Gauge({
  name: 'evolution_fitness_score',
  help: 'Fitness scores of evaluated strategies',
  labelNames: ['agent_id', 'generation_id', 'passed'] as const,
  registers: [evaluationRegistry]
});

// Current queue size
export const queueSizeGauge = new Gauge({
  name: 'evolution_evaluation_queue_size',
  help: 'Number of strategies waiting in the evaluation queue',
  registers: [evaluationRegistry]
});

// Active evaluations
export const activeEvaluationsGauge = new Gauge({
  name: 'evolution_active_evaluations',
  help: 'Number of evaluations currently running',
  registers: [evaluationRegistry]
});

// Promotion counts
export const promotionsTotal = new Counter({
  name: 'evolution_promotions_total',
  help: 'Total number of strategies promoted',
  labelNames: ['agent_id', 'generation_id'] as const,
  registers: [evaluationRegistry]
});

// Remutation counts
export const remutationsTotal = new Counter({
  name: 'evolution_remutations_total',
  help: 'Total number of strategies sent for remutation',
  labelNames: ['agent_id', 'generation_id'] as const,
  registers: [evaluationRegistry]
});

// Performance metrics
export const performanceMetricsGauge = new Gauge({
  name: 'evolution_performance_metrics',
  help: 'Various performance metrics for evaluated strategies',
  labelNames: ['metric', 'agent_id', 'generation_id'] as const,
  registers: [evaluationRegistry]
});

/**
 * Record metrics for a completed evaluation
 * 
 * @param result - Evaluation result
 * @param durationMs - Evaluation duration in milliseconds
 */
export function recordEvaluationMetrics(
  result: any, // Replace with actual EvaluationResult type
  durationMs: number
): void {
  const { agentId, strategyId, generationId, passed, fitnessScore, sharpe, maxDrawdown, winRate, volatilityResilience, regretIndex } = result;
  
  // Increment evaluation counter
  evaluationTotal.inc({ status: passed ? 'passed' : 'failed', generation_id: generationId });
  
  // Record duration
  evaluationDuration.observe({ generation_id: generationId }, durationMs / 1000);
  
  // Update fitness score gauge
  fitnessScoreGauge.set({ agent_id: agentId, generation_id: generationId, passed: String(passed) }, fitnessScore);
  
  // Record performance metrics
  performanceMetricsGauge.set({ metric: 'sharpe', agent_id: agentId, generation_id: generationId }, sharpe);
  performanceMetricsGauge.set({ metric: 'max_drawdown', agent_id: agentId, generation_id: generationId }, maxDrawdown);
  performanceMetricsGauge.set({ metric: 'win_rate', agent_id: agentId, generation_id: generationId }, winRate);
  performanceMetricsGauge.set({ metric: 'volatility_resilience', agent_id: agentId, generation_id: generationId }, volatilityResilience);
  performanceMetricsGauge.set({ metric: 'regret_index', agent_id: agentId, generation_id: generationId }, regretIndex);
}

/**
 * Record metrics for a promotion
 * 
 * @param agentId - ID of the agent
 * @param generationId - ID of the generation
 */
export function recordPromotion(agentId: string, generationId: string): void {
  promotionsTotal.inc({ agent_id: agentId, generation_id: generationId });
}

/**
 * Record metrics for a remutation
 * 
 * @param agentId - ID of the agent
 * @param generationId - ID of the generation
 */
export function recordRemutation(agentId: string, generationId: string): void {
  remutationsTotal.inc({ agent_id: agentId, generation_id: generationId });
}

/**
 * Update queue metrics
 * 
 * @param queueSize - Current size of the evaluation queue
 * @param activeCount - Number of active evaluations
 */
export function updateQueueMetrics(queueSize: number, activeCount: number): void {
  queueSizeGauge.set(queueSize);
  activeEvaluationsGauge.set(activeCount);
} 