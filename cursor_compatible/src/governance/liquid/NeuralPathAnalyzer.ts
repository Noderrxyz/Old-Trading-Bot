/**
 * Neural Path Analyzer
 * 
 * Analyzes influence paths between agents in the governance network,
 * creating a neural map of influence and trust.
 */

import { FileSystemService } from '../../services/FileSystemService.js';
import { RedisClient } from '../../common/redis.js';
import {
  AgentID,
  ProposalID,
  NeuralInfluencePath,
  LiquidVote,
  VoteDelegation
} from '../../types/governance-liquid.types.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('NeuralPathAnalyzer');

/**
 * Agent node in the neural trust network
 */
interface AgentNode {
  id: AgentID;
  trustScore: number;
  connections: {
    targetId: AgentID;
    strength: number;
    type: 'direct' | 'delegated' | 'trust' | 'social';
  }[];
  totalInfluence: number;
}

export class NeuralPathAnalyzer {
  private fs: FileSystemService;
  private redisClient: RedisClient;
  private configPath: string = 'src/data/governance/liquid/neural_quorum.config.json';
  
  // Cache of agent nodes
  private agentNodes: Map<AgentID, AgentNode> = new Map();
  
  // Cache of neural paths
  private neuralPaths: Map<string, NeuralInfluencePath> = new Map();
  
  // Configuration
  private config: any;
  
  constructor(redisClient: RedisClient, fs?: FileSystemService) {
    this.redisClient = redisClient;
    this.fs = fs || new FileSystemService();
    
    // Initialize
    this.initialize();
  }
  
  /**
   * Initialize the analyzer
   */
  private async initialize(): Promise<void> {
    await this.loadConfiguration();
  }
  
  /**
   * Load configuration
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const configData = await this.fs.readFile(this.configPath);
      if (configData) {
        this.config = JSON.parse(configData);
      } else {
        logger.warn(`Configuration file not found at ${this.configPath}`);
        this.config = this.getDefaultConfig();
      }
    } catch (error: any) {
      logger.error(`Failed to load configuration: ${error.message}`);
      this.config = this.getDefaultConfig();
    }
  }
  
  /**
   * Get default configuration
   */
  private getDefaultConfig(): any {
    return {
      trustScoreWeight: 0.4,
      delegationWeight: 0.3,
      socialWeight: 0.2,
      directWeight: 0.1,
      minInfluenceThreshold: 0.05,
      maxInfluenceDepth: 3,
      influenceDecayRate: 0.3
    };
  }
  
  /**
   * Build a neural influence map for a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Map of agent influence strengths
   */
  public async buildNeuralInfluenceMap(proposalId: ProposalID): Promise<Record<AgentID, number>> {
    // Reset caches
    this.agentNodes.clear();
    this.neuralPaths.clear();
    
    // Step 1: Load all votes and delegations for this proposal
    const votes = await this.getVotesForProposal(proposalId);
    const delegations = await this.getDelegationsForProposal(proposalId);
    
    // Step 2: Create agent nodes
    await this.createAgentNodes(votes, delegations);
    
    // Step 3: Analyze connections between agents
    await this.analyzeConnections(proposalId);
    
    // Step 4: Calculate influence propagation
    const influenceMap = await this.calculateInfluencePropagation(proposalId);
    
    // Step 5: Store paths for later analysis
    await this.storeNeuralPaths(proposalId);
    
    return influenceMap;
  }
  
  /**
   * Get all votes for a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Array of votes
   */
  private async getVotesForProposal(proposalId: ProposalID): Promise<LiquidVote[]> {
    try {
      const votesData = await this.redisClient.get(`governance:liquid:votes:${proposalId}`);
      if (votesData) {
        return JSON.parse(votesData);
      }
    } catch (error: any) {
      logger.error(`Error getting votes for proposal ${proposalId}: ${error.message}`);
    }
    
    return [];
  }
  
  /**
   * Get all delegations for a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Array of delegations
   */
  private async getDelegationsForProposal(proposalId: ProposalID): Promise<VoteDelegation[]> {
    try {
      const delegationsData = await this.redisClient.get(`governance:liquid:delegations:${proposalId}`);
      if (delegationsData) {
        return JSON.parse(delegationsData);
      }
    } catch (error: any) {
      logger.error(`Error getting delegations for proposal ${proposalId}: ${error.message}`);
    }
    
    return [];
  }
  
