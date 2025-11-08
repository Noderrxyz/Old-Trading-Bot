import { WebSocket, WebSocketServer } from 'ws';
import { FeedGraphEngine } from '../../telemetry/feed_graph/FeedGraphEngine.js';
import logger from '../../utils/logger.js';
import { FeedGraph } from '../../telemetry/feed_graph/FeedGraphEngine.js';

interface TelemetryFrame {
  type: 'feed_graph';
  timestamp: number;
  data: FeedGraph;
}

export class TelemetryWebSocket {
  private static instance: TelemetryWebSocket;
  private wss: WebSocketServer | null;
  private engine: FeedGraphEngine;
  private clients: Set<WebSocket>;
  private broadcastInterval: NodeJS.Timeout | null;

  private constructor() {
    this.wss = null;
    this.engine = FeedGraphEngine.getInstance();
    this.clients = new Set();
    this.broadcastInterval = null;
  }

  public static getInstance(): TelemetryWebSocket {
    if (!TelemetryWebSocket.instance) {
      TelemetryWebSocket.instance = new TelemetryWebSocket();
    }
    return TelemetryWebSocket.instance;
  }

  public setupWebSocketServer(port: number): void {
    if (this.wss) {
      logger.warn('WebSocket server is already running');
      return;
    }

    this.wss = new WebSocketServer({ port });
    logger.info(`WebSocket server started on port ${port}`);

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      logger.info('New WebSocket client connected');

      // Send initial graph
      const initialFrame: TelemetryFrame = {
        type: 'feed_graph',
        timestamp: Date.now(),
        data: this.engine.generateGraph()
      };
      ws.send(JSON.stringify(initialFrame));

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    // Start broadcasting updates
    this.broadcastInterval = setInterval(() => {
      this.broadcastUpdate();
    }, 1000); // Update every second
  }

  private broadcastUpdate(): void {
    if (this.clients.size === 0) return;

    const frame: TelemetryFrame = {
      type: 'feed_graph',
      timestamp: Date.now(),
      data: this.engine.generateGraph()
    };

    const message = JSON.stringify(frame);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public stop(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.wss) {
      this.clients.forEach((client) => {
        client.close();
      });
      this.clients.clear();
      this.wss.close();
      this.wss = null;
      logger.info('WebSocket server stopped');
    }
  }
} 