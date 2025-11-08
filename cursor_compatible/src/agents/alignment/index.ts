/**
 * Alignment Module
 * 
 * Exports components for the Recursive Meta-Agent Alignment Protocol system.
 * This module enables agents to maintain alignment with ethical and strategic anchors
 * even as they evolve independently.
 */

// Export alignment anchor framework components
export * from './alignment_anchor.js';

// Export recursive auditor components
export * from './recursive_auditor.js';

// Export drift monitor components
export * from './drift_monitor.js';

// Export the anchor service, auditor, and drift monitor
import { AlignmentAnchorService } from './alignment_anchor.js';
import { RecursiveAlignmentAuditor } from './recursive_auditor.js';
import { AlignmentDriftMonitor, DEFAULT_DRIFT_CONFIG } from './drift_monitor.js';
export { AlignmentAnchorService, RecursiveAlignmentAuditor, AlignmentDriftMonitor };

// Import core dependencies for factory function
import { RedisClient } from '../../common/redis.js';
import { AgentRegistry } from '../agentRegistry.js';

/**
 * Create a complete alignment system with all necessary components
 * @param redis Redis client for persistence
 * @param agentRegistry Agent registry for accessing agents
 * @returns Object containing all alignment components
 */
export function createAlignmentSystem(
  redis: RedisClient,
  agentRegistry: AgentRegistry
) {
  // Create components in dependency order
  const anchorService = new AlignmentAnchorService(redis);
  const recursiveAuditor = new RecursiveAlignmentAuditor(redis, anchorService);
  const driftMonitor = new AlignmentDriftMonitor(redis, anchorService, recursiveAuditor);
  
  // Initialize core components
  anchorService.initialize().catch(err => {
    console.error('Failed to initialize alignment system:', err);
  });
  
  // Return all components
  return {
    anchorService,
    recursiveAuditor,
    driftMonitor
  };
} 