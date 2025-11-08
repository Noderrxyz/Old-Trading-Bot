/**
 * RegretBuffer Service
 * 
 * Tracks agent decision regret to help agents avoid repeating costly behaviors.
 * Provides persistence and querying capabilities for regret entries.
 */

import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../infrastructure/RedisService.js';
import logger from '../../utils/logger.js';

/**
 * Regret entry interface
 */
export interface RegretEntry {
  id: string;
  agentId: string;
  action: string;
  outcome: string;
  regretScore: number;
  timestamp: number;
  assetSymbol?: string;
  actionContext?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * RegretBuffer configuration options
 */
export interface RegretBufferConfig {
  // Redis key prefix for regret entries
  keyPrefix: string;
  
  // Maximum number of regret entries to keep per agent
  maxEntriesPerAgent: number;
  
  // TTL in milliseconds for regret entries
  ttlMs: number;
  
  // Regret score threshold for storing entries (0-1)
  minRegretScoreThreshold: number;
  
  // How quickly regret scores decay over time (daily multiplier < 1)
  regretDecayRate: number;
  
  // Whether to enable automatic publishing of high-regret events
  publishHighRegretEvents: boolean;
  
  // Threshold for high regret events
  highRegretThreshold: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RegretBufferConfig = {
  keyPrefix: 'agent:regret',
  maxEntriesPerAgent: 100,
  ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  minRegretScoreThreshold: 0.1,
  regretDecayRate: 0.95, // 5% decay per day
  publishHighRegretEvents: true,
  highRegretThreshold: 0.7
};

/**
 * Regret query options
 */
export interface RegretQueryOptions {
  startTime?: number;
  endTime?: number;
  minRegretScore?: number;
  maxRegretScore?: number;
  outcome?: string;
  action?: string;
  assetSymbol?: string;
  limit?: number;
  sortDescending?: boolean;
}

/**
 * RegretBuffer service that tracks agent decision regret
 */
export class RegretBuffer {
  private redisService: RedisService;
  private config: RegretBufferConfig;
  
  /**
   * Creates a new RegretBuffer instance
   * 
   * @param redisService - Redis service for data persistence
   * @param config - Configuration options
   */
  constructor(
    redisService: RedisService,
    config: Partial<RegretBufferConfig> = {}
  ) {
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('RegretBuffer initialized', {
      maxEntries: this.config.maxEntriesPerAgent,
      ttlDays: this.config.ttlMs / (24 * 60 * 60 * 1000)
    });
  }
  
  /**
   * Log a regret entry
   * 
   * @param entry - Regret entry without ID or timestamp
   * @returns The stored regret entry ID if successful, null otherwise
   */
  public async log(entry: Omit<RegretEntry, 'id' | 'timestamp'>): Promise<string | null> {
    try {
      // Skip if regret score is below threshold
      if (entry.regretScore < this.config.minRegretScoreThreshold) {
        logger.debug('Regret score below threshold, skipping', {
          agentId: entry.agentId,
          regretScore: entry.regretScore
        });
        return null;
      }
      
      // Create full entry with ID and timestamp
      const fullEntry: RegretEntry = {
        id: uuidv4(),
        timestamp: Date.now(),
        ...entry
      };
      
      // Store in Redis
      await this.storeRegretEntry(fullEntry);
      
      // Publish high regret events
      if (this.config.publishHighRegretEvents && entry.regretScore >= this.config.highRegretThreshold) {
        await this.publishHighRegretEvent(fullEntry);
      }
      
      // Prune old entries if needed
      await this.pruneOldEntries(entry.agentId);
      
      return fullEntry.id;
    } catch (error) {
      logger.error('Error logging regret entry', {
        error: error instanceof Error ? error.message : String(error),
        agentId: entry.agentId,
        action: entry.action
      });
      return null;
    }
  }
  
