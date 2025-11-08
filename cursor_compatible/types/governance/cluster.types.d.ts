/**
 * Governance Cluster Type Definitions
 *
 * Defines the core types for autonomous multi-agent governance clusters
 * that enable decentralized decision-making pods across federated systems.
 */
/**
 * Reference to an agent participating in a governance cluster
 */
export interface AgentRef {
    did: string;
    joinedAt: number;
    role: string;
    weight: number;
    reputation: number;
    status: 'active' | 'probation' | 'suspended';
}
/**
 * Role definition within a governance cluster
 */
export interface ClusterRoleDefinition {
    id: string;
    name: string;
    description: string;
    minAgents: number;
    maxAgents: number;
    permissions: string[];
    quorumWeight: number;
    slashableStake: boolean;
}
/**
 * Main governance cluster interface
 */
export interface GovernanceCluster {
    id: string;
    name: string;
    scope: 'treasury' | 'infra' | 'legal' | 'growth';
    genesisAt: number;
    agents: AgentRef[];
    roles: ClusterRoleDefinition[];
    proposalTypes: string[];
    decisionProtocol: '1-agent-1-vote' | 'stake-weighted' | 'reputation-weighted';
    quorumThreshold: number;
    executionDelay: number;
    metadata: Record<string, any>;
}
/**
 * Cluster genesis parameters for creating a new governance cluster
 */
export interface ClusterGenesisParams {
    name: string;
    scope: GovernanceCluster['scope'];
    founderDids: string[];
    roles: Omit<ClusterRoleDefinition, 'id'>[];
    proposalTypes: string[];
    decisionProtocol: GovernanceCluster['decisionProtocol'];
    quorumThreshold: number;
    executionDelay: number;
    metadata?: Record<string, any>;
}
/**
 * Current consensus state of a cluster
 */
export interface ClusterConsensusState {
    clusterId: string;
    activeProposals: number;
    latestSyncTimestamp: number;
    quorumStatus: Record<string, boolean>;
    agentParticipation: Record<string, number>;
    healthScore: number;
}
//# sourceMappingURL=cluster.types.d.ts.map