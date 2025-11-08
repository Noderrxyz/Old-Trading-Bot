/**
 * Speciation Ledger
 * 
 * Records and tracks the history of agent speciation and lineage.
 * Maintains an immutable record of evolutionary events.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { AgentLineage, AgentLineageGraph } from '../../../types/agent.types.js';

/**
 * Options for the speciation ledger
 */
export interface SpeciationLedgerOptions {
  /** Storage backend type */
  storageType?: 'memory' | 'redis' | 'postgres';
  
  /** Whether to emit events on changes */
  emitEvents?: boolean;
  
  /** Time-to-live for records in milliseconds (0 = no expiry) */
  ttlMs?: number;
}

/**
 * Default options for the speciation ledger
 */
const DEFAULT_OPTIONS: Required<SpeciationLedgerOptions> = {
  storageType: 'memory',
  emitEvents: true,
  ttlMs: 0 // No expiry
};

/**
 * Speciation Ledger for tracking agent evolution and lineage
 */
export class SpeciationLedger {
  private options: Required<SpeciationLedgerOptions>;
  private lineageRecords: Map<string, AgentLineage> = new Map();
  private parentChildMap: Map<string, string[]> = new Map();
  
  /**
   * Create a new speciation ledger
   * 
   * @param options Ledger options
   */
  constructor(options: SpeciationLedgerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    logger.info('Speciation Ledger initialized', { storageType: this.options.storageType });
  }
  
  /**
   * Record a speciation event
   * 
   * @param record Lineage record to save
   * @returns The saved record
   */
  public async recordSpeciationEvent(record: AgentLineage): Promise<AgentLineage> {
    // If no timestamp provided, add one
    if (!record.createdAt) {
      record.createdAt = Date.now();
    }
    
    // Store the record
    this.lineageRecords.set(record.agentId, record);
    
    // Update parent-child relationships
    if (record.parentId) {
      if (!this.parentChildMap.has(record.parentId)) {
        this.parentChildMap.set(record.parentId, []);
      }
      
      const children = this.parentChildMap.get(record.parentId)!;
      if (!children.includes(record.agentId)) {
        children.push(record.agentId);
        this.parentChildMap.set(record.parentId, children);
      }
    }
    
    logger.info(`Recorded speciation event for agent ${record.agentId} in cluster ${record.clusterId}`, {
      generation: record.generation,
      parentId: record.parentId
    });
    
    return record;
  }
  
  /**
   * Get the lineage record for an agent
   * 
   * @param agentId Agent ID to look up
   * @returns Lineage record or undefined if not found
   */
  public async getAgentLineage(agentId: string): Promise<AgentLineage | undefined> {
    return this.lineageRecords.get(agentId);
  }
  
  /**
   * Get all descendants of an agent
   * 
   * @param agentId Agent ID to get descendants for
   * @returns Array of descendant agent IDs
   */
  public async getDescendants(agentId: string): Promise<string[]> {
    const descendants: string[] = [];
    const pending: string[] = [agentId];
    
    // Breadth-first traversal of the lineage tree
    while (pending.length > 0) {
      const currentId = pending.shift()!;
      const children = this.parentChildMap.get(currentId) || [];
      
      for (const childId of children) {
        if (!descendants.includes(childId)) {
          descendants.push(childId);
          pending.push(childId);
        }
      }
    }
    
    return descendants;
  }
  
  /**
   * Get the complete lineage tree for an agent
   * 
   * @param agentId Root agent ID for the lineage tree
   * @returns Lineage graph or undefined if agent not found
   */
  public async getLineageTree(agentId: string): Promise<AgentLineageGraph | undefined> {
    const rootRecord = await this.getAgentLineage(agentId);
    if (!rootRecord) {
      return undefined;
    }
    
    const nodes: AgentLineage[] = [rootRecord];
    const edges: Array<{ source: string, target: string, mutationType: string }> = [];
    const pending: string[] = [agentId];
    const visited = new Set<string>([agentId]);
    
    // Breadth-first traversal to build the graph
    while (pending.length > 0) {
      const currentId = pending.shift()!;
      const children = this.parentChildMap.get(currentId) || [];
      
      for (const childId of children) {
        if (!visited.has(childId)) {
          const childRecord = await this.getAgentLineage(childId);
          if (childRecord) {
            nodes.push(childRecord);
            edges.push({
              source: currentId,
              target: childId,
              mutationType: childRecord.mutationReason
            });
            
            visited.add(childId);
            pending.push(childId);
          }
        }
      }
    }
    
    return { nodes, edges };
  }
  
  /**
   * Get the full agent evolution graph for all agents
   * 
   * @returns Complete evolution graph
   */
  public async getSpeciationTree(): Promise<AgentLineageGraph> {
    const nodes: AgentLineage[] = Array.from(this.lineageRecords.values());
    const edges: Array<{ source: string, target: string, mutationType: string }> = [];
    
    // Build edges from parent-child relationships
    for (const record of nodes) {
      if (record.parentId) {
        edges.push({
          source: record.parentId,
          target: record.agentId,
          mutationType: record.mutationReason
        });
      }
    }
    
    return { nodes, edges };
  }
  
  /**
   * Get all agents in a specific generation
   * 
   * @param generation Generation number
   * @returns Array of lineage records for that generation
   */
  public async getGenerationAgents(generation: number): Promise<AgentLineage[]> {
    return Array.from(this.lineageRecords.values())
      .filter(record => record.generation === generation);
  }
  
  /**
   * Get all agents in a specific cluster
   * 
   * @param clusterId Cluster ID
   * @returns Array of lineage records for that cluster
   */
  public async getClusterAgents(clusterId: string): Promise<AgentLineage[]> {
    return Array.from(this.lineageRecords.values())
      .filter(record => record.clusterId === clusterId);
  }
} 