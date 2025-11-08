/**
 * Memory Module
 * 
 * Exports components for the Agent Memory Graph system, which captures all
 * historical interactions, decisions, trust events, and reinforcement signals
 * in a compressed knowledge graph.
 */

// Export memory types from types folder
export type {
  MemoryGraphNode,
  MemoryGraphConfig,
  MemoryQueryOptions,
  CompressionOptions,
  FusionFeedbackEvent,
  MemoryPath
} from '../../types/memory.types.js';

// Export memory components
export { MemoryGraph } from './MemoryGraph.js';
export { CompressionEngine } from './CompressionEngine.js';
export { MemoryQuery } from './MemoryQuery.js';

// Export memory factory functions
import { RedisService } from '../infrastructure/RedisService.js';
import { MemoryGraph } from './MemoryGraph.js';
import { CompressionEngine } from './CompressionEngine.js';
import { MemoryQuery } from './MemoryQuery.js';
import { MemoryGraphConfig, CompressionOptions } from '../../types/memory.types.js';

/**
 * Create a full memory system with all components initialized
 * 
 * @param redisService - Redis service for data persistence
 * @param memoryConfig - Configuration for the memory graph
 * @param compressionOptions - Configuration for the compression engine
 * @returns Object containing all memory components
 */
export function createMemorySystem(
  redisService: RedisService,
  memoryConfig: Partial<MemoryGraphConfig> = {},
  compressionOptions: Partial<CompressionOptions> = {}
) {
  const memoryGraph = new MemoryGraph(redisService, memoryConfig);
  const compressionEngine = new CompressionEngine(redisService, memoryGraph, compressionOptions);
  const memoryQuery = new MemoryQuery(redisService, memoryGraph);
  
  return {
    memoryGraph,
    compressionEngine,
    memoryQuery
  };
} 