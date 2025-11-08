/**
 * Swarm Divergence Engine
 * 
 * Detects clusters of agents with similar traits and behaviors,
 * and manages the speciation process to create specialized agent populations.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { AgentCluster, AgentLineage, ClusterSummary } from '../../../types/agent.types.js';
import { StrategyForker, ForkReason } from './StrategyForker.js';
import { SpeciationLedger } from './SpeciationLedger.js';
import { MutationType } from '../types.js';
import { AgentTrait } from './types.js';

/**
 * Options for the speciation process
 */
export interface SpeciationOptions {
  /** Minimum number of agents required to form a new cluster */
  minClusterSize?: number;
  
  /** Maximum distance between points to be considered part of the same cluster */
  distanceThreshold?: number;
  
  /** Minimum fitness score difference to consider an agent for speciation */
  minFitnessDelta?: number;
  
  /** Number of clusters to aim for (if using k-means) */
  targetClusterCount?: number;
  
  /** Whether to enable automatic mutation after clustering */
  enableAutoMutation?: boolean;
  
  /** Clustering algorithm to use (DBSCAN or KMeans) */
  algorithm?: 'DBSCAN' | 'KMeans';
  
  /** Which traits to consider when clustering */
  considerTraits?: string[];
}

/**
 * Default speciation options
 */
const DEFAULT_SPECIATION_OPTIONS: Required<SpeciationOptions> = {
  minClusterSize: 3,
  distanceThreshold: 0.3,
  minFitnessDelta: 0.05,
  targetClusterCount: 5,
  enableAutoMutation: true,
  algorithm: 'DBSCAN',
  considerTraits: ['performance', 'behavior', 'timeframe', 'risk']
};

/**
 * Swarm Divergence Engine responsible for speciation
 */
export class SwarmDivergenceEngine {
  private strategyForker: StrategyForker;
  private speciationLedger: SpeciationLedger;
  private clusters: Map<string, AgentCluster> = new Map();
  private agentTraits: Map<string, AgentTrait[]> = new Map();
  private defaultClusterId: string;
  
