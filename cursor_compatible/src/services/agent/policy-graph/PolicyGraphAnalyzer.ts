/**
 * PolicyGraphAnalyzer.ts
 * 
 * Analyzes policy graphs to detect optimization opportunities:
 * - Redundant node chains
 * - High-regret leaf nodes
 * - Loops with decaying utility
 * 
 * Outputs optimization suggestions for the GraphConsolidator
 */

import { RedisService } from '../../infrastructure/RedisService.js';
import { RegretBuffer } from '../RegretBuffer.js';
import { TrustScoreService } from '../TrustScoreService.js';
import logger from '../../../utils/logger.js';

/**
 * Represents a node in the policy graph
 */
export interface PolicyNode {
  id: string;
  agentId: string;
  type: string;
  config: Record<string, any>;
  metadata: {
    createdAt: number;
    lastUsed: number;
    usageCount: number;
    reinforcementScore: number;
    successRate?: number;
  };
}

/**
 * Represents an edge in the policy graph
 */
export interface PolicyEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  condition?: string | Record<string, any>;
  metadata: {
    createdAt: number;
    lastUsed: number;
    usageCount: number;
    successRate?: number;
  };
}

/**
 * Represents a policy graph
 */
export interface PolicyGraph {
  id: string;
  agentId: string;
  nodes: PolicyNode[];
  edges: PolicyEdge[];
  metadata: {
    createdAt: number;
    lastModified: number;
    version: number;
  };
}

/**
 * Types of optimization suggestions
 */
export enum OptimizationType {
  DEPRECATE_NODE = 'DEPRECATE_NODE',
  MERGE_NODES = 'MERGE_NODES',
  REWIRE_EDGE = 'REWIRE_EDGE',
  REMOVE_EDGE = 'REMOVE_EDGE',
  REWEIGHT_EDGE = 'REWEIGHT_EDGE'
}

/**
 * Optimization suggestion for the graph consolidator
 */
export interface OptimizationSuggestion {
  type: OptimizationType;
  targetIds: string[];
  reason: string;
  confidence: number;
  impact: number; // Estimated performance impact (positive is good)
  trustDelta: number; // Estimated impact on trust score
  metadata?: Record<string, any>;
}

/**
 * Configuration for the policy graph analyzer
 */
export interface PolicyGraphAnalyzerConfig {
  // Minimum regret score to consider a node for deprecation
  highRegretThreshold: number;
  
  // Minimum number of uses before considering node for optimization
  minUsageThreshold: number;
  
  // Similarity threshold for node merging (0-1)
  similarityThreshold: number;
  
  // Maximum allowed length of redundant chains
  maxRedundantChainLength: number;
  
  // How many consecutive low-performance iterations before suggestion
  lowPerformanceStreak: number;
  
  // Minimum expected performance improvement to suggest change
  minImpactThreshold: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PolicyGraphAnalyzerConfig = {
  highRegretThreshold: 0.7,
  minUsageThreshold: 10,
  similarityThreshold: 0.85,
  maxRedundantChainLength: 3,
  lowPerformanceStreak: 5,
  minImpactThreshold: 0.05
};

/**
 * Policy Graph Analyzer
 * 
 * Analyzes policy graphs to find optimization opportunities
 */
export class PolicyGraphAnalyzer {
  private regretBuffer: RegretBuffer;
  private trustScoreService: TrustScoreService;
  private redisService: RedisService;
  private config: PolicyGraphAnalyzerConfig;
  
  /**
   * Creates a new PolicyGraphAnalyzer
   * 
   * @param regretBuffer - Regret buffer service
   * @param trustScoreService - Trust score service
   * @param redisService - Redis service
   * @param config - Analyzer configuration
   */
  constructor(
    regretBuffer: RegretBuffer,
    trustScoreService: TrustScoreService,
    redisService: RedisService,
    config: Partial<PolicyGraphAnalyzerConfig> = {}
  ) {
    this.regretBuffer = regretBuffer;
    this.trustScoreService = trustScoreService;
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('PolicyGraphAnalyzer initialized', {
      highRegretThreshold: this.config.highRegretThreshold,
      similarityThreshold: this.config.similarityThreshold
    });
  }
  
