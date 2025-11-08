/**
 * Agent Metrics Service
 * 
 * Service for retrieving and processing agent performance metrics
 * from Redis and falling back to Postgres when necessary.
 */

import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { 
  AgentPerformanceSnapshot, 
  AgentPerformanceHistoryPoint, 
  AgentLifecycleState,
  ExecutionMode 
} from '../types.js';

const logger = createLogger('AgentMetricsService');

/**
 * Default time range values in milliseconds
 */
const TIME_RANGES = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'all': Number.MAX_SAFE_INTEGER
};

/**
 * Time resolution mapping (for data points)
 */
const RESOLUTIONS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000
};

/**
 * Service for retrieving and processing agent metrics
 */
export class AgentMetricsService {
  private redis: RedisClient;

  /**
   * Create a new metrics service
   */
  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  /**
   * Get performance snapshot for multiple agents
   * @param agentIds List of agent IDs to get metrics for (or all if not specified)
   * @returns Array of agent performance snapshots
   */
  public async getAgentPerformanceSnapshots(
    agentIds?: string[]
  ): Promise<AgentPerformanceSnapshot[]> {
    try {
      // If no agent IDs specified, get all active agents
      const targetAgentIds = agentIds || await this.getAllActiveAgentIds();
      
      // Get performance snapshots for each agent
      const promises = targetAgentIds.map(id => this.getAgentPerformanceSnapshot(id));
      const snapshots = await Promise.all(promises);
      
      // Filter out null values (agents that couldn't be found)
      return snapshots.filter(Boolean) as AgentPerformanceSnapshot[];
    } catch (error) {
      logger.error(`Failed to get agent performance snapshots: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Get performance snapshot for a single agent
   * @param agentId Agent ID
   * @returns Agent performance snapshot or null if not found
   */
  public async getAgentPerformanceSnapshot(
    agentId: string
  ): Promise<AgentPerformanceSnapshot | null> {
    try {
      // Get agent metrics from Redis
      const metricsKey = `agent:${agentId}:metrics`;
      const metricsData = await this.redis.get(metricsKey);
      
      if (!metricsData) {
        return null; // Agent not found
      }
      
      const metrics = JSON.parse(metricsData);
      
      // Get agent registration info
      const regKey = `agent:${agentId}:registration`;
      const regData = await this.redis.get(regKey);
      const registration = regData ? JSON.parse(regData) : null;
      
      // Get agent state
      const stateKey = `agent:${agentId}:state`;
      const stateData = await this.redis.get(stateKey);
      const state = stateData || AgentLifecycleState.INITIALIZING;
      
      // Get last trade information
      const lastTradeKey = `agent:${agentId}:last_trade`;
      const lastTradeData = await this.redis.get(lastTradeKey);
      const lastTrade = lastTradeData ? JSON.parse(lastTradeData) : null;
      
      // Determine if agent is canary
      const isCanary = registration?.config?.executionConfig?.mode === 'canary' || 
                      registration?.config?.executionConfig?.canaryMode === true;
      
      // Get agent mode
      const mode = registration?.config?.executionConfig?.mode || 'live';
      
      // Get start time to calculate uptime
      const startTimeKey = `agent:${agentId}:start_time`;
      const startTimeData = await this.redis.get(startTimeKey);
      const startTime = startTimeData ? parseInt(startTimeData) : Date.now();
      const uptime = Date.now() - startTime;
      
      // Create performance snapshot
      const snapshot: AgentPerformanceSnapshot = {
        agentId,
        name: registration?.name || agentId,
        mode: mode as ExecutionMode,
        state: state as AgentLifecycleState,
        cumulativePnL: metrics.pnl || 0,
        realizedPnL: metrics.realizedPnL || 0,
        unrealizedPnL: metrics.unrealizedPnL || 0,
        winRate: metrics.winRate || 0,
        signalCount: metrics.signalCount || 0,
        avgLatency: metrics.avgLatency || 0,
        currentDrawdownPct: metrics.currentDrawdownPct || 0,
        maxDrawdownPct: metrics.maxDrawdownPct || 0,
        uptime,
        isCanary,
        lastTrade: lastTrade ? {
          timestamp: lastTrade.timestamp,
          price: lastTrade.price,
          type: lastTrade.side,
          asset: lastTrade.asset
        } : undefined,
        timestamp: Date.now()
      };
      
      return snapshot;
    } catch (error) {
      logger.error(`Failed to get agent performance snapshot for ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get historical performance data for multiple agents
   * @param agentIds List of agent IDs to get history for
   * @param timeRange Time range to get history for ('1h', '1d', '7d', etc.)
   * @param resolution Data point resolution ('1m', '5m', '1h', etc.)
   * @returns Map of agent IDs to performance history points
   */
  public async getAgentPerformanceHistory(
    agentIds: string[],
    timeRange: string = '1d',
    resolution: string = '5m'
  ): Promise<Record<string, AgentPerformanceHistoryPoint[]>> {
    try {
      // Convert time range to milliseconds
      const timeRangeMs = TIME_RANGES[timeRange as keyof typeof TIME_RANGES] || TIME_RANGES['1d'];
      
      // Calculate start time
      const startTime = Date.now() - timeRangeMs;
      
      // Get history for each agent
      const result: Record<string, AgentPerformanceHistoryPoint[]> = {};
      for (const agentId of agentIds) {
        result[agentId] = await this.getAgentHistoryPoints(agentId, startTime, resolution);
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to get agent performance history: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  /**
   * Get historical performance data points for a single agent
   * @param agentId Agent ID
   * @param startTime Start timestamp
   * @param resolution Data point resolution
   * @returns Array of performance history points
   */
  private async getAgentHistoryPoints(
    agentId: string,
    startTime: number,
    resolution: string
  ): Promise<AgentPerformanceHistoryPoint[]> {
    try {
      // Get time series data from Redis
      const pnlKey = `agent:${agentId}:ts:pnl`;
      const drawdownKey = `agent:${agentId}:ts:drawdown`;
      const exposureKey = `agent:${agentId}:ts:exposure`;
      
      // Get all data points since startTime
      const [pnlData, drawdownData, exposureData] = await Promise.all([
        this.redis.zrangebyscore(pnlKey, startTime, '+inf', 'WITHSCORES'),
        this.redis.zrangebyscore(drawdownKey, startTime, '+inf', 'WITHSCORES'),
        this.redis.zrangebyscore(exposureKey, startTime, '+inf', 'WITHSCORES')
      ]);
      
      // Convert Redis response to maps for easier processing
      const pnlMap = this.convertRedisTimeSeriesData(pnlData);
      const drawdownMap = this.convertRedisTimeSeriesData(drawdownData);
      const exposureMap = this.convertRedisTimeSeriesData(exposureData);
      
      // Get all unique timestamps
      const timestamps = new Set<number>();
      for (const ts of [...pnlMap.keys(), ...drawdownMap.keys(), ...exposureMap.keys()]) {
        timestamps.add(ts);
      }
      
      // Sort timestamps
      const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);
      
      // Group data points by resolution
      const resolutionMs = RESOLUTIONS[resolution as keyof typeof RESOLUTIONS] || RESOLUTIONS['5m'];
      const groupedPoints: AgentPerformanceHistoryPoint[] = [];
      
      let currentGroup: number[] = [];
      let currentGroupStartTime = 0;
      
      for (const ts of sortedTimestamps) {
        if (currentGroupStartTime === 0) {
          currentGroupStartTime = ts;
        }
        
        if (ts - currentGroupStartTime < resolutionMs) {
          // Add to current group
          currentGroup.push(ts);
        } else {
          // Process current group and start a new one
          if (currentGroup.length > 0) {
            const groupPoint = this.createHistoryPointFromGroup(
              agentId,
              currentGroup,
              pnlMap,
              drawdownMap,
              exposureMap
            );
            
            groupedPoints.push(groupPoint);
          }
          
          // Start new group
          currentGroupStartTime = ts;
          currentGroup = [ts];
        }
      }
      
      // Process the last group
      if (currentGroup.length > 0) {
        const groupPoint = this.createHistoryPointFromGroup(
          agentId,
          currentGroup,
          pnlMap,
          drawdownMap,
          exposureMap
        );
        
        groupedPoints.push(groupPoint);
      }
      
      return groupedPoints;
    } catch (error) {
      logger.error(`Failed to get agent history points for ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Convert Redis time series data to a map
   * @param data Redis ZRANGEBYSCORE response
   * @returns Map of timestamps to values
   */
  private convertRedisTimeSeriesData(data: string[]): Map<number, number> {
    const result = new Map<number, number>();
    
    // Redis ZRANGEBYSCORE with WITHSCORES returns [value1, score1, value2, score2, ...]
    for (let i = 0; i < data.length; i += 2) {
      const value = parseFloat(data[i]);
      const timestamp = parseInt(data[i + 1]);
      result.set(timestamp, value);
    }
    
    return result;
  }

  /**
   * Create a history data point from a group of timestamps
   * @param agentId Agent ID
   * @param timestamps Timestamps in the group
   * @param pnlMap Map of timestamps to PnL values
   * @param drawdownMap Map of timestamps to drawdown values
   * @param exposureMap Map of timestamps to exposure values
   * @returns History data point
   */
  private createHistoryPointFromGroup(
    agentId: string,
    timestamps: number[],
    pnlMap: Map<number, number>,
    drawdownMap: Map<number, number>,
    exposureMap: Map<number, number>
  ): AgentPerformanceHistoryPoint {
    // Use the latest timestamp as the group timestamp
    const latestTimestamp = Math.max(...timestamps);
    
    // For PnL, use the latest value in the group
    let pnl = 0;
    for (const ts of timestamps) {
      if (pnlMap.has(ts)) {
        pnl = pnlMap.get(ts)!;
      }
    }
    
    // For drawdown, use the maximum in the group
    let drawdown = 0;
    for (const ts of timestamps) {
      if (drawdownMap.has(ts) && drawdownMap.get(ts)! > drawdown) {
        drawdown = drawdownMap.get(ts)!;
      }
    }
    
    // For exposure, use the average in the group
    let exposureSum = 0;
    let exposureCount = 0;
    for (const ts of timestamps) {
      if (exposureMap.has(ts)) {
        exposureSum += exposureMap.get(ts)!;
        exposureCount++;
      }
    }
    const exposure = exposureCount > 0 ? exposureSum / exposureCount : 0;
    
    return {
      agentId,
      timestamp: latestTimestamp,
      cumulativePnL: pnl,
      drawdownPct: drawdown,
      exposure
    };
  }

  /**
   * Get all active agent IDs from Redis
   * @returns Array of active agent IDs
   */
  private async getAllActiveAgentIds(): Promise<string[]> {
    try {
      // Get all agent registrations
      const keys = await this.redis.keys('agent:*:registration');
      
      // Extract agent IDs from keys
      const agentIds = keys.map(key => {
        const match = key.match(/agent:(.+):registration/);
        return match ? match[1] : null;
      }).filter(Boolean) as string[];
      
      return agentIds;
    } catch (error) {
      logger.error(`Failed to get all active agent IDs: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
} 