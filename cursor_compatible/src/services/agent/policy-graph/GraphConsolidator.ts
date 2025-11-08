/**
 * GraphConsolidator.ts
 * 
 * Implements graph consolidation operations:
 * - Applies optimization suggestions from PolicyGraphAnalyzer
 * - Merges similar nodes
 * - Rewires graph connections
 * - Prunes deprecated nodes
 */

import { 
  PolicyGraph, 
  PolicyNode, 
  PolicyEdge, 
  OptimizationSuggestion,
  OptimizationType
} from './PolicyGraphAnalyzer.js';
import { TrustScoreService } from '../TrustScoreService.js';
import { RedisService } from '../../infrastructure/RedisService.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';

/**
 * Interface for graph changes recorded in consolidation journal
 */
export interface GraphChange {
  id: string;
  graphId: string;
  agentId: string;
  timestamp: number;
  type: OptimizationType;
  targetIds: string[];
  reason: string;
  beforeState?: any;
  afterState?: any;
  trustImpact: number;
}

/**
 * Configuration for the graph consolidator
 */
export interface GraphConsolidatorConfig {
  // Maximum number of changes to apply per consolidation
  maxChangesPerRun: number;
  
  // Whether to apply changes or just simulate them
  dryRun: boolean;
  
  // Minimum confidence threshold for applying suggestions
  minConfidenceThreshold: number;
  
  // Redis key prefix for storing graphs
  redisKeyPrefix: string;
  
  // TTL for graph snapshots (ms)
  snapshotTtlMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: GraphConsolidatorConfig = {
  maxChangesPerRun: 5,
  dryRun: false,
  minConfidenceThreshold: 0.7,
  redisKeyPrefix: 'agent:policy_graph',
  snapshotTtlMs: 30 * 24 * 60 * 60 * 1000 // 30 days
};

/**
 * Graph Consolidator
 * 
 * Applies optimization suggestions to policy graphs
 */
export class GraphConsolidator {
  private trustScoreService: TrustScoreService;
  private redisService: RedisService;
  private config: GraphConsolidatorConfig;
  
  /**
   * Creates a new GraphConsolidator
   * 
   * @param trustScoreService - Trust score service
   * @param redisService - Redis service
   * @param config - Consolidator configuration
   */
  constructor(
    trustScoreService: TrustScoreService,
    redisService: RedisService,
    config: Partial<GraphConsolidatorConfig> = {}
  ) {
    this.trustScoreService = trustScoreService;
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('GraphConsolidator initialized', {
      maxChangesPerRun: this.config.maxChangesPerRun,
      dryRun: this.config.dryRun
    });
  }
  
  /**
   * Apply optimization suggestions to a policy graph
   * 
   * @param graph - Policy graph to modify
   * @param suggestions - Optimization suggestions to apply
   * @returns Array of applied changes and modified graph
   */
  public async consolidate(
    graph: PolicyGraph,
    suggestions: OptimizationSuggestion[]
  ): Promise<{
    changes: GraphChange[],
    updatedGraph: PolicyGraph
  }> {
    try {
      // Filter suggestions by confidence threshold
      const validSuggestions = suggestions.filter(
        s => s.confidence >= this.config.minConfidenceThreshold
      );
      
      // Sort by impact * confidence
      validSuggestions.sort((a, b) => 
        (b.impact * b.confidence) - (a.impact * a.confidence)
      );
      
      // Limit to max changes per run
      const suggestionsToApply = validSuggestions.slice(0, this.config.maxChangesPerRun);
      
      logger.info('Consolidating policy graph', {
        graphId: graph.id,
        agentId: graph.agentId,
        suggestionsCount: suggestionsToApply.length,
        dryRun: this.config.dryRun
      });
      
      // Create a deep copy of the graph to modify
      const updatedGraph = this.cloneGraph(graph);
      
      // Apply each suggestion and record changes
      const changes: GraphChange[] = [];
      
      for (const suggestion of suggestionsToApply) {
        const change = await this.applySuggestion(updatedGraph, suggestion);
        
        if (change) {
          changes.push(change);
          
          // Store snapshot in journal if not dry run
          if (!this.config.dryRun) {
            await this.storeChangeInJournal(change);
          }
        }
      }
      
      // Update graph metadata
      updatedGraph.metadata.lastModified = Date.now();
      updatedGraph.metadata.version++;
      
      // Persist updated graph if not in dry run mode
      if (!this.config.dryRun && changes.length > 0) {
        await this.persistGraph(updatedGraph);
        
        // Update agent trust score
        const totalTrustDelta = changes.reduce(
          (sum, change) => sum + change.trustImpact, 
          0
        );
        
        if (totalTrustDelta !== 0) {
          await this.updateAgentTrustScore(updatedGraph.agentId, totalTrustDelta);
        }
      }
      
      return { changes, updatedGraph };
    } catch (error) {
      logger.error('Error consolidating policy graph', {
        error: error instanceof Error ? error.message : String(error),
        graphId: graph.id,
        agentId: graph.agentId
      });
      return { changes: [], updatedGraph: graph };
    }
  }
  
