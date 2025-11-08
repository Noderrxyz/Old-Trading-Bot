/**
 * MemoryGraph Service
 * 
 * Stores agent-specific memory graphs in Redis with persistence capabilities.
 * Represents agent memories as a directed graph of decision points, experiences,
 * and feedback signals that evolve over time through reinforcement.
 */

import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../infrastructure/RedisService.js';
import { 
  MemoryGraphNode, 
  MemoryGraphConfig, 
  MemoryQueryOptions,
  FusionFeedbackEvent,
  MemoryPath
} from '../../types/memory.types.js';
import logger from '../../utils/logger.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MemoryGraphConfig = {
  keyPrefix: 'agent:memory',
  ttlMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  memoryDecayRate: 0.998, // ~0.2% decay per day
  maxChildrenPerNode: 50,
  similarityThreshold: 0.85
};

/**
 * MemoryGraph service that manages agent memory graph structures
 */
export class MemoryGraph {
  private redisService: RedisService;
  private config: MemoryGraphConfig;
  
  /**
   * Creates a new MemoryGraph instance
   * 
   * @param redisService - Redis service for data persistence
   * @param config - Configuration options
   */
  constructor(
    redisService: RedisService,
    config: Partial<MemoryGraphConfig> = {}
  ) {
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('MemoryGraph initialized', {
      ttlDays: this.config.ttlMs / (24 * 60 * 60 * 1000),
      decayRate: this.config.memoryDecayRate
    });
  }
  
  /**
   * Add a node to the memory graph from a feedback event
   * 
   * @param event - The feedback event to create a node from
   * @returns The ID of the created node
   */
  public async addNode(event: FusionFeedbackEvent): Promise<string> {
    try {
      // Create node ID if not provided
      const nodeId = event.id || uuidv4();
      
      // Create the memory node
      const node: MemoryGraphNode = {
        id: nodeId,
        strategyId: event.strategyId,
        agentId: event.agentId,
        timestamp: event.timestamp || Date.now(),
        trustScore: event.eventType === 'trust' ? event.score : 0,
        reinforcementScore: event.eventType === 'reinforcement' ? event.score : 0,
        regretScore: event.eventType === 'regret' ? event.score : 0,
        contextTags: event.contextTags || [],
        children: [],
        parentId: event.parentEventId,
        metadata: event.metadata,
        compressionLevel: 0,
        weight: this.calculateInitialWeight(event)
      };
      
      // Store the node
      await this.storeNode(node);
      
      // If parent exists, link nodes
      if (event.parentEventId) {
        await this.linkNodes(event.parentEventId, nodeId);
      }
      
      return nodeId;
    } catch (error) {
      logger.error('Error adding node to memory graph', {
        error: error instanceof Error ? error.message : String(error),
        agentId: event.agentId,
        strategyId: event.strategyId
      });
      throw error;
    }
  }
  
  /**
   * Link two nodes in the memory graph
   * 
   * @param parentId - The ID of the parent node
   * @param childId - The ID of the child node
   * @returns Whether linking was successful
   */
  public async linkNodes(parentId: string, childId: string): Promise<boolean> {
    try {
      // Get parent node
      const parentNode = await this.getNode(parentId);
      if (!parentNode) {
        logger.warn('Cannot link nodes: parent node not found', { parentId, childId });
        return false;
      }
      
      // Get child node
      const childNode = await this.getNode(childId);
      if (!childNode) {
        logger.warn('Cannot link nodes: child node not found', { parentId, childId });
        return false;
      }
      
      // Check if link already exists
      if (parentNode.children.includes(childId)) {
        return true; // Already linked
      }
      
      // Check if max children limit is reached
      if (parentNode.children.length >= this.config.maxChildrenPerNode) {
        logger.warn('Max children limit reached for node', { 
          parentId, 
          childCount: parentNode.children.length 
        });
        return false;
      }
      
      // Update parent node with new child
      parentNode.children.push(childId);
      await this.storeNode(parentNode);
      
      // Update child node with parent reference
      childNode.parentId = parentId;
      await this.storeNode(childNode);
      
      logger.debug('Linked memory nodes', { parentId, childId });
      return true;
    } catch (error) {
      logger.error('Error linking memory nodes', {
        error: error instanceof Error ? error.message : String(error),
        parentId,
        childId
      });
      return false;
    }
  }
  
