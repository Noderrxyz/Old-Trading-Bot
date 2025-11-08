/**
 * WebSocket Service
 * 
 * Service for managing WebSocket connections and broadcasting agent comparison updates
 */

import { Server as WebSocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { createLogger } from '../../common/logger.js';
import { AgentComparisonUpdate } from '../types.js';
import { AgentMetricsService } from './agentMetricsService.js';

const logger = createLogger('WebSocketService');

/**
 * Service for managing WebSocket connections
 */
export class WebSocketService {
  private io: WebSocketServer;
  private metricsService: AgentMetricsService;
  private updateInterval: NodeJS.Timeout | null = null;
  private intervalMs: number = 5000; // Default to 5 seconds

  /**
   * Create a new WebSocket service
   * @param server HTTP server to attach to
   * @param metricsService Agent metrics service
   */
  constructor(server: HttpServer, metricsService: AgentMetricsService) {
    this.io = new WebSocketServer(server, {
      cors: {
        origin: '*', // In production, restrict this to your frontend domains
        methods: ['GET', 'POST']
      }
    });
    
    this.metricsService = metricsService;
    
    // Initialize socket connections
    this.initialize();
  }

  /**
   * Initialize WebSocket service
   */
  private initialize(): void {
    this.io.on('connection', (socket) => {
      logger.info(`New WebSocket connection established: ${socket.id}`);
      
      // Join the agent_comparison channel by default
      socket.join('agent_comparison');
      
      // Handle subscription to specific agent update channels
      socket.on('subscribe_agents', (agentIds: string[]) => {
        if (Array.isArray(agentIds)) {
          // Join agent-specific channels
          for (const agentId of agentIds) {
            socket.join(`agent:${agentId}`);
          }
          logger.info(`Socket ${socket.id} subscribed to agents: ${agentIds.join(', ')}`);
        }
      });
      
      // Handle unsubscription from agent channels
      socket.on('unsubscribe_agents', (agentIds: string[]) => {
        if (Array.isArray(agentIds)) {
          // Leave agent-specific channels
          for (const agentId of agentIds) {
            socket.leave(`agent:${agentId}`);
          }
          logger.info(`Socket ${socket.id} unsubscribed from agents: ${agentIds.join(', ')}`);
        }
      });
      
      // Handle update interval change
      socket.on('set_update_interval', (intervalMs: number) => {
        if (typeof intervalMs === 'number' && intervalMs >= 1000) {
          // Only allow authorized clients to change interval
          // For now, accept any client's request
          this.setUpdateInterval(intervalMs);
          logger.info(`Update interval changed to ${intervalMs}ms by socket ${socket.id}`);
        }
      });
      
      // Handle disconnect
      socket.on('disconnect', () => {
        logger.info(`WebSocket connection closed: ${socket.id}`);
      });
    });
    
    logger.info('WebSocket service initialized');
  }

  /**
   * Start broadcasting agent comparison updates
   */
  public start(): void {
    // Clear any existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    // Start new interval
    this.updateInterval = setInterval(
      () => this.broadcastAgentComparison(),
      this.intervalMs
    );
    
    logger.info(`WebSocket service started with ${this.intervalMs}ms update interval`);
  }

  /**
   * Stop broadcasting agent comparison updates
   */
  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      logger.info('WebSocket service stopped');
    }
  }

  /**
   * Set the update interval
   * @param intervalMs Interval in milliseconds
   */
  public setUpdateInterval(intervalMs: number): void {
    if (intervalMs < 1000) {
      logger.warn(`Requested interval ${intervalMs}ms is too small, using 1000ms instead`);
      intervalMs = 1000;
    }
    
    this.intervalMs = intervalMs;
    
    // Restart broadcasts with new interval
    if (this.updateInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Broadcast agent comparison update to all clients
   */
  private async broadcastAgentComparison(): Promise<void> {
    try {
      // Get performance snapshots for all agents
      const snapshots = await this.metricsService.getAgentPerformanceSnapshots();
      
      // Convert to WebSocket update format
      const update: AgentComparisonUpdate = {
        agents: snapshots.map(snapshot => ({
          id: snapshot.agentId,
          name: snapshot.name,
          mode: snapshot.isCanary ? 'canary' : 'live',
          cumulativePnL: snapshot.cumulativePnL,
          avgLatency: snapshot.avgLatency,
          winRate: snapshot.winRate,
          drawdownMax: snapshot.maxDrawdownPct,
          signalCount: snapshot.signalCount,
          timestamp: snapshot.timestamp
        }))
      };
      
      // Broadcast to agent_comparison channel
      this.io.to('agent_comparison').emit('agent_comparison_update', update);
      
      // Also broadcast individual updates to agent-specific channels
      for (const agent of update.agents) {
        this.io.to(`agent:${agent.id}`).emit('agent_update', agent);
      }
      
      logger.debug(`Broadcasted comparison update for ${update.agents.length} agents`);
    } catch (error) {
      logger.error(`Failed to broadcast agent comparison: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the Socket.IO server instance
   */
  public getIO(): WebSocketServer {
    return this.io;
  }
} 