/**
 * Inter-Cluster Diplomacy and Binding Resolutions
 * 
 * Enables communication, coordination, and decision referencing
 * between different governance clusters, supporting cross-cluster
 * binding signatures and multi-cluster proposal execution.
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../common/logger.js';
import { ClusterManager } from './clusterManager.js';

// Logger for inter-cluster operations
const logger = createLogger('InterClusterDiplomacy');

// Types for inter-cluster operations
interface ClusterReference {
  clusterId: string;
  proposalIds: string[];
  requiredOutcome: 'passed' | 'any';
}

interface BindingSignature {
  agentDid: string;
  signature: string;
  timestamp: number;
  proposalId: string;
  clusterOrigin: string;
  clusterTarget: string;
}

interface CrossClusterProposal {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  creatorDid: string;
  primaryClusterId: string;
  secondaryClusters: ClusterReference[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  bindingSignatures: BindingSignature[];
  executionOrder: string[]; // Ordered cluster IDs for execution
  currentExecutionIndex: number;
  results: Record<string, any>;
}

export class InterClusterDiplomacy {
  private redis: Redis.Redis;
  private clusterManager: ClusterManager;
  
  constructor(redis: Redis.Redis, clusterManager: ClusterManager) {
    this.redis = redis;
    this.clusterManager = clusterManager;
  }
  
  /**
   * Create a new cross-cluster proposal that requires coordination
   * between multiple clusters
   * 
   * @param title Proposal title
   * @param description Proposal description
   * @param creatorDid Creator's DID
   * @param primaryClusterId Primary cluster responsible for the proposal
   * @param secondaryClusters Secondary clusters involved in the proposal
   * @param executionOrder Order of cluster execution (if undefined, determined automatically)
   * @returns Created cross-cluster proposal
   */
  async createCrossClusterProposal(
    title: string,
    description: string,
    creatorDid: string,
    primaryClusterId: string,
    secondaryClusters: ClusterReference[],
    executionOrder?: string[]
  ): Promise<CrossClusterProposal> {
    logger.info(
      `Creating cross-cluster proposal "${title}" with primary cluster ${primaryClusterId}`
    );
    
    // Validate primary cluster exists
    await this.clusterManager.getCluster(primaryClusterId);
    
    // Validate all secondary clusters exist
    for (const ref of secondaryClusters) {
      await this.clusterManager.getCluster(ref.clusterId);
    }
    
    // Generate execution order if not provided
    if (!executionOrder) {
      executionOrder = this.determineExecutionOrder(primaryClusterId, secondaryClusters);
    }
    
    // Create proposal ID
    const proposalId = `xcluster:${uuidv4()}`;
    
    // Create cross-cluster proposal
    const proposal: CrossClusterProposal = {
      id: proposalId,
      title,
      description,
      createdAt: Date.now(),
      creatorDid,
      primaryClusterId,
      secondaryClusters,
      status: 'pending',
      bindingSignatures: [],
      executionOrder,
      currentExecutionIndex: 0,
      results: {}
    };
    
    // Store in Redis
    await this.redis.set(
      `governance:cross-cluster:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Add to indexes
    await this.redis.sadd('governance:cross-cluster:all', proposalId);
    await this.redis.sadd(
      `governance:cross-cluster:primary:${primaryClusterId}`,
      proposalId
    );
    
    // Add to secondary cluster indexes
    for (const ref of secondaryClusters) {
      await this.redis.sadd(
        `governance:cross-cluster:secondary:${ref.clusterId}`,
        proposalId
      );
    }
    
    logger.info(
      `Created cross-cluster proposal ${proposalId} with execution order: ${executionOrder.join(', ')}`
    );
    
    return proposal;
  }
  
  /**
   * Determine the optimal execution order for clusters in a cross-cluster proposal
   * 
   * @param primaryClusterId Primary cluster ID
   * @param secondaryClusters Secondary cluster references
   * @returns Ordered array of cluster IDs for execution
   */
  private determineExecutionOrder(
    primaryClusterId: string,
    secondaryClusters: ClusterReference[]
  ): string[] {
    // Extract cluster IDs
    const secondaryIds = secondaryClusters.map(ref => ref.clusterId);
    
    // Simple ordering based on cluster scope
    const scopePriority: Record<string, number> = {
      'legal': 1,    // Legal approvals come first
      'treasury': 2, // Treasury funding comes next
      'infra': 3,    // Infrastructure changes come next
      'growth': 4    // Growth/marketing comes last
    };
    
    // Get clusters with their scopes
    const clusterScopes: Record<string, string> = {
      [primaryClusterId]: 'unknown'
    };
    
    // Add secondary cluster scopes (async operations handled outside this function)
    for (const clusterId of secondaryIds) {
      // Default scope if not yet known
      clusterScopes[clusterId] = 'unknown';
    }
    
    // Sort clusters by scope priority
    const sortedClusters = [primaryClusterId, ...secondaryIds].sort((a, b) => {
      const scopeA = clusterScopes[a] || 'unknown';
      const scopeB = clusterScopes[b] || 'unknown';
      
      const priorityA = scopePriority[scopeA] || 99;
      const priorityB = scopePriority[scopeB] || 99;
      
      return priorityA - priorityB;
    });
    
    return sortedClusters;
  }
  
  /**
   * Add a binding signature from an agent to a cross-cluster proposal
   * 
   * @param proposalId Cross-cluster proposal ID
   * @param signature Binding signature data
   * @returns Updated proposal
   */
  async addBindingSignature(
    proposalId: string,
    signature: BindingSignature
  ): Promise<CrossClusterProposal> {
    // Get proposal
    const proposalData = await this.redis.get(`governance:cross-cluster:${proposalId}`);
    if (!proposalData) {
      throw new Error(`Cross-cluster proposal ${proposalId} not found`);
    }
    
    const proposal: CrossClusterProposal = JSON.parse(proposalData);
    
    // Validate signature is from an agent in the origin cluster
    const originCluster = await this.clusterManager.getCluster(signature.clusterOrigin);
    const agentInOriginCluster = originCluster.agents.some(a => a.did === signature.agentDid);
    
    if (!agentInOriginCluster) {
      throw new Error(
        `Agent ${signature.agentDid} is not a member of origin cluster ${signature.clusterOrigin}`
      );
    }
    
    // Validate target cluster is part of the proposal
    const isTargetInvolved = proposal.secondaryClusters.some(
      ref => ref.clusterId === signature.clusterTarget
    ) || proposal.primaryClusterId === signature.clusterTarget;
    
    if (!isTargetInvolved) {
      throw new Error(
        `Target cluster ${signature.clusterTarget} is not involved in proposal ${proposalId}`
      );
    }
    
    // Check for duplicate signatures
    const existingSignatureIndex = proposal.bindingSignatures.findIndex(
      sig => sig.agentDid === signature.agentDid && 
             sig.clusterOrigin === signature.clusterOrigin &&
             sig.clusterTarget === signature.clusterTarget
    );
    
    if (existingSignatureIndex >= 0) {
      // Replace existing signature if newer
      if (signature.timestamp > proposal.bindingSignatures[existingSignatureIndex].timestamp) {
        proposal.bindingSignatures[existingSignatureIndex] = signature;
      } else {
        logger.info(`Ignoring older signature from ${signature.agentDid}`);
        return proposal;
      }
    } else {
      // Add new signature
      proposal.bindingSignatures.push(signature);
    }
    
    // Update proposal
    await this.redis.set(
      `governance:cross-cluster:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    logger.info(
      `Added binding signature from ${signature.agentDid} (${signature.clusterOrigin}) ` +
      `to ${signature.clusterTarget} for proposal ${proposalId}`
    );
    
    return proposal;
  }
  
  /**
   * Advance execution of a cross-cluster proposal to the next cluster
   * 
   * @param proposalId Cross-cluster proposal ID
   * @param currentResults Results from the current cluster's execution
   * @returns Updated proposal
   */
  async advanceExecution(
    proposalId: string,
    currentResults: Record<string, any>
  ): Promise<CrossClusterProposal> {
    // Get proposal
    const proposalData = await this.redis.get(`governance:cross-cluster:${proposalId}`);
    if (!proposalData) {
      throw new Error(`Cross-cluster proposal ${proposalId} not found`);
    }
    
    const proposal: CrossClusterProposal = JSON.parse(proposalData);
    
    // Validate current status
    if (proposal.status !== 'in_progress' && proposal.status !== 'pending') {
      throw new Error(`Cannot advance execution of ${proposal.status} proposal ${proposalId}`);
    }
    
    // Get current cluster in execution
    const currentClusterId = proposal.executionOrder[proposal.currentExecutionIndex];
    
    // Update results
    proposal.results[currentClusterId] = currentResults;
    
    // Set to in_progress if pending
    if (proposal.status === 'pending') {
      proposal.status = 'in_progress';
    }
    
    // Move to next cluster in execution order
    proposal.currentExecutionIndex++;
    
    // Check if execution is complete
    if (proposal.currentExecutionIndex >= proposal.executionOrder.length) {
      proposal.status = 'completed';
      logger.info(`Cross-cluster proposal ${proposalId} execution completed`);
    } else {
      const nextClusterId = proposal.executionOrder[proposal.currentExecutionIndex];
      logger.info(
        `Advancing cross-cluster proposal ${proposalId} execution from ${currentClusterId} to ${nextClusterId}`
      );
    }
    
    // Update proposal
    await this.redis.set(
      `governance:cross-cluster:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    return proposal;
  }
  
  /**
   * Check if a cluster has the required binding signatures to execute
   * its part of a cross-cluster proposal
   * 
   * @param proposalId Cross-cluster proposal ID
   * @param clusterId Cluster ID to check
   * @returns Whether the cluster has the required binding signatures
   */
  async hasRequiredBindingSignatures(
    proposalId: string,
    clusterId: string
  ): Promise<boolean> {
    // Get proposal
    const proposalData = await this.redis.get(`governance:cross-cluster:${proposalId}`);
    if (!proposalData) {
      throw new Error(`Cross-cluster proposal ${proposalId} not found`);
    }
    
    const proposal: CrossClusterProposal = JSON.parse(proposalData);
    
    // If primary cluster, only need to be in the execution order
    if (clusterId === proposal.primaryClusterId) {
      return proposal.executionOrder[proposal.currentExecutionIndex] === clusterId;
    }
    
    // For secondary clusters, need binding signatures from at least one agent
    // in each preceding cluster in the execution order
    const clusterIndex = proposal.executionOrder.indexOf(clusterId);
    
    // If cluster is not in execution order, can't execute
    if (clusterIndex === -1 || clusterIndex < proposal.currentExecutionIndex) {
      return false;
    }
    
    // If not the current cluster in the execution order, can't execute yet
    if (clusterIndex !== proposal.currentExecutionIndex) {
      return false;
    }
    
    // Check for binding signatures from preceding clusters
    const precedingClusters = proposal.executionOrder.slice(0, clusterIndex);
    
    for (const precedingClusterId of precedingClusters) {
      // Check if there's at least one binding signature from this cluster to the target
      const hasBindingSignature = proposal.bindingSignatures.some(
        sig => sig.clusterOrigin === precedingClusterId && sig.clusterTarget === clusterId
      );
      
      if (!hasBindingSignature) {
        logger.warn(
          `Missing binding signature from ${precedingClusterId} to ${clusterId} for proposal ${proposalId}`
        );
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Get all cross-cluster proposals that involve a specific cluster
   * 
   * @param clusterId Cluster ID
   * @returns Array of cross-cluster proposals
   */
  async getClusterCrossProposals(clusterId: string): Promise<CrossClusterProposal[]> {
    // Get proposals where cluster is primary
    const primaryIds = await this.redis.smembers(
      `governance:cross-cluster:primary:${clusterId}`
    );
    
    // Get proposals where cluster is secondary
    const secondaryIds = await this.redis.smembers(
      `governance:cross-cluster:secondary:${clusterId}`
    );
    
    // Combine and de-duplicate
    const proposalIds = [...new Set([...primaryIds, ...secondaryIds])];
    
    // Get proposal data
    const proposals: CrossClusterProposal[] = [];
    
    for (const id of proposalIds) {
      const proposalData = await this.redis.get(`governance:cross-cluster:${id}`);
      if (proposalData) {
        proposals.push(JSON.parse(proposalData));
      }
    }
    
    return proposals;
  }
  
  /**
   * Mark a cross-cluster proposal as failed
   * 
   * @param proposalId Cross-cluster proposal ID
   * @param reason Reason for failure
   * @returns Updated proposal
   */
  async markProposalFailed(
    proposalId: string,
    reason: string
  ): Promise<CrossClusterProposal> {
    // Get proposal
    const proposalData = await this.redis.get(`governance:cross-cluster:${proposalId}`);
    if (!proposalData) {
      throw new Error(`Cross-cluster proposal ${proposalId} not found`);
    }
    
    const proposal: CrossClusterProposal = JSON.parse(proposalData);
    
    // Update status
    proposal.status = 'failed';
    proposal.results.failure = { reason, timestamp: Date.now() };
    
    // Update proposal
    await this.redis.set(
      `governance:cross-cluster:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    logger.info(`Marked cross-cluster proposal ${proposalId} as failed: ${reason}`);
    
    return proposal;
  }
} 