  /**
   * Decay old paths in the memory graph to reduce the weight of old memories
   * 
   * @param agentId - The ID of the agent whose memories to decay
   * @returns Number of nodes decayed
   */
  public async decayOldPaths(agentId: string): Promise<number> {
    try {
      // Get all node IDs for this agent
      const nodeIds = await this.getAgentNodeIds(agentId);
      
      if (nodeIds.length === 0) {
        return 0;
      }
      
      let decayedCount = 0;
      const now = Date.now();
      
      // Process each node
      for (const nodeId of nodeIds) {
        const node = await this.getNode(nodeId);
        if (!node) continue;
        
        // Calculate age in days
        const daysSinceCreation = (now - node.timestamp) / (24 * 60 * 60 * 1000);
        
        // Apply decay based on age
        const decayFactor = Math.pow(this.config.memoryDecayRate, daysSinceCreation);
        
        // Update node weight
        if (node.weight !== undefined) {
          const oldWeight = node.weight;
          node.weight = oldWeight * decayFactor;
          
          // If significant change, update the node
          if (Math.abs(oldWeight - node.weight) > 0.01) {
            await this.storeNode(node);
            decayedCount++;
          }
        }
      }
      
      logger.info('Decayed memory paths', {
        agentId,
        totalNodes: nodeIds.length,
        decayedNodes: decayedCount
      });
      
      return decayedCount;
    } catch (error) {
      logger.error('Error decaying memory paths', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return 0;
    }
  }
  
  /**
   * Get context nodes from the memory graph for a specific strategy
   * 
   * @param agentId - The ID of the agent
   * @param strategyId - The ID of the strategy
   * @param options - Query options
   * @returns List of relevant memory nodes
   */
  public async getContext(
    agentId: string, 
    strategyId: string, 
    options: MemoryQueryOptions = {}
  ): Promise<MemoryGraphNode[]> {
    try {
      // Get all node IDs for this agent
      const nodeIds = await this.getAgentNodeIds(agentId);
      
      if (nodeIds.length === 0) {
        return [];
      }
      
      const contextNodes: MemoryGraphNode[] = [];
      
      // Process each node
      for (const nodeId of nodeIds) {
        const node = await this.getNode(nodeId);
        if (!node) continue;
        
        // Check if node matches strategy
        if (node.strategyId === strategyId) {
          // Check if node passes filters
          if (this.nodeMatchesFilters(node, options)) {
            contextNodes.push(node);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      contextNodes.sort((a, b) => b.timestamp - a.timestamp);
      
      // Apply limit if specified
      if (options.limit && options.limit > 0 && contextNodes.length > options.limit) {
        return contextNodes.slice(0, options.limit);
      }
      
      return contextNodes;
    } catch (error) {
      logger.error('Error getting memory context', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        strategyId
      });
      return [];
    }
  }
  
  /**
   * Get a single node from the memory graph
   * 
   * @param nodeId - The ID of the node to get
   * @returns The memory node, or null if not found
   */
  public async getNode(nodeId: string): Promise<MemoryGraphNode | null> {
    try {
      const nodeKey = `${this.config.keyPrefix}:node:${nodeId}`;
      const json = await this.redisService.get(nodeKey);
      
      if (!json) {
        return null;
      }
      
      return JSON.parse(json) as MemoryGraphNode;
    } catch (error) {
      logger.error('Error getting memory node', {
        error: error instanceof Error ? error.message : String(error),
        nodeId
      });
      return null;
    }
  }
  
  /**
   * Get all nodes for a specific agent
   * 
   * @param agentId - The ID of the agent
   * @param options - Query options
   * @returns List of memory nodes
   */
  public async getAgentNodes(
    agentId: string,
    options: MemoryQueryOptions = {}
  ): Promise<MemoryGraphNode[]> {
    try {
      // Get all node IDs for this agent
      const nodeIds = await this.getAgentNodeIds(agentId);
      
      if (nodeIds.length === 0) {
        return [];
      }
      
      const nodes: MemoryGraphNode[] = [];
      
      // Fetch each node
      for (const nodeId of nodeIds) {
        const node = await this.getNode(nodeId);
        if (node && this.nodeMatchesFilters(node, options)) {
          nodes.push(node);
        }
      }
      
      return nodes;
    } catch (error) {
      logger.error('Error getting agent nodes', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return [];
    }
  }
  
  /**
   * Delete a node from the memory graph
   * 
   * @param nodeId - The ID of the node to delete
   * @returns Whether deletion was successful
   */
  public async deleteNode(nodeId: string): Promise<boolean> {
    try {
      // Get the node first to find the agent ID and parent/children
      const node = await this.getNode(nodeId);
      
      if (!node) {
        logger.warn('Node not found for deletion', { nodeId });
        return false;
      }
      
      // Delete from Redis
      const nodeKey = `${this.config.keyPrefix}:node:${nodeId}`;
      await this.redisService.del(nodeKey);
      
      // Remove from agent's node list
      const agentNodesKey = `${this.config.keyPrefix}:agent:${node.agentId}:nodes`;
      await this.redisService.srem(agentNodesKey, nodeId);
      
      // Update parent node if exists
      if (node.parentId) {
        const parentNode = await this.getNode(node.parentId);
        if (parentNode) {
          // Remove this node from parent's children
          parentNode.children = parentNode.children.filter(id => id !== nodeId);
          await this.storeNode(parentNode);
        }
      }
      
      // Update child nodes if any
      for (const childId of node.children) {
        const childNode = await this.getNode(childId);
        if (childNode && childNode.parentId === nodeId) {
          childNode.parentId = undefined;
          await this.storeNode(childNode);
        }
      }
      
      logger.info('Deleted memory node', { nodeId, agentId: node.agentId });
      return true;
    } catch (error) {
      logger.error('Error deleting memory node', {
        error: error instanceof Error ? error.message : String(error),
        nodeId
      });
      return false;
    }
  }
  
  /**
   * Clear all memory nodes for an agent
   * 
   * @param agentId - The ID of the agent
   * @returns Number of nodes cleared
   */
  public async clearAgentMemory(agentId: string): Promise<number> {
    try {
      // Get all node IDs for this agent
      const nodeIds = await this.getAgentNodeIds(agentId);
      
      if (nodeIds.length === 0) {
        return 0;
      }
      
      // Delete each node
      for (const nodeId of nodeIds) {
        const nodeKey = `${this.config.keyPrefix}:node:${nodeId}`;
        await this.redisService.del(nodeKey);
      }
      
      // Delete the agent's node list
      const agentNodesKey = `${this.config.keyPrefix}:agent:${agentId}:nodes`;
      await this.redisService.del(agentNodesKey);
      
      logger.info('Cleared agent memory', {
        agentId,
        count: nodeIds.length
      });
      
      return nodeIds.length;
    } catch (error) {
      logger.error('Error clearing agent memory', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return 0;
    }
  }
  
  /**
   * Retrieve a memory path starting from a specific node
   * 
   * @param startNodeId - The ID of the starting node
   * @param maxDepth - Maximum path depth to traverse
   * @returns The memory path
   */
  public async getMemoryPath(startNodeId: string, maxDepth: number = 10): Promise<MemoryPath> {
    try {
      const startNode = await this.getNode(startNodeId);
      
      if (!startNode) {
        return this.createEmptyPath();
      }
      
      const path: MemoryGraphNode[] = [startNode];
      let currentNode = startNode;
      let depth = 0;
      
      // Traverse up to parent
      while (currentNode.parentId && depth < maxDepth) {
        const parentNode = await this.getNode(currentNode.parentId);
        if (!parentNode) break;
        
        path.unshift(parentNode); // Add to beginning of path
        currentNode = parentNode;
        depth++;
      }
      
      // Reset for traversing down
      currentNode = startNode;
      depth = 0;
      
      // Simple traversal: just get the highest weight child at each step
      while (currentNode.children.length > 0 && depth < maxDepth) {
        // Get all children
        const childNodes: MemoryGraphNode[] = [];
        for (const childId of currentNode.children) {
          const childNode = await this.getNode(childId);
          if (childNode) {
            childNodes.push(childNode);
          }
        }
        
        if (childNodes.length === 0) break;
        
        // Sort by weight (highest first)
        childNodes.sort((a, b) => {
          const aWeight = a.weight ?? 0;
          const bWeight = b.weight ?? 0;
          return bWeight - aWeight;
        });
        
        // Add highest weight child to path
        path.push(childNodes[0]);
        currentNode = childNodes[0];
        depth++;
      }
      
      // Calculate path metrics
      return this.calculatePathMetrics(path);
    } catch (error) {
      logger.error('Error getting memory path', {
        error: error instanceof Error ? error.message : String(error),
        startNodeId
      });
      return this.createEmptyPath();
    }
  }
  
  /**
   * Get all strategy IDs that an agent has tried
   * 
   * @param agentId - The ID of the agent
   * @returns List of unique strategy IDs
   */
  public async getTriedStrategies(agentId: string): Promise<string[]> {
    try {
      const nodes = await this.getAgentNodes(agentId);
      
      // Extract unique strategy IDs
      const strategyIds = new Set<string>();
      for (const node of nodes) {
        strategyIds.add(node.strategyId);
      }
      
      return Array.from(strategyIds);
    } catch (error) {
      logger.error('Error getting tried strategies', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return [];
    }
  }
  
  /**
   * Check if an agent has tried a specific context before
   * 
   * @param agentId - The ID of the agent
   * @param contextTags - The context tags to check
   * @param requiredMatches - Minimum number of matching tags (default: all tags)
   * @returns Whether the agent has tried the context
   */
  public async hasAgentTriedContext(
    agentId: string, 
    contextTags: string[],
    requiredMatches: number = contextTags.length
  ): Promise<boolean> {
    try {
      if (contextTags.length === 0) {
        return false;
      }
      
      const nodes = await this.getAgentNodes(agentId);
      
      // Check each node for matching context
      for (const node of nodes) {
        let matches = 0;
        
        for (const tag of contextTags) {
          if (node.contextTags.includes(tag)) {
            matches++;
          }
        }
        
        if (matches >= requiredMatches) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error checking if agent tried context', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        contextTags
      });
      return false;
    }
  }
  
  /**
   * Get the most trusted strategy path for an agent
   * 
   * @param agentId - The ID of the agent
   * @returns The most trusted memory path
   */
  public async getMostTrustedStrategyPath(agentId: string): Promise<MemoryPath> {
    try {
      const nodes = await this.getAgentNodes(agentId);
      
      if (nodes.length === 0) {
        return this.createEmptyPath();
      }
      
      // Sort by trust score (highest first)
      nodes.sort((a, b) => b.trustScore - a.trustScore);
      
      // Get path starting from most trusted node
      const path = await this.getMemoryPath(nodes[0].id);
      return path;
    } catch (error) {
      logger.error('Error getting most trusted strategy path', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return this.createEmptyPath();
    }
  }
  
  /**
   * Trace the lineage of a strategy to find its ancestry
   * 
   * @param agentId - The ID of the agent
   * @param strategyId - The ID of the strategy
   * @returns The strategy ancestry path
   */
  public async getStrategyAncestry(agentId: string, strategyId: string): Promise<MemoryPath> {
    try {
      // Get nodes related to this strategy
      const strategyNodes = await this.getContext(agentId, strategyId);
      
      if (strategyNodes.length === 0) {
        return this.createEmptyPath();
      }
      
      // Sort by timestamp (oldest first)
      strategyNodes.sort((a, b) => a.timestamp - b.timestamp);
      
      // Get full path from oldest node
      const ancestryPath = await this.getMemoryPath(strategyNodes[0].id);
      return ancestryPath;
    } catch (error) {
      logger.error('Error getting strategy ancestry', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        strategyId
      });
      return this.createEmptyPath();
    }
  }
  
  /**
   * Trace regret lineage for a strategy
   * 
   * @param agentId - The ID of the agent
   * @param strategyId - The ID of the strategy
   * @returns Nodes with regret scores for this strategy
   */
  public async traceRegretLineage(agentId: string, strategyId: string): Promise<MemoryGraphNode[]> {
    try {
      // Get nodes for this strategy
      const strategyNodes = await this.getContext(agentId, strategyId);
      
      // Filter nodes with regret scores > 0
      const regretNodes = strategyNodes.filter(node => node.regretScore > 0);
      
      // Sort by regret score (highest first)
      regretNodes.sort((a, b) => b.regretScore - a.regretScore);
      
      return regretNodes;
    } catch (error) {
      logger.error('Error tracing regret lineage', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        strategyId
      });
      return [];
    }
  }
  
  /**
   * Store a node in Redis
   * 
   * @param node - The node to store
   */
  private async storeNode(node: MemoryGraphNode): Promise<void> {
    const nodeKey = `${this.config.keyPrefix}:node:${node.id}`;
    const agentNodesKey = `${this.config.keyPrefix}:agent:${node.agentId}:nodes`;
    
    // Store the node
    await this.redisService.setex(
      nodeKey,
      Math.floor(this.config.ttlMs / 1000),
      JSON.stringify(node)
    );
    
    // Add to agent's nodes set
    await this.redisService.sadd(agentNodesKey, node.id);
    
    // Set TTL on the agent's nodes set
    await this.redisService.expire(
      agentNodesKey,
      Math.floor(this.config.ttlMs / 1000)
    );
  }
  
  /**
   * Get all node IDs for an agent
   * 
   * @param agentId - The ID of the agent
   * @returns List of node IDs
   */
  private async getAgentNodeIds(agentId: string): Promise<string[]> {
    try {
      const agentNodesKey = `${this.config.keyPrefix}:agent:${agentId}:nodes`;
      const nodeIds = await this.redisService.smembers(agentNodesKey);
      return nodeIds || [];
    } catch (error) {
      logger.error('Error getting agent node IDs', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return [];
    }
  }
  
  /**
   * Calculate initial weight for a node based on the event
   * 
   * @param event - The feedback event
   * @returns Initial weight value
   */
  private calculateInitialWeight(event: FusionFeedbackEvent): number {
    // Base weight on score and event type
    let weight = event.score;
    
    // Adjust based on event type
    switch (event.eventType) {
      case 'trust':
        weight *= 1.2; // Boost trust events
        break;
      case 'regret':
        weight *= 0.8; // Reduce regret events
        break;
      case 'reinforcement':
        weight *= 1.5; // Strongly boost reinforcement events
        break;
      default:
        // No adjustment for other types
        break;
    }
    
    return weight;
  }
  
  /**
   * Check if a node matches the specified filters
   * 
   * @param node - The node to check
   * @param filters - The filters to apply
   * @returns Whether the node matches
   */
  private nodeMatchesFilters(node: MemoryGraphNode, filters: MemoryQueryOptions): boolean {
    // Time range
    if (filters.startTime && node.timestamp < filters.startTime) {
      return false;
    }
    
    if (filters.endTime && node.timestamp > filters.endTime) {
      return false;
    }
    
    // Score filters
    if (filters.minTrustScore !== undefined && node.trustScore < filters.minTrustScore) {
      return false;
    }
    
    if (filters.minReinforcementScore !== undefined && 
        node.reinforcementScore < filters.minReinforcementScore) {
      return false;
    }
    
    if (filters.maxRegretScore !== undefined && node.regretScore > filters.maxRegretScore) {
      return false;
    }
    
    // Context tags
    if (filters.contextTags && filters.contextTags.length > 0) {
      // Check if node has all required tags
      for (const tag of filters.contextTags) {
        if (!node.contextTags.includes(tag)) {
          return false;
        }
      }
    }
    
    // Compression level
    if (filters.includeCompressed === false && 
        node.compressionLevel !== undefined && 
        node.compressionLevel > 0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Calculate metrics for a memory path
   * 
   * @param nodes - The nodes in the path
   * @returns Path metrics
   */
  private calculatePathMetrics(nodes: MemoryGraphNode[]): MemoryPath {
    let totalTrust = 0;
    let totalReinforcement = 0;
    let totalRegret = 0;
    let totalWeight = 0;
    
    for (const node of nodes) {
      totalTrust += node.trustScore;
      totalReinforcement += node.reinforcementScore;
      totalRegret += node.regretScore;
      totalWeight += node.weight ?? 0;
    }
    
    // Calculate context similarity (percentage of shared tags)
    let contextSimilarity = 1;
    if (nodes.length > 1) {
      const allTags = new Set<string>();
      const tagCounts: Record<string, number> = {};
      
      // Count all tags
      for (const node of nodes) {
        for (const tag of node.contextTags) {
          allTags.add(tag);
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
      
      // Calculate average occurrence
      let totalOccurrences = 0;
      for (const tag of allTags) {
        totalOccurrences += tagCounts[tag] || 0;
      }
      
      // Similarity is average occurrences divided by max possible (nodes.length)
      contextSimilarity = totalOccurrences / (allTags.size * nodes.length);
    }
    
    return {
      nodes,
      totalTrust,
      totalReinforcement,
      totalRegret,
      averageWeight: nodes.length > 0 ? totalWeight / nodes.length : 0,
      contextSimilarity
    };
  }
  
  /**
   * Create an empty memory path
   * 
   * @returns Empty path
   */
  private createEmptyPath(): MemoryPath {
    return {
      nodes: [],
      totalTrust: 0,
      totalReinforcement: 0,
      totalRegret: 0,
      averageWeight: 0,
      contextSimilarity: 0
    };
  }
} 