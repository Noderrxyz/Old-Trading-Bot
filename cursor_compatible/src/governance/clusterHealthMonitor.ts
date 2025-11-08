/**
 * Cluster Health Monitor and Anomaly Detection
 * 
 * Tracks health metrics for governance clusters and detects anomalies such as:
 * - Proposal dropouts (proposals not reaching resolution)
 * - Repeated indecision (tie votes, no quorum)
 * - Rogue agents (contradictory or invalid votes)
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../common/logger.js';
import { ClusterManager } from './clusterManager.js';
import { ClusterConsensusState, GovernanceCluster } from '../../types/governance/cluster.types.js';
import { ProposalVote } from './clusterProposalExecutor.js';

// Logger for health monitoring
const logger = createLogger('ClusterHealthMonitor');

// Anomaly types
export enum AnomalyType {
  PROPOSAL_DROPOUT = 'proposal_dropout',
  REPEATED_INDECISION = 'repeated_indecision',
  ROGUE_AGENT = 'rogue_agent',
  LOW_PARTICIPATION = 'low_participation',
  QUORUM_FAILURE = 'quorum_failure',
  VOTING_PATTERN_SHIFT = 'voting_pattern_shift'
}

// Anomaly detection settings
interface AnomalySettings {
  proposalDropoutThresholdHours: number;
  indecisionThreshold: number;
  rogueAgentDetectionEnabled: boolean;
  participationThresholdPercent: number;
  quorumFailureThresholdPercent: number;
}

// Detected anomaly
export interface ClusterAnomaly {
  id: string;
  clusterId: string;
  type: AnomalyType;
  timestamp: number;
  details: Record<string, any>;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
  resolutionDetails?: Record<string, any>;
}

// Cluster health metrics
export interface ClusterHealthMetrics {
  clusterId: string;
  timestamp: number;
  proposalCount: number;
  activeProposals: number;
  completedProposals: number;
  failedProposals: number;
  averageParticipation: number;
  quorumSuccessRate: number;
  averageTimeToResolution: number;
  anomalies: ClusterAnomaly[];
  healthScore: number;
  agentMetrics: Record<string, AgentHealthMetrics>;
}

// Agent health metrics
interface AgentHealthMetrics {
  agentDid: string;
  voteCount: number;
  participationRate: number;
  consensusAlignment: number; // How often agent votes with the majority
  lastActiveTimestamp: number;
  avgResponseTime: number;
  healthScore: number;
}

export class ClusterHealthMonitor extends EventEmitter {
  private redis: Redis.Redis;
  private clusterManager: ClusterManager;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private settings: Record<string, AnomalySettings> = {};
  private defaultSettings: AnomalySettings = {
    proposalDropoutThresholdHours: 48,
    indecisionThreshold: 3,
    rogueAgentDetectionEnabled: true,
    participationThresholdPercent: 70,
    quorumFailureThresholdPercent: 25
  };
  
  constructor(redis: Redis.Redis, clusterManager: ClusterManager) {
    super();
    this.redis = redis;
    this.clusterManager = clusterManager;
  }
  
  /**
   * Start monitoring a cluster's health
   * 
   * @param clusterId Cluster ID to monitor
   * @param intervalMs Monitoring interval in milliseconds (default: 1 hour)
   * @param settings Custom anomaly detection settings
   */
  async startMonitoring(
    clusterId: string,
    intervalMs: number = 3600000,
    settings?: Partial<AnomalySettings>
  ): Promise<void> {
    // Check if already monitoring
    if (this.monitoringIntervals.has(clusterId)) {
      return;
    }
    
    // Get cluster to validate it exists
    await this.clusterManager.getCluster(clusterId);
    
    // Set custom settings for this cluster
    this.settings[clusterId] = {
      ...this.defaultSettings,
      ...settings
    };
    
    logger.info(`Starting health monitoring for cluster ${clusterId}`);
    
    // Perform initial health check
    await this.checkClusterHealth(clusterId);
    
    // Schedule regular checks
    const interval = setInterval(() => {
      this.checkClusterHealth(clusterId).catch(error => {
        logger.error(`Error checking health for cluster ${clusterId}: ${error}`);
      });
    }, intervalMs);
    
    this.monitoringIntervals.set(clusterId, interval);
  }
  
  /**
   * Stop monitoring a cluster's health
   * 
   * @param clusterId Cluster ID to stop monitoring
   */
  stopMonitoring(clusterId: string): void {
    const interval = this.monitoringIntervals.get(clusterId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(clusterId);
      logger.info(`Stopped health monitoring for cluster ${clusterId}`);
    }
  }
  
  /**
   * Check a cluster's health and detect anomalies
   * 
   * @param clusterId Cluster ID to check
   * @returns Current health metrics
   */
  async checkClusterHealth(clusterId: string): Promise<ClusterHealthMetrics> {
    logger.info(`Checking health for cluster ${clusterId}`);
    
    // Get cluster
    const cluster = await this.clusterManager.getCluster(clusterId);
    
    // Get consensus state
    const consensusState = await this.clusterManager.getConsensusState(clusterId);
    
    // Get active proposals
    const activeProposalIds = await this.redis.smembers(
      `governance:clusters:${clusterId}:proposals`
    );
    
    // Get completed proposals
    const completedProposalIds = await this.redis.smembers(
      `governance:clusters:${clusterId}:proposals:completed`
    );
    
    // Get failed proposals
    const failedProposalIds = await this.redis.smembers(
      `governance:clusters:${clusterId}:proposals:failed`
    );
    
    // Get all proposals for analysis
    const allProposalIds = [
      ...activeProposalIds,
      ...completedProposalIds,
      ...failedProposalIds
    ];
    
    // Initialize metrics
    const metrics: ClusterHealthMetrics = {
      clusterId,
      timestamp: Date.now(),
      proposalCount: allProposalIds.length,
      activeProposals: activeProposalIds.length,
      completedProposals: completedProposalIds.length,
      failedProposals: failedProposalIds.length,
      averageParticipation: 0,
      quorumSuccessRate: 0,
      averageTimeToResolution: 0,
      anomalies: [],
      healthScore: 100,
      agentMetrics: {}
    };
    
    // Initialize agent metrics
    for (const agent of cluster.agents) {
      metrics.agentMetrics[agent.did] = {
        agentDid: agent.did,
        voteCount: 0,
        participationRate: 0,
        consensusAlignment: 100,
        lastActiveTimestamp: 0,
        avgResponseTime: 0,
        healthScore: 100
      };
    }
    
    // Calculate metrics from proposals
    let totalParticipation = 0;
    let totalQuorumSuccess = 0;
    let totalResolutionTime = 0;
    let resolutionCount = 0;
    
    const agentVoteCounts: Record<string, number> = {};
    const agentConsensusCounts: Record<string, { aligned: number; total: number }> = {};
    
    for (const agent of cluster.agents) {
      agentVoteCounts[agent.did] = 0;
      agentConsensusCounts[agent.did] = { aligned: 0, total: 0 };
    }
    
    // Analyze all proposals
    for (const proposalId of allProposalIds) {
      const proposalData = await this.redis.get(`governance:proposals:${proposalId}`);
      if (!proposalData) {
        continue;
      }
      
      const proposal = JSON.parse(proposalData);
      
      // Calculate participation for this proposal
      const votingAgents = new Set(proposal.votes.map((v: ProposalVote) => v.agentDid));
      const participationRate = votingAgents.size / cluster.agents.length;
      totalParticipation += participationRate;
      
      // Check for quorum success
      const quorumReached = consensusState.quorumStatus[proposalId] || false;
      totalQuorumSuccess += quorumReached ? 1 : 0;
      
      // Calculate resolution time for completed/failed proposals
      if (proposal.status === 'executed' || proposal.status === 'failed') {
        const resolutionTime = proposal.executedAt - proposal.createdAt;
        totalResolutionTime += resolutionTime;
        resolutionCount++;
        
        // Update agent consensus alignment
        // Determine the majority vote
        const voteCount: Record<string, number> = { 'yes': 0, 'no': 0, 'abstain': 0 };
        for (const vote of proposal.votes) {
          voteCount[vote.vote]++;
        }
        
        const majorityVote = Object.entries(voteCount)
          .filter(([vote]) => vote !== 'abstain')
          .sort(([, countA], [, countB]) => countB - countA)[0]?.[0];
        
        // Update agent stats
        for (const vote of proposal.votes) {
          // Update vote count
          agentVoteCounts[vote.agentDid] = (agentVoteCounts[vote.agentDid] || 0) + 1;
          
          // Update last activity timestamp
          const agentMetrics = metrics.agentMetrics[vote.agentDid];
          if (agentMetrics && vote.timestamp > agentMetrics.lastActiveTimestamp) {
            agentMetrics.lastActiveTimestamp = vote.timestamp;
          }
          
          // Update consensus alignment (only for yes/no votes)
          if (majorityVote && vote.vote !== 'abstain') {
            const aligned = vote.vote === majorityVote;
            const agentConsensus = agentConsensusCounts[vote.agentDid];
            
            if (agentConsensus) {
              agentConsensus.total++;
              if (aligned) {
                agentConsensus.aligned++;
              }
            }
          }
        }
      }
      
      // Detect anomalies in this proposal
      await this.detectProposalAnomalies(clusterId, proposal, cluster, metrics);
    }
    
    // Calculate average metrics
    metrics.averageParticipation = allProposalIds.length > 0
      ? (totalParticipation / allProposalIds.length) * 100
      : 0;
    
    metrics.quorumSuccessRate = allProposalIds.length > 0
      ? (totalQuorumSuccess / allProposalIds.length) * 100
      : 0;
    
    metrics.averageTimeToResolution = resolutionCount > 0
      ? totalResolutionTime / resolutionCount
      : 0;
    
    // Update agent metrics
    for (const [agentDid, voteCount] of Object.entries(agentVoteCounts)) {
      const agentMetrics = metrics.agentMetrics[agentDid];
      if (agentMetrics) {
        agentMetrics.voteCount = voteCount;
        agentMetrics.participationRate = allProposalIds.length > 0
          ? (voteCount / allProposalIds.length) * 100
          : 0;
        
        const consensusCounts = agentConsensusCounts[agentDid];
        agentMetrics.consensusAlignment = consensusCounts && consensusCounts.total > 0
          ? (consensusCounts.aligned / consensusCounts.total) * 100
          : 100;
        
        // Calculate agent health score
        agentMetrics.healthScore = this.calculateAgentHealthScore(agentMetrics);
      }
    }
    
    // Detect rogue agents
    await this.detectRogueAgents(clusterId, metrics);
    
    // Calculate overall health score
    metrics.healthScore = this.calculateClusterHealthScore(metrics);
    
    // Store health metrics
    await this.redis.set(
      `governance:clusters:health:${clusterId}:latest`,
      JSON.stringify(metrics)
    );
    
    // Store historical metrics
    await this.redis.zadd(
      `governance:clusters:health:${clusterId}:history`,
      metrics.timestamp,
      JSON.stringify(metrics)
    );
    
    // Trim history to last 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    await this.redis.zremrangebyscore(
      `governance:clusters:health:${clusterId}:history`,
      0,
      thirtyDaysAgo
    );
    
    // Emit event if anomalies were detected
    if (metrics.anomalies.length > 0) {
      this.emit('anomaliesDetected', {
        clusterId,
        anomalies: metrics.anomalies
      });
      
      logger.warn(
        `Detected ${metrics.anomalies.length} anomalies in cluster ${clusterId}`
      );
    }
    
    logger.info(
      `Cluster ${clusterId} health score: ${metrics.healthScore.toFixed(2)}, ` +
      `Average participation: ${metrics.averageParticipation.toFixed(2)}%, ` +
      `Quorum success rate: ${metrics.quorumSuccessRate.toFixed(2)}%`
    );
    
    return metrics;
  }
  
  /**
   * Detect anomalies in a specific proposal
   * 
   * @param clusterId Cluster ID
   * @param proposal Proposal data
   * @param cluster Cluster data
   * @param metrics Health metrics to update
   */
  private async detectProposalAnomalies(
    clusterId: string,
    proposal: any,
    cluster: GovernanceCluster,
    metrics: ClusterHealthMetrics
  ): Promise<void> {
    const settings = this.settings[clusterId] || this.defaultSettings;
    
    // Check for proposal dropout (active proposal with no recent activity)
    if (proposal.status === 'active') {
      const now = Date.now();
      const dropoutThresholdMs = settings.proposalDropoutThresholdHours * 60 * 60 * 1000;
      
      // Find the most recent vote
      let lastActivityTime = proposal.createdAt;
      for (const vote of proposal.votes) {
        if (vote.timestamp > lastActivityTime) {
          lastActivityTime = vote.timestamp;
        }
      }
      
      // Check if inactive for too long
      if (now - lastActivityTime > dropoutThresholdMs) {
        const anomaly: ClusterAnomaly = {
          id: `anomaly:${uuidv4()}`,
          clusterId,
          type: AnomalyType.PROPOSAL_DROPOUT,
          timestamp: now,
          details: {
            proposalId: proposal.id,
            lastActivityTime,
            inactiveDurationMs: now - lastActivityTime
          },
          severity: 'medium',
          resolved: false
        };
        
        metrics.anomalies.push(anomaly);
        await this.storeAnomaly(anomaly);
      }
    }
    
    // Check for repeated indecision (tied votes or failed to reach quorum)
    if (proposal.status === 'failed') {
      // Check if the proposal failed due to no quorum
      const quorumFailed = proposal.votes.length < (cluster.agents.length * settings.participationThresholdPercent / 100);
      
      if (quorumFailed) {
        // Check if this cluster has a pattern of quorum failures
        const recentFailedProposals = await this.redis.smembers(
          `governance:clusters:${clusterId}:proposals:failed`
        );
        
        if (recentFailedProposals.length > 0) {
          let quorumFailureCount = 0;
          
          for (const failedId of recentFailedProposals) {
            if (failedId === proposal.id) continue;
            
            const failedProposalData = await this.redis.get(`governance:proposals:${failedId}`);
            if (failedProposalData) {
              const failedProposal = JSON.parse(failedProposalData);
              const failedQuorum = failedProposal.votes.length < (cluster.agents.length * settings.participationThresholdPercent / 100);
              
              if (failedQuorum) {
                quorumFailureCount++;
              }
            }
          }
          
          // If quorum failures exceed threshold, create anomaly
          if (quorumFailureCount >= settings.indecisionThreshold) {
            const anomaly: ClusterAnomaly = {
              id: `anomaly:${uuidv4()}`,
              clusterId,
              type: AnomalyType.REPEATED_INDECISION,
              timestamp: Date.now(),
              details: {
                reason: 'quorum_failures',
                failureCount: quorumFailureCount + 1,
                latestProposalId: proposal.id
              },
              severity: quorumFailureCount >= 5 ? 'high' : 'medium',
              resolved: false
            };
            
            metrics.anomalies.push(anomaly);
            await this.storeAnomaly(anomaly);
          }
        }
      }
      
      // Check for tied votes (equal yes/no)
      const yesVotes = proposal.votes.filter((v: ProposalVote) => v.vote === 'yes').length;
      const noVotes = proposal.votes.filter((v: ProposalVote) => v.vote === 'no').length;
      
      if (yesVotes === noVotes && yesVotes > 0) {
        const anomaly: ClusterAnomaly = {
          id: `anomaly:${uuidv4()}`,
          clusterId,
          type: AnomalyType.REPEATED_INDECISION,
          timestamp: Date.now(),
          details: {
            reason: 'tied_votes',
            proposalId: proposal.id,
            yesVotes,
            noVotes
          },
          severity: 'low',
          resolved: false
        };
        
        metrics.anomalies.push(anomaly);
        await this.storeAnomaly(anomaly);
      }
    }
    
    // Check for low participation
    if (proposal.votes.length < (cluster.agents.length * settings.participationThresholdPercent / 100)) {
      const participationRate = proposal.votes.length / cluster.agents.length * 100;
      
      if (participationRate < settings.participationThresholdPercent) {
        const anomaly: ClusterAnomaly = {
          id: `anomaly:${uuidv4()}`,
          clusterId,
          type: AnomalyType.LOW_PARTICIPATION,
          timestamp: Date.now(),
          details: {
            proposalId: proposal.id,
            participationRate,
            votesReceived: proposal.votes.length,
            totalAgents: cluster.agents.length
          },
          severity: participationRate < 30 ? 'high' : 'medium',
          resolved: false
        };
        
        metrics.anomalies.push(anomaly);
        await this.storeAnomaly(anomaly);
      }
    }
  }
  
  /**
   * Detect rogue agents in a cluster
   * 
   * @param clusterId Cluster ID
   * @param metrics Health metrics to update
   */
  private async detectRogueAgents(
    clusterId: string,
    metrics: ClusterHealthMetrics
  ): Promise<void> {
    const settings = this.settings[clusterId] || this.defaultSettings;
    
    if (!settings.rogueAgentDetectionEnabled) {
      return;
    }
    
    for (const [agentDid, agentMetrics] of Object.entries(metrics.agentMetrics)) {
      // Consider agent rogue if they have:
      // 1. Very low consensus alignment (regularly vote against majority)
      // 2. Sufficient participation to be statistically significant
      
      if (
        agentMetrics.voteCount >= 5 && // Need enough votes for statistical significance
        agentMetrics.consensusAlignment < 30 // Consistently against consensus
      ) {
        const anomaly: ClusterAnomaly = {
          id: `anomaly:${uuidv4()}`,
          clusterId,
          type: AnomalyType.ROGUE_AGENT,
          timestamp: Date.now(),
          details: {
            agentDid,
            consensusAlignment: agentMetrics.consensusAlignment,
            voteCount: agentMetrics.voteCount
          },
          severity: 'high',
          resolved: false
        };
        
        metrics.anomalies.push(anomaly);
        await this.storeAnomaly(anomaly);
        
        logger.warn(
          `Detected rogue agent ${agentDid} in cluster ${clusterId} with ` +
          `${agentMetrics.consensusAlignment.toFixed(2)}% consensus alignment`
        );
      }
    }
  }
  
  /**
   * Calculate a cluster's overall health score
   * 
   * @param metrics Cluster health metrics
   * @returns Health score (0-100)
   */
  private calculateClusterHealthScore(metrics: ClusterHealthMetrics): number {
    // Weights for each component
    const weights = {
      participation: 0.3,
      quorumSuccess: 0.3,
      agentHealth: 0.2,
      anomalies: 0.2
    };
    
    // Calculate agent health component
    let agentHealthScore = 0;
    let agentCount = 0;
    
    for (const agentMetrics of Object.values(metrics.agentMetrics)) {
      agentHealthScore += agentMetrics.healthScore;
      agentCount++;
    }
    
    agentHealthScore = agentCount > 0 ? agentHealthScore / agentCount : 100;
    
    // Calculate anomaly penalty
    const anomalyPenalty = metrics.anomalies.reduce((penalty, anomaly) => {
      switch (anomaly.severity) {
        case 'low': return penalty + 5;
        case 'medium': return penalty + 15;
        case 'high': return penalty + 30;
        default: return penalty;
      }
    }, 0);
    
    // Combine components with weights
    let score = 
      (metrics.averageParticipation * weights.participation / 100) +
      (metrics.quorumSuccessRate * weights.quorumSuccess / 100) +
      (agentHealthScore * weights.agentHealth / 100);
    
    // Scale to 0-100 and apply anomaly penalty
    score = Math.max(0, Math.min(100, score * 100 - anomalyPenalty));
    
    return score;
  }
  
  /**
   * Calculate an agent's health score
   * 
   * @param metrics Agent health metrics
   * @returns Health score (0-100)
   */
  private calculateAgentHealthScore(metrics: AgentHealthMetrics): number {
    // Weights for each component
    const weights = {
      participation: 0.6,
      consensusAlignment: 0.3,
      activity: 0.1
    };
    
    // Activity score based on recency of last activity
    const now = Date.now();
    const daysSinceLastActive = (now - metrics.lastActiveTimestamp) / (24 * 60 * 60 * 1000);
    const activityScore = Math.max(0, 100 - (daysSinceLastActive * 10)); // -10 points per day inactive
    
    // Combine components with weights
    const score = 
      (metrics.participationRate * weights.participation / 100) +
      (metrics.consensusAlignment * weights.consensusAlignment / 100) +
      (activityScore * weights.activity / 100);
    
    return Math.max(0, Math.min(100, score * 100));
  }
  
  /**
   * Store an anomaly in Redis
   * 
   * @param anomaly Anomaly to store
   */
  private async storeAnomaly(anomaly: ClusterAnomaly): Promise<void> {
    // Store anomaly
    await this.redis.set(
      `governance:clusters:anomalies:${anomaly.id}`,
      JSON.stringify(anomaly)
    );
    
    // Add to cluster's anomaly index
    await this.redis.sadd(
      `governance:clusters:${anomaly.clusterId}:anomalies`,
      anomaly.id
    );
    
    // Add to global anomaly index
    await this.redis.zadd(
      'governance:clusters:anomalies:all',
      anomaly.timestamp,
      anomaly.id
    );
  }
  
  /**
   * Resolve an anomaly
   * 
   * @param anomalyId Anomaly ID to resolve
   * @param resolutionDetails Details about how the anomaly was resolved
   * @returns Resolved anomaly
   */
  async resolveAnomaly(
    anomalyId: string,
    resolutionDetails: Record<string, any>
  ): Promise<ClusterAnomaly> {
    // Get anomaly
    const anomalyData = await this.redis.get(`governance:clusters:anomalies:${anomalyId}`);
    if (!anomalyData) {
      throw new Error(`Anomaly ${anomalyId} not found`);
    }
    
    const anomaly: ClusterAnomaly = JSON.parse(anomalyData);
    
    // Update anomaly
    anomaly.resolved = true;
    anomaly.resolutionDetails = resolutionDetails;
    
    // Store updated anomaly
    await this.redis.set(
      `governance:clusters:anomalies:${anomalyId}`,
      JSON.stringify(anomaly)
    );
    
    logger.info(`Resolved anomaly ${anomalyId} in cluster ${anomaly.clusterId}`);
    
    return anomaly;
  }
  
  /**
   * Get all unresolved anomalies for a cluster
   * 
   * @param clusterId Cluster ID
   * @returns Array of unresolved anomalies
   */
  async getUnresolvedAnomalies(clusterId: string): Promise<ClusterAnomaly[]> {
    // Get all anomaly IDs for the cluster
    const anomalyIds = await this.redis.smembers(
      `governance:clusters:${clusterId}:anomalies`
    );
    
    // Get anomaly data
    const anomalies: ClusterAnomaly[] = [];
    
    for (const id of anomalyIds) {
      const anomalyData = await this.redis.get(`governance:clusters:anomalies:${id}`);
      if (anomalyData) {
        const anomaly: ClusterAnomaly = JSON.parse(anomalyData);
        if (!anomaly.resolved) {
          anomalies.push(anomaly);
        }
      }
    }
    
    return anomalies;
  }
  
  /**
   * Get the latest health metrics for a cluster
   * 
   * @param clusterId Cluster ID
   * @returns Latest health metrics or null if not found
   */
  async getLatestHealthMetrics(clusterId: string): Promise<ClusterHealthMetrics | null> {
    const metricsData = await this.redis.get(`governance:clusters:health:${clusterId}:latest`);
    return metricsData ? JSON.parse(metricsData) : null;
  }
} 