  /**
   * Analyze policy graph and generate optimization suggestions
   * 
   * @param graph - Policy graph to analyze
   * @returns List of optimization suggestions
   */
  public async analyze(graph: PolicyGraph): Promise<OptimizationSuggestion[]> {
    try {
      logger.info('Analyzing policy graph', {
        graphId: graph.id,
        agentId: graph.agentId,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length
      });
      
      const suggestions: OptimizationSuggestion[] = [];
      
      // Get regret data for this agent
      const regretEntries = await this.regretBuffer.getAgentRegretEntries(graph.agentId);
      
      // Run all analysis methods and collect suggestions
      suggestions.push(...await this.findHighRegretNodes(graph, regretEntries));
      suggestions.push(...await this.findRedundantChains(graph));
      suggestions.push(...await this.findSimilarNodes(graph));
      suggestions.push(...await this.findDecayingLoops(graph));
      suggestions.push(...await this.findIsolatedNodes(graph));
      
      // Sort by confidence and impact
      suggestions.sort((a, b) => 
        (b.confidence * b.impact) - (a.confidence * a.impact)
      );
      
      logger.info('Analysis complete', {
        graphId: graph.id,
        suggestionCount: suggestions.length
      });
      
      return suggestions;
    } catch (error) {
      logger.error('Error analyzing policy graph', {
        error: error instanceof Error ? error.message : String(error),
        graphId: graph.id,
        agentId: graph.agentId
      });
      return [];
    }
  }
  
  /**
   * Find nodes with high regret scores
   * 
   * @param graph - Policy graph
   * @param regretEntries - Regret entries for the agent
   * @returns Optimization suggestions
   */
  private async findHighRegretNodes(
    graph: PolicyGraph, 
    regretEntries: any[]
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    // Group regret entries by node
    const nodeRegrets = new Map<string, any[]>();
    
    for (const entry of regretEntries) {
      if (entry.actionContext?.nodeId) {
        const nodeId = entry.actionContext.nodeId;
        if (!nodeRegrets.has(nodeId)) {
          nodeRegrets.set(nodeId, []);
        }
        nodeRegrets.get(nodeId)?.push(entry);
      }
    }
    
    // Check each node
    for (const node of graph.nodes) {
      const nodeEntries = nodeRegrets.get(node.id) || [];
      
      if (nodeEntries.length === 0) {
        continue;
      }
      
      // Calculate average regret score
      const avgRegret = nodeEntries.reduce(
        (sum, entry) => sum + entry.regretScore, 
        0
      ) / nodeEntries.length;
      
      // Check if node is a leaf node (no outgoing edges)
      const isLeafNode = !graph.edges.some(e => e.sourceNodeId === node.id);
      
      // Check if node has been used enough to make a decision
      if (node.metadata.usageCount >= this.config.minUsageThreshold) {
        // If high regret and leaf node, suggest deprecation
        if (avgRegret >= this.config.highRegretThreshold && isLeafNode) {
          suggestions.push({
            type: OptimizationType.DEPRECATE_NODE,
            targetIds: [node.id],
            reason: `High regret leaf node (score: ${avgRegret.toFixed(2)})`,
            confidence: Math.min(1, nodeEntries.length / 20),
            impact: 0.2,
            trustDelta: 0.05
          });
        } 
        // If high regret but not leaf, suggest rewiring
        else if (avgRegret >= this.config.highRegretThreshold) {
          // Find incoming edges to this node
          const incomingEdges = graph.edges.filter(e => e.targetNodeId === node.id);
          
          for (const edge of incomingEdges) {
            suggestions.push({
              type: OptimizationType.REWEIGHT_EDGE,
              targetIds: [edge.id],
              reason: `Edge to high-regret node (score: ${avgRegret.toFixed(2)})`,
              confidence: Math.min(1, nodeEntries.length / 15),
              impact: 0.15,
              trustDelta: 0.03,
              metadata: {
                newWeight: Math.max(0.1, edge.weight * 0.5)
              }
            });
          }
        }
      }
    }
    
    return suggestions;
  }
  
  /**
   * Find redundant chains of nodes that can be simplified
   * 
   * @param graph - Policy graph
   * @returns Optimization suggestions
   */
  private async findRedundantChains(graph: PolicyGraph): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    // Find chains where nodes have exactly one input and one output
    for (const node of graph.nodes) {
      // Skip if node hasn't been used enough
      if (node.metadata.usageCount < this.config.minUsageThreshold) {
        continue;
      }
      
      // Get incoming and outgoing edges
      const incoming = graph.edges.filter(e => e.targetNodeId === node.id);
      const outgoing = graph.edges.filter(e => e.sourceNodeId === node.id);
      
      // If exactly one in and one out, potential chain
      if (incoming.length === 1 && outgoing.length === 1) {
        // Trace the chain back
        const chain = await this.traceChain(graph, node.id);
        
        // If chain is longer than max length, suggest merging
        if (chain.length >= this.config.maxRedundantChainLength) {
          suggestions.push({
            type: OptimizationType.MERGE_NODES,
            targetIds: chain,
            reason: `Redundant chain of ${chain.length} nodes`,
            confidence: 0.7,
            impact: 0.1 * chain.length,
            trustDelta: 0.02
          });
        }
      }
    }
    
