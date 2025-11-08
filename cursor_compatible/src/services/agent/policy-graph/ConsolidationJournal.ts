/**
 * ConsolidationJournal.ts
 * 
 * Records and retrieves consolidation actions for policy graphs:
 * - Logs before/after states of modifications
 * - Provides audit capabilities
 * - Enables rollback when needed
 */

import { RedisService } from '../../infrastructure/RedisService.js';
import { GraphChange } from './GraphConsolidator.js';
import { OptimizationType } from './PolicyGraphAnalyzer.js';
import logger from '../../../utils/logger.js';

/**
 * Journal query options interface
 */
export interface JournalQueryOptions {
  startTime?: number;
  endTime?: number;
  types?: OptimizationType[];
  limit?: number;
  offset?: number;
}

/**
 * Configuration for the consolidation journal
 */
export interface ConsolidationJournalConfig {
  // Redis key prefix
  redisKeyPrefix: string;
  
  // TTL for journal entries (ms)
  journalTtlMs: number;
  
  // Maximum entries per agent
  maxEntriesPerAgent: number;
  
  // Default page size for queries
  defaultPageSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ConsolidationJournalConfig = {
  redisKeyPrefix: 'agent:policy_graph',
  journalTtlMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  maxEntriesPerAgent: 1000,
  defaultPageSize: 50
};

/**
 * Consolidation Journal
 * 
 * Records and retrieves graph consolidation events
 */
export class ConsolidationJournal {
  private redisService: RedisService;
  private config: ConsolidationJournalConfig;
  
  /**
   * Creates a new ConsolidationJournal
   * 
   * @param redisService - Redis service
   * @param config - Journal configuration
   */
  constructor(
    redisService: RedisService,
    config: Partial<ConsolidationJournalConfig> = {}
  ) {
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('ConsolidationJournal initialized', {
      journalTtlDays: this.config.journalTtlMs / (24 * 60 * 60 * 1000)
    });
  }
  
  /**
   * Log a consolidation change to the journal
   * 
   * @param change - Graph change to log
   * @returns Whether logging was successful
   */
  public async logChange(change: GraphChange): Promise<boolean> {
    try {
      // Store the change
      const changeKey = `${this.config.redisKeyPrefix}:journal:change:${change.id}`;
      
      await this.redisService.setex(
        changeKey,
        Math.floor(this.config.journalTtlMs / 1000),
        JSON.stringify(change)
      );
      
      // Add to graph journal index
      const graphJournalKey = `${this.config.redisKeyPrefix}:journal:graph:${change.graphId}`;
      
      await this.redisService.zadd(
        graphJournalKey,
        change.timestamp,
        change.id
      );
      
      // Add to agent journal index
      const agentJournalKey = `${this.config.redisKeyPrefix}:journal:agent:${change.agentId}`;
      
      await this.redisService.zadd(
        agentJournalKey,
        change.timestamp,
        change.id
      );
      
      // Set TTL on indexes
      await this.redisService.expire(
        graphJournalKey,
        Math.floor(this.config.journalTtlMs / 1000)
      );
      
      await this.redisService.expire(
        agentJournalKey,
        Math.floor(this.config.journalTtlMs / 1000)
      );
      
      // Prune old entries if needed
      await this.pruneJournalEntries(agentJournalKey);
      
      logger.debug('Logged consolidation change', {
        changeId: change.id,
        graphId: change.graphId,
        type: change.type
      });
      
      return true;
    } catch (error) {
      logger.error('Error logging consolidation change', {
        error: error instanceof Error ? error.message : String(error),
        changeId: change.id
      });
      
      return false;
    }
  }
  
