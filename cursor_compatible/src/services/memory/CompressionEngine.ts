/**
 * CompressionEngine Service
 * 
 * Periodically scans memory graphs to optimize storage and processing by:
 * - Merging redundant nodes (same context + similar outcome)
 * - Pruning low-weight dead branches
 * - Promoting long-lived successful strategies into core memory nodes
 * - Maintaining a compressed embedding-like summary for fast lookups
 */

import { RedisService } from '../infrastructure/RedisService.js';
import { MemoryGraph } from './MemoryGraph.js';
import { 
  MemoryGraphNode, 
  CompressionOptions,
  MemoryPath
} from '../../types/memory.types.js';
import logger from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Default compression options
 */
const DEFAULT_COMPRESSION_OPTIONS: CompressionOptions = {
  similarityThreshold: 0.85,
  minNodeAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  minWeightThreshold: 0.1,
  maxCompressionLevel: 5
};

/**
 * CompressionEngine service for optimizing memory graphs
 */
export class CompressionEngine {
  private redisService: RedisService;
  private memoryGraph: MemoryGraph;
  private options: CompressionOptions;
  
  /**
   * Creates a new CompressionEngine instance
   * 
   * @param redisService - Redis service for data persistence
   * @param memoryGraph - Memory graph service
   * @param options - Compression options
   */
  constructor(
    redisService: RedisService,
    memoryGraph: MemoryGraph,
    options: Partial<CompressionOptions> = {}
  ) {
    this.redisService = redisService;
    this.memoryGraph = memoryGraph;
    this.options = { ...DEFAULT_COMPRESSION_OPTIONS, ...options };
    
    logger.info('CompressionEngine initialized', {
      similarityThreshold: this.options.similarityThreshold,
      minNodeAgeDays: this.options.minNodeAge / (24 * 60 * 60 * 1000)
    });
  }
  