    return suggestions;
  }
  
  /**
   * Find similar nodes that could be merged
   * 
   * @param graph - Policy graph
   * @returns Optimization suggestions
   */
  private async findSimilarNodes(graph: PolicyGraph): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    // Compare each node with every other node of the same type
    for (let i = 0; i < graph.nodes.length; i++) {
      const nodeA = graph.nodes[i];
      
      // Skip if not used enough
      if (nodeA.metadata.usageCount < this.config.minUsageThreshold) {
        continue;
      }
      
      for (let j = i + 1; j < graph.nodes.length; j++) {
        const nodeB = graph.nodes[j];
        
        // Skip if not used enough
        if (nodeB.metadata.usageCount < this.config.minUsageThreshold) {
          continue;
        }
        
        // Only compare nodes of the same type
        if (nodeA.type !== nodeB.type) {
          continue;
        }
        
        // Calculate similarity
        const similarity = this.calculateNodeSimilarity(nodeA, nodeB);
        
        // If similar enough, suggest merging
        if (similarity >= this.config.similarityThreshold) {
          // Decide which node to keep (higher reinforcement)
          const [keeper, target] = nodeA.metadata.reinforcementScore >= nodeB.metadata.reinforcementScore 
            ? [nodeA, nodeB] 
            : [nodeB, nodeA];
          
          suggestions.push({
            type: OptimizationType.MERGE_NODES,
            targetIds: [keeper.id, target.id],
            reason: `Similar nodes (${similarity.toFixed(2)} similarity)`,
            confidence: similarity,
            impact: 0.2,
            trustDelta: 0.04,
            metadata: {
              keeperId: keeper.id,
              similarity: similarity
            }
          });
        }
      }
    }
    
