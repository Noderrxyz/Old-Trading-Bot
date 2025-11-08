import { TelemetryBus } from '../telemetry/TelemetryBus';

interface FeedNode {
  id: string;
  type: 'cex' | 'dex';
  latency: number;
  trust: number;
  status: 'healthy' | 'delayed' | 'broken';
  markets: string[];
  last_heartbeat: number;
}

interface FeedEdge {
  source: string;
  target: string;
  weight: number;
}

interface FeedGraphData {
  nodes: FeedNode[];
  edges: FeedEdge[];
}

export class FeedGraphEngine {
  private static instance: FeedGraphEngine;
  private telemetryBus: TelemetryBus;
  private feeds: Map<string, FeedNode>;
  private lastUpdate: number;

  private constructor() {
    this.telemetryBus = TelemetryBus.getInstance();
    this.feeds = new Map();
    this.lastUpdate = Date.now();

    this.setupTelemetry();
  }

  public static getInstance(): FeedGraphEngine {
    if (!FeedGraphEngine.instance) {
      FeedGraphEngine.instance = new FeedGraphEngine();
    }
    return FeedGraphEngine.instance;
  }

  private setupTelemetry(): void {
    this.telemetryBus.on('feed_metrics', (event: any) => {
      const { id, type, latency, trust, markets, heartbeat } = event.data;
      
      const status = this.determineStatus(latency, trust);
      this.feeds.set(id, {
        id,
        type,
        latency,
        trust,
        status,
        markets,
        last_heartbeat: heartbeat
      });

      this.lastUpdate = Date.now();
    });
  }

  private determineStatus(latency: number, trust: number): 'healthy' | 'delayed' | 'broken' {
    if (latency > 1000 || trust < 0.5) {
      return 'broken';
    }
    if (latency > 500 || trust < 0.8) {
      return 'delayed';
    }
    return 'healthy';
  }

  public async generateGraph(): Promise<FeedGraphData> {
    // Clean up stale feeds (no updates in last 30 seconds)
    const now = Date.now();
    for (const [id, feed] of this.feeds.entries()) {
      if (now - feed.last_heartbeat > 30000) {
        this.feeds.delete(id);
      }
    }

    const nodes = Array.from(this.feeds.values());
    const edges = this.generateEdges(nodes);

    return { nodes, edges };
  }

  private generateEdges(nodes: FeedNode[]): FeedEdge[] {
    const edges: FeedEdge[] = [];
    const executionCore = 'execution_core';

    // Connect each feed to the execution core
    nodes.forEach(node => {
      edges.push({
        source: node.id,
        target: executionCore,
        weight: node.trust
      });
    });

    return edges;
  }

  public cleanup(): void {
    this.feeds.clear();
  }
} 