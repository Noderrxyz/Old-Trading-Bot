import { WebSocketServer, WebSocket } from 'ws';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { AlphaMemoryEngine } from '../memory/AlphaMemoryEngine';
import { AlphaSnapshot } from '../types/AlphaSnapshot';

export class StrategyUpdatesServer {
  private static instance: StrategyUpdatesServer;
  private wss: WebSocketServer;
  private clients: Set<WebSocket>;
  private telemetryBus: TelemetryBus;
  private memoryEngine: AlphaMemoryEngine;

  private constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.clients = new Set();
    this.telemetryBus = TelemetryBus.getInstance();
    this.memoryEngine = AlphaMemoryEngine.getInstance();

    this.setupWebSocket();
    this.setupTelemetry();
  }

  public static getInstance(port: number = 8080): StrategyUpdatesServer {
    if (!StrategyUpdatesServer.instance) {
      StrategyUpdatesServer.instance = new StrategyUpdatesServer(port);
    }
    return StrategyUpdatesServer.instance;
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
      const strategies = await this.memoryEngine.querySnapshots({} as any);
      ws.send(JSON.stringify({
        type: 'initial_state',
        data: strategies
      }));
    } catch (error) {
      console.error('Failed to send initial state:', error);
    }
  }

  private setupTelemetry(): void {
    const events = [
      'strategy_update',
      'strategy_paused',
      'strategy_killed',
      'strategy_cloned',
      'strategy_debug'
    ];

    events.forEach(event => {
      this.telemetryBus.on(event, (data: any) => {
        this.broadcast({
          type: event,
          data
        });
      });
    });
  }

  private broadcast(message: any): void {
    const payload = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  public async updateStrategy(strategy: AlphaSnapshot): Promise<void> {
    await this.memoryEngine.saveSnapshot(strategy);
    this.broadcast({
      type: 'strategy_update',
      data: strategy
    });
  }

  public cleanup(): void {
    this.clients.forEach(client => client.close());
    this.wss.close();
  }
} 