import { WebSocketServer, WebSocket } from 'ws';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { FeedGraphEngine } from '../feed/FeedGraphEngine';

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

export class FeedGraphUpdatesServer {
  private static instance: FeedGraphUpdatesServer;
  private wss: WebSocketServer;
  private clients: Set<WebSocket>;
  private telemetryBus: TelemetryBus;
  private feedGraphEngine: FeedGraphEngine;
  private updateInterval: NodeJS.Timeout | null = null;

  private constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.clients = new Set();
    this.telemetryBus = TelemetryBus.getInstance();
    this.feedGraphEngine = FeedGraphEngine.getInstance();

    this.setupWebSocket();
    this.startUpdates();
  }

  public static getInstance(port: number = 8081): FeedGraphUpdatesServer {
    if (!FeedGraphUpdatesServer.instance) {
      FeedGraphUpdatesServer.instance = new FeedGraphUpdatesServer(port);
    }
    return FeedGraphUpdatesServer.instance;
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // Send initial state
      this.sendInitialState(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  private async sendInitialState(ws: WebSocket): Promise<void> {
    try {
      const graphData = await this.feedGraphEngine.generateGraph();
      ws.send(JSON.stringify({
        type: 'initial_state',
        data: graphData
      }));
    } catch (error) {
      console.error('Failed to send initial state:', error);
    }
  }

  private startUpdates(): void {
    this.updateInterval = setInterval(async () => {
      try {
        const graphData = await this.feedGraphEngine.generateGraph();
        this.broadcast({
          type: 'feed_graph_updates',
          data: graphData
        });
        this.telemetryBus.emit('feed_graph_updates', graphData);
      } catch (error) {
        console.error('Failed to update feed graph:', error);
      }
    }, 5000); // Update every 5 seconds
  }

  private broadcast(message: any): void {
    const payload = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  public cleanup(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.clients.forEach(client => client.close());
    this.wss.close();
  }
} 