  /**
   * Compress the memory graph for a specific agent
   * 
   * @param agentId - The ID of the agent
   * @returns Compression statistics
   */
  public async compressAgentMemory(agentId: string): Promise<{
    nodesAnalyzed: number;
    nodesMerged: number;
    nodesPruned: number;
    nodesPromoted: number;
  }> {
    try {
      logger.info('Starting memory compression for agent', { agentId });
      
      const stats = {
        nodesAnalyzed: 0,
        nodesMerged: 0,
        nodesPruned: 0,
        nodesPromoted: 0
      };
      
      // Get all nodes for the agent
      const nodes = await this.memoryGraph.getAgentNodes(agentId);
      stats.nodesAnalyzed = nodes.length;
      
      if (nodes.length === 0) {
        logger.info('No nodes to compress for agent', { agentId });
        return stats;
      }
      
      // 1. Prune low-weight nodes
      const prunedCount = await this.pruneDeadBranches(agentId, nodes);
      stats.nodesPruned = prunedCount;
      
      // Re-fetch nodes after pruning
      const afterPruneNodes = await this.memoryGraph.getAgentNodes(agentId);
      
      // 2. Merge similar nodes
      const mergeResult = await this.mergeSimilarNodes(agentId, afterPruneNodes);
      stats.nodesMerged = mergeResult.mergedCount;
      
      // 3. Promote important nodes
      const promotedCount = await this.promoteImportantNodes(agentId, afterPruneNodes);
      stats.nodesPromoted = promotedCount;
      
      logger.info('Completed memory compression for agent', {
        agentId,
        ...stats
      });
      
      return stats;
    } catch (error) {
      logger.error('Error compressing agent memory', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return {
        nodesAnalyzed: 0,
        nodesMerged: 0,
        nodesPruned: 0,
        nodesPromoted: 0
      };
    }
  }
  
  /**
   * Prune low-weight branches from the memory graph
   * 
   * @param agentId - The ID of the agent
   * @param nodes - List of memory nodes
   * @returns Number of nodes pruned
   */
  private async pruneDeadBranches(agentId: string, nodes: MemoryGraphNode[]): Promise<number> {
    try {
      const now = Date.now();
      let prunedCount = 0;
      
      // Filter nodes that are candidates for pruning
      const pruneableNodes = nodes.filter(node => {
        // Only consider nodes older than minNodeAge
        const nodeAge = now - node.timestamp;
        
        return (
          nodeAge > this.options.minNodeAge && // Node is old enough
          (node.weight ?? 0) < this.options.minWeightThreshold && // Weight below threshold
          node.children.length === 0 // Leaf node (no children)
        );
      });
      
      // Prune each candidate
      for (const node of pruneableNodes) {
        const deleted = await this.memoryGraph.deleteNode(node.id);
        if (deleted) {
          prunedCount++;
        }
      }
      
      logger.info('Pruned dead branches', {
        agentId,
        prunedCount,
        candidateCount: pruneableNodes.length
      });
      
      return prunedCount;
    } catch (error) {
      logger.error('Error pruning dead branches', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return 0;
    }
  }
  
  /**
   * Merge similar nodes to reduce redundancy
   * 
   * @param agentId - The ID of the agent
   * @param nodes - List of memory nodes
   * @returns Merge statistics
   */
  private async mergeSimilarNodes(
    agentId: string, 
    nodes: MemoryGraphNode[]
  ): Promise<{
    mergedCount: number;
    newNodesCreated: number;
  }> {
    try {
      let mergedCount = 0;
      let newNodesCreated = 0;
      
      // Sort by strategy ID to group similar nodes
      nodes.sort((a, b) => {
        if (a.strategyId !== b.strategyId) {
          return a.strategyId.localeCompare(b.strategyId);
        }
        return a.timestamp - b.timestamp;
      });
      
      // Group nodes by strategy
      const nodesByStrategy: Record<string, MemoryGraphNode[]> = {};
      
      for (const node of nodes) {
        if (!nodesByStrategy[node.strategyId]) {
          nodesByStrategy[node.strategyId] = [];
        }
        nodesByStrategy[node.strategyId].push(node);
      }
      
      // Process each strategy group
      for (const strategyId of Object.keys(nodesByStrategy)) {
        const strategyNodes = nodesByStrategy[strategyId];
        
        // Skip if not enough nodes to merge
        if (strategyNodes.length < 3) {
          continue;
        }
        
        // Find clusters of similar nodes
        const clusters = this.clusterSimilarNodes(strategyNodes);
        
        // Merge each cluster if it has multiple nodes
        for (const cluster of clusters) {
          if (cluster.length >= 3) {
            const mergeResult = await this.mergeNodeCluster(cluster);
            if (mergeResult.success) {
              mergedCount += cluster.length;
              newNodesCreated++;
            }
          }
        }
      }
      
      logger.info('Merged similar nodes', {
        agentId,
        mergedCount,
        newNodesCreated
      });
      
      return { mergedCount, newNodesCreated };
    } catch (error) {
      logger.error('Error merging similar nodes', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return { mergedCount: 0, newNodesCreated: 0 };
    }
  }
  
  /**
   * Promote important nodes to core memory
   * 
   * @param agentId - The ID of the agent
   * @param nodes - List of memory nodes
   * @returns Number of nodes promoted
   */
  private async promoteImportantNodes(agentId: string, nodes: MemoryGraphNode[]): Promise<number> {
    try {
      let promotedCount = 0;
      
      // Find candidates for promotion:
      // 1. High trust score
      // 2. Low regret score
      // 3. Has been accessed/referenced multiple times
      const candidateNodes = nodes.filter(node => {
        const isHighTrust = node.trustScore > 0.8;
        const isLowRegret = node.regretScore < 0.2;
        const hasGoodWeight = (node.weight ?? 0) > 0.7;
        
        return isHighTrust && isLowRegret && hasGoodWeight;
      });
      
      // Promote each candidate
      for (const node of candidateNodes) {
        // Skip if already at max compression level
        if ((node.compressionLevel ?? 0) >= this.options.maxCompressionLevel) {
          continue;
        }
        
        // Increase compression level (promotion)
        const updatedNode = {
          ...node,
          compressionLevel: Math.min(
            (node.compressionLevel ?? 0) + 1,
            this.options.maxCompressionLevel
          ),
          // Boost weight slightly
          weight: (node.weight ?? 0) * 1.1
        };
        
        // Add promotion marker to metadata
        if (!updatedNode.metadata) {
          updatedNode.metadata = {};
        }
        
        updatedNode.metadata.promotedAt = Date.now();
        
        // Update the node
        await this.storeNode(updatedNode);
        promotedCount++;
      }
      
      logger.info('Promoted important nodes', {
        agentId,
        promotedCount,
        candidateCount: candidateNodes.length
      });
      
      return promotedCount;
    } catch (error) {
      logger.error('Error promoting important nodes', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return 0;
    }
  }
  
  /**
   * Cluster nodes based on similarity
   * 
   * @param nodes - List of nodes to cluster
   * @returns Array of node clusters
   */
  private clusterSimilarNodes(nodes: MemoryGraphNode[]): MemoryGraphNode[][] {
    const clusters: MemoryGraphNode[][] = [];
    const processedNodes = new Set<string>();
    
    // For each node, find similar nodes
    for (const node of nodes) {
      // Skip if already processed
      if (processedNodes.has(node.id)) {
        continue;
      }
      
      // Start a new cluster with this node
      const cluster: MemoryGraphNode[] = [node];
      processedNodes.add(node.id);
      
      // Find similar nodes
      for (const otherNode of nodes) {
        if (processedNodes.has(otherNode.id)) {
          continue;
        }
        
        const similarity = this.calculateNodeSimilarity(node, otherNode);
        
        if (similarity >= this.options.similarityThreshold) {
          cluster.push(otherNode);
          processedNodes.add(otherNode.id);
        }
      }
      
      // Add cluster if it has multiple nodes
      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }
    
    return clusters;
  }
  
  /**
   * Merge a cluster of similar nodes into a compressed node
   * 
   * @param nodes - Cluster of similar nodes
   * @returns Result of the merge operation
   */
  private async mergeNodeCluster(
    nodes: MemoryGraphNode[]
  ): Promise<{
    success: boolean;
    mergedNodeId?: string;
  }> {
    try {
      if (nodes.length < 2) {
        return { success: false };
      }
      
      // Sort by timestamp
      nodes.sort((a, b) => a.timestamp - b.timestamp);
      
      // Create new merged node
      const mergedNodeId = uuidv4();
      
      // Calculate merged properties
      const avgTrustScore = nodes.reduce((sum, node) => sum + node.trustScore, 0) / nodes.length;
      const avgReinforcementScore = nodes.reduce((sum, node) => sum + node.reinforcementScore, 0) / nodes.length;
      const avgRegretScore = nodes.reduce((sum, node) => sum + node.regretScore, 0) / nodes.length;
      const avgWeight = nodes.reduce((sum, node) => sum + (node.weight ?? 0), 0) / nodes.length;
      
      // Combine context tags (unique)
      const allTags = new Set<string>();
      for (const node of nodes) {
        for (const tag of node.contextTags) {
          allTags.add(tag);
        }
      }
      
      // Create merged node
      const mergedNode: MemoryGraphNode = {
        id: mergedNodeId,
        strategyId: nodes[0].strategyId,
        agentId: nodes[0].agentId,
        timestamp: nodes[0].timestamp, // Use oldest timestamp
        trustScore: avgTrustScore,
        reinforcementScore: avgReinforcementScore,
        regretScore: avgRegretScore,
        contextTags: Array.from(allTags),
        children: [], // Will update after storing
        parentId: nodes[0].parentId, // Use oldest node's parent
        metadata: {
          mergedFrom: nodes.map(n => n.id),
          mergedCount: nodes.length,
          mergedAt: Date.now(),
          originalTimestamps: nodes.map(n => n.timestamp)
        },
        compressionLevel: Math.max(...nodes.map(n => n.compressionLevel ?? 0)) + 1,
        weight: avgWeight
      };
      
      // Store the merged node
      await this.storeNode(mergedNode);
      
      // Update parent-child relationships
      if (mergedNode.parentId) {
        await this.memoryGraph.linkNodes(mergedNode.parentId, mergedNodeId);
      }
      
      // Collect all unique children
      const allChildren = new Set<string>();
      for (const node of nodes) {
        for (const childId of node.children) {
          allChildren.add(childId);
        }
      }
      
      // Link merged node to all children
      for (const childId of allChildren) {
        await this.memoryGraph.linkNodes(mergedNodeId, childId);
      }
      
      // Delete original nodes
      for (const node of nodes) {
        await this.memoryGraph.deleteNode(node.id);
      }
      
      return {
        success: true,
        mergedNodeId
      };
    } catch (error) {
      logger.error('Error merging node cluster', {
        error: error instanceof Error ? error.message : String(error),
        nodeCount: nodes.length
      });
      return { success: false };
    }
  }
  
  /**
   * Calculate similarity between two nodes
   * 
   * @param node1 - First node
   * @param node2 - Second node
   * @returns Similarity score (0-1)
   */
  private calculateNodeSimilarity(node1: MemoryGraphNode, node2: MemoryGraphNode): number {
    // Must be same strategy
    if (node1.strategyId !== node2.strategyId) {
      return 0;
    }
    
    // Compute tag similarity (Jaccard index)
    const tags1 = new Set(node1.contextTags);
    const tags2 = new Set(node2.contextTags);
    const intersection = new Set([...tags1].filter(tag => tags2.has(tag)));
    const union = new Set([...tags1, ...tags2]);
    const tagSimilarity = union.size === 0 ? 0 : intersection.size / union.size;
    
    // Compute score similarity
    const trustDiff = Math.abs(node1.trustScore - node2.trustScore);
    const reinforcementDiff = Math.abs(node1.reinforcementScore - node2.reinforcementScore);
    const regretDiff = Math.abs(node1.regretScore - node2.regretScore);
    
    const scoreSimilarity = 1 - ((trustDiff + reinforcementDiff + regretDiff) / 3);
    
    // Weight the components (more emphasis on tags)
    return 0.7 * tagSimilarity + 0.3 * scoreSimilarity;
  }
  
  /**
   * Store a node in Redis
   * 
   * @param node - The node to store
   */
  private async storeNode(node: MemoryGraphNode): Promise<void> {
    // Leverage MemoryGraph's addNode method by creating a feedback event
    await this.memoryGraph.addNode({
      id: node.id,
      agentId: node.agentId,
      strategyId: node.strategyId,
      timestamp: node.timestamp,
      eventType: 'decision', // Default type
      score: node.trustScore, // Use trust score as default
      contextTags: node.contextTags,
      parentEventId: node.parentId,
      metadata: {
        ...node.metadata,
        reinforcementScore: node.reinforcementScore,
        regretScore: node.regretScore,
        compressionLevel: node.compressionLevel,
        weight: node.weight
      }
    });
  }
} 