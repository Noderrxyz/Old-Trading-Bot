/**
 * Governance Cluster Manager
 * 
 * Responsible for managing autonomous governance clusters, including:
 * - Cluster creation (genesis)
 * - Agent assignment and role management
 * - Cluster metadata and configuration
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../common/logger.js';
import { 
  GovernanceCluster,
  AgentRef,
  ClusterRoleDefinition,
  ClusterGenesisParams,
  ClusterConsensusState
} from '../../types/governance/cluster.types.js';

// Logger for cluster operations
const logger = createLogger('ClusterManager');

export class ClusterManager {
  private redis: Redis.Redis;
  
  constructor(redis: Redis.Redis) {
    this.redis = redis;
  }
  
  /**
   * Create a new governance cluster
   * 
   * @param params Cluster genesis parameters
   * @returns Newly created cluster
   */
  async createCluster(params: ClusterGenesisParams): Promise<GovernanceCluster> {
    logger.info(`Creating new ${params.scope} governance cluster: ${params.name}`);
    
    // Generate cluster ID
    const clusterId = `cluster:${uuidv4()}`;
    const now = Date.now();
    
    // Validate genesis parameters
    this.validateGenesisParams(params);
    
    // Create roles with generated IDs
    const roles: ClusterRoleDefinition[] = params.roles.map((role: Omit<ClusterRoleDefinition, 'id'>) => ({
      ...role,
      id: `role:${uuidv4()}`
    }));
    
    // Create initial agent references
    const agents: AgentRef[] = params.founderDids.map((did: string) => ({
      did,
      joinedAt: now,
      role: roles[0].id, // Default to first role for founders
      weight: this.calculateInitialWeight(params.decisionProtocol),
      reputation: 100, // Start with perfect reputation
      status: 'active'
    }));
    
    // Construct the cluster
    const cluster: GovernanceCluster = {
      id: clusterId,
      name: params.name,
      scope: params.scope,
      genesisAt: now,
      agents,
      roles,
      proposalTypes: params.proposalTypes,
      decisionProtocol: params.decisionProtocol,
      quorumThreshold: params.quorumThreshold,
      executionDelay: params.executionDelay,
      metadata: params.metadata || {}
    };
    
    // Store in Redis
    await this.redis.set(
      `governance:clusters:${clusterId}`,
      JSON.stringify(cluster)
    );
    
    // Add to cluster index
    await this.redis.sadd('governance:clusters:index', clusterId);
    
    // Add to scope index
    await this.redis.sadd(`governance:clusters:scope:${params.scope}`, clusterId);
    
    // Add agents to cluster index
    for (const agent of agents) {
      await this.redis.sadd(`governance:agent:${agent.did}:clusters`, clusterId);
    }
    
    // Initialize cluster consensus state
    await this.initializeConsensusState(clusterId);
    
    logger.info(`Created cluster ${clusterId} with ${agents.length} founding agents`);
    return cluster;
  }
  
  /**
   * Validate cluster genesis parameters
   * 
   * @param params Genesis parameters to validate
   * @throws Error if parameters are invalid
   */
  private validateGenesisParams(params: ClusterGenesisParams): void {
    // Name length
    if (!params.name || params.name.length < 3) {
      throw new Error('Cluster name must be at least 3 characters');
    }
    
    // Founder DIDs
    if (!params.founderDids || params.founderDids.length < 1) {
      throw new Error('At least one founding agent is required');
    }
    
    // Roles
    if (!params.roles || params.roles.length < 1) {
      throw new Error('At least one role definition is required');
    }
    
    // Proposal types
    if (!params.proposalTypes || params.proposalTypes.length < 1) {
      throw new Error('At least one proposal type is required');
    }
    
    // Quorum threshold
    if (params.quorumThreshold < 1 || params.quorumThreshold > 100) {
      throw new Error('Quorum threshold must be between 1 and 100');
    }
  }
  
  /**
   * Calculate initial agent weight based on decision protocol
   * 
   * @param protocol Decision protocol
   * @returns Initial weight
   */
  private calculateInitialWeight(protocol: GovernanceCluster['decisionProtocol']): number {
    switch (protocol) {
      case '1-agent-1-vote':
        return 1;
      case 'stake-weighted':
        return 10; // Default stake
      case 'reputation-weighted':
        return 100; // Default reputation
      default:
        return 1;
    }
  }
  
  /**
   * Initialize consensus state for a new cluster
   * 
   * @param clusterId Cluster ID
   */
  private async initializeConsensusState(clusterId: string): Promise<void> {
    const consensusState: ClusterConsensusState = {
      clusterId,
      activeProposals: 0,
      latestSyncTimestamp: Date.now(),
      quorumStatus: {},
      agentParticipation: {},
      healthScore: 100
    };
    
    await this.redis.set(
      `governance:clusters:consensus:${clusterId}`,
      JSON.stringify(consensusState)
    );
  }
  
  /**
   * Add an agent to a cluster
   * 
   * @param clusterId Cluster ID
   * @param agentDid Agent DID
   * @param role Role ID
   * @returns Updated cluster
   */
  async addAgentToCluster(
    clusterId: string,
    agentDid: string,
    role: string
  ): Promise<GovernanceCluster> {
    const cluster = await this.getCluster(clusterId);
    
    // Validate role
    const roleDefinition = cluster.roles.find((r: ClusterRoleDefinition) => r.id === role);
    if (!roleDefinition) {
      throw new Error(`Role ${role} does not exist in cluster ${clusterId}`);
    }
    
    // Check if agent already exists
    if (cluster.agents.some((a: AgentRef) => a.did === agentDid)) {
      throw new Error(`Agent ${agentDid} is already in cluster ${clusterId}`);
    }
    
    // Check role capacity
    const agentsInRole = cluster.agents.filter((a: AgentRef) => a.role === role).length;
    if (agentsInRole >= roleDefinition.maxAgents) {
      throw new Error(`Role ${role} is at maximum capacity (${roleDefinition.maxAgents})`);
    }
    
    // Add agent
    const newAgent: AgentRef = {
      did: agentDid,
      joinedAt: Date.now(),
      role,
      weight: this.calculateInitialWeight(cluster.decisionProtocol),
      reputation: 100,
      status: 'active'
    };
    
    cluster.agents.push(newAgent);
    
    // Update in Redis
    await this.redis.set(
      `governance:clusters:${clusterId}`,
      JSON.stringify(cluster)
    );
    
    // Add to agent's cluster index
    await this.redis.sadd(`governance:agent:${agentDid}:clusters`, clusterId);
    
    logger.info(`Added agent ${agentDid} to cluster ${clusterId} with role ${role}`);
    return cluster;
  }
  
  /**
   * Get a cluster by ID
   * 
   * @param clusterId Cluster ID
   * @returns Cluster data
   */
  async getCluster(clusterId: string): Promise<GovernanceCluster> {
    const clusterData = await this.redis.get(`governance:clusters:${clusterId}`);
    
    if (!clusterData) {
      throw new Error(`Cluster ${clusterId} not found`);
    }
    
    return JSON.parse(clusterData);
  }
  
  /**
   * Get all clusters with optional scope filter
   * 
   * @param scope Optional scope filter
   * @returns Array of clusters
   */
  async getClusters(scope?: GovernanceCluster['scope']): Promise<GovernanceCluster[]> {
    let clusterIds: string[];
    
    if (scope) {
      clusterIds = await this.redis.smembers(`governance:clusters:scope:${scope}`);
    } else {
      clusterIds = await this.redis.smembers('governance:clusters:index');
    }
    
    const clusters = await Promise.all(
      clusterIds.map(id => this.getCluster(id))
    );
    
    return clusters;
  }
  
  /**
   * Update a cluster's configuration
   * 
   * @param clusterId Cluster ID
   * @param updates Partial updates to apply
   * @returns Updated cluster
   */
  async updateCluster(
    clusterId: string,
    updates: Partial<Omit<GovernanceCluster, 'id' | 'genesisAt'>>
  ): Promise<GovernanceCluster> {
    const cluster = await this.getCluster(clusterId);
    
    // Apply updates
    const updatedCluster = {
      ...cluster,
      ...updates,
      id: cluster.id, // Ensure ID can't be changed
      genesisAt: cluster.genesisAt, // Ensure genesis timestamp can't be changed
    };
    
    // Update in Redis
    await this.redis.set(
      `governance:clusters:${clusterId}`,
      JSON.stringify(updatedCluster)
    );
    
    // Update scope index if scope changed
    if (updates.scope && updates.scope !== cluster.scope) {
      await this.redis.srem(`governance:clusters:scope:${cluster.scope}`, clusterId);
      await this.redis.sadd(`governance:clusters:scope:${updates.scope}`, clusterId);
    }
    
    logger.info(`Updated cluster ${clusterId}`);
    return updatedCluster;
  }
  
  /**
   * Get consensus state for a cluster
   * 
   * @param clusterId Cluster ID
   * @returns Current consensus state
   */
  async getConsensusState(clusterId: string): Promise<ClusterConsensusState> {
    const stateData = await this.redis.get(`governance:clusters:consensus:${clusterId}`);
    
    if (!stateData) {
      throw new Error(`Consensus state for cluster ${clusterId} not found`);
    }
    
    return JSON.parse(stateData);
  }
} 