  /**
   * Create agent nodes from votes and delegations
   * 
   * @param votes Array of votes
   * @param delegations Array of delegations
   */
  private async createAgentNodes(votes: LiquidVote[], delegations: VoteDelegation[]): Promise<void> {
    // Get unique agent IDs from votes and delegations
    const agentIds = new Set<AgentID>();
    
    votes.forEach(vote => {
      agentIds.add(vote.agentId);
      if (vote.delegatedTo) {
        agentIds.add(vote.delegatedTo);
      }
    });
    
    delegations.forEach(delegation => {
      agentIds.add(delegation.fromAgent);
      agentIds.add(delegation.toAgent);
    });
    
    // Create nodes for each agent
    for (const agentId of agentIds) {
      const trustScore = await this.getAgentTrustScore(agentId);
      
      this.agentNodes.set(agentId, {
        id: agentId,
        trustScore,
        connections: [],
        totalInfluence: 0
      });
    }
  }
  
  /**
   * Get an agent's trust score
   * 
   * @param agentId Agent ID
   * @returns Trust score (0-1)
   */
  private async getAgentTrustScore(agentId: AgentID): Promise<number> {
    try {
      const trustScore = await this.redisClient.get(`agent:${agentId}:trust_score`);
      if (trustScore) {
        return Math.min(Math.max(parseFloat(trustScore), 0), 1);
      }
    } catch (error) {
      logger.error(`Error getting trust score for agent ${agentId}: ${error}`);
    }
    
    return 0.5; // Default trust score
  }
  
  /**
   * Analyze connections between agents
   * 
   * @param proposalId Proposal ID for context
   */
  private async analyzeConnections(proposalId: ProposalID): Promise<void> {
    // Step 1: Analyze delegation connections
    const delegations = await this.getDelegationsForProposal(proposalId);
    
    for (const delegation of delegations) {
      if (!delegation.active) continue;
      
      const sourceNode = this.agentNodes.get(delegation.fromAgent);
      const targetNode = this.agentNodes.get(delegation.toAgent);
      
      if (sourceNode && targetNode) {
        // Add delegation connection
        sourceNode.connections.push({
          targetId: delegation.toAgent,
          strength: delegation.weight,
          type: 'delegated'
        });
        
        // Store the neural path
        const pathKey = `${delegation.fromAgent}:${delegation.toAgent}:delegated`;
        this.neuralPaths.set(pathKey, {
          sourceAgent: delegation.fromAgent,
          targetAgent: delegation.toAgent,
          strength: delegation.weight,
          type: 'delegated',
          updatedAt: Date.now()
        });
      }
    }
    
    // Step 2: Analyze trust-based connections
    for (const [sourceId, sourceNode] of this.agentNodes.entries()) {
      for (const [targetId, targetNode] of this.agentNodes.entries()) {
        if (sourceId === targetId) continue;
        
        // Calculate trust-based connection strength
        const trustStrength = await this.calculateTrustStrength(sourceId, targetId);
        
        if (trustStrength > this.config.minInfluenceThreshold) {
          // Add trust connection
          sourceNode.connections.push({
            targetId,
            strength: trustStrength,
            type: 'trust'
          });
          
          // Store the neural path
          const pathKey = `${sourceId}:${targetId}:trust`;
          this.neuralPaths.set(pathKey, {
            sourceAgent: sourceId,
            targetAgent: targetId,
            strength: trustStrength,
            type: 'trust',
            updatedAt: Date.now()
          });
        }
      }
    }
    
    // Step 3: Analyze social connections (agents that frequently interact)
    await this.analyzeSocialConnections();
    
    // Step 4: Analyze direct connections (agents that directly voted the same way)
    await this.analyzeDirectConnections(proposalId);
  }
  
