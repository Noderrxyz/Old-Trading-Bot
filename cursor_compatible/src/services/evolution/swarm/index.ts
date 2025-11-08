/**
 * Swarm Evolution Module
 * 
 * Exports components for agent speciation and evolutionary dynamics.
 */

// Core types
export * from './types.js';

// Main components
export { StrategyForker, ForkReason } from './StrategyForker.js';
export { SpeciationLedger, SpeciationLedgerOptions } from './SpeciationLedger.js';
export { SwarmDivergenceEngine, SpeciationOptions } from './SwarmDivergenceEngine.js';

// Utility functions
export * from './utils.js'; 