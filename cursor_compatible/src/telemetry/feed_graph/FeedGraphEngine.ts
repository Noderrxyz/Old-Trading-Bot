import { ValidatorNode } from '../../feeds/validator/ValidatorNode.js';
import { FeedBus } from '../../feeds/publishers/FeedBus.js';
import { AgentRouter } from '../../agents/AgentRouter.js';
import { FeedSource } from '../../types/FeedSource.js';
import logger from '../../utils/logger.js';

interface GraphNode {
  id: string;
  type: 'source' | 'bus' | 'router';
  metadata: {
    latencyMs?: number;
    score?: number;
    quarantined?: boolean;
    lastUpdate?: number;
  };
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'feed' | 'route';
}

export interface FeedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    timestamp: number;
    totalNodes: number;
    quarantinedCount: number;
    averageLatency: number;
  };
}

export class FeedGraphEngine {
  private static instance: FeedGraphEngine;
  private validators: Map<string, ValidatorNode>;
  private feedBus: FeedBus;
  private agentRouter: AgentRouter;

  private constructor() {
    this.validators = new Map();
    this.feedBus = FeedBus.getInstance();
    this.agentRouter = AgentRouter.getInstance();
  }

  public static getInstance(): FeedGraphEngine {
    if (!FeedGraphEngine.instance) {
      FeedGraphEngine.instance = new FeedGraphEngine();
    }
    return FeedGraphEngine.instance;
  }

  public registerValidator(source: FeedSource, validator: ValidatorNode): void {
    this.validators.set(source, validator);
  }

  public generateGraph(): FeedGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let totalLatency = 0;
    let quarantinedCount = 0;

    // Add feed source nodes
    this.validators.forEach((validator, source) => {
      const metrics = validator.getMetrics();
      const isQuarantined = validator.isInQuarantine();
      
      if (isQuarantined) quarantinedCount++;
      totalLatency += metrics.latencyMs;

      nodes.push({
        id: source,
        type: 'source',
        metadata: {
          latencyMs: metrics.latencyMs,
          score: metrics.score,
          quarantined: isQuarantined,
          lastUpdate: metrics.lastUpdate
        }
      });

      // Add edge from source to feed bus
      edges.push({
        source,
        target: 'feed_bus',
        type: 'feed'
      });
    });

    // Add feed bus node
    nodes.push({
      id: 'feed_bus',
      type: 'bus',
      metadata: {
        lastUpdate: Date.now()
      }
    });

    // Add agent router node
    nodes.push({
      id: 'agent_router',
      type: 'router',
      metadata: {
        lastUpdate: Date.now()
      }
    });

    // Add edge from feed bus to agent router
    edges.push({
      source: 'feed_bus',
      target: 'agent_router',
      type: 'route'
    });

    const totalNodes = nodes.length;
    const averageLatency = totalNodes > 0 ? totalLatency / totalNodes : 0;

    return {
      nodes,
      edges,
      metadata: {
        timestamp: Date.now(),
        totalNodes,
        quarantinedCount,
        averageLatency
      }
    };
  }

  public getValidatorMetrics(source: FeedSource) {
    const validator = this.validators.get(source);
    if (!validator) {
      logger.warn(`No validator found for source: ${source}`);
      return null;
    }
    return validator.getMetrics();
  }

  public isSourceQuarantined(source: FeedSource): boolean {
    const validator = this.validators.get(source);
    return validator ? validator.isInQuarantine() : false;
  }
} 