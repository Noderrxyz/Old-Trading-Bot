import { v4 as uuidv4 } from 'uuid';
import { InfluenceGraph } from './InfluenceGraph.js';

/**
 * Represents a reinforcement event between agents
 */
export interface ReinforcementEvent {
  id: string;
  timestamp: number;
  sourceAgent: string;
  targetAgent: string;
  reason: string;
  weight: number;
  decayTTL: number; // milliseconds
  tags?: string[];
}

/**
 * Centralized log for all agent-to-agent reinforcement events
 * Tracks who rewarded whom, for what, and why
 */
export class ReinforcementLog {
  private log: ReinforcementEvent[] = [];

  /**
   * Record a new reinforcement event in the log
   * 
   * @param event The reinforcement event details (ID and timestamp will be auto-generated)
   * @returns The complete reinforcement event that was recorded
   */
  record(event: Omit<ReinforcementEvent, 'id' | 'timestamp'>): ReinforcementEvent {
    const fullEvent: ReinforcementEvent = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...event
    };

    this.log.push(fullEvent);
    return fullEvent;
  }

  /**
   * Get all recorded reinforcement events
   * 
   * @returns A copy of all events in the log
   */
  getAll(): ReinforcementEvent[] {
    return [...this.log];
  }

  /**
   * Get all events related to a specific agent
   * 
   * @param agentId The agent ID to filter by (as source or target)
   * @returns All events where the agent is either the source or target
   */
  getByAgent(agentId: string): ReinforcementEvent[] {
    return this.log.filter(e => e.sourceAgent === agentId || e.targetAgent === agentId);
  }

  /**
   * Get all events where an agent is the source
   * 
   * @param agentId The agent ID to filter by (as source)
   * @returns All events where the agent is the source
   */
  getBySourceAgent(agentId: string): ReinforcementEvent[] {
    return this.log.filter(e => e.sourceAgent === agentId);
  }

  /**
   * Get all events where an agent is the target
   * 
   * @param agentId The agent ID to filter by (as target)
   * @returns All events where the agent is the target
   */
  getByTargetAgent(agentId: string): ReinforcementEvent[] {
    return this.log.filter(e => e.targetAgent === agentId);
  }

  /**
   * Get events filtered by tags
   * 
   * @param tags Tags to filter by (events must have at least one of these tags)
   * @returns Events matching the tag filter
   */
  getByTags(tags: string[]): ReinforcementEvent[] {
    return this.log.filter(e => e.tags?.some(tag => tags.includes(tag)));
  }

  /**
   * Remove expired events from the log
   * Events are considered expired when current time > timestamp + decayTTL
   */
  pruneExpired(): void {
    const now = Date.now();
    this.log = this.log.filter(e => (e.timestamp + e.decayTTL) > now);
  }

  /**
   * Convert the reinforcement log to an influence graph
   * 
   * @returns An InfluenceGraph representing agent-to-agent relationships
   */
  toGraph(): InfluenceGraph {
    const graph = new InfluenceGraph();

    for (const event of this.log) {
      graph.addEdge(event.sourceAgent, event.targetAgent, event.weight, event.reason);
    }

    return graph;
  }
} 