  /**
   * Apply a single optimization suggestion to the graph
   * 
   * @param graph - Policy graph to modify
   * @param suggestion - Optimization suggestion to apply
   * @returns The change record or null if not applied
   */
  private async applySuggestion(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): Promise<GraphChange | null> {
    try {
      // Create change record
      const change: GraphChange = {
        id: uuidv4(),
        graphId: graph.id,
        agentId: graph.agentId,
        timestamp: Date.now(),
        type: suggestion.type,
        targetIds: [...suggestion.targetIds],
        reason: suggestion.reason,
        trustImpact: suggestion.trustDelta
      };
      
      // Store before state
      change.beforeState = this.extractRelevantState(graph, suggestion);
      
      // Apply the change based on type
      switch (suggestion.type) {
        case OptimizationType.DEPRECATE_NODE:
          this.handleDeprecateNode(graph, suggestion);
          break;
          
        case OptimizationType.MERGE_NODES:
          this.handleMergeNodes(graph, suggestion);
          break;
          
        case OptimizationType.REWIRE_EDGE:
          this.handleRewireEdge(graph, suggestion);
          break;
          
        case OptimizationType.REMOVE_EDGE:
          this.handleRemoveEdge(graph, suggestion);
          break;
          
        case OptimizationType.REWEIGHT_EDGE:
          this.handleReweightEdge(graph, suggestion);
          break;
          
        default:
          logger.warn('Unknown optimization type', { type: suggestion.type });
          return null;
      }
      
      // Store after state
      change.afterState = this.extractRelevantState(graph, suggestion);
      
      return change;
    } catch (error) {
      logger.error('Error applying suggestion', {
        error: error instanceof Error ? error.message : String(error),
        suggestionType: suggestion.type,
        targetIds: suggestion.targetIds
      });
      return null;
    }
  }
  
  /**
   * Handle deprecating a node
   * 
   * @param graph - Policy graph to modify
   * @param suggestion - Optimization suggestion
   */
  private handleDeprecateNode(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): void {
    const nodeId = suggestion.targetIds[0];
    
    // Find and remove the node
    const nodeIndex = graph.nodes.findIndex(n => n.id === nodeId);
    
    if (nodeIndex === -1) {
      logger.warn('Node not found for deprecation', { nodeId });
      return;
    }
    
    // Remove all edges connected to this node
    const edgesToRemove = graph.edges.filter(
      e => e.sourceNodeId === nodeId || e.targetNodeId === nodeId
    );
    
    for (const edge of edgesToRemove) {
      const edgeIndex = graph.edges.findIndex(e => e.id === edge.id);
      if (edgeIndex !== -1) {
        graph.edges.splice(edgeIndex, 1);
      }
    }
    
    // Remove the node
    graph.nodes.splice(nodeIndex, 1);
    
    logger.info('Deprecated node', {
      nodeId,
      edgesRemoved: edgesToRemove.length
    });
  }
  