  /**
   * Calculate trust strength between two agents
   * 
   * @param sourceId Source agent ID
   * @param targetId Target agent ID
   * @returns Trust strength (0-1)
   */
  private async calculateTrustStrength(sourceId: AgentID, targetId: AgentID): Promise<number> {
    try {
      // Look for direct trust relationship
      const trustData = await this.redisClient.get(`agent:${sourceId}:trust:${targetId}`);
      if (trustData) {
        return parseFloat(trustData);
      }
      
      // If no direct relationship, calculate from trust scores
      const sourceNode = this.agentNodes.get(sourceId);
      const targetNode = this.agentNodes.get(targetId);
      
      if (sourceNode && targetNode) {
        // Simple trust similarity measure
        const trustDifference = Math.abs(sourceNode.trustScore - targetNode.trustScore);
        return Math.max(0, 1 - trustDifference);
      }
    } catch (error: any) {
      logger.error(`Error calculating trust strength: ${error.message}`);
    }
    
    return 0;
  }
  
  /**
   * Analyze social connections between agents
   */
  private async analyzeSocialConnections(): Promise<void> {
    try {
      // This would analyze historical interactions between agents
      // For now, we'll use a simple placeholder implementation
      
      // In a real implementation, this would:
      // 1. Analyze transaction history between agents
      // 2. Check communication patterns
      // 3. Look at shared governance participation
      
      for (const [sourceId, sourceNode] of this.agentNodes.entries()) {
        for (const [targetId, targetNode] of this.agentNodes.entries()) {
          if (sourceId === targetId) continue;
          
          // For demo purposes, create a random social connection
          if (Math.random() < 0.3) {
            const strength = 0.1 + (Math.random() * 0.3); // 0.1-0.4 range
            
            if (strength > this.config.minInfluenceThreshold) {
              // Add social connection
              sourceNode.connections.push({
                targetId,
                strength,
                type: 'social'
              });
              
              // Store the neural path
              const pathKey = `${sourceId}:${targetId}:social`;
              this.neuralPaths.set(pathKey, {
                sourceAgent: sourceId,
                targetAgent: targetId,
                strength,
                type: 'social',
                updatedAt: Date.now()
              });
            }
          }
        }
      }
    } catch (error: any) {
      logger.error(`Error analyzing social connections: ${error.message}`);
    }
  }
  
  /**
   * Analyze direct connections between agents based on voting patterns
   * 
   * @param proposalId Current proposal ID
   */
  private async analyzeDirectConnections(proposalId: ProposalID): Promise<void> {
    try {
      // Get historical voting data
      const voteHistoryData = await this.redisClient.get('governance:liquid:vote_history');
      if (!voteHistoryData) return;
      
      const voteHistory = JSON.parse(voteHistoryData);
      
      for (const [sourceId, sourceNode] of this.agentNodes.entries()) {
        for (const [targetId, targetNode] of this.agentNodes.entries()) {
          if (sourceId === targetId) continue;
          
          // Calculate how often these agents voted the same way
          let sameVotes = 0;
          let totalCommonVotes = 0;
          
          for (const pastProposalId in voteHistory) {
            if (pastProposalId === proposalId) continue; // Skip current proposal
            
            const proposalVotes = voteHistory[pastProposalId];
            const sourceVote = proposalVotes[sourceId];
            const targetVote = proposalVotes[targetId];
            
            if (sourceVote && targetVote) {
              totalCommonVotes++;
              if (sourceVote.vote === targetVote.vote) {
                sameVotes++;
              }
            }
          }
          
          if (totalCommonVotes > 0) {
            const strength = sameVotes / totalCommonVotes;
            
            if (strength > this.config.minInfluenceThreshold) {
              // Add direct connection
              sourceNode.connections.push({
                targetId,
                strength,
                type: 'direct'
              });
              
              // Store the neural path
              const pathKey = `${sourceId}:${targetId}:direct`;
              this.neuralPaths.set(pathKey, {
                sourceAgent: sourceId,
                targetAgent: targetId,
                strength,
                type: 'direct',
                updatedAt: Date.now()
              });
            }
          }
        }
      }
    } catch (error: any) {
      logger.error(`Error analyzing direct connections: ${error.message}`);
    }
  }
  
