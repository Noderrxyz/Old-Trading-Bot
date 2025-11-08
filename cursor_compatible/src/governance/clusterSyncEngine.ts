/**
 * Cluster Synchronization Engine
 * 
 * Handles consensus synchronization across agents in a governance cluster:
 * - Periodic consensus state sync
 * - Real-time vote gossiping
 * - Enforcement of execution consensus based on quorum
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { createLogger } from '../common/logger.js';
import { ClusterManager } from './clusterManager.js';
import { ClusterConsensusState, GovernanceCluster } from '../../types/governance/cluster.types.js';
import { ProposalVote } from './clusterProposalExecutor.js';

// Logger for sync operations
const logger = createLogger('ClusterSyncEngine');

// Vote sync message structure
interface VoteSyncMessage {
  proposalId: string;
  clusterId: string;
  vote: ProposalVote;
  timestamp: number;
}

// Agent sync status
interface AgentSyncStatus {
  agentDid: string;
  lastSyncTimestamp: number;
  connectedPeers: number;
  healthScore: number; // 0-100
}

// Cluster sync status
interface ClusterSyncStatus {
  clusterId: string;
  lastGlobalSyncTimestamp: number;
  syncInterval: number; // ms
  agents: AgentSyncStatus[];
  consensusState: ClusterConsensusState;
}

export class ClusterSyncEngine extends EventEmitter {
  private redis: Redis.Redis;
  private clusterManager: ClusterManager;
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private syncStatuses: Map<string, ClusterSyncStatus> = new Map();
  
  constructor(redis: Redis.Redis, clusterManager: ClusterManager) {
    super();
    this.redis = redis;
    this.clusterManager = clusterManager;
  }
  
  /**
   * Initialize sync for a specific cluster
   * 
   * @param clusterId Cluster ID
   * @param syncIntervalMs Sync interval in milliseconds (default: 30000)
   */
  async initializeClusterSync(clusterId: string, syncIntervalMs: number = 30000): Promise<void> {
    // Check if already initialized
    if (this.syncIntervals.has(clusterId)) {
      return;
    }
    
    // Get cluster to validate it exists
    const cluster = await this.clusterManager.getCluster(clusterId);
    
    // Get consensus state
    const consensusState = await this.clusterManager.getConsensusState(clusterId);
    
    // Create sync status
    const agentStatuses = cluster.agents.map(agent => ({
      agentDid: agent.did,
      lastSyncTimestamp: Date.now(),
      connectedPeers: 0,
      healthScore: 100
    }));
    
    const syncStatus: ClusterSyncStatus = {
      clusterId,
      lastGlobalSyncTimestamp: Date.now(),
      syncInterval: syncIntervalMs,
      agents: agentStatuses,
      consensusState
    };
    
    this.syncStatuses.set(clusterId, syncStatus);
    
    // Start periodic sync
    const interval = setInterval(() => {
      this.syncClusterVotes(clusterId).catch(error => {
        logger.error(`Error syncing cluster ${clusterId}: ${error}`);
      });
    }, syncIntervalMs);
    
    this.syncIntervals.set(clusterId, interval);
    
    logger.info(`Initialized sync for cluster ${clusterId} with ${agentStatuses.length} agents`);
    
    // Perform initial sync
    await this.syncClusterVotes(clusterId);
  }
  
  /**
   * Stop syncing for a specific cluster
   * 
   * @param clusterId Cluster ID
   */
  stopClusterSync(clusterId: string): void {
    const interval = this.syncIntervals.get(clusterId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(clusterId);
      this.syncStatuses.delete(clusterId);
      logger.info(`Stopped sync for cluster ${clusterId}`);
    }
  }
  
  /**
   * Synchronize votes across all agents in a cluster
   * 
   * @param clusterId Cluster ID
   * @returns Updated consensus state
   */
  async syncClusterVotes(clusterId: string): Promise<ClusterConsensusState> {
    logger.info(`Syncing votes for cluster ${clusterId}`);
    
    // Get cluster
    const cluster = await this.clusterManager.getCluster(clusterId);
    
    // Get active proposals for the cluster
    const proposalIds = await this.redis.smembers(
      `governance:clusters:${clusterId}:proposals`
    );
    
    if (proposalIds.length === 0) {
      logger.info(`No active proposals to sync for cluster ${clusterId}`);
      
      // Update consensus state
      const syncStatus = this.syncStatuses.get(clusterId);
      if (syncStatus) {
        syncStatus.lastGlobalSyncTimestamp = Date.now();
        syncStatus.consensusState.activeProposals = 0;
        syncStatus.consensusState.latestSyncTimestamp = Date.now();
        
        // Store updated consensus state
        await this.redis.set(
          `governance:clusters:consensus:${clusterId}`,
          JSON.stringify(syncStatus.consensusState)
        );
      }
      
      return syncStatus?.consensusState || await this.clusterManager.getConsensusState(clusterId);
    }
    
    // Process each proposal
    const quorumStatuses: Record<string, boolean> = {};
    const agentParticipation: Record<string, number> = {};
    
    // Initialize agent participation to 0
    for (const agent of cluster.agents) {
      agentParticipation[agent.did] = 0;
    }
    
    // For each proposal, check votes and calculate participation
    for (const proposalId of proposalIds) {
      // Get proposal data
      const proposalData = await this.redis.get(`governance:proposals:${proposalId}`);
      if (!proposalData) {
        logger.warn(`Proposal ${proposalId} not found but listed as active`);
        continue;
      }
      
      const proposal = JSON.parse(proposalData);
      
      // Calculate quorum status
      const totalVotes = proposal.votes.length;
      const totalAgents = cluster.agents.length;
      const participationRate = totalVotes / totalAgents;
      
      // Calculate quorum based on the cluster's decision protocol
      let quorumReached = false;
      
      if (totalVotes > 0) {
        const activeVotes = proposal.votes.filter((v: ProposalVote) => v.vote !== 'abstain');
        if (activeVotes.length > 0) {
          const totalWeight = activeVotes.reduce(
            (sum: number, v: ProposalVote) => sum + v.weight, 0
          );
          
          const positiveWeight = activeVotes
            .filter((v: ProposalVote) => v.vote === 'yes')
            .reduce((sum: number, v: ProposalVote) => sum + v.weight, 0);
          
          const approvalPercentage = (positiveWeight / totalWeight) * 100;
          quorumReached = approvalPercentage >= cluster.quorumThreshold;
        }
      }
      
      quorumStatuses[proposalId] = quorumReached;
      
      // Update agent participation
      for (const vote of proposal.votes) {
        if (agentParticipation[vote.agentDid] !== undefined) {
          agentParticipation[vote.agentDid]++;
        }
      }
    }
    
    // Calculate overall health score
    let totalParticipation = 0;
    const agentCount = cluster.agents.length;
    
    for (const agentDid of Object.keys(agentParticipation)) {
      const participation = agentParticipation[agentDid] / proposalIds.length;
      agentParticipation[agentDid] = Math.round(participation * 100);
      totalParticipation += participation;
    }
    
    const averageParticipation = totalParticipation / agentCount;
    const healthScore = Math.round(averageParticipation * 100);
    
    // Update consensus state
    const consensusState: ClusterConsensusState = {
      clusterId,
      activeProposals: proposalIds.length,
      latestSyncTimestamp: Date.now(),
      quorumStatus: quorumStatuses,
      agentParticipation,
      healthScore
    };
    
    // Update sync status
    const syncStatus = this.syncStatuses.get(clusterId);
    if (syncStatus) {
      syncStatus.lastGlobalSyncTimestamp = Date.now();
      syncStatus.consensusState = consensusState;
    }
    
    // Store updated consensus state
    await this.redis.set(
      `governance:clusters:consensus:${clusterId}`,
      JSON.stringify(consensusState)
    );
    
    // Emit sync complete event
    this.emit('clusterSyncComplete', {
      clusterId,
      consensusState
    });
    
    logger.info(`Completed vote sync for cluster ${clusterId}, health score: ${healthScore}`);
    return consensusState;
  }
  
  /**
   * Process a vote message from an agent and propagate to the cluster
   * 
   * @param message Vote sync message
   */
  async processVoteMessage(message: VoteSyncMessage): Promise<void> {
    const { proposalId, clusterId, vote } = message;
    
    logger.info(`Processing vote from ${vote.agentDid} on proposal ${proposalId}`);
    
    // Validate that the cluster exists
    const cluster = await this.clusterManager.getCluster(clusterId);
    
    // Validate that the agent is part of the cluster
    const agentInCluster = cluster.agents.some(a => a.did === vote.agentDid);
    if (!agentInCluster) {
      logger.warn(`Agent ${vote.agentDid} is not part of cluster ${clusterId}`);
      return;
    }
    
    // Get proposal
    const proposalData = await this.redis.get(`governance:proposals:${proposalId}`);
    if (!proposalData) {
      logger.warn(`Proposal ${proposalId} not found`);
      return;
    }
    
    const proposal = JSON.parse(proposalData);
    
    // Check if proposal belongs to the cluster
    if (proposal.clusterId !== clusterId) {
      logger.warn(`Proposal ${proposalId} does not belong to cluster ${clusterId}`);
      return;
    }
    
    // Check if the proposal is still active
    if (proposal.status !== 'active') {
      logger.warn(`Cannot vote on ${proposal.status} proposal ${proposalId}`);
      return;
    }
    
    // Check if agent has already voted
    const existingVoteIndex = proposal.votes.findIndex(
      (v: ProposalVote) => v.agentDid === vote.agentDid
    );
    
    if (existingVoteIndex >= 0) {
      // Update existing vote if timestamp is newer
      if (vote.timestamp > proposal.votes[existingVoteIndex].timestamp) {
        proposal.votes[existingVoteIndex] = vote;
      } else {
        // Skip if we already have a newer vote
        logger.info(`Ignoring older vote from ${vote.agentDid} on proposal ${proposalId}`);
        return;
      }
    } else {
      // Add new vote
      proposal.votes.push(vote);
    }
    
    // Update proposal
    await this.redis.set(
      `governance:proposals:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Publish vote message to the cluster channel
    await this.redis.publish(
      `governance:clusters:${clusterId}:votes`,
      JSON.stringify(message)
    );
    
    // Update agent's last sync timestamp
    const syncStatus = this.syncStatuses.get(clusterId);
    if (syncStatus) {
      const agentStatus = syncStatus.agents.find(a => a.agentDid === vote.agentDid);
      if (agentStatus) {
        agentStatus.lastSyncTimestamp = Date.now();
      }
    }
    
    // Trigger additional sync if needed
    if (this.shouldTriggerAdditionalSync(clusterId)) {
      await this.syncClusterVotes(clusterId);
    }
    
    logger.info(`Processed and propagated vote from ${vote.agentDid} on proposal ${proposalId}`);
  }
  
  /**
   * Determine if an additional sync should be triggered based on activity
   * 
   * @param clusterId Cluster ID
   * @returns Whether to trigger additional sync
   */
  private shouldTriggerAdditionalSync(clusterId: string): boolean {
    const syncStatus = this.syncStatuses.get(clusterId);
    if (!syncStatus) {
      return false;
    }
    
    // Trigger if last sync was more than half the interval ago
    const timeSinceLastSync = Date.now() - syncStatus.lastGlobalSyncTimestamp;
    return timeSinceLastSync > syncStatus.syncInterval / 2;
  }
  
  /**
   * Start listening for vote messages on Redis pub/sub
   * 
   * @param clusterId Cluster ID to listen to, or undefined for all clusters
   */
  async startVotePubSub(clusterId?: string): Promise<void> {
    // Create a separate Redis client for pub/sub
    const pubsubRedis = new Redis();
    
    if (clusterId) {
      // Subscribe to specific cluster
      await pubsubRedis.subscribe(`governance:clusters:${clusterId}:votes`);
      logger.info(`Subscribed to votes for cluster ${clusterId}`);
    } else {
      // Get all clusters
      const clusters = await this.clusterManager.getClusters();
      
      // Subscribe to all clusters
      for (const cluster of clusters) {
        await pubsubRedis.subscribe(`governance:clusters:${cluster.id}:votes`);
      }
      
      logger.info(`Subscribed to votes for ${clusters.length} clusters`);
    }
    
    // Handle incoming messages
    pubsubRedis.on('message', (channel: string, message: string) => {
      try {
        const voteMessage: VoteSyncMessage = JSON.parse(message);
        this.emit('voteSyncMessage', voteMessage);
        
        // Update sync status
        const clusterIdFromChannel = channel.split(':')[2];
        const syncStatus = this.syncStatuses.get(clusterIdFromChannel);
        
        if (syncStatus) {
          // Find agent and update status
          const agentStatus = syncStatus.agents.find(a => a.agentDid === voteMessage.vote.agentDid);
          if (agentStatus) {
            agentStatus.lastSyncTimestamp = Date.now();
          }
        }
      } catch (error) {
        logger.error(`Error processing vote message: ${error}`);
      }
    });
  }
} 