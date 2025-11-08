/**
 * Evolution Graph Engine
 * 
 * Tracks strategy mutations across agents to enable self-evolution,
 * rollback, and historical analysis.
 */

import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

import { RedisClient } from '../../common/redis.js';
import { PostgresService } from '../infrastructure/PostgresService.js';
import { createLogger } from '../../common/logger.js';

import {
  EvolutionRecord,
  EvolutionGraph,
  EvolutionEdge,
  MetricRecord,
  MutationType,
  PerformanceMetrics,
  RecordMutationOptions
} from './types.js';

// Logger for evolution events
const logger = createLogger('EvolutionGraphEngine');

/**
 * WebSocket server for real-time evolution events
 */
interface WebSocketServer {
  clients: Set<WebSocket>;
  broadcast(event: string, data: any): void;
}

/**
 * Default options for recording mutations
 */
const DEFAULT_RECORD_OPTIONS: RecordMutationOptions = {
  emitTelemetry: true,
  publishEvent: true
};

/**
 * Engine for tracking and managing strategy evolution
 */
export class EvolutionGraphEngine {
  private redisClient: RedisClient;
  private postgresService: PostgresService;
  private wsServer?: WebSocketServer;
  public static instance: EvolutionGraphEngine | null = null;

  /**
   * Create a new evolution graph engine
   * 
   * @param redisClient Redis client for fast lookups and caching
   * @param postgresService PostgreSQL service for persistent storage
   * @param wsServer Optional WebSocket server for real-time events
   */
  constructor(
    redisClient: RedisClient,
    postgresService: PostgresService,
    wsServer?: WebSocketServer
  ) {
    this.redisClient = redisClient;
    this.postgresService = postgresService;
    this.wsServer = wsServer;
  }

  /**
   * Get the singleton instance of the evolution graph engine
   * 
   * @param redisClient Redis client
   * @param postgresService PostgreSQL service
   * @param wsServer Optional WebSocket server
   * @returns Evolution graph engine instance
   */
  public static getInstance(
    redisClient: RedisClient,
    postgresService: PostgresService,
    wsServer?: WebSocketServer
  ): EvolutionGraphEngine {
    if (!EvolutionGraphEngine.instance) {
      EvolutionGraphEngine.instance = new EvolutionGraphEngine(
        redisClient,
        postgresService,
        wsServer
      );
    }
    return EvolutionGraphEngine.instance;
  }

  /**
   * Initialize the evolution graph engine
   * Ensures PostgreSQL tables are created
   */
  public async initialize(): Promise<void> {
    try {
      // Initialize PostgreSQL tables
      await this.postgresService.initialize();

      logger.info('Evolution Graph Engine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Evolution Graph Engine:', error);
      throw error;
    }
  }

