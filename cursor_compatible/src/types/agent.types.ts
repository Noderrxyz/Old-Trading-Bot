/**
 * Agent types definitions
 */

/**
 * Agent health modes
 */
export enum AgentHealthMode {
  NORMAL = 'normal',
  SELF_HEALING = 'self_healing',
  CRITICAL = 'critical'
}

/**
 * Agent trust state
 */
export interface AgentTrustState {
  score: number;
  mode: AgentHealthMode;
  enteredSelfHealingAt?: number;
}

/**
 * Agent Lineage System
 * 
 * Types for tracking ancestry and evolution history of each agent.
 */

/**
 * Represents an agent's evolutionary lineage
 */
export interface AgentLineage {
  /** Unique identifier for this agent */
  agentId: string;
  
  /** Parent agent ID (undefined for genesis agents) */
  parentId?: string;
  
  /** Generation number (starts at 0 for genesis agents) */
  generation: number;
  
  /** Reason for the mutation/evolution that created this agent */
  mutationReason: string;
  
  /** Cluster ID this agent belongs to */
  clusterId: string;
  
  /** Timestamp when this lineage record was created */
  createdAt: number;
  
  /** Associated strategy ID */
  strategyId: string;
  
  /** Fitness score at creation time */
  initialFitness?: number;
}

/**
 * Represents a cluster of agents with similar traits
 */
export interface AgentCluster {
  /** Unique identifier for this cluster */
  clusterId: string;
  
  /** Human-readable name for this cluster */
  name: string;
  
  /** Description of this cluster's specialization or traits */
  description: string;
  
  /** Agent IDs belonging to this cluster */
  agentIds: string[];
  
  /** Dominant traits that define this cluster */
  traits: Record<string, any>;
  
  /** Timestamp when this cluster was created */
  createdAt: number;
  
  /** Timestamp when this cluster was last updated */
  updatedAt: number;
}

/**
 * Summary of a cluster after speciation
 */
export interface ClusterSummary {
  /** Cluster ID */
  clusterId: string;
  
  /** Number of agents in the cluster */
  agentCount: number;
  
  /** Average fitness score of agents in the cluster */
  avgFitness: number;
  
  /** Dominant traits of the cluster */
  dominantTraits: Record<string, any>;
  
  /** Agents that were added to the cluster during speciation */
  addedAgentIds: string[];
  
  /** Agents that were removed from the cluster during speciation */
  removedAgentIds: string[];
}

/**
 * Graph representation of agent lineage
 */
export interface AgentLineageGraph {
  /** Nodes represent agents */
  nodes: AgentLineage[];
  
  /** Edges represent parent-child relationships */
  edges: Array<{
    /** Parent agent ID */
    source: string;
    
    /** Child agent ID */
    target: string;
    
    /** Type of mutation that created the child */
    mutationType: string;
  }>;
} 