    return suggestions;
  }
  
  /**
   * Find loops with decaying utility
   * 
   * @param graph - Policy graph
   * @returns Optimization suggestions
   */
  private async findDecayingLoops(graph: PolicyGraph): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    // Find loops in the graph
    const loops = this.findLoops(graph);
    
    for (const loop of loops) {
      // Calculate success rate for the loop
      let totalUsage = 0;
      let totalSuccess = 0;
      
      for (const edgeId of loop) {
        const edge = graph.edges.find(e => e.id === edgeId);
        if (!edge) continue;
        
        totalUsage += edge.metadata.usageCount;
        
        if (edge.metadata.successRate !== undefined) {
          totalSuccess += edge.metadata.usageCount * (edge.metadata.successRate || 0);
        }
      }
      
      const avgSuccessRate = totalUsage > 0 ? totalSuccess / totalUsage : 0;
      
      // If success rate is low, suggest breaking the loop
      if (avgSuccessRate < 0.4 && totalUsage >= this.config.minUsageThreshold) {
        // Find the weakest edge in the loop
        let weakestEdge = null;
        let minSuccessRate = 1.0;
        
        for (const edgeId of loop) {
          const edge = graph.edges.find(e => e.id === edgeId);
          if (!edge) continue;
          
          const successRate = edge.metadata.successRate || 0;
          if (successRate < minSuccessRate) {
            minSuccessRate = successRate;
            weakestEdge = edge;
          }
        }
        
        if (weakestEdge) {
          suggestions.push({
            type: OptimizationType.REMOVE_EDGE,
            targetIds: [weakestEdge.id],
            reason: `Breaking low-success loop (rate: ${avgSuccessRate.toFixed(2)})`,
            confidence: Math.min(1, totalUsage / 30),
            impact: 0.3,
            trustDelta: 0.05
          });
        }
      }
    }
    
    return suggestions;
  }
  
  /**
   * Find isolated nodes with no connections
   * 
   * @param graph - Policy graph
   * @returns Optimization suggestions
   */
  private async findIsolatedNodes(graph: PolicyGraph): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    for (const node of graph.nodes) {
      const hasIncoming = graph.edges.some(e => e.targetNodeId === node.id);
      const hasOutgoing = graph.edges.some(e => e.sourceNodeId === node.id);
      
      // If node is isolated (no connections)
      if (!hasIncoming && !hasOutgoing) {
        suggestions.push({
          type: OptimizationType.DEPRECATE_NODE,
          targetIds: [node.id],
          reason: 'Isolated node with no connections',
          confidence: 0.95,
          impact: 0.05,
          trustDelta: 0
        });
      }
    }
    
    return suggestions;
  }
  
  /**
   * Trace a chain of nodes in the graph
   * 
   * @param graph - Policy graph
   * @param startNodeId - Starting node ID
   * @returns Array of node IDs in the chain
   */
  private async traceChain(graph: PolicyGraph, startNodeId: string): Promise<string[]> {
    const chain: string[] = [startNodeId];
    let currentNodeId = startNodeId;
    let visited = new Set<string>([startNodeId]);
    
    while (true) {
      // Get incoming edges
      const incoming = graph.edges.filter(e => e.targetNodeId === currentNodeId);
      
      // If not exactly one incoming edge, break
      if (incoming.length !== 1) {
        break;
      }
      
      // Get source node
      const sourceNodeId = incoming[0].sourceNodeId;
      
      // Check if already visited (loop)
      if (visited.has(sourceNodeId)) {
        break;
      }
      
      // Get outgoing edges from source
      const outgoing = graph.edges.filter(e => e.sourceNodeId === sourceNodeId);
      
      // If not exactly one outgoing edge, break
      if (outgoing.length !== 1) {
        break;
      }
      
      // Add to chain and continue
      chain.unshift(sourceNodeId);
      currentNodeId = sourceNodeId;
      visited.add(sourceNodeId);
      
      // Limit chain length to prevent infinite loops
      if (chain.length >= 10) {
        break;
      }
    }
    
    return chain;
  }
  
  /**
   * Find loops in the graph
   * 
   * @param graph - Policy graph
   * @returns Array of loops (each loop is an array of edge IDs)
   */
  private findLoops(graph: PolicyGraph): string[][] {
    const loops: string[][] = [];
    const visited = new Set<string>();
    
    // Build adjacency list
    const adjList = new Map<string, string[]>();
    
    for (const edge of graph.edges) {
      if (!adjList.has(edge.sourceNodeId)) {
        adjList.set(edge.sourceNodeId, []);
      }
      adjList.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
    
    // DFS function to find loops
    const dfs = (
      node: string, 
      path: string[], 
      edgePath: string[]
    ): void => {
      if (path.includes(node)) {
        // Found a loop
        const loopStart = path.indexOf(node);
        const loop = path.slice(loopStart);
        const edgeLoop = edgePath.slice(loopStart);
        loops.push(edgeLoop);
        return;
      }
      
      visited.add(node);
      path.push(node);
      
      const neighbors = adjList.get(node) || [];
      
      for (const neighbor of neighbors) {
        const edge = graph.edges.find(
          e => e.sourceNodeId === node && e.targetNodeId === neighbor
        );
        
        if (!edge) continue;
        
        const newEdgePath = [...edgePath, edge.id];
        dfs(neighbor, [...path], newEdgePath);
      }
    };
    
    // Run DFS from each node
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id, [], []);
      }
    }
    
    return loops;
  }
  
  /**
   * Calculate similarity between two nodes
   * 
   * @param nodeA - First node
   * @param nodeB - Second node
   * @returns Similarity score (0-1)
   */
  private calculateNodeSimilarity(nodeA: PolicyNode, nodeB: PolicyNode): number {
    // Simple implementation - compare configs directly
    // In a real system, this would use more sophisticated similarity metrics
    
    if (nodeA.type !== nodeB.type) {
      return 0;
    }
    
    // Calculate Jaccard similarity of config keys
    const keysA = Object.keys(nodeA.config);
    const keysB = Object.keys(nodeB.config);
    
    const intersection = keysA.filter(k => keysB.includes(k));
    const union = new Set([...keysA, ...keysB]);
    
    const keySimilarity = intersection.length / union.size;
    
    // Check value similarity for common keys
    let valueSimilarity = 0;
    let valueCount = 0;
    
    for (const key of intersection) {
      valueCount++;
      const valA = nodeA.config[key];
      const valB = nodeB.config[key];
      
      if (typeof valA === 'number' && typeof valB === 'number') {
        // For numbers, calculate how close they are as a percentage
        const max = Math.max(Math.abs(valA), Math.abs(valB)) || 1;
        const diff = Math.abs(valA - valB) / max;
        valueSimilarity += (1 - diff);
      } else if (valA === valB) {
        // For exact matches
        valueSimilarity += 1;
      } else if (
        typeof valA === 'string' && 
        typeof valB === 'string'
      ) {
        // For strings, check if they're similar
        const maxLen = Math.max(valA.length, valB.length);
        let sameChars = 0;
        const minLen = Math.min(valA.length, valB.length);
        
        for (let i = 0; i < minLen; i++) {
          if (valA[i] === valB[i]) sameChars++;
        }
        
        valueSimilarity += sameChars / maxLen;
      } else {
        // Different types or complex objects
        valueSimilarity += 0;
      }
    }
    
    // Calculate weighted average
    const avgValueSimilarity = valueCount > 0 
      ? valueSimilarity / valueCount 
      : 0;
    
    return (keySimilarity * 0.4) + (avgValueSimilarity * 0.6);
  }
} 