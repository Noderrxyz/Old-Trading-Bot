/**
 * MemoryQuery Service
 * 
 * Provides specialized query capabilities for the agent memory graph.
 * Enables complex historical tracing, pattern finding, and sophisticated lookups
 * beyond the basic capabilities of the MemoryGraph service.
 */

import { RedisService } from '../infrastructure/RedisService.js';
import { MemoryGraph } from './MemoryGraph.js';
import {
  MemoryGraphNode,
  MemoryQueryOptions,
  MemoryPath
} from '../../types/memory.types.js';
import logger from '../../utils/logger.js';

/**
 * MemoryQuery service for advanced memory graph queries
 */
export class MemoryQuery {
  private redisService: RedisService;
  private memoryGraph: MemoryGraph;
  
  /**
   * Creates a new MemoryQuery instance
   * 
   * @param redisService - Redis service for data persistence
   * @param memoryGraph - Memory graph service
   */
  constructor(
    redisService: RedisService,
    memoryGraph: MemoryGraph
  ) {
    this.redisService = redisService;
    this.memoryGraph = memoryGraph;
    
    logger.info('MemoryQuery service initialized');
  }
  
  /**
   * Find the most trusted strategy path for an agent
   * 
   * @param agentId - The ID of the agent
   * @returns The most trusted memory path
   */
  public async getMostTrustedStrategyPath(agentId: string): Promise<MemoryPath> {
    return this.memoryGraph.getMostTrustedStrategyPath(agentId);
  }
  
  /**
   * Trace the ancestry lineage of a strategy
   * 
   * @param agentId - The ID of the agent
   * @param strategyId - The ID of the strategy
   * @returns The strategy ancestry path
   */
  public async getStrategyAncestry(agentId: string, strategyId: string): Promise<MemoryPath> {
    return this.memoryGraph.getStrategyAncestry(agentId, strategyId);
  }
  
  /**
   * Trace the regret lineage for a strategy
   * 
   * @param agentId - The ID of the agent
   * @param strategyId - The ID of the strategy
   * @returns Array of nodes with regret, sorted by regret score
   */
  public async traceRegretLineage(agentId: string, strategyId: string): Promise<MemoryGraphNode[]> {
    return this.memoryGraph.traceRegretLineage(agentId, strategyId);
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
    requiredMatches?: number
  ): Promise<boolean> {
    return this.memoryGraph.hasAgentTriedContext(agentId, contextTags, requiredMatches);
  }
  
  /**
   * Get all strategies an agent has tried
   * 
   * @param agentId - The ID of the agent
   * @returns Array of unique strategy IDs
   */
  public async getTriedStrategies(agentId: string): Promise<string[]> {
    return this.memoryGraph.getTriedStrategies(agentId);
  }
  
  /**
   * Find similar historical contexts to the current context
   * 
   * @param agentId - The ID of the agent
   * @param contextTags - The current context tags
   * @param minSimilarity - Minimum similarity threshold (0-1)
   * @param limit - Maximum number of results
   * @returns Array of similar nodes with similarity scores
   */
  public async findSimilarContexts(
    agentId: string,
    contextTags: string[],
    minSimilarity: number = 0.6,
    limit: number = 5
  ): Promise<Array<{ node: MemoryGraphNode; similarity: number }>> {
    try {
      // Get all nodes for the agent
      const nodes = await this.memoryGraph.getAgentNodes(agentId);
      
      if (nodes.length === 0 || contextTags.length === 0) {
        return [];
      }
      
      // Calculate similarity for each node
      const nodeSimilarities = nodes.map(node => {
        const similarity = this.calculateContextSimilarity(contextTags, node.contextTags);
        return { node, similarity };
      });
      
      // Filter by minimum similarity and sort
      return nodeSimilarities
        .filter(item => item.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      logger.error('Error finding similar contexts', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        contextTags
      });
      return [];
    }
  }
  