  /**
   * Handle merging nodes
   * 
   * @param graph - Policy graph to modify
   * @param suggestion - Optimization suggestion
   */
  private handleMergeNodes(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): void {
    // If merging nodes, the first node in targetIds is usually the keeper
    // and the rest are merged into it
    if (suggestion.targetIds.length < 2) {
      logger.warn('Not enough nodes for merging', {
        targetIds: suggestion.targetIds
      });
      return;
    }
    
    // Determine which node to keep (either from metadata or first in list)
    const keeperId = suggestion.metadata?.keeperId || suggestion.targetIds[0];
    const keeper = graph.nodes.find(n => n.id === keeperId);
    
    if (!keeper) {
      logger.warn('Keeper node not found', { keeperId });
      return;
    }
    
    // Get nodes to merge
    const nodeIdsToMerge = suggestion.targetIds.filter(id => id !== keeperId);
    const nodesToMerge = graph.nodes.filter(n => nodeIdsToMerge.includes(n.id));
    
    if (nodesToMerge.length === 0) {
      logger.warn('No nodes found to merge', { nodeIdsToMerge });
      return;
    }
    
    // For each node to merge
    for (const node of nodesToMerge) {
      // Redirect all incoming edges to the keeper
      for (const edge of graph.edges) {
        if (edge.targetNodeId === node.id) {
          edge.targetNodeId = keeper.id;
        }
      }
      
      // Move outgoing edges to the keeper
      for (const edge of graph.edges) {
        if (edge.sourceNodeId === node.id) {
          edge.sourceNodeId = keeper.id;
        }
      }
      
      // Update the keeper's metadata
      keeper.metadata.usageCount += node.metadata.usageCount;
      keeper.metadata.reinforcementScore = Math.max(
        keeper.metadata.reinforcementScore,
        node.metadata.reinforcementScore
      );
      
      // If both nodes have success rates, use weighted average
      if (
        keeper.metadata.successRate !== undefined &&
        node.metadata.successRate !== undefined
      ) {
        const keeperWeight = keeper.metadata.usageCount;
        const nodeWeight = node.metadata.usageCount;
        const totalWeight = keeperWeight + nodeWeight;
        
        if (totalWeight > 0) {
          keeper.metadata.successRate = (
            (keeperWeight * (keeper.metadata.successRate || 0)) +
            (nodeWeight * (node.metadata.successRate || 0))
          ) / totalWeight;
        }
      }
      
      // Merge config if appropriate
      if (keeper.type === node.type) {
        // Simple merge - take best of both
        Object.entries(node.config).forEach(([key, value]) => {
          if (!(key in keeper.config)) {
            keeper.config[key] = value;
          }
        });
      }
      
      // Remove the merged node
      const nodeIndex = graph.nodes.findIndex(n => n.id === node.id);
      if (nodeIndex !== -1) {
        graph.nodes.splice(nodeIndex, 1);
      }
    }
    
    // Remove duplicate edges (same source and target)
    const uniqueEdges = new Map<string, PolicyEdge>();
    
    for (const edge of graph.edges) {
      const key = `${edge.sourceNodeId}-${edge.targetNodeId}`;
      
      if (!uniqueEdges.has(key) || edge.weight > uniqueEdges.get(key)!.weight) {
        uniqueEdges.set(key, edge);
      }
    }
    
    graph.edges = Array.from(uniqueEdges.values());
    
    // Check for self-loops and remove them
    const selfLoops = graph.edges.filter(
      e => e.sourceNodeId === e.targetNodeId
    );
    
    for (const edge of selfLoops) {
      const edgeIndex = graph.edges.findIndex(e => e.id === edge.id);
      if (edgeIndex !== -1) {
        graph.edges.splice(edgeIndex, 1);
      }
    }
    
    logger.info('Merged nodes', {
      keeperId,
      mergedNodes: nodeIdsToMerge,
      removedSelfLoops: selfLoops.length
    });
  }
  
  /**
   * Handle rewiring an edge
   * 
   * @param graph - Policy graph to modify
   * @param suggestion - Optimization suggestion
   */
  private handleRewireEdge(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): void {
    // Rewiring usually means changing the target of an edge
    if (suggestion.targetIds.length < 2) {
      logger.warn('Not enough targets for rewiring', {
        targetIds: suggestion.targetIds
      });
      return;
    }
    
    const edgeId = suggestion.targetIds[0];
    const newTargetId = suggestion.targetIds[1];
    
    const edge = graph.edges.find(e => e.id === edgeId);
    const newTarget = graph.nodes.find(n => n.id === newTargetId);
    
    if (!edge) {
      logger.warn('Edge not found for rewiring', { edgeId });
      return;
    }
    
    if (!newTarget) {
      logger.warn('Target node not found for rewiring', { newTargetId });
      return;
    }
    
    // Store the old target for logging
    const oldTargetId = edge.targetNodeId;
    
    // Update edge target
    edge.targetNodeId = newTargetId;
    
    logger.info('Rewired edge', {
      edgeId,
      oldTargetId,
      newTargetId
    });
  }
  