  /**
   * Get all changes for a graph
   * 
   * @param graphId - Graph ID
   * @param options - Query options
   * @returns Array of graph changes
   */
  public async getGraphChanges(
    graphId: string,
    options: JournalQueryOptions = {}
  ): Promise<GraphChange[]> {
    try {
      const graphJournalKey = `${this.config.redisKeyPrefix}:journal:graph:${graphId}`;
      
      // Determine query parameters
      const limit = options.limit || this.config.defaultPageSize;
      const offset = options.offset || 0;
      
      // Get change IDs based on time range
      let changeIds;
      
      if (options.startTime !== undefined && options.endTime !== undefined) {
        // Get by score range (time range)
        changeIds = await this.redisService.zrange(
          graphJournalKey,
          options.startTime,
          options.endTime
        );
      } else {
        // Get recent changes
        changeIds = await this.redisService.zrange(
          graphJournalKey,
          0,
          -1,
          'REV'
        );
      }
      
      if (!changeIds || changeIds.length === 0) {
        return [];
      }
      
      // Apply pagination
      const paginatedIds = changeIds.slice(offset, offset + limit);
      
      // Get details for each change
      const changes: GraphChange[] = [];
      
      for (const id of paginatedIds) {
        const changeKey = `${this.config.redisKeyPrefix}:journal:change:${id}`;
        const json = await this.redisService.get(changeKey);
        
        if (json) {
          const change = JSON.parse(json) as GraphChange;
          
          // Apply type filter if specified
          if (options.types && !options.types.includes(change.type)) {
            continue;
          }
          
          changes.push(change);
        }
      }
      
      return changes;
    } catch (error) {
      logger.error('Error getting graph changes', {
        error: error instanceof Error ? error.message : String(error),
        graphId
      });
      
      return [];
    }
  }
  
