/**
 * Evolution Engine Module
 * 
 * Exports components for the Multi-Agent Adaptation and Evolution Engine.
 * This module enables agents to evolve, mutate, and optimize based on 
 * real-world feedback, becoming self-improving decentralized strategists.
 */

export * from './agentFitnessScoring.js';
export * from './mutationRegistry.js';
export * from './evolutionEngine.js';
export * from './evolutionVoting.js';
export * from './dashboard/evolutionDashboardAPI.js';

// Re-export Dashboard API from the dashboard directory
import { EvolutionDashboardAPI } from './dashboard/evolutionDashboardAPI.js';
export { EvolutionDashboardAPI };

// Import core classes for the factory function
import { RedisClient } from '../../common/redis.js';
import { AgentRegistry } from '../agentRegistry.js';
import { TrustScoreEngine } from '../../strategy-engine/index.js';
import { AgentFitnessScoring } from './agentFitnessScoring.js';
import { MutationRegistry } from './mutationRegistry.js';
import { EvolutionEngine } from './evolutionEngine.js';
import { EvoVotingSystem } from './evolutionVoting.js';

/**
 * Create a complete Evolution Engine with all necessary components
 * @param redis Redis client for persistence
 * @param agentRegistry Agent registry for accessing agents
 * @param trustScoreEngine Trust score engine for vote weighting
 * @returns Object containing all evolution components
 */
export function createEvolutionEngine(
  redis: RedisClient,
  agentRegistry: AgentRegistry,
  trustScoreEngine: TrustScoreEngine
) {
  // Create components in dependency order
  const fitnessScoring = new AgentFitnessScoring(redis, agentRegistry);
  const mutationRegistry = new MutationRegistry(redis);
  const votingSystem = new EvoVotingSystem(redis, agentRegistry, trustScoreEngine);
  const evolutionEngine = new EvolutionEngine(
    redis,
    agentRegistry,
    fitnessScoring,
    mutationRegistry,
    votingSystem
  );
  const dashboardAPI = new EvolutionDashboardAPI(
    redis,
    agentRegistry,
    fitnessScoring,
    mutationRegistry,
    evolutionEngine,
    votingSystem
  );
  
  // Return all components
  return {
    fitnessScoring,
    mutationRegistry,
    votingSystem,
    evolutionEngine,
    dashboardAPI
  };
} 