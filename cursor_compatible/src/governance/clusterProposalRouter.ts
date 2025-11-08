/**
 * Cluster Proposal Router
 * 
 * Routes proposals to the appropriate cluster executor based on
 * clusterId and proposalType, enabling autonomous proposal processing
 * within each governance cluster.
 */

import Redis from 'ioredis';
import { createLogger } from '../common/logger.js';
import { ClusterManager } from './clusterManager.js';
import { ClusterProposalExecutor } from './clusterProposalExecutor.js';

// Logger for proposal routing
const logger = createLogger('ClusterProposalRouter');

export class ProposalRouter {
  private redis: Redis.Redis;
  private clusterManager: ClusterManager;
  private executors: Map<string, ClusterProposalExecutor> = new Map();
  
  constructor(redis: Redis.Redis, clusterManager: ClusterManager) {
    this.redis = redis;
    this.clusterManager = clusterManager;
  }
  
  /**
   * Get or create a proposal executor for a specific cluster
   * 
   * @param clusterId Cluster ID
   * @returns Proposal executor for the cluster
   */
  private async getExecutor(clusterId: string): Promise<ClusterProposalExecutor> {
    if (this.executors.has(clusterId)) {
      return this.executors.get(clusterId)!;
    }
    
    // Get cluster to validate it exists
    const cluster = await this.clusterManager.getCluster(clusterId);
    
    // Create new executor
    const executor = new ClusterProposalExecutor(
      this.redis,
      clusterId,
      cluster.decisionProtocol,
      cluster.quorumThreshold,
      cluster.executionDelay
    );
    
    // Store for reuse
    this.executors.set(clusterId, executor);
    
    return executor;
  }
  
  /**
   * Route a proposal to the appropriate cluster executor
   * 
   * @param clusterId Target cluster ID
   * @param proposalType Type of proposal
   * @param proposalData Proposal data
   * @returns Proposal ID
   */
  async route(
    clusterId: string,
    proposalType: string,
    proposalData: Record<string, any>
  ): Promise<string> {
    logger.info(`Routing ${proposalType} proposal to cluster ${clusterId}`);
    
    // Get cluster to validate proposal type
    const cluster = await this.clusterManager.getCluster(clusterId);
    
    // Validate proposal type is supported by cluster
    if (!cluster.proposalTypes.includes(proposalType)) {
      throw new Error(
        `Proposal type ${proposalType} is not supported by cluster ${clusterId}`
      );
    }
    
    // Get executor for cluster
    const executor = await this.getExecutor(clusterId);
    
    // Submit proposal to executor
    const proposalId = await executor.submitProposal(proposalType, proposalData);
    
    // Record routing for later lookup
    await this.redis.set(
      `governance:proposals:routing:${proposalId}`,
      clusterId
    );
    
    logger.info(`Routed proposal ${proposalId} to cluster ${clusterId}`);
    return proposalId;
  }
  
  /**
   * Get the cluster ID for a routed proposal
   * 
   * @param proposalId Proposal ID
   * @returns Cluster ID or null if not found
   */
  async getProposalCluster(proposalId: string): Promise<string | null> {
    const clusterId = await this.redis.get(`governance:proposals:routing:${proposalId}`);
    return clusterId;
  }
  
  /**
   * Create a routing builder for fluent API
   * 
   * @param clusterId Cluster ID
   * @param proposalType Proposal type
   * @returns Routing builder
   */
  static route(clusterId: string, proposalType: string): RouterBuilder {
    return new RouterBuilder(clusterId, proposalType);
  }
}

/**
 * Builder for fluent routing API
 */
class RouterBuilder {
  private clusterId: string;
  private proposalType: string;
  
  constructor(clusterId: string, proposalType: string) {
    this.clusterId = clusterId;
    this.proposalType = proposalType;
  }
  
  /**
   * Route to the specified executor
   * 
   * @param executor Proposal executor to use
   * @returns Executor for chaining
   */
  to(executor: ClusterProposalExecutor): ClusterProposalExecutor {
    // Set executor's context for this proposal type
    executor.setContext({
      clusterId: this.clusterId,
      proposalType: this.proposalType
    });
    
    return executor;
  }
} 