/**
 * Evolution Module
 * 
 * Entry point for the evolution tracking system.
 * Exports types and functionality for the Evolution Graph Engine.
 */

// Export types
export * from './types.js';

// Export main functionality
export {
  EvolutionGraphEngine,
  recordMutation,
  getLineage,
  getLatestStrategy
} from './EvolutionGraphEngine.js'; 