  /**
   * Get regret entries for a specific agent
   * 
   * @param agentId - Agent ID
   * @param options - Query options
   * @returns List of regret entries
   */
  public async getAgentRegretEntries(
    agentId: string, 
    options: RegretQueryOptions = {}
  ): Promise<RegretEntry[]> {
    try {
      const entriesKey = `${this.config.keyPrefix}:entries:${agentId}`;
      
      // Get all entries
      const entryIds = await this.redisService.lrange(
        entriesKey,
        0,
        -1
      );
      
      if (!entryIds || entryIds.length === 0) {
        return [];
      }
      
      // Get full entries
      const entries: RegretEntry[] = [];
      
      for (const id of entryIds) {
        const entryKey = `${this.config.keyPrefix}:entry:${id}`;
        const json = await this.redisService.get(entryKey);
        
        if (json) {
          const entry = JSON.parse(json) as RegretEntry;
          
          // Apply filters
          if (this.matchesQueryOptions(entry, options)) {
            entries.push(entry);
          }
          
          // Apply limit
          if (options.limit && entries.length >= options.limit) {
            break;
          }
        }
      }
      
      return entries;
    } catch (error) {
      logger.error('Error getting agent regret entries', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return [];
    }
  }
  
  /**
   * Calculate agent's total regret score (sum of all active entries with decay)
   * 
   * @param agentId - Agent ID
   * @returns Total regret score
   */
  public async calculateTotalRegret(agentId: string): Promise<number> {
    try {
      const entries = await this.getAgentRegretEntries(agentId);
      
      if (entries.length === 0) {
        return 0;
      }
      
      // Apply time-based decay and sum
      const now = Date.now();
      let totalRegret = 0;
      
      for (const entry of entries) {
        const daysSinceEntry = (now - entry.timestamp) / (24 * 60 * 60 * 1000);
        const decayFactor = Math.pow(this.config.regretDecayRate, daysSinceEntry);
        totalRegret += entry.regretScore * decayFactor;
      }
      
      return totalRegret;
    } catch (error) {
      logger.error('Error calculating total regret', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return 0;
    }
  }
  
  /**
   * Get regret summary for an agent
   * 
   * @param agentId - Agent ID
   * @returns Summary statistics
   */
  public async getRegretSummary(agentId: string): Promise<{
    totalRegret: number;
    avgRegret: number;
    maxRegret: number;
    entryCount: number;
    recentRegret: number;
    actionCounts: Record<string, number>;
  }> {
    try {
      const entries = await this.getAgentRegretEntries(agentId);
      
      if (entries.length === 0) {
        return {
          totalRegret: 0,
          avgRegret: 0,
          maxRegret: 0,
          entryCount: 0,
          recentRegret: 0,
          actionCounts: {}
        };
      }
      
      let totalRegret = 0;
      let maxRegret = 0;
      const actionCounts: Record<string, number> = {};
      const now = Date.now();
      let recentRegret = 0;
      const recentTimeWindow = 7 * 24 * 60 * 60 * 1000; // 7 days
      
      for (const entry of entries) {
        const daysSinceEntry = (now - entry.timestamp) / (24 * 60 * 60 * 1000);
        const decayFactor = Math.pow(this.config.regretDecayRate, daysSinceEntry);
        const decayedRegret = entry.regretScore * decayFactor;
        
        totalRegret += decayedRegret;
        maxRegret = Math.max(maxRegret, decayedRegret);
        
        // Count actions
        actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
        
        // Calculate recent regret
        if (now - entry.timestamp < recentTimeWindow) {
          recentRegret += decayedRegret;
        }
      }
      
      return {
        totalRegret,
        avgRegret: totalRegret / entries.length,
        maxRegret,
        entryCount: entries.length,
        recentRegret,
        actionCounts
      };
    } catch (error) {
      logger.error('Error getting regret summary', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return {
        totalRegret: 0,
        avgRegret: 0,
        maxRegret: 0,
        entryCount: 0,
        recentRegret: 0,
        actionCounts: {}
      };
    }
  }
  
  /**
   * Delete a regret entry
   * 
   * @param entryId - Entry ID
   * @returns Whether deletion was successful
   */
  public async deleteRegretEntry(entryId: string): Promise<boolean> {
    try {
      // Get entry first to find the agent ID
      const entryKey = `${this.config.keyPrefix}:entry:${entryId}`;
      const json = await this.redisService.get(entryKey);
      
      if (!json) {
        logger.warn('Regret entry not found for deletion', { entryId });
        return false;
      }
      
      const entry = JSON.parse(json) as RegretEntry;
      const entriesKey = `${this.config.keyPrefix}:entries:${entry.agentId}`;
      
      // Delete both the entry and its reference
      await this.redisService.del(entryKey);
      await this.redisService.srem(entriesKey, entryId);
      
      logger.info('Deleted regret entry', { entryId, agentId: entry.agentId });
      return true;
    } catch (error) {
      logger.error('Error deleting regret entry', {
        error: error instanceof Error ? error.message : String(error),
        entryId
      });
      return false;
    }
  }
  
  /**
   * Clear all regret entries for an agent
   * 
   * @param agentId - Agent ID
   * @returns Number of entries cleared
   */
  public async clearAgentRegret(agentId: string): Promise<number> {
    try {
      const entriesKey = `${this.config.keyPrefix}:entries:${agentId}`;
      const entryIds = await this.redisService.lrange(entriesKey, 0, -1);
      
      if (!entryIds || entryIds.length === 0) {
        return 0;
      }
      
      // Delete all entry keys
      for (const id of entryIds) {
        const entryKey = `${this.config.keyPrefix}:entry:${id}`;
        await this.redisService.del(entryKey);
      }
      
      // Delete the entries list
      await this.redisService.del(entriesKey);
      
      logger.info('Cleared regret entries for agent', {
        agentId,
        count: entryIds.length
      });
      
      return entryIds.length;
    } catch (error) {
      logger.error('Error clearing agent regret', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      return 0;
    }
  }
  
  /**
   * Store regret entry in Redis
   * 
   * @param entry - Full regret entry
   */
  private async storeRegretEntry(entry: RegretEntry): Promise<void> {
    const entryKey = `${this.config.keyPrefix}:entry:${entry.id}`;
    const entriesKey = `${this.config.keyPrefix}:entries:${entry.agentId}`;
    
    // Store the entry
    await this.redisService.setex(
      entryKey,
      Math.floor(this.config.ttlMs / 1000),
      JSON.stringify(entry)
    );
    
    // Add to the agent's entries sorted set
    await this.redisService.sadd(
      entriesKey,
      entry.id
    );
    
    // Set TTL on the agent's entries list too
    await this.redisService.expire(
      entriesKey,
      Math.floor(this.config.ttlMs / 1000)
    );
    
    logger.debug('Stored regret entry', {
      entryId: entry.id,
      agentId: entry.agentId,
      regretScore: entry.regretScore
    });
  }
  
  /**
   * Publish high regret event to Redis
   * 
   * @param entry - Regret entry
   */
  private async publishHighRegretEvent(entry: RegretEntry): Promise<void> {
    try {
      const eventData = {
        type: 'high_regret',
        entry,
        timestamp: Date.now()
      };
      
      await this.redisService.publish(
        'events:agent:regret',
        JSON.stringify(eventData)
      );
      
      logger.info('Published high regret event', {
        agentId: entry.agentId,
        regretScore: entry.regretScore,
        action: entry.action
      });
    } catch (error) {
      logger.error('Error publishing high regret event', {
        error: error instanceof Error ? error.message : String(error),
        agentId: entry.agentId
      });
    }
  }
  
  /**
   * Prune old entries if the count exceeds the maximum
   * 
   * @param agentId - Agent ID
   */
  private async pruneOldEntries(agentId: string): Promise<void> {
    try {
      const entriesKey = `${this.config.keyPrefix}:entries:${agentId}`;
      const entryIds = await this.redisService.smembers(entriesKey);
      const count = entryIds.length;
      
      if (count <= this.config.maxEntriesPerAgent) {
        return;
      }
      
      const toRemove = count - this.config.maxEntriesPerAgent;
      
      // Sort by timestamp (we need to get entries first)
      const entries: Array<{id: string, timestamp: number}> = [];
      for (const id of entryIds) {
        const entryKey = `${this.config.keyPrefix}:entry:${id}`;
        const json = await this.redisService.get(entryKey);
        if (json) {
          const entry = JSON.parse(json) as RegretEntry;
          entries.push({ id, timestamp: entry.timestamp });
        }
      }
      
      // Sort by timestamp (oldest first)
      entries.sort((a, b) => a.timestamp - b.timestamp);
      
      // Get oldest entries to remove
      const oldestEntryIds = entries.slice(0, toRemove).map(e => e.id);
      
      if (oldestEntryIds.length === 0) {
        return;
      }
      
      // Delete entry keys
      for (const id of oldestEntryIds) {
        const entryKey = `${this.config.keyPrefix}:entry:${id}`;
        await this.redisService.del(entryKey);
      }
      
      // Remove from set
      await this.redisService.srem(entriesKey, ...oldestEntryIds);
      
      logger.debug('Pruned old regret entries', {
        agentId,
        removedCount: oldestEntryIds.length
      });
    } catch (error) {
      logger.error('Error pruning old regret entries', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
    }
  }
  
  /**
   * Check if a regret entry matches query options
   * 
   * @param entry - Regret entry
   * @param options - Query options
   * @returns Whether the entry matches the options
   */
  private matchesQueryOptions(entry: RegretEntry, options: RegretQueryOptions): boolean {
    // Time range
    if (options.startTime && entry.timestamp < options.startTime) {
      return false;
    }
    
    if (options.endTime && entry.timestamp > options.endTime) {
      return false;
    }
    
    // Regret score range
    if (options.minRegretScore !== undefined && entry.regretScore < options.minRegretScore) {
      return false;
    }
    
    if (options.maxRegretScore !== undefined && entry.regretScore > options.maxRegretScore) {
      return false;
    }
    
    // Outcome
    if (options.outcome && entry.outcome !== options.outcome) {
      return false;
    }
    
    // Action
    if (options.action && entry.action !== options.action) {
      return false;
    }
    
    // Asset symbol
    if (options.assetSymbol && entry.assetSymbol !== options.assetSymbol) {
      return false;
    }
    
    return true;
  }
} 