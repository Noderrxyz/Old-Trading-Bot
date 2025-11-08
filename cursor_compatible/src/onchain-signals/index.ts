/**
 * Onchain Signals Module
 * 
 * This module analyzes blockchain data to generate trading signals
 * based on on-chain metrics like transaction volumes, token transfers,
 * smart contract interactions, and wallet activities.
 */

// Export models for analyzing blockchain data
export * from './models/index.js';

// Export utilities
export * from './utils/statistics.js';

// Re-export the ChainAlpha type for external use
export { ChainAlpha } from '../strategies/alpha/blend.js'; 