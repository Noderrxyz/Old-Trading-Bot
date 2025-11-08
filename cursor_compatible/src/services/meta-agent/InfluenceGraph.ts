/**
 * Represents an edge in the influence graph between agents
 */
export interface InfluenceEdge {
  from: string;
  to: string;
  weight: number;
  reason: string;
}

/**
 * Graph representation of agent-to-agent influence relationships
 * Used for analyzing influence chains, reward loops, and potential manipulation patterns
 */
export class InfluenceGraph {
  private edges: InfluenceEdge[] = [];
  private nodeSet: Set<string> = new Set();

  /**
   * Add a new edge to the influence graph
   * 
   * @param from The source agent ID
   * @param to The target agent ID
   * @param weight The influence weight/strength
   * @param reason The reason for this influence relationship
   */
  addEdge(from: string, to: string, weight: number, reason: string): void {
    this.edges.push({ from, to, weight, reason });
    this.nodeSet.add(from);
    this.nodeSet.add(to);
  }

  /**
   * Get all edges in the influence graph
   * 
   * @returns A copy of all edges
   */
  getEdges(): InfluenceEdge[] {
    return [...this.edges];
  }

  /**
   * Get all unique node IDs in the graph
   * 
   * @returns Array of all agent IDs in the graph
   */
  getNodes(): string[] {
    return Array.from(this.nodeSet);
  }

  /**
   * Get all agents that influence a specific agent
   * 
   * @param agentId The target agent ID
   * @returns Edges representing incoming influence to this agent
   */
  getInfluencers(agentId: string): InfluenceEdge[] {
    return this.edges.filter(e => e.to === agentId);
  }

  /**
   * Get all agents that are influenced by a specific agent
   * 
   * @param agentId The source agent ID
   * @returns Edges representing outgoing influence from this agent
   */
  getTargets(agentId: string): InfluenceEdge[] {
    return this.edges.filter(e => e.from === agentId);
  }

  /**
   * Get the total incoming influence weight for an agent
   * 
   * @param agentId The agent ID to calculate influence for
   * @returns The sum of all incoming influence weights
   */
  getIncomingInfluenceTotal(agentId: string): number {
    return this.getInfluencers(agentId)
      .reduce((sum, edge) => sum + edge.weight, 0);
  }

  /**
   * Get the total outgoing influence weight from an agent
   * 
   * @param agentId The agent ID to calculate influence for
   * @returns The sum of all outgoing influence weights
   */
  getOutgoingInfluenceTotal(agentId: string): number {
    return this.getTargets(agentId)
      .reduce((sum, edge) => sum + edge.weight, 0);
  }

  /**
   * Convert the graph to an adjacency map for efficient traversal
   * 
   * @returns A map of node IDs to their outgoing edges
   */
  asAdjacencyMap(): Record<string, InfluenceEdge[]> {
    const map: Record<string, InfluenceEdge[]> = {};
    
    for (const edge of this.edges) {
      if (!map[edge.from]) map[edge.from] = [];
      map[edge.from].push(edge);
    }
    
    return map;
  }

  /**
   * Check if the graph contains any circular influence paths
   * 
   * @returns True if circular influence paths exist, false otherwise
   */
  hasCircularInfluence(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const adjMap = this.asAdjacencyMap();
    
    const checkCycle = (node: string): boolean => {
      if (!visited.has(node)) {
        visited.add(node);
        recStack.add(node);
        
        const neighbors = adjMap[node] || [];
        for (const edge of neighbors) {
          if (!visited.has(edge.to) && checkCycle(edge.to)) {
            return true;
          } else if (recStack.has(edge.to)) {
            return true;
          }
        }
      }
      
      recStack.delete(node);
      return false;
    };
    
    for (const node of this.getNodes()) {
      if (checkCycle(node)) {
        return true;
      }
    }
    
    return false;
  }
} 