  /**
   * Handle removing an edge
   * 
   * @param graph - Policy graph to modify
   * @param suggestion - Optimization suggestion
   */
  private handleRemoveEdge(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): void {
    const edgeId = suggestion.targetIds[0];
    
    const edgeIndex = graph.edges.findIndex(e => e.id === edgeId);
    
    if (edgeIndex === -1) {
      logger.warn('Edge not found for removal', { edgeId });
      return;
    }
    
    // Remove the edge
    const removedEdge = graph.edges.splice(edgeIndex, 1)[0];
    
    logger.info('Removed edge', {
      edgeId,
      sourceNodeId: removedEdge.sourceNodeId,
      targetNodeId: removedEdge.targetNodeId
    });
  }
  
  /**
   * Handle reweighting an edge
   * 
   * @param graph - Policy graph to modify
   * @param suggestion - Optimization suggestion
   */
  private handleReweightEdge(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): void {
    const edgeId = suggestion.targetIds[0];
    
    const edge = graph.edges.find(e => e.id === edgeId);
    
    if (!edge) {
      logger.warn('Edge not found for reweighting', { edgeId });
      return;
    }
    
    // Get the new weight
    const newWeight = suggestion.metadata?.newWeight;
    
    if (typeof newWeight !== 'number') {
      logger.warn('New weight not specified', { edgeId });
      return;
    }
    
    const oldWeight = edge.weight;
    
    // Update edge weight
    edge.weight = newWeight;
    
    logger.info('Reweighted edge', {
      edgeId,
      oldWeight,
      newWeight
    });
  }
  
  /**
   * Extract relevant state from graph based on suggestion
   * 
   * @param graph - Policy graph
   * @param suggestion - Optimization suggestion
   * @returns Relevant portion of the graph state
   */
  private extractRelevantState(
    graph: PolicyGraph,
    suggestion: OptimizationSuggestion
  ): any {
    const state: any = {
      type: suggestion.type,
      timestamp: Date.now()
    };
    
    switch (suggestion.type) {
      case OptimizationType.DEPRECATE_NODE:
      case OptimizationType.MERGE_NODES:
        // For node operations, extract the nodes and their connections
        state.nodes = suggestion.targetIds.map(id => {
          const node = graph.nodes.find(n => n.id === id);
          if (!node) return { id, missing: true };
          
          const incomingEdges = graph.edges.filter(e => e.targetNodeId === id);
          const outgoingEdges = graph.edges.filter(e => e.sourceNodeId === id);
          
          return {
            ...node,
            incomingEdges,
            outgoingEdges
          };
        });
        break;
        
      case OptimizationType.REWIRE_EDGE:
      case OptimizationType.REMOVE_EDGE:
      case OptimizationType.REWEIGHT_EDGE:
        // For edge operations, extract the edge and connected nodes
        const edgeId = suggestion.targetIds[0];
        const edge = graph.edges.find(e => e.id === edgeId);
        
        if (edge) {
          const sourceNode = graph.nodes.find(n => n.id === edge.sourceNodeId);
          const targetNode = graph.nodes.find(n => n.id === edge.targetNodeId);
          
          state.edge = edge;
          
          if (sourceNode) {
            state.sourceNode = {
              id: sourceNode.id,
              type: sourceNode.type
            };
          }
          
          if (targetNode) {
            state.targetNode = {
              id: targetNode.id,
              type: targetNode.type
            };
          }
        } else {
          state.edge = { id: edgeId, missing: true };
        }
        break;
    }
    
    return state;
  }
  
  /**
   * Update agent trust score based on consolidation
   * 
   * @param agentId - Agent ID
   * @param trustDelta - Trust score change
   */
  private async updateAgentTrustScore(
    agentId: string,
    trustDelta: number
  ): Promise<void> {
    if (trustDelta === 0) return;
    
    try {
      await this.trustScoreService.adjustScore(
        agentId,
        trustDelta,
        'Graph consolidation',
        {
          consolidationType: 'automatic',
          timestamp: Date.now()
        }
      );
      
      logger.info('Updated agent trust score', {
        agentId,
        trustDelta
      });
    } catch (error) {
      logger.error('Error updating agent trust score', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        trustDelta
      });
    }
  }
  
