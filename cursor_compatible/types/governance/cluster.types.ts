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
  did: string;          // Decentralized identifier of the agent
  joinedAt: number;     // Timestamp when agent joined the cluster
  role: string;         // Role of the agent within the cluster
  weight: number;       // Voting weight of the agent (for weighted voting)
  reputation: number;   // Reputation score within the cluster
  status: 'active' | 'probation' | 'suspended';
}

/**
 * Role definition within a governance cluster
 */
export interface ClusterRoleDefinition {
  id: string;           // Unique identifier for the role
  name: string;         // Human-readable name
  description: string;  // Description of role responsibilities
  minAgents: number;    // Minimum agents required with this role
  maxAgents: number;    // Maximum agents allowed with this role
  permissions: string[]; // List of permission identifiers
  quorumWeight: number; // Role weight in quorum calculations
  slashableStake: boolean; // Whether role holders can have stake slashed
}

/**
 * Main governance cluster interface
 */
export interface GovernanceCluster {
  id: string;           // Unique identifier for the cluster
  name: string;         // Human-readable name
  scope: 'treasury' | 'infra' | 'legal' | 'growth'; // Domain of authority
  genesisAt: number;    // Timestamp of cluster creation
  agents: AgentRef[];   // Participating agents
  roles: ClusterRoleDefinition[]; // Available roles in the cluster
  proposalTypes: string[]; // Types of proposals this cluster can process
  decisionProtocol: '1-agent-1-vote' | 'stake-weighted' | 'reputation-weighted';
  quorumThreshold: number; // Percentage (0-100) required for proposal passage
  executionDelay: number; // Time (ms) between approval and execution
  metadata: Record<string, any>; // Additional cluster configuration
}

/**
 * Cluster genesis parameters for creating a new governance cluster
 */
export interface ClusterGenesisParams {
  name: string;
  scope: GovernanceCluster['scope'];
  founderDids: string[]; // DIDs of founding agents
  roles: Omit<ClusterRoleDefinition, 'id'>[]; // Role definitions without IDs
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
  quorumStatus: Record<string, boolean>; // proposalId -> quorum met
  agentParticipation: Record<string, number>; // agentDid -> participation %
  healthScore: number; // 0-100 score of cluster health
} 