  /**
   * Find the most successful strategies for a given context
   * 
   * @param agentId - The ID of the agent
   * @param contextTags - The context tags to match
   * @param limit - Maximum number of results
   * @returns Array of strategy IDs with success scores
   */
  public async findSuccessfulStrategies(
    agentId: string,
    contextTags: string[],
    limit: number = 3
  ): Promise<Array<{ strategyId: string; score: number }>> {
    try {
      // Find similar contexts first
      const similarContexts = await this.findSimilarContexts(
        agentId,
        contextTags,
        0.5, // Lower threshold to get more candidates
        20  // Get more candidates to aggregate
      );
      
      if (similarContexts.length === 0) {
        return [];
      }
      
      // Group by strategy and calculate success score
      const strategyScores: Record<string, { count: number; totalScore: number }> = {};
      
      for (const { node, similarity } of similarContexts) {
        // Skip strategies with high regret
        if (node.regretScore > 0.6) {
          continue;
        }
        
        // Calculate success score: trust * reinforcement * (1 - regret) * similarity
        const successScore = node.trustScore * 
                            node.reinforcementScore * 
                            (1 - node.regretScore) *
                            similarity;
        
        if (!strategyScores[node.strategyId]) {
          strategyScores[node.strategyId] = { count: 0, totalScore: 0 };
        }
        
        strategyScores[node.strategyId].count++;
        strategyScores[node.strategyId].totalScore += successScore;
      }
      
      // Convert to array and calculate average score
      const result = Object.entries(strategyScores).map(([strategyId, data]) => ({
        strategyId,
        score: data.totalScore / data.count
      }));
      
      // Sort by score (highest first) and limit results
      return result
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      logger.error('Error finding successful strategies', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        contextTags
      });
      return [];
    }
  }
  
  /**
   * Analyze common patterns in agent memory
   * 
   * @param agentId - The ID of the agent
   * @returns Analysis of patterns in agent memory
   */
  public async analyzeMemoryPatterns(agentId: string): Promise<{
    frequentContextTags: Array<{ tag: string; count: number }>;
    topStrategies: Array<{ strategyId: string; count: number }>;
    regretDistribution: Array<{ range: string; count: number }>;
    trustDistribution: Array<{ range: string; count: number }>;
  }> {
    try {
      // Get all nodes for the agent
      const nodes = await this.memoryGraph.getAgentNodes(agentId);
      
      if (nodes.length === 0) {
        return {
          frequentContextTags: [],
          topStrategies: [],
          regretDistribution: [],
          trustDistribution: []
        };
      }
      
      // Analyze context tags
      const tagCounts: Record<string, number> = {};
      for (const node of nodes) {
        for (const tag of node.contextTags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
      
      const frequentContextTags = Object.entries(tagCounts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      // Analyze strategies
      const strategyCounts: Record<string, number> = {};
      for (const node of nodes) {
        strategyCounts[node.strategyId] = (strategyCounts[node.strategyId] || 0) + 1;
      }
      
      const topStrategies = Object.entries(strategyCounts)
        .map(([strategyId, count]) => ({ strategyId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      // Analyze regret distribution
      const regretRanges = [
        { range: '0.0-0.2', count: 0 },
        { range: '0.2-0.4', count: 0 },
        { range: '0.4-0.6', count: 0 },
        { range: '0.6-0.8', count: 0 },
        { range: '0.8-1.0', count: 0 }
      ];
      
      for (const node of nodes) {
        const regret = node.regretScore;
        if (regret < 0.2) regretRanges[0].count++;
        else if (regret < 0.4) regretRanges[1].count++;
        else if (regret < 0.6) regretRanges[2].count++;
        else if (regret < 0.8) regretRanges[3].count++;
        else regretRanges[4].count++;
      }
      
      // Analyze trust distribution
      const trustRanges = [
        { range: '0.0-0.2', count: 0 },
        { range: '0.2-0.4', count: 0 },
        { range: '0.4-0.6', count: 0 },
        { range: '0.6-0.8', count: 0 },
        { range: '0.8-1.0', count: 0 }
      ];
      
      for (const node of nodes) {
        const trust = node.trustScore;
        if (trust < 0.2) trustRanges[0].count++;
        else if (trust < 0.4) trustRanges[1].count++;
        else if (trust < 0.6) trustRanges[2].count++;
        else if (trust < 0.8) trustRanges[3].count++;
        else trustRanges[4].count++;
      }
      
      return {
        frequentContextTags,
        topStrategies,
        regretDistribution: regretRanges,
        trustDistribution: trustRanges
      };
    } catch (error) {
      logger.error('Error analyzing memory patterns', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return {
        frequentContextTags: [],
        topStrategies: [],
        regretDistribution: [],
        trustDistribution: []
      };
    }
  }
  
  /**
   * Compare memory patterns between two agents
   * 
   * @param agentId1 - The ID of the first agent
   * @param agentId2 - The ID of the second agent
   * @returns Comparison metrics between the two agents
   */
  public async compareAgentMemories(
    agentId1: string,
    agentId2: string
  ): Promise<{
    sharedStrategies: string[];
    sharedContextTags: string[];
    avgTrustDifference: number;
    avgRegretDifference: number;
    memorySizeDifference: number;
  }> {
    try {
      // Get nodes for both agents
      const nodes1 = await this.memoryGraph.getAgentNodes(agentId1);
      const nodes2 = await this.memoryGraph.getAgentNodes(agentId2);
      
      // Calculate memory size difference
      const memorySizeDifference = nodes1.length - nodes2.length;
      
      // Check for shared strategies
      const strategyIds1 = new Set(nodes1.map(node => node.strategyId));
      const strategyIds2 = new Set(nodes2.map(node => node.strategyId));
      
      const sharedStrategies = Array.from(strategyIds1).filter(id => strategyIds2.has(id));
      
      // Check for shared context tags
      const tags1 = new Set<string>();
      for (const node of nodes1) {
        for (const tag of node.contextTags) {
          tags1.add(tag);
        }
      }
      
      const tags2 = new Set<string>();
      for (const node of nodes2) {
        for (const tag of node.contextTags) {
          tags2.add(tag);
        }
      }
      
      const sharedContextTags = Array.from(tags1).filter(tag => tags2.has(tag));
      
      // Calculate average trust and regret differences
      const avgTrust1 = nodes1.reduce((sum, node) => sum + node.trustScore, 0) / (nodes1.length || 1);
      const avgTrust2 = nodes2.reduce((sum, node) => sum + node.trustScore, 0) / (nodes2.length || 1);
      const avgTrustDifference = avgTrust1 - avgTrust2;
      
      const avgRegret1 = nodes1.reduce((sum, node) => sum + node.regretScore, 0) / (nodes1.length || 1);
      const avgRegret2 = nodes2.reduce((sum, node) => sum + node.regretScore, 0) / (nodes2.length || 1);
      const avgRegretDifference = avgRegret1 - avgRegret2;
      
      return {
        sharedStrategies,
        sharedContextTags,
        avgTrustDifference,
        avgRegretDifference,
        memorySizeDifference
      };
    } catch (error) {
      logger.error('Error comparing agent memories', {
        error: error instanceof Error ? error.message : String(error),
        agentId1,
        agentId2
      });
      return {
        sharedStrategies: [],
        sharedContextTags: [],
        avgTrustDifference: 0,
        avgRegretDifference: 0,
        memorySizeDifference: 0
      };
    }
  }
  
  /**
   * Find the best strategy for a given context based on historical performance
   * 
   * @param agentId - The ID of the agent
   * @param contextTags - The context tags to match
   * @returns The best strategy ID and confidence score
   */
  public async findBestStrategyForContext(
    agentId: string,
    contextTags: string[]
  ): Promise<{
    strategyId: string | null;
    confidence: number;
    alternativeStrategies: string[];
  }> {
    try {
      // Find successful strategies
      const strategies = await this.findSuccessfulStrategies(agentId, contextTags);
      
      if (strategies.length === 0) {
        return {
          strategyId: null,
          confidence: 0,
          alternativeStrategies: []
        };
      }
      
      // Get best strategy
      const bestStrategy = strategies[0];
      
      // Calculate confidence based on score and difference from next best
      let confidence = bestStrategy.score;
      
      if (strategies.length > 1) {
        const scoreDiff = bestStrategy.score - strategies[1].score;
        // Boost confidence if there's a clear winner
        confidence *= (1 + (scoreDiff / bestStrategy.score));
      }
      
      // Cap confidence at 0.95
      confidence = Math.min(confidence, 0.95);
      
      return {
        strategyId: bestStrategy.strategyId,
        confidence,
        alternativeStrategies: strategies.slice(1, 3).map(s => s.strategyId)
      };
    } catch (error) {
      logger.error('Error finding best strategy for context', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        contextTags
      });
      return {
        strategyId: null,
        confidence: 0,
        alternativeStrategies: []
      };
    }
  }
  
  /**
   * Calculate similarity between two sets of context tags
   * Using Jaccard similarity coefficient
   * 
   * @param tags1 - First set of context tags
   * @param tags2 - Second set of context tags
   * @returns Similarity score (0-1)
   */
  private calculateContextSimilarity(tags1: string[], tags2: string[]): number {
    if (tags1.length === 0 || tags2.length === 0) {
      return 0;
    }
    
    const set1 = new Set(tags1);
    const set2 = new Set(tags2);
    
    // Intersection size
    const intersectionSize = [...set1].filter(tag => set2.has(tag)).length;
    
    // Union size
    const unionSize = set1.size + set2.size - intersectionSize;
    
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }
} 