  /**
   * Store a graph change in the consolidation journal
   * 
   * @param change - Graph change to store
   */
  private async storeChangeInJournal(change: GraphChange): Promise<void> {
    try {
      const key = `${this.config.redisKeyPrefix}:journal:${change.id}`;
      
      await this.redisService.setex(
        key,
        Math.floor(this.config.snapshotTtlMs / 1000),
        JSON.stringify(change)
      );
      
      // Add to journal index
      await this.redisService.lpush(
        `${this.config.redisKeyPrefix}:journal:${change.graphId}`,
        change.id
      );
      
      // Keep journal at reasonable size
      await this.redisService.ltrim(
        `${this.config.redisKeyPrefix}:journal:${change.graphId}`,
        0,
        99 // Keep last 100 changes
      );
      
      logger.debug('Stored graph change in journal', {
        changeId: change.id,
        graphId: change.graphId,
        type: change.type
      });
    } catch (error) {
      logger.error('Error storing graph change in journal', {
        error: error instanceof Error ? error.message : String(error),
        changeId: change.id
      });
    }
  }
  
  /**
   * Persist updated graph to storage
   * 
   * @param graph - Graph to store
   */
  private async persistGraph(graph: PolicyGraph): Promise<void> {
    try {
      const key = `${this.config.redisKeyPrefix}:${graph.id}`;
      
      // Store the graph
      await this.redisService.set(key, JSON.stringify(graph));
      
      // Also store a version snapshot
      const snapshotKey = `${this.config.redisKeyPrefix}:${graph.id}:version:${graph.metadata.version}`;
      
      await this.redisService.setex(
        snapshotKey,
        Math.floor(this.config.snapshotTtlMs / 1000),
        JSON.stringify(graph)
      );
      
      logger.info('Persisted policy graph', {
        graphId: graph.id,
        version: graph.metadata.version
      });
    } catch (error) {
      logger.error('Error persisting policy graph', {
        error: error instanceof Error ? error.message : String(error),
        graphId: graph.id
      });
    }
  }
  
  /**
   * Create a deep clone of a policy graph
   * 
   * @param graph - Graph to clone
   * @returns Cloned graph
   */
  private cloneGraph(graph: PolicyGraph): PolicyGraph {
    return JSON.parse(JSON.stringify(graph));
  }
  
  /**
   * Load a graph from storage by ID
   * 
   * @param graphId - Graph ID
   * @returns Policy graph or null if not found
   */
  public async loadGraph(graphId: string): Promise<PolicyGraph | null> {
    try {
      const key = `${this.config.redisKeyPrefix}:${graphId}`;
      const data = await this.redisService.get(key);
      
      if (!data) {
        logger.warn('Graph not found', { graphId });
        return null;
      }
      
      return JSON.parse(data) as PolicyGraph;
    } catch (error) {
      logger.error('Error loading policy graph', {
        error: error instanceof Error ? error.message : String(error),
        graphId
      });
      return null;
    }
  }
  
  /**
   * Rollback to a previous graph version
   * 
   * @param graphId - Graph ID
   * @param version - Version to rollback to
   * @returns Whether rollback was successful
   */
  public async rollbackToVersion(
    graphId: string,
    version: number
  ): Promise<boolean> {
    try {
      const snapshotKey = `${this.config.redisKeyPrefix}:${graphId}:version:${version}`;
      const data = await this.redisService.get(snapshotKey);
      
      if (!data) {
        logger.warn('Graph version not found', { graphId, version });
        return false;
      }
      
      const graph = JSON.parse(data) as PolicyGraph;
      
      // Update the current version number but keep the rollback versioning
      const currentGraph = await this.loadGraph(graphId);
      
      if (currentGraph) {
        graph.metadata.version = currentGraph.metadata.version + 1;
      }
      
      graph.metadata.lastModified = Date.now();
      
      await this.persistGraph(graph);
      
      logger.info('Rolled back graph to version', {
        graphId,
        fromVersion: currentGraph?.metadata.version,
        toVersion: version,
        newVersion: graph.metadata.version
      });
      
      return true;
    } catch (error) {
      logger.error('Error rolling back graph', {
        error: error instanceof Error ? error.message : String(error),
        graphId,
        version
      });
      return false;
    }
  }
} 