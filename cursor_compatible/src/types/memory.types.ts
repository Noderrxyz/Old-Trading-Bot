/**
 * Types for the Agent Memory Graph system.
 * Defines structures for persistent, evolving memory that captures historical interactions,
 * decisions, trust events, and reinforcement signals in a compressed knowledge graph.
 */

/**
 * Represents a node in the memory graph for a specific agent.
 * Each node contains information about a decision point, strategy snapshot,
 * or significant event in the agent's history.
 */
export interface MemoryGraphNode {
  id: string;
  strategyId: string;
  agentId: string;
  timestamp: number;
  trustScore: number;
  reinforcementScore: number;
  regretScore: number;
  contextTags: string[];
  children: string[]; // IDs of downstream decisions/nodes
  parentId?: string;  // Optional parent node
  metadata?: Record<string, any>; // Additional contextual data
  compressionLevel?: number; // Indicates if this node has been compressed (0-10)
  weight?: number; // Node importance weight (calculated from scores and decay)
}

/**
 * Configuration options for the MemoryGraph service
 */
export interface MemoryGraphConfig {
  // Redis key prefix for memory graph entries
  keyPrefix: string;
  
  // TTL in milliseconds for memory entries
  ttlMs: number;
  
  // Rate at which memory decays over time (daily multiplier < 1)
  memoryDecayRate: number;
  
  // Maximum number of direct children per node
  maxChildrenPerNode: number;
  
  // Threshold for node merging during compression
  similarityThreshold: number;
}

/**
 * Options for querying the memory graph
 */
export interface MemoryQueryOptions {
  // Time range options
  startTime?: number;
  endTime?: number;
  
  // Filter by minimum scores
  minTrustScore?: number;
  minReinforcementScore?: number;
  maxRegretScore?: number;
  
  // Filter by context tags (array of required tags)
  contextTags?: string[];
  
  // Maximum number of results to return
  limit?: number;
  
  // Traversal depth limit when exploring the graph
  maxDepth?: number;
  
  // Whether to include compressed nodes
  includeCompressed?: boolean;
}

/**
 * Options for memory graph compression
 */
export interface CompressionOptions {
  // Minimum similarity threshold for merging nodes
  similarityThreshold: number;
  
  // Maximum age of nodes to consider for compression (in ms)
  minNodeAge: number;
  
  // Minimum weight for nodes to be preserved during pruning
  minWeightThreshold: number;
  
  // Maximum compression level (higher = more compressed)
  maxCompressionLevel: number;
}

/**
 * Defines the structure of feedback events that can be added to the memory graph
 */
export interface FusionFeedbackEvent {
  id: string;
  agentId: string;
  strategyId: string;
  timestamp: number;
  eventType: 'reinforcement' | 'trust' | 'regret' | 'decision';
  score: number;
  contextTags: string[];
  parentEventId?: string;
  metadata?: Record<string, any>;
}

/**
 * Result of a memory graph query representing a path through the graph
 */
export interface MemoryPath {
  nodes: MemoryGraphNode[];
  totalTrust: number;
  totalReinforcement: number;
  totalRegret: number;
  averageWeight: number;
  contextSimilarity: number;
} 