  /**
   * Record a strategy mutation
   * 
   * @param agentId Agent ID
   * @param strategyId Strategy ID
   * @param parentStrategyId Parent strategy ID (undefined for genesis strategies)
   * @param mutationType Type of mutation
   * @param performanceMetrics Performance metrics at time of mutation
   * @param options Additional options for recording
   * @returns The recorded evolution record
   */
  public async recordMutation(
    agentId: string,
    strategyId: string,
    parentStrategyId: string | undefined,
    mutationType: MutationType,
    performanceMetrics: PerformanceMetrics,
    options: RecordMutationOptions = DEFAULT_RECORD_OPTIONS
  ): Promise<EvolutionRecord> {
    try {
      // Generate a unique ID for this evolution record
      const id = uuidv4();
      const timestamp = Date.now();

      // Create the evolution record
      const record: EvolutionRecord = {
        id,
        agentId,
        strategyId,
        parentStrategyId,
        mutationType,
        performanceSnapshot: performanceMetrics,
        timestamp
      };

      // Store in PostgreSQL
      await this.postgresService.query(
        `INSERT INTO strategy_evolution_log
         (id, agent_id, strategy_id, parent_strategy_id, mutation_type, performance_snapshot, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          agentId,
          strategyId,
          parentStrategyId || null,
          mutationType,
          JSON.stringify(performanceMetrics),
          new Date(timestamp)
        ]
      );

      // Store in Redis for faster lookups
      await this.redisClient.lpush(
        `evolution:graph:${agentId}`,
        JSON.stringify(record)
      );

      // Keep Redis list at a reasonable size (last 100 mutations)
      await this.redisClient.ltrim(`evolution:graph:${agentId}`, 0, 99);

      // Store latest strategy ID for quick access
      await this.redisClient.set(`evolution:latest:${agentId}`, strategyId);

      // Emit telemetry if requested
      if (options.emitTelemetry) {
        await this.emitPerformanceMetrics(agentId, strategyId, performanceMetrics);
      }

      // Publish WebSocket event if requested
      if (options.publishEvent && this.wsServer) {
        this.wsServer.broadcast('EVOLUTION_GRAPH_UPDATED', {
          agentId,
          record,
          parentStrategyId
        });
      }

      logger.info(`Recorded mutation for agent ${agentId}, strategy ${strategyId}, type: ${mutationType}`);
      return record;
    } catch (error) {
      logger.error(`Error recording mutation for agent ${agentId}, strategy ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Get the complete lineage for an agent
   * 
   * @param agentId Agent ID
   * @returns Complete evolution graph for the agent
   */
  public async getLineage(agentId: string): Promise<EvolutionGraph> {
    try {
      // Get all evolution records for this agent from PostgreSQL
      const result = await this.postgresService.query<EvolutionRecord>(
        `SELECT 
          id, 
          agent_id as "agentId", 
          strategy_id as "strategyId", 
          parent_strategy_id as "parentStrategyId", 
          mutation_type as "mutationType", 
          performance_snapshot as "performanceSnapshot", 
          EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
         FROM strategy_evolution_log
         WHERE agent_id = $1
         ORDER BY timestamp ASC`,
        [agentId]
      );

      const nodes = result.rows;

      // Build edges from the nodes
      const edges: EvolutionEdge[] = nodes
        .filter(node => node.parentStrategyId) // Filter out genesis nodes
        .map(node => ({
          source: node.parentStrategyId!,
          target: node.strategyId,
          mutationType: node.mutationType,
          timestamp: node.timestamp
        }));

      return {
        agentId,
        nodes,
        edges
      };
    } catch (error) {
      logger.error(`Error retrieving lineage for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Get all strategy versions for an agent
   * 
   * @param agentId Agent ID
   * @returns Array of strategy versions
   */
  public async getStrategyVersions(agentId: string): Promise<EvolutionRecord[]> {
    try {
      const result = await this.postgresService.query<EvolutionRecord>(
        `SELECT 
          id, 
          agent_id as "agentId", 
          strategy_id as "strategyId", 
          parent_strategy_id as "parentStrategyId", 
          mutation_type as "mutationType", 
          performance_snapshot as "performanceSnapshot", 
          EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
         FROM strategy_evolution_log
         WHERE agent_id = $1
         ORDER BY timestamp DESC`,
        [agentId]
      );

      return result.rows;
    } catch (error) {
      logger.error(`Error retrieving strategy versions for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Get the latest strategy for an agent
   * 
   * @param agentId Agent ID
   * @returns Latest strategy record or null if none exists
   */
  public async getLatestStrategy(agentId: string): Promise<EvolutionRecord | null> {
    try {
      // Try Redis first for faster lookup
      const cachedStrategyId = await this.redisClient.get(`evolution:latest:${agentId}`);
      
      if (cachedStrategyId) {
        // Get details from PostgreSQL
        const result = await this.postgresService.query<EvolutionRecord>(
          `SELECT 
            id, 
            agent_id as "agentId", 
            strategy_id as "strategyId", 
            parent_strategy_id as "parentStrategyId", 
            mutation_type as "mutationType", 
            performance_snapshot as "performanceSnapshot", 
            EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
           FROM strategy_evolution_log
           WHERE agent_id = $1 AND strategy_id = $2
           LIMIT 1`,
          [agentId, cachedStrategyId]
        );

        if (result.rows.length > 0) {
          return result.rows[0];
        }
      }

      // Fallback to getting the most recent from PostgreSQL
      const result = await this.postgresService.query<EvolutionRecord>(
        `SELECT 
          id, 
          agent_id as "agentId", 
          strategy_id as "strategyId", 
          parent_strategy_id as "parentStrategyId", 
          mutation_type as "mutationType", 
          performance_snapshot as "performanceSnapshot", 
          EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
         FROM strategy_evolution_log
         WHERE agent_id = $1
         ORDER BY timestamp DESC
         LIMIT 1`,
        [agentId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      // Update cache
      const latestStrategy = result.rows[0];
      await this.redisClient.set(`evolution:latest:${agentId}`, latestStrategy.strategyId);

      return latestStrategy;
    } catch (error) {
      logger.error(`Error retrieving latest strategy for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Emit performance metrics to telemetry stream
   * 
   * @param agentId Agent ID
   * @param strategyId Strategy ID
   * @param metrics Performance metrics
   */
  private async emitPerformanceMetrics(
    agentId: string,
    strategyId: string,
    metrics: PerformanceMetrics
  ): Promise<void> {
    try {
      // Get previous metrics for this strategy to calculate deltas
      const prevMetrics = await this.getLatestMetrics(strategyId);

      // For each metric in the performance snapshot, record a telemetry event
      for (const [metricType, value] of Object.entries(metrics)) {
        if (value === undefined) continue;

        // Calculate delta if previous value exists
        const prevValue = prevMetrics?.[metricType];
        const delta = prevValue !== undefined ? value - prevValue : undefined;

        // Create metric record
        const metricRecord: MetricRecord = {
          id: uuidv4(),
          agentId,
          strategyId,
          metricType,
          value,
          prevValue,
          delta,
          timestamp: Date.now()
        };

        // Store in PostgreSQL
        await this.postgresService.query(
          `INSERT INTO evolution_metrics
           (id, agent_id, strategy_id, metric_type, value, prev_value, delta, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            metricRecord.id,
            agentId,
            strategyId,
            metricType,
            value,
            prevValue !== undefined ? prevValue : null,
            delta !== undefined ? delta : null,
            new Date(metricRecord.timestamp)
          ]
        );

        // Store in Redis timeseries
        const timeSeriesKey = `evolution:metrics:${metricType}:${strategyId}`;
        await this.redisClient.zadd(
          timeSeriesKey,
          metricRecord.timestamp,
          JSON.stringify(metricRecord)
        );

        // Publish WebSocket event
        if (this.wsServer) {
          this.wsServer.broadcast('EVOLUTION_METRIC_UPDATED', metricRecord);
        }
      }

      logger.debug(`Emitted performance metrics for agent ${agentId}, strategy ${strategyId}`);
    } catch (error) {
      logger.error(`Error emitting performance metrics:`, error);
      // Non-blocking - we don't want to fail the mutation if telemetry fails
    }
  }

  /**
   * Get the latest metrics for a strategy
   * 
   * @param strategyId Strategy ID
   * @returns Latest performance metrics or undefined if none exist
   */
  private async getLatestMetrics(strategyId: string): Promise<PerformanceMetrics | undefined> {
    try {
      const result = await this.postgresService.query<{ metric_type: string; value: number }>(
        `SELECT metric_type, value
         FROM evolution_metrics
         WHERE strategy_id = $1
         AND timestamp = (
           SELECT MAX(timestamp)
           FROM evolution_metrics
           WHERE strategy_id = $1
           GROUP BY metric_type
         )`,
        [strategyId]
      );

      if (result.rows.length === 0) {
        return undefined;
      }

      // Convert rows to PerformanceMetrics object
      const metrics: PerformanceMetrics = {};
      for (const row of result.rows) {
        metrics[row.metric_type] = row.value;
      }

      return metrics;
    } catch (error) {
      logger.error(`Error retrieving latest metrics for strategy ${strategyId}:`, error);
      return undefined;
    }
  }

  /**
   * Get the evolution graph data for visualization
   * Returns a format compatible with D3.js visualization
   * 
   * @param agentId Agent ID
   * @returns D3-compatible graph data
   */
  public async getVisualizationData(agentId: string): Promise<any> {
    try {
      const lineage = await this.getLineage(agentId);

      // Transform to D3-compatible format
      return {
        nodes: lineage.nodes.map(node => ({
          id: node.strategyId,
          mutationType: node.mutationType,
          timestamp: node.timestamp,
          performanceSnapshot: node.performanceSnapshot
        })),
        links: lineage.edges.map(edge => ({
          source: edge.source,
          target: edge.target,
          mutationType: edge.mutationType
        }))
      };
    } catch (error) {
      logger.error(`Error generating visualization data for agent ${agentId}:`, error);
      throw error;
    }
  }
}

/**
 * Standalone function to record a mutation in the evolution graph
 * 
 * @param agentId Agent ID
 * @param strategyId Strategy ID
 * @param parentStrategyId Parent strategy ID
 * @param mutationType Type of mutation
 * @param performanceMetrics Performance metrics
 * @param options Additional options
 * @returns Evolution record
 */
export async function recordMutation(
  agentId: string,
  strategyId: string,
  parentStrategyId: string | undefined,
  mutationType: MutationType,
  performanceMetrics: PerformanceMetrics,
  options?: RecordMutationOptions
): Promise<EvolutionRecord> {
  // Check if singleton instance exists
  if (!EvolutionGraphEngine.instance) {
    throw new Error('Evolution Graph Engine not initialized. Call EvolutionGraphEngine.getInstance() first.');
  }

  return EvolutionGraphEngine.instance.recordMutation(
    agentId,
    strategyId,
    parentStrategyId,
    mutationType,
    performanceMetrics,
    options
  );
}

/**
 * Standalone function to get the lineage for an agent
 * 
 * @param agentId Agent ID
 * @returns Evolution graph for the agent
 */
export async function getLineage(agentId: string): Promise<EvolutionGraph> {
  // Check if singleton instance exists
  if (!EvolutionGraphEngine.instance) {
    throw new Error('Evolution Graph Engine not initialized. Call EvolutionGraphEngine.getInstance() first.');
  }

  return EvolutionGraphEngine.instance.getLineage(agentId);
}

/**
 * Standalone function to get the latest strategy for an agent
 * 
 * @param agentId Agent ID
 * @returns Latest strategy record or null if none exists
 */
export async function getLatestStrategy(agentId: string): Promise<EvolutionRecord | null> {
  // Check if singleton instance exists
  if (!EvolutionGraphEngine.instance) {
    throw new Error('Evolution Graph Engine not initialized. Call EvolutionGraphEngine.getInstance() first.');
  }

  return EvolutionGraphEngine.instance.getLatestStrategy(agentId);
} 