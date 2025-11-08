// @ts-ignore
import Logger from '@noderr/logger';
import { RedisService } from '../redis/RedisService.js';
import { AgentReinforcementService } from './AgentReinforcementService.js';
import { TrustScoreService } from '../agent/TrustScoreService.js';
import { ReinforcementVote } from '../../types/metaAgent.types.js';

/**
 * Agent cluster representing groups of agents with mutual reinforcement
 */
interface AgentCluster {
  id: string;
  members: string[];
  averageAgreement: number;
  density: number; // Connections / possible connections
  dominantContexts: string[];
}

/**
 * Graph representation of agent reinforcement relationships
 */
interface ReinforcementGraph {
  nodes: {
    id: string;
    trust: number;
    reinforcementScore: number;
    clusterIds: string[];
  }[];
  edges: {
    source: string;
    target: string;
    strength: number;
    contextType: string;
    timestamp: number;
  }[];
  clusters: AgentCluster[];
}

/**
 * Service for analyzing reinforcement patterns between agents
 * and generating graph representations of agent interactions
 */
export class ReinforcementAnalyzer {
  private logger = new Logger('ReinforcementAnalyzer');
  private redisKeyAnalytics = 'noderr:agent-reinforcement:analytics';
  private redisKeyGraph = 'noderr:agent-reinforcement:graph';
  private redisKeyCluster = 'noderr:agent-reinforcement:clusters';

  constructor(
    private redisService: RedisService,
    private reinforcementService: AgentReinforcementService,
    private trustScoreService: TrustScoreService
  ) {
    // Schedule periodic graph generation
    this.scheduleGraphGeneration();
  }

  /**
   * Generate a complete reinforcement graph of all active agents
   * 
   * @param minTrustScore Minimum trust score for agents to include
   * @param maxAgents Maximum number of agents to include
   * @returns The complete reinforcement graph
   */
  public async generateReinforcementGraph(
    minTrustScore = 50,
    maxAgents = 100
  ): Promise<ReinforcementGraph> {
    // Get all agents with sufficient trust
    const allAgentKeys = await this.redisService.keys('noderr:agent:*');
    const eligibleAgents: string[] = [];
    
    for (const key of allAgentKeys) {
      const agentId = key.split(':')[2];
      
      if (!agentId) continue;
      
      const trustScore = await this.trustScoreService.getAgentTrustScore(agentId);
      if (trustScore >= minTrustScore) {
        eligibleAgents.push(agentId);
        
        if (eligibleAgents.length >= maxAgents) break;
      }
    }
    
    const nodes: ReinforcementGraph['nodes'] = [];
    const edges: ReinforcementGraph['edges'] = [];
    
    // Create graph nodes for each agent
    for (const agentId of eligibleAgents) {
      const trust = await this.trustScoreService.getAgentTrustScore(agentId);
      const reinforcement = await this.reinforcementService.calculateAgentReinforcement(agentId);
      
      nodes.push({
        id: agentId,
        trust,
        reinforcementScore: reinforcement.score,
        clusterIds: [] // Will be populated after clustering
      });
    }
    
    // Create graph edges for reinforcement votes
    for (const sourceAgentId of eligibleAgents) {
      for (const targetAgentId of eligibleAgents) {
        if (sourceAgentId === targetAgentId) continue;
        
        const agreement = await this.reinforcementService.getAgentAgreement(sourceAgentId, targetAgentId);
        
        if (agreement && agreement > 0.4) { // Only include meaningful relationships
          edges.push({
            source: sourceAgentId,
            target: targetAgentId,
            strength: agreement,
            contextType: 'agreement', // Using general agreement as the context type
            timestamp: Date.now()
          });
        }
      }
    }
    
    // Identify clusters using a basic clustering algorithm
    const clusters = await this.identifyClusters(nodes, edges);
    
    // Assign cluster IDs to nodes
    for (const cluster of clusters) {
      for (const memberId of cluster.members) {
        const node = nodes.find(n => n.id === memberId);
        if (node) {
          node.clusterIds.push(cluster.id);
        }
      }
    }
    
    const graph: ReinforcementGraph = {
      nodes,
      edges,
      clusters
    };
    
    // Store the graph for later retrieval
    await this.storeReinforcementGraph(graph);
    
    return graph;
  }

  /**
   * Get the stored reinforcement graph or generate a new one if needed
   * 
   * @returns The reinforcement graph
   */
  public async getReinforcementGraph(): Promise<ReinforcementGraph | null> {
    const storedGraph = await this.redisService.get(`${this.redisKeyGraph}:latest`);
    
    if (storedGraph) {
      try {
        return JSON.parse(storedGraph);
      } catch (error) {
        this.logger.error('Error parsing stored reinforcement graph', { error });
      }
    }
    
    // Generate a new graph if none exists
    return this.generateReinforcementGraph();
  }

  /**
   * Find agents that would benefit from mutual reinforcement
   * 
   * @param agentId The agent to find potential collaborators for
   * @param threshold Minimum similarity threshold
   * @returns Array of recommended agent IDs for collaboration
   */
  public async findReinforcementCandidates(
    agentId: string,
    threshold = 0.6
  ): Promise<string[]> {
    // Get the agent's high agreement partners
    const directPartners = await this.reinforcementService.findHighAgreementAgents(agentId, threshold);
    
    // Find second-degree connections (partners of partners)
    const secondDegreePartners = new Set<string>();
    
    for (const partnerId of directPartners) {
      const partnerPartners = await this.reinforcementService.findHighAgreementAgents(partnerId, threshold);
      
      for (const secondDegreeId of partnerPartners) {
        // Don't include the original agent or direct partners
        if (secondDegreeId !== agentId && !directPartners.includes(secondDegreeId)) {
          secondDegreePartners.add(secondDegreeId);
        }
      }
    }
    
    // For each second-degree partner, calculate potential agreement
    const potentialPartners: Array<{id: string, score: number}> = [];
    
    for (const candidateId of secondDegreePartners) {
      let totalScore = 0;
      let count = 0;
      
      // Average the agreement scores through the mutual connections
      for (const partnerId of directPartners) {
        const partnerToCandidate = await this.reinforcementService.getAgentAgreement(partnerId, candidateId);
        
        if (partnerToCandidate !== null) {
          totalScore += partnerToCandidate;
          count++;
        }
      }
      
      if (count > 0) {
        const averageScore = totalScore / count;
        
        if (averageScore >= threshold) {
          potentialPartners.push({
            id: candidateId,
            score: averageScore
          });
        }
      }
    }
    
    // Sort by score and return IDs
    return potentialPartners
      .sort((a, b) => b.score - a.score)
      .map(p => p.id);
  }

  /**
   * Identify clusters of closely cooperating agents
   * 
   * @param nodes Graph nodes representing agents
   * @param edges Graph edges representing reinforcement relationships
   * @returns Array of identified agent clusters
   */
  private async identifyClusters(
    nodes: ReinforcementGraph['nodes'],
    edges: ReinforcementGraph['edges']
  ): Promise<AgentCluster[]> {
    const clusters: AgentCluster[] = [];
    
    // Use a simple community detection algorithm based on edge strength
    // This is a basic implementation - a more sophisticated algorithm could be used
    
    // Create adjacency map
    const adjacencyMap = new Map<string, Map<string, number>>();
    
    for (const node of nodes) {
      adjacencyMap.set(node.id, new Map());
    }
    
    for (const edge of edges) {
      const sourceMap = adjacencyMap.get(edge.source);
      if (sourceMap) {
        sourceMap.set(edge.target, edge.strength);
      }
    }
    
    // Find densely connected subgraphs using a greedy approach
    const unassigned = new Set(nodes.map(n => n.id));
    let clusterId = 0;
    
    while (unassigned.size > 0) {
      // Start with the node that has the most connections
      let seed: string | null = null;
      let maxConnections = 0;
      
      for (const nodeId of unassigned) {
        const connections = adjacencyMap.get(nodeId);
        if (connections && connections.size > maxConnections) {
          seed = nodeId;
          maxConnections = connections.size;
        }
      }
      
      if (!seed || maxConnections === 0) {
        // No more connected nodes, add remaining as individual clusters
        for (const nodeId of unassigned) {
          clusters.push({
            id: `cluster-${clusterId++}`,
            members: [nodeId],
            averageAgreement: 0,
            density: 0,
            dominantContexts: []
          });
          unassigned.delete(nodeId);
        }
        break;
      }
      
      // Grow the cluster from the seed
      const clusterMembers = new Set<string>([seed]);
      let totalAgreement = 0;
      let agreementCount = 0;
      
      // Add strongly connected neighbors
      const frontier = [seed];
      while (frontier.length > 0) {
        const current = frontier.shift()!;
        const connections = adjacencyMap.get(current);
        
        if (!connections) continue;
        
        for (const [neighbor, strength] of connections.entries()) {
          if (strength >= 0.7 && unassigned.has(neighbor)) {
            clusterMembers.add(neighbor);
            unassigned.delete(neighbor);
            frontier.push(neighbor);
            
            totalAgreement += strength;
            agreementCount++;
          }
        }
      }
      
      // Calculate cluster metrics
      const averageAgreement = agreementCount > 0 ? totalAgreement / agreementCount : 0;
      const memberArray = Array.from(clusterMembers);
      
      // Calculate density (connections / possible connections)
      const possibleConnections = memberArray.length * (memberArray.length - 1) / 2;
      let actualConnections = 0;
      
      for (let i = 0; i < memberArray.length; i++) {
        for (let j = i + 1; j < memberArray.length; j++) {
          const connections = adjacencyMap.get(memberArray[i]);
          if (connections && connections.has(memberArray[j])) {
            actualConnections++;
          }
        }
      }
      
      const density = possibleConnections > 0 ? actualConnections / possibleConnections : 0;
      
      // Find dominant contexts
      const contextCounts = new Map<string, number>();
      
      for (const edge of edges) {
        if (clusterMembers.has(edge.source) && clusterMembers.has(edge.target)) {
          const count = contextCounts.get(edge.contextType) || 0;
          contextCounts.set(edge.contextType, count + 1);
        }
      }
      
      const dominantContexts = Array.from(contextCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([context]) => context);
      
      // Create the cluster
      clusters.push({
        id: `cluster-${clusterId++}`,
        members: memberArray,
        averageAgreement,
        density,
        dominantContexts
      });
      
      // Remove assigned nodes from unassigned
      for (const member of clusterMembers) {
        unassigned.delete(member);
      }
    }
    
    // Store the clusters for later analysis
    await this.storeClusters(clusters);
    
    return clusters;
  }