  /**
   * Create a new swarm divergence engine
   * 
   * @param strategyForker Strategy forker instance
   * @param speciationLedger Speciation ledger instance
   */
  constructor(strategyForker: StrategyForker, speciationLedger: SpeciationLedger) {
    this.strategyForker = strategyForker;
    this.speciationLedger = speciationLedger;
    
    // Create default cluster
    this.defaultClusterId = 'default';
    const defaultCluster: AgentCluster = {
      clusterId: this.defaultClusterId,
      name: 'Default Cluster',
      description: 'Default cluster for all agents before speciation',
      agentIds: [],
      traits: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.clusters.set(this.defaultClusterId, defaultCluster);
    logger.info('Swarm Divergence Engine initialized with default cluster');
  }
  
  /**
   * Add an agent to the swarm
   * 
   * @param agentId Agent ID to add
   * @param clusterId Optional cluster ID (defaults to default cluster)
   * @param traits Initial traits for the agent
   */
  public async addAgent(
    agentId: string, 
    clusterId: string = this.defaultClusterId,
    traits: AgentTrait[] = []
  ): Promise<void> {
    // Get the cluster (or default if not found)
    const cluster = this.clusters.get(clusterId) || this.clusters.get(this.defaultClusterId)!;
    
    // Add agent to cluster
    if (!cluster.agentIds.includes(agentId)) {
      cluster.agentIds.push(agentId);
      cluster.updatedAt = Date.now();
      this.clusters.set(cluster.clusterId, cluster);
    }
    
    // Store agent traits
    if (traits.length > 0) {
      this.agentTraits.set(agentId, traits);
    }
    
    logger.info(`Added agent ${agentId} to cluster ${cluster.clusterId}`);
  }
  
  /**
   * Remove an agent from the swarm
   * 
   * @param agentId Agent ID to remove
   */
  public async removeAgent(agentId: string): Promise<void> {
    // Remove from all clusters
    for (const [clusterId, cluster] of this.clusters.entries()) {
      const index = cluster.agentIds.indexOf(agentId);
      if (index !== -1) {
        cluster.agentIds.splice(index, 1);
        cluster.updatedAt = Date.now();
        this.clusters.set(clusterId, cluster);
        logger.info(`Removed agent ${agentId} from cluster ${clusterId}`);
      }
    }
    
    // Remove traits
    this.agentTraits.delete(agentId);
  }
  
  /**
   * Update agent traits
   * 
   * @param agentId Agent ID to update
   * @param traits New traits or traits to update
   * @param replace Whether to replace all traits (true) or merge (false)
   */
  public async updateAgentTraits(
    agentId: string,
    traits: AgentTrait[],
    replace: boolean = false
  ): Promise<void> {
    if (replace || !this.agentTraits.has(agentId)) {
      this.agentTraits.set(agentId, traits);
    } else {
      // Merge traits
      const existingTraits = this.agentTraits.get(agentId)!;
      const mergedTraits = [...existingTraits];
      
      // Add or update traits
      for (const newTrait of traits) {
        const existingIndex = mergedTraits.findIndex(t => 
          t.name === newTrait.name && t.category === newTrait.category
        );
        
        if (existingIndex !== -1) {
          mergedTraits[existingIndex] = newTrait;
        } else {
          mergedTraits.push(newTrait);
        }
      }
      
      this.agentTraits.set(agentId, mergedTraits);
    }
    
    logger.debug(`Updated traits for agent ${agentId}`, { traitCount: traits.length });
  }
  
  /**
   * Create a new cluster
   * 
   * @param name Cluster name
   * @param description Cluster description
   * @param traits Dominant traits for this cluster
   * @returns The new cluster
   */
  public async createCluster(
    name: string,
    description: string,
    traits: Record<string, any> = {}
  ): Promise<AgentCluster> {
    const clusterId = uuidv4();
    const timestamp = Date.now();
    
    const cluster: AgentCluster = {
      clusterId,
      name,
      description,
      agentIds: [],
      traits,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    this.clusters.set(clusterId, cluster);
    logger.info(`Created new cluster: ${name} (${clusterId})`);
    
    return cluster;
  }
  
  /**
   * Run the speciation process to identify clusters and evolve agents
   * 
   * @param options Speciation options
   * @returns Summary of the clusters after speciation
   */
  public async runSpeciation(options: SpeciationOptions = {}): Promise<ClusterSummary[]> {
    const mergedOptions: Required<SpeciationOptions> = {
      ...DEFAULT_SPECIATION_OPTIONS,
      ...options
    };
    
    logger.info('Running speciation process', mergedOptions);
    
    // Get all agents and their traits
    const agentIds = Array.from(this.agentTraits.keys());
    if (agentIds.length < mergedOptions.minClusterSize * 2) {
      logger.warn(`Not enough agents (${agentIds.length}) for meaningful speciation`);
      return this.getClusterSummaries();
    }
    
    // Prepare agent feature vectors for clustering
    const featureVectors = this.prepareFeatureVectors(agentIds, mergedOptions.considerTraits);
    
    // Run clustering algorithm
    const clusterAssignments = await this.runClusteringAlgorithm(
      featureVectors,
      mergedOptions.algorithm,
      mergedOptions.targetClusterCount,
      mergedOptions.distanceThreshold
    );
    
    // Process cluster assignments
    const newClusters = await this.processClusterAssignments(
      agentIds,
      clusterAssignments,
      mergedOptions
    );
    
    // If auto-mutation is enabled, trigger mutations for agents moving to new clusters
    if (mergedOptions.enableAutoMutation) {
      await this.triggerClusterMutations(newClusters);
    }
    
    // Generate summaries
    const summaries = this.getClusterSummaries();
    
    logger.info(`Speciation complete: ${summaries.length} clusters identified`);
    return summaries;
  }
  
  /**
   * Get summaries of all current clusters
   * 
   * @returns Array of cluster summaries
   */
  private getClusterSummaries(): ClusterSummary[] {
    return Array.from(this.clusters.values()).map(cluster => {
      // Calculate average fitness if available
      const avgFitness = 0; // In a real implementation, this would aggregate fitness scores
      
      return {
        clusterId: cluster.clusterId,
        agentCount: cluster.agentIds.length,
        avgFitness,
        dominantTraits: cluster.traits,
        addedAgentIds: [],
        removedAgentIds: []
      };
    });
  }
  
  /**
   * Convert agent traits to feature vectors for clustering
   * 
   * @param agentIds Agent IDs to process
   * @param considerTraits Categories of traits to consider
   * @returns Map of agent IDs to feature vectors
   */
  private prepareFeatureVectors(
    agentIds: string[],
    considerTraits: string[]
  ): Map<string, number[]> {
    const featureVectors = new Map<string, number[]>();
    
    // Define feature dimensions and normalization
    // This would be more comprehensive in a real implementation
    const featureDimensions = [
      'performance.winRate',
      'performance.roi',
      'performance.sharpe',
      'behavior.tradeFrequency',
      'behavior.holdTime',
      'risk.maxDrawdown',
      'risk.volatility',
      'timeframe.preference'
    ];
    
    // Extract features for each agent
    for (const agentId of agentIds) {
      const traits = this.agentTraits.get(agentId) || [];
      const featureVector: number[] = [];
      
      // Initialize with zeros
      for (let i = 0; i < featureDimensions.length; i++) {
        featureVector.push(0);
      }
      
      // Fill in values from traits
      for (const trait of traits) {
        // Skip traits not in consideration list
        if (!considerTraits.includes(trait.category)) continue;
        
        // Find matching feature dimension
        const dimensionKey = `${trait.category}.${trait.name}`;
        const dimensionIndex = featureDimensions.indexOf(dimensionKey);
        
        if (dimensionIndex !== -1 && typeof trait.value === 'number') {
          featureVector[dimensionIndex] = trait.value;
        }
      }
      
      featureVectors.set(agentId, featureVector);
    }
    
    return featureVectors;
  }
  
  /**
   * Run a clustering algorithm on feature vectors
   * 
   * @param featureVectors Map of agent IDs to feature vectors
   * @param algorithm Clustering algorithm to use
   * @param targetClusterCount Target number of clusters for k-means
   * @param distanceThreshold Distance threshold for DBSCAN
   * @returns Map of agent IDs to cluster assignments
   */
  private async runClusteringAlgorithm(
    featureVectors: Map<string, number[]>,
    algorithm: 'DBSCAN' | 'KMeans',
    targetClusterCount: number,
    distanceThreshold: number
  ): Promise<Map<string, number>> {
    const agentIds = Array.from(featureVectors.keys());
    const clusterAssignments = new Map<string, number>();
    
    logger.info(`Running ${algorithm} clustering algorithm`);
    
    // In a real implementation, this would use a proper clustering algorithm
    // For this demonstration, we'll use a simplified random assignment
    
    if (algorithm === 'KMeans') {
      // Simulate k-means clustering with random assignments
      for (const agentId of agentIds) {
        const clusterIndex = Math.floor(Math.random() * targetClusterCount);
        clusterAssignments.set(agentId, clusterIndex);
      }
    } else { // DBSCAN
      // Simulate DBSCAN with random assignments, including noise (-1)
      for (const agentId of agentIds) {
        // 10% chance of being noise
        if (Math.random() < 0.1) {
          clusterAssignments.set(agentId, -1); // Noise point
        } else {
          const maxClusters = Math.ceil(agentIds.length / 5); // Roughly 5 agents per cluster
          const clusterIndex = Math.floor(Math.random() * maxClusters);
          clusterAssignments.set(agentId, clusterIndex);
        }
      }
    }
    
    return clusterAssignments;
  }
  
  /**
   * Process cluster assignments and update cluster memberships
   * 
   * @param agentIds Agent IDs that were clustered
   * @param clusterAssignments Cluster assignments from algorithm
   * @param options Speciation options
   * @returns Map of cluster IDs to added agent IDs
   */
  private async processClusterAssignments(
    agentIds: string[],
    clusterAssignments: Map<string, number>,
    options: Required<SpeciationOptions>
  ): Promise<Map<string, string[]>> {
    // Track which agents are added to each cluster
    const addedAgents = new Map<string, string[]>();
    
    // Group agents by cluster assignment
    const algorithmClusters = new Map<number, string[]>();
    
    for (const agentId of agentIds) {
      const clusterIndex = clusterAssignments.get(agentId) ?? -1;
      
      // Skip noise points
      if (clusterIndex === -1) continue;
      
      if (!algorithmClusters.has(clusterIndex)) {
        algorithmClusters.set(clusterIndex, []);
      }
      
      algorithmClusters.get(clusterIndex)!.push(agentId);
    }
    
    // Process each algorithm cluster
    for (const [clusterIndex, memberAgentIds] of algorithmClusters.entries()) {
      // Skip clusters that are too small
      if (memberAgentIds.length < options.minClusterSize) {
        continue;
      }
      
      // Determine dominant traits for this cluster
      const dominantTraits = this.calculateDominantTraits(memberAgentIds);
      
      // See if this matches an existing cluster or create a new one
      let targetCluster: AgentCluster | undefined;
      
      // Look for an existing cluster with similar traits
      for (const cluster of this.clusters.values()) {
        if (cluster.clusterId === this.defaultClusterId) continue;
        
        // Simple trait matching - would be more sophisticated in a real implementation
        const traitSimilarity = this.calculateTraitSimilarity(cluster.traits, dominantTraits);
        if (traitSimilarity > 0.7) {
          targetCluster = cluster;
          break;
        }
      }
      
      // Create new cluster if no match found
      if (!targetCluster) {
        targetCluster = await this.createCluster(
          `Cluster-${clusterIndex}`,
          `Automatically generated cluster from speciation run`,
          dominantTraits
        );
      }
      
      // Update agent memberships
      for (const agentId of memberAgentIds) {
        // Find current cluster for this agent
        let currentClusterId: string | undefined;
        for (const [cId, cluster] of this.clusters.entries()) {
          if (cluster.agentIds.includes(agentId)) {
            currentClusterId = cId;
            break;
          }
        }
        
        // If agent is already in the right cluster, skip
        if (currentClusterId === targetCluster.clusterId) {
          continue;
        }
        
        // Remove from current cluster
        if (currentClusterId) {
          const currentCluster = this.clusters.get(currentClusterId)!;
          const index = currentCluster.agentIds.indexOf(agentId);
          if (index !== -1) {
            currentCluster.agentIds.splice(index, 1);
            currentCluster.updatedAt = Date.now();
            this.clusters.set(currentClusterId, currentCluster);
          }
        }
        
        // Add to new cluster
        if (!targetCluster.agentIds.includes(agentId)) {
          targetCluster.agentIds.push(agentId);
          targetCluster.updatedAt = Date.now();
          this.clusters.set(targetCluster.clusterId, targetCluster);
          
          // Track added agents
          if (!addedAgents.has(targetCluster.clusterId)) {
            addedAgents.set(targetCluster.clusterId, []);
          }
          addedAgents.get(targetCluster.clusterId)!.push(agentId);
          
          logger.info(`Moved agent ${agentId} to cluster ${targetCluster.clusterId}`);
        }
      }
    }
    
    return addedAgents;
  }
  
  /**
   * Calculate dominant traits for a group of agents
   * 
   * @param agentIds Agent IDs to analyze
   * @returns Record of dominant traits
   */
  private calculateDominantTraits(agentIds: string[]): Record<string, any> {
    const traits: Record<string, any> = {};
    
    // Count traits by category and name
    const traitCounts: Record<string, Record<string, { count: number, sum: number }>> = {};
    
    for (const agentId of agentIds) {
      const agentTraits = this.agentTraits.get(agentId) || [];
      
      for (const trait of agentTraits) {
        const { category, name, value } = trait;
        
        if (typeof value !== 'number') continue;
        
        if (!traitCounts[category]) {
          traitCounts[category] = {};
        }
        
        if (!traitCounts[category][name]) {
          traitCounts[category][name] = { count: 0, sum: 0 };
        }
        
        traitCounts[category][name].count++;
        traitCounts[category][name].sum += value;
      }
    }
    
    // Calculate averages for each trait
    for (const [category, categoryTraits] of Object.entries(traitCounts)) {
      traits[category] = {};
      
      for (const [name, { count, sum }] of Object.entries(categoryTraits)) {
        traits[category][name] = sum / count;
      }
    }
    
    return traits;
  }
  
  /**
   * Calculate similarity between two trait sets
   * 
   * @param traitsA First trait set
   * @param traitsB Second trait set
   * @returns Similarity score (0-1)
   */
  private calculateTraitSimilarity(
    traitsA: Record<string, any>,
    traitsB: Record<string, any>
  ): number {
    // Simple implementation - would be more sophisticated in a real system
    let matchCount = 0;
    let totalTraits = 0;
    
    // Check traits in A that are also in B
    for (const [categoryA, categoryTraitsA] of Object.entries(traitsA)) {
      if (typeof categoryTraitsA !== 'object' || categoryTraitsA === null) continue;
      
      const categoryTraitsB = traitsB[categoryA];
      if (typeof categoryTraitsB !== 'object' || categoryTraitsB === null) continue;
      
      for (const [nameA, valueA] of Object.entries(categoryTraitsA)) {
        if (typeof valueA !== 'number') continue;
        
        totalTraits++;
        
        const valueB = categoryTraitsB[nameA];
        if (typeof valueB !== 'number') continue;
        
        // Check if the values are close (within 20%)
        const ratio = Math.min(valueA, valueB) / Math.max(valueA, valueB);
        if (ratio > 0.8) {
          matchCount++;
        }
      }
    }
    
    // Also check traits in B that weren't counted above
    for (const [categoryB, categoryTraitsB] of Object.entries(traitsB)) {
      if (typeof categoryTraitsB !== 'object' || categoryTraitsB === null) continue;
      
      const categoryTraitsA = traitsA[categoryB];
      if (typeof categoryTraitsA !== 'object' || categoryTraitsA === null) continue;
      
      for (const nameB of Object.keys(categoryTraitsB)) {
        if (!(nameB in categoryTraitsA)) {
          totalTraits++;
        }
      }
    }
    
    return totalTraits > 0 ? matchCount / totalTraits : 0;
  }
  
  /**
   * Trigger mutations for agents that have moved to new clusters
   * 
   * @param newClusters Map of cluster IDs to added agent IDs
   */
  private async triggerClusterMutations(newClusters: Map<string, string[]>): Promise<void> {
    for (const [clusterId, agentIds] of newClusters.entries()) {
      const cluster = this.clusters.get(clusterId);
      if (!cluster) continue;
      
      logger.info(`Triggering mutations for ${agentIds.length} agents in cluster ${clusterId}`);
      
      // Record speciation events in the ledger
      for (const agentId of agentIds) {
        // In a real implementation, this would actually trigger the strategy forking
        // and create new agent variants through mutation
        
        // For now, just record the event
        const speciationRecord: AgentLineage = {
          agentId,
          // parent would be determined from actual agent data
          parentId: undefined,
          generation: 1,
          mutationReason: ForkReason.CLUSTER_DIVERGENCE,
          clusterId,
          createdAt: Date.now(),
          // strategy would be determined from actual strategy data
          strategyId: `strategy-${agentId}`
        };
        
        await this.speciationLedger.recordSpeciationEvent(speciationRecord);
      }
    }
  }
} 