  /**
   * Get all changes for an agent
   * 
   * @param agentId - Agent ID
   * @param options - Query options
   * @returns Array of graph changes
   */
  public async getAgentChanges(
    agentId: string,
    options: JournalQueryOptions = {}
  ): Promise<GraphChange[]> {
    try {
      const agentJournalKey = `${this.config.redisKeyPrefix}:journal:agent:${agentId}`;
      
      // Determine query parameters
      const limit = options.limit || this.config.defaultPageSize;
      const offset = options.offset || 0;
      
      // Get change IDs based on time range
      let changeIds;
      
      if (options.startTime !== undefined && options.endTime !== undefined) {
        // Get by score range (time range)
        changeIds = await this.redisService.zrange(
          agentJournalKey,
          options.startTime,
          options.endTime
        );
      } else {
        // Get recent changes
        changeIds = await this.redisService.zrange(
          agentJournalKey,
          0,
          -1,
          'REV'
        );
      }
      
      if (!changeIds || changeIds.length === 0) {
        return [];
      }
      
      // Apply pagination
      const paginatedIds = changeIds.slice(offset, offset + limit);
      
      // Get details for each change
      const changes: GraphChange[] = [];
      
      for (const id of paginatedIds) {
        const changeKey = `${this.config.redisKeyPrefix}:journal:change:${id}`;
        const json = await this.redisService.get(changeKey);
        
        if (json) {
          const change = JSON.parse(json) as GraphChange;
          
          // Apply type filter if specified
          if (options.types && !options.types.includes(change.type)) {
            continue;
          }
          
          changes.push(change);
        }
      }
      
      return changes;
    } catch (error) {
      logger.error('Error getting agent changes', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return [];
    }
  }
  
  /**
   * Get a specific change by ID
   * 
   * @param changeId - Change ID
   * @returns The change or null if not found
   */
  public async getChange(changeId: string): Promise<GraphChange | null> {
    try {
      const changeKey = `${this.config.redisKeyPrefix}:journal:change:${changeId}`;
      const json = await this.redisService.get(changeKey);
      
      if (!json) {
        return null;
      }
      
      return JSON.parse(json) as GraphChange;
    } catch (error) {
      logger.error('Error getting change', {
        error: error instanceof Error ? error.message : String(error),
        changeId
      });
      
      return null;
    }
  }
  
  /**
   * Get consolidated metrics about graph changes over time
   * 
   * @param graphId - Graph ID
   * @param startTime - Start timestamp
   * @param endTime - End timestamp
   * @returns Metrics about graph changes
   */
  public async getGraphMetrics(
    graphId: string,
    startTime: number,
    endTime: number
  ): Promise<{
    totalChanges: number;
    typeBreakdown: Record<string, number>;
    trustImpact: number;
    changeRatePerDay: number;
    riskScore: number;
  }> {
    try {
      // Get changes in time range
      const changes = await this.getGraphChanges(graphId, {
        startTime,
        endTime
      });
      
      // No changes in range
      if (changes.length === 0) {
        return {
          totalChanges: 0,
          typeBreakdown: {},
          trustImpact: 0,
          changeRatePerDay: 0,
          riskScore: 0
        };
      }
      
      // Calculate metrics
      const typeBreakdown: Record<string, number> = {};
      let trustImpact = 0;
      
      for (const change of changes) {
        // Count by type
        typeBreakdown[change.type] = (typeBreakdown[change.type] || 0) + 1;
        
        // Sum trust impact
        trustImpact += change.trustImpact;
      }
      
      // Calculate change rate
      const daySpan = (endTime - startTime) / (24 * 60 * 60 * 1000);
      const changeRatePerDay = daySpan > 0 ? changes.length / daySpan : 0;
      
      // Calculate risk score (higher = more risky changes)
      // This is a simplified model - in production this would be more sophisticated
      const riskFactors = {
        [OptimizationType.DEPRECATE_NODE]: 2,
        [OptimizationType.MERGE_NODES]: 1.5,
        [OptimizationType.REWIRE_EDGE]: 1,
        [OptimizationType.REMOVE_EDGE]: 1.2,
        [OptimizationType.REWEIGHT_EDGE]: 0.5
      };
      
      let riskScore = 0;
      
      for (const [type, count] of Object.entries(typeBreakdown)) {
        riskScore += (riskFactors[type as OptimizationType] || 1) * count;
      }
      
      // Normalize risk score
      riskScore = Math.min(10, riskScore / 10);
      
      return {
        totalChanges: changes.length,
        typeBreakdown,
        trustImpact,
        changeRatePerDay,
        riskScore
      };
    } catch (error) {
      logger.error('Error getting graph metrics', {
        error: error instanceof Error ? error.message : String(error),
        graphId
      });
      
      return {
        totalChanges: 0,
        typeBreakdown: {},
        trustImpact: 0,
        changeRatePerDay: 0,
        riskScore: 0
      };
    }
  }
  
  /**
   * Prune old journal entries if count exceeds maximum
   * 
   * @param journalKey - Redis key for journal index
   */
  private async pruneJournalEntries(journalKey: string): Promise<void> {
    try {
      // Get count of entries
      const count = await this.redisService.zcard(journalKey);
      
      if (count <= this.config.maxEntriesPerAgent) {
        return;
      }
      
      // Calculate how many to remove
      const removeCount = count - this.config.maxEntriesPerAgent;
      
      // Get oldest entries
      const oldestIds = await this.redisService.zrange(
        journalKey,
        0,
        removeCount - 1
      );
      
      if (!oldestIds || oldestIds.length === 0) {
        return;
      }
      
      // Delete change records
      for (const id of oldestIds) {
        const changeKey = `${this.config.redisKeyPrefix}:journal:change:${id}`;
        await this.redisService.del(changeKey);
      }
      
      // Remove from index
      await this.redisService.zrem(journalKey, ...oldestIds);
      
      logger.debug('Pruned old journal entries', {
        journalKey,
        removedCount: oldestIds.length
      });
    } catch (error) {
      logger.error('Error pruning journal entries', {
        error: error instanceof Error ? error.message : String(error),
        journalKey
      });
    }
  }
} 