  /**
   * Calculate influence propagation through the network
   * 
   * @param proposalId Proposal ID
   * @returns Map of agent influence strengths
   */
  private async calculateInfluencePropagation(proposalId: ProposalID): Promise<Record<AgentID, number>> {
    const influenceMap: Record<AgentID, number> = {};
    
    // Set initial influence based on trust scores
    for (const [agentId, node] of this.agentNodes.entries()) {
      influenceMap[agentId] = node.trustScore;
    }
    
    // Propagate influence through the network
    const maxDepth = this.config.maxInfluenceDepth || 3;
    const decayRate = this.config.influenceDecayRate || 0.3;
    
    // Propagate multiple times to allow influence to flow through the network
    for (let depth = 0; depth < maxDepth; depth++) {
      const newInfluence: Record<AgentID, number> = { ...influenceMap };
      
      // For each agent
      for (const [agentId, node] of this.agentNodes.entries()) {
        // For each connection from this agent
        for (const connection of node.connections) {
          // Calculate influence flow
          const flowStrength = influenceMap[agentId] * connection.strength * (1 - decayRate * depth);
          
          // Add to target's influence
          newInfluence[connection.targetId] = (newInfluence[connection.targetId] || 0) + flowStrength;
        }
      }
      
      // Update influence map for next iteration
      for (const agentId in newInfluence) {
        influenceMap[agentId] = newInfluence[agentId];
      }
    }
    
    // Normalize influence values
    let totalInfluence = 0;
    for (const influence of Object.values(influenceMap)) {
      totalInfluence += influence;
    }
    
    if (totalInfluence > 0) {
      for (const agentId in influenceMap) {
        influenceMap[agentId] = influenceMap[agentId] / totalInfluence;
        
        // Update the node's total influence
        const node = this.agentNodes.get(agentId);
        if (node) {
          node.totalInfluence = influenceMap[agentId];
        }
      }
    }
    
    return influenceMap;
  }
  
  /**
   * Store neural paths for later analysis
   * 
   * @param proposalId Proposal ID
   */
  private async storeNeuralPaths(proposalId: ProposalID): Promise<void> {
    try {
      // Convert paths to array
      const paths = Array.from(this.neuralPaths.values());
      
      // Store in Redis
      await this.redisClient.set(
        `governance:liquid:neural_paths:${proposalId}`,
        JSON.stringify(paths)
      );
      
      // Store influence map
      const influenceMap: Record<AgentID, number> = {};
      for (const [agentId, node] of this.agentNodes.entries()) {
        influenceMap[agentId] = node.totalInfluence;
      }
      
      await this.redisClient.set(
        `governance:liquid:influence_map:${proposalId}`,
        JSON.stringify(influenceMap)
      );
    } catch (error: any) {
      logger.error(`Error storing neural paths: ${error.message}`);
    }
  }
  
  /**
   * Get the neural influence map for a proposal
   * 
   * @param proposalId Proposal ID
   * @returns The neural influence map
   */
  public async getNeuralInfluenceMap(proposalId: ProposalID): Promise<Record<AgentID, number>> {
    try {
      const mapData = await this.redisClient.get(`governance:liquid:influence_map:${proposalId}`);
      if (mapData) {
        return JSON.parse(mapData);
      }
    } catch (error: any) {
      logger.error(`Error getting neural influence map: ${error.message}`);
    }
    
    // If no map exists, build a new one
    return this.buildNeuralInfluenceMap(proposalId);
  }
  
  /**
   * Get all neural paths for a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Array of neural paths
   */
  public async getNeuralPaths(proposalId: ProposalID): Promise<NeuralInfluencePath[]> {
    try {
      const pathsData = await this.redisClient.get(`governance:liquid:neural_paths:${proposalId}`);
      if (pathsData) {
        return JSON.parse(pathsData);
      }
    } catch (error: any) {
      logger.error(`Error getting neural paths: ${error.message}`);
    }
    
    return [];
  }
  
  /**
   * Refresh the neural paths for a proposal
   * 
   * @param proposalId Proposal ID
   */
  public async refreshNeuralPaths(proposalId: ProposalID): Promise<void> {
    await this.buildNeuralInfluenceMap(proposalId);
  }
} 