  /**
   * Calculate influence metrics for agents based on their reinforcement patterns
   * 
   * @returns Object mapping agent IDs to influence scores
   */
  public async calculateInfluenceMetrics(): Promise<Record<string, number>> {
    const graph = await this.getReinforcementGraph();
    
    if (!graph) {
      return {};
    }
    
    const influence: Record<string, number> = {};
    
    // Calculate influence based on incoming edges (weighted by source trust)
    for (const node of graph.nodes) {
      // Start with base influence from trust
      influence[node.id] = node.trust / 200; // Scale 0-100 trust to 0-0.5 base influence
    }
    
    // Add influence from reinforcement connections
    for (const edge of graph.edges) {
      // Receiving reinforcement increases influence
      const currentInfluence = influence[edge.target] || 0;
      const sourceTrust = graph.nodes.find(n => n.id === edge.source)?.trust || 0;
      
      // Weight by source trust and edge strength
      const additionalInfluence = (sourceTrust / 100) * edge.strength * 0.01;
      
      influence[edge.target] = currentInfluence + additionalInfluence;
    }
    
    // Normalize influence to 0-1 range
    const maxInfluence = Math.max(...Object.values(influence));
    
    if (maxInfluence > 0) {
      for (const agentId in influence) {
        influence[agentId] /= maxInfluence;
      }
    }
    
    // Store influence metrics
    await this.redisService.set(
      `${this.redisKeyAnalytics}:influence`,
      JSON.stringify(influence)
    );
    
    return influence;
  }

  /**
   * Store the reinforcement graph in Redis
   * 
   * @param graph The reinforcement graph to store
   */
  private async storeReinforcementGraph(graph: ReinforcementGraph): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // Store latest graph
      await this.redisService.set(
        `${this.redisKeyGraph}:latest`,
        JSON.stringify(graph)
      );
      
      // Store timestamped version for history
      await this.redisService.set(
        `${this.redisKeyGraph}:${timestamp}`,
        JSON.stringify(graph)
      );
      
      // Set expiry for historical graphs (keep for 30 days)
      await this.redisService.expire(
        `${this.redisKeyGraph}:${timestamp}`,
        30 * 24 * 60 * 60 // 30 days
      );
      
      this.logger.info('Stored reinforcement graph', {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        clusters: graph.clusters.length
      });
    } catch (error) {
      this.logger.error('Error storing reinforcement graph', { error });
    }
  }

  /**
   * Store clusters for analysis
   * 
   * @param clusters Array of agent clusters
   */
  private async storeClusters(clusters: AgentCluster[]): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // Store latest clusters
      await this.redisService.set(
        `${this.redisKeyCluster}:latest`,
        JSON.stringify(clusters)
      );
      
      // Store timestamped version for history
      await this.redisService.set(
        `${this.redisKeyCluster}:${timestamp}`,
        JSON.stringify(clusters)
      );
      
      // Set expiry for historical clusters (keep for 30 days)
      await this.redisService.expire(
        `${this.redisKeyCluster}:${timestamp}`,
        30 * 24 * 60 * 60 // 30 days
      );
    } catch (error) {
      this.logger.error('Error storing agent clusters', { error });
    }
  }

  /**
   * Schedule periodic graph generation
   */
  private scheduleGraphGeneration(): void {
    // Generate graph every 6 hours
    setInterval(async () => {
      try {
        await this.generateReinforcementGraph();
        await this.calculateInfluenceMetrics();
      } catch (error) {
        this.logger.error('Error in scheduled graph generation', { error });
      }
    }, 6 * 60 * 60 * 1